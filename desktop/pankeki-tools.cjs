'use strict';
// Pankeki tool layer shared by the desktop chat bridges.
//
// The six model-facing tools, their argument bounds, the action guard, the job
// ownership ledger and path-free results. Tools run locally through the existing
// Pankeki MCP adapter (plugins/pankeki-local) as a stdio MCP client, so
// source/mask paths come from the app's resolver and never reach a remote model.
// Same behaviour as the tool code in codex-bridge.cjs, which stays frozen until
// its Codex path is re-tested; it should then import this module instead.
const {spawn} = require('node:child_process');
const platformInfo = require('./platform.cjs');
const fs = require('node:fs');
const path = require('node:path');
// Packaged bytes and development bytes use the same shared browser/Node validator.
const Design = require(require('node:fs').existsSync(require('node:path').join(__dirname,'profiles.cjs'))?'./profiles.cjs':'../web/src/profiles.js');

const MCP_PROTOCOL = '2025-06-18';
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const JOB = /^[0-9a-f]{32}$/;
const MAX_TEXT = 8000;
const JOB_STATUSES = new Set(['queued', 'submitting', 'running', 'canceling', 'canceled', 'succeeded', 'failed', 'uncertain', 'orphaned']);

const num = (minimum, maximum, integer = false) => ({type: integer ? 'integer' : 'number', minimum, maximum});
const job = {type: 'object', properties: {job_id: {type: 'string', pattern: '^[0-9a-f]{32}$'}}, required: ['job_id'], additionalProperties: false};
// Model-facing tools. Bounds mirror plugins/pankeki-local/server/CONTRACT.md.
const TOOLS = {
  pankeki_status: {description: 'Check whether the local Pankeki app and its image models are available.',
    inputSchema: {type: 'object', properties: {}, additionalProperties: false}, mcp: 'pankeki_get_status'},
  pankeki_generate: {description: 'Start a new image generation job in Pankeki. Returns a job_id; poll pankeki_job, then call pankeki_result.',
    inputSchema: {type: 'object', additionalProperties: false, required: ['prompt'], properties: {
      prompt: {type: 'string', maxLength: 4000}, negative: {type: 'string', maxLength: 4000},
      model_id: {type: 'string', enum: ['sdxl-base', 'sd-turbo', 'animagine-xl-4.0-opt']}, seed: num(0, 2 ** 53 - 1, true),
      sampler: {type:'string',enum:['euler','euler_ancestral','dpmpp_2m']},scheduler: {type:'string',enum:['normal','simple','karras']},
      width: num(64, 2048, true), height: num(64, 2048, true), steps: num(1, 100, true), cfg: num(0, 30)}}, mcp: 'pankeki_generate_image'},
  pankeki_edit: {description: 'Use only the app-bound image. operation=recompose creates a new whole-image source-conditioned candidate for explicit pose/viewpoint/composition changes; it needs a source but no mask. operation=regenerate repaints a user mask; operation=recolor changes colors inside a user mask. Narrow edits require a mask/pin; never recompose as their fallback.',
    inputSchema: {type: 'object', additionalProperties: false, required: ['operation'], properties: {
      operation: {type: 'string', enum: ['regenerate', 'recolor', 'recompose']}, prompt: {type: 'string', maxLength: 4000}, negative: {type: 'string', maxLength: 4000},
      target_color: {type: 'string', pattern: '^#[0-9A-Fa-f]{6}$'}, source_color: {type: 'string', pattern: '^#[0-9A-Fa-f]{6}$'},
      color_tolerance: num(0, 90), model_id: {type: 'string', enum: ['sdxl-base', 'sdxl-inpaint-v01','animagine-xl-4.0-opt']}, seed: num(0, 2 ** 53 - 1, true),
      steps: num(1, 100, true), cfg: num(0, 30), denoise: num(0.01, 1)}}, mcp: 'pankeki_edit_image'},
  pankeki_job: {description: 'Get the state of a Pankeki job started in this conversation.', inputSchema: job, mcp: 'pankeki_get_job'},
  pankeki_result: {description: 'Fetch the verified result of a succeeded Pankeki job started in this conversation.', inputSchema: job, mcp: 'pankeki_get_result'},
  pankeki_cancel: {description: 'Cancel a Pankeki job started in this conversation.', inputSchema: job, mcp: 'pankeki_cancel_job'}
};
const TOOL_NAMES = Object.keys(TOOLS);
function normalizedCapabilities(value) {
  if(value?.source==='legacy')return value;
  const raw={...value};delete raw.source;return Design.validateCapabilities(raw);
}
function createToolSchemas(snapshot) {
  if(!snapshot)return TOOLS;
  const caps=normalizedCapabilities(snapshot),schemas=JSON.parse(JSON.stringify(TOOLS));
  schemas.pankeki_generate.inputSchema.properties.model_id.enum=Design.capabilityModels(caps,'generate').filter(v=>v.available).map(v=>v.id);
  const operations=['regenerate','recolor','recompose'].filter(id=>Design.capabilityOperation(caps,id).ready);
  schemas.pankeki_edit.inputSchema.properties.operation.enum=operations;
  schemas.pankeki_edit.inputSchema.properties.model_id.enum=[...new Set(['regenerate','recompose'].flatMap(id=>Design.capabilityModels(caps,id).filter(v=>v.available).map(v=>v.id)))];
  return schemas;
}
function authorizeTool(snapshot,tool,args,ref={}) {
  if(!snapshot||!['pankeki_generate','pankeki_edit'].includes(tool))return;
  const caps=normalizedCapabilities(snapshot),operation=tool==='pankeki_generate'?'generate':args.operation;
  if(ref.automatic?.capabilityRevision!==undefined&&ref.automatic.capabilityRevision!==caps.revision)throw new BridgeError('capability-changed','Image capability revision changed; capture the app context again');
  const row=Design.capabilityOperation(caps,operation);
  if(!row.ready)throw new BridgeError('capability-unavailable',row.reason||'Image capability unavailable');
  if(operation==='recolor')return;
  const model=args.model_id||caps.default_model_id;
  if(!Design.capabilityModels(caps,operation).some(value=>value.id===model&&value.available))throw new BridgeError('capability-unavailable','Selected model is unavailable for '+operation);
}
function createCapabilityReader({origin,verifyBackend,fetchImpl=fetch}) {
  return async function readCapabilities(){
    if(!await verifyBackend())throw Error('backend-identity-changed');
    const get=async endpoint=>fetchImpl(origin+endpoint,{redirect:'error',signal:AbortSignal.timeout(2500),headers:{origin}});
    const response=await get('/api/capabilities');
    let result;
    if(response.status===404){const legacy=await get('/api/models');if(!legacy.ok)throw Error('capability-unavailable');result=Design.legacyCapabilities(await legacy.json());}
    else {if(!response.ok)throw Error('capability-unavailable');result=Design.validateCapabilities(await response.json());}
    if(!await verifyBackend())throw Error('backend-identity-changed');return result;
  };
}

// Leading action line written by the app's message formatter. Only the first
// line counts; it limits which submitting tool this request may run.
const ACTION = /^\[Pankeki action: (chat|generate|edit)\]$/;
const SUBMITS = {chat: [], generate: ['pankeki_generate'], edit: ['pankeki_edit']};
const TERMINAL = new Set(['canceled', 'succeeded', 'failed', 'orphaned']);
// Keys never forwarded from the adapter (paths, manifests, provenance, raw recipes).
const PRIVATE_KEY = /path|dir|file|root|manifest|sha|hash|snapshot|ledger|provenance|recipe|config|session|api_url|health/i;

const INSTRUCTIONS = [
  'You are the assistant inside the Pankeki character design app.',
  'Only use the pankeki_* tools. Never claim an image was made unless pankeki_job reports succeeded and pankeki_result succeeds.',
  'For new images call pankeki_generate, then poll pankeki_job until it finishes, then call pankeki_result.',
  'For edits use pankeki_edit with the app-bound source. Only regenerate/recolor require a user mask. For explicit whole-image viewpoint/pose/composition changes (for example 정면을 바라보도록 바꿔줘, 측면으로, 자세를 바꿔줘), choose operation=recompose and its separate source-only capability. A narrow request such as 눈 색만 or 소매만 requires a user mask/pin; never substitute recompose or new generation.',
  'Read source-only recompose and masked-edit capabilities separately. Missing mask blocks regenerate/recolor, not a ready recompose. Missing source blocks every source-based operation; never invent one.',
  'The first line [Pankeki action: chat|generate|edit] sets what this message may do: chat starts no jobs, generate may only call pankeki_generate, edit may only call pankeki_edit.',
  'For app-origin [Pankeki action: auto], use this conversation and the app capability note to decide chat, a clear new-image request, or a clear masked edit, or an explicit source-conditioned whole-image recompose. Ask briefly if ambiguous. Only one image submission is allowed; never change operation or retry after an error. Missing edit assets require preparation, never a replacement generation or invented whole-image mask.',
  'For SDXL image generation and regenerate edits, translate positive prompts into clear English when needed while preserving the requested meaning.',
  'Keep the user negative prompt verbatim: never translate, append, deduplicate or rewrite it.',
  'For new images, preserve the explicit subject count, attributes, colors, clothing, props, composition, framing and selected generation style. Remove redundant or conflicting positive-prompt wording without dropping explicit requirements. Explicit user requirements take priority over generic style or quality wording; if explicit requirements cannot be reconciled, ask briefly instead of inventing a choice.',
  'Only when the user explicitly requests a finished illustration, make the finish concrete with controlled clean outlines, coherent color fills and consistent shading where compatible with the requested medium and style; omit incompatible properties. When no finish is explicitly requested, do not add finish wording. If style is unspecified, organize the requested subject and composition without inventing a rendering style. Respect explicit sketch, rough, monochrome, watercolor, painterly, flat-color and other styles. Never add lineart, cel shading, lighting or artist styles as generic quality boosts.',
  'Only for animagine-xl-4.0-opt generation, translate the positive prompt into concise English comma-separated tags, preserve the requested subject count, attributes, colors, composition and style, and place masterpiece, high score, great score, absurdres at the end exactly once.',
  'For Animagine, use the model-documented subject-count tag appropriate to an explicitly requested subject and count (for example 1girl, 1boy or 1other), add solo only for a single subject, preserve explicit adult or age attributes separately without inferring or changing age or gender, and express other requested attributes as concise English tags rather than prose.',
  'Animagine supports txt2img and source-conditioned img2img recompose, never masked inpaint. Never invent artist names, copyrighted characters or series, extra subjects, props or styles. Keep the user negative and explicit settings; for Animagine the validated app negative is supplied unchanged, and recommendations are applied only by the app preset action. Base and Turbo keep their existing natural-language prompt format.',
  'Preserve requested colors, props, singular/plural object counts, composition, and explicitly selected settings. Do not invent character styles, palettes, setting sheets, extra people or props.',
  'Apply new-image finish, quality and generation-style expansion only to pankeki_generate. For pankeki_edit, keep the positive prompt limited to the requested masked change and any explicit local style; never import whole-image generation style, quality tags or finish instructions.',
  'Never automatically submit another image job to improve visual quality.',
  'When the user message carries an image, it is the image currently selected in the app; use it to understand what the user is referring to.',
  'A succeeded pankeki_result carries the result image. Look at it before replying: say briefly whether the requested change is visible, and if it clearly is not (for example the face still points the same way), say what differs and suggest a concrete next request instead of claiming success. Describe only what the image shows. If no image is attached, you have not seen the result: report only the status and prompt used and ask the user to inspect it in the app.',
  'Reply in the user\'s language, briefly.'
].join(' ');

class BridgeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Auto is a renderer-origin request protocol, never a model-facing seventh tool.
// Its snapshots contain only selected settings; pixels and native context ids stay local.
function validateAutomaticContext(value) {
  const fail = () => { throw new BridgeError('invalid-input', 'Invalid automatic settings snapshot'); };
  const object = (item, allowed, required = allowed) => {
    if (!item || Array.isArray(item) || Object.getPrototypeOf(item) !== Object.prototype || Object.getOwnPropertySymbols(item).length) fail();
    const fields = Object.getOwnPropertyDescriptors(item);
    if (Object.keys(fields).some(key => !allowed.includes(key) || !Object.hasOwn(fields[key], 'value')) || required.some(key => !Object.hasOwn(fields,key))) fail();
  };
  const number = (item, low, high, integer = false) => { if (typeof item !== 'number' || !Number.isFinite(item) || item < low || item > high || integer && !Number.isSafeInteger(item)) fail(); return item; };
  const text = (item, max) => {
    if (typeof item !== 'string' || item.length > max || /\b(?:https?|wss?|ftp|file|data):|(?:^|\s)(?:\/[A-Za-z0-9]|\.{1,2}\/|~\/|[A-Za-z]:\\)/i.test(item)) fail();
    return item;
  };
  object(value, ['version','target','generationStyle','generation','edit','recompose','capabilityRevision','capabilitySource'],['version','target','generationStyle','generation','edit']);
  if(value.capabilityRevision!==undefined&&value.capabilityRevision!==null&&!/^[a-f0-9]{64}$/.test(value.capabilityRevision))fail();
  if(value.capabilitySource!==undefined&&!['snapshot','legacy','unavailable'].includes(value.capabilitySource))fail();
  if (value.version !== 1) fail();
  object(value.target, ['visibleCandidateId','sourceCandidateId','sourceRevision','maskReady','referenceCandidateId'],['visibleCandidateId','sourceCandidateId','sourceRevision','maskReady']);
  if(value.target.referenceCandidateId!==undefined&&value.target.referenceCandidateId!==null&&(typeof value.target.referenceCandidateId!=='string'||!ID.test(value.target.referenceCandidateId)))fail();
  for (const key of ['visibleCandidateId','sourceCandidateId']) if (value.target[key] !== null && (typeof value.target[key] !== 'string' || !ID.test(value.target[key]))) fail();
  if (typeof value.target.sourceRevision !== 'string' || !ID.test(value.target.sourceRevision) || typeof value.target.maskReady !== 'boolean') fail();
  let generationStyle = null;
  if (value.generationStyle !== null) {
    object(value.generationStyle, ['id','prompt']);
    if (!['character','illustration','background','concept','portrait','chibi','other'].includes(value.generationStyle.id)) fail();
    generationStyle = Object.freeze({id:value.generationStyle.id,prompt:text(value.generationStyle.prompt,512)});
  }
  function capability(item, editing, recomposing=false) {
    object(item, ['ready','settings','reason',...(recomposing?['basePrompt']:[])], ['ready','settings']);
    if (typeof item.ready !== 'boolean') fail();
    if (!item.ready) {
      if (item.settings !== null || !((editing||recomposing) ? ['source','mask','target','capability','model','settings'] : ['model','settings']).includes(item.reason)) fail();
      return Object.freeze({ready:false,settings:null,reason:item.reason});
    }
    const basePrompt = recomposing && item.basePrompt !== undefined ? text(item.basePrompt,2000) : null;
    if (Object.hasOwn(item,'reason')) fail();
    const keys = recomposing ? ['model_id','negative','seed','steps','cfg','denoise','sampler','scheduler','cache','preview'] : editing ? ['model_id','seed','steps','cfg','denoise','sampler','scheduler','roi','halo','cache','preview'] :
      ['model_id','negative','seed','width','height','steps','cfg','sampler','scheduler','cache','preview'];
    object(item.settings, keys);
    const input = item.settings, settings = {};
    if(typeof input.model_id!=='string'||!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(input.model_id)||!value.capabilityRevision&&!TOOLS[editing||recomposing?'pankeki_edit':'pankeki_generate'].inputSchema.properties.model_id.enum.includes(input.model_id))fail();
    settings.model_id = input.model_id;
    settings.seed = number(input.seed,0,Number.MAX_SAFE_INTEGER,true);
    settings.steps = number(input.steps,1,100,true); settings.cfg = number(input.cfg,0,30);
    if (!['euler','euler_ancestral','dpmpp_2m'].includes(input.sampler) || !['normal','simple','karras'].includes(input.scheduler)) fail();
    settings.sampler = input.sampler; settings.scheduler = input.scheduler;
    for (const key of ['cache','preview']) { if (typeof input[key] !== 'boolean') fail(); settings[key] = input[key]; }
    if(recomposing){settings.negative=text(input.negative,4000);settings.denoise=number(input.denoise,.01,.99);}
    else if (editing) {
      settings.denoise = number(input.denoise,.01,1); settings.halo = number(input.halo,0,512,true);
      if (typeof input.roi !== 'boolean' || settings.model_id === 'sdxl-inpaint-v01' && settings.cache) fail();
      settings.roi = input.roi;
    } else {
      settings.negative = text(input.negative,4000); settings.width = number(input.width,64,2048,true); settings.height = number(input.height,64,2048,true);
      if (settings.width % 8 || settings.height % 8) fail();
    }
    return Object.freeze({ready:true,settings:Object.freeze(settings),...(basePrompt?{basePrompt}:{})});
  }
  object(value.edit,['ready','feather','reason','regenerate','recolor'],['ready','feather','regenerate']);
  let recolor; if(value.edit.recolor!==undefined){object(value.edit.recolor,['ready','reason'],['ready']);if(typeof value.edit.recolor.ready!=='boolean')fail();recolor={ready:value.edit.recolor.ready,...(!value.edit.recolor.ready?{reason:text(value.edit.recolor.reason,2000)}:{})};}
  if (typeof value.edit.ready !== 'boolean') fail();
  if (value.edit.ready) {
    if (Object.hasOwn(value.edit,'reason') || !value.target.visibleCandidateId || value.target.visibleCandidateId !== value.target.sourceCandidateId || !value.target.maskReady) fail();
  } else if (!['source','mask','target','capability'].includes(value.edit.reason)) fail();
  const feather = value.edit.feather === null && !value.edit.ready ? null : number(value.edit.feather,0,64,true);
  const edit = Object.freeze({ready:value.edit.ready,feather,...(value.edit.ready?{}:{reason:value.edit.reason}),regenerate:capability(value.edit.regenerate,true),...(recolor?{recolor:Object.freeze(recolor)}:{})});
  const result = Object.freeze({version:1,...(value.capabilityRevision!==undefined?{capabilityRevision:value.capabilityRevision,capabilitySource:value.capabilitySource}:{}),target:Object.freeze({...value.target}),generationStyle,
    generation:capability(value.generation,false),edit,...(value.recompose?{recompose:capability(value.recompose,false,true)}:{})});
  if(result.recompose?.ready&&!result.target.referenceCandidateId)fail();
  if (JSON.stringify(result).length > 32768) fail();
  return result;
}

function automaticFromMessage(text, value, {sourceRevision,contextId} = {}) {
  const automatic = typeof text === 'string' && text.split('\n',1)[0] === '[Pankeki action: auto]';
  if (!automatic) { if (value !== undefined) throw new BridgeError('invalid-input','Automatic snapshot requires the auto action header'); return null; }
  const result = validateAutomaticContext(value);
  if (result.target.sourceRevision !== sourceRevision || (result.edit.ready||result.recompose?.ready) && !contextId) throw new BridgeError('invalid-input','Automatic asset capability did not match this request');
  return result;
}

function resolveAutomaticChat(ref, emit) {
  if (ref.automatic && !ref.resolvedIntent) {
    ref.action = ref.resolvedIntent = 'chat';
    emit('intent-resolved',{intent:'chat'},ref);
  }
}

function reserveAutomaticSubmission(ref, tool, input, emit) {
  if (!ref.automatic || !['pankeki_generate','pankeki_edit'].includes(tool)) return undefined;
  if (ref.autoPermit) throw new BridgeError('scope','An automatic request allows one image operation');
  const permit = Object.freeze({}); ref.autoPermit = permit; ref.autoTool = tool;
  const intent = tool === 'pankeki_generate' ? 'generate' : 'edit';
  const operation = intent === 'edit' ? input && input.operation : undefined;
  if (intent === 'edit' && !['regenerate','recolor','recompose'].includes(operation)) throw new BridgeError('tool','Invalid automatic edit operation');
  ref.action = ref.resolvedIntent = intent; ref.automaticOperation = operation;
  emit('intent-resolved',{intent,...(operation ? {operation} : {})},ref);
  const asset = intent === 'edit' ? operation==='recompose'?(ref.automatic.recompose||{ready:false,reason:'source'}):ref.automatic.edit : null;
  const capability = asset && !asset.ready ? asset : intent === 'edit' ? operation === 'regenerate' ? asset.regenerate : asset.recolor||asset : ref.automatic.generation;
  if (!capability.ready) {
    if (['source','mask','target','capability'].includes(capability.reason)) emit('needs-input',{reason:capability.reason},ref);
    else emit('error',{code:capability.reason === 'model' ? 'image-model-unavailable' : 'image-settings',message:'The selected image settings are not ready.'},ref);
    throw new BridgeError('needs-input','Prepare the selected '+capability.reason+' capability before this image operation');
  }
  return permit;
}

function consumeAutomaticSubmission(ref, tool, permit) {
  if (!ref.automatic || !['pankeki_generate','pankeki_edit'].includes(tool)) return;
  if (!permit || ref.autoPermit !== permit || ref.autoTool !== tool) throw new BridgeError('scope','Automatic submission requires its reserved tool permit');
  if (ref.autoConsumed) throw new BridgeError('scope','An automatic request allows one image operation');
  ref.autoConsumed = true; // before validation, context resolution, or any adapter await
}

function failAutomaticSubmission(ref, permit, error, emit) {
  if (!ref.automatic || !permit || ref.autoPermit !== permit || !ref.autoConsumed || ref.jobs.size || ref.canceled) return;
  ref.autoSubmissionFailed = true;
  if (error.code !== 'needs-input') emit('error',{code:'image-submission',message:redact(error.message || 'Image submission could not be confirmed')},ref);
}

function bindAutomaticSettings(ref, tool, input) {
  if (!ref.automatic) return input;
  if (tool === 'pankeki_generate') return {...input,...ref.automatic.generation.settings};
  if (tool === 'pankeki_edit') {
    if(ref.automaticOperation&&ref.automaticOperation!==input.operation)throw new BridgeError('scope','Automatic edit operation cannot change after reservation');
    if(input.operation==='recompose'){const {prompt,operation}=input,{settings,basePrompt}=ref.automatic.recompose;return {prompt:recomposePrompt(prompt,basePrompt,settings.model_id),operation,...settings};}
    if (input.operation === 'recolor') {
      const {model_id,seed,steps,cfg,denoise,sampler,scheduler,roi,halo,cache,preview,...color} = input;
      return {...color,feather:ref.automatic.edit.feather};
    }
    return {...input,...ref.automatic.edit.regenerate.settings,feather:ref.automatic.edit.feather};
  }
  return input;
}

// Animagine's look rests on its subject-count and quality tags; a recompose prompt that
// drops them redraws the image in another style. Restore the source prompt's subject-count
// tags and end with the quality tags exactly once. Other tags stay as the model wrote them.
const ANIMAGINE_QUALITY = ['masterpiece', 'high score', 'great score', 'absurdres'];
function recomposePrompt(prompt, basePrompt, modelId) {
  if (modelId !== 'animagine-xl-4.0-opt' || typeof prompt !== 'string') return prompt;
  const split = value => (typeof value === 'string' ? value : '').split(',').map(tag => tag.trim()).filter(Boolean);
  const tags = split(prompt).filter(tag => !ANIMAGINE_QUALITY.includes(tag.toLowerCase()));
  const lower = new Set(tags.map(tag => tag.toLowerCase()));
  const subject = split(basePrompt).filter(tag => /^(?:\d+\+?(?:girl|boy|other)s?|solo|multiple (?:girls|boys|others))$/i.test(tag) && !lower.has(tag.toLowerCase()));
  return [...subject, ...tags, ...ANIMAGINE_QUALITY].join(', ');
}

function automaticOwnsJob(ref, jobId, entry) {
  return !!entry && ref.jobs?.has(jobId) && entry.requestId === ref.requestId && entry.projectId === ref.projectId && entry.sourceRevision === ref.sourceRevision;
}

function automaticNote(value) {
  if (!value) return '';
  return 'This automatic request delegates chat/new-image/masked-edit intent to you. Use conversation context, not keywords alone. '+
    'Only a clear image request may submit one image job. For ambiguous requests or questions, briefly ask/answer in chat without submitting. '+
    'For narrow masked edits with an unready target/source/mask, explain how to prepare it; never generate a replacement or invent a whole-image mask. A ready source-only recompose is separate and needs no mask. '+
    'Generation capability: '+JSON.stringify({ready:value.generation.ready,reason:value.generation.reason,model:value.generation.settings?.model_id})+'. '+
    'Masked edit asset/CPU recolor capability: '+JSON.stringify({ready:value.edit.ready,reason:value.edit.reason})+'. '+
    'Whole-image recompose capability: '+JSON.stringify({ready:value.recompose?.ready===true,reason:value.recompose?.reason||(!value.recompose?'source':undefined),model:value.recompose?.settings?.model_id})+'. '+
    (value.recompose?.basePrompt ? 'A recompose redraws the original image of this candidate line, made with this prompt: '+JSON.stringify(value.recompose.basePrompt)+'. Write the recompose prompt as that prompt with only the requested change: keep its subject, character, clothing and style tags, and replace only tags that contradict the change. ' : '')+
    'Regenerate model capability: '+JSON.stringify({ready:value.edit.regenerate.ready,reason:value.edit.regenerate.reason,model:value.edit.regenerate.settings?.model_id})+'. '+
    (value.generationStyle ? 'Only if generating a new image, incorporate this explicitly selected style into its translated execution prompt; it is not an image request and does not apply to chat or edits: '+JSON.stringify(value.generationStyle)+'. Explicit user requirements take priority over generic category style details; omit conflicting category details. ' : '')+
    'Selected model/numeric/negative settings are fixed by the app. An image attached to this message is the app-bound source; for a recompose it is the original the redraw starts from. Without an attached image you have not seen the pixels; do not claim to have inspected them.';
}

// The existing renderer writes these two leading lines. Body text never changes
// the action or snapshot. Bind only the new model; legacy calls stay unchanged.
function generationSettingsFromMessage(text) {
  if(typeof text==='string'&&text.length>MAX_TEXT)throw new BridgeError('invalid-input','Oversized image settings snapshot');
  const lines=typeof text==='string'?text.split('\n'):[];
  if(lines[0]!=='[Pankeki action: generate]')return null;
  const match=/^\[Pankeki settings: (.*)\]$/.exec(lines[1]||'');
  if(!match){if((lines[1]||'').startsWith('[Pankeki settings:'))throw new BridgeError('invalid-input','Invalid image settings snapshot');return null;}
  let value;
  try{value=JSON.parse(match[1]);}catch{throw new BridgeError('invalid-input','Invalid image settings snapshot');}
  if(value?.model_id!=='animagine-xl-4.0-opt')return null;
  const fail=()=>{throw new BridgeError('invalid-input','Invalid Animagine settings snapshot');};
  const allowed=['mode','prompt','negative','model_id','seed','width','height','steps','cfg','sampler','scheduler','denoise','roi','halo','feather','cache','preview','preview_interval'];
  if(!value||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).some(key=>!allowed.includes(key))||value.mode!=='txt2img')fail();
  for(const item of Object.values(value)){
    if(!['string','number','boolean'].includes(typeof item)||typeof item==='number'&&!Number.isFinite(item))fail();
    if(typeof item==='string'&&(item.length>4000||/\b(?:https?|wss?|ftp|file|data):|(?:^|\s)(?:\/[A-Za-z0-9]|\.{1,2}\/|~\/|[A-Za-z]:\\)/i.test(item)))fail();
  }
  for(const key of ['prompt','negative'])if(typeof value[key]!=='string')fail();
  for(const [key,low,high,integer]of [['seed',0,Number.MAX_SAFE_INTEGER,true],['width',64,2048,true],['height',64,2048,true],['steps',1,100,true],['cfg',0,30,false]]){
    if(typeof value[key]!=='number'||!Number.isFinite(value[key])||value[key]<low||value[key]>high||integer&&!Number.isSafeInteger(value[key]))fail();
  }
  if(value.width%8||value.height%8||!['euler','euler_ancestral','dpmpp_2m'].includes(value.sampler)||!['normal','simple','karras'].includes(value.scheduler))fail();
  for(const key of ['cache','preview','roi'])if(value[key]!==undefined&&typeof value[key]!=='boolean')fail();
  for(const [key,low,high,integer]of [['denoise',.01,1,false],['halo',0,512,true],['feather',0,64,true],['preview_interval',.05,5,false]])if(value[key]!==undefined&&(typeof value[key]!=='number'||value[key]<low||value[key]>high||integer&&!Number.isSafeInteger(value[key])))fail();
  const output={};for(const key of ['model_id','negative','seed','width','height','steps','cfg','sampler','scheduler','cache','preview'])if(Object.hasOwn(value,key))output[key]=value[key];
  return Object.freeze(output);
}

function redact(text) {
  return String(text).replace(/[A-Za-z0-9_\-.]{32,}/g, '<redacted>').replace(/(?:\/(?:Users|Volumes|private|var|tmp)\/|~\/)[^\s"']*/g, '<local path>').slice(0, 2000);
}

// Strip private keys and path-like strings from adapter data.
function scrub(value, depth = 0) {
  if (depth > 5) return null;
  if (typeof value === 'string') return /^(\/|~\/|[A-Za-z]:\\)/.test(value) ? '<local file>' : redact(value).slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 20).map(v => scrub(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, v] of Object.entries(value)) if (!PRIVATE_KEY.test(key)) out[key] = scrub(v, depth + 1);
    return out;
  }
  return value;
}

// Minimal tool result sent to the remote model.
function forModel(tool, data) {
  const d = data && typeof data === 'object' ? data : {};
  if (tool === 'pankeki_status') return {app_reachable: d.app_reachable === true, models: scrub(d.models)};
  const out = {job_id: d.job_id, state: d.state};
  if (typeof d.error === 'string' && d.error) out.error = redact(d.error).slice(0, 300);
  if (tool === 'pankeki_result' && Array.isArray(d.dimensions)) out.dimensions = d.dimensions.slice(0, 2);
  return out;
}

function within(root, target) {
  const rel = path.relative(root, target);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Pixels the remote model may look at: the app-bound selection, re-checked like an
// edit input, and the verified result served by Pankeki. Paths never leave this process.
async function sourceImageBytes(ref, {resolveEditContext, inputRoot}) {
  if (!ref.contextId || !resolveEditContext) return null;
  try {
    const resolved = await resolveEditContext({projectId: ref.projectId, requestId: ref.requestId, contextId: ref.contextId, sourceRevision: ref.sourceRevision});
    const value = resolved && resolved.sourcePath;
    if (typeof value !== 'string' || !path.isAbsolute(value)) return null;
    const real = fs.realpathSync(value);
    if (!within(fs.realpathSync(path.join(inputRoot, ref.projectId)), real) || !/\.png$/i.test(real)) return null;
    return fs.readFileSync(real);
  } catch { return null; }
}
async function resultImageBytes(jobId, {pankekiBaseUrl, fetchImpl = fetch}) {
  if (typeof jobId !== 'string' || !JOB.test(jobId)) return null;
  try {
    const response = await fetchImpl(`${pankekiBaseUrl}/api/results/${jobId}`, {redirect: 'error', signal: AbortSignal.timeout(5000), headers: {origin: pankekiBaseUrl}});
    if (!response.ok || response.headers.get('content-type') !== 'image/png') return null;
    return Buffer.from(await response.arrayBuffer());
  } catch { return null; }
}
// Electron main supplies a downscaling encoder; this fallback sends small PNGs as they are.
function imageForModel(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 3.5 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null;
  return {mimeType: 'image/png', data: bytes.toString('base64')};
}

function opaque(value, name) {
  if (typeof value !== 'string' || !ID.test(value)) throw new BridgeError('invalid-input', name + ' must match ' + ID);
  return value;
}

// Environment for children: no API keys, so CLIs use their own managed sign-in.
function childEnv(base, extra = {}) {
  if (process.platform === 'win32') return {...platformInfo.minimalEnv(base, 'win32'), ...extra};
  const env = {};
  for (const key of ['HOME', 'PATH', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'SHELL']) if (base[key]) env[key] = base[key];
  return {...env, ...extra};
}

// Newline-delimited JSON-RPC over a child's stdio (MCP stdio).
function rpc(proc, {onRequest, onNotification, log, label}) {
  let buffer = '', nextId = 1;
  const pending = new Map();
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', chunk => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { log(label + ': non-JSON line ignored'); continue; }
      if (message.id !== undefined && message.method) onRequest(message);
      else if (message.id !== undefined) {
        const entry = pending.get(message.id);
        if (!entry) continue;
        pending.delete(message.id); clearTimeout(entry.timer);
        if (message.error) entry.reject(new BridgeError(label, entry.method + ': ' + redact(message.error.message || 'error')));
        else entry.resolve(message.result);
      } else if (message.method) onNotification(message);
    }
  });
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', chunk => log(label + ': ' + redact(chunk)));
  const write = message => {
    if (!proc.stdin.writable) throw new BridgeError('not-connected', label + ' is not running');
    proc.stdin.write(JSON.stringify(message) + '\n');
  };
  return {
    write,
    request(method, params, timeout) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new BridgeError('timeout', method + ' timed out')); }, timeout);
        pending.set(id, {resolve, reject, timer, method});
        try { write({jsonrpc: '2.0', id, method, params}); } catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
      });
    },
    failAll(error) { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); } pending.clear(); }
  };
}

async function stopProcess(proc, ms) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  if (process.platform === 'win32') {
    // Signals are emulated on Windows and would end only the launcher; stop the whole tree.
    await new Promise(resolve => {
      const kill = setTimeout(() => { void platformInfo.killTree(proc, {force: true}); }, ms);
      proc.once('exit', () => { clearTimeout(kill); resolve(); });
      try { proc.stdin.end(); } catch {}
      void platformInfo.killTree(proc, {force: false}).then(sent => { if (!sent && proc.exitCode === null) { clearTimeout(kill); void platformInfo.killTree(proc, {force: true}).then(() => resolve()); } });
    });
    return;
  }
  await new Promise(resolve => {
    const kill = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, ms);
    proc.once('exit', () => { clearTimeout(kill); resolve(); });
    try { proc.stdin.end(); proc.kill('SIGTERM'); } catch { clearTimeout(kill); resolve(); }
  });
}

// One runner per bridge. `emit(type, payload, ref)` and `current(ref)` come from
// the bridge; a ref is the bridge's active request
// ({requestId, projectId, contextId, sourceRevision, action, jobs:Set}).
// limits.jobWait > 0 makes pankeki_job wait (polling every limits.jobPoll ms) until
// the job reaches a final state, so a model that polls quickly does not give up
// before the image is done.
function createToolRunner({projectRoot, paths, pankekiBaseUrl, resolveEditContext, mcpCommand, spawnImpl = spawn, limits, emit, current,
  log = () => {}, clientVersion = '0.1.0', getCapabilities}) {
  const mcp = new Map();                     // projectId -> {proc, rpc, ready}
  const ledger = new Map();                  // jobId -> {requestId, projectId, sourceRevision, tool, request, result}
  const inflight = new Set();                // submit sequences (POST + late-job cancel) close() must drain

  async function mcpFor(projectId) {
    if (mcp.has(projectId)) return mcp.get(projectId).ready;
    const inputs = path.join(paths.inputs, projectId);
    fs.mkdirSync(inputs, {recursive: true});
    fs.mkdirSync(paths.state, {recursive: true});
    const spec = mcpCommand ? mcpCommand({inputs, state: paths.state}) : {
      command: paths.mcpPython, args: [paths.launcher, '--input-root', inputs, '--state-dir', paths.state],
      env: {PANKEKI_APP_ROOT: projectRoot, PANKEKI_PYTHON: paths.mcpPython, PANKEKI_API_URL: pankekiBaseUrl}};
    const proc = spawnImpl(spec.command, spec.args, {cwd: paths.work, env: childEnv(process.env, spec.env), stdio: ['pipe', 'pipe', 'pipe'], ...(process.platform === 'win32' ? {windowsHide: true} : {})});
    const client = rpc(proc, {label: 'mcp', log, onNotification() {}, onRequest: m => client.write({jsonrpc: '2.0', id: m.id, error: {code: -32601, message: 'unsupported'}})});
    const entry = {proc, rpc: client};
    proc.on('error', error => { log('mcp spawn error: ' + redact(error.message)); client.failAll(new BridgeError('mcp', 'Pankeki tools could not start')); });
    proc.on('exit', () => { client.failAll(new BridgeError('mcp', 'Pankeki tools stopped')); if (mcp.get(projectId) === entry) mcp.delete(projectId); });
    entry.ready = (async () => {
      await client.request('initialize', {protocolVersion: MCP_PROTOCOL, capabilities: {}, clientInfo: {name: 'pankeki_desktop', version: clientVersion}}, limits.request);
      client.write({jsonrpc: '2.0', method: 'notifications/initialized'});
      return entry;
    })();
    entry.ready.catch(() => { mcp.delete(projectId); stopProcess(proc, limits.close); });
    mcp.set(projectId, entry);
    return entry.ready;
  }

  async function callAdapter(projectId, name, args) {
    const entry = await mcpFor(projectId);
    const result = await entry.rpc.request('tools/call', {name, arguments: args}, limits.tool);
    let data = result.structuredContent;
    if (data && typeof data === 'object' && Object.keys(data).length === 1 && data.result !== undefined) data = data.result;
    if (data === undefined || data === null) for (const part of result.content || []) if (part.type === 'text') { try { data = JSON.parse(part.text); } catch { data = {message: part.text}; } }
    if (result.isError) throw new BridgeError('tool', redact((data && data.message) || (result.content || []).map(p => p.text).join(' ') || 'tool error'));
    return data;
  }

  function jobFor(ref, args) {
    const id = args && args.job_id;
    const entry = typeof id === 'string' && JOB.test(id) ? ledger.get(id) : null;
    if (!entry || entry.projectId !== ref.projectId) throw new BridgeError('tool', 'Unknown job for this conversation');
    return id;
  }

  // The request body the adapter actually POSTed (its own request.json under the
  // state dir), without source/mask image data.
  function submittedRequest(data) {
    try {
      const file = data && data.provenance && data.provenance.request_path;
      if (typeof file !== 'string') return null;
      const real = fs.realpathSync(file);
      if (!within(fs.realpathSync(paths.state), real)) return null;
      const body = JSON.parse(fs.readFileSync(real, 'utf8'));
      const request = body && body.request && typeof body.request === 'object' ? {...body.request} : null;
      if (request) { delete request.source; delete request.mask; delete request.trace_id; }
      return request;
    } catch { return null; }
  }

  function safeMetrics(data) {
    const out = {};
    if (!data || typeof data !== 'object') return out;
    if (Array.isArray(data.dimensions)) [out.width, out.height] = data.dimensions;
    if (data.metrics && typeof data.metrics === 'object') for (const [k, v] of Object.entries(data.metrics)) if (['string', 'number', 'boolean'].includes(typeof v) && !PRIVATE_KEY.test(k)) out[k] = v;
    return out;
  }

  async function adapterCancel(projectId, jobId, ref = null) {
    const entry = ledger.get(jobId);
    if (!entry || TERMINAL.has(entry.state) || entry.cancelRequested) return;
    entry.cancelRequested = true;
    try {
      const data = await callAdapter(projectId, 'pankeki_cancel_job', {job_id: jobId});
      if (data && typeof data.state === 'string') {entry.state = data.state;if(data.state==='orphaned'&&ref)ref.jobOrphaned=true;}
    } catch (error) { log('job cancel failed: ' + redact(error.message)); }
  }

  function checkFiles(projectId, resolved, requireMask=true) {
    if (!resolved || typeof resolved !== 'object') return null;
    const realDir = fs.realpathSync(path.join(paths.inputs, projectId));
    const out = {};
    for (const key of requireMask?['sourcePath','maskPath']:['sourcePath']) {
      const value = resolved[key];
      if (typeof value !== 'string' || !path.isAbsolute(value)) return null;
      let real;
      try { real = fs.realpathSync(value); } catch { return null; }
      if (!within(realDir, real) || !/\.png$/i.test(real) || !fs.statSync(real).isFile()) return null;
      out[key] = real;
    }
    return out;
  }

  // Returns {payload, data}: payload for the app event, data for forModel().
  async function automaticResult(ref, jobId, entry) {
    if (!entry.autoResultTask) entry.autoResultTask = (async () => {
      const data = await callAdapter(ref.projectId,TOOLS.pankeki_result.mcp,{job_id:jobId});
      if (!current(ref) || ledger.get(jobId) !== entry || !automaticOwnsJob(ref,jobId,entry)) throw new BridgeError('stale','Request no longer owns this result');
      if (!data || data.job_id !== jobId || data.state !== 'succeeded' || ['failed','canceled','canceling','uncertain','orphaned'].includes(entry.state)) throw new BridgeError('result-unavailable','The image result could not be verified');
      entry.state=data.state;entry.result={metrics:safeMetrics(data),request:data.request&&typeof data.request==='object'?scrub(data.request):null};
      return data;
    })().catch(error=>{
      if(current(ref)&&ledger.get(jobId)===entry&&automaticOwnsJob(ref,jobId,entry)){
        ref.autoResultFailed=true;
        emit('error',{code:'result-unavailable',message:redact(error.message||'Image result could not be verified')},ref);
      }
      throw error;
    });
    const data=await entry.autoResultTask;
    if (!current(ref) || ledger.get(jobId) !== entry || !automaticOwnsJob(ref,jobId,entry)) throw new BridgeError('stale','Request no longer owns this result');
    return data;
  }
  async function runTool(ref, tool, args, permit) {
    if (ref.automatic && !current(ref)) throw new BridgeError('stale','Request is no longer active');
    consumeAutomaticSubmission(ref,tool,permit);
    const spec = TOOLS[tool];
    const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
    for (const key of Object.keys(input)) if (!(key in spec.inputSchema.properties)) throw new BridgeError('tool', 'Unexpected argument ' + key);
    const payload = {tool};
    let data;
    if (tool === 'pankeki_generate' || tool === 'pankeki_edit') {
      if (!SUBMITS[ref.action].includes(tool)) throw new BridgeError('scope', `This ${ref.action} request cannot run ${tool}.`);
      let call = bindAutomaticSettings(ref,tool,{...input});
      if(tool==='pankeki_generate'&&ref.generationSettings)call={...call,...ref.generationSettings};
      authorizeTool(getCapabilities?await getCapabilities():null,tool,call,ref);
      if(!current(ref))throw new BridgeError('stale','Request is no longer active');
      if(tool==='pankeki_edit'&&call.operation!=='recompose'&&call.model_id==='animagine-xl-4.0-opt')throw new BridgeError('scope','Animagine is generation-only');
      if(tool==='pankeki_generate'){
        if(call.sampler!==undefined&&!['euler','euler_ancestral','dpmpp_2m'].includes(call.sampler)||call.scheduler!==undefined&&!['normal','simple','karras'].includes(call.scheduler))throw new BridgeError('tool','Unsupported sampler/scheduler');
      }
      if (tool === 'pankeki_edit') {
        if (!ref.contextId) { emit('needs-input', {reason: 'source'}, ref); throw new BridgeError('needs-input', 'No image or mask is selected in the app'); }
        const resolved = resolveEditContext ? await resolveEditContext({projectId: ref.projectId, requestId: ref.requestId, contextId: ref.contextId, sourceRevision: ref.sourceRevision}) : null;
        if (!current(ref)) throw new BridgeError('stale', 'Request is no longer active');
        if(call.operation==='recompose'&&(!ref.automatic?.recompose?.ready))throw new BridgeError('scope','Source-only recompose requires an app-bound automatic capability');
        const files = checkFiles(ref.projectId, resolved, call.operation!=='recompose');
        if (!files) { emit('needs-input', {reason: resolved && resolved.sourcePath ? 'mask' : 'source'}, ref); throw new BridgeError('needs-input', 'Select an image and paint a mask in the app'); }
        call = {...call, source_path: files.sourcePath,...(call.operation==='recompose'?{}:{mask_path:files.maskPath})};
      }
      if(ref.requestId)call.trace_id=ref.requestId;
      // Tracked as one unit so close() can wait for a late job id and cancel it
      // before the adapter process is stopped.
      const submission = (async () => {
        const result = await callAdapter(ref.projectId, spec.mcp, call);
        const jobId = result && result.job_id;
        if (ref.automatic && (typeof jobId !== 'string' || !JOB.test(jobId))) throw new BridgeError('tool','Image submission did not return an owned job ID');
        if (typeof jobId === 'string' && JOB.test(jobId)) {
          ledger.set(jobId, {requestId: ref.requestId, projectId: ref.projectId, sourceRevision: ref.sourceRevision, tool,
            traceId:ref.requestId,request: submittedRequest(result), state: result.state, result: null});
          ref.jobs.add(jobId);
          payload.jobId = jobId;
          // Canceled while the POST was in flight: discard the late job right away.
          if (!current(ref)) { await adapterCancel(ref.projectId, jobId, ref); throw new BridgeError('stale', 'Request was canceled'); }
        }
        return result;
      })();
      inflight.add(submission);
      submission.then(() => inflight.delete(submission), () => inflight.delete(submission));
      data = await submission;
    } else if (tool === 'pankeki_status') {
      data = await callAdapter(ref.projectId, spec.mcp, {});
      if (data && typeof data.app_reachable === 'boolean') payload.appReachable = data.app_reachable;
    } else {
      const jobId = jobFor(ref, input);
      const originalEntry=ledger.get(jobId),ownedAutoJob = automaticOwnsJob(ref,jobId,originalEntry);
      if (ref.automatic && tool === 'pankeki_cancel' && !ownedAutoJob) throw new BridgeError('scope','Automatic requests cannot cancel another request job');
      payload.jobId = jobId;
      if(tool==='pankeki_result'&&originalEntry.state==='orphaned')throw new BridgeError('orphaned','The previous server job was orphaned; it was not resubmitted');
      data = ref.automatic&&tool==='pankeki_result'&&ownedAutoJob?await automaticResult(ref,jobId,originalEntry):await callAdapter(ref.projectId, spec.mcp, {job_id: jobId});
      if (tool === 'pankeki_job' && limits.jobWait > 0) {
        const until = Date.now() + limits.jobWait;
        while (data && !TERMINAL.has(data.state) && Date.now() < until && current(ref)) {
          await new Promise(resolve => setTimeout(resolve, limits.jobPoll));
          if (!current(ref)) break;
          data = await callAdapter(ref.projectId, spec.mcp, {job_id: jobId});
        }
      }
      if(ref.automatic&&(!current(ref)||ledger.get(jobId)!==originalEntry))throw new BridgeError('stale','Request is no longer active');
      if(ref.automatic&&data?.job_id!==undefined&&data.job_id!==jobId)throw new BridgeError('tool','Job response did not match the owned job');
      const entry = ledger.get(jobId);
      if (data && typeof data.state === 'string') {entry.state = data.state;if(data.state==='orphaned')ref.jobOrphaned=true;}
      if (tool === 'pankeki_result' && data && data.state === 'succeeded' && (!ref.automatic || ownedAutoJob)) {
        if(!ref.automatic)entry.result = {metrics: safeMetrics(data), request: data.request && typeof data.request === 'object' ? scrub(data.request) : null};
        if(!ref.automatic||!entry.autoResultPublished){
          if(ref.automatic)entry.autoResultPublished=true;
          payload.resultId = jobId;
          payload.previewUrl = `${pankekiBaseUrl}/api/results/${jobId}`;
        }
      }
    }
    if (data && typeof data.state === 'string' && JOB_STATUSES.has(data.state)) payload.jobStatus = data.state;
    return {payload, data};
  }

  // Jobs this request started that have neither a fetched result nor a final failure.
  const unsettledJobs = ref => [...ref.jobs].filter(id => { const entry = ledger.get(id); return entry && !entry.result && !['failed', 'canceled', 'orphaned'].includes(entry.state); });

  async function cancelJobs(ref) {
    for (const jobId of ref.jobs) await adapterCancel(ref.projectId, jobId, ref);
  }

  // Local-only metadata for Electron main; all four ids must match.
  const owned = ({jobId, projectId, requestId, sourceRevision = null} = {}) => {
    const entry = typeof jobId === 'string' ? ledger.get(jobId) : null;
    return entry && entry.projectId === projectId && entry.requestId === requestId && entry.sourceRevision === sourceRevision ? entry : null;
  };

  function getSubmittedRequest(query) {
    const entry = owned(query);
    return entry && entry.request ? {jobId: query.jobId, requestId: entry.requestId,traceId:entry.traceId, tool: entry.tool, state: entry.state || null, request: {...entry.request}} : null;
  }

  function getResultDescriptor(query) {
    const entry = owned(query);
    if (!entry || !entry.result) return null;
    return {jobId: query.jobId, resultId: query.jobId, requestId: entry.requestId,traceId:entry.traceId, state: 'succeeded',
      request: {...(entry.request || entry.result.request || {})}, metrics: {...entry.result.metrics}};
  }

  // Waits for pending submits, logically cancels unfinished jobs, stops the
  // adapters. Returns the number of submits still unanswered after the drain.
  async function close() {
    let unconfirmedSubmissions = 0;
    if (inflight.size) {
      const pending = [...inflight];
      let timer;
      const drained = await Promise.race([Promise.allSettled(pending).then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), limits.drain); })]);
      clearTimeout(timer);
      if (!drained) {
        unconfirmedSubmissions = pending.filter(p => inflight.has(p)).length;
        emit('error', {code: 'unconfirmed-cancel', message: `${unconfirmedSubmissions} submission(s) were still pending at close; a job may run without a logical cancel.`}, null);
      }
    }
    for (const [jobId, entry] of ledger) if (!TERMINAL.has(entry.state) && mcp.has(entry.projectId)) await adapterCancel(entry.projectId, jobId);
    const stops = [...mcp.values()].map(entry => stopProcess(entry.proc, limits.close));
    mcp.clear();
    await Promise.all(stops);
    ledger.clear();
    return unconfirmedSubmissions;
  }

  return {runTool, cancelJobs, unsettledJobs, getSubmittedRequest, getResultDescriptor, close};
}

module.exports = {DocumentSchema:Design,createToolRunner, BridgeError, TOOLS, TOOL_NAMES, ACTION, INSTRUCTIONS, MAX_TEXT, ID, redact, forModel, opaque, childEnv, stopProcess, generationSettingsFromMessage,
  sourceImageBytes,resultImageBytes,imageForModel,createToolSchemas,createCapabilityReader,authorizeTool,normalizedCapabilities,validateAutomaticContext,automaticFromMessage,resolveAutomaticChat,reserveAutomaticSubmission,consumeAutomaticSubmission,failAutomaticSubmission,bindAutomaticSettings,automaticOwnsJob,automaticNote,recomposePrompt};

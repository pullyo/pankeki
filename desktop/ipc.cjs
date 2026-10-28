'use strict';
const ID=/^[A-Za-z0-9_-]{1,80}$/;
const STATES=new Set(['missing','signed-out','idle','starting','ready','busy','error']);
const JOB_STATES=new Set(['queued','submitting','running','canceling','canceled','succeeded','failed','uncertain','orphaned']);
const PROVIDERS=new Set(['codex','claude']);
const {validModelId}=require('./chat-model-settings.cjs');
const MODEL_SOURCES=new Set(['codex-model-list','claude-initialize','claude-help']);
const MODEL_ERRORS=new Set(['invalid-input','busy','stale-provider','unknown-model','model-metadata-unavailable','missing','signed-out','not-ready','model-list-failed','settings-save-failed']);
const TOOLS=new Set(['pankeki_status','pankeki_generate','pankeki_edit','pankeki_job','pankeki_result','pankeki_cancel']);
function fail(code){const error=new Error(code);error.code=code;throw error;}
function plain(value){return value && typeof value==='object' && !Array.isArray(value) && Object.getPrototypeOf(value)===Object.prototype;}
function keys(value,allowed){if(!plain(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail('invalid-input');}
function id(value){if(typeof value!=='string'||!ID.test(value))fail('invalid-input');return value;}
function safeText(value,max=8000){return String(value??'').replace(/\bsk-[A-Za-z0-9_-]+/g,'[redacted]').replace(/\/(?:Users|Volumes|private|tmp)\/[^\s"<>]+/g,'[local path]').slice(0,max);}
function safeStatus(value={}) {
  const version=typeof value.codexVersion==='string'?value.codexVersion:typeof value.version==='string'?value.version:null;
  return {state:STATES.has(value.state)?value.state:'error',provider:PROVIDERS.has(value.provider)?value.provider:'codex',codexVersion:version===null?null:safeText(version,80),
    authMode:['chatgpt','claude'].includes(value.authMode)?value.authMode:null,toolsReady:value.toolsReady===true,
    activeRequestId:typeof value.activeRequestId==='string'&&ID.test(value.activeRequestId)?value.activeRequestId:null,
    lastError:value.lastError?{code:'codex-error',message:'Codex connection needs attention.'}:null,
    modelId:validModelId(value.modelId)?value.modelId:null,modelRevision:Number.isSafeInteger(value.modelRevision)&&value.modelRevision>=0?value.modelRevision:0};
}
function safeModelOptions(value={}) {
  const seen=new Set(),options=[];
  for(const item of (Array.isArray(value.options)?value.options:[]).slice(0,101)){
    if(!item||!validModelId(item.id)||seen.has(item.id))continue;
    seen.add(item.id);options.push({id:item.id,displayName:safeText(item.displayName||item.id,120).replace(/[\x00-\x1f\x7f]/g,'')});
  }
  return {provider:PROVIDERS.has(value.provider)?value.provider:'codex',selectedModelId:validModelId(value.selectedModelId)?value.selectedModelId:'default',
    modelRevision:Number.isSafeInteger(value.modelRevision)&&value.modelRevision>=0?value.modelRevision:0,state:STATES.has(value.state)?value.state:'error',
    cliVersion:typeof value.cliVersion==='string'?safeText(value.cliVersion,80):null,source:MODEL_SOURCES.has(value.source)?value.source:null,
    availability:'unverified',options,errorCode:MODEL_ERRORS.has(value.errorCode)?value.errorCode:null};
}
function validateMessage(value) {
  keys(value,['text','projectId','requestId','context','automatic']);id(value.projectId);id(value.requestId);
  if(typeof value.text!=='string'||!value.text.trim()||value.text.length>8000)fail('invalid-input');
  if(value.context!==undefined){keys(value.context,['sourceRevision','sourceId','maskId']);id(value.context.sourceRevision);
    for(const field of ['sourceId','maskId'])if(value.context[field]!==undefined)id(value.context[field]);
    if(value.context.maskId&&!value.context.sourceId)fail('invalid-input');}
  const automatic=value.text.split('\n',1)[0]==='[Pankeki action: auto]';
  if(automatic!==Object.hasOwn(value,'automatic'))fail('invalid-input');
  if(automatic){
    let snapshot;try{snapshot=require('./pankeki-tools.cjs').validateAutomaticContext(value.automatic);}catch{fail('invalid-input');}
    if(snapshot.target.sourceRevision!==value.context?.sourceRevision||snapshot.edit.ready&&(!value.context.sourceId||!value.context.maskId)||snapshot.recompose?.ready&&!value.context?.sourceId)fail('invalid-input');
    return {...value,automatic:snapshot};
  }
  return value;
}
function createIpcController({bridge,getAppStatus,isTrusted,sendEvent,contexts,results,mapBridgeMessage=value=>value,allowLiveSend=false,origin='http://127.0.0.1:8190'}) {
  const requests=new Map();let active=null, connecting=null,changingModel=false;
  async function invoke(method,event,value) {
    if(!isTrusted(event))fail('untrusted-sender');
    if(method==='getStatus')return {codex:safeStatus(bridge.status()),app:await getAppStatus()};
    if(method==='connectCodex') {
      if(changingModel)fail('busy');
      if(!connecting)connecting=Promise.resolve().then(()=>bridge.connect()).then(safeStatus).finally(()=>{connecting=null;});
      try{return await connecting;}catch{fail('connect-failed');}
    }
    if(method==='selectProvider') {
      keys(value,['provider']);if(!PROVIDERS.has(value.provider)||typeof bridge.select!=='function')fail('invalid-input');
      if(active||connecting||changingModel)fail('busy');
      try{return safeStatus(bridge.select({provider:value.provider}));}catch(error){fail(error.code==='busy'?'busy':'select-failed');}
    }
    if(method==='getChatModelOptions') {
      keys(value,['provider']);if(!PROVIDERS.has(value.provider)||typeof bridge.getChatModelOptions!=='function')fail('invalid-input');
      try{return safeModelOptions(await bridge.getChatModelOptions(value));}catch(error){fail(MODEL_ERRORS.has(error.code)?error.code:'model-list-failed');}
    }
    if(method==='setChatModel') {
      keys(value,['provider','modelId']);if(!PROVIDERS.has(value.provider)||!validModelId(value.modelId)||typeof bridge.setChatModel!=='function')fail('invalid-input');
      if(active||connecting||changingModel||['busy','starting'].includes(bridge.status().state))fail('busy');
      changingModel=true;
      try{const result=await bridge.setChatModel(value);return {provider:value.provider,selectedModelId:validModelId(result.selectedModelId)?result.selectedModelId:value.modelId,
        modelRevision:Number.isSafeInteger(result.modelRevision)&&result.modelRevision>=0?result.modelRevision:0,conversationReset:result.conversationReset===true};}
      catch(error){fail(MODEL_ERRORS.has(error.code)?error.code:'model-list-failed');}
      finally{changingModel=false;}
    }
    if(method==='prepareEditContext') {
      keys(value,['projectId','sourceRevision','sourceDataUrl','maskDataUrl']);id(value.projectId);id(value.sourceRevision);
      try{return await contexts.prepare(value);}catch{fail('invalid-context');}
    }
    if(method==='resolveResult') {
      keys(value,['requestId','projectId','sourceRevision','jobId','resultId']);
      id(value.requestId);id(value.projectId);id(value.sourceRevision);
      if(!/^[0-9a-f]{32}$/.test(value.jobId||'')||!/^[0-9a-f]{32}$/.test(value.resultId||''))fail('invalid-input');
      const ref=requests.get(value.requestId);
      if(!ref||ref.projectId!==value.projectId||ref.sourceRevision!==value.sourceRevision)fail('stale-context');
      if(!results)fail('result-metadata-pending');
      return results.resolveResult(value);
    }
    if(method==='cancelMessage'){
      keys(value,['requestId']);id(value.requestId);
      if(active!==value.requestId)return {requestId:value.requestId,canceled:false};
      try{return {requestId:value.requestId,canceled:(await bridge.cancel({requestId:value.requestId}))===true};}catch{fail('cancel-failed');}
    }
    if(method==='sendMessage') {
      value=validateMessage(value);
      if(!allowLiveSend)fail('bridge-pending');
      if(active||connecting||changingModel||bridge.status().state==='busy')fail('busy');
      if(bridge.status().state!=='ready')fail('not-ready');
      if(requests.has(value.requestId))fail('duplicate-request');
      if(requests.size>=10000)fail('session-limit');
      if(value.context?.sourceId)contexts.resolve(value.projectId,value.context);
      requests.set(value.requestId,{projectId:value.projectId,sourceRevision:value.context?.sourceRevision});active=value.requestId;
      try{await bridge.send(mapBridgeMessage(value));return {requestId:value.requestId};}
      catch{active=null;fail('send-failed');}
    }
    fail('unknown-method');
  }
  function acceptEvent(event) {
    if(!plain(event)||typeof event.type!=='string'||!plain(event.payload))return;
    const ref=requests.get(event.requestId);
    if(event.type!=='status'&&(!ref||ref.projectId!==event.projectId))return;
    let payload;
    const source=event.payload;
    switch(event.type) {
      case 'status':payload=safeStatus(source);break;
      case 'turn-started':payload={};break;
      case 'intent-resolved':
        if(!['chat','generate','edit'].includes(source.intent)||source.intent==='edit'&&!['regenerate','recolor','recompose'].includes(source.operation)||source.intent!=='edit'&&source.operation!==undefined)return;
        payload={intent:source.intent,...(source.operation?{operation:source.operation}:{})};break;
      case 'message-delta':case 'message':payload={text:safeText(source.text)};break;
      case 'tool-started':if(!TOOLS.has(source.tool))return;payload={tool:source.tool,summary:safeText(source.summary,300)};break;
      case 'tool-completed':
        if(!TOOLS.has(source.tool))return;
        payload={tool:source.tool,ok:source.ok===true};
        if(typeof source.jobId==='string'&&ID.test(source.jobId))payload.jobId=source.jobId;
        if(JOB_STATES.has(source.jobStatus))payload.jobStatus=source.jobStatus;
        if(source.tool==='pankeki_result'&&source.ok===true&&source.jobStatus==='succeeded'&&/^[0-9a-f]{32}$/.test(source.resultId||'')){
          payload.resultId=source.resultId;payload.previewUrl=origin+'/api/results/'+source.resultId;
        }
        break;
      case 'needs-input':if(!['mask','source','target','capability'].includes(source.reason))return;payload={reason:source.reason};break;
      case 'turn-completed':payload={status:['completed','interrupted','failed'].includes(source.status)?source.status:'failed'};if(active===event.requestId)active=null;break;
      case 'error':payload={code:safeText(source.code,80),message:safeText(source.message,500)};break;
      default:return;
    }
    const clean={requestId:event.type==='status'?null:event.requestId,projectId:event.type==='status'?null:event.projectId,type:event.type,payload};
    if(ref?.sourceRevision)clean.context={sourceRevision:ref.sourceRevision};
    sendEvent(clean);
  }
  return {invoke,acceptEvent,activeRequestId:()=>active};
}
module.exports={createIpcController,validateMessage,safeStatus};

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const fixture=require('./automatic-fixture.cjs'),JOB='a'.repeat(32);
function providerSetup(name){
 const filename=path.join(__dirname,name+'-bridge.test.cjs'),source=fs.readFileSync(filename,'utf8'),end=source.indexOf("\ntest('auto ");
 const moduleFile=new Module(filename,module);moduleFile.filename=filename;moduleFile.paths=module.paths;moduleFile._compile(source.slice(0,end)+'\nmodule.exports={setup};',filename);return moduleFile.exports.setup;
}
const setups={codex:providerSetup('codex'),claude:providerSetup('claude')};
const calls=t=>t.adapterCalls?t.adapterCalls():t.received('mcp','tools/call').map(row=>row.params);
const submits=t=>calls(t).filter(row=>['pankeki_generate_image','pankeki_edit_image'].includes(row.name));
const done=(t,id='auto')=>t.waitFor(e=>e.type==='turn-completed'&&e.requestId===id);
const send=(t,automatic=fixture(),extra={})=>t.bridge.send({text:'[Pankeki action: auto]\n자동 요청',projectId:'p',requestId:'auto',context:{sourceRevision:'rev'},automatic,...extra});
function selectedFiles(t){const directory=path.join(t.inputRoot,'p');fs.mkdirSync(directory,{recursive:true});for(const name of ['source','mask'])fs.writeFileSync(path.join(directory,name+'.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==','base64'));return {sourcePath:fs.realpathSync(path.join(directory,'source.png')),maskPath:fs.realpathSync(path.join(directory,'mask.png'))};}
for(const provider of ['codex','claude']){
 test(`${provider} auto clarification completes as chat without submitting an image`,async()=>{
  const t=setups[provider]('auto-chat');try{await t.bridge.connect();const automatic=fixture();automatic.generationStyle={id:'chibi',prompt:'Cute chibi style.'};await send(t,automatic);await done(t);assert.equal(submits(t).length,0);assert.equal(t.events.find(e=>e.type==='intent-resolved').payload.intent,'chat');}finally{await t.bridge.close();}
 });
 test(`${provider} auto regenerate without a model is blocked while its CPU asset capability stays ready`,async()=>{
  const t=setups[provider]('auto-edit-regenerate');try{await t.bridge.connect();await send(t,fixture({editReady:true,regenerateReady:false}),{context:{sourceRevision:'rev',contextId:'selected'}});await done(t);assert.equal(submits(t).length,0);assert(t.events.some(e=>e.type==='error'&&e.payload.code==='image-model-unavailable'));}finally{await t.bridge.close();}
 });
 for(const modelId of ['sd-turbo','animagine-xl-4.0-opt'])test(`${provider} auto pins ${modelId} across concurrent submission attempts`,async()=>{
  const t=setups[provider]('auto-race');try{await t.bridge.connect();const automatic=fixture({modelId});await send(t,automatic);automatic.generation.settings.seed=99;await done(t);assert.equal(submits(t).length,1);assert.equal(submits(t)[0].arguments.model_id,modelId);assert.equal(submits(t)[0].arguments.seed,42);}finally{await t.bridge.close();}
 });
 test(`${provider} legacy explicit generation keeps its pre-auto multi-submit capability`,async()=>{
  const t=setups[provider]('auto-race');try{await t.bridge.connect();await t.bridge.send({text:'[Pankeki action: generate]\nGENERATE',projectId:'p',requestId:'legacy',context:{sourceRevision:'rev'}});await done(t,'legacy');assert.equal(submits(t).filter(row=>row.name==='pankeki_generate_image').length,2);assert.equal(t.events.filter(e=>e.type==='intent-resolved').length,0);}finally{await t.bridge.close();}
 });
 for(const operation of ['recolor','regenerate'])test(`${provider} auto ${operation} uses only its sealed source/mask and settings`,async()=>{
  let files;const t=setups[provider]('auto-edit-'+operation,{resolveEditContext:async()=>files});
  try{files=selectedFiles(t);await t.bridge.connect();const automatic=fixture({editReady:true,regenerateReady:operation!=='recolor'});automatic.edit.feather=7;
   await send(t,automatic,{context:{sourceRevision:'rev',contextId:'selected'}});await done(t);const call=submits(t)[0];assert.equal(submits(t).length,1);assert.equal(call.name,'pankeki_edit_image');assert.equal(call.arguments.source_path,files.sourcePath);assert.equal(call.arguments.mask_path,files.maskPath);assert.equal(call.arguments.feather,7);
   if(operation==='regenerate'){assert.equal(call.arguments.model_id,'sdxl-inpaint-v01');assert.equal(call.arguments.steps,23);assert.equal(call.arguments.denoise,.75);}else assert.equal(call.arguments.model_id,undefined);
   const resolved=t.events.find(e=>e.type==='intent-resolved');assert.equal(resolved.payload.operation,operation);assert(t.events.indexOf(resolved)<t.events.findIndex(e=>e.type==='tool-started'&&e.payload.tool==='pankeki_edit'));
  }finally{await t.bridge.close();}
 });
 for(const reason of ['source','mask','target','capability'])test(`${provider} auto missing ${reason} keeps edit at zero and forbids generation fallback`,async()=>{
  const t=setups[provider]('auto-fallback');try{await t.bridge.connect();await send(t,fixture({editReason:reason}));await done(t);assert.equal(submits(t).length,0);assert.equal(t.events.find(e=>e.type==='intent-resolved').payload.intent,'edit');assert(t.events.some(e=>e.type==='needs-input'&&e.payload.reason===reason));}finally{await t.bridge.close();}
 });
 test(`${provider} auto parallel and cross-operation attempts can produce only one image POST`,async()=>{
  const t=setups[provider]('auto-race');try{await t.bridge.connect();await send(t);await done(t);assert.equal(submits(t).length,1);assert.equal(t.events.filter(e=>e.type==='intent-resolved').length,1);assert.equal(t.events.filter(e=>e.payload.resultId).length,1);}finally{await t.bridge.close();}
 });
 for(const scenario of ['auto-invalid-fallback','auto-adapter-error'])test(`${provider} ${scenario} cannot retry and completes as a failure`,async()=>{
  const t=setups[provider](scenario);try{await t.bridge.connect();await send(t);const end=await done(t);assert.equal(submits(t).length,scenario==='auto-invalid-fallback'?0:1);assert.equal(t.events.filter(e=>e.payload.resultId).length,0);assert.equal(end.payload.status,'failed');}finally{await t.bridge.close();}
 });
 test(`${provider} auto explicit/settle result overlap fetches and publishes once`,async()=>{
  const t=setups[provider]('auto-overlap');try{await t.bridge.connect();await send(t);await done(t);assert.equal(calls(t).filter(row=>row.name==='pankeki_get_result').length,1);assert.equal(t.events.filter(e=>e.payload.resultId).length,1);}finally{await t.bridge.close();}
 });
 test(`${provider} auto result verification failure ends honestly instead of waiting for a missing artifact`,async()=>{
  const t=setups[provider]('auto-result-error');try{await t.bridge.connect();await send(t);const end=await done(t);assert.equal(end.payload.status,'failed');assert.equal(t.events.filter(e=>e.type==='error').length,1);assert.equal(t.events.filter(e=>e.payload.resultId).length,0);assert.equal(calls(t).filter(row=>row.name==='pankeki_get_result').length,1);assert.equal(t.bridge.getResultDescriptor({jobId:JOB,projectId:'p',requestId:'auto',sourceRevision:'rev'}),null);await t.bridge.close();assert.equal(calls(t).filter(row=>row.name==='pankeki_cancel_job').length,0,'a succeeded job needs no cancel after a verification failure');}finally{await t.bridge.close();}
 });
 test(`${provider} readonly foreign result errors cannot fail a new automatic chat request`,async()=>{
  const t=setups[provider]('auto-foreign-result-error');try{await t.bridge.connect();await t.bridge.send({text:'[Pankeki action: generate]\nGENERATE',projectId:'p',requestId:'owner',context:{sourceRevision:'rev'}});await done(t,'owner');const automatic=fixture();automatic.target.sourceRevision='newrev';await send(t,automatic,{requestId:'reader',context:{sourceRevision:'newrev'}});const end=await done(t,'reader');assert.equal(end.payload.status,'completed');assert.equal(t.events.filter(e=>e.requestId==='reader'&&e.type==='error').length,0);assert.equal(t.events.filter(e=>e.requestId==='reader'&&e.payload.resultId).length,0);assert.equal(t.events.find(e=>e.requestId==='reader'&&e.type==='intent-resolved').payload.intent,'chat');}finally{await t.bridge.close();}
 });
 test(`${provider} auto cancellation discards a delayed result descriptor before a new request`,async()=>{
  const t=setups[provider]('auto-cancel-result');try{await t.bridge.connect();await send(t);await t.waitFor(e=>e.type==='tool-started'&&e.payload.tool==='pankeki_result');await t.bridge.cancel({requestId:'auto'});await done(t);
   await t.bridge.send({text:'hello',projectId:'next',requestId:'next',context:{sourceRevision:'nextrev'}});await done(t,'next');await new Promise(resolve=>setTimeout(resolve,180));assert.equal(t.events.filter(e=>e.payload.resultId).length,0);assert.equal(t.bridge.getResultDescriptor({jobId:JOB,projectId:'p',requestId:'auto',sourceRevision:'rev'}),null);
  }finally{await t.bridge.close();}
 });
 test(`${provider} auto close drains a late image POST without delivering its result`,async()=>{
  const t=setups[provider]('auto-late-post',{timeouts:{drain:1000,close:100}});try{await t.bridge.connect();await send(t);await t.waitFor(e=>e.type==='tool-started'&&e.payload.tool==='pankeki_generate');await t.bridge.close();assert.equal(submits(t).length,1);assert.equal(calls(t).filter(row=>row.name==='pankeki_cancel_job').length,1);assert.equal(t.events.filter(e=>e.payload.resultId).length,0);}finally{await t.bridge.close();}
 });
 test(`${provider} auto old-job reads cannot publish or cancel another request job`,async()=>{
  const t=setups[provider]('auto-foreign');try{await t.bridge.connect();await t.bridge.send({text:'[Pankeki action: generate]\nGENERATE',projectId:'p',requestId:'owner',context:{sourceRevision:'rev'}});await done(t,'owner');const before=calls(t).length;
   const automatic=fixture();automatic.target.sourceRevision='newrev';await send(t,automatic,{requestId:'reader',context:{sourceRevision:'newrev'}});await done(t,'reader');assert.equal(t.events.filter(e=>e.requestId==='reader'&&e.payload.resultId).length,0);assert.equal(calls(t).slice(before).filter(row=>row.name==='pankeki_cancel_job').length,0);assert.equal(t.events.find(e=>e.requestId==='reader'&&e.type==='intent-resolved').payload.intent,'chat');
  }finally{await t.bridge.close();}
 });
}

// Controlled provider decisions exercise both production bridges, not Korean classification.
for(const provider of ['codex','claude'])test(`${provider} source-only recompose submits only its sealed reference using the selected Animagine model`,async()=>{
 const {spawn}=require('node:child_process');let t;
 const spawnImpl=(command,args,options)=>{
  const filename=path.join(__dirname,provider==='codex'||command==='fake-mcp'?'codex-bridge-fake-server.cjs':'claude-bridge-fake-cli.cjs');
  let script=fs.readFileSync(filename,'utf8').replaceAll("scenario==='auto-edit-recolor'?'recolor':'regenerate'","scenario==='auto-edit-recolor'?'recolor':'recompose'");
  script=script.replace("pankeki_edit_image: a => submit(a.operation==='regenerate'?", "pankeki_edit_image: a => submit(a.operation==='recompose'?{mode:'img2img',prompt:a.prompt,negative:a.negative,model_id:a.model_id,seed:a.seed,steps:a.steps,cfg:a.cfg,denoise:a.denoise,sampler:a.sampler,scheduler:a.scheduler,cache:a.cache,preview:a.preview,width:64,height:64,source:'fixture-reference'}:a.operation==='regenerate'?");
  script=script.replace("request: {mode: 'txt2img', prompt: 'cat girl', seed: 7}","request: (({source,...rest})=>rest)(JSON.parse(fs.readFileSync(path.join(state,'submissions',String(n),'request.json'),'utf8')).request)");
  return spawn(process.execPath,['-e',script,'isolated-provider-fixture',...args],{...options,env:{...options.env,FAKE_SCENARIO:'auto-edit-regenerate',FAKE_AUTH:'ok',FAKE_LOG:path.join(t.dataDir,'fake.log')}});
 };
 t=setups[provider]('auto-edit-regenerate',{spawnImpl,resolveEditContext:async()=>({sourcePath:files.sourcePath})});let files;
 try{
  files=selectedFiles(t);await t.bridge.connect();const automatic=fixture({modelId:'animagine-xl-4.0-opt',editReason:'mask'});
  automatic.target.referenceCandidateId='candidate-F';const {width,height,...settings}=automatic.generation.settings;automatic.recompose={ready:true,settings:{...settings,denoise:.55}};
  await send(t,automatic,{context:{sourceRevision:'rev',contextId:'reference'}});await done(t);
  const submitted=calls(t).filter(row=>row.name==='pankeki_edit_image');assert.equal(submitted.length,1);
  const actual=submitted[0].arguments;assert.equal(actual.operation,'recompose');assert.equal(actual.source_path,files.sourcePath);assert.equal(actual.mask_path,undefined);assert.equal(actual.model_id,'animagine-xl-4.0-opt');assert.equal(actual.denoise,.55);assert.equal(actual.target_color,undefined);
  assert.equal(t.events.find(event=>event.type==='intent-resolved').payload.operation,'recompose');
  const posted=t.bridge.getSubmittedRequest({projectId:'p',requestId:'auto',sourceRevision:'rev',jobId:JOB});assert.equal(posted.request.mode,'img2img');assert.equal(posted.request.source,undefined);
 }finally{await t.bridge.close();}
});


// Controlled ENGLISH provider output checks preservation and one-job authorization.
// It cannot establish that an LLM translates Korean pose/framing correctly.
for(const provider of ['codex','claude'])for(const positive of [
 '1girl, solo, adult woman, standing, front view, straight-on, full body, feet visible, uncropped, masterpiece, high score, great score, absurdres',
 '2boys, adult men, sitting, from behind, eyes closed, foot focus, soles, cropped, outer space, masterpiece, high score, great score, absurdres'
])test(`${provider} Animagine explicit pose framing output stays verbatim through automatic one-job settings binding: ${positive.includes('1girl')?'front':'contrasting intent'}`,async()=>{
 const {spawn}=require('node:child_process');let t;
 const spawnImpl=(command,args,options)=>{const filename=path.join(__dirname,provider==='codex'||command==='fake-mcp'?'codex-bridge-fake-server.cjs':'claude-bridge-fake-cli.cjs');const script=fs.readFileSync(filename,'utf8').replaceAll("prompt:'first'",'prompt:'+JSON.stringify(positive));return spawn(process.execPath,['-e',script,'controlled-english-output',...args],{...options,env:{...options.env,FAKE_SCENARIO:'auto-race',FAKE_AUTH:'ok',FAKE_LOG:path.join(t.dataDir,'fake.log')}});};
 t=setups[provider]('auto-race',{spawnImpl});try{await t.bridge.connect();const automatic=fixture({modelId:'animagine-xl-4.0-opt'}),negative='사용자 negative,  Keep CASE, bad hands';Object.assign(automatic.generation.settings,{negative,seed:42,width:832,height:1216,steps:28,cfg:5,sampler:'euler_ancestral',scheduler:'normal',cache:false,preview:false});await send(t,automatic,{text:'[Pankeki action: auto]\n원래 요청의 자세와 구도를 그대로 표현해줘.'});automatic.generation.settings.negative='late mutation';automatic.generation.settings.seed=999;await done(t);const submitted=submits(t);assert.equal(submitted.length,1,'duplicate and cross-operation provider attempts cannot generate another candidate');assert.equal(submitted[0].name,'pankeki_generate_image');assert.deepEqual(submitted[0].arguments,{prompt:positive,negative,model_id:'animagine-xl-4.0-opt',seed:42,width:832,height:1216,steps:28,cfg:5,sampler:'euler_ancestral',scheduler:'normal',cache:false,preview:false,trace_id:'auto'});assert.equal(t.events.filter(event=>event.type==='intent-resolved').length,1);assert.equal(t.events.filter(event=>event.payload.resultId).length,1);
 }finally{await t.bridge.close();}
});

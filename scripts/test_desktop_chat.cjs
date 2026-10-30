'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const filename=path.join(__dirname,'test_ui_state.cjs'),source=fs.readFileSync(filename,'utf8'),boundary=source.indexOf("\ntest('selected model preset reaches");
if(boundary<0)throw Error('Review UI harness boundary');
const harness=new Module(filename,module);harness.filename=filename;harness.paths=module.paths;
harness._compile(source.slice(0,boundary)+'\nmodule.exports={test,assert,page,settle,until,RED,BLUE,WHITE};',filename);
const {test,assert,page,settle,until,RED,BLUE,WHITE}=harness.exports;
const plain=value=>JSON.parse(JSON.stringify(value));
async function app(){const ui=page();await until(()=>ui.studio().getSummary().modelsReady,'catalog');return ui;}
function adapter(ui){assert(ui.studio().desktopChat,'desktop context/result boundary must exist');return ui.studio().desktopChat;}
function capture(ui,intent='generate'){return adapter(ui).captureContext({intent,includeEditAssets:intent==='edit'});}
function begin(ui,id='request-1',context=capture(ui)){assert.equal(adapter(ui).beginRequest({requestId:id,context}).accepted,true);return {requestId:id,projectId:context.projectId,sourceRevision:context.sourceRevision,context};}
function event(ref,type,payload){return {requestId:ref.requestId,projectId:ref.projectId,sourceRevision:ref.sourceRevision,type,payload};}
function result(ui,ref,jobId='job-1',imageDataUrl=BLUE){return event(ref,'result',{jobId,imageDataUrl,request:{...plain(ui.project().versions[0].request),mode:ref.context.intent==='edit'?'inpaint':'txt2img'},metrics:{kind:'inference',model_calls:1},label:'Codex candidate'});}
function moduleApi(){const file=path.join(__dirname,'../web/src/desktop-chat.js');assert(fs.existsSync(file),'desktop chat module must exist');return require(file);}
function transport(){let listener;const calls={send:[],cancel:[],prepare:[],resolve:[],connect:0};return {calls,getStatus:async()=>({codex:{state:'ready',toolsReady:true}}),connectCodex:async()=>{calls.connect++;return {state:'ready',toolsReady:true};},sendMessage:async value=>{calls.send.push(value);return {accepted:true};},cancelMessage:async value=>{calls.cancel.push(value);return {canceled:true};},prepareEditContext:async value=>{calls.prepare.push(value);return {projectId:value.projectId,sourceRevision:value.sourceRevision,sourceId:'source-local',maskId:'mask-local'};},onCodexEvent(fn){listener=fn;return()=>{listener=null;};},emit:async value=>listener?.(value)};}
async function automaticController({toolsReady=true,assets=false,regenerateReady=true}={}){
 const ipc=transport(),received=[],captures=[],ended=[],state={projectId:'auto-project',sourceRevision:'auto-source',maskRevision:1,revision:1};
 ipc.getStatus=async()=>({codex:{state:'ready',toolsReady}});
 const automatic={version:1,target:{visibleCandidateId:'F',sourceCandidateId:assets?'F':null,sourceRevision:state.sourceRevision,maskReady:assets},generationStyle:null,
  generation:{ready:true,settings:{model_id:'sd-turbo',negative:'',seed:42,width:512,height:512,steps:1,cfg:1,sampler:'euler',scheduler:'normal',cache:false,preview:false}},
  edit:{ready:assets,feather:assets?4:null,...(assets?{}:{reason:'source'}),regenerate:regenerateReady?{ready:true,settings:{model_id:'sdxl-inpaint-v01',seed:42,steps:25,cfg:6,sampler:'dpmpp_2m',scheduler:'karras',denoise:.55,halo:32,roi:true,cache:false,preview:false}}:{ready:false,settings:null,reason:'model'}}};
 let acceptDecision=true,acceptJob=true,id=0;
 const adapter={getState:()=>({...state}),captureContext:input=>{captures.push(input);return {version:2,intent:'auto',...state,automatic,...(assets?{source:{dataUrl:RED,width:1,height:1},mask:{dataUrl:WHITE,width:1,height:1}}:{})};},
  formatMessage:({text})=>'[Pankeki action: auto]\n'+text,beginRequest:()=>({accepted:true}),endRequest:ref=>ended.push(ref),
  receiveEvent:async event=>{received.push(event);return event.type==='intent-resolved'?{accepted:acceptDecision}:event.type==='job'?{accepted:acceptJob}:event.type==='result'?{accepted:true,candidateId:'auto-candidate'}:{accepted:true};}};
 const instance=moduleApi().createController({ipc,adapter,makeId:()=>`automatic-${++id}`,getAutomaticContext:()=>({visibleCandidateId:'F',generationStyle:null})});await instance.start();
 return {instance,ipc,received,captures,ended,automatic,denyDecision:()=>acceptDecision=false,denyJob:()=>acceptJob=false};
}

test('auto contract sends the original text and opaque metadata without requiring image tools or a mode selection',async()=>{
 const ui=await automaticController({toolsReady:false});try{
  assert.equal(await ui.instance.send({text:'이미지 생성 기능 설명해줘 / keep my English',intent:'auto'}),true);
  const wire=ui.ipc.calls.send[0];assert.equal(wire.text,'[Pankeki action: auto]\n이미지 생성 기능 설명해줘 / keep my English');
  assert.deepEqual(ui.captures[0],{intent:'auto',visibleCandidateId:'F',generationStyle:null});assert.deepEqual(wire.automatic,ui.automatic);
  assert.deepEqual(wire.context,{sourceRevision:'auto-source'});assert.equal(ui.instance.getState().messages[0].text,'이미지 생성 기능 설명해줘 / keep my English');
 }finally{ui.instance.destroy();}
});
test('auto contract resolves through the adapter and readonly old jobs never become candidates or image waiters',async()=>{
 const ui=await automaticController();let resolutions=0;ui.ipc.resolveResult=async()=>{resolutions++;return {imageDataUrl:RED};};try{
  assert.equal(await ui.instance.send({text:'그려줘',intent:'auto'}),true);const ref=ui.ipc.calls.send[0];
  await ui.ipc.emit({...ref,type:'tool-started',payload:{tool:'pankeki_job'}});
  await ui.ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'old-job',resultId:'old-job'}});
  assert.equal(resolutions,0);assert.equal(ui.received.length,0);assert.equal(ui.instance.getState().resolvedIntent,null);
  await ui.ipc.emit({...ref,type:'intent-resolved',payload:{intent:'generate'}});assert.equal(ui.instance.getState().resolvedIntent,'generate');
  assert.equal(ui.received[0].type,'intent-resolved');
  await ui.ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'old-job',resultId:'old-job'}});assert.equal(resolutions,0);
  await ui.ipc.emit({...ref,type:'tool-started',payload:{tool:'pankeki_generate'}});
  await ui.ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_generate',ok:true,jobId:'owned-job',jobStatus:'queued'}});
  await ui.ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'owned-job',resultId:'owned-job'}});
  await ui.ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'owned-job',jobStatus:'queued'}});
  await ui.ipc.emit({...ref,type:'turn-completed',payload:{status:'completed'}});
  assert.equal(resolutions,1);assert.equal(ui.instance.getState().phase,'done');assert.equal(ui.instance.getState().activeRequestId,null);
  assert.deepEqual(ui.instance.getState().messages.at(-1).candidateIds,['auto-candidate']);
 }finally{ui.instance.destroy();}
});
test('auto contract stages ready edit assets locally without leaking bytes into the provider payload',async()=>{
 const ui=await automaticController({assets:true,regenerateReady:false});try{
  assert.equal(await ui.instance.send({text:'이 부분을 다듬어줘',intent:'auto'}),true);
  assert.equal(ui.ipc.calls.prepare.length,1);assert.equal(ui.ipc.calls.prepare[0].sourceDataUrl,RED);
  assert.deepEqual(ui.ipc.calls.send[0].context,{sourceRevision:'auto-source',sourceId:'source-local',maskId:'mask-local'});
  assert.equal(JSON.stringify(ui.ipc.calls.send[0]).includes('data:image'),false);
  assert.equal(ui.ipc.calls.send[0].automatic.edit.regenerate.ready,false);assert.equal(ui.ipc.calls.send[0].automatic.edit.feather,4);
  await ui.ipc.emit({...ui.ipc.calls.send[0],type:'intent-resolved',payload:{intent:'edit',operation:'recolor'}});assert.equal(ui.instance.getState().resolvedIntent,'edit');
 }finally{ui.instance.destroy();}
});
test('auto contract requires adapter acceptance and ignores foreign stale duplicate or conflicting decisions',async()=>{
 const ui=await automaticController();try{
  await ui.instance.send({text:'질문',intent:'auto'});const ref=ui.ipc.calls.send[0];
  for(const extra of [{requestId:'foreign'},{projectId:'foreign'},{context:{sourceRevision:'stale'}}])await ui.ipc.emit({...ref,...extra,type:'intent-resolved',payload:{intent:'generate'}});
  await ui.ipc.emit({...ref,type:'intent-resolved',payload:{intent:'edit'}});assert.equal(ui.received.length,0);
  await ui.ipc.emit({...ref,type:'intent-resolved',payload:{intent:'chat'}});assert.equal(ui.instance.getState().resolvedIntent,'chat');
  await ui.ipc.emit({...ref,type:'intent-resolved',payload:{intent:'chat'}});await ui.ipc.emit({...ref,type:'intent-resolved',payload:{intent:'generate'}});
  assert.equal(ui.instance.getState().resolvedIntent,'chat');assert.equal(ui.received.filter(e=>e.type==='intent-resolved').length,1);
 }finally{ui.instance.destroy();}
 const rejected=await automaticController();try{
  await rejected.instance.send({text:'질문',intent:'auto'});rejected.denyDecision();await rejected.ipc.emit({...rejected.ipc.calls.send[0],type:'intent-resolved',payload:{intent:'generate'}});
  assert.equal(rejected.instance.getState().resolvedIntent,null);
 }finally{rejected.instance.destroy();}
});
test('auto contract unauthorized starts and unresolved or mismatched successful mutations stay blocked',async()=>{
 for(const resolved of [null,'chat','generate'])for(const type of ['tool-started','tool-completed']){
  const ui=await automaticController();try{
   await ui.instance.send({text:'설명해줘',intent:'auto'});const ref=ui.ipc.calls.send[0];
   if(resolved)await ui.ipc.emit({...ref,type:'intent-resolved',payload:{intent:resolved}});
   await ui.ipc.emit({...ref,type,payload:{tool:resolved==='generate'?'pankeki_edit':'pankeki_generate',ok:true}});
   assert.equal(ui.instance.getState().activeRequestId,null);assert.equal(ui.ipc.calls.cancel.length,1);assert.equal(ui.received.some(e=>e.type==='job'||e.type==='result'),false);
  }finally{ui.instance.destroy();}
 }
 const ui=await automaticController({assets:true});try{
  ui.ipc.prepareEditContext=async()=>({projectId:'foreign',sourceRevision:'auto-source',sourceId:'source-local',maskId:'mask-local'});
  assert.equal(await ui.instance.send({text:'다듬어줘',intent:'auto'}),false);assert.equal(ui.ipc.calls.send.length,0);
 }finally{ui.instance.destroy();}
});
test('auto rejected completion still obeys genuine native error failed and needs-input termination',async()=>{
 for(const [type,payload,phase] of [['error',{code:'image-result',message:'승자 결과를 검증하지 못했어요.'},'error'],['turn-completed',{status:'failed'},'error'],['needs-input',{reason:'target'},'needs-input']]){
  const ui=await automaticController();try{
   await ui.instance.send({text:'그려줘',intent:'auto'});const ref=ui.ipc.calls.send[0];
   await ui.ipc.emit({...ref,type:'intent-resolved',payload:{intent:'generate'}});await ui.ipc.emit({...ref,type:'tool-started',payload:{tool:'pankeki_generate'}});
   await ui.ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_edit',ok:false}});assert.equal(ui.instance.getState().activeRequestId,ref.requestId);
   await ui.ipc.emit({...ref,type,payload});assert.equal(ui.instance.getState().phase,phase);assert.equal(ui.instance.getState().activeRequestId,null);assert.equal(ui.ipc.calls.cancel.length,0);
  }finally{ui.instance.destroy();}
 }
});
test('auto contract cannot create an image waiter or resolve a job rejected by the app ownership guard',async()=>{
 const ui=await automaticController();let resolved=0;ui.ipc.resolveResult=async()=>{resolved++;return {};};try{
  await ui.instance.send({text:'그려줘',intent:'auto'});const ref=ui.ipc.calls.send[0];await ui.ipc.emit({...ref,type:'intent-resolved',payload:{intent:'generate'}});ui.denyJob();
  await ui.ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_generate',ok:true,jobId:'rejected-job',jobStatus:'queued'}});
  await ui.ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'rejected-job',resultId:'rejected-job'}});
  assert.equal(ui.instance.getState().activeRequestId,null);assert.equal(ui.ipc.calls.cancel.length,1);assert.equal(resolved,0);
 }finally{ui.instance.destroy();}
});
for(const [winner,rejected] of [['generate','edit'],['edit','generate'],['generate','generate'],['edit','edit']])test(`auto rejected completion preserves ${winner} winner against ${rejected} before a second POST`,async()=>{
 const policy=require('../desktop/pankeki-tools.cjs'),ui=await app(),ipc=transport();await ui.studio().importProject(ui.project('Winner'));
 ui.studio().setImageModelSettings({editModelId:'sdxl-base'});ui.element('paint').snapshot=WHITE;
 ui.element('paint').getContext().getImageData=()=>({data:new Uint8ClampedArray([255,255,255,255])});
 const instance=moduleApi().createController({ipc,adapter:adapter(ui),makeId:()=> 'winner-request',getAutomaticContext:()=>({visibleCandidateId:ui.state().sourceId,generationStyle:null})});
 await instance.start();let runner,winning,stream=Promise.resolve(),nativeRef;const events=[];
 try{
  assert.equal(await instance.send({text:'한 번만 작업해줘',intent:'auto'}),true);const wire=ipc.calls.send[0],before=ui.state().project.versions.length;
  assert.equal(wire.automatic.edit.ready,true);assert.equal(wire.automatic.edit.regenerate.ready,true);
  const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'pankeki-frontend-winner-')),inputs=path.join(dir,'inputs'),selected=path.join(inputs,wire.projectId),logFile=path.join(dir,'adapter.log');fs.mkdirSync(selected,{recursive:true});
  const files={sourcePath:path.join(selected,'source.png'),maskPath:path.join(selected,'mask.png')};
  fs.writeFileSync(files.sourcePath,Buffer.from(RED.split(',')[1],'base64'));fs.writeFileSync(files.maskPath,Buffer.from(WHITE.split(',')[1],'base64'));
  nativeRef={...wire,sourceRevision:wire.context.sourceRevision,contextId:'selected',automatic:policy.validateAutomaticContext(plain(wire.automatic)),action:'chat',jobs:new Set()};
  ipc.cancelMessage=async input=>{ipc.calls.cancel.push(input);nativeRef.canceled=true;return {canceled:true};};
  const emit=(type,payload)=>{events.push({type,payload});stream=stream.then(()=>ipc.emit({...wire,type,payload}));};
  runner=policy.createToolRunner({projectRoot:path.resolve(__dirname,'..'),paths:{inputs,state:path.join(dir,'state'),work:dir},limits:{request:1500,tool:1500,close:100,drain:1000},emit,current:ref=>!ref.canceled,resolveEditContext:async()=>files,
   mcpCommand:({state})=>({command:process.execPath,args:[path.join(__dirname,'../desktop/tests/codex-bridge-fake-server.cjs'),'--mcp','--state',state],env:{FAKE_SCENARIO:'auto-late-post',FAKE_LOG:logFile}})});
  const tool=kind=>kind==='generate'?'pankeki_generate':'pankeki_edit',args=kind=>kind==='generate'?{prompt:'one translated request'}:{operation:'regenerate',prompt:'one edited request'};
  const permit=policy.reserveAutomaticSubmission(nativeRef,tool(winner),args(winner),emit);emit('tool-started',{tool:tool(winner)});
  let settled=false;winning=runner.runTool(nativeRef,tool(winner),args(winner),permit).then(value=>{settled=true;return value;});winning.catch(()=>{});
  const calls=()=>fs.existsSync(logFile)?fs.readFileSync(logFile,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter(row=>row.received?.method==='tools/call').map(row=>row.received.params):[];
  const submits=()=>calls().filter(row=>['pankeki_generate_image','pankeki_edit_image'].includes(row.name));
  for(let i=0;i<200&&!submits().length;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(submits().length,1);assert.equal(settled,false,'winner POST is still in flight');await stream;const notice=instance.getState().notice;
  let refusal;try{policy.reserveAutomaticSubmission(nativeRef,tool(rejected),args(rejected),emit);}catch(error){refusal=error;}
  assert.equal(refusal?.code,'scope');policy.failAutomaticSubmission(nativeRef,undefined,refusal,emit);
  emit('tool-completed',{tool:tool(rejected),ok:false,error:refusal.message});await stream;
  assert.equal(instance.getState().activeRequestId,wire.requestId);assert.equal(instance.getState().resolvedIntent,winner);assert.equal(instance.getState().notice,notice);assert.equal(ipc.calls.cancel.length,0);
  const completed=await winning;emit('tool-completed',{...completed.payload,ok:true});await stream;
  const edit=winner==='edit',settings=edit?wire.automatic.edit.regenerate.settings:wire.automatic.generation.settings;
  ipc.resolveResult=async()=>({imageDataUrl:BLUE,request:{...plain(ui.project().versions[0].request),...plain(settings),mode:edit?'inpaint':'txt2img',...(edit?{edit_operation:'regenerate',feather:wire.automatic.edit.feather}:{})},metrics:{model_calls:1}});
  const result=await runner.runTool(nativeRef,'pankeki_result',{job_id:completed.payload.jobId});emit('tool-completed',{...result.payload,ok:true});await stream;
  emit('turn-completed',{status:'completed'});await stream;
  assert.equal(submits().length,1);assert.equal(events.filter(e=>e.type==='tool-started').length,1);assert.equal(ipc.calls.cancel.length,0);assert.equal(ui.state().project.versions.length,before+1);assert.equal(instance.getState().activeRequestId,null);assert.equal(instance.getState().phase,'done');
 }finally{await winning?.catch(()=>{});await runner?.close();instance.destroy();}
});
async function controller(ui,ipc=transport(),options={}){const states=[];let id=0;const instance=moduleApi().createController({ipc,adapter:adapter(ui),subscribe:ui.studio().subscribe,onChange:state=>states.push(state),makeId:()=>`chat-${++id}`,formatMessage:({text,intent,context})=>`[Pankeki action: ${intent}]\n[Pankeki settings: ${JSON.stringify({model_id:context.generation.modelId,width:context.generation.width,height:context.generation.height})}]\n${text}`,...options});await instance.start();return {instance,ipc,states};}

test('desktop context is an explicit scalar whitelist and never exports a project or notes',async()=>{
  const ui=await app();await ui.studio().importProject(ui.project('Kept'));
  ui.element('notes').value='/private/secret do not send';
  const before=ui.studio().exportProject(),ctx=capture(ui,'chat');
  assert.equal(ctx.intent,'chat');assert.equal(ctx.source,undefined);assert.equal(ctx.mask,undefined);
  assert.equal(JSON.stringify(ctx).includes('secret'),false);assert.equal(JSON.stringify(ctx).includes('versions'),false);
  assert.equal(ui.studio().exportProject(),before);assert.equal(ui.requests.length,0);
});
test('edit context requires explicit assets, a loaded source, and nonempty painted mask',async()=>{
  const ui=await app(),api=adapter(ui);
  assert.throws(()=>capture(ui,'edit'),/원본/);
  await ui.studio().importProject(ui.project());
  assert.throws(()=>api.captureContext({intent:'edit',includeEditAssets:false}),/선택|동의/);
  ui.element('paint').getContext().getImageData=()=>({data:new Uint8ClampedArray([0,0,0,255])});
  assert.throws(()=>capture(ui,'edit'),/마스크|칠/);
  ui.element('paint').getContext().getImageData=()=>({data:new Uint8ClampedArray([255,255,255,255])});ui.element('paint').snapshot=WHITE;
  const ctx=capture(ui,'edit');assert.equal(ctx.source.dataUrl,RED);assert.equal(ctx.mask.dataUrl,WHITE);
  assert.equal(ctx.sourceRevision,api.getState().sourceRevision);assert.equal(ctx.maskRevision,api.getState().maskRevision);
});
test('a live registered job result appends once through the real gallery and project boundary without a GPU request',async()=>{
  const ui=await app();await ui.studio().importProject(ui.project('Keep original'));
  const ref=begin(ui),api=adapter(ui),original=ui.state().project.versions[0].id;
  assert.equal((await api.receiveEvent(result(ui,ref))).accepted,false,'unregistered job');
  assert.equal((await api.receiveEvent(event(ref,'job',{jobId:'job-1',state:'running'}))).accepted,true);
  const output=result(ui,ref);assert.equal((await api.receiveEvent(output)).accepted,true);
  assert.equal((await api.receiveEvent(output)).accepted,false,'duplicate result');
  assert.equal(ui.state().project.versions.length,2);assert.equal(ui.state().project.versions[0].id,original);
  assert.equal(ui.element('result').src,BLUE);assert.equal(ui.element('gallery').children.filter(n=>n.dataset.candidateId).length,2);
  assert.equal(JSON.parse(ui.studio().exportProject()).versions.at(-1).image,BLUE);assert.equal(ui.requests.length,0);
});
test('cancel, project replacement, source replacement and decode races cannot append old results',async()=>{
  for(const change of ['cancel','project','source','decode']){
    const ui=await app();await ui.studio().importProject(ui.project('Original'));
    const api=adapter(ui),ref=begin(ui);await api.receiveEvent(event(ref,'job',{jobId:'job-1',state:'running'}));
    let pending;
    if(change==='decode'){ui.heldImages.add(BLUE);pending=api.receiveEvent(result(ui,ref));await settle();}
    if(change==='cancel')api.endRequest({requestId:ref.requestId});
    else if(change==='source')await ui.studio().loadSource(RED,{parentId:'parent'});
    else ui.studio().resetProject();
    const before=ui.studio().exportProject();
    if(pending){ui.decode(BLUE);assert.equal((await pending).accepted,false);}else assert.equal((await api.receiveEvent(result(ui,ref))).accepted,false);
    assert.equal(ui.studio().exportProject(),before,change);assert.equal(ui.requests.length,0);
  }
});
test('mask generation mismatch and malformed image result do not mutate the document',async()=>{
  const ui=await app();await ui.studio().importProject(ui.project());const api=adapter(ui),ref=begin(ui);
  await api.receiveEvent(event(ref,'job',{jobId:'job-1',state:'running'}));const before=ui.studio().exportProject();
  assert.equal((await api.receiveEvent(result(ui,ref,'job-1','https://example.test/evil.png'))).accepted,false);
  await ui.element('clearMask').click();assert.equal((await api.receiveEvent(result(ui,ref))).accepted,false);
  assert.equal(ui.studio().exportProject(),before);
});
test('sourceRevision is an opaque composite token that changes for mask-only edits and RGB defines selection',async()=>{
  const ui=await app();await ui.studio().importProject(ui.project());const api=adapter(ui),before=api.getState();
  assert.match(before.sourceRevision,/^[A-Za-z0-9_-]{1,80}$/);
  await ui.element('clearMask').click();assert.notEqual(api.getState().sourceRevision,before.sourceRevision);
  ui.element('paint').getContext().getImageData=()=>({data:new Uint8ClampedArray([255,255,255,0])});
  assert.equal(capture(ui,'edit').intent,'edit','alpha does not define mask meaning');
  ui.element('paint').getContext().getImageData=()=>({data:new Uint8ClampedArray([0,0,1,255])});
  assert.throws(()=>capture(ui,'edit'),/マスク|마스크|칠/,'RGB luminance rounds to black');
});
test('web mode mounts nothing and never attempts IPC',()=>{
  const api=moduleApi();assert.equal(api.mount({body:{}},{ipc:null}),null);
});
test('streaming is request scoped, full message replaces deltas, and duplicate submit is blocked',async()=>{
  const ui=await app(),{instance,ipc}=await controller(ui);
  assert.equal(await instance.send({text:'Hello',intent:'chat'}),true);
  assert.equal(await instance.send({text:'Duplicate',intent:'chat'}),false);assert.equal(ipc.calls.send.length,1);
  const ref=ipc.calls.send[0];await ipc.emit({...ref,type:'message-delta',payload:{text:'<img onerror=evil>'}});
  await ipc.emit({...ref,requestId:'unrelated',type:'message-delta',payload:{text:'WRONG'}});
  assert.equal(instance.getState().messages.at(-1).text,'<img onerror=evil>');
  await ipc.emit({...ref,type:'message',payload:{text:'Complete answer'}});
  await ipc.emit({...ref,type:'turn-completed',payload:{status:'completed'}});
  assert.equal(instance.getState().messages.at(-1).text,'Complete answer');assert.equal(instance.getState().activeRequestId,null);
  instance.destroy();
});
test('cancel immediately retires request before a delayed acknowledgement and suppresses late text/results',async()=>{
  const ui=await app(),{instance,ipc}=await controller(ui);
  await instance.send({text:'Make an image',intent:'generate'});const ref=ipc.calls.send[0];
  let finish;ipc.cancelMessage=value=>{ipc.calls.cancel.push(value);return new Promise(resolve=>finish=resolve);};
  const pending=instance.cancel();await ipc.emit({...ref,type:'message-delta',payload:{text:'LATE'}});
  assert.equal(instance.getState().messages.at(-1).text.includes('LATE'),false);assert.equal(instance.getState().activeRequestId,null);
  finish({});await pending;assert.equal(ipc.calls.cancel.length,1);instance.destroy();
});
test('project switch retires the old chat request and late events stay out of the new project',async()=>{
  const ui=await app(),{instance,ipc}=await controller(ui);await instance.send({text:'Hello',intent:'chat'});const ref=ipc.calls.send[0];
  ui.studio().resetProject();await settle();await ipc.emit({...ref,type:'message-delta',payload:{text:'OLD'}});
  assert.equal(instance.getState().activeRequestId,null);assert.equal(instance.getState().messages.length,0);
  assert.equal(ipc.calls.cancel.length,1);instance.destroy();
});
test('edit assets are staged locally and only opaque local IDs enter sendMessage',async()=>{
  const ui=await app();await ui.studio().importProject(ui.project());
  ui.element('paint').getContext().getImageData=()=>({data:new Uint8ClampedArray([255,255,255,255])});ui.element('paint').snapshot=WHITE;
  const {instance,ipc}=await controller(ui);
  assert.equal(await instance.send({text:'Change scarf',intent:'edit',includeEditAssets:true}),true);
  assert.equal(ipc.calls.prepare[0].sourceDataUrl,RED);assert.equal(ipc.calls.prepare[0].maskDataUrl,WHITE);
  assert.equal(ipc.calls.send[0].context.sourceId,'source-local');assert.equal(ipc.calls.send[0].context.maskId,'mask-local');
  assert.deepEqual(Object.keys(ipc.calls.send[0].context).sort(),['maskId','sourceId','sourceRevision']);
  assert.equal(JSON.stringify(ipc.calls.send[0]).includes('data:image'),false);
  instance.destroy();
});
test('turn completion keeps a submitted image job alive until the later verified result is applied',async()=>{
  const ui=await app(),ipc=transport();
  ipc.resolveResult=async()=>({imageDataUrl:BLUE,request:plain(ui.project().versions[0].request),metrics:{model_calls:1}});
  const {instance}=await controller(ui,ipc);await instance.send({text:'Generate a character',intent:'generate'});const ref=ipc.calls.send[0];
  await ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_generate',ok:true,jobId:'job-later',jobStatus:'queued'}});
  await ipc.emit({...ref,type:'turn-completed',payload:{status:'completed'}});
  assert.equal(instance.getState().activeRequestId,ref.requestId,'image work outlives assistant turn');
  await ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'job-later',resultId:'job-later',jobStatus:'succeeded'}});
  assert.equal(ui.state().project.versions.length,1);assert.equal(ui.element('result').src,BLUE);
  assert.equal(instance.getState().activeRequestId,null);assert.equal(ui.requests.length,0);
  instance.destroy();
});
test('automatic result then duplicate tool completion cannot reopen a terminal job before turn completion',async()=>{
  const ui=await app();await ui.studio().importProject(ui.project('Keep existing'));
  const ipc=transport();let resolves=0;
  ipc.resolveResult=async()=>{resolves++;return {imageDataUrl:BLUE,request:plain(ui.project().versions[0].request),metrics:{model_calls:1}};};
  const {instance}=await controller(ui,ipc);
  try{
    await instance.send({text:'Generate a character',intent:'generate'});const ref=ipc.calls.send[0];
    await ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_generate',ok:true,jobId:'job-auto',jobStatus:'queued'}});
    await ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_job',ok:true,jobId:'job-auto',jobStatus:'succeeded'}});
    await ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'job-auto',resultId:'job-auto',jobStatus:'succeeded'}});
    const candidate=ui.state().project.versions.at(-1).id;
    assert.equal(ui.state().project.versions.length,2);assert.equal(instance.getState().activeRequestId,ref.requestId,'the model turn is still active');
    await ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'job-auto',jobStatus:'succeeded'}});
    await ipc.emit({...ref,type:'turn-completed',payload:{status:'completed'}});
    await ipc.emit({type:'status',payload:{state:'ready',toolsReady:true}});
    assert.equal(instance.getState().phase,'done');assert.equal(instance.getState().activeRequestId,null);
    assert.equal(instance.settingsLocked(),false);assert.equal(ui.studio().getImageModelSettings().busy,false);
    assert.equal(resolves,1);assert.deepEqual(instance.getState().messages.at(-1).candidateIds,[candidate]);assert.equal(ui.state().project.versions.length,2);
    assert.equal(await instance.send({text:'Follow-up chat',intent:'chat'}),true);const next=ipc.calls.send[1];
    await ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_job',ok:true,jobId:'job-auto',jobStatus:'running'}});
    assert.equal(instance.getState().activeRequestId,next.requestId);assert.equal(ui.state().project.versions.length,2);assert.equal(ui.requests.length,0);
  }finally{instance.destroy();}
});
test('a collected terminal job stays settled while another succeeded job still waits for its verified result',async()=>{
  const ui=await app(),ipc=transport();
  ipc.resolveResult=async({jobId})=>({imageDataUrl:jobId==='job-first'?BLUE:WHITE,request:plain(ui.project().versions[0].request),metrics:{model_calls:1}});
  const {instance}=await controller(ui,ipc);
  try{
    await instance.send({text:'Two images',intent:'generate'});const ref=ipc.calls.send[0];
    await ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'job-first',resultId:'job-first',jobStatus:'succeeded'}});
    await ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_generate',ok:true,jobId:'job-second',jobStatus:'queued'}});
    for(const jobStatus of ['succeeded','queued','running'])await ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_job',ok:true,jobId:'job-first',jobStatus}});
    await ipc.emit({...ref,type:'turn-completed',payload:{status:'completed'}});
    assert.equal(instance.getState().phase,'waiting-job');assert.equal(instance.getState().activeRequestId,ref.requestId);
    await ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_job',ok:true,jobId:'job-second',jobStatus:'succeeded'}});
    assert.equal(instance.getState().phase,'waiting-job','succeeded metadata alone cannot stand in for result collection');assert.equal(ui.state().project.versions.length,1);
    await ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'job-second',resultId:'job-second',jobStatus:'succeeded'}});
    assert.equal(instance.getState().phase,'done');assert.equal(instance.getState().activeRequestId,null);assert.equal(ui.state().project.versions.length,2);
    assert.equal(ui.studio().getImageModelSettings().busy,false);assert.equal(ui.requests.length,0);
  }finally{instance.destroy();}
});
test('staged assets from the wrong project/revision never reach sendMessage',async()=>{
  const ui=await app();await ui.studio().importProject(ui.project());
  ui.element('paint').getContext().getImageData=()=>({data:new Uint8ClampedArray([255,255,255,255])});
  const ipc=transport();ipc.prepareEditContext=async()=>({projectId:'other',sourceRevision:'old',sourceId:'source-local',maskId:'mask-local'});
  const {instance}=await controller(ui,ipc);
  assert.equal(await instance.send({text:'Edit',intent:'edit',includeEditAssets:true}),false);assert.equal(ipc.calls.send.length,0);instance.destroy();
});
test('a rejected old resolver cannot fail a newer request after cancellation',async()=>{
  const ui=await app(),ipc=transport();let rejectOld,started=false;
  ipc.resolveResult=()=>{started=true;return new Promise((resolve,reject)=>rejectOld=reject);};
  const {instance}=await controller(ui,ipc);await instance.send({text:'First image',intent:'generate'});const old=ipc.calls.send[0];
  const oldEvent=ipc.emit({...old,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'old-job',resultId:'old-job'}});
  await until(()=>started,'old resolver');await instance.cancel();
  await instance.send({text:'New request',intent:'chat'});const next=ipc.calls.send[1];assert(next);
  rejectOld(Error('Old resolver failed'));await oldEvent;
  assert.equal(instance.getState().activeRequestId,next.requestId);
  await ipc.emit({...next,type:'message-delta',payload:{text:'New reply'}});
  assert.equal(instance.getState().messages.at(-1).text,'New reply');instance.destroy();
});
test('missing or stale event snapshot token does not change a matching request transcript',async()=>{
  const ui=await app(),{instance,ipc}=await controller(ui);await instance.send({text:'Hello'});const ref=ipc.calls.send[0];
  await ipc.emit({requestId:ref.requestId,projectId:ref.projectId,type:'message-delta',payload:{text:'MISSING'}});
  await ipc.emit({...ref,context:{sourceRevision:'old'},type:'message-delta',payload:{text:'STALE'}});
  assert.equal(instance.getState().messages.at(-1).text,'');instance.destroy();
});
test('wire text states intent and validated settings while canonical context stays reference-only',async()=>{
  const ui=await app(),{instance,ipc}=await controller(ui);await instance.send({text:'A character',intent:'generate'});
  const wire=ipc.calls.send[0];assert.match(wire.text,/^\[Pankeki action: generate\]\n\[Pankeki settings: /);assert.match(wire.text,/"width":512/);assert.match(wire.text,/"model_id":"sd-turbo"/);
  assert.deepEqual(Object.keys(wire.context),['sourceRevision']);instance.destroy();
});
test('production image send fails closed without the app-owned normalized formatter and chat forbids image tools',async()=>{
  const ui=await app(),ipc=transport(),thin={...adapter(ui),formatMessage:undefined};
  const instance=moduleApi().createController({ipc,adapter:thin,makeId:()=> 'guarded'});await instance.start();
  assert.equal(await instance.send({text:'Generate',intent:'generate'}),false);assert.equal(ipc.calls.send.length,0);
  assert.equal(await instance.send({text:'Hello',intent:'chat'}),true);assert.match(ipc.calls.send[0].text,/^\[Pankeki action: chat\]/);assert.match(ipc.calls.send[0].text,/이미지.*도구.*실행하지/);
  instance.destroy();
});
test('an image formatter cannot serialize raw paths/assets or the whole request into the settings block',async()=>{
  const ui=await app(),{instance,ipc}=await controller(ui,transport(),{formatMessage:()=> '[Pankeki action: generate]\n[Pankeki settings: {"source":"data:image/png;base64,RAW"}]\nDraw'});
  assert.equal(await instance.send({text:'Draw',intent:'generate'}),false);assert.equal(ipc.calls.send.length,0);instance.destroy();
});
test('a chat-only turn cannot start image work or resolve a result into the project',async()=>{
  const ui=await app(),ipc=transport();ipc.resolveResult=async()=>{throw Error('must not resolve');};
  const {instance}=await controller(ui,ipc);await instance.send({text:'Discuss the design',intent:'chat'});const ref=ipc.calls.send[0];
  const before=ui.studio().exportProject();
  await ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'job-existing',resultId:'job-existing'}});
  assert.equal(ui.studio().exportProject(),before);assert.equal(instance.getState().activeRequestId,ref.requestId);
  await ipc.emit({...ref,type:'tool-started',payload:{tool:'pankeki_generate'}});
  assert.equal(instance.getState().activeRequestId,null);assert.equal(ipc.calls.cancel.length,1);assert.equal(ui.requests.length,0);instance.destroy();
});
test('login, missing runtime, limit and needs-input have explicit states without automatic retries',async()=>{
  const ui=await app(),{instance,ipc}=await controller(ui);
  for(const state of ['missing','signed-out','starting']){
    await ipc.emit({type:'status',payload:{state}});assert.equal(instance.getState().codex.state,state);
    assert.equal(await instance.send({text:'Hello'}),false);
  }
  await ipc.emit({type:'status',payload:{state:'ready',toolsReady:true}});await instance.send({text:'Hello'});const ref=ipc.calls.send[0];
  await ipc.emit({...ref,type:'error',payload:{code:'rate_limited',message:'Limit reached'}});
  assert.equal(instance.getState().phase,'limited');assert.equal(ipc.calls.send.length,1);
  await ipc.emit({...ref,type:'needs-input',payload:{reason:'mask'}});assert.equal(ipc.calls.send.length,1);
  instance.destroy();
});

test('central desktop chat preserves navigation/logo and displays model HTML literally',async()=>{
  const file=path.join(__dirname,'test_ui_unification.cjs'),text=fs.readFileSync(file,'utf8'),end=text.indexOf("\ntest('settings opened");
  const dom=new Module(file,module);dom.filename=file;dom.paths=module.paths;dom._compile(text.slice(0,end)+'\nmodule.exports={mounted};',file);
  const ui=await dom.exports.mounted(),ipc=transport(),api=moduleApi(),nav=ui.doc.querySelector('.pk-navigation');
  const before=nav.querySelectorAll('button').map(node=>node.getAttribute('aria-label')),logo=ui.doc.querySelector('.pk-brand img').src;
  const view=api.mount(ui.doc,{ipc,studio:ui.studio(),workflow:ui.sandbox.PankekiWorkflowController});assert(view);await settle();
  assert.equal(ui.doc.getElementById('desktopChatPanel'),null);assert.equal(ui.doc.querySelector('.desktop-chat-launcher'),null);ui.controller.go('design');
  const input=ui.doc.getElementById('pcPrompt');input.value='Hello';await input.dispatchEvent(new ui.Event('input'));
  await ui.doc.getElementById('pkPromptForm').requestSubmit();const ref=ipc.calls.send[0];assert(ref);
  await ipc.emit({...ref,type:'message-delta',payload:{text:'<img src=x onerror=evil()>'}});
  const reply=ui.doc.querySelector('.desktop-chat-reply');assert.equal(reply.querySelector('img'),null);assert.match(reply.textContent,/<img src=x/);
  assert.deepEqual(nav.querySelectorAll('button').map(node=>node.getAttribute('aria-label')),before);assert.equal(before.length,9);assert.equal(ui.doc.querySelector('.pk-brand img').src,logo);
  view.destroy();assert.equal(ui.doc.getElementById('desktopChatIntent'),null);assert.equal(ui.requests.length,0);
});

test('a bridge usage-limit error shows a Korean limit notice and title without the raw URL',async()=>{
  const ui=await app(),{instance,ipc}=await controller(ui);
  await ipc.emit({type:'status',payload:{state:'ready',toolsReady:true}});await instance.send({text:'Hello'});const ref=ipc.calls.send[0];
  await ipc.emit({...ref,type:'error',payload:{code:'codex',message:"You've hit your usage limit. Visit https://chatgpt.com/settings/usage to purchase more credits or try again at Oct 31st, 2026 8:37 AM."}});
  await ipc.emit({...ref,type:'turn-completed',payload:{status:'failed'}});
  const state=instance.getState();
  assert.equal(state.phase,'limited');assert.match(state.notice,/사용 한도/);assert.match(state.notice,/Oct 31st, 2026 8:37 AM/);
  assert.equal(/https?:|chatgpt\.com|usage limit/i.test(state.notice),false);
  assert.equal(moduleApi().statusTitle(state),'Codex 사용 한도');
  assert.equal(await instance.send({text:'Again'}),false);assert.equal(ipc.calls.send.length,1);
  instance.destroy();
});
test('switching project clears a request error notice but keeps an account-wide limit',async()=>{
  const ui=await app(),{instance,ipc}=await controller(ui);
  await ipc.emit({type:'status',payload:{state:'ready',toolsReady:true}});await instance.send({text:'Hello'});let ref=ipc.calls.send[0];
  await ipc.emit({...ref,type:'error',payload:{code:'codex',message:'Something broke'}});
  assert.equal(instance.getState().phase,'error');assert.equal(moduleApi().statusTitle(instance.getState()),'Codex 요청 오류');
  ui.studio().resetProject();await settle();
  let state=instance.getState();
  assert.equal(state.phase,'idle');assert.equal(state.notice.includes('Something broke'),false);assert.equal(moduleApi().statusTitle(state),'Codex 준비됨');
  await instance.send({text:'Again'});ref=ipc.calls.send.at(-1);
  await ipc.emit({...ref,type:'error',payload:{code:'rate_limited',message:'Limit reached'}});
  ui.studio().resetProject();await settle();
  state=instance.getState();assert.equal(state.phase,'limited');assert.match(state.notice,/사용 한도/);
  instance.destroy();
});
test('switching to Claude clears the Codex limit, renames the status and shows the Claude limit in Korean',async()=>{
  const ui=await app(),{instance,ipc}=await controller(ui);const selected=[];
  ipc.selectProvider=async value=>{selected.push(value);return {state:'ready',provider:value.provider,toolsReady:true};};
  await ipc.emit({type:'status',payload:{state:'ready',toolsReady:true}});await instance.send({text:'Hello'});let ref=ipc.calls.send[0];
  await ipc.emit({...ref,type:'error',payload:{code:'codex',message:"You've hit your usage limit. Try again at Oct 31st, 2026 8:37 AM."}});
  assert.equal(moduleApi().statusTitle(instance.getState()),'Codex 사용 한도');
  assert.equal(await instance.selectProvider('gpt'),false);assert.equal(selected.length,0);
  assert.equal(await instance.selectProvider('claude'),true);assert.deepEqual(selected,[{provider:'claude'}]);
  let state=instance.getState();assert.equal(state.phase,'idle');assert.equal(moduleApi().statusTitle(state),'Claude 준비됨');
  assert.equal(await instance.send({text:'Again'}),true);ref=ipc.calls.send.at(-1);
  assert.equal(instance.getState().messages.at(-1).provider,'Claude');
  await ipc.emit({...ref,type:'error',payload:{code:'rate-limit',message:'Claude usage limit reached. Try again at Oct 25, 2026, 3:00 PM.'}});
  state=instance.getState();assert.equal(state.phase,'limited');assert.equal(moduleApi().statusTitle(state),'Claude 사용 한도');
  assert.match(state.notice,/^Claude 사용 한도에 도달했어요\. Oct 25, 2026, 3:00 PM 이후 다시 시도해주세요\.$/);
  instance.destroy();
});
test('the provider cannot change while a request is active',async()=>{
  const ui=await app(),{instance,ipc}=await controller(ui);let selected=0;
  ipc.selectProvider=async value=>{selected++;return {state:'ready',provider:value.provider,toolsReady:true};};
  await ipc.emit({type:'status',payload:{state:'ready',toolsReady:true}});await instance.send({text:'Hello'});
  assert.equal(await instance.selectProvider('claude'),false);assert.equal(selected,0);assert.equal(moduleApi().statusTitle(instance.getState()).startsWith('Codex'),true);
  instance.destroy();
});
function miniDocument(){
  const make=tag=>({tagName:tag.toUpperCase(),children:[],attributes:{},_text:'',
    append(...items){for(const item of items)this.children.push(typeof item==='string'?{text:item}:item);},
    replaceChildren(...items){this.children=[];this._text='';this.append(...items);},
    setAttribute(name,value){this.attributes[name]=String(value);},
    set textContent(value){this._text=String(value);this.children=[];},
    get textContent(){return this._text+this.children.map(child=>child.text??child.textContent).join('');}});
  return {createElement:make};
}
const shape=node=>node.text!==undefined?node.text:{[node.tagName.toLowerCase()]:node.children.length?node.children.map(shape):node._text,...(Object.keys(node.attributes).length?{attrs:node.attributes}:{})};
test('replies render bold, code, headings and lists as elements built from text only',()=>{
  const doc=miniDocument(),box=doc.createElement('div');
  moduleApi().renderMarkdown(doc,box,'## 상태\n앱은 **정상**이고 `sdxl-base`를 써요.\n둘째 줄\n\n- **SDXL**: 사용 가능\n- SD Turbo: 불가\n3. 셋째\n4. 넷째\n<img src=x onerror=evil()> **열린');
  assert.deepEqual(box.children.map(shape),[
    {p:[{b:['상태']}]},
    {p:['앱은 ',{b:'정상'},'이고 ',{code:'sdxl-base'},'를 써요.','\n','둘째 줄']},
    {ul:[{li:[{b:'SDXL'},': 사용 가능']},{li:['SD Turbo: 불가']}]},
    {ol:[{li:['셋째']},{li:['넷째']}],attrs:{start:'3'}},
    {p:['<img src=x onerror=evil()> **열린']}]);
});
test('a finished reply still waiting for its image releases the panel after the wait limit',async()=>{
  const ui=await app(),{instance,ipc}=await controller(ui,transport(),{waitLimitMs:30});
  await ipc.emit({type:'status',payload:{state:'ready',toolsReady:true}});
  assert.equal(await instance.send({text:'사과',intent:'generate'}),true);const ref=ipc.calls.send[0];
  await ipc.emit({...ref,type:'tool-started',payload:{tool:'pankeki_generate'}});
  await ipc.emit({...ref,type:'turn-completed',payload:{status:'completed'}});
  let state=instance.getState();assert.equal(state.phase,'waiting-job');assert.match(state.notice,/요청을 취소하세요/);assert.ok(state.activeRequestId);
  await new Promise(resolve=>setTimeout(resolve,60));
  state=instance.getState();assert.equal(state.phase,'error');assert.equal(state.activeRequestId,null);assert.match(state.notice,/이미지 결과를 받지 못해/);
  assert.equal(await instance.send({text:'다시'}),true);assert.equal(ipc.calls.send.length,2);
  instance.destroy();
});
test('the wait limit timer is cleared when the request finishes normally',async()=>{
  const ui=await app(),{instance,ipc}=await controller(ui,transport(),{waitLimitMs:30});
  await ipc.emit({type:'status',payload:{state:'ready',toolsReady:true}});
  await instance.send({text:'사과',intent:'generate'});const ref=ipc.calls.send[0];
  await ipc.emit({...ref,type:'tool-started',payload:{tool:'pankeki_generate'}});
  await ipc.emit({...ref,type:'turn-completed',payload:{status:'completed'}});
  await instance.cancel();await instance.send({text:'다음'});
  await new Promise(resolve=>setTimeout(resolve,60));
  const state=instance.getState();assert.ok(state.activeRequestId,'the new request is not ended by the old timer');assert.notEqual(state.phase,'error');
  instance.destroy();
});
for(const [provider,name] of [['Claude','Claude'],[undefined,'Codex'],['<b>evil</b>','Codex']]){
  test(`job status, candidate label and result notice use the chat model name (${provider??'none'} → ${name})`,async()=>{
    const ui=await app(),api=adapter(ui),context=capture(ui);
    assert.equal(api.beginRequest({requestId:'request-1',context,provider}).accepted,true);
    const ref={requestId:'request-1',projectId:context.projectId,sourceRevision:context.sourceRevision,context};
    await api.receiveEvent(event(ref,'job',{jobId:'job-1',state:'running'}));
    assert.equal(ui.element('status').textContent,name+' 이미지 작업을 진행하고 있어요.');
    const {label,...unlabeled}=result(ui,ref).payload;
    assert.equal((await api.receiveEvent(event(ref,'result',unlabeled))).accepted,true);
    assert.equal(ui.state().project.versions.at(-1).label,name+' 후보');
    assert.equal(ui.element('status').textContent,name+' 작업 결과를 후보에 추가했어요.');
  });
}
test('the chat controller tells the app which model the request uses',async()=>{
  const ui=await app(),api=adapter(ui),seen=[],original=api.beginRequest;
  const spy=Object.freeze({...api,beginRequest:value=>{seen.push(value.provider);return original(value);}});
  const ipc=transport();ipc.selectProvider=async value=>({state:'ready',provider:value.provider,toolsReady:true});
  const instance=moduleApi().createController({ipc,adapter:spy,subscribe:ui.studio().subscribe,makeId:()=>'chat-1',formatMessage:({text,intent})=>`[Pankeki action: ${intent}]\n[Pankeki settings: {}]\n${text}`});
  await instance.start();await ipc.emit({type:'status',payload:{state:'ready',toolsReady:true}});
  await instance.selectProvider('claude');await instance.send({text:'사과'});
  assert.deepEqual(seen,['Claude']);instance.destroy();
});

test('reference capture tokens are unique across source-only and masked snapshots without changing editor revision',async()=>{
 const ui=await app();await ui.studio().importProject(ui.project());ui.element('paint').snapshot=WHITE;ui.element('paint').context.getImageData=()=>({data:new Uint8ClampedArray([255,255,255,255])});const before=plain(adapter(ui).getState());
 const one=adapter(ui).captureContext({intent:'auto',visibleCandidateId:null,referenceCandidateId:'parent'}),two=adapter(ui).captureContext({intent:'auto',visibleCandidateId:'parent'});
 assert.equal(one.mask,undefined);assert.equal(two.mask.dataUrl,WHITE);
 assert.notEqual(one.sourceRevision,two.sourceRevision,'native snapshot keys cannot alias a different asset bundle');assert.deepEqual(plain(adapter(ui).getState()),before);
});


test('chat cleanup model reset keeps transcript and advances only validated runtime contexts',async()=>{
 const ui=await app(),ipc=transport();let revision=0,reset=true,fail=false;
 ipc.getStatus=async()=>({codex:{state:'ready',toolsReady:true,provider:'codex',modelId:'default',modelRevision:0}});
 ipc.getChatModelOptions=async()=>({provider:'codex',selectedModelId:'default',modelRevision:revision,options:[{id:'default',displayName:'기본 모델'},{id:'other',displayName:'새 모델'}]});
 ipc.setChatModel=async input=>{if(fail)throw Error('Controlled model write failure');return {provider:input.provider,selectedModelId:input.modelId,modelRevision:++revision,conversationReset:reset};};
 const {instance}=await controller(ui,ipc);try{const before=ui.studio().exportProject();
  assert.equal(instance.getState().contextEpoch,0);await instance.send({text:'모델 전 원문',intent:'chat'});const first=ipc.calls.send[0];await ipc.emit({...first,type:'message',payload:{text:'보존할 답변'}});await ipc.emit({...first,type:'turn-completed',payload:{status:'completed'}});
  const transcript=instance.getState().messages;assert(transcript.every(message=>message.contextEpoch===0));
  assert.equal(await instance.setChatModel('other'),true);assert.equal(instance.getState().contextEpoch,1);assert.deepEqual(instance.getState().messages,transcript);
  reset=false;assert.equal(await instance.setChatModel('default'),true);assert.equal(instance.getState().contextEpoch,1,'a save without actual conversation reset is not a new context');
  fail=true;assert.equal(await instance.setChatModel('other'),false);assert.equal(instance.getState().contextEpoch,1);assert.deepEqual(instance.getState().messages,transcript);assert.equal(ui.studio().exportProject(),before);
  await instance.send({text:'새 문맥 원문',intent:'chat'});assert(instance.getState().messages.slice(-2).every(message=>message.contextEpoch===1));
  const next=ipc.calls.send.at(-1);await ipc.emit({...next,type:'turn-completed',payload:{status:'completed'}});let complete;ipc.setChatModel=input=>new Promise(resolve=>complete=()=>resolve({provider:input.provider,selectedModelId:input.modelId,modelRevision:++revision,conversationReset:true}));const pending=instance.setChatModel('other');
  await ui.studio().importProject(ui.project('새 문맥 소유자'));await settle();const owner=adapter(ui).getState().projectId;assert.equal(instance.getState().contextEpoch,0);complete();assert.equal(await pending,true);assert.equal(instance.getState().codex.modelId,'other','the validated global model update still applies');assert.equal(instance.getState().projectId,owner);assert.equal(instance.getState().messages.length,0);assert.equal(instance.getState().contextEpoch,0,'a reset begun by an old owner cannot mark the newly loaded project');
 }finally{instance.destroy();}
});


test('chat cleanup reinput metadata belongs only to actual failed terminal requests',async()=>{
 for(const failure of ['send','turn']){const ui=await automaticController();try{if(failure==='send')ui.ipc.sendMessage=async input=>{ui.ipc.calls.send.push(input);throw Object.assign(Error('Controlled failed send'),{code:'send-failed'});};
  const accepted=await ui.instance.send({text:'실패해도 보존할 요청',intent:'auto'});const ref=ui.ipc.calls.send[0];if(failure==='turn'){assert.equal(accepted,true);await ui.ipc.emit({...ref,type:'turn-completed',payload:{status:'failed'}});}else assert.equal(accepted,false);
  const state=ui.instance.getState();assert.equal(state.phase,'error');assert.equal(state.lastFailure?.requestId,ref.requestId);assert.equal(state.lastFailure?.text,'실패해도 보존할 요청');
 }finally{ui.instance.destroy();}}
 for(const outcome of ['cancel','needs-input']){const ui=await automaticController();try{await ui.instance.send({text:'실패로 꾸미지 않을 요청',intent:'auto'});const ref=ui.ipc.calls.send[0];if(outcome==='cancel')await ui.instance.cancel();else await ui.ipc.emit({...ref,type:'needs-input',payload:{reason:'source'}});assert.equal(ui.instance.getState().lastFailure,null);}finally{ui.instance.destroy();}}
});

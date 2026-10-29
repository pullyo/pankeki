'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{webcrypto,createHash}=require('node:crypto');
const harness=fs.readFileSync(path.join(__dirname,'test_ui_state.cjs'),'utf8');
const prefix=harness.slice(0,harness.indexOf("\ntest('selected model preset"));
const {page,settle,RED,BLUE,BLACK,WHITE,deferred,until}=new Function('require','__dirname',prefix+'\nreturn {page,settle,RED,BLUE,BLACK,WHITE,deferred,until};')(require,__dirname);
const sha=data=>createHash('sha256').update(Buffer.from(data.split(',')[1],'base64')).digest('hex');
async function setup(options={}){
 const ui=page(options);ui.sandbox.crypto.subtle=webcrypto.subtle;
 const Original=ui.sandbox.Image;ui.sandbox.Image=class extends Original{constructor(){super();this.width=this.naturalWidth=1;this.height=this.naturalHeight=1;}};
 await settle();await ui.studio().importProject(ui.project('Photo',RED));
 const api=ui.studio().photoTools;assert.ok(api,'photo-tools core boundary is not implemented');
 const originalFetch=ui.sandbox.fetch,operations=[];
 ui.sandbox.fetch=async(url,options)=>{if(url==='/api/image-ops'){const d=deferred();operations.push({body:JSON.parse(options.body),...d});return d.promise;}return originalFetch(url,options);};
 function result(index=0,image=BLUE){const op=operations[index];op.resolve(ui.response({ok:true,operationId:op.body.operationId,operation:op.body.operation,image:{png:image,sha256:sha(image),width:1,height:1},metadata:{algorithm:'controlled-test',algorithmVersion:'1',parameters:{}}}));}
 return {ui,api,operations,result};
}
test('explicit target required; begin preserves source/mask/mode/model and draft settings',async()=>{
 const {ui,api}=await setup();const before=ui.state();await assert.rejects(api.begin('missing','markup'));
 const opened=await api.begin('parent','markup');assert.equal(opened.width,1);assert.equal(opened.image,RED);
 const after=ui.state();for(const key of ['sourceId','sourceDataURL','sourceRevision','maskRevision','project','busy'])assert.deepEqual(after[key],before[key]);
 assert.equal(api.getState().active,true);assert.equal(api.getState().locked,false);
 await assert.rejects(api.begin('parent','resize'));await api.cancel(opened.token);assert.equal(api.getState().active,false);
});
test('same apply coalesces one HTTP operation and commits one honest derived candidate',async()=>{
 const {ui,api,operations,result}=await setup();const opened=await api.begin('parent','background-remove');
 const one=api.apply(opened.token,{}),two=api.apply(opened.token,{});await until(()=>operations.length,'image op');
 assert.equal(api.getState().locked,true);result();const [a,b]=await Promise.all([one,two]);assert.equal(a.candidateId,b.candidateId);
 const versions=ui.state().project.versions;assert.equal(versions.length,2);assert.equal(versions[0].image,RED);assert.equal(versions[1].request,null);assert.equal(versions[1].kind,'derived');assert.equal(versions[1].parentId,'parent');assert.equal(versions[1].derivation.sourceSha256,sha(RED));assert.equal(operations.length,1);
 await assert.rejects(api.apply(opened.token,{}));
});
test('cancel or project replacement while HTTP awaits cannot commit into a newer project',async()=>{
 for(const replace of [false,true]){const {ui,api,operations,result}=await setup();const opened=await api.begin('parent','background-remove');const pending=api.apply(opened.token,{});await until(()=>operations.length,'pending');
  if(replace)await ui.studio().importProject(ui.project('Replacement',BLACK));else await api.cancel(opened.token);
  result();await assert.rejects(pending);assert.equal(ui.state().project.versions.length,1);assert.equal(ui.state().project.versions[0].image,replace?BLACK:RED);
 }
});
test('wrong operation response or PNG hash is rejected with no derived candidate',async()=>{
 const {ui,api,operations}=await setup();const opened=await api.begin('parent','background-remove');const pending=api.apply(opened.token,{});await until(()=>operations.length,'pending');
 operations[0].resolve(ui.response({ok:true,operationId:'wrong',operation:'background-remove',image:{png:BLUE,sha256:sha(BLUE),width:1,height:1},metadata:{algorithm:'test',algorithmVersion:'1',parameters:{}}}));
 await assert.rejects(pending);assert.equal(ui.state().project.versions.length,1);
});
test('coordinate comment CRUD persists through export/import without pixel or candidate change',async()=>{
 const {ui,api}=await setup();const opened=await api.begin('parent','comments');
 const note=api.saveComment(opened.token,{x:.25,y:.75,text:'목도리의 주석'});assert.equal(api.listComments('parent')[0].text,'목도리의 주석');
 await new Promise(resolve=>setTimeout(resolve,240));assert.equal(JSON.parse(ui.writes.at(-1)).versions[0].annotations[0].text,'목도리의 주석');
 const fresh=page({holdRestore:true});await until(()=>fresh.restores.length,'restore read');fresh.restores[0].resolve(ui.writes.at(-1));await until(()=>fresh.state().project.versions.length,'annotation auto restore');assert.equal(fresh.studio().photoTools.listComments('parent')[0].text,'목도리의 주석');
 const raw=ui.studio().exportProject();assert.equal(JSON.parse(raw).versions[0].image,RED);assert.equal(JSON.parse(raw).versions.length,1);
 await api.cancel(opened.token);await ui.studio().importProject(raw);assert.equal(api.listComments('parent')[0].id,note.id);
 const next=await api.begin('parent','comments');api.saveComment(next.token,{id:note.id,x:.5,y:.2,text:'바뀐 주석'});api.deleteComment(next.token,note.id);assert.deepEqual(JSON.parse(JSON.stringify(api.listComments('parent'))),[]);
});
test('invalid comment is rejected atomically and AI request cannot begin during a photo transaction',async()=>{
 const {ui,api}=await setup();const opened=await api.begin('parent','comments');await assert.rejects(async()=>api.saveComment(opened.token,{x:2,y:0,text:'invalid'}));assert.equal(api.listComments('parent').length,0);
 assert.throws(()=>ui.studio().desktopChat.captureContext({intent:'chat'}));assert.equal(ui.requests.length,0);await api.cancel(opened.token);
});
test('erase without an explicit nonempty natural-size PNG mask starts no job',async()=>{
 const {ui,api}=await setup();const before=ui.state(),opened=await api.begin('parent','erase');await assert.rejects(api.apply(opened.token,{}));assert.equal(ui.requests.length,0);
 for(const key of ['sourceId','sourceDataURL','sourceRevision','maskRevision'])assert.deepEqual(ui.state()[key],before[key]);
});
function maskCanvas(ui){const create=ui.sandbox.document.createElement.bind(ui.sandbox.document);ui.sandbox.document.createElement=(tag)=>{const el=create(tag);if(tag==='canvas'){el.context.getImageData=()=>({data:new Uint8ClampedArray([255,255,255,255])});el.snapshot=WHITE;}return el;};}
test('erase uses selected edit settings and exact candidate/mask without changing global source or generation negative',async()=>{
 const {ui,api}=await setup();ui.studio().setImageModelSettings({editModelId:'sdxl-base'});await ui.input('negative','generation-only');maskCanvas(ui);
 const before=ui.state(),opened=await api.begin('parent','erase');assert.equal(opened.imageSettingsSnapshot.model_id,'sdxl-base');
 const pending=api.apply(opened.token,{maskPng:WHITE});await until(()=>ui.requests.length,'erase POST');
 const request=ui.requests[0].body.request;assert.equal(request.mode,'inpaint');assert.equal(request.model_id,'sdxl-base');assert.equal(request.source,RED);assert.equal(request.mask,WHITE);assert.equal(request.negative,'');
 await ui.complete(0,BLUE);const done=await pending;const item=ui.state().project.versions.find(v=>v.id===done.candidateId);
 assert.equal(item.kind,'derived');assert.equal(item.derivation.operation,'erase');assert.equal(item.request.model_id,'sdxl-base');
 for(const key of ['sourceId','sourceDataURL','sourceRevision','maskRevision'])assert.deepEqual(ui.state()[key],before[key]);assert.equal(ui.element('negative').value,'generation-only');
});
test('cancel during erase POST keeps lock until late owned job receives one cancel ACK',async()=>{
 const {ui,api}=await setup();ui.studio().setImageModelSettings({editModelId:'sdxl-base'});maskCanvas(ui);
 const prior=ui.sandbox.fetch,ack=deferred();let canceled=0;
 ui.sandbox.fetch=(url,opts)=>String(url).endsWith('/cancel')?(++canceled,ack.promise):prior(url,opts);
 const opened=await api.begin('parent','erase'),pending=api.apply(opened.token,{maskPng:WHITE});await until(()=>ui.requests.length,'late POST');
 const discard=assert.rejects(pending);const cancel=api.cancel(opened.token);assert.equal(api.getState().locked,true);
 await ui.accept(0);await until(()=>canceled,'cancel');assert.equal(canceled,1);assert.equal(api.getState().locked,true);assert.equal(ui.state().project.versions.length,1);
 ack.resolve(ui.response({state:'canceled'}));await cancel;await discard;assert.equal(api.getState().active,false);assert.equal(ui.state().project.versions.length,1);
});
test('apply options are snapshotted before asynchronous hashing',async()=>{
 const {api,operations,result}=await setup(),opened=await api.begin('parent','resize');const options={width:1,height:1,keepAspect:true};
 const pending=api.apply(opened.token,options);options.width=999;await until(()=>operations.length,'immutable options');assert.equal(operations[0].body.options.width,1);result();await pending;
});
test('import rejects derived metadata which disagrees with real parent PNG/hash or output dimensions',async()=>{
 for(const field of ['sourceSha256','inputWidth','outputHeight']){
  const {ui,api,operations,result}=await setup(),opened=await api.begin('parent','background-remove');const pending=api.apply(opened.token,{});await until(()=>operations.length,'derived');result();await pending;
  const raw=JSON.parse(ui.studio().exportProject());raw.versions[1].derivation[field]=field==='sourceSha256'?'b'.repeat(64):2;
  assert.equal(await ui.studio().importProject(raw),false);
 }
});
test('failed erase cancel ACK remains locked and permits an honest retry',async()=>{
 const {ui,api}=await setup();ui.studio().setImageModelSettings({editModelId:'sdxl-base'});maskCanvas(ui);
 const prior=ui.sandbox.fetch;let attempts=0;
 ui.sandbox.fetch=(url,opts)=>String(url).endsWith('/cancel')?(++attempts===1?Promise.reject(Error('offline')):Promise.resolve(ui.response({state:'canceled'}))):prior(url,opts);
 const opened=await api.begin('parent','erase'),pending=api.apply(opened.token,{maskPng:WHITE});const discarded=assert.rejects(pending);await ui.accept(0);await until(()=>ui.polls.size,'poll');
 await assert.rejects(api.cancel(opened.token));assert.equal(api.getState().active,true);assert.equal(api.getState().locked,true);
 ui.polls.values().next().value.shift().resolve(ui.response({is_current:true,state:'canceled'}));await discarded;
 await api.cancel(opened.token);assert.equal(attempts,2);assert.equal(api.getState().active,false);assert.equal(ui.state().project.versions.length,1);
});
test('pinned edit prepares the selected natural circle as existing mask capability without a job',async()=>{
 const {ui,api}=await setup();const Base=ui.sandbox.Image;ui.sandbox.Image=class extends Base{constructor(){super();this.width=this.naturalWidth=100;this.height=this.naturalHeight=50;}};const arcs=[],create=ui.sandbox.document.createElement.bind(ui.sandbox.document);ui.sandbox.document.createElement=tag=>{const node=create(tag);if(tag==='canvas')node.context.arc=(...args)=>arcs.push(args);return node;};
 const opened=await api.begin('parent','comments');const before=ui.state(),paint=ui.element('paint'),draw=paint.context.drawImage;paint.context.drawImage=function(image){if(image.tagName==='CANVAS')this.draws.push(image.snapshot),paint.snapshot=image.snapshot;else draw.call(this,image);};paint.context.getImageData=()=>({data:paint.snapshot===WHITE?[255,255,255,255]:[0,0,0,255]});
 const prepared=await api.preparePinnedEdit(opened.token,{x:.5,y:.5,radius:.12});assert.equal(prepared.candidateId,'parent');assert.deepEqual(arcs[0],[50,25,6,0,Math.PI*2]);assert.equal(api.getState().active,false);assert.equal(ui.state().sourceId,'parent');assert.equal(ui.state().sourceDataURL,RED);assert.equal(paint.width,100);assert.equal(paint.height,50);assert.equal(paint.snapshot,WHITE);const capture=ui.studio().desktopChat.captureContext({intent:'auto',visibleCandidateId:'parent'});assert.equal(capture.automatic.edit.ready,true);assert.equal(capture.mask.dataUrl,WHITE);assert.equal(ui.requests.length,0);assert.equal(ui.cancellations.length,0);assert.equal(ui.state().project.versions[0].image,before.project.versions[0].image);
});
test('pinned edit rejects invalid ranges and stale async preparation without overwriting newer source or mask',async()=>{
 const {ui,api}=await setup(),opened=await api.begin('parent','comments'),before=ui.state();await assert.rejects(()=>api.preparePinnedEdit(opened.token,{x:2,y:0,radius:.12}));assert.equal(ui.state().sourceRevision,before.sourceRevision);const held=deferred(),Base=ui.sandbox.Image;let first=true;ui.sandbox.Image=class extends Base{decode(){if(first){first=false;return held.promise;}return super.decode();}};const pending=api.preparePinnedEdit(opened.token,{x:.5,y:.5,radius:.12});await settle();await api.cancel(opened.token);const newer=await api.begin('parent','markup');const snapshot=ui.state();held.resolve();await assert.rejects(pending,/바뀌|취소|다시/);assert.equal(ui.state().sourceRevision,snapshot.sourceRevision);assert.equal(ui.state().sourceDataURL,snapshot.sourceDataURL);assert.equal(api.getState().tool,'markup');await api.cancel(newer.token);
});
test('changing a prepared mask publishes a new revision so pin presentation cannot remain ready',async()=>{
 const {ui,api}=await setup(),opened=await api.begin('parent','comments');await api.preparePinnedEdit(opened.token,{x:.5,y:.5,radius:.12});let observed=ui.studio().desktopChat.getState().sourceRevision;const old=observed;ui.studio().subscribe(()=>observed=ui.studio().desktopChat.getState().sourceRevision);await ui.element('clearMask').click();assert.notEqual(observed,old);
});

test('202 CPU image operation polls its owned job once submitted and preserves exact PNG trace through serialized reopen',async()=>{
 const {ui,api,operations}=await setup({capabilities:require('../tests/fixtures/system-capabilities.json')}),opened=await api.begin('parent','resize'),pending=api.apply(opened.token,{width:1,height:1});await until(()=>operations.length,'submit');
 const id='c'.repeat(32),op=operations[0],execution={trace_id:op.body.trace_id,job_id:id,result_sha256:sha(BLUE),run_ref:'runs/'+id};
 op.resolve({ok:true,status:202,json:async()=>({ok:false,code:'in-progress',operationId:op.body.operationId,job_id:id,state:'queued'})});
 await until(()=>ui.polls.get(id)?.length,'owned CPU job poll');ui.polls.get(id)[0].resolve(ui.response({job_id:id,is_current:true,state:'succeeded',result:{ok:true,operationId:op.body.operationId,operation:'resize',image:{png:BLUE,sha256:sha(BLUE),width:1,height:1},metadata:{algorithm:'pillow',algorithmVersion:'1',parameters:{}},...execution}}));
 const result=await pending;assert.equal(operations.length,1);assert.equal(result.image,BLUE);
 const raw=ui.studio().exportProject(),saved=JSON.parse(raw).versions.at(-1);assert.equal(saved.image,BLUE);assert.equal(saved.execution.resultSha256,sha(saved.image));assert.equal(saved.execution.traceId,op.body.trace_id);
 assert.equal(await ui.studio().importProject(raw),true);assert.equal(ui.state().project.versions.at(-1).image,BLUE);assert.equal(ui.state().project.versions.at(-1).execution.runRef,'runs/'+id);
});
test('orphaned CPU operation is terminal with one POST and cannot create a candidate',async()=>{
 const {ui,api,operations}=await setup({capabilities:require('../tests/fixtures/system-capabilities.json')}),opened=await api.begin('parent','resize'),pending=api.apply(opened.token,{width:1,height:1});const rejected=assert.rejects(pending,/다시 시작|orphaned|상태/);await until(()=>operations.length,'submit');const id='d'.repeat(32),op=operations[0];
 op.resolve({ok:true,status:202,json:async()=>({ok:false,code:'in-progress',operationId:op.body.operationId,job_id:id,state:'queued'})});await until(()=>ui.polls.get(id)?.length,'poll orphan');ui.polls.get(id)[0].resolve(ui.response({job_id:id,is_current:true,state:'orphaned'}));await rejected;assert.equal(operations.length,1);assert.equal(ui.state().project.versions.length,1);
});

test('switching project during owned CPU 202 poll discards its late success without resubmission',async()=>{
 const {ui,api,operations}=await setup({capabilities:require('../tests/fixtures/system-capabilities.json')}),opened=await api.begin('parent','resize'),pending=api.apply(opened.token,{width:1,height:1}),rejected=assert.rejects(pending);await until(()=>operations.length,'POST');const id='f'.repeat(32),op=operations[0];
 op.resolve({ok:true,status:202,json:async()=>({ok:false,code:'in-progress',operationId:op.body.operationId,job_id:id,state:'queued'})});await until(()=>ui.polls.get(id)?.length,'CPU poll');
 assert.equal(await ui.studio().importProject(ui.project('New project',BLACK)),true);
 ui.polls.get(id)[0].resolve(ui.response({job_id:id,is_current:true,state:'succeeded',result:{ok:true,operationId:op.body.operationId,operation:'resize',image:{png:BLUE,sha256:sha(BLUE),width:1,height:1},metadata:{algorithm:'pillow',algorithmVersion:'1',parameters:{}}}}));await rejected;
 assert.equal(operations.length,1);assert.equal(ui.state().project.brief.name,'New project');assert.equal(ui.state().project.versions.length,1);assert.equal(ui.state().project.versions[0].image,BLACK);
});

test('legacy server image operation retains the exact historical wire fields',async()=>{
 const {api,operations,result}=await setup(),opened=await api.begin('parent','resize'),pending=api.apply(opened.token,{width:1,height:1});await until(()=>operations.length,'legacy operation');
 assert.deepEqual(Object.keys(operations[0].body).sort(),['operation','operationId','options','source','version']);result();await pending;
});

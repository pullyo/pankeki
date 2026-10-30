'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const filename=path.join(__dirname,'../../scripts/test_ui_state.cjs'),source=fs.readFileSync(filename,'utf8'),end=source.indexOf("\ntest('selected model preset reaches");
const harness=new Module(filename,module);harness.filename=filename;harness.paths=module.paths;
harness._compile(source.slice(0,end)+'\nmodule.exports={test,assert,page,until,WHITE,BLUE};',filename);
const {test,assert,page,until,WHITE,BLUE}=harness.exports,plain=value=>JSON.parse(JSON.stringify(value));
const catalog={default_model_id:'sdxl-base',models:[
 {id:'sdxl-base',label:'Base',available:true,defaults:{width:1024,height:1024,steps:25,cfg:6,denoise:.55,sampler:'dpmpp_2m',scheduler:'karras'}},
 {id:'sd-turbo',label:'Turbo',available:false,defaults:{width:512,height:512,steps:1,cfg:1,denoise:1,sampler:'euler',scheduler:'normal'}},
 {id:'animagine-xl-4.0-opt',label:'Animagine',available:true,recommended_negative:'lowres',defaults:{width:1024,height:1024,steps:28,cfg:5,denoise:1,sampler:'euler_ancestral',scheduler:'normal'}}
],edit_models:[{id:'sdxl-inpaint-v01',label:'Inpaint',available:true,defaults:{width:1024,height:1024,steps:25,cfg:6,denoise:.55,sampler:'dpmpp_2m',scheduler:'karras'}}]};
async function ready(options={}){const ui=page({catalog,...options});await until(()=>ui.studio().getSummary().modelsReady,'catalog');return ui;}
function mask(ui){ui.element('paint').getContext().getImageData=()=>({data:new Uint8ClampedArray([255,255,255,255])});ui.element('paint').snapshot=WHITE;}
const capture=(ui,id=null,style=null)=>ui.studio().desktopChat.captureContext({intent:'auto',visibleCandidateId:id,generationStyle:style});
const event=(context,type,payload)=>({requestId:'auto-request',projectId:context.projectId,sourceRevision:context.sourceRevision,type,payload});
test('auto capture keeps independent selected generation and masked-edit snapshots without changing mode or project',async()=>{
 const ui=await ready(),api=ui.studio();await api.importProject(ui.project());mask(ui);api.setImageModelSettings({generationModelId:'animagine-xl-4.0-opt',editModelId:'sdxl-inpaint-v01'});
 await ui.input('steps','19');await ui.input('cfg','7.5');const project=api.exportProject(),mode=ui.element('mode').value;
 const context=capture(ui,'parent',{id:'chibi',prompt:'Cute chibi character illustration.'});
 assert.equal(context.intent,'auto');assert.equal(context.automatic.generation.settings.model_id,'animagine-xl-4.0-opt');assert.equal(context.automatic.generation.settings.steps,19);
 assert.equal(context.automatic.edit.ready,true);assert.equal(context.automatic.edit.regenerate.settings.model_id,'sdxl-inpaint-v01');assert.equal(context.automatic.edit.regenerate.settings.steps,25);
 assert.equal(context.source.dataUrl,ui.state().sourceDataURL);assert.equal(context.mask.dataUrl,WHITE);assert.equal(Object.isFrozen(context.automatic),true);
 const text=api.desktopChat.formatMessage({text:'그림 스타일이 뭐야?',intent:'auto',context});assert.equal(text,'[Pankeki action: auto]\n그림 스타일이 뭐야?');assert(!text.includes('chibi'));
 assert.equal(api.exportProject(),project);assert.equal(ui.element('mode').value,mode);assert.equal(ui.requests.length,0);
});
test('auto capture never uses stale prepared G assets for visible F or infers an invisible latest target',async()=>{
 const ui=await ready(),api=ui.studio(),project=ui.project();project.versions.push({...project.versions[0],id:'G',image:BLUE,label:'G'});await api.importProject(project);mask(ui);
 const mismatch=capture(ui,'parent');assert.equal(mismatch.automatic.edit.ready,false);assert.equal(mismatch.automatic.edit.reason,'target');assert.equal(mismatch.source.dataUrl,project.versions[0].image);assert.notEqual(mismatch.source.dataUrl,BLUE);assert.equal(mismatch.automatic.recompose.ready,true);assert.equal(mismatch.mask,undefined);
 const none=capture(ui);assert.equal(none.automatic.edit.ready,false);assert.equal(none.automatic.edit.reason,'target');assert.equal(none.source,undefined);assert.equal(none.automatic.recompose.ready,false);assert.equal(none.automatic.recompose.reason,'source');
 assert.equal(ui.state().sourceId,'G');assert.equal(ui.element('paint').snapshot,WHITE);assert.equal(ui.requests.length,0);
});
test('normal uploaded source receives a candidate identity and enables CPU recolor without a regenerate model',async()=>{
 const ui=await ready(),pending=ui.upload('upload','blob:source',WHITE);await until(()=>ui.images.get('blob:source')?.length,'uploaded image decode');ui.decode('blob:source');await pending;mask(ui);const id=ui.state().sourceId;
 assert(id);assert.equal(ui.state().project.versions[0].kind,'upload');const context=capture(ui,id);
 assert.equal(context.automatic.edit.ready,true);assert.equal(context.automatic.edit.regenerate.ready,false);assert.equal(context.automatic.edit.regenerate.reason,'model');assert.equal(context.automatic.edit.feather,4);
 assert(context.source);assert(context.mask);assert.equal(ui.requests.length,0);
});
test('automatic intent binding is idempotent, rejects conflicting or pre-resolution results, and keeps the captured parent',async()=>{
 const ui=await ready(),api=ui.studio();await api.importProject(ui.project());mask(ui);api.setImageModelSettings({editModelId:'sdxl-inpaint-v01'});
 const context=capture(ui,'parent'),adapter=api.desktopChat;assert.equal(adapter.beginRequest({requestId:'auto-request',context}).accepted,true);
 assert.equal((await adapter.receiveEvent(event(context,'job',{jobId:'owned',state:'queued'}))).accepted,false,'unresolved metadata cannot register a job');
 assert.equal((await adapter.receiveEvent(event(context,'intent-resolved',{intent:'edit',operation:'regenerate'}))).accepted,true);
 assert.equal((await adapter.receiveEvent(event(context,'intent-resolved',{intent:'edit',operation:'regenerate'}))).accepted,true);
 assert.equal((await adapter.receiveEvent(event(context,'intent-resolved',{intent:'generate'}))).accepted,false);
 assert.equal((await adapter.receiveEvent(event(context,'job',{jobId:'owned',state:'queued'}))).accepted,true);
 assert.equal((await adapter.receiveEvent(event(context,'job',{jobId:'other',state:'queued'}))).accepted,false,'auto cannot register a second job');
 const settings=context.automatic.edit.regenerate.settings,request={...plain(ui.project().versions[0].request),...plain(settings),mode:'inpaint',edit_operation:'regenerate',feather:context.automatic.edit.feather};
 const output=await adapter.receiveEvent(event(context,'result',{jobId:'owned',imageDataUrl:BLUE,request,metrics:{model_calls:1}}));
 assert.equal(output.accepted,true);assert.equal(ui.state().project.versions.at(-1).parentId,'parent');assert.equal(ui.state().sourceId,'parent');assert.equal(ui.element('paint').snapshot,WHITE);
 adapter.endRequest({requestId:'auto-request'});assert.equal(ui.requests.length,0);
});
test('unready image settings do not prevent ordinary auto chat and subsequent real source changes reject late decisions',async()=>{
 const ui=await ready();await ui.input('steps','');const context=capture(ui);
 assert.equal(context.automatic.generation.ready,false);assert.equal(context.automatic.generation.reason,'settings');assert.equal(context.automatic.edit.ready,false);
 const adapter=ui.studio().desktopChat;assert.equal(adapter.beginRequest({requestId:'auto-request',context}).accepted,true);
 assert.equal((await adapter.receiveEvent(event(context,'intent-resolved',{intent:'chat'}))).accepted,true);adapter.endRequest({requestId:'auto-request'});
 await ui.studio().importProject(ui.project());mask(ui);const next=capture(ui,'parent');assert.equal(adapter.beginRequest({requestId:'auto-request',context:next}).accepted,true);
 await ui.studio().loadSource(WHITE,{parentId:'parent'});assert.equal((await adapter.receiveEvent(event(next,'intent-resolved',{intent:'edit',operation:'recolor'}))).accepted,false);
 adapter.endRequest({requestId:'auto-request'});assert.equal(ui.requests.length,0);
});

'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),vm=require('node:vm');
const filename=path.join(__dirname,'../../scripts/test_ui_state.cjs'),source=fs.readFileSync(filename,'utf8'),boundary=source.indexOf("\ntest('selected model preset reaches");
const harness=new Module(filename,module);harness.filename=filename;harness.paths=module.paths;
harness._compile(source.slice(0,boundary)+'\nmodule.exports={test,assert,page,until,WHITE,BLUE};',filename);
const {test,assert,page,until,WHITE,BLUE}=harness.exports;
async function fixture(options){const ui=page(options);await until(()=>ui.studio().getSummary().modelsReady,'catalog');return ui;}
const settings=message=>JSON.parse(/^\[Pankeki settings: (.*)\]$/.exec(message.split('\n')[1])[1]);
const IMAGE_MODEL_STORAGE_KEY='pankeki-image-model-settings-v1';
function modelStorage(initial){
  const values=new Map([['another-app-setting','keep']]),writes=[];
  if(initial!==undefined)values.set(IMAGE_MODEL_STORAGE_KEY,typeof initial==='string'?initial:JSON.stringify(initial));
  return {values,writes,getItem:key=>values.get(key)??null,setItem:(key,value)=>{writes.push({key,value});values.set(key,value);},removeItem:key=>values.delete(key)};
}
function imageSettingsApi(ui){
  const api=ui.studio();assert.equal(typeof api.getImageModelSettings,'function');assert.equal(typeof api.setImageModelSettings,'function');return api;
}
function editCatalog({dedicatedAvailable=true,turboAvailable=true}={}){
  return {default_model_id:'sdxl-base',models:[
    {id:'sdxl-base',label:'SDXL 1.0 Base',available:true,description:'Base',defaults:{width:1024,height:1024,steps:25,cfg:6,denoise:.55,sampler:'dpmpp_2m',scheduler:'karras'}},
    {id:'sd-turbo',label:'SD Turbo',available:turboAvailable,description:'Turbo',defaults:{width:512,height:512,steps:1,cfg:1,denoise:1,sampler:'euler',scheduler:'normal'}}
  ],edit_models:[{id:'sdxl-inpaint-v01',label:'SDXL Inpaint v0.1',available:dedicatedAvailable,description:'Dedicated inpaint',defaults:{width:1024,height:1024,steps:25,cfg:6,denoise:.55,sampler:'dpmpp_2m',scheduler:'karras'}}]};
}
function animagineCatalog(available=true){
  const catalog=editCatalog();catalog.models.push({id:'animagine-xl-4.0-opt',label:'Animagine XL 4.0 Opt',available,description:'생성 전용 · 영어 comma-tag 권장',supported_modes:['txt2img'],
    recommended_negative:'lowres, bad anatomy, bad hands, text, extra digits, missing fingers, worst quality, low quality, watermark, blurry',
    defaults:{width:1024,height:1024,steps:28,cfg:5,denoise:1,sampler:'euler_ancestral',scheduler:'normal'}});
  return catalog;
}
test('Animagine is generation-only and selection preserves values until the explicit preset is applied',async()=>{
  const ui=await fixture({catalog:animagineCatalog()}),api=imageSettingsApi(ui);
  for(const [key,value] of Object.entries({steps:'19',cfg:'7',seed:'123',negative:'custom negative',sampler:'dpmpp_2m',scheduler:'karras'}))ui.element(key).value=value;
  await ui.input('imageModel','animagine-xl-4.0-opt');
  assert.equal(api.getImageModelSettings().generation.selectedId,'animagine-xl-4.0-opt');
  for(const [key,value] of Object.entries({steps:'19',cfg:'7',seed:'123',negative:'custom negative',sampler:'dpmpp_2m',scheduler:'karras'}))assert.equal(ui.element(key).value,value,key);
  assert.equal(api.getImageModelSettings().edit.models.some(model=>model.id==='animagine-xl-4.0-opt'),false);
  assert.throws(()=>api.setImageModelSettings({editModelId:'animagine-xl-4.0-opt'}),error=>error.code==='IMAGE_MODEL_SETTINGS_INVALID');
  await ui.element('resetModelPreset').dispatchEvent(new ui.Event('click'));
  assert.equal(ui.element('steps').value,'28');assert.equal(ui.element('cfg').value,'5');assert.equal(ui.element('sampler').value,'euler_ancestral');assert.equal(ui.element('scheduler').value,'normal');
  assert.equal(ui.element('seed').value,'123');assert.match(ui.element('negative').value,/lowres/);
  const desktop=api.desktopChat,context=desktop.captureContext({intent:'generate'});
  const snapshot=settings(desktop.formatMessage({text:'1girl, red scarf',intent:'generate',context}));
  assert.equal(snapshot.model_id,'animagine-xl-4.0-opt');assert.equal(snapshot.steps,28);assert.equal(snapshot.sampler,'euler_ancestral');
  assert.match(snapshot.prompt,/red scarf/);assert.match(snapshot.prompt,/absurdres$/);
});
test('Animagine saved selection restores independently and never restores into the edit picker',async()=>{
  const storage=modelStorage({version:1,generationModelId:'animagine-xl-4.0-opt',editModelId:'sdxl-base'});
  const ui=await fixture({catalog:animagineCatalog(),localStorageImpl:storage}),api=imageSettingsApi(ui);
  assert.equal(api.getImageModelSettings().generation.selectedId,'animagine-xl-4.0-opt');
  assert.equal(api.getImageModelSettings().edit.selectedId,'sdxl-base');
  api.setMode('inpaint');assert.equal(ui.element('imageModel').children.some(option=>option.value==='animagine-xl-4.0-opt'),false);
  const missing=await fixture({catalog:animagineCatalog(false),localStorageImpl:storage});
  assert.equal(missing.studio().getImageModelSettings().generation.selectedId,'');assert.equal(missing.requests.length,0);
  const invalidEdit=await fixture({catalog:animagineCatalog(),localStorageImpl:modelStorage({version:1,generationModelId:'sdxl-base',editModelId:'animagine-xl-4.0-opt'})});
  assert.equal(invalidEdit.studio().getImageModelSettings().generation.selectedId,'sdxl-base');assert.equal(invalidEdit.studio().getImageModelSettings().edit.selectedId,'');
});
for(const restore of [false,true])test(`v1 ${restore?'restore':'import'} completion refreshes image model controls and the final subscriber busy state`,async()=>{
  const ui=await fixture({catalog:editCatalog()}),api=imageSettingsApi(ui);
  api.setImageModelSettings({generationModelId:'sd-turbo',editModelId:'sdxl-inpaint-v01'});
  const observed=[],unsubscribe=api.subscribe(summary=>observed.push({importing:summary.importing,busy:api.getImageModelSettings().busy,
    pickerDisabled:ui.element('imageModel').disabled,resetDisabled:ui.element('resetModelPreset').disabled}));
  assert.equal(await api.importProject(ui.project('Import controls',WHITE),{restore}),true);
  assert.equal(api.getSummary().importing,false);assert.equal(api.getImageModelSettings().busy,false);
  assert.equal(ui.element('imageModel').disabled,false);assert.equal(ui.element('resetModelPreset').disabled,false);
  assert(observed.some(value=>value.importing&&value.busy&&value.pickerDisabled&&value.resetDisabled));
  assert.deepEqual(observed.at(-1),{importing:false,busy:false,pickerDisabled:false,resetDisabled:false});
  assert.equal(ui.element('imageModel').value,'sd-turbo');assert.equal(api.getImageModelSettings().edit.selectedId,'sdxl-inpaint-v01');
  assert.equal(ui.state().sourceDataURL,WHITE);assert.equal(ui.requests.length,0);unsubscribe();
});
test('stale import finalization leaves a newer decoding import busy and its image model controls disabled',async()=>{
  const ui=await fixture({catalog:editCatalog()}),api=imageSettingsApi(ui);ui.heldImages.add(WHITE);ui.heldImages.add(BLUE);
  const older=api.importProject(ui.project('Old held import',WHITE));await until(()=>ui.images.get(WHITE)?.length,'old decode');
  const newer=api.importProject(ui.project('New held import',BLUE));await until(()=>ui.images.get(BLUE)?.length,'new decode');
  const observed=[],unsubscribe=api.subscribe(summary=>observed.push({importing:summary.importing,busy:api.getImageModelSettings().busy}));
  ui.decode(WHITE);assert.equal(await older,false);
  assert.equal(api.getSummary().importing,true);assert.equal(api.getImageModelSettings().busy,true);
  assert.equal(ui.element('imageModel').disabled,true);assert.equal(ui.element('resetModelPreset').disabled,true);
  assert(observed.every(value=>value.importing&&value.busy),'the stale finalizer must not publish an idle state');
  ui.decode(BLUE);assert.equal(await newer,true);
  assert.equal(ui.state().project.brief.name,'New held import');assert.equal(ui.state().sourceDataURL,BLUE);
  assert.equal(api.getImageModelSettings().busy,false);assert.equal(ui.element('imageModel').disabled,false);
  assert.deepEqual(observed.at(-1),{importing:false,busy:false});unsubscribe();
});
test('image settings getter exposes actual mode capabilities, readiness and independent immutable snapshots',async()=>{
  const ui=page({catalog:editCatalog({turboAvailable:false})}),api=imageSettingsApi(ui);
  assert.equal(api.getImageModelSettings().ready,false);
  await until(()=>api.getImageModelSettings().ready,'image settings catalog');
  const value=api.getImageModelSettings();assert.equal(value.busy,false);assert.equal(value.error,'');
  assert.equal(value.generation.selectedId,'sdxl-base');assert.equal(value.edit.selectedId,'');
  assert.deepEqual(Array.from(value.generation.models,model=>model.id),['sdxl-base','sd-turbo']);
  assert.deepEqual(Array.from(value.edit.models,model=>model.id),['sdxl-base','sd-turbo','sdxl-inpaint-v01']);
  const missing=value.edit.models.find(model=>model.id==='sd-turbo');assert.equal(missing.available,false);assert.match(missing.reason,/미설치|사용/);
  assert.equal(Object.isFrozen(value),true);assert.equal(Object.isFrozen(value.edit.models[0]),true);
  assert.throws(()=>{value.edit.models[0].label='changed';});assert.notEqual(api.getImageModelSettings().edit.models[0].label,'changed');
});
test('image settings setter updates both selections without changing mode, project, images, mask or user settings',async()=>{
  const storage=modelStorage(),ui=await fixture({catalog:editCatalog(),localStorageImpl:storage}),api=imageSettingsApi(ui);
  await api.importProject(ui.project());ui.element('paint').snapshot=WHITE;ui.element('denoise').value='0.75';ui.element('steps').value='19';
  const before=ui.state(),project=api.exportProject(),dimensions=[ui.element('source').width,ui.element('source').height];
  const reasons=[],unsubscribe=api.subscribe((_summary,reason)=>reasons.push(reason));
  const result=api.setImageModelSettings({generationModelId:'sd-turbo',editModelId:'sdxl-inpaint-v01'});
  assert.equal(result.generation.selectedId,'sd-turbo');assert.equal(result.edit.selectedId,'sdxl-inpaint-v01');
  assert.equal(ui.element('mode').value,'txt2img');assert.equal(ui.element('imageModel').value,'sd-turbo');
  assert.deepEqual(ui.state(),before);assert.equal(api.exportProject(),project);
  assert.deepEqual([ui.element('source').width,ui.element('source').height],dimensions);assert.equal(ui.element('paint').snapshot,WHITE);
  assert.equal(ui.element('denoise').value,'0.75');assert.equal(ui.element('steps').value,'19');assert(reasons.includes('image-model-settings'));
  api.setMode('inpaint');assert.equal(ui.element('imageModel').value,'sdxl-inpaint-v01');
  await ui.input('imageModel','sdxl-base');assert.equal(api.getImageModelSettings().edit.selectedId,'sdxl-base');
  assert.equal(api.getImageModelSettings().generation.selectedId,'sd-turbo');
  const stored=JSON.parse(storage.values.get(IMAGE_MODEL_STORAGE_KEY)),{generationSettings,...selection}=stored;
  assert.deepEqual(selection,{version:1,generationModelId:'sd-turbo',editModelId:'sdxl-base'});
  assert.equal(generationSettings.steps,19);assert.equal(generationSettings.denoise,.75,'edit-mode preset must not replace the generation snapshot');
  assert.equal(storage.values.get('another-app-setting'),'keep');assert(storage.writes.every(write=>write.key===IMAGE_MODEL_STORAGE_KEY));
  assert.equal(ui.requests.length,0);unsubscribe();
});
test('image settings validation rejects unavailable or mode-invalid values atomically and never substitutes Base',async()=>{
  const storage=modelStorage(),ui=await fixture({catalog:editCatalog({dedicatedAvailable:false}),localStorageImpl:storage}),api=imageSettingsApi(ui);
  const before=JSON.stringify(api.getImageModelSettings()),writes=storage.writes.length;
  for(const [patch,code] of [
    [{generationModelId:'sd-turbo',editModelId:'sdxl-inpaint-v01'},'IMAGE_MODEL_UNAVAILABLE'],
    [{generationModelId:'sdxl-inpaint-v01'},'IMAGE_MODEL_SETTINGS_INVALID'],
    [{editModelId:'unknown'},'IMAGE_MODEL_SETTINGS_INVALID'],[{editModelId:''},'IMAGE_MODEL_SETTINGS_INVALID'],
    [{other:'sd-turbo'},'IMAGE_MODEL_SETTINGS_INVALID'],[null,'IMAGE_MODEL_SETTINGS_INVALID'],[[],'IMAGE_MODEL_SETTINGS_INVALID']
  ]){
    assert.throws(()=>api.setImageModelSettings(patch),error=>error.code===code,JSON.stringify(patch));
    assert.equal(JSON.stringify(api.getImageModelSettings()),before);assert.equal(storage.writes.length,writes);
  }
  assert.equal(api.setImageModelSettings({}).generation.selectedId,'sdxl-base');
});
test('image settings reject both public and context-picker changes during an accepted image request or desktop turn',async()=>{
  const ui=await fixture({catalog:editCatalog()}),api=imageSettingsApi(ui);ui.element('candidateCount').value='1';
  const pending=api.generate();await until(()=>ui.requests.length===1,'image POST');
  assert.equal(api.getImageModelSettings().busy,true);
  assert.throws(()=>api.setImageModelSettings({generationModelId:'sd-turbo'}),error=>error.code==='IMAGE_MODELS_BUSY');
  await ui.input('imageModel','sd-turbo');assert.equal(ui.element('imageModel').value,'sdxl-base');
  assert.equal(api.getImageModelSettings().generation.selectedId,'sdxl-base');
  await ui.complete(0,BLUE);assert.equal(await pending,true);assert.equal(api.getImageModelSettings().busy,false);
  const events=[],unsubscribe=api.subscribe(()=>events.push(api.getImageModelSettings().busy)),context=api.desktopChat.captureContext({intent:'chat'});
  assert.equal(api.desktopChat.beginRequest({requestId:'settings_busy',context}).accepted,true);assert.equal(api.getImageModelSettings().busy,true);
  assert.throws(()=>api.setImageModelSettings({editModelId:'sdxl-inpaint-v01'}),error=>error.code==='IMAGE_MODELS_BUSY');
  api.desktopChat.endRequest({requestId:'settings_busy'});assert.equal(api.getImageModelSettings().busy,false);
  assert(events.includes(true));assert.equal(events.at(-1),false);unsubscribe();
});
test('image model IDs restore from the app-only storage after a new page validates its catalog',async()=>{
  const storage=modelStorage(),ui=await fixture({catalog:editCatalog(),localStorageImpl:storage}),api=imageSettingsApi(ui);
  api.setImageModelSettings({generationModelId:'sd-turbo',editModelId:'sdxl-inpaint-v01'});
  const restored=await fixture({catalog:editCatalog(),localStorageImpl:storage}),next=imageSettingsApi(restored),result=next.getImageModelSettings();
  assert.equal(result.generation.selectedId,'sd-turbo');assert.equal(result.edit.selectedId,'sdxl-inpaint-v01');
  assert.equal(restored.element('mode').value,'txt2img');assert.equal(restored.element('imageModel').value,'sd-turbo');
  next.setMode('inpaint');assert.equal(restored.element('imageModel').value,'sdxl-inpaint-v01');assert.equal(restored.requests.length,0);
});
test('invalid saved image settings are rejected against current capability and availability without default substitution',async()=>{
  for(const [stored,expectedGeneration,expectedEdit] of [
    [{version:1,generationModelId:'sdxl-inpaint-v01',editModelId:'sdxl-base'},'','sdxl-base'],
    [{version:1,generationModelId:'sd-turbo',editModelId:'sdxl-base'},'','sdxl-base'],
    [{version:1,generationModelId:'sdxl-base',editModelId:'sdxl-inpaint-v01'},'sdxl-base',''],
    ['{broken','',''],[{version:2,generationModelId:'sdxl-base',editModelId:''},'','']
  ]){
    const ui=await fixture({catalog:editCatalog({turboAvailable:false,dedicatedAvailable:false}),localStorageImpl:modelStorage(stored)}),api=imageSettingsApi(ui),value=api.getImageModelSettings();
    assert.equal(value.generation.selectedId,expectedGeneration);assert.equal(value.edit.selectedId,expectedEdit);
    if(!expectedGeneration)assert.match(value.generation.reason,/저장|선택/);
    if(!expectedEdit)assert.match(value.edit.reason,/저장|선택/);
    if(!expectedGeneration){assert.equal(await api.generate(),false);assert.equal(ui.requests.length,0);assert.equal(ui.element('imageModel').value,'');}
  }
});
test('image settings remain usable in memory when localStorage access is blocked, while catalog failure is explicit',async()=>{
  const ui=await fixture({catalog:editCatalog(),localStorageImpl:{getItem(){throw Error('read denied');},setItem(){throw Error('write denied');}}}),api=imageSettingsApi(ui);
  assert.match(api.getImageModelSettings().persistenceError,/저장|기억/);
  const result=api.setImageModelSettings({editModelId:'sdxl-inpaint-v01'});assert.equal(result.edit.selectedId,'sdxl-inpaint-v01');assert.match(result.persistenceError,/저장|기억/);
  const offline=page({catalog:null}),blocked=imageSettingsApi(offline);await until(()=>blocked.getImageModelSettings().error,'catalog error');
  assert.equal(blocked.getImageModelSettings().ready,false);
  assert.throws(()=>blocked.setImageModelSettings({generationModelId:'sdxl-base'}),error=>error.code==='IMAGE_MODELS_NOT_READY');
});
test('generation Base and Turbo selections each survive independent explicit edit model roundtrips',async()=>{
  for(const generationId of ['sdxl-base','sd-turbo']){
    const ui=await fixture({catalog:editCatalog()});await ui.input('imageModel',generationId);
    assert.equal(ui.element('imageModel').children.some(option=>option.value==='sdxl-inpaint-v01'),false);
    ui.studio().setMode('inpaint');
    assert.equal(ui.element('imageModel').value,'','first edit entry requires explicit selection');
    await ui.input('imageModel','sdxl-inpaint-v01');
    ui.studio().setMode('txt2img');assert.equal(ui.element('imageModel').value,generationId);
    assert.equal(ui.element('imageModel').children.some(option=>option.value==='sdxl-inpaint-v01'),false);
    ui.studio().setMode('inpaint');assert.equal(ui.element('imageModel').value,'sdxl-inpaint-v01');
  }
});
test('unavailable dedicated edit model is visible only for inpaint, disabled, and never silently replaced',async()=>{
  const ui=await fixture({catalog:editCatalog({dedicatedAvailable:false})});ui.studio().setMode('inpaint');
  const option=ui.element('imageModel').children.find(entry=>entry.value==='sdxl-inpaint-v01');
  assert.ok(option);assert.equal(option.disabled,true);assert.equal(ui.element('imageModel').value,'');
  await ui.input('imageModel','sdxl-inpaint-v01');assert.match(ui.element('status').textContent,/미설치|사용/);
  assert.equal(await ui.studio().generate(),false);
  assert.equal(ui.requests.length,0);assert.equal(ui.element('imageModel').value,'','rejection retains the prior empty edit selection');
});
test('dedicated model keeps custom settings, disables cache, and restores the generation cache choice on return',async()=>{
  for(const cache of [true,false]){
    const ui=await fixture({catalog:editCatalog()});ui.element('cache').checked=cache;
    const generationDenoise=ui.element('denoise').value,generationSteps=ui.element('steps').value;
    ui.studio().setMode('inpaint');ui.element('denoise').value='0.75';ui.element('steps').value='19';
    await ui.input('imageModel','sdxl-inpaint-v01');
    assert.equal(ui.element('cache').checked,false);assert.equal(ui.element('cache').disabled,true);
    ui.studio().setMode('txt2img');
    assert.equal(ui.element('cache').checked,cache);assert.equal(ui.element('cache').disabled,false);
    assert.equal(ui.element('denoise').value,generationDenoise);assert.equal(ui.element('steps').value,generationSteps);
    ui.studio().setMode('inpaint');assert.equal(ui.element('imageModel').value,'sdxl-inpaint-v01');
    assert.equal(ui.element('denoise').value,'0.75');assert.equal(ui.element('steps').value,'19');
    assert.equal(ui.element('cache').checked,false);assert.equal(ui.element('cache').disabled,true);
    await ui.element('resetModelPreset').click();
    assert.equal(ui.element('denoise').value,'0.55');assert.equal(ui.element('steps').value,'25');
  }
});
test('explicit dedicated edit submits its ID, entered strength and cache false, with exact candidate lineage roundtrip',async()=>{
  const ui=await fixture({autoJobs:true,catalog:editCatalog()});await ui.studio().importProject(ui.project('Keep source',WHITE));
  ui.studio().setMode('inpaint');
  ui.element('candidateCount').value='1';ui.element('denoise').value='0.75';ui.element('seed').value='73';
  ui.element('steps').value='19';ui.element('cfg').value='5';ui.element('width').value='768';ui.element('height').value='512';
  ui.element('paint').snapshot=WHITE;
  const before=ui.state(),beforeCanvas=[ui.element('source').width,ui.element('source').height],brief=JSON.stringify(before.project.brief);
  await ui.input('imageModel','sdxl-inpaint-v01');
  assert.equal(ui.element('denoise').value,'0.75');assert.equal(ui.element('seed').value,'73');
  assert.equal(ui.element('steps').value,'19');assert.equal(ui.element('cfg').value,'5');
  assert.equal(ui.element('width').value,'768');assert.equal(ui.element('height').value,'512');
  ui.element('cache').checked=true; // Snapshot must enforce the dedicated model contract independently of the checkbox.
  assert.equal(await ui.studio().generate(),true);
  const request=ui.requests[0].body.request;
  assert.equal(request.model_id,'sdxl-inpaint-v01');assert.equal(request.mode,'inpaint');assert.equal(request.denoise,.75);assert.equal(request.cache,false);
  assert.equal(ui.state().sourceDataURL,before.sourceDataURL);assert.deepEqual([ui.element('source').width,ui.element('source').height],beforeCanvas);
  assert.equal(JSON.stringify(ui.state().project.brief),brief);
  const saved=JSON.parse(ui.studio().exportProject()),candidate=saved.versions.at(-1);
  assert.equal(candidate.request.model_id,'sdxl-inpaint-v01');assert.equal(candidate.request.denoise,.75);assert.equal(candidate.parentId,'parent');
  const parsed=ui.sandbox.CharacterDesign.parseProject(JSON.stringify(saved));assert.equal(parsed.versions.at(-1).request.model_id,'sdxl-inpaint-v01');
  assert.equal(parsed.versions.at(-1).request.denoise,.75);assert.equal(parsed.versions.at(-1).parentId,'parent');
  const card=ui.element('gallery').children.find(entry=>entry.dataset.candidateId===candidate.id);
  assert.match(card.textContent,/SDXL Inpaint v0\.1/);assert.doesNotMatch(card.textContent,/SD Turbo/);
  assert.equal(ui.sandbox.CharacterDesign.parseProject(JSON.stringify(ui.project())).versions[0].request.mode,'txt2img');
});
test('dedicated selection is rejected for actual txt2img intent before any POST even while the visible mode is inpaint',async()=>{
  const ui=await fixture({catalog:editCatalog()});await ui.studio().importProject(ui.project());ui.studio().setMode('inpaint');
  await ui.input('imageModel','sdxl-inpaint-v01');
  const api=ui.studio().desktopChat,context=api.captureContext({intent:'generate'});
  assert.throws(()=>api.formatMessage({text:'A single umbrella',intent:'generate',context}),/모델|model/i);
  ui.element('mode').value='txt2img';assert.equal(await ui.studio().generate(),false);assert.equal(ui.requests.length,0);
});
test('unavailable Turbo remains invalid in edit mode instead of falling back to Base',async()=>{
  const ui=await fixture({catalog:editCatalog({turboAvailable:false})});ui.studio().setMode('inpaint');
  const option=ui.element('imageModel').children.find(entry=>entry.value==='sd-turbo');assert.equal(option.disabled,true);
  await ui.input('imageModel','sd-turbo');assert.match(ui.element('status').textContent,/미설치|사용/);
  assert.equal(await ui.studio().generate(),false);
  assert.equal(ui.element('imageModel').value,'');assert.equal(ui.requests.length,0);
});
test('recolor still submits through its existing CPU request without selecting an image model',async()=>{
  const ui=await fixture({autoJobs:true,catalog:editCatalog()});await ui.studio().importProject(ui.project());ui.studio().setMode('inpaint');
  ui.element('editOperation').value='recolor';ui.element('targetColorValue').value='#00AAFF';ui.element('sourceColorMode').value='auto';
  ui.element('colorTolerance').value='35';ui.element('feather').value='4';ui.element('paint').snapshot=WHITE;
  assert.equal(await ui.studio().generate(),true);
  assert.equal(ui.requests[0].body.request.edit_operation,'recolor');assert.equal(ui.requests[0].body.request.model_id,undefined);
});
test('AI generation uses only the entered description even with enabled character brief and palette',async()=>{
  for(const text of ['빨간 사과 한 개','A single blue umbrella on a plain white background']){
    const ui=await fixture();await ui.studio().importProject(ui.project('Manual character brief'));
    const api=ui.studio().desktopChat;
    assert.equal(ui.element('useBrief').checked,true);
    const context=api.captureContext({intent:'generate'});
    const request=settings(api.formatMessage({text,intent:'generate',context}));
    assert.equal(request.prompt,text);assert.equal(request.mode,'txt2img');
  }
});
test('AI formatting preserves the original project brief, palette, UI and edit snapshot',async()=>{
  const ui=await fixture();await ui.studio().importProject(ui.project('Preserved manual project'));
  const api=ui.studio().desktopChat,context=api.captureContext({intent:'generate'});
  const before=ui.studio().exportProject();
  const fields=['profile','prompt','brief','appearance','detail','palette1','palette2','palette3'];
  const values=fields.map(key=>ui.element(key).value);
  api.formatMessage({text:'A single red apple',intent:'generate',context});
  assert.equal(ui.studio().exportProject(),before);
  assert.deepEqual(fields.map(key=>ui.element(key).value),values);
  assert.equal(ui.element('useBrief').checked,true);
  assert.equal(api.getState().sourceRevision,context.sourceRevision);
  assert.equal(ui.requests.length,0);
});
test('manual generation still applies its enabled character brief after an AI formatting call',async()=>{
  const ui=await fixture({autoJobs:true});await ui.studio().importProject(ui.project('Manual flow'));
  await ui.input('prompt','manual red scarf character');
  const api=ui.studio().desktopChat,context=api.captureContext({intent:'generate'});
  api.formatMessage({text:'A single blue umbrella',intent:'generate',context});
  assert.equal(await ui.studio().generate(),true);
  const prompt=ui.requests[0].body.request.prompt;
  assert.match(prompt,/manual red scarf character/);
  assert.match(prompt,/A brave forest guardian/);
  assert.match(prompt,/round ears/);assert.match(prompt,/large scarf/);
  assert.match(prompt,/Suggested palette: #112233, #445566, #778899/);
  assert.doesNotMatch(prompt,/single blue umbrella/);
});
test('AI edit keeps the entered edit prompt and selected settings without brief or asset leakage',async()=>{
  const ui=await fixture();await ui.studio().importProject(ui.project('Edit brief'));
  ui.element('paint').getContext().getImageData=()=>({data:new Uint8ClampedArray([255,255,255,255])});ui.element('paint').snapshot=WHITE;
  for(const [key,value] of Object.entries({seed:'23',steps:'7',cfg:'3',denoise:'0.45',width:'256',height:'256',sampler:'euler',scheduler:'normal'}))ui.element(key).value=value;
  const api=ui.studio().desktopChat,context=api.captureContext({intent:'edit',includeEditAssets:true}),before=ui.studio().exportProject();
  const request=settings(api.formatMessage({text:'Change only the scarf to blue',intent:'edit',context}));
  assert.equal(request.prompt,'Change only the scarf to blue');assert.equal(request.mode,'inpaint');
  assert.equal(request.seed,23);assert.equal(request.steps,7);assert.equal(request.cfg,3);assert.equal(request.denoise,.45);
  assert.equal(request.width,256);assert.equal(request.height,256);assert.equal(request.sampler,'euler');assert.equal(request.scheduler,'normal');
  assert.equal(request.source,undefined);assert.equal(request.mask,undefined);
  assert.equal(ui.studio().exportProject(),before);assert.equal(ui.element('useBrief').checked,true);
});
test('real app formatter uses selected validated settings and excludes notes/images/project',async()=>{
  const ui=await fixture(),adapter=ui.studio().desktopChat;
  ui.element('notes').value='/private/secret do not send';ui.element('useBrief').checked=false;ui.element('seed').value='17';
  ui.element('width').value='768';ui.element('height').value='512';
  const context=adapter.captureContext({intent:'generate'}),text='노란 머플러 캐릭터';
  const message=adapter.formatMessage({text,intent:'generate',context});
  assert.equal(message.split('\n')[0],'[Pankeki action: generate]');assert.equal(message.split('\n').at(-1),text);
  const request=settings(message);assert.equal(request.mode,'txt2img');assert.equal(request.seed,17);assert.equal(request.width,768);assert.equal(request.prompt,text);
  assert.equal(JSON.stringify(request).includes('secret'),false);assert.equal(JSON.stringify(request).includes('data:image'),false);assert.equal(request.notes,undefined);
  assert.equal(ui.requests.length,0);
});
test('edit intent normalizes inpaint without mutating current workspace or leaking source/mask',async()=>{
  const ui=await fixture();await ui.studio().importProject(ui.project());
  ui.element('paint').getContext().getImageData=()=>({data:new Uint8ClampedArray([255,255,255,255])});ui.element('paint').snapshot=WHITE;
  const api=ui.studio().desktopChat,context=api.captureContext({intent:'edit',includeEditAssets:true}),before=ui.studio().getSummary().mode;
  const value=settings(api.formatMessage({text:'머플러를 노란색으로',intent:'edit',context}));
  assert.equal(value.mode,'inpaint');assert.equal(value.source,undefined);assert.equal(value.mask,undefined);assert.equal(ui.studio().getSummary().mode,before);
});
test('stale mask snapshots and invalid samplers cannot be formatted into an image request',async()=>{
  const ui=await fixture(),api=ui.studio().desktopChat;const context=api.captureContext({intent:'generate'});
  await ui.element('clearMask').click();assert.throws(()=>api.formatMessage({text:'image',intent:'generate',context}),/바뀌|상태/);
  const fresh=api.captureContext({intent:'generate'});ui.element('sampler').value='unsafe_sampler';
  assert.throws(()=>api.formatMessage({text:'image',intent:'generate',context:fresh}),/sampler|scheduler/);
});
test('v3 replacement entry point invalidates the old desktop project snapshot',async()=>{
  const ui=await fixture(),api=ui.studio().desktopChat,before=api.getState();
  vm.runInContext('authoringV3={getSummary:()=>({loaded:false}),loadDocument:async()=>false}',ui.sandbox);
  await ui.studio().importProject({version:3,format:'pankeki-authoring'});assert.notEqual(api.getState().sourceRevision,before.sourceRevision);
});
for(const modelId of ['sdxl-base','animagine-xl-4.0-opt'])test('real bridge descriptor resolves and saves one candidate through app adapter: '+modelId,async t=>{
  const os=require('node:os'),{spawn}=require('node:child_process');
  const {createCodexBridge}=require('../codex-bridge.cjs'),{createResultResolver}=require('../result-resolver.cjs');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pankeki-cross-adapter-'));
  const fake=path.join(__dirname,'codex-bridge-fake-server.cjs');
  let done;const completed=new Promise(resolve=>{done=resolve;});
  const bridge=createCodexBridge({projectRoot:path.resolve(__dirname,'../..'),codexPath:'/fake/codex',dataDir:temp,inputRoot:path.join(temp,'inputs'),mcpStateDir:path.join(temp,'state'),
    onEvent:event=>{if(event.type==='turn-completed')done();},
    spawnImpl:(_command,args,options)=>spawn(process.execPath,[fake,...args],{...options,env:{...options.env,FAKE_SCENARIO:modelId==='animagine-xl-4.0-opt'?'animagine':'generate',FAKE_LOG:path.join(temp,'fake.log')}}),
    mcpCommand:({state})=>({command:'fake-mcp',args:['--mcp','--state',state],env:{}})});
  t.after(async()=>{await bridge.close();fs.rmSync(temp,{recursive:true,force:true});});
  const ui=await fixture({catalog:animagineCatalog()});await ui.input('imageModel',modelId);ui.element('useBrief').checked=false;ui.element('seed').value='7';ui.element('cache').checked=false;
  if(modelId==='animagine-xl-4.0-opt'){await ui.element('resetModelPreset').dispatchEvent(new ui.Event('click'));ui.element('negative').value='custom';}
  const api=ui.studio().desktopChat,context=api.captureContext({intent:'generate'}),requestId='cross_1';
  assert.equal(api.beginRequest({requestId,context}).accepted,true);await bridge.connect();
  await bridge.send({requestId,projectId:context.projectId,context:{sourceRevision:context.sourceRevision},text:api.formatMessage({text:'cat girl',intent:'generate',context})});
  await completed;
  const query={requestId,projectId:context.projectId,sourceRevision:context.sourceRevision,jobId:'a'.repeat(32),resultId:'a'.repeat(32)};
  assert.equal(bridge.getResultDescriptor(query).state,'succeeded');
  const resolver=createResultResolver({bridge,origin:'http://127.0.0.1:8190',verifyBackend:async()=>true,decode:()=>({width:1,height:1}),fetchImpl:async url=>url.includes('/api/jobs/')?
    new Response(JSON.stringify({job_id:query.jobId,state:'succeeded',is_current:true,result:{image_url:'/api/results/'+query.resultId,metrics:{model_calls:1}}})):
    new Response(Buffer.from(BLUE.split(',')[1],'base64'),{headers:{'content-type':'image/png'}})});
  const output=await resolver.resolveResult(query);
  assert.equal(output.request.cache,false);assert.equal(output.request.mode,'txt2img');
  assert.equal(output.request.model_id,modelId);
  if(modelId==='animagine-xl-4.0-opt'){assert.equal(output.request.sampler,'euler_ancestral');assert.equal(output.request.steps,28);assert.equal(output.request.negative,'custom');}
  await api.receiveEvent({...query,type:'job',payload:{jobId:query.jobId,state:'succeeded'}});
  assert.equal((await api.receiveEvent({...query,type:'result',payload:{jobId:query.jobId,...output}})).accepted,true);
  assert.equal(ui.state().project.versions.length,1);assert.equal(ui.requests.length,0);
  assert.equal(ui.sandbox.CharacterDesign.parseProject(ui.studio().exportProject()).versions[0].request.model_id,modelId);
});


test('server capability matrix drives UI choices, automatic selected model and honest blocked reasons',async()=>{
  const Design=require('../../web/src/profiles.js'),caps=JSON.parse(JSON.stringify(require('../../tests/fixtures/system-capabilities.json')));
  caps.models.find(v=>v.id==='sdxl-base').operations=caps.models.find(v=>v.id==='sdxl-base').operations.filter(id=>id!=='regenerate');
  caps.operations.find(v=>v.id==='regenerate').model_ids=caps.operations.find(v=>v.id==='regenerate').model_ids.filter(id=>id!=='sdxl-base');
  caps.revision=Design.capabilityRevision(caps);
  const ui=await fixture({capabilities:caps}),api=ui.studio(),settings=api.getImageModelSettings();
  assert.equal(settings.source,'snapshot');assert.equal(settings.revision,caps.revision);
  assert.equal(settings.edit.models.some(v=>v.id==='sdxl-base'),false);
  assert.equal(settings.generation.models.find(v=>v.id==='sd-turbo').available,false);
  assert.equal(api.desktopChat.captureContext({intent:'auto'}).automatic.capabilityRevision,caps.revision);
  const blocked=JSON.parse(JSON.stringify(caps));blocked.operations.find(v=>v.id==='generate').ready=false;blocked.operations.find(v=>v.id==='generate').reason='fixture service unavailable';blocked.revision=Design.capabilityRevision(blocked);
  const offline=await fixture({capabilities:blocked});assert.equal(offline.element('generate').disabled,true);
  assert.match(offline.studio().getImageModelSettings().generation.models[0].reason,/fixture service unavailable/);
  assert.equal(offline.studio().desktopChat.captureContext({intent:'auto'}).automatic.generation.ready,false);
});
test('old server fallback is explicit while malformed capability response cannot silently claim readiness',async()=>{
  const ui=await fixture();assert.equal(ui.studio().getImageModelSettings().source,'legacy');assert.match(ui.studio().getImageModelSettings().capabilityReason,/legacy/i);assert.match(ui.element('imageModelHelp').textContent,/legacy/i);
  const broken=page({capabilities:{schema:2,revision:'a'.repeat(64),models:[],operations:[]}});await until(()=>broken.element('imageModelHelp').textContent.includes('revision'),'reject snapshot');assert.equal(broken.studio().getSummary().modelsReady,false);
});

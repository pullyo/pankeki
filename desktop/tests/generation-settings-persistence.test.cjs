'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const filename=path.join(__dirname,'../../scripts/test_ui_state.cjs'),source=fs.readFileSync(filename,'utf8'),boundary=source.indexOf("\ntest('selected model preset reaches");
const harness=new Module(filename,module);harness.filename=filename;harness.paths=module.paths;
harness._compile(source.slice(0,boundary)+'\nmodule.exports={test,assert,page,until,deferred,settle,WHITE};',filename);
const {test,assert,page,until,deferred,settle,WHITE}=harness.exports;
const KEY='pankeki-image-model-settings-v1';
const negative='lowres, bad anatomy, bad hands, text, extra digits, missing fingers, worst quality, low quality, watermark, blurry';
const catalog={default_model_id:'sdxl-base',models:[
  {id:'sdxl-base',label:'Base',available:true,defaults:{width:1024,height:1024,steps:25,cfg:6,denoise:.55,sampler:'dpmpp_2m',scheduler:'karras'}},
  {id:'sd-turbo',label:'Turbo',available:false,defaults:{width:512,height:512,steps:1,cfg:1,denoise:1,sampler:'euler',scheduler:'normal'}},
  {id:'animagine-xl-4.0-opt',label:'Animagine',available:true,supported_modes:['txt2img'],recommended_negative:negative,
    defaults:{width:1024,height:1024,steps:28,cfg:5,denoise:1,sampler:'euler_ancestral',scheduler:'normal'}}
],edit_models:[{id:'sdxl-inpaint-v01',label:'Inpaint',available:true,defaults:{width:1024,height:1024,steps:25,cfg:6,denoise:.55,sampler:'dpmpp_2m',scheduler:'karras'}}]};
function storage(value){const values=new Map(value===undefined?[]:[[KEY,typeof value==='string'?value:JSON.stringify(value)]]);return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};}
async function ready(options={}){const ui=page({catalog,...options});await until(()=>ui.studio().getImageModelSettings().ready,'catalog');return ui;}
function fields(ui){return Object.fromEntries(['width','height','seed','steps','cfg','denoise','negative','sampler','scheduler','candidateCount'].map(id=>[id,ui.element(id).value]).concat([['cache',ui.element('cache').checked],['previewOn',ui.element('previewOn').checked]]));}
test('Animagine explicit preset survives a new page instead of reverting to HTML 512/1/1 defaults',async()=>{
  const localStorageImpl=storage(),first=await ready({localStorageImpl});
  await first.input('imageModel','animagine-xl-4.0-opt');await first.element('resetModelPreset').click();
  const expected=fields(first),second=await ready({localStorageImpl});
  assert.equal(second.studio().getImageModelSettings().generation.selectedId,'animagine-xl-4.0-opt');
  assert.deepEqual(fields(second),expected);
  assert.equal(expected.width,'1024');assert.equal(expected.steps,'28');assert.equal(expected.cfg,'5');assert.equal(expected.negative,negative);
  assert.equal(first.requests.length+second.requests.length,0);
});
const custom={width:832,height:1216,seed:987654321,steps:19,cfg:7.5,denoise:.75,negative:'custom negative',sampler:'dpmpp_2m',scheduler:'simple',candidateCount:1,cache:false,previewOn:false};
function saved(values=custom,generationModelId='animagine-xl-4.0-opt'){return {version:1,generationModelId,editModelId:'sdxl-inpaint-v01',generationSettings:{...values}};}
function expectedFields(values){return Object.fromEntries(Object.entries(values).map(([key,value])=>[key,typeof value==='boolean'?value:String(value)]));}
test('valid custom generation values take precedence over every model preset on relaunch and store no project content',async()=>{
  for(const modelId of ['sdxl-base','sd-turbo','animagine-xl-4.0-opt']){
    const available=structuredClone(catalog);available.models[1].available=true;
    const localStorageImpl=storage(),ui=await ready({catalog:available,localStorageImpl});
    await ui.input('imageModel',modelId);
    await ui.input('prompt','PRIVATE POSITIVE PROMPT');await ui.input('projectName','PRIVATE PROJECT');
    for(const [key,value] of Object.entries(custom))await ui.input(key,typeof value==='boolean'?value:String(value));
    const next=await ready({catalog:available,localStorageImpl});assert.deepEqual(fields(next),expectedFields(custom),modelId);
    assert.equal(next.studio().getImageModelSettings().generation.selectedId,modelId);
    const value=JSON.parse(localStorageImpl.values.get(KEY));assert.deepEqual(value,{version:1,generationModelId:modelId,editModelId:'',generationSettings:custom});
    assert.doesNotMatch(localStorageImpl.values.get(KEY),/PRIVATE|data:image|mask|source|prompt|brief|conversation/i);
    assert.equal(ui.requests.length+next.requests.length,0);
  }
});
test('ID-only legacy settings initialize once from the actual model metadata, including Animagine negative',async()=>{
  for(const modelId of ['sdxl-base','sd-turbo','animagine-xl-4.0-opt']){
    const available=structuredClone(catalog);available.models[1].available=true;
    const localStorageImpl=storage({version:1,generationModelId:modelId,editModelId:'sdxl-inpaint-v01'}),ui=await ready({catalog:available,localStorageImpl});
    const model=available.models.find(item=>item.id===modelId);
    for(const [key,value] of Object.entries(model.defaults))assert.equal(ui.element(key).value,String(value),modelId+':'+key);
    assert.equal(ui.element('negative').value,modelId==='animagine-xl-4.0-opt'?negative:'');
    const persisted=JSON.parse(localStorageImpl.values.get(KEY));assert.equal(persisted.generationSettings.steps,model.defaults.steps);
    const changed=structuredClone(available);changed.models.find(item=>item.id===modelId).defaults.steps=31;
    const again=await ready({catalog:changed,localStorageImpl});assert.deepEqual(fields(again),fields(ui),'metadata is only an initial fallback');
    assert.equal(again.studio().getImageModelSettings().edit.selectedId,'sdxl-inpaint-v01');assert.equal(again.requests.length,0);
  }
});
test('generation persistence rejects malformed or out-of-range snapshots and uses a safe metadata fallback',async()=>{
  const invalid=[null,[],{}, {...custom,source:WHITE},{...custom,prompt:'must not be stored'},
    {...custom,width:513},{...custom,height:4096},{...custom,seed:-1},{...custom,steps:0},{...custom,cfg:'7'},
    {...custom,denoise:0},{...custom,sampler:'unknown'},{...custom,scheduler:'https://invalid'},{...custom,cache:1},
    {...custom,previewOn:null},{...custom,candidateCount:3},{...custom,negative:'x'.repeat(10001)}];
  for(const generationSettings of invalid){
    const localStorageImpl=storage({...saved(),generationSettings}),ui=await ready({localStorageImpl});
    assert.equal(ui.studio().getImageModelSettings().generation.selectedId,'animagine-xl-4.0-opt');
    assert.equal(ui.element('steps').value,'28');assert.equal(ui.element('cfg').value,'5');assert.equal(ui.element('negative').value,negative);
    assert.deepEqual(Object.keys(JSON.parse(localStorageImpl.values.get(KEY)).generationSettings).sort(),Object.keys(custom).sort());
    assert.equal(ui.requests.length,0);
  }
});
test('invalid transient input leaves the last valid generation settings intact, including an explicitly empty negative',async()=>{
  const localStorageImpl=storage(saved()),ui=await ready({localStorageImpl});
  await ui.input('negative','');const last=JSON.parse(localStorageImpl.values.get(KEY));assert.equal(last.generationSettings.negative,'');
  for(const [key,value] of [['steps',''],['steps','101'],['sampler','invalid']])await ui.input(key,value);
  const next=await ready({localStorageImpl});assert.deepEqual(fields(next),expectedFields({...custom,negative:''}));assert.equal(next.requests.length,0);
});
test('late startup catalog cannot overwrite generation controls the user already edited',async()=>{
  for(const stored of [saved(),{version:1,generationModelId:'animagine-xl-4.0-opt',editModelId:''}]){
    const pending=deferred(),localStorageImpl=storage(stored),ui=page({catalog:pending.promise,localStorageImpl});
    for(const [key,value] of Object.entries(custom))await ui.input(key,typeof value==='boolean'?value:String(value));
    pending.resolve(catalog);await until(()=>ui.studio().getImageModelSettings().ready,'delayed catalog');
    assert.deepEqual(fields(ui),expectedFields(custom));assert.equal(ui.studio().getImageModelSettings().generation.selectedId,'animagine-xl-4.0-opt');
    assert.deepEqual(JSON.parse(localStorageImpl.values.get(KEY)).generationSettings,custom);assert.equal(ui.requests.length,0);
  }
});
test('late startup catalog leaves a confirmed explicit project import and its current form unchanged',async()=>{
  const pending=deferred(),ui=page({catalog:pending.promise,localStorageImpl:storage(saved())});
  const before=fields(ui);assert.equal(await ui.studio().importProject(ui.project('Explicit import',WHITE)),true);
  pending.resolve(catalog);await until(()=>ui.studio().getImageModelSettings().ready,'catalog after import');
  assert.deepEqual(fields(ui),before);assert.equal(ui.state().project.brief.name,'Explicit import');assert.equal(ui.state().sourceDataURL,WHITE);
  assert.equal(ui.requests.length,0);
});
test('generation settings restoration is independent of automatic project restore and catalog completion order',async()=>{
  for(const catalogFirst of [false,true]){
    const pending=deferred(),ui=page({catalog:pending.promise,holdRestore:true,localStorageImpl:storage(saved())});
    await until(()=>ui.restores.length,'IndexedDB get');
    if(catalogFirst){pending.resolve(catalog);await until(()=>ui.studio().getImageModelSettings().ready,'early catalog');}
    ui.restores[0].resolve(ui.project('Automatic project',WHITE));await until(()=>ui.state().project.versions.length===1,'automatic project');
    if(!catalogFirst){pending.resolve(catalog);await until(()=>ui.studio().getImageModelSettings().ready,'late catalog');}
    assert.deepEqual(fields(ui),expectedFields(custom));assert.equal(ui.state().sourceDataURL,WHITE);
    assert.equal(ui.state().project.brief.name,'Automatic project');assert.equal(ui.requests.length,0);
  }
});
test('edit controls and edit-model changes never replace remembered generation settings',async()=>{
  const localStorageImpl=storage(saved()),ui=await ready({localStorageImpl});ui.studio().setMode('inpaint');
  await ui.input('imageModel','sdxl-inpaint-v01');await ui.element('resetModelPreset').click();
  for(const [key,value] of Object.entries({steps:'11',cfg:'2',negative:'EDIT ONLY',sampler:'euler',scheduler:'normal',cache:false}))await ui.input(key,value);
  await ui.input('imageModel','sdxl-base');
  assert.deepEqual(JSON.parse(localStorageImpl.values.get(KEY)).generationSettings,custom);
  const next=await ready({localStorageImpl});assert.deepEqual(fields(next),expectedFields(custom));assert.equal(next.requests.length,0);
});
test('late catalog does not apply a generation snapshot over an active edit form',async()=>{
  const pending=deferred(),localStorageImpl=storage(saved()),ui=page({catalog:pending.promise,localStorageImpl});ui.studio().setMode('inpaint');
  await ui.input('steps','11');await ui.input('negative','EDIT ONLY');const before=fields(ui);
  pending.resolve(catalog);await until(()=>ui.studio().getImageModelSettings().ready,'catalog in edit mode');
  assert.deepEqual(fields(ui),{...before,cache:false},'the existing dedicated-edit cache guard remains active');assert.deepEqual(JSON.parse(localStorageImpl.values.get(KEY)).generationSettings,custom);
  assert.equal(ui.requests.length,0);
});
for(const trigger of ['negative input','model selection'])test(`same-page edit roundtrip cannot overwrite generation settings through ${trigger}`,async()=>{
  const localStorageImpl=storage(saved()),ui=await ready({localStorageImpl}),api=ui.studio();
  await api.importProject(ui.project('Keep project',WHITE));ui.element('paint').snapshot=WHITE;
  const project=api.exportProject(),before=ui.state();
  api.setMode('inpaint');await ui.input('imageModel','sdxl-inpaint-v01');await ui.element('resetModelPreset').click();
  await ui.input('steps','11');await ui.input('cfg','2');await ui.input('negative','EDIT ONLY');
  const edit=fields(ui);assert.equal(edit.cache,false);api.setMode('txt2img');
  const expected={...custom};
  if(trigger==='negative input'){expected.negative+=' x';await ui.input('negative',expected.negative);}
  else api.setImageModelSettings({generationModelId:'animagine-xl-4.0-opt'});
  assert.deepEqual(JSON.parse(localStorageImpl.values.get(KEY)).generationSettings,expected);
  assert.deepEqual(fields(ui),expectedFields(expected));assert.equal(ui.element('cache').disabled,false);
  assert.equal(api.getImageModelSettings().generation.selectedId,'animagine-xl-4.0-opt');assert.equal(api.getImageModelSettings().edit.selectedId,'sdxl-inpaint-v01');
  api.setMode('inpaint');assert.deepEqual(fields(ui),edit,'returning to edit preserves its in-memory controls');assert.equal(ui.element('cache').disabled,true);
  assert.equal(api.exportProject(),project);assert.equal(ui.state().sourceDataURL,before.sourceDataURL);assert.equal(ui.element('paint').snapshot,WHITE);assert.equal(ui.requests.length,0);
});
test('generation roundtrips preserve dedicated edit cache disabling and its previous edit cache choice',async()=>{
  const localStorageImpl=storage(saved({...custom,cache:true})),ui=await ready({localStorageImpl}),api=ui.studio();
  api.setMode('inpaint');await ui.input('imageModel','sdxl-base');await ui.input('cache',false);
  await ui.input('imageModel','sdxl-inpaint-v01');assert.equal(ui.element('cache').disabled,true);
  api.setMode('txt2img');assert.equal(ui.element('cache').checked,true);assert.equal(ui.element('cache').disabled,false);
  api.setMode('inpaint');assert.equal(ui.element('cache').checked,false);assert.equal(ui.element('cache').disabled,true);
  await ui.input('imageModel','sdxl-base');assert.equal(ui.element('cache').checked,false,'the edit cache choice before dedicated selection survives the roundtrip');
  api.setMode('txt2img');assert.equal(ui.element('cache').checked,true);
  assert.equal(JSON.parse(localStorageImpl.values.get(KEY)).generationSettings.cache,true);assert.equal(ui.requests.length,0);
});
test('ID-only Animagine initializes generation settings while a delayed catalog arrives in active edit mode',async()=>{
  const pending=deferred(),localStorageImpl=storage({version:1,generationModelId:'animagine-xl-4.0-opt',editModelId:'sdxl-inpaint-v01'});
  const ui=page({catalog:pending.promise,localStorageImpl}),api=ui.studio(),initial=fields(ui);api.setMode('inpaint');
  const before=fields(ui);pending.resolve(catalog);await until(()=>api.getImageModelSettings().ready,'catalog in active edit');
  assert.deepEqual(fields(ui),{...before,cache:false},'catalog must leave the edit form unchanged except its existing cache guard');
  await ui.input('steps','11');await ui.input('cfg','2');const edit=fields(ui);api.setMode('txt2img');
  await ui.input('negative',negative+' x');
  const expected={...initial,...expectedFields(catalog.models[2].defaults),negative:negative+' x'};
  assert.deepEqual(fields(ui),expected);assert.equal(JSON.parse(localStorageImpl.values.get(KEY)).generationSettings.steps,28);
  assert.equal(JSON.parse(localStorageImpl.values.get(KEY)).generationSettings.cache,initial.cache,'edit cache=false cannot initialize generation');
  api.setMode('inpaint');assert.deepEqual(fields(ui),edit);assert.equal(ui.requests.length,0);
});
test('legacy mode select change roundtrip follows the same generation/edit preservation as the API',async()=>{
  const localStorageImpl=storage(saved()),ui=await ready({localStorageImpl}),api=ui.studio();
  await api.importProject(ui.project('Legacy select',WHITE));ui.element('paint').snapshot=WHITE;const project=api.exportProject();
  await ui.input('mode','inpaint');await ui.element('resetModelPreset').click();await ui.input('steps','11');await ui.input('cfg','2');
  const edit=fields(ui);await ui.input('mode','txt2img');await ui.input('negative',custom.negative+' x');
  assert.deepEqual(fields(ui),expectedFields({...custom,negative:custom.negative+' x'}));
  assert.equal(JSON.parse(localStorageImpl.values.get(KEY)).generationSettings.steps,custom.steps);
  await ui.input('mode','inpaint');assert.deepEqual(fields(ui),edit);assert.equal(ui.element('cache').disabled,true);
  assert.equal(api.getImageModelSettings().generation.selectedId,'animagine-xl-4.0-opt');assert.equal(api.getImageModelSettings().edit.selectedId,'sdxl-inpaint-v01');
  assert.equal(api.exportProject(),project);assert.equal(ui.state().sourceDataURL,WHITE);assert.equal(ui.element('paint').snapshot,WHITE);assert.equal(ui.requests.length,0);
});
for(const priority of ['generation input','explicit import'])test(`early ${priority} remains authoritative across active-edit catalog initialization`,async()=>{
  const pending=deferred(),localStorageImpl=storage(saved()),ui=page({catalog:pending.promise,localStorageImpl}),api=ui.studio();
  if(priority==='generation input')for(const [key,value] of Object.entries({...custom,steps:23,negative:'EARLY INPUT'}))await ui.input(key,typeof value==='boolean'?value:String(value));
  else await api.importProject(ui.project('Early explicit import',WHITE));
  const generation=fields(ui);api.setMode('inpaint');pending.resolve(catalog);await until(()=>api.getImageModelSettings().ready,'catalog after priority choice');
  await ui.input('steps','11');await ui.input('cfg','2');const edit=fields(ui);api.setMode('txt2img');
  assert.deepEqual(fields(ui),generation);await ui.input('negative',generation.negative+' x');
  assert.equal(JSON.parse(localStorageImpl.values.get(KEY)).generationSettings.steps,Number(generation.steps));
  api.setMode('inpaint');assert.deepEqual(fields(ui),edit);assert.equal(ui.requests.length,0);
});

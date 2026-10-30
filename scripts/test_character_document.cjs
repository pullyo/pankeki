'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/handoffs/fixtures/character-document-v2.fixture.json'),'utf8'));
const clone = x => JSON.parse(JSON.stringify(x));
function crc(bytes) { let n=0xffffffff; for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0; }
async function decodeAsset(asset) {
  const png=Buffer.from(asset.data.split(',')[1],'base64'); let offset=8, compressed=[];
  while(offset<png.length){const size=png.readUInt32BE(offset), type=png.toString('ascii',offset+4,offset+8), data=png.subarray(offset+8,offset+8+size);
    if(offset+size+12>png.length||crc(png.subarray(offset+4,offset+8+size))!==png.readUInt32BE(offset+8+size))throw Error('PNG CRC or truncated data');
    if(type==='IDAT')compressed.push(data); offset+=size+12;
  }
  const width=png.readUInt32BE(16),height=png.readUInt32BE(20),channels=png[25]===6?4:1;
  const pixels=zlib.inflateSync(Buffer.concat(compressed),{maxOutputLength:16*1024*1024*4+4096});
  if(pixels.length!==height*(width*channels+1))throw Error('Invalid PNG raster');
  return {width,height};
}
function api() { const file=path.join(__dirname,'../web/src/character-document.js');assert(fs.existsSync(file),'PankekiDocument implementation is required');return require(file); }
const options = {decodeAsset};

test('v2_round_trip_and_v1_bytes_preserved', async()=>{
  const D=api(), raw=clone(fixture.document), before=JSON.stringify(raw);
  const doc=await D.parseDocument(raw,options); assert.equal(doc.version,2); assert.equal(JSON.stringify(raw),before);
  assert.deepEqual(await D.parseDocument(await D.serializeDocument(doc),options),doc);
  const v1=clone(fixture.legacyV1), original=JSON.stringify(v1); const converted=await D.fromV1(v1,options);
  assert.equal(converted.version,2);assert.equal(converted.assets[0].data,v1.versions[0].image);
  assert.equal(converted.candidates[0].id,'source-fixture');assert.deepEqual(converted.parts,[]);assert.deepEqual(converted.rigs,[]);
  assert.deepEqual(converted.selectionHistory,v1.selectionHistory);assert.equal(converted.backgroundAssetId,null);
  assert.equal(JSON.stringify(v1),original); assert.equal(converted.canvas.width,32);
  assert.deepEqual(await D.parseDocument(v1,options),converted);
});

test('v1_conversion_keeps_candidate_lineage_and_unknown_provenance',async()=>{
  const D=api(), v1=clone(fixture.legacyV1);
  delete v1.versions[0].kind; v1.versions.push({...clone(v1.versions[0]),id:'child',parentId:'source-fixture'});
  v1.selectionHistory=[{candidateId:'child',action:'edit',at:'2026-10-20T00:00:00.000Z'}];
  const doc=await D.fromV1(v1,options); assert.equal(doc.assets.length,1);assert.equal(doc.candidates[1].parentId,'source-fixture');
  assert.equal(doc.sourceCandidateId,'child');assert.deepEqual(doc.selection.compareCandidateIds,[]);
  assert(!Object.hasOwn(doc.candidates[0],'kind'));assert(!Object.hasOwn(doc.candidates[0].request,'model_id'));
});

function legacyWithPhotoMetadata(){
  const v1=clone(fixture.legacyV1),source=v1.versions[0],output=fixture.document.assets[1];
  source.annotations=[{id:'source-note',x:.25,y:.75,text:'원본 스카프 확인',createdAt:'2026-10-29T00:00:00.000Z'}];
  const child={...clone(source),id:'photo-resize',label:'Synthetic resize',image:output.data,kind:'derived',parentId:'source-fixture',request:null,
    derivation:{operation:'resize',sourceId:'source-fixture',sourceSha256:'32b80b1d9b7b3d1bca7fd4066672c335b6a633e69dd0cac9df65dc2ab0098795',inputWidth:32,inputHeight:32,outputWidth:8,outputHeight:8,algorithm:'pillow-lanczos',algorithmVersion:'1',parameters:{width:8,height:8,keepAspect:true}},
    execution:{schema:1,traceId:'synthetic-cpu-resize',jobId:'e'.repeat(32),resultSha256:'a83bfbbde1c3988877b50c77c58821f122f40a50e97fa9c0af5653bf136f3ea9',runRef:'runs/'+'e'.repeat(32)}};
  delete child.annotations;
  v1.versions.push(child,{...clone(child),id:'photo-resize-copy'});
  v1.selectionHistory=[{candidateId:'photo-resize-copy',action:'view',at:'2026-10-29T00:00:00.000Z'}];
  return v1;
}

test('photo_metadata_survives_v1_to_motion_v2_serialization_with_real_asset_lineage',async()=>{
  const D=api(),v1=legacyWithPhotoMetadata(),before=JSON.stringify(v1);
  assert.equal(require('../web/src/profiles.js').parseProject(v1).versions.length,3,'fixture must be accepted by the current image-project schema');
  const converted=await D.fromV1(v1,options),reopened=await D.parseDocument(await D.serializeDocument(converted),options);
  assert.deepEqual(reopened,converted);assert.equal(JSON.stringify(v1),before);
  assert.equal(reopened.assets.length,2,'equal PNG bytes share an asset without dropping candidate metadata');
  assert.deepEqual(reopened.candidates.map(c=>c.id),['source-fixture','photo-resize','photo-resize-copy']);
  assert.equal(reopened.sourceCandidateId,'photo-resize-copy');assert.deepEqual(reopened.selectionHistory,v1.selectionHistory);
  const source=reopened.candidates[0];assert.deepEqual(source.annotations,v1.versions[0].annotations);
  assert.equal(source.assetId,'sha256:32b80b1d9b7b3d1bca7fd4066672c335b6a633e69dd0cac9df65dc2ab0098795');
  assert.equal(reopened.assets.find(a=>a.id===source.assetId).data,v1.versions[0].image);
  for(const child of reopened.candidates.slice(1)){
    assert.equal(child.kind,'derived');assert.equal(child.request,null);assert.equal(child.parentId,'source-fixture');
    assert.equal(child.assetId,'sha256:a83bfbbde1c3988877b50c77c58821f122f40a50e97fa9c0af5653bf136f3ea9');
    assert.deepEqual(child.derivation,v1.versions[1].derivation);assert.deepEqual(child.execution,v1.versions[1].execution);
    assert.equal(reopened.assets.find(a=>a.id===child.assetId).data,v1.versions[1].image);
  }
});

test('photo_metadata_rejects_forged_provenance_and_unsupported_fields_without_mutation',async()=>{
  const D=api(),good=await D.fromV1(legacyWithPhotoMetadata(),options),before=JSON.stringify(good);
  const cases=[
    ['unknown candidate metadata',d=>{d.candidates[1].externalPath='/tmp/not-an-asset';}],
    ['unknown derivation metadata',d=>{d.candidates[1].derivation.externalPath='/tmp/not-an-asset';}],
    ['invalid annotation coordinates',d=>{d.candidates[0].annotations[0].x=-.1;}],
    ['forged execution image SHA',d=>{d.candidates[1].execution.resultSha256='f'.repeat(64);}],
    ['derived parent disagreement',d=>{d.candidates[1].parentId='photo-resize-copy';}],
    ['forged derived source SHA',d=>{d.candidates[1].derivation.sourceSha256='f'.repeat(64);}],
    ['derived input size disagrees with parent PNG',d=>{d.candidates[1].derivation.inputWidth=31;}],
    ['derived output size disagrees with PNG',d=>{d.candidates[1].derivation.outputWidth=7;}],
  ];
  for(const [label,mutate]of cases){const bad=clone(good);mutate(bad);const input=JSON.stringify(bad);await assert.rejects(D.parseDocument(bad,options),undefined,label);assert.equal(JSON.stringify(bad),input,label);assert.equal(JSON.stringify(good),before);}
  const accessor=clone(good);let called=false;Object.defineProperty(accessor.candidates[0],'annotations',{enumerable:true,get(){called=true;return [];}});
  await assert.rejects(D.parseDocument(accessor,options),/Accessor/);assert.equal(called,false);assert.equal(JSON.stringify(good),before);
});

test('reject_hash_dimensions_and_limits_without_replacing_current',async()=>{
  const D=api();const current=await D.parseDocument(fixture.document,options), before=JSON.stringify(current);
  const mutations=[
    d=>{d.assets[0].id='sha256:'+'0'.repeat(64);},
    d=>{d.assets[0].width=31;},
    d=>{d.parts=Array.from({length:17},(_,i)=>({...clone(d.parts[0]),id:'part'+i}));},
    d=>{d.parts[0].parentId='eye';},
    d=>{d.unknown=true;},
    d=>{d.parts[0].transform[0]=Infinity;},
    d=>{d.assets.push(clone(d.assets[0]));},
    d=>{d.selection.partId='missing';},
    d=>{d.assets[0].data='data:image/svg+xml;base64,PHN2Zz4=';},
  ];
  for(const change of mutations){const bad=clone(fixture.document);change(bad);await assert.rejects(D.parseDocument(bad,options));assert.equal(JSON.stringify(current),before);}
  await assert.rejects(D.parseDocument(' '.repeat(64*1024*1024+1),options),/64 MiB/);
  const getter=clone(fixture.document);Object.defineProperty(getter,'brief',{get(){assert.fail('Accessor ran');}});
  await assert.rejects(D.parseDocument(getter,options),/Accessor/);
  await assert.rejects(D.parseDocument(JSON.stringify(fixture.document).replace('"version":2','"version":2,"__proto__":{}'),options),/Unsafe|Unsupported/);
});

test('always_decode_new_bytes_and_enforce_actual_dimensions',async()=>{
  const D=api(), doc=clone(fixture.document); let calls=0;
  const loaded=await D.parseDocument(doc,{decodeAsset:async a=>{calls++;return decodeAsset(a);}});assert.equal(calls,6);
  await assert.rejects(D.parseDocument(doc,{decodeAsset:async()=>({width:1,height:1})}),/dimension|size/i);
  assert.equal(loaded.assets[0].data,doc.assets[0].data);
});

test('rig_hash_is_deterministic_and_old_bindings_remain_stale',async()=>{
  const D=api(),doc=await D.parseDocument(fixture.document,options);
  for(const rig of doc.rigs)assert.equal(await D.computeRigHash(doc.parts.find(p=>p.id===rig.partId),rig,doc.assets),rig.rigHash);
  const bad=clone(doc);bad.parts[1].materialAssetId=bad.assets[2].id;
  const stale=await D.parseDocument(bad,options);assert.equal(stale.rigs.find(r=>r.partId==='eye').status,'stale');
  assert.equal(stale.rigs.find(r=>r.partId==='eye').rigHash,doc.rigs.find(r=>r.partId==='eye').rigHash);
  assert.equal(stale.presets[0].rigHashes[1],doc.presets[0].rigHashes[1]);
});

test('reject_bad_mesh_key_defaults_and_motion_curves',async()=>{
  const D=api();for(const change of [d=>d.rigs[0].triangles[0]=999,d=>d.rigs[0].uv[0]=2,d=>d.rigs[0].bindings[0].keys[0].deltas[0]=1,
    d=>d.parameters[0].value=2,d=>d.motions.push({id:'bad',duration:2,fps:24,rigHashes:[],curves:[{parameterId:'breath',keys:[{t:0,value:0},{t:2,value:1}]}]})]){
    const bad=clone(fixture.document);change(bad);await assert.rejects(D.parseDocument(bad,options));
  }
});

test('v1_decoder_cannot_override_png_header_and_corrupt_new_bytes_are_rejected',async()=>{
  const D=api();await assert.rejects(D.fromV1(fixture.legacyV1,{decodeAsset:async()=>({width:1,height:1})}),/dimension|size/i);
  const bad=clone(fixture.document), old=bad.assets[0].id, png=Buffer.from(bad.assets[0].data.split(',')[1],'base64');png[45]^=1;
  const next='sha256:'+require('node:crypto').createHash('sha256').update(png).digest('hex');
  const changed=JSON.parse(JSON.stringify(bad).replaceAll(old,next));changed.assets[0].data='data:image/png;base64,'+png.toString('base64');
  await assert.rejects(D.parseDocument(changed,options),/CRC|PNG|raster/i);
});

test('commands_are_atomic_and_undo_keeps_revision_monotonic',async()=>{
  const D=api(),editor=D.createEditor(await D.parseDocument(fixture.document,options));
  const start=editor.snapshot();assert.equal(start.revision,0);assert.equal(start.canUndo,false);
  await editor.dispatch({type:'setPart',args:{partId:'eye',patch:{transform:[1,0,0,1,1,-13]}},expectedRevision:0});
  assert.equal(editor.snapshot().undoCount,1);const moved=editor.snapshot().document.parts[1].transform;
  assert.equal((await editor.undo()).revision,2);assert.deepEqual(editor.snapshot().document.parts[1].transform,[1,0,0,1,0,-13]);
  assert.equal((await editor.redo()).revision,3);assert.deepEqual(editor.snapshot().document.parts[1].transform,moved);
  await editor.undo();const previous=editor.snapshot();
  await assert.rejects(editor.dispatch({type:'setPart',args:{partId:'eye',patch:{transform:[0,0,0,0,0,0]}},expectedRevision:previous.revision}));
  assert.equal(editor.snapshot().document,previous.document);assert.equal(editor.snapshot().revision,previous.revision);
  await editor.dispatch({type:'setParameters',args:{values:{eyeOpen:.5}},expectedRevision:previous.revision});
  assert.equal(editor.snapshot().canRedo,false);assert.equal(start.document.parameters[0].value,1);
  assert(Object.isFrozen(editor.snapshot().document.parts[0]));
});

test('material_and_keyform_replacement_invalidate_dependents_in_one_undo',async()=>{
  const D=api(),editor=D.createEditor(await D.parseDocument(fixture.document,options));const before=editor.snapshot();
  await editor.dispatch({type:'replaceMaterial',args:{partId:'eye',assetId:fixture.document.assets[2].id},expectedRevision:0});
  assert.equal(editor.snapshot().document.rigs[1].status,'stale');assert.equal(editor.snapshot().undoCount,1);
  await assert.rejects(editor.dispatch({type:'setParameters',args:{values:{eyeOpen:.5}},expectedRevision:1}),/ready|stale/i);
  await editor.undo();assert.deepEqual(editor.snapshot().document,before.document);
  const changed=clone(editor.snapshot().document.rigs[1]);changed.bindings[0].keys[1].deltas[1]=1.8;
  changed.rigHash=await D.computeRigHash(editor.snapshot().document.parts[1],changed,editor.snapshot().document.assets);
  await editor.dispatch({type:'setRig',args:{rig:changed},expectedRevision:2});
  assert.equal(editor.snapshot().document.rigs[1].status,'ready');assert.notEqual(editor.snapshot().document.rigs[1].rigHash,before.document.rigs[1].rigHash);
  assert.equal(editor.snapshot().document.presets[0].rigHashes[1],before.document.rigs[1].rigHash);
  await editor.undo();assert.deepEqual(editor.snapshot().document,before.document);
});

test('locked_or_referenced_parts_and_stale_revisions_cannot_mutate',async()=>{
  const D=api(),editor=D.createEditor(await D.parseDocument(fixture.document,options));
  await editor.dispatch({type:'setPart',args:{partId:'eye',patch:{lockMaterial:true,lockTransform:true}},expectedRevision:0});
  const before=editor.snapshot();
  for(const command of [
    {type:'replaceMaterial',args:{partId:'eye',assetId:fixture.document.assets[2].id}},
    {type:'setPart',args:{partId:'eye',patch:{transform:[1,0,0,1,2,-13]}}},
    {type:'removePart',args:{partId:'body'}},{type:'removePart',args:{partId:'eye'}},
    {type:'setPart',args:{partId:'eye',patch:{sourceAssetId:fixture.document.assets[2].id}}},
  ])await assert.rejects(editor.dispatch({...command,expectedRevision:1}));
  await assert.rejects(editor.dispatch({type:'setSelection',args:{selection:{partId:'mouth'}},expectedRevision:0}),/revision/i);
  assert.equal(editor.snapshot().document,before.document);
  const first=editor.dispatch({type:'setSelection',args:{selection:{partId:'mouth'}},expectedRevision:1});
  const stale=editor.dispatch({type:'setSelection',args:{selection:{partId:'body'}},expectedRevision:1});
  await first;await assert.rejects(stale,/revision/i);assert.equal(editor.snapshot().document.selection.partId,'mouth');
});

test('history_has_50_state_and_patch_byte_caps_and_serialization_excludes_it',async()=>{
  const D=api(),editor=D.createEditor(await D.parseDocument(fixture.document,options));
  for(let i=0;i<55;i++)await editor.dispatch({type:'setPart',args:{partId:'eye',patch:{name:'Edit '+i}},expectedRevision:editor.snapshot().revision});
  assert.equal(editor.snapshot().undoCount,50);assert(editor.snapshot().historyBytes<=33554432);
  const saved=JSON.parse(await D.serializeDocument(editor.snapshot().document));assert(!Object.hasOwn(saved,'undo'));
  const restored=D.createEditor(await D.parseDocument(saved,options));assert.equal(restored.snapshot().undoCount,0);
  const bounded=D.createEditor(await D.parseDocument(fixture.document,options),{maxHistoryBytes:120});
  for(let i=0;i<8;i++)await bounded.dispatch({type:'setPart',args:{partId:'eye',patch:{name:'Bounded edit '+i}},expectedRevision:i});
  assert(bounded.snapshot().historyBytes<=120);assert.equal(bounded.snapshot().document.parts[1].name,'Bounded edit 7');
});

test('background_confirmation_and_prepared_transparent_scene_are_atomic',async()=>{
  const D=api(),raw=clone(fixture.document);raw.backgroundAssetId=null;raw.parts.forEach(p=>p.backgroundReady=false);
  const editor=D.createEditor(await D.parseDocument(raw,options));
  await assert.rejects(editor.dispatch({type:'setPart',args:{partId:'eye',patch:{transform:[1,0,0,1,1,-13]}},expectedRevision:0}),/background|prepared/i);
  await editor.dispatch({type:'setBackground',args:{assetId:null,confirmed:true},expectedRevision:0});
  assert(editor.snapshot().document.parts.every(p=>p.backgroundReady));assert.equal(editor.snapshot().document.backgroundAssetId,null);
  await editor.undo();assert(editor.snapshot().document.parts.every(p=>!p.backgroundReady));
});

test('undo_queued_behind_dispatch_keeps_the_current_redo_stack',async()=>{
  const D=api(),editor=D.createEditor(await D.parseDocument(fixture.document,options));
  const edit=editor.dispatch({type:'setPart',args:{partId:'eye',patch:{name:'Queued change'}},expectedRevision:0});
  const undo=editor.undo();await edit;await undo;
  assert.equal(editor.snapshot().canRedo,true);await editor.redo();assert.equal(editor.snapshot().document.parts[1].name,'Queued change');
});

test('approved_commands_can_form_one_atomic_import_and_keep_user_labels',async()=>{
  const D=api(),editor=D.createEditor(await D.parseDocument(fixture.document,options));
  await assert.rejects(editor.dispatchBatch([{type:'setPart',args:{partId:'eye',patch:{name:'Must roll back'}},expectedRevision:0},{type:'setSelection',args:{selection:{partId:'missing'}},expectedRevision:0}]));
  assert.equal(editor.snapshot().document.parts[1].name,'Synthetic eye');assert.equal(editor.snapshot().revision,0);
  await editor.dispatchBatch([{type:'setPart',args:{partId:'eye',patch:{name:'Imported eye'}},expectedRevision:0},{type:'savePreset',args:{preset:{...clone(fixture.document.presets[0]),id:'named',label:'기본 표정'}},expectedRevision:0}]);
  assert.equal(editor.snapshot().undoCount,1);assert.equal(editor.snapshot().document.presets.at(-1).label,'기본 표정');
  await editor.undo();assert.equal(editor.snapshot().document.parts[1].name,'Synthetic eye');assert.equal(editor.snapshot().document.presets.length,1);
});

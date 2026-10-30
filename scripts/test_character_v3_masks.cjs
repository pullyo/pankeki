'use strict';
// Required real CPU pixels: install/resolve @napi-rs/canvas or supply its package path.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {createCanvas,loadImage}=require(process.env.PANKEKI_TEST_CANVAS_MODULE||'@napi-rs/canvas');
const D=require('../web/src/character-document-v3.js'),V=require('../web/src/character-renderer-v3.js'),L=require('../web/src/character-document.js');
const fixture=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../docs/handoffs/fixtures/character-document-v2.fixture.json'))).document;
const copy=x=>JSON.parse(JSON.stringify(x)),relation=(sourcePartId='eye',targetPartId='mouth',inverted=false)=>({sourcePartId,targetPartId,inverted});
const pixel=(c,x,y)=>[...c.getContext('2d').getImageData(x,y,1,1).data];
const bytes=c=>Buffer.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data);
async function fixtureDoc({clip=[relation()],alpha=1,sourceVisible=false,mutate=()=>{}}={}){
 const raw=copy(fixture),source=createCanvas(8,8),x=source.getContext('2d');x.fillStyle=`rgba(255,0,0,${alpha})`;x.fillRect(0,0,4,8);
 const png=source.toBuffer('image/png'),asset={id:'sha256:'+crypto.createHash('sha256').update(png).digest('hex'),mime:'image/png',width:8,height:8,data:'data:image/png;base64,'+png.toString('base64')};raw.assets.push(asset);
 const target=createCanvas(8,8);target.getContext('2d').fillStyle='#0000ff';target.getContext('2d').fillRect(0,0,8,8);const targetPng=target.toBuffer('image/png'),targetAsset={id:'sha256:'+crypto.createHash('sha256').update(targetPng).digest('hex'),mime:'image/png',width:8,height:8,data:'data:image/png;base64,'+targetPng.toString('base64')};raw.assets.push(targetAsset);
 raw.parts.forEach(p=>p.materialAssetId=targetAsset.id);
 raw.backgroundAssetId=null;for(const p of raw.parts){p.parentId=null;p.transform=[1,0,0,1,4,4];p.visible=p.id==='mouth';p.opacity=1;}
 raw.parts.find(p=>p.id==='eye').materialAssetId=asset.id;raw.parts.find(p=>p.id==='eye').visible=sourceVisible;
 for(const r of raw.rigs){r.bindings=[];r.materialAssetId=raw.parts.find(p=>p.id===r.partId).materialAssetId;}
 mutate(raw);for(const r of raw.rigs){r.materialAssetId=raw.parts.find(p=>p.id===r.partId).materialAssetId;r.rigHash=await L.computeRigHash(raw.parts.find(p=>p.id===r.partId),r,raw.assets);r.status='ready';}
 const decoded=new Map();for(const a of raw.assets)decoded.set(a.id,await loadImage(Buffer.from(a.data.split(',')[1],'base64')));
 const d=copy(await D.upgradeV2(raw,{decodeAsset:a=>decoded.get(a.id)}));d.clipRelations=clip;
 return{doc:await D.parseDocumentV3(d,{decodeAsset:a=>decoded.get(a.id)}),decoded};
}
function draw(doc,decoded,opts={}){const c=createCanvas(32,32),pose=V.evaluatePoseV3(doc);return{canvas:c,pose,result:V.drawPoseV3(c,pose,decoded,{canvasFactory:createCanvas,...opts})};}
test('real CPU normal mask keeps texture alpha inside and clears target outside; hidden source stays a mask',async()=>{const{doc,decoded}=await fixtureDoc();const{canvas,pose,result}=draw(doc,decoded);assert.equal(pixel(canvas,5,6)[3],255);assert.equal(pixel(canvas,10,6)[3],0);assert.deepEqual(result,{width:32,height:32,drawnPartIds:['mouth']});assert(!pose.draws.some(d=>d.partId==='eye'));assert(pose.maskSources.some(d=>d.partId==='eye'));assert.deepEqual(pose.clipRelations,doc.clipRelations);});
test('inverted mask removes source alpha interior and preserves exterior target',async()=>{const{doc,decoded}=await fixtureDoc({clip:[relation('eye','mouth',true)]});const{canvas}=draw(doc,decoded);assert.equal(pixel(canvas,5,6)[3],0);assert.equal(pixel(canvas,10,6)[3],255);});
test('source texture alpha multiplied once by own and inherited parent opacity after affine transforms',async()=>{const{doc,decoded}=await fixtureDoc({alpha:.5,mutate:r=>{const b=r.parts[0],s=r.parts[1],t=r.parts[2];b.transform=[1,0,0,1,2,3];b.opacity=.5;b.visible=false;s.parentId='body';s.transform=[2,0,0,1,3,1];s.opacity=.5;t.parentId='eye';t.transform=[1,0,0,1,0,0];t.opacity=1;}});const{canvas,pose}=draw(doc,decoded);const source=pose.maskSources.find(p=>p.partId==='eye');assert.equal(source.opacity,.25);assert.deepEqual(source.verticesDocument,[5,4,21,4,21,12,5,12]);assert.equal(pose.draws.length,0,'hidden ancestor hides target draw');const raw=copy(doc);raw.baseDocument.parts.forEach(p=>p.visible=p.id!=='eye');raw.baseDocument.parts[2].parentId='body';raw.baseDocument.parts[2].transform=[2,0,0,1,3,1];for(const r of raw.baseDocument.rigs)r.rigHash=await L.computeRigHash(raw.baseDocument.parts.find(p=>p.id===r.partId),r,raw.baseDocument.assets);const current=await D.parseDocumentV3(raw,{decodeAsset:a=>decoded.get(a.id)});const output=draw(current,decoded).canvas;assert(Math.abs(pixel(output,11,6)[3]-16)<=1);assert.equal(pixel(output,16,6)[3],0);assert.equal(pixel(canvas,7,6)[3],0);});
test('two actual ancestor transforms position hidden source and target together with inherited opacity',async()=>{
 const{doc,decoded}=await fixtureDoc({mutate:r=>{
  const grand=copy(r.parts[0]),grandRig=copy(r.rigs[0]);grand.id='grand';grand.parentId=null;grand.order=-1;grand.transform=[0,1,-1,0,24,2];grand.opacity=.5;grand.visible=true;
  grandRig.id='rig-grand';grandRig.partId='grand';r.parts.push(grand);r.rigs.push(grandRig);
  const body=r.parts[0],source=r.parts[1],target=r.parts[2];body.parentId='grand';body.transform=[1,0,0,1,2,2];body.opacity=.5;body.visible=true;
  source.parentId='body';source.transform=[1,0,0,1,2,2];source.visible=false;target.parentId='body';target.transform=[1,0,0,1,2,2];target.visible=true;
  // Parent meshes are independent of their inherited transforms. Keep their
  // synthetic colors outside the canvas to read the child's exact alpha alone.
  for(const rig of [r.rigs[0],grandRig])rig.vertices=[100,100,108,100,108,108,100,108];
 }});
 const{canvas,pose}=draw(doc,decoded),source=pose.maskSources.find(p=>p.partId==='eye'),target=pose.draws.find(p=>p.partId==='mouth');
 assert.deepEqual(source.verticesDocument,[20,6,20,14,12,14,12,6]);assert.deepEqual(target.verticesDocument,source.verticesDocument);assert.equal(source.opacity,.25);assert.equal(target.opacity,.25);
 assert(Math.abs(pixel(canvas,15,8)[3]-16)<=1);assert.equal(pixel(canvas,15,12)[3],0);
});
test('multiple sources union with source-over alpha once, including shared triangle diagonal',async()=>{const{doc,decoded}=await fixtureDoc({alpha:.5,clip:[relation(),relation('body')],mutate:r=>{r.parts[0].materialAssetId=r.parts[1].materialAssetId;r.parts[0].transform=[1,0,0,1,6,4];}});const out=draw(doc,decoded).canvas;assert(Math.abs(pixel(out,5,5)[3]-127)<=1);assert(Math.abs(pixel(out,7,7)[3]-191)<=1);assert(Math.abs(pixel(out,9,7)[3]-127)<=1);assert.equal(pixel(out,11,7)[3],0);});
test('non-affine multi-triangle alpha stays consistent across shared diagonal',async()=>{const{doc,decoded}=await fixtureDoc({alpha:.5,mutate:r=>{for(const mesh of r.rigs)mesh.vertices=[0,0,8,0,7,8,0,8];}});const out=draw(doc,decoded).canvas;assert(Math.abs(pixel(out,5,5)[3]-127)<=1);assert(Math.abs(pixel(out,6,6)[3]-127)<=1);assert(Math.abs(pixel(out,5,8)[3]-127)<=1);assert.equal(pixel(out,10,6)[3],0);});
test('missing/self/cycle/mixed inversion/duplicates/unknown fields/nonboolean/>32 clips reject',async()=>{const{doc}=await fixtureDoc();for(const clip of [[relation('missing')],[relation('eye','eye')],[relation(),relation('mouth','eye')],[relation(),relation('body','mouth',true)],[relation(),relation()],[{...relation(),extra:1}],[{...relation(),inverted:1}],Array.from({length:33},()=>relation())]){const raw=copy(doc);raw.clipRelations=clip;await assert.rejects(D.parseDocumentV3(raw,{decodeAsset:a=>({width:a.width,height:a.height})}));}});
test('clip batch changes hash, stale guards and roundtrips; failed edit leaves identity and FIFO intact',async()=>{const{doc}=await fixtureDoc({clip:[]}),editor=D.createEditorV3(doc);await editor.dispatchBatch([{type:'savePreset',value:{id:'p',label:'p',rigHash:doc.rigHash,values:doc.values}}]);await editor.dispatchBatch([{type:'setClipRelations',value:[relation()]}]);const changed=editor.snapshot();assert.notEqual(changed.document.rigHash,doc.rigHash);assert.deepEqual(D.compatibilityV3(changed.document).stalePresetIds,['p']);assert.throws(()=>D.presetValuesV3(changed.document,'p'),/stale/);assert.deepEqual(await D.parseDocumentV3(await D.serializeDocumentV3(changed.document),{decodeAsset:a=>({width:a.width,height:a.height})}),changed.document);const bad=editor.dispatchBatch([{type:'setClipRelations',value:[relation('eye','eye')]}]);const good=editor.dispatchBatch([{type:'setValues',value:{...doc.values,eyeOpen:.5}}]);await assert.rejects(bad);await good;assert.equal(editor.snapshot().document.values.eyeOpen,.5);await editor.undo();assert.equal(editor.snapshot().document,changed.document);await editor.undo();assert.equal(editor.snapshot().document.rigHash,doc.rigHash);await editor.redo();assert.equal(editor.snapshot().document,changed.document);});
test('staged failures preserve destination bytes and release every scratch surface',async()=>{const{doc,decoded}=await fixtureDoc();const pose=V.evaluatePoseV3(doc),c=createCanvas(32,32),ctx=c.getContext('2d');ctx.fillStyle='#123456';ctx.fillRect(0,0,32,32);const before=bytes(c),owned=[];let n=0;const factory=(w,h)=>{if(++n===3)throw Error('factory failed');const x=createCanvas(w,h);owned.push(x);return x;};assert.throws(()=>V.drawPoseV3(c,pose,decoded,{canvasFactory:factory}),/factory failed/);assert.deepEqual(bytes(c),before);assert(owned.every(x=>x.width===1&&x.height===1));const missing=new Map(decoded);missing.delete(pose.maskSources[0].assetId);assert.throws(()=>V.drawPoseV3(c,pose,missing,{canvasFactory:createCanvas}));assert.deepEqual(bytes(c),before);const late=copy(pose);late.draws.push({...late.draws[0],partId:'bad',assetId:'missing'});assert.throws(()=>V.drawPoseV3(c,late,decoded,{canvasFactory:createCanvas}));assert.deepEqual(bytes(c),before);});
test('successful draw releases scratch; reusable factory aliases and destination alias reject without damage',async()=>{const{doc,decoded}=await fixtureDoc(),owned=[],c=createCanvas(32,32),pose=V.evaluatePoseV3(doc);V.drawPoseV3(c,pose,decoded,{canvasFactory:(w,h)=>{const x=createCanvas(w,h);owned.push(x);return x;}});assert(owned.length>0&&owned.every(x=>x.width===1&&x.height===1));const before=bytes(c);assert.throws(()=>V.drawPoseV3(c,pose,decoded,{canvasFactory:()=>c}));assert.deepEqual(bytes(c),before);const shared=createCanvas(32,32);assert.throws(()=>V.drawPoseV3(c,pose,decoded,{canvasFactory:()=>shared}));assert.deepEqual(bytes(c),before);});
test('axis deformation applies once to mask and target; grid and warp remain unsupported',async()=>{const{doc,decoded}=await fixtureDoc(),raw=copy(doc);raw.bindings=['eye','mouth'].map(partId=>({id:'shift-'+partId,partId,mode:'axis',parameterIds:['eyeOpen'],keys:[{at:0,deltas:[2,0,2,0,2,0,2,0]},{at:1,deltas:Array(8).fill(0)}]}));const d=await D.parseDocumentV3(raw,{decodeAsset:a=>decoded.get(a.id)}),pose=V.evaluatePoseV3(d,{eyeOpen:0}),out=createCanvas(32,32);V.drawPoseV3(out,pose,decoded,{canvasFactory:createCanvas});assert.equal(pixel(out,5,6)[3],0);assert.equal(pixel(out,7,6)[3],255);assert.equal(pixel(out,11,6)[3],0);for(const mutate of [r=>r.bindings[0].mode='grid',r=>r.deformers=[{}],r=>r.partDeformerIds={eye:'warp'}]){const bad=copy(d);mutate(bad);await assert.rejects(D.parseDocumentV3(bad,{decodeAsset:a=>decoded.get(a.id)}));}});

test('clip chain uses effective alpha of a hidden already-clipped source',async()=>{const{doc,decoded}=await fixtureDoc({alpha:.5,clip:[relation('eye','body'),relation('body','mouth')],mutate:r=>{r.parts[0].opacity=.5;}});const out=draw(doc,decoded).canvas;assert(Math.abs(pixel(out,5,6)[3]-64)<=1);assert.equal(pixel(out,10,6)[3],0);});

// T7-I1: expected pixels come from native whole-image drawing of the same
// already-quantized host texture, independently of the v3 reconstruction.
const LR=require('../web/src/character-renderer.js');
function precisionTexture(alpha,rgb=[100,150,200]){
 const c=createCanvas(8,8),x=c.getContext('2d'),im=x.createImageData(8,8);
 for(let i=0;i<im.data.length;i+=4)im.data.set([...rgb,alpha],i);
 x.putImageData(im,0,0);return c;
}
function precisionDraw(id='target',opacity=1,bent=false){return{partId:id,assetId:id,order:0,opacity,verticesDocument:bent?[4,4,12,4,12,12,5,12]:[4,4,12,4,12,12,4,12],uv:[0,0,1,0,1,1,0,1],triangles:[0,1,2,0,2,3]};}
function precisionReference(texture,opacity){const c=createCanvas(16,16),x=c.getContext('2d');x.globalAlpha=opacity;x.drawImage(texture,4,4);x.globalAlpha=1;return c;}
const interiorPrecisionPoints=[[5,5],[6,6],[7,7],[8,8],[5,8],[8,5]];
test('precision regression affine whole-frame RGBA equals direct and legacy at low alpha and half opacity',()=>{
 for(const alpha of [1,16,64,128,255])for(const opacity of [1,.5]){
  const tex=precisionTexture(alpha),d=precisionDraw('target',opacity),pose={backgroundAssetId:null,draws:[d],blockedParts:[]},assets=new Map([['target',tex]]),expected=precisionReference(tex,opacity),legacy=createCanvas(16,16),actual=createCanvas(16,16);
  LR.drawPose(legacy,pose,assets);assert.deepEqual(bytes(legacy),bytes(expected));V.drawPoseV3(actual,pose,assets,{canvasFactory:createCanvas});assert.deepEqual(bytes(actual),bytes(expected),`affine alpha=${alpha} opacity=${opacity}`);
 }
});
test('precision regression non-affine shared-diagonal interior RGBA preserves host texture and opacity',()=>{
 for(const alpha of [1,16,64,128,255])for(const opacity of [1,.5]){
  const tex=precisionTexture(alpha),pose={backgroundAssetId:null,draws:[precisionDraw('target',opacity,true)],blockedParts:[]},actual=createCanvas(16,16),expected=precisionReference(tex,opacity);
  V.drawPoseV3(actual,pose,new Map([['target',tex]]),{canvasFactory:createCanvas});
  for(const [x,y]of interiorPrecisionPoints)assert.deepEqual(pixel(actual,x,y),pixel(expected,x,y),`non-affine alpha=${alpha} opacity=${opacity} at ${x},${y}`);
 }
});
test('precision regression normal masks preserve mixed-RGB target and low-alpha source through the common non-affine pipeline',()=>{
 for(const role of ['target','source'])for(const alpha of [1,16,64,128,255])for(const opacity of [1,.5]){
  const target=precisionTexture(role==='target'?alpha:255),source=precisionTexture(role==='source'?alpha:255),targetDraw=precisionDraw('target',role==='target'?opacity:1,true),sourceDraw=precisionDraw('source',role==='source'?opacity:1,true),actual=createCanvas(16,16);
  const pose={backgroundAssetId:null,draws:[targetDraw],blockedParts:[],partIds:['source','target'],maskSources:[sourceDraw],clipRelations:[relation('source','target')]};
  V.drawPoseV3(actual,pose,new Map([['target',target],['source',source]]),{canvasFactory:createCanvas});
  const expected=precisionReference(target,targetDraw.opacity),x=expected.getContext('2d');x.globalCompositeOperation='destination-in';x.drawImage(precisionReference(source,sourceDraw.opacity),0,0);
  for(const [px,py]of interiorPrecisionPoints)assert.deepEqual(pixel(actual,px,py),pixel(expected,px,py),`${role} alpha=${alpha} opacity=${opacity} at ${px},${py}`);
 }
});

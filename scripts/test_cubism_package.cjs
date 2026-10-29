'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), vm = require('node:vm');
const enc = x => new TextEncoder().encode(typeof x === 'string' ? x : JSON.stringify(x));
const clone = x => JSON.parse(JSON.stringify(x));
const MiB = 1024 * 1024;
// Technical 1x1 transparent PNG; no user artwork.
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=', 'base64');
function png(w=1,h=1) { const b=Uint8Array.from(pixel);new DataView(b.buffer).setUint32(16,w);new DataView(b.buffer).setUint32(20,h);return b; }
function manifest() { return {Version:3,FileReferences:{Moc:'model.moc3',Textures:['텍스처/두 번째.png','텍스처/첫 번째.png'],Motions:{Idle:[{File:'motions/idle.motion3.json',Sound:'audio/voice.wav',FadeInTime:0.5},{File:'motions/other.motion3.json'}]},Expressions:[{Name:'미소',File:'exp/smile.exp3.json'}],Physics:'physics.json',Pose:'pose.json',DisplayInfo:'display.json',UserData:'userdata.json'},Groups:[{Target:'Parameter',Name:'EyeBlink',Ids:['ParamEyeLOpen']}],Layout:{CenterX:0},HitAreas:[{Id:'Head',Name:'머리'}]}; }
function fixture(m=manifest(),prefix='모델 폴더/') { return [{path:prefix+'캐릭터.model3.json',bytes:enc(m)},...['model.moc3','텍스처/두 번째.png','텍스처/첫 번째.png','motions/idle.motion3.json','motions/other.motion3.json','audio/voice.wav','exp/smile.exp3.json','physics.json','pose.json','display.json','userdata.json'].map(p=>({path:prefix+p,bytes:p.endsWith('.png')?png():p.endsWith('.json')?enc({Version:3}):enc('opaque')}))]; }
function api() { const f=path.join(__dirname,'../web/src/cubism-package.js');assert(fs.existsSync(f),'SDK-independent package reader implementation is required');return require(f); }
const rejects = (promise,code) => assert.rejects(promise,e=>{assert.equal(e.code,code);return true;});

test('relative_unicode_paths_and_texture_slots',async()=>{
  const files=fixture(), before=files.map(f=>Buffer.from(f.bytes)), P=api();
  files[1].path='모델 폴더/./model.moc3';
  const pkg=await P.readPackage(files);
  assert.equal(pkg.entryPath,'모델 폴더/캐릭터.model3.json');
  assert.deepEqual(pkg.resources.textures.map(r=>[r.path,r.slot,r.width,r.height]),[['모델 폴더/텍스처/두 번째.png',0,1,1],['모델 폴더/텍스처/첫 번째.png',1,1,1]]);
  assert.deepEqual(pkg.resources.motions.map(r=>[r.group,r.index,r.path,r.sound?.path]),[['Idle',0,'모델 폴더/motions/idle.motion3.json','모델 폴더/audio/voice.wav'],['Idle',1,'모델 폴더/motions/other.motion3.json',undefined]]);
  assert.equal(pkg.resources.motions[0].definition.FadeInTime,0.5);
  assert.equal(pkg.resources.expressions[0].name,'미소');
  for(const k of ['physics','pose','displayInfo','userData']) assert(pkg.resources[k].path);
  assert.deepEqual(pkg.manifest.Groups,manifest().Groups);
  assert.equal(pkg.capabilities.packageRead,'verified');assert.equal(pkg.capabilities.actualPlayback,'not-run');
  assert.equal(pkg.capabilities.sdkValidation,'not-run');assert.equal(pkg.capabilities.pngDecode,'not-run');
  files.forEach((f,i)=>assert.deepEqual(Buffer.from(f.bytes),before[i]));
  for(const [p,b] of pkg.files) assert.equal(pkg.hashes[p],crypto.createHash('sha256').update(b).digest('hex'));
});

test('all_declared_resources_required',async()=>{
  const P=api();
  for(let i=1;i<fixture().length;i++){const f=fixture();const missing=f.splice(i,1)[0];await assert.rejects(P.readPackage(f),e=>e.code==='MISSING_RESOURCE'&&e.path===missing.path);}
  for(const field of ['Moc','Textures']){const m=manifest();delete m.FileReferences[field];await rejects(P.readPackage(fixture(m)),'INVALID_MANIFEST');}
  const m=manifest();m.FileReferences.Textures=[];await rejects(P.readPackage(fixture(m)),'INVALID_MANIFEST');
});

test('ambiguous_entry_requires_selection',async()=>{
  const P=api(), f=fixture();f.push({path:'모델 폴더/다른.model3.json',bytes:enc(manifest())});
  await assert.rejects(P.readPackage(f),e=>e.code==='ENTRY_REQUIRED'&&e.entries.length===2&&e.entries[0]==='모델 폴더/다른.model3.json');
  assert.equal((await P.readPackage(f,{entryPath:'모델 폴더/캐릭터.model3.json'})).entryPath,'모델 폴더/캐릭터.model3.json');
  await rejects(P.readPackage([{path:'solo.moc3',bytes:enc('opaque')}]),'MANIFEST_REQUIRED');
  await rejects(P.readPackage(f,{entryPath:'missing.model3.json'}),'ENTRY_NOT_FOUND');
});

test('reject_external_escape_collision_and_limits',async()=>{
  const P=api();
  for(const bad of ['https://evil/x','data:xyz','/x','C:/x','\\\\server\\x','../escape','a/../../escape','a%2fb','a%5Cb','a%252fb','a\0b','a\\b']){
    await rejects(P.readPackage([...fixture(),{path:bad,bytes:enc('x')}]),'INVALID_PATH');
    const m=manifest();m.FileReferences.Moc=bad.includes('..')?'../../../escape.moc3':bad;await rejects(P.readPackage(fixture(m)), 'INVALID_PATH');
  }
  for(const pair of [['a','A'],['é','e\u0301'],['straße','STRASSE'],['x/./a','x/a']])await rejects(P.readPackage([...fixture(),...pair.map(path=>({path,bytes:enc('x')}))]),'PATH_COLLISION');
  await rejects(P.readPackage(Array.from({length:257},(_,i)=>({path:'f'+i,bytes:enc('x')}))),'FILE_COUNT_LIMIT');
  await rejects(P.readPackage([...fixture(),{path:'big',bytes:new Uint8Array(64*MiB+1)}]),'FILE_SIZE_LIMIT');
  const block=new Uint8Array(64*MiB);await rejects(P.readPackage([...fixture(),...Array.from({length:4},(_,i)=>({path:'large'+i,bytes:block}))]),'TOTAL_SIZE_LIMIT');
  await rejects(P.readPackage([...fixture(),{path:'big.json',bytes:new Uint8Array(8*MiB+1)}]),'JSON_SIZE_LIMIT');
  const m=manifest();m.FileReferences.Textures=Array(33).fill('텍스처/첫 번째.png');await rejects(P.readPackage(fixture(m)),'TEXTURE_COUNT_LIMIT');
  const big=fixture();big[2].bytes=png(8193,1);await rejects(P.readPackage(big),'TEXTURE_DIMENSION_LIMIT');
  const total=fixture();total[2].bytes=png(8192,8192);await rejects(P.readPackage(total),'DECODED_SIZE_LIMIT');
});

test('abort_preserves_inputs_and_snapshot_before_first_await',async()=>{
  const P=api(), f=fixture(), original=Buffer.from(f[1].bytes), controller=new AbortController();
  controller.abort();await rejects(P.readPackage(f,{signal:controller.signal}),'ABORTED');assert.deepEqual(Buffer.from(f[1].bytes),original);
  const running=P.readPackage(f);f[1].bytes.fill(0);const pkg=await running;
  assert.deepEqual(Buffer.from(pkg.files.get('모델 폴더/model.moc3')),original);
  const f2=fixture(), c2=new AbortController(), pending=P.readPackage(f2,{signal:c2.signal});c2.abort();await rejects(pending,'ABORTED');
  assert.equal(new TextDecoder().decode(f2[1].bytes),'opaque');
});

test('consumer_mutations_cannot_invalidate_trusted_package_hashes',async()=>{
  const pkg=await api().readPackage(fixture()), p='모델 폴더/model.moc3', h=pkg.hashes[p];
  pkg.files.get(p).fill(0);pkg.files.set(p,enc('replacement'));pkg.files.clear();pkg.resources.moc.bytes.fill(0);
  assert.equal(new TextDecoder().decode(pkg.files.get(p)),'opaque');assert.equal(new TextDecoder().decode(pkg.resources.moc.bytes),'opaque');
  assert.equal(crypto.createHash('sha256').update(pkg.files.get(p)).digest('hex'),h);
  assert.throws(()=>{pkg.hashes[p]='fake';},TypeError);assert.throws(()=>{pkg.manifest.Version=4;},TypeError);
});

test('json_schema_header_validation_and_unknown_features',async()=>{
  const P=api();
  for(const edit of [m=>m.Version=2,m=>m.FileReferences.Moc=4,m=>m.Layout={X:'bad'},m=>m.Groups=[{Target:'Parameter',Name:'EyeBlink',Ids:[4]}],m=>m.HitAreas=[{Id:2,Name:'bad'}],m=>m.FileReferences.Motions.Idle[0].FadeInTime='bad',m=>m.FileReferences.Expressions[0].Name=5]){const m=manifest();edit(m);await rejects(P.readPackage(fixture(m)),'INVALID_MANIFEST');}
  for(const raw of ['{"Version":1e400}','{"Version":3,','[]', '{"__proto__":{}}']){const f=fixture();f[0].bytes=enc(raw);await rejects(P.readPackage(f),'INVALID_JSON');}
  const deep=fixture();let v={};for(let i=0;i<26;i++)v={child:v};deep.push({path:'deep.json',bytes:enc(v)});await rejects(P.readPackage(deep),'JSON_DEPTH_LIMIT');
  const corrupt=fixture();corrupt[2].bytes=enc('not PNG');await rejects(P.readPackage(corrupt),'INVALID_PNG');
  const m=manifest();m.FutureSetting={Keep:true};m.FileReferences.FutureResource='future.bin';const pkg=await P.readPackage(fixture(m));
  assert.deepEqual(pkg.manifest.FutureSetting,{Keep:true});assert(pkg.warnings.some(w=>w.code==='UNKNOWN_FEATURE'));assert.equal(pkg.capabilities.unknownFeatures,'unsupported');
  const f=fixture();f[5].bytes=enc('{bad');await rejects(P.readPackage(f),'INVALID_JSON');
});

test('browser_umd_and_safe_parent_relative_references',async()=>{
  const P=api(), m=manifest();m.FileReferences.Moc='../shared.moc3';const f=fixture(m);f.push({path:'shared.moc3',bytes:enc('shared')});
  assert.equal((await P.readPackage(f)).resources.moc.path,'shared.moc3');
  const context={TextEncoder,TextDecoder,Uint8Array,DataView,crypto:crypto.webcrypto};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/src/cubism-package.js'),'utf8'),context);
  assert.equal((await context.PankekiCubismPackage.readPackage(f)).resources.moc.path,'shared.moc3');
});

test('uppercase_sharp_s_collision',async()=>{
  const P=api();
  await rejects(P.readPackage([...fixture(),{path:'ẞ',bytes:enc('a')},{path:'ss',bytes:enc('b')}]),'PATH_COLLISION');
});
test('json_references_without_json_extension_still_require_json',async()=>{
  const P=api();
  const m=manifest();m.FileReferences.Physics='physics.bin';const f=fixture(m);f.push({path:'모델 폴더/physics.bin',bytes:enc('not json')});
  await rejects(P.readPackage(f),'INVALID_JSON');
});

test('inclusive_file_texture_dimension_and_decoded_budget_boundaries',async()=>{
  const P=api(), f=fixture();
  while(f.length<256)f.push({path:'extra/'+f.length,bytes:enc('x')});
  assert.equal((await P.readPackage(f)).files.size,256);
  const m=manifest();m.FileReferences.Textures=Array(32).fill('텍스처/첫 번째.png');
  assert.equal((await P.readPackage(fixture(m))).resources.textures.length,32);
  m.FileReferences.Textures=['텍스처/두 번째.png'];const big=fixture(m);big[2].bytes=png(8192,8192);
  const pkg=await P.readPackage(big);assert.equal(pkg.resources.textures[0].width,8192);assert.equal(pkg.resources.textures[0].height,8192);
  assert.equal(pkg.capabilities.pngDecode,'not-run');
});

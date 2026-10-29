'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const pickerModule=require('../video-scene-picker.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'pankeki-video-scene-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,grants:path.join(root,'runtime/video/scene-grants')};}
test('a selected blend grants only an opaque ID and binds the original file bytes',async t=>{
  assert.equal(typeof pickerModule.createVideoScenePicker,'function');
  const {root,grants}=fixture(t),scene=path.join(root,'선택한 구도.blend');fs.writeFileSync(scene,'BLENDER-v300scene');
  const pick=pickerModule.createVideoScenePicker({projectRoot:root,chooseFile:async()=>({canceled:false,filePaths:[scene]})});
  const result=await pick();
  assert.deepEqual(Object.keys(result).sort(),['name','scene_id']);assert.match(result.scene_id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);assert.equal(result.name,'선택한 구도.blend');
  const grantPath=path.join(grants,result.scene_id+'.json'),grant=JSON.parse(fs.readFileSync(grantPath));
  assert.equal(grant.version,1);assert.equal(grant.scene_path,fs.realpathSync(scene));assert.equal(grant.name,'선택한 구도.blend');assert.equal(grant.size,17);
  assert.equal(grant.mtime_ns,fs.statSync(scene,{bigint:true}).mtimeNs.toString());assert.equal(grant.sha256,crypto.createHash('sha256').update('BLENDER-v300scene').digest('hex'));
  assert.ok(Math.abs(Date.now()-Date.parse(grant.created_at))<10000);assert.equal(fs.statSync(grantPath).mode&0o777,0o600);assert.deepEqual(fs.readdirSync(grants),[result.scene_id+'.json']);
});
test('canceling the native picker does not create a grant',async t=>{
  assert.equal(typeof pickerModule.createVideoScenePicker,'function');const {root,grants}=fixture(t);
  const pick=pickerModule.createVideoScenePicker({projectRoot:root,chooseFile:async()=>({canceled:true,filePaths:[]})});assert.equal(await pick(),null);assert.equal(fs.existsSync(grants),false);
});
test('directories, symbolic links, wrong extensions, and oversized files cannot grant file access',async t=>{
  assert.equal(typeof pickerModule.createVideoScenePicker,'function');const {root,grants}=fixture(t);
  const real=path.join(root,'real.blend');fs.writeFileSync(real,'BLENDER-v300');const linked=path.join(root,'link.blend');fs.symlinkSync(real,linked);
  const dir=path.join(root,'directory.blend');fs.mkdirSync(dir);const wrong=path.join(root,'plain.txt');fs.writeFileSync(wrong,'BLENDER-v300');
  const huge=path.join(root,'huge.blend');const fd=fs.openSync(huge,'w');fs.ftruncateSync(fd,128*1024*1024+1);fs.closeSync(fd);
  for(const scene of [linked,dir,wrong,huge]){
    const pick=pickerModule.createVideoScenePicker({projectRoot:root,chooseFile:async()=>({canceled:false,filePaths:[scene]})});await assert.rejects(pick(),/invalid-video-scene/);
  }
  assert.equal(fs.existsSync(grants),false);
});
test('a second picker cannot replace the pending native choice',async t=>{
  assert.equal(typeof pickerModule.createVideoScenePicker,'function');const {root}=fixture(t);let resolve;
  const pick=pickerModule.createVideoScenePicker({projectRoot:root,chooseFile:()=>new Promise(done=>{resolve=done;})});
  const pending=pick();await assert.rejects(pick(),/busy/);resolve({canceled:true,filePaths:[]});assert.equal(await pending,null);
});

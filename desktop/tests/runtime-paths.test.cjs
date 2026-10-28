'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {resolveRuntime,saveProjectRoot,REQUIRED}=require('../runtime-paths.cjs');
test('missing external checkout gives a bounded recoverable dependency error',()=>{
  assert.throws(()=>resolveRuntime({projectRoot:'/nonexistent Pankeki test'}),/runtime-missing/);
});
test('external checkout with spaces resolves without copying runtime or auth',t=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'Pankeki 한글 space ')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const file of ['.venv-macos/bin/python','pankeki/__main__.py','web/index.html','runtime/macos/config.json','runtime/macos/model-paths.yaml','vendor/ComfyUI/main.py']){
    const p=path.join(root,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'');
  }
  const result=resolveRuntime({projectRoot:root,codexPath:null});assert.equal(result.projectRoot,fs.realpathSync(root));
  assert.equal(result.config,path.join(root,'runtime/macos/config.json'));assert.equal(result.codexPath,null);
  assert.equal(fs.existsSync(path.join(root,'auth.json')),false);
});

function fakeCheckout(t,label){
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'Pankeki '+label+' ')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const file of REQUIRED){const p=path.join(root,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'');}
  return root;
}
function tempDir(t){const d=fs.mkdtempSync(path.join(os.tmpdir(),'pankeki-settings-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;}
const isolated={codexPath:null,resourcesPath:undefined};
test('a moved checkout is found through PANKEKI_PROJECT_ROOT before a stale bundled path',t=>{
  const moved=fakeCheckout(t,'moved'),resources=tempDir(t);
  fs.writeFileSync(path.join(resources,'runtime.json'),JSON.stringify({projectRoot:'/Volumes/Old Drive/Pankeki'}));
  const result=resolveRuntime({...isolated,resourcesPath:resources,env:{PANKEKI_PROJECT_ROOT:moved}});
  assert.equal(result.projectRoot,moved);assert.equal(result.rootSource,'environment');
});
test('a saved folder choice is used when the bundled build path no longer exists',t=>{
  const moved=fakeCheckout(t,'saved'),settings=tempDir(t),resources=tempDir(t);
  fs.writeFileSync(path.join(resources,'runtime.json'),JSON.stringify({projectRoot:'/Volumes/Old Drive/Pankeki'}));
  saveProjectRoot(settings,moved);
  const result=resolveRuntime({...isolated,resourcesPath:resources,settingsDir:settings,env:{}});
  assert.equal(result.projectRoot,moved);assert.equal(result.rootSource,'saved');
  assert.equal((fs.statSync(path.join(settings,'project-root.json')).mode&0o777),0o600);
});
test('the bundled path still works when it is valid',t=>{
  const built=fakeCheckout(t,'built'),resources=tempDir(t);
  fs.writeFileSync(path.join(resources,'runtime.json'),JSON.stringify({projectRoot:built}));
  const result=resolveRuntime({...isolated,resourcesPath:resources,settingsDir:tempDir(t),env:{}});
  assert.equal(result.projectRoot,built);assert.equal(result.rootSource,'bundled');
});
test('an explicit argument never falls through and incomplete folders are refused',t=>{
  const moved=fakeCheckout(t,'explicit');
  assert.throws(()=>resolveRuntime({...isolated,projectRoot:'/nonexistent Pankeki',env:{PANKEKI_PROJECT_ROOT:moved}}),/runtime-missing/);
  fs.rmSync(path.join(moved,'vendor/ComfyUI/main.py'));
  assert.throws(()=>resolveRuntime({...isolated,projectRoot:moved}),/runtime-missing/);
  assert.throws(()=>saveProjectRoot(tempDir(t),moved),/runtime-missing/);
  assert.throws(()=>saveProjectRoot(tempDir(t),'relative/path'),/runtime-missing/);
});

'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
function api(){const file=path.join(__dirname,'../build-identity.cjs');assert.ok(fs.existsSync(file),'build identity module is absent');return require(file);}
// Project venv Python: macOS /usr/bin/python3 is an Xcode shim that fails until its license is accepted.
const PYTHON=process.env.PANKEKI_TEST_PYTHON||path.join(__dirname,'../../.venv-macos/bin/python');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'pankeki-build-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));for(const [name,data]of Object.entries({'main.cjs':'module.exports=1;\n','preload.cjs':'// narrow IPC\n','shell.html':'<html>shell</html>'}))fs.writeFileSync(path.join(root,name),data);return root;}
test('executing bundle bytes determine identity independently from release flags',t=>{
  const root=fixture(t),{bundleContentId}=api(),before=bundleContentId(root);
  assert.match(before,/^[0-9a-f]{64}$/);
  fs.writeFileSync(path.join(root,'package.json'),'{"version":"99","source_id":"'+'a'.repeat(64)+'"}');
  assert.equal(bundleContentId(root),before);
  fs.writeFileSync(path.join(root,'main.cjs'),'module.exports=2;\n');assert.notEqual(bundleContentId(root),before);
});
test('missing or linked bundle input is unknown',t=>{
  const root=fixture(t),{bundleContentId}=api();fs.unlinkSync(path.join(root,'preload.cjs'));assert.equal(bundleContentId(root),null);
  fs.symlinkSync(path.join(root,'main.cjs'),path.join(root,'preload.cjs'));assert.equal(bundleContentId(root),null);
});
test('Python source expectation and actual Electron bundle use the same byte framing',t=>{
  const root=fixture(t),{bundleContentId}=api();fs.writeFileSync(path.join(root,'extra.cjs'),'const 이름="팬케키";\n');
  const {execFileSync}=require('node:child_process');
  const expected=execFileSync(PYTHON,['-c','from pankeki.build_identity import desktop_content_id; import sys; print(desktop_content_id(sys.argv[1]))',root],{cwd:path.join(__dirname,'../..'),env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},encoding:'utf8'}).trim();
  assert.equal(bundleContentId(root),expected);
});
test('backend status and actual bundle identity are retained as separate observations',async t=>{
  const root=fixture(t),{readBuildStatus,bundleContentId}=api();
  const result=await readBuildStatus({bundleDirectory:root,fetchHealth:async()=>({build:{schema:1,source_id:'a'.repeat(64),html_source_id:'b'.repeat(64),html_sha256:'c'.repeat(64),desktop_source_id:'d'.repeat(64),status:'match'}})});
  assert.equal(result.source_id,'a'.repeat(64));assert.equal(result.html_source_id,'b'.repeat(64));
  assert.equal(result.status,'mismatch');assert.equal(result.bundle_status,'mismatch');assert.equal(result.electron_bundle_id,bundleContentId(root));
});
test('unavailable backend and invalid identifiers never copy the bundle ID into source fields',async t=>{
  const root=fixture(t),{readBuildStatus}=api();
  for(const fetchHealth of [async()=>{throw Error('offline');},async()=>({build:{schema:1,source_id:'/Users/private',html_source_id:'a'.repeat(64),desktop_source_id:'g'.repeat(64)}})]){
    const result=await readBuildStatus({bundleDirectory:root,fetchHealth});assert.equal(result.status,'unknown');assert.equal(result.bundle_status,'unknown');assert.equal(result.source_id,null);assert.equal(result.desktop_source_id,null);assert.match(result.electron_bundle_id,/^[0-9a-f]{64}$/);
  }
});
test('startup bundle observation survives path replacement and reader instances do not share fixture state',async t=>{
  const root=fixture(t),{createBuildStatusReader,bundleContentId}=api();assert.equal(typeof createBuildStatusReader,'function');
  const start=bundleContentId(root),fetchHealth=async()=>({build:{schema:1,source_id:'a'.repeat(64),process_source_id:'c'.repeat(64),html_source_id:'a'.repeat(64),desktop_source_id:bundleContentId(root)}});
  const first=createBuildStatusReader({bundleDirectory:root,fetchHealth});assert.equal((await first()).electron_bundle_id,start);
  fs.writeFileSync(path.join(root,'main.cjs'),'// replaced after application boot');
  const old=await first();assert.equal(old.electron_bundle_id,start);assert.equal(old.bundle_status,'mismatch');assert.equal(old.process_source_id,'c'.repeat(64));assert.equal(old.process_status,'mismatch');
  const second=createBuildStatusReader({bundleDirectory:root,fetchHealth});assert.equal((await second()).bundle_status,'match');
  assert.notEqual((await second()).electron_bundle_id,start);assert.equal((await first()).electron_bundle_id,start);
  const unknown=createBuildStatusReader({bundleDirectory:root,electronBundleId:null,fetchHealth});assert.equal((await unknown()).electron_bundle_id,null);
});
test('IPC awaits asynchronous app information instead of returning an unresolved promise',async()=>{
  const {createIpcController}=require('../ipc.cjs');
  const controller=createIpcController({bridge:{status:()=>({state:'idle'})},getAppStatus:async()=>({version:'0.1.0',build:{source_id:null}}),isTrusted:()=>true});
  const result=await controller.invoke('getStatus',true);assert.deepEqual(result.app,{version:'0.1.0',build:{source_id:null}});
});
test('app information compares the current renderer marker separately and reports unknowns',()=>{
  const ui=require('../../web/src/desktop-chat.js');assert.equal(typeof ui.buildInformation,'function');
  const match=ui.buildInformation({source_id:'a'.repeat(64),html_source_id:'a'.repeat(64),desktop_source_id:'b'.repeat(64),electron_bundle_id:'b'.repeat(64)},'a'.repeat(64));
  assert.equal(match.htmlStatus,'match');assert.equal(match.rendererStatus,'match');assert.equal(match.bundleStatus,'match');
  const stale=ui.buildInformation({source_id:'a'.repeat(64),html_source_id:'a'.repeat(64),desktop_source_id:'b'.repeat(64),electron_bundle_id:'c'.repeat(64)},'d'.repeat(64));
  assert.equal(stale.rendererStatus,'mismatch');assert.equal(stale.bundleStatus,'mismatch');
  const absent=ui.buildInformation({},null);assert.equal(absent.rendererStatus,'unknown');assert.equal(absent.bundleStatus,'unknown');
  assert.equal(absent.processStatus,'unknown');
  const changedProcess=ui.buildInformation({source_id:'a'.repeat(64),process_source_id:'b'.repeat(64)},null);assert.equal(changedProcess.processStatus,'mismatch');assert.equal(changedProcess.processSourceId,'b'.repeat(64));
});

test('shared validator has the same logical filename and independent bytes in source and packaged bundle',t=>{
 const source=fixture(t),web=path.resolve(source,'../web-'+path.basename(source)),packaged=fixture(t),{bundleContentId}=api();
 // A project-shaped fixture is separate from the generic arbitrary bundle fixture.
 const project=fs.mkdtempSync(path.join(os.tmpdir(),'pankeki-shared-'));t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
 fs.mkdirSync(path.join(project,'desktop'));fs.mkdirSync(path.join(project,'web/src'),{recursive:true});
 for(const name of ['main.cjs','preload.cjs','shell.html'])fs.copyFileSync(path.join(source,name),path.join(project,'desktop',name));
 fs.writeFileSync(path.join(project,'web/src/profiles.js'),'shared-validator-v1');
 for(const name of ['main.cjs','preload.cjs','shell.html'])fs.copyFileSync(path.join(source,name),path.join(packaged,name));
 fs.copyFileSync(path.join(project,'web/src/profiles.js'),path.join(packaged,'profiles.cjs'));
 assert.equal(bundleContentId(path.join(project,'desktop')),bundleContentId(packaged));
 const {execFileSync}=require('node:child_process'),python=directory=>execFileSync(PYTHON,['-c','from pankeki.build_identity import desktop_content_id; import sys; print(desktop_content_id(sys.argv[1]))',directory],{cwd:path.resolve(__dirname,'../..'),env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},encoding:'utf8'}).trim();
 assert.equal(python(path.join(project,'desktop')),bundleContentId(packaged));
 const before=bundleContentId(packaged);fs.writeFileSync(path.join(project,'web/src/profiles.js'),'shared-validator-v2');
 assert.notEqual(bundleContentId(path.join(project,'desktop')),before);assert.equal(bundleContentId(packaged),before);
});

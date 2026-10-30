'use strict';
// Exception boundaries from the Codex independent review of the Windows port (rev2, 2026-10-29):
// an MCP adapter whose initialize fails and whose stop is refused, and an owned launcher that exits
// while the identity check is awaiting netstat. Production files are loaded in a VM with
// process.platform='win32' and fake children only: nothing real is spawned, killed or listened on.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {test}=require('node:test'),{createRequire}=require('node:module'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const desktop=path.join(__dirname,'..');
const platform=require('../platform.cjs');
function load(relative,overrides={}){
  const filename=path.join(desktop,relative),nativeRequire=createRequire(filename),module={exports:{}};
  const deny=()=>{throw Error('test forbids real child processes');};
  const sandbox={module,exports:module.exports,__dirname:path.dirname(filename),__filename:filename,Buffer,console,setTimeout,clearTimeout,structuredClone,
    process:{platform:'win32',env:{}},
    require:specifier=>Object.hasOwn(overrides,specifier)?overrides[specifier]:specifier==='node:child_process'?{spawn:deny,execFile:deny}
      :specifier==='node:fs'?{...fs,mkdirSync(){}}:nativeRequire(specifier)};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),sandbox,{filename});return module.exports;
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fakeChild(pid,{failInitialize=false}={}){
  const c=new EventEmitter();Object.assign(c,{pid,exitCode:null,signalCode:null,stdout:new PassThrough(),stderr:new PassThrough()});
  c.stdin={writable:true,end(){this.writable=false;},write(raw){const m=JSON.parse(raw);if(!m.id)return;
    queueMicrotask(()=>c.stdout.emit('data',JSON.stringify({id:m.id,...(failInitialize&&m.method==='initialize'?{error:{message:'initialize failed'}}
      :{result:m.method==='initialize'?{}:{structuredContent:{app_reachable:true}}})})+'\n'));}};
  return c;
}
// taskkill that never manages to stop anything (access denied, tool missing, ...)
const refusingPlatform={...platform,stopProcessTree:(proc,ms)=>platform.stopProcessTree(proc,ms,{killTree:async()=>false})};
const exit=c=>{c.exitCode=1;c.emit('exit',1,null);};
function runner(tools,spawned,options){
  return tools.createToolRunner({projectRoot:'/fake',paths:{inputs:'/fake/input',state:'/fake/state',work:'/fake/work'},mcpCommand:()=>({command:'fake',args:[],env:{}}),
    spawnImpl:()=>{const c=fakeChild(100+spawned.length,options);spawned.push(c);return c;},limits:{request:20,tool:20,close:10,drain:10},emit(){},current:()=>true,log(){}});
}
const ref={projectId:'project-a',requestId:'request-a',action:'chat',jobs:new Set()};

for(const file of ['pankeki-tools.cjs']){
  test(`${file}: initialize failure + refused stop keeps the adapter, close reports it, and no second adapter starts`,async()=>{
    const tools=load(file,{'./platform.cjs':refusingPlatform}),spawned=[];const r=runner(tools,spawned,{failInitialize:true});
    await assert.rejects(r.runTool(ref,'pankeki_status',{}));await delay(30);
    await assert.rejects(r.runTool(ref,'pankeki_status',{}));
    assert.equal(spawned.length,1,'no replacement beside a live adapter');
    await assert.rejects(r.close(),error=>error.code==='stop-failed');
    assert.equal(spawned.length,1);
  });
  test(`${file}: once the failed adapter really exits, the project recovers with a new adapter`,async()=>{
    const tools=load(file,{'./platform.cjs':refusingPlatform}),spawned=[];const r=runner(tools,spawned,{failInitialize:true});
    await assert.rejects(r.runTool(ref,'pankeki_status',{}));await delay(30);
    exit(spawned[0]);
    await assert.rejects(r.runTool(ref,'pankeki_status',{}));   // new adapter starts (and fails initialize again)
    assert.equal(spawned.length,2,'a confirmed exit is the only thing that frees the slot');
  });
}

function winPaths(){const w=path.win32,r='D:\\내 작업\\Pankeki';return {platform:'win32',projectRoot:r,python:w.join(r,'.venv-windows','Scripts','python.exe'),
  config:w.join(r,'runtime','windows','config.json'),modelPaths:w.join(r,'runtime','windows','model-paths.yaml'),comfyRoot:w.join(r,'vendor','ComfyUI'),runtime:w.join(r,'runtime','windows','desktop-codex')};}
function listener(kind,pid,p,ancestors=[]){return {pid,loopback:true,created:'2026-10-29T06:00:00.0000000Z',executable:'C:\\Python312\\python.exe',ancestors,
  command:kind==='pankeki'?`"C:\\Python312\\python.exe" -u -m pankeki serve --port 8190 --config "${p.config}"`
    :`"C:\\Python312\\python.exe" -u "${path.win32.join(p.comfyRoot,'main.py')}" --listen 127.0.0.1 --port 8188 --extra-model-paths-config "${p.modelPaths}"`};}
function ownedManager({onFastInspect}={}){
  const b=load('backend-manager.cjs'),p=winPaths(),live={},children={};
  const manager=b.createBackendManager({paths:p,probe:async()=>true,killTree:async c=>{queueMicrotask(()=>exit(c));return true;},
    launch:(_exe,args)=>{const kind=args.includes('serve')?'pankeki':'comfy';const c=fakeChild(kind==='comfy'?300:304);children[kind]=c;live[kind]=listener(kind,c.pid+1000,p,[c.pid]);return c;},
    inspectListener:async(kind,options)=>{if(options?.full===false){onFastInspect?.(kind,children,live);return {pid:live[kind].pid,loopback:true};}return live[kind]||null;}});
  return {manager,children,live};
}
test('owned launcher exiting while netstat is awaited does not authorize the same PID',async()=>{
  let expire=false;
  const {manager,children}=ownedManager({onFastInspect:(kind,kids)=>{if(expire&&kind==='pankeki')exit(kids.pankeki);}});
  await manager.start();assert.equal(await manager.verifyIdentity(),true);
  expire=true;assert.equal(await manager.verifyIdentity(),false);
  assert.equal(children.pankeki.exitCode,1);
});
test('a known-dead owned launcher fails verification even if something listens on the old PID',async()=>{
  const {manager,children}=ownedManager();
  await manager.start();exit(children.comfy);
  assert.equal(await manager.verifyIdentity(),false);
});
test('close during an in-flight verification makes it fail closed',async()=>{
  let closeNow;const {manager}=ownedManager({onFastInspect:kind=>{if(closeNow&&kind==='pankeki'){closeNow();closeNow=null;}}});
  await manager.start();
  const closed=new Promise(resolve=>{closeNow=()=>resolve(manager.close());});
  const result=await manager.verifyIdentity();await closed;
  assert.equal(result,false);
});

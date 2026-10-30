'use strict';
const {test,after}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createBackendManager,listenerMatches}=require('../backend-manager.cjs');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'Pankeki backend 한글 '));after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
const paths={projectRoot:'/external drive/Pankeki',python:'/external drive/Pankeki/.venv-macos/bin/python',
  config:'/external drive/Pankeki/runtime/macos/config.json',modelPaths:'/external drive/Pankeki/runtime/macos/model-paths.yaml',
  comfyRoot:'/external drive/Pankeki/vendor/ComfyUI',runtime:temporary};
function fakeChild(pid){const child=new EventEmitter();child.pid=pid;child.exitCode=null;child.signalCode=null;child.kill=signal=>{child.signalCode=signal;queueMicrotask(()=>child.emit('exit',null,signal));return true;};return child;}
function identity(kind,pid){return {pid,cwd:kind==='pankeki'?paths.projectRoot:paths.comfyRoot,loopback:true,
  command:kind==='pankeki'?`${paths.python} -u -m pankeki serve --port 8190 --config ${paths.config}`:`${paths.python} -u main.py --listen 127.0.0.1 --port 8188`};}
test('occupied localhost port from a different checkout blocks without a launch',async()=>{
  let launches=0;const manager=createBackendManager({paths,inspectListener:async()=>({pid:7,command:'python -m pankeki serve',cwd:'/foreign',loopback:true}),
    probe:async()=>true,launch:()=>{launches++;return fakeChild(9);}});
  await assert.rejects(manager.start(),/occupied/);assert.equal(launches,0);
});
test('healthy verified external services survive desktop close',async()=>{
  let launches=0;const manager=createBackendManager({paths,
    inspectListener:async kind=>({pid:kind==='pankeki'?7:8,cwd:kind==='pankeki'?paths.projectRoot:paths.comfyRoot,loopback:true,
      command:kind==='pankeki'?`${paths.python} -u -m pankeki serve --port 8190 --comfy-url http://127.0.0.1:8188 --config ${paths.config}`:`${paths.python} -u main.py --listen 127.0.0.1 --port 8188`}),
    probe:async()=>true,launch:()=>{launches++;return fakeChild(9);}});
  await manager.start();assert.equal(manager.status().pankeki.ownership,'external');await manager.close();assert.equal(launches,0);
  assert.equal(manager.status().comfy.ownership,'external');
});
test('owned launch preserves space-containing args and closes only its child handles',async()=>{
  const calls=[];const children=[];const live={};const manager=createBackendManager({paths,inspectListener:async kind=>live[kind]||null,probe:async()=>true,
    launch:(exe,args,options)=>{calls.push({exe,args,options});const child=fakeChild(children.length+20);children.push(child);live[args.includes('serve')?'pankeki':'comfy']=identity(args.includes('serve')?'pankeki':'comfy',child.pid);return child;}});
  await manager.start();assert.equal(manager.status().pankeki.ownership,'app');
  assert.equal(calls[1].exe,paths.python);assert.ok(calls[1].args.includes(paths.config));assert.equal(calls[1].options.shell,false);
  await manager.close();assert.equal(children[0].signalCode,'SIGINT');assert.equal(children[1].signalCode,'SIGINT');
});
test('clean Comfy launch prepares its runtime directories before spawn and preserves existing input',async()=>{
  const freshPaths={...paths,runtime:path.join(temporary,'fresh native runtime')};
  const existingInput=path.join(freshPaths.runtime,'comfy-input','existing-user-input.png');
  fs.mkdirSync(path.dirname(existingInput),{recursive:true});fs.writeFileSync(existingInput,'preserved user input');
  const live={},children=[];
  const manager=createBackendManager({paths:freshPaths,inspectListener:async kind=>live[kind]||null,probe:async()=>true,
    launch:(_exe,args)=>{
      for(const name of ['user','input','output','temp'])assert.equal(fs.statSync(path.join(freshPaths.runtime,'comfy-'+name)).isDirectory(),true);
      assert.equal(fs.readFileSync(existingInput,'utf8'),'preserved user input');
      const child=fakeChild(children.length+50),kind=args.includes('serve')?'pankeki':'comfy';
      children.push(child);live[kind]=identity(kind,child.pid);return child;
    }});
  try{await manager.start();assert.equal(children.length,2);assert.equal(manager.status().comfy.state,'ready');}
  finally{await manager.close();}
  assert.equal(fs.readFileSync(existingInput,'utf8'),'preserved user input');
});
test('partial startup failure reaps the already owned child',async()=>{
  const child=fakeChild(22);let count=0;
  const manager=createBackendManager({paths,inspectListener:async kind=>count&&kind==='comfy'?identity('comfy',22):null,probe:async()=>true,launch:()=>{if(++count===2)throw Error('cannot start');return child;}});
  await assert.rejects(manager.start(),/cannot start/);assert.equal(child.signalCode,'SIGINT');
});
test('a port replacement between initial inspection and ready cannot be reused',async()=>{
  let checks=0;const manager=createBackendManager({paths,inspectListener:async kind=>identity(kind,++checks>2?99:kind==='comfy'?8:7),probe:async()=>true});
  await assert.rejects(manager.start(),/identity-changed/);
});
test('SIGINT refusal waits for owned SIGTERM exit before reporting stopped',async()=>{
  const live={};const signals=[];const children=[];
  const manager=createBackendManager({paths,inspectListener:async kind=>live[kind]||null,probe:async()=>true,shutdownTimeouts:{interrupt:1,terminate:100,kill:100},
    launch:(_exe,args)=>{const child=new EventEmitter();child.pid=children.length+30;child.exitCode=null;child.signalCode=null;
      child.kill=signal=>{signals.push(signal);if(signal==='SIGTERM')setTimeout(()=>{child.signalCode=signal;child.emit('exit',null,signal);},10);return true;};
      const kind=args.includes('serve')?'pankeki':'comfy';live[kind]=identity(kind,child.pid);children.push(child);return child;}});
  await manager.start();await manager.close();assert.equal(signals.filter(s=>s==='SIGTERM').length,2);
  assert.equal(children.every(c=>c.signalCode==='SIGTERM'),true);assert.equal(manager.status().pankeki.ownership,'none');
});
test('Quit during pending startup cannot spawn the next backend after close',async()=>{
  let release,launched;const waitHealth=new Promise(resolve=>{release=resolve;});const childStarted=new Promise(resolve=>{launched=resolve;});
  let count=0;const child=fakeChild(40);
  const manager=createBackendManager({paths,inspectListener:async()=>null,probe:async()=>waitHealth,
    launch:()=>{count++;launched();return child;}});
  const starting=manager.start().catch(error=>error);
  await childStarted;await manager.close();release(true);
  const error=await starting;assert.match(error.message,/startup-canceled/);assert.equal(count,1);assert.equal(child.signalCode,'SIGINT');
});
test('process identity rejects wildcard listeners and config-prefix lookalikes',()=>{
  const listener={pid:8,cwd:paths.projectRoot,loopback:true,command:`python -m pankeki serve --config ${paths.config}.evil`};
  assert.equal(listenerMatches('pankeki',listener,paths),false);
  assert.equal(listenerMatches('pankeki',{...listener,loopback:false},paths),false);
});

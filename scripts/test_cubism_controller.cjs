'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {readPackage}=require('../web/src/cubism-package.js');
let api={}; try { api=require('../web/src/cubism-controller.js'); } catch(e) { if(e.code!=='MODULE_NOT_FOUND') throw e; }
const SDK={coreVersion:'fake-runtime-fixture-only',coreHash:'1'.repeat(64),frameworkCommit:'2'.repeat(40),bundleHash:'3'.repeat(64)};
const deferred=()=>{let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject};};
const turn=async()=>{for(let i=0;i<12;i++) await new Promise(r=>setImmediate(r));};
function fakeClock(){let id=0,time=0; const raf=new Map(),timers=new Map(); return {raf,timers,now:()=>time,request:cb=>{raf.set(++id,cb);return id;},cancel:h=>raf.delete(h),setTimeout:(cb,delay)=>{timers.set(++id,{cb,due:time+delay});return id;},clearTimeout:h=>timers.delete(h),frame(ms){time=ms; const jobs=[...raf.values()];raf.clear();jobs.forEach(cb=>cb(ms));},advance(ms){time+=ms;for(const [h,t] of [...timers])if(t.due<=time){timers.delete(h);t.cb();}}};}
function canvas(){const events=new Map();return {addEventListener:(n,f)=>events.set(n,f),removeEventListener:(n,f)=>{if(events.get(n)===f)events.delete(n);},lose(){events.get('webglcontextlost')?.({preventDefault(){}});},events};}
function runtime(options={}){let dead=false,disposeCount=0; const values={Angle:0}; const calls=[]; const ownCanvas=canvas(); const settings={mode:'inspection',motion:null,expression:null,effects:{blink:true,physics:true,pose:true}};
 return {calls,settings,canvas:ownCanvas,get dead(){return dead;},get disposeCount(){return disposeCount;},get ownedResources(){return dead?0:2;},async load(pkg){calls.push(['load',pkg.entryPath]);if(options.load)await options.load; if(options.loadFail)throw Object.assign(new Error('decode'),{code:'DECODE_FAILED'});},async drawFirstFrame(){calls.push(['first']);if(options.first)await options.first;if(options.firstFail)throw Object.assign(new Error('first draw'),{code:'DRAW_FAILED'});},getCanvas:()=>ownCanvas,diagnostics:()=>({sdk:Object.hasOwn(options,'sdk')?options.sdk:SDK}),parameters:()=>[{id:'Angle',min:-30,max:30,default:0,type:'normal',repeat:false,value:values.Angle}],setParameter(id,v){if(id!=='Angle'||v < -30||v>30)throw Object.assign(new Error('parameter'),{code:'INVALID_PARAMETER'});values[id]=v;calls.push(['parameter',id,v]);},setMode(v){settings.mode=v;calls.push(['mode',v]);},playMotion(group,index,{loop}){if(group!=='Idle')throw Object.assign(new Error('motion'),{code:'INVALID_MOTION'});settings.motion={group,index,loop};calls.push(['motion',group,index,loop]);},setExpression(v){if(v==='missing')throw Object.assign(new Error('expression'),{code:'INVALID_EXPRESSION'});settings.expression=v;calls.push(['expression',v]);},setEffects(v){settings.effects={...v};calls.push(['effects',v]);},reset(){values.Angle=0;settings.motion=null;settings.expression=null;calls.push(['reset']);},update(dt){calls.push(['update',dt]);if(options.updateFail)throw Object.assign(new Error('update'),{code:'UPDATE_FAILED'});},draw(){calls.push(['draw']);if(options.drawFail)throw Object.assign(new Error('draw'),{code:'DRAW_FAILED'});},dispose(){disposeCount++;assert.equal(dead,false,'controller must dispose each candidate at most once');dead=true;calls.push(['dispose']);}};
}
async function pkg(tag='a', names={}) {
 const entry=names.entry || 'model.model3.json', moc=names.moc || 'model.moc3';
 const directory=entry.includes('/')?entry.slice(0,entry.lastIndexOf('/')+1):'';
 const bytes=new Uint8Array(33);bytes.set([137,80,78,71,13,10,26,10]);
 new DataView(bytes.buffer).setUint32(8,13);bytes.set([73,72,68,82],12);
 new DataView(bytes.buffer).setUint32(16,1);new DataView(bytes.buffer).setUint32(20,1);
 return readPackage([
  {path:entry,bytes:Buffer.from(JSON.stringify({Version:3,FileReferences:{Moc:moc,Textures:['a.png']}}))},
  {path:directory+moc,bytes:Buffer.from(tag)},
  {path:directory+'a.png',bytes},
  ...(names.extra?[{path:directory+names.extra,bytes:Buffer.from('unreferenced')}]:[])
 ]);
}
function controller(runtimeFactory,clock=fakeClock(),onState=()=>{}){assert.equal(typeof api.createController,'function','controller must exist');return api.createController({runtimeFactory,clock,onState});}
test('before first runtime and after disposal no session or canvas exists; no runtime delegates throw a stable error',async()=>{
 const c=controller(()=>{throw Object.assign(new Error('SDK absent'),{code:'SDK_UNAVAILABLE'});});assert.equal(c.snapshot(),null);assert.equal(c.getCanvas(),null);c.pause();c.resume();assert.equal(c.getState().running,false);assert.throws(()=>c.parameters(),{code:'RUNTIME_NOT_READY'});assert.equal(await c.load(await pkg()),false);assert.equal(c.snapshot(),null);assert.equal(c.getState().error.code,'SDK_UNAVAILABLE');c.dispose();c.dispose();c.resume();assert.equal(c.snapshot(),null);assert.equal(c.getCanvas(),null);
});
test('first draw remains private; successful swap disposes old runtime and failure retains old canvas/session',async()=>{
 const first=runtime(),gate=deferred(),second=runtime({first:gate.promise}),bad=runtime({firstFail:true});const queue=[first,second,bad]; const c=controller(()=>queue.shift());const p=await pkg();assert.equal(await c.load(p),true);const before=c.snapshot();const loading=c.load(p);await turn();assert.equal(c.getCanvas(),first.canvas);assert.equal(c.getState().loading,true);gate.resolve();assert.equal(await loading,true);assert.equal(first.dead,true);assert.equal(c.getCanvas(),second.canvas);assert.equal(await c.load(p),false);assert.equal(c.getCanvas(),second.canvas);assert.deepEqual(c.snapshot(),before);assert.equal(bad.dead,true);c.dispose();assert.equal(second.dead,true);
});
test('late async factory after B has committed is disposed and cannot overwrite B',async()=>{
 const gate=deferred(),a=runtime(),b=runtime();let count=0;const signals=[];const c=controller(({signal})=>{signals.push(signal);return ++count===1?gate.promise:b;});const p=await pkg();const loadingA=c.load(p);await turn();assert.equal(await c.load(p),true);assert.equal(await loadingA,false);assert.equal(signals[0].aborted,true);gate.resolve(a);await turn();assert.equal(a.dead,true);assert.equal(c.getCanvas(),b.canvas);c.dispose();
});
test('decode cancellation and 30 second timeout clean staged resources and preserve active settings',async()=>{
 const a=runtime(),gate=deferred(),b=runtime({load:gate.promise}),late=deferred(),d=runtime();const clock=fakeClock();const queue=[a,b,late.promise];const c=controller(()=>queue.shift(),clock);const p=await pkg();await c.load(p);c.setParameter('Angle',12);const ac=new AbortController();const l=c.load(p,{signal:ac.signal});await turn();ac.abort();assert.equal(await l,false);assert.equal(b.dead,true);assert.equal(c.snapshot().parameterOverrides.Angle,12);gate.resolve();await turn();assert.equal(c.getCanvas(),a.canvas);const timed=c.load(p);await turn();clock.advance(30000);assert.equal(await timed,false);assert.equal(c.getState().error.code,'LOAD_TIMEOUT');late.resolve(d);await turn();assert.equal(d.dead,true);assert.equal(clock.timers.size,0);c.dispose();
});
test('dispose while factory resolves cancels staging and cleans all late resources without reactivation',async()=>{
 const gate=deferred(),r=runtime(),clock=fakeClock();const c=controller(()=>gate.promise,clock);const loading=c.load(await pkg());await turn();c.dispose();assert.equal(await loading,false);gate.resolve(r);await turn();assert.equal(r.dead,true);assert.equal(c.getState().ready,false);assert.equal(c.getState().loading,false);assert.equal(clock.raf.size,0);assert.equal(clock.timers.size,0);
});
test('pause and duplicate resume own exactly one RAF and restart dt without resetting motion or physics',async()=>{
 const r=runtime(),clock=fakeClock();const c=controller(()=>r,clock);await c.load(await pkg());assert.equal(clock.raf.size,0);c.setMode('play');c.playMotion('Idle',0,{loop:true});assert.equal(clock.raf.size,0);c.resume();c.resume();assert.equal(clock.raf.size,1);clock.frame(1000);clock.frame(1250);assert.deepEqual(r.calls.filter(x=>x[0]==='update').slice(-2),[['update',0],['update',0.25]]);c.pause();c.pause();assert.equal(clock.raf.size,0);c.resume();c.resume();clock.frame(9000);assert.equal(r.calls.filter(x=>x[0]==='update').at(-1)[1],0);assert.equal(r.calls.filter(x=>x[0]==='reset').length,0);assert.deepEqual(c.snapshot().motion,{group:'Idle',index:0,loop:true});c.dispose();assert.equal(clock.raf.size,0);
});
test('delegated successful settings reach snapshot before notification; failed edits preserve snapshot',async()=>{
 const r=runtime();const observed=[];let c;c=controller(()=>r,fakeClock(),state=>{if(c)observed.push({state,snapshot:c.snapshot()});});await c.load(await pkg());c.setParameter('Angle',15);assert.equal(observed.at(-1).snapshot.parameterOverrides.Angle,15);c.setMode('play');c.playMotion('Idle',0,{loop:false});c.setExpression('smile');c.setEffects({blink:false,physics:true,pose:false});const saved=c.snapshot();assert.throws(()=>c.setParameter('Angle',99),{code:'INVALID_PARAMETER'});assert.deepEqual(c.snapshot(),saved);assert.equal(c.getState().error.code,'INVALID_PARAMETER');assert.throws(()=>c.setExpression('missing'),{code:'INVALID_EXPRESSION'});assert.deepEqual(c.snapshot(),saved);c.reset();assert.deepEqual(c.snapshot().parameterOverrides,{});assert.equal(c.snapshot().motion,null);assert.equal(c.snapshot().expression,null);c.dispose();
});
test('restore resets and applies all settings before first draw and atomically adopts candidate',async()=>{
 const a=runtime(),b=runtime();const queue=[a,b];const c=controller(()=>queue.shift());const p=await pkg();await c.load(p);c.setParameter('Angle',22);c.setMode('play');c.playMotion('Idle',0,{loop:true});c.setExpression('smile');c.setEffects({blink:false,physics:false,pose:true});const saved=JSON.parse(JSON.stringify(c.snapshot()));assert.equal(await c.restore(saved,p),true);assert.deepEqual(c.snapshot(),saved);const names=b.calls.map(x=>x[0]);assert.ok(names.indexOf('reset')<names.indexOf('parameter'));assert.ok(names.indexOf('expression')<names.indexOf('first'));assert.ok(names.indexOf('effects')<names.indexOf('first'));assert.equal(a.dead,true);c.dispose();
});
test('restore package SDK or parameter mismatch never replaces prior canvas or settings',async()=>{
 const a=runtime(),b=runtime({sdk:{...SDK,bundleHash:'4'.repeat(64)}}),d=runtime();const queue=[a,b,d];const c=controller(()=>queue.shift());const p=await pkg();await c.load(p);c.setParameter('Angle',7);const saved=c.snapshot();assert.equal(await c.restore(saved,await pkg('changed')),false);assert.equal(c.getState().error.code,'PACKAGE_MISMATCH');assert.equal(await c.restore(saved,p),false);assert.equal(b.dead,true);assert.equal(c.getState().error.code,'SDK_MISMATCH');assert.equal(await c.restore({...saved,parameterOverrides:{missing:4}},p),false);assert.equal(d.dead,true);assert.equal(c.getCanvas(),a.canvas);assert.deepEqual(c.snapshot(),saved);c.dispose();
});
test('rehashes one consumer snapshot and rejects forged changed bytes while leaving original package immutable',async()=>{
 const r=runtime(),c=controller(()=>r);const p=await pkg();const files=p.files;files.get('model.moc3')[0]=0;let accesses=0;const edited={entryPath:p.entryPath,hashes:p.hashes,get files(){accesses++;return files;}};assert.equal(await c.load(edited),false);assert.equal(accesses,1);assert.equal(c.getState().error.code,'PACKAGE_MISMATCH');assert.equal(c.snapshot(),null);assert.equal(await c.load(p),true);c.dispose();
});
test('context loss and frame error pause the only clock and publish error while retaining session',async()=>{
 for(const fail of [false,true]){const r=runtime({updateFail:fail}),clock=fakeClock();const c=controller(()=>r,clock);await c.load(await pkg());c.resume();if(fail)clock.frame(10);else r.canvas.lose();assert.equal(clock.raf.size,0);assert.equal(c.getState().running,false);assert.equal(c.getState().error.code,fail?'UPDATE_FAILED':'CONTEXT_LOST');assert.ok(c.snapshot());c.dispose();assert.equal(r.canvas.events.size,0);}
});
test('independent session operations never touch browser document legacy DB or localStorage',async()=>{
 const oldStorage=global.localStorage,oldDB=global.indexedDB,oldDoc=global.document;let writes=0;const trap=new Proxy({}, {get(){writes++;throw new Error('legacy storage accessed');}});global.localStorage=trap;global.indexedDB=trap;global.document=trap;
 try {const r=runtime(),c=controller(()=>r);const p=await pkg();await c.load(p);c.setParameter('Angle',3);const saved=c.snapshot();c.pause();c.resume();c.dispose();assert.equal(saved.format,'pankeki-cubism-session');assert.equal(writes,0);}finally{global.localStorage=oldStorage;global.indexedDB=oldDB;global.document=oldDoc;}
});

// A lost canvas cannot become usable merely by switching tabs or calling resume.
test('context loss blocks resume until a new staged runtime commits',async()=>{
 const a=runtime(),b=runtime(),clock=fakeClock(),queue=[a,b];
 const c=controller(()=>queue.shift(),clock),p=await pkg();
 await c.load(p);c.resume();a.canvas.lose();c.resume();c.resume();
 assert.equal(clock.raf.size,0);assert.equal(c.getState().running,false);
 assert.equal(c.getState().error.code,'CONTEXT_LOST');
 await c.load(p);c.resume();assert.equal(clock.raf.size,1);c.dispose();
});
test('SDK inspection without real runtime provenance cannot produce a playback session',async()=>{
 const r=runtime({sdk:null}),c=controller(()=>r);
 assert.equal(await c.load(await pkg()),false);
 assert.equal(c.getState().error.code,'SDK_UNAVAILABLE');
 assert.equal(c.snapshot(),null);assert.equal(c.getCanvas(),null);assert.equal(r.dead,true);c.dispose();
});
test('preaborted loads never create candidates and first draw cancellation retains the running old canvas',async()=>{
 const a=runtime(),gate=deferred(),b=runtime({first:gate.promise}),clock=fakeClock();
 let factories=0;const c=controller(()=>{factories++;return factories===1?a:b;},clock),p=await pkg();
 const aborted=new AbortController();aborted.abort();assert.equal(await c.load(p,{signal:aborted.signal}),false);assert.equal(factories,0);
 await c.load(p);c.resume();const cancelled=new AbortController();const loading=c.load(p,{signal:cancelled.signal});await turn();
 cancelled.abort();assert.equal(await loading,false);assert.equal(c.getCanvas(),a.canvas);assert.equal(c.getState().running,true);assert.equal(clock.raf.size,1);assert.equal(b.dead,true);
 gate.resolve();await turn();assert.equal(c.getCanvas(),a.canvas);c.dispose();assert.equal(clock.raf.size,0);assert.equal(clock.timers.size,0);
});
test('30 staged replacements release every fake resource and timeout handle after disposal',async()=>{
 const resources=[];const clock=fakeClock();const c=controller(()=>{const r=runtime();resources.push(r);return r;},clock),p=await pkg();
 for(let i=0;i<30;i++){assert.equal(await c.load(p),true);assert.equal(resources.filter(r=>!r.dead).length,1);assert.equal(clock.timers.size,0);}
 c.dispose();assert.equal(resources.reduce((sum,r)=>sum+r.ownedResources,0),0);assert.ok(resources.every(r=>r.disposeCount===1));assert.equal(clock.raf.size,0);assert.equal(clock.timers.size,0);
});

test('paused inspection edits update and draw exactly once without starting RAF',async()=>{
 const r=runtime(),clock=fakeClock(),c=controller(()=>r,clock);await c.load(await pkg());
 for(const edit of [()=>c.setParameter('Angle',11),()=>c.setExpression('smile'),()=>c.setEffects({blink:false,physics:false,pose:false}),()=>c.setMode('play'),()=>c.playMotion('Idle',0,{loop:false}),()=>c.reset()]){
  const before=r.calls.length;edit();const calls=r.calls.slice(before);
  assert.deepEqual(calls.slice(-2),[['update',0],['draw']]);assert.equal(clock.raf.size,0);assert.equal(c.getState().running,false);
 }
 c.dispose();
});
test('failed edit or edit redraw preserves snapshot and pauses the only RAF',async()=>{
 for(const drawFail of [false,true]){
  const r=runtime({drawFail}),clock=fakeClock(),c=controller(()=>r,clock);await c.load(await pkg());const before=c.snapshot();c.resume();
  assert.throws(()=>c.setParameter('Angle',drawFail?5:99),{code:drawFail?'DRAW_FAILED':'INVALID_PARAMETER'});
  assert.deepEqual(c.snapshot(),before);assert.equal(clock.raf.size,0);assert.equal(c.getState().running,false);c.dispose();
 }
});
test('a cancelled old RAF callback cannot update or duplicate scheduling for a newly resumed canvas',async()=>{
 const a=runtime(),b=runtime(),queue=[a,b],clock=fakeClock(),c=controller(()=>queue.shift(),clock),p=await pkg();
 await c.load(p);c.resume();const stale=[...clock.raf.values()][0];
 await c.load(p);c.resume();const before=b.calls.length;stale(1000);
 assert.equal(b.calls.length,before);assert.equal(clock.raf.size,1);
 clock.frame(2000);assert.deepEqual(b.calls.slice(-2),[['update',0],['draw']]);assert.equal(clock.raf.size,1);c.dispose();
});

// Task1 canonical package names must survive every Task2 persistence boundary.
test('Task1 safe percent and uppercase entry packages load serialize parse and restore with exact canonical keys',async()=>{
 const {serializeSession,parseSession}=require('../web/src/cubism-session.js');
 const cases=[
  {names:{moc:'100%hero.moc3',extra:'literal%20name.bin'},entry:'model.model3.json',keys:['100%hero.moc3','a.png','literal%20name.bin','model.model3.json']},
  {names:{entry:'model.MODEL3.JSON'},entry:'model.MODEL3.JSON',keys:['a.png','model.MODEL3.JSON','model.moc3']},
  {names:{entry:'히어로/Model.MODEL3.JSON',moc:'100%hero.moc3'},entry:'히어로/Model.MODEL3.JSON',keys:['히어로/100%hero.moc3','히어로/Model.MODEL3.JSON','히어로/a.png']}
 ];
 for(const fixture of cases){
  const p=await pkg('fixture',fixture.names);assert.equal(p.capabilities.packageRead,'verified');
  const c=controller(()=>runtime());assert.equal(await c.load(p),true);
  const saved=parseSession(serializeSession(c.snapshot()));
  assert.equal(saved.entryPath,fixture.entry);assert.deepEqual(Object.keys(saved.fileHashes).sort(),fixture.keys);
  assert.deepEqual(saved.fileHashes,{...p.hashes});
  assert.equal(await c.restore(saved,p),true);assert.equal(c.snapshot().entryPath,fixture.entry);
  assert.deepEqual(Object.keys(c.snapshot().fileHashes).sort(),fixture.keys);c.dispose();
 }
});
test('SDK validation errors stay SDK_UNAVAILABLE while unrelated session and package path errors retain their code',async()=>{
 for(const sdk of [null,{...SDK,coreHash:'invalid'},{...SDK,frameworkCommit:'unknown'}]){
  const c=controller(()=>runtime({sdk}));assert.equal(await c.load(await pkg()),false);
  assert.equal(c.getState().error.code,'SDK_UNAVAILABLE');assert.equal(c.snapshot(),null);c.dispose();
 }
 const c=controller(()=>runtime()),p=await pkg();await c.load(p);const before=c.snapshot();
 assert.equal(await c.restore({...before,entryPath:'../bad.model3.json'},p),false);
 assert.equal(c.getState().error.code,'INVALID_SESSION');assert.deepEqual(c.snapshot(),before);
 // A session's identifier budget is unrelated to SDK provenance.
 const oversized=await pkg('fixture',{entry:'x'.repeat(1025)+'.model3.json'});
 assert.equal(oversized.capabilities.packageRead,'verified');assert.equal(await c.load(oversized),false);
 assert.equal(c.getState().error.code,'INVALID_SESSION');assert.deepEqual(c.snapshot(),before);
 const bad={entryPath:'../bad.model3.json',hashes:p.hashes,files:new Map([['../bad.model3.json',Buffer.from('{}')]])};
 assert.equal(await c.load(bad),false);assert.equal(c.getState().error.code,'INVALID_PATH');assert.deepEqual(c.snapshot(),before);c.dispose();
});

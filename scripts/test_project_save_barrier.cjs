'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'test_ui_state.cjs'),'utf8'),prefix=source.slice(0,source.indexOf("\ntest('selected model preset"));
const {page,until,settle}=new Function('require','__dirname',prefix+'\nreturn {page,until,settle};')(require,__dirname);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
test('explicit file save waits for startup current and catalog transaction completion before download',async()=>{
 const ui=page({autoJobs:true,holdWrites:true});await until(()=>ui.studio().getSummary().modelsReady,'models');await ui.input('prompt','saved candidate');ui.element('candidateCount').value='1';assert.equal(await ui.studio().generate(),true);
 const catalog=deferred();let catalogCalled=false,settled=false;ui.studio().setProjectActions({saveCurrent:()=>{catalogCalled=true;return catalog.promise;},newProject:async()=>false,importProject:async()=>false});
 const saving=ui.element('saveProject').onclick().then(()=>(settled=true));await settle();assert.equal(ui.downloads.length,0,'download must not precede startup transaction');await until(()=>ui.pendingWrites.length,'current write');assert.equal(settled,false);ui.pendingWrites[0].complete();await until(()=>catalogCalled,'catalog write');assert.equal(ui.downloads.length,0);catalog.resolve(true);await saving;assert.equal(ui.downloads.length,1);assert.equal(JSON.parse(ui.writes.at(-1)).versions.length,1);
});
test('aborted startup current transaction cannot announce file-save success or trigger download',async()=>{
 const ui=page({holdWrites:true});await until(()=>ui.studio().getSummary().modelsReady,'models');await ui.input('projectName','unsaved');const saving=ui.element('saveProject').onclick();await settle();assert.equal(ui.downloads.length,0);await until(()=>ui.pendingWrites.length,'current write');ui.pendingWrites[0].abort();await saving;assert.equal(ui.downloads.length,0);assert.match(ui.element('projectStatus').textContent,/실패|abort/);
});

test('host startup persistence does not publish another autosave notification loop',async()=>{
 const ui=page();await until(()=>ui.studio().getSummary().modelsReady,'models');await ui.studio().ready;await settle();let updates=0;const remove=ui.studio().subscribe(()=>updates++);updates=0;await ui.studio().persistCurrentProject(ui.studio().exportProject());remove();assert.equal(updates,0,'host commit completion must not schedule another catalog autosave');
});

test('explicit imported snapshot retires the older brief debounce before returning',async()=>{
 const ui=page();await until(()=>ui.studio().getSummary().modelsReady,'models');let sequence=0;const timers=new Map(),nativeSet=ui.sandbox.setTimeout,nativeClear=ui.sandbox.clearTimeout;
 ui.sandbox.setTimeout=(fn,ms,...args)=>{if(ms!==200&&ms!==800)return nativeSet(fn,ms,...args);const id='save-'+(++sequence);timers.set(id,()=>fn(...args));return id;};ui.sandbox.clearTimeout=id=>{if(timers.has(id))timers.delete(id);else nativeClear(id);};
 await ui.input('projectName','older brief-only workspace');assert.equal(timers.size,1);const imported=ui.project('New imported candidate');imported.brief.prompt='preserved imported description';
 assert.equal(await ui.studio().importProject(imported),true);assert.equal(timers.size,0);assert.equal(JSON.parse(ui.writes.at(-1)).brief.prompt,'preserved imported description');assert.equal(JSON.parse(ui.writes.at(-1)).versions.length,1);
});

test('late old startup transaction completes before the explicitly imported current snapshot',async()=>{
 const ui=page({holdWrites:true});await until(()=>ui.studio().getSummary().modelsReady,'models');const old=ui.studio().persistCurrentProject(ui.studio().exportProject());await until(()=>ui.pendingWrites.length===1,'old transaction');const imported=ui.studio().importProject(ui.project('New after queued old snapshot'));await settle();assert.equal(ui.pendingWrites.length,1);ui.pendingWrites[0].complete();await old;await until(()=>ui.pendingWrites.length===2,'new transaction');ui.pendingWrites[1].complete();assert.equal(await imported,true);assert.equal(JSON.parse(ui.writes.at(-1)).brief.name,'New after queued old snapshot');assert.equal(JSON.parse(ui.writes.at(-1)).versions.length,1);
});

test('unavailable catalog still permits a real file backup with an explicit local-storage warning',async()=>{
 const ui=page();await until(()=>ui.studio().getSummary().modelsReady,'models');ui.studio().setProjectActions({saveCurrent:async()=> 'unavailable',importProject:async()=>false,newProject:async()=>false});await ui.element('saveProject').onclick();assert.equal(ui.downloads.length,1);assert.equal(ui.element('projectStatus').classList.contains('error'),true);assert.match(ui.element('projectStatus').textContent,/목록.*사용할 수 없|목록.*저장.*못/);
});

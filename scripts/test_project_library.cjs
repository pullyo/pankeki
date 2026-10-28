'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Design=require('../web/src/profiles.js');
let API;try{API=require('../web/src/project-library.js');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;API={create(){throw Error('Project library implementation is absent');}};}
const clone=value=>structuredClone(value),raw=name=>JSON.stringify(Design.createProject({name},[],[]));
const EMPTY=raw(''),A=raw('Project A'),B=raw('Project B');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
// External persistence boundary only: atomic commit, CAS, and fault/delay injection.
class MemoryStore{
 constructor(){this.state={revision:0,activeId:null,records:[]};this.fail=null;this.hold=null;}
 async read(){return clone(this.state);}
 async commit(change){
  if(this.hold&&this.hold.when(change)){const held=this.hold;this.hold=null;held.entered.resolve();await held.release.promise;}
  if(this.fail&&this.fail(change)){this.fail=null;throw Error('QuotaExceededError');}
  if(change.expectedRevision!==this.state.revision)throw Error('Catalog revision conflict');
  const records=new Map(this.state.records.map(item=>[item.id,clone(item)]));
  for(const id of change.remove||[])records.delete(id);
  for(const item of change.put||[])records.set(item.id,clone(item));
  const activeId=Object.hasOwn(change,'activeId')?change.activeId:this.state.activeId;
  this.state={revision:this.state.revision+1,activeId,records:[...records.values()]};
  return {revision:this.state.revision,activeId};
 }
}
function host(initial=A){return {raw:initial,identity:'runtime-1',busy:false,draft:{text:'',start:0,end:0},loads:[],resets:0,decline:false,
 load(value){this.loads.push(value);if(this.decline)return false;this.raw=value;this.identity+='x';return true;},
 reset(){this.resets++;if(this.decline)return false;this.raw=EMPTY;this.identity+='n';return true;}};}
let sequence=0;
function make(store=new MemoryStore(),h=host(),ready={ok:true,restored:true,reason:'restored',legacyRead:true,legacyRaw:h.raw},extra={}){
 const library=API.create({store,ready:Promise.resolve(ready),capture:()=>h.raw,validateRaw:Design.parseProject,
  load:value=>h.load(value),newProject:()=>h.reset(),isBusy:()=>h.busy,getIdentity:()=>h.identity,
  getDraft:()=>clone(h.draft),setDraft:value=>h.draft=clone(value),now:()=> '2026-10-27T00:00:00.000Z',makeId:()=> 'local-'+(++sequence),...extra});
 return {library,h,store};
}
test('ready delay cannot seed a temporary default; a genuinely empty startup creates no row',async()=>{
 const gate=deferred(),x=make(new MemoryStore(),host(EMPTY),gate.promise);const pending=x.library.init();await Promise.resolve();assert.equal(x.store.state.records.length,0);
 x.h.raw=A;gate.resolve({ok:true,restored:true,reason:'restored',legacyRead:true,legacyRaw:A});assert.equal(await pending,true);assert.equal(x.library.getState().items[0].name,'Project A');
 const empty=make(new MemoryStore(),host(EMPTY),{ok:true,restored:false,reason:'empty',legacyRead:true,legacyRaw:null});assert.equal(await empty.library.init(),true);assert.equal(empty.library.getState().items.length,0);
});
test('two real documents retain exact raw bytes, stable local IDs and favorite after reopening',async()=>{
 const x=make();assert.equal(await x.library.init(),true);const first=x.library.getState().activeId;
 const spaced=JSON.stringify(JSON.parse(B),null,2);assert.equal(await x.library.importProject(spaced),true);const second=x.library.getState().activeId;assert.notEqual(first,second);
 assert.equal(await x.library.setFavorite(first,true),true);assert.equal(await x.library.switchTo(first),true);assert.equal(x.h.raw,A);
 const reopened=make(x.store,host(A));assert.equal(await reopened.library.init(),true);assert.equal(reopened.library.getState().activeId,first);assert.equal(reopened.library.getState().items.find(v=>v.id===first).favorite,true);
 assert.equal(x.store.state.records.find(v=>v.id===second).raw,spaced);
});
test('a successfully restored empty project binds its persisted active ID without loading, rewriting or choosing an identical empty row',async()=>{
 const emptyReport={ok:true,restored:false,reason:'empty',legacyRead:true,legacyRaw:null};
 const x=make(new MemoryStore(),host(EMPTY),emptyReport);await x.library.init();
 assert.equal(await x.library.newProject(),true);const first=x.library.getState().activeId;
 assert.equal(await x.library.newProject(),true);const second=x.library.getState().activeId;assert.notEqual(first,second);
 assert.equal(await x.library.setFavorite(second,true),true);const before=clone(x.store.state);
 const reopened=make(x.store,host(EMPTY));assert.equal(await reopened.library.init(),true);
 assert.equal(reopened.library.getState().activeId,second);assert.equal(reopened.library.getState().items.find(v=>v.id===second).favorite,true);
 assert.equal(reopened.h.loads.length,0);assert.equal(reopened.h.raw,EMPTY);assert.deepEqual(x.store.state,before);assert.equal(reopened.library.getState().notice,'');
 const typed=host(EMPTY);typed.draft={text:'새 입력 유지',start:1,end:2};const untouched=make(x.store,typed);await untouched.library.init();
 assert.equal(untouched.library.getState().activeId,null);assert.equal(typed.loads.length,0);assert.equal(typed.draft.text,'새 입력 유지');assert.deepEqual(x.store.state,before);
 assert.equal(await reopened.library.setFavorite(second,false),true);
});
test('cross-database partial completion preserves both documents and binds visible legacy A instead of claiming last B restored',async()=>{
 const x=make();await x.library.init();const a=x.library.getState().activeId;await x.library.importProject(B);const b=x.library.getState().activeId;
 const reopened=make(x.store,host(A));assert.equal(await reopened.library.init(),true);assert.equal(reopened.h.raw,A);assert.equal(reopened.h.loads.length,0);assert.equal(reopened.library.getState().activeId,a);
 assert.deepEqual(new Set(x.store.state.records.map(v=>v.raw)),new Set([A,B]));assert(reopened.library.getState().notice);assert.notEqual(reopened.library.getState().activeId,b);
});
test('stored active autoload requires confirmed empty legacy storage and no typed draft',async()=>{
 const x=make();await x.library.init();const id=x.library.getState().activeId;
 const emptyReport={ok:true,restored:false,reason:'empty',legacyRead:true,legacyRaw:null};
 const clean=make(x.store,host(EMPTY),emptyReport);assert.equal(await clean.library.init(),true);assert.equal(clean.h.raw,A);assert.equal(clean.library.getState().activeId,id);
 const typed=host(EMPTY);typed.draft={text:'아직 보내지 않은 문장',start:2,end:4};const untouched=make(x.store,typed,emptyReport);await untouched.library.init();assert.equal(typed.loads.length,0);assert.equal(typed.draft.text,'아직 보내지 않은 문장');assert.equal(untouched.library.getState().activeId,null);
});
test('superseded startup preserves legacy raw and current user work without automatic loading',async()=>{
 const x=make(new MemoryStore(),host(B),{ok:false,restored:false,reason:'superseded',legacyRead:true,legacyRaw:A});assert.equal(await x.library.init(),true);
 assert.deepEqual(new Set(x.store.state.records.map(v=>v.raw)),new Set([A,B]));assert.equal(x.h.loads.length,0);assert.equal(x.h.raw,B);
});
test('failed legacy read or decode never seeds the default or mutates an existing catalog',async()=>{
 const x=make();await x.library.init();const before=clone(x.store.state);
 for(const reason of ['unavailable','error']){const y=make(x.store,host(EMPTY),{ok:false,restored:false,reason,legacyRead:reason==='error',legacyRaw:reason==='error'?A:null});assert.equal(await y.library.init(),false);assert.deepEqual(x.store.state,before);assert.equal(y.h.loads.length,0);assert(y.library.getState().error);}
});
test('actual busy or IME guard blocks switch and new, and drafts follow their own local IDs',async()=>{
 const x=make();await x.library.init();const a=x.library.getState().activeId;await x.library.importProject(B);const b=x.library.getState().activeId;
 x.h.busy=true;assert.equal(await x.library.switchTo(a),false);assert.equal(await x.library.newProject(),false);assert.equal(x.h.raw,B);x.h.busy=false;
 x.h.draft={text:'B 초안',start:1,end:3};assert.equal(await x.library.switchTo(a),true);x.h.draft={text:'A 초안',start:2,end:4};assert.equal(await x.library.switchTo(b),true);assert.deepEqual(x.h.draft,{text:'B 초안',start:1,end:3});assert.equal(await x.library.switchTo(a),true);assert.equal(x.h.draft.text,'A 초안');
});
test('invalid input and declined import leave active document, records and draft untouched',async()=>{
 const x=make();await x.library.init();const before=clone(x.store.state);x.h.draft={text:'keep',start:1,end:2};
 assert.equal(await x.library.importProject('{"version":99}'),false);assert.equal(x.h.loads.length,0);assert.deepEqual(x.store.state,before);
 x.h.decline=true;assert.equal(await x.library.importProject(B),false);assert.deepEqual(x.store.state,before);assert.equal(x.h.raw,A);assert.equal(x.h.draft.text,'keep');
});
test('a failed active commit retains target UI as uncommitted and explicit retry cannot overwrite the previous ID',async()=>{
 const x=make();await x.library.init();const a=x.library.getState().activeId;const before=clone(x.store.state);
 x.store.fail=change=>Object.hasOwn(change,'activeId');assert.equal(await x.library.importProject(B),false);assert.equal(x.h.raw,B);assert.equal(x.library.getState().activeId,null);assert(x.library.getState().recovery);assert.deepEqual(x.store.state,before);
 assert.equal(await x.library.newProject(),false);assert.equal(await x.library.saveCurrent(),true);const b=x.library.getState().activeId;assert.notEqual(a,b);assert.equal(x.store.state.records.find(v=>v.id===a).raw,A);assert.equal(x.store.state.records.find(v=>v.id===b).raw,B);
});
test('raw saves merge the latest favorite and a delayed old save never reverses a later active selection',async()=>{
 const x=make();await x.library.init();const a=x.library.getState().activeId;await x.library.importProject(B);const b=x.library.getState().activeId;await x.library.switchTo(a);
 x.h.raw=raw('A edited');const entered=deferred(),release=deferred();x.store.hold={when:c=>c.put?.some(v=>v.raw.includes('A edited')),entered,release};const save=x.library.saveCurrent();await entered.promise;
 const favorite=x.library.setFavorite(a,true),switching=x.library.switchTo(b);release.resolve();assert.equal(await save,true);assert.equal(await favorite,true);assert.equal(await switching,true);
 assert.equal(x.store.state.activeId,b);assert.equal(x.store.state.records.find(v=>v.id===a).favorite,true);
});
test('a stale client cannot resurrect a removed ID or overwrite a concurrent favorite',async()=>{
 const x=make();await x.library.init();const a=x.library.getState().activeId;await x.library.importProject(B);const b=x.library.getState().activeId;await x.library.switchTo(a);
 const other=make(x.store,host(A));await other.library.init();x.h.raw=raw('stale A');const entered=deferred(),release=deferred();x.store.hold={when:c=>c.put?.some(v=>v.raw.includes('stale A')),entered,release};const save=x.library.saveCurrent();await entered.promise;
 await other.library.setFavorite(a,true);await other.library.switchTo(b);assert.equal(await other.library.remove(a),true);release.resolve();assert.equal(await save,false);assert.equal(x.store.state.records.some(v=>v.id===a),false);assert.equal(x.store.state.activeId,b);
});
test('only inactive catalog items can be removed; removal never invokes an external file or host load',async()=>{
 const x=make();await x.library.init();const a=x.library.getState().activeId;assert.equal(await x.library.remove(a),false);await x.library.importProject(B);const before=x.h.loads.length;assert.equal(await x.library.remove(a),true);assert.equal(x.h.loads.length,before);assert.equal(x.library.getState().items.length,1);assert.equal(await x.library.remove(x.library.getState().activeId),false);
});
test('runtime identity bypass fails closed, and foreign-format rebind only accepts unchanged v1 content',async()=>{
 const x=make();await x.library.init();const a=x.library.getState().activeId;x.h.identity='foreign-runtime';assert.equal(await x.library.rebindCurrent(),true);assert.equal(x.library.getState().activeId,a);
 const before=clone(x.store.state);x.h.raw=B;x.h.identity='external-import';assert.equal(await x.library.saveCurrent(),false);assert.deepEqual(x.store.state,before);assert.equal(await x.library.rebindCurrent(),false);assert.equal(x.library.getState().activeId,null);
});
test('an identity change during initial seed never binds the old record to new visible work',async()=>{
 const x=make(),entered=deferred(),release=deferred();x.store.hold={when:()=>true,entered,release};const initializing=x.library.init();await entered.promise;x.h.raw=B;x.h.identity='new-user-work';release.resolve();await initializing;
 assert.equal(x.library.getState().activeId,null);assert(x.library.getState().recovery);assert.equal(x.store.state.records[0].raw,A);assert.equal(x.h.raw,B);
});
test('a replacement during pre-switch save cancels the stale load instead of overwriting new work',async()=>{
 const x=make();await x.library.init();await x.library.importProject(B);const b=x.library.getState().activeId;x.h.raw=raw('B edited');const entered=deferred(),release=deferred();x.store.hold={when:c=>c.put?.some(v=>v.raw.includes('B edited')),entered,release};
 const a=x.library.getState().items.find(v=>v.name==='Project A').id,before=x.h.loads.length,switching=x.library.switchTo(a);await entered.promise;x.h.raw=raw('External current');x.h.identity='external-new';release.resolve();assert.equal(await switching,false);assert.equal(x.h.loads.length,before);assert.equal(x.h.raw,raw('External current'));assert.equal(x.library.getState().activeId,null);assert.equal(x.store.state.activeId,b);
});
test('a queued switch cannot load an item that an earlier queued removal has removed',async()=>{
 const x=make();await x.library.init();const a=x.library.getState().activeId;await x.library.importProject(B);x.h.raw=raw('B changed');const entered=deferred(),release=deferred();x.store.hold={when:c=>c.put?.some(v=>v.raw.includes('B changed')),entered,release};
 const save=x.library.saveCurrent();await entered.promise;const removing=x.library.remove(a),before=x.h.loads.length,switching=x.library.switchTo(a);release.resolve();await save;assert.equal(await removing,true);assert.equal(await switching,false);assert.equal(x.h.loads.length,before);assert.equal(x.store.state.records.some(v=>v.id===a),false);
});
test('a same-owner brief or draft edit during pre-switch persistence aborts the load and preserves new input',async()=>{
 const x=make();await x.library.init();await x.library.importProject(B);const a=x.library.getState().items.find(v=>v.name==='Project A').id;
 x.h.raw=raw('B initial edit');x.h.draft={text:'before',start:0,end:0};const entered=deferred(),release=deferred();x.store.hold={when:c=>c.put?.some(v=>v.raw.includes('B initial edit')),entered,release};const before=x.h.loads.length,switching=x.library.switchTo(a);await entered.promise;
 x.h.raw=raw('B newer edit');x.h.draft={text:'새 초안',start:1,end:2};release.resolve();assert.equal(await switching,false);assert.equal(x.h.loads.length,before);assert.equal(x.h.raw,raw('B newer edit'));assert.equal(x.h.draft.text,'새 초안');
});
test('a first save cannot bind its old snapshot to a different runtime after commit',async()=>{
 const x=make(new MemoryStore(),host(EMPTY),{ok:true,restored:false,reason:'empty',legacyRead:true,legacyRaw:null});await x.library.init();x.h.raw=A;const entered=deferred(),release=deferred();x.store.hold={when:()=>true,entered,release};const saving=x.library.saveCurrent();await entered.promise;x.h.raw=B;x.h.identity='replacement';release.resolve();assert.equal(await saving,false);assert.equal(x.library.getState().activeId,null);assert(x.library.getState().recovery);assert.equal(x.store.state.records[0].raw,A);
});
test('a recovery retry cannot bind a newly replaced runtime to the previously pending document',async()=>{
 const x=make();await x.library.init();x.store.fail=c=>Object.hasOwn(c,'activeId');await x.library.importProject(B);const entered=deferred(),release=deferred();x.store.hold={when:()=>true,entered,release};const saving=x.library.saveCurrent();await entered.promise;x.h.raw=raw('External C');x.h.identity='replacement';release.resolve();assert.equal(await saving,false);assert.equal(x.library.getState().activeId,null);assert(x.library.getState().recovery);assert.equal(x.h.raw,raw('External C'));
});


test('explicit catalog save waits for startup-current transaction before its own commit and success',async()=>{
 const entered=deferred(),release=deferred();let persisted;
 const x=make(undefined,undefined,undefined,{persistCurrent:async raw=>{persisted=raw;entered.resolve();await release.promise;}});await x.library.init();const before=x.store.state.revision;x.h.raw=B;let settled=false;const saving=x.library.saveCurrent().then(v=>(settled=true,v));
 await Promise.race([entered.promise,new Promise(resolve=>setImmediate(resolve))]);assert.equal(persisted,B,'startup-current persistence must be part of explicit save');assert.equal(settled,false);assert.equal(x.store.state.revision,before);release.resolve();assert.equal(await saving,true);assert.equal(x.store.state.records.find(v=>v.id===x.library.getState().activeId).raw,B);
});
test('startup-current transaction failure cannot report catalog save success or overwrite its old snapshot',async()=>{
 const x=make(undefined,undefined,undefined,{persistCurrent:async()=>{throw Error('Controlled startup transaction abort');}});await x.library.init();const before=clone(x.store.state);x.h.raw=B;assert.equal(await x.library.saveCurrent(),false);assert.deepEqual(x.store.state,before);assert.equal(x.h.raw,B);assert.match(x.library.getState().error,/transaction abort/);
});

test('unbound foreign runtime cannot write startup current before a project transition refuses it',async()=>{
 let writes=0;const x=make(undefined,undefined,undefined,{persistCurrent:async()=>{writes++;}});await x.library.init();const before=clone(x.store.state);x.h.raw=B;x.h.identity='foreign-runtime';assert.equal(await x.library.newProject(),false);assert.equal(writes,0);assert.deepEqual(x.store.state,before);assert.equal(x.h.raw,B);
});

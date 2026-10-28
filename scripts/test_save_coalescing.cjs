'use strict';
// node --test scripts/test_save_coalescing.cjs
// Counts whole-project JSON work and storage writes caused by one burst of
// brief edits in the real app + redesign + project library. Controlled
// browser I/O only; this does not measure browser paint or IndexedDB speed.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),Module=require('node:module');
const fixtureFile=path.join(__dirname,'test_central_composer.cjs'),fixtureText=fs.readFileSync(fixtureFile,'utf8'),end=fixtureText.indexOf("\ntest('home entry moves");
if(end<0)throw Error('Review changed central composer harness boundary');
const fixture=new Module(fixtureFile,module);fixture.filename=fixtureFile;fixture.paths=module.paths;
fixture._compile(fixtureText.slice(0,end)+'\nmodule.exports={test,assert,mounted,transport,ProjectStore,settle,until};',fixtureFile);
const {assert,mounted,transport,ProjectStore,settle}=fixture.exports,test=require('node:test');
const idle=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Whole-project work is any JSON call whose text carries the candidate image.
function counter(ui){
  vm.runInContext(`(()=>{const s=JSON.stringify,p=JSON.parse,c=globalThis.__projectJSON={stringify:0,parse:0,on:false};
    JSON.stringify=function(value,...rest){const text=s.call(JSON,value,...rest);if(c.on&&typeof text==='string'&&text.includes('"versions":[{'))c.stringify++;return text;};
    JSON.parse=function(text,...rest){if(c.on&&typeof text==='string'&&text.includes('"versions":[{'))c.parse++;return p.call(JSON,text,...rest);};})()`,ui.sandbox);
  return ui.sandbox.__projectJSON;
}
async function burst(ui,store,edit){
  const counts=counter(ui),writes=ui.writes.length,commits=store.state.revision;
  counts.on=true;
  for(let i=1;i<=10;i++){edit(i);await settle();await idle(20);}
  // Let every debounce, chained write and post-save notification settle.
  await idle(2600);await settle();counts.on=false;
  return {stringify:counts.stringify,parse:counts.parse,currentWrites:ui.writes.length-writes,catalogCommits:store.state.revision-commits};
}
async function brief(ui,id,i){const node=ui.doc.getElementById(id);node.value=node.value+String(i%10);await node.dispatchEvent(new ui.Event('input',{bubbles:true}));}

test('one burst of brief edits serializes and validates the project once and writes each store once',{timeout:10000},async()=>{
  const store=new ProjectStore(),ui=await mounted(transport(),{projectStore:store});
  try{
    await idle(1200);await settle();
    const result=await burst(ui,store,i=>void brief(ui,'brief',i));
    console.log('brief burst',JSON.stringify(result));
    const saved=JSON.parse(ui.writes.at(-1));assert.equal(saved.brief.brief,ui.doc.getElementById('brief').value);
    assert.equal(JSON.parse(store.state.records.find(item=>item.id===store.state.activeId).raw).brief.brief,saved.brief.brief);
    assert.equal(result.stringify,1,'one validated export per burst');
    assert.equal(result.parse,0,'validated export is not parsed again');
    assert.equal(result.currentWrites,1);assert.equal(result.catalogCommits,1);
  }finally{ui.view.destroy();}
});

test('prompt keystrokes coalesce the same way and pending text saves flush on pagehide',{timeout:10000},async()=>{
  const store=new ProjectStore(),ui=await mounted(transport(),{projectStore:store});
  try{
    await idle(1200);await settle();
    const result=await burst(ui,store,i=>void brief(ui,'prompt',i));
    console.log('prompt burst',JSON.stringify(result));
    assert.equal(result.stringify,1,'one validated export per burst');
    assert.equal(result.parse,0);assert.equal(result.currentWrites,1);assert.equal(result.catalogCommits,1);
    const before=ui.writes.length;await brief(ui,'notes',7);await settle();assert.equal(ui.writes.length,before,'text edit is debounced');
    for(const listener of ui.sandbox.document.listeners.get('pagehide')||[])listener({persisted:false});
    await settle();await settle();assert.equal(ui.writes.length,before+1,'pagehide flushes the pending text save');
    assert.equal(JSON.parse(ui.writes.at(-1)).brief.notes,ui.doc.getElementById('notes').value);
  }finally{ui.view.destroy();}
});

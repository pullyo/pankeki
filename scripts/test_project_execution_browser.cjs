'use strict';
// Isolated Chromium + IndexedDB source/store integration. No installed Pankeki,
// account, model, GPU, live service or user browser profile is used.
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const executable=process.env.PANKEKI_BROWSER_FIXTURE_EXECUTABLE,python=process.env.PANKEKI_CPU_FIXTURE_PYTHON;
test('actual CPU PNG bytes and execution survive browser IndexedDB reload, import, save and reopen without touching v2/v3 stores',{skip:!executable||!python?'Set bounded browser and CPU fixture runtimes to run the isolated IndexedDB integration':false,timeout:30000},async()=>{
 const {chromium}=require('playwright'),root=path.resolve(__dirname,'..');
 const original='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
 const actual=JSON.parse(execFileSync(python,['-c',"import base64,hashlib,json,sys; from pankeki.imageops import resize_png; result=resize_png(base64.b64decode(sys.argv[1]),2,2,False); print(json.dumps({'png':'data:image/png;base64,'+base64.b64encode(result.png).decode(),'sha256':hashlib.sha256(result.png).hexdigest()}))",original],{cwd:root,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},encoding:'utf8'}));
 const server=http.createServer((req,res)=>{
  if(req.url==='/'){res.setHeader('content-type','text/html');return res.end('<!doctype html><title>Bounded source persistence fixture</title><script src="/profiles.js"></script><script src="/project-library.js"></script>');}
  const file={'/profiles.js':'profiles.js','/project-library.js':'project-library.js'}[req.url];if(!file){res.writeHead(404);return res.end();}res.setHeader('content-type','text/javascript');res.end(fs.readFileSync(path.join(root,'web/src',file)));
 });
 let browser;
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  browser=await chromium.launch({executablePath:executable,headless:true});const context=await browser.newContext(),page=await context.newPage(),url='http://127.0.0.1:'+server.address().port;
  await page.goto(url);
  const first=await page.evaluate(async actual=>{
   const D=CharacterDesign,brief=D.sanitizeBrief({name:'CPU PNG trace'}),execution={schema:1,traceId:'cpu-operation',jobId:'e'.repeat(32),resultSha256:actual.sha256,runRef:'runs/'+'e'.repeat(32)};
   const raw=JSON.stringify(D.createProject(brief,[{id:'cpu-result',createdAt:'2026-10-28T00:00:00.000Z',label:'CPU resized',image:actual.png,brief,request:{mode:'txt2img',seed:1},parentId:null,metrics:{},execution}],[]));
   async function sentinel(name){await new Promise((resolve,reject)=>{const request=indexedDB.open(name,1);request.onupgradeneeded=()=>request.result.createObjectStore('sentinel');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('sentinel','readwrite');tx.objectStore('sentinel').put('preserved','keep');tx.oncomplete=()=>{db.close();resolve();};};});}
   await sentinel('pankeki-motion-studio-v2');await sentinel('pankeki-authoring-v3');
   let live=raw,identity='one',draft={text:'',start:0,end:0};
   const library=PankekiProjectLibrary.create({ready:Promise.resolve({ok:true,restored:true,reason:'restored',legacyRead:true,legacyRaw:raw}),capture:()=>live,load:value=>{live=value;identity+='x';return true;},newProject:()=>false,isBusy:()=>false,getIdentity:()=>identity,getDraft:()=>draft,setDraft:value=>draft=value});
   if(!await library.init()||!await library.saveCurrent())throw Error('Initial IndexedDB save failed');
   return {raw,activeId:library.getState().activeId};
  },actual);
  await page.reload();
  const reopened=await page.evaluate(async expected=>{
   const snapshot=await PankekiProjectLibrary.createIndexedDBStore().read(),record=snapshot.records.find(v=>v.id===expected.activeId);if(!record)throw Error('Saved candidate missing after reload');
   const document=CharacterDesign.parseProject(record.raw),row=document.versions[0];
   let live=record.raw,identity='reopened',draft={text:'',start:0,end:0};const library=PankekiProjectLibrary.create({ready:Promise.resolve({ok:true,restored:true,reason:'restored',legacyRead:true,legacyRaw:live}),capture:()=>live,load:value=>{live=value;identity+='x';return true;},newProject:()=>false,isBusy:()=>false,getIdentity:()=>identity,getDraft:()=>draft,setDraft:value=>draft=value});
   await library.init();const imported=await library.importProject(record.raw),saved=await library.saveCurrent(),exported=JSON.stringify(CharacterDesign.parseProject(live));
   async function preserved(name){return new Promise((resolve,reject)=>{const request=indexedDB.open(name);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('sentinel'),read=tx.objectStore('sentinel').get('keep');read.onsuccess=()=>{resolve({version:db.version,value:read.result});db.close();};};});}
   return {raw:record.raw,image:row.image,execution:row.execution,sha:CharacterDesign.imageSha256(row.image),imported,saved,exported,sentinels:await Promise.all(['pankeki-motion-studio-v2','pankeki-authoring-v3'].map(preserved))};
  },first);
  assert.equal(reopened.raw,first.raw);assert.equal(reopened.image,actual.png);assert.equal(reopened.sha,actual.sha256);assert.equal(reopened.execution.resultSha256,actual.sha256);assert.equal(reopened.imported,true);assert.equal(reopened.saved,true);assert.equal(reopened.exported,first.raw);assert.deepEqual(reopened.sentinels,[{version:1,value:'preserved'},{version:1,value:'preserved'}]);
 }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

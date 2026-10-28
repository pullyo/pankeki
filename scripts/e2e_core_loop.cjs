'use strict';
// Real served HTML + isolated persistent Chromium profile. Never controls an
// installed Electron app, user Chrome profile, service startup or global cancel.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const crypto=require('node:crypto');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function queueState(value){if(!value||!Array.isArray(value.queue_running)||!Array.isArray(value.queue_pending))throw Error('Unknown Comfy queue; no submission permitted');return value.queue_running.length||value.queue_pending.length?'busy':'idle';}
function validateRequest(body,index){
 assert.equal(body.request.mode,index===0?'txt2img':'inpaint');
 for(const [key,value]of Object.entries({model_id:'sdxl-base',width:512,height:512,steps:2,seed:2026102801+index,denoise:1,cache:false,roi:false,preview:false}))assert.equal(body.request[key],value,'Bounded smoke request '+key);
 if(index===1){assert.equal(body.request.feather,0);assert.ok(body.request.source.startsWith('data:image/png;'));assert.ok(body.request.mask.startsWith('data:image/png;'));}
}
function resumeLedger(previous){
 assert.equal(previous.job_posts,1,'Resume must retain exactly one consumed submission');
 assert.equal(previous.stages.generation,'PASS');assert.equal(previous.jobs.length,1);assert.equal(previous.jobs[0].state,'succeeded');assert.ok(previous.jobs[0].result?.result_sha256);assert.equal(previous.requests.length,1);validateRequest(previous.requests[0],0);
 return {...previous,status:'IN_PROGRESS',error:null,events:[...previous.events,{kind:'resume_after_harness_failure',previous_error:previous.error,consumed_posts:1}]};
}
async function run(config){
 if(config.allowGpu!==true)throw Error('Explicit GPU gate missing');
 const parsed=new URL(config.baseUrl);if(!['127.0.0.1','localhost'].includes(parsed.hostname)||['8190','8188',''].includes(parsed.port))throw Error('Protected or nonstaging service');
 const out=config.outputDir,report=config.resume?resumeLedger(JSON.parse(fs.readFileSync(path.join(config.outputDir,'browser-report.json'),'utf8'))):{status:'IN_PROGRESS',stages:{identity:'UNVERIFIED',generation:'UNVERIFIED',edit:'UNVERIFIED',save:'UNVERIFIED',reload:'UNVERIFIED',import:'UNVERIFIED',resave:'UNVERIFIED',reopen:'UNVERIFIED'},job_posts:0,jobs:[],requests:[],events:[],page_errors:[],native_acceptance:'UNVERIFIED',visual_quality:'UNVERIFIED'};
 const write=()=>fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));
 const runDeadline=Date.now()+config.timeoutMs;
 const trace=config.resume?report.requests[0].request.trace_id.replace(/-generation$/,''):'core-e2e-'+crypto.randomUUID(),jobIds=new Set(report.jobs.map(job=>job.job_id)),responseTasks=new Set();let context,page;
 async function get(url){const response=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Read probe HTTP '+response.status);return response.json();}
 async function identity(){const health=await get(config.baseUrl+'/api/health');for(const key of ['source_id','html_source_id','process_source_id'])assert.equal(health.build?.[key],config.expectedSourceId,'Source changed before submission: '+key);assert.equal(health.build?.status,'match');const actual=await get(config.comfyUrl+'/system_stats');const stable=Object.fromEntries(['python_version','pytorch_version','comfyui_version','argv'].map(key=>[key,actual.system?.[key]??null]));assert.deepEqual(stable,config.expectedComfySystem,'Attached Comfy service changed');}
 async function idle(){const deadline=Math.min(runDeadline,Date.now()+600000);while(true){const state=queueState(await get(config.comfyUrl+'/queue'));if(state==='idle')return;report.events.push({kind:'foreign_queue_busy_wait',at:new Date().toISOString()});write();if(Date.now()>deadline)throw Error('Foreign Comfy work remains busy; no job submitted');await sleep(1000);}}
 try{
  const {chromium}=require('playwright');
  const profile=path.join(out,'isolated-browser-profile');if(fs.existsSync(profile)!==!!config.resume)throw Error('Fresh run requires new profile; resume requires the same existing profile');
  context=await chromium.launchPersistentContext(profile,{executablePath:config.browserExecutable,headless:true,acceptDownloads:true,viewport:{width:1600,height:1100},args:['--no-first-run','--disable-sync','--disable-background-networking','--disable-component-update','--disable-domain-reliability','--disable-extensions','--safebrowsing-disable-auto-update','--password-store=basic','--use-mock-keychain','--disable-features=OptimizationHints,OptimizationGuideModelDownloading,MediaRouter']});
  page=context.pages()[0]||await context.newPage();page.setDefaultTimeout(30000);
  const commands=require('node:child_process').execFileSync('/bin/ps',['-axo','pid,ppid,command'],{encoding:'utf8'}).split('\n').filter(line=>line.includes(profile));
  fs.writeFileSync(path.join(out,'chrome-launch-processes.json'),JSON.stringify({scope:'Observed launch commands; page/context requests are allowlisted to Pankeki/Comfy loopback; background networking and component updates disabled',commands},null,2));
  page.on('dialog',async dialog=>{report.events.push({kind:'dialog',type:dialog.type(),message:dialog.message()});write();if(dialog.type()==='confirm'&&dialog.message().includes('현재 프로젝트')&&dialog.message().includes('교체'))await dialog.accept();else await dialog.dismiss();});
  page.on('pageerror',error=>{report.page_errors.push(String(error));write();});
  // Intercept only to enforce the fixed budget/identity and attach our trace;
  // source, mask and all settings originate in actual app requestSnapshot().
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(['http:','https:','ws:','wss:'].includes(url.protocol)&&![new URL(config.baseUrl).origin,new URL(config.comfyUrl).origin].includes(url.origin)){report.events.push({kind:'external_request_blocked',url:req.url()});write();return route.abort('blockedbyclient');}
   if(req.method()==='POST'){
    if(url.origin!==new URL(config.baseUrl).origin||url.pathname!=='/api/jobs'){report.events.push({kind:'forbidden_mutation',url:req.url()});write();return route.abort('blockedbyclient');}
    try{
     if(report.job_posts>=2)throw Error('2 POST budget exhausted; automatic replay forbidden');
     const index=report.job_posts,body=JSON.parse(req.postData());validateRequest(body,index);
     await identity();await idle();await identity();
     body.request.trace_id=trace+'-'+(index===0?'generation':'edit');
     report.job_posts++;report.requests.push(body);write();
     // Count is consumed before dispatch. A lost response is never rePOSTed.
     return route.continue({postData:JSON.stringify(body),headers:{...req.headers(),'content-type':'application/json'}});
    }catch(error){report.events.push({kind:'submission_refused',error:String(error)});write();return route.abort('blockedbyclient');}
   }
   await route.continue();
  });
  page.on('response',response=>{
   const task=(async()=>{
    const pathname=new URL(response.url()).pathname;
    if(pathname==='/api/jobs'&&response.request().method()==='POST'&&response.ok()){const job=await response.json();if(job.job_id)jobIds.add(job.job_id);report.events.push({kind:'submit_response',job});write();}
    if(/^\/api\/jobs\/[0-9a-f]{32}$/.test(pathname)&&response.ok()){
     const job=await response.json();if(jobIds.has(job.job_id)&&['succeeded','failed','canceled','uncertain','orphaned'].includes(job.state)){
      const at=report.jobs.findIndex(row=>row.job_id===job.job_id);if(at<0)report.jobs.push(job);else report.jobs[at]=job;write();
     }
    }
   })().catch(error=>{report.events.push({kind:'response_observation_error',error:String(error)});write();});responseTasks.add(task);task.finally(()=>responseTasks.delete(task));
  });
  await page.goto(config.baseUrl,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>globalThis.PankekiStudio&&globalThis.PankekiProjectLibrary&&document.querySelector('#imageModel option[value="sdxl-base"]'));
  assert.equal(await page.locator('meta[name="pankeki-source-id"]').getAttribute('content'),config.expectedSourceId);
  await page.evaluate(()=>PankekiStudio.ready);report.stages.identity='PASS';write();
  await page.waitForFunction(()=>!document.getElementById('imageModel').disabled);
  await page.waitForFunction(()=>!document.querySelector('#pcProjectLibraryActions [data-pk-action="new"]').disabled);
  if(config.resume){const raw=fs.readFileSync(path.join(out,'generation-recovered.pankeki.json'),'utf8');assert.equal(await page.evaluate(raw=>PankekiStudio.requestImportProject(raw),raw),true,'Actual recovered downloaded project import failed');report.events.push({kind:'resume_from_actual_downloaded_project',file:'generation-recovered.pankeki.json'});write();}
  assert.equal(await page.evaluate(()=>PankekiStudio.getState().project.versions.length),config.resume?1:0,'Unexpected isolated QA project contents');
  async function settings(index){await page.evaluate(index=>{
   const set=(id,value)=>{const el=document.getElementById(id);if(typeof value==='boolean')el.checked=value;else el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));};
   PankekiWorkflowController.go(index===0?'design':'inpaint');PankekiStudio.setMode(index===0?'txt2img':'inpaint');
   const model=document.getElementById('imageModel');model.value='sdxl-base';model.dispatchEvent(new Event('change',{bubbles:true}));
   for(const [key,value]of Object.entries({width:512,height:512,steps:2,seed:2026102801+index,cfg:5,denoise:1,candidateCount:1,cache:false,roi:false,previewOn:false,halo:0,feather:0,sampler:'euler',scheduler:'normal',negative:'',useBrief:false,projectName:'Isolated core E2E QA',prompt:index===0?'A simple blue circle and yellow square on a plain white background, flat colored geometric shapes':'A vivid red square, flat colored geometric shape on a plain white background'}))set(key,value);
   if(index===1)set('editOperation','regenerate');
  },index);}
  async function generate(index){
   await settings(index);let timer;
   try{const ok=await Promise.race([page.evaluate(()=>PankekiStudio.generate()),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Owned job observation deadline; no cancel or retry sent')),Math.max(1,runDeadline-Date.now()));})]);assert.equal(ok,true,await page.locator('#status').textContent());}
   finally{clearTimeout(timer);}
   await Promise.all([...responseTasks]);
   const state=await page.evaluate(()=>PankekiStudio.getState());assert.equal(state.project.versions.length,index+1);
   const row=state.project.versions[index];assert.ok(row.execution,'Actual app candidate must retain backend execution');
   fs.writeFileSync(path.join(out,index===0?'generation-candidate.json':'edit-candidate.json'),JSON.stringify(row,null,2));
   fs.writeFileSync(path.join(out,index===0?'generation-candidate.png':'edit-candidate.png'),Buffer.from(row.image.split(',')[1],'base64'));
   await page.screenshot({path:path.join(out,index===0?'01-generation.png':'02-edit.png'),fullPage:true});return row;
  }
  const generated=config.resume?await page.evaluate(()=>PankekiStudio.getState().project.versions[0]):await generate(0);
  if(config.resume)assert.equal(generated.execution.resultSha256,report.jobs[0].result.result_sha256,'Recovered original candidate SHA differs');
  report.stages.generation='PASS';write();
  await page.evaluate(()=>PankekiWorkflowController.go('design'));
  if(config.resume)await page.screenshot({path:path.join(out,'01-generation-restored.png'),fullPage:true});
  // Use the actual candidate continuation control, preserving its parent ID and
  // edit selection history. Then load a real PNG through the app mask input.
  await page.evaluate(async id=>{const card=document.querySelector('#gallery [data-candidate-id="'+id+'"]');const edit=card?.querySelector('[data-action="edit"]');if(!edit)throw Error('Actual candidate edit control missing');await edit.onclick();},generated.id);
  await page.waitForFunction(id=>PankekiStudio.getState().sourceId===id&&PankekiStudio.getState().sourceLoaded,generated.id);
  const mask=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=512;const ctx=c.getContext('2d');ctx.fillStyle='black';ctx.fillRect(0,0,512,512);ctx.fillStyle='white';ctx.fillRect(224,224,64,64);return c.toDataURL('image/png');});
  fs.writeFileSync(path.join(out,'mask.png'),Buffer.from(mask.split(',')[1],'base64'));
  await page.locator('#maskUpload').setInputFiles({name:'bounded-mask.png',mimeType:'image/png',buffer:Buffer.from(mask.split(',')[1],'base64')});
  await page.waitForFunction(()=>!PankekiStudio.getState().maskLoading&&document.getElementById('status').textContent.includes('마스크를 불러왔어요'));
  const edited=await generate(1);assert.equal(edited.parentId,generated.id);report.stages.edit='PASS';write();
  const exported=await page.evaluate(()=>PankekiStudio.exportProject());fs.writeFileSync(path.join(out,'project-export.json'),exported);
  async function save(name){
   const pending=page.waitForEvent('download');
   await page.evaluate(()=>document.getElementById('saveProject').onclick());
   const download=await pending;await download.saveAs(path.join(out,name));
   assert.equal(fs.readFileSync(path.join(out,name),'utf8'),exported,'Actual downloaded export differs from live project');
   await page.waitForFunction(async raw=>{const state=await PankekiProjectLibrary.createIndexedDBStore().read();return state.activeId&&state.records.some(row=>row.id===state.activeId&&row.raw===raw);},exported);
   await page.waitForFunction(async raw=>new Promise((resolve,reject)=>{const request=indexedDB.open('pankeki-character-studio',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('projects'),read=tx.objectStore('projects').get('current');read.onsuccess=()=>{const same=read.result===raw;db.close();resolve(same);};read.onerror=()=>{db.close();reject(read.error);};};}),exported);
   const snapshot=await page.evaluate(()=>PankekiProjectLibrary.createIndexedDBStore().read());fs.writeFileSync(path.join(out,name+'.indexeddb.json'),JSON.stringify(snapshot,null,2));return snapshot;
  }
  const saved=await save('project-saved.pankeki.json');report.stages.save='PASS';write();
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>globalThis.PankekiStudio);await page.evaluate(()=>PankekiStudio.ready);
  await page.waitForFunction(raw=>PankekiStudio.exportProject()===raw,exported);
  const afterReload=await page.evaluate(()=>PankekiStudio.exportProject());assert.equal(afterReload,exported);report.stages.reload='PASS';write();
  assert.equal(await page.evaluate(raw=>PankekiStudio.requestImportProject(raw),exported),true,'Actual UI project import failed');
  assert.equal(await page.evaluate(()=>PankekiStudio.exportProject()),exported);report.stages.import='PASS';write();
  const resaved=await save('project-resaved.pankeki.json');report.stages.resave='PASS';write();
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>globalThis.PankekiStudio);await page.evaluate(()=>PankekiStudio.ready);
  await page.waitForFunction(raw=>PankekiStudio.exportProject()===raw,exported);
  const reopened=await page.evaluate(()=>CharacterDesign.parseProject(PankekiStudio.exportProject()));
  assert.deepEqual(reopened.versions.map(row=>row.execution),[generated.execution,edited.execution]);
  const candidateHashes=await page.evaluate(()=>CharacterDesign.parseProject(PankekiStudio.exportProject()).versions.map(row=>CharacterDesign.imageSha256(row.image)));
  assert.deepEqual(candidateHashes,[generated.execution.resultSha256,edited.execution.resultSha256]);
  report.stages.reopen='PASS';
  report.persistence={passed:true,firstActiveId:saved.activeId,resavedActiveId:resaved.activeId,candidates:reopened.versions.map(row=>({id:row.id,parentId:row.parentId,execution:row.execution})),project_sha256:crypto.createHash('sha256').update(exported).digest('hex')};
  await page.screenshot({path:path.join(out,'03-reopened.png'),fullPage:true});
  await identity();await Promise.all([...responseTasks]);assert.equal(report.job_posts,2);assert.equal(report.jobs.length,2);for(const job of report.jobs)assert.equal(job.state,'succeeded');
  report.status='BROWSER_CORE_LOOP_PASS';write();
 }catch(error){report.status='FAIL';report.error=String(error.stack||error);write();throw error;}
 finally{
  for(const id of jobIds){try{const job=await get(config.baseUrl+'/api/jobs/'+id);const at=report.jobs.findIndex(row=>row.job_id===id);if(at<0)report.jobs.push(job);else report.jobs[at]=job;}catch(error){report.events.push({kind:'final_owned_job_observation_unavailable',job_id:id,error:String(error)});}}
  write();if(context)await context.close();
 }
 return report;
}
async function runPersistence(config){
 if(config.allowGpu!==false)throw Error('Persistence-only mode forbids GPU permission');
 const parsed=new URL(config.baseUrl);if(!['127.0.0.1','localhost'].includes(parsed.hostname)||['8190','8188',''].includes(parsed.port))throw Error('Protected or nonstaging service');
 const raw=fs.readFileSync(config.projectPath,'utf8'),document=JSON.parse(raw);assert.equal(document.versions.length,2);for(const row of document.versions)assert.ok(row.execution?.resultSha256);
 const out=config.outputDir,profile=path.join(out,'isolated-browser-profile');if(fs.existsSync(profile))throw Error('Persistence test requires a fresh isolated profile');
 const report={status:'IN_PROGRESS',mode:'persistence-only',gpu_job_posts:0,blocked_posts:[],stages:{import:'UNVERIFIED',explicitSave:'UNVERIFIED',immediateReopen:'UNVERIFIED',resave:'UNVERIFIED',secondReopen:'UNVERIFIED'},events:[],native_acceptance:'UNVERIFIED',visual_quality:'UNVERIFIED'};
 const write=()=>fs.writeFileSync(path.join(out,'persistence-report.json'),JSON.stringify(report,null,2));
 const {chromium}=require('playwright');let context,page;
 const launchArgs=['--no-first-run','--disable-sync','--disable-background-networking','--disable-component-update','--disable-domain-reliability','--disable-extensions','--safebrowsing-disable-auto-update','--password-store=basic','--use-mock-keychain','--disable-features=OptimizationHints,OptimizationGuideModelDownloading,MediaRouter'];
 const sha=text=>crypto.createHash('sha256').update(text).digest('hex');
 async function open(){
  context=await chromium.launchPersistentContext(profile,{executablePath:config.browserExecutable,headless:true,acceptDownloads:true,viewport:{width:1600,height:1100},args:launchArgs});
  const commands=require('node:child_process').execFileSync('/bin/ps',['-axo','pid,ppid,command'],{encoding:'utf8'}).split('\n').filter(line=>line.includes(profile));
  const launchFile=path.join(out,'chrome-launch-processes.json'),launches=fs.existsSync(launchFile)?JSON.parse(fs.readFileSync(launchFile,'utf8')):[];launches.push({at:Date.now(),commands});fs.writeFileSync(launchFile,JSON.stringify(launches,null,2));
  await context.route('**/*',route=>{const req=route.request(),url=new URL(req.url());if(req.method()==='POST'){report.blocked_posts.push({url:req.url(),body_sha256:sha(req.postData()||'')});write();return route.abort('blockedbyclient');}if(['http:','https:','ws:','wss:'].includes(url.protocol)&&![new URL(config.baseUrl).origin,new URL(config.comfyUrl).origin].includes(url.origin)){report.events.push({kind:'external_request_blocked',url:req.url()});write();return route.abort('blockedbyclient');}return route.continue();});
  page=context.pages()[0]||await context.newPage();page.on('dialog',async dialog=>{report.events.push({kind:'dialog',type:dialog.type(),message:dialog.message()});write();if(dialog.type()==='confirm'&&dialog.message().includes('현재 프로젝트')&&dialog.message().includes('교체'))await dialog.accept();else await dialog.dismiss();});
  page.on('pageerror',error=>{report.events.push({kind:'pageerror',error:String(error)});write();});
  await page.goto(config.baseUrl,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>globalThis.PankekiStudio&&globalThis.PankekiProjectLibrary);await page.evaluate(()=>PankekiStudio.ready);
  await page.waitForFunction(()=>!document.querySelector('#pcProjectLibraryActions [data-pk-action="new"]').disabled);
  assert.equal(await page.locator('meta[name="pankeki-source-id"]').getAttribute('content'),config.expectedSourceId);
  report.events.push({kind:'opened',at:Date.now(),source_id:config.expectedSourceId});write();
 }
 async function actualRaw(name){const value=await page.evaluate(()=>PankekiStudio.exportProject());fs.writeFileSync(path.join(out,name),value);return value;}
 async function sameProject(name){const actual=await actualRaw(name);assert.equal(sha(actual),sha(raw),'Project changed; full expected/actual artifacts retained');const rows=await page.evaluate(()=>CharacterDesign.parseProject(PankekiStudio.exportProject()).versions.map(row=>({id:row.id,parentId:row.parentId,sha:CharacterDesign.imageSha256(row.image),execution:row.execution})));assert.deepEqual(rows.map(row=>row.sha),document.versions.map(row=>row.execution.resultSha256));assert.deepEqual(rows.map(row=>row.execution),document.versions.map(row=>row.execution));return rows;}
 async function saveAndClose(name){
  const pending=page.waitForEvent('download');const started=Date.now();await page.evaluate(()=>document.getElementById('saveProject').onclick());const handlerResolved=Date.now();
  const appSaveStatus=await page.evaluate(()=>({text:document.getElementById('projectStatus').textContent,error:document.getElementById('projectStatus').classList.contains('error')}));assert.equal(appSaveStatus.error,false,'Product explicit save reported an error');
  const download=await pending;await download.saveAs(path.join(out,name));const file=fs.readFileSync(path.join(out,name),'utf8');assert.equal(sha(file),sha(raw),'Real downloaded project changed');
  // Deliberately no timer, polling, legacy-DB wait, or catalog barrier here.
  // The product's explicit save handler must supply its own durability boundary.
  const closeRequested=Date.now();await context.close();context=null;
  report.events.push({kind:'explicit_save_then_immediate_close',file:name,started,handlerResolved,closeRequested,handler_to_close_ms:closeRequested-handlerResolved,appSaveStatus,test_inserted_sleep_ms:0,legacy_db_polling:false,catalog_db_polling:false});write();
 }
 try{
  fs.writeFileSync(path.join(out,'expected-project.pankeki.json'),raw);write();await open();
  report.events.push({kind:'ui_file_import_started',at:Date.now()});write();
  await page.locator('#loadProject').setInputFiles({name:'actual-two-candidate-project.pankeki.json',mimeType:'application/json',buffer:Buffer.from(raw)});
  await page.waitForFunction(()=>!PankekiStudio.getState().importing&&PankekiStudio.getState().project.versions.length===2);
  await page.waitForFunction(()=>!document.querySelector('#pcProjectLibraryActions [data-pk-action="new"]').disabled);
  report.events.push({kind:'ui_import_and_catalog_ready',at:Date.now()});write();
  report.imported=await sameProject('after-import.pankeki.json');report.stages.import='PASS';write();
  await saveAndClose('explicit-saved.pankeki.json');report.stages.explicitSave='PASS';write();
  await open();report.firstReopen=await sameProject('first-immediate-reopen.pankeki.json');report.stages.immediateReopen='PASS';write();
  await page.evaluate(()=>PankekiWorkflowController.go('design'));await page.screenshot({path:path.join(out,'01-immediate-reopen.png'),fullPage:true});
  await saveAndClose('explicit-resaved.pankeki.json');report.stages.resave='PASS';write();
  await open();report.secondReopen=await sameProject('second-immediate-reopen.pankeki.json');report.stages.secondReopen='PASS';write();
  await page.evaluate(()=>PankekiWorkflowController.go('design'));await page.screenshot({path:path.join(out,'02-second-reopen.png'),fullPage:true});
  const snapshot=await page.evaluate(()=>PankekiProjectLibrary.createIndexedDBStore().read());fs.writeFileSync(path.join(out,'final-catalog.json'),JSON.stringify(snapshot,null,2));
  assert.equal(report.blocked_posts.length,0,'Unexpected HTTP POST attempted; all blocked');report.status='PERSISTENCE_ONLY_PASS';write();
 }catch(error){report.status='FAIL';report.error=String(error.name||'Error')+': '+String(error.message||error).slice(0,1600);if(page)try{await actualRaw('failure-current-project.pankeki.json');await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});}catch{}write();throw error;}
 finally{if(context)await context.close();write();}
 return report;
}

module.exports={queueState,validateRequest,resumeLedger,run,runPersistence};
if(require.main===module){const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));(config.mode==='persistence-only'?runPersistence(config):run(config)).catch(error=>{process.stderr.write(String(error.stack||error)+'\n');process.exitCode=1;});}

// Real production UI/library with isolated storage and desktop IPC I/O.
'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const filename=path.join(__dirname,'test_central_composer.cjs'),source=fs.readFileSync(filename,'utf8'),boundary=source.indexOf("\ntest('home entry moves");
if(boundary<0)throw Error('Review changed central-composer fixture boundary');
const fixture=new Module(filename,module);fixture.filename=filename;fixture.paths=Module._nodeModulePaths(__dirname);
fixture._compile(source.slice(0,boundary)+'\nmodule.exports={test,assert,mounted,transport,ProjectStore,type,settle,until};',filename);
const {assert,mounted,transport,ProjectStore,type,settle,until}=fixture.exports;
const test=(name,fn)=>require('node:test')(name,{timeout:15000},fn);

test('home generation submission keeps its payload through ordinary entry and sends once',async()=>{
 const store=new ProjectStore(),ipc=transport();let input,library,atSend;const send=ipc.sendMessage;
 ipc.sendMessage=async payload=>{atSend={value:input.value,start:input.selectionStart,end:input.selectionEnd,kind:library.getState().activeKind};return send(payload);};
 const ui=await mounted(ipc,{projectStore:store});library=ui.workspace.projects;input=ui.doc.getElementById('pcPrompt');
 try{const project=library.getState().activeId,original=structuredClone(store.state.records.find(v=>v.id===project));
  assert.equal(await library.openGeneration(),true);await ui.input('projectName','Ordinary saved work');await type(ui,'이전 일반 초안');input.setSelectionRange(1,4);await library.saveCurrent();const general=library.getState().activeId;
  assert.equal(await library.switchTo(project),true);await settle();ui.workspace.go('home');await type(ui,'집 앞 고양이 그림을 만들어줘');input.setSelectionRange(2,7);
  const form=ui.doc.getElementById('pkPromptForm');await form.requestSubmit();await settle();await form.requestSubmit();
  assert.equal(library.getState().activeKind,'generation','home send uses ordinary context rather than the selected project');assert.equal(library.getState().activeId,general);
  assert.equal(ui.ipc.calls.send.length,1);assert.equal(ui.ipc.calls.send[0].text,'[Pankeki action: auto]\n집 앞 고양이 그림을 만들어줘');
  assert.deepEqual(atSend,{value:'집 앞 고양이 그림을 만들어줘',start:2,end:7,kind:'generation'});assert.equal(input.value,'');
  assert.deepEqual(store.state.records.find(v=>v.id===project),original);assert.equal(library.getState().items.length,1);assert.equal(ui.requests.length,0);
  const ref=ui.ipc.calls.send[0];await ui.ipc.emit({...ref,type:'intent-resolved',payload:{intent:'chat'}});await ui.ipc.emit({...ref,type:'turn-completed',payload:{status:'completed'}});await settle();
  assert.equal(await library.switchTo(project),true);assert.equal(await library.openGeneration(),true);await settle();
  assert.equal(input.value,'이전 일반 초안');assert.equal(input.selectionStart,1);assert.equal(input.selectionEnd,4,'successful home send does not discard the dormant ordinary draft');
  await type(ui,'새 일반 편집 초안');input.setSelectionRange(2,5);assert.equal(await library.switchTo(project),true);assert.equal(await library.openGeneration(),true);await settle();
  assert.equal(input.value,'새 일반 편집 초안');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,5,'actual ordinary-editor input supersedes the old dormant draft');
 }finally{ui.view.destroy();}
});

test('Home ordinary submission crosses the native form task boundary once and drops changed drafts composition routes or disabled sends',async()=>{
 for(const wasProject of [false,true])for(const changed of ['none','draft','composition','route','disabled']){
  const ui=await mounted(transport(),{projectStore:new ProjectStore(),initialProject:false});try{const input=ui.doc.getElementById('pcPrompt'),form=ui.doc.getElementById('pkPromptForm');const library=ui.workspace.projects;await library.openGeneration();let projectId=null;if(wasProject){await type(ui,'일반 기존 초안');await library.newProject();projectId=library.getState().activeId;}ui.workspace.go('home');await type(ui,'한 번 보낼 한국어 요청');input.setSelectionRange(2,6);
   // Native form submission ignores recursive requests while firing submit.
   // The shared DOM fixture has no such browser algorithm or task queue.
   const tasks=[],timeout=ui.sandbox.setTimeout,submit=form.requestSubmit.bind(form);let firing=false,recursive=0,events=0;
   ui.sandbox.setTimeout=(fn,delay,...args)=>delay===0?(tasks.push(()=>fn(...args)),0):timeout(fn,delay,...args);
   form.requestSubmit=()=>{if(firing){recursive++;return Promise.resolve();}firing=true;events++;const pending=submit();setImmediate(()=>firing=false);return pending;};
   const pending=form.requestSubmit();await settle();assert.equal(ui.doc.body.dataset.studioScreen,'design');assert.equal(tasks.length,1,'Home must leave native submit dispatch before forwarding');assert.equal(ui.ipc.calls.send.length,0);assert.equal(input.value,'한 번 보낼 한국어 요청');
   if(changed==='draft')await type(ui,'새로 고친 초안');if(changed==='composition')await input.dispatchEvent(new ui.Event('compositionstart'));if(changed==='route')ui.workspace.go('projects');if(changed==='disabled')ui.doc.getElementById('pkGenerate').disabled=true;
   tasks.shift()();await pending;await settle();assert.equal(recursive,0);assert.equal(events,changed==='none'?2:1);assert.equal(ui.ipc.calls.send.length,changed==='none'?1:0);if(changed==='none')assert.equal(ui.ipc.calls.send[0].text,'[Pankeki action: auto]\n한 번 보낼 한국어 요청');else assert.equal(input.value,changed==='draft'?'새로 고친 초안':'한 번 보낼 한국어 요청');assert.equal(ui.requests.length,0);if(wasProject&&changed!=='none'){if(changed==='composition')await input.dispatchEvent(new ui.Event('compositionend'));assert.equal(await library.switchTo(projectId),true);assert.equal(await library.openGeneration(),true);assert.equal(input.value,changed==='draft'?'새로 고친 초안':'한 번 보낼 한국어 요청','an aborted forward remains the ordinary unsent draft');}
  }finally{ui.view.destroy();}
 }
});

test('home generation send failure keeps its visible payload and selection through later switches',async()=>{
 const store=new ProjectStore(),ipc=transport();ipc.sendMessage=async payload=>{ipc.calls.send.push(payload);throw Error('Controlled home send failure');};
 const ui=await mounted(ipc,{projectStore:store}),library=ui.workspace.projects,input=ui.doc.getElementById('pcPrompt');
 try{const project=library.getState().activeId;await library.openGeneration();await ui.input('projectName','Ordinary saved work');await type(ui,'이전 일반 초안');input.setSelectionRange(1,4);await library.saveCurrent();await library.switchTo(project);await settle();
  ui.workspace.go('home');await type(ui,'실패해도 남길 홈 요청');input.setSelectionRange(2,6);await ui.doc.getElementById('pkPromptForm').requestSubmit();await settle();
  assert.equal(library.getState().activeKind,'generation');assert.equal(input.value,'실패해도 남길 홈 요청');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,6);assert.equal(ipc.calls.send.length,1);
  assert.equal(await library.switchTo(project),true);assert.equal(await library.openGeneration(),true);await settle();
  assert.equal(input.value,'실패해도 남길 홈 요청');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,6,'failed payload is not hidden by the dormant-draft overlay');assert.equal(library.getState().items.length,1);assert.equal(ui.requests.length,0);
 }finally{ui.view.destroy();}
});

test('home generation IME and busy guards preserve the project while editor sends keep project context',async()=>{
 const store=new ProjectStore(),ui=await mounted(transport(),{projectStore:store}),library=ui.workspace.projects,input=ui.doc.getElementById('pcPrompt');
 try{const project=library.getState().activeId;ui.workspace.go('home');await type(ui,'조합 중 홈 요청');input.setSelectionRange(1,4);await input.dispatchEvent(new ui.Event('compositionstart'));await ui.doc.getElementById('pkPromptForm').requestSubmit();
  assert.equal(library.getState().activeId,project);assert.equal(input.value,'조합 중 홈 요청');assert.equal(ipcCount(ui),0);await input.dispatchEvent(new ui.Event('compositionend'));
  ui.workspace.go('design');await type(ui,'프로젝트 안에서만 대화');await ui.doc.getElementById('pkPromptForm').requestSubmit();assert.equal(library.getState().activeId,project);assert.equal(library.getState().activeKind,'project');assert.equal(ipcCount(ui),1);
  ui.workspace.go('home');await type(ui,'진행 중 보존할 홈 초안');input.setSelectionRange(2,5);await ui.doc.getElementById('pkPromptForm').requestSubmit();
  assert.equal(library.getState().activeId,project);assert.equal(ipcCount(ui),1);assert.equal(input.value,'진행 중 보존할 홈 초안');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,5);assert.equal(ui.requests.length,0);
 }finally{ui.view.destroy();}
});
function ipcCount(ui){return ui.ipc.calls.send.length;}

test('home image reference enters ordinary work while refused or busy entry never opens upload',async()=>{
 const store=new ProjectStore(),ui=await mounted(transport(),{projectStore:store}),library=ui.workspace.projects;let uploads=0;ui.element('upload').addEventListener('click',()=>uploads++);
 const reference=()=>ui.doc.getElementById('pkPromptForm').querySelector('[data-pk-action=reference]');
 try{const project=library.getState().activeId,original=structuredClone(store.state.records.find(v=>v.id===project));ui.workspace.go('home');assert(reference());await reference().click();
  assert.equal(library.getState().activeKind,'generation');assert.equal(uploads,1);assert.deepEqual(store.state.records.find(v=>v.id===project),original);
  assert.equal(await library.switchTo(project),true);await settle();ui.workspace.go('design');await reference().click();assert.equal(library.getState().activeId,project);assert.equal(library.getState().activeKind,'project');assert.equal(uploads,2,'project editor reference keeps its project context');
  ui.workspace.go('home');ui.sandbox.confirm=()=>false;await reference().click();assert.equal(library.getState().activeId,project);assert.equal(uploads,2,'declined entry cannot open upload');
  ui.sandbox.confirm=()=>true;ui.workspace.go('design');await type(ui,'진행 중인 프로젝트 대화');await ui.doc.getElementById('pkPromptForm').requestSubmit();assert.equal(ipcCount(ui),1);ui.workspace.go('home');await reference().click();
  assert.equal(library.getState().activeId,project);assert.equal(uploads,2,'busy entry cannot open upload');assert.equal(ui.requests.length,0);
 }finally{ui.view.destroy();}
});

test('home settings identify ordinary request destination and Projects keeps the active saved project name',async()=>{
 const ui=await mounted(transport(),{projectStore:new ProjectStore(),initialProject:'길고도 실제인 현재 프로젝트 이름'});
 try{ui.workspace.go('home');
  await ui.doc.getElementById('pcHomeOptions').click();const destination=ui.doc.getElementById('pcHomeDestination');assert(destination,'home names the ordinary-generation destination');assert.match(destination.textContent,/일반 생성으로 시작/);
  const title=ui.doc.getElementById('studioTitle');assert.equal(title.textContent,'길고도 실제인 현재 프로젝트 이름');assert.equal(title.classList.contains('sr-only'),false,'current project identity is visible');
  assert.equal(ui.workspace.projects.getState().activeKind,'project');assert.equal(ui.ipc.calls.send.length,0);
 }finally{ui.view.destroy();}
});

test('Projects resumes the current saved work from Home while separate ordinary drafts stay intact',async()=>{
 const store=new ProjectStore(),ui=await mounted(transport(),{projectStore:store}),library=ui.workspace.projects;
 try{const project=library.getState().activeId,input=ui.doc.getElementById('pcPrompt');await type(ui,'프로젝트 안의 미전송 초안');input.setSelectionRange(2,7);await library.saveCurrent();const original=structuredClone(store.state.records.find(item=>item.id===project));
  await library.openGeneration();await type(ui,'일반 생성 미전송 초안');input.setSelectionRange(1,5);await library.switchTo(project);await settle();ui.workspace.go('home');
  await ui.doc.querySelector('.pk-navigation [data-pk-route=projects]').click();const resume=ui.doc.getElementById('pcProjectsPageList').querySelector(`[data-pk-project-id="${project}"][data-pk-project-action=open]`);assert(resume,'Projects opens the actual current work');await resume.click();
  assert.equal(ui.doc.body.dataset.studioScreen,'design');assert.equal(library.getState().activeId,project);assert.equal(library.getState().activeKind,'project');assert.equal(input.value,'프로젝트 안의 미전송 초안');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,7);assert.deepEqual(store.state.records.find(item=>item.id===project).raw,original.raw);
  ui.workspace.go('home');await ui.doc.querySelector('.pc-home-projects [data-pk-route=projects]').click();assert.equal(ui.doc.body.dataset.studioScreen,'projects');assert.equal(library.getState().activeId,project);
  await library.openGeneration();await settle();assert.equal(input.value,'일반 생성 미전송 초안');assert.equal(input.selectionStart,1);assert.equal(input.selectionEnd,5);assert.equal(ui.ipc.calls.send.length,0);assert.equal(ui.requests.length,0);
 }finally{ui.view.destroy();}
});

'use strict';
// Real UI and IPC/storage boundaries; no provider or generation execution.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const sourceRoot=process.env.PANKEKI_ENGLISH_SOURCE_ROOT||path.join(__dirname,'..');
const api=require(path.join(sourceRoot,'web/src/ui-strings.js'));
const filename=path.join(__dirname,'test_central_composer.cjs'),source=fs.readFileSync(filename,'utf8'),boundary=source.indexOf("\ntest('home entry moves");
if(boundary<0)throw Error('Review changed central-composer fixture boundary');
const fixture=new Module(filename,module);fixture.filename=filename;fixture.paths=Module._nodeModulePaths(__dirname);
fixture._compile(source.slice(0,boundary)+'\nmodule.exports={test,assert,mounted,transport,ProjectStore,type,settle,until};',filename);
const {test,assert,mounted,transport,ProjectStore,type,settle,until}=fixture.exports;

test('known system errors use English while unknown text and user data retain their original values',()=>{
 assert.equal(api.locale,'en');
 assert.equal(api.message('이미지 도구 모듈이 준비되지 않았습니다.'),'The image tools module is not ready.');
 assert.equal(api.message('영상 생성에 필요한 여유 메모리 48.0GiB와 정상 압력을 확인해 주세요.'),'Video generation requires 48.0 GiB of available memory and normal memory pressure.');
 assert.equal(api.message('영상 엔진이 종료되었습니다 (exit -9). 작업 로그를 보존했습니다.'),'The video engine exited (exit -9). The job log was preserved.');
 const ownText='한글 이름과 내 말은 그대로 — ${notAnExpression}';assert.equal(api.message(ownText),ownText);
 const value={message:'파일 경로가 올바르지 않습니다.'};assert.equal(api.message(value),value);
 assert.equal(api.message('임의 접두사: 파일 경로가 올바르지 않습니다.'),'임의 접두사: 파일 경로가 올바르지 않습니다.');
});

test('English browsing preserves Korean project/candidate names and the exact ordinary draft without storage writes',async()=>{
 const seed=await mounted(),store=new ProjectStore(),project=seed.project('파일 경로가 올바르지 않습니다.');project.versions[0].label='내가 정한 한국어 후보 이름';project.versions[0].brief.notes='사용자가 적은 설명과 프롬프트';const raw=JSON.stringify(project);store.state.records=[{id:'korean-owner',raw,kind:'project',createdAt:'2026-10-29T00:00:00.000Z',updatedAt:'2026-10-30T00:00:00.000Z',favorite:true,recovered:false}];seed.view.destroy();
 const ui=await mounted(transport(),{projectStore:store,initialProject:false});try{
  await ui.workspace.projects.openGeneration();await type(ui,'원문 초안: 정면으로 서 있는 캐릭터를 그려줘.');const input=ui.doc.getElementById('pcPrompt');input.setSelectionRange(3,7);const before=ui.studio().exportProject(),records=JSON.stringify(store.state.records),settings=['width','height','seed','steps','cfg','sampler','scheduler','denoise'].map(id=>[id,ui.element(id).value]);
  ui.workspace.go('home');assert.deepEqual(Array.from(ui.doc.querySelectorAll('.pk-navigation button span'),n=>n.textContent.trim()),['Home','Projects','Generate images','Motion','Export','Gallery','Models','Settings']);
  await ui.doc.querySelector('[data-pk-action=recent-images]').click();const dialog=ui.doc.getElementById('pkLibrary');assert.match(dialog.textContent,/Recent generated images/);assert.match(dialog.querySelector('[data-pk-recent-image]').getAttribute('aria-label'),/내가 정한 한국어 후보 이름/);dialog.close();ui.workspace.go('projects');assert.match(ui.doc.getElementById('pcProjectsPageList').textContent,/파일 경로가 올바르지 않습니다\./);assert.match(ui.doc.getElementById('pcProjectsPageList').textContent,/1 candidate(?: ·|$)/);assert.doesNotMatch(ui.doc.getElementById('pcProjectsPageList').textContent,/1 candidates/);
  assert.equal(input.value,'원문 초안: 정면으로 서 있는 캐릭터를 그려줘.');assert.equal(input.selectionStart,3);assert.equal(input.selectionEnd,7);assert.equal(ui.studio().exportProject(),before);assert.equal(JSON.stringify(store.state.records),records);assert.deepEqual(['width','height','seed','steps','cfg','sampler','scheduler','denoise'].map(id=>[id,ui.element(id).value]),settings);assert.equal(ui.ipc.calls.send.length,0);assert.equal(ui.requests.length,0);
 }finally{ui.view.destroy();}
});

test('one Home send keeps the Korean wire prompt and displays a known service failure in English',async()=>{
 const ipc=transport();ipc.sendMessage=async input=>{ipc.calls.send.push(input);throw Error('이미지 도구 모듈이 준비되지 않았습니다.');};const ui=await mounted(ipc);try{
  const input=ui.doc.getElementById('pcPrompt'),draft='정면으로 서 있는 인물을 그려줘. 원문은 번역하지 마.';await type(ui,draft);ui.workspace.go('home');await ui.doc.getElementById('pkPromptForm').requestSubmit();await until(()=>ui.view.controller.getState().phase==='error','English service failure');
  assert.equal(ipc.calls.send.length,1);assert.equal(ipc.calls.send[0].text,'[Pankeki action: auto]\n'+draft);assert.equal(input.value,draft);assert.match(ui.doc.getElementById('pkComposerStatus').textContent,/The image tools module is not ready\./);assert.equal(ui.requests.length,0);
 }finally{ui.view.destroy();}
});

test('English transcript controls do not translate a Korean assistant reply or later user draft',async()=>{
 const ui=await mounted();try{
  await type(ui,'한국어로 답해 줘');await ui.doc.getElementById('pkPromptForm').requestSubmit();await until(()=>ui.ipc.calls.send.length===1,'one request');const sent=ui.ipc.calls.send[0];await ui.ipc.emit({...sent,type:'message',payload:{text:'원래 한국어 답변을 그대로 보여 줍니다.'}});await ui.ipc.emit({...sent,type:'turn-completed',payload:{status:'completed'}});await settle();
  assert.match(ui.doc.getElementById('pcConversation').textContent,/원래 한국어 답변을 그대로 보여 줍니다\./);await type(ui,'후속 한국어 초안');assert.equal(ui.doc.getElementById('pcPrompt').value,'후속 한국어 초안');assert.equal(ui.ipc.calls.send.length,1);
 }finally{ui.view.destroy();}
});

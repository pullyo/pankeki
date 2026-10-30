'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),Module=require('node:module');
const fixtureFile=path.join(__dirname,'test_ui_unification.cjs'),fixtureText=fs.readFileSync(fixtureFile,'utf8'),end=fixtureText.indexOf("\ntest('settings opened");
const fixture=new Module(fixtureFile,module);fixture.filename=fixtureFile;fixture.paths=module.paths;
fixture._compile(fixtureText.slice(0,end)+'\nmodule.exports={test,assert,page,settle,until,structuralDOM,RED,WHITE};',fixtureFile);
const {test,assert,page,settle,until,structuralDOM,RED,WHITE}=fixture.exports;
const api=require('../web/src/desktop-chat.js');
const plain=value=>JSON.parse(JSON.stringify(value));
function transport(){let listener;const calls={send:[],cancel:[],models:[],set:[],provider:[],prepare:[]};let provider='codex',modelId='default',modelRevision=0;
 const status=()=>({state:'ready',provider,modelId,modelRevision,toolsReady:true});
 return {calls,getStatus:async()=>({codex:status()}),connectCodex:async()=>status(),onCodexEvent(fn){listener=fn;return()=>listener=null;},emit:async event=>listener?.(event),sendMessage:async input=>{calls.send.push(input);return {requestId:input.requestId};},cancelMessage:async input=>{calls.cancel.push(input);return {canceled:true};},
 getChatModelOptions:async input=>{calls.models.push(input);return {provider:input.provider,selectedModelId:modelId,modelRevision,state:'ready',availability:'unverified',source:'codex-model-list',errorCode:null,options:[{id:'default',displayName:'Codex 기본값'},{id:'test-model',displayName:'검증용 모델'}]};},
 setChatModel:async input=>{calls.set.push(input);modelId=input.modelId;modelRevision++;return {provider,selectedModelId:modelId,modelRevision,conversationReset:true};},
 selectProvider:async input=>{calls.provider.push(input);provider=input.provider;modelId=provider==='claude'?'sonnet':'default';modelRevision++;return status();},
 prepareEditContext:async input=>{calls.prepare.push(input);return {...input,sourceId:'source-local',maskId:'mask-local'};}};}
async function mounted(ipc=transport(),{projectStore,initialProject}={}){
 const ui=page({catalog:{default_model_id:'sdxl-base',models:[{id:'sdxl-base',label:'SDXL Base 1.0',available:true,defaults:{width:1024,height:1024,steps:25,cfg:6,denoise:.55,sampler:'dpmpp_2m',scheduler:'karras'}},{id:'sd-turbo',label:'SD Turbo',available:false}],edit_models:[{id:'sdxl-inpaint-v01',label:'SDXL Inpaint v0.1',available:true}]}});await until(()=>ui.studio().getSummary().modelsReady,'models');const doc=structuralDOM(ui);ui.sandbox.pankekiDesktop=ipc;
 if(projectStore){await ui.studio().ready;if(initialProject!==false){await ui.studio().importProject(ui.project(initialProject||'Library A'));if(!projectStore.failRead&&!projectStore.state.records.length){projectStore.state.activeId='fixture-legacy-a';projectStore.state.records=[{id:'fixture-legacy-a',raw:ui.studio().exportProject(),createdAt:'2026-10-27T00:00:00.000Z',updatedAt:'2026-10-27T00:00:00.000Z',favorite:false,recovered:false}];}}const library=require('../web/src/project-library.js');ui.sandbox.PankekiProjectLibrary={create:options=>library.create({...options,store:projectStore})};}
 ui.sandbox.addEventListener||=()=>{};ui.sandbox.removeEventListener||=()=>{};for(const name of ['ResizeObserver','MutationObserver'])if(ui.sandbox[name]?.prototype)ui.sandbox[name].prototype.disconnect||=()=>{};
 for(const name of ['photo-editor.js','redesign.js','studio.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/src',name),'utf8'),ui.sandbox,{filename:name});
 const icons={};for(const name of ['folder','chevron-right','smile','pencil']){const svg=fs.readFileSync(path.join(__dirname,'../web/vendor/lucide',name+'.svg'),'utf8'),body=svg.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/)[1];icons[name]='<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">'+body+'</svg>';}
 const assets=doc.createElement('script');assets.id='redesignAssets';assets.textContent=JSON.stringify({images:{'catgirl-hero':'/template.png'},icons});doc.body.append(assets);
 const workspace=ui.sandbox.PankekiRedesign.mount(doc,ui.studio(),ui.sandbox.PankekiWorkflowController);
 const view=api.mount(doc,{ipc,studio:ui.studio(),workflow:ui.sandbox.PankekiWorkflowController});await settle();workspace.go('design');
 if(projectStore)await until(()=>workspace.projects.getState().initialized,'project library initialized');
 return {...ui,doc,workspace,view,ipc};
}
async function type(ui,text){const input=ui.doc.getElementById('pcPrompt');input.value=text;await input.dispatchEvent(new ui.Event('input',{bubbles:true}));}
async function choose(ui,id,value){const node=ui.doc.getElementById(id);assert(node,id);node.value=value;await node.dispatchEvent(new ui.Event('change',{bubbles:true}));}
// Storage I/O boundary only; the production catalog and host UI run unchanged.
class ProjectStore{
 constructor(){this.state={revision:0,activeId:null,records:[]};this.hold=null;this.failRead=false;}
 async read(){if(this.failRead)throw Error('Storage unavailable');return structuredClone(this.state);}
 async commit(change){if(this.hold){const gate=this.hold;this.hold=null;gate.enter();await gate.promise;}assert.equal(change.expectedRevision,this.state.revision);const records=new Map(this.state.records.map(value=>[value.id,structuredClone(value)]));for(const value of change.put||[])records.set(value.id,structuredClone(value));for(const id of change.remove||[])records.delete(id);const activeId=Object.hasOwn(change,'activeId')?change.activeId:this.state.activeId;this.state={revision:this.state.revision+1,activeId,records:[...records.values()]};return {revision:this.state.revision,activeId};}
}
function holdProjectWrite(store){let release,enter;const entered=new Promise(resolve=>enter=resolve),promise=new Promise(resolve=>release=resolve);store.hold={enter,promise};return {entered,release};}
test('home entry moves the same automatic form and draft then sends exactly once without resetting edit state',async()=>{
 const ui=await mounted();try{await ui.studio().importProject(ui.project('Home context'));ui.studio().setMode('inpaint');ui.element('paint').snapshot=WHITE;ui.element('paint').context.getImageData=()=>({data:new Uint8ClampedArray([255,255,255,255])});
  const input=ui.doc.getElementById('pcPrompt'),form=ui.doc.getElementById('pkPromptForm'),dock=form.closest('.pk-composer-dock'),source=ui.state().sourceDataURL,mask=ui.element('paint').snapshot,settingIds=['cache','previewOn','desktopGenerationModel','desktopEditModel','desktopChatProvider','desktopChatModel','width','height','seed','steps','cfg','sampler','scheduler','denoise'],settings=settingIds.map(id=>[id,ui.doc.getElementById(id).value,ui.doc.getElementById(id).checked]);await type(ui,'원본을 유지할 요청');input.setSelectionRange(2,5);await input.dispatchEvent(new ui.Event('compositionstart'));ui.workspace.go('home');assert.equal(ui.doc.body.dataset.studioScreen,'inpaint','IME route waits for compositionend');await form.requestSubmit();assert.equal(ui.ipc.calls.send.length,0);await input.dispatchEvent(new ui.Event('compositionend'));assert.equal(ui.doc.body.dataset.studioScreen,'home');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,5);
  for(let i=0;i<3;i++){ui.workspace.go('home');assert.equal(dock.parentNode.id,'pcHomeComposer');ui.workspace.go('inpaint');assert.equal(form.closest('.app-shell')?.classList.contains('app-shell'),true);assert.equal(ui.doc.getElementById('pcPrompt'),input);assert.equal(input.value,'원본을 유지할 요청');}
  ui.workspace.go('home');await input.dispatchEvent(new ui.Event('keydown',{key:'Enter',isComposing:true}));assert.equal(ui.ipc.calls.send.length,0);await input.dispatchEvent(new ui.Event('keydown',{key:'Enter'}));await settle();
  assert.equal(ui.doc.body.dataset.studioScreen,'inpaint');assert.equal(ui.ipc.calls.send.length,1);assert.equal(ui.ipc.calls.send[0].text,'[Pankeki action: auto]\n원본을 유지할 요청');assert.equal(ui.ipc.calls.send[0].automatic.edit.ready,true);assert.equal(ui.ipc.calls.send[0].context.sourceId,'source-local');assert.equal(ui.ipc.calls.send[0].context.maskId,'mask-local');assert.equal(ui.ipc.calls.prepare[0].sourceDataUrl,source);assert.equal(ui.ipc.calls.prepare[0].maskDataUrl,mask);assert.equal(ui.element('mode').value,'inpaint');assert.equal(ui.state().sourceDataURL,source);assert.equal(ui.element('paint').snapshot,mask);assert.deepEqual(settingIds.map(id=>[id,ui.doc.getElementById(id).value,ui.doc.getElementById(id).checked]),settings);
  ui.workspace.go('home');assert.equal(ui.doc.getElementById('pkGenerate').disabled,true);await form.requestSubmit();assert.equal(ui.ipc.calls.send.length,1);assert.equal(ui.doc.querySelectorAll('#pcPrompt').length,1);assert.equal(ui.doc.querySelectorAll('#pkPromptForm').length,1);assert.equal(ui.requests.length,0);
 }finally{ui.view.destroy();}
});
test('centered empty home stays local while all template presets and project file actions remain reachable through their menus',async()=>{
 const ui=await mounted();try{ui.workspace.go('home');await ui.doc.getElementById('pkPromptForm').requestSubmit();assert.equal(ui.doc.body.dataset.studioScreen,'home');assert.equal(ui.ipc.calls.send.length,0);
  assert.equal(ui.doc.querySelector('.pk-home-templates').hidden,true);assert.equal(ui.doc.querySelector('.pc-home-rail').hidden,true);
  const libraryIds=['catgirl','postman','pink','maid','bedroom','landscape'],libraryPrompts=new Set();for(const id of libraryIds){ui.workspace.go('home');await ui.doc.querySelector('.pc-welcome [data-pk-action=templates]').click();const library=ui.doc.getElementById('pkLibrary');assert.equal(library.open,true);assert.deepEqual(Array.from(library.querySelectorAll('[data-pk-template]'),button=>button.dataset.pkTemplate),[...libraryIds,'sd-character','expression-sheet','simple-sketch']);await library.querySelector(`[data-pk-template="${id}"]`).click();const text=ui.doc.getElementById('pcPrompt').value;assert(text.trim().length>0);libraryPrompts.add(text);assert.equal(ui.doc.body.dataset.studioScreen,'design');assert.equal(library.open,false);}assert.equal(libraryPrompts.size,6);
  ui.workspace.go('home');let upload=0,projectOpen=0;ui.element('upload').addEventListener('click',()=>upload++);ui.element('loadProject').addEventListener('click',()=>projectOpen++);await ui.doc.querySelector('#pcHomeComposer [data-pk-action=reference]').click();assert.equal(upload,1);assert.equal(ui.doc.body.dataset.studioScreen,'inpaint');ui.workspace.go('projects');await ui.doc.querySelector('#pcProjectsPage [data-pk-action=import]').click();assert.equal(projectOpen,1);await ui.doc.querySelector('.pk-header-home-actions [data-pk-action=settings]').click();await ui.doc.querySelector('#pkSettings [data-pk-panel=chat]').click();assert.equal(ui.doc.getElementById('pkSettings').dataset.panel,'chat');await ui.doc.querySelector('#pkSettings [data-pk-close]').click();await ui.doc.querySelector('.pk-navigation [data-pk-route=parts]').click();assert.equal(ui.doc.body.dataset.studioScreen,'parts');assert.equal(ui.ipc.calls.send.length,0);assert.equal(ui.requests.length,0);
 }finally{ui.view.destroy();}
});
// Controlled native decisions only: these fixtures do not classify natural language.
async function resolveIntent(ui,intent,ref=ui.ipc.calls.send.at(-1)){
 await ui.ipc.emit({...ref,type:'intent-resolved',payload:{intent,...(intent==='edit'?{operation:'regenerate'}:{})}});
}
async function ownJob(ui,jobId,ref=ui.ipc.calls.send.at(-1),intent='generate'){
 await resolveIntent(ui,intent,ref);const tool=intent==='edit'?'pankeki_edit':'pankeki_generate';
 await ui.ipc.emit({...ref,type:'tool-started',payload:{tool}});
 await ui.ipc.emit({...ref,type:'tool-completed',payload:{tool,ok:true,jobId,jobStatus:'queued'}});
}
function automaticRequest(ui,intent='generate',ref=ui.ipc.calls.send.at(-1)){
 const edit=intent==='edit',settings=edit?ref.automatic.edit.regenerate.settings:ref.automatic.generation.settings;
 return {...plain(ui.project().versions[0].request),...plain(settings),mode:edit?'inpaint':'txt2img',...(edit?{edit_operation:'regenerate',feather:ref.automatic.edit.feather}:{})};
}

test('desktop uses one central composer and typing/chat leave manual brief and project untouched',async()=>{
 const ui=await mounted();assert(ui.view);const nav=ui.doc.querySelector('.pk-navigation').textContent,logo=ui.doc.querySelector('.pk-brand img').src;
 const before=ui.studio().exportProject(),prompt=ui.element('prompt').value;await type(ui,'설정에 넣지 않을 대화');
 assert.equal(ui.element('prompt').value,prompt);assert.equal(ui.studio().exportProject(),before);
 assert.equal(ui.doc.getElementById('desktopChatPanel'),null);assert.equal(ui.doc.getElementById('desktopChatInput'),null);
 await ui.doc.getElementById('pkPromptForm').requestSubmit();assert.equal(ui.ipc.calls.send.length,1);assert.match(ui.ipc.calls.send[0].text,/Pankeki action: auto/);
 const ref=ui.ipc.calls.send[0];await ui.ipc.emit({...ref,type:'message-delta',payload:{text:'**중앙 답변** <script>bad</script>'}});
 assert.match(ui.doc.getElementById('pcConversation').textContent,/중앙 답변/);assert.equal(ui.doc.getElementById('pcConversation').querySelector('script'),null);
 assert.equal(ui.studio().exportProject(),before);assert.equal(ui.requests.length,0);assert.equal(ui.doc.querySelector('.pk-navigation').textContent,nav);assert.equal(ui.doc.querySelector('.pk-brand img').src,logo);ui.view.destroy();
});
test('automatic composer removes action and consent selectors while retaining one ordinary input and settings access',async()=>{
 const ui=await mounted();try{
  assert.equal(Boolean(ui.doc.getElementById('desktopChatIntent')),false);assert.equal(Boolean(ui.doc.getElementById('desktopChatConsent')),false);assert.equal(Boolean(ui.doc.getElementById('desktopChatConsentRow')),false);
  assert.equal(ui.doc.querySelectorAll('#pcPrompt').length,1);assert.equal(typeof ui.doc.getElementById('pkPromptForm').pankekiComposer.getAutomaticContext,'function');
  const before=ui.studio().exportProject();await type(ui,'이미지 생성 기능 설명해줘 / original English');await ui.doc.getElementById('pkPromptForm').requestSubmit();
  assert.equal(ui.ipc.calls.send.length,1);assert.equal(ui.ipc.calls.send[0].text,'[Pankeki action: auto]\n이미지 생성 기능 설명해줘 / original English');assert.equal(ui.studio().exportProject(),before);
  assert(ui.doc.getElementById('pcResolution'));assert.equal(ui.doc.getElementById('pcModelName').closest('button').hidden,false);
 }finally{ui.view.destroy();}
});
test('automatic composer keeps text chat available without image tools and shows image preparation errors without jobs',async()=>{
 const ipc=transport();ipc.getStatus=async()=>({codex:{state:'ready',provider:'codex',toolsReady:false}});const ui=await mounted(ipc);try{
  await type(ui,'이미지 생성 기능 설명해줘');assert.equal(ui.doc.getElementById('pkGenerate').disabled,false);await ui.doc.getElementById('pkPromptForm').requestSubmit();
  assert.equal(ipc.calls.send.length,1);await resolveIntent(ui,'chat');await ipc.emit({...ipc.calls.send[0],type:'turn-completed',payload:{status:'completed'}});assert.equal(ui.view.controller.getState().phase,'done');
  await type(ui,'고양이 캐릭터 그려줘');await ui.doc.getElementById('pkPromptForm').requestSubmit();await ipc.emit({...ipc.calls.send[1],type:'error',payload:{code:'tools-unavailable',message:'이미지 도구 연결을 확인해주세요.'}});
  assert.equal(ui.view.controller.getState().phase,'error');assert.match(ui.doc.getElementById('pkComposerStatus').textContent,/이미지 도구/);assert.equal(ui.requests.length,0);
 }finally{ui.view.destroy();}
});

test('authentication failure restores submitted draft without overwriting later typing',async()=>{
 const ui=await mounted();await type(ui,'보존할 초안');await ui.doc.getElementById('pkPromptForm').requestSubmit();let ref=ui.ipc.calls.send[0];
 await ui.ipc.emit({...ref,type:'error',payload:{code:'signed-out',message:'로그인이 필요해요.'}});assert.equal(ui.doc.getElementById('pcPrompt').value,'보존할 초안');
 await ui.ipc.emit({type:'status',payload:{state:'ready',toolsReady:true}});await ui.doc.getElementById('pkPromptForm').requestSubmit();ref=ui.ipc.calls.send.at(-1);await type(ui,'새로 쓰는 초안');
 await ui.ipc.emit({...ref,type:'error',payload:{code:'signed-out',message:'로그인 오류'}});assert.equal(ui.doc.getElementById('pcPrompt').value,'새로 쓰는 초안');ui.view.destroy();
});
test('central keyboard keeps IME/Shift Enter local and submits Enter only once',async()=>{
 const ui=await mounted();await type(ui,'한국어 입력');const input=ui.doc.getElementById('pcPrompt');
 await input.dispatchEvent(new ui.Event('keydown',{key:'Enter',isComposing:true}));await input.dispatchEvent(new ui.Event('keydown',{key:'Enter',keyCode:229}));await input.dispatchEvent(new ui.Event('keydown',{key:'Enter',shiftKey:true}));
 assert.equal(ui.ipc.calls.send.length,0);await input.dispatchEvent(new ui.Event('keydown',{key:'Enter'}));await settle();assert.equal(ui.ipc.calls.send.length,1);ui.view.destroy();
});
test('three settings groups reflect installed model capabilities and reject image changes while active',async()=>{
 const ui=await mounted();const before=ui.studio().exportProject();
 for(const id of ['desktopChatProvider','desktopChatModel','desktopGenerationModel','desktopEditModel'])assert(ui.doc.getElementById(id)?.closest('#pkSettings'),id);
 await choose(ui,'desktopEditModel','sdxl-inpaint-v01');assert.equal(ui.studio().getImageModelSettings().edit.selectedId,'sdxl-inpaint-v01');assert.equal(ui.studio().exportProject(),before);
 await type(ui,'대화');await ui.doc.getElementById('pkPromptForm').requestSubmit();const old=ui.studio().getImageModelSettings().generation.selectedId;
 assert.equal(ui.doc.getElementById('desktopGenerationModel').disabled,true);await choose(ui,'desktopGenerationModel','sd-turbo');assert.equal(ui.studio().getImageModelSettings().generation.selectedId,old);
 await choose(ui,'desktopChatModel','test-model');assert.equal(ui.ipc.calls.set.length,0);ui.view.destroy();
});
test('notification center records actual terminal requests and separates current connection from history',async()=>{
 const ui=await mounted();try{
  const bell=ui.doc.querySelector('[data-pk-action="notifications"]');bell.focus();await bell.click();const popup=ui.doc.getElementById('pcNotifications');assert(popup,'anchored notification center');assert.equal(popup.hidden,false);assert.equal(popup.querySelectorAll('[data-pc-notice-id]').length,0,'initial status is not a new event');assert(popup.querySelector('.pc-notification-empty'));
  await ui.doc.dispatchEvent(new ui.Event('keydown',{key:'Escape',target:bell}));assert.equal(popup.hidden,true);assert.equal(ui.doc.activeElement,bell);
  ui.element('projectStatus').textContent='후보와 설정을 이 브라우저에 자동 저장합니다. 마스크는 프로젝트 파일에 포함되지 않습니다.';await ui.input('notes',ui.element('notes').value);ui.flushMutations(ui.element('projectStatus'));assert.equal(bell.getAttribute('data-unread-count'),'0','asynchronous storage hint is not a task event');
  ui.element('status').textContent='ComfyUI 서버를 먼저 시작해주세요.';ui.element('status').classList.add('error');ui.flushMutations(ui.element('status'));assert.equal(bell.getAttribute('data-unread-count'),'0','connection bootstrap error is current state, not image completion');
  await type(ui,'설명을 해줘');await ui.doc.getElementById('pkPromptForm').requestSubmit();const ref=ui.ipc.calls.send[0];await resolveIntent(ui,'chat',ref);await ui.ipc.emit({...ref,type:'turn-completed',payload:{status:'completed'}});await settle();
  assert.equal(bell.getAttribute('data-unread-count'),'1');await bell.click();assert.equal(popup.querySelectorAll('[data-pc-notice-id]').length,1);assert.equal(popup.querySelector('.pc-notification-connection').contains(popup.querySelector('[data-pc-notice-id]')),false);
  const focused=popup.querySelector('[data-pc-notice-id]');focused.focus();await ui.ipc.emit({type:'status',payload:{state:'ready',provider:'codex',toolsReady:true}});assert.equal(ui.doc.activeElement,focused);assert.equal(ui.doc.body.contains(focused),true,'connection refresh keeps the focused event DOM');
  const before=ui.studio().exportProject();await popup.querySelector('[data-pc-notice-action="read-all"]').click();assert.equal(bell.getAttribute('data-unread-count'),'0');await popup.querySelector('[data-pc-notice-action="clear"]').click();assert.equal(popup.querySelectorAll('[data-pc-notice-id]').length,0);assert.equal(ui.studio().exportProject(),before);assert.equal(ui.ipc.calls.send.length,1);
  const projectStatus=ui.element('projectStatus');for(const text of ['프로젝트의 이미지 파일을 확인하고 있어요…','이 브라우저에 자동 저장했어요. 프로젝트 파일로도 보관할 수 있습니다.']){projectStatus.textContent=text;ui.flushMutations(projectStatus);}assert.equal(popup.querySelectorAll('[data-pc-notice-id]').length,0);
  projectStatus.textContent='프로젝트 파일을 내보냈어요. 브리프·후보 이미지·선택 기록이 포함됩니다.';ui.flushMutations(projectStatus);ui.flushMutations(projectStatus);assert.equal(popup.querySelectorAll('[data-pc-notice-id]').length,1,'explicit export completion is recorded once');
  projectStatus.textContent='자동 저장 실패: 저장소 없음';projectStatus.classList.add('error');ui.flushMutations(projectStatus);projectStatus.textContent='프로젝트의 이미지 파일을 확인하고 있어요…';projectStatus.classList.remove('error');ui.flushMutations(projectStatus);projectStatus.textContent='자동 저장 실패: 저장소 없음';projectStatus.classList.add('error');ui.flushMutations(projectStatus);assert.equal(popup.querySelectorAll('[data-pc-notice-id]').length,2,'repeated same failure is not badge spam');
  ui.element('healthText').textContent='ComfyUI 연결됨';ui.flushMutations(ui.element('healthText'));assert.equal(bell.getAttribute('data-unread-count'),'2','connection is not another event');assert.match(popup.querySelector('.pc-notification-connection').textContent,/ComfyUI 연결됨/);
  const search=ui.doc.getElementById('pkSearch');search.focus();await ui.doc.dispatchEvent(new ui.Event('click',{target:search}));assert.equal(popup.hidden,true);assert.equal(ui.doc.activeElement,search,'outside click does not steal focus');
 }finally{ui.view.destroy();}
});
test('installed model settings open their category without cloning controls or changing the draft',async()=>{
 const ui=await mounted();try{
  await type(ui,'한글 초안');const provider=ui.doc.getElementById('desktopChatProvider'),generation=ui.doc.getElementById('desktopGenerationModel'),edit=ui.doc.getElementById('desktopEditModel');
  const modelButton=ui.doc.getElementById('desktopChatSelectedModel');assert.match(modelButton.textContent,/AI 대화 · Codex · Codex 기본값/);assert.match(modelButton.getAttribute('aria-label'),/Codex.*Codex 기본값/);
  await ui.doc.getElementById('desktopChatSelectedModel').click();await settle();const drawer=ui.doc.getElementById('pkSettings');assert.equal(drawer.dataset.panel,'chat');assert.equal(provider.closest('[data-pk-settings-section]').hidden,false);assert.equal(generation.closest('[data-pk-settings-section]').hidden,true);
  await choose(ui,'desktopChatModel','test-model');await settle();assert.match(modelButton.getAttribute('aria-label'),/Codex.*검증용 모델/);assert.match(modelButton.getAttribute('title'),/AI 대화/);
  ui.workspace.settings('model','desktopEditModel');await settle();assert.equal(drawer.dataset.panel,'edit');assert.equal(ui.doc.activeElement,edit);assert.equal(edit.closest('[data-pk-settings-section]').hidden,false);assert.equal(provider.closest('[data-pk-settings-section]').hidden,true);
  for(const [id,node] of [['desktopChatProvider',provider],['desktopGenerationModel',generation],['desktopEditModel',edit]]){assert.equal(ui.doc.getElementById(id),node);assert.equal(ui.doc.querySelectorAll('#'+id).length,1);}
  assert.equal(ui.doc.getElementById('pcPrompt').value,'한글 초안');assert.equal(ui.ipc.calls.send.length,0);
  ui.view.destroy();assert.equal(ui.doc.getElementById('desktopModelSettings'),null);const next=api.mount(ui.doc,{ipc:ui.ipc,studio:ui.studio(),workflow:ui.sandbox.PankekiWorkflowController});await settle();
  for(const id of ['desktopChatProvider','desktopGenerationModel','desktopEditModel','desktopChatConnect'])assert.equal(ui.doc.querySelectorAll('#'+id).length,1,id+' unique after remount');next.destroy();
 }finally{ui.view.destroy();}
});
test('automatic capture and resolved actions preserve app mode source mask and the submitted setting snapshots',async()=>{
 const ui=await mounted();await ui.studio().importProject(ui.project('Keep'));ui.element('paint').snapshot=WHITE;
 ui.element('paint').getContext().getImageData=()=>({data:new Uint8ClampedArray([255,255,255,255])});ui.studio().setImageModelSettings({generationModelId:'sdxl-base',editModelId:'sdxl-inpaint-v01'});
 ui.workspace.go('inpaint');const source=ui.state().sourceDataURL,mask=ui.element('paint').snapshot,revision=ui.studio().desktopChat.getState().revision;
 await type(ui,'목도리만 수정');await ui.doc.getElementById('pkPromptForm').requestSubmit();await resolveIntent(ui,'edit');
 assert.equal(ui.element('mode').value,'inpaint');assert.equal(ui.ipc.calls.send[0].automatic.edit.regenerate.settings.model_id,'sdxl-inpaint-v01');assert.equal(ui.studio().desktopChat.getState().revision,revision);
 await ui.view.controller.cancel();await type(ui,'새 이미지');await ui.doc.getElementById('pkPromptForm').requestSubmit();await resolveIntent(ui,'generate');
 assert.equal(ui.element('mode').value,'inpaint');assert.equal(ui.ipc.calls.send[1].automatic.generation.settings.model_id,'sdxl-base');assert.equal(ui.state().sourceDataURL,source);assert.equal(ui.element('paint').snapshot,mask);ui.view.destroy();
});
test('accepted result reuses one actual candidate card within its AI turn',async()=>{
 const ui=await mounted();await ui.studio().importProject(ui.project());await type(ui,'새 후보');
 ui.ipc.resolveResult=async()=>({imageDataUrl:RED,request:automaticRequest(ui),metrics:{model_calls:1}});
 await ui.doc.getElementById('pkPromptForm').requestSubmit();const ref=ui.ipc.calls.send[0];await ownJob(ui,'job1',ref);await ui.ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'job1',resultId:'result1'}});
 const id=ui.state().project.versions.at(-1).id,cards=ui.doc.querySelectorAll(`.pc-turn[data-candidate-id="${id}"]`);assert.equal(cards.length,1);assert(cards[0].closest('.pc-ai-turn'));
 await ui.ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'job1',resultId:'result1'}});assert.equal(ui.state().project.versions.length,2);assert.equal(ui.doc.querySelectorAll(`.pc-turn[data-candidate-id="${id}"]`).length,1);ui.view.destroy();
});
test('automatic result with a duplicate completion releases composer and workspace after the model turn ends',async()=>{
 const ui=await mounted();
 try{
  await ui.studio().importProject(ui.project());await type(ui,'새 후보');
  ui.ipc.resolveResult=async()=>({imageDataUrl:RED,request:automaticRequest(ui),metrics:{model_calls:1}});
  await ui.doc.getElementById('pkPromptForm').requestSubmit();const ref=ui.ipc.calls.send[0];await ownJob(ui,'job-auto',ref);
  await ui.ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'job-auto',resultId:'job-auto',jobStatus:'succeeded'}});
  const id=ui.state().project.versions.at(-1).id;
  await ui.ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'job-auto',jobStatus:'succeeded'}});
  await ui.ipc.emit({...ref,type:'turn-completed',payload:{status:'completed'}});await ui.ipc.emit({type:'status',payload:{state:'ready',toolsReady:true}});
  assert.equal(ui.view.controller.getState().phase,'done');assert.equal(ui.view.controller.getState().activeRequestId,null);
  assert.equal(ui.view.controller.settingsLocked(),false);assert.equal(ui.doc.getElementById('pkCancel').hidden,true);
  assert.equal(ui.doc.getElementById('workspace').getAttribute('aria-busy'),'false');assert.equal(ui.state().project.versions.length,2);
  assert.equal(ui.doc.querySelectorAll(`.pc-turn[data-candidate-id="${id}"]`).length,1);
  await type(ui,'후속 대화');await ui.doc.getElementById('pkPromptForm').requestSubmit();assert.equal(ui.ipc.calls.send.length,2);assert.equal(ui.requests.length,0);assert.equal(ui.view.controller.getState().resolvedIntent,null);
 }finally{ui.view.destroy();}
});
test('candidate size uses decoded natural dimensions instead of request defaults',async()=>{
 const ui=await mounted();await ui.studio().importProject(ui.project());const img=ui.doc.querySelector('.pc-image-open img');img.naturalWidth=1024;img.naturalHeight=1536;await img.dispatchEvent(new ui.Event('load'));
 assert.match(ui.doc.querySelector('.pc-message-author').textContent,/1024 × 1536/);ui.view.destroy();
});
test('model catalogs ignore late provider responses and setting changes serialize against sending',async()=>{
 const ui=page();await until(()=>ui.studio().getSummary().modelsReady,'models');const ipc=transport();let finishOld;ipc.getChatModelOptions=input=>input.provider==='codex'?new Promise(resolve=>finishOld=resolve):Promise.resolve({provider:'claude',selectedModelId:'sonnet',modelRevision:1,availability:'unverified',options:[{id:'sonnet',displayName:'Sonnet'}]});
 const c=api.createController({ipc,adapter:ui.studio().desktopChat,subscribe:ui.studio().subscribe});await c.start();assert.equal(typeof c.loadChatModels,'function');await c.selectProvider('claude');await settle();finishOld({provider:'codex',selectedModelId:'default',modelRevision:0,options:[{id:'old',displayName:'Old'}]});await settle();
 assert.equal(c.getState().modelOptions.provider,'claude');assert.equal(c.getState().modelOptions.options[0].id,'sonnet');
 let save;ipc.setChatModel=input=>{ipc.calls.set.push(input);return new Promise(resolve=>save=resolve);};const pending=c.setChatModel('sonnet');assert.equal(await c.send({text:'must wait'}),false);assert.equal(await c.setChatModel('sonnet'),false);assert.equal(ipc.calls.set.length,1);
 save({provider:'claude',selectedModelId:'sonnet',modelRevision:2,conversationReset:true});await pending;assert.match(c.getState().notice,/새 AI 문맥/);c.destroy();
});
test('failed catalog and model save preserve the current model and unsent draft',async()=>{
 const ui=await mounted();await type(ui,'남겨둘 입력');const input=ui.doc.getElementById('pcPrompt');ui.ipc.setChatModel=async()=>{throw Object.assign(Error('저장소 쓰기 실패'),{code:'settings-write-failed'});};
 await choose(ui,'desktopChatModel','test-model');assert.equal(input.value,'남겨둘 입력');assert.equal(ui.view.controller.getState().codex.modelId,'default');assert.match(ui.doc.getElementById('desktopChatModelHelp').textContent,/실패|저장/);
 ui.ipc.getChatModelOptions=async()=>{throw Error('조회 실패');};await ui.view.controller.loadChatModels();assert.equal(ui.doc.getElementById('desktopChatModel').disabled,true);assert.match(ui.doc.getElementById('desktopChatModelHelp').textContent,/조회|목록/);ui.view.destroy();
});

test('cancel acknowledgement keeps model settings locked until native cancellation returns',async()=>{
 const ui=await mounted();await type(ui,'cancel me');await ui.doc.getElementById('pkPromptForm').requestSubmit();let acknowledge;ui.ipc.cancelMessage=()=>new Promise(resolve=>acknowledge=resolve);
 const pending=ui.view.controller.cancel();assert.equal(ui.doc.getElementById('desktopChatModel').disabled,true);assert.equal(ui.doc.getElementById('pkCancel').hidden,false,'cancel remains visible until acknowledgement');assert.equal(ui.doc.getElementById('pkCancel').disabled,true);assert.match(ui.doc.getElementById('pkComposerStatus').textContent,/취소/);assert.equal(await ui.view.controller.setChatModel('test-model'),false);assert.equal(ui.ipc.calls.set.length,0);acknowledge({canceled:true});await pending;assert.equal(ui.doc.getElementById('desktopChatModel').disabled,false);assert.match(ui.doc.getElementById('pkComposerStatus').textContent,/취소/);ui.view.destroy();
});
test('AI style choices stay in settings and capture generation metadata without rewriting a normal message',async()=>{
 const ui=await mounted();const selected=ui.doc.querySelectorAll('.pk-categories [aria-pressed="true"]');assert.equal(selected.length,1);assert.equal(selected[0].id,'pcNoAIStyle');
 assert(ui.doc.querySelector('.pk-categories').closest('#pcModelPanel'));const before=ui.studio().exportProject();await ui.doc.querySelector('[data-pk-category="background"]').click();await type(ui,'이미지 생성 기능 설명해줘');await ui.doc.getElementById('pkPromptForm').requestSubmit();
 assert.equal(ui.ipc.calls.send[0].text,'[Pankeki action: auto]\n이미지 생성 기능 설명해줘');assert.match(ui.ipc.calls.send[0].automatic.generationStyle.prompt,/environment background/);assert.equal(ui.ipc.calls.send[0].automatic.generationStyle.id,'background');assert.equal(ui.studio().exportProject(),before);ui.view.destroy();
});
test('successful AI model and provider changes keep unsent text and the project intact',async()=>{
 const ui=await mounted();await type(ui,'모델만 바꿔도 남는 초안');const before=ui.studio().exportProject();await choose(ui,'desktopChatModel','test-model');assert.match(ui.doc.getElementById('pkComposerStatus').textContent,/새 AI 문맥/);assert.equal(ui.doc.getElementById('pcPrompt').value,'모델만 바꿔도 남는 초안');
 await choose(ui,'desktopChatProvider','claude');assert.equal(ui.doc.getElementById('pcPrompt').value,'모델만 바꿔도 남는 초안');assert.equal(ui.studio().exportProject(),before);assert.equal(ui.ipc.calls.send.length,0);ui.view.destroy();
});

for(const change of ['reset','import'])test(`project replacement removes all old central AI turns (${change})`,async()=>{
 const ui=await mounted();await type(ui,'이전 프로젝트의 대화');await ui.doc.getElementById('pkPromptForm').requestSubmit();const ref=ui.ipc.calls.send[0];await ui.ipc.emit({...ref,type:'message-delta',payload:{text:'다른 프로젝트에 남으면 안 되는 답변'}});
 assert.equal(ui.doc.querySelectorAll('.pc-ai-turn').length,1);
 if(change==='reset')ui.studio().resetProject();else await ui.studio().importProject(ui.project('New project'));
 await settle();assert.equal(ui.view.controller.getState().messages.length,0);assert.equal(ui.doc.querySelectorAll('.pc-ai-turn').length,0);assert.equal(ui.doc.getElementById('pcConversation').textContent.includes('다른 프로젝트에 남으면 안 되는 답변'),false);assert.equal(ui.ipc.calls.cancel.length,1);
 await ui.ipc.emit({...ref,type:'message-delta',payload:{text:'LATE'}});assert.equal(ui.doc.querySelectorAll('.pc-ai-turn').length,0);ui.view.destroy();
});
for(const order of ['status-before-response','response-before-status'])test(`native restored model revision completes catalog loading (${order})`,async()=>{
 const ipc=transport();let answer;ipc.getChatModelOptions=()=>new Promise(resolve=>answer=resolve);const ui=await mounted(ipc);await type(ui,'복원 중에도 남길 초안');const before=ui.studio().exportProject();
 const status={state:'ready',provider:'codex',modelId:'test-model',modelRevision:1,toolsReady:true},catalog={provider:'codex',selectedModelId:'test-model',modelRevision:1,state:'ready',availability:'unverified',source:'codex-model-list',options:[{id:'default',displayName:'Codex 기본값'},{id:'test-model',displayName:'복원된 모델'}]};
 if(order==='status-before-response')await ipc.emit({type:'status',payload:status});answer(catalog);await settle();if(order==='response-before-status')await ipc.emit({type:'status',payload:status});
 const state=ui.view.controller.getState();assert.equal(state.modelOptions.loading,false);assert.equal(state.modelOptions.error,'');assert.equal(state.codex.modelRevision,1);assert.equal(state.codex.modelId,'test-model');assert.equal(ui.doc.getElementById('desktopChatModel').value,'test-model');assert.equal(ui.doc.getElementById('desktopChatModel').disabled,false);assert.equal(ui.doc.getElementById('pcPrompt').value,'복원 중에도 남길 초안');assert.equal(ui.studio().exportProject(),before);ui.view.destroy();
});
test('stale owned catalog ends loading without changing a newer native model selection',async()=>{
 const ipc=transport();let answer;ipc.getChatModelOptions=()=>new Promise(resolve=>answer=resolve);const ui=await mounted(ipc);
 await ipc.emit({type:'status',payload:{state:'ready',provider:'codex',modelId:'newer-model',modelRevision:2,toolsReady:true}});
 answer({provider:'codex',selectedModelId:'old-model',modelRevision:1,state:'ready',options:[{id:'old-model',displayName:'Old'}]});await settle();
 const state=ui.view.controller.getState();assert.equal(state.modelOptions.loading,false);assert.equal(state.codex.modelId,'newer-model');assert.equal(state.codex.modelRevision,2);ui.view.destroy();
});

function viewVisible(node){for(let current=node;current;current=current.parentNode)if(current.hidden||current.inert)return false;return true;}
test('installed settings expose the three model groups and preserve the legacy picker behind hidden/inert',async()=>{
 const ui=await mounted(),picker=ui.doc.getElementById('imageModel'),label=ui.doc.querySelector('label[for="imageModel"]'),help=ui.doc.getElementById('imageModelHelp');
 assert.equal(picker.hidden,true);assert.equal(picker.inert,true);assert.equal(viewVisible(label),false);assert.equal(viewVisible(help),false);
 for(const [category,ids] of [['chat',['desktopChatProvider','desktopChatModel']],['edit',['desktopEditModel']],['model',['desktopGenerationModel']]]){ui.workspace.settings(category);for(const id of ids)assert.equal(viewVisible(ui.doc.getElementById(id)),true,id);}
 assert.equal(ui.doc.querySelectorAll('#imageModel').length,1);assert.equal(typeof picker.onchange,'function');assert.equal(viewVisible(ui.doc.getElementById('resetModelPreset')),true);assert.equal(viewVisible(ui.doc.getElementById('width')),true);assert.equal(viewVisible(ui.doc.getElementById('height')),true);ui.view.destroy();
});
test('desktop retains one reachable preset reset action with its original handler and numeric defaults',async()=>{
 const ui=await mounted(),reset=ui.doc.getElementById('resetModelPreset'),handler=reset.onclick;assert.equal(viewVisible(reset),true);assert.equal(typeof handler,'function');assert.equal(ui.doc.querySelectorAll('#resetModelPreset').length,1);
 await ui.input('width','640');await ui.input('height','768');await ui.input('steps','13');await reset.click();
 assert.equal(Number(ui.element('width').value),1024);assert.equal(Number(ui.element('height').value),1024);assert.equal(Number(ui.element('steps').value),25);assert.equal(reset.onclick,handler);assert.equal(ui.ipc.calls.send.length,0);assert.equal(ui.requests.length,0);ui.view.destroy();
});
test('plain web keeps the original visible model picker and preset reset behavior',async()=>{
 const ui=await mounted(null);assert.equal(ui.view,null);const picker=ui.doc.getElementById('imageModel'),reset=ui.doc.getElementById('resetModelPreset');
 assert.equal(viewVisible(picker),true);assert.equal(!!picker.inert,false);assert.equal(viewVisible(ui.doc.querySelector('label[for="imageModel"]')),true);assert.equal(viewVisible(ui.doc.getElementById('imageModelHelp')),true);assert.equal(ui.doc.getElementById('desktopModelSettings'),null);
 await ui.input('width','640');await reset.click();assert.equal(Number(ui.element('width').value),1024);assert.equal(ui.requests.length,0);
});
test('disposing desktop view restores the same legacy picker label and help without replacing handlers',async()=>{
 const ui=await mounted(),picker=ui.doc.getElementById('imageModel'),handler=picker.onchange,label=ui.doc.querySelector('label[for="imageModel"]'),help=ui.doc.getElementById('imageModelHelp');assert.equal(picker.hidden,true);ui.view.destroy();
 assert.equal(ui.doc.getElementById('imageModel'),picker);assert.equal(picker.onchange,handler);assert.equal(viewVisible(picker),true);assert.equal(!!picker.inert,false);assert.equal(viewVisible(label),true);assert.equal(viewVisible(help),true);
});

test('installed edit layout reserves a usable viewport and scrolls instead of shrinking its workspace chain',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../web/src/desktop-chat.css'),'utf8');
 const rule=selector=>{const block=Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g)).find(match=>match[1].trim()===selector);assert(block,selector);return block[2];};
 const scope='body.pc-central-chat[data-studio-screen=inpaint]';
 assert.match(rule(scope+' .app-shell'),/overflow-y\s*:\s*auto/);
 for(const selector of [' .pk-generation-workspace',' .pk-generation-workspace>.canvas-stack',' .pk-generation-workspace .canvas-card'])assert.match(rule(scope+selector),/flex\s*:\s*1\s+0\s+auto/,selector);
 const viewport=rule(scope+' .pk-generation-workspace .canvas-viewport');assert(Number(/min-height\s*:\s*(\d+)px/.exec(viewport)?.[1])>=300);assert.match(viewport,/flex\s*:\s*1\s+0\s+\d+px/);
 assert.match(rule(scope+' .pc-thread[data-has-chat=true]'),/flex\s*:\s*0\s+0\s+auto/);
 assert.equal(css.includes('#source'),false,'view fix must not independently resize a bitmap layer');assert.equal(css.includes('#paint'),false);
});
test('edit operation caption is distinct while the original regenerate/recolor selector and handler work',async()=>{
 const ui=await mounted();await ui.studio().importProject(ui.project('Keep mask'));ui.workspace.go('inpaint');
 const select=ui.element('editOperation'),handler=select.onchange,label=select.closest('label');assert.equal(label.querySelector('span')?.textContent,'수정 방식');assert.equal(select,ui.doc.getElementById('editOperation'));assert.equal(typeof handler,'function');
 assert.deepEqual(select.querySelectorAll('option').map(option=>option.value),['regenerate','recolor']);const mask=ui.element('paint').snapshot,source=ui.state().sourceDataURL;
 await choose(ui,'editOperation','recolor');assert.equal(ui.studio().getSummary().editOperation,'recolor');await choose(ui,'editOperation','regenerate');assert.equal(ui.studio().getSummary().editOperation,'regenerate');assert.equal(select.onchange,handler);assert.equal(ui.element('paint').snapshot,mask);assert.equal(ui.state().sourceDataURL,source);assert.equal(ui.requests.length,0);ui.view.destroy();
});
test('unchanged shared fitter keeps source/paint geometry on one stage for controlled viewport sizes',()=>{
 const template=fs.readFileSync(path.join(__dirname,'../web/src/index.template.html'),'utf8'),start=template.indexOf(' const sourceCanvas ='),end=template.indexOf(' const editorSizeObserver',start);assert(start>0&&end>start);
 for(const [width,height] of [[960,58],[960,320],[1920,640]]){
  const stage={style:{}},source={width:1024,height:1024},editor={clientWidth:width,clientHeight:height},viewport={clientWidth:width,clientHeight:height};
  vm.runInNewContext(template.slice(start,end)+'\nfitSource();',{document:{getElementById:id=>({source,sourceStage:stage,editor,canvasViewport:viewport})[id]},requestAnimationFrame:fn=>fn(),getComputedStyle:()=>({paddingLeft:'0',paddingRight:'0',paddingTop:'0',paddingBottom:'0'})});
  const side=Math.min(width,height);assert.equal(stage.style.width,side+'px');assert.equal(stage.style.height,side+'px');
 }
 const css=fs.readFileSync(path.join(__dirname,'../web/src/style.css'),'utf8');assert.match(css,/\.stage #source\{[^}]*width:100%;height:100%/);assert.match(css,/\.stage #paint\{[^}]*width:100%;height:100%/);
});
async function openPinMode(ui){ui.sandbox.crypto.subtle=require('node:crypto').webcrypto.subtle;await ui.studio().importProject(ui.project('Pin project'));await ui.doc.querySelector('.pc-image-open').click();await ui.doc.querySelector('[data-ppe-tool="comments"]').click();await settle();}
test('pin tool keeps the same left conversation and composer while preserving the unsent draft',async()=>{
 const ui=await mounted(),input=ui.doc.getElementById('pcPrompt'),form=ui.doc.getElementById('pkPromptForm'),thread=ui.doc.getElementById('pcConversation'),formHome=form.parentNode,threadHome=thread.parentNode;await openPinMode(ui);await type(ui,'보존할 초안');assert.equal(form.parentNode,formHome);assert.equal(thread.parentNode,threadHome);assert.equal(ui.doc.getElementById('pcPinContext').closest('.pk-composer-dock'),formHome);assert.equal(ui.doc.getElementById('pcPinChat'),null);assert.equal(ui.doc.querySelectorAll('#pcPrompt').length,1);assert.equal(ui.doc.getElementById('pcPinContext').hidden,false);await ui.doc.getElementById('pcPinClear').click();assert.equal(ui.doc.getElementById('pcPrompt'),input);assert.equal(ui.doc.getElementById('pkPromptForm'),form);assert.equal(form.parentNode,formHome);assert.equal(thread.parentNode,threadHome);assert.equal(input.value,'보존할 초안');ui.view.destroy();
});
test('prepared pin note is visible beside preserved draft and reaches one existing automatic AI request',async()=>{
 const ui=await mounted();await openPinMode(ui);await type(ui,'기존 요청');const paint=ui.element('paint'),draw=paint.context.drawImage;paint.context.drawImage=function(image){if(image.tagName==='CANVAS')paint.snapshot=image.snapshot;else draw.call(this,image);};paint.context.getImageData=()=>({data:paint.snapshot===WHITE?[255,255,255,255]:[0,0,0,255]});
 const overlay=ui.doc.querySelector('.ppe-overlay');await overlay.dispatchEvent(new ui.Event('pointerdown',{button:0,clientX:30,clientY:30,pointerId:1}));const memo=ui.doc.querySelector('.ppe-comment-input');memo.value='핀의 머리색을 파랗게';await memo.dispatchEvent(new ui.Event('input'));const button=ui.doc.querySelector('.ppe-pin-popover').querySelectorAll('button').find(n=>n.textContent==='수정 요청 작성');await button.click();const input=ui.doc.getElementById('pcPrompt');assert.equal(input.value,'기존 요청\n\n핀의 머리색을 파랗게');assert.match(ui.doc.getElementById('pcPinContext').textContent,/핀의 머리색을 파랗게/);assert.equal(ui.studio().photoTools.getState().active,false);const beforeSource=ui.state().sourceDataURL,beforeMask=paint.snapshot,beforeRevision=ui.studio().desktopChat.getState().sourceRevision;ui.workspace.go('home');assert.equal(input.closest('#pcHomeComposer')?.id,'pcHomeComposer');assert.equal(input.value,'기존 요청\n\n핀의 머리색을 파랗게');assert.equal(ui.doc.getElementById('pcPinContext').hidden,false);assert.equal(ui.doc.getElementById('pcComposerTarget').hidden,false);await ui.doc.getElementById('pcComposerTarget').click();assert.equal(ui.element('mode').value,'inpaint','viewing the attached target preserves the edit context');ui.workspace.go('home');await ui.doc.getElementById('pkPromptForm').requestSubmit();assert.equal(ui.doc.body.dataset.studioScreen,'inpaint');assert.equal(ui.state().sourceDataURL,beforeSource);assert.equal(paint.snapshot,beforeMask);assert.equal(ui.studio().desktopChat.getState().sourceRevision,beforeRevision);assert.equal(ui.ipc.calls.send.length,1);assert.equal(ui.ipc.calls.send[0].text,'[Pankeki action: auto]\n기존 요청\n\n핀의 머리색을 파랗게');assert.equal(ui.ipc.calls.send[0].automatic.edit.ready,true);assert.equal(ui.ipc.calls.prepare.length,1);ui.view.destroy();
});
test('clearing a prepared pin restores an unchanged old draft and a new project cannot revive it',async()=>{
 const ui=await mounted();await openPinMode(ui);await type(ui,'원래 초안');await ui.doc.querySelector('.ppe-overlay').dispatchEvent(new ui.Event('pointerdown',{button:0,clientX:30,clientY:30,pointerId:1}));const memo=ui.doc.querySelector('.ppe-comment-input');assert(memo.closest('.ppe-pin-popover'),'memo input belongs beside pin');memo.value='핀 메모';await memo.dispatchEvent(new ui.Event('input'));await ui.doc.querySelector('.ppe-pin-popover').querySelectorAll('button').find(n=>n.textContent==='수정 요청 작성').click();assert.equal(ui.doc.getElementById('pcPrompt').value,'원래 초안\n\n핀 메모');await ui.element('clearMask').click();await settle();assert.equal(ui.doc.getElementById('pcPinContext').hidden,true);assert.equal(ui.doc.getElementById('pcPrompt').value,'원래 초안');await ui.studio().importProject(ui.project('New pin project'));await settle();assert.equal(ui.doc.getElementById('pcPrompt').value,'');assert.equal(ui.doc.querySelectorAll('#pcPrompt').length,1);ui.view.destroy();
});

test('image overlay saves exact PNG on keyboard activation without opening view and edits once through the existing action',async()=>{
 const ui=await mounted();await ui.studio().importProject(ui.project('Overlay'));const frame=ui.doc.querySelector('.pc-image-frame'),open=frame.querySelector('.pc-image-open'),actions=frame.querySelector('.pc-image-actions');assert(actions,'image actions belong inside the same frame');const edit=actions.querySelector('[data-pc-action="edit"]'),save=actions.querySelector('a');assert.equal(open.contains(edit),false);assert.equal(open.contains(save),false);assert.equal(edit.type,'button');assert.equal(save.getAttribute('aria-label'),'이미지 저장');save.focus();const keyboardClick=new ui.Event('click',{detail:0});await save.dispatchEvent(keyboardClick);assert.equal(keyboardClick.defaultPrevented,true);assert.equal(ui.downloads.length,1);assert.deepEqual(Buffer.from(await ui.downloads[0].blob.arrayBuffer()),Buffer.from(RED.split(',')[1],'base64'));assert.equal(ui.doc.querySelector('.pc-image-workspace').dataset.pcViewer,'closed');await open.click();assert.equal(ui.doc.querySelector('.pc-image-workspace').dataset.pcViewer,'open');await ui.doc.getElementById('pcCanvasClose').click();const sourceView=ui.element('sourceView'),original=sourceView.onclick;let invoked=0;sourceView.onclick=event=>{invoked++;return original(event);};assert.equal(ui.doc.body.contains(edit),true,'edit overlay remains attached');assert.equal(ui.view.controller.settingsLocked(),false,'edit is ready');edit.focus();await edit.dispatchEvent(new ui.Event('click',{detail:0}));await settle();assert.equal(invoked,1);assert.equal(ui.state().sourceId,'parent');assert.equal(ui.element('mode').value,'inpaint');assert.equal(ui.doc.querySelector('.pc-image-workspace').dataset.pcViewer,'closed');assert.equal(ui.ipc.calls.send.length,0);assert.equal(ui.requests.length,0);ui.view.destroy();
});

test('home compact composer keeps one draft and core controls with existing alternate actions',async()=>{
 const ui=await mounted();try{ui.view.destroy();ui.workspace.go('home');ui.view=api.mount(ui.doc,{ipc:ui.ipc,studio:ui.studio(),workflow:ui.sandbox.PankekiWorkflowController});await settle();assert.equal(ui.doc.getElementById('desktopChatControls').hidden,true,'initial binding on home does not expose the model badge');await type(ui,'보존할 한글 초안');const input=ui.doc.getElementById('pcPrompt'),form=ui.doc.getElementById('pkPromptForm'),group=ui.doc.querySelector('.pc-home-shortcuts');
  input.focus();input.setSelectionRange(2,5);assert.equal(group.hidden,true);assert.equal(ui.doc.getElementById('desktopChatControls').hidden,true);assert.equal(form.querySelector('.pc-prompt-label').classList.contains('sr-only'),true);assert.equal(input.getAttribute('aria-label'),'메시지');assert.equal(ui.doc.getElementById('pkComposerStatus').hidden,true);assert.equal(ui.doc.getElementById('pkGenerate').disabled,false);
  let uploads=0;ui.element('upload').addEventListener('click',()=>uploads++);await form.querySelector('[data-pk-action=reference]').click();assert.equal(uploads,1);assert.equal(ui.doc.body.dataset.studioScreen,'inpaint');assert.equal(ui.doc.getElementById('desktopChatControls').hidden,false);assert.equal(form.querySelector('.pc-prompt-label').classList.contains('sr-only'),false);assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,5);ui.workspace.go('home');await ui.doc.querySelector('.pk-header-home-actions [data-pk-action=settings]').click();await ui.doc.querySelector('#pkSettings [data-pk-panel=chat]').click();assert.equal(ui.doc.getElementById('desktopChatConnect').closest('fieldset').querySelector('legend').textContent,'AI 대화');assert.equal(ui.doc.querySelectorAll('#desktopChatProvider').length,1);assert.equal(ui.doc.getElementById('pcPrompt'),input);assert.equal(ui.doc.getElementById('pkPromptForm'),form);assert.equal(input.value,'보존할 한글 초안');assert.equal(ui.ipc.calls.send.length,0);assert.equal(ui.requests.length,0);
 }finally{ui.view.destroy();}
});
test('home compact feedback preserves actual connection error and cancel states',async()=>{
 const ui=await mounted();try{ui.workspace.go('home');const feedback=ui.doc.getElementById('pkComposerStatus'),send=ui.doc.getElementById('pkGenerate');assert.equal(feedback.hidden,true);
  for(const [state,text] of [['signed-out',/로그인/],['starting',/연결 중/],['missing',/사용할 수 없/]]){await ui.ipc.emit({type:'status',payload:{state}});assert.equal(feedback.hidden,false);assert.match(feedback.textContent,text);assert.equal(send.disabled,true);}
  await ui.ipc.emit({type:'status',payload:{state:'ready',toolsReady:true}});assert.equal(feedback.hidden,true);await type(ui,'유지할 요청');await ui.doc.getElementById('pkPromptForm').requestSubmit();ui.workspace.go('home');assert.equal(feedback.hidden,false);assert.equal(ui.doc.getElementById('pkCancel').hidden,false);await ui.doc.getElementById('pkCancel').click();assert.equal(feedback.hidden,false);assert.match(feedback.textContent,/취소/);assert.equal(ui.doc.getElementById('pkCancel').hidden,true);
  await type(ui,'오류 확인');await ui.doc.getElementById('pkPromptForm').requestSubmit();ui.workspace.go('home');const ref=ui.ipc.calls.send.at(-1);await ui.ipc.emit({...ref,type:'error',payload:{code:'signed-out',message:'로그인이 필요해요.'}});assert.equal(feedback.hidden,false);assert.equal(feedback.getAttribute('role'),'alert');assert.match(feedback.textContent,/로그인/);assert.equal(ui.doc.querySelectorAll('#pcPrompt').length,1);
 }finally{ui.view.destroy();}
});

const catalogTest=(name,fn)=>require('node:test')(name,{timeout:15000},fn);
catalogTest('project catalog UI uses actual rows previews paging and persistent ID favorites while candidates remain reachable',async()=>{
 const store=new ProjectStore(),ui=await mounted(transport(),{projectStore:store});try{ui.workspace.go('home');const lib=ui.workspace.projects,first=lib.getState().activeId;assert.equal(lib.getState().items.length,1);assert.equal(ui.doc.querySelectorAll('.pc-project-open').length,1);assert.equal(ui.doc.querySelector('.pc-project-preview').src,RED);assert.equal(ui.doc.getElementById('pcProjectPaging').hidden,true);
  assert.equal(ui.doc.getElementById('pcHomeProjectSummary').querySelector('strong').textContent,'현재 프로젝트');assert.equal(ui.doc.getElementById('studioTitle').textContent,'Library A');assert.equal(ui.doc.querySelector('.pc-project-active').textContent,'사용 중');assert.equal(ui.doc.querySelector('.pc-project-remove').hidden,true);assert.match(ui.doc.getElementById('pkFavorite').getAttribute('title'),/현재 프로젝트 Library A/);
  const actions=ui.doc.getElementById('pcProjectLibraryActions'),open=actions.querySelector('[data-pk-action=import]'),save=actions.querySelector('[data-pk-action=save]');for(const [button,label]of[[open,'열기'],[save,'파일 저장']]){assert.equal(button.querySelector('span').textContent,label);assert.equal(button.getAttribute('aria-label'),label);assert.equal(button.getAttribute('title'),label);}let picker=0;ui.element('loadProject').addEventListener('click',()=>picker++);await open.click();assert.equal(picker,1);await save.click();await lib.flush();assert.equal(ui.downloads.length,1);
  await ui.doc.getElementById('pkFavorite').click();await lib.flush();assert.equal(store.state.records.find(value=>value.id===first).favorite,true);
  assert.equal(await ui.studio().requestImportProject(JSON.stringify(ui.project('Library B'))),true);assert.equal(await ui.studio().requestImportProject(JSON.stringify(ui.project('Library C'))),true);assert.equal(await ui.studio().requestImportProject(JSON.stringify(ui.project('Library D'))),true);assert.equal(await ui.studio().requestNewProject(),true);ui.workspace.go('home');assert.equal(lib.getState().items.length,5);assert.equal(ui.doc.querySelectorAll('.pc-project-open').length,4);assert.equal(ui.doc.getElementById('pcProjectPaging').hidden,true);assert(ui.doc.querySelector('span.pc-project-preview svg path'),'empty project contains an actual supported folder SVG');
  await ui.doc.querySelector('.pc-home-projects [data-pk-route=projects]').click();assert.equal(ui.doc.body.dataset.studioScreen,'projects');const catalog=ui.doc.getElementById('pcProjectsPageList');assert.equal(catalog.querySelectorAll('.pc-project-open').length,5,'the fifth item remains in the full catalog');const old=catalog.querySelector(`[data-pk-project-id="${first}"][data-pk-project-action=open]`);assert(old);await old.click();await lib.flush();assert.equal(lib.getState().activeId,first);
  assert.equal(ui.doc.activeElement,ui.doc.getElementById('pcPrompt'),'opening a project moves focus to its visible composer');ui.workspace.go('projects');const remove=ui.doc.getElementById('pcProjectsPageList').querySelectorAll('.pc-project-remove').find(node=>!node.disabled);assert(remove);const removed=remove.dataset.pkProjectId;await remove.click();await lib.flush();assert.equal(lib.getState().items.some(value=>value.id===removed),false);assert.equal(lib.getState().items.length,4);
  await ui.doc.querySelector('[data-pk-action="gallery"]').click();assert.equal(ui.doc.querySelector('.pk-gallery-dialog').open,true);assert.match(ui.doc.getElementById('gallery').textContent,/후보 1/);assert.match(ui.doc.getElementById('gallery').querySelector('[data-action=view]').getAttribute('aria-label'),/후보 1/);assert.equal(ui.requests.length,0);assert.equal(ui.ipc.calls.send.length,0);
 }finally{ui.view.destroy();}
 const reopened=await mounted(transport(),{projectStore:store,initialProject:'Library A'});try{assert.equal(reopened.workspace.projects.getState().items.find(value=>value.id===store.state.records.find(value=>value.favorite)?.id)?.favorite,true);}finally{reopened.view.destroy();}
});
catalogTest('project catalog transition preserves each draft and locks real inputs only during document work',async()=>{
 const store=new ProjectStore(),ui=await mounted(transport(),{projectStore:store});try{const lib=ui.workspace.projects,first=lib.getState().activeId,input=ui.doc.getElementById('pcPrompt');await type(ui,'A 미전송 초안');input.setSelectionRange(1,4);assert.equal(await ui.studio().requestImportProject(JSON.stringify(ui.project('Library B'))),true);const second=lib.getState().activeId;await type(ui,'B 미전송 초안');
  const gate=holdProjectWrite(store);await ui.input('projectName','B changed');const switching=lib.switchTo(first);await gate.entered;assert.equal(input.readOnly,true);assert.equal(ui.element('brief').readOnly,true);assert.equal(ui.doc.getElementById('workspace').inert,true);assert.equal(ui.doc.getElementById('pkGenerate').disabled,true);await ui.doc.getElementById('pkPromptForm').requestSubmit();assert.equal(ui.ipc.calls.send.length,0);gate.release();assert.equal(await switching,true);assert.equal(input.value,'A 미전송 초안');assert.equal(input.selectionStart,1);assert.equal(input.selectionEnd,4);assert.equal(!!input.readOnly,false);assert.equal(!!ui.doc.getElementById('workspace').inert,false);
  await input.dispatchEvent(new ui.Event('compositionstart'));assert.equal(await lib.switchTo(second),false);assert.equal(lib.getState().activeId,first);await input.dispatchEvent(new ui.Event('compositionend'));assert.equal(await lib.switchTo(second),true);assert.equal(input.value,'B 미전송 초안');
  const saving=holdProjectWrite(store);await ui.input('projectName','B background saved');const pending=lib.saveCurrent();await saving.entered;assert.equal(!!input.readOnly,false,'background save does not lock the composer');assert.equal(ui.doc.getElementById('pkGenerate').disabled,false);saving.release();assert.equal(await pending,true);assert.equal(ui.doc.querySelectorAll('#pcPrompt').length,1);assert.equal(ui.requests.length,0);
 }finally{ui.view.destroy();}
});
catalogTest('project catalog unavailable storage keeps original file open new and export without writing an old ID',async()=>{
 const store=new ProjectStore();store.failRead=true;const ui=await mounted(transport(),{projectStore:store});try{const lib=ui.workspace.projects;assert.equal(lib.getState().ready,false);assert.match(ui.doc.getElementById('pcProjectLibraryStatus').textContent,/Storage unavailable/);assert.equal(await ui.studio().requestImportProject(JSON.stringify(ui.project('File fallback'))),true);assert.equal(ui.studio().getSummary().name,'File fallback');await ui.element('saveProject').onclick();assert.equal(ui.downloads.length,1);assert.equal(await ui.studio().requestNewProject(),true);assert.equal(ui.studio().getSummary().candidateCount,0);assert.equal(lib.getState().activeId,null);assert.equal(store.state.records.length,0);assert.equal(ui.ipc.calls.send.length,0);}finally{ui.view.destroy();}
});
catalogTest('project catalog delegates foreign v2 load and file save to the existing core without catalog conversion',async()=>{
 const store=new ProjectStore(),ui=await mounted(transport(),{projectStore:store});try{const before=structuredClone(store.state),calls=[];ui.sandbox.motionBoundary={getSummary:()=>({partCount:1,isMotionProject:true,dirty:false,loading:false}),suspend(){},refreshSources(){},loadDocument:async raw=>{calls.push(raw);return true;},saveProject:async()=>'{"version":2,"id":"foreign-motion"}'};vm.runInContext('motionController=motionBoundary',ui.sandbox);assert.equal(await ui.studio().requestImportProject('{"version":2,"id":"foreign-motion"}'),true);assert.equal(calls.length,1);assert.deepEqual(store.state.records,before.records);assert.equal(ui.workspace.projects.getState().activeId,before.activeId);await ui.element('saveProject').onclick();assert.equal(JSON.parse(await ui.downloads.at(-1).blob.text()).version,2);assert.deepEqual(store.state.records,before.records);assert.equal(ui.ipc.calls.send.length,0);}finally{ui.view.destroy();}
});
catalogTest('project catalog displays existing-record mismatch notice without requiring a recovered item',async()=>{
 const store=new ProjectStore(),first=await mounted(transport(),{projectStore:store}),id=first.workspace.projects.getState().activeId;try{assert.equal(await first.studio().requestImportProject(JSON.stringify(first.project('Library B'))),true);assert.notEqual(store.state.activeId,id);assert.equal(store.state.records.every(item=>item.recovered===false),true);}finally{first.view.destroy();}
 const reopened=await mounted(transport(),{projectStore:store,initialProject:'Library A'});try{reopened.workspace.go('home');const state=reopened.workspace.projects.getState();assert.equal(state.items.length,2);assert.equal(state.activeId,id);assert.equal(state.items.every(item=>item.recovered===false),true);assert.match(state.notice,/모두 보존/);assert.equal(reopened.doc.getElementById('pcProjectLibraryStatus').textContent,state.notice);assert.equal(reopened.studio().getSummary().name,'Library A');assert.equal(reopened.ipc.calls.send.length,0);}finally{reopened.view.destroy();}
});


test('chat cleanup tools show actual image model and size without changing the work',async()=>{
 const ui=await mounted();try{const before=ui.studio().exportProject(),input=ui.doc.getElementById('pcPrompt');await type(ui,'도구를 확인해도 남는 초안');input.setSelectionRange(2,6);
  const model=ui.doc.getElementById('pcModelName'),size=ui.doc.getElementById('pcResolution');
  assert.match(model.textContent,/SDXL Base 1\.0/);assert.match(size.textContent,/1024\s*×\s*1024/);
  assert.match(model.closest('button').getAttribute('aria-label'),/SDXL Base 1\.0/);assert.match(size.title,/1024\s*×\s*1024/);
  await ui.input('width','768');await ui.input('height','512');assert.match(size.textContent,/768\s*×\s*512/);assert.match(size.title,/768\s*×\s*512/);
  assert.equal(input.value,'도구를 확인해도 남는 초안');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,6);assert.equal(ui.studio().exportProject(),before);assert.equal(ui.ipc.calls.send.length,0);
  await ui.doc.getElementById('pkPromptForm').requestSubmit();const ref=ui.ipc.calls.send[0];await ui.ipc.emit({...ref,type:'message',payload:{text:'모델 변경 뒤에도 남길 원답변'}});await ui.ipc.emit({...ref,type:'turn-completed',payload:{status:'completed'}});await type(ui,'새 문맥에도 남는 초안');input.setSelectionRange(2,6);
  await choose(ui,'desktopChatModel','test-model');const boundary=ui.doc.querySelector('[data-pc-context-boundary]');assert(boundary,'a confirmed model reset exposes the new runtime context');assert.match(boundary.textContent,/새|문맥/);assert.match(ui.doc.getElementById('pcConversation').textContent,/모델 변경 뒤에도 남길 원답변/);assert.equal(input.value,'새 문맥에도 남는 초안');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,6);assert.equal(ui.ipc.calls.send.length,1);assert.equal(ui.studio().exportProject(),before);
  await ui.studio().importProject(ui.project('문맥 소유자 교체'));await settle();assert.equal(ui.doc.querySelectorAll('[data-pc-context-boundary]').length,0);assert.doesNotMatch(ui.doc.getElementById('pcConversation').textContent,/모델 변경 뒤에도 남길 원답변/);
 }finally{ui.view.destroy();}
});

test('chat cleanup failed request reinput restores only its current untouched composer without sending',async()=>{
 const ui=await mounted();try{const input=ui.doc.getElementById('pcPrompt');await type(ui,'실패한 원문을 다시 검토');await ui.doc.getElementById('pkPromptForm').requestSubmit();const ref=ui.ipc.calls.send[0];
  await ui.ipc.emit({...ref,type:'error',payload:{code:'temporary-error',message:'Controlled failure'}});
  const turn=ui.doc.querySelector('.pc-ai-turn'),retry=turn.querySelector('button[data-pc-reinput]');assert(retry,'actual failed current request offers explicit reinput');
  await type(ui,'');const before=ui.studio().exportProject();await retry.click();assert.equal(input.value,'실패한 원문을 다시 검토');assert.equal(ui.doc.activeElement,input);assert.equal(ui.ipc.calls.send.length,1);assert.equal(ui.studio().exportProject(),before);
  await type(ui,'새로 쓰는 원문');input.setSelectionRange(1,4);await retry.click();assert.equal(input.value,'새로 쓰는 원문');assert.equal(input.selectionStart,1);assert.equal(input.selectionEnd,4);assert.equal(ui.ipc.calls.send.length,1);
  await type(ui,'');await input.dispatchEvent(new ui.Event('compositionstart'));await retry.click();assert.equal(input.value,'');assert.equal(ui.ipc.calls.send.length,1);await input.dispatchEvent(new ui.Event('compositionend'));
  await type(ui,'다음 요청 진행');await ui.doc.getElementById('pkPromptForm').requestSubmit();await type(ui,'진행 중 새 초안');input.setSelectionRange(2,5);await retry.click();assert.equal(input.value,'진행 중 새 초안');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,5);assert.equal(ui.ipc.calls.send.length,2);await ui.view.controller.cancel();
  await choose(ui,'desktopChatModel','test-model');await type(ui,'');await retry.click();assert.equal(input.value,'','old-context reinput cannot restore after a real model reset');assert.equal(ui.ipc.calls.send.length,2);
  await ui.studio().importProject(ui.project('다른 소유 작업'));await settle();await type(ui,'새 작업 초안');input.setSelectionRange(1,3);const ownerRaw=ui.studio().exportProject();await retry.click();assert.equal(input.value,'새 작업 초안');assert.equal(input.selectionStart,1);assert.equal(input.selectionEnd,3);assert.equal(ui.studio().exportProject(),ownerRaw);assert.equal(ui.ipc.calls.send.length,2);
 }finally{ui.view.destroy();}
});


test('chat cleanup copies actual reply text and reports pending success or rejection without altering the draft',async()=>{
 const ui=await mounted(),copied=[];let resolve,reject;ui.sandbox.navigator={clipboard:{writeText:text=>{copied.push(text);return new Promise((yes,no)=>{resolve=yes;reject=no;});}}};
 try{await type(ui,'답변만 복사할 요청');await ui.doc.getElementById('pkPromptForm').requestSubmit();const ref=ui.ipc.calls.send[0],answer='답변 **강조**\n<img src=x onerror=evil> 그대로';await ui.ipc.emit({...ref,type:'message',payload:{text:answer}});await ui.ipc.emit({...ref,type:'turn-completed',payload:{status:'completed'}});
  await type(ui,'보존할 현재 초안');const input=ui.doc.getElementById('pcPrompt');input.setSelectionRange(1,4);const raw=ui.studio().exportProject(),turn=ui.doc.querySelector('.pc-ai-turn'),copy=turn.querySelector('button[data-pc-copy-reply]');assert(copy,'completed actual reply offers plaintext copy');
  const pending=copy.click();assert.deepEqual(copied,[answer]);assert.equal(copy.disabled,true);const feedback=turn.querySelector('[data-pc-message-feedback]');assert(feedback);assert.match(feedback.textContent,/복사/);assert.doesNotMatch(feedback.textContent,/복사했|복사됐|완료/);resolve();await pending;assert.match(feedback.textContent,/복사했|복사됐|완료/);
  const refused=copy.click();reject(Error('Clipboard denied'));await refused;assert.match(feedback.textContent,/실패|못|권한|허용/);assert.equal(copied.length,2);assert.equal(input.value,'보존할 현재 초안');assert.equal(input.selectionStart,1);assert.equal(input.selectionEnd,4);assert.equal(ui.studio().exportProject(),raw);assert.equal(ui.ipc.calls.send.length,1);
 }finally{ui.view.destroy();}
});

test('home and project catalog order older newly modified projects before newly created projects',async()=>{
 const seed=await mounted(),store=new ProjectStore();
 store.state.activeId='older-modified';store.state.records=[
  {id:'newer-created',raw:JSON.stringify(seed.project('새로 만든 프로젝트')),createdAt:'2026-10-29T00:00:00.000Z',updatedAt:'2026-10-29T00:00:00.000Z',favorite:false,recovered:false},
  {id:'older-modified',raw:JSON.stringify(seed.project('방금 수정한 오래된 프로젝트')),createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-30T00:00:00.000Z',favorite:false,recovered:false},
  {id:'oldest',raw:JSON.stringify(seed.project('오래된 프로젝트')),createdAt:'2026-09-01T00:00:00.000Z',updatedAt:'2026-09-01T00:00:00.000Z',favorite:false,recovered:false},
  {id:'ancient-one',raw:JSON.stringify(seed.project('더 오래된 프로젝트')),createdAt:'2026-08-01T00:00:00.000Z',updatedAt:'2026-08-01T00:00:00.000Z',favorite:false,recovered:false},
  {id:'ancient-two',raw:JSON.stringify(seed.project('가장 오래된 프로젝트')),createdAt:'2026-07-01T00:00:00.000Z',updatedAt:'2026-07-01T00:00:00.000Z',favorite:false,recovered:false}
 ];seed.view.destroy();const ui=await mounted(transport(),{projectStore:store,initialProject:false});
 try{const active=ui.workspace.projects.getState().activeId;ui.workspace.go('home');const ids=list=>Array.from(list.querySelectorAll('[data-pk-project-action=open]'),node=>node.dataset.pkProjectId);
  assert.deepEqual(ids(ui.doc.getElementById('pkRecentGrid')),['older-modified','newer-created','oldest','ancient-one']);assert.equal(ui.doc.getElementById('pcProjectPaging').hidden,true);
  ui.workspace.go('projects');assert.deepEqual(ids(ui.doc.getElementById('pcProjectsPageList')),['older-modified','newer-created','oldest','ancient-one','ancient-two']);assert.equal(ui.workspace.projects.getState().activeId,active,'sorting and paging keep the current identity');assert.equal(ui.ipc.calls.send.length,0);
 }finally{ui.view.destroy();}
});

test('project recency falls back from invalid modification dates to creation dates and stable ids',()=>{
 const redesign=require('../web/src/redesign.js');
 const items=[{id:'b-invalid',updatedAt:'bad',createdAt:'bad'},{id:'z-created',updatedAt:null,createdAt:'2026-10-29T00:00:00.000Z'},{id:'a-invalid'},
  {id:'b-tie',updatedAt:'2026-10-30T00:00:00.000Z',createdAt:'2026-10-01T00:00:00.000Z'},{id:'a-tie',updatedAt:'2026-10-30T00:00:00.000Z',createdAt:'2026-10-01T00:00:00.000Z'},
  {id:'recent-created',updatedAt:'2026-10-30T00:00:00.000Z',createdAt:'2026-10-02T00:00:00.000Z'}];
 assert.deepEqual(items.sort(redesign.compareProjectRecency).map(item=>item.id),['recent-created','a-tie','b-tie','z-created','a-invalid','b-invalid']);
});

test('home actual model summary follows provider model and size changes through existing settings without touching the draft',async()=>{
 const ipc=transport(),catalog=ipc.getChatModelOptions;ipc.getChatModelOptions=async input=>{const value=await catalog(input);value.options.find(item=>item.id==='test-model').displayName='아주 긴 실제 대화 모델 이름 · 한글 모델 · 상세 버전';return value;};
 const ui=await mounted(ipc);
 try{ui.workspace.go('home');const input=ui.doc.getElementById('pcPrompt');assert.equal(input.placeholder,'어떤 이미지를 만들어볼까요?');
  await type(ui,'여러 줄의 한글\n보존할 초안');input.setSelectionRange(2,8);const before=ui.studio().exportProject(),chat=ui.doc.getElementById('pcHomeChatModel'),image=ui.doc.getElementById('pcHomeImageModel'),size=ui.doc.getElementById('pcHomeImageSize');
  assert(chat,'home exposes actual AI model settings');assert(image);assert(size);assert.match(chat.textContent,/Codex.*Codex 기본값/);assert.match(image.textContent,/SDXL Base 1.0/);assert.equal(size.textContent,'1024 × 1024');
  await chat.click();assert.equal(ui.doc.getElementById('pkSettings').dataset.panel,'chat');await choose(ui,'desktopChatModel','test-model');assert.match(chat.textContent,/아주 긴 실제 대화 모델 이름/);assert.match(chat.getAttribute('aria-label'),/아주 긴 실제 대화 모델 이름/);await ui.doc.querySelector('#pkSettings [data-pk-close]').click();
  await image.click();assert.equal(ui.doc.getElementById('pkSettings').dataset.panel,'model');await ui.doc.querySelector('#pkSettings [data-pk-close]').click();await size.click();assert.equal(ui.doc.getElementById('pkSettings').dataset.panel,'model');await ui.input('width','768');await ui.input('height','512');assert.equal(size.textContent,'768 × 512');await ui.doc.querySelector('#pkSettings [data-pk-close]').click();
  await choose(ui,'desktopChatProvider','claude');assert.match(chat.textContent,/Claude/);assert.equal(input.value,'여러 줄의 한글\n보존할 초안');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,8);assert.equal(ui.studio().exportProject(),before);assert.equal(ui.ipc.calls.send.length,0);assert.equal(ui.doc.getElementById('desktopChatIntent'),null);
 }finally{ui.view.destroy();}
});

test('plain web home exposes its actual generation model and size without an AI provider badge',async()=>{
 const ui=await mounted(null);ui.workspace.go('home');const image=ui.doc.getElementById('pcHomeImageModel'),size=ui.doc.getElementById('pcHomeImageSize');
 assert(image,'plain home keeps actual image settings reachable');assert.equal(ui.doc.getElementById('pcHomeChatModel').hidden,true);assert.match(image.textContent,/SDXL Base/);assert.equal(size.textContent,'1024 × 1024');
 await size.click();assert.equal(ui.doc.getElementById('pkSettings').dataset.panel,'model');await ui.input('width','640');assert.equal(size.textContent,'640 × 1024');assert.equal(ui.requests.length,0);
});

test('sidebar keeps nine tools and image edit remains the direct route with image generation highlighted',async()=>{
 const ui=await mounted();
 try{await ui.studio().importProject(ui.project('메뉴 정리 후 원본'));const nav=ui.doc.querySelector('.pk-navigation'),before=ui.studio().exportProject();
  assert.deepEqual(Array.from(nav.querySelectorAll('button'),node=>node.getAttribute('aria-label')),['홈','프로젝트','이미지 생성','부위 편집','표정 · 동작','출력','갤러리','모델 관리','설정']);
  await type(ui,'이미지를 보며 수정할 한글 초안');const input=ui.doc.getElementById('pcPrompt');input.setSelectionRange(3,8);const edit=ui.doc.querySelector('.pc-image-actions [data-pc-action=edit]');await edit.click();await settle();
  assert.equal(ui.doc.body.dataset.studioScreen,'inpaint');assert.equal(nav.querySelector('[aria-current=page]').dataset.pkRoute,'design');assert.equal(ui.state().sourceId,'parent');assert.equal(input.value,'이미지를 보며 수정할 한글 초안');assert.equal(ui.doc.getElementById('desktopChatIntent'),null);
  await nav.querySelector('[data-pk-route=design]').click();await settle();assert.equal(ui.doc.body.dataset.studioScreen,'design');assert.equal(nav.querySelector('[aria-current=page]').dataset.pkRoute,'design');assert.equal(input.value,'이미지를 보며 수정할 한글 초안');assert.equal(ui.studio().exportProject(),before);assert.equal(ui.ipc.calls.send.length,0);assert.equal(ui.requests.length,0);
 }finally{ui.view.destroy();}
});

test('plain web home edit summary matches the active image picker and preserves its source mask draft and document',async()=>{
 const ui=await mounted(null);await ui.studio().importProject(ui.project('일반 웹 수정 모델'));ui.studio().setMode('inpaint');ui.studio().setImageModelSettings({editModelId:'sdxl-inpaint-v01'});await settle();
 await type(ui,'원본과 마스크를 보존할 수정 초안');const input=ui.doc.getElementById('pcPrompt');input.setSelectionRange(2,8);ui.element('paint').snapshot=WHITE;
 const before={raw:ui.studio().exportProject(),source:ui.state().sourceDataURL,mask:ui.element('paint').snapshot,model:ui.element('imageModel').value},selected=ui.doc.getElementById('imageModel').selectedOptions[0].textContent;
 assert.match(selected,/SDXL Inpaint v0.1/);ui.workspace.go('home');const summary=ui.doc.getElementById('pcHomeImageModel');assert.equal(summary.textContent,'이미지 · '+selected);assert.equal(summary.getAttribute('aria-label'),'부분 수정 모델 설정: '+selected);
 await summary.click();assert.equal(ui.doc.getElementById('pkSettings').dataset.panel,'model');assert.equal(summary.dataset.pkSettingTarget,'imageModel');assert.equal(ui.element('imageModel').value,before.model);await ui.doc.querySelector('#pkSettings [data-pk-close]').click();
 assert.equal(ui.studio().getSummary().mode,'inpaint');assert.equal(input.value,'원본과 마스크를 보존할 수정 초안');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,8);assert.deepEqual({raw:ui.studio().exportProject(),source:ui.state().sourceDataURL,mask:ui.element('paint').snapshot,model:ui.element('imageModel').value},before);assert.equal(ui.requests.length,0);
});


test('native base-seed explanation binds once preserves settings and restores manual edit and standalone accessibility',async()=>{
 const ui=await mounted(null),seed=ui.doc.getElementById('seed'),label=ui.doc.querySelector('label[for="seed"]'),helper=ui.doc.createElement('span');helper.id='priorSeedHelp';helper.textContent='기존 시드 설명';seed.closest('.field').append(helper);seed.setAttribute('aria-describedby','priorSeedHelp');const originalHTML=label.innerHTML,originalDescription=seed.getAttribute('aria-describedby'),ids=['seed','width','height','steps','cfg','sampler','scheduler','negative','denoise','cache','previewOn'],settings=()=>ids.map(id=>{const node=ui.doc.getElementById(id);return [id,node.value,node.checked];}),before=settings(),documentBefore=ui.studio().exportProject();let writes=0;for(const event of ['input','change'])seed.addEventListener(event,()=>writes++);let binding;
 try{assert.equal(ui.doc.getElementById('pcSeedPolicyHint'),null);for(let pass=0;pass<2;pass++){
   binding=api.mount(ui.doc,{ipc:transport(),studio:ui.studio(),workflow:ui.sandbox.PankekiWorkflowController});await settle();assert(binding);assert.equal(label.textContent,'기준 시드');assert.equal(ui.doc.querySelectorAll('#pcSeedPolicyHint').length,1);assert.deepEqual(seed.getAttribute('aria-describedby').split(/\s+/),['priorSeedHelp','pcSeedPolicyHint']);assert.deepEqual(settings(),before);assert.equal(ui.studio().exportProject(),documentBefore);assert.equal(writes,0);
   ui.studio().setMode('inpaint');assert.equal(label.innerHTML,originalHTML);assert.equal(seed.getAttribute('aria-describedby'),originalDescription);assert.equal(ui.doc.getElementById('pcSeedPolicyHint'),null,'manual edit keeps its original seed semantics');ui.studio().setMode('txt2img');assert.equal(ui.doc.querySelectorAll('#pcSeedPolicyHint').length,1);assert.equal(label.textContent,'기준 시드');
   binding.destroy();binding=null;assert.equal(label.innerHTML,originalHTML);assert.equal(seed.getAttribute('aria-describedby'),originalDescription);assert.equal(ui.doc.getElementById('pcSeedPolicyHint'),null);assert.deepEqual(settings(),before);assert.equal(writes,0);
  }
 }finally{binding?.destroy();}
});


test('home keeps full project names and current badge while quiet successes retain live semantics and attention stays visible',async()=>{
 const store=new ProjectStore(),fullName='QA 2026-10-30 여백 보강 42 매우 긴 원래 프로젝트 이름',ui=await mounted(transport(),{projectStore:store,initialProject:fullName}),library=ui.workspace.projects,status=ui.doc.getElementById('pcProjectLibraryStatus'),project=library.getState().activeId,originalCommit=store.commit;let gate;
 try{ui.workspace.go('home');const row=ui.doc.getElementById('pkRecentGrid').querySelector('[data-pk-project-action=open]'),name=row.querySelector('.pc-project-name'),badge=row.querySelector('.pc-project-active');assert.equal(name.textContent,fullName);assert(badge);assert.equal(name.contains(badge),false,'current badge is outside the truncated name');assert.equal(badge.parentNode,name.parentNode);assert(row.getAttribute('aria-label').includes(fullName));assert(row.title.includes(fullName));assert.match(row.title,/선택 영역은 초기화/);ui.workspace.go('projects');assert.equal(ui.doc.getElementById('pcProjectsPageList').querySelector('.pc-project-name').textContent,fullName);
  assert.equal(await library.openGeneration(),true);ui.workspace.go('home');assert.equal(status.textContent,library.getState().notice);assert.equal(status.classList.contains('sr-only'),true);assert.equal(status.hidden,false);assert.equal(status.getAttribute('role'),'status');assert.equal(status.getAttribute('aria-live'),'polite');
  gate=holdProjectWrite(store);await ui.input('projectName','일반 기록 저장 중');const save=library.saveCurrent();await gate.entered;assert.equal(status.classList.contains('sr-only'),false,'saving feedback remains visual');gate.release();assert.equal(await save,true);gate=null;assert.equal(status.classList.contains('sr-only'),true);
  const general=library.getState().activeId;ui.sandbox.confirm=()=>false;assert.equal(await library.switchTo(project),false);assert.equal(library.getState().activeId,general);assert.match(status.textContent,/취소/);assert.equal(status.classList.contains('sr-only'),false,'unknown/canceled-transition notices remain visible');ui.sandbox.confirm=()=>true;
  store.commit=async()=>{throw Error('revision conflict');};await ui.input('projectName','실패해도 보존할 일반 기록');assert.equal(await library.saveCurrent(),false);assert(library.getState().recovery);assert.equal(status.getAttribute('role'),'alert');assert.equal(status.classList.contains('sr-only'),false);assert.match(status.textContent,/revision conflict/);assert.equal(library.getState().items.find(item=>item.id===project).name,fullName);assert.equal(ui.ipc.calls.send.length,0);assert.equal(ui.requests.length,0);
 }finally{gate?.release();store.commit=originalCommit;ui.view.destroy();}
});

'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),Module=require('node:module');
const fixtureFile=path.join(__dirname,'test_central_composer.cjs'),source=fs.readFileSync(fixtureFile,'utf8'),boundary=source.indexOf("\ntest('desktop uses");
const fixture=new Module(fixtureFile,module);fixture.filename=fixtureFile;fixture.paths=module.paths;fixture._compile(source.slice(0,boundary)+'\nmodule.exports={test,assert,mounted,type,choose,transport,plain,RED,WHITE,settle,page,structuralDOM,until,api,ownJob,resolveIntent,automaticRequest};',fixtureFile);
const {test,assert,mounted,type,choose,plain,RED,WHITE,settle,page,structuralDOM,until,api,transport,ownJob,resolveIntent,automaticRequest}=fixture.exports;
// The shared DOM fixture only bubbles. These gallery regressions also need the
// browser capture phase and a fixed event path before native onclick mutation.
function captureDOM(ui,doc){
 const proto=Object.getPrototypeOf(doc.body),add=proto.addEventListener,remove=proto.removeEventListener,captures=new WeakMap();
 proto.addEventListener=function(type,listener,options){if(options===true||options?.capture){let events=captures.get(this);if(!events)captures.set(this,events=new Map());if(!events.has(type))events.set(type,[]);events.get(type).push(listener);}else add.call(this,type,listener,options);};
 proto.removeEventListener=function(type,listener,options){if(options===true||options?.capture){const events=captures.get(this);events?.set(type,(events.get(type)||[]).filter(fn=>fn!==listener));}else remove.call(this,type,listener,options);};
 proto.dispatchEvent=function(event){
  const path=[];for(let node=this;node;node=node.parentNode)path.push(node);event.target||=this;event.composedPath=()=>path.slice();let stopped=false,immediate=false;const results=[];
  event.stopPropagation=()=>{stopped=true;};event.stopImmediatePropagation=()=>{stopped=true;immediate=true;};
  const invoke=(node,capture)=>{event.currentTarget=node;if(!capture&&node['on'+event.type])results.push(node['on'+event.type](event));for(const listener of capture?captures.get(node)?.get(event.type)||[]:node.listeners?.get(event.type)||[]){if(immediate)break;results.push(listener(event));}};
  for(const node of path.slice().reverse()){invoke(node,true);if(stopped)break;}
  if(!stopped)for(const node of path){invoke(node,false);if(stopped||!event.bubbles&&event.type!=='click')break;}
  return Promise.all(results);
 };
}
async function captureMounted({photo=false}={}){
 const ui=page();await until(()=>ui.studio().getSummary().modelsReady,'models');const doc=structuralDOM(ui);captureDOM(ui,doc);const ipc=transport();ui.sandbox.pankekiDesktop=ipc;
 if(photo){doc.body.parentNode=doc;ui.sandbox.crypto.subtle=require('node:crypto').webcrypto.subtle;for(const name of ['ResizeObserver','MutationObserver'])ui.sandbox[name].prototype.disconnect||=()=>{};}
 for(const name of [...(photo?['photo-editor.js']:[]),'redesign.js','studio.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/src',name),'utf8'),ui.sandbox,{filename:name});
 const assets=doc.createElement('script');assets.id='redesignAssets';assets.textContent=JSON.stringify({images:{'catgirl-hero':'/template.png'},icons:{}});doc.body.append(assets);
 const workspace=ui.sandbox.PankekiRedesign.mount(doc,ui.studio(),ui.sandbox.PankekiWorkflowController),view=api.mount(doc,{ipc,studio:ui.studio(),workflow:ui.sandbox.PankekiWorkflowController});await settle();await ui.studio().importProject(ui.project('Gallery'));workspace.go('design');return {...ui,doc,workspace,view,ipc};
}
async function withImage(){const ui=await mounted();await ui.studio().importProject(ui.project('Actual project'));ui.workspace.go('design');return ui;}
async function openImage(ui,id=ui.state().project.versions[0].id){const trigger=ui.doc.querySelector(`.pc-turn[data-candidate-id="${id}"] .pc-image-open`);await trigger.click();return trigger;}
async function loaded(ui,width=1024,height=1536){if(ui.doc.querySelector('.pc-image-workspace').dataset.pcViewer!=='open')await openImage(ui);const img=ui.doc.getElementById('pcViewerImage'),viewport=ui.doc.getElementById('canvasViewport');Object.assign(img,{naturalWidth:width,naturalHeight:height});Object.assign(viewport,{clientWidth:640,clientHeight:480});await img.dispatchEvent(new ui.Event('load'));return {img,viewport};}
async function photoOperations(){
 const ui=await mounted();ui.sandbox.crypto.subtle=require('node:crypto').webcrypto.subtle;const Original=ui.sandbox.Image;ui.sandbox.Image=class extends Original{constructor(){super();this.width=this.naturalWidth=1;this.height=this.naturalHeight=1;}};
 const project=ui.project('Photos');project.versions.push({...plain(project.versions[0]),id:'other',image:WHITE});await ui.studio().importProject(project);ui.workspace.go('design');await openImage(ui,'parent');const originalFetch=ui.sandbox.fetch,operations=[];
 ui.sandbox.fetch=(url,options)=>{if(url!=='/api/image-ops')return originalFetch(url,options);let resolve;const pending=new Promise(done=>resolve=done);operations.push({body:JSON.parse(options.body),resolve});return pending;};
 const finish=()=>{const op=operations[0],sha=require('node:crypto').createHash('sha256').update(Buffer.from(WHITE.split(',')[1],'base64')).digest('hex');op.resolve(ui.response({ok:true,operationId:op.body.operationId,operation:op.body.operation,image:{png:WHITE,sha256:sha,width:1,height:1},metadata:{algorithm:'controlled-photo-fixture',algorithmVersion:'1',parameters:{}}}));};
 return {...ui,operations,finish};
}

for(const fields of [{isComposing:true},{isComposing:false,keyCode:229}])test(`photo comment IME Escape crosses document capture and shell bubble without closing (${fields.keyCode||'isComposing'})`,async()=>{
 const ui=await captureMounted({photo:true});try{
  await type(ui,'보존할 다음 초안');const trigger=await openImage(ui,'parent');await ui.doc.querySelector('[data-ppe-tool="comments"]').click();await until(()=>ui.doc.querySelector('.ppe-comment-input'),'comment input');
  const input=ui.doc.querySelector('.ppe-comment-input'),shell=ui.doc.querySelector('.pc-image-workspace'),before=ui.studio().exportProject(),path=[];input.focus();input.value='한';await input.dispatchEvent(new ui.Event('input',{bubbles:true}));await input.dispatchEvent(new ui.Event('compositionstart',{bubbles:true}));
  ui.doc.addEventListener('keydown',()=>path.push('document capture'),true);shell.addEventListener('keydown',()=>path.push('shell bubble'));
  const event=new ui.Event('keydown',{key:'Escape',bubbles:true,...fields});await input.dispatchEvent(event);
  assert.deepEqual(path,['document capture','shell bubble']);assert.equal(shell.dataset.pcViewer,'open','IME Escape must not close the viewer after the photo module yields');assert.equal(ui.studio().photoTools.getState().tool,'comments');assert.equal(input.value,'한');assert.equal(ui.doc.activeElement,input);assert.equal(event.defaultPrevented,undefined);assert.equal(ui.studio().exportProject(),before);
  await input.dispatchEvent(new ui.Event('compositionend',{bubbles:true}));path.length=0;await input.dispatchEvent(new ui.Event('keydown',{key:'Escape',bubbles:true}));await until(()=>!ui.studio().photoTools.getState().active,'comment cancel');assert.deepEqual(path,['document capture']);assert.equal(shell.dataset.pcViewer,'open','ordinary Escape first cancels the active photo tool');
  await ui.doc.getElementById('workspace').dispatchEvent(new ui.Event('keydown',{key:'Escape',bubbles:true}));assert.equal(shell.dataset.pcViewer,'closed');assert.equal(ui.doc.activeElement,trigger);assert.equal(ui.doc.getElementById('pcPrompt').value,'보존할 다음 초안');assert.equal(ui.studio().exportProject(),before);assert.equal(ui.requests.length,0);assert.equal(ui.ipc.calls.send.length,0);
 }finally{ui.view.destroy();}
});

for(const nextView of ['same','other','closed'])test(`photo result ${nextView} preserves explicit viewer ownership draft focus and original source mask`,async()=>{
 const ui=await photoOperations();try{
  const before={source:ui.state().sourceDataURL,id:ui.state().sourceId,sourceRevision:ui.state().sourceRevision,maskRevision:ui.state().maskRevision,mask:ui.element('paint').snapshot,mode:ui.element('mode').value};
  const pending=ui.doc.querySelector('[data-ppe-tool="background-remove"]').click();await until(()=>ui.operations.length===1,'photo operation');assert.equal(ui.doc.getElementById('pkGenerate').disabled,true);
  if(nextView==='other')await openImage(ui,'other');else if(nextView==='closed')await ui.doc.getElementById('pcCanvasClose').click();await type(ui,'다음 초안');ui.doc.getElementById('pcPrompt').focus();const focus=ui.doc.activeElement;
  ui.finish();await pending;await settle();const candidate=ui.state().project.versions.at(-1);assert.equal(candidate.kind,'derived');assert.equal(candidate.parentId,'parent');assert.equal(candidate.image,WHITE);assert.equal(ui.state().project.versions[0].image,RED);assert.equal(ui.operations.length,1);assert.equal(ui.state().project.versions.length,3);
  assert.equal(ui.doc.querySelector('.pc-image-workspace').dataset.pcEditor,nextView==='closed'?'closed':'open');assert.equal(ui.doc.getElementById('workspace').dataset.candidateId,nextView==='same'?candidate.id:nextView==='other'?'other':'');assert.equal(ui.doc.activeElement===focus,true);assert.equal(ui.doc.getElementById('pcPrompt').value,'다음 초안');assert.equal(ui.doc.getElementById('pkGenerate').disabled,false);assert.equal(ui.doc.getElementById('pkCancel').hidden,true);
  assert.equal(ui.state().sourceDataURL,before.source);assert.equal(ui.state().sourceId,before.id);assert.equal(ui.state().sourceRevision,before.sourceRevision);assert.equal(ui.state().maskRevision,before.maskRevision);assert.equal(ui.element('paint').snapshot,before.mask);assert.equal(ui.element('mode').value,before.mode);assert.equal(ui.requests.length,0);assert.equal(ui.ipc.calls.send.length,0);
 }finally{ui.view.destroy();}
});

test('closing a pending photo view keeps a reachable photo cancel and rejects its late result without touching the draft',async()=>{
 const ui=await photoOperations();try{
  const before=ui.studio().exportProject(),pending=ui.doc.querySelector('[data-ppe-tool="background-remove"]').click();await until(()=>ui.operations.length,'pending photo');await ui.doc.getElementById('pcCanvasClose').click();await type(ui,'취소 후 남길 초안');
  const cancel=ui.doc.getElementById('pkCancel');assert.equal(cancel.hidden,false);assert.match(cancel.textContent,/Cancel image edit/);assert.equal(ui.doc.getElementById('pkGenerate').disabled,true);await cancel.click();await until(()=>!ui.workspace.composer.isPhotoBusy(),'photo cancel');
  ui.finish();await pending;assert.equal(ui.studio().exportProject(),before);assert.equal(ui.doc.querySelector('.pc-image-workspace').dataset.pcEditor,'closed');assert.equal(ui.doc.getElementById('pcPrompt').value,'취소 후 남길 초안');assert.equal(ui.doc.getElementById('pkGenerate').disabled,false);assert.equal(ui.ipc.calls.cancel.length,0);assert.equal(ui.requests.length,0);
 }finally{ui.view.destroy();}
});

test('reference workspace opens an actual header rail stage and candidate strip only on explicit selection',async()=>{
 const ui=await withImage();try{
  assert.equal(ui.doc.body.classList.contains('pankeki-reference'),true);const shell=ui.doc.querySelector('.pc-image-workspace');assert.equal(shell.dataset.pcEditor,'closed');await type(ui,'남겨둘 초안');const before=ui.studio().exportProject();await loaded(ui);
  assert.equal(shell.dataset.pcEditor,'open');assert.equal(ui.doc.getElementById('pcComposerTarget').closest('.pk-prompt-slot')?.className,'pk-prompt-slot');assert.equal(ui.doc.getElementById('pcCanvasFit').closest('.pc-canvas-header')?.className,'pc-canvas-header');assert(ui.doc.getElementById('editorTools').closest('.pc-editor-rail'));
  for(const id of ['sourceView','resultView'])assert.equal(ui.doc.getElementById(id).closest('#pcModelPanel')?.id,'pcModelPanel');
  const rail=ui.doc.querySelector('.pc-editor-rail'),viewport=ui.doc.getElementById('canvasViewport');assert.equal(viewport.contains(rail),false);assert.equal(ui.doc.querySelectorAll('.pc-candidate-strip button').length,1);
  await ui.doc.getElementById('pcCanvasClose').click();assert.equal(shell.dataset.pcEditor,'closed');assert.equal(ui.doc.getElementById('pcPrompt').value,'남겨둘 초안');assert.equal(ui.studio().exportProject(),before);
 }finally{ui.view.destroy();}
});

test('photo workspace keeps its tool footer outside the image and retains explicit viewing gallery and settings access',async()=>{
 const ui=await withImage();try{
  assert.equal(ui.doc.body.classList.contains('pankeki-photo-tools'),true);const footer=ui.doc.getElementById('pcPhotoTools'),viewport=ui.doc.getElementById('canvasViewport');assert(footer,'dedicated photo tool footer');assert.equal(viewport.contains(footer),false);assert.equal(footer.closest('.canvas-card')===viewport.closest('.canvas-card'),true);assert.deepEqual(Array.from(footer.querySelectorAll('[data-ppe-tool]'),node=>node.dataset.ppeTool),['markup','comments','background-remove','erase','resize']);
  assert.equal(ui.doc.querySelector('.pc-image-workspace').dataset.pcEditor,'closed');await loaded(ui);assert.equal(ui.doc.querySelector('.pc-image-workspace').dataset.pcEditor,'open');assert.equal(ui.doc.getElementById('workspace').dataset.candidateId,'parent');assert.equal(ui.doc.querySelector('.pk-navigation').querySelectorAll('button').length,8);
  await ui.doc.getElementById('pkGalleryOpen').click();assert.equal(ui.doc.querySelector('.pk-gallery-dialog').open,true);ui.doc.querySelector('.pk-gallery-dialog').close();await ui.doc.getElementById('pcResolution').click();assert.equal(ui.doc.getElementById('pkSettings').open,true);
 }finally{ui.view.destroy();}
});
test('reference strip browsing during a request preserves its submitted target and pinned image through a new result',async()=>{
 const ui=await withImage();try{
  const project=ui.project('Strip');project.versions.push({...plain(project.versions[0]),id:'G',image:WHITE});await ui.studio().importProject(project);ui.workspace.go('design');await openImage(ui,'parent');await type(ui,'새 후보');await ui.doc.getElementById('pkPromptForm').requestSubmit();const ref=ui.ipc.calls.send[0];await ownJob(ui,'strip-job',ref);
  const revision=ui.studio().desktopChat.getState().revision,strip=ui.doc.querySelector('.pc-candidate-strip');assert(strip,'real candidate strip');strip.scrollLeft=77;
  await strip.querySelector('[data-pc-candidate="G"]').click();assert.equal(ui.studio().desktopChat.getState().revision,revision);assert.equal(ui.view.controller.getState().activeRequestId,ref.requestId);assert.equal(ui.ipc.calls.cancel.length,0);assert.equal(ref.automatic.target.visibleCandidateId,'parent');assert.equal(ui.doc.getElementById('pcComposerTarget').dataset.candidateId,'parent');
  ui.ipc.resolveResult=async()=>({imageDataUrl:RED,request:automaticRequest(ui),metrics:{model_calls:1}});await ui.ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'strip-job',resultId:'strip-job'}});
  assert.equal(strip.querySelectorAll('button').length,3);assert.equal(strip.scrollLeft,77);assert.equal(ui.doc.getElementById('workspace').dataset.candidateId,'G');assert.equal(ui.doc.getElementById('pcCanvasSave').href,WHITE);assert.equal(strip.querySelector('[data-pc-candidate="G"]').getAttribute('aria-pressed'),'true');
 }finally{ui.view.destroy();}
});
test('reference editor close also hides an inpaint workspace without clearing source mask mode or draft',async()=>{
 const ui=await withImage();try{
  ui.workspace.go('inpaint');ui.element('paint').snapshot=WHITE;await type(ui,'마스크와 같이 유지');const before=ui.studio().exportProject(),source=ui.state().sourceDataURL,mode=ui.element('mode').value;
  await ui.doc.getElementById('pcCanvasClose').click();assert.equal(ui.doc.querySelector('.pc-image-workspace').dataset.pcEditor,'closed');assert.equal(ui.element('mode').value,mode);assert.equal(ui.state().sourceDataURL,source);assert.equal(ui.element('paint').snapshot,WHITE);assert.equal(ui.studio().exportProject(),before);assert.equal(ui.doc.getElementById('pcPrompt').value,'마스크와 같이 유지');assert.equal(ui.doc.getElementById('pkPromptForm').pankekiComposer.getAutomaticContext().visibleCandidateId,null);
 }finally{ui.view.destroy();}
});

test('narrow reference close and canvas pane reopen restore rail candidate save and target without changing the document',async()=>{
 const ui=await withImage();try{
  await openImage(ui,'parent');await ui.doc.getElementById('pcCanvasEdit').click();await settle();ui.element('paint').snapshot=WHITE;await type(ui,'keep source mask and draft');
  const shell=ui.doc.querySelector('.pc-image-workspace'),rail=ui.doc.querySelector('.pc-editor-rail'),before={project:ui.studio().exportProject(),identity:plain(ui.studio().desktopChat.getState()),source:ui.state().sourceDataURL,mode:ui.element('mode').value};
  await ui.doc.getElementById('pcCanvasClose').click();assert.equal(shell.dataset.pcEditor,'closed');assert.equal(rail.hidden,true);assert.equal(ui.doc.getElementById('pcComposerTarget').hidden,true);
  assert.equal(ui.doc.getElementById('pcShowCanvas').disabled,false);await ui.doc.getElementById('pcShowCanvas').click();
  assert.equal(shell.dataset.pcEditor,'open');assert.equal(shell.dataset.pcPane,'canvas');assert.equal(rail.hidden,false,'reopening must resync the actual rail');assert.equal(ui.doc.getElementById('editorTools').hidden,false);
  assert.equal(ui.doc.getElementById('workspace').dataset.candidateId,'parent');assert.equal(ui.doc.getElementById('pcCanvasSave').href,RED);assert.equal(ui.doc.getElementById('pcCanvasSave').getAttribute('aria-disabled'),'false');
  assert.equal(ui.doc.getElementById('pcComposerTarget').hidden,false);assert.equal(ui.doc.getElementById('pcComposerTarget').dataset.candidateId,'parent');assert.equal(ui.doc.getElementById('pkPromptForm').pankekiComposer.getAutomaticContext().visibleCandidateId,'parent');
  assert.equal(ui.doc.querySelector('.pc-candidate-strip [data-pc-candidate="parent"]').getAttribute('aria-pressed'),'true');assert.deepEqual(plain(ui.studio().desktopChat.getState()),before.identity);assert.equal(ui.state().sourceDataURL,before.source);assert.equal(ui.element('mode').value,before.mode);assert.equal(ui.element('paint').snapshot,WHITE);assert.equal(ui.studio().exportProject(),before.project);assert.equal(ui.doc.getElementById('pcPrompt').value,'keep source mask and draft');assert.equal(ui.ipc.calls.send.length,0);assert.equal(ui.ipc.calls.cancel.length,0);assert.equal(ui.requests.length,0);
 }finally{ui.view.destroy();}
});

test('closed narrow reference explicitly hides its pane switcher instead of sharing the header row',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../web/src/redesign.css'),'utf8'),reference=css.slice(css.indexOf('/* Native reference workspace:')),narrow=reference.slice(reference.indexOf('@media(max-width:1024px)'));
 const rules=Array.from(narrow.matchAll(/([^{}]+)\{([^{}]*)\}/g));assert(rules.some(([,selector,body])=>selector.includes('.pankeki-reference:not(.pc-reference-open)')&&selector.includes('.pc-pane-switcher')&&/display\s*:\s*none\s*!important/.test(body)),'closed native reference must override the legacy inpaint switcher display');
});

test('accepted automatic edit result identifies the actual core result without opening a viewer or changing its source mask',async()=>{
 const ui=await withImage();try{
  ui.studio().setImageModelSettings({editModelId:'sdxl-inpaint-v01'});await openImage(ui,'parent');await ui.doc.getElementById('pcCanvasEdit').click();await settle();
  ui.element('paint').snapshot=WHITE;ui.element('paint').getContext().getImageData=()=>({data:new Uint8ClampedArray([255,255,255,255])});await type(ui,'controlled edit completion');
  const before={source:ui.state().sourceDataURL,sourceId:ui.state().sourceId,identity:plain(ui.studio().desktopChat.getState()),mode:ui.element('mode').value};
  await ui.doc.getElementById('pkPromptForm').requestSubmit();const ref=ui.ipc.calls.send[0];await ownJob(ui,'edit-core-result',ref,'edit');
  ui.ipc.resolveResult=async()=>({imageDataUrl:WHITE,label:'Actual edit result',request:automaticRequest(ui,'edit'),metrics:{model_calls:1}});
  await ui.ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'edit-core-result',resultId:'edit-core-result'}});
  const id=ui.studio().getSummary().latestId,result=ui.doc.getElementById('result'),shell=ui.doc.querySelector('.pc-image-workspace');assert.notEqual(id,'parent');assert.equal(result.hidden,false);assert.equal(ui.doc.getElementById('editor').hidden,true);assert.equal(result.src,WHITE);assert.equal(shell.dataset.pcViewer,'closed');assert.equal(shell.dataset.pcEditor,'open');
  assert.equal(ui.doc.getElementById('workspace').dataset.candidateId,id,'metadata must follow the verified visible core result');assert.equal(ui.doc.getElementById('pcCanvasSave').href,WHITE);assert.equal(ui.doc.querySelector('.pc-candidate-strip [aria-pressed="true"]').dataset.pcCandidate,id);assert.equal(ui.doc.getElementById('pcComposerTarget').dataset.candidateId,'parent','active request retains its submitted target');assert.equal(ui.doc.body.classList.contains('pc-native-result'),true);assert.equal(ui.doc.body.classList.contains('pc-reading-image'),false);assert.equal(ui.doc.getElementById('pcViewerImage').hidden,true);
  Object.assign(result,{naturalWidth:1024,naturalHeight:1536,complete:true});Object.assign(ui.doc.getElementById('canvasViewport'),{clientWidth:640,clientHeight:480});await result.dispatchEvent(new ui.Event('load'));
  await ui.ipc.emit({...ref,type:'turn-completed',payload:{status:'completed'}});assert.match(ui.doc.getElementById('pcCanvasInfo').textContent,/1024 × 1536/);assert.equal(ui.doc.getElementById('pcCanvasActual').disabled,false);await ui.doc.getElementById('pcCanvasActual').click();assert.equal(ui.doc.getElementById('canvasViewport').dataset.pcZoom,'pixels');assert.equal(ui.doc.getElementById('pcCanvasScale').textContent,'100%');
  assert.equal(ui.doc.getElementById('pcComposerTarget').dataset.candidateId,id);const composer=ui.doc.getElementById('pkPromptForm').pankekiComposer;assert.equal(composer.getAutomaticContext().visibleCandidateId,id);assert.equal(ui.doc.querySelector('[data-ppe-tool="markup"]').disabled,false);assert.equal(Boolean(ui.doc.querySelector('.pc-image-actions [data-pc-action="edit"]')),true);
  assert.equal(ui.state().sourceDataURL,before.source);assert.equal(ui.state().sourceId,before.sourceId);assert.equal(ui.element('paint').snapshot,WHITE);assert.equal(ui.element('mode').value,before.mode);const after=ui.studio().desktopChat.getState();assert.equal(after.sourceRevision,before.identity.sourceRevision);assert.equal(after.maskRevision,before.identity.maskRevision);assert.equal(after.revision,before.identity.revision+1);assert.equal(ui.requests.length,0);assert.equal(ui.ipc.calls.cancel.length,0);
  const project=ui.studio().exportProject();result.src=RED;await result.dispatchEvent(new ui.Event('load'));assert.equal(ui.doc.getElementById('workspace').dataset.candidateId,'','mismatched bytes must not infer the newest or source candidate');assert.equal(composer.getAutomaticContext().visibleCandidateId,null);assert.equal(ui.doc.getElementById('pcCanvasSave').getAttribute('aria-disabled'),'true');assert.equal(ui.studio().exportProject(),project);
 }finally{ui.view.destroy();}
});

test('native negative prompt scope is explicit inside settings and restores the original web label hint and value',async()=>{
 const ui=await mounted();let destroyed=false;try{
  const field=ui.doc.getElementById('negative'),label=ui.doc.querySelector('label[for="negative"]'),hint=field.closest('.field').querySelector('.hint'),value=field.value;
  assert.equal(field.closest('#pkSettings')?.id,'pkSettings');assert.match(label.textContent,/Image generation only/);assert.match(hint.textContent,/Not used for current AI image edits/);assert.equal(field.hidden,false);assert.equal(field.value,value);assert.equal(ui.doc.querySelector('.pk-composer-dock').textContent.includes('current AI local edit'),false);
  field.value='keep negative value';await field.dispatchEvent(new ui.Event('input',{bubbles:true}));const captured=ui.studio().desktopChat.captureContext({intent:'auto',visibleCandidateId:null});assert.equal(captured.automatic.generation.settings.negative,'keep negative value');assert.equal(Object.hasOwn(captured.automatic.edit.regenerate.settings||{},'negative'),false);
  ui.view.destroy();destroyed=true;assert.equal(label.textContent,'Negative prompt');assert.equal(hint.textContent,'Negative prompts do not apply at CFG 1. Start with the model defaults and adjust as needed.');assert.equal(field.value,'keep negative value');assert.equal(ui.requests.length,0);
 }finally{if(!destroyed)ui.view.destroy();}
});

test('explicit candidate selection reveals only its strip thumbnail and background results preserve scroll pin draft and focus',async()=>{
 const ui=await withImage();try{
  const project=ui.project('Reveal');for(let i=1;i<9;i++)project.versions.push({...plain(project.versions[0]),id:'P'+i});await ui.studio().importProject(project);ui.workspace.go('design');
  const strip=ui.doc.querySelector('.pc-candidate-strip');Object.assign(strip,{scrollLeft:0,scrollTop:7,clientWidth:300,clientLeft:0,scrollWidth:1000});strip.getBoundingClientRect=()=>({left:100,right:400,width:300,top:600,bottom:734});
  Array.from(strip.querySelectorAll('button')).forEach((thumb,index)=>{thumb.getBoundingClientRect=()=>({left:100+index*108-strip.scrollLeft,right:198+index*108-strip.scrollLeft,width:98});thumb.scrollIntoView=()=>assert.fail('thumbnail reveal must not scroll the document');thumb.focus=()=>assert.fail('thumbnail reveal must not steal focus');});
  ui.doc.body.scrollTop=50;await type(ui,'preserved draft');await openImage(ui,'P8');assert.equal(strip.scrollLeft,662,'explicitly selected thumbnail is brought inside the horizontal strip');assert.equal(strip.scrollTop,7);assert.equal(ui.doc.body.scrollTop,50);assert.equal(ui.doc.getElementById('pcPrompt').value,'preserved draft');
  await openImage(ui,'P8');assert.equal(strip.scrollLeft,662,'already visible selection keeps scroll');await openImage(ui,'parent');assert.equal(strip.scrollLeft,0,'selection to the left reveals only horizontally');await openImage(ui,'P8');strip.scrollLeft=40;
  await ui.doc.getElementById('pkPromptForm').requestSubmit();const ref=ui.ipc.calls.send[0];await ownJob(ui,'reveal-background',ref);await type(ui,'next draft');ui.doc.getElementById('pcPrompt').focus();const focus=ui.doc.activeElement;
  ui.ipc.resolveResult=async()=>({imageDataUrl:WHITE,request:automaticRequest(ui),metrics:{model_calls:1}});await ui.ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'reveal-background',resultId:'reveal-background'}});
  assert.equal(strip.querySelectorAll('button').length,10);assert.equal(strip.scrollLeft,40);assert.equal(strip.scrollTop,7);assert.equal(ui.doc.body.scrollTop,50);assert.equal(ui.doc.getElementById('workspace').dataset.candidateId,'P8');assert.equal(ui.doc.activeElement,focus);assert.equal(ui.doc.getElementById('pcPrompt').value,'next draft');assert.equal(ui.requests.length,0);
 }finally{ui.view.destroy();}
});

test('automatic context reads only the visible pinned candidate or actual editor source without changing the document',async()=>{
 const ui=await withImage();try{
  const next=ui.project('Targets');next.versions.push({...plain(next.versions[0]),id:'G',image:WHITE});await ui.studio().importProject(next);ui.workspace.go('design');
  const composer=ui.doc.getElementById('pkPromptForm').pankekiComposer,revision=ui.studio().desktopChat.getState().revision,before=ui.studio().exportProject();
  assert.equal(composer.getAutomaticContext().visibleCandidateId,null);
  await openImage(ui,'parent');assert.equal(composer.getAutomaticContext().visibleCandidateId,'parent');
  await openImage(ui,'G');assert.equal(composer.getAutomaticContext().visibleCandidateId,'G');assert.equal(ui.studio().desktopChat.getState().revision,revision);assert.equal(ui.studio().exportProject(),before);
  await ui.doc.getElementById('pcCanvasEdit').click();await settle();assert.equal(composer.getAutomaticContext().visibleCandidateId,'G');assert.equal(ui.state().sourceId,'G');
  const prepared=ui.studio().exportProject();composer.getAutomaticContext();assert.equal(ui.studio().exportProject(),prepared);
 }finally{ui.view.destroy();}
});
test('readonly viewing from an active edit preserves the request revision source mask and pinned target',async()=>{
 const ui=await withImage();try{
  const next=ui.project('Edit and view');next.versions.push({...plain(next.versions[0]),id:'G',image:WHITE});await ui.studio().importProject(next);ui.workspace.go('design');await openImage(ui,'parent');await ui.doc.getElementById('pcCanvasEdit').click();await settle();ui.studio().setImageModelSettings({editModelId:'sdxl-inpaint-v01'});assert.equal(ui.state().sourceId,'parent');
  ui.element('paint').snapshot=WHITE;ui.element('paint').getContext().getImageData=()=>({data:new Uint8ClampedArray([255,255,255,255])});
  await type(ui,'Edit F');await ui.doc.getElementById('pkPromptForm').requestSubmit();assert.equal(ui.ipc.calls.send.length,1);await ownJob(ui,'edit-F',ui.ipc.calls.send[0],'edit');
  const revision=ui.studio().desktopChat.getState().revision,source=ui.state().sourceDataURL,mask=ui.element('paint').snapshot,request=ui.view.controller.getState().activeRequestId;
  await openImage(ui,'G');assert.equal(ui.studio().desktopChat.getState().revision,revision);assert.equal(ui.state().sourceDataURL,source);assert.equal(ui.element('paint').snapshot,mask);
  assert.equal(ui.view.controller.getState().activeRequestId,request);assert.equal(ui.ipc.calls.cancel.length,0);assert.equal(ui.doc.getElementById('workspace').dataset.candidateId,'G');
  ui.ipc.resolveResult=async()=>({imageDataUrl:RED,request:automaticRequest(ui,'edit'),metrics:{model_calls:1}});
  await ui.ipc.emit({...ui.ipc.calls.send[0],type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'edit-F',resultId:'edit-F'}});
  assert.equal(ui.state().project.versions.at(-1).parentId,'parent');assert.equal(ui.doc.getElementById('workspace').dataset.candidateId,'G');assert.equal(ui.doc.getElementById('pcCanvasSave').href,WHITE);
 }finally{ui.view.destroy();}
});
test('automatic view F with a prepared source and mask G stages only the reference F and no mismatched mask',async()=>{
 const ui=await withImage();try{
  const next=ui.project('F and G');next.versions.push({...plain(next.versions[0]),id:'G',image:WHITE});await ui.studio().importProject(next);ui.workspace.go('design');await openImage(ui,'G');await ui.doc.getElementById('pcCanvasEdit').click();await settle();
  ui.element('paint').snapshot=WHITE;ui.element('paint').getContext().getImageData=()=>({data:new Uint8ClampedArray([255,255,255,255])});await openImage(ui,'parent');
  const before=ui.studio().exportProject();await type(ui,'이 그림 수정해줘');await ui.doc.getElementById('pkPromptForm').requestSubmit();const wire=ui.ipc.calls.send[0];
  assert.equal(wire.automatic.target.visibleCandidateId,'parent');assert.equal(wire.automatic.target.sourceCandidateId,'G');assert.equal(wire.automatic.edit.ready,false);assert.equal(wire.automatic.edit.reason,'target');
  assert.equal(ui.ipc.calls.prepare.length,1);assert.equal(wire.context.sourceId,'source-local');assert.equal(wire.context.maskId,undefined);assert.equal(ui.ipc.calls.prepare[0].sourceDataUrl,RED);assert.equal(ui.ipc.calls.prepare[0].maskDataUrl,undefined);assert.equal(wire.automatic.target.referenceCandidateId,'parent');
  await ui.ipc.emit({...wire,type:'needs-input',payload:{reason:'target'}});assert.match(ui.view.controller.getState().notice,/visible image/);assert.equal(ui.studio().exportProject(),before);assert.equal(ui.state().sourceId,'G');assert.equal(ui.element('paint').snapshot,WHITE);assert.equal(ui.requests.length,0);
 }finally{ui.view.destroy();}
});

test('generation has one conversation/composer and the original right image workspace with truthful empty state',async()=>{
 const ui=await mounted();assert(ui.doc.querySelector('.pc-image-workspace'));assert.equal(ui.doc.querySelectorAll('#pcPrompt').length,1);assert.equal(ui.doc.getElementById('desktopChatPanel'),null);assert(ui.doc.getElementById('pcCanvasTitle'));assert.equal(ui.doc.getElementById('pcCanvasFit').disabled,true);assert.equal(ui.doc.getElementById('pcCanvasEdit').disabled,true);
 assert.equal(ui.doc.querySelector('.pk-brand img').src,ui.doc.querySelector('.app-header .brand-logo').src);assert.equal(ui.doc.querySelector('.pk-navigation').querySelectorAll('button').length,8);assert.equal(ui.requests.length,0);ui.view.destroy();
});
test('candidate image and big-view controls activate the original canvas without opening a second viewer',async()=>{
 const ui=await withImage(),before=ui.studio().exportProject();await ui.doc.querySelector('.pc-image-open').click();assert.equal(ui.doc.querySelector('.pc-image-workspace').dataset.pcPane,'canvas');assert.equal(ui.doc.activeElement,ui.doc.getElementById('workspace'));assert.equal(ui.element('result').src,RED);assert.equal(ui.doc.querySelector('.pc-image-viewer'),null);
 await ui.doc.querySelector('.pc-image-open').click();assert.equal(ui.state().project.versions.length,1);assert.equal(ui.doc.querySelectorAll('#pcPrompt').length,1);assert.equal(ui.requests.length,0);ui.view.destroy();
});
test('fit and real 100 percent/zoom preserve natural portrait dimensions and the original image bytes',async()=>{
 const ui=await withImage(),{img,viewport}=await loaded(ui),bytes=img.src;assert.match(ui.doc.getElementById('pcCanvasInfo').textContent,/1024 × 1536/);assert.equal(viewport.dataset.pcZoom,'fit');
 await ui.doc.getElementById('pcCanvasActual').click();assert.equal(viewport.dataset.pcZoom,'pixels');assert.equal(viewport.style['--pc-canvas-image-width'],'1024px');assert.equal(viewport.style['--pc-canvas-image-height'],'1536px');
 await ui.doc.getElementById('pcCanvasZoomIn').click();assert.equal(viewport.style['--pc-canvas-image-width'],'1280px');assert.equal(viewport.style['--pc-canvas-image-height'],'1920px');await ui.doc.getElementById('pcCanvasFit').click();assert.equal(viewport.dataset.pcZoom,'fit');assert.equal(img.src,bytes);assert.equal(ui.requests.length,0);ui.view.destroy();
});
test('canvas save and partial edit reuse existing candidate handlers without changing image or mask',async()=>{
 const ui=await withImage();await loaded(ui);const source=ui.state().sourceDataURL,mask=ui.element('paint').snapshot,id=ui.state().project.versions[0].id;
 const save=ui.doc.getElementById('pcCanvasSave');assert.equal(save.href,RED);assert.equal(save.download,'pankeki-'+id+'.png');const event=new ui.Event('click');await save.dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.equal(ui.downloads.length,1);assert.deepEqual(Buffer.from(await ui.downloads[0].blob.arrayBuffer()),Buffer.from(RED.split(',')[1],'base64'));
 await ui.doc.getElementById('pcCanvasEdit').click();await settle();assert.equal(ui.doc.body.dataset.studioScreen,'inpaint');assert.equal(ui.state().sourceDataURL,source);assert.equal(ui.element('paint').snapshot,mask);assert.equal(ui.requests.length,0);ui.view.destroy();
});
test('one accepted bridge result stays in left history without automatically opening the viewer or moving focus',async()=>{
 const ui=await withImage();await type(ui,'new image');ui.ipc.resolveResult=async()=>({imageDataUrl:RED,request:automaticRequest(ui),metrics:{model_calls:1}});
 ui.doc.getElementById('pcPrompt').focus();const focused=ui.doc.activeElement;
 await ui.doc.getElementById('pkPromptForm').requestSubmit();const ref=ui.ipc.calls.send[0];await ownJob(ui,'job-new',ref);await ui.ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'job-new',resultId:'result-new'}});
 const id=ui.state().project.versions.at(-1).id;assert.equal(ui.state().project.versions.length,2);assert.equal(ui.doc.querySelectorAll(`.pc-turn[data-candidate-id="${id}"]`).length,1);assert.equal(ui.doc.querySelector('.pc-image-workspace').dataset.pcViewer,'closed');assert.equal(ui.doc.getElementById('workspace').dataset.candidateId,'');assert.equal(ui.element('result').src,RED);assert.equal(ui.doc.activeElement,focused);assert.equal(ui.requests.length,0);ui.view.destroy();
});
test('canvas surface switches return focus with Escape and do not duplicate or clear the draft',async()=>{
 const ui=await withImage();await type(ui,'keep draft');const trigger=await openImage(ui);await ui.doc.getElementById('pcShowConversation').click();await ui.doc.getElementById('pcShowCanvas').click();assert.equal(ui.doc.querySelector('.pc-image-workspace').dataset.pcPane,'canvas');assert.equal(ui.doc.activeElement,ui.doc.getElementById('workspace'));
 await ui.doc.getElementById('workspace').dispatchEvent(new ui.Event('keydown',{key:'Escape',bubbles:true}));assert.equal(ui.doc.querySelector('.pc-image-workspace').dataset.pcPane,'conversation');assert.equal(ui.doc.querySelector('.pc-image-workspace').dataset.pcViewer,'closed');assert.equal(ui.doc.activeElement,trigger);assert.equal(ui.doc.getElementById('pcPrompt').value,'keep draft');assert.equal(ui.doc.querySelectorAll('#pcPrompt').length,1);ui.view.destroy();
});
test('progress and errors are actual controller state and reset removes stale selection and save targets',async()=>{
 const ui=await withImage();await loaded(ui);await type(ui,'question');await ui.doc.getElementById('pkPromptForm').requestSubmit();const ref=ui.ipc.calls.send[0];await ui.ipc.emit({...ref,type:'turn-started',payload:{}});assert.equal(ui.doc.getElementById('workspace').getAttribute('aria-busy'),'true');
 await ui.ipc.emit({...ref,type:'error',payload:{code:'signed-out',message:'로그인 확인이 필요해요.'}});assert.match(ui.doc.getElementById('pcCanvasStatus').textContent,/로그인/);ui.studio().resetProject();await settle();assert.equal(ui.doc.getElementById('workspace').dataset.candidateId,'');assert.equal(ui.doc.getElementById('pcCanvasActual').disabled,true);assert.equal(ui.doc.getElementById('pcCanvasSave').getAttribute('aria-disabled'),'true');ui.view.destroy();
});
test('generation layout reserves conversation width, contains complete images and offers a narrow surface switch',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../web/src/redesign.css'),'utf8'),spacious=css.slice(css.indexOf('/* Spacious generation/edit workspace'));
 assert.match(spacious,/grid-template-columns:clamp\(340px,32%,560px\) minmax\(0,1fr\)/);assert.match(spacious,/\.pk-composer-dock\{grid-area:3\/1\/4\/-1;[^}]*max-width:none/);assert.match(spacious,/\.pc-canvas-overlay\{position:absolute;[^}]*bottom:12px/);
 assert.match(css,/data-pc-zoom=fit[^}]*object-fit:contain/);assert.match(css,/data-pc-zoom=pixels[^}]*max-width:none/);assert.match(css,/@media\(max-width:1024px\)/);assert.match(css,/data-pc-pane=canvas/);assert.match(css,/data-pc-pane=conversation/);
});

test('partial edit entry synchronizes the existing desktop action before the next send',async()=>{
 const ui=await withImage();ui.studio().setImageModelSettings({editModelId:'sdxl-inpaint-v01'});
 await ui.doc.querySelector('.pc-image-actions [data-pc-action="edit"]').click();await settle();assert.equal(Boolean(ui.doc.getElementById('desktopChatIntent')),false);
 ui.element('paint').snapshot=WHITE;ui.element('paint').getContext().getImageData=()=>({data:new Uint8ClampedArray([255,255,255,255])});await type(ui,'selected edit');await ui.doc.getElementById('pkPromptForm').requestSubmit();assert.match(ui.ipc.calls.send[0].text,/Pankeki action: auto/);assert.equal(ui.ipc.calls.send[0].automatic.edit.regenerate.settings.model_id,'sdxl-inpaint-v01');ui.view.destroy();
});

test('changing image does not reuse old natural dimensions before the newly selected image finishes loading',async()=>{
 const ui=await withImage(),{img}=await loaded(ui);img.complete=false;const next=ui.project('Next project');next.versions.push({...plain(next.versions[0]),id:'next-image',label:'Next image',image:WHITE});await ui.studio().importProject(next);ui.workspace.go('design');await openImage(ui,'next-image');
 assert.equal(ui.doc.getElementById('pcCanvasActual').disabled,true);assert.equal(ui.doc.getElementById('pcCanvasInfo').textContent.includes('1024 × 1536'),false);assert.equal(ui.doc.getElementById('pcCanvasScale').textContent,'');assert.match(ui.doc.getElementById('pcCanvasStatus').textContent,/Loading/);
 Object.assign(img,{complete:true,naturalWidth:512,naturalHeight:512});await img.dispatchEvent(new ui.Event('load'));assert.match(ui.doc.getElementById('pcCanvasInfo').textContent,/512 × 512/);assert.equal(ui.doc.getElementById('pcCanvasActual').disabled,false);ui.view.destroy();
});

test('gallery edit invokes the original candidate edit exactly once without a chat mode selector',async()=>{
 const ui=await withImage();ui.studio().setImageModelSettings({editModelId:'sdxl-inpaint-v01'});
 const before=ui.state().project.selectionHistory.length,sourceRevision=ui.studio().getSummary().sourceRevision,id=ui.state().project.versions[0].id;
 await ui.doc.getElementById('pkGalleryOpen').click();const gallery=ui.doc.querySelector('.pk-gallery-dialog');assert.equal(gallery.open,true);
 await gallery.querySelector(`[data-candidate-id="${id}"] [data-action="edit"]`).click();await settle();
 assert.equal(gallery.open,false);assert.equal(ui.state().project.selectionHistory.length,before+1);assert.deepEqual(plain(ui.state().project.selectionHistory.at(-1)).candidateId,id);assert.equal(ui.state().project.selectionHistory.at(-1).action,'edit');assert.equal(ui.studio().getSummary().sourceRevision,sourceRevision+1);
 assert.equal(ui.state().sourceId,id);assert.equal(ui.state().sourceDataURL,RED);
 ui.element('paint').snapshot=WHITE;ui.element('paint').getContext().getImageData=()=>({data:new Uint8ClampedArray([255,255,255,255])});await type(ui,'갤러리에서 선택한 영역 수정');await ui.doc.getElementById('pkPromptForm').requestSubmit();
 assert.equal(ui.ipc.calls.send.length,1);assert.match(ui.ipc.calls.send[0].text,/Pankeki action: auto/);assert.equal(ui.ipc.calls.send[0].automatic.edit.regenerate.settings.model_id,'sdxl-inpaint-v01');assert.equal(Boolean(ui.doc.getElementById('desktopChatIntent')),false);assert.equal(ui.element('mode').value,'inpaint');assert.equal(ui.requests.length,0);ui.view.destroy();
});

test('zooming out a large image fitted below 25 percent cannot enlarge it to the pixel zoom minimum',async()=>{
 const ui=await withImage(),{viewport}=await loaded(ui,4096,4096);const scale=ui.doc.getElementById('pcCanvasScale').textContent;assert.equal(viewport.dataset.pcZoom,'fit');assert.equal(scale,'12%');
 await ui.doc.getElementById('pcCanvasZoomOut').click();assert.equal(viewport.dataset.pcZoom,'fit');assert.equal(ui.doc.getElementById('pcCanvasScale').textContent,scale);assert.equal(ui.doc.getElementById('pcCanvasZoomOut').disabled,true);
 await ui.doc.getElementById('pcCanvasActual').click();await ui.doc.getElementById('pcCanvasZoomOut').click();assert.equal(ui.doc.getElementById('pcCanvasScale').textContent,'75%');assert.equal(viewport.style['--pc-canvas-image-width'],'3072px');ui.view.destroy();
});

for(const initialIntent of ['pending','generate','chat'])test(`native active ${initialIntent} prevents gallery and workspace edits from changing the source until cancellation`,async()=>{
 const ui=await withImage();await openImage(ui);const selections=ui.state().project.selectionHistory.length;await type(ui,'진행 중 요청');await ui.doc.getElementById('pkPromptForm').requestSubmit();if(initialIntent!=='pending')await resolveIntent(ui,initialIntent);
 assert(ui.view.controller.getState().activeRequestId);assert.equal(ui.studio().getSummary().busy,false);assert.equal(ui.view.controller.settingsLocked(),true);
 const before={revision:ui.studio().getSummary().sourceRevision,source:ui.state().sourceDataURL,id:ui.state().sourceId,mode:ui.element('mode').value,project:ui.studio().exportProject()};
 await ui.doc.querySelector('.pc-image-actions [data-pc-action="edit"]').click();await ui.doc.getElementById('pcCanvasEdit').click();await ui.doc.getElementById('pkGalleryOpen').click();
 const gallery=ui.doc.querySelector('.pk-gallery-dialog'),edit=gallery.querySelector('[data-action="edit"]');
 // The controlled DOM click() does not implement disabled-button activation;
 // honor that browser boundary while running the original candidate handler.
 if(!edit.disabled)await edit.click();await settle();
 assert.equal(ui.studio().getSummary().sourceRevision,before.revision);assert.equal(ui.state().sourceDataURL,before.source);assert.equal(ui.state().sourceId,before.id);assert.equal(ui.element('mode').value,before.mode);assert.equal(ui.studio().exportProject(),before.project);assert.equal(Boolean(ui.doc.getElementById('desktopChatIntent')),false);assert.equal(edit.disabled,true);assert.equal(gallery.open,true);
 await ui.view.controller.cancel();await settle();const ready=gallery.querySelector('[data-action="edit"]');assert.equal(ready.disabled,false);await ready.click();await settle();assert.equal(Boolean(ui.doc.getElementById('desktopChatIntent')),false);assert.equal(ui.studio().getSummary().sourceRevision,before.revision+1);assert.equal(ui.state().project.selectionHistory.length,selections+1);assert.equal(ui.state().project.selectionHistory.at(-1).action,'edit');assert.equal(ui.ipc.calls.send.length,1);assert.equal(ui.requests.length,0);ui.view.destroy();
});

for(const initialIntent of ['pending','generate','chat'])test(`pending cancel acknowledgement keeps ${initialIntent} gallery and workspace edits locked until the shared controller unlocks`,async()=>{
 const ui=await withImage();await openImage(ui);const selections=ui.state().project.selectionHistory.length;await type(ui,'취소 ACK 대기');await ui.doc.getElementById('pkPromptForm').requestSubmit();if(initialIntent!=='pending')await resolveIntent(ui,initialIntent);
 let acknowledge;ui.ipc.cancelMessage=input=>{ui.ipc.calls.cancel.push(input);return new Promise(resolve=>acknowledge=resolve);};const cancel=ui.view.controller.cancel();await settle();
 assert.equal(ui.view.controller.getState().activeRequestId,null);assert.equal(ui.view.controller.getState().canceling,true);assert.equal(ui.view.controller.settingsLocked(),true);assert.equal(ui.studio().getSummary().busy,false);assert.equal(ui.view.controller.settingsLocked(),true);
 assert.equal(ui.doc.querySelectorAll('[data-ppe-tool]').length,5);for(const tool of ui.doc.querySelectorAll('[data-ppe-tool]'))assert.equal(tool.disabled,true,'photo tools remain locked during native cancellation acknowledgement');
 const before={revision:ui.studio().getSummary().sourceRevision,source:ui.state().sourceDataURL,id:ui.state().sourceId,mode:ui.element('mode').value,project:ui.studio().exportProject()};
 await ui.doc.querySelector('.pc-image-actions [data-pc-action="edit"]').click();await ui.doc.getElementById('pcCanvasEdit').click();await ui.doc.getElementById('pkGalleryOpen').click();const gallery=ui.doc.querySelector('.pk-gallery-dialog'),edit=gallery.querySelector('[data-action="edit"]');
 // Honor disabled-button user activation at the controlled browser boundary.
 if(!edit.disabled)await edit.click();await settle();
 assert.equal(ui.studio().getSummary().sourceRevision,before.revision);assert.equal(ui.state().sourceDataURL,before.source);assert.equal(ui.state().sourceId,before.id);assert.equal(ui.element('mode').value,before.mode);assert.equal(ui.studio().exportProject(),before.project);assert.equal(Boolean(ui.doc.getElementById('desktopChatIntent')),false);assert.equal(edit.disabled,true);assert.equal(ui.doc.querySelector('.pc-image-actions [data-pc-action="edit"]').disabled,true);assert.equal(ui.doc.getElementById('pcCanvasEdit').disabled,true);
 acknowledge({canceled:true});await cancel;await settle();assert.equal(ui.view.controller.settingsLocked(),false);for(const tool of ui.doc.querySelectorAll('[data-ppe-tool]'))assert.equal(tool.disabled,false);const ready=gallery.querySelector('[data-action="edit"]');assert.equal(ready.disabled,false);assert.equal(ui.doc.querySelector('.pc-image-actions [data-pc-action="edit"]').disabled,false);assert.equal(ui.doc.getElementById('pcCanvasEdit').disabled,false);await ready.click();await settle();assert.equal(Boolean(ui.doc.getElementById('desktopChatIntent')),false);assert.equal(ui.studio().getSummary().sourceRevision,before.revision+1);assert.equal(ui.state().project.selectionHistory.length,selections+1);assert.equal(ui.state().project.selectionHistory.at(-1).action,'edit');assert.equal(ui.ipc.calls.send.length,1);assert.equal(ui.requests.length,0);ui.view.destroy();
});

test('viewer starts closed for empty, loaded and reopened projects without reserving a selected image',async()=>{
 const ui=await mounted(),shell=ui.doc.querySelector('.pc-image-workspace');assert.equal(shell.dataset.pcViewer,'closed');await ui.studio().importProject(ui.project('Reopen'));assert.equal(shell.dataset.pcViewer,'closed');await openImage(ui);assert.equal(shell.dataset.pcViewer,'open');const saved=ui.studio().exportProject();await ui.studio().importProject(saved);assert.equal(shell.dataset.pcViewer,'closed');assert.equal(ui.doc.getElementById('workspace').dataset.candidateId,'');await openImage(ui);ui.studio().resetProject();await settle();assert.equal(shell.dataset.pcViewer,'closed');ui.view.destroy();
});
test('viewer close returns the original image trigger and a missing trigger falls back to the single composer',async()=>{
 const ui=await withImage();await type(ui,'keep this draft');const trigger=await openImage(ui);await ui.doc.getElementById('pcCanvasClose').click();assert.equal(ui.doc.querySelector('.pc-image-workspace').dataset.pcViewer,'closed');assert.equal(ui.doc.activeElement,trigger);await ui.doc.getElementById('pcShowCanvas').click();assert.equal(ui.doc.querySelector('.pc-image-workspace').dataset.pcViewer,'closed');await openImage(ui);trigger.remove();await ui.doc.getElementById('pcCanvasClose').click();assert.equal(ui.doc.activeElement,ui.doc.getElementById('pcPrompt'));assert.equal(ui.doc.getElementById('pcPrompt').value,'keep this draft');ui.view.destroy();
});
test('an open viewer pins its clicked candidate through new results and edits that same candidate',async()=>{
 const ui=await withImage(),id=ui.state().project.versions[0].id;await loaded(ui);const viewport=ui.doc.getElementById('canvasViewport'),title=ui.doc.getElementById('pcCanvasTitle').textContent,info=ui.doc.getElementById('pcCanvasInfo').textContent;await ui.doc.getElementById('pcCanvasActual').click();viewport.scrollTop=123;viewport.scrollLeft=17;await type(ui,'another result');ui.doc.getElementById('pcPrompt').focus();const focused=ui.doc.activeElement;
 ui.ipc.resolveResult=async()=>({imageDataUrl:WHITE,request:automaticRequest(ui),metrics:{model_calls:1}});await ui.doc.getElementById('pkPromptForm').requestSubmit();const ref=ui.ipc.calls.send[0];await ownJob(ui,'job-pinned',ref);await ui.ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'job-pinned',resultId:'result-pinned'}});const added=ui.state().project.versions.at(-1).id;
 assert.notEqual(added,id);assert.equal(ui.doc.getElementById('workspace').dataset.candidateId,id);assert.equal(ui.doc.getElementById('pcViewerImage').src,RED);assert.equal(ui.element('result').src,WHITE);assert.equal(ui.doc.getElementById('pcCanvasTitle').textContent,title);assert.equal(ui.doc.getElementById('pcCanvasInfo').textContent,info);assert.equal(ui.doc.getElementById('pcCanvasSave').href,RED);assert.equal(ui.doc.getElementById('pcCanvasSave').download,'pankeki-'+id+'.png');assert.equal(viewport.dataset.pcZoom,'pixels');assert.equal(viewport.scrollTop,123);assert.equal(viewport.scrollLeft,17);assert.equal(ui.doc.activeElement,focused);assert.equal(ui.doc.querySelectorAll(`.pc-turn[data-candidate-id="${added}"]`).length,1);
 await ui.ipc.emit({...ref,type:'turn-completed',payload:{}});await ui.doc.getElementById('pcCanvasEdit').click();await settle();assert.equal(ui.state().sourceId,id);assert.equal(ui.state().sourceDataURL,RED);assert.equal(ui.doc.body.dataset.studioScreen,'inpaint');assert.equal(ui.doc.querySelector('.pc-image-workspace').dataset.pcViewer,'closed');assert.equal(ui.requests.length,0);ui.view.destroy();
});

test('opening a chat image during generation preserves the request revision and still accepts its result',async()=>{
 const ui=await withImage();await type(ui,'generation while viewing');ui.ipc.resolveResult=async()=>({imageDataUrl:WHITE,request:automaticRequest(ui),metrics:{model_calls:1}});await ui.doc.getElementById('pkPromptForm').requestSubmit();const ref=ui.ipc.calls.send[0],revision=ui.studio().desktopChat.getState().revision;
 await openImage(ui);assert.equal(ui.studio().desktopChat.getState().revision,revision);await ownJob(ui,'job-during-view',ref);await ui.ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'job-during-view',resultId:'result-during-view'}});assert.equal(ui.state().project.versions.length,2);assert.equal(ui.doc.getElementById('workspace').dataset.candidateId,'parent');assert.equal(ui.doc.getElementById('pcViewerImage').src,RED);ui.view.destroy();
});

test('gallery view during generation is captured before native onclick and preserves the live request until result collection',async()=>{
 const ui=await captureMounted();await type(ui,'generation while viewing gallery');ui.ipc.resolveResult=async()=>({imageDataUrl:WHITE,request:automaticRequest(ui),metrics:{model_calls:1}});await ui.doc.getElementById('pkPromptForm').requestSubmit();
 const ref=ui.ipc.calls.send[0],before={revision:ui.studio().desktopChat.getState().revision,source:ui.state().sourceDataURL,sourceId:ui.state().sourceId,sourceRevision:ui.studio().getSummary().sourceRevision,project:ui.studio().exportProject()};await ui.doc.getElementById('pkGalleryOpen').click();const gallery=ui.doc.querySelector('.pk-gallery-dialog');await gallery.querySelector('[data-action="view"]').click();
 assert.equal(ui.studio().desktopChat.getState().revision,before.revision);assert.equal(ui.state().sourceDataURL,before.source);assert.equal(ui.state().sourceId,before.sourceId);assert.equal(ui.studio().getSummary().sourceRevision,before.sourceRevision);assert.equal(ui.studio().exportProject(),before.project);assert.equal(ui.view.controller.getState().activeRequestId,ref.requestId);assert.equal(ui.ipc.calls.cancel.length,0);assert.equal(gallery.open,false);assert.equal(ui.doc.getElementById('workspace').dataset.candidateId,'parent');assert.equal(ui.doc.getElementById('pcViewerImage').src,RED);
 await ownJob(ui,'job-gallery-view',ref);await ui.ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'job-gallery-view',resultId:'result-gallery-view'}});assert.equal(ui.state().project.versions.length,2);assert.equal(ui.doc.getElementById('workspace').dataset.candidateId,'parent');assert.equal(ui.doc.getElementById('pcViewerImage').src,RED);assert.equal(ui.ipc.calls.send.length,1);assert.equal(ui.requests.length,0);ui.view.destroy();
});

test('viewer closing returns to the composer when its gallery dialog is closed or its chat trigger is hidden or inert',async()=>{
 const ui=await captureMounted();await type(ui,'preserved draft');await ui.doc.getElementById('pkGalleryOpen').click();const gallery=ui.doc.querySelector('.pk-gallery-dialog');await gallery.querySelector('[data-action="view"]').click();assert.equal(gallery.open,false);
 await ui.doc.getElementById('workspace').dispatchEvent(new ui.Event('keydown',{key:'Escape',bubbles:true}));assert.equal(ui.doc.activeElement?.id,'pcPrompt');
 for(const property of ['hidden','inert']){const trigger=await openImage(ui);trigger[property]=true;await ui.doc.getElementById('pcCanvasClose').click();assert.equal(ui.doc.activeElement?.id,'pcPrompt');trigger[property]=false;}
 assert.equal(ui.doc.getElementById('pcPrompt').value,'preserved draft');assert.equal(ui.doc.querySelector('.pc-image-workspace').dataset.pcViewer,'closed');ui.view.destroy();
});

test('real view controls occupy the header and mask tools the external rail without changing source or mask handlers',async()=>{
 const ui=await withImage();await loaded(ui);const rail=ui.doc.querySelector('.pc-editor-rail');assert(rail,'actual canvas tools rail');
 for(const id of ['pcCanvasEdit','editorTools'])assert.equal(ui.doc.getElementById(id).closest('.pc-editor-rail')===rail,true,id);
 for(const id of ['pcCanvasFit','pcCanvasActual','pcCanvasZoomIn','pcCanvasSave','pcCanvasClose'])assert.equal(ui.doc.getElementById(id).closest('.pc-canvas-header')===ui.doc.querySelector('.pc-canvas-header'),true,id);
 await ui.doc.getElementById('pcCanvasEdit').click();await settle();const source=ui.state().sourceDataURL,mask=ui.element('paint').snapshot;await ui.element('eraserTool').click();assert.equal(ui.element('erase').checked,true);await ui.element('brushTool').click();assert.equal(ui.element('erase').checked,false);assert.equal(ui.state().sourceDataURL,source);assert.equal(ui.element('paint').snapshot,mask);assert.equal(ui.requests.length,0);ui.view.destroy();
});
test('explicit edit exposes the existing canvas in the shared workspace and pane switches preserve the project',async()=>{
 const ui=await withImage();await ui.doc.querySelector('.pc-image-actions [data-pc-action="edit"]').click();await settle();assert.equal(ui.doc.querySelector('.pc-image-workspace').dataset.pcPane,'canvas');assert.equal(ui.doc.getElementById('pcShowCanvas').disabled,false);
 const before=ui.studio().exportProject(),revision=ui.studio().getSummary().sourceRevision,source=ui.state().sourceDataURL;await ui.doc.getElementById('pcShowConversation').click();await ui.doc.getElementById('pcShowCanvas').click();assert.equal(ui.doc.querySelector('.pc-image-workspace').dataset.pcPane,'canvas');assert.equal(ui.doc.querySelector('.pc-image-workspace').dataset.pcViewer,'closed');assert.equal(ui.studio().exportProject(),before);assert.equal(ui.studio().getSummary().sourceRevision,revision);assert.equal(ui.state().sourceDataURL,source);assert.equal(ui.doc.querySelectorAll('#pcPrompt').length,1);assert.equal(ui.requests.length,0);ui.view.destroy();
});
test('compact composer keeps original edit controls and settings with no manual action or consent selectors',async()=>{
 const ui=await withImage(),context=ui.doc.querySelector('.pc-edit-context');assert.equal(ui.doc.getElementById('pcPrompt').rows,1);assert(context,'existing edit controls context');assert.equal(ui.doc.getElementById('inpaintOperations').parentNode,context);assert.equal(context.closest('#pcModelPanel')?.id,'pcModelPanel');assert.equal(Boolean(ui.doc.getElementById('desktopChatConsentRow')),false);assert.equal(ui.doc.getElementById('inpaintOperations').closest('form'),null);assert.equal(ui.doc.getElementById('desktopChatConnect').closest('#desktopModelSettings'),ui.doc.getElementById('desktopModelSettings'));
 let connected=0;ui.ipc.connectCodex=async()=>{connected++;return {state:'ready',provider:'codex',toolsReady:true};};await ui.doc.getElementById('desktopChatSelectedModel').click();assert.equal(ui.doc.getElementById('pkSettings').open,true);await ui.doc.getElementById('desktopChatConnect').click();await settle();assert.equal(connected,1);assert.equal(ui.doc.querySelectorAll('#pcPrompt').length,1);assert.equal(ui.ipc.calls.send.length,0);assert.equal(ui.requests.length,0);ui.view.destroy();
});

test('compact shell sizing is route independent while spacious page content stays limited to the work routes',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../web/src/redesign.css'),'utf8'),spacious=css.slice(css.indexOf('/* Spacious generation/edit workspace'),css.indexOf('/* Native reference workspace:'));
 const blocks=Array.from(spacious.matchAll(/([^{}]+)\{([^{}]*)\}/g)),shell=blocks.filter(block=>/\.pk-(?:layout|sidebar|brand|surface|header|navigation)\b/.test(block[1]));assert(shell.length>=10);
 for(const block of shell)assert.equal(block[1].includes('data-studio-screen'),false,'shared shell must not move on route change: '+block[1].trim());
 assert.match(spacious,/body\.pankeki-pc\.pankeki-spacious\{padding:0\}/);assert.match(spacious,/\.pk-layout\{grid-template-columns:176px minmax\(0,1fr\);gap:0;height:100dvh/);assert.match(spacious,/data-studio-screen=inpaint[^}]*\.pc-spacious-workspace/);
 const reference=css.slice(css.indexOf('/* Native reference workspace:'));assert.match(reference,/pankeki-reference \.pk-layout\{grid-template-columns:220px minmax\(0,1fr\)/);
 for(const block of reference.matchAll(/([^{}]+)\{([^{}]*)\}/g))if(/\.pk-(?:sidebar|brand|navigation)\b/.test(block[1]))assert.equal(block[1].includes('data-studio-screen'),false,'sidebar coordinates remain route independent');
});

test('returning from a readonly view to its already prepared source preserves the existing mask',async()=>{
 const ui=await withImage();try{
  await loaded(ui);await ui.doc.getElementById('pcCanvasEdit').click();await settle();ui.element('paint').snapshot=WHITE;
  const source=ui.state().sourceDataURL,revision=ui.studio().getSummary().sourceRevision;await openImage(ui,'parent');await ui.doc.getElementById('pcCanvasEdit').click();await settle();
  assert.equal(ui.doc.querySelector('.pc-image-workspace').dataset.pcEditor,'open');assert.equal(ui.state().sourceDataURL,source);assert.equal(ui.studio().getSummary().sourceRevision,revision);assert.equal(ui.element('paint').snapshot,WHITE);assert.equal(ui.requests.length,0);
 }finally{ui.view.destroy();}
});

test('a repeated chat generation gets the next unused seed instead of redrawing the same image',async()=>{
 const ui=await mounted();try{
  await type(ui,'검은 머리 고양이귀 캐릭터를 그려줘');await ui.doc.getElementById('pkPromptForm').requestSubmit();const first=ui.ipc.calls.send[0],seed=first.automatic.generation.settings.seed;await ownJob(ui,'repeat-source',first,'generate');
  ui.ipc.resolveResult=async()=>({imageDataUrl:RED,label:'생성 후보',request:automaticRequest(ui,'generate'),metrics:{model_calls:1}});
  await ui.ipc.emit({...first,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'repeat-source',resultId:'repeat-source'}});await ui.ipc.emit({...first,type:'turn-completed',payload:{status:'completed'}});
  assert.equal(ui.project().versions.at(-1).request.seed,seed);
  await type(ui,'한 장 더 그려줘');await ui.doc.getElementById('pkPromptForm').requestSubmit();
  assert.equal(ui.ipc.calls.send[1].automatic.generation.settings.seed,seed+1);
 }finally{ui.view.destroy();}
});

test('closed-viewer Korean whole-pose followup completes and links its new candidate without changing source or mask',async()=>{
 const ui=await mounted();try{
  await type(ui,'검은 머리 고양이귀 캐릭터를 그려줘');await ui.doc.getElementById('pkPromptForm').requestSubmit();const first=ui.ipc.calls.send[0];await ownJob(ui,'followup-source',first,'generate');
  ui.ipc.resolveResult=async()=>({imageDataUrl:RED,label:'생성 후보',request:{...automaticRequest(ui,'generate'),prompt:'1girl, solo, cat ears, masterpiece, high score, great score, absurdres'},metrics:{model_calls:1}});
  await ui.ipc.emit({...first,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'followup-source',resultId:'followup-source'}});await ui.ipc.emit({...first,type:'turn-completed',payload:{status:'completed'}});
  const id=ui.studio().getSummary().latestId,before={source:ui.state().sourceDataURL,mask:ui.element('paint').snapshot,sourceId:ui.state().sourceId};
  assert.equal(ui.doc.querySelector('.pc-image-workspace').dataset.pcEditor,'closed');
  await type(ui,'정면을 바라보도록 바꿔줘');await ui.doc.getElementById('pkPromptForm').requestSubmit();const wire=ui.ipc.calls.send[1];
  assert.equal(wire.automatic.target.referenceCandidateId,id);assert.equal(wire.automatic.recompose.ready,true);assert.equal(wire.automatic.edit.ready,false);
  assert.equal(ui.ipc.calls.prepare.length,1);assert.equal(ui.ipc.calls.prepare[0].sourceDataUrl,RED);assert.equal(ui.ipc.calls.prepare[0].maskDataUrl,undefined);
  assert.equal(ui.state().sourceId,before.sourceId);assert.equal(ui.state().sourceDataURL,before.source);assert.equal(ui.element('paint').snapshot,before.mask);
  await ui.ipc.emit({...wire,type:'intent-resolved',payload:{intent:'edit',operation:'recompose'}});
  assert.match(ui.view.controller.getState().notice,/new composition candidate/);
  await ui.ipc.emit({...wire,type:'tool-started',payload:{tool:'pankeki_edit'}});
  await ui.ipc.emit({...wire,type:'tool-completed',payload:{tool:'pankeki_edit',ok:true,jobId:'recompose-result',jobStatus:'queued'}});
  ui.ipc.resolveResult=async()=>({imageDataUrl:WHITE,label:'구도 변경 후보',request:{...plain(wire.automatic.recompose.settings),mode:'img2img',width:64,height:64},metrics:{model_calls:1}});
  await ui.ipc.emit({...wire,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'recompose-result',resultId:'recompose-result'}});
  await ui.ipc.emit({...wire,type:'turn-completed',payload:{status:'completed'}});
  const document=JSON.parse(ui.studio().exportProject()),result=document.versions.at(-1);
  assert.equal(result.parentId,id);assert.equal(result.request.mode,'img2img');assert.equal(document.version,1);
  const completed=ui.view.controller.getState();assert.equal(completed.phase,'done');assert.equal(ui.ipc.calls.cancel.length,0);assert(completed.messages.find(message=>message.requestId===wire.requestId&&message.role==='assistant').candidateIds.includes(result.id));
  assert.equal(ui.state().sourceId,before.sourceId);assert.equal(ui.state().sourceDataURL,before.source);assert.equal(ui.element('paint').snapshot,before.mask);
  await type(ui,'측면을 보도록 바꿔줘');await ui.doc.getElementById('pkPromptForm').requestSubmit();const old=ui.ipc.calls.send.at(-1);
  const basePrompt=document.versions.find(version=>version.id===id).request.prompt;
  assert.ok(basePrompt);assert.equal(wire.automatic.recompose.basePrompt,basePrompt);
  assert.equal(ui.studio().getSummary().latestId,result.id,'the latest candidate, which a closed viewer refers to, is the recompose result');
  assert.equal(old.automatic.target.referenceCandidateId,id,'a second recompose starts from the original, not the previous redraw');
  assert.equal(ui.ipc.calls.prepare.at(-1).sourceDataUrl,RED);assert.equal(old.automatic.recompose.basePrompt,basePrompt);
  await ui.studio().importProject(ui.project('Other project'));const preserved=ui.studio().exportProject();
  await ui.ipc.emit({...old,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'old-recompose',resultId:'old-recompose'}});
  assert.equal(ui.studio().exportProject(),preserved);
 }finally{ui.view.destroy();}
});

test('a viewer selection changed while the reference is staging sends no old image request',async()=>{
 const ui=await mounted();try{
  const project=ui.project('Reference epoch');project.versions.push({...plain(project.versions[0]),id:'other-reference',image:WHITE});await ui.studio().importProject(project);await openImage(ui,'parent');
  const before={project:ui.studio().exportProject(),source:ui.state().sourceDataURL,mask:ui.element('paint').snapshot};let release,entered;
  const waiting=new Promise(resolve=>entered=resolve);ui.ipc.prepareEditContext=input=>{ui.ipc.calls.prepare.push(input);entered();return new Promise(resolve=>release=()=>resolve({...input,sourceId:'reference-only'}));};
  const sending=ui.view.controller.send({text:'정면으로 바꿔줘',intent:'auto'});await waiting;await openImage(ui,'other-reference');release();assert.equal(await sending,false);
  assert.equal(ui.ipc.calls.send.length,0);assert.equal(ui.studio().exportProject(),before.project);assert.equal(ui.state().sourceDataURL,before.source);assert.equal(ui.element('paint').snapshot,before.mask);assert.equal(ui.view.controller.getState().activeRequestId,null);
 }finally{ui.view.destroy();}
});

for(const boundary of ['resolver','decoder'])test(`source-only recompose discards a result after viewer selection changes during ${boundary}`,async()=>{
 const ui=await mounted();try{
  const project=ui.project('Reference result epoch');project.versions.push({...plain(project.versions[0]),id:'other-reference',image:WHITE});await ui.studio().importProject(project);await openImage(ui,'parent');
  const before={project:ui.studio().exportProject(),source:ui.state().sourceDataURL,mask:ui.element('paint').snapshot};
  await ui.view.controller.send({text:'정면을 바라보도록 바꿔줘',intent:'auto'});const ref=ui.ipc.calls.send[0];
  await ui.ipc.emit({...ref,type:'intent-resolved',payload:{intent:'edit',operation:'recompose'}});
  await ui.ipc.emit({...ref,type:'tool-started',payload:{tool:'pankeki_edit'}});await ui.ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_edit',ok:true,jobId:'stale-recompose',jobStatus:'queued'}});
  let release,entered;const waiting=new Promise(resolve=>entered=resolve),resolved={imageDataUrl:WHITE,label:'stale pose',request:{...plain(ref.automatic.recompose.settings),mode:'img2img',width:64,height:64},metrics:{model_calls:1}};
  if(boundary==='resolver')ui.ipc.resolveResult=()=>{entered();return new Promise(resolve=>release=()=>resolve(resolved));};
  else{
   ui.ipc.resolveResult=async()=>resolved;const Original=ui.sandbox.Image;
   ui.sandbox.Image=class extends Original{set src(value){this.width=this.naturalWidth=1;this.height=this.naturalHeight=1;entered();release=()=>this.onload?.();}get src(){return WHITE;}};
  }
  const pending=ui.ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'stale-recompose',resultId:'stale-recompose'}});
  await waiting;await openImage(ui,'other-reference');release();await pending;
  assert.equal(ui.studio().exportProject(),before.project,'stale source-only candidate must not be committed');assert.equal(ui.state().sourceDataURL,before.source);assert.equal(ui.element('paint').snapshot,before.mask);assert.equal(ui.doc.getElementById('workspace').dataset.candidateId,'other-reference');
 }finally{ui.view.destroy();}
});

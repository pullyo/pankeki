'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const file=path.join(__dirname,'test_central_composer.cjs'),text=fs.readFileSync(file,'utf8'),end=text.indexOf("\ntest('home entry moves");
if(end<0)throw Error('Review changed central composer fixture boundary');
const fixture=new Module(file,module);fixture.filename=file;fixture.paths=Module._nodeModulePaths(__dirname);
fixture._compile(text.slice(0,end)+'\nmodule.exports={test,assert,mounted,transport,ProjectStore,type,settle,RED,WHITE};',file);
const {assert,mounted,transport,ProjectStore,type,settle,RED,WHITE}=fixture.exports;
const test=(name,fn)=>require('node:test')(name,{timeout:15000},fn);
async function completeImage(ui,image,job){
 const ref=ui.ipc.calls.send.at(-1);
 ui.ipc.resolveResult=async()=>({imageDataUrl:image,request:{...JSON.parse(JSON.stringify(ui.project().versions[0].request)),...ref.automatic.generation.settings,mode:'txt2img'},metrics:{model_calls:1}});
 await ui.ipc.emit({...ref,type:'intent-resolved',payload:{intent:'generate'}});
 await ui.ipc.emit({...ref,type:'tool-started',payload:{tool:'pankeki_generate'}});
 await ui.ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_generate',ok:true,jobId:job,jobStatus:'queued'}});
 await ui.ipc.emit({...ref,type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:job,resultId:job}});
 await ui.ipc.emit({...ref,type:'turn-completed',payload:{status:'completed'}});await settle();
}
for(const library of [false,true])test(`home request shows its new conversation instead of the old selected image, library=${library}`,async()=>{
 const ui=await mounted(transport(),library?{projectStore:new ProjectStore()}:{});
 try{
  if(library)assert.equal(await ui.workspace.projects.openGeneration(),true);
  await type(ui,'이전 이미지 생성');await ui.doc.getElementById('pkPromptForm').requestSubmit();await completeImage(ui,RED,'old-image');
  const old=ui.state().project.versions.at(-1);
  await ui.doc.querySelector(`.pc-turn[data-candidate-id="${old.id}"] [data-pc-action="edit"]`).click();await settle();
  ui.element('paint').snapshot=WHITE;ui.element('paint').context.getImageData=()=>({data:new Uint8ClampedArray([255,255,255,255])});
  const before=ui.studio().exportProject(),source=ui.state().sourceDataURL,mask=ui.element('paint').snapshot;
  await ui.doc.querySelector(`.pc-turn[data-candidate-id="${old.id}"] .pc-image-open`).click();
  assert.equal(ui.doc.body.classList.contains('pc-reference-open'),true);
  ui.workspace.go('home');await type(ui,'노란 우비를 입은 새 캐릭터를 그려줘');
  await ui.doc.getElementById('pkPromptForm').requestSubmit();await settle();
  assert.equal(ui.ipc.calls.send.length,2,'one new home request is sent');
  assert.equal(ui.doc.querySelector('.pc-image-workspace').dataset.pcPane,'conversation','new request must be visible even with an old selected canvas');
  assert.equal(ui.doc.body.classList.contains('pc-reference-open'),false,'previous editor must not cover the new request');
  assert.equal(ui.studio().exportProject(),before,'hiding the old editor must not discard saved work');
  assert.equal(ui.state().sourceDataURL,source);assert.equal(ui.element('paint').snapshot,mask);
  await completeImage(ui,WHITE,'new-image');
  const latest=ui.state().project.versions.at(-1);assert.notEqual(latest.id,old.id);assert.equal(latest.image,WHITE);
  assert.equal(ui.doc.body.classList.contains('pc-reference-open'),false,'completed new result stays in the visible conversation');
  ui.workspace.go('inpaint');
  assert.equal(ui.doc.body.classList.contains('pc-reference-open'),true,'explicit edit navigation restores the preserved editor');
  await ui.doc.querySelector(`.pc-turn[data-candidate-id="${latest.id}"] .pc-image-open`).click();
  assert.equal(ui.doc.getElementById('pcViewerImage').src,WHITE);
  assert.equal(ui.doc.body.classList.contains('pc-reference-open'),true,'explicit image selection opens that new result');
 }finally{ui.view.destroy();}
});

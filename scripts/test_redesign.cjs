'use strict';
const {readFileSync,existsSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const filename = path.join(__dirname,'test_ui_state.cjs');
const source = readFileSync(filename,'utf8');
const boundary = source.indexOf("\ntest('selected model preset reaches");
if (boundary < 0) throw Error('Review changed UI harness boundary');
const harness = new Module(filename,module); harness.filename=filename; harness.paths=module.paths;
harness._compile(source.slice(0,boundary)+'\nmodule.exports={test,assert,page,settle,until,RED};',filename);
const {test,assert,page,until,RED}=harness.exports;
function redesign(ui) {
  const filename=path.join(__dirname,'../web/src/redesign.js');
  assert(existsSync(filename),'The reference-design composer is not implemented yet');
  vm.runInContext(readFileSync(filename,'utf8'),ui.sandbox,{filename});
  return ui.sandbox.PankekiRedesign;
}
test('the new composer sends the selected background style through the actual generation boundary without resetting saved candidates',async()=>{
  const ui=page({autoJobs:true}); const api=redesign(ui);
  await ui.studio().importProject(ui.project('Keep this project'));
  ui.element('useBrief').checked=false; ui.element('candidateCount').value='1';
  ui.element('prompt').value='A sunlit room with plants';
  const oldId=ui.state().project.versions[0].id;
  await api.submitPrompt(ui.studio(),ui.element('prompt'),'background');
  assert.equal(ui.requests.length,1);
  assert.match(ui.requests[0].body.request.prompt,/A sunlit room with plants/);
  assert.match(ui.requests[0].body.request.prompt,/environment/);
  assert.equal(ui.state().project.versions[0].id,oldId);
  assert.equal(ui.state().project.versions.length,2);
});
test('an empty new composer is rejected before a model job is created',async()=>{
  const ui=page({autoJobs:true}); const api=redesign(ui);
  ui.element('prompt').value='   ';
  await assert.rejects(()=>api.submitPrompt(ui.studio(),ui.element('prompt'),'character'),/설명/);
  assert.equal(ui.requests.length,0);
});
test('the new composer keeps the original and painted mask when submitting a partial edit',async()=>{
  const ui=page({autoJobs:true}); const api=redesign(ui);
  await ui.studio().importProject(ui.project('Keep mask'));
  await until(()=>ui.studio().getSummary().modelsReady,'model catalog');
  ui.studio().setMode('inpaint'); ui.studio().setImageModelSettings({editModelId:'sd-turbo'}); ui.element('candidateCount').value='1';
  ui.element('prompt').value='A red scarf';
  const mask=ui.element('paint').toDataURL();
  await api.submitPrompt(ui.studio(),ui.element('prompt'),'character');
  assert.equal(ui.requests[0].body.request.mode,'inpaint');
  assert.equal(ui.requests[0].body.request.source,RED);
  assert.equal(ui.requests[0].body.request.mask,mask);
});
test('conversation presentation reflects saved uploads and real generation without changing the document',async()=>{
  const ui=page({autoJobs:true});const api=redesign(ui);
  const original=ui.project('A real reference');original.versions[0].kind='upload';
  await ui.studio().importProject(original);
  ui.element('useBrief').checked=false;ui.element('candidateCount').value='1';
  ui.element('prompt').value='A sunlit room with plants';
  await api.submitPrompt(ui.studio(),ui.element('prompt'),'background');
  const saved=ui.studio().exportProject(),project=JSON.parse(saved);
  const entries=api.conversationEntries(project);
  assert.deepEqual(Array.from(entries,item=>item.kind),['upload','generated']);
  assert.equal(entries[0].prompt,'');
  assert.equal(entries[1].prompt,'A sunlit room with plants');
  assert.equal(entries[1].image,project.versions[1].image);
  assert.equal(entries[1].id,project.versions[1].id);
  assert.equal(JSON.stringify(project),saved);
  assert.equal(ui.studio().exportProject(),saved);
});
test('conversation presentation invents no messages for an empty saved project',()=>{
  const ui=page({autoJobs:true});const api=redesign(ui);
  const project=JSON.parse(ui.studio().exportProject());
  assert.equal(api.conversationEntries(project).length,0);
  assert.equal(ui.requests.length,0);
});
test('derived photo results show their real operation and output size without inventing a generation request or user prompt',()=>{
  const ui=page(),api=redesign(ui),project=ui.project('Photo source');
  project.versions.push({...project.versions[0],id:'resized',kind:'derived',request:null,derivation:{operation:'resize',outputWidth:640,outputHeight:960},label:'크기 조정 결과'});
  const before=JSON.stringify(project),entries=api.conversationEntries(project),result=entries[1];
  assert.equal(result.id,'resized');assert.equal(result.operation,'resize');assert.equal(result.operationLabel,'크기 조정');assert.equal(result.model,'');assert.equal(result.width,640);assert.equal(result.height,960);assert.equal(result.prompt,'');assert.equal(JSON.stringify(project),before);
});

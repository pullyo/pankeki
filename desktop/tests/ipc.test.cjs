'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createIpcController} = require('../ipc.cjs');

function setup({allowLiveSend=true}={}) {
  let state='ready', activeRequestId=null;
  const output=[];
  const bridge={status:()=>({state,codexVersion:'0.164.0',authMode:'chatgpt',toolsReady:true,activeRequestId,lastError:null,secret:'private'}),
    connect:async()=>bridge.status(),send:async payload=>{state='busy';activeRequestId=payload.requestId;return {requestId:payload.requestId};},
    cancel:async({requestId})=>requestId===activeRequestId,close:async()=>{}};
  const controller=createIpcController({bridge,getAppStatus:()=>({version:'0.1.0',externalRuntimeRequired:true}),
    isTrusted:event=>event===true,sendEvent:event=>output.push(event),allowLiveSend,
    contexts:{resolve:()=>({sourceId:'source_1',sourceRevision:'snapshot_3'}),prepare:async value=>({projectId:value.projectId,sourceRevision:value.sourceRevision,sourceId:'source_1'})}});
  return {controller,output,bridge};
}
const message={text:'안녕하세요',projectId:'project_1',requestId:'req_1',context:{sourceRevision:'snapshot_3'}};

test('automatic IPC accepts only bounded snapshots paired with the header and sanitizes resolved intent events',async()=>{
  const {controller,output}=setup(),automatic=require('./automatic-fixture.cjs')();automatic.target.sourceRevision='snapshot_3';
  await controller.invoke('sendMessage',true,{...message,text:'[Pankeki action: auto]\n그려줘',automatic});
  controller.acceptEvent({...message,type:'intent-resolved',payload:{intent:'generate',secret:'hidden'}});
  assert.deepEqual(output[0],{requestId:'req_1',projectId:'project_1',type:'intent-resolved',payload:{intent:'generate'},context:{sourceRevision:'snapshot_3'}});
  controller.acceptEvent({...message,type:'needs-input',payload:{reason:'target'}});assert.equal(output[1].payload.reason,'target');
  for(const payload of [{intent:'other'},{intent:'edit'},{intent:'chat',operation:'recolor'}])controller.acceptEvent({...message,type:'intent-resolved',payload});
  assert.equal(output.length,2);
});
test('automatic IPC refuses forged consent, mismatched revisions and unstaged ready edit assets',async()=>{
  for(const change of [v=>delete v.automatic,v=>v.text='[Pankeki action: chat]\ntext',v=>v.automatic.target.sourceRevision='other',v=>v.automatic.consent=true,v=>v.automatic=require('./automatic-fixture.cjs')({editReady:true})]){
    const {controller}=setup(),automatic=require('./automatic-fixture.cjs')();automatic.target.sourceRevision='snapshot_3';
    const value={...message,text:'[Pankeki action: auto]\ntext',automatic};change(value);await assert.rejects(controller.invoke('sendMessage',true,value),/invalid-input/);
  }
});

test('chat model IPC rejects extra keys paths and untrusted callers and sanitizes catalog metadata', async () => {
  const {controller, bridge} = setup();
  bridge.getChatModelOptions = async ({provider}) => ({provider, selectedModelId: 'default', modelRevision: 2, state: 'ready', cliVersion: '0.164.0', source: 'codex-model-list', availability: 'available',
    options: [{id: 'picker-a', displayName: 'Model A', model: 'wire-secret', account: 'private'}, {id: '/tmp/a', displayName: 'bad'}], secret: 'private'});
  for (const value of [{provider: 'other'}, {provider: 'codex', url: 'https://evil'}, {provider: 'codex', modelId: '/tmp/a'}]) {
    await assert.rejects(controller.invoke('getChatModelOptions', true, value), /invalid-input/);
  }
  await assert.rejects(controller.invoke('getChatModelOptions', false, {provider: 'codex'}), /untrusted/);
  const result = await controller.invoke('getChatModelOptions', true, {provider: 'codex'});
  assert.deepEqual(result.options, [{id: 'picker-a', displayName: 'Model A'}]);
  assert.equal(result.availability, 'unverified'); assert.equal(result.secret, undefined);
  await assert.rejects(controller.invoke('setChatModel', true, {provider: 'codex', modelId: '../escape'}), /invalid-input/);
});

test('chat model IPC locks mutation against sends provider changes and concurrent mutation', async () => {
  const {controller, bridge} = setup(); let release;
  bridge.setChatModel = () => new Promise(resolve => { release = () => resolve({provider: 'codex', selectedModelId: 'picker', modelRevision: 1, conversationReset: true}); });
  bridge.select = () => bridge.status();
  const pending = controller.invoke('setChatModel', true, {provider: 'codex', modelId: 'picker'});
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(controller.invoke('sendMessage', true, message), /busy/);
  await assert.rejects(controller.invoke('selectProvider', true, {provider: 'claude'}), /busy/);
  await assert.rejects(controller.invoke('setChatModel', true, {provider: 'codex', modelId: 'picker'}), /busy/);
  release(); assert.equal((await pending).conversationReset, true);
});

test('provider busy errors from an in-progress native catalog are preserved at the IPC boundary', async () => {
  const {controller, bridge} = setup();
  bridge.select = () => { throw Object.assign(new Error('busy'), {code: 'busy'}); };
  await assert.rejects(controller.invoke('selectProvider', true, {provider: 'claude'}), {code: 'busy'});
});

test('untrusted sender is rejected before privileged calls',async()=>{
  const {controller}=setup(); await assert.rejects(controller.invoke('getStatus',false),/untrusted/);
});
test('getStatus preserves confirmed states and removes extra bridge fields',async()=>{
  const {controller}=setup();const result=await controller.invoke('getStatus',true);
  assert.equal(result.codex.state,'ready');assert.equal('secret' in result.codex,false);
});
test('paths, prototype objects, excessive text and malformed revisions are rejected',async()=>{
  for (const patch of [{context:{sourcePath:'/tmp/a.png'}},{projectId:'../escape'},{text:'x'.repeat(8001)},
    {context:{sourceRevision:-1}},{context:{sourceRevision:3}},{context:{sourceRevision:'snapshot_3',maskId:'m'}}]) {
    const {controller}=setup();await assert.rejects(controller.invoke('sendMessage',true,{...message,...patch}),/invalid-input/);
  }
});
test('real send stays blocked until reviewed ID-only bridge is explicitly enabled',async()=>{
  const {controller}=setup({allowLiveSend:false});await assert.rejects(controller.invoke('sendMessage',true,message),/bridge-pending/);
});
test('concurrent send and stale cancellation cannot affect the active request',async()=>{
  const {controller}=setup();assert.deepEqual(await controller.invoke('sendMessage',true,message),{requestId:'req_1'});
  assert.deepEqual(await controller.invoke('cancelMessage',true,{requestId:'old'}),{requestId:'old',canceled:false});
  await assert.rejects(controller.invoke('sendMessage',true,{...message,requestId:'req_2'}),/busy/);
  assert.deepEqual(await controller.invoke('cancelMessage',true,{requestId:'req_1'}),{requestId:'req_1',canceled:true});
});
test('events retain accepted revision and drop mismatched projects or unsafe preview URLs',async()=>{
  const {controller,output}=setup();await controller.invoke('sendMessage',true,message);
  controller.acceptEvent({requestId:'req_1',projectId:'another',type:'message',payload:{text:'wrong'}});
  assert.equal(output.length,0);
  controller.acceptEvent({requestId:'req_1',projectId:'project_1',type:'tool-completed',payload:{tool:'pankeki_result',ok:true,previewUrl:'https://evil.test/image',jobId:'abc',token:'secret'}});
  assert.deepEqual(output[0],{requestId:'req_1',projectId:'project_1',type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobId:'abc'},context:{sourceRevision:'snapshot_3'}});
  controller.acceptEvent({requestId:'req_1',projectId:'project_1',type:'message',payload:{text:'image ready'}});
  assert.equal(output[1].payload.text,'image ready');
});
test('turn completion and failed tool retrieval cannot expose an image result',async()=>{
  const {controller,output}=setup();await controller.invoke('sendMessage',true,message);
  controller.acceptEvent({requestId:'req_1',projectId:'project_1',type:'tool-completed',payload:{tool:'pankeki_result',ok:false,jobStatus:'failed',resultId:'a'.repeat(32),previewUrl:'http://127.0.0.1:8190/api/results/'+ 'a'.repeat(32)}});
  assert.equal(output[0].payload.jobStatus,'failed');assert.equal(output[0].payload.resultId,undefined);
  controller.acceptEvent({requestId:'req_1',projectId:'project_1',type:'tool-completed',payload:{tool:'pankeki_result',ok:true,jobStatus:'succeeded',resultId:'b'.repeat(32),previewUrl:'https://evil.test'}});
  assert.equal(output[1].payload.previewUrl,'http://127.0.0.1:8190/api/results/'+ 'b'.repeat(32));
});
test('resolveResult rejects arbitrary URLs and stays gated without registered actual request metadata',async()=>{
  const {controller}=setup();await controller.invoke('sendMessage',true,message);
  const value={requestId:'req_1',projectId:'project_1',sourceRevision:'snapshot_3',jobId:'a'.repeat(32),resultId:'a'.repeat(32)};
  await assert.rejects(controller.invoke('resolveResult',true,{...value,url:'https://evil.test'}),/invalid-input/);
  await assert.rejects(controller.invoke('resolveResult',true,value),/result-metadata-pending/);
});
test('selectProvider switches only between known providers and never during a request',async()=>{
  const {controller,bridge}=setup();let provider='codex';
  bridge.select=({provider:next})=>{provider=next;return {...bridge.status(),provider:next,version:'2.1.310',authMode:'claude'};};
  const status=await controller.invoke('selectProvider',true,{provider:'claude'});
  assert.equal(status.provider,'claude');assert.equal(status.authMode,'claude');assert.equal(status.codexVersion,'0.164.0');
  await assert.rejects(controller.invoke('selectProvider',true,{provider:'gpt'}),/invalid-input/);
  await assert.rejects(controller.invoke('selectProvider',true,{provider:'claude',extra:1}),/invalid-input/);
  await controller.invoke('sendMessage',true,message);
  await assert.rejects(controller.invoke('selectProvider',true,{provider:'codex'}),/busy/);
  assert.equal(provider,'claude');
});

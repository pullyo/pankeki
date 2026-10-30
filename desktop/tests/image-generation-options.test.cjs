'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const tools=require('../pankeki-tools.cjs');
const snapshot=()=>({mode:'txt2img',model_id:'animagine-xl-4.0-opt',prompt:'원본은 덮어쓰지 않음',negative:'custom negative',seed:42,width:1024,height:1024,steps:28,cfg:5,sampler:'euler_ancestral',scheduler:'normal',cache:false,preview:false,roi:false,denoise:1,halo:32,feather:4,preview_interval:.2});
const message=(s=snapshot(),action='generate',body='user text')=>'[Pankeki action: '+action+']\n[Pankeki settings: '+JSON.stringify(s)+']\n'+body;
test('Animagine native generation schemas add only bounded sampler fields and preserve the six-tool edit boundary',()=>{
  const native=require('../codex-bridge.cjs').createCodexBridge({projectRoot:require('node:path').resolve(__dirname,'../..'),onEvent(){}})._debug.tools;
  for(const schema of [tools.TOOLS,native]){
    assert.equal(Object.keys(schema).length,6);
    assert.ok(schema.pankeki_generate.inputSchema.properties.model_id.enum.includes('animagine-xl-4.0-opt'));
    assert.deepEqual(schema.pankeki_generate.inputSchema.properties.sampler.enum,['euler','euler_ancestral','dpmpp_2m']);
    assert.deepEqual(schema.pankeki_generate.inputSchema.properties.scheduler.enum,['normal','simple','karras']);
    assert.ok(schema.pankeki_edit.inputSchema.properties.model_id.enum.includes('animagine-xl-4.0-opt'));assert.ok(schema.pankeki_edit.inputSchema.properties.operation.enum.includes('recompose'),'Animagine model identity is exposed only alongside the distinct recompose operation; masked execution is checked below');
    assert.equal(schema.pankeki_edit.inputSchema.properties.sampler,undefined);
  }
});
test('Animagine snapshot pins validated settings without pinning the translated positive prompt or accepting body headers',()=>{
  const source=snapshot(),settings=tools.generationSettingsFromMessage(message(source));
  assert.equal(settings.model_id,'animagine-xl-4.0-opt');assert.equal(settings.steps,28);assert.equal(settings.negative,'custom negative');assert.equal(settings.sampler,'euler_ancestral');
  assert.equal(settings.prompt,undefined);assert.ok(Object.isFrozen(settings));source.steps=99;assert.equal(settings.steps,28);
  assert.equal(tools.generationSettingsFromMessage(message({...snapshot(),model_id:'sdxl-base'})),null);
  assert.equal(tools.generationSettingsFromMessage(message(snapshot(),'chat',message())),null);
  assert.equal(tools.generationSettingsFromMessage('ordinary user text\n'+message()),null);
  const parsed=tools.generationSettingsFromMessage(message(snapshot(),'generate',message({...snapshot(),seed:9})));
  assert.equal(parsed.seed,42);
  for(const patch of [{steps:0},{seed:true},{cfg:Infinity},{sampler:'command'},{scheduler:'https://evil'},{mode:'inpaint'},{negative:'data:image/png;base64,x'},{unknown:1},{negative:'x'.repeat(4001)},{prompt:'/Users/private/file'},{prompt:'/etc/passwd'},{negative:'ftp://private/file'},{prompt:'../image.png'},{prompt:'C:\\models\\private.png'},{source:'/tmp/a'}]){
    assert.throws(()=>tools.generationSettingsFromMessage(message({...snapshot(),...patch})),/settings|snapshot|input/i);
  }
  assert.throws(()=>tools.generationSettingsFromMessage(message(snapshot())+'x'.repeat(8000)),/settings|snapshot|input/i);
  assert.throws(()=>tools.generationSettingsFromMessage(message(snapshot()).replace('}]','} garbage]')),/settings|snapshot|input/i);
});
test('Animagine edit and unbounded generation samplers are rejected before any adapter spawn',async()=>{
  let spawns=0;
  const runner=tools.createToolRunner({projectRoot:__dirname,paths:{},limits:{},emit(){},current:()=>true,spawnImpl(){spawns++;throw Error('must not spawn');}});
  for(const operation of ['regenerate','recolor'])await assert.rejects(runner.runTool({action:'edit'},'pankeki_edit',{operation,model_id:'animagine-xl-4.0-opt',target_color:'#FF0000'}),/generation-only/);
  for(const args of [{sampler:'arbitrary-command'},{scheduler:'https://evil'}])await assert.rejects(runner.runTool({action:'generate'},'pankeki_generate',{prompt:'one girl',...args}),/sampler\/scheduler/);
  assert.equal(spawns,0);await runner.close();
});

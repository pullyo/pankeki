'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const policy=require('../pankeki-tools.cjs'),fixture=require('./automatic-fixture.cjs');
test('automatic scalar capabilities reject unbounded or forged data and freeze independent snapshots',()=>{
  const original=fixture(),value=policy.validateAutomaticContext(original);assert(Object.isFrozen(value));assert(Object.isFrozen(value.generation.settings));
  original.generation.settings.steps=99;assert.equal(value.generation.settings.steps,19);assert.equal(value.generation.settings.prompt,undefined);
  for(const change of [v=>v.consent=true,v=>v.target.visibleCandidateId='/tmp/source',v=>v.generation.settings.source='data:image/png;base64,x',v=>v.generation.settings.model_id='unknown',v=>v.generation.settings.width=513,v=>v.generation.settings.seed=true,v=>v.generation.settings.negative='x'.repeat(4001),v=>v.edit={ready:true,settings:fixture({editReady:true}).edit.settings},v=>v.generationStyle={id:'unknown',prompt:'style'}]){
    const invalid=fixture();change(invalid);assert.throws(()=>policy.validateAutomaticContext(invalid),/automatic|snapshot|input/i);
  }
});
test('automatic submission reserves synchronously once, consumes an unforgeable call permit once, and binds all generation models',()=>{
  for(const modelId of ['sdxl-base','sd-turbo','animagine-xl-4.0-opt']){
    const events=[],ref={automatic:policy.validateAutomaticContext(fixture({modelId})),action:'chat'};
    const permit=policy.reserveAutomaticSubmission(ref,'pankeki_generate',{prompt:'translated'},(type,payload)=>events.push({type,payload}));
    assert.equal(ref.action,'generate');assert.equal(events[0].type,'intent-resolved');
    assert.throws(()=>policy.reserveAutomaticSubmission(ref,'pankeki_edit',{operation:'regenerate'},()=>{}),/one|scope|operation/i);
    assert.throws(()=>policy.consumeAutomaticSubmission(ref,'pankeki_generate',{}),/permit|scope/i);
    policy.consumeAutomaticSubmission(ref,'pankeki_generate',permit);assert.throws(()=>policy.consumeAutomaticSubmission(ref,'pankeki_generate',permit),/one|scope|operation/i);
    const bound=policy.bindAutomaticSettings(ref,'pankeki_generate',{prompt:'translated',model_id:'sd-turbo',seed:9,width:512});
    assert.equal(bound.model_id,modelId);assert.equal(bound.seed,42);assert.equal(bound.width,832);assert.equal(bound.prompt,'translated');
  }
  const ref={action:'generate'};assert.equal(policy.reserveAutomaticSubmission(ref,'pankeki_generate',{},()=>{}),undefined);
  policy.consumeAutomaticSubmission(ref,'pankeki_generate');policy.consumeAutomaticSubmission(ref,'pankeki_generate');
});
test('unready edit is an intent with no executable capability and cannot fall back to another operation',()=>{
  for(const reason of ['source','mask','target','capability']){
    const ref={automatic:policy.validateAutomaticContext(fixture({editReason:reason})),action:'chat'},events=[];
    assert.throws(()=>policy.reserveAutomaticSubmission(ref,'pankeki_edit',{operation:'regenerate'},(type,payload)=>events.push({type,payload})),/source|mask|target|capability|ready|prepare/i);
    assert.equal(events[0].type,'intent-resolved');assert.deepEqual(events[1],{type:'needs-input',payload:{reason}});
    assert.throws(()=>policy.reserveAutomaticSubmission(ref,'pankeki_generate',{prompt:'fallback'},()=>{}),/one|scope|operation/i);
  }
});
test('automatic regenerate binds only the edit model settings while recolor stays on its existing CPU path',()=>{
  const ref={automatic:policy.validateAutomaticContext(fixture({editReady:true})),action:'edit'};
  const edit=policy.bindAutomaticSettings(ref,'pankeki_edit',{operation:'regenerate',model_id:'sdxl-base',seed:7,prompt:'scarf'});
  assert.equal(edit.model_id,'sdxl-inpaint-v01');assert.equal(edit.seed,31);assert.equal(edit.denoise,.75);assert.equal(edit.prompt,'scarf');
  const recolor=policy.bindAutomaticSettings(ref,'pankeki_edit',{operation:'recolor',model_id:'sdxl-inpaint-v01',target_color:'#FF0000'});
  assert.equal(recolor.model_id,undefined);assert.equal(recolor.target_color,'#FF0000');assert.equal(recolor.feather,4);
});
test('automatic recolor needs no regenerate model but still binds the selected mask feather',()=>{
  const events=[],ref={automatic:policy.validateAutomaticContext(fixture({editReady:true,regenerateReady:false})),action:'chat'};
  const permit=policy.reserveAutomaticSubmission(ref,'pankeki_edit',{operation:'recolor'},(type,payload)=>events.push({type,payload}));
  policy.consumeAutomaticSubmission(ref,'pankeki_edit',permit);
  assert.deepEqual(policy.bindAutomaticSettings(ref,'pankeki_edit',{operation:'recolor',target_color:'#FF0000',feather:64}),{operation:'recolor',target_color:'#FF0000',feather:4});
  assert.equal(events[0].payload.operation,'recolor');
  const regenerate={automatic:ref.automatic,action:'chat'};
  assert.throws(()=>policy.reserveAutomaticSubmission(regenerate,'pankeki_edit',{operation:'regenerate'},()=>{}),/model|ready|prepare/i);
  assert.equal(regenerate.autoConsumed,undefined);
});
test('an automatic submission permit cannot change its reserved tool or edit operation',()=>{
  const ref={automatic:policy.validateAutomaticContext(fixture({editReady:true,regenerateReady:false})),action:'chat'};
  const permit=policy.reserveAutomaticSubmission(ref,'pankeki_edit',{operation:'recolor'},()=>{});
  assert.throws(()=>policy.consumeAutomaticSubmission(ref,'pankeki_generate',permit),/scope|reserved|permit/i);
  policy.consumeAutomaticSubmission(ref,'pankeki_edit',permit);
  assert.throws(()=>policy.bindAutomaticSettings(ref,'pankeki_edit',{operation:'regenerate',prompt:'different operation'}),/scope|operation/i);
});

test('source-only recompose binds an immutable generation checkpoint and cannot grant a masked edit',()=>{
 const value=fixture({editReason:'source'});value.target.referenceCandidateId='recent';value.recompose={ready:true,settings:{model_id:'animagine-xl-4.0-opt',negative:'keep',seed:3,steps:20,cfg:5,denoise:.55,sampler:'euler',scheduler:'normal',cache:false,preview:true}};
 const automatic=policy.validateAutomaticContext(value),ref={automatic,action:'chat'},events=[];
 const permit=policy.reserveAutomaticSubmission(ref,'pankeki_edit',{operation:'recompose',prompt:'front view'},(type,payload)=>events.push({type,payload}));
 policy.consumeAutomaticSubmission(ref,'pankeki_edit',permit);const bound=policy.bindAutomaticSettings(ref,'pankeki_edit',{operation:'recompose',model_id:'sdxl-inpaint-v01',denoise:1,prompt:'front view'});
 assert.equal(bound.model_id,'animagine-xl-4.0-opt');assert.equal(bound.denoise,.55);assert.equal(bound.negative,'keep');assert.equal(events[0].payload.operation,'recompose');
 const masked={automatic,action:'chat'};assert.throws(()=>policy.reserveAutomaticSubmission(masked,'pankeki_edit',{operation:'regenerate'},()=>{}),/source|prepare/i);
 for(const denoise of [0,1]){const invalid=structuredClone(value);invalid.recompose.settings.denoise=denoise;assert.throws(()=>policy.validateAutomaticContext(invalid),/snapshot/i);}
});
test('Animagine recompose keeps the source prompt subject tags and ends with the quality tags exactly once',()=>{
  const base='1girl, solo, cat ears, red scarf, masterpiece, high score, great score, absurdres';
  assert.equal(policy.recomposePrompt('face turned to the right, head turned toward the right side of the frame',base,'animagine-xl-4.0-opt'),
    '1girl, solo, face turned to the right, head turned toward the right side of the frame, masterpiece, high score, great score, absurdres');
  assert.equal(policy.recomposePrompt('1girl, solo, cat ears, masterpiece, profile view, high score',base,'animagine-xl-4.0-opt'),
    '1girl, solo, cat ears, profile view, masterpiece, high score, great score, absurdres');
  assert.equal(policy.recomposePrompt('turn the head to the right',base,'sdxl-base'),'turn the head to the right','other models keep the model prompt');
  const value=fixture({modelId:'animagine-xl-4.0-opt'});
  value.target.referenceCandidateId='candidate-A';
  value.recompose={ready:true,basePrompt:base,settings:{model_id:'animagine-xl-4.0-opt',negative:'user negative',seed:42,steps:28,cfg:5,denoise:.55,sampler:'euler_ancestral',scheduler:'normal',cache:false,preview:false}};
  const checked=policy.validateAutomaticContext(value);assert.equal(checked.recompose.basePrompt,base);
  assert.match(policy.automaticNote(checked),/redraws the original image of this candidate line, made with this prompt: "1girl, solo, cat ears, red scarf/);
  assert.doesNotMatch(policy.automaticNote(checked),/You have not seen image pixels\./);
  const bound=policy.bindAutomaticSettings({automatic:checked},'pankeki_edit',{operation:'recompose',prompt:'looking to the right'});
  assert.equal(bound.prompt,'1girl, solo, looking to the right, masterpiece, high score, great score, absurdres');assert.equal(bound.denoise,.55);
  for(const forged of [1,'x'.repeat(2001)]){const invalid=structuredClone(value);invalid.recompose.basePrompt=forged;assert.throws(()=>policy.validateAutomaticContext(invalid));}
});

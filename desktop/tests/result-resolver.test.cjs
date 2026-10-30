'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {createResultResolver}=require('../result-resolver.cjs');
const Design=require('../../web/src/profiles.js');
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
const value={requestId:'req1',projectId:'p1',sourceRevision:'source_mask_p1',jobId:'a'.repeat(32),resultId:'a'.repeat(32)};
function setup(change={}){
  const calls=[];const desc={...value,state:'succeeded',request:{mode:'txt2img',prompt:'real prompt',model_id:'sdxl-base',seed:1,cache:false,preview:false},metrics:{width:1},...change};
  const bridge={getResultDescriptor:()=>desc,getSubmittedRequest:()=>({requestId:'req1',request:desc.request})};
  const resolver=createResultResolver({bridge,origin:'http://127.0.0.1:8190',verifyBackend:async()=>true,decode:()=>({width:1,height:1}),
    fetchImpl:async(url,options)=>{calls.push({url,options});return url.includes('/api/jobs/')?new Response(JSON.stringify({job_id:value.jobId,state:'succeeded',is_current:true,result:{image_url:'/api/results/'+value.resultId,metrics:{width:1}}})):
      new Response(Buffer.from([137,80,78,71,13,10,26,10,1]),{headers:{'content-type':'image/png'}});}});
  return {resolver,calls};
}
test('result retrieval requires the exact request identity from actual bridge ledger',async()=>{
  const {resolver,calls}=setup({requestId:'another'});await assert.rejects(resolver.resolveResult(value),/unregistered-result/);assert.equal(calls.length,0);
});
test('registered success fetches only exact local endpoints without following redirects',async()=>{
  const {resolver,calls}=setup();const result=await resolver.resolveResult(value);
  assert.equal(result.request.prompt,'real prompt');assert.equal(result.imageDataUrl.startsWith('data:image/png;base64,'),true);
  assert.deepEqual(calls.map(x=>x.url),['http://127.0.0.1:8190/api/jobs/'+value.jobId,'http://127.0.0.1:8190/api/results/'+value.resultId]);
  assert.equal(calls.every(x=>x.options.redirect==='error'),true);assert.equal(result.request.source_path,undefined);
});
test('invented request metadata and local paths cannot be returned as a real result',async()=>{
  const {resolver}=setup({request:{mode:'edit',source_path:'/private/secret.png'}});
  await assert.rejects(resolver.resolveResult(value),/unsafe-request/);
});
test('actual MCP txt2img, inpaint and recolor request shapes survive the real document validator',async()=>{
  const common={prompt:'cat girl',negative:'',model_id:'sdxl-base',seed:7,steps:25,cfg:6,sampler:'dpmpp_2m',scheduler:'karras',cache:false,preview:false};
  const actual=[{...common,mode:'txt2img',width:1024,height:1024},
    {...common,mode:'inpaint',edit_operation:'regenerate',denoise:.55,roi:false,halo:32,feather:4},
    {...common,model_id:'sdxl-inpaint-v01',mode:'inpaint',edit_operation:'regenerate',denoise:.55,roi:false,halo:32,feather:4},
    {mode:'inpaint',edit_operation:'recolor',target_color:'#FFAA00',source_color:null,color_tolerance:35,feather:4,cache:false,preview:false}];
  for(const request of actual){
    const {resolver}=setup({request});const output=await resolver.resolveResult(value);
    const brief=Design.sanitizeBrief({});
    const document=Design.createProject(brief,[{id:'result',createdAt:'2026-10-24T00:00:00.000Z',label:'actual metadata',image,kind:'generated',brief,request:output.request,parentId:null,metrics:{}}],[]);
    assert.equal(document.versions[0].request.mode,request.mode);
    if(request.edit_operation==='recolor')assert.equal(document.versions[0].request.source_color,null);
    else assert.equal(document.versions[0].request.cache,false);
    const restored=Design.parseProject(JSON.stringify(document));
    assert.equal(restored.versions[0].request.model_id,document.versions[0].request.model_id);
  }
});
test('dedicated inpaint ID is never accepted for generation or replaced with Base',async()=>{
  for(const request of [{mode:'txt2img',model_id:'sdxl-inpaint-v01'},{mode:'inpaint',model_id:'uninstalled-model'}]){
    const {resolver}=setup({request});await assert.rejects(resolver.resolveResult(value),/unsafe-request/);
  }
});
test('Animagine result resolves and round trips only as txt2img with its actual model identity',async()=>{
  const request={mode:'txt2img',model_id:'animagine-xl-4.0-opt',prompt:'1girl, red scarf',negative:'custom',seed:42,steps:28,cfg:5,sampler:'euler_ancestral',scheduler:'normal'};
  const {resolver}=setup({request});const output=await resolver.resolveResult(value);
  const brief=Design.sanitizeBrief({}),document=Design.createProject(brief,[{id:'animagine',createdAt:'2026-10-25T00:00:00.000Z',label:'Animagine',image,kind:'generated',brief,request:output.request,parentId:null,metrics:{}}],[]);
  assert.equal(Design.parseProject(JSON.stringify(document)).versions[0].request.model_id,'animagine-xl-4.0-opt');
  for(const operation of ['regenerate','recolor'])await assert.rejects(setup({request:{...request,mode:'inpaint',edit_operation:operation}}).resolver.resolveResult(value),/unsafe-request/);
});

test('source-conditioned img2img results preserve their honest mode and reject total noise and masked models',async()=>{
 for(const model_id of ['sdxl-base','animagine-xl-4.0-opt']){
  const request={mode:'img2img',model_id,prompt:'front view',negative:'keep',seed:7,steps:20,cfg:5,denoise:.55,width:64,height:64,sampler:'euler',scheduler:'normal',cache:false,preview:false};
  const {resolver}=setup({request});const result=await resolver.resolveResult(value);assert.equal(result.request.mode,'img2img');assert.equal(result.request.model_id,model_id);
  assert.equal(Design.createProject(Design.sanitizeBrief({}),[{id:'recomposed',createdAt:new Date().toISOString(),label:'구도 변경',image,brief:Design.sanitizeBrief({}),request:result.request,parentId:null,metrics:{}}],[]).versions[0].request.mode,'img2img');
 }
 for(const extra of [{denoise:1},{denoise:0},{model_id:'sdxl-inpaint-v01'},{source:'data:image/png;base64,secret'},{mask:'data:image/png;base64,secret'}]){
  const {resolver,calls}=setup({request:{mode:'img2img',model_id:'sdxl-base',denoise:.55,...extra}});await assert.rejects(resolver.resolveResult(value),/unsafe-request/);assert.equal(calls.length,0);
 }
});

test('private turn trace and verified result bytes become optional execution, mismatches fail before import',async()=>{
 const {createHash}=require('node:crypto'),bytes=Buffer.from(image.split(',')[1],'base64'),sha=createHash('sha256').update(bytes).digest('hex');
 const execution={trace_id:'req1',job_id:value.jobId,result_sha256:sha,run_ref:'runs/'+value.jobId};
 async function resolve(patch={},resultPatch={}){
  const request={mode:'txt2img',model_id:'sdxl-base',prompt:'actual'},bridge={getSubmittedRequest:()=>({requestId:'req1',traceId:'req1',request}),getResultDescriptor:()=>({...value,state:'succeeded',traceId:'req1',request})};
  return createResultResolver({bridge,origin:'http://127.0.0.1:9999',verifyBackend:async()=>true,decode:()=>({width:1,height:1}),fetchImpl:async url=>url.includes('/api/jobs/')?new Response(JSON.stringify({job_id:value.jobId,state:'succeeded',is_current:true,...execution,...patch,result:{image_url:'/api/results/'+value.jobId,...execution,...resultPatch}})):new Response(bytes,{headers:{'content-type':'image/png'}})}).resolveResult(value);
 }
 assert.deepEqual((await resolve()).execution,{schema:1,traceId:'req1',jobId:value.jobId,resultSha256:sha,runRef:'runs/'+value.jobId});
 for(const patch of [{trace_id:'other-turn'},{result_sha256:'0'.repeat(64)},{run_ref:'/private/result.png'}])await assert.rejects(resolve({},patch),/execution|SHA|trace|provenance/i);
 await assert.rejects(resolve({result_sha256:'0'.repeat(64)}),/provenance|SHA/i);
});

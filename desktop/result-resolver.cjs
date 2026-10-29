'use strict';
const Design=require('./pankeki-tools.cjs').DocumentSchema;
const REQUEST_FIELDS=new Set(['mode','prompt','negative','model_id','seed','width','height','steps','cfg','sampler','scheduler',
  'edit_operation','target_color','source_color','color_tolerance','feather','denoise','roi','halo','cache','preview','preview_interval']);
function safeRequest(request){
  if(!request||typeof request!=='object'||Array.isArray(request)||!['txt2img','inpaint','img2img'].includes(request.mode))throw Error('unsafe-request');
  if(request.model_id!==undefined&&!['sdxl-base','sd-turbo'].includes(request.model_id)&&!(request.model_id==='sdxl-inpaint-v01'&&request.mode==='inpaint')&&!(request.model_id==='animagine-xl-4.0-opt'&&['txt2img','img2img'].includes(request.mode)))throw Error('unsafe-request');
  if(request.mode==='img2img'&&(!['sdxl-base','animagine-xl-4.0-opt'].includes(request.model_id)||!(request.denoise>0&&request.denoise<1)||request.edit_operation!==undefined))throw Error('unsafe-request');
  const clean={};
  const recolor=request.mode==='inpaint'&&request.edit_operation==='recolor';
  const recolorKeys=new Set(['mode','edit_operation','target_color','source_color','color_tolerance','feather']);
  for(const [key,value] of Object.entries(request)){
    if(!REQUEST_FIELDS.has(key)||!(value===null&&key==='source_color')&&!['string','number','boolean'].includes(typeof value)||(typeof value==='number'&&!Number.isFinite(value))||(typeof value==='string'&&value.length>8000))throw Error('unsafe-request');
    // The existing recolor document schema excludes transport cache/preview flags.
    if(!recolor||recolorKeys.has(key))clean[key]=value;
  }
  return clean;
}
function safeMetrics(metrics){
  const result={};for(const [key,value] of Object.entries(metrics||{}).slice(0,100)){
    if(/path|dir|file|token|secret/i.test(key)||!['string','number','boolean'].includes(typeof value))continue;
    if(typeof value==='number'&&!Number.isFinite(value))continue;
    if(typeof value==='string'&&(/^(\/|~\/|[A-Za-z]:\\)/.test(value)||value.length>1000))continue;
    result[key]=value;
  }return result;
}
async function boundedBody(response,limit){
  if(Number(response.headers.get('content-length'))>limit)throw Error('result-size');
  const chunks=[];let total=0;const reader=response.body.getReader();
  try{for(;;){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>limit)throw Error('result-size');chunks.push(value);}}
  catch(error){await reader.cancel();throw error;}
  return Buffer.concat(chunks,total);
}
function createResultResolver({bridge,origin,verifyBackend,decode,fetchImpl=fetch}) {
  async function get(endpoint,limit){
    if(!await verifyBackend())throw Error('backend-identity-changed');
    const response=await fetchImpl(origin+endpoint,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{origin}});
    if(!response.ok)throw Error('result-unavailable');return {bytes:await boundedBody(response,limit),type:response.headers.get('content-type')};
  }
  async function resolveResult(value){
    const descriptor=bridge.getResultDescriptor(value),submitted=bridge.getSubmittedRequest(value);
    if(!descriptor||!submitted||descriptor.requestId!==value.requestId||submitted.requestId!==value.requestId||descriptor.state!=='succeeded'||descriptor.jobId!==value.jobId||descriptor.resultId!==value.resultId)throw Error('unregistered-result');
    const request=safeRequest(submitted.request);
    if(JSON.stringify(request)!==JSON.stringify(safeRequest(descriptor.request)))throw Error('unregistered-result');
    const job=JSON.parse((await get('/api/jobs/'+value.jobId,256*1024)).bytes.toString('utf8'));
    if(job.job_id!==value.jobId||job.state!=='succeeded'||job.is_current===false||job.result?.image_url!=='/api/results/'+value.resultId)throw Error('result-not-current');
    const {bytes,type}=await get('/api/results/'+value.resultId,20*1024*1024);
    if(type?.split(';')[0]!=='image/png'||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('result-format');
    const size=decode(bytes);if(!size||size.width<1||size.height<1||size.width>4096||size.height>4096||size.width*size.height>16777216)throw Error('result-format');
    const imageDataUrl='data:image/png;base64,'+bytes.toString('base64');
    const execution=Design.executionFromResult(job.result,imageDataUrl);
    if(execution){
      if(execution.jobId!==value.jobId||execution.traceId!==(submitted.traceId||value.requestId))throw Error('execution-trace-mismatch');
      for(const [key,field] of [['trace_id','traceId'],['result_sha256','resultSha256'],['run_ref','runRef']])if(job[key]!==undefined&&job[key]!==execution[field])throw Error('execution-provenance-mismatch');
    } else if(['trace_id','result_sha256','run_ref'].some(key=>job[key]!=null))throw Error('execution-provenance-missing');
    if(!await verifyBackend())throw Error('backend-identity-changed');
    return {...(execution?{execution}:{}),imageDataUrl:'data:image/png;base64,'+bytes.toString('base64'),request,metrics:safeMetrics(job.result.metrics||descriptor.metrics)};
  }
  return {resolveResult};
}
module.exports={createResultResolver};

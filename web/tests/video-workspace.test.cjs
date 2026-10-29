'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Video=require('../src/video-workspace.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const caps={ready:true,reason:null,model:{id:'ltx',label:'LTX'},defaults:{width:384,height:256,frames:49,fps:24,steps:8},blender_available:true};
function memory(initial){const values=new Map(initial?[[Video.STORAGE_KEY,JSON.stringify(initial)]]:[]);return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),values};}
function setup(options={}){
  const calls=[],timers=new Map(),storage=options.storage||memory();let counter=0,job=null,result=null,scene={scene_id:'scene-1',name:'정원.blend'};
  const api=async(path,body)=>{calls.push({path,body});if(options.api){const answer=options.api(path,body);if(answer!==undefined)return answer;}
    if(path==='/api/video/status')return caps;
    if(path==='/api/video/jobs'){job={id:'video-1',status:'running',phase:'guide',project_id:body.project_id,epoch:body.epoch,guide_url:null,progress:null};return {id:job.id,status:job.status};}
    if(path.endsWith('/cancel')){job={...job,status:'canceled',phase:'canceled'};return job;}
    if(path==='/api/video/jobs/video-1')return {...job};
    if(path==='/api/video/results/video-1')return result;
    throw Error('Unexpected route '+path);
  };
  const controller=Video.createController({api,storage,pickScene:options.pickScene||(()=>Promise.resolve(scene)),makeId:()=>`project-${++counter}`,schedule:fn=>{const id=++counter;timers.set(id,fn);return id;},clearSchedule:id=>timers.delete(id)});
  return {controller,calls,storage,timers,get job(){return job;},set job(value){job=value;},set result(value){result=value;},set scene(value){scene=value;},async ready(){await controller.check();await controller.selectScene();controller.setPrompt('햇살 아래서 천천히 돌아보는 인물');},async submit(){await controller.submit();await tick();}};
}
test('scene token and a natural Korean instruction submit the fixed video job without filesystem paths',async()=>{
  const h=setup();await h.ready();await h.submit();
  const sent=h.calls.find(row=>row.path==='/api/video/jobs').body;
  assert.deepEqual(Object.keys(sent).sort(),['epoch','project_id','prompt','scene_id','seed']);
  assert.equal(sent.scene_id,'scene-1');assert.equal(sent.prompt,'햇살 아래서 천천히 돌아보는 인물');assert.equal(sent.seed,42);
  assert.equal(h.controller.getState().busy,true);assert.equal(h.controller.setPrompt('늦은 변경'),false);
  assert.equal(h.controller.getState().job.phase,'guide');assert.equal(h.controller.getState().result,null);h.controller.destroy();
});
test('a guide URL remains a guide and only verified AI result metadata unlocks the result',async()=>{
  const h=setup();await h.ready();await h.submit();h.job={...h.job,guide_url:'/api/video/assets/video-1/guide.mp4'};await h.controller.refreshJob();
  assert.equal(h.controller.getState().guide_url,h.job.guide_url);assert.equal(h.controller.getState().result,null);
  h.job={...h.job,status:'succeeded',phase:'completed'};h.result={ai_generated:false,url:'/api/video/assets/video-1/guide.mp4'};await h.controller.refreshJob();
  assert.equal(h.controller.getState().result,null);assert.match(h.controller.getState().error,/확인/);
  h.result={ai_generated:true,url:'/api/video/assets/video-1/result.mp4',filename:'Pankeki-garden.mp4'};await h.controller.refreshJob();
  assert.deepEqual(h.controller.getState().result,{url:'/api/video/assets/video-1/result.mp4',filename:'Pankeki-garden.mp4'});
  assert.equal(h.controller.getState().busy,false);h.controller.destroy();
});
test('foreign result URLs and mismatched project or epoch cannot become the current video',async()=>{
  for(const change of [job=>({...job,project_id:'other'}),job=>({...job,epoch:job.epoch+1})]){
    const h=setup();await h.ready();await h.submit();h.job=change({...h.job,status:'succeeded'});h.result={ai_generated:true,url:'/api/video/assets/video-1/result.mp4'};await h.controller.refreshJob();
    assert.equal(h.controller.getState().result,null);assert.match(h.controller.getState().error,/연결/);h.controller.destroy();
  }
  assert.equal(Video.checkedAsset('https://example.org/video.mp4','video-1','result'),null);
  assert.equal(Video.checkedAsset('/api/video/assets/another/result.mp4','video-1','result'),null);
});
test('cancel keeps the scene and prompt and does not display a completion racing with cancellation',async()=>{
  const h=setup({api:(path)=>path.endsWith('/cancel')?{}:undefined});await h.ready();await h.submit();
  h.job={...h.job,status:'succeeded'};h.result={ai_generated:true,url:'/api/video/assets/video-1/result.mp4'};
  await h.controller.cancel();assert.equal(h.controller.getState().result,null);assert.match(h.controller.getState().notice,/취소/);
  assert.equal(h.controller.getState().scene.name,'정원.blend');assert.match(h.controller.getState().prompt,/햇살/);h.controller.destroy();
});
test('a late submission after a project reset is canceled by its ID and never adopted',async()=>{
  const late=deferred(),h=setup({api:path=>path==='/api/video/jobs'?late.promise:undefined});await h.ready();
  const pending=h.controller.submit();await tick();h.controller.reset();late.resolve({id:'late-video',status:'queued'});await pending;await tick();
  assert.equal(h.controller.getState().job,null);assert.equal(h.controller.getState().scene,null);
  assert.ok(h.calls.some(row=>row.path==='/api/video/jobs/late-video/cancel'));h.controller.destroy();
});
test('reload only reads the persisted job and verifies a completed file; it never resubmits inference',async()=>{
  const saved={schema:1,project_id:'saved-project',epoch:7,scene:{scene_id:'scene-1',name:'보관.blend'},prompt:'기억한 설명',job:{id:'video-1',project_id:'saved-project',epoch:7}};
  const h=setup({storage:memory(saved),api:path=>path==='/api/video/jobs/video-1'?{id:'video-1',project_id:'saved-project',epoch:7,status:'succeeded',phase:'completed'}:path==='/api/video/results/video-1'?{ai_generated:true,url:'/api/video/assets/video-1/result.mp4'}:undefined});
  await h.controller.restore();assert.equal(h.controller.getState().result.url,'/api/video/assets/video-1/result.mp4');assert.equal(h.controller.getState().prompt,'기억한 설명');
  assert.equal(h.calls.filter(row=>row.body!==undefined).length,0);h.controller.destroy();
});
test('unavailable runtime and picker cancellation never submit a job or erase the current selection',async()=>{
  const h=setup();await h.ready();h.scene=null;assert.equal(await h.controller.selectScene(),false);assert.equal(h.controller.getState().scene.name,'정원.blend');
  const blocked=setup({api:path=>path==='/api/video/status'?{...caps,ready:false,reason:'모델을 준비해주세요.'}:undefined});await blocked.ready();assert.equal(await blocked.controller.submit(),false);
  assert.match(blocked.controller.getState().error,/모델/);assert.equal(blocked.calls.filter(row=>row.path==='/api/video/jobs').length,0);h.controller.destroy();blocked.controller.destroy();
});
test('job polling recovers from a transient failure and terminates automatic retries after repeated disconnects',async()=>{
  let broken=false;const h=setup({api:path=>broken&&path==='/api/video/jobs/video-1'?Promise.reject(Error('연결 끊김')):undefined});await h.ready();await h.submit();broken=true;
  for(let i=0;i<3;i++)await h.controller.refreshJob();assert.equal(h.timers.size,0);assert.equal(h.controller.getState().busy,true);
  broken=false;await h.controller.refreshJob();assert.equal(h.controller.getState().error,'');assert.equal(h.timers.size,1);h.controller.destroy();
});
test('a lost submission response locks new generation and explicit recovery repeats the exact idempotent request',async()=>{
  let broken=true,payload;
  const h=setup({api:(path,body)=>{if(path==='/api/video/jobs'){if(broken){payload={...body};return Promise.reject(Error('응답 유실'));}return {id:'video-1',status:'queued'};}if(path==='/api/video/jobs/video-1')return {id:'video-1',status:'queued',phase:'waiting_gpu',project_id:payload.project_id,epoch:payload.epoch};}});
  await h.ready();await h.submit();assert.equal(h.controller.getState().busy,true);assert.deepEqual(h.controller.getState().pendingSubmission,payload);
  assert.equal(await h.controller.submit(),false);assert.equal(h.calls.filter(row=>row.path==='/api/video/jobs').length,1);
  broken=false;await h.controller.recoverSubmission();await tick();
  const submissions=h.calls.filter(row=>row.path==='/api/video/jobs');assert.equal(submissions.length,2);assert.deepEqual(submissions[1].body,submissions[0].body);assert.equal(h.controller.getState().pendingSubmission,null);h.controller.destroy();
});
test('an unknown pending request survives reload without automatically sending a POST',async()=>{
  const payload={scene_id:'scene-1',project_id:'saved-project',epoch:4,prompt:'설명',seed:42};
  const h=setup({storage:memory({schema:1,project_id:'saved-project',epoch:4,prompt:'설명',pendingSubmission:payload})});
  await h.controller.restore();assert.deepEqual(h.controller.getState().pendingSubmission,payload);assert.equal(h.calls.filter(row=>row.body!==undefined).length,0);h.controller.destroy();
});
test('a request rejected before creation leaves inputs available for correction',async()=>{
  const h=setup({api:path=>path==='/api/video/jobs'?Promise.reject(Object.assign(Error('파일을 다시 가져와주세요.'),{status:400})):undefined});await h.ready();await h.submit();
  assert.equal(h.controller.getState().busy,false);assert.equal(h.controller.getState().pendingSubmission,null);assert.equal(h.controller.setPrompt('수정한 설명'),true);h.controller.destroy();
});
test('a polling response from the previous project cannot overwrite the new project',async()=>{
  const late=deferred();let delay=false;
  const h=setup({api:path=>delay&&path==='/api/video/jobs/video-1'?late.promise:undefined});await h.ready();await h.submit();delay=true;
  const polling=h.controller.refreshJob(),old={...h.job};h.controller.reset();late.resolve({...old,status:'succeeded'});await polling;
  assert.equal(h.controller.getState().job,null);assert.equal(h.controller.getState().result,null);assert.equal(h.controller.getState().error,'');h.controller.destroy();
});
test('the mounted composer preserves Korean IME input and real project import retires the video context',async t=>{
  class Element{
    constructor(){this.dataset={};this.attributes=new Map();this.listeners=new Map();this.value='';this.hidden=false;}
    addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
    removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
    emit(type,extra={}){for(const fn of this.listeners.get(type)||[])fn({target:this,...extra});}
    setAttribute(name,value){this.attributes.set(name,String(value));}
    getAttribute(name){return this.attributes.get(name)??null;}
    hasAttribute(name){return this.attributes.has(name);}
    removeAttribute(name){this.attributes.delete(name);}
    load(){} pause(){}
  }
  const ids=['videoWorkspace','videoPickScene','videoPrompt','videoSceneName','videoGenerate','videoCancel','videoRefresh','videoReadiness','videoFormat','videoStatus','videoError','videoStorageError','videoProgress','videoElapsed','videoResult','videoEmpty','videoPlayer','videoSave','videoGuideDetails','videoGuidePlayer','videoEmptyTitle','videoEmptyCopy'];
  const nodes=Object.fromEntries(ids.map(id=>[id,new Element()])),doc={getElementById:id=>nodes[id],body:new Element()},posts=[];let notify;
  const values={localStorage:memory(),pankekiDesktop:{pickVideoScene:async()=>({scene_id:'scene-1',name:'정원.blend'})},fetch:async(path,options)=>{if(options?.method==='POST')posts.push({path,body:options.body});return {ok:true,json:async()=>caps};},MutationObserver:class{observe(){} disconnect(){}}};
  const descriptors=Object.fromEntries(Object.keys(values).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value]of Object.entries(values))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  t.after(()=>{for(const [key,descriptor]of Object.entries(descriptors))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
  const controller=Video.mount(doc,{ready:Promise.resolve(),subscribe:listener=>{notify=listener;listener({});return ()=>{};}});t.after(()=>controller.destroy());await tick();
  nodes.videoPickScene.emit('click');await tick();
  nodes.videoPrompt.emit('compositionstart');nodes.videoPrompt.value='가';nodes.videoPrompt.emit('input',{isComposing:true});
  await controller.check();assert.equal(nodes.videoPrompt.value,'가');assert.equal(controller.getState().prompt,'');
  nodes.videoGenerate.emit('click');await tick();assert.equal(posts.length,0);
  nodes.videoPrompt.value='가을 숲을 천천히 걷는 인물';nodes.videoPrompt.emit('compositionend');assert.equal(controller.getState().prompt,'가을 숲을 천천히 걷는 인물');
  const previous=controller.getState().project_id;notify({},'import');assert.notEqual(controller.getState().project_id,previous);assert.equal(controller.getState().scene,null);assert.equal(controller.getState().prompt,'');
});
test('motion header keeps video entry and all three rig mode controls in row one above the unchanged row-two body',()=>{
  const fs=require('node:fs'),path=require('node:path'),html=fs.readFileSync(path.join(__dirname,'../src/index.template.html'),'utf8');
  // Parse the source element hierarchy. Template icons are text and do not
  // affect which elements become direct CSS grid items.
  const tree={tag:'root',attrs:{},children:[],parent:null},stack=[tree],voids=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  for(const match of html.matchAll(/<(\/)?([a-z][\w:-]*)\b([^>]*)>/gi)){
    const tag=match[2].toLowerCase();if(match[1]){const at=stack.findLastIndex(node=>node.tag===tag);if(at>0)stack.length=at;continue;}
    const attrs=Object.fromEntries([...match[3].matchAll(/([\w-]+)="([^"]*)"/g)].map(row=>[row[1],row[2]])),node={tag,attrs,children:[],parent:stack.at(-1)};
    node.parent.children.push(node);if(!voids.has(tag)&&!match[3].endsWith('/'))stack.push(node);
  }
  const all=[];(function collect(node){all.push(node);for(const child of node.children)collect(child);})(tree);
  const hasClass=(node,name)=>(node.attrs.class||'').split(/\s+/).includes(name),page=all.find(node=>hasClass(node,'motion-preview-page'));
  const entry=all.find(node=>hasClass(node,'video-motion-entry')),modes=all.find(node=>hasClass(node,'motion-workspace-switch'));
  const gridItem=node=>{while(node&&node.parent!==page)node=node.parent;return node;};
  assert.ok(gridItem(entry)===gridItem(modes),'video entry and mode switch must share one grid item, preserving the two-row motion layout');
  const header=gridItem(entry);assert.ok(hasClass(header,'motion-mode-header'));
  for(const id of ['motionNativeMode','v3Mode','motionCubismMode'])assert.ok(all.some(node=>node.attrs.id===id&&node.parent===modes),id+' must remain in the original mode control group');
  const videoCss=fs.readFileSync(path.join(__dirname,'../src/video-workspace.css'),'utf8'),legacyCss=fs.readFileSync(path.join(__dirname,'../src/redesign.css'),'utf8');
  const declarations=(css,selector)=>{const rule=css.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*\\{([^}]*)\\}'));assert.ok(rule,'missing layout contract '+selector);return Object.fromEntries(rule[1].split(';').filter(Boolean).map(row=>row.split(':').map(value=>value.trim())));};
  const top=declarations(videoCss,'.motion-mode-header');assert.equal(top['grid-column'],'1/-1');assert.equal(top['grid-row'],'1');assert.equal(top.display,'flex');assert.equal(top['flex-direction'],'column');
  const v3=declarations(legacyCss,'.pankeki-pc .v3-workspace');assert.equal(v3['grid-row'],'2');
  const layout=declarations(legacyCss,'.pankeki-pc .motion-preview-page');assert.equal(layout['grid-template-rows'],'auto minmax(0,1fr)');
});

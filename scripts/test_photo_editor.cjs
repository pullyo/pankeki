'use strict';
// Client event/core-boundary tests. No rendered-app, server, segmentation or sampler claims.
const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../web/src/photo-editor.js');
const PNG='data:image/png;base64,controlled-mask';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(overrides={}) {
  const calls={begin:[],apply:[],cancel:[],save:[],delete:[],applied:[],locks:[],errors:[],before:[]},comments=new Map();let candidate='F',remoteLock=false,token=0;
  const doc={activeElement:null},listenerStats={active:0,added:0,removed:0};
  class Element {
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.parentNode=null;this.listeners={};this.style={};this.attributes={};this.dataset={};this.hidden=false;this.disabled=false;this.value='';this.checked=false;this._text='';this._classes=new Set();this.scrollLeft=0;this.scrollTop=0;this.clientLeft=0;this.clientTop=0;this.rect={left:10,top:20,width:600,height:400};this.context={commands:[],clearRect(){this.commands.push(['clear']);},save(){},restore(){},beginPath(){},arc(...v){this.commands.push(['arc',...v]);},fill(){this.commands.push(['fill']);},moveTo(...v){this.commands.push(['move',...v]);},lineTo(...v){this.commands.push(['line',...v]);},stroke(){this.commands.push(['stroke']);},fillRect(...v){this.commands.push(['fillRect',...v]);}};
      this.classList={add:(...n)=>n.forEach(v=>this._classes.add(v)),remove:(...n)=>n.forEach(v=>this._classes.delete(v)),contains:n=>this._classes.has(n),toggle:(n,force)=>{if(force??!this._classes.has(n))this._classes.add(n);else this._classes.delete(n);}};
    }
    set className(value){this._classes=new Set(value.split(/\s+/));}get className(){return [...this._classes].join(' ');}
    set textContent(value){this._text=String(value);this.replaceChildren();}get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
    append(...nodes){nodes.forEach(n=>{n.parentNode=this;this.children.push(n);});}
    replaceChildren(...nodes){this.children.forEach(n=>n.parentNode=null);this.children=[];this.append(...nodes);}
    contains(node){return node===this||this.children.some(n=>n.contains(node));}
    remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null;}
    setAttribute(name,value){this.attributes[name]=String(value);}getAttribute(name){return this.attributes[name]??null;}
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);listenerStats.active++;listenerStats.added++;}removeEventListener(type,fn){const old=this.listeners[type]||[],next=old.filter(n=>n!==fn);this.listeners[type]=next;listenerStats.active-=old.length-next.length;listenerStats.removed+=old.length-next.length;}
    async fire(type,fields={}){const event={type,target:this,button:0,pointerId:1,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...fields};await Promise.all((this.listeners[type]||[]).map(fn=>fn(event)));return event;}
    async click(){if(!this.disabled)return this.fire('click');}
    querySelectorAll(selector){const selectors=selector.split(',').map(s=>s.trim()),matches=n=>selectors.some(s=>s.startsWith('.')?n._classes.has(s.slice(1)):s.toUpperCase()===n.tagName);const result=[];function visit(n){for(const child of n.children){if(matches(child))result.push(child);visit(child);}}visit(this);return result;}
    closest(selector){for(let n=this;n;n=n.parentNode)if(selector.startsWith('.')&&n._classes.has(selector.slice(1)))return n;return null;}
    focus(){doc.activeElement=this;}getBoundingClientRect(){return this.rect;}
    getContext(){return this.context;}toDataURL(type){this.exportType=type;return PNG;}
    setPointerCapture(){}releasePointerCapture(){}
  }
  const win=new Element('window');win.getComputedStyle=node=>({objectFit:'contain',objectPosition:'50% 50%',...node.computed});
  doc.defaultView=win;doc.createElement=tag=>{const node=new Element(tag);if(tag==='canvas')canvases.push(node);return node;};doc.listeners={};doc.addEventListener=Element.prototype.addEventListener;doc.removeEventListener=Element.prototype.removeEventListener;doc.fire=Element.prototype.fire;
  const canvases=[],stage=new Element(),image=new Element('img'),controls=new Element();image.complete=true;image.naturalWidth=1200;image.naturalHeight=800;stage.append(image);
  const core={
    getState:()=>({locked:remoteLock}),
    begin:async(id,tool)=>{calls.begin.push({id,tool});return {token:'token-'+(++token),tool,candidateId:id,image:PNG,width:1200,height:800,annotations:[]};},
    apply:async(token,options)=>{calls.apply.push({token,options});const tool=calls.begin.at(-1).tool;return {candidateId:'derived',image:PNG,width:tool==='resize'?options.width:1200,height:tool==='resize'?options.height:800,operation:tool};},
    cancel:async token=>{calls.cancel.push(token);},
    listComments:async id=>comments.get(id)||[],
    saveComment:async(token,comment)=>{calls.save.push({token,comment});const current=comments.get('F')||[];const value={...comment,id:comment.id||'comment-'+(current.length+1)};comments.set('F',[...current.filter(n=>n.id!==value.id),value]);return value;},
    deleteComment:async(token,id)=>{calls.delete.push({token,id});comments.set('F',(comments.get('F')||[]).filter(n=>n.id!==id));},...overrides
  };
  const host={stage,image,controls,core,getCandidateId:()=>candidate,onApplied:r=>calls.applied.push(r),onLockChange:(locked,state)=>calls.locks.push({locked,state}),onError:m=>calls.errors.push(m)};
  const editor=api.mount(host);
  const byText=(text)=>controls.querySelectorAll('button').find(n=>n.textContent===text);
  const overlay=stage.querySelectorAll('.ppe-overlay')[0];
  return {editor,host,core,calls,doc,win,stage,image,controls,canvases,overlay,comments,listenerStats,byText,setCandidate:id=>{candidate=id;},setLock:v=>{remoteLock=v;}};
}
async function stroke(f,points=[[160,120],[310,220]]){await f.overlay.fire('pointerdown',{clientX:points[0][0],clientY:points[0][1]});for(const [clientX,clientY]of points.slice(1))await f.overlay.fire('pointermove',{clientX,clientY});await f.overlay.fire('pointerup');}
const flush=()=>new Promise(setImmediate);

test('contain letterbox maps only actual image content and uses natural coordinates',()=>{
 const rect=api.contentRect({left:100,top:50,width:600,height:500},1200,800);
 assert.deepEqual(rect,{left:100,top:100,width:600,height:400,right:700,bottom:500});
 assert.equal(api.pointerToImage(rect,110,70,1200,800),null);
 assert.deepEqual(api.pointerToImage(rect,400,300,1200,800),{x:600,y:400});
 assert.deepEqual(api.pointerToImage(rect,900,900,1200,800,true),{x:1200,y:800});
});
test('zoom and scroll viewport coordinates map the same natural point',()=>{
 const normal=api.contentRect({left:20,top:50,width:600,height:400},1200,800);
 const zoom=api.contentRect({left:-180,top:-150,width:1200,height:800},1200,800);
 assert.deepEqual(api.pointerToImage(normal,320,250,1200,800),api.pointerToImage(zoom,420,250,1200,800));
 const positioned=api.contentRect({left:0,top:0,width:600,height:600},1200,800,'contain','left bottom');assert.equal(positioned.top,200);
});
test('measurement removes image border/padding and supports dynamic element geometry',()=>{
 const f=fixture();Object.assign(f.image,{offsetWidth:600,offsetHeight:400,computed:{paddingLeft:'10px',paddingRight:'10px',borderTopWidth:'2px',borderBottomWidth:'2px'}});
 const rect=api.measureImageContent(f.image,f.win);assert.equal(rect.left,20);assert.equal(rect.width,580);assert.ok(rect.top>22);f.editor.destroy();
});
test('aspect calculation shows rounded opposite dimension and rejects instead of clamping',()=>{
 assert.deepEqual(api.resizeDimensions(1200,800,'500','800',true),{width:500,height:333,keepAspect:true,valid:true,error:''});
 assert.equal(api.resizeDimensions(1200,800,'500','400',true,'height').width,600);
 for(const [width,height]of [[8193,10],[0,10],[4097,4096],['1.5',10],['',10]])assert.equal(api.resizeDimensions(1200,800,width,height,false).valid,false);
 assert.equal(api.resizeDimensions(1200,800,8192,2048,false).valid,true);
 assert.equal(api.resizeDimensions(8192,1,1,1,true).valid,false,'rounded zero is rejected');
});
test('history is bounded, copies caller data and resets redo on a fresh stroke',()=>{
 const h=api.createHistory(2),v=[{x:1}];h.push(v);v[0].x=9;assert.equal(h.get()[0].x,1);h.push([2]);h.push([3]);h.undo();assert.deepEqual(h.get(),[2]);h.undo();h.undo();assert.deepEqual(h.get(),[{x:1}]);h.redo();h.push([4]);assert.equal(h.canRedo(),false);
});
test('host gets exactly five tabs and preview strokes reach core only on apply',async()=>{
 const f=fixture();assert.deepEqual(f.controls.querySelectorAll('.ppe-tab').map(n=>n.textContent),['마크업','댓글','배경 제거','지우기','크기 조정']);
 await f.editor.open('markup','F');await stroke(f);assert.equal(f.calls.apply.length,0);await f.byText('실행 취소').click();await f.byText('다시 실행').click();const result=await f.editor.apply();assert.equal(result.candidateId,'derived');assert.equal(f.calls.apply.length,1);assert.deepEqual(f.calls.apply[0].options.strokes[0],{points:[{x:300,y:200},{x:600,y:400}],color:'#b34422',width:8,opacity:1});assert.equal(f.calls.applied.length,1);assert.equal(f.image.src,undefined);f.editor.destroy();
});
test('erase encodes a dedicated natural-size black/white mask and never draws source pixels',async()=>{
 const f=fixture();await f.editor.open('erase','F');await stroke(f);await f.editor.apply();const mask=f.canvases.at(-1);assert.equal(mask.width,1200);assert.equal(mask.height,800);assert.equal(mask.exportType,'image/png');assert.deepEqual(f.calls.apply[0].options,{maskPng:PNG});assert.ok(mask.context.commands.some(n=>n[0]==='fillRect'));assert.equal(f.calls.begin.length,1);f.editor.destroy();
});
test('empty paint cannot apply and cancellation creates no result',async()=>{
 const f=fixture();await f.editor.open('markup','F');await assert.rejects(f.editor.apply,/먼저/);await stroke(f);await f.editor.cancel();assert.equal(f.calls.apply.length,0);assert.equal(f.calls.applied.length,0);assert.deepEqual(f.calls.cancel,['token-1']);assert.equal(f.overlay.hidden,true);f.editor.destroy();
});
test('beforeOpen can pin the readonly candidate before core begins',async()=>{
 const f=fixture();f.setCandidate('G');f.host.beforeOpen=async(tool,id)=>{f.calls.before.push({tool,id});f.setCandidate(id);};await f.editor.open('resize','F');assert.equal(f.calls.before.length,1);assert.equal(f.calls.begin[0].id,'F');f.editor.destroy();
});
test('switching viewed image hides pinned overlay and preserves its draft',async()=>{
 const f=fixture();await f.editor.open('markup','F');await stroke(f);f.setCandidate('G');f.editor.render();assert.equal(f.overlay.hidden,true);assert.equal(await f.editor.apply(),null);assert.equal(f.calls.apply.length,0);f.setCandidate('F');f.editor.render();assert.equal(f.overlay.hidden,false);await f.editor.apply();assert.equal(f.calls.apply[0].token,'token-1');f.editor.destroy();
});
test('tool tabs retain unsent comment text and markup while each core token stays separate',async()=>{
 const f=fixture();await f.editor.open('markup','F');await stroke(f);await f.editor.open('comments','F');let area=f.controls.querySelectorAll('textarea')[0];area.value='남겨둘 초안';await area.fire('input');await f.editor.open('markup','F');await f.editor.apply();assert.equal(f.calls.apply[0].options.strokes.length,1);await f.editor.open('comments','F');area=f.controls.querySelectorAll('textarea')[0];assert.equal(area.value,'남겨둘 초안');f.editor.destroy();
});
test('comment save/edit/delete use normalized pins and plain text without a pixel apply',async()=>{
 const f=fixture();await f.editor.open('comments','F');await f.overlay.fire('pointerdown',{clientX:310,clientY:220});const area=f.controls.querySelectorAll('textarea')[0];area.value='<b>실제 plain text</b>';await area.fire('input');await f.byText('댓글 저장').click();assert.deepEqual(f.calls.save[0].comment,{x:.5,y:.5,text:'<b>실제 plain text</b>'});assert.equal(f.controls.querySelectorAll('.ppe-comment-item')[0].textContent,'1. <b>실제 plain text</b>');await f.controls.querySelectorAll('.ppe-comment-item')[0].click();area.value='수정';await area.fire('input');await f.byText('댓글 저장').click();assert.equal(f.calls.save[1].comment.id,'comment-1');await f.controls.querySelectorAll('.ppe-comment-item')[0].click();await f.byText('댓글 삭제').click();assert.equal(f.calls.delete[0].id,'comment-1');assert.equal(f.calls.apply.length,0);f.editor.destroy();
});
test('resize inputs display the exact rounded result and submit exact pixels',async()=>{
 const f=fixture();await f.editor.open('resize','F');const fields=f.controls.querySelectorAll('input'),width=fields.find(n=>n.type==='number'),height=fields.filter(n=>n.type==='number')[1];width.value='500';await width.fire('input');assert.equal(height.value,'333');assert.match(f.controls.querySelectorAll('.ppe-resize-output')[0].textContent,/500 × 333 px/);await f.editor.apply();assert.deepEqual(f.calls.apply[0].options,{width:500,height:333,keepAspect:true});f.editor.destroy();
});
test('external lock blocks pointer and apply while leaving cancellation available',async()=>{
 const f=fixture();await f.editor.open('markup','F');f.setLock(true);f.editor.render();await stroke(f);assert.equal(await f.editor.apply(),null);assert.equal(f.byText('적용').disabled,true);assert.equal(f.byText('취소').disabled,false);await assert.rejects(()=>f.editor.open('resize','F'),/진행 중/);f.setLock(false);await f.editor.cancel();f.editor.destroy();
});
test('cancel during begin waits acknowledgement and releases a late token once',async()=>{
 const begin=deferred(),ack=deferred(),f=fixture({begin:()=>begin.promise,cancel:token=>{f.calls.cancel.push(token);return ack.promise;}});
 const opening=f.editor.open('markup','F'),cancelled=f.editor.cancel();assert.equal(f.editor.getState().locked,true);begin.resolve({token:'late',tool:'markup',candidateId:'F',image:PNG,width:1200,height:800});await flush();assert.deepEqual(f.calls.cancel,['late']);assert.equal(f.editor.getState().cancelling,true);ack.resolve();await Promise.all([opening,cancelled]);assert.equal(f.editor.getState().active,null);assert.equal(f.calls.applied.length,0);f.editor.destroy();
});
test('cancel suppresses late apply notification and preserves the next operation busy state',async()=>{
 const first=deferred(),second=deferred();let count=0;const f=fixture({apply:()=>++count===1?first.promise:second.promise});const applying=f.editor.open('background-remove','F');await flush();await f.editor.cancel();const next=f.editor.open('background-remove','F');await flush();first.resolve({candidateId:'old',image:PNG,width:1200,height:800,operation:'background-remove'});await applying;assert.equal(f.calls.applied.length,0);assert.equal(f.editor.getState().applying,true);second.resolve({candidateId:'new',image:PNG,width:1200,height:800,operation:'background-remove'});await next;assert.equal(f.calls.applied[0].candidateId,'new');f.editor.destroy();
});
test('backend failure and no derived identity never report success',async()=>{
 const f=fixture({apply:async()=>{throw Error('실제 연산 실패');}});await assert.rejects(()=>f.editor.open('background-remove','F'),/실제 연산 실패/);assert.equal(f.calls.applied.length,0);f.core.apply=async()=>({candidateId:'F',image:PNG,width:1200,height:800,operation:'background-remove'});await assert.rejects(()=>f.editor.open('background-remove','F'),/결과/);assert.equal(f.calls.applied.length,0);f.editor.destroy();
});
test('IME Escape preserves draft, ordinary Escape cancels and restores focus',async()=>{
 const f=fixture(),trigger=f.doc.createElement('button');trigger.focus();await f.editor.open('comments','F');const area=f.controls.querySelectorAll('textarea')[0];area.value='작성 중';await area.fire('input');await area.fire('compositionstart');const ime=await f.doc.fire('keydown',{key:'Escape'});assert.equal(ime.defaultPrevented,undefined);assert.ok(f.editor.getState().active);await area.fire('compositionend');const escape=await f.doc.fire('keydown',{key:'Escape'});await flush();assert.equal(escape.defaultPrevented,true);assert.equal(f.editor.getState().active,null);assert.equal(f.doc.activeElement,trigger);f.editor.destroy();
});
test('destroy removes layers/listeners and cancels an owned transaction',async()=>{
 const f=fixture();await f.editor.open('markup','F');f.editor.destroy();await flush();assert.equal(f.stage.querySelectorAll('.ppe-overlay').length,0);assert.equal(f.controls.children.length,0);assert.equal(f.doc.listeners.keydown.length,0);assert.deepEqual(f.calls.cancel,['token-1']);
});
test('dynamic getImage uses the displayed content rectangle after load and scroll',async()=>{
 const f=fixture(),other=f.doc.createElement('img');other.complete=true;other.naturalWidth=1200;other.naturalHeight=800;other.rect={left:-100,top:-50,width:1200,height:800};f.host.getImage=()=>other;f.stage.scrollLeft=110;f.stage.scrollTop=70;await f.editor.open('markup','F');assert.equal(f.overlay.style.left,'0px');assert.equal(f.overlay.style.top,'0px');await stroke(f,[[200,150]]);await f.editor.apply();assert.deepEqual(f.calls.apply[0].options.strokes[0].points,[{x:300,y:200}]);assert.ok(other.listeners.load.length);f.editor.destroy();assert.equal(other.listeners.load.length,0);
});
test('failed cancellation retains ownership and can retry without discarding the draft',async()=>{
 let fail=true;const f=fixture({cancel:async token=>{f.calls.cancel.push(token);if(fail)throw Error('취소 ACK 실패');}});await f.editor.open('markup','F');await stroke(f);await assert.rejects(f.editor.cancel,/ACK 실패/);assert.equal(f.editor.getState().active.candidateId,'F');fail=false;await f.editor.cancel();assert.deepEqual(f.calls.cancel,['token-1','token-1']);assert.equal(f.editor.getState().active,null);f.editor.destroy();
});
test('a stale rejected apply is silent and lock callbacks tolerate host rerender',async()=>{
 const work=deferred(),f=fixture({apply:()=>work.promise});f.host.onLockChange=()=>f.editor.render();const applying=f.editor.open('background-remove','F');await flush();await f.editor.cancel();work.reject(Error('이미 취소된 응답'));assert.equal(await applying,null);assert.equal(f.calls.errors.length,0);f.editor.destroy();
});
test('a core-released failed transaction can reopen with the same local draft and a fresh token',async()=>{
 const f=fixture();let active=true;f.core.getState=()=>({active,locked:false});await f.editor.open('markup','F');await stroke(f);f.core.apply=async()=>{active=false;throw Error('실제 처리 실패');};await assert.rejects(f.editor.apply,/실제 처리 실패/);assert.equal(f.editor.getState().active,null);active=true;await f.editor.open('markup','F');f.core.apply=async(token,options)=>{f.calls.apply.push({token,options});return {candidateId:'new',image:PNG,width:1200,height:800,operation:'markup'};};await f.editor.apply();assert.equal(f.calls.apply[0].token,'token-2');assert.equal(f.calls.apply[0].options.strokes.length,1);f.editor.destroy();
});
test('synchronous lost capture cannot double-commit a stroke',async()=>{
 const f=fixture();await f.editor.open('markup','F');f.overlay.releasePointerCapture=()=>f.overlay.fire('lostpointercapture');await stroke(f);await f.editor.apply();assert.equal(f.calls.apply[0].options.strokes.length,1);f.editor.destroy();
});
test('one-click background tab runs beforeOpen begin apply once, with progress and cancel until the real result',async()=>{
 const work=deferred(),order=[],f=fixture();f.host.beforeOpen=async(tool,id)=>order.push(['before',tool,id]);const begin=f.core.begin;f.core.begin=async(id,tool)=>{order.push(['begin',tool,id]);return begin(id,tool);};f.core.apply=async(token,options)=>{f.calls.apply.push({token,options});order.push(['apply',token]);return work.promise;};
 const first=f.byText('배경 제거').click();await flush();assert.deepEqual(order,[['before','background-remove','F'],['begin','background-remove','F'],['apply','token-1']]);assert.deepEqual(f.calls.apply[0].options,{});assert.equal(f.calls.applied.length,0);assert.equal(f.controls.querySelectorAll('.ppe-tools')[0].getAttribute('aria-busy'),'true');assert.equal(f.byText('적용 중…').hidden,true);assert.equal(f.byText('취소').disabled,false);await f.byText('배경 제거').click();await assert.rejects(()=>f.editor.open('background-remove','F'),/진행 중/);assert.equal(f.calls.apply.length,1);work.resolve({candidateId:'cutout',image:PNG,width:1200,height:800,operation:'background-remove'});await first;assert.equal(f.calls.applied.length,1);assert.equal(f.calls.applied[0].candidateId,'cutout');assert.equal(f.editor.getState().locked,false);f.editor.destroy();
});
test('one-click background programmatic open pins the source despite viewing another candidate during begin',async()=>{
 const wait=deferred(),f=fixture();f.core.begin=async(id,tool)=>{f.calls.begin.push({id,tool});await wait.promise;return {token:'source-F',tool,candidateId:id,image:PNG,width:1200,height:800};};f.core.apply=async(token,options)=>{f.calls.apply.push({token,options});return {candidateId:'cutout-F',image:PNG,width:1200,height:800,operation:'background-remove'};};const opening=f.editor.open('background-remove','F');f.setCandidate('G');wait.resolve();await opening;assert.deepEqual(f.calls.begin,[{id:'F',tool:'background-remove'}]);assert.equal(f.calls.apply[0].token,'source-F');assert.equal(f.host.getCandidateId(),'G');assert.equal(f.calls.applied[0].candidateId,'cutout-F');f.editor.destroy();
});
test('one-click background cancellation before begin resolution never starts apply',async()=>{
 const wait=deferred(),f=fixture({begin:()=>wait.promise});const opening=f.editor.open('background-remove','F'),cancelled=f.editor.cancel();wait.resolve({token:'late-background',tool:'background-remove',candidateId:'F',image:PNG,width:1200,height:800});await Promise.all([opening,cancelled]);assert.equal(f.calls.apply.length,0);assert.equal(f.calls.applied.length,0);assert.deepEqual(f.calls.cancel,['late-background']);f.editor.destroy();
});
test('one-click background failure is visible and a second click retries with a fresh token',async()=>{
 const f=fixture();let fail=true;f.core.apply=async(token,options)=>{f.calls.apply.push({token,options});if(fail)throw Error('배경 인식 실패');return {candidateId:'retried',image:PNG,width:1200,height:800,operation:'background-remove'};};await f.byText('배경 제거').click();assert.match(f.editor.getState().message,/배경 인식 실패/);assert.equal(f.editor.getState().active,null);assert.equal(f.calls.applied.length,0);fail=false;await f.byText('배경 제거').click();assert.deepEqual(f.calls.apply.map(n=>n.token),['token-1','token-2']);assert.equal(f.calls.applied[0].candidateId,'retried');f.editor.destroy();
});
test('one-click background old finally cannot release a newly applying resize transaction',async()=>{
 const old=deferred(),next=deferred(),f=fixture();let applyCount=0;f.core.apply=()=>++applyCount===1?old.promise:next.promise;const background=f.editor.open('background-remove','F');await flush();await f.editor.cancel();await f.editor.open('resize','F');const resized=f.editor.apply();old.resolve({candidateId:'stale',image:PNG,width:1200,height:800,operation:'background-remove'});await background;assert.equal(f.editor.getState().applying,true);assert.equal(f.editor.getState().active.tool,'resize');assert.equal(f.calls.applied.length,0);next.resolve({candidateId:'resized',image:PNG,width:1200,height:800,operation:'resize'});await resized;assert.equal(f.calls.applied[0].candidateId,'resized');f.editor.destroy();
});
test('markup bounds validator accepts exact server limits and rejects overflow or invalid scalar/coordinates',()=>{
 const dot={points:[{x:1199,y:799}],color:'#b34422',width:256,opacity:0},line={...dot,points:Array.from({length:4096},(_,i)=>({x:i%1200,y:0}))};assert.deepEqual(api.MARKUP_LIMITS,{strokes:128,pointsPerStroke:4096,totalPoints:16384});assert.equal(api.validateMarkup(Array.from({length:128},()=>dot),1200,800).valid,true);assert.equal(api.validateMarkup([line,line,line,line],1200,800).valid,true);
 const invalid=[Array.from({length:129},()=>dot),[{...line,points:[...line.points,{x:1,y:1}]}],[line,line,line,line,dot],...[-1,0,257,NaN,Infinity].map(width=>[{...dot,width}]),...[-.1,1.1,NaN].map(opacity=>[{...dot,opacity}]),...[{x:1201,y:1},{x:1,y:801},{x:NaN,y:0},{x:Infinity,y:0}].map(p=>[{...dot,points:[p]}])];for(const strokes of invalid)assert.equal(api.validateMarkup(strokes,1200,800).valid,false);assert.equal(api.validateMarkup([{...dot,width:1,opacity:1}],1200,800).valid,true);
});
test('markup bounds 129th stroke is rejected visibly, accepted preview stays intact, undo/reset recover without a request',async()=>{
 const f=fixture();await f.editor.open('markup','F');for(let i=0;i<128;i++)await stroke(f,[[160,120]]);await stroke(f,[[310,220]]);assert.match(f.editor.getState().message,/128개/);assert.equal(f.byText('적용').disabled,true);assert.equal(f.byText('다시 실행').disabled,true);await f.editor.open('comments','F');await f.editor.open('markup','F');assert.match(f.editor.getState().message,/128개/);await assert.rejects(f.editor.apply,/128개/);assert.equal(f.calls.apply.length,0);await f.byText('실행 취소').click();await f.editor.apply();assert.equal(f.calls.apply[0].options.strokes.length,128);assert.ok(f.calls.apply[0].options.strokes.every(s=>s.points[0].x===300));await f.editor.open('markup','F');const width=f.controls.querySelectorAll('input').find(n=>n.type==='range');width.value='257';await width.fire('input');await stroke(f);await assert.rejects(f.editor.apply,/1–256/);assert.equal(f.calls.apply.length,1);await f.byText('비우기').click();assert.equal(f.editor.getState().error,false);await f.editor.cancel();f.editor.destroy();
});
test('markup bounds long pointer stroke is rejected whole at 4097 points and preserves the prior complete stroke',async()=>{
 const f=fixture();await f.editor.open('markup','F');await stroke(f,[[160,120]]);const ctx=f.canvases[0].context;for(const name of ['arc','fill','moveTo','lineTo','stroke','clearRect'])ctx[name]=()=>{};await f.overlay.fire('pointerdown',{clientX:20,clientY:100});for(let i=1;i<=4096;i++)await f.overlay.fire('pointermove',{clientX:20+i%500,clientY:100});await f.overlay.fire('pointerup');assert.match(f.editor.getState().message,/4096/);await assert.rejects(f.editor.apply,/4096/);assert.equal(f.calls.apply.length,0);await f.byText('실행 취소').click();await f.editor.apply();assert.equal(f.calls.apply[0].options.strokes.length,1);assert.deepEqual(f.calls.apply[0].options.strokes[0].points,[{x:300,y:200}]);f.editor.destroy();
});
test('markup bounds right/bottom image edges preserve the original continuous corner coordinates',async()=>{
 const f=fixture();await f.editor.open('markup','F');await stroke(f,[[610,420]]);await f.editor.apply();assert.deepEqual(f.calls.apply[0].options.strokes[0].points,[{x:1200,y:800}]);assert.equal(api.validateMarkup(f.calls.apply[0].options.strokes,1200,800).valid,true);f.editor.destroy();
});
test('listener lifecycle stays bounded across comment typing, pan and resize while focus caret and IME stay intact',async()=>{
 const f=fixture();f.comments.set('F',Array.from({length:100},(_,i)=>({id:'c'+i,x:i/100,y:.5,text:'댓글 '+i})));await f.editor.open('comments','F');const area=f.controls.querySelectorAll('textarea')[0],firstPin=f.stage.querySelectorAll('.ppe-pin')[0],baseline=f.listenerStats.active;area.focus();area.selectionStart=area.selectionEnd=3;await area.fire('compositionstart');for(let i=0;i<40;i++){area.value='작성 중 '+i;await area.fire('input');f.stage.scrollLeft=i;await f.stage.fire('scroll');await f.win.fire('resize');assert.equal(f.stage.querySelectorAll('.ppe-pin').length,100);assert.equal(f.listenerStats.active,baseline,'detached pin listeners must be removed each render');assert.equal(f.doc.activeElement,area);assert.equal(area.selectionStart,3);assert.equal(area.selectionEnd,3);assert.equal(f.controls.querySelectorAll('textarea')[0],area);}assert.equal(firstPin.listeners.click.length,0);const ime=await f.doc.fire('keydown',{key:'Escape'});assert.equal(ime.defaultPrevented,undefined);assert.ok(f.editor.getState().active);await area.fire('compositionend');await f.editor.cancel();f.editor.destroy();assert.equal(f.listenerStats.active,0);
});
test('listener lifecycle cleans replaced tool bodies and comment lists through save delete and undo',async()=>{
 const f=fixture();await f.editor.open('comments','F');const initial=f.listenerStats.active,oldArea=f.controls.querySelectorAll('textarea')[0];for(let i=0;i<12;i++){await f.editor.open('markup','F');await stroke(f);await f.byText('실행 취소').click();await f.byText('다시 실행').click();await f.editor.open('resize','F');await f.editor.open('comments','F');assert.equal(f.listenerStats.active,initial);assert.equal(f.controls.querySelectorAll('textarea').length,1);}assert.equal(oldArea.listeners.input.length,0);assert.equal(oldArea.listeners.compositionstart.length,0);await f.overlay.fire('pointerdown',{clientX:310,clientY:220});const area=f.controls.querySelectorAll('textarea')[0];area.value='저장한 댓글';await area.fire('input');await f.byText('댓글 저장').click();const oldItem=f.controls.querySelectorAll('.ppe-comment-item')[0];await oldItem.click();area.value='수정한 댓글';await area.fire('input');await f.byText('댓글 저장').click();assert.equal(oldItem.listeners.click.length,0);await f.controls.querySelectorAll('.ppe-comment-item')[0].click();await f.byText('댓글 삭제').click();assert.equal(f.comments.get('F').length,0);assert.equal(f.listenerStats.active,initial);f.editor.destroy();await flush();assert.equal(f.listenerStats.active,0);
});
test('selected comment pin opens one nearby plain-text popover with bounded range and keyboard dismissal',async()=>{
 const f=fixture();f.comments.set('F',[{id:'pinned',x:.99,y:.02,text:'<b>수정 위치</b>'}]);await f.editor.open('comments','F');await f.stage.querySelectorAll('.ppe-pin')[0].click();const popup=f.controls.querySelectorAll('.ppe-pin-popover')[0];assert.ok(popup,'a selected pin needs a nearby popover');assert.equal(popup.hidden,false);assert.equal(popup.getAttribute('role'),'dialog');assert.match(popup.textContent,/<b>수정 위치<\/b>/);const range=popup.querySelectorAll('input').find(n=>n.type==='range');assert.equal(range.min,'2');assert.equal(range.max,'40');assert.equal(range.value,'12');assert.equal(f.stage.querySelectorAll('.ppe-pin')[0].getAttribute('aria-expanded'),'true');range.value='20';await range.fire('input');assert.match(popup.textContent,/20%/);await popup.fire('keydown',{key:'Escape'});assert.equal(popup.hidden,true);assert.ok(f.editor.getState().active,'dismissal preserves comment editing');f.editor.destroy();assert.equal(f.listenerStats.active,0);
});
test('pin handoff ends the comment transaction and keeps a fixed visible prepared range for the same candidate',async()=>{
 let input,result;const f=fixture({preparePinnedEdit:async(token,point)=>{input={token,point};return {candidateId:'F',...point,width:1200,height:800,sourceRevision:'prepared'};}});f.host.onPinnedEdit=value=>result=value;await f.editor.open('comments','F');await f.overlay.fire('pointerdown',{clientX:310,clientY:220});assert.equal(f.stage.querySelectorAll('.ppe-pin-draft')[0].textContent,'1');const area=f.controls.querySelectorAll('textarea')[0];area.value='이 머리색을 파랗게';await area.fire('input');const popup=f.controls.querySelectorAll('.ppe-pin-popover')[0],prepare=popup.querySelectorAll('button').find(n=>n.textContent==='수정 요청 작성');assert.ok(prepare,'pin needs explicit preparation');await prepare.click();assert.deepEqual(input.point,{x:.5,y:.5,radius:.12});assert.equal(result.text,'이 머리색을 파랗게');assert.equal(f.editor.getState().active,null);assert.equal(f.editor.getState().pinnedEdit.radius,.12);assert.equal(f.stage.querySelectorAll('.ppe-pin-draft')[0].textContent,'1');assert.equal(popup.querySelectorAll('input')[0].disabled,true,'prepared range is fixed until comment mode is reopened');f.host.getSourceRevision=()=>'changed-mask-revision';f.editor.render();assert.equal(f.editor.getState().pinnedEdit,null);f.editor.destroy();
});
test('pin popover owns the existing memo input and closes with a browser-like NodeList',async()=>{
 const f=fixture();await f.editor.open('comments','F');await f.overlay.fire('pointerdown',{clientX:310,clientY:220});const input=f.controls.querySelectorAll('textarea')[0],popup=[...f.stage.querySelectorAll('.ppe-pin-popover'),...f.controls.querySelectorAll('.ppe-pin-popover')][0];assert.equal(popup.contains(input),true,'nearby popover must contain the real memo input');const pins=f.stage.querySelectorAll('.ppe-pins')[0],query=pins.querySelectorAll.bind(pins);pins.querySelectorAll=selector=>{const rows=query(selector);return {length:rows.length,[Symbol.iterator]:()=>rows[Symbol.iterator]()};};await popup.fire('keydown',{key:'Escape'});assert.equal(popup.hidden,true);f.editor.destroy();
});
test('compact pin popover reuses comment actions and collapsed range while hiding only non-error lower chrome',async()=>{
 const f=fixture({saveComment:async()=>{throw Error('저장 오류');}});await f.editor.open('comments','F');await f.overlay.fire('pointerdown',{clientX:310,clientY:220});const popup=f.controls.querySelectorAll('.ppe-pin-popover')[0];for(const text of ['댓글 저장','댓글 삭제','새 댓글'])assert.equal(popup.contains(f.byText(text)),true,text);const area=f.controls.querySelectorAll('textarea')[0];assert.equal(area.rows,2);assert.equal(f.controls.querySelectorAll('.ppe-body')[0].hidden,true);assert.equal(f.controls.querySelectorAll('.ppe-actions')[0].hidden,true);assert.equal(Boolean(popup.querySelectorAll('.ppe-pin-range')[0].open),false);area.value='오류도 보여야 해요';await area.fire('input');await f.byText('댓글 저장').click();const status=f.controls.querySelectorAll('.ppe-status')[0];assert.equal(status.hidden,false);assert.match(status.textContent,/저장 오류/);f.editor.destroy();
});

test('unavailable capability keeps the photo menu present with a disabled reason and no begin',async()=>{
 const f=fixture({getState:()=>({locked:false,capabilitySource:'snapshot',operations:{'background-remove':{ready:false,reason:'Fixture helper not installed'},resize:{ready:true}}})});
 const button=f.controls.querySelectorAll('button').find(node=>node.dataset.ppeTool==='background-remove');
 assert(button);assert.equal(button.disabled,true);assert.match(button.getAttribute('title'),/Fixture helper not installed/);await button.click();assert.equal(f.calls.begin.length,0);
 assert.equal(f.controls.querySelectorAll('button').find(node=>node.dataset.ppeTool==='resize').disabled,false);f.editor.destroy();
});

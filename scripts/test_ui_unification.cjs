'use strict';
// Real app, workflow and redesign state transitions with controlled browser I/O.
// The structural DOM below parses our template; it does not measure CSS/layout.
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const filename = path.join(__dirname, 'test_ui_state.cjs');
const source = readFileSync(filename, 'utf8');
const boundary = source.indexOf("\ntest('selected model preset reaches");
if (boundary < 0) throw Error('Review changed UI harness boundary');
const harness = new Module(filename, module); harness.filename = filename; harness.paths = module.paths;
harness._compile(source.slice(0, boundary) + '\nmodule.exports={test,assert,page,settle,until,RED,WHITE};', filename);
const {test,assert,page,settle,until,RED,WHITE} = harness.exports;

function structuralDOM(ui) {
  const doc = ui.sandbox.document, proto = Object.getPrototypeOf(doc.body);
  const create = doc.createElement, setAttribute = proto.setAttribute;
  const decode = text => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[name]));
  const descendants = node => node.children.flatMap(child => child.tagName ? [child,...descendants(child)] : []);
  const dataKey = name => name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
  function matches(node, selector) {
    const parts = selector.trim().split(/\s+(?![^\[]*\])/);
    const simple = parts.pop();
    if (!simple || !node.tagName) return false;
    const tag = simple.match(/^[\w*-]+/)?.[0];
    if (tag && tag !== '*' && node.tagName.toLowerCase() !== tag) return false;
    for (const [,id] of simple.matchAll(/#([\w-]+)/g)) if (node.id !== id) return false;
    for (const [,name] of simple.matchAll(/\.([\w-]+)/g)) if (!node.classList.contains(name)) return false;
    for (const [,name,quoted,single,raw] of simple.matchAll(/\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]/g)) {
      const actual = node.getAttribute(name), wanted = quoted ?? single ?? raw;
      if (actual === null || wanted !== undefined && actual !== wanted) return false;
    }
    if (!parts.length) return true;
    let parent = node.parentNode;
    while (parent) { if (matches(parent, parts.join(' '))) return true; parent = parent.parentNode; }
    return false;
  }
  function parse(parent, html) {
    parent.replaceChildren();
    const stack = [parent], voids = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
    for (const [token] of String(html).matchAll(/<!--[\s\S]*?-->|<![^>]*>|<\/?[^>]+>|[^<]+/g)) {
      if (token.startsWith('<!')) continue;
      if (token.startsWith('</')) { stack.pop(); continue; }
      if (!token.startsWith('<')) { stack.at(-1)._text += decode(token); continue; }
      const tag = token.match(/^<([\w-]+)/)?.[1]; if (!tag) continue;
      const attrs = Array.from(token.slice(tag.length + 1).matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+)))?/g), m => [m[1],decode(m[2] ?? m[3] ?? m[4] ?? '')]);
      const id = attrs.find(([name]) => name === 'id')?.[1];
      const node = id ? ui.element(id) : doc.createElement(tag); node.tagName = tag.toUpperCase();
      node.replaceChildren(); node.style.setProperty ||= function(name,value){this[name]=value;};
      for (const [name,value] of attrs) node.setAttribute(name,value);
      stack.at(-1).append(node);
      if (!voids.has(tag) && !token.endsWith('/>')) stack.push(node);
    }
  }
  proto.setAttribute = function(name,value) {
    setAttribute.call(this,name,value);
    if (name === 'class') this.className = value;
    else if (name.startsWith('data-')) this.dataset[dataKey(name)] = String(value);
    else if (['hidden','disabled','checked','open','selected'].includes(name)) this[name] = true;
    else if (['id','src','href','type','download'].includes(name)) this[name] = String(value);
    else if (name === 'for') this.htmlFor = String(value);
    else if (name === 'value' && !this.value) this.value = String(value);
  };
  proto.getAttribute = function(name) {
    if (name === 'class') return this.className;
    if (name === 'id') return this.id || null;
    if (name === 'for') return this.htmlFor ?? null;
    if (name.startsWith('data-')) return this.dataset[dataKey(name)] ?? null;
    return this.attributes[name] ?? null;
  };
  proto.appendChild = function(child) { child.remove?.(); child.parentNode=this; this.children.push(child); return child; };
  proto.prepend = function(...children) { for (const child of children.reverse()) { child.remove?.(); child.parentNode=this; this.children.unshift(child); } };
  proto.insertBefore = function(child,before) { child.remove?.();const index=this.children.indexOf(before);child.parentNode=this;if(index<0)this.children.push(child);else this.children.splice(index,0,child);return child; };
  Object.defineProperty(proto,'nextSibling',{configurable:true,get(){return this.parentNode?.children[this.parentNode.children.indexOf(this)+1]||null;}});
  proto.querySelectorAll = function(selector) { return descendants(this).filter(node => selector.split(',').some(part=>matches(node,part))); };
  proto.querySelector = function(selector) { return this.querySelectorAll(selector)[0] || null; };
  proto.closest = function(selector) { return selector.split(',').some(part=>matches(this,part.trim())) ? this : this.parentNode?.closest(selector) || null; };
  proto.hasAttribute = function(name) { return this.getAttribute(name)!==null; };
  proto.setSelectionRange = function(start,end) { this.selectionStart=start; this.selectionEnd=end; };
  proto.requestSubmit = function() { return this.dispatchEvent(new ui.sandbox.Event('submit',{bubbles:true})); };
  // Capture precedes native onclick mutations; the event path stays fixed.
  const addListener=proto.addEventListener,removeListener=proto.removeEventListener,captures=new WeakMap();
  proto.addEventListener=function(type,listener,options){if(options===true||options?.capture){let events=captures.get(this);if(!events)captures.set(this,events=new Map());if(!events.has(type))events.set(type,[]);events.get(type).push(listener);}else addListener.call(this,type,listener,options);};
  proto.removeEventListener=function(type,listener,options){if(options===true||options?.capture){const events=captures.get(this);events?.set(type,(events.get(type)||[]).filter(fn=>fn!==listener));}else removeListener.call(this,type,listener,options);};
  proto.dispatchEvent=function(event){
    const eventPath=[];for(let node=this;node;node=node.parentNode)eventPath.push(node);event.target||=this;event.composedPath=()=>eventPath.slice();let stopped=false,immediate=false;const results=[];
    event.stopPropagation=()=>{stopped=true;};event.stopImmediatePropagation=()=>{stopped=true;immediate=true;};
    const invoke=(node,capture)=>{event.currentTarget=node;if(!capture&&node['on'+event.type])results.push(node['on'+event.type](event));for(const listener of capture?captures.get(node)?.get(event.type)||[]:node.listeners?.get(event.type)||[]){if(immediate)break;results.push(listener(event));}};
    for(const node of eventPath.slice().reverse()){invoke(node,true);if(stopped)break;}
    if(!stopped)for(const node of eventPath){invoke(node,false);if(stopped||!event.bubbles&&event.type!=='click')break;}
    return Promise.all(results);
  };
  Object.defineProperty(proto,'innerHTML',{configurable:true,get(){return this._html || '';},set(value){this._html=String(value);parse(this,value);}});
  Object.defineProperty(proto,'selectedOptions',{get(){return this.querySelectorAll('option').filter(node=>node.value===this.value);}});
  doc.createElement = tag => { const node=create(tag);node.style.setProperty=function(name,value){this[name]=value;};return node; };
  doc.querySelectorAll = selector => doc.body.querySelectorAll(selector);
  doc.querySelector = selector => doc.querySelectorAll(selector)[0] || null;
  doc.getElementById = id => {
    const find = node => { for (const child of node.children) { if (!child.tagName) continue; if (child.id === id) return child; const found=find(child); if(found) return found; } return null; };
    return find(doc.body);
  };
  const template=readFileSync(path.join(__dirname,'../web/src/index.template.html'),'utf8');
  parse(doc.body,template.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1].replace(/<script\b[\s\S]*?<\/script>/g,''));
  doc.body.dataset.studioScreen='home';
  const observers=[];
  ui.flushMutations=node=>{for(const entry of observers)if(entry.node===node)entry.callback();};
  ui.sandbox.MutationObserver=class {constructor(callback){this.callback=callback;}observe(node,options){observers.push({node,options,callback:this.callback});}};
  ui.sandbox.ResizeObserver=class {observe(){}};
  doc.body.dataset=new Proxy(doc.body.dataset,{set(target,key,value){const changed=target[key]!==value;target[key]=value;if(changed)queueMicrotask(()=>{for(const entry of observers)if(entry.node===doc.body&&entry.options.attributeFilter.includes('data-studio-screen'))entry.callback();});return true;}});
  return doc;
}

async function mounted({twoCandidates=false,storageEstimate,projectStore,initialProject=true,waitProjectReady=true}={}) {
  const ui=page({autoJobs:true}); await until(()=>ui.studio().getSummary().modelsReady,'model catalog');
  const projectCalls={persistCurrent:0,load:0,newProject:0};
  if(storageEstimate)ui.sandbox.navigator={storage:{estimate:storageEstimate}};
  const doc=structuralDOM(ui);
  if(projectStore){
    await ui.studio().ready;
    if(initialProject)await ui.studio().importProject(ui.project('Library A'));
    else assert.equal(ui.studio().resetProject(),true,'empty-catalog fixture starts with the production empty brief');
    if(initialProject&&!projectStore.state.records.length){
      projectStore.state.activeId='fixture-legacy-a';projectStore.state.records=[{id:'fixture-legacy-a',raw:ui.studio().exportProject(),createdAt:'2026-10-27T00:00:00.000Z',updatedAt:'2026-10-27T00:00:00.000Z',favorite:false,recovered:false}];
    }
    const library=require('../web/src/project-library.js');
    ui.sandbox.PankekiProjectLibrary={create:options=>library.create({...options,store:projectStore,
      persistCurrent:raw=>{projectCalls.persistCurrent++;return options.persistCurrent(raw);},
      load:raw=>{projectCalls.load++;return options.load(raw);},
      newProject:()=>{projectCalls.newProject++;return options.newProject();}})};
  }
  for (const name of ['redesign.js','studio.js']) vm.runInContext(readFileSync(path.join(__dirname,'../web/src',name),'utf8'),ui.sandbox,{filename:name});
  const assets=doc.createElement('script');assets.id='redesignAssets';assets.textContent=JSON.stringify({images:{'catgirl-hero':'/template.png'},icons:{}});doc.body.append(assets);
  const controller=ui.sandbox.PankekiRedesign.mount(doc,ui.studio(),ui.sandbox.PankekiWorkflowController);
  if(projectStore){if(waitProjectReady){await until(()=>controller.projects.getState().initialized,'project catalog');await controller.projects.flush();}return {...ui,doc,controller,projectCalls};}
  const project=ui.project('Actual project');
  if(twoCandidates)project.versions.push({...project.versions[0],id:'second',label:'Second candidate'});
  await ui.studio().importProject(project);
  ui.studio().setMode('inpaint');
  await ui.input('editOperation','recolor');
  ui.element('paint').snapshot=WHITE;
  await settle();
  return {...ui,doc,controller};
}

// Only the external persistence boundary is replaced; production project rows,
// navigation, host capture/load and revision checks run unchanged.
class CatalogStore {
  constructor(){this.state={revision:0,activeId:null,records:[]};}
  async read(){return structuredClone(this.state);}
  async commit(change){
    assert.equal(change.expectedRevision,this.state.revision);
    const rows=new Map(this.state.records.map(row=>[row.id,structuredClone(row)]));
    for(const id of change.remove||[])rows.delete(id);
    for(const row of change.put||[])rows.set(row.id,structuredClone(row));
    this.state={revision:this.state.revision+1,activeId:Object.hasOwn(change,'activeId')?change.activeId:this.state.activeId,records:[...rows.values()]};
    return {revision:this.state.revision,activeId:this.state.activeId};
  }
}

test('settings opened from recolor/export offers completion instead of a second execution footer',async()=>{
  const ui=await mounted();ui.controller.go('export');
  const before=ui.studio().exportProject(),count=ui.requests.length;
  ui.controller.settings();const drawer=ui.doc.getElementById('pkSettings');
  assert.equal(drawer.open,true);
  assert.equal(drawer.querySelector('.generate-dock').hidden,true,'original generation footer must be hidden');
  assert.equal(ui.element('candidateCount').closest('.generate-dock'),null,'candidate count remains an available setting');
  assert.equal(ui.element('candidateCount').closest('#pcModelPanel')?.id,'pcModelPanel');
  assert.match(ui.doc.getElementById('pkSettingsTitle').textContent,/이미지 생성 설정/);
  const done=drawer.querySelector('.pk-settings-done[data-pk-close]');assert(done,'explicit settings Done control');
  assert.equal(done.type,'button');assert.equal(done.textContent,'설정 완료');
  await done.click();assert.equal(drawer.open,false);
  ui.controller.settings('brief');assert.match(ui.doc.getElementById('pkSettingsTitle').textContent,/캐릭터 설정/);
  await drawer.querySelector('.pk-dialog-heading [data-pk-close]').click();assert.equal(drawer.open,false);
  assert.equal(ui.studio().exportProject(),before);assert.equal(ui.requests.length,count);
});

test('local profile opens independently and saves only a local display name',async()=>{
  const ui=await mounted(),before=ui.studio().exportProject(),purpose=ui.element('profile').value,name=ui.element('name').value,writes=[];
  ui.sandbox.localStorage.setItem=(key,value)=>writes.push([key,value]);
  const avatar=ui.doc.querySelector('.pk-avatar');avatar.focus();await avatar.click();
  const popup=ui.doc.getElementById('pcProfilePopover');assert(popup,'dedicated local profile');assert.equal(popup.hidden,false);assert.match(popup.textContent,/로컬 프로필/);assert.equal(ui.doc.getElementById('pkLibrary').open,undefined);
  const input=ui.doc.getElementById('pcLocalProfileName');input.value='내 작업실';await input.dispatchEvent(new ui.sandbox.Event('compositionstart'));await popup.querySelector('form').requestSubmit();assert.equal(writes.length,0,'IME confirmation is not profile save');await input.dispatchEvent(new ui.sandbox.Event('compositionend'));await popup.querySelector('form').requestSubmit();
  assert.deepEqual(writes,[['pankeki-local-profile-name','내 작업실']]);assert.equal(ui.element('name').value,name);assert.equal(ui.element('profile').value,purpose);assert.equal(ui.studio().exportProject(),before);
  await ui.doc.dispatchEvent(new ui.sandbox.Event('keydown',{key:'Escape',target:input}));assert.equal(popup.hidden,true);assert.equal(ui.doc.activeElement,avatar);
  await avatar.click();await input.dispatchEvent(new ui.sandbox.Event('compositionstart'));await ui.doc.dispatchEvent(new ui.sandbox.Event('click',{target:ui.doc.body}));await avatar.click();ui.sandbox.localStorage.setItem=()=>{throw Error('storage unavailable');};input.value='저장 실패';await popup.querySelector('form').requestSubmit();assert.match(ui.doc.getElementById('pcLocalProfileStatus').textContent,/저장하지 못/);assert.equal(popup.querySelector('.pc-local-identity strong').textContent,'내 작업실');
  await ui.doc.querySelector('[data-pk-action="notifications"]').click();assert.equal(popup.hidden,true);assert.equal(ui.doc.getElementById('pcNotifications').hidden,false);await ui.doc.dispatchEvent(new ui.sandbox.Event('click',{target:ui.doc.body}));assert.equal(ui.doc.getElementById('pcNotifications').hidden,true);
});

test('settings category switches retain original controls and deep links reveal their fields',async()=>{
  const ui=await mounted(),before=ui.studio().exportProject(),ids=['width','height','seed','steps','cfg','denoise','sampler','scheduler','negative','cache','previewOn','clearCache','roi','halo','feather','candidateCount','profile','designDetail','notes','palette1','palette2','palette3'];
  const originals=new Map(ids.map(id=>[id,ui.element(id)])),values=new Map(ids.map(id=>[id,[ui.element(id).value,ui.element(id).checked]]));
  ui.controller.settings('environment');const drawer=ui.doc.getElementById('pkSettings');assert.equal(drawer.dataset.panel,'environment');assert.equal(ui.element('cache').closest('[data-pk-settings-section]').hidden,false);
  await drawer.querySelector('[data-pk-panel="edit"]').click();assert.equal(ui.element('denoise').closest('[data-pk-settings-section]').hidden,false);assert.equal(ui.element('cache').closest('[data-pk-settings-section]').hidden,true);
  ui.controller.settings('model','steps');await settle();assert.equal(drawer.dataset.panel,'model');assert.equal(ui.doc.querySelector('.pc-more-settings').open,true);assert.equal(ui.doc.activeElement,ui.element('steps'));
  const tabs=drawer.querySelector('[role="tablist"]');await tabs.dispatchEvent(new ui.sandbox.Event('keydown',{key:'End'}));assert.equal(drawer.dataset.panel,'brief');await tabs.dispatchEvent(new ui.sandbox.Event('keydown',{key:'Home'}));assert.equal(drawer.dataset.panel,'chat');
  for(const id of ids){assert.equal(ui.element(id),originals.get(id),id+' same DOM');assert.deepEqual([ui.element(id).value,ui.element(id).checked],values.get(id),id+' same setting');assert.equal(ui.doc.querySelectorAll('#'+id).length,1,id+' unique');}
  assert.equal(ui.studio().exportProject(),before);assert.equal(ui.requests.length,0);
});

test('compare hides composers and edit tools, blocks submissions, and restores edit state on return',async()=>{
  const ui=await mounted({twoCandidates:true});
  await ui.input('prompt','Keep the scarf shape');await ui.input('targetColorValue','#00AAFF');
  for(const id of ['parent','second'])await ui.doc.querySelector(`[data-candidate-id="${id}"] [data-action="compare"]`).click();
  const before=ui.studio().exportProject(),source=ui.state().sourceDataURL,mask=ui.element('paint').snapshot;
  const useBrief=ui.element('useBrief').checked;
  ui.controller.go('compare');
  assert.equal(ui.element('comparePanel').hidden,false);assert.equal(ui.element('compareGrid').querySelectorAll('figure').length,2);
  assert.equal(ui.doc.querySelector('.pk-composer-dock').hidden,true,'compare has no composer');
  assert.equal(ui.doc.querySelector('.pk-composer-dock').inert,true);
  assert.equal(ui.doc.querySelector('.pk-categories').hidden,true);
  assert.equal(ui.element('editorTools').hidden,true,'mask toolbar is hidden in compare');
  await ui.doc.getElementById('pkPromptForm').requestSubmit();
  assert.equal(ui.requests.length,0,'hidden form cannot create a job');
  ui.controller.go('inpaint');
  assert.equal(ui.doc.querySelector('.pk-composer-dock').hidden,false);
  assert.equal(ui.doc.querySelector('.pk-composer-dock').inert,false);
  assert.equal(ui.element('editorTools').hidden,false);
  assert.equal(ui.element('inpaintOperations').hidden,false);
  assert.equal(ui.element('targetColorValue').value,'#00AAFF');assert.equal(ui.element('prompt').value,'Keep the scarf shape');
  assert.equal(ui.studio().getSummary().editOperation,'recolor');
  assert.equal(ui.element('useBrief').checked,useBrief);
  assert.equal(ui.state().sourceDataURL,source);assert.equal(ui.element('paint').snapshot,mask);
  assert.equal(ui.studio().exportProject(),before);assert.equal(ui.requests.length,0);
  await ui.doc.getElementById('pkPromptForm').requestSubmit();
  assert.equal(ui.requests.length,1,'restored edit composer executes its real operation');
  assert.equal(ui.requests[0].body.request.edit_operation,'recolor');
  assert.equal(ui.requests[0].body.request.target_color,'#00AAFF');
  assert.equal(ui.requests[0].body.request.source,source);assert.equal(ui.requests[0].body.request.mask,mask);
  ui.controller.go('design');assert.equal(ui.doc.querySelector('.pk-composer-dock').hidden,false);
  assert.equal(ui.doc.querySelector('.pk-categories').hidden,false);
});

test('all routes retain ten sidebar items and image edit or compare activates image generation',async()=>{
  const ui=await mounted(),nav=ui.doc.querySelector('.pk-navigation');
  const expected=['홈','프로젝트','이미지 생성','부위 편집','표정 · 동작','출력','갤러리','템플릿','모델 관리','설정'];
  for(const screen of ['home','projects','design','inpaint','compare','parts','motion','export']){
    ui.controller.go(screen);
    assert.deepEqual(nav.querySelectorAll('button').map(node=>node.getAttribute('aria-label')),expected);
    assert.equal(nav.querySelector('.pk-gallery-nav').hidden,false);
    const active=nav.querySelectorAll('[aria-current="page"]');assert.equal(active.length,1);
    assert.equal(active[0].dataset.pkRoute,['inpaint','compare'].includes(screen)?'design':screen);
    assert.equal(active[0].classList.contains('active'),true);
  }
  assert.equal(ui.requests.length,0);
});

test('home keeps its brand hero and six recommendations while existing candidate gallery remains reachable',async()=>{
  const ui=await mounted({twoCandidates:true}),hero=ui.doc.querySelector('.pc-home-hero');
  ui.controller.go('home');
  assert(hero,'brand composition instead of giant project card');assert.notEqual(hero.querySelector('img').src,RED);assert.match(hero.querySelector('h1').textContent,/상상하는 캐릭터/);
  assert.equal(ui.doc.querySelector('.pk-home-templates').querySelectorAll('[data-pk-template]').length,6);
  assert.match(ui.doc.getElementById('pcHomeProjectSummary').textContent,/일반 생성 기록/);assert.match(ui.doc.getElementById('pcHomeCandidateSummary').textContent,/현재 후보 2개/);assert.match(ui.doc.getElementById('pcProjectLibraryHeading').textContent,/프로젝트 목록/);
  assert.equal(ui.doc.getElementById('pkSearch').placeholder,'프로젝트·현재 후보 검색…');assert.match(ui.doc.querySelector('label[for=pkSearch]').textContent,/프로젝트 이름과 현재 후보/);assert.match(ui.doc.querySelector('.pc-home-projects [data-pk-action=gallery]').textContent,/현재 후보 보기/);
  ui.doc.getElementById('pkSearch').value='Second candidate';await ui.doc.getElementById('pkSearch').dispatchEvent(new ui.sandbox.Event('input'));await ui.doc.querySelector('[data-pk-action="gallery"]').click();assert.equal(ui.doc.querySelector('.pk-gallery-dialog').open,true);assert.equal(ui.doc.activeElement.dataset.candidateId,undefined);await ui.doc.getElementById('gallery').querySelector('[data-candidate-id="second"] [data-action=view]').click();assert.equal(ui.doc.getElementById('workspace').dataset.candidateId,'second');
  ui.studio().resetProject();ui.controller.go('home');
  assert.equal(ui.doc.querySelectorAll('.pc-home-recent-item').length,0);assert.equal(ui.doc.querySelector('.pk-home-templates').querySelectorAll('[data-pk-template]').length,6);
  assert.equal(ui.requests.length,0);
});

test('candidate gallery and image card accessibility distinguish same-name work by original order after reload',async()=>{
  const ui=await mounted(),project=ui.project('Actual duplicates');project.versions[0].label='같은 후보';project.versions.push({...project.versions[0],id:'second',label:'같은 후보'},{...project.versions[0],id:'third',label:'같은 후보'});
  await ui.studio().importProject(project);ui.controller.go('home');
  const rows=ui.doc.getElementById('gallery').querySelectorAll('[data-action=view]');assert.equal(rows.length,3);assert.equal(new Set(rows.map(row=>row.getAttribute('aria-label'))).size,3);
  for(const [id,number] of [['third',3],['second',2],['parent',1]]){const row=ui.doc.getElementById('gallery').querySelector(`[data-candidate-id="${id}"]`);assert(row,id);assert.match(row.textContent,new RegExp('후보 '+number));assert.match(row.querySelector('[data-action=view]').getAttribute('aria-label'),new RegExp('후보 '+number));}
  const search=ui.doc.getElementById('pkSearch');search.value='같은 후보';await search.dispatchEvent(new ui.sandbox.Event('input'));await ui.doc.querySelector('[data-pk-action="gallery"]').click();await ui.doc.getElementById('gallery').querySelector('[data-candidate-id="second"] [data-action=view]').click();assert.equal(ui.doc.getElementById('workspace').dataset.candidateId,'second');
  project.versions.push({...project.versions[0],id:'fourth'},{...project.versions[0],id:'fifth'});await ui.studio().importProject(project);ui.controller.go('home');
  assert.equal(ui.doc.getElementById('gallery').querySelectorAll('[data-action=view]').length,5);assert.match(ui.doc.getElementById('gallery').querySelector('[data-candidate-id="fifth"] [data-action=view]').getAttribute('aria-label'),/후보 5/);
  await ui.studio().importProject(ui.studio().exportProject());ui.controller.go('home');assert.match(ui.doc.getElementById('gallery').querySelector('[data-candidate-id="second"] [data-action=view]').getAttribute('aria-label'),/후보 2/);assert.match(ui.doc.querySelector('[data-pc-candidate="second"].pc-image-open').getAttribute('aria-label'),/후보 2/);assert.equal(ui.requests.length,0);
});
test('home audit storage labels real browser estimates as browser scope',async()=>{
  let estimates=0;const ui=await mounted({storageEstimate:async()=>{estimates++;return {usage:19600000,quota:1756300000000};}});ui.controller.go('home');
  const text=ui.doc.getElementById('pkStorageText'),storage=ui.doc.querySelector('.pk-storage');assert.equal(text.textContent,'약 19.6 MB 사용');assert.doesNotMatch(text.textContent,/GB|한도/);assert.match(storage.getAttribute('title'),/1756\.3 GB 추정 한도/);assert.match(storage.getAttribute('aria-label'),/브라우저.*앱 전용 확보 공간이나 기기 전체 여유 공간을 뜻하지 않습니다/);assert.equal(ui.doc.getElementById('pkStorageBar').hidden,false);assert.equal(ui.doc.getElementById('pkStoragePercent').textContent,'0%');assert.equal(estimates,1);
});
test('home audit unavailable storage remains unknown',async()=>{const unavailable=await mounted({storageEstimate:async()=>{throw Error('unavailable');}});assert.equal(unavailable.doc.getElementById('pkStorageBar').hidden,true);assert.match(unavailable.doc.getElementById('pkStorageText').textContent,/확인할 수 없/);});
test('home audit actual zero storage remains a valid measured number',async()=>{const empty=await mounted({storageEstimate:async()=>({usage:0,quota:1000000000})});assert.equal(empty.doc.getElementById('pkStorageBar').hidden,false);assert.equal(empty.doc.getElementById('pkStoragePercent').textContent,'0%');assert.equal(empty.doc.getElementById('pkStorageText').textContent,'약 0.0 MB 사용');assert.match(empty.doc.querySelector('.pk-storage').getAttribute('title'),/1\.0 GB 추정 한도/);});

test('project library host waits for restore decode and preserves legacy raw across superseded or failed boot',async()=>{
  const restored=page({holdRestore:true});restored.heldImages.add(RED);await until(()=>restored.restores.length===1,'legacy read pending');
  assert.equal(typeof restored.studio().ready?.then,'function');let ready=false;restored.studio().ready.then(()=>ready=true);
  const raw=JSON.stringify(restored.project('Restore source'));restored.restores[0].resolve(raw);await until(()=>restored.images.get(RED)?.length>0,'decode pending');assert.equal(ready,false);await restored.decode(RED);
  const result=await restored.studio().ready;assert.equal(result.ok,true);assert.equal(result.reason,'restored');assert.equal(result.legacyRead,true);assert.equal(result.legacyRaw,raw);assert.equal(restored.studio().getSummary().importing,false);
  const superseded=page({holdRestore:true});await until(()=>superseded.restores.length===1,'second legacy read');const old=JSON.stringify(superseded.project('Old source'));await superseded.input('projectName','Live edit');superseded.restores[0].resolve(old);const skipped=await superseded.studio().ready;assert.equal(skipped.reason,'superseded');assert.equal(skipped.legacyRaw,old);assert.equal(superseded.studio().getSummary().name,'Live edit');
  const decoding=page({holdRestore:true});decoding.heldImages.add(RED);await until(()=>decoding.restores.length===1,'late legacy read');decoding.restores[0].resolve(old);await until(()=>decoding.images.get(RED)?.length>0,'late decode pending');await decoding.input('projectName','Edit during decode');await decoding.decode(RED);const late=await decoding.studio().ready;assert.equal(late.reason,'superseded');assert.equal(late.legacyRaw,old);assert.equal(late.ok,true);assert.equal(decoding.studio().getSummary().name,'Edit during decode');
  const invalid=page({holdRestore:true});await until(()=>invalid.restores.length===1,'invalid legacy read');const broken='{"version":99}';invalid.restores[0].resolve(broken);const failure=await invalid.studio().ready;assert.equal(failure.ok,false);assert.equal(failure.legacyRead,true);assert.equal(failure.legacyRaw,broken);assert.equal(failure.stage,'import');
  const empty=page({holdRestore:true});await until(()=>empty.restores.length===1,'empty legacy read');empty.restores[0].resolve(undefined);const blank=await empty.studio().ready;assert.equal(blank.reason,'empty');assert.equal(blank.legacyRead,true);assert.equal(blank.legacyRaw,null);
});
test('project library host routes original file new and v1 save through one optional action contract',async()=>{
  const ui=page();await ui.studio().ready;const calls=[],raw=JSON.stringify(ui.project('Opened file'));
  const unbind=ui.studio().setProjectActions({importProject:async value=>{calls.push(['import',value]);return false;},newProject:async()=>{calls.push(['new']);return false;},saveCurrent:async()=>{calls.push(['save']);return true;}});
  ui.element('loadProject').files=[{size:raw.length,text:async()=>raw}];await ui.element('loadProject').onchange();assert.deepEqual(calls,[['import',raw]]);await ui.element('newProject').onclick();assert.deepEqual(calls[1],['new']);
  await ui.element('saveProject').onclick();assert.equal(calls.filter(value=>value[0]==='save').length,1);assert.equal(ui.downloads.length,1);assert.equal(ui.studio().getSummary().candidateCount,0);
  unbind();assert.equal(await ui.studio().requestImportProject(raw),true);assert.equal(ui.studio().getSummary().candidateCount,1);assert.equal(await ui.studio().requestNewProject(),true);assert.equal(ui.studio().getSummary().candidateCount,0);
});

test('sidebar projects navigates to the dedicated page without saving or replacing the current work',async()=>{
  const store=new CatalogStore(),ui=await mounted({projectStore:store});
  ui.controller.go('inpaint');
  const input=ui.doc.getElementById('pcPrompt');input.value='보존할 미전송 초안';input.setSelectionRange(2,6);
  await input.dispatchEvent(new ui.sandbox.Event('input',{bubbles:true}));
  assert.equal(await ui.controller.projects.saveCurrent(),true);await ui.controller.projects.flush();
  const raw=ui.studio().exportProject(),saved=JSON.stringify(store.state),calls={...ui.projectCalls},activeId=ui.controller.projects.getState().activeId,mode=ui.studio().getSummary().mode;
  const nav=ui.doc.querySelector('.pk-navigation'),projects=nav.querySelector('[data-pk-route=projects]');projects.focus();await projects.click();
  assert.equal(ui.doc.body.dataset.studioScreen,'projects');assert.equal(ui.doc.querySelector('.pk-layout').dataset.screen,'projects');
  const page=ui.doc.querySelector('[data-studio-page=projects]');assert(page,'workflow owns a real projects page');assert.equal(page.hidden,false);
  const heading=page.querySelector('[data-studio-heading=projects]');assert.equal(heading?.textContent,'프로젝트');
  assert.equal(ui.doc.querySelectorAll('dialog').some(node=>node.open),false,'projects entry has no popup');
  assert.equal(page.querySelectorAll('.pc-project-open').length,1);
  const row=page.querySelector('.pc-project-open');assert.match(row.textContent,/Library A/);assert.match(row.textContent,/후보 1개/);assert.match(row.textContent,/\d{2}\D+\d{2}/,'actual modified time is presented');
  assert.equal(row.querySelector('img')?.src,RED);assert.match(row.textContent,/사용 중/);
  assert.equal(projects.getAttribute('aria-current'),'page');
  assert.equal(nav.querySelectorAll('[aria-current=page]').length,1);
  assert.equal(ui.doc.activeElement,heading,'focus enters the real project page heading');
  await nav.querySelector('[data-pk-route=home]').click();assert.equal(ui.doc.body.dataset.studioScreen,'home');assert.equal(page.hidden,true);
  assert.equal(nav.querySelector('[aria-current=page]').dataset.pkRoute,'home');assert.equal(ui.doc.getElementById('pkRecentGrid').querySelectorAll('.pc-project-open').length,1,'home rail remains available');
  assert.equal(ui.studio().exportProject(),raw);assert.equal(JSON.stringify(store.state),saved);assert.equal(ui.controller.projects.getState().activeId,activeId);
  assert.deepEqual(ui.projectCalls,calls,'pure navigation does not invoke persistence, load or reset');assert.equal(ui.studio().getSummary().mode,mode);
  assert.equal(input.value,'보존할 미전송 초안');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,6);
  assert.equal(ui.downloads.length,0);assert.equal(ui.requests.length,0);
});

test('sidebar projects isolates its search and opens actual stored projects with their drafts',async()=>{
  const store=new CatalogStore(),ui=await mounted({projectStore:store}),library=ui.controller.projects;
  const first=library.getState().activeId,input=ui.doc.getElementById('pcPrompt');input.value='A 미전송 초안';input.setSelectionRange(2,4);
  await input.dispatchEvent(new ui.sandbox.Event('input',{bubbles:true}));
  assert.equal(await ui.studio().requestImportProject(JSON.stringify(ui.project('Library B'))),true);
  input.value='B 미전송 초안';input.setSelectionRange(1,3);await input.dispatchEvent(new ui.sandbox.Event('input',{bubbles:true}));
  // This legacy composer mirrors its text into the current document. Commit B
  // before the baseline so normal save-before-switch is not mistaken for loss.
  assert.equal(await library.saveCurrent(),true);await library.flush();assert.equal(library.getState().items.length,2);
  ui.controller.go('home');
  const search=ui.doc.getElementById('pkSearch');search.value='NO MATCH FOR STORED PROJECT';await search.dispatchEvent(new ui.sandbox.Event('input',{bubbles:true}));
  assert.equal(ui.doc.getElementById('pkRecentGrid').querySelectorAll('.pc-project-open').length,0,'home search can filter its own rows');
  assert.match(ui.doc.getElementById('pkRecentGrid').querySelector('.pc-home-recent-empty').textContent,/검색/,'filtered results must not be described as an empty saved catalog');
  const raw=ui.studio().exportProject(),saved=JSON.stringify(store.state);ui.controller.go('design');
  await ui.doc.querySelector('.pk-navigation [data-pk-route=projects]').click();
  assert.equal(ui.doc.body.dataset.studioScreen,'projects');const page=ui.doc.querySelector('[data-studio-page=projects]');assert.equal(page.hidden,false);
  assert.equal(page.querySelectorAll('.pc-project-open').length,2,'stored projects are not hidden by an unrelated home query');
  assert.equal(search.value,'','the initial project-page query is independent of home');assert.equal(ui.doc.querySelectorAll('#pkSearch').length,1);
  assert.equal(ui.studio().exportProject(),raw);assert.equal(JSON.stringify(store.state),saved);assert.equal(ui.requests.length,0);
  search.value='Library A';await search.dispatchEvent(new ui.sandbox.Event('input',{bubbles:true}));assert.equal(page.querySelectorAll('.pc-project-open').length,1);
  await ui.doc.querySelector('.pk-navigation [data-pk-route=home]').click();assert.equal(search.value,'NO MATCH FOR STORED PROJECT');assert.equal(ui.doc.getElementById('pkRecentGrid').querySelectorAll('.pc-project-open').length,0);
  await ui.doc.querySelector('.pk-navigation [data-pk-route=projects]').click();assert.equal(search.value,'Library A');
  const target=page.querySelectorAll('.pc-project-open').find(node=>node.dataset.pkProjectId===first);assert(target,'page exposes the actual stored local ID');await target.click();await library.flush();await settle();
  assert.equal(page.hidden,true);assert.equal(library.getState().activeId,first);assert.equal(ui.studio().getSummary().name,'Library A');assert.equal(ui.doc.body.dataset.studioScreen,'design');
  assert.equal(input.value,'A 미전송 초안');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,4);
  assert.equal(ui.doc.activeElement,input);assert.equal(JSON.stringify(store.state.records),JSON.stringify(JSON.parse(saved).records));assert.equal(ui.downloads.length,0);assert.equal(ui.requests.length,0);

  // The catalog has no20-project cap. Only external storage is seeded; no
  // user database or21real imports/generations are involved.
  const many=new CatalogStore(),Design=require('../web/src/profiles.js');
  many.state.records=Array.from({length:21},(_,i)=>({id:'stored-'+String(i+1).padStart(2,'0'),raw:JSON.stringify(Design.createProject({name:'Stored '+String(i+1).padStart(2,'0')},[],[])),createdAt:new Date(Date.UTC(2026,9,29,0,0,i)).toISOString(),updatedAt:'2026-10-29T00:01:00.000Z',favorite:false,recovered:false}));
  const large=await mounted({projectStore:many,initialProject:false});large.controller.go('home');
  assert.equal(large.controller.projects.getState().items.length,21);assert.equal(large.doc.getElementById('pkRecentGrid').querySelectorAll('.pc-project-open').length,4);
  assert.equal(large.doc.getElementById('pcProjectPaging').hidden,true);assert.equal(large.doc.getElementById('pkRecentGrid').querySelectorAll('.pc-project-open').length,4,'home retains its four newest rows; the complete catalog remains reachable');
  await large.doc.querySelector('.pk-navigation [data-pk-route=projects]').click();const libraryPage=large.doc.querySelector('[data-studio-page=projects]');
  assert.equal(libraryPage.querySelectorAll('.pc-project-open').length,20);const next=libraryPage.querySelector('[aria-label="다음 프로젝트 페이지"]');assert(next&&!next.disabled,'21st project has an accessible next page');await next.click();
  const oldest=libraryPage.querySelectorAll('.pc-project-open');assert.equal(oldest.length,1);assert.equal(oldest[0].dataset.pkProjectId,'stored-01');await oldest[0].click();await large.controller.projects.flush();await settle();
  assert.equal(large.controller.projects.getState().activeId,'stored-01');assert.equal(large.studio().getSummary().name,'Stored 01');assert.equal(many.state.records.length,21);assert.equal(large.requests.length,0);
});

test('sidebar projects distinguishes catalog loading, genuine empty storage and read failure',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),store=new CatalogStore();store.read=async()=>{await gate;return structuredClone(store.state);};
  const ui=await mounted({projectStore:store,initialProject:false,waitProjectReady:false});await ui.doc.querySelector('.pk-navigation [data-pk-route=projects]').click();
  assert.equal(ui.doc.body.dataset.studioScreen,'projects');const page=ui.doc.querySelector('[data-studio-page=projects]');assert.equal(page.hidden,false);
  assert.match(page.querySelector('[role=status]').textContent,/확인|불러|준비/);assert.equal(page.querySelectorAll('.pc-project-open').length,0);
  assert.doesNotMatch(ui.doc.getElementById('pcProjectName').textContent+' '+ui.doc.getElementById('pcHomeCandidateSummary').textContent,/자동\s*(보관|저장)/,'pending storage must not claim automatic preservation');
  release();await until(()=>ui.controller.projects.getState().initialized,'empty catalog initialized');
  assert.equal(ui.controller.projects.getState().ready,true);assert.match(page.textContent,/저장된 프로젝트가 없/);assert.equal(store.state.records.length,0);
  const failed=new CatalogStore();failed.read=async()=>{throw Error('Controlled catalog unavailable');};
  const broken=await mounted({projectStore:failed,initialProject:false});await broken.doc.querySelector('.pk-navigation [data-pk-route=projects]').click();
  const errorPage=broken.doc.querySelector('[data-studio-page=projects]');assert.equal(errorPage.hidden,false);assert.match(errorPage.querySelector('[role=alert]').textContent,/Controlled catalog unavailable/);
  assert.doesNotMatch(broken.doc.getElementById('pcProjectName').textContent+' '+broken.doc.getElementById('pcHomeCandidateSummary').textContent,/자동\s*(보관|저장)/,'unavailable storage must not claim automatic preservation');
  assert.equal(broken.controller.projects.getState().ready,false);assert.equal(failed.state.records.length,0);assert.equal(broken.requests.length,0);assert.equal(ui.requests.length,0);
});

test('generation sidebar entry opens ordinary work without editing a stored project',async()=>{
 const store=new CatalogStore(),ui=await mounted({projectStore:store});const original=structuredClone(store.state.records[0]);
 await ui.doc.querySelector('.pk-navigation [data-pk-route=design]').click();
 assert.equal(ui.controller.projects.getState().activeKind,'generation','sidebar image generation must leave the stored-project context');
 assert.equal(ui.doc.body.dataset.studioScreen,'design');assert.deepEqual(store.state.records.find(v=>v.id===original.id),original);
 assert.equal(ui.controller.projects.getState().items.length,1);assert.equal(ui.requests.length,0);
 const library=ui.controller.projects,input=ui.doc.getElementById('pcPrompt');await library.switchTo(original.id);await settle();ui.controller.go('home');input.value='취소하면 남길 입력';input.setSelectionRange(1,4);await input.dispatchEvent(new ui.sandbox.Event('input',{bubbles:true}));await library.saveCurrent();const saved=structuredClone(store.state.records.find(v=>v.id===original.id)),raw=ui.studio().exportProject();
 ui.sandbox.confirm=()=>false;const template=ui.doc.querySelector('.pk-home-templates [data-pk-template]');await template.click();assert.equal(library.getState().activeId,original.id);assert.equal(input.value,'취소하면 남길 입력');assert.equal(input.selectionStart,1);assert.equal(input.selectionEnd,4);assert.equal(ui.studio().exportProject(),raw);
 ui.sandbox.confirm=()=>true;await template.click();assert.equal(library.getState().activeKind,'generation');assert(input.value.trim());assert.notEqual(input.value,'취소하면 남길 입력');assert.deepEqual(store.state.records.find(v=>v.id===original.id),saved);assert.equal(library.getState().items.length,1);assert.equal(ui.requests.length,0);
});

test('generation file export keeps ordinary records while explicit project save copies them',async()=>{
 const store=new CatalogStore(),ui=await mounted({projectStore:store,initialProject:false}),library=ui.controller.projects;
 const save=()=>ui.doc.querySelectorAll('button').find(node=>node.getAttribute('aria-label')==='프로젝트로 저장'||node.textContent.trim()==='프로젝트로 저장');
 assert(save(),'ordinary work exposes an explicit project-save control');
 ui.element('prompt').value='A synthetic ordinary image';ui.element('candidateCount').value='1';ui.element('useBrief').checked=false;
 assert.equal(await ui.studio().generate(),true);assert.equal(await library.saveCurrent(),true);const general=library.getState().activeId,raw=ui.studio().exportProject();
 assert.equal(library.getState().activeKind,'generation');assert.equal(library.getState().items.length,0);
 await ui.element('saveProject').click();await library.flush();assert.equal(ui.downloads.length,1);assert.equal(library.getState().items.length,0);assert.equal(library.getState().activeKind,'generation');
 assert.equal(JSON.stringify(JSON.parse(await ui.downloads[0].blob.text())),JSON.stringify(JSON.parse(raw)));
 await save().click();await library.flush();assert.equal(library.getState().activeKind,'project');assert.equal(library.getState().items.length,1);assert.notEqual(library.getState().activeId,general);
 assert.equal(store.state.records.find(v=>v.id===general).raw,raw);assert.equal(store.state.records.find(v=>v.id===general).kind,'generation');assert.equal(ui.requests.length,1,'project registration never submits another image job');
});

test('generation project save failure is visible beside the preserved ordinary work',async()=>{
 const store=new CatalogStore(),ui=await mounted({projectStore:store,initialProject:false}),library=ui.controller.projects;
 await ui.doc.querySelector('.pk-navigation [data-pk-route=design]').click();ui.element('prompt').value='A synthetic ordinary image';ui.element('candidateCount').value='1';ui.element('useBrief').checked=false;
 assert.equal(await ui.studio().generate(),true);await library.saveCurrent();const raw=ui.studio().exportProject(),id=library.getState().activeId,commit=store.commit.bind(store);
 store.commit=change=>change.put?.some(row=>row.kind==='project')?Promise.reject(Error('Controlled project save failure')):commit(change);
 const save=ui.doc.querySelectorAll('button').find(node=>node.getAttribute('aria-label')==='프로젝트로 저장'||node.textContent.trim()==='프로젝트로 저장');assert(save);await save.click();await library.flush();
 assert.equal(library.getState().activeKind,'generation');assert.equal(library.getState().activeId,id);assert.equal(library.getState().items.length,0);assert.equal(ui.studio().exportProject(),raw);
 const feedback=ui.doc.getElementById('pkComposerStatus');assert.match(feedback.textContent,/Controlled project save failure/);assert.equal(feedback.hidden,false);
});

// Keep the optimized fixture lookup equivalent to its original live document walk.
test('structural DOM id lookup preserves duplicate order detach reparent and missing semantics',async()=>{
 const ui=page();await settle();const doc=structuralDOM(ui),left=doc.createElement('div'),right=doc.createElement('div'),first=doc.createElement('span'),second=doc.createElement('span'),detached=doc.createElement('span');
 first.id=second.id=detached.id='lookup-shared';doc.body.append(left,right);left.append(first);right.append(second);
 assert.equal(doc.getElementById('lookup-shared'),first);first.remove();assert.equal(doc.getElementById('lookup-shared'),second);left.prepend(first);assert.equal(doc.getElementById('lookup-shared'),first);
 right.prepend(first);assert.equal(doc.getElementById('lookup-shared'),first);left.prepend(second);assert.equal(doc.getElementById('lookup-shared'),second);
 second.id='lookup-renamed';assert.equal(doc.getElementById('lookup-shared'),first);assert.equal(doc.getElementById('lookup-renamed'),second);left.remove();assert.equal(doc.getElementById('lookup-renamed'),null);
 doc.body.id='lookup-body';assert.equal(doc.getElementById('lookup-body'),null,'preserve the prior fixture body exclusion');assert.equal(doc.getElementById('lookup-missing'),null);detached.id='lookup-detached';assert.equal(doc.getElementById('lookup-detached'),null);
});

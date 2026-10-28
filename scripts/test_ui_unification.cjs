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
  proto.closest = function(selector) { return matches(this,selector) ? this : this.parentNode?.closest(selector) || null; };
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
  doc.getElementById = id => descendants(doc.body).find(node=>node.id===id) || null;
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

async function mounted({twoCandidates=false,storageEstimate}={}) {
  const ui=page({autoJobs:true}); await until(()=>ui.studio().getSummary().modelsReady,'model catalog');
  if(storageEstimate)ui.sandbox.navigator={storage:{estimate:storageEstimate}};
  const doc=structuralDOM(ui);
  for (const name of ['redesign.js','studio.js']) vm.runInContext(readFileSync(path.join(__dirname,'../web/src',name),'utf8'),ui.sandbox,{filename:name});
  const assets=doc.createElement('script');assets.id='redesignAssets';assets.textContent=JSON.stringify({images:{'catgirl-hero':'/template.png'},icons:{}});doc.body.append(assets);
  const controller=ui.sandbox.PankekiRedesign.mount(doc,ui.studio(),ui.sandbox.PankekiWorkflowController);
  const project=ui.project('Actual project');
  if(twoCandidates)project.versions.push({...project.versions[0],id:'second',label:'Second candidate'});
  await ui.studio().importProject(project);
  ui.studio().setMode('inpaint');
  await ui.input('editOperation','recolor');
  ui.element('paint').snapshot=WHITE;
  await settle();
  return {...ui,doc,controller};
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

test('all routes retain eleven sidebar items and compare activates the Design parent',async()=>{
  const ui=await mounted(),nav=ui.doc.querySelector('.pk-navigation');
  const expected=['홈','프로젝트','이미지 생성','디자인','부위 편집','표정 · 동작','출력','갤러리','템플릿','모델 관리','설정'];
  for(const screen of ['home','design','inpaint','compare','parts','motion','export']){
    ui.controller.go(screen);
    assert.deepEqual(nav.querySelectorAll('button').map(node=>node.getAttribute('aria-label')),expected);
    assert.equal(nav.querySelector('.pk-gallery-nav').hidden,false);
    const active=nav.querySelectorAll('[aria-current="page"]');assert.equal(active.length,1);
    assert.equal(active[0].dataset.pkRoute,screen==='compare'?'inpaint':screen);
    assert.equal(active[0].classList.contains('active'),true);
  }
  assert.equal(ui.requests.length,0);
});

test('home keeps its brand hero and six recommendations while existing candidate gallery remains reachable',async()=>{
  const ui=await mounted({twoCandidates:true}),hero=ui.doc.querySelector('.pc-home-hero');
  ui.controller.go('home');
  assert(hero,'brand composition instead of giant project card');assert.notEqual(hero.querySelector('img').src,RED);assert.match(hero.querySelector('h1').textContent,/상상하는 캐릭터/);
  assert.equal(ui.doc.querySelector('.pk-home-templates').querySelectorAll('[data-pk-template]').length,6);
  assert.match(ui.doc.getElementById('pcHomeProjectSummary').textContent,/Actual project/);assert.match(ui.doc.getElementById('pcProjectLibraryHeading').textContent,/프로젝트 목록/);
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
  const text=ui.doc.getElementById('pkStorageText'),storage=ui.doc.querySelector('.pk-storage');assert.equal(text.textContent,'약 19.6 MB 사용');assert.doesNotMatch(text.textContent,/GB|한도/);assert.match(storage.getAttribute('title'),/1756\.3 GB 추정 한도/);assert.match(storage.getAttribute('aria-label'),/브라우저.*앱 전용 확보 공간이나 기기 전체 여유 공간을 뜻하지 않습니다/);assert.equal(ui.doc.getElementById('pkStorageBar').hidden,true);assert.equal(estimates,1);
});
test('home audit unavailable storage remains unknown',async()=>{const unavailable=await mounted({storageEstimate:async()=>{throw Error('unavailable');}});assert.equal(unavailable.doc.getElementById('pkStorageBar').hidden,true);assert.match(unavailable.doc.getElementById('pkStorageText').textContent,/확인할 수 없/);});
test('home audit actual zero storage remains a valid measured number',async()=>{const empty=await mounted({storageEstimate:async()=>({usage:0,quota:1000000000})});assert.equal(empty.doc.getElementById('pkStorageBar').hidden,true);assert.equal(empty.doc.getElementById('pkStorageText').textContent,'약 0.0 MB 사용');assert.match(empty.doc.querySelector('.pk-storage').getAttribute('title'),/1\.0 GB 추정 한도/);});

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

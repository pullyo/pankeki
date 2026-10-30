// node --test scripts/test_ui_state.cjs
// Runs the actual profiles.js and app.js sources, with controlled browser I/O.
// These are state/HTTP-boundary tests, not browser rendering or GPU evidence.
'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const nodeTest = require('node:test');
const test = (name, fn) => nodeTest(name, { timeout: 4000 }, fn);
const scripts = ['profiles.js', 'app.js'].map(name => ({
  name, source: readFileSync(path.join(__dirname, '../web/src', name), 'utf8'),
}));
const png = value => 'data:image/png;base64,' + value;
const BLACK = png('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==');
const WHITE = png('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==');
const RED = png('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==');
const BLUE = png('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/5ncLrgAAAABJRU5ErkJggg==');
const plain = value => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(setImmediate);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function until(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await settle();
  }
  assert.fail(`application never reached: ${label}`);
}

const MODEL_CATALOG = { default_model_id: 'sd-turbo', models: [
  { id:'sd-turbo',label:'SD Turbo · 빠른 초안',available:true,description:'빠른 초안',defaults:{width:512,height:512,steps:1,cfg:1,denoise:1,sampler:'euler',scheduler:'normal'} },
  { id:'sdxl-base',label:'SDXL Base 1.0',available:true,description:'세부 묘사 비교',defaults:{width:1024,height:1024,steps:25,cfg:6,denoise:.55,sampler:'dpmpp_2m',scheduler:'karras'} }
] };
function page({ autoJobs = false, holdRestore = false, catalog = MODEL_CATALOG, capabilities = null, holdWrites = false, localStorageImpl } = {}) {
  const elements = new Map(), blobs = new Map(), images = new Map(), heldImages = new Set();
  const requests = [], polls = new Map(), cancellations = [], revoked = [], writes = [], restores = [], pendingWrites = [];
  const objectURLs = new Map(), downloads = [], exportCanvases = [];
  let uuid = 0;
  class Event {
    constructor(type, fields = {}) { this.type = type; Object.assign(this, fields); }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() {}
  }
  class Element {
    constructor(tag = 'div', id = '') {
      this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.dataset = {};
      this.value = ''; this.checked = false; this.disabled = false; this.hidden = false;
      this.width = 512; this.height = 512; this.naturalWidth = 512; this.naturalHeight = 512;
      this.files = []; this.attributes = {}; this.style = {}; this.listeners = new Map();
      this._text = ''; this._classes = new Set(); this.snapshot = BLACK;
      this.classList = {
        add: (...names) => names.forEach(name => this._classes.add(name)),
        remove: (...names) => names.forEach(name => this._classes.delete(name)),
        contains: name => this._classes.has(name),
        toggle: (name, force = !this._classes.has(name)) => {
          if (force) this._classes.add(name); else this._classes.delete(name); return force;
        },
      };
      const owner = this;
      this.context = {
        draws: [], texts: [], fills: 0, fillStyle: 'black',
        drawImage(image) { this.draws.push(image.src); owner.snapshot = image.src; },
        fillRect() { this.fills++; owner.snapshot = this.fillStyle === 'black' ? BLACK : WHITE; },
        clearRect() { owner.snapshot = BLACK; }, fill() { owner.snapshot = WHITE; },
        stroke() { owner.snapshot = WHITE; }, beginPath() {}, arc() {}, moveTo() {}, lineTo() {},
        save() {}, restore() {}, translate() {}, scale() {}, rect() {}, clip() {}, setTransform() {}, strokeRect() {},
        fillText(text, x, y) { this.texts.push({ text, x, y }); },
        measureText(text) { return { width: text.length * 8 }; },
      };
    }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent || '').join(''); }
    set innerHTML(value) { this.replaceChildren(); this._html = String(value); }
    get innerHTML() { return this._html || ''; }
    set className(value) { this._classes = new Set(value.split(/\s+/).filter(Boolean)); }
    get className() { return [...this._classes].join(' '); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    append(...children) { children.forEach(child => this.appendChild(typeof child === 'string' ? { textContent: child } : child)); }
    replaceChildren(...children) {
      if (this.children.some(child => child === document.activeElement || child.contains?.(document.activeElement))) document.activeElement = document.body;
      this.children.forEach(child => { child.parentNode = null; });
      this.children = []; this._text = ''; this.append(...children);
    }
    contains(node) { return this === node || this.children.some(child => child === node || child.contains?.(node)); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); }
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    }
    removeEventListener(type, listener) {
      this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener));
    }
    dispatchEvent(event) {
      event.target ||= this; event.currentTarget = this;
      const results = [];
      if (this['on' + event.type]) results.push(this['on' + event.type](event));
      for (const listener of this.listeners.get(event.type) || []) results.push(listener(event));
      return Promise.all(results);
    }
    click() {
      if (this.tagName === 'A' && this.download) downloads.push({ name: this.download, url: this.href, blob: objectURLs.get(this.href) });
      return this.dispatchEvent(new Event('click'));
    }
    focus(options) { document.activeElement = this; this.focusOptions = options; }
    scrollIntoView() {} setPointerCapture() {} releasePointerCapture() {}
    showModal() { this.open = true; } close() { this.open = false; }
    getContext() { return this.context; }
    getBoundingClientRect() { return { left: 0, top: 0, right: 512, bottom: 512, width: 512, height: 512 }; }
    toDataURL() { return this.snapshot; }
    toBlob(callback, type = 'image/png') {
      this.exportType = type;
      // Browser encoding is external here. The real board renderer's text,
      // image and dimension commands are captured above; this fixture only
      // lets its real PNG download handler finish without a browser.
      callback(new Blob([Buffer.from(BLACK.split(',')[1], 'base64')], { type }));
    }
    querySelectorAll(selector) {
      const all = this.children.flatMap(child => [child, ...(child.querySelectorAll?.('*') || [])]);
      return all.filter(child => selector === '*' || (selector.startsWith('.') ? child.classList?.contains(selector.slice(1)) : child.tagName?.toLowerCase() === selector));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  function element(id) {
    if (!elements.has(id)) elements.set(id, new Element(['source', 'paint'].includes(id) ? 'canvas' : 'div', id));
    return elements.get(id);
  }
  const values = { mode: 'txt2img', seed: '42', steps: '1', width: '512', height: '512', cfg: '1',
    denoise: '1', halo: '32', feather: '4', brush: '40', candidateCount: '2', profile: 'original',
    palette1: '#112233', palette2: '#445566', palette3: '#778899', sampler: 'dpmpp_2m', scheduler: 'karras' };
  for (const [id, value] of Object.entries(values)) element(id).value = value;
  for (const id of ['useBrief', 'cache', 'previewOn']) element(id).checked = true;
  const document = new Element('document');
  document.body = new Element('body'); document.documentElement = new Element('html');
  document.activeElement = document.body;
  document.getElementById = element;
  document.createElement = tag => { const node = new Element(tag); if (tag === 'canvas') exportCanvases.push(node); return node; };
  document.createTextNode = text => ({ textContent: text });
  document.querySelectorAll = selector => selector.startsWith('#') ? [element(selector.slice(1))] : [];
  document.querySelector = selector => selector.startsWith('#') ? element(selector.slice(1)) : null;
  const metrics = { cache: 'miss', total_s: .1, model_size: [512, 512], outside_mask_max_error: 0 };
  // Response.json and IndexedDB produce objects in the receiving browser realm.
  const realm = value => value === undefined ? value : vm.runInContext('JSON.parse(' + JSON.stringify(JSON.stringify(value)) + ')', sandbox);
  const response = value => ({ ok: true, status: 200, json: async () => realm(value) });
  function completed(id, image = RED) {
    blobs.set('/api/results/' + id, { data: image });
    return { job_id: id, revision: 1, state: 'succeeded', is_current: true, preview: null,
      result: { image_url: '/api/results/' + id, metrics } };
  }
  const database = {
    objectStoreNames: { contains: () => true }, createObjectStore() {}, close() {},
    transaction() {
      const transaction = { objectStore: () => ({
        get() {
          const request = {};
          const resolve = value => { request.result = realm(value); request.onsuccess?.({ target: request }); };
          restores.push({ request, resolve });
          if (!holdRestore) queueMicrotask(() => resolve(undefined));
          return request;
        },
        put(value) {
          writes.push(plain(value)); const request = {};
          const complete=()=>{request.onsuccess?.({target:request});transaction.oncomplete?.();};
          if(holdWrites)pendingWrites.push({value,complete,abort(){transaction.error=Error('Controlled current transaction abort');transaction.onabort?.();}});else queueMicrotask(complete);
          return request;
        },
        delete() { const request = {}; queueMicrotask(() => { request.onsuccess?.(); transaction.oncomplete?.(); }); return request; },
      }) };
      return transaction;
    },
  };
  const sandbox = {
    document, Event, console, Blob, atob, structuredClone: realm, TextEncoder, TextDecoder,
    setTimeout, clearTimeout, queueMicrotask, requestAnimationFrame: callback => setImmediate(callback),
    crypto: { randomUUID: () => `uuid-${++uuid}` }, confirm: () => true,
    localStorage: localStorageImpl || { getItem: () => null, setItem() {}, removeItem() {} },
    indexedDB: { open() { const request = {}; queueMicrotask(() => { request.result = database; request.onsuccess?.({ target: request }); }); return request; } },
    URL: {
      createObjectURL(file) { if (file.url) return file.url; const url = `blob:download-${++uuid}`; objectURLs.set(url, file); return url; },
      revokeObjectURL: url => revoked.push(url),
    },
    Image: class extends Element {
      constructor() { super('img'); }
      decode() {
        const pending = { ...deferred(), image: this, done: false };
        if (!images.has(this.src)) images.set(this.src, []);
        images.get(this.src).push(pending);
        if (this.src?.startsWith('data:') && !heldImages.has(this.src)) queueMicrotask(() => { pending.done = true; pending.resolve(); });
        return pending.promise;
      }
    },
    FileReader: class {
      readAsDataURL(blob) {
        blob.readerStarted = true;
        (blob.read?.promise || Promise.resolve()).then(() => { this.result = blob.data; this.onload?.(); },
          error => { this.error = error; this.onerror?.(error); });
      }
      readAsText(blob) { blob.text().then(text => { this.result = text; this.onload?.(); }, error => { this.error = error; this.onerror?.(error); }); }
    },
    fetch: async (url, options = {}) => {
      if (url === '/api/capabilities') return capabilities ? response(await capabilities) : {ok:false,status:404,json:async()=>({error:'Not found'})};
      if (url === '/api/health') return response({ comfy: true });
      if (url === '/api/models') {
        if (catalog === null) throw Error('catalog offline');
        return response(await catalog);
      }
      if (url === '/api/jobs') {
        const pending = { ...deferred(), id: 'job-' + (requests.length + 1), body: JSON.parse(options.body) };
        requests.push(pending);
        if (autoJobs) pending.resolve(response({ job_id: pending.id }));
        return pending.promise;
      }
      const cancel = String(url).match(/^\/api\/jobs\/([^/]+)\/cancel$/);
      if (cancel) { cancellations.push(cancel[1]); return response({ canceled: true }); }
      const job = String(url).match(/^\/api\/jobs\/([^/]+)$/);
      if (job) {
        if (autoJobs) return response(completed(job[1], requests.findIndex(item => item.id === job[1]) % 2 ? BLUE : RED));
        const pending = deferred();
        if (!polls.has(job[1])) polls.set(job[1], []);
        polls.get(job[1]).push(pending);
        return pending.promise;
      }
      if (url === '/api/cache/clear') return response({});
      if (String(url).startsWith('data:')) return { ok: true, blob: async () => ({ data: url }) };
      assert(blobs.has(url), `unexpected fetch ${url}`);
      return { ok: true, blob: async () => blobs.get(url) };
    },
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
  sandbox.addEventListener = document.addEventListener.bind(document);
  sandbox.removeEventListener = document.removeEventListener.bind(document);
  vm.createContext(sandbox);
  for (const { name, source } of scripts) vm.runInContext(source, sandbox, { filename: 'web/src/' + name });
  const studio = () => {
    assert(sandbox.PankekiStudio, 'app must expose PankekiStudio state/test boundary');
    const api = sandbox.PankekiStudio;
    // Browser imports arrive as file text. Avoid sending host-realm plain
    // objects across the VM boundary into strict JSON schema validators.
    return { ...api, importProject: (raw, options) => api.importProject(typeof raw === 'string' ? raw : JSON.stringify(raw), options) };
  };
  const state = () => plain(studio().getState());
  function file(url, data = BLACK, { holdRead = false } = {}) {
    const blob = { data, readerStarted: false, ...(holdRead ? { read: deferred() } : {}) };
    blobs.set(url, blob);
    return { url, size: data.length, type: 'image/png', text: async () => data };
  }
  function decode(url, width = 512, height = 512) {
    const pending = images.get(url)?.find(item => !item.done);
    assert(pending, `decode not pending for ${url}`);
    Object.assign(pending.image, { width, height, naturalWidth: width, naturalHeight: height });
    pending.done = true; pending.resolve();
  }
  async function finishSource(url, pending, width = 512, height = 512) {
    decode(url, width, height); await settle(); blobs.get(url)?.read?.resolve(); return pending;
  }
  async function readySource(url = 'blob:initial', options = {}) {
    file(url); const pending = sandbox.loadSource(url, options); await finishSource(url, pending);
  }
  function upload(id, url, data = BLACK, options) {
    element(id).files = [file(url, data, options)]; return element(id).onchange();
  }
  async function accept(index) {
    await until(() => requests[index], 'POST ' + (index + 1));
    const pending = requests[index]; pending.resolve(response({ job_id: pending.id }));
    await settle(); return pending.id;
  }
  async function complete(index, image = RED) {
    const id = await accept(index);
    await until(() => polls.get(id)?.length, 'GET ' + id);
    polls.get(id).shift().resolve(response(completed(id, image)));
    await settle();
  }
  async function input(id, value) {
    if (typeof value === 'boolean') element(id).checked = value; else element(id).value = value;
    await element(id).dispatchEvent(new Event('input'));
    await element(id).dispatchEvent(new Event('change'));
  }
  function project(name = 'Saved', image = RED) {
    const brief = { profile: 'original', name, brief: 'A brave forest guardian', appearance: 'round ears', detail: 'large scarf',
      palette: ['#112233', '#445566', '#778899'], notes: 'Saved notes', prompt: 'full body', useBrief: true };
    const raw = { version: 1, brief, versions: [{ id: 'parent', createdAt: '2026-10-19T00:00:00.000Z',
      label: name + ' original', image, brief, request: { mode: 'txt2img', seed: 42 }, parentId: null, kind: 'generated' }] };
    return plain(sandbox.CharacterDesign.parseProject(JSON.stringify(raw)));
  }
  return { sandbox, studio, state, element, file, decode, finishSource, readySource, upload, accept, complete,
    input, project, response, images, heldImages, blobs, requests, polls, cancellations, revoked, restores, writes, pendingWrites,
    downloads, exportCanvases, Event };
}

test('selected model preset reaches the submitted job and the saved candidate', async () => {
  const ui = page({autoJobs:true,catalog:{...MODEL_CATALOG,default_model_id:'sdxl-base'}});
  await settle();
  ui.element('candidateCount').value = '1';
  assert.equal(await ui.studio().generate(), true);
  const request = ui.requests[0].body.request;
  assert.equal(request.model_id, 'sdxl-base');
  assert.deepEqual([request.width,request.height,request.steps,request.cfg,request.sampler,request.scheduler], [1024,1024,25,6,'dpmpp_2m','karras']);
  assert.equal(ui.state().project.versions[0].request.model_id, 'sdxl-base');
  await ui.input('imageModel','sd-turbo');
  assert.equal(await ui.studio().generate(), true);
  assert.deepEqual([ui.requests[1].body.request.model_id,ui.requests[1].body.request.steps,ui.requests[1].body.request.cfg], ['sd-turbo',1,1]);
});

test('unavailable model catalog blocks generation instead of silently using Turbo defaults', async () => {
  const ui = page({autoJobs:true,catalog:null});
  await settle();
  assert.equal(await ui.studio().generate(), false);
  assert.equal(ui.requests.length, 0);
  assert.match(ui.element('status').textContent, /모델/);
});

test('newest source wins when decode and original-file reads finish out of order', async () => {
  for (const delayRead of [false, true]) {
    const ui = page();
    ui.file('blob:old', RED, { holdRead: delayRead }); ui.file('blob:new', BLUE);
    const older = ui.sandbox.loadSource('blob:old');
    if (delayRead) { ui.decode('blob:old'); await until(() => ui.blobs.get('blob:old').readerStarted, 'old file read'); }
    const newer = ui.sandbox.loadSource('blob:new');
    await ui.finishSource('blob:new', newer, 640, 480);
    if (delayRead) { ui.blobs.get('blob:old').read.resolve(); await older; }
    else await ui.finishSource('blob:old', older, 320, 240);
    assert.equal(ui.state().sourceDataURL, BLUE);
    assert.equal(ui.element('source').width, 640);
    assert.deepEqual(ui.element('source').getContext().draws, ['blob:new']);
  }
});

test('failed newest upload retains the committed source when an older pending upload finishes late', async () => {
  const ui = page(); await ui.readySource('blob:committed');
  ui.file('blob:pending', BLUE); ui.file('blob:failed', WHITE);
  const pending = ui.sandbox.loadSource('blob:pending');
  const failed = ui.sandbox.loadSource('blob:failed');
  ui.images.get('blob:failed')[0].reject(Error('Controlled newest decode failure'));
  await assert.rejects(failed, /Controlled newest decode failure/);
  assert.equal(ui.state().sourceLoaded, true);
  assert.equal(ui.state().sourceDataURL, BLACK);
  await ui.finishSource('blob:pending', pending);
  assert.equal(ui.state().sourceLoaded, true);
  assert.equal(ui.state().sourceDataURL, BLACK);
  assert.deepEqual(ui.element('source').getContext().draws, ['blob:committed']);
});

test('stale source errors do not replace current status or recorded upload candidate', async () => {
  const ui = page();
  const older = ui.upload('upload', 'blob:old', RED), newer = ui.upload('upload', 'blob:new', BLUE);
  await ui.finishSource('blob:new', newer);
  ui.element('status').textContent = 'Current status';
  ui.images.get('blob:old')[0].reject(Error('obsolete failure'));
  await older;
  assert.equal(ui.element('status').textContent, 'Current status');
  assert.equal(ui.state().project.versions.length, 1);
  assert.equal(ui.state().project.versions[0].image, BLUE);
  assert.equal(ui.state().project.versions[0].kind, 'upload');
});

test('pending source and mask reject generation without changing job revision', async () => {
  for (const kind of ['source', 'mask']) {
    const ui = page(); await ui.readySource(); ui.element('mode').value = 'inpaint';
    const pending = ui.upload(kind === 'source' ? 'upload' : 'maskUpload', 'blob:pending');
    const before = ui.state().serial;
    await ui.element('generate').onclick();
    assert.equal(ui.requests.length, 0, kind);
    assert.equal(ui.state().serial, before, kind);
    ui.decode('blob:pending'); await pending;
  }
});

test('late masks cannot replace a newer mask, source, clear, or brush edit', async () => {
  for (const action of ['mask', 'source', 'clear', 'brush']) {
    const ui = page(); await ui.readySource();
    const older = ui.upload('maskUpload', 'blob:old-mask');
    if (action === 'mask') {
      const newer = ui.upload('maskUpload', 'blob:new-mask'); ui.decode('blob:new-mask'); await newer;
    } else if (action === 'source') {
      const newer = ui.upload('upload', 'blob:new-source', BLUE); await ui.finishSource('blob:new-source', newer);
    } else if (action === 'clear') ui.element('clearMask').onclick();
    else ui.element('paint').onpointerdown({ clientX: 10, clientY: 20, pointerId: 1 });
    ui.decode('blob:old-mask'); await older;
    assert(!ui.element('paint').getContext().draws.includes('blob:old-mask'), action);
  }
});

test('seed overflow in a two-candidate batch sends no partial first request', async () => {
  const ui = page(); ui.element('seed').value = String(Number.MAX_SAFE_INTEGER); ui.element('candidateCount').value = '2';
  const before = ui.state().serial;
  await ui.studio().generate();
  assert.equal(ui.requests.length, 0);
  assert.equal(ui.state().serial, before);
  assert(ui.element('status').textContent.length > 0);
});

test('profile switches preserve custom brief text and the uploaded source', async () => {
  const ui = page(); await ui.readySource();
  await ui.input('projectName', 'My own character'); await ui.input('brief', 'My own story');
  await ui.input('appearance', 'My own appearance'); await ui.input('notes', 'Private design notes');
  await ui.input('profile', 'comic');
  const state = ui.state();
  assert.equal(state.project.brief.profile, 'comic');
  assert.equal(state.project.brief.name, 'My own character'); assert.equal(state.project.brief.brief, 'My own story');
  assert.equal(state.project.brief.appearance, 'My own appearance'); assert.equal(state.project.brief.notes, 'Private design notes');
  assert.equal(state.sourceDataURL, BLACK);
});

test('candidate capacity rejects a two-image batch without deleting existing work', async () => {
  const ui = page(); const saved = ui.project('Near capacity');
  saved.versions = Array.from({ length: 19 }, (_, index) => ({
    ...plain(saved.versions[0]), id: 'saved-' + index, parentId: null,
  }));
  await ui.studio().importProject(saved);
  const before = ui.state(); await ui.studio().generate();
  assert.equal(ui.requests.length, 0); assert.equal(ui.state().serial, before.serial);
  assert.deepEqual(ui.state().project.versions, before.project.versions);
});

test('two candidates run sequentially from the same original image and mask', async () => {
  const ui = page(); await ui.readySource(); ui.element('mode').value = 'inpaint';
  ui.element('paint').snapshot = WHITE;
  const pending = ui.element('generate').onclick();
  await ui.accept(0);
  assert.equal(ui.requests.length, 1, 'second POST must wait for the first result');
  const first = plain(ui.requests[0].body.request);
  ui.element('paint').snapshot = BLUE;
  await ui.complete(0, RED);
  await until(() => ui.requests.length === 2, 'second candidate');
  const second = plain(ui.requests[1].body.request);
  assert.equal(first.source, BLACK); assert.equal(first.mask, WHITE);
  assert.equal(second.source, BLACK); assert.equal(second.mask, WHITE);
  assert.deepEqual([first.seed, second.seed], [42, 43]);
  await ui.complete(1, BLUE); await pending;
  assert.equal(ui.state().project.versions.length, 2);
  assert.equal(ui.state().sourceDataURL, BLACK);
});

test('generation captures immutable brief and parent metadata before asynchronous work', async () => {
  const ui = page(); await ui.studio().importProject(ui.project('Parent'));
  await ui.sandbox.loadSource(RED, { parentId: 'parent' });
  ui.element('mode').value = 'inpaint'; await ui.input('projectName', 'Submitted name');
  await ui.input('brief', 'Submitted brief');
  const pending = ui.studio().generate(); await ui.accept(0);
  await ui.input('projectName', 'Edited while generating'); await ui.input('brief', 'Later brief');
  await ui.complete(0, BLUE); await ui.complete(1, WHITE); await pending;
  const versions = ui.state().project.versions.filter(item => item.id !== 'parent');
  assert.equal(versions.length, 2);
  for (const item of versions) {
    assert.equal(item.brief.name, 'Submitted name'); assert.equal(item.brief.brief, 'Submitted brief');
    assert.equal(item.parentId, 'parent');
    assert(!Object.hasOwn(item.request, 'source')); assert(!Object.hasOwn(item.request, 'mask'));
  }
  const exposed = ui.studio().getState(); exposed.project.versions[1].brief.name = 'External mutation';
  assert.equal(ui.state().project.versions[1].brief.name, 'Submitted name');
  assert.equal(ui.state().project.brief.name, 'Edited while generating');
});

test('invalid new input does not stop an already accepted generation', async () => {
  const ui = page(); ui.element('candidateCount').value = '1';
  const pending = ui.studio().generate(); await ui.accept(0); const revision = ui.state().serial;
  ui.element('seed').value = '-1'; await ui.studio().generate();
  assert.equal(ui.state().serial, revision); assert.equal(ui.requests.length, 1);
  await ui.complete(0); await pending;
  assert.equal(ui.state().project.versions.length, 1);
});

test('cancel during first job stops the remaining batch and drops a late success', async () => {
  const ui = page(); const pending = ui.studio().generate(); const id = await ui.accept(0);
  await ui.studio().cancel(); await ui.complete(0); await pending;
  assert.equal(ui.requests.length, 1); assert.equal(ui.state().project.versions.length, 0);
  assert(ui.cancellations.includes(id)); assert.equal(ui.state().busy, false);
});

test('cancel while second POST is pending also cancels its eventual accepted job', async () => {
  const ui = page(); const pending = ui.studio().generate(); await ui.complete(0, RED);
  await until(() => ui.requests.length === 2, 'second POST awaiting response');
  await ui.studio().cancel(); const id = await ui.accept(1);
  await pending;
  assert(ui.cancellations.includes(id));
  assert.equal(ui.state().project.versions.length, 1);
  assert.equal(ui.state().project.versions[0].image, RED);
  assert.equal(ui.state().busy, false);
});

test('cancel before the first POST response cancels the eventual job and entire batch', async () => {
  const ui = page(); const pending = ui.studio().generate();
  await until(() => ui.requests.length === 1, 'first pending POST');
  await ui.studio().cancel(); const id = await ui.accept(0); await pending;
  assert(ui.cancellations.includes(id)); assert.equal(ui.requests.length, 1);
  assert.equal(ui.state().project.versions.length, 0); assert.equal(ui.state().busy, false);
});

test('a failed second candidate retains the first completed candidate', async () => {
  const ui = page(); const pending = ui.studio().generate(); await ui.complete(0, RED);
  const id = await ui.accept(1); await until(() => ui.polls.get(id)?.length, 'second poll');
  ui.polls.get(id).shift().resolve(ui.response({
    state: 'failed', is_current: true, preview: null, error: 'Controlled second candidate failure',
  }));
  await pending;
  assert.deepEqual(ui.state().project.versions.map(item => item.image), [RED]);
  assert.equal(ui.state().busy, false);
  assert(ui.element('status').textContent.includes('Controlled second candidate failure'));
});

test('empty-mask copy is labeled as original copy rather than AI generation', async () => {
  const ui = page(); await ui.readySource(); ui.element('mode').value = 'inpaint';
  ui.element('candidateCount').value = '1';
  const pending = ui.studio().generate(); const id = await ui.accept(0);
  await until(() => ui.polls.get(id)?.length, 'empty-mask result poll');
  ui.blobs.set('/api/results/' + id, { data: BLACK });
  ui.polls.get(id).shift().resolve(ui.response({ state: 'succeeded', is_current: true, preview: null,
    result: { image_url: '/api/results/' + id, metrics: {
      cache: 'empty-mask-skip', kind: 'pixel_copy', model_calls: 0, skipped: true,
      total_s: .001, outside_mask_max_error: 0,
    } } }));
  await pending;
  const item = ui.state().project.versions[0];
  const card = ui.element('gallery').children.find(node => node.dataset?.candidateId === item.id);
  assert.equal(item.metrics.cache, 'empty-mask-skip'); assert.equal(item.metrics.model_calls, 0);
  assert(ui.element('resultLabel').textContent.includes('원본 복사'));
  assert(card.textContent.includes('원본 복사'));
  assert(ui.element('status').textContent.includes('원본 복사'));
  assert(!card.textContent.includes('생성 결과'));
});

test('new generation wins when an older result download finishes late', async () => {
  const ui = page(); ui.element('candidateCount').value = '1';
  const older = ui.studio().generate(); const id = await ui.accept(0);
  const read = deferred(); ui.blobs.set('/api/results/' + id, { data: RED, read });
  await until(() => ui.polls.get(id)?.length, 'first poll');
  ui.polls.get(id).shift().resolve(ui.response({ state: 'succeeded', is_current: true, preview: null,
    result: { image_url: '/api/results/' + id, metrics: { cache: 'miss', total_s: .1 } } }));
  await until(() => ui.blobs.get('/api/results/' + id).readerStarted, 'first result download');
  const newer = ui.studio().generate(); await ui.complete(1, BLUE); await newer;
  read.resolve(); await older;
  assert.deepEqual(ui.state().project.versions.map(item => item.image), [BLUE]);
  assert.equal(ui.state().latestUrl, BLUE);
});

test('import restores embedded images, brief and lineage without fetching result URLs', async () => {
  const ui = page(); const saved = ui.project('Restored');
  saved.versions.push({ ...plain(saved.versions[0]), id: 'child', parentId: 'parent', image: BLUE, label: 'Child' });
  saved.selectionHistory = [
    { candidateId: 'parent', action: 'view', at: '2026-10-19T01:00:00.000Z' },
    { candidateId: 'child', action: 'edit', at: '2026-10-19T01:01:00.000Z' },
  ];
  await ui.studio().importProject(JSON.stringify(saved));
  const restored = ui.state().project;
  assert.equal(restored.brief.name, 'Restored'); assert.equal(ui.element('projectName').value, 'Restored');
  assert.deepEqual(restored.versions.map(item => [item.id, item.parentId, item.image]), [['parent', null, RED], ['child', 'parent', BLUE]]);
  assert.deepEqual(restored.selectionHistory.slice(0, 2), saved.selectionHistory);
  const exported = ui.studio().exportProject();
  const roundTrip = ui.sandbox.CharacterDesign.parseProject(exported);
  assert.deepEqual(plain(roundTrip), restored); assert.equal(ui.requests.length, 0);
});

test('gallery comparison and editing retain original images and persist selection history', async () => {
  const ui = page(); const saved = ui.project('Selection');
  saved.versions.push({ ...plain(saved.versions[0]), id: 'other', image: BLUE, label: 'Other candidate' });
  await ui.studio().importProject(saved);
  const action = (id, label) => {
    const card = ui.element('gallery').children.find(item => item.dataset?.candidateId === id);
    const button = card.querySelectorAll('button').find(item => item.textContent === label);
    assert(button, `missing candidate action ${label}`); return button.onclick();
  };
  await action('parent', '비교 선택'); await action('other', '비교 선택');
  await ui.element('compareSelected').onclick();
  assert.deepEqual(ui.state().selectedIds, ['parent', 'other']);
  assert.deepEqual(ui.element('compareGrid').querySelectorAll('img').map(item => item.src), [RED, BLUE]);
  await action('parent', '이어서 수정');
  assert.equal(ui.state().sourceId, 'parent'); assert.equal(ui.state().sourceDataURL, RED);
  assert.deepEqual(ui.state().project.selectionHistory.map(item => [item.candidateId, item.action]),
    [['parent', 'compare'], ['other', 'compare'], ['parent', 'edit']]);
  const exported = ui.sandbox.CharacterDesign.parseProject(ui.studio().exportProject());
  assert.deepEqual(plain(exported.selectionHistory), ui.state().project.selectionHistory);
  assert.deepEqual(ui.state().project.versions.map(item => item.image), [RED, BLUE]);
});

test('new import wins over an older import still decoding embedded images', async () => {
  const ui = page(); ui.heldImages.add(RED);
  const older = ui.studio().importProject(ui.project('Old import', RED));
  await until(() => ui.images.get(RED)?.length, 'old import decode');
  const newer = ui.studio().importProject(ui.project('New import', BLUE)); await newer;
  ui.decode(RED); await older;
  assert.equal(ui.state().project.brief.name, 'New import');
  assert.equal(ui.state().project.versions[0].image, BLUE);
});

test('an explicit import wins over a prior accepted job that completes during import decoding', async () => {
  const ui = page(); ui.element('candidateCount').value = '1';
  const job = ui.studio().generate(); await ui.accept(0);
  ui.heldImages.add(RED);
  const imported = ui.studio().importProject(ui.project('Requested import', RED));
  await until(() => ui.images.get(RED)?.length, 'requested import decode');
  await ui.complete(0, BLUE); await job;
  assert.equal(ui.state().project.versions.length, 0, 'old job must not commit while the requested import decodes');
  ui.decode(RED); await imported;
  assert.equal(ui.state().project.brief.name, 'Requested import');
  assert.deepEqual(ui.state().project.versions.map(item => item.image), [RED]);
});

test('an explicit import wins over a prior upload that completes during import decoding', async () => {
  const ui = page();
  const upload = ui.upload('upload', 'blob:prior-upload', BLUE);
  ui.heldImages.add(RED);
  const imported = ui.studio().importProject(ui.project('Requested import', RED));
  await until(() => ui.images.get(RED)?.length, 'requested import decode');
  await ui.finishSource('blob:prior-upload', upload);
  assert.equal(ui.state().project.versions.length, 0, 'old upload must not commit while the requested import decodes');
  ui.decode(RED); await imported;
  assert.equal(ui.state().project.brief.name, 'Requested import');
  assert.deepEqual(ui.state().project.versions.map(item => item.image), [RED]);
  assert.equal(ui.state().sourceDataURL, RED);
});

test('a project file read finishing late cannot replace a newer imported file', async () => {
  const ui = page(); const read = deferred();
  ui.element('loadProject').files = [{ size: 2000, text: () => read.promise }];
  const older = ui.element('loadProject').onchange();
  ui.element('loadProject').files = [{ size: 2000, text: async () => JSON.stringify(ui.project('New file', BLUE)) }];
  await ui.element('loadProject').onchange();
  read.resolve(JSON.stringify(ui.project('Old file', RED))); await older;
  assert.equal(ui.state().project.brief.name, 'New file');
  assert.deepEqual(ui.state().project.versions.map(item => item.image), [BLUE]);
});

test('user edit while importing wins over delayed project restore', async () => {
  const ui = page(); ui.heldImages.add(RED);
  const pending = ui.studio().importProject(ui.project('Old import', RED));
  await until(() => ui.images.get(RED)?.length, 'import decode');
  await ui.input('projectName', 'My new edit'); ui.decode(RED); await pending;
  assert.equal(ui.element('projectName').value, 'My new edit');
  assert.equal(ui.state().project.brief.name, 'My new edit');
  assert.equal(ui.state().project.versions.length, 0);
});

test('IndexedDB auto-restore does not overwrite input made while storage was pending', async () => {
  const ui = page({ holdRestore: true });
  await until(() => ui.restores.length, 'IndexedDB get');
  await ui.input('projectName', 'Started typing');
  ui.restores[0].resolve(ui.project('Old saved project'));
  await settle(); await settle();
  assert.equal(ui.element('projectName').value, 'Started typing');
  assert.equal(ui.state().project.brief.name, 'Started typing');
  assert.equal(ui.state().project.versions.length, 0);
});

test('IndexedDB auto-restore cannot overwrite edits made while restored images decode', async () => {
  const ui = page({ holdRestore: true }); ui.heldImages.add(RED);
  await until(() => ui.restores.length, 'IndexedDB get');
  ui.restores[0].resolve(ui.project('Saved project'));
  await until(() => ui.images.get(RED)?.length, 'restored image decode');
  await ui.input('projectName', 'Edit during decode'); ui.decode(RED);
  await settle(); await settle();
  assert.equal(ui.state().project.brief.name, 'Edit during decode');
  assert.equal(ui.state().project.versions.length, 0);
});

test('a malformed import leaves the working project available for export', async () => {
  const ui = page(); await ui.studio().importProject(ui.project('Keep working'));
  const before = ui.state().project;
  try { await ui.studio().importProject('{bad json'); } catch (error) { assert(error instanceof Error || error?.message); }
  assert.deepEqual(ui.state().project, before);
  const exported = ui.studio().exportProject();
  assert.equal(ui.sandbox.CharacterDesign.parseProject(exported).brief.name, 'Keep working');
});

test('project import invalidates an older pending source upload', async () => {
  const ui = page(); const upload = ui.upload('upload', 'blob:old', WHITE);
  await ui.studio().importProject(ui.project('Imported', BLUE));
  await ui.finishSource('blob:old', upload);
  assert.equal(ui.state().project.brief.name, 'Imported');
  assert.deepEqual(ui.state().project.versions.map(item => item.image), [BLUE]);
  assert.notEqual(ui.state().sourceDataURL, WHITE);
});

test('project import invalidates a previous job result still being fetched', async () => {
  const ui = page(); ui.element('candidateCount').value = '1';
  const pending = ui.studio().generate(); await ui.accept(0);
  await ui.studio().importProject(ui.project('Imported', BLUE));
  await ui.complete(0, RED); await pending;
  assert.equal(ui.state().project.brief.name, 'Imported');
  assert.deepEqual(ui.state().project.versions.map(item => item.image), [BLUE]);
});

test('declining project reset preserves the current project', async () => {
  const ui = page(); await ui.studio().importProject(ui.project('Keep'));
  ui.sandbox.confirm = () => false;
  await ui.studio().resetProject();
  assert.equal(ui.state().project.brief.name, 'Keep');
  assert.equal(ui.state().project.versions.length, 1);
});

test('file import into a fresh blank project does not request discard confirmation', async () => {
  const ui = page(); const saved = ui.project('First imported project');
  const raw = JSON.stringify(saved); let confirmations = 0;
  ui.sandbox.confirm = () => { confirmations++; return false; };
  ui.element('loadProject').files = [{ size: Buffer.byteLength(raw, 'utf8'), text: async () => raw }];
  await ui.element('loadProject').onchange();
  assert.equal(confirmations, 0, 'choosing a file is not an unsaved project edit');
  assert.equal(ui.state().project.brief.name, 'First imported project');
  assert.equal(ui.state().project.versions.length, 1);
});

test('palette-only and profile-only edits request confirmation before starting a new project', async () => {
  for (const [id, value] of [['palette1', '#ABCDEF'], ['profile', 'comic']]) {
    const ui = page(); await ui.input(id, value); let confirmations = 0;
    ui.sandbox.confirm = () => { confirmations++; return false; };
    await ui.element('newProject').onclick();
    assert.equal(confirmations, 1, id + ' changes must be protected');
    assert.equal(ui.element(id).value, value, 'declining reset keeps the changed field');
    assert.equal(ui.state().project.versions.length, 0);
  }
});

test('candidate compare toggles and view preserve keyboard focus on the same candidate action', async () => {
  const ui = page(); const saved = ui.project('Keyboard project');
  saved.versions.push({ ...plain(saved.versions[0]), id: 'second', image: BLUE, label: 'Second candidate' });
  await ui.studio().importProject(saved);
  const action = label => ui.element('gallery').children.find(card => card.dataset.candidateId === 'parent')
    .querySelectorAll('button').find(button => button.textContent === label);
  const compare = action('비교 선택'); compare.focus();
  assert(ui.sandbox.document.activeElement === compare);
  await compare.click();
  const unselect = action('비교 선택 해제');
  assert.notEqual(unselect, compare, 'the gallery rebuilt the focused button');
  assert(ui.sandbox.document.activeElement === unselect, 'focus stays on the first candidate compare toggle');
  assert.equal(unselect.focusOptions?.preventScroll, true, 'focus restoration must not jump the page');
  assert.equal(unselect.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(ui.state().selectedIds, ['parent']);
  await unselect.click();
  assert(ui.sandbox.document.activeElement === action('비교 선택'), 'unselect also preserves focus');
  assert.equal(action('비교 선택').focusOptions?.preventScroll, true);
  assert.deepEqual(ui.state().selectedIds, []);
  const view = action('크게 보기'); view.focus(); await view.click();
  assert.notEqual(action('크게 보기'), view);
  assert(ui.sandbox.document.activeElement === action('크게 보기'), 'view preserves its corresponding rebuilt button');
  assert.equal(action('크게 보기').focusOptions?.preventScroll, true);
  assert.equal(ui.state().latestUrl, RED);
});

test('board export uses an uploaded source when no generated result is selected', async () => {
  const ui = page(); await ui.input('projectName', 'Uploaded character');
  const upload = ui.upload('upload', 'blob:source-only', BLUE); await ui.finishSource('blob:source-only', upload);
  assert.equal(ui.state().latestUrl, null); assert(ui.state().sourceId);
  assert.deepEqual(ui.state().selectedIds, []);
  await ui.element('exportBoard').onclick();
  assert.equal(ui.downloads.length, 1);
  assert.equal(ui.downloads[0].name, 'Uploaded character-board.png');
  assert.equal(ui.downloads[0].blob.type, 'image/png');
  assert.equal(ui.exportCanvases[0].exportType, 'image/png');
  assert.deepEqual(ui.exportCanvases[0].context.draws, [BLUE]);
  assert(ui.exportCanvases[0].context.texts.some(line => line.text === 'Uploaded character'));
  assert.equal(ui.requests.length, 0);
});

test('board export keeps its captured name and brief while a newer edit is made', async () => {
  const ui = page(); await ui.input('projectName', 'Before name'); await ui.input('brief', 'Before brief');
  const upload = ui.upload('upload', 'blob:board-source', BLUE); await ui.finishSource('blob:board-source', upload);
  ui.heldImages.add(BLUE);
  const exporting = ui.element('exportBoard').onclick();
  await until(() => ui.images.get(BLUE)?.some(item => !item.done), 'board source decode');
  await ui.input('projectName', 'After name'); await ui.input('brief', 'After brief');
  ui.element('projectStatus').textContent = 'Newer editing status';
  ui.decode(BLUE); await exporting;
  assert.equal(ui.downloads.length, 1); assert.equal(ui.downloads[0].name, 'Before name-board.png');
  const text = ui.exportCanvases[0].context.texts.map(line => line.text);
  assert(text.includes('Before name')); assert(text.includes('Before brief'));
  assert(!text.includes('After name')); assert(!text.includes('After brief'));
  assert.equal(ui.state().project.brief.name, 'After name'); assert.equal(ui.state().project.brief.brief, 'After brief');
  assert.equal(ui.element('projectStatus').textContent, 'Newer editing status');
});

test('empty canvas instructions follow generation and editing mode', async () => {
  const ui = page(); const heading = ui.element('emptyHeading').textContent;
  const description = ui.element('emptyDescription').textContent;
  assert(heading && description);
  await ui.input('mode', 'inpaint');
  assert(ui.element('emptyHeading').textContent.includes('원본'));
  assert(ui.element('emptyDescription').textContent.includes('업로드'));
  assert(ui.element('emptyDescription').textContent.includes('칠'));
  assert.notEqual(ui.element('emptyHeading').textContent, heading);
  await ui.input('mode', 'txt2img');
  assert.equal(ui.element('emptyHeading').textContent, heading);
  assert.equal(ui.element('emptyDescription').textContent, description);
});

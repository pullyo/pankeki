'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const { execFileSync } = require('node:child_process');
const filename = path.join(__dirname, 'test_character_motion.cjs');
const source = fs.readFileSync(filename, 'utf8');
const boundary = source.indexOf("\ntest('module_is_side_effect_free");
assert(boundary > 0, 'Review the existing motion harness boundary');
const harness = new Module(filename, module);
harness.filename = filename; harness.paths = module.paths;
harness._compile(source.slice(0, boundary) + '\nmodule.exports={domSurface,clock,fixture,decodeAsset,clone};', filename);
const { domSurface, clock, fixture, decodeAsset, clone } = harness.exports;
const Motion = require('../web/src/character-motion.js');
const Renderer = require('../web/src/character-renderer.js');
const Design = require('../web/src/profiles.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) { for (let i = 0; i < 100 && !predicate(); i++) await tick(); assert(predicate(), 'Expected UI transition'); }
function uiSurface() {
  const root = domSurface();
  for (const [id, tag] of Object.entries({ motionEditor: 'div', motionSourceSelect: 'select',
    motionUseSource: 'button', motionPartDetails: 'details', motionParameterDetails: 'details',
    motionExportDetails: 'details', motionProjectTools: 'details', motionExportLive: 'div',
    motionCancelExport: 'button', motionExportProgress: 'progress', motionExportStatus: 'p' })) {
    const node = root.createElement(tag); node.open = false; root.nodes.set(id, node);
  }
  const select = root.nodes.get('motionSourceSelect'); let requested = '';
  Object.defineProperty(select, 'value', { get() { return this.children.some(o => o.value === requested) ? requested : ''; },
    set(value) { requested = String(value); } });
  root.nodes.get('motionUseSource').dataset.motionAction = 'use-source';
  root.nodes.get('motionCancelExport').dataset.motionAction = 'cancel-export';
  root.nodes.get('motionExportLive').hidden = true;
  root.nodes.get('motionExportStatus').textContent = '준비된 리그와 동작을 확인한 뒤 출력할 수 있습니다.';
  const styles = new Map();
  root.nodes.get('motionEditor').style = { setProperty: (name, value) => styles.set(name, value), getPropertyValue: name => styles.get(name) || '' };
  return { root, select, button: root.nodes.get('motionUseSource'), styles };
}
async function mount({ initial = fixture, ...options } = {}) {
  const ui = uiSurface(), time = clock(), errors = [];
  const c = Motion.mount(ui.root, { renderer: Renderer, decodeAsset, clock: time, onError: e => errors.push(e), ...options });
  await c.ready;
  if (initial) await c.loadDocument(clone(initial));
  return { ...ui, c, time, errors };
}
const external = () => Array.from({ length: 5 }, (_, i) => ({ id: 'external-' + i, label: '후보 ' + (i + 1) }));
const blank = () => Design.createProject({}, [], []);

test('five source candidates keep a named empty choice and disable preparation until valid selection', async () => {
  const ui = await mount({ initial: blank(), getSourceCandidates: external });
  try {
    assert.equal(ui.button.disabled, true, 'No valid selected source: preparation must be disabled');
    assert.equal(ui.select.children.length, 6);
    assert.equal(ui.select.children[0].value, '');
    assert.equal(ui.select.children[0].textContent, '기준 후보를 선택하세요');
    assert.equal(ui.select.value, ''); assert.equal(ui.button.disabled, true);
    assert.equal(ui.c.getSummary().sourceCandidateId, null);
    ui.select.value = 'external-2'; ui.select.events.get('change')?.();
    assert.equal(ui.button.disabled, false);
    assert.equal(ui.c.getSummary().sourceCandidateId, null, 'Choosing an option must not prepare the source automatically');
  } finally { ui.c.destroy(); }
});

test('source choice survives labels and document edits but removed choices become empty and disabled', async () => {
  let sources = external(); const ui = await mount({ getSourceCandidates: () => sources });
  try {
    assert.equal(ui.select.value, fixture.sourceCandidateId);
    ui.select.value = 'external-2'; ui.select.events.get('change')?.();
    sources = sources.map(c => c.id === 'external-2' ? { ...c, label: '이름 변경' } : c);
    ui.c.refreshSources(); await ui.c.selectPart('body');
    assert.equal(ui.select.value, 'external-2');
    assert.equal(ui.c.getSummary().sourceCandidateId, fixture.sourceCandidateId);
    sources = sources.filter(c => c.id !== 'external-2'); ui.c.refreshSources();
    assert.equal(ui.select.value, ''); assert.equal(ui.button.disabled, true);
    assert.equal(ui.c.getSummary().sourceCandidateId, fixture.sourceCandidateId);
  } finally { ui.c.destroy(); }
});

test('only an explicit enabled preparation action replaces the actual source candidate', async () => {
  const next = clone(fixture); next.id = 'external-project';
  next.candidates[0].id = 'external-2'; next.sourceCandidateId = 'external-2';
  next.selectionHistory = []; next.parts = []; next.rigs = []; next.presets = []; next.motions = [];
  next.selection = { activeCandidateId: 'external-2', compareCandidateIds: [], partId: null };
  const ui = await mount({ initial: blank(), getSourceCandidates: external,
    getSourceDocument: async id => { assert.equal(id, 'external-2'); return next; } });
  try {
    ui.select.value = 'external-2'; ui.select.events.get('change')?.();
    assert.equal(ui.c.getSummary().sourceCandidateId, null);
    ui.root.events.get('click')({ target: ui.button });
    await until(() => ui.c.getSummary().sourceCandidateId === 'external-2');
    assert.equal(ui.c.getSummary().partCount, 0); assert.equal(ui.c.getSummary().ready, false);
    assert.deepEqual(ui.errors, []);
  } finally { ui.c.destroy(); }
});

test('motion hooks and native details follow preparation and selection without overriding manual collapse', async () => {
  const ui = await mount({ initial: blank() });
  try {
    const editor = ui.root.nodes.get('motionEditor');
    for (const key of ['motionHasParts', 'motionHasSelection', 'motionReady']) assert.equal(editor.dataset[key], 'false');
    assert.equal(ui.root.nodes.get('motionPartDetails').open, false);
    assert.equal(ui.root.nodes.get('motionParameterDetails').open, false);
    assert.equal(ui.root.nodes.get('motionExportDetails').open, false);
    await ui.c.loadDocument(clone(fixture));
    for (const key of ['motionHasParts', 'motionHasSelection', 'motionReady']) assert.equal(editor.dataset[key], 'true');
    for (const id of ['motionPartDetails', 'motionParameterDetails', 'motionExportDetails']) assert.equal(ui.root.nodes.get(id).open, true);
    ui.root.nodes.get('motionParameterDetails').open = false;
    await ui.c.previewParameters({ eyeOpen: 0.5 }); ui.c.refreshSources();
    assert.equal(ui.root.nodes.get('motionParameterDetails').open, false);
    await ui.c.dispatch('setSelection', { selection: { partId: null } });
    assert.equal(editor.dataset.motionHasSelection, 'false');
    assert.equal(editor.dataset.motionHasParts, 'true'); assert.equal(editor.dataset.motionReady, 'true');
    assert.equal(ui.root.nodes.get('motionPartDetails').open, false);
    await ui.c.selectPart('body'); assert.equal(ui.root.nodes.get('motionPartDetails').open, true);
  } finally { ui.c.destroy(); }
});

test('CSS canvas ratio uses document dimensions and falls back to one without changing its canvas', async () => {
  const ui = await mount({ initial: null });
  try {
    assert.equal(ui.styles.get('--motion-canvas-ratio'), '1');
    const next = clone(fixture); next.canvas.width = 64; next.canvas.height = 32;
    next.parts = []; next.rigs = []; next.presets = []; next.motions = []; next.backgroundAssetId = null; next.selection.partId = null;
    await ui.c.loadDocument(next);
    assert.equal(ui.styles.get('--motion-canvas-ratio'), '2');
    assert.deepEqual(JSON.parse(await ui.c.snapshotProject()).canvas, next.canvas);
  } finally { ui.c.destroy(); }
});

test('output freeze disables source preparation and keeps cancel and progress accessible when details close', async () => {
  let release, options; const downloads = [];
  const ui = await mount({ exporter: { exportFrames: value => { options = value; return new Promise(r => release = r); } },
    download: (_, name) => downloads.push(name) });
  const pending = ui.c.exportFrames();
  try {
    await until(() => !!options);
    assert.equal(ui.select.disabled, true); assert.equal(ui.button.disabled, true);
    assert.equal(ui.root.nodes.get('motionExportLive').hidden, false);
    ui.root.nodes.get('motionExportDetails').open = false; ui.c.refreshSources();
    assert.equal(ui.root.nodes.get('motionExportDetails').open, false);
    assert.equal(ui.root.nodes.get('motionCancelExport').disabled, false);
    assert.equal(ui.root.nodes.get('motionExportLive').hidden, false);
    options.onProgress({ completed: 3 }); assert.equal(ui.root.nodes.get('motionExportProgress').value, 3);
    ui.c.cancelExport(); release(new Blob(['late'])); assert.equal(await pending, false);
    assert.deepEqual(downloads, []); assert.equal(ui.root.nodes.get('motionExportLive').hidden, true);
    assert.equal(ui.button.disabled, false);
  } finally { if (release) release(new Blob()); await pending; ui.c.destroy(); }
});

test('loading and destroyed workspaces cannot prepare a source and initial load does not claim an export cancellation', async () => {
  const ui = await mount(); let release;
  const gate = new Promise(r => release = r);
  const pending = ui.c.loadDocument(clone(fixture), { decodeAsset: async a => { await gate; return decodeAsset(a); } });
  try {
    assert.equal(ui.select.disabled, true); assert.equal(ui.button.disabled, true);
    release(); await pending;
    assert.match(ui.root.nodes.get('motionExportStatus').textContent, /준비된 리그/);
    assert.equal(ui.button.disabled, false);
    ui.c.destroy(); assert.equal(ui.select.disabled, true); assert.equal(ui.button.disabled, true);
  } finally { release(); await pending; ui.c.destroy(); }
});

let html;
function templateTree() {
  if (html) return html;
  const code = `import json,sys\nfrom html.parser import HTMLParser\nclass Parse(HTMLParser):\n def __init__(self): super().__init__(); self.nodes=[]; self.stack=[]\n def handle_starttag(self,tag,attrs):\n  self.nodes.append({'tag':tag,'attrs':dict(attrs),'parent':self.stack[-1] if self.stack else None})\n  if tag not in {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}: self.stack.append(len(self.nodes)-1)\n def handle_endtag(self,tag):\n  for i in range(len(self.stack)-1,-1,-1):\n   if self.nodes[self.stack[i]]['tag']==tag: del self.stack[i:]; break\np=Parse(); p.feed(open(sys.argv[1],encoding='utf8').read()); print(json.dumps(p.nodes))`;
  html = JSON.parse(execFileSync('python3', ['-c', code, path.join(__dirname, '../web/src/index.template.html')], { encoding: 'utf8' }));
  return html;
}
function node(id) { const n = templateTree().find(n => n.attrs.id === id); assert(n, 'Template needs #' + id); return n; }
function within(n, parent) { const tree = templateTree(); while (n && n !== parent) n = tree[n.parent]; return n === parent; }
function cls(n, name) { return (n.attrs.class || '').split(/\s+/).includes(name); }
test('template provides native named details and preserves all part parameter and project management controls', () => {
  const tree = templateTree();
  for (const [id, controls] of Object.entries({ motionPartDetails: ['motionPartName', 'motionPartParent', 'motionApplyPart', 'motionRemovePart'],
    motionParameterDetails: ['warmEyeOpen', 'warmMouthOpen', 'warmBreathing', 'warmExpressionPreset', 'motionSavePreset'],
    motionProjectTools: ['motionLoadDemo', 'motionPickProject', 'motionProjectUpload', 'motionSaveProject', 'motionUndo', 'motionRedo'] })) {
    const details = node(id); assert.equal(details.tag, 'details');
    assert(tree.some(n => n.parent === tree.indexOf(details) && n.tag === 'summary'));
    for (const control of controls) assert(within(node(control), details), control + ' must remain accessible through its summary');
  }
  for (const id of ['motionPartDetails', 'motionParameterDetails']) {
    const details = node(id); assert(cls(tree[details.parent], 'motion-detail-panel'));
    assert(!Object.hasOwn(details.attrs, 'hidden')); assert(!Object.hasOwn(tree[details.parent].attrs, 'hidden'));
  }
  for (const key of ['data-motion-has-parts', 'data-motion-has-selection', 'data-motion-ready']) assert.equal(node('motionEditor').attrs[key], 'false');
});
test('image export actions precede motion details and active output progress is outside collapsible content', () => {
  const tree = templateTree(), details = node('motionExportDetails');
  assert.equal(details.tag, 'details');
  const grid = tree.find(n => cls(n, 'image-export-grid')); assert(grid);
  for (const action of ['download', 'board', 'save']) {
    assert(tree.some(n => n.attrs['data-studio-action'] === action && within(n, grid)));
  }
  assert(tree.indexOf(grid) < tree.indexOf(details));
  assert(tree.some(n => cls(n, 'image-export-preview') && within(n, grid)));
  assert(tree.some(n => cls(n, 'image-export-viewport') && within(n, grid)));
  assert(within(node('motionExportPng'), details)); assert(within(node('motionExportFrames'), details));
  assert(within(node('motionCancelExport'), node('motionExportLive')));
  assert(within(node('motionExportProgress'), node('motionExportLive')));
  for (const id of ['motionExportLive', 'motionExportStatus']) assert(!within(node(id), details));
});

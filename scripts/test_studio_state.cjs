'use strict';
// Exercise current app.js plus the workflow adapter with controlled browser I/O.
const { readFileSync } = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const vm = require('node:vm');
const filename = path.join(__dirname, 'test_ui_state.cjs');
const source = readFileSync(filename, 'utf8');
const boundary = source.indexOf("\ntest('selected model preset reaches");
if (boundary < 0) throw Error('Review changed UI harness boundary');
const harness = new Module(filename, module); harness.filename = filename; harness.paths = module.paths;
harness._compile(source.slice(0, boundary) + '\nmodule.exports = {test, assert, page, plain, settle, until, RED, BLUE, WHITE};', filename);
const { test, assert, page, plain, settle, until, RED, BLUE, WHITE } = harness.exports;

function workflow(options) {
  const ui = page(options), doc = ui.sandbox.document;
  const screens = ['home', 'design', 'compare', 'inpaint', 'parts', 'motion', 'export'];
  const nav = {}, pages = {}, actions = {};
  function append(id, tag = 'div') { const node = ui.element(id); node.tagName = tag.toUpperCase(); doc.body.append(node); return node; }
  const shell = append('workflowShell'); shell.className = 'app-shell';
  append('skip-workspace', 'a').className = 'skip-link';
  for (const screen of screens) {
    nav[screen] = append('go-' + screen, 'button'); nav[screen].dataset.studioGo = screen;
    const heading = append('heading-' + screen); heading.dataset.studioHeading = screen;
    if (['home', 'parts', 'motion', 'export'].includes(screen)) {
      pages[screen] = append('page-' + screen); pages[screen].dataset.studioPage = screen;
      if (screen !== 'home') { const image = append('image-' + screen, 'img'); image.dataset.studioImage = ''; image.hidden = true; }
    }
  }
  for (const action of ['new', 'upload', 'import', 'save', 'board', 'download', 'continue', 'help']) {
    actions[action] = append('action-' + action, 'button'); actions[action].dataset.studioAction = action;
  }
  const planned = append('planned-motion', 'button'); planned.dataset.studioPlanned = '';
  for (const id of ['studioTitle', 'studioStatus', 'studioCandidateCount', 'studioCurrentImage', 'studioCurrentSummary']) append(id);
  const oldQuery = doc.querySelectorAll;
  const all = () => doc.body.children.flatMap(node => [node, ...node.querySelectorAll('*')]);
  doc.querySelectorAll = selector => {
    const key = selector.match(/^\[data-studio-([a-z]+)\]$/)?.[1];
    if (key) return all().filter(node => Object.hasOwn(node.dataset || {}, 'studio' + key[0].toUpperCase() + key.slice(1)));
    if (selector === '.app-shell') return [shell];
    if (selector === '.skip-link') return [ui.element('skip-workspace')];
    return oldQuery(selector);
  };
  doc.querySelector = selector => doc.querySelectorAll(selector)[0] || null;
  const adapter = path.join(__dirname, '../web/src/studio.js');
  assert(require('node:fs').existsSync(adapter), 'workflow adapter must be implemented');
  vm.runInContext(readFileSync(adapter, 'utf8'), ui.sandbox, { filename: adapter });
  assert(ui.sandbox.PankekiWorkflowController, 'browser mount must expose its controller');
  return { ...ui, doc, nav, pages, actions, shell, planned, controller: ui.sandbox.PankekiWorkflowController };
}

test('app subscriptions expose a small immutable summary and can be detached', async () => {
  const ui = page(); assert.equal(typeof ui.studio().subscribe, 'function');
  const seen = []; const detach = ui.studio().subscribe(summary => seen.push(summary));
  assert(seen.length); assert.equal(Object.isFrozen(seen[0]), true);
  assert.equal(Object.hasOwn(seen[0], 'project'), false);
  await ui.input('projectName', 'A changed title');
  assert.equal(seen.at(-1).name, 'A changed title');
  detach(); const count = seen.length;
  await ui.input('projectName', 'After detach'); assert.equal(seen.length, count);
});

test('stage navigation preserves project, source, mask and sends no model requests', async () => {
  const ui = workflow(); await ui.studio().importProject(ui.project('Kept'));
  const before = ui.studio().exportProject(); ui.element('paint').snapshot = WHITE;
  for (const screen of ['inpaint', 'parts', 'motion', 'export', 'home', 'design']) await ui.nav[screen].click();
  assert.equal(ui.studio().exportProject(), before);
  assert.equal(ui.state().sourceDataURL, RED); assert.equal(ui.element('paint').snapshot, WHITE);
  assert.equal(ui.doc.body.dataset.studioScreen, 'design'); assert.equal(ui.shell.hidden, false);
  assert.equal(ui.pages.home.hidden, true); assert.equal(ui.requests.length, 0);
  assert.equal(ui.nav.design.getAttribute('aria-current'), 'step');
  assert.equal(ui.nav.home.getAttribute('aria-current'), null);
});

test('planned screens remain labeled and their controls cannot manufacture outputs', async () => {
  const ui = workflow(); await ui.nav.parts.click();
  assert.equal(ui.pages.parts.hidden, false); assert.equal(ui.shell.hidden, true);
  assert.match(ui.element('studioStatus').textContent, /Parts preparation/);
  await ui.nav.motion.click(); assert.equal(ui.pages.motion.hidden, false);
  assert.equal(ui.planned.disabled, true); assert.match(ui.element('studioStatus').textContent, /Expressions and motion/);
  assert.equal(ui.requests.length, 0); assert.equal(ui.downloads.length, 0);
  assert.equal(ui.state().project.versions.length, 0);
});

test('home only reflects the current restored project and clears its image on reset', async () => {
  const ui = workflow({ catalog: null }); await ui.studio().importProject(ui.project('Actual project'));
  await ui.nav.home.click();
  assert.equal(ui.element('studioTitle').textContent, 'Actual project');
  assert.equal(ui.element('studioCurrentImage').src, RED); assert.equal(ui.element('studioCurrentImage').hidden, false);
  assert.match(ui.element('studioCandidateCount').textContent, /1/);
  await ui.actions.new.click();
  assert.equal(ui.doc.body.dataset.studioScreen, 'design');
  assert.equal(ui.element('studioCurrentImage').hidden, true);
  assert.equal(ui.state().project.versions.length, 0); assert.equal(ui.requests.length, 0);
});

test('planned and export image slots show actual project images and clear after reset', async () => {
  const ui = workflow(); await ui.studio().importProject(ui.project('Existing image'));
  for (const screen of ['parts', 'motion', 'export']) {
    await ui.nav[screen].click(); const image = ui.element('image-' + screen);
    assert.equal(image.src, RED); assert.equal(image.hidden, false);
  }
  await ui.actions.new.click();
  for (const screen of ['parts', 'motion', 'export']) assert.equal(ui.element('image-' + screen).hidden, true);
});

test('inpaint summary image follows the selected source rather than a different latest result', async () => {
  const ui = workflow(); const saved = ui.project('Original');
  saved.versions.push({ ...plain(saved.versions[0]), id: 'latest', image: BLUE });
  await ui.studio().importProject(saved);
  await ui.sandbox.loadSource(RED, { parentId: 'parent' }); await ui.nav.inpaint.click();
  assert.equal(ui.state().latestUrl, BLUE); assert.equal(ui.state().sourceDataURL, RED);
  assert.equal(ui.element('studioCurrentImage').src, RED);
  assert.equal(ui.element('image-parts').src, RED);
});

test('boolean heading markers in the actual template receive focus and counters fit their suffix', async () => {
  const ui = workflow(); const heading = ui.element('heading-export');
  heading.dataset.studioHeading = ''; heading.remove(); ui.pages.export.append(heading);
  await ui.studio().importProject(ui.project('One candidate')); await ui.nav.export.click();
  assert(ui.doc.activeElement === heading, 'the visible page heading must receive focus');
  assert.equal(ui.element('studioCandidateCount').textContent, '1');
});

test('skip link reveals the actual workspace while starting on the home screen', async () => {
  const ui = workflow(); assert.equal(ui.shell.hidden, true);
  await ui.element('skip-workspace').click();
  assert.equal(ui.shell.hidden, false); assert.equal(ui.doc.body.dataset.studioScreen, 'design');
});

test('existing header reset opens design after acceptance and preserves export on refusal', async () => {
  const ui = workflow(); await ui.studio().importProject(ui.project('Header reset'));
  await ui.nav.export.click(); ui.sandbox.confirm = () => false;
  await ui.element('newProject').click(); assert.equal(ui.doc.body.dataset.studioScreen, 'export');
  assert.equal(ui.state().project.versions.length, 1);
  ui.sandbox.confirm = () => true; await ui.element('newProject').click();
  assert.equal(ui.doc.body.dataset.studioScreen, 'design'); assert.equal(ui.state().project.versions.length, 0);
});

test('declining a new project keeps both the previous route and current work', async () => {
  const ui = workflow(); await ui.studio().importProject(ui.project('Preserve'));
  await ui.nav.export.click(); ui.sandbox.confirm = () => false;
  const before = ui.studio().exportProject(); await ui.actions.new.click();
  assert.equal(ui.doc.body.dataset.studioScreen, 'export'); assert.equal(ui.studio().exportProject(), before);
});

test('compare stage uses the actual selected candidates and closes through the existing action', async () => {
  const ui = workflow(); const saved = ui.project('Compare');
  saved.versions.push({ ...plain(saved.versions[0]), id: 'other', image: BLUE });
  await ui.studio().importProject(saved); await ui.nav.compare.click();
  assert.equal(ui.element('comparePanel').hidden, true); assert.match(ui.element('studioStatus').textContent, /two candidates/);
  for (const id of ['parent', 'other']) {
    const card = ui.element('gallery').children.find(item => item.dataset.candidateId === id);
    await card.querySelectorAll('button').find(node => node.dataset.action === 'compare').click();
  }
  await ui.nav.compare.click();
  assert.equal(ui.element('comparePanel').hidden, false);
  assert.deepEqual(ui.element('compareGrid').querySelectorAll('img').map(node => node.src), [RED, BLUE]);
  await ui.element('closeCompare').click(); assert.equal(ui.doc.body.dataset.studioScreen, 'design');
});

test('existing upload and candidate edit callbacks move to inpaint without replacing their behavior', async () => {
  const ui = workflow(); await ui.nav.design.click();
  const upload = ui.upload('upload', 'blob:new-source', BLUE); await ui.finishSource('blob:new-source', upload);
  assert.equal(ui.doc.body.dataset.studioScreen, 'inpaint'); assert.equal(ui.state().sourceDataURL, BLUE);
  assert.equal(ui.state().project.versions[0].kind, 'upload');
  await ui.nav.design.click();
  const card = ui.element('gallery').children.find(node => node.dataset.candidateId);
  await card.querySelectorAll('button').find(node => node.dataset.action === 'edit').click();
  assert.equal(ui.doc.body.dataset.studioScreen, 'inpaint'); assert.equal(ui.state().sourceDataURL, BLUE);
  assert.equal(ui.state().project.selectionHistory.at(-1).action, 'edit');
});

test('save and board actions invoke actual version1 export and board handlers', async () => {
  const ui = workflow(); await ui.studio().importProject(ui.project('Real export'));
  await ui.actions.save.click();
  assert.equal(ui.downloads.length, 1); assert.equal(ui.downloads[0].name, 'Real export.pankeki.json');
  const project = JSON.parse(await ui.downloads[0].blob.text());
  assert.equal(project.version, 1); assert.equal(project.versions[0].image, RED);
  assert.deepEqual(Object.keys(project).sort(), ['brief', 'selectionHistory', 'version', 'versions']);
  await ui.actions.board.click();
  await until(() => ui.downloads.length === 2, 'actual board download');
  assert.equal(ui.downloads[1].name, 'Real export-board.png'); assert.equal(ui.downloads[1].blob.type, 'image/png');
  assert.equal(ui.requests.length, 0);
});

test('reading other stages during a running generation preserves its request and result', async () => {
  const ui = workflow(); ui.element('candidateCount').value = '1';
  await ui.nav.design.click(); const pending = ui.studio().generate(); await ui.accept(0);
  const original = plain(ui.requests[0].body.request);
  await ui.nav.parts.click(); await ui.nav.export.click(); await ui.complete(0, BLUE); await pending;
  assert.deepEqual(ui.requests[0].body.request, original); assert.equal(ui.cancellations.length, 0);
  assert.equal(ui.state().project.versions[0].image, BLUE); assert.equal(ui.state().busy, false);
  assert.equal(ui.doc.body.dataset.studioScreen, 'export');
});

test('precise rigging route hides and restores the native motion panel, project tools and mode buttons', async () => {
  const ui = workflow(); const doc = ui.doc;
  for (const id of ['motionNativePanel', 'motionProjectTools', 'v3Workspace']) doc.body.append(ui.element(id));
  const nativeMode = ui.element('motionNativeMode', 'button'), v3Mode = ui.element('v3Mode', 'button');
  doc.body.append(nativeMode, v3Mode);
  const seen = [];
  ui.sandbox.PankekiAuthoringV3Controller = { show: screen => seen.push(['show', screen]), suspend: () => seen.push(['suspend']) };
  vm.runInContext('authoringV3Selected = true', ui.sandbox);
  ui.controller.go('motion');
  assert.equal(ui.element('motionNativePanel').hidden, true);
  assert.equal(ui.element('motionProjectTools').hidden, true);
  assert.equal(ui.element('v3Workspace').hidden, false);
  assert.equal(v3Mode.getAttribute('aria-pressed'), 'true');
  assert.equal(nativeMode.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(seen, [['show', 'motion']]);
  vm.runInContext('authoringV3Selected = false', ui.sandbox);
  ui.controller.go('motion');
  assert.equal(ui.element('motionNativePanel').hidden, false);
  assert.equal(ui.element('motionProjectTools').hidden, false, 'returning to native authoring must show the project tools again');
  assert.equal(ui.element('v3Workspace').hidden, true);
  assert.equal(v3Mode.getAttribute('aria-pressed'), 'false');
  assert.equal(nativeMode.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(seen.at(-1), ['suspend']);
});

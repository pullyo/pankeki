// Inpaint request regressions; passing tests do not establish image quality.
// Uses the existing VM harness: no browser, network, server, or GPU is used.
'use strict';
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');

const filename = path.join(__dirname, 'test_ui_state.cjs');
const source = readFileSync(filename, 'utf8');
const boundary = source.indexOf("\ntest('selected model preset reaches");
if (boundary < 0) throw Error('Review changed UI harness boundary');
const harness = new Module(filename, module);
harness.filename = filename;
harness.paths = module.paths;
harness._compile(source.slice(0, boundary) + '\nmodule.exports={test,assert,page,RED,WHITE,MODEL_CATALOG,until};', filename);
const { test, assert, page, RED, WHITE, MODEL_CATALOG, until } = harness.exports;
const Redesign = require('../web/src/redesign.js');

const EDIT = 'Change only the scarf to red. Preserve its shape and all other colors.';
const CHARACTER_STYLE = 'Expressive original character design, detailed 2d anime illustration.';
const BACKGROUND_STYLE = 'Detailed environment background illustration, atmospheric lighting, no characters.';
const BRIEF = 'A friendly mascot character.';
const APPEARANCE = 'The character wears a blue scarf and a green coat, with round ears.';
const DETAIL = 'A plain white background.';
const GUIDANCE = 'Original character concept art, a distinctive coherent silhouette, readable outfit and meaningful accessories, one character.';
const PALETTE = 'Suggested palette: #0000FF, #008000, #FFFFFF.';

async function submit({ mode = 'inpaint', useBrief = true, category = 'character', text = EDIT } = {}) {
  const ui = page({ autoJobs: true, catalog: { ...MODEL_CATALOG, default_model_id: 'sdxl-base' } });
  const redesignPath = path.join(__dirname, '../web/src/redesign.js');
  vm.runInContext(readFileSync(redesignPath, 'utf8'), ui.sandbox, { filename: redesignPath });
  const api = ui.sandbox.PankekiRedesign;
  const saved = ui.project('Inpaint prompt diagnostic');
  Object.assign(saved.brief, {
    profile: 'original', brief: BRIEF, appearance: APPEARANCE, detail: DETAIL,
    palette: ['#0000FF', '#008000', '#FFFFFF'], prompt: 'A character wearing a blue scarf.', useBrief,
  });
  saved.versions[0].brief = JSON.parse(JSON.stringify(saved.brief));
  assert.equal(await ui.studio().importProject(saved), true);
  await until(() => ui.studio().getSummary().modelsReady, 'model catalog');
  const { prompt: oldPrompt, ...originalBrief } = ui.state().project.brief;
  ui.studio().setMode(mode);
  if (mode === 'inpaint') await ui.input('imageModel', 'sdxl-base');
  ui.element('candidateCount').value = '1';
  ui.element('negative').value = 'blurry, artifacts';
  // pcPrompt -> original prompt forwarding is traced in the source report.
  // This existing harness enters the real original-field/helper boundary;
  // it does not mount the redesign DOM or test keyboard/rendering behavior.
  await ui.input('prompt', text);
  ui.element('paint').snapshot = WHITE;
  assert.equal(await api.submitPrompt(ui.studio(), ui.element('prompt'), category), true);
  assert.equal(ui.requests.length, 1);
  const request = ui.requests[0].body.request;
  assert.equal(request.mode, mode);
  assert.equal(request.model_id, 'sdxl-base');
  assert.equal(request.negative, 'blurry, artifacts');
  assert.equal(request.seed, 42);
  assert.equal(request.denoise, mode==='inpaint'?.55:1,'inpaint keeps the explicit edit strength while txt2img keeps its existing request default');
  if (mode === 'inpaint') {
    assert.equal(request.source, RED);
    assert.equal(request.mask, WHITE);
  }
  const result = ui.state().project;
  assert.equal(result.versions.length, 2);
  assert.equal(result.versions[0].id, 'parent');
  assert.equal(result.versions[1].parentId, mode === 'inpaint' ? 'parent' : null);
  assert.equal(result.versions[1].request.prompt, request.prompt);
  const { prompt: currentPrompt, ...currentBrief } = result.brief;
  assert.deepEqual(currentBrief, originalBrief);
  assert.deepEqual(result.versions[0], saved.versions[0]);
  return { ui, api, request };
}

test('inpaint sends only the local edit without old appearance, palette or automatic style', async t => {
  const { ui, request } = await submit();
  assert.equal(request.prompt, EDIT);
  assert.equal(ui.element('prompt').value, EDIT);
  t.diagnostic('captured mock POST /api/jobs: ' + JSON.stringify({ mode: request.mode, model_id: request.model_id, prompt: request.prompt }));
});

test('inpaint ignores automatic style and brief controls without changing their stored values', async () => {
  for (const useBrief of [true, false]) {
    for (const category of ['character', 'background', 'chibi']) {
      const { request } = await submit({ useBrief, category });
      assert.equal(request.prompt, EDIT, `${category}, useBrief=${useBrief}`);
    }
  }
});

test('txt2img keeps its complete prompt while inpaint changes only the positive prompt and source contract', async () => {
  const generated = await submit({ mode: 'txt2img' });
  const edited = await submit({ mode: 'inpaint' });
  const expected = [EDIT + '\n\n' + CHARACTER_STYLE, BRIEF, APPEARANCE, DETAIL, GUIDANCE, PALETTE].join('\n');
  assert.equal(generated.request.prompt, expected);
  assert.equal(edited.request.prompt, EDIT);
  assert.equal(Object.hasOwn(generated.request, 'source'), false);
  assert.equal(Object.hasOwn(generated.request, 'mask'), false);
  const settings = ({ mode, source, mask, prompt, steps, width, height, cfg, denoise, trace_id, ...rest }) => rest;
  assert.deepEqual(settings(generated.request), settings(edited.request),'positive-prompt handling preserves shared controls without conflating independent generation and edit presets');
  assert.deepEqual([generated.request.steps,generated.request.width,generated.request.height,generated.request.cfg,generated.request.denoise],[1,512,512,1,1]);
  assert.deepEqual([edited.request.steps,edited.request.width,edited.request.height,edited.request.cfg,edited.request.denoise],[25,1024,1024,6,.55]);
  assert.equal(typeof generated.request.trace_id,'string');assert.equal(typeof edited.request.trace_id,'string');
});

test('inpaint removes only a known style suffix separated from an edit by two newlines', async () => {
  for (const suffix of [CHARACTER_STYLE, BACKGROUND_STYLE]) {
    const { request } = await submit({ text: EDIT + '\n\n' + suffix });
    assert.equal(request.prompt, EDIT);
  }
});

test('inpaint preserves a style sentence used as the edit in both the request and displayed history', async () => {
  for (const text of [CHARACTER_STYLE, BACKGROUND_STYLE]) {
    const { ui, api, request } = await submit({ text });
    assert.equal(request.prompt, text);
    assert.equal(ui.element('prompt').value, text);
    assert.equal(api.conversationEntries(ui.state().project).at(-1).prompt, text);
  }
});

test('inpaint preserves user style instructions without the automatic suffix delimiter', async () => {
  for (const text of [
    EDIT + ' ' + CHARACTER_STYLE,
    EDIT + '\n' + CHARACTER_STYLE,
    'Paint the scarf in a rough watercolor style. Preserve the rest.',
    EDIT + '\n\nUse a rough watercolor style only inside the selection.',
  ]) {
    const { ui, api, request } = await submit({ text });
    assert.equal(request.prompt, text);
    assert.equal(api.conversationEntries(ui.state().project).at(-1).prompt, text);
  }
});

test('inpaint rejects empty edits without a job and accepts the full 4000 character description budget', async () => {
  const ui = page({ autoJobs: true });
  const redesignPath = path.join(__dirname, '../web/src/redesign.js');
  vm.runInContext(readFileSync(redesignPath, 'utf8'), ui.sandbox, { filename: redesignPath });
  ui.studio().setMode('inpaint');
  ui.element('prompt').value = '  \n\n ';
  await assert.rejects(() => ui.sandbox.PankekiRedesign.submitPrompt(ui.studio(), ui.element('prompt'), 'character'), /설명/);
  assert.equal(ui.requests.length, 0);
  assert.equal(Redesign.preparePrompt('x'.repeat(4000), 'character', 'inpaint'), 'x'.repeat(4000));
  assert.throws(() => Redesign.preparePrompt('x'.repeat(4001), 'character', 'inpaint'), /길어요/);
});

test('txt2img retains existing style suffix replacement and length validation', () => {
  const expected = EDIT + '\n\n' + CHARACTER_STYLE;
  assert.equal(Redesign.preparePrompt(EDIT, 'character'), expected);
  assert.equal(Redesign.preparePrompt(EDIT + '\n\n' + BACKGROUND_STYLE, 'character', 'txt2img'), expected);
  assert.throws(() => Redesign.preparePrompt('x'.repeat(4000), 'character', 'txt2img'), /길어요/);
});

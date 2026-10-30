// Actual app/request/document code with the existing VM browser I/O doubles.
// No browser, server, image algorithm, or GPU is exercised here.
'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), Module = require('node:module');
const filename = path.join(__dirname, 'test_ui_state.cjs');
const source = fs.readFileSync(filename, 'utf8');
const boundary = source.indexOf("\ntest('selected model preset reaches");
if (boundary < 0) throw Error('Review changed UI harness boundary');
const harness = new Module(filename, module); harness.filename = filename; harness.paths = module.paths;
harness._compile(source.slice(0, boundary) + '\nmodule.exports={test,assert,page,settle,until,RED,WHITE,BLACK};', filename);
const { test, assert, page, settle, until, RED, WHITE, BLACK } = harness.exports;
const Design = require('../web/src/profiles.js');
const Document = require('../web/src/character-document.js');
function redesign(ui) {
  const file = path.join(__dirname, '../web/src/redesign.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), ui.sandbox, { filename: file });
  return ui.sandbox.PankekiRedesign;
}
async function ready({ autoJobs = true, offline = true } = {}) {
  const ui = page({ autoJobs, ...(offline ? { catalog: null } : {}) });
  await settle();
  await ui.studio().importProject(ui.project('Color project'));
  ui.studio().setMode('inpaint');
  for (const [id, value] of Object.entries({ editOperation: 'recolor', targetColor: '#FF6600', sourceColorMode: 'auto', sourceColor: '#0000FF', colorTolerance: '35', feather: '4', candidateCount: '2', prompt: '' })) await ui.input(id, value);
  ui.element('paint').snapshot = WHITE;
  return ui;
}
const cpuMetadata = (extra = {}) => ({ mode: 'inpaint', edit_operation: 'recolor', target_color: '#FF6600', source_color: null, color_tolerance: 35, feather: 4, ...extra });
function returnSkipped(ui, skipped) {
  const originalFetch = ui.sandbox.fetch;
  ui.sandbox.fetch = async (url, options) => {
    const response = await originalFetch(url, options);
    if (!/^\/api\/jobs\/[^/]+$/.test(String(url))) return response;
    const job = await response.json();
    if (skipped === undefined) delete job.result.metrics.skipped;
    else job.result.metrics.skipped = skipped;
    job.result.metrics.kind = 'local_recolor'; job.result.metrics.model_calls = 0;
    return { ...response, json: async () => job };
  };
}

test('recolor submits exactly one CPU request without model, prompt, or sampler even with a failed model catalog', async () => {
  const ui = await ready();
  assert.equal(ui.studio().getSummary().modelsReady, false);
  assert.equal(ui.element('generate').disabled, false);
  assert.equal(await ui.studio().generate(), true);
  assert.equal(ui.requests.length, 1);
  const {trace_id,...cpuRequest}=ui.requests[0].body.request;
  assert.match(trace_id,/^[A-Za-z0-9_-]{1,128}$/);
  assert.deepEqual(cpuRequest,{...cpuMetadata(),source:RED,mask:WHITE});
  assert.equal(ui.state().project.versions.at(-1).request.trace_id,undefined,'private transport trace is kept in execution, not archived request settings');
  assert.equal(ui.state().project.versions.length, 2);
  assert.equal(ui.state().project.versions[1].parentId, 'parent');
  assert.match(ui.state().project.versions[1].label, /색상 변경/);
  assert.match(ui.element('result').alt, /색상 변경/);
  assert.doesNotMatch(ui.element('result').alt, /생성 결과/);
  await ui.element('exportBoard').onclick();
  assert(ui.exportCanvases.at(-1).context.texts.some(line => line.text === '색상 변경'));
  assert(!ui.exportCanvases.at(-1).context.texts.some(line => line.text === '생성 후보'));
});

test('recolor composer accepts an empty prompt and leaves the brief untouched', async () => {
  const ui = await ready(), api = redesign(ui);
  const before = JSON.stringify(ui.state().project.brief);
  assert.equal(await api.submitPrompt(ui.studio(), ui.element('prompt'), 'background'), true);
  assert.equal(JSON.stringify(ui.state().project.brief), before);
  assert.equal(Object.hasOwn(ui.requests[0].body.request, 'prompt'), false);
  const item = api.conversationEntries(ui.state().project).at(-1);
  assert.equal(item.operation, 'recolor');
  assert.equal(item.prompt, '색상 변경 · #FF6600');
  assert.equal(item.model, '');
});

test('manual source color and tolerance endpoints reach the captured request', async () => {
  for (const tolerance of [0, 90]) {
    const ui = await ready();
    await ui.input('sourceColorMode', 'manual'); await ui.input('colorTolerance', String(tolerance));
    assert.equal(await ui.studio().generate(), true);
    assert.equal(ui.requests[0].body.request.source_color, '#0000FF');
    assert.equal(ui.requests[0].body.request.color_tolerance, tolerance);
  }
});

test('recolor ignores stale invalid AI settings instead of requiring a seed or sampler', async () => {
  const ui = await ready();
  for (const id of ['seed', 'steps', 'width', 'height', 'cfg', 'denoise', 'sampler', 'scheduler']) ui.element(id).value = 'invalid';
  assert.equal(await ui.studio().generate(), true);
  const {trace_id,...cpuRequest}=ui.requests[0].body.request;
  assert.match(trace_id,/^[A-Za-z0-9_-]{1,128}$/);
  assert.deepEqual(cpuRequest,{...cpuMetadata(),source:RED,mask:WHITE});
  assert.equal(ui.state().project.versions.at(-1).request.trace_id,undefined,'private transport trace is kept in execution, not archived request settings');
});

test('choosing recolor clears a prior model readiness error without enabling AI generation', async () => {
  const ui = await ready();
  await ui.input('editOperation', 'regenerate');
  ui.element('status').textContent = 'ComfyUI 서버를 먼저 시작해주세요.';
  ui.element('status').classList.add('error');
  await ui.input('editOperation', 'recolor');
  assert.equal(ui.element('status').classList.contains('error'), false);
  assert.match(ui.element('status').textContent, /선택 영역/);
  assert.equal(ui.studio().getSummary().modelsReady, false);
});

test('invalid recolor color, tolerance, or feather sends no request and preserves candidates', async () => {
  for (const changes of [
    { targetColor: '#FFF' }, { targetColor: 'red' }, { sourceColorMode: 'manual', sourceColor: '#12345G' },
    { colorTolerance: '-1' }, { colorTolerance: '91' }, { colorTolerance: 'NaN' }, { colorTolerance: '' },
    { feather: '-1' }, { feather: '65' }, { editOperation: 'unknown' },
  ]) {
    const ui = await ready(), before = JSON.stringify(ui.state().project.versions);
    for (const [id, value] of Object.entries(changes)) await ui.input(id, value);
    assert.equal(await ui.studio().generate(), false, JSON.stringify(changes));
    assert.equal(ui.requests.length, 0);
    assert.equal(JSON.stringify(ui.state().project.versions), before);
    assert.equal(ui.studio().getSummary().busy, false);
  }
});

test('recolor still requires a committed source and rejects a pending mask', async () => {
  const blank = page({ autoJobs: true, catalog: null }); await settle();
  blank.studio().setMode('inpaint'); await blank.input('editOperation', 'recolor'); await blank.input('targetColor', '#FF6600');
  assert.equal(await blank.studio().generate(), false); assert.equal(blank.requests.length, 0);
  assert.match(blank.element('status').textContent, /원본/);
  const ui = await ready(), pending = ui.upload('maskUpload', 'blob:pending-color-mask', WHITE);
  assert.equal(await ui.studio().generate(), false); assert.equal(ui.requests.length, 0);
  assert.match(ui.element('status').textContent, /마스크/);
  ui.decode('blob:pending-color-mask'); await pending;
});

test('recolor roundtrip keeps metadata and image download and restores color controls', async () => {
  const ui = await ready(); await ui.input('sourceColorMode', 'manual'); await ui.input('colorTolerance', '17');
  assert.equal(await ui.studio().generate(), true);
  const raw = ui.studio().exportProject(), parsed = Design.parseProject(raw), item = parsed.versions.at(-1);
  assert.deepEqual(item.request, cpuMetadata({ source_color: '#0000FF', color_tolerance: 17 }));
  assert.equal(ui.element('download').href, item.image);
  assert.match(ui.element('download').download, /\.png$/);
  const restored = page({ autoJobs: true, catalog: null });
  assert.equal(await restored.studio().importProject(raw), true);
  assert.deepEqual(restored.state().project.versions.at(-1).request, item.request);
  assert.equal(restored.element('editOperation').value, 'recolor');
  assert.equal(restored.element('targetColor').value, '#FF6600');
  assert.equal(restored.element('sourceColorMode').value, 'manual');
  assert.equal(restored.element('sourceColor').value, '#0000FF');
  assert.equal(restored.element('targetColorValue').value, '#FF6600');
  assert.equal(restored.element('sourceColorValue').value, '#0000FF');
  assert.equal(restored.element('colorTolerance').value, '17');
  assert.equal(restored.element('paint').snapshot, BLACK);
  // Each VM's deterministic UUID counter restarts. Real browser UUIDs do not.
  restored.sandbox.crypto.randomUUID = () => 'restored-color-child';
  restored.studio().setMode('inpaint'); restored.element('paint').snapshot = WHITE;
  assert.equal(await restored.studio().generate(), true);
  assert.equal(restored.state().project.versions.at(-1).parentId, item.id);
});

test('recolor metadata survives conversion to a v2 document without an inferred model', async () => {
  const ui = await ready(); assert.equal(await ui.studio().generate(), true);
  const legacy = JSON.parse(ui.studio().exportProject());
  const options = { decodeAsset: async () => ({ width: 1, height: 1 }) };
  const converted = await Document.fromV1(legacy, options);
  const parsed = await Document.parseDocument(await Document.serializeDocument(converted), options);
  assert.deepEqual(parsed.candidates.at(-1).request, cpuMetadata());
  assert.equal(parsed.candidates.at(-1).parentId, 'parent');
});

test('recolor request imports reject invalid metadata without replacing the working project', async () => {
  const ui = await ready();
  for (const change of [
    { mode: 'txt2img' }, { edit_operation: 'unknown' }, { target_color: 'red' },
    { source_color: '#123' }, { color_tolerance: 91 }, { color_tolerance: '35' }, { feather: -1 },
  ]) {
    const invalid = ui.project('Invalid color'); invalid.versions[0].request = cpuMetadata(change);
    assert.equal(await ui.studio().importProject(invalid), false, JSON.stringify(change));
    assert.equal(ui.state().project.brief.name, 'Color project');
  }
});

test('recolor defaults nullable source and tolerance in saved metadata while explicit regenerate remains valid', () => {
  const ui = page(), saved = ui.project();
  saved.versions[0].request = { mode: 'inpaint', edit_operation: 'recolor', target_color: '#FF6600', feather: 4 };
  const cpu = Design.parseProject(saved);
  assert.deepEqual(cpu.versions[0].request, cpuMetadata());
  saved.versions[0].request = { mode: 'inpaint', edit_operation: 'regenerate', prompt: 'A red scarf', seed: 42 };
  assert.equal(Design.parseProject(saved).versions[0].request.edit_operation, 'regenerate');
});

test('switching from recolor back to AI edit keeps the existing prompt and model request', async () => {
  const ui = await ready({ offline: false });
  await ui.input('imageModel', 'sd-turbo');
  await ui.input('editOperation', 'regenerate'); await ui.input('prompt', 'A red scarf');
  ui.element('candidateCount').value = '1';
  assert.equal(await redesign(ui).submitPrompt(ui.studio(), ui.element('prompt'), 'character'), true);
  assert.equal(ui.requests[0].body.request.prompt, 'A red scarf');
  assert.equal(ui.requests[0].body.request.model_id, 'sd-turbo');
  assert.equal(ui.requests[0].body.request.source, RED); assert.equal(ui.requests[0].body.request.mask, WHITE);
  assert.equal(Object.hasOwn(ui.requests[0].body.request, 'target_color'), false);
});

test('txt2img ignores an inactive recolor choice and preserves generation behavior', async () => {
  const ui = await ready({ offline: false });
  ui.studio().setMode('txt2img'); await ui.input('prompt', 'A cat'); ui.element('candidateCount').value = '1';
  assert.equal(await ui.studio().generate(), true);
  assert.equal(ui.requests[0].body.request.mode, 'txt2img');
  assert.equal(ui.requests[0].body.request.model_id, 'sd-turbo');
  assert.equal(Object.hasOwn(ui.requests[0].body.request, 'edit_operation'), false);
  assert.equal(Object.hasOwn(ui.requests[0].body.request, 'source'), false);
});

test('cancel before CPU POST acceptance drops the late result and uses color-specific feedback', async () => {
  const ui = await ready({ autoJobs: false }), pending = ui.studio().generate();
  await until(() => ui.requests.length === 1, 'CPU POST');
  await ui.studio().cancel(); await ui.accept(0); await pending;
  assert.equal(ui.state().project.versions.length, 1);
  assert.deepEqual(ui.cancellations, ['job-1']);
  assert.match(ui.element('status').textContent, /색상 변경/);
  assert.doesNotMatch(ui.element('status').textContent, /GPU/);
});

test('a skipped recolor is labeled unchanged rather than a successful color application', async () => {
  const ui = await ready(), originalFetch = ui.sandbox.fetch;
  ui.sandbox.fetch = async (url, options) => {
    const response = await originalFetch(url, options);
    if (!/^\/api\/jobs\/[^/]+$/.test(String(url))) return response;
    const job = await response.json(); job.result.metrics.skipped = true;
    return { ...response, json: async () => job };
  };
  assert.equal(await ui.studio().generate(), true);
  assert.match(ui.element('resultLabel').textContent, /변경 없음/);
  assert.match(ui.element('status').textContent, /선택 영역과 기준 색/);
  assert.doesNotMatch(ui.element('status').textContent, /적용했어요|변경 완료/);
  assert.match(ui.element('result').alt, /변경 없음/);
  assert.equal(Design.parseProject(ui.studio().exportProject()).versions.at(-1).metrics.skipped, true);
  await ui.element('exportBoard').onclick();
  assert(ui.exportCanvases.at(-1).context.texts.some(line => line.text === '변경 없음'));
});

test('target HEX typing and swatch changes stay synchronized and reach the CPU request', async () => {
  const ui = await ready();
  await ui.input('targetColorValue', '#12ab34');
  assert.equal(ui.element('targetColor').value.toUpperCase(), '#12AB34');
  assert.equal(ui.element('targetColorValue').value, '#12AB34');
  assert.equal(await ui.studio().generate(), true);
  assert.equal(ui.requests[0].body.request.target_color, '#12AB34');
  await ui.input('targetColor', '#4500ff');
  assert.equal(ui.element('targetColorValue').value, '#4500FF');
});

test('manual source HEX typing updates the swatch while automatic source remains null', async () => {
  const ui = await ready(); await ui.input('sourceColorMode', 'manual');
  await ui.input('sourceColorValue', '#0a23ff');
  assert.equal(ui.element('sourceColor').value.toUpperCase(), '#0A23FF');
  assert.equal(await ui.studio().generate(), true);
  assert.equal(ui.requests[0].body.request.source_color, '#0A23FF');
  await ui.input('sourceColorMode', 'auto');
  await ui.input('sourceColorValue', '#bad');
  assert.equal(await ui.studio().generate(), true);
  assert.equal(ui.requests[1].body.request.source_color, null);
  await ui.input('sourceColor', '#aabbcc');
  assert.equal(ui.element('sourceColorValue').value, '#AABBCC');
});

test('invalid HEX drafts stay visible and block a request instead of silently using the prior swatch', async () => {
  for (const id of ['targetColorValue', 'sourceColorValue']) {
    for (const text of ['', '#12', '#GG0011']) {
      const ui = await ready(); await ui.input('sourceColorMode', 'manual');
      await ui.input(id, text);
      ui.studio().setMode('inpaint');
      assert.equal(ui.element(id).value, text);
      assert.equal(ui.element(id).getAttribute('aria-invalid'), 'true');
      assert.equal(await ui.studio().generate(), false);
      assert.equal(ui.requests.length, 0);
      assert.equal(ui.state().project.versions.length, 1);
      assert.match(ui.element('status').textContent, /#RRGGBB/);
    }
  }
});

test('CPU metrics kind and zero model calls survive candidate save and restore without a new candidate kind', async () => {
  const ui = await ready(), originalFetch = ui.sandbox.fetch;
  ui.sandbox.fetch = async (url, options) => {
    const response = await originalFetch(url, options);
    if (!/^\/api\/jobs\/[^/]+$/.test(String(url))) return response;
    const job = await response.json();
    job.result.metrics.kind = 'local_recolor'; job.result.metrics.model_calls = 0;
    return { ...response, json: async () => job };
  };
  assert.equal(await ui.studio().generate(), true);
  const raw = ui.studio().exportProject(), candidate = Design.parseProject(raw).versions.at(-1);
  assert.equal(candidate.kind, 'generated');
  assert.equal(candidate.metrics.kind, 'local_recolor');
  assert.equal(candidate.metrics.model_calls, 0);
  const restored = page({ catalog: null });
  assert.equal(await restored.studio().importProject(raw), true);
  assert.equal(restored.state().project.versions.at(-1).metrics.kind, 'local_recolor');
});

test('backend string skip reasons stay unchanged in result, gallery, compare, board, conversation and document restore', async () => {
  for (const reason of ['empty-mask', 'no-matching-color', 'same-color', 'no-visible-change', 'another-reason', ' ', true]) {
    const ui = await ready(); returnSkipped(ui, reason);
    assert.equal(await ui.studio().generate(), true);
    const candidate = ui.state().project.versions.at(-1);
    assert.equal(ui.element('resultLabel').textContent, '변경 없음', String(reason));
    assert.match(ui.element('status').textContent, /선택 영역과 기준 색/);
    assert.doesNotMatch(ui.element('status').textContent, /적용했어요|적용 완료/);
    assert.match(ui.element('result').alt, /변경 없음/);
    const card = ui.element('gallery').children.find(node => node.dataset.candidateId === candidate.id);
    assert(card.querySelectorAll('span').some(node => node.textContent === '변경 없음'));
    assert.equal(redesign(ui).conversationEntries(ui.state().project).at(-1).skipped, true);
    for (const id of ['parent', candidate.id]) {
      const current = ui.element('gallery').children.find(node => node.dataset.candidateId === id);
      await current.querySelectorAll('button').find(node => node.dataset.action === 'compare').click();
    }
    await ui.element('compareSelected').click();
    assert(ui.element('compareGrid').querySelectorAll('figcaption').some(node => node.textContent.includes('변경 없음')));
    await ui.element('exportBoard').onclick();
    assert(ui.exportCanvases.at(-1).context.texts.some(line => line.text === '변경 없음'));
    const raw = ui.studio().exportProject(), saved = Design.parseProject(raw);
    assert.equal(saved.versions.at(-1).metrics.skipped, reason);
    const options = { decodeAsset: async () => ({ width: 1, height: 1 }) };
    const v2 = await Document.parseDocument(await Document.serializeDocument(await Document.fromV1(saved, options)), options);
    assert.equal(v2.candidates.at(-1).metrics.skipped, reason);
    const restored = page({ catalog: null });
    assert.equal(await restored.studio().importProject(raw), true);
    assert.equal(restored.element('resultLabel').textContent, '변경 없음');
    assert.match(restored.element('result').alt, /변경 없음/);
    assert.equal(redesign(restored).conversationEntries(restored.state().project).at(-1).skipped, true);
    await restored.element('exportBoard').onclick();
    assert(restored.exportCanvases.at(-1).context.texts.some(line => line.text === '변경 없음'));
  }
});

test('false, null, missing and empty-string skip markers retain successful color labels and survive restore', async () => {
  for (const marker of [false, null, undefined, '']) {
    const ui = await ready(); returnSkipped(ui, marker);
    assert.equal(await ui.studio().generate(), true);
    assert.equal(ui.element('resultLabel').textContent, '색상 적용 완료');
    assert.match(ui.element('status').textContent, /색상을 적용했어요/);
    assert.doesNotMatch(ui.element('result').alt, /변경 없음/);
    assert.equal(redesign(ui).conversationEntries(ui.state().project).at(-1).skipped, false);
    await ui.element('exportBoard').onclick();
    assert(ui.exportCanvases.at(-1).context.texts.some(line => line.text === '색상 변경'));
    assert(!ui.exportCanvases.at(-1).context.texts.some(line => line.text === '변경 없음'));
    const raw = ui.studio().exportProject();
    assert.equal(Design.parseProject(raw).versions.at(-1).metrics.skipped, marker);
    const restored = page({ catalog: null });
    assert.equal(await restored.studio().importProject(raw), true);
    assert.equal(restored.element('resultLabel').textContent, '색상 변경');
    assert.equal(redesign(restored).conversationEntries(restored.state().project).at(-1).skipped, false);
  }
});

test('PNG image save click downloads a Blob with the exact original bytes, MIME and filename while retaining its data URL', async () => {
  const ui = await ready(); assert.equal(await ui.studio().generate(), true);
  const link = ui.element('download'), href = link.href, name = link.download;
  const project = ui.studio().exportProject(), requests = ui.requests.length;
  const event = new ui.Event('click'); await link.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(ui.downloads.length, 1);
  const saved = ui.downloads[0];
  assert.match(saved.url, /^blob:/); assert.equal(saved.name, name);
  assert(saved.blob instanceof Blob); assert.equal(saved.blob.type, 'image/png');
  assert.deepEqual(Buffer.from(await saved.blob.arrayBuffer()), Buffer.from(href.split(',')[1], 'base64'));
  assert.equal(link.href, href); assert.equal(link.download, name);
  assert.equal(ui.studio().exportProject(), project); assert.equal(ui.requests.length, requests);
  assert.equal(ui.exportCanvases.length, 0);
});

test('the shared PNG click handler preserves exact bytes and filenames for history and viewer save anchors', async () => {
  const ui = await ready();
  assert.equal(typeof ui.studio().downloadImage, 'function');
  for (const [name, data] of [['기록-색상변경.png', RED], ['확대-원본.png', WHITE]]) {
    const link = ui.sandbox.document.createElement('a'); link.href = data; link.download = name;
    link.addEventListener('click', ui.studio().downloadImage);
    const event = new ui.Event('click'); await link.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    const saved = ui.downloads.at(-1);
    assert.equal(saved.name, name); assert.equal(saved.blob.type, 'image/png');
    assert.deepEqual(Buffer.from(await saved.blob.arrayBuffer()), Buffer.from(data.split(',')[1], 'base64'));
    assert.equal(link.href, data); assert.equal(link.download, name);
  }
});

test('PNG compatibility handling leaves non-PNG and existing Blob download defaults alone', async () => {
  const ui = await ready(), link = ui.element('download');
  link.download = 'original-file';
  for (const href of ['data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==', 'data:image/webp;base64,UklGRgAAAABXRUJQ', 'blob:existing-download']) {
    link.href = href;
    const event = new ui.Event('click'); await link.dispatchEvent(event);
    assert.notEqual(event.defaultPrevented, true);
    assert.equal(ui.downloads.length, 0); assert.equal(link.href, href);
    assert.equal(link.download, 'original-file');
  }
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CharacterDesign = require('../src/profiles.js');
const { profiles, sanitizeBrief, buildPrompt, makeRequests, createProject, parseProject } = CharacterDesign;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=';
const brief = () => sanitizeBrief({ profile: 'original', ...profiles.original.example });
const version = () => ({ id: 'a127f3d8-2026', createdAt: '2026-10-19T12:34:56.000Z', label: '후보 1', image: PNG, brief: brief(), request: { mode: 'txt2img', prompt: 'A desert alchemist', seed: 42 }, parentId: null, metrics: { total_s: 1.2, cache: 'miss', outside_mask_max_error: null } });

test('profiles give distinct visual guidance and English generation examples', () => {
  assert.deepEqual(Object.keys(profiles), ['original', 'comic', 'avatar', 'mascot', 'game']);
  assert.deepEqual(Object.values(profiles).map(profile => profile.label), ['자유 창작', '웹툰·웹소설', '버튜버', '마스코트', '게임']);
  const prompts = new Set();
  for (const [key, value] of Object.entries(profiles)) {
    for (const field of ['brief', 'appearance', 'detail', 'prompt']) assert.doesNotMatch(value.example[field], /[가-힣]/);
    const generated = buildPrompt({ ...value.example, profile: key }, 'txt2img');
    assert.ok(generated.includes(value.guidance));
    assert.ok(!generated.includes(value.example.notes));
    assert.ok(!generated.includes(value.example.name));
    prompts.add(generated);
  }
  assert.equal(prompts.size, 5);
  assert.match(profiles.comic.guidance, /webtoon or web novel/);
  assert.match(profiles.avatar.guidance, /portrait/);
  assert.match(profiles.mascot.guidance, /small size/);
  assert.match(profiles.game.guidance, /equipment/);
});

test('sanitization bounds text, validates colors, and safely defaults unknown profiles', () => {
  const value = sanitizeBrief({ profile: '__proto__', name: 'n'.repeat(90), brief: 'a'.repeat(1300), appearance: 12, detail: 'd'.repeat(900), notes: 'x'.repeat(1300), prompt: 'p'.repeat(4100), palette: ['#aaBb12', 'red', '#123'], useBrief: false });
  assert.equal(value.profile, 'original');
  assert.equal(value.name.length, 80);
  assert.equal(value.brief.length, 1200);
  assert.equal(value.appearance, '');
  assert.equal(value.detail.length, 800);
  assert.equal(value.notes.length, 1200);
  assert.equal(value.prompt.length, 4000);
  assert.deepEqual(value.palette, ['#AABB12', '#385C59', '#E9DCC8']);
  assert.equal(buildPrompt(value, 'inpaint'), value.prompt);
  assert.equal(sanitizeBrief(null).profile, 'original');
});

test('compiled prompt fits backend limit and omits private name and notes', () => {
  const value = { profile: 'comic', name: 'PRIVATE_NAME', notes: 'PRIVATE_NOTES', prompt: 'p'.repeat(4000), brief: 'b'.repeat(1200), appearance: 'a'.repeat(1200), detail: 'd'.repeat(800) };
  const output = buildPrompt(value, 'inpaint');
  assert.ok(output.length <= 10000);
  assert.ok(output.includes('b'.repeat(1200)));
  assert.ok(output.includes('a'.repeat(1200)));
  assert.doesNotMatch(output, /PRIVATE_NAME|PRIVATE_NOTES/);
  assert.throws(() => buildPrompt(value, 'other'), /mode/);
});

test('candidate requests preserve mask, source, and settings without mutating or sharing objects', () => {
  const base = { mode: 'inpaint', seed: 7, source: PNG, mask: PNG, settings: { nested: ['keep'] }, prompt: 'original', roi: true };
  const before = JSON.stringify(base);
  const output = makeRequests(base, 2);
  assert.deepEqual(output.map(item => item.seed), [7, 8]);
  assert.equal(JSON.stringify(base), before);
  assert.equal(output[0].source, base.source);
  assert.equal(output[1].mask, base.mask);
  output[0].settings.nested[0] = 'changed';
  assert.equal(base.settings.nested[0], 'keep');
  assert.equal(output[1].settings.nested[0], 'keep');
  assert.equal(output[1].roi, true);
});

test('seed boundaries throw instead of rounding; candidate count is one or two', () => {
  assert.equal(makeRequests({ seed: Number.MAX_SAFE_INTEGER }, 1)[0].seed, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(makeRequests({ seed: Number.MAX_SAFE_INTEGER - 1 }, 2).map(item => item.seed), [Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER]);
  for (const seed of [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, -1, 1.5, NaN, Infinity, '1']) assert.throws(() => makeRequests({ seed }, 2), /Seed/);
  for (const count of [0, 3, 1.5, '2']) assert.throws(() => makeRequests({ seed: 1 }, count), /one or two/);
});

test('project round-trip preserves snapshots and request settings but excludes source and mask', () => {
  const entry = version();
  entry.request.source = PNG;
  entry.request.mask = PNG;
  entry.request.mode = 'inpaint';
  entry.request.sampler = 'dpmpp_2m';
  const saved = createProject(brief(), [entry]);
  assert.equal(saved.versions[0].request.source, undefined);
  assert.equal(saved.versions[0].request.mask, undefined);
  assert.equal(saved.versions[0].request.sampler, 'dpmpp_2m');
  assert.equal(entry.request.source, PNG);
  assert.deepEqual(parseProject(JSON.stringify(saved)), saved);
  assert.deepEqual(saved.versions[0].metrics, entry.metrics);
  saved.brief.palette[0] = '#000000';
  assert.equal(entry.brief.palette[0], '#C49A6C');
});

test('import rejects remote, SVG, mismatched and malformed image payloads', () => {
  for (const image of ['https://example.com/image.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zy8+', PNG.replace('image/png', 'image/jpeg'), PNG + '\n', PNG.replace('iVBOR', 'i=OR')]) {
    assert.throws(() => parseProject({ version: 1, brief: brief(), versions: [{ ...version(), image }] }), /image|Image|embedded/);
  }
});

test('import rejects oversized content and dangerous object fields instead of truncating', () => {
  const raw = createProject(brief(), [version()]);
  raw.brief.notes = 'x'.repeat(1201);
  assert.throws(() => parseProject(raw), /notes/);
  raw.brief.notes = '';
  raw.brief.palette[0] = 'url(javascript:x)';
  assert.throws(() => parseProject(raw), /Palette/);
  const polluted = JSON.stringify(createProject(brief(), [])).replace('"version":1', '"version":1,"__proto__":{"polluted":true}');
  assert.throws(() => parseProject(polluted), /Unsupported/);
  assert.equal({}.polluted, undefined);
  assert.throws(() => parseProject(' '.repeat(64 * 1024 * 1024 + 1)), /64 MiB/);
  const huge = version();
  huge.image = 'data:image/png;base64,' + 'A'.repeat(16 * 1024 * 1024);
  assert.throws(() => createProject(brief(), [huge]), /16 MiB/);
});

test('import rejects unsupported versions, duplicate ids, bad request settings and excess candidates', () => {
  assert.throws(() => parseProject({ version: 2, brief: brief(), versions: [] }), /version/);
  assert.throws(() => parseProject({ version: 1, brief: brief(), versions: [], script: 'x' }), /Unsupported/);
  assert.throws(() => createProject(brief(), [version(), version()]), /Duplicate/);
  assert.throws(() => createProject(brief(), Array.from({ length: 21 }, (_, i) => ({ ...version(), id: 'v' + i }))), /20 candidates/);
  for (const change of [{ seed: Number.MAX_SAFE_INTEGER + 1 }, { width: 511 }, { cfg: Infinity }, { roi: 'true' }, { scheduler: 'unknown' }]) {
    const entry = version();
    Object.assign(entry.request, change);
    assert.throws(() => createProject(brief(), [entry]));
  }
  const entry = version();
  entry.metrics = { html: { script: 'x' } };
  assert.throws(() => createProject(brief(), [entry]), /metric/);
  const malformedDate = { ...version(), createdAt: '2026-02-31T00:00:00Z' };
  assert.throws(() => createProject(brief(), [malformedDate]), /timestamp/);
});

test('accessors and nested executable objects are rejected during import', () => {
  let called = false;
  const raw = { version: 1, versions: [] };
  Object.defineProperty(raw, 'brief', { enumerable: true, get() { called = true; return brief(); } });
  assert.throws(() => parseProject(raw), /Accessor/);
  assert.equal(called, false);
  assert.throws(() => makeRequests({ seed: 1, callback() {} }, 1), /non-JSON/);
});

test('browser UMD export works without CommonJS and profile defaults are immutable', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const context = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/profiles.js'), 'utf8'), context);
  assert.equal(typeof context.CharacterDesign.buildPrompt, 'function');
  assert.equal(Object.isFrozen(profiles), true);
  assert.equal(Object.isFrozen(profiles.original.example.palette), true);
});

test('explicit upload/generated kinds survive export while legacy kinds stay unspecified', () => {
  const entries = [{ ...version(), id: 'upload', kind: 'upload' }, { ...version(), id: 'generated', kind: 'generated', parentId: 'upload' }, { ...version(), id: 'legacy' }];
  const saved = createProject(brief(), entries);
  assert.equal(saved.versions[0].kind, 'upload');
  assert.equal(saved.versions[1].kind, 'generated');
  assert.equal(Object.hasOwn(saved.versions[2], 'kind'), false);
  assert.deepEqual(parseProject(JSON.stringify(saved)), saved);
  for (const kind of ['ai', '', null, 1]) assert.throws(() => createProject(brief(), [{ ...version(), kind }]), /kind/);
});

test('parent lineage supports forward references but rejects missing, self, and cyclic parents', () => {
  const parent = { ...version(), id: 'parent' };
  const child = { ...version(), id: 'child', parentId: 'parent' };
  assert.equal(createProject(brief(), [child, parent]).versions[0].parentId, 'parent');
  assert.throws(() => createProject(brief(), [child]), /parent/i);
  assert.throws(() => createProject(brief(), [{ ...parent, parentId: 'parent' }]), /parent|cycle/i);
  assert.throws(() => createProject(brief(), [{ ...parent, parentId: 'child' }, child]), /parent|cycle/i);
});

test('selection history records explicit actions without sharing or losing entries', () => {
  const entries = [{ ...version(), id: 'first' }, { ...version(), id: 'second', parentId: 'first' }];
  const history = [
    { candidateId: 'first', action: 'view', at: '2026-10-19T12:34:56.000Z' },
    { candidateId: 'second', action: 'edit', at: '2026-10-19T12:35:00Z' },
    { candidateId: 'first', action: 'compare', at: '2026-10-19T12:36:00Z' }
  ];
  const saved = createProject(brief(), entries, history);
  assert.deepEqual(saved.selectionHistory, history);
  history[0].candidateId = 'second';
  assert.equal(saved.selectionHistory[0].candidateId, 'first');
  assert.deepEqual(parseProject(JSON.stringify(saved)), saved);
  const legacy = { version: 1, brief: brief(), versions: [version()] };
  assert.deepEqual(parseProject(legacy).selectionHistory, []);
});

test('history bounds and references fail explicitly without trimming candidates', () => {
  const entry = version();
  const valid = { candidateId: entry.id, action: 'view', at: entry.createdAt };
  assert.equal(createProject(brief(), [entry], Array.from({ length: 1000 }, () => ({ ...valid }))).selectionHistory.length, 1000);
  assert.throws(() => createProject(brief(), [entry], Array.from({ length: 1001 }, () => ({ ...valid }))), /1000|history/i);
  for (const change of [{ candidateId: 'missing' }, { action: 'generate' }, { at: '2026-02-31T00:00:00Z' }, { extra: true }]) {
    assert.throws(() => createProject(brief(), [entry], [{ ...valid, ...change }]), /history|candidate|timestamp|Unsupported/i);
  }
  assert.equal(entry.id, 'a127f3d8-2026');
});

test('64 MiB import bound counts UTF-8 bytes including raw whitespace', () => {
  const limit = 64 * 1024 * 1024;
  const small = JSON.stringify(createProject({ ...brief(), name: '가'.repeat(80) }, []));
  const oversized = small + ' '.repeat(limit - small.length);
  assert.equal(oversized.length, limit);
  assert.ok(Buffer.byteLength(oversized, 'utf8') > limit);
  assert.throws(() => parseProject(oversized), /64 MiB/);
});

test('64 MiB serialized-project bound counts UTF-8 bytes instead of code units', () => {
  const limit = 64 * 1024 * 1024;
  const seed = createProject({ ...brief(), name: '가'.repeat(80) }, Array.from({ length: 4 }, (_, i) => ({ ...version(), id: 'v' + i })));
  const overhead = JSON.stringify(seed).length - 4 * PNG.length;
  const prefix = 'data:image/png;base64,';
  const payloadSize = Math.floor(((limit - overhead - 32) / 4 - prefix.length) / 4) * 4;
  // Header-bearing fixture for the byte-budget validator; browser decoding is a separate check.
  const image = prefix + 'iVBORw0KGgoA' + 'A'.repeat(payloadSize - 12);
  const large = { ...seed, versions: seed.versions.map(entry => ({ ...entry, image })) };
  const raw = JSON.stringify(large);
  assert.ok(raw.length <= limit);
  assert.ok(Buffer.byteLength(raw, 'utf8') > limit);
  assert.throws(() => parseProject(large), /64 MiB/);
  assert.throws(() => createProject(large.brief, large.versions), /64 MiB/);
});

test('hidden accessors and array accessors are rejected before executing code', () => {
  let called = 0;
  const hidden = { version: 1, versions: [] };
  Object.defineProperty(hidden, 'brief', { get() { called++; return brief(); } });
  assert.throws(() => parseProject(hidden), /Accessor/);
  const seedGetter = {};
  Object.defineProperty(seedGetter, 'seed', { enumerable: true, get() { called++; return 1; } });
  assert.throws(() => makeRequests(seedGetter, 1), /Accessor/);
  const array = ['ok'];
  Object.defineProperty(array, '0', { enumerable: true, get() { called++; return 'executed'; } });
  assert.throws(() => makeRequests({ seed: 1, values: array }, 1), /Accessor/);
  assert.equal(called, 0);
});

test('sparse candidate and history arrays fail rather than silently omitting slots', () => {
  assert.throws(() => createProject(brief(), new Array(2)), /array|candidate|sparse/i);
  assert.throws(() => createProject(brief(), [version()], new Array(2)), /array|history|sparse/i);
});

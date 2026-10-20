// Contract/ZIP/encoding-boundary tests. Real Canvas pixels are a separate QA gate.
'use strict';
const assert = require('node:assert/strict');
const { readFileSync, existsSync, mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { deflateSync, inflateSync } = require('node:zlib');
const test = require('node:test');
const modulePath = path.join(__dirname, '../web/src/character-export.js');
const api = existsSync(modulePath) ? require(modulePath) : {};
const fixture = JSON.parse(readFileSync(path.join(__dirname, '../docs/handoffs/fixtures/character-document-v2.fixture.json'), 'utf8')).document;
const clone = value => JSON.parse(JSON.stringify(value));
function frames(options) {
  assert.equal(typeof api.exportFrames, 'function', 'exportFrames public API is missing');
  return api.exportFrames(options);
}
function posePng(options) {
  assert.equal(typeof api.exportPosePng, 'function', 'exportPosePng public API is missing');
  return api.exportPosePng(options);
}

// Independent bit-at-a-time CRC, not the writer's implementation or exports.
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length); name.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE(crc(Buffer.concat([name, data])), result.length - 4);
  return result;
}
function png(width, height, rgba = [25, 75, 125, 128], metadataBytes = 0) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    for (let c = 0; c < 4; c++) pixels[y * (width * 4 + 1) + 1 + x * 4 + c] = rgba[c];
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    ...(metadataBytes ? [chunk('tEXt', Buffer.concat([Buffer.from('Comment\0'), Buffer.alloc(metadataBytes, 97)]))] : []),
    chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
function decodeFixturePng(bytes) {
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), idat = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.subarray(offset + 4, offset + 8).toString();
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    assert.equal(crc(bytes.subarray(offset + 4, offset + 8 + length)), bytes.readUInt32BE(offset + 8 + length));
    if (type === 'IDAT') idat.push(body);
    offset += 12 + length;
  }
  const pixels = inflateSync(Buffer.concat(idat));
  assert.equal(pixels.length, (width * 4 + 1) * height);
  return { width, height, firstPixel: [...pixels.subarray(1, 5)] };
}
function readZip(bytes) {
  assert.equal(crc(Buffer.from('123456789')), 0xcbf43926);
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50, 'EOCD');
  assert.equal(bytes.readUInt16LE(end + 4), 0); assert.equal(bytes.readUInt16LE(end + 6), 0);
  assert.equal(bytes.readUInt16LE(end + 20), 0);
  const count = bytes.readUInt16LE(end + 10), directorySize = bytes.readUInt32LE(end + 12);
  const directoryOffset = bytes.readUInt32LE(end + 16);
  assert.equal(bytes.readUInt16LE(end + 8), count);
  assert.equal(directoryOffset + directorySize, end);
  const entries = new Map(); let at = directoryOffset, nextLocal = 0;
  for (let index = 0; index < count; index++) {
    assert.equal(bytes.readUInt32LE(at), 0x02014b50, 'central directory');
    const flags = bytes.readUInt16LE(at + 8), method = bytes.readUInt16LE(at + 10);
    const checksum = bytes.readUInt32LE(at + 16), size = bytes.readUInt32LE(at + 20);
    assert.equal(bytes.readUInt32LE(at + 24), size); assert.equal(method, 0, 'ZIP STORE');
    assert.equal(flags & 9, 0, 'neither encryption nor data descriptor');
    const nameSize = bytes.readUInt16LE(at + 28), extraSize = bytes.readUInt16LE(at + 30), commentSize = bytes.readUInt16LE(at + 32);
    const name = bytes.subarray(at + 46, at + 46 + nameSize).toString('utf8');
    const local = bytes.readUInt32LE(at + 42); assert.equal(local, nextLocal);
    assert.equal(bytes.readUInt32LE(local), 0x04034b50, 'local header');
    assert.equal(bytes.readUInt16LE(local + 6), flags); assert.equal(bytes.readUInt16LE(local + 8), method);
    assert.equal(bytes.readUInt32LE(local + 14), checksum);
    assert.equal(bytes.readUInt32LE(local + 18), size); assert.equal(bytes.readUInt32LE(local + 22), size);
    const localNameSize = bytes.readUInt16LE(local + 26), localExtraSize = bytes.readUInt16LE(local + 28);
    assert.equal(bytes.subarray(local + 30, local + 30 + localNameSize).toString('utf8'), name);
    const start = local + 30 + localNameSize + localExtraSize, data = bytes.subarray(start, start + size);
    assert.equal(data.length, size); assert.equal(crc(data), checksum, 'ZIP CRC');
    assert(!entries.has(name), 'duplicate ZIP entry'); entries.set(name, { data, start });
    nextLocal = start + size; at += 46 + nameSize + extraSize + commentSize;
  }
  assert.equal(nextLocal, directoryOffset); assert.equal(at, end);
  return entries;
}
function setup({ encode, draw, evaluate } = {}) {
  const document = clone(fixture); document.parameters[1].value = .37;
  const motion = { id: 'blink', duration: 2, fps: 24, rigHashes: document.rigs.map(rig => rig.rigHash),
    curves: [{ parameterId: 'eyeOpen', keys: [{ t: 0, value: 1 }, { t: 1, value: 0 }, { t: 2, value: 1 }] }] };
  const samples = [], scenes = [], canvases = [], draws = [];
  const decodedAssets = new Map(document.assets.map(asset => [asset.id, { width: asset.width, height: asset.height }]));
  const renderer = {
    sampleMotion(value, time, options) {
      samples.push({ time, options }); assert.equal(value.duration, 2);
      return { eyeOpen: time <= 1 ? 1 - time : time - 1 };
    },
    evaluatePose(scene, values) {
      scenes.push({ sourceAssetId: scene.sourceAssetId, values: clone(values), width: scene.canvas.width });
      if (evaluate) return evaluate(scene, values);
      return { backgroundAssetId: scene.backgroundAssetId, blockedParts: [],
        draws: scene.parts.map(part => ({ partId: part.id })), color: Math.round(values.eyeOpen * 255) };
    },
    drawPose(canvas, pose, assets) {
      draws.push(pose); assert.strictEqual(assets, decodedAssets);
      if (draw) draw(canvas, pose, draws.length);
      canvas.color = pose.color;
      return { width: canvas.width, height: canvas.height, drawnPartIds: pose.draws.map(part => part.partId) };
    },
  };
  function canvasFactory() {
    const canvas = { width: 0, height: 0, toBlob(callback, type) {
      assert.equal(type, 'image/png');
      if (encode) return encode(callback, canvas, canvases.length);
      callback(new Blob([png(canvas.width, canvas.height, [canvas.color, 75, 125, 128])], { type }));
    } };
    canvases.push(canvas); return canvas;
  }
  return { document, motion, renderer, decodedAssets, canvasFactory, samples, scenes, canvases, draws };
}

test('archive_has_48_frames_and_exact_sample_times', async () => {
  const ctx = setup(), before = JSON.stringify(ctx.document), progress = [];
  const blob = await frames({ ...ctx, onProgress: value => progress.push(value) });
  assert(blob instanceof Blob); assert.equal(blob.type, 'application/zip');
  const bytes = Buffer.from(await blob.arrayBuffer()), files = readZip(bytes);
  assert.equal(files.size, 49);
  const manifest = JSON.parse(files.get('manifest.json').data.toString('utf8'));
  assert.equal(manifest.width, 32); assert.equal(manifest.height, 32);
  assert.equal(manifest.duration, 2); assert.equal(manifest.fps, 24); assert.equal(manifest.frameCount, 48);
  assert.deepEqual([...manifest.rigHashes].sort(), [...ctx.motion.rigHashes].sort());
  assert.equal(manifest.frames.length, 48);
  for (let i = 0; i < 48; i++) {
    const file = 'frame-' + String(i).padStart(4, '0') + '.png';
    assert.deepEqual(manifest.frames[i], { file, time: i / 24 });
    assert(files.has(file)); assert.equal(ctx.samples[i].time, i / 24);
    assert.deepEqual(decodeFixturePng(files.get(file).data), { width: 32, height: 32,
      firstPixel: [Math.round((i <= 24 ? 1 - i / 24 : i / 24 - 1) * 255), 75, 125, 128] });
  }
  assert.equal(ctx.samples[47].time, 1.9583333333333333);
  assert(ctx.scenes.every(scene => scene.values.mouthOpen === .37 && scene.values.breath === 0));
  assert(ctx.scenes.every(scene => scene.sourceAssetId === fixture.candidates[0].assetId));
  assert.equal(progress.length, 48); assert.equal(progress[47].completed, 48); assert.equal(progress[47].total, 48);
  assert.equal(JSON.stringify(ctx.document), before);
  assert(ctx.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
  const damaged = Buffer.from(bytes); damaged[files.get('frame-0000.png').start + 45] ^= 1;
  assert.throws(() => readZip(damaged), /ZIP CRC/);
  const output = path.join(__dirname, '../work/team-resume/function/motion-export');
  mkdirSync(output, { recursive: true }); writeFileSync(path.join(output, 'numeric-fixture.zip'), bytes);
});

test('single pose PNG uses the same renderer, current defaults and explicit values without mutation', async () => {
  const ctx = setup(), before = JSON.stringify(ctx.document);
  const blob = await posePng({ ...ctx, values: { eyeOpen: .5, breath: .2 } });
  assert.equal(blob.type, 'image/png');
  assert.deepEqual(decodeFixturePng(Buffer.from(await blob.arrayBuffer())).firstPixel, [128, 75, 125, 128]);
  assert.deepEqual(ctx.scenes[0].values, { eyeOpen: .5, mouthOpen: .37, breath: .2 });
  assert.equal(ctx.samples.length, 0); assert.equal(JSON.stringify(ctx.document), before);
});

test('caller edits during progress cannot change the captured document or motion', async () => {
  const ctx = setup();
  const blob = await frames({ ...ctx, onProgress({ completed }) {
    if (completed === 1) { ctx.document.canvas.width = 64; ctx.document.parameters[1].value = .9; ctx.motion.duration = 9; }
  } });
  assert.equal(readZip(Buffer.from(await blob.arrayBuffer())).size, 49);
  assert(ctx.scenes.every(scene => scene.width === 32 && scene.values.mouthOpen === .37));
  assert.equal(ctx.document.canvas.width, 64, 'export must not overwrite newer caller edits');
});

test('pre-aborted and mid-frame aborts reject without a completed archive or extra frames', async () => {
  for (const preAborted of [true, false]) {
    const ctx = setup(), controller = new AbortController(), before = JSON.stringify(ctx.document);
    if (preAborted) controller.abort();
    let completed = false;
    await assert.rejects(frames({ ...ctx, signal: controller.signal, onProgress() { controller.abort(); } })
      .then(() => { completed = true; }), { name: 'AbortError' });
    assert.equal(completed, false); assert.equal(ctx.draws.length, preAborted ? 0 : 1);
    assert.equal(JSON.stringify(ctx.document), before);
    assert(ctx.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
  }
});

test('abort while encoder callback is pending settles promptly and ignores a late PNG', { timeout: 2000 }, async () => {
  let callback;
  const ctx = setup({ encode(done) { callback = done; } }), controller = new AbortController();
  const pending = frames({ ...ctx, signal: controller.signal });
  for (let i = 0; i < 10 && !callback; i++) await new Promise(setImmediate);
  assert.equal(typeof callback, 'function'); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  callback(new Blob([png(32, 32)]));
  await new Promise(setImmediate); assert.equal(ctx.draws.length, 1);
});

test('third-frame geometry failure returns no archive and preserves the document', async () => {
  const ctx = setup({ draw(canvas, pose, count) { if (count === 3) throw Error('Controlled geometry failure'); } });
  const before = JSON.stringify(ctx.document), progress = [];
  await assert.rejects(frames({ ...ctx, onProgress: value => progress.push(value) }), /Controlled geometry failure/);
  assert.equal(ctx.draws.length, 3); assert.equal(progress.length, 2);
  assert.equal(JSON.stringify(ctx.document), before);
  assert(ctx.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
});

test('PNG aggregate exceeding 128 MiB stops without producing a completed ZIP', async () => {
  const bytes = png(32, 32, [25, 75, 125, 128], 3 * 1024 * 1024), blob = new Blob([bytes], { type: 'image/png' });
  const ctx = setup({ encode(done) { done(blob); } }), before = JSON.stringify(ctx.document), progress = [];
  await assert.rejects(frames({ ...ctx, onProgress: value => progress.push(value) }), /128 MiB/);
  assert.equal(ctx.draws.length, 43); assert.equal(progress.length, 42);
  assert.equal(JSON.stringify(ctx.document), before);
});

test('invalid PNG signature, truncated chunks, corrupt CRC, wrong dimensions and null encoding fail without progress', async () => {
  const corrupt = png(32, 32); corrupt[45] ^= 1;
  for (const bytes of [Buffer.from('not a PNG at all'), png(16, 32), null, png(32, 32).subarray(0, 33), corrupt]) {
    const ctx = setup({ encode(done) { done(bytes === null ? null : new Blob([bytes])); } }), progress = [];
    await assert.rejects(frames({ ...ctx, onProgress: value => progress.push(value) }), /PNG|dimension|크기/i);
    assert.equal(ctx.draws.length, 1); assert.equal(progress.length, 0);
  }
});

test('blocked geometry and a stale motion rig hash cannot be exported', async () => {
  const blocked = setup({ evaluate() { return { draws: [], blockedParts: [{ partId: 'eye', reason: 'stale' }] }; } });
  await assert.rejects(frames(blocked), /blocked|stale/i); assert.equal(blocked.draws.length, 0);
  const stale = setup(); stale.motion.rigHashes[0] = '0'.repeat(64);
  await assert.rejects(frames(stale), /rig|stale/i); assert.equal(stale.draws.length, 0);
});

test('invalid motion rate, canvas limit, source reference and pose values reject before drawing', async () => {
  for (const change of [ctx => { ctx.motion.fps = 30; }, ctx => { ctx.motion.duration = 3; },
    ctx => { ctx.document.canvas.width = 1025; }, ctx => { ctx.document.sourceCandidateId = 'missing'; }]) {
    const ctx = setup(); change(ctx); await assert.rejects(frames(ctx)); assert.equal(ctx.draws.length, 0);
  }
  const ctx = setup(); await assert.rejects(posePng({ ...ctx, values: { eyeOpen: NaN } }));
  assert.equal(ctx.draws.length, 0);
});

test('UMD browser load exposes only exporter API and does no DOM, download or render work', () => {
  assert(existsSync(modulePath), 'export module is missing');
  let effects = 0;
  const context = { Blob, TextEncoder, Uint8Array, DataView, document: { createElement() { effects++; } },
    URL: { createObjectURL() { effects++; } } };
  vm.runInNewContext(readFileSync(modulePath, 'utf8'), context);
  assert.equal(typeof context.PankekiExport.exportFrames, 'function');
  assert.equal(typeof context.PankekiExport.exportPosePng, 'function');
  assert.equal(effects, 0);
});

// Uses production sampling/geometry/drawing. The Canvas/PNG boundary remains a
// recording probe, so this proves API compatibility rather than browser pixels.
function productionSetup() {
  const ctx = setup(), frameCalls = [], canvases = [];
  ctx.renderer = require('../web/src/character-renderer.js');
  ctx.decodedAssets = new Map(ctx.document.assets.map(asset => [asset.id,
    { id: asset.id, width: asset.width, height: asset.height, complete: true }]));
  let encodes = 0;
  ctx.canvasFactory = (width, height) => {
    assert.equal(width, 32); assert.equal(height, 32);
    let paths = [], current; const stack = [];
    const mapped = (x, y) => {
      const m = context.matrix; return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    };
    const context = {
      matrix: [1, 0, 0, 1, 0, 0], globalAlpha: 1, globalCompositeOperation: 'source-over', clips: null,
      save() { stack.push({ matrix: this.matrix.slice(), globalAlpha: this.globalAlpha,
        globalCompositeOperation: this.globalCompositeOperation, clips: this.clips }); },
      restore() { assert(stack.length); Object.assign(this, stack.pop()); },
      setTransform(...matrix) { this.matrix = matrix; },
      clearRect(x, y, w, h) {
        assert.deepEqual([x, y, w, h], [0, 0, 32, 32]);
        current = []; frameCalls.push(current);
      },
      beginPath() { paths = []; }, moveTo(x, y) { paths.push([mapped(x, y)]); },
      lineTo(x, y) { paths.at(-1).push(mapped(x, y)); }, closePath() {},
      clip() { assert.equal(this.clips, null, 'Fixture probe supports one clip level'); this.clips = clone(paths); },
      drawImage(image, x, y) {
        const quad = [[x, y], [x + image.width, y], [x + image.width, y + image.height], [x, y + image.height]].map(([px, py]) => mapped(px, py));
        current.push({ assetId: image.id, quad, regions: clone(this.clips || [quad]),
          alpha: this.globalAlpha, composite: this.globalCompositeOperation });
      },
    };
    const canvas = { width: 0, height: 0,
      getContext(type) { assert.equal(type, '2d'); return context; },
      toBlob(done, type) {
        encodes++; done(new Blob([png(canvas.width, canvas.height)], { type }));
      },
    };
    canvases.push(canvas); return canvas;
  };
  return { ...ctx, frameCalls, productionCanvases: canvases, encodes: () => encodes };
}

const nearPoints = (left, right) => left.length === right.length && left.every((point, i) =>
  point.every((coordinate, j) => Math.abs(coordinate - right[i][j]) < 1e-8));
function signedArea(polygon) {
  return polygon.reduce((sum, p, i) => { const q = polygon[(i + 1) % polygon.length]; return sum + p[0] * q[1] - p[1] * q[0]; }, 0) / 2;
}
// Independent convex intersection measures overlapping draw coverage. Accepts
// a full texture draw or clipped triangles without assuming their call count.
function intersection(subject, clip) {
  let result = subject; const sign = Math.sign(signedArea(clip));
  for (let i = 0; i < clip.length && result.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length], input = result; result = [];
    const side = p => sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length], dp = side(p), dq = side(q);
      if (dp >= -1e-9) result.push(p);
      if ((dp >= -1e-9) !== (dq >= -1e-9)) {
        const t = dp / (dp - dq); result.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
  }
  return result;
}
function expectedFrame(document, index) {
  const rectangle = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const closure = 1 - Math.abs(1 - index / 24);
  // Independently authored fixture geometry; no renderer pose/math as oracle.
  return [
    { name: 'background', assetId: document.backgroundAssetId, quad: rectangle(0, 0, 32, 32), alpha: 1 },
    { name: 'body', assetId: document.parts[0].materialAssetId, quad: rectangle(12, 20, 20, 28), alpha: 1 },
    { name: 'eye', assetId: document.parts[1].materialAssetId, quad: rectangle(12, 7 + 3.9 * closure, 20, 15 - 3.9 * closure), alpha: 1 },
    { name: 'mouth', assetId: document.parts[2].materialAssetId, quad: rectangle(12, 13.63, 20, 22.37), alpha: 1 },
  ];
}
function assertFrame(calls, expected) {
  let cursor = 0;
  for (const layer of expected) {
    const regions = []; let drawn = false;
    while (cursor < calls.length && nearPoints(calls[cursor].quad, layer.quad)) {
      const call = calls[cursor++]; drawn = true;
      assert.equal(call.assetId, layer.assetId, layer.name + ' material');
      assert.equal(call.alpha, layer.alpha, layer.name + ' alpha'); assert.equal(call.composite, 'source-over');
      regions.push(...call.regions);
    }
    assert(drawn, layer.name + ' missing or out of order');
    const expectedArea = Math.abs(signedArea(layer.quad)); let covered = 0;
    for (let i = 0; i < regions.length; i++) {
      const area = Math.abs(signedArea(regions[i])); assert(area > 0);
      assert(Math.abs(Math.abs(signedArea(intersection(regions[i], layer.quad))) - area) < 1e-7, layer.name + ' outside coverage');
      covered += area;
      for (let j = 0; j < i; j++) assert(Math.abs(signedArea(intersection(regions[i], regions[j]))) < 1e-7, layer.name + ' duplicate coverage');
    }
    assert(Math.abs(covered - expectedArea) < 1e-7, layer.name + ' incomplete coverage');
  }
  assert.equal(cursor, calls.length, 'Unexpected draw after expected layers');
}

test('production renderer exports 48 poses through the real source, Map and Canvas call contract', async () => {
  const ctx = productionSetup(), before = JSON.stringify(ctx.document);
  const files = readZip(Buffer.from(await (await frames(ctx)).arrayBuffer()));
  assert.equal(files.size, 49); assert.equal(ctx.encodes(), 48);
  assert.equal(ctx.frameCalls.length, 48);
  for (let i = 0; i < 48; i++) {
    assertFrame(ctx.frameCalls[i], expectedFrame(ctx.document, i));
    const file = 'frame-' + String(i).padStart(4, '0') + '.png';
    assert.deepEqual(decodeFixturePng(files.get(file).data), { width: 32, height: 32, firstPixel: [25, 75, 125, 128] });
  }
  // Prove the new oracle catches omitted/duplicated draws, wrong alpha and a
  // half-covered part rather than merely accepting a changed draw count.
  const expected = expectedFrame(ctx.document, 12), original = ctx.frameCalls[12];
  const eyeIndex = original.findIndex(call => nearPoints(call.quad, expected[2].quad));
  assertFrame(expected.flatMap(layer => [
    { ...layer, composite: 'source-over', regions: [layer.quad.slice(0, 3)] },
    { ...layer, composite: 'source-over', regions: [[layer.quad[0], layer.quad[2], layer.quad[3]]] },
  ]), expected); // The equivalent triangle partition is valid too.
  for (const corrupt of [
    calls => calls.splice(eyeIndex, 1),
    calls => calls.splice(eyeIndex, 0, clone(calls[eyeIndex])),
    calls => { calls[eyeIndex].alpha = .5; },
    calls => {
      const half = { ...clone(calls[eyeIndex]), regions: [calls[eyeIndex].quad.slice(0, 3)] };
      const count = calls.filter(call => nearPoints(call.quad, expected[2].quad)).length;
      calls.splice(eyeIndex, count, half);
    },
  ]) { const damaged = clone(original); corrupt(damaged); assert.throws(() => assertFrame(damaged, expected)); }
  const manifest = JSON.parse(files.get('manifest.json').data);
  assert.equal(manifest.duration, 2); assert.equal(manifest.fps, 24); assert.equal(manifest.frameCount, 48);
  assert.deepEqual(manifest.frames, Array.from({ length: 48 }, (_, i) => ({ file: 'frame-' + String(i).padStart(4, '0') + '.png', time: i / 24 })));
  assert.deepEqual(manifest.rigHashes, [...ctx.motion.rigHashes].sort());
  assert.equal(JSON.stringify(ctx.document), before);
  assert(ctx.productionCanvases.every(canvas => canvas.width === 0 && canvas.height === 0));
});

test('production renderer blocked reasons and missing assets stop output before draw or encoding', async () => {
  for (const [change, reason] of [
    [ctx => { ctx.document.rigs[1].status = 'stale'; }, 'rig_stale'],
    [ctx => { ctx.document.parts[1].sourceAssetId = 'other-source'; }, 'source_mismatch'],
    [ctx => { ctx.document.parts[1].backgroundReady = false; }, 'background_not_ready'],
  ]) {
    const ctx = productionSetup(); change(ctx); const before = JSON.stringify(ctx.document);
    await assert.rejects(posePng(ctx), error => {
      assert.equal(error.code, 'blocked_pose');
      assert(error.blockedParts.some(part => part.partId === 'eye' && part.reason === reason));
      return true;
    });
    assert.equal(ctx.frameCalls.length, 0); assert.equal(ctx.encodes(), 0);
    assert.equal(JSON.stringify(ctx.document), before);
    assert(ctx.productionCanvases.every(canvas => canvas.width === 0 && canvas.height === 0));
  }
  const missing = productionSetup(); missing.decodedAssets.delete(missing.document.parts[0].materialAssetId);
  await assert.rejects(posePng(missing), { code: 'missing_asset' });
  assert.equal(missing.frameCalls.length, 0); assert.equal(missing.encodes(), 0);
});

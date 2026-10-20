(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PankekiExport = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const PNG_LIMIT = 128 * 1024 * 1024;
  const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
  const PARAMETER_IDS = ['eyeOpen', 'mouthOpen', 'breath'];
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let value = n;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    crcTable[n] = value >>> 0;
  }

  function checkAbort(signal) {
    if (signal?.aborted) {
      const error = new Error('Export canceled'); error.name = 'AbortError'; throw error;
    }
  }
  function abortable(promise, signal) {
    checkAbort(signal);
    if (!signal) return Promise.resolve(promise);
    return new Promise((resolve, reject) => {
      function aborted() {
        signal.removeEventListener('abort', aborted);
        const error = new Error('Export canceled'); error.name = 'AbortError'; reject(error);
      }
      signal.addEventListener('abort', aborted, { once: true });
      Promise.resolve(promise).then(value => {
        signal.removeEventListener('abort', aborted);
        if (signal.aborted) aborted(); else resolve(value);
      }, error => { signal.removeEventListener('abort', aborted); reject(error); });
      if (signal.aborted) aborted();
    });
  }
  function snapshot(value) {
    return JSON.parse(JSON.stringify(value));
  }
  function prepare(options, animated) {
    checkAbort(options.signal);
    const renderer = options.renderer;
    if (!renderer || typeof renderer.evaluatePose !== 'function' || typeof renderer.drawPose !== 'function' ||
        animated && typeof renderer.sampleMotion !== 'function') throw new TypeError('A pose renderer is required');
    const doc = snapshot(options.document), width = doc?.canvas?.width, height = doc?.canvas?.height;
    if (doc?.version !== 2 || !Number.isInteger(width) || !Number.isInteger(height) ||
        width < 1 || height < 1 || width > 1024 || height > 1024) throw new RangeError('Export requires a v2 canvas within 1024px');
    const source = doc.candidates?.find(candidate => candidate.id === doc.sourceCandidateId);
    if (!source || typeof source.assetId !== 'string') throw new Error('The source candidate is missing');
    if (!Array.isArray(doc.parameters) || !Array.isArray(doc.parts) || !Array.isArray(doc.rigs)) throw new TypeError('Invalid pose document');
    const values = {};
    for (const parameter of doc.parameters) {
      if (!PARAMETER_IDS.includes(parameter.id) || Object.hasOwn(values, parameter.id)) throw new Error('Invalid parameter definition');
      const value = parameter.value === undefined ? parameter.default : parameter.value;
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Parameter must be within 0..1');
      values[parameter.id] = value;
    }
    const scene = { canvas: doc.canvas, sourceAssetId: source.assetId, backgroundAssetId: doc.backgroundAssetId,
      parts: doc.parts, rigs: doc.rigs, parameters: doc.parameters };
    let motion;
    if (animated) {
      motion = snapshot(options.motion);
      if (motion?.duration !== 2 || motion?.fps !== 24 || !Array.isArray(motion.curves) || !Array.isArray(motion.rigHashes)) {
        throw new Error('Frame export requires a 2 second, 24 fps motion');
      }
      const ready = new Set(doc.rigs.filter(rig => rig.status === 'ready').map(rig => rig.rigHash));
      if (motion.rigHashes.some(hash => !ready.has(hash))) throw new Error('Motion rig hash is stale or missing');
    }
    return { renderer, scene, values, motion, width, height, usedRigHashes: new Set(), decodedAssets: options.decodedAssets };
  }
  function poseValues(context, overrides = {}) {
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new TypeError('Pose values must be an object');
    const values = { ...context.values };
    for (const [key, value] of Object.entries(overrides)) {
      if (!Object.hasOwn(values, key) || !Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Invalid pose parameter');
      values[key] = value;
    }
    return values;
  }
  function createCanvas(context, factory) {
    let canvas;
    if (factory) canvas = factory(context.width, context.height);
    else if (root.document?.createElement) canvas = root.document.createElement('canvas');
    else if (root.OffscreenCanvas) canvas = new root.OffscreenCanvas(context.width, context.height);
    else throw new Error('Canvas is unavailable; provide canvasFactory');
    if (!canvas) throw new Error('canvasFactory did not return a canvas');
    canvas.width = context.width; canvas.height = context.height;
    return canvas;
  }
  function encode(canvas) {
    if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type: 'image/png' });
    if (typeof canvas.toBlob !== 'function') throw new Error('Canvas PNG encoding is unavailable');
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas returned no PNG')), 'image/png');
    });
  }
  async function renderPng(context, canvas, values, signal, remaining) {
    checkAbort(signal);
    const pose = context.renderer.evaluatePose(context.scene, values);
    if (!pose || !Array.isArray(pose.draws) || !Array.isArray(pose.blockedParts)) throw new Error('Invalid renderer pose');
    if (pose.blockedParts.length) {
      const part = pose.blockedParts[0];
      const error = new Error('Export blocked: ' + String(part.partId || '') + ' ' + String(part.reason || 'unprepared part'));
      error.code = 'blocked_pose';
      error.blockedParts = pose.blockedParts.map(item => ({ ...item }));
      throw error;
    }
    const drawn = await abortable(context.renderer.drawPose(canvas, pose, context.decodedAssets), signal);
    if (canvas.width !== context.width || canvas.height !== context.height ||
        drawn?.width !== context.width || drawn?.height !== context.height) throw new Error('Rendered PNG dimensions do not match the document');
    for (const draw of pose.draws) {
      const rig = context.scene.rigs.find(item => item.partId === draw.partId && item.status === 'ready');
      if (rig) context.usedRigHashes.add(rig.rigHash);
    }
    const blob = await abortable(encode(canvas), signal);
    if (!blob || !Number.isSafeInteger(blob.size) || blob.size < 0 || typeof blob.arrayBuffer !== 'function') throw new Error('Invalid PNG Blob');
    if (blob.size > remaining) throw new RangeError('PNG data exceeds the 128 MiB limit');
    const bytes = new Uint8Array(await abortable(blob.arrayBuffer(), signal));
    if (bytes.length !== blob.size || bytes.length < 33 || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) throw new Error('Invalid PNG signature or size');
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (header.getUint32(8) !== 13 || header.getUint32(12) !== 0x49484452 ||
        header.getUint32(16) !== context.width || header.getUint32(20) !== context.height) throw new Error('PNG dimensions do not match the document');
    let offset = 8, dataBytes = 0, ended = false;
    while (offset + 12 <= bytes.length) {
      const length = header.getUint32(offset), type = header.getUint32(offset + 4), end = offset + length + 12;
      if (end > bytes.length) throw new Error('Truncated PNG chunk');
      if (crc32(bytes.subarray(offset + 4, end - 4)) !== header.getUint32(end - 4)) throw new Error('PNG chunk CRC mismatch');
      if (offset !== 8 && type === 0x49484452) throw new Error('Duplicate PNG header');
      if (type === 0x49444154) dataBytes += length;
      if (type === 0x49454e44) {
        if (length !== 0 || end !== bytes.length) throw new Error('Invalid PNG end chunk');
        ended = true; break;
      }
      offset = end;
    }
    if (!ended || !dataBytes) throw new Error('Incomplete PNG image');
    checkAbort(signal);
    return bytes;
  }
  function crc32(bytes) {
    let value = 0xffffffff;
    for (let index = 0; index < bytes.length; index++) value = crcTable[(value ^ bytes[index]) & 255] ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
  }
  async function archive(entries, signal) {
    const localParts = [], centralParts = [];
    let offset = 0, centralSize = 0;
    for (let index = 0; index < entries.length; index++) {
      checkAbort(signal);
      const { name, bytes } = entries[index], nameBytes = new TextEncoder().encode(name), checksum = crc32(bytes);
      const local = new Uint8Array(30 + nameBytes.length), header = new DataView(local.buffer);
      header.setUint32(0, 0x04034b50, true); header.setUint16(4, 20, true); header.setUint16(6, 0x800, true);
      header.setUint16(12, 33, true); // Deterministic DOS date: 1980-01-01.
      header.setUint32(14, checksum, true); header.setUint32(18, bytes.length, true); header.setUint32(22, bytes.length, true);
      header.setUint16(26, nameBytes.length, true); local.set(nameBytes, 30);
      const central = new Uint8Array(46 + nameBytes.length), directory = new DataView(central.buffer);
      directory.setUint32(0, 0x02014b50, true); directory.setUint16(4, 20, true); directory.setUint16(6, 20, true);
      directory.setUint16(8, 0x800, true); directory.setUint16(14, 33, true);
      directory.setUint32(16, checksum, true); directory.setUint32(20, bytes.length, true); directory.setUint32(24, bytes.length, true);
      directory.setUint16(28, nameBytes.length, true); directory.setUint32(42, offset, true); central.set(nameBytes, 46);
      localParts.push(local, bytes); centralParts.push(central);
      offset += local.length + bytes.length; centralSize += central.length;
      if (index % 8 === 7) await abortable(new Promise(resolve => root.setTimeout(resolve, 0)), signal);
    }
    checkAbort(signal);
    const end = new Uint8Array(22), trailer = new DataView(end.buffer);
    trailer.setUint32(0, 0x06054b50, true); trailer.setUint16(8, entries.length, true); trailer.setUint16(10, entries.length, true);
    trailer.setUint32(12, centralSize, true); trailer.setUint32(16, offset, true);
    const result = new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
    checkAbort(signal);
    return result;
  }

  async function exportFrames(options) {
    const context = prepare(options, true), entries = [], frames = [];
    let canvas, totalBytes = 0;
    try {
      canvas = createCanvas(context, options.canvasFactory);
      for (let index = 0; index < 48; index++) {
        checkAbort(options.signal);
        const time = index / 24;
        const sampled = context.renderer.sampleMotion(context.motion, time, { loop: true });
        const bytes = await renderPng(context, canvas, poseValues(context, sampled), options.signal, PNG_LIMIT - totalBytes);
        const name = 'frame-' + String(index).padStart(4, '0') + '.png';
        totalBytes += bytes.length; entries.push({ name, bytes }); frames.push({ file: name, time });
        if (options.onProgress) options.onProgress({ completed: index + 1, total: 48, time, file: name, bytes: totalBytes });
        checkAbort(options.signal);
      }
      const manifest = { version: 1, width: context.width, height: context.height, duration: 2, fps: 24,
        frameCount: 48, rigHashes: [...context.usedRigHashes].sort(), frames };
      entries.push({ name: 'manifest.json', bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
      return await archive(entries, options.signal);
    } finally {
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      entries.length = 0; frames.length = 0;
    }
  }
  async function exportPosePng(options) {
    const context = prepare(options, false); let canvas;
    try {
      canvas = createCanvas(context, options.canvasFactory);
      const bytes = await renderPng(context, canvas, poseValues(context, options.values), options.signal, PNG_LIMIT);
      return new Blob([bytes], { type: 'image/png' });
    } finally { if (canvas) { canvas.width = 0; canvas.height = 0; } }
  }
  return Object.freeze({ exportFrames, exportPosePng });
}));

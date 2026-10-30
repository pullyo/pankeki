/* V3 export uses the frozen document evaluator. ZIP/PNG primitives intentionally
 * remain local so legacy exporter validation and API stay byte-identical. */
(function (root, factory) {
  'use strict';
  const api = typeof module === 'object' && module.exports ? factory(root,require('./character-document-v3.js'),require('./character-renderer-v3.js')) : factory(root,root.PankekiDocumentV3,root.PankekiRendererV3);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PankekiExportV3 = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root, Document, Renderer) {
  'use strict';
  const PNG_LIMIT = 128 * 1024 * 1024;
  const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
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
  function prepare(options, animated) {
    checkAbort(options.signal);
    const doc = Document.assertDocumentV3(options.document), base = doc.baseDocument;
    const width = base.canvas.width, height = base.canvas.height;
    if (!(options.decodedAssets instanceof Map)) throw new TypeError('Decoded assets Map is required');
    let motionId = null;
    if (animated) {
      motionId = typeof options.motion === 'string' ? options.motion : options.motion?.id;
      const member = doc.motions.find(item => item.id === motionId);
      if (!member || typeof options.motion !== 'string' && member !== options.motion) throw new Error('Motion must belong to the captured document');
      Renderer.sampleMotionV3(doc,motionId,0); // Includes the current rig hash guard.
    }
    return { document:doc, values:Document.resolveValuesV3(doc,options.values), motionId,
      width,height,decodedAssets:new Map(options.decodedAssets),canvasFactory:options.canvasFactory };
  }
  function poseValues(context, overrides = {}) { return Document.resolveValuesV3(context.document,{...context.values,...overrides}); }
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
    const pose = Renderer.evaluatePoseV3(context.document, values);
    if (!pose || !Array.isArray(pose.draws) || !Array.isArray(pose.blockedParts)) throw new Error('Invalid renderer pose');
    if (pose.blockedParts.length) {
      const part = pose.blockedParts[0];
      const error = new Error('Export blocked: ' + String(part.partId || '') + ' ' + String(part.reason || 'unprepared part'));
      error.code = 'blocked_pose';
      error.blockedParts = pose.blockedParts.map(item => ({ ...item }));
      throw error;
    }
    const drawn = await abortable(Renderer.drawPoseV3(canvas, pose, context.decodedAssets, {canvasFactory:context.canvasFactory}), signal);
    if (canvas.width !== context.width || canvas.height !== context.height ||
        drawn?.width !== context.width || drawn?.height !== context.height) throw new Error('Rendered PNG dimensions do not match the document');
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
        const sampled = Renderer.sampleMotionV3(context.document, context.motionId, time, { loop: true });
        const bytes = await renderPng(context, canvas, poseValues(context, sampled), options.signal, PNG_LIMIT - totalBytes);
        const name = 'frame-' + String(index).padStart(4, '0') + '.png';
        totalBytes += bytes.length; entries.push({ name, bytes }); frames.push({ file: name, time, values:poseValues(context,sampled) });
        if (options.onProgress) options.onProgress({ completed: index + 1, total: 48, time, file: name, bytes: totalBytes });
        checkAbort(options.signal);
      }
      const manifest = { version: 1, width: context.width, height: context.height, duration: 2, fps: 24,
        frameCount: 48, format:'pankeki-authoring-frames', rigHash:context.document.rigHash, motionId:context.motionId, parameterDefinitions:context.document.parameterDefinitions, frames };
      entries.push({ name: 'manifest.json', bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
      return await archive(entries, options.signal);
    } finally {
      if (canvas) { canvas.width = 1; canvas.height = 1; }
      entries.length = 0; frames.length = 0;
    }
  }
  async function exportPosePng(options) {
    const context = prepare(options, false); let canvas;
    try {
      canvas = createCanvas(context, options.canvasFactory);
      const bytes = await renderPng(context, canvas, poseValues(context, options.values), options.signal, PNG_LIMIT);
      return new Blob([bytes], { type: 'image/png' });
    } finally { if (canvas) { canvas.width = 1; canvas.height = 1; } }
  }
  return Object.freeze({ exportFrames, exportPosePng });
}));

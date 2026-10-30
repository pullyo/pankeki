/* Reference-only Cubism session format. No assets, browser storage, or SDK loading. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PankekiCubismSession = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const fields = ['format', 'version', 'runtimeType', 'entryPath', 'fileHashes', 'sdk', 'mode', 'parameterOverrides', 'motion', 'expression', 'effects', 'resumePolicy'];
  const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
  function invalid(message) { throw Object.assign(new Error(message), {code: 'INVALID_SESSION'}); }
  function record(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid('Expected plain object');
    for (const key of Object.keys(value)) if (unsafe.has(key)) invalid('Unsafe key');
    return value;
  }
  function exact(value, names) {
    record(value);
    const keys = Object.keys(value);
    if (keys.length !== names.length || keys.some(key => !names.includes(key))) invalid('Unexpected or missing fields');
  }
  function name(value) {
    if (typeof value !== 'string' || !value.length || value.length > 1024 || /[\u0000-\u001f\u007f]/u.test(value)) invalid('Invalid name');
    return value;
  }
  function logicalPath(value) {
    name(value);
    if (value !== value.normalize('NFC') || /[:\\]/u.test(value) || value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..')) invalid('Expected normalized relative package path');
    // Preserve literal percent names; never decode them for lookup. Match Task1's
    // rejection of encoded separators/traversal, including nested percent encodings.
    let encoded = value;
    for (let i = 0; i <= value.length; i++) {
      if (/%(?:2f|5c|00|2e)/i.test(encoded)) invalid('Encoded path separators or traversal are not allowed');
      const next = encoded.replace(/%25/ig, '%');
      if (next === encoded) break;
      encoded = next;
    }
    return value;
  }
  function hash(value, length) {
    if (typeof value !== 'string' || !(new RegExp('^[0-9a-f]{' + length + '}$')).test(value)) invalid('Invalid provenance hash');
    return value;
  }
  function sdkProvenance(value) {
    try {
      exact(value, ['coreVersion', 'coreHash', 'frameworkCommit', 'bundleHash']);
      return {coreVersion: name(value.coreVersion), coreHash: hash(value.coreHash, 64), frameworkCommit: hash(value.frameworkCommit, 40), bundleHash: hash(value.bundleHash, 64)};
    } catch (error) {
      // Keep the parser's public code while identifying only provenance failures.
      error.field = 'sdk';
      throw error;
    }
  }
  function parseSession(raw) {
    let input = raw;
    if (typeof input === 'string') {
      if (input.length > 1024 * 1024) invalid('Session too large');
      try { input = JSON.parse(input); } catch (_) { invalid('Invalid JSON'); }
    }
    exact(input, fields);
    if (input.format !== 'pankeki-cubism-session' || input.version !== 1 || input.runtimeType !== 'cubism' || input.resumePolicy !== 'restart') invalid('Unsupported session format');
    logicalPath(input.entryPath);
    if (!input.entryPath.toLowerCase().endsWith('.model3.json')) invalid('Invalid entry path');
    record(input.fileHashes);
    const hashes = {};
    const paths = Object.keys(input.fileHashes);
    if (!paths.length || paths.length > 256 || !Object.hasOwn(input.fileHashes, input.entryPath)) invalid('Entry hash missing');
    for (const key of paths.sort()) { logicalPath(key); hashes[key] = hash(input.fileHashes[key], 64); }
    const sdk = sdkProvenance(input.sdk);
    if (!['inspection', 'play'].includes(input.mode)) invalid('Invalid mode');
    record(input.parameterOverrides);
    if (Object.keys(input.parameterOverrides).length > 4096) invalid('Too many parameter overrides');
    const parameterOverrides = {};
    for (const key of Object.keys(input.parameterOverrides).sort()) {
      name(key);
      const value = input.parameterOverrides[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) invalid('Invalid parameter value');
      parameterOverrides[key] = value;
    }
    let motion = null;
    if (input.motion !== null) {
      exact(input.motion, ['group', 'index', 'loop']);
      name(input.motion.group);
      if (!Number.isSafeInteger(input.motion.index) || input.motion.index < 0 || typeof input.motion.loop !== 'boolean') invalid('Invalid motion');
      motion = Object.freeze({group: input.motion.group, index: input.motion.index, loop: input.motion.loop});
    }
    if (input.expression !== null) name(input.expression);
    exact(input.effects, ['blink', 'physics', 'pose']);
    for (const flag of Object.values(input.effects)) if (typeof flag !== 'boolean') invalid('Invalid effects');
    return Object.freeze({format: input.format, version: 1, runtimeType: 'cubism', entryPath: input.entryPath,
      fileHashes: Object.freeze(hashes), sdk: Object.freeze(sdk), mode: input.mode,
      parameterOverrides: Object.freeze(parameterOverrides), motion, expression: input.expression,
      effects: Object.freeze({...input.effects}), resumePolicy: 'restart'});
  }
  function serializeSession(session) { return JSON.stringify(parseSession(session), null, 2); }
  return Object.freeze({parseSession, serializeSession});
});

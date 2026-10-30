/* Controller owns scheduling; the injected runtime owns its detached canvas/resources. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./cubism-session.js'), require('./cubism-package.js'));
  else root.PankekiCubismController = factory(root.PankekiCubismSession, root.PankekiCubismPackage);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (sessionApi, packageApi) {
  'use strict';
  function failure(code, message) { return Object.assign(new Error(message), {code}); }
  function publicError(error) { return Object.freeze({code: typeof error?.code === 'string' ? error.code : 'RUNTIME_ERROR', message: typeof error?.message === 'string' ? error.message : String(error)}); }
  function sameRecord(a, b) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && a[key] === b[key]);
  }
  function createController({runtimeFactory, clock, onState = () => {}}) {
    if (typeof runtimeFactory !== 'function' || typeof onState !== 'function' || !clock || ['now', 'request', 'cancel', 'setTimeout', 'clearTimeout'].some(key => typeof clock[key] !== 'function')) throw failure('INVALID_CONTROLLER', 'Factory, clock, and state callback are required');
    let active = null, pending = null, session = null, closed = false, raf = null, lastMs = null, frameEpoch = 0;
    let state = {ready: false, running: false, loading: false, generation: 0, error: null};
    const disposed = new WeakSet();
    function getState() { return Object.freeze({...state}); }
    // Observer errors must not undo an already committed runtime/resource transition.
    function notify() { try { onState(getState()); } catch (_) { /* Observer owns its own errors. */ } }
    function report(error) { state.error = publicError(error); notify(); }
    function release(runtime) {
      if (!runtime || disposed.has(runtime)) return;
      disposed.add(runtime);
      try { runtime.dispose(); } catch (_) { /* Cleanup must continue for all owners. */ }
    }
    function releaseActive(item) {
      if (!item) return;
      item.canvas.removeEventListener?.('webglcontextlost', item.onLoss);
      release(item.runtime);
    }
    function stop() {
      frameEpoch++;
      if (raf !== null) { clock.cancel(raf); raf = null; }
      lastMs = null;
      state.running = false;
    }
    function pause() { if (closed) return; stop(); notify(); }
    function requestFrame(epoch) { raf = clock.request(nowMs => tick(nowMs, epoch)); }
    function tick(nowMs, epoch) {
      if (epoch !== frameEpoch) return;
      raf = null;
      if (closed || !active || !state.running) return;
      try {
        if (!Number.isFinite(nowMs)) throw failure('INVALID_CLOCK', 'Frame timestamp must be finite');
        const dt = lastMs === null ? 0 : Math.max(0, nowMs - lastMs) / 1000;
        lastMs = nowMs;
        active.runtime.update(dt);
        if (!state.running || closed || epoch !== frameEpoch) return;
        active.runtime.draw();
        if (state.running && !closed && epoch === frameEpoch) requestFrame(epoch);
      } catch (error) { stop(); report(error); }
    }
    function resume() {
      if (closed || !active || active.lost || state.running) return;
      state.running = true;
      lastMs = null;
      requestFrame(frameEpoch);
      notify();
    }
    function assertCurrent(stage) {
      if (closed || pending !== stage || stage.abort.signal.aborted) throw stage.reason || failure('ABORTED', 'Staging cancelled');
    }
    function cancelPending(reason) { if (pending) pending.cancel(reason); }
    function requireRuntime() {
      if (closed || !active) throw failure('RUNTIME_NOT_READY', 'No active Cubism runtime');
      return active.runtime;
    }
    function validateParameter(runtime, id, value) {
      const definition = runtime.parameters().find(parameter => parameter.id === id);
      if (!definition || !Number.isFinite(value) || (!definition.repeat && (value < definition.min || value > definition.max))) throw failure('INVALID_PARAMETER', 'Unknown parameter or value outside model range');
    }
    function newSession(pkg, sdk) {
      return sessionApi.parseSession({format: 'pankeki-cubism-session', version: 1, runtimeType: 'cubism', entryPath: pkg.entryPath,
        fileHashes: pkg.hashes, sdk, mode: 'inspection', parameterOverrides: {}, motion: null, expression: null,
        effects: {blink: true, physics: true, pose: true}, resumePolicy: 'restart'});
    }
    function applyRestored(runtime, restored) {
      // Restart belongs only to explicit restore, never to pause/resume.
      runtime.reset();
      runtime.setMode(restored.mode);
      runtime.setEffects(restored.effects);
      for (const [id, value] of Object.entries(restored.parameterOverrides)) {
        validateParameter(runtime, id, value);
        runtime.setParameter(id, value);
      }
      if (restored.motion) runtime.playMotion(restored.motion.group, restored.motion.index, {loop: restored.motion.loop});
      runtime.setExpression(restored.expression);
    }
    async function stagePackage(pkg, signal, restoredRaw) {
      if (closed) return false;
      cancelPending(failure('ABORTED', 'Superseded by a newer load'));
      const generation = ++state.generation;
      const stage = {abort: new AbortController(), runtime: null, reason: null};
      let rejectCancellation;
      const cancellation = new Promise((_, reject) => { rejectCancellation = reject; });
      stage.cancel = reason => {
        if (stage.abort.signal.aborted) return;
        stage.reason = reason;
        stage.abort.abort(reason);
        release(stage.runtime);
        rejectCancellation(reason);
      };
      pending = stage;
      state.loading = true;
      state.error = null;
      const externalAbort = () => stage.cancel(failure('ABORTED', 'Load aborted'));
      const timeout = clock.setTimeout(() => stage.cancel(failure('LOAD_TIMEOUT', 'Cubism staging exceeded 30 seconds')), 30000);
      signal?.addEventListener('abort', externalAbort, {once: true});
      if (signal?.aborted) externalAbort();
      notify();
      const work = async () => {
        assertCurrent(stage);
        const restored = restoredRaw === undefined ? null : sessionApi.parseSession(restoredRaw);
        // Package-shaped input is never trusted: capture once, validate bytes, compare hashes.
        const files = pkg.files;
        if (!(files instanceof Map)) throw failure('INVALID_INPUT', 'Package files snapshot required');
        const verified = await packageApi.readPackage(Array.from(files, ([path, bytes]) => ({path, bytes})), {entryPath: pkg.entryPath, signal: stage.abort.signal});
        assertCurrent(stage);
        if (!pkg.hashes || !sameRecord(verified.hashes, pkg.hashes)) throw failure('PACKAGE_MISMATCH', 'Package hashes do not match selected bytes');
        if (restored && (restored.entryPath !== verified.entryPath || !sameRecord(restored.fileHashes, verified.hashes))) throw failure('PACKAGE_MISMATCH', 'Session belongs to different package bytes');
        // A promise may resolve after cancellation. Its returned resource still belongs to us.
        const runtime = await runtimeFactory({signal: stage.abort.signal});
        stage.runtime = runtime;
        if (stage.abort.signal.aborted || closed || pending !== stage) { release(runtime); assertCurrent(stage); }
        await runtime.load(verified);
        assertCurrent(stage);
        let next;
        try { next = newSession(verified, runtime.diagnostics()?.sdk); }
        catch (error) {
          if (error.code !== 'INVALID_SESSION' || error.field !== 'sdk') throw error;
          throw failure('SDK_UNAVAILABLE', 'Runtime SDK provenance is missing or invalid: ' + error.message);
        }
        if (restored && !sameRecord(restored.sdk, next.sdk)) throw failure('SDK_MISMATCH', 'Session SDK provenance differs from active runtime');
        if (restored) applyRestored(runtime, restored);
        else { runtime.setMode(next.mode); runtime.setEffects(next.effects); }
        await runtime.drawFirstFrame();
        assertCurrent(stage);
        const canvas = runtime.getCanvas();
        if (!canvas || typeof canvas.addEventListener !== 'function') throw failure('INVALID_CANVAS', 'Runtime must provide its drawn candidate canvas');
        return {runtime, canvas, session: restored || next};
      };
      try {
        const candidate = await Promise.race([work(), cancellation]);
        assertCurrent(stage);
        const previous = active;
        stop();
        const item = {runtime: candidate.runtime, canvas: candidate.canvas, onLoss: null, lost: false};
        item.onLoss = event => {
          if (active !== item || closed) return;
          event.preventDefault?.();
          item.lost = true;
          stop();
          report(failure('CONTEXT_LOST', 'Cubism WebGL context lost; reselect/reload the original package to recover'));
        };
        item.canvas.addEventListener('webglcontextlost', item.onLoss);
        active = item;
        session = candidate.session;
        state.ready = true;
        state.error = null;
        releaseActive(previous);
        return true;
      } catch (error) {
        if (!stage.abort.signal.aborted) stage.abort.abort(error);
        release(stage.runtime);
        // Stale failures must never overwrite a newer load's state.
        if (!closed && generation === state.generation) state.error = publicError(error);
        return false;
      } finally {
        clock.clearTimeout(timeout);
        signal?.removeEventListener('abort', externalAbort);
        if (pending === stage) { pending = null; state.loading = false; notify(); }
      }
    }
    function edit(method, args, changes) {
      const runtime = requireRuntime();
      try {
        const next = sessionApi.parseSession({...session, ...changes});
        if (method === 'setParameter') validateParameter(runtime, args[0], args[1]);
        if (active.lost) throw failure('CONTEXT_LOST', 'Reload the original package before editing');
        runtime[method](...args);
        runtime.update(0);
        if (active.lost) throw failure('CONTEXT_LOST', 'Cubism WebGL context lost during edit');
        runtime.draw();
        session = next;
        if (method === 'reset') lastMs = null;
        state.error = null;
        notify();
      } catch (error) { stop(); report(error); throw error; }
    }
    function dispose() {
      if (closed) return;
      closed = true;
      stop();
      cancelPending(failure('ABORTED', 'Controller disposed'));
      releaseActive(active);
      active = null;
      session = null;
      state.ready = false;
      state.loading = false;
      state.error = null;
      notify();
    }
    return Object.freeze({
      load: (pkg, {signal} = {}) => stagePackage(pkg, signal),
      restore: (restored, pkg) => stagePackage(pkg, undefined, restored),
      snapshot: () => session, getState, getCanvas: () => active?.canvas || null, pause, resume, dispose,
      parameters() { const runtime = requireRuntime(); try { return runtime.parameters().map(value => ({...value})); } catch (error) { report(error); throw error; } },
      setParameter(id, value) { edit('setParameter', [id, value], {parameterOverrides: {...session?.parameterOverrides, [id]: value}}); },
      setMode(mode) { edit('setMode', [mode], {mode}); },
      playMotion(group, index, options) { edit('playMotion', [group, index, options], {motion: {group, index, loop: options?.loop}}); },
      setExpression(expression) { edit('setExpression', [expression], {expression}); },
      setEffects(effects) { edit('setEffects', [effects], {effects}); },
      reset() { edit('reset', [], {parameterOverrides: {}, motion: null, expression: null}); }
    });
  }
  return Object.freeze({createController});
});

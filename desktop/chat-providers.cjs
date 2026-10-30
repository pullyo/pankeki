'use strict';
// Chooses which chat bridge (Codex or Claude) the desktop app talks to.
//
// Presents the single-bridge contract Electron main and ipc.cjs already use, so
// neither needs to know which provider runs. The provider can only change while
// no request is active; a status event from the provider that is not selected
// is dropped. Request events must belong to the current provider/model revision.
// Result lookups still go to the bridge that owns the job.
const PROVIDERS = ['codex', 'claude'];
const {DEFAULT_MODELS, validModelId} = require('./chat-model-settings.cjs');
const fail = code => { throw Object.assign(new Error(code), {code}); };

function createProviderBridge({factories, initial = 'codex', onEvent, settings}) {
  if (!factories || !PROVIDERS.every(name => typeof factories[name] === 'function')) throw new Error('codex and claude bridge factories are required');
  if (!PROVIDERS.includes(initial)) throw new Error('unknown provider');
  if (typeof onEvent !== 'function') throw new Error('onEvent is required');
  let selected = initial, modelRevision = 0, changing = false;
  const selectedModels = {...DEFAULT_MODELS}, catalogs = new Map(), connecting = new Map(), loading = new Map(), restoring = new Map(), requests = new Map();
  let saved = {}; try { saved = settings?.load() || {}; } catch {}
  const pendingRestore = new Set(PROVIDERS.filter(name => validModelId(saved[name]) && saved[name] !== DEFAULT_MODELS[name]));
  const bridges = {};
  for (const name of PROVIDERS) bridges[name] = factories[name](event => {
    if (!event) return;
    if (event.type === 'status') {
      if (name !== selected) return;
      onEvent({...event, payload: {...event.payload, provider: name, modelId: selectedModels[name], modelRevision}});
      return;
    }
    if (!event.requestId) { if (name === selected) onEvent(event); return; }
    const owner = requests.get(event.requestId);
    if (!owner || owner.provider !== name || owner.revision !== modelRevision || name !== selected) return;
    onEvent(event);
  });
  const current = () => bridges[selected];
  const status = () => ({...current().status(), provider: selected, modelId: selectedModels[selected], modelRevision});
  const busy = () => changing || connecting.size > 0 || loading.size > 0 || restoring.size > 0 || PROVIDERS.some(name => {
    const state = bridges[name].status(); return state.activeRequestId || ['starting', 'busy'].includes(state.state);
  });
  function statusEvent() { onEvent({requestId: null, projectId: null, sourceRevision: null, type: 'status', payload: status()}); }

  function select({provider} = {}) {
    if (!PROVIDERS.includes(provider)) throw Object.assign(new Error('unknown provider'), {code: 'invalid-input'});
    if (busy()) fail('busy');
    if (selected !== provider) modelRevision++;
    selected = provider;
    const snapshot = status();
    statusEvent();
    return snapshot;
  }

  function connectNative(name) {
    if (!connecting.has(name)) {
      const promise = Promise.resolve().then(() => bridges[name].connect()).finally(() => connecting.delete(name));
      connecting.set(name, promise);
    }
    return connecting.get(name);
  }
  async function catalogFor(name) {
    if (catalogs.has(name)) return catalogs.get(name);
    if (!loading.has(name)) {
      const promise = (async () => {
        const state = await connectNative(name);
        if (state.state !== 'ready') fail(['missing', 'signed-out'].includes(state.state) ? state.state : 'not-ready');
        if (typeof bridges[name].getModels !== 'function') fail('model-list-failed');
        const catalog = await bridges[name].getModels();
        catalogs.set(name, catalog); return catalog;
      })().finally(() => loading.delete(name));
      loading.set(name, promise);
    }
    return loading.get(name);
  }
  async function restore(name, catalog) {
    if (restoring.has(name)) return restoring.get(name);
    if (!pendingRestore.has(name)) return;
    if (!catalog.models.some(model => model.id === saved[name])) { pendingRestore.delete(name); return; }
    const promise = (async () => {
      await bridges[name].setModel({modelId: saved[name]});
      pendingRestore.delete(name); selectedModels[name] = saved[name]; modelRevision++;
      if (name === selected) statusEvent();
    })().finally(() => restoring.delete(name));
    restoring.set(name, promise);
    return promise;
  }
  async function connect() {
    if (changing) fail('busy');
    const name = selected;
    const state = await connectNative(name);
    if (state.state === 'ready' && pendingRestore.has(name)) await restore(name, await catalogFor(name));
    return {...bridges[name].status(), provider: name, modelId: selectedModels[name], modelRevision};
  }
  async function getChatModelOptions({provider} = {}) {
    if (!PROVIDERS.includes(provider)) fail('invalid-input');
    let catalog = catalogs.get(provider), errorCode = null;
    if (!catalog && busy()) errorCode = 'busy';
    else {
      try { catalog = await catalogFor(provider); if (!changing) await restore(provider, catalog); }
      catch (error) { errorCode = ['missing', 'signed-out', 'not-ready', 'busy'].includes(error.code) ? error.code : 'model-list-failed'; }
    }
    const snapshot = bridges[provider].status();
    return {provider, selectedModelId: selectedModels[provider], modelRevision,
      state: snapshot.state, cliVersion: snapshot.codexVersion || snapshot.version || null, source: catalog?.source || null, availability: 'unverified',
      options: catalog ? [...(provider === 'codex' ? [{id: 'default', displayName: 'Codex default'}] : []), ...catalog.models.map(({id, displayName}) => ({id, displayName}))] : [], errorCode};
  }
  async function setChatModel({provider, modelId} = {}) {
    if (!PROVIDERS.includes(provider) || !validModelId(modelId)) fail('invalid-input');
    if (provider !== selected) fail('stale-provider');
    if (busy()) fail('busy');
    changing = true;
    try {
      const catalog = await catalogFor(provider);
      if (modelId !== DEFAULT_MODELS[provider] && !catalog.models.some(model => model.id === modelId)) fail('unknown-model');
      if (provider === 'claude' && !catalog.models.some(model => model.id === modelId)) fail('unknown-model');
      const before = selectedModels[provider];
      if (before === modelId) return {provider, selectedModelId: modelId, modelRevision, conversationReset: false};
      await bridges[provider].setModel({modelId});
      try { settings?.save(provider, modelId); }
      catch { await bridges[provider].setModel({modelId: before}); fail('settings-save-failed'); }
      pendingRestore.delete(provider); selectedModels[provider] = modelId; modelRevision++;
      statusEvent();
      return {provider, selectedModelId: modelId, modelRevision, conversationReset: true};
    } finally { changing = false; }
  }

  const lookup = method => query => {
    for (const name of PROVIDERS) { const found = bridges[name][method](query); if (found) return found; }
    return null;
  };

  async function close() {
    const results = await Promise.all(PROVIDERS.map(name => bridges[name].close()));
    return {unconfirmedSubmissions: results.reduce((sum, r) => sum + (Number.isSafeInteger(r && r.unconfirmedSubmissions) ? r.unconfirmedSubmissions : 0), 0)};
  }

  return {
    status, select, close, getChatModelOptions, setChatModel,
    providers: () => [...PROVIDERS],
    connect,
    send: async value => {
      if (busy()) fail('busy');
      if (requests.size >= 10000) fail('session-limit');
      requests.set(value.requestId, {provider: selected, revision: modelRevision});
      return current().send(value);
    },
    cancel: async value => {
      for (const name of PROVIDERS) if (await bridges[name].cancel(value)) return true;
      return false;
    },
    getSubmittedRequest: lookup('getSubmittedRequest'),
    getResultDescriptor: lookup('getResultDescriptor'),
    protocolVersion: PROVIDERS.every(name => bridges[name].protocolVersion === 2) ? 2 : null
  };
}

module.exports = {createProviderBridge, PROVIDERS};

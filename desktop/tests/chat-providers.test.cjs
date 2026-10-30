'use strict';
// node --test desktop/tests/chat-providers.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const {createProviderBridge} = require('../chat-providers.cjs');

function stub(name) {
  const calls = [];
  let active = null, emit;
  const bridge = {
    calls, protocolVersion: 2,
    status: () => ({state: 'ready', activeRequestId: active}),
    connect: async () => { calls.push('connect'); return {state: 'ready'}; },
    send: async value => { calls.push('send'); active = value.requestId; return {requestId: value.requestId}; },
    cancel: async ({requestId}) => { if (active !== requestId) return false; active = null; return true; },
    close: async () => { calls.push('close'); return {unconfirmedSubmissions: name === 'codex' ? 1 : 2}; },
    getSubmittedRequest: q => q.jobId === name ? {owner: name} : null,
    getResultDescriptor: q => q.jobId === name ? {owner: name} : null,
    emit: event => emit(event)
  };
  bridge.getModels = async () => ({source: name === 'codex' ? 'codex-model-list' : 'claude-initialize', models: name === 'codex'
    ? [{id: 'model-a', displayName: 'Model A', model: 'wire-a', effort: 'low'}, {id: 'model-b', displayName: 'Model B', model: 'wire-b', effort: 'medium'}]
    : [{id: 'sonnet', displayName: 'Sonnet', model: 'sonnet'}, {id: 'opus', displayName: 'Opus', model: 'opus'}]});
  bridge.setModel = async ({modelId}) => { calls.push('model:' + modelId); };
  return {bridge, factory: onEvent => { emit = onEvent; return bridge; }};
}

function setup() {
  const codex = stub('codex'), claude = stub('claude'), events = [];
  const providers = createProviderBridge({factories: {codex: codex.factory, claude: claude.factory}, onEvent: e => events.push(e)});
  return {providers, codex: codex.bridge, claude: claude.bridge, events};
}

test('defaults to codex and routes connect/send to the selected provider', async () => {
  const t = setup();
  assert.equal(t.providers.status().provider, 'codex');
  assert.equal((await t.providers.connect()).provider, 'codex');
  t.providers.select({provider: 'claude'});
  await t.providers.send({requestId: 'r1'});
  assert.deepEqual(t.codex.calls, ['connect']);
  assert.deepEqual(t.claude.calls, ['send']);
  assert.equal(t.events.at(-1).payload.provider, 'claude');
});

test('switching is refused while a request is active and for unknown providers', async () => {
  const t = setup();
  await t.providers.send({requestId: 'r1'});
  assert.throws(() => t.providers.select({provider: 'claude'}), {code: 'busy'});
  assert.equal(await t.providers.cancel({requestId: 'r1'}), true);
  t.providers.select({provider: 'claude'});
  assert.throws(() => t.providers.select({provider: 'gpt'}), {code: 'invalid-input'});
});

test('unselected or unowned events are dropped and selected current request events pass', async () => {
  const t = setup();
  t.claude.emit({type: 'status', requestId: null, payload: {state: 'error'}});
  t.claude.emit({type: 'message', requestId: 'r1', payload: {text: 'x'}});
  await t.providers.send({requestId: 'r1'});
  t.codex.emit({type: 'message', requestId: 'r1', payload: {text: 'current'}});
  t.codex.emit({type: 'status', requestId: null, payload: {state: 'ready'}});
  assert.deepEqual(t.events.map(e => e.type + ':' + (e.requestId || '')), ['message:r1', 'status:']);
});

test('saved restoration keeps its revision coherent and blocks provider/send races until native reset ends', async () => {
  const codex = stub('codex'), claude = stub('claude'); let release;
  codex.bridge.setModel = () => new Promise(resolve => { release = resolve; });
  const providers = createProviderBridge({factories: {codex: codex.factory, claude: claude.factory}, onEvent() {}, settings: {load: () => ({codex: 'model-a'}), save() {}}});
  const listing = providers.getChatModelOptions({provider: 'codex'});
  await new Promise(resolve => setImmediate(resolve));
  assert.throws(() => providers.select({provider: 'claude'}), {code: 'busy'});
  await assert.rejects(providers.send({requestId: 'r1'}), {code: 'busy'});
  release(); const options = await listing;
  assert.equal(options.selectedModelId, 'model-a');
  assert.equal(options.modelRevision, providers.status().modelRevision);
});

test('missing and signed-out catalogs report honest state and never selectable invented models', async () => {
  for (const state of ['missing', 'signed-out']) {
    const codex = stub('codex'), claude = stub('claude');
    codex.bridge.connect = async () => ({state}); codex.bridge.status = () => ({state});
    const providers = createProviderBridge({factories: {codex: codex.factory, claude: claude.factory}, onEvent() {}});
    const options = await providers.getChatModelOptions({provider: 'codex'});
    assert.equal(options.state, state); assert.equal(options.errorCode, state); assert.deepEqual(options.options, []);
  }
});

test('result lookups go to the owning bridge; close closes both and sums unconfirmed submits', async () => {
  const t = setup();
  assert.deepEqual(t.providers.getResultDescriptor({jobId: 'claude'}), {owner: 'claude'});
  assert.deepEqual(t.providers.getSubmittedRequest({jobId: 'codex'}), {owner: 'codex'});
  assert.equal(t.providers.getResultDescriptor({jobId: 'none'}), null);
  assert.deepEqual(await t.providers.close(), {unconfirmedSubmissions: 3});
  assert.ok(t.codex.calls.includes('close') && t.claude.calls.includes('close'));
  assert.equal(t.providers.protocolVersion, 2);
});

test('model changes validate catalog membership and preserve the other provider selection', async () => {
  const t = setup();
  const options = await t.providers.getChatModelOptions({provider: 'codex'});
  assert.equal(options.selectedModelId, 'default');
  assert.equal(options.availability, 'unverified');
  assert.deepEqual(options.options.map(m => m.id), ['default', 'model-a', 'model-b']);
  await assert.rejects(t.providers.setChatModel({provider: 'codex', modelId: 'invented'}), {code: 'unknown-model'});
  const result = await t.providers.setChatModel({provider: 'codex', modelId: 'model-a'});
  assert.equal(result.conversationReset, true);
  assert.equal(t.providers.status().modelId, 'model-a');
  assert.equal((await t.providers.setChatModel({provider: 'codex', modelId: 'model-a'})).conversationReset, false);
  t.providers.select({provider: 'claude'});
  await t.providers.getChatModelOptions({provider: 'claude'});
  await t.providers.setChatModel({provider: 'claude', modelId: 'opus'});
  t.providers.select({provider: 'codex'});
  assert.equal(t.providers.status().modelId, 'model-a');
  await assert.rejects(t.providers.setChatModel({provider: 'claude', modelId: 'sonnet'}), {code: 'stale-provider'});
});

test('model mutation locks send/provider changes and drops earlier model request events', async () => {
  const t = setup();
  await t.providers.getChatModelOptions({provider: 'codex'});
  await t.providers.send({requestId: 'old'});
  t.codex.emit({type: 'turn-completed', requestId: 'old', payload: {status: 'completed'}});
  await t.providers.cancel({requestId: 'old'});
  let release;
  t.codex.setModel = () => new Promise(resolve => { release = resolve; });
  const changing = t.providers.setChatModel({provider: 'codex', modelId: 'model-a'});
  await new Promise(resolve => setImmediate(resolve));
  assert.throws(() => t.providers.select({provider: 'claude'}), {code: 'busy'});
  await assert.rejects(t.providers.send({requestId: 'new'}), {code: 'busy'});
  release(); await changing;
  const count = t.events.length;
  t.codex.emit({type: 'message', requestId: 'old', payload: {text: 'stale'}});
  assert.equal(t.events.length, count);
});

test('saved selection is verified against fresh catalog and persistence errors roll back', async () => {
  const codex = stub('codex'), claude = stub('claude');
  const saved = {codex: 'model-a', claude: 'invented'};
  const providers = createProviderBridge({factories: {codex: codex.factory, claude: claude.factory}, onEvent() {}, settings: {load: () => saved, save: () => { throw Error('disk'); }}});
  await providers.connect();
  assert.equal(providers.status().modelId, 'model-a');
  await assert.rejects(providers.setChatModel({provider: 'codex', modelId: 'model-b'}), {code: 'settings-save-failed'});
  assert.equal(providers.status().modelId, 'model-a');
  assert.deepEqual(codex.bridge.calls.slice(-2), ['model:model-b', 'model:model-a']);
  providers.select({provider: 'claude'}); await providers.connect();
  assert.equal(providers.status().modelId, 'sonnet');
});

test('both provider choices survive an application settings reload and are applied before sending', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const {createChatModelSettings} = require('../chat-model-settings.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pankeki-provider-settings-'));
  function open() {
    const codex = stub('codex'), claude = stub('claude');
    return {codex, claude, providers: createProviderBridge({factories: {codex: codex.factory, claude: claude.factory}, onEvent() {}, settings: createChatModelSettings({directory})})};
  }
  const first = open();
  await first.providers.setChatModel({provider: 'codex', modelId: 'model-b'});
  first.providers.select({provider: 'claude'});
  await first.providers.setChatModel({provider: 'claude', modelId: 'opus'});
  await first.providers.close();
  const next = open();
  assert.equal(next.providers.status().provider, 'codex');
  await next.providers.connect(); await next.providers.send({requestId: 'codex-restored'});
  assert.ok(next.codex.bridge.calls.indexOf('model:model-b') < next.codex.bridge.calls.indexOf('send'));
  await next.providers.cancel({requestId: 'codex-restored'});
  next.providers.select({provider: 'claude'}); await next.providers.connect();
  assert.equal(next.providers.status().modelId, 'opus');
  assert.ok(next.claude.bridge.calls.includes('model:opus'));
  await next.providers.close();
});

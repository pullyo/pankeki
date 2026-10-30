'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const settings = () => require('../chat-model-settings.cjs');

test('catalog normalization rejects commands paths duplicates and unsupported default efforts', () => {
  const {normalizeModels, validModelId} = settings();
  for (const id of ['../model', '--model', 'https://host/model', 'a;cmd', 'a\ncmd', 'x'.repeat(121)]) assert.equal(validModelId(id), false);
  assert.equal(validModelId('claude-fable-5-1[1m]'), true);
  const row = {id: 'picker', model: 'wire', displayName: 'Pick', defaultReasoningEffort: 'low', supportedReasoningEfforts: [{reasoningEffort: 'low'}]};
  assert.deepEqual(normalizeModels('codex', [row, row, {...row, id: 'bad', defaultReasoningEffort: 'ultra'}, {...row, id: '../no'}, {...row, id: 'secret', displayName: '/Users/private/file'}]).map(m => [m.id, m.displayName, m.effort]), [['picker', 'Pick', 'low'], ['secret', 'secret', 'low']]);
  assert.deepEqual(normalizeModels('claude', [{value: 'opus', displayName: 'Opus', account: 'secret'}, {value: 'opus'}, {value: '/tmp/a'}]), [{id: 'opus', model: 'opus', displayName: 'Opus'}]);
});

test('private settings round trip both providers and reject corrupt oversized and symlink files', () => {
  const {createChatModelSettings} = settings();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pankeki-model-settings-'));
  const file = path.join(dir, 'chat-model-settings.json');
  const store = createChatModelSettings({directory: dir});
  assert.deepEqual(store.load(), {codex: 'default', claude: 'sonnet'});
  store.save('codex', 'picker'); store.save('claude', 'opus');
  assert.deepEqual(createChatModelSettings({directory: dir}).load(), {codex: 'picker', claude: 'opus'});
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.throws(() => store.save('codex', '../escape'), {code: 'invalid-input'});
  fs.writeFileSync(file, JSON.stringify({version: 1, models: {codex: '/tmp/file', claude: 'opus'}}));
  assert.deepEqual(store.load(), {codex: 'default', claude: 'sonnet'});
  fs.writeFileSync(file, 'x'.repeat(20000)); assert.equal(store.load().codex, 'default');
  fs.unlinkSync(file); fs.writeFileSync(path.join(dir, 'external'), '{}'); fs.symlinkSync(path.join(dir, 'external'), file);
  assert.equal(store.load().codex, 'default');
});

test('failed atomic settings writes do not replace prior preferences', () => {
  const {createChatModelSettings} = settings();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pankeki-model-settings-'));
  const store = createChatModelSettings({directory: path.join(dir, 'blocked')});
  fs.writeFileSync(path.join(dir, 'blocked'), 'not a directory');
  assert.throws(() => store.save('codex', 'picker'));
  assert.equal(fs.readFileSync(path.join(dir, 'blocked'), 'utf8'), 'not a directory');
  assert.equal(store.load().codex, 'default');
});

test('catalogs cap visible rows and titles independently of untrusted metadata size', () => {
  const {normalizeModels} = settings();
  const rows = Array.from({length: 1000}, (_, n) => ({value: 'model-' + n, displayName: 'x'.repeat(1000)}));
  const models = normalizeModels('claude', rows);
  assert.equal(models.length, 100); assert.equal(models[0].displayName.length, 120);
});

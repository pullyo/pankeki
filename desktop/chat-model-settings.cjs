'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const DEFAULT_MODELS = Object.freeze({codex: 'default', claude: 'sonnet'});
const validModelId = value => typeof value === 'string' && value.length <= 120 && /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\[[A-Za-z0-9_-]{1,16}\])?$/.test(value);
const error = code => Object.assign(new Error(code), {code});
function displayName(value, fallback) {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]|(?:https?:|file:|\/Users\/|\/Volumes\/|\/tmp\/|\bsk-)/i.test(value)) return fallback;
  return value.trim().slice(0, 120) || fallback;
}
function normalizeModels(provider, rows) {
  const models = [], seen = new Set();
  if (!Array.isArray(rows)) return models;
  for (const row of rows.slice(0, 400)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const id = provider === 'codex' ? row.id : row.value;
    const model = provider === 'codex' ? row.model : row.value;
    if (!validModelId(id) || !validModelId(model) || seen.has(id) || row.hidden === true || (provider === 'codex' && id === 'default')) continue;
    const entry = {id, model, displayName: displayName(row.displayName, id)};
    if (provider === 'codex') {
      const effort = row.defaultReasoningEffort;
      if (typeof effort !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(effort) || !Array.isArray(row.supportedReasoningEfforts)
        || !row.supportedReasoningEfforts.some(option => option && option.reasoningEffort === effort)) continue;
      entry.effort = effort;
    }
    seen.add(id); models.push(entry);
    if (models.length === 100) break;
  }
  return models;
}
function createChatModelSettings({directory}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw error('invalid-config');
  const file = path.join(directory, 'chat-model-settings.json');
  function load() {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) return {...DEFAULT_MODELS};
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!data || Object.keys(data).sort().join(',') !== 'models,version' || data.version !== 1 || !data.models
        || Object.keys(data.models).sort().join(',') !== 'claude,codex' || !Object.values(data.models).every(validModelId)) return {...DEFAULT_MODELS};
      return {codex: data.models.codex, claude: data.models.claude};
    } catch { return {...DEFAULT_MODELS}; }
  }
  function save(provider, modelId) {
    if (!Object.hasOwn(DEFAULT_MODELS, provider) || !validModelId(modelId)) throw error('invalid-input');
    const models = {...load(), [provider]: modelId};
    fs.mkdirSync(directory, {recursive: true});
    const temporary = path.join(directory, '.chat-model-settings-' + randomUUID() + '.tmp');
    try {
      fs.writeFileSync(temporary, JSON.stringify({version: 1, models}) + '\n', {mode: 0o600, flag: 'wx'});
      fs.renameSync(temporary, file);
    } finally { try { fs.unlinkSync(temporary); } catch {} }
  }
  return {load, save};
}
module.exports = {DEFAULT_MODELS, validModelId, normalizeModels, createChatModelSettings};

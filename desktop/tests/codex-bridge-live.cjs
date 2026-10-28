'use strict';
// Live check against the installed Codex (not part of the automated suite).
//   node desktop/tests/codex-bridge-live.cjs isolation  — local only, no model turn
//   node desktop/tests/codex-bridge-live.cjs turn       — one real turn, status tool only
// Writes a redacted JSON record to output/desktop-codex-20261024/claude/live/.
const fs = require('node:fs');
const path = require('node:path');
const {createCodexBridge} = require('../codex-bridge.cjs');

const projectRoot = path.resolve(__dirname, '../..');
const mode = process.argv[2] || 'isolation';
const outDir = path.join(projectRoot, 'output/desktop-codex-20261024/claude/live');
const events = [];
const logs = [];

(async () => {
  const traces = [];
  // Trace keeps only method names, item types, MCP server/tool names and startup states.
  const trace = (method, params) => traces.push({method, item: params.item && params.item.type, server: params.item && params.item.server || params.name,
    tool: params.item && params.item.tool, status: params.item && params.item.status, startup: params.status && (params.status.state || params.status),
    error: params.item && params.item.error ? String(params.item.error.message).slice(0, 300) : params.error ? String(params.error.message || params.error).slice(0, 300) : undefined});
  const bridge = createCodexBridge({projectRoot, onEvent: event => events.push({at: Date.now(), ...event}), log: line => logs.push(line), trace});
  const record = {mode, startedAt: new Date().toISOString(), childArgs: bridge._debug.childArgs().map(a => a.replace(/\/Users\/[^/]+/g, '~'))};
  record.connect = await bridge.connect();
  if (record.connect.state === 'ready') {
    record.isolation = await bridge._debug.verifyIsolation();
    if (mode === 'turn') {
      const done = new Promise(resolve => { const check = setInterval(() => { if (events.some(e => e.type === 'turn-completed')) { clearInterval(check); resolve(); } }, 200); });
      await bridge.send({text: '[Pankeki action: chat]\nPankeki 앱 상태를 확인하고 한 문장으로 알려 주세요. 이미지는 만들지 마세요.', projectId: 'live-check', requestId: 'live-status-1'});
      await Promise.race([done, new Promise(resolve => setTimeout(resolve, 180000))]);
    }
  }
  await bridge.close();
  record.finalStatus = bridge.status();
  record.events = events.map(e => ({...e, payload: e.type === 'message-delta' ? {chars: e.payload.text.length} : e.payload}));
  record.stderrLines = logs.length;
  record.traces = traces.filter(t => t.method !== 'item/agentMessage/delta');
  record.stderrTail = logs.slice(-15);
  fs.mkdirSync(outDir, {recursive: true});
  const file = path.join(outDir, `${mode}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
  console.log(file);
  console.log(JSON.stringify({connect: record.connect, isolation: record.isolation, types: record.events.map(e => e.type)}, null, 1));
})().catch(error => { console.error(error); process.exitCode = 1; });

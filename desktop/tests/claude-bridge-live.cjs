'use strict';
// Live check against the installed Claude Code CLI (not part of the automated suite).
//   node desktop/tests/claude-bridge-live.cjs turn   — one real chat turn, status tool only
// Uses the real Pankeki MCP adapter against 127.0.0.1:8190; no image job runs.
// Writes a redacted JSON record to output/desktop-codex-20261024/claude-provider/live/.
const fs = require('node:fs');
const path = require('node:path');
const {createClaudeBridge} = require('../claude-bridge.cjs');

const projectRoot = path.resolve(__dirname, '../..');
const mode = process.argv[2] || 'turn';
const outDir = path.join(projectRoot, 'output/desktop-codex-20261024/claude-provider/live');
const events = [];
const logs = [];

(async () => {
  const bridge = createClaudeBridge({projectRoot, onEvent: event => events.push({at: Date.now(), ...event}), log: line => logs.push(line)});
  const record = {mode, startedAt: new Date().toISOString(), sessionArgs: bridge._debug.sessionArgs('<mcp-config>', 'sonnet').map(a => a.length > 120 ? a.slice(0, 60) + '…' : a)};
  record.connect = await bridge.connect();
  if (record.connect.state === 'ready' && mode === 'turn') {
    const done = new Promise(resolve => { const check = setInterval(() => { if (events.some(e => e.type === 'turn-completed')) { clearInterval(check); resolve(); } }, 200); });
    await bridge.send({text: '[Pankeki action: chat]\nPankeki 앱 상태를 확인하고 한 문장으로 알려 주세요. 이미지는 만들지 마세요.', projectId: 'live-check', requestId: 'live-status-1'});
    await Promise.race([done, new Promise(resolve => setTimeout(resolve, 180000))]);
  }
  await bridge.close();
  record.finalStatus = bridge.status();
  record.events = events.map(e => ({...e, payload: e.type === 'message-delta' ? {chars: e.payload.text.length} : e.payload}));
  record.stderrLines = logs.length;
  record.stderrTail = logs.slice(-15);
  fs.mkdirSync(outDir, {recursive: true});
  const file = path.join(outDir, `${mode}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
  console.log(file);
  console.log(JSON.stringify({connect: record.connect, types: record.events.map(e => e.type), messages: record.events.filter(e => e.type === 'message').map(e => e.payload.text)}, null, 1));
})().catch(error => { console.error(error); process.exitCode = 1; });

'use strict';
// node --test desktop/tests/claude-bridge.test.cjs
// Runs the bridge against claude-bridge-fake-cli.cjs (fake `claude` CLI) and the
// fake Pankeki MCP adapter in codex-bridge-fake-server.cjs; no network, Claude
// account, GPU or real Pankeki server.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {createClaudeBridge, MODEL_TOOLS} = require('../claude-bridge.cjs');

const projectRoot = path.resolve(__dirname, '../..');
const fakeCli = path.join(__dirname, 'claude-bridge-fake-cli.cjs');
const fakeMcp = path.join(__dirname, 'codex-bridge-fake-server.cjs');
const JOB = 'a'.repeat(32);
// A failed assertion skips a test's own close(); stop every child and server here.
const opened = [];
test.after(async () => { for (const bridge of opened) await bridge.close(); });

function setup(scenario = 'ok', {auth = 'ok', ...extra} = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pankeki-claude-'));
  const inputRoot = path.join(dataDir, 'inputs');
  const logFile = path.join(dataDir, 'fake.log');
  const events = [];
  const children = [];
  const env = {FAKE_SCENARIO: scenario, FAKE_LOG: logFile, FAKE_AUTH: auth};
  const spawnImpl = (cmd, args, options) => {
    const proc = spawn(process.execPath, [cmd === 'fake-mcp' ? fakeMcp : fakeCli, ...args], {...options, env: {...options.env, ...env}});
    children.push({role: cmd === 'fake-mcp' ? 'mcp' : args[0], proc});
    return proc;
  };
  const mcpStateDir = path.join(dataDir, 'mcp-state');
  const mcpCommand = ({state}) => ({command: 'fake-mcp', args: ['--mcp', '--state', state], env: {}});
  const bridge = createClaudeBridge({projectRoot, claudePath: '/fake/claude', dataDir, inputRoot, mcpStateDir, onEvent: e => events.push(e), spawnImpl, mcpCommand, ...extra});
  opened.push(bridge);
  const log = () => fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').map(JSON.parse) : [];
  const mcpReplies = () => log().filter(e => e.mcpReply).map(e => e.mcpReply);
  const adapterCalls = () => log().filter(e => e.role === 'mcp' && e.received && e.received.method === 'tools/call').map(e => e.received.params);
  const waitUntil = (predicate, ms = 5000) => new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => { const hit = predicate(); if (hit) return resolve(hit); if (Date.now() - start > ms) return reject(new Error('timeout waiting for condition')); setTimeout(tick, 10); };
    tick();
  });
  const waitFor = (predicate, ms) => waitUntil(() => events.find(predicate), ms);
  const done = requestId => waitFor(e => e.type === 'turn-completed' && e.requestId === requestId);
  return {bridge, events, log, mcpReplies, adapterCalls, waitUntil, waitFor, done, children, dataDir, inputRoot};
}

test('auto Claude resolves generate before submission and binds the selected Base snapshot',async()=>{
  const t=setup();
  try{
    await t.bridge.connect();
    await t.bridge.send({text:'[Pankeki action: auto]\nGENERATE',projectId:'p',requestId:'auto-base',context:{sourceRevision:'rev'},automatic:require('./automatic-fixture.cjs')()});
    await t.done('auto-base');
    const call=t.adapterCalls().find(e=>e.name==='pankeki_generate_image');assert(call,'one automatic generation must execute');
    assert.equal(call.arguments.model_id,'sdxl-base');assert.equal(call.arguments.seed,42);assert.equal(call.arguments.width,832);
    const resolved=t.events.find(e=>e.type==='intent-resolved');assert.equal(resolved?.payload.intent,'generate');
    assert(t.events.indexOf(resolved)<t.events.findIndex(e=>e.type==='tool-started'&&e.payload.tool==='pankeki_generate'));
  }finally{await t.bridge.close();}
});

test('connect: claude.ai sign-in, isolated flags, no API key in the child, email never exposed', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-should-not-leak';
  const t = setup();
  try {
    const status = await t.bridge.connect();
    assert.equal(status.state, 'ready');
    assert.equal(status.provider, 'claude');
    assert.equal(status.authMode, 'claude');
    assert.equal(status.version, '2.1.310');
    assert.equal(status.toolsReady, true);
    assert.ok(!JSON.stringify(status).includes('example.com'));
    const starts = t.log().filter(e => e.argv);
    assert.deepEqual(starts.map(s => s.argv[0]), ['auth', '-p']);
    const argv = starts[1].argv;
    const after = flag => argv[argv.indexOf(flag) + 1];
    assert.equal(after('--tools'), '');
    assert.equal(after('--setting-sources'), '');
    assert.equal(after('--permission-mode'), 'dontAsk');
    assert.equal(after('--permission-prompts'), 'none');
    assert.equal(after('--allowedTools'), MODEL_TOOLS.join(','));
    for (const flag of ['--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence', '--no-chrome', '--system-prompt']) assert.ok(argv.includes(flag), flag);
    const config = after('--mcp-config');
    assert.equal(fs.statSync(config).mode & 0o777, 0o600);
    const server = JSON.parse(fs.readFileSync(config, 'utf8')).mcpServers;
    assert.deepEqual(Object.keys(server), ['pankeki']);
    assert.match(server.pankeki.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    for (const start of starts) assert.ok(!start.envKeys.includes('ANTHROPIC_API_KEY'));
    await t.bridge.close();
    assert.ok(!fs.existsSync(config), 'config with the token is removed on close');
  } finally {
    await t.bridge.close();
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved;
  }
});

for (const [auth, scenario, expected] of [['signed-out', 'ok', 'signed-out'], ['apikey', 'ok', 'error'], ['ok', 'commands', 'error']]) {
  test(`connect fails closed: auth=${auth} scenario=${scenario}`, async () => {
    const t = setup(scenario, {auth});
    const status = await t.bridge.connect();
    assert.equal(status.state, expected);
    assert.equal(status.toolsReady, false);
    await t.bridge.close();
  });
}

test('missing or nonexistent Claude reports missing', async () => {
  for (const claudePath of [null, '/nonexistent/claude']) {
    const bridge = createClaudeBridge({projectRoot, claudePath, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pankeki-claude-')), onEvent() {}});
    assert.equal((await bridge.connect()).state, 'missing');
    await bridge.close();
  }
});

for (const scenario of ['extra-tool', 'extra-mcp', 'apikey-source']) {
  test(`unisolated session init stops the turn before any tool or text: ${scenario}`, async () => {
    const t = setup(scenario);
    await t.bridge.connect();
    await t.bridge.send({text: 'STATUS', projectId: 'p1', requestId: 'r1'});
    const end = await t.done('r1');
    assert.equal(end.payload.status, 'failed');
    assert.ok(t.events.some(e => e.type === 'error' && e.payload.code === 'policy'));
    assert.ok(!t.events.some(e => ['tool-started', 'message', 'message-delta'].includes(e.type)));
    assert.equal(t.bridge.status().state, 'error');
    assert.equal(t.adapterCalls().length, 0);
    await t.bridge.close();
  });
}

test('model catalog selection changes only the session and preserves prior result provenance', async () => {
  const t = setup();
  try {
    await t.bridge.connect();
    assert.deepEqual((await t.bridge.getModels()).models.map(m => m.id), ['default', 'opus', 'sonnet']);
    await t.bridge.send({text: '[Pankeki action: generate]\nGENERATE', projectId: 'p1', requestId: 'before-model', context: {sourceRevision: 'rev1'}});
    await t.done('before-model');
    const query = {projectId: 'p1', requestId: 'before-model', jobId: JOB, sourceRevision: 'rev1'};
    const before = t.bridge.getSubmittedRequest(query);
    assert.ok(before);
    await t.bridge.setModel({modelId: 'opus'});
    assert.deepEqual(t.bridge.getSubmittedRequest(query), before);
    await t.bridge.send({text: 'hello', projectId: 'p1', requestId: 'after-model'});
    await t.done('after-model');
    const starts = t.log().filter(e => e.argv && e.argv[0] === '-p');
    assert.equal(starts.length, 2);
    assert.equal(starts[1].argv[starts[1].argv.indexOf('--model') + 1], 'opus');
    await assert.rejects(t.bridge.setModel({modelId: '--dangerously-skip-permissions'}), {code: 'invalid-input'});
    await assert.rejects(t.bridge.setModel({modelId: 'invented'}), {code: 'unknown-model'});
  } finally { await t.bridge.close(); }
});

test('older Claude without initialize models only exposes aliases present in its installed help', async () => {
  const t = setup('no-models');
  try {
    assert.equal((await t.bridge.connect()).state, 'ready');
    const catalog = await t.bridge.getModels();
    assert.equal(catalog.source, 'claude-help');
    assert.deepEqual(catalog.models.map(m => m.id), ['opus', 'sonnet']);
    assert.equal(t.bridge.status().version, '2.1.310');
    await assert.rejects(t.bridge.setModel({modelId: 'haiku'}), {code: 'unknown-model'});
    assert.equal(t.log().filter(e => e.received?.type === 'user').length, 0);
  } finally { await t.bridge.close(); }
});

test('Animagine Claude binds validated UI settings without replacing the model positive prompt',async()=>{
  const t=setup();
  try{
    await t.bridge.connect();
    const settings={mode:'txt2img',model_id:'animagine-xl-4.0-opt',prompt:'원문 소녀',negative:'custom negative',seed:42,width:832,height:1216,steps:28,cfg:5,sampler:'euler_ancestral',scheduler:'normal',cache:false,preview:false};
    await t.bridge.send({text:'[Pankeki action: generate]\n[Pankeki settings: '+JSON.stringify(settings)+']\nGENERATE',projectId:'p',requestId:'animagine-claude',context:{sourceRevision:'animagine-revision'}});
    settings.cfg=1;settings.negative='late UI';await t.done('animagine-claude');
    const args=t.adapterCalls().find(e=>e.name==='pankeki_generate_image').arguments;
    assert.deepEqual(args,{prompt:'cat girl',negative:'custom negative',model_id:'animagine-xl-4.0-opt',seed:42,width:832,height:1216,steps:28,cfg:5,sampler:'euler_ancestral',scheduler:'normal',cache:false,preview:false,trace_id:'animagine-claude'});
    assert.equal(t.events.filter(e=>e.type==='tool-completed'&&e.payload.resultId).length,1);
  }finally{await t.bridge.close();}
});

test('old Claude session events cannot contaminate the selected model and active changes are refused', async () => {
  const t = setup();
  try {
    await t.bridge.connect(); await t.bridge.getModels();
    const old = t.children.find(child => child.role === '-p').proc;
    await t.bridge.setModel({modelId: 'opus'});
    await t.bridge.send({text: 'SLOW', projectId: 'p1', requestId: 'selected-model'});
    await t.waitFor(e => e.type === 'message-delta' && e.requestId === 'selected-model');
    await assert.rejects(t.bridge.setModel({modelId: 'sonnet'}), {code: 'busy'});
    old.stdout.emit('data', JSON.stringify({type: 'assistant', message: {role: 'assistant', content: [{type: 'text', text: 'STALE-OLD-MODEL'}]}}) + '\n');
    assert.ok(!t.events.some(e => JSON.stringify(e.payload).includes('STALE-OLD-MODEL')));
    await t.bridge.cancel({requestId: 'selected-model'}); await t.done('selected-model');
  } finally { await t.bridge.close(); }
});

test('chat: deltas, message and completion carry request ids', async () => {
  const t = setup();
  await t.bridge.connect();
  await t.bridge.send({text: 'hello', projectId: 'p1', requestId: 'r1', context: {sourceRevision: 'rev1'}});
  const end = await t.done('r1');
  assert.equal(end.payload.status, 'completed');
  for (const type of ['turn-started', 'message-delta', 'message']) assert.ok(t.events.some(e => e.type === type && e.requestId === 'r1' && e.projectId === 'p1' && e.sourceRevision === 'rev1'), type);
  const sent = t.log().find(e => e.received && e.received.type === 'user').received.message.content;
  assert.match(sent,/^hello\n\n\[Pankeki\]/);assert.match(sent,/No image source is bound/);assert.equal(t.adapterCalls().filter(v=>/generate_image|edit_image/.test(v.name)).length,0);
  assert.equal(t.bridge.status().state, 'ready');
  await t.bridge.close();
});

test('status tool runs through the adapter; the model gets no paths, manifests or health', async () => {
  const t = setup();
  await t.bridge.connect();
  await t.bridge.send({text: 'STATUS', projectId: 'p1', requestId: 'r1'});
  await t.done('r1');
  const done = t.events.find(e => e.type === 'tool-completed');
  assert.deepEqual(done.payload, {tool: 'pankeki_status', ok: true, appReachable: true});
  const reply = JSON.stringify(t.mcpReplies()[0]);
  assert.ok(reply.includes('app_reachable'));
  for (const bad of ['/Users', 'manifest', 'health', 'e'.repeat(64)]) assert.ok(!reply.includes(bad), bad);
  await t.bridge.close();
});

test('generate: blocked for chat, allowed for generate with ledger and result descriptor', async () => {
  const t = setup();
  await t.bridge.connect();
  await t.bridge.send({text: '[Pankeki action: chat]\nGENERATE', projectId: 'p1', requestId: 'r1'});
  await t.done('r1');
  assert.equal(t.mcpReplies()[0].result.isError, true);
  assert.equal(t.adapterCalls().length, 0);
  await t.bridge.send({text: '[Pankeki action: generate]\nGENERATE', projectId: 'p1', requestId: 'r2', context: {sourceRevision: 'rev2'}});
  await t.done('r2');
  const result = t.events.find(e => e.type === 'tool-completed' && e.payload.tool === 'pankeki_result');
  assert.equal(result.payload.resultId, JOB);
  assert.equal(result.payload.previewUrl, 'http://127.0.0.1:8190/api/results/' + JOB);
  const query = {jobId: JOB, projectId: 'p1', requestId: 'r2', sourceRevision: 'rev2'};
  assert.equal(t.bridge.getSubmittedRequest(query).request.mode, 'txt2img');
  assert.equal(t.bridge.getResultDescriptor(query).state, 'succeeded');
  assert.equal(t.bridge.getResultDescriptor({...query, requestId: 'r1'}), null);
  assert.ok(!JSON.stringify(t.events).includes('/Users/'));
  await t.bridge.close();
});

test('edit: paths come only from resolveEditContext; path arguments and missing selection are refused', async () => {
  let t = setup('ok', {resolveEditContext: async () => {
    const dir = path.join(t.inputRoot, 'p1');
    fs.mkdirSync(dir, {recursive: true});
    for (const name of ['s.png', 'm.png']) fs.writeFileSync(path.join(dir, name), 'png');
    return {sourcePath: path.join(dir, 's.png'), maskPath: path.join(dir, 'm.png')};
  }});
  await t.bridge.connect();
  await t.bridge.send({text: '[Pankeki action: edit]\nEDIT', projectId: 'p1', requestId: 'r1', context: {contextId: 'c1', sourceRevision: 'rev1'}});
  await t.done('r1');
  const edit = t.adapterCalls().find(c => c.name === 'pankeki_edit_image');
  assert.ok(edit.arguments.source_path.endsWith(path.join('p1', 's.png')));
  await t.bridge.send({text: '[Pankeki action: edit]\nEDIT PATHARG', projectId: 'p1', requestId: 'r2', context: {contextId: 'c1', sourceRevision: 'rev1'}});
  await t.done('r2');
  assert.match(t.mcpReplies().at(-1).result.content[0].text, /Unexpected argument source_path/);
  await t.bridge.send({text: '[Pankeki action: edit]\nEDIT', projectId: 'p1', requestId: 'r3'});
  await t.done('r3');
  assert.ok(t.events.some(e => e.type === 'needs-input' && e.requestId === 'r3' && e.payload.reason === 'source'));
  assert.equal(t.adapterCalls().filter(c => c.name === 'pankeki_edit_image').length, 1);
  await t.bridge.close();
});

test('a tool call whose tool_use was never shown is refused; one that arrives early is matched', async () => {
  const t = setup();
  await t.bridge.connect();
  await t.bridge.send({text: 'SPOOF', projectId: 'p1', requestId: 'r1'});
  await t.done('r1');
  assert.equal(t.mcpReplies()[0].result.isError, true);
  assert.equal(t.adapterCalls().length, 0);
  await t.bridge.send({text: 'EARLY', projectId: 'p1', requestId: 'r2'});
  await t.done('r2');
  assert.equal(t.mcpReplies()[1].result.isError, undefined);
  await t.bridge.close();
});

test('forbidden built-in tool use is a policy error and interrupts the turn', async () => {
  const t = setup();
  await t.bridge.connect();
  await t.bridge.send({text: 'FORBIDDEN', projectId: 'p1', requestId: 'r1'});
  const end = await t.done('r1');
  assert.equal(end.payload.status, 'failed');
  assert.ok(t.events.some(e => e.type === 'error' && e.payload.code === 'policy'));
  assert.equal(t.events.filter(e => e.type === 'error' && e.requestId === 'r1').length, 1);
  assert.ok(t.log().some(e => e.received && e.received.type === 'control_request' && e.received.request.subtype === 'interrupt'));
  await t.bridge.close();
});

test('usage limit is reported as rate-limit with a retry time and no URL', async () => {
  const t = setup();
  await t.bridge.connect();
  await t.bridge.send({text: 'LIMIT', projectId: 'p1', requestId: 'r1'});
  const end = await t.done('r1');
  assert.equal(end.payload.status, 'failed');
  const error = t.events.find(e => e.type === 'error' && e.requestId === 'r1');
  assert.equal(error.payload.code, 'rate-limit');
  assert.match(error.payload.message, /^Claude usage limit reached\. Try again at [^.]+\.$/);
  assert.ok(!error.payload.message.includes('http'));
  await t.bridge.close();
});

test('cancel interrupts the running turn; the session stays usable for the next message', async () => {
  const t = setup();
  await t.bridge.connect();
  await t.bridge.send({text: 'SLOW', projectId: 'p1', requestId: 'r1'});
  await t.waitFor(e => e.type === 'message-delta');
  assert.equal(await t.bridge.cancel({requestId: 'r1'}), true);
  const end = await t.done('r1');
  assert.equal(end.payload.status, 'interrupted');
  await t.bridge.send({text: 'hello', projectId: 'p1', requestId: 'r2'});
  assert.equal((await t.done('r2')).payload.status, 'completed');
  assert.equal(t.log().filter(e => e.argv && e.argv[0] === '-p').length, 1, 'same CLI process');
  await t.bridge.close();
});

test('cancel logically cancels jobs started by the turn', async () => {
  const t = setup('cancel-after-submit');
  await t.bridge.connect();
  await t.bridge.send({text: '[Pankeki action: generate]\nGENERATE', projectId: 'p1', requestId: 'r1'});
  await t.waitFor(e => e.type === 'tool-completed' && e.payload.jobId === JOB);
  await t.bridge.cancel({requestId: 'r1'});
  assert.equal((await t.done('r1')).payload.status, 'interrupted');
  assert.ok(t.adapterCalls().some(c => c.name === 'pankeki_cancel_job'));
  await t.bridge.close();
});

test('cancel regression: a late job cancel never interrupts the next turn in the same session', async () => {
  const t = setup('cancel-race');
  const connected = await t.bridge.connect();
  assert.equal(connected.state, 'ready', JSON.stringify(connected));
  await t.bridge.send({text: '[Pankeki action: generate]\nGENERATE', projectId: 'p1', requestId: 'r1'});
  await t.waitUntil(() => t.log().some(e => e.waitingForFinish === 1));
  const cli = t.children.find(c => c.role === '-p').proc;
  const adapter = t.children.find(c => c.role === 'mcp').proc;
  adapter.stdout.pause();
  try {
    const cancel = t.bridge.cancel({requestId: 'r1'});
    await t.waitUntil(() => t.adapterCalls().some(c => c.name === 'pankeki_cancel_job'));
    cli.stdin.write(JSON.stringify({type: 'test-finish'}) + '\n');
    assert.equal((await t.done('r1')).payload.status, 'interrupted');
    await t.bridge.send({text: 'SLOW', projectId: 'p1', requestId: 'r2'});
    await t.waitUntil(() => t.log().some(e => e.waitingForFinish === 2));
    adapter.stdout.resume();
    assert.equal(await cancel, true);
    cli.stdin.write(JSON.stringify({type: 'test-finish'}) + '\n');
    assert.equal((await t.done('r2')).payload.status, 'completed');
    assert.equal(t.log().filter(e => e.received?.request?.subtype === 'interrupt').length, 0);
    assert.equal(t.children.filter(c => c.role === '-p').length, 1, 'normal result preserves the conversation');
    assert.equal(t.bridge.status().state, 'ready');
    await t.bridge.close();
    for (const id of ['r1', 'r2']) assert.equal(t.events.filter(e => e.type === 'turn-completed' && e.requestId === id).length, 1);
  } finally {
    adapter.stdout.resume();
    await t.bridge.close();
  }
});

for (const scenario of ['interrupt-timeout', 'interrupt-no-result']) {
  test(`cancel regression: ${scenario} ends once within the deadline and the next send starts a fresh session`, async () => {
    const t = setup(scenario, {timeouts: {request: 300, close: 100, turn: 5000}});
    const connected = await t.bridge.connect();
    assert.equal(connected.state, 'ready', JSON.stringify(connected));
    await t.bridge.send({text: 'SLOW', projectId: 'p1', requestId: 'r1'});
    await t.waitFor(e => e.type === 'message-delta' && e.requestId === 'r1');
    const oldCli = t.children.find(c => c.role === '-p').proc;
    assert.equal(await t.bridge.cancel({requestId: 'r1'}), true);
    const end = await t.waitFor(e => e.type === 'turn-completed' && e.requestId === 'r1', 1500);
    assert.equal(end.payload.status, 'interrupted');
    assert.equal(oldCli.signalCode, 'SIGKILL', 'the unresponsive old session was stopped within the close window');
    assert.equal(t.bridge.status().state, 'ready');
    assert.equal(t.bridge.status().activeRequestId, null);
    assert.equal(t.log().filter(e => e.interruptAcknowledged).length, scenario === 'interrupt-no-result' ? 1 : 0);
    await t.bridge.send({text: 'hello', projectId: 'p1', requestId: 'r2'});
    assert.equal((await t.done('r2')).payload.status, 'completed');
    assert.equal(t.children.filter(c => c.role === '-p').length, 2, 'forced stop starts a new conversation');
    await t.bridge.close();
    for (const id of ['r1', 'r2']) assert.equal(t.events.filter(e => e.type === 'turn-completed' && e.requestId === id).length, 1);
  });
}

test('a different project starts a fresh session', async () => {
  const t = setup();
  await t.bridge.connect();
  await t.bridge.send({text: 'hello', projectId: 'p1', requestId: 'r1'});
  await t.done('r1');
  await t.bridge.send({text: 'hello', projectId: 'p2', requestId: 'r2'});
  await t.done('r2');
  assert.equal(t.log().filter(e => e.argv && e.argv[0] === '-p').length, 2);
  await t.bridge.close();
});

test('CLI crash mid-turn ends the turn as failed and the next message restarts it', async () => {
  const t = setup();
  await t.bridge.connect();
  await t.bridge.send({text: 'CRASH', projectId: 'p1', requestId: 'r1'});
  assert.equal((await t.done('r1')).payload.status, 'failed');
  await t.bridge.send({text: 'hello', projectId: 'p1', requestId: 'r2'});
  assert.equal((await t.done('r2')).payload.status, 'completed');
  await t.bridge.close();
});

test('MCP endpoint rejects requests without the token', async () => {
  const t = setup();
  await t.bridge.connect();
  const argv = t.log().find(e => e.argv && e.argv[0] === '-p').argv;
  const {url} = JSON.parse(fs.readFileSync(argv[argv.indexOf('--mcp-config') + 1], 'utf8')).mcpServers.pankeki;
  const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list'})});
  assert.equal(response.status, 401);
  await t.bridge.close();
});

test('input validation and busy rejection', async () => {
  const t = setup();
  await t.bridge.connect();
  await assert.rejects(t.bridge.send({text: '', projectId: 'p1', requestId: 'r1'}), {code: 'invalid-input'});
  await assert.rejects(t.bridge.send({text: 'x', projectId: '../p', requestId: 'r1'}), {code: 'invalid-input'});
  await assert.rejects(t.bridge.send({text: 'x', projectId: 'p1', requestId: 'r1', context: {contextId: 'c1'}}), {code: 'invalid-input'});
  await t.bridge.send({text: 'SLOW', projectId: 'p1', requestId: 'r1'});
  await assert.rejects(t.bridge.send({text: 'x', projectId: 'p1', requestId: 'r2'}), {code: 'busy'});
  await t.bridge.cancel({requestId: 'r1'});
  await t.done('r1');
  await t.bridge.close();
});

test('invalid configuration is rejected', () => {
  assert.throws(() => createClaudeBridge({projectRoot: 'relative', onEvent() {}}), {code: 'invalid-config'});
  assert.throws(() => createClaudeBridge({projectRoot, onEvent() {}, pankekiBaseUrl: 'http://example.com'}), {code: 'invalid-config'});
});

test('pankeki_job waits on the bridge until the job finishes, so one poll is enough', async () => {
  const t = setup('slow-job', {timeouts: {jobPoll: 20}});
  await t.bridge.connect();
  await t.bridge.send({text: '[Pankeki action: generate]\nGENERATE', projectId: 'p1', requestId: 'r1'});
  await t.done('r1');
  const job = t.events.find(e => e.type === 'tool-completed' && e.payload.tool === 'pankeki_job');
  assert.equal(job.payload.jobStatus, 'succeeded');
  assert.equal(t.adapterCalls().filter(c => c.name === 'pankeki_get_job').length, 4);
  assert.ok(t.events.some(e => e.type === 'tool-completed' && e.payload.resultId === JOB));
  const argv = t.log().find(e => e.argv && e.argv[0] === '-p').argv;
  assert.match(argv[argv.indexOf('--system-prompt') + 1], /Keep calling it until the state is succeeded/);
  assert.match(argv[argv.indexOf('--system-prompt') + 1], /succeeded pankeki_result carries the result image/);
  assert.doesNotMatch(argv[argv.indexOf('--system-prompt') + 1], /You cannot see the images/);
  await t.bridge.close();
});

test('a canceled request stops the job wait at once', async () => {
  const t = setup('slow-job', {timeouts: {jobPoll: 300}});
  await t.bridge.connect();
  await t.bridge.send({text: '[Pankeki action: generate]\nGENERATE', projectId: 'p1', requestId: 'r1'});
  await t.waitFor(e => e.type === 'tool-started' && e.payload.tool === 'pankeki_job');
  await t.bridge.cancel({requestId: 'r1'});
  assert.equal((await t.done('r1')).payload.status, 'interrupted');
  assert.ok(t.adapterCalls().filter(c => c.name === 'pankeki_get_job').length < 4);
  await t.bridge.close();
});

test('a reply that ends before its job finishes is settled by the bridge: job waited, result fetched, then completed', async () => {
  const t = setup('slow-job', {timeouts: {jobPoll: 20}});
  await t.bridge.connect();
  await t.bridge.send({text: '[Pankeki action: generate]\nGIVEUP', projectId: 'p1', requestId: 'r1', context: {sourceRevision: 'rev1'}});
  const end = await t.done('r1');
  assert.equal(end.payload.status, 'completed');
  const order = t.events.filter(e => e.requestId === 'r1').map(e => e.type + (e.payload.tool ? ':' + e.payload.tool : ''));
  assert.ok(order.indexOf('tool-completed:pankeki_result') < order.indexOf('turn-completed'), order.join(' '));
  assert.ok(t.events.some(e => e.type === 'tool-completed' && e.payload.resultId === JOB));
  assert.equal(t.bridge.getResultDescriptor({jobId: JOB, projectId: 'p1', requestId: 'r1', sourceRevision: 'rev1'}).state, 'succeeded');
  assert.equal(t.bridge.status().state, 'ready');
  await t.bridge.close();
});

test('an orphaned cancel response is recorded without a ReferenceError in the shared tool runner', async () => {
  const logs = [];
  const mcpCommand = ({state}) => ({command: 'fake-mcp', args: ['--mcp', '--state', state], env: {FAKE_CANCEL_STATE: 'orphaned'}});
  const t = setup('slow-job', {timeouts: {jobPoll: 300}, mcpCommand, log: line => logs.push(String(line))});
  await t.bridge.connect();
  await t.bridge.send({text: '[Pankeki action: generate]\nGIVEUP', projectId: 'p1', requestId: 'r1'});
  await t.waitFor(e => e.type === 'tool-started' && e.payload.tool === 'pankeki_job');
  assert.equal(await t.bridge.cancel({requestId: 'r1'}), true);
  assert.equal((await t.done('r1')).payload.status, 'interrupted');
  assert.ok(t.adapterCalls().some(c => c.name === 'pankeki_cancel_job'));
  assert.deepEqual(logs.filter(line => line.includes('job cancel failed')), []);
  await t.bridge.close();
});

test('cancel while the bridge settles a job ends the turn as interrupted without a result or CLI interrupt', async () => {
  const t = setup('slow-job', {timeouts: {jobPoll: 300}});
  await t.bridge.connect();
  await t.bridge.send({text: '[Pankeki action: generate]\nGIVEUP', projectId: 'p1', requestId: 'r1'});
  await t.waitFor(e => e.type === 'tool-started' && e.payload.tool === 'pankeki_job');
  assert.equal(await t.bridge.cancel({requestId: 'r1'}), true);
  assert.equal((await t.done('r1')).payload.status, 'interrupted');
  assert.ok(!t.events.some(e => e.payload.resultId));
  assert.ok(t.adapterCalls().some(c => c.name === 'pankeki_cancel_job'));
  assert.ok(!t.log().some(e => e.received && e.received.type === 'control_request' && e.received.request.subtype === 'interrupt'));
  await t.bridge.send({text: 'hello', projectId: 'p1', requestId: 'r2'});
  assert.equal((await t.done('r2')).payload.status, 'completed');
  await t.bridge.close();
});

test('the model sees the selected source with the message and the verified result with pankeki_result', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const server = require('node:http').createServer((req, res) => {
    if (req.url !== '/api/results/' + JOB) { res.writeHead(404); return res.end(); }
    res.writeHead(200, {'content-type': 'image/png'}); res.end(png);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const t = setup('ok', {pankekiBaseUrl: 'http://127.0.0.1:' + server.address().port,
    resolveEditContext: async ({projectId}) => ({sourcePath: path.join(t.inputRoot, projectId, 'source.png')})});
  try {
    await t.bridge.connect();
    fs.mkdirSync(path.join(t.inputRoot, 'p1'), {recursive: true});
    fs.writeFileSync(path.join(t.inputRoot, 'p1', 'source.png'), png);
    await t.bridge.send({text: '[Pankeki action: generate]\nGENERATE', projectId: 'p1', requestId: 'vision-1', context: {contextId: 'ctx', sourceRevision: 'rev'}});
    await t.done('vision-1');
    const sent = t.log().find(e => e.received && e.received.type === 'user').received.message.content;
    assert.match(sent[0].text, /^\[Pankeki action: generate\]\nGENERATE\n\n\[Pankeki\]/);
    assert.deepEqual(sent[1], {type: 'image', source: {type: 'base64', media_type: 'image/png', data: png.toString('base64')}});
    assert.ok(!JSON.stringify(sent).includes(t.inputRoot), 'no path in the model message');
    const withImage = t.mcpReplies().filter(reply => reply.result.content.some(block => block.type === 'image'));
    assert.equal(withImage.length, 1, 'only the succeeded result carries pixels');
    assert.deepEqual(withImage[0].result.content[1], {type: 'image', data: png.toString('base64'), mimeType: 'image/png'});
  } finally { await t.bridge.close(); server.close(); }
});


test('Animagine pose policy reaches the real Claude CLI with original Korean and preserves the bound generation contract',async()=>{
 const t=setup(),korean='성인 여성 한 명이 정면으로 자연스럽게 서 있는 전신. 머리끝부터 신발 밑창까지 잘리지 않게 위아래 여백을 남겨줘.',negative='사용자 negative,  Keep CASE, bad hands';
 try{await t.bridge.connect();const settings={mode:'txt2img',model_id:'animagine-xl-4.0-opt',prompt:korean,negative,seed:42,width:832,height:1216,steps:28,cfg:5,sampler:'euler_ancestral',scheduler:'normal',cache:false,preview:false};await t.bridge.send({text:'[Pankeki action: generate]\n[Pankeki settings: '+JSON.stringify(settings)+']\n'+korean+'\nGENERATE',projectId:'pose-policy',requestId:'pose-policy',context:{sourceRevision:'pose-policy'}});await t.done('pose-policy');
  const invocation=t.log().find(row=>row.role==='claude'&&row.argv?.includes('--system-prompt'));assert(invocation);const policy=invocation.argv[invocation.argv.indexOf('--system-prompt')+1],shared=require('../pankeki-tools.cjs').INSTRUCTIONS;assert(policy.startsWith(shared));assert.match(policy,/Only for animagine-xl-4\.0-opt pankeki_generate, canonicalize explicitly requested pose and framing/);assert.match(policy,/looking at viewer only for an explicitly requested gaze/);assert.match(policy,/shoe soles.*full body, feet visible, uncropped/);assert(policy.includes('Translate compositional 여백/위아래 공간 as the requested margins/headroom'));assert(policy.includes('Preserve a genuinely requested cosmic/outer-space background.'));const turn=t.log().find(row=>row.role==='claude'&&row.received?.type==='user').received.message.content;assert.equal(typeof turn,'string');assert(turn.includes(korean),'the CLI receives the untouched Korean request');
  // GENERATE is the fake CLI control token; no Korean translation is simulated or claimed.
  const calls=t.adapterCalls().filter(row=>row.name==='pankeki_generate_image');assert.equal(calls.length,1);assert.deepEqual(calls[0].arguments,{prompt:'cat girl',negative,model_id:'animagine-xl-4.0-opt',seed:42,width:832,height:1216,steps:28,cfg:5,sampler:'euler_ancestral',scheduler:'normal',cache:false,preview:false,trace_id:'pose-policy'});
 }finally{await t.bridge.close();}
});

'use strict';
// node --test desktop/tests/codex-bridge.test.cjs
// Runs the bridge against codex-bridge-fake-server.cjs (fake app-server + fake
// Pankeki MCP adapter); no network, Codex account, GPU or real Pankeki server.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {createCodexBridge, DISABLED_FEATURES, TOOL_NAMES} = require('../codex-bridge.cjs');
const {INSTRUCTIONS: toolLayerInstructions} = require('../pankeki-tools.cjs');

const projectRoot = path.resolve(__dirname, '../..');
const fake = path.join(__dirname, 'codex-bridge-fake-server.cjs');
const opened = [];
test.after(async () => { for (const bridge of opened) await bridge.close(); });

function setup(scenario, extra = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pankeki-bridge-'));
  const inputRoot = path.join(dataDir, 'inputs');
  const logFile = path.join(dataDir, 'fake.log');
  const events = [];
  const env = {FAKE_SCENARIO: scenario, FAKE_LOG: logFile};
  const spawnImpl = (cmd, args, options) => spawn(process.execPath, [fake, ...args], {...options, env: {...options.env, ...env}});
  const mcpStateDir = path.join(dataDir, 'mcp-state');
  const mcpCommand = ({state}) => ({command: 'fake-mcp', args: ['--mcp', '--state', state], env: {}});
  const bridge = createCodexBridge({projectRoot, codexPath: '/fake/codex', dataDir, inputRoot, mcpStateDir, onEvent: e => events.push(e), spawnImpl, mcpCommand, ...extra});
  opened.push(bridge);
  const log = () => fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').map(JSON.parse) : [];
  const received = (role, method) => log().filter(e => e.role === role && e.received && e.received.method === method).map(e => e.received);
  const replies = () => log().filter(e => e.toolReply).map(e => e.toolReply);
  const waitFor = (predicate, ms = 5000) => new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => { const hit = events.find(predicate); if (hit) return resolve(hit); if (Date.now() - start > ms) return reject(new Error('timeout waiting for event')); setTimeout(tick, 10); };
    tick();
  });
  return {bridge, events, log, received, replies, waitFor, dataDir, inputRoot};
}

test('auto Codex resolves generate before submission and binds the selected Base snapshot',async()=>{
  const t=setup('generate');
  try{
    await t.bridge.connect();
    await t.bridge.send({text:'[Pankeki action: auto]\n고양이 소녀를 그려줘',projectId:'p',requestId:'auto-base',context:{sourceRevision:'rev'},automatic:require('./automatic-fixture.cjs')()});
    await t.waitFor(e=>e.type==='turn-completed');
    const call=t.received('mcp','tools/call').find(e=>e.params.name==='pankeki_generate_image');assert(call,'one automatic generation must execute');
    assert.equal(call.params.arguments.model_id,'sdxl-base');assert.equal(call.params.arguments.seed,42);assert.equal(call.params.arguments.width,832);
    const resolved=t.events.find(e=>e.type==='intent-resolved');assert.equal(resolved?.payload.intent,'generate');
    assert(t.events.indexOf(resolved)<t.events.findIndex(e=>e.type==='tool-started'&&e.payload.tool==='pankeki_generate'));
  }finally{await t.bridge.close();}
});

test('terminal result is delivered while the model keeps polling success without ending its turn', async () => {
  const t = setup('terminal-polling', {timeouts: {turn: 2000}});
  try {
    await t.bridge.connect();
    await t.bridge.getModels(); await t.bridge.setModel({modelId: 'picker-a'});
    await t.bridge.send({text: '[Pankeki action: generate]\none girl', projectId: 'p', requestId: 'terminal-live', context: {sourceRevision: 'rev'}});
    await t.waitFor(e => e.type === 'tool-completed' && e.payload.tool === 'pankeki_job' && e.payload.jobStatus === 'succeeded');
    const result = await t.waitFor(e => e.type === 'tool-completed' && e.payload.resultId, 250);
    assert.equal(result.requestId, 'terminal-live'); assert.equal(result.projectId, 'p'); assert.equal(result.sourceRevision, 'rev');
    assert.equal(t.events.filter(e => e.type === 'turn-completed').length, 0, 'collecting an image does not fake model completion');
    assert.equal(t.bridge.status().state, 'busy');
    await assert.rejects(t.bridge.send({text: 'next', projectId: 'other', requestId: 'next'}), {code: 'busy'});
    await assert.rejects(t.bridge.setModel({modelId: 'default'}), {code: 'busy'});
    await new Promise(resolve => setTimeout(resolve, 90));
    assert.ok(t.events.filter(e => e.type === 'tool-completed' && e.payload.tool === 'pankeki_job').length >= 3);
    assert.equal(t.events.filter(e => e.type === 'tool-completed' && e.payload.resultId).length, 1);
    assert.equal(t.received('mcp', 'tools/call').filter(e => e.params.name === 'pankeki_get_result').length, 1);
    assert.equal(t.received('codex', 'thread/start')[0].params.model, 'wire-a');
    assert.equal(t.received('codex', 'turn/start')[0].params.effort, 'low');
    assert.ok(!JSON.stringify(t.events).includes('/Users/'));
  } finally { await t.bridge.close(); }
});

for (const scenario of ['terminal-overlap', 'terminal-settle']) {
  test(`terminal result coalesces automatic, explicit and post-turn collection: ${scenario}`, async () => {
    const t = setup(scenario, {timeouts: {turn: 2000}});
    try {
      await t.bridge.connect();
      await t.bridge.send({text: '[Pankeki action: generate]\none girl', projectId: 'p', requestId: scenario});
      const done = await t.waitFor(e => e.type === 'turn-completed');
      assert.equal(done.payload.status, 'completed');
      const results = t.events.filter(e => e.type === 'tool-completed' && e.payload.resultId);
      assert.equal(results.length, 1); assert.ok(t.events.indexOf(results[0]) < t.events.indexOf(done));
      assert.equal(t.received('mcp', 'tools/call').filter(e => e.params.name === 'pankeki_get_result').length, 1);
      assert.equal(t.events.filter(e => e.type === 'turn-completed').length, 1);
      if (scenario === 'terminal-overlap') assert.ok(t.replies().every(reply => reply.success));
    } finally { await t.bridge.close(); }
  });
}

for (const action of ['cancel', 'timeout', 'close']) {
  test(`terminal result discards an in-flight collector on ${action}`, async () => {
    const t = setup('terminal-' + action, {timeouts: {turn: action === 'timeout' ? 80 : 2000}});
    try {
      await t.bridge.connect();
      await t.bridge.send({text: '[Pankeki action: generate]\none girl', projectId: 'old', requestId: 'terminal-old', context: {sourceRevision: 'old-rev'}});
      await t.waitFor(e => e.type === 'tool-started' && e.payload.tool === 'pankeki_result', 250);
      if (action === 'close') await t.bridge.close();
      else {
        if (action === 'cancel') assert.equal(await t.bridge.cancel({requestId: 'terminal-old'}), true);
        assert.equal((await t.waitFor(e => e.type === 'turn-completed' && e.requestId === 'terminal-old')).payload.status, 'interrupted');
        await t.bridge.send({text: 'healthy', projectId: 'new', requestId: 'terminal-new', context: {sourceRevision: 'new-rev'}});
        await t.waitFor(e => e.type === 'turn-completed' && e.requestId === 'terminal-new');
      }
      await new Promise(resolve => setTimeout(resolve, 220));
      assert.equal(t.events.filter(e => e.type === 'tool-completed' && e.payload.resultId).length, 0);
      assert.equal(t.events.filter(e => e.type === 'turn-completed' && e.requestId === 'terminal-old').length, 1);
      assert.equal(t.bridge.getResultDescriptor({jobId: 'a'.repeat(32), projectId: 'old', requestId: 'terminal-old', sourceRevision: 'old-rev'}), null);
      if (action === 'timeout') assert.equal(t.events.filter(e => e.type === 'error' && e.payload.code === 'timeout').length, 1);
    } finally { await t.bridge.close(); }
  });
}

for (const scenario of ['terminal-failed', 'terminal-canceled', 'terminal-uncertain', 'terminal-wrong-job', 'terminal-result-error', 'terminal-result-wrong-job', 'terminal-result-uncertain']) {
  test(`terminal result never promotes ${scenario} to an artifact`, async () => {
    const t = setup(scenario, {timeouts: {jobPoll: 5, turn: 1500}});
    try {
      await t.bridge.connect();
      await t.bridge.send({text: '[Pankeki action: generate]\none girl', projectId: 'p', requestId: scenario});
      const done = await t.waitFor(e => e.type === 'turn-completed');
      assert.equal(t.events.filter(e => e.type === 'tool-completed' && e.payload.resultId).length, 0);
      if (scenario.includes('result-')) {
        assert.equal(done.payload.status, 'failed');
        assert.ok(t.events.some(e => e.type === 'error'));
        assert.equal(t.received('mcp', 'tools/call').filter(e => e.params.name === 'pankeki_get_result').length, 1, 'failed collection is not silently retried');
      }
    } finally { await t.bridge.close(); }
  });
}

test('terminal result does not publish another request job during a chat-only read', async () => {
  const t = setup('terminal-foreign');
  try {
    await t.bridge.connect();
    await t.bridge.send({text: '[Pankeki action: generate]\none girl', projectId: 'p', requestId: 'owner', context: {sourceRevision: 'old'}});
    await t.waitFor(e => e.type === 'turn-completed' && e.requestId === 'owner');
    await t.bridge.send({text: '[Pankeki action: chat]\nold job status', projectId: 'p', requestId: 'reader', context: {sourceRevision: 'new'}});
    await t.waitFor(e => e.type === 'turn-completed' && e.requestId === 'reader');
    assert.ok(t.events.some(e => e.requestId === 'reader' && e.payload.tool === 'pankeki_job' && e.payload.jobStatus === 'succeeded'));
    assert.equal(t.events.filter(e => e.type === 'tool-completed' && e.payload.resultId).length, 0);
    assert.equal(t.bridge.getResultDescriptor({jobId: 'a'.repeat(32), projectId: 'p', requestId: 'reader', sourceRevision: 'new'}), null);
  } finally { await t.bridge.close(); }
});

test('post-turn settle collects a slow owned image once before completion and stays busy meanwhile', async () => {
  const t = setup('settle-slow', {timeouts: {jobPoll: 10, turn: 1500}});
  try {
    await t.bridge.connect();
    await t.bridge.getModels(); await t.bridge.setModel({modelId: 'picker-a'});
    await t.bridge.send({text: '[Pankeki action: generate]\none girl', projectId: 'settle-project', requestId: 'settle-1', context: {sourceRevision: 'revision-1'}});
    await t.waitFor(e => e.type === 'message' && e.requestId === 'settle-1');
    assert.equal(t.bridge.status().state, 'busy');
    assert.equal(t.events.filter(e => e.type === 'turn-completed').length, 0);
    await assert.rejects(t.bridge.setModel({modelId: 'default'}), {code: 'busy'});
    const {createProviderBridge} = require('../chat-providers.cjs');
    const providers = createProviderBridge({onEvent() {}, factories: {codex: () => t.bridge, claude: () => ({status: () => ({state: 'idle'}), protocolVersion: 2})}});
    assert.throws(() => providers.select({provider: 'claude'}), {code: 'busy'});
    await assert.rejects(providers.setChatModel({provider: 'codex', modelId: 'default'}), {code: 'busy'});
    await assert.rejects(t.bridge.send({text: 'next', projectId: 'other-project', requestId: 'blocked'}), {code: 'busy'});
    const done = await t.waitFor(e => e.type === 'turn-completed' && e.requestId === 'settle-1');
    assert.equal(done.payload.status, 'completed');
    const results = t.events.filter(e => e.type === 'tool-completed' && e.payload.tool === 'pankeki_result' && e.payload.ok);
    assert.equal(results.length, 1);
    assert.equal(results[0].requestId, 'settle-1'); assert.equal(results[0].projectId, 'settle-project'); assert.equal(results[0].sourceRevision, 'revision-1');
    assert.ok(t.events.indexOf(results[0]) < t.events.indexOf(done));
    assert.equal(t.events.filter(e => e.type === 'turn-completed').length, 1);
    assert.equal(t.received('mcp', 'tools/call').filter(e => e.params.name === 'pankeki_get_result').length, 1);
    assert.equal(t.bridge.status().state, 'ready');
    assert.equal(t.received('codex', 'thread/start')[0].params.model, 'wire-a');
    assert.equal(t.received('codex', 'turn/start')[0].params.effort, 'low');
    await t.bridge.send({text: 'healthy', projectId: 'other-project', requestId: 'healthy-next'});
    await t.waitFor(e => e.type === 'turn-completed' && e.requestId === 'healthy-next');
    assert.ok(!t.events.some(e => JSON.stringify(e.payload).includes('/Users/')));
  } finally { await t.bridge.close(); }
});

test('post-turn settle skips a result already collected by the model', async () => {
  const t = setup('settle-already-result', {timeouts: {jobPoll: 10, turn: 1500}});
  try {
    await t.bridge.connect();
    await t.bridge.send({text: '[Pankeki action: generate]\none girl', projectId: 'p', requestId: 'already'});
    await t.waitFor(e => e.type === 'turn-completed' && e.requestId === 'already');
    assert.equal(t.received('mcp', 'tools/call').filter(e => e.params.name === 'pankeki_get_result').length, 1);
    assert.equal(t.events.filter(e => e.type === 'tool-completed' && e.payload.resultId).length, 1);
  } finally { await t.bridge.close(); }
});

test('Animagine Codex snapshot binds the actual model settings while preserving the translated positive prompt',async()=>{
  const t=setup('animagine');
  try{
    await t.bridge.connect();
    const settings={mode:'txt2img',model_id:'animagine-xl-4.0-opt',prompt:'한 명 빨간 목도리',negative:'custom negative',seed:42,width:832,height:1216,steps:28,cfg:5,sampler:'euler_ancestral',scheduler:'normal',cache:false,preview:false};
    await t.bridge.send({text:'[Pankeki action: generate]\n[Pankeki settings: '+JSON.stringify(settings)+']\n한 명 빨간 목도리',projectId:'p',requestId:'animagine',context:{sourceRevision:'new-model-revision'}});
    settings.seed=999;settings.negative='late UI change';
    await t.waitFor(e=>e.type==='turn-completed'&&e.requestId==='animagine');
    const args=t.received('mcp','tools/call').find(e=>e.params.name==='pankeki_generate_image').params.arguments;
    assert.deepEqual(args,{prompt:'cat girl',negative:'custom negative',model_id:'animagine-xl-4.0-opt',seed:42,width:832,height:1216,steps:28,cfg:5,sampler:'euler_ancestral',scheduler:'normal',cache:false,preview:false,trace_id:'animagine'});
    const submitted=t.bridge.getSubmittedRequest({jobId:'a'.repeat(32),projectId:'p',requestId:'animagine',sourceRevision:'new-model-revision'});
    assert.equal(submitted.request.model_id,'animagine-xl-4.0-opt');assert.equal(submitted.request.sampler,'euler_ancestral');
    assert.equal(t.events.filter(e=>e.type==='tool-completed'&&e.payload.resultId).length,1);
  }finally{await t.bridge.close();}
});

for (const scenario of ['settle-delayed-poll', 'settle-delayed-result']) {
  test(`post-turn settle cancellation discards late ${scenario} across a new project and revision`, async () => {
    const t = setup(scenario, {timeouts: {jobPoll: 5, turn: 1500}});
    try {
      await t.bridge.connect();
      await t.bridge.send({text: '[Pankeki action: generate]\none girl', projectId: 'old-project', requestId: 'old-settle', context: {sourceRevision: 'old-revision'}});
      const waitingTool = scenario === 'settle-delayed-result' ? 'pankeki_result' : 'pankeki_job';
      await t.waitFor(e => e.requestId === 'old-settle' && e.type === 'tool-started' && e.payload.tool === waitingTool);
      assert.equal(t.bridge.status().state, 'busy');
      assert.equal(await t.bridge.cancel({requestId: 'old-settle'}), true);
      const done = await t.waitFor(e => e.type === 'turn-completed' && e.requestId === 'old-settle');
      assert.equal(done.payload.status, 'interrupted');
      assert.equal(t.received('codex', 'turn/interrupt').length, 0);
      assert.equal(t.received('mcp', 'tools/call').filter(e => e.params.name === 'pankeki_cancel_job').length, scenario === 'settle-delayed-result' ? 0 : 1,
        'an already succeeded backend job needs no cancel; its late result is still discarded');
      await t.bridge.send({text: 'healthy', projectId: 'new-project', requestId: 'new-settle', context: {sourceRevision: 'new-revision'}});
      await t.waitFor(e => e.type === 'turn-completed' && e.requestId === 'new-settle');
      await new Promise(resolve => setTimeout(resolve, 220));
      assert.equal(t.events.filter(e => e.type === 'turn-completed' && e.requestId === 'old-settle').length, 1);
      assert.ok(!t.events.some(e => e.type === 'tool-completed' && e.payload.resultId));
      assert.equal(t.bridge.getResultDescriptor({jobId: 'a'.repeat(32), projectId: 'old-project', requestId: 'old-settle', sourceRevision: 'old-revision'}), null);
      assert.equal(t.bridge.getResultDescriptor({jobId: 'a'.repeat(32), projectId: 'new-project', requestId: 'new-settle', sourceRevision: 'new-revision'}), null);
      assert.equal(t.bridge.status().state, 'ready');
    } finally { await t.bridge.close(); }
  });
}

test('post-turn settle timeout uses the original deadline and cancels only its owned job locally', async () => {
  const t = setup('settle-timeout', {timeouts: {jobPoll: 5, turn: 80}});
  try {
    await t.bridge.connect();
    const start = Date.now();
    await t.bridge.send({text: '[Pankeki action: generate]\none girl', projectId: 'p', requestId: 'settle-timeout'});
    const done = await t.waitFor(e => e.type === 'turn-completed' && e.requestId === 'settle-timeout');
    assert.equal(done.payload.status, 'interrupted'); assert.ok(Date.now() - start < 1000);
    assert.equal(t.events.filter(e => e.type === 'error' && e.payload.code === 'timeout').length, 1);
    assert.equal(t.received('codex', 'turn/interrupt').length, 0);
    assert.deepEqual(t.received('mcp', 'tools/call').filter(e => e.params.name === 'pankeki_cancel_job').map(e => e.params.arguments), [{job_id: 'a'.repeat(32)}]);
    assert.ok(!t.events.some(e => e.type === 'tool-completed' && e.payload.resultId));
    await t.bridge.send({text: 'healthy', projectId: 'p', requestId: 'after-timeout'});
    await t.waitFor(e => e.type === 'turn-completed' && e.requestId === 'after-timeout');
  } finally { await t.bridge.close(); }
});

test('an orphaned cancel response is recorded without a ReferenceError in adapterCancel', async () => {
  const logs = [];
  const mcpCommand = ({state}) => ({command: 'fake-mcp', args: ['--mcp', '--state', state], env: {FAKE_CANCEL_STATE: 'orphaned'}});
  const t = setup('settle-timeout', {timeouts: {jobPoll: 5, turn: 80}, mcpCommand, log: line => logs.push(String(line))});
  try {
    await t.bridge.connect();
    await t.bridge.send({text: '[Pankeki action: generate]\none girl', projectId: 'p', requestId: 'orphan-cancel'});
    await t.waitFor(e => e.type === 'turn-completed' && e.requestId === 'orphan-cancel');
    assert.equal(t.received('mcp', 'tools/call').filter(e => e.params.name === 'pankeki_cancel_job').length, 1);
    assert.deepEqual(logs.filter(line => line.includes('job cancel failed')), []);
  } finally { await t.bridge.close(); }
});

test('post-turn settle close disposes the wait and never delivers a late artifact', async () => {
  const t = setup('settle-close', {timeouts: {jobPoll: 1000, turn: 2000}});
  try {
    await t.bridge.connect();
    await t.bridge.send({text: '[Pankeki action: generate]\none girl', projectId: 'p', requestId: 'settle-close'});
    await t.waitFor(e => e.type === 'tool-started' && e.payload.tool === 'pankeki_job');
    const start = Date.now(); await t.bridge.close();
    assert.ok(Date.now() - start < 700, 'close wakes the pending poll sleep');
    assert.equal(t.events.filter(e => e.type === 'turn-completed' && e.requestId === 'settle-close').length, 1);
    assert.ok(!t.events.some(e => e.type === 'tool-completed' && e.payload.resultId));
    assert.equal(t.received('mcp', 'tools/call').filter(e => e.params.name === 'pankeki_cancel_job').length, 1);
  } finally { await t.bridge.close(); }
});

for (const scenario of ['settle-failed', 'settle-canceled', 'settle-uncertain', 'settle-result-error', 'settle-wrong-job']) {
  test(`post-turn settle never promotes ${scenario} to an image artifact`, async () => {
    const t = setup(scenario, {timeouts: {jobPoll: 5, turn: 1500}});
    try {
      await t.bridge.connect();
      await t.bridge.send({text: '[Pankeki action: generate]\none girl', projectId: 'p', requestId: scenario});
      assert.equal((await t.waitFor(e => e.type === 'turn-completed' && e.requestId === scenario)).payload.status, 'failed');
      assert.ok(t.events.some(e => e.type === 'error' && e.requestId === scenario));
      assert.ok(!t.events.some(e => e.type === 'tool-completed' && e.payload.resultId));
      assert.equal(t.bridge.status().state, 'ready');
      await t.bridge.send({text: 'healthy', projectId: 'p', requestId: 'after-' + scenario});
      await t.waitFor(e => e.type === 'turn-completed' && e.requestId === 'after-' + scenario);
    } finally { await t.bridge.close(); }
  });
}

test('post-turn settle does not start after a failed model turn', async () => {
  const t = setup('settle-turn-failed', {timeouts: {jobPoll: 5, turn: 1500}});
  try {
    await t.bridge.connect();
    await t.bridge.send({text: '[Pankeki action: generate]\none girl', projectId: 'p', requestId: 'model-failed'});
    assert.equal((await t.waitFor(e => e.type === 'turn-completed')).payload.status, 'failed');
    assert.equal(t.received('mcp', 'tools/call').filter(e => e.params.name === 'pankeki_get_result').length, 0);
  } finally { await t.bridge.close(); }
});

test('post-turn settle waits for an overlapping model result tool and never fetches it twice', async () => {
  const t = setup('settle-overlap-result', {timeouts: {jobPoll: 5, turn: 1500}});
  try {
    await t.bridge.connect();
    await t.bridge.send({text: '[Pankeki action: generate]\none girl', projectId: 'p', requestId: 'overlap'});
    const done = await t.waitFor(e => e.type === 'turn-completed');
    const results = t.events.filter(e => e.type === 'tool-completed' && e.payload.resultId);
    assert.equal(results.length, 1); assert.ok(t.events.indexOf(results[0]) < t.events.indexOf(done));
    assert.equal(t.received('mcp', 'tools/call').filter(e => e.params.name === 'pankeki_get_result').length, 1);
  } finally { await t.bridge.close(); }
});

test('connect: ChatGPT sign-in, no MCP servers, isolation verified, user skills disabled by restart', async () => {
  const saved = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-should-not-leak';
  const t = setup('ok');
  try {
    const status = await t.bridge.connect();
    assert.equal(status.state, 'ready');
    assert.equal(status.authMode, 'chatgpt');
    assert.equal(status.codexVersion, '0.164.0');
    assert.equal(status.toolsReady, true);
    assert.ok(!JSON.stringify(status).includes('example.com'), 'account email is not exposed');
    const starts = t.log().filter(e => e.role === 'codex' && e.argv);
    assert.equal(starts.length, 2);
    const joined = starts[1].argv.join(' ');
    for (const feature of DISABLED_FEATURES) assert.ok(starts[1].argv.includes(feature), feature);
    assert.ok(!joined.includes('code_mode_host'));
    for (const pattern of [/approval_policy="never"/, /sandbox_mode="read-only"/, /web_search="disabled"/, /mcp_servers\.node_repl\.enabled=false/,
      /mcp_servers\.pankeki-local\.enabled=false/, /skills\.bundled\.enabled=false/, /skills\.config=\[\{"name"="user-skill","enabled"=false\}\]/]) assert.match(joined, pattern);
    assert.ok(!/mcp_servers\.[a-z_]+=\{/.test(joined), 'no MCP server is added to the child');
    for (const start of starts) assert.ok(!start.envKeys.includes('OPENAI_API_KEY'));
    assert.equal(t.received('codex', 'initialize')[0].params.capabilities.experimentalApi, true);
  } finally {
    await t.bridge.close();
    if (saved === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved;
  }
});

for (const [scenario, expected] of [['signed-out', 'signed-out'], ['apikey', 'error'], ['extra-mcp', 'error'], ['hooks', 'error']]) {
  test(`connect fails closed: ${scenario}`, async () => {
    const t = setup(scenario);
    const status = await t.bridge.connect();
    assert.equal(status.state, expected);
    assert.equal(status.toolsReady, false);
    assert.equal(t.received('codex', 'thread/start').length, 0);
    await t.bridge.close();
  });
}

test('missing or nonexistent Codex reports missing', async () => {
  for (const codexPath of [null, '/nonexistent/codex']) {
    const bridge = createCodexBridge({projectRoot, codexPath, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pankeki-bridge-')), onEvent() {}});
    assert.equal((await bridge.connect()).state, 'missing');
    await bridge.close();
  }
});

test('send: dynamic tools declared, status tool runs through the adapter, events carry ids', async () => {
  const t = setup('ok');
  await t.bridge.connect();
  await t.bridge.send({text: '상태 알려줘', projectId: 'proj-1', requestId: 'req-1'});
  await t.waitFor(e => e.type === 'turn-completed');
  const start = t.received('codex', 'thread/start')[0].params;
  assert.deepEqual(start.dynamicTools.map(d => d.name), TOOL_NAMES);
  for (const tool of start.dynamicTools) assert.ok(!JSON.stringify(tool.inputSchema).match(/path/), tool.name + ' has no path arguments');
  assert.deepEqual([start.approvalPolicy, start.sandbox, start.ephemeral], ['never', 'read-only', true]);
  const types = t.events.filter(e => e.requestId === 'req-1').map(e => e.type);
  for (const type of ['turn-started', 'tool-started', 'tool-completed', 'message-delta', 'message', 'turn-completed']) assert.ok(types.includes(type), type);
  assert.equal(types.filter(type => type === 'turn-started').length, 1);
  assert.deepEqual(t.replies()[0].success, true);
  const reply = JSON.parse(t.replies()[0].contentItems[0].text);
  assert.deepEqual(reply, {app_reachable: true, models: {'sdxl-base': {available: true}}}, 'status reply is minimal: no paths, manifests or health');
  const input = t.received('codex', 'turn/start')[0].params.input[0].text;
  assert.match(input,/No image source is bound/);assert.equal(t.received('mcp','tools/call').filter(v=>/generate_image|edit_image/.test(v.params.name)).length,0);
  assert.equal(t.received('mcp', 'tools/call')[0].params.name, 'pankeki_get_status');
  await t.bridge.close();
});

test('catalog model selection reaches thread model and supported default effort and starts a fresh conversation', async () => {
  const t = setup('ok');
  try {
    await t.bridge.connect();
    const catalog = await t.bridge.getModels();
    assert.equal(catalog.models[0].id, 'picker-a');
    await t.bridge.setModel({modelId: 'picker-a'});
    await t.bridge.send({text: 'hello', projectId: 'p', requestId: 'model-1'});
    await t.waitFor(e => e.type === 'turn-completed' && e.requestId === 'model-1');
    assert.equal(t.received('codex', 'thread/start')[0].params.model, 'wire-a');
    assert.equal(t.received('codex', 'turn/start')[0].params.effort, 'low');
    await assert.rejects(t.bridge.setModel({modelId: 'invented'}), {code: 'unknown-model'});
    await t.bridge.setModel({modelId: 'default'});
    await t.bridge.send({text: 'hello', projectId: 'p', requestId: 'model-2'});
    await t.waitFor(e => e.type === 'turn-completed' && e.requestId === 'model-2');
    assert.equal(t.received('codex', 'thread/start').length, 2);
    assert.equal(t.received('codex', 'thread/start')[1].params.model, undefined);
    assert.equal(t.received('codex', 'turn/start')[1].params.effort, undefined);
  } finally { await t.bridge.close(); }
});

test('model catalogs are bounded paginated and do not create a thread or model turn', async () => {
  const t = setup('model-pagination');
  try {
    await t.bridge.connect();
    assert.equal((await t.bridge.getModels()).models.length, 100);
    assert.equal(t.received('codex', 'model/list').length, 4);
    assert.equal(t.received('codex', 'thread/start').length, 0);
    assert.equal(t.received('codex', 'turn/start').length, 0);
  } finally { await t.bridge.close(); }
});

test('invalid effort metadata and repeated pagination cursors cannot become model choices', async () => {
  for (const scenario of ['bad-effort', 'bad-cursor']) {
    const t = setup(scenario);
    try {
      await t.bridge.connect();
      if (scenario === 'bad-cursor') await assert.rejects(t.bridge.getModels(), {code: 'model-list-failed'});
      else assert.deepEqual((await t.bridge.getModels()).models, []);
      await assert.rejects(t.bridge.setModel({modelId: 'picker-a'}), {code: 'unknown-model'});
      assert.equal(t.received('codex', 'turn/start').length, 0);
    } finally { await t.bridge.close(); }
  }
});

test('thread RPC receives meaning-preserving SDXL prompt and image-evidence instructions for both tool layers', async () => {
  const t = setup('ok');
  try {
    await t.bridge.connect();
    await t.bridge.send({text:'[Pankeki action: chat]\nCheck availability only.',projectId:'prompt-policy',requestId:'prompt-policy-1'});
    await t.waitFor(e=>e.type==='turn-completed');
    const instructions=t.received('codex','thread/start')[0].params.developerInstructions;
    assert.equal(instructions,toolLayerInstructions,'Codex RPC and shared Claude tool policy stay aligned');
    assert.match(instructions,/positive prompts into clear English when needed/i);
    assert.match(instructions,/preserv.*colors, props, singular\/plural object counts, composition, and explicitly selected settings/i);
    assert.match(instructions,/do not invent character styles, palettes, setting sheets, extra people or props/i);
    assert.match(instructions,/succeeded pankeki_result carries the result image\. Look at it before replying/i);
    assert.match(instructions,/if it clearly is not.*say what differs.*instead of claiming success/i);
    assert.match(instructions,/If no image is attached, you have not seen the result.*inspect it in the app/i);
    assert.match(instructions,/reply in the user's language/i);
  } finally { await t.bridge.close(); }
});

test('generate: job ledger, result descriptor, no local paths to the model or events', async () => {
  const t = setup('generate');
  await t.bridge.connect();
  const rev = 'revA_mask3_projp';
  await t.bridge.send({text: '[Pankeki action: generate]\n[Pankeki settings: {"seed":7}]\n고양이 소녀', projectId: 'p', requestId: 'g1', context: {sourceRevision: rev}});
  await t.waitFor(e => e.type === 'turn-completed');
  const done = t.events.filter(e => e.type === 'tool-completed').map(e => e.payload);
  assert.equal(done[0].jobId, 'a'.repeat(32));
  assert.equal(done[0].jobStatus, 'queued');
  assert.equal(done[1].jobStatus, 'succeeded', 'job state comes from data.state');
  assert.equal(done[1].resultId, undefined, 'resultId only after pankeki_result');
  assert.equal(done[2].resultId, 'a'.repeat(32));
  assert.equal(done[2].jobStatus, 'succeeded');
  assert.equal(done[2].previewUrl, 'http://127.0.0.1:8190/api/results/' + 'a'.repeat(32));
  assert.equal(done.find(e => e.tool === 'pankeki_job' && e.ok === false).ok, false, 'jobs from outside this conversation are refused');
  assert.equal(done.filter(e => e.resultId).length, 1, 'explicit result reuses the automatic collection without republishing');
  assert.equal(t.received('mcp', 'tools/call').length, 3, 'unknown job never reaches the adapter');
  for (const e of t.events.filter(e => e.requestId)) assert.equal(e.sourceRevision, rev);
  const everything = JSON.stringify(t.events) + JSON.stringify(t.replies());
  for (const secret of ['/Users/someone', 'request_path', 'provenance', 'manifest', 'b'.repeat(64)]) assert.ok(!everything.includes(secret), 'model/events never see ' + secret);
  assert.deepEqual(JSON.parse(t.replies()[2].contentItems[0].text), {job_id: 'a'.repeat(32), state: 'succeeded', dimensions: [768, 1024]});
  const query = {jobId: 'a'.repeat(32), projectId: 'p', requestId: 'g1', sourceRevision: rev};
  const submitted = t.bridge.getSubmittedRequest(query);
  assert.deepEqual({mode: submitted.request.mode, prompt: submitted.request.prompt, seed: submitted.request.seed, width: submitted.request.width}, {mode: 'txt2img', prompt: 'cat girl', seed: 7, width: 1024});
  for (const mismatch of [{sourceRevision: 'other'}, {requestId: 'g2'}, {projectId: 'q'}]) assert.equal(t.bridge.getSubmittedRequest({...query, ...mismatch}), null);
  const descriptor = t.bridge.getResultDescriptor(query);
  assert.equal(descriptor.state, 'succeeded');
  assert.equal(descriptor.requestId, 'g1');
  assert.equal(descriptor.request.mode, 'txt2img');
  assert.deepEqual(descriptor.metrics, {width: 768, height: 1024, elapsed_s: 3.5});
  assert.equal(t.bridge.getResultDescriptor({...query, requestId: 'x'}), null);
  await t.bridge.close();
});

test('edit: paths come only from resolveEditContext, model path arguments are rejected', async () => {
  let calls = 0;
  const t = setup('edit', {resolveEditContext: async ({projectId, contextId, sourceRevision}) => {
    calls++;
    assert.deepEqual([projectId, contextId, sourceRevision], ['p', 'ctx-9', 'rev-9']);
    const dir = path.join(t.inputRoot, 'p');
    return {sourcePath: path.join(dir, 'source.png'), maskPath: path.join(dir, 'mask.png')};
  }});
  await t.bridge.connect();
  fs.mkdirSync(path.join(t.inputRoot, 'p'), {recursive: true});
  fs.writeFileSync(path.join(t.inputRoot, 'p', 'source.png'), 'x');
  fs.writeFileSync(path.join(t.inputRoot, 'p', 'mask.png'), 'x');
  await t.bridge.send({text: '[Pankeki action: edit]\n빨갛게', projectId: 'p', requestId: 'e1', context: {contextId: 'ctx-9', sourceRevision: 'rev-9'}});
  await t.waitFor(e => e.type === 'turn-completed');
  const [rejected, accepted] = t.replies();
  assert.equal(rejected.success, false, 'source_path argument from the model is refused');
  assert.equal(accepted.success, true);
  assert.equal(calls, 2, 'once to show the source to the model, once for the edit');
  assert.equal(t.received('codex', 'turn/start')[0].params.input.length, 1, 'a file that is not a PNG is never shown to the model');
  const call = t.received('mcp', 'tools/call')[0].params;
  assert.equal(call.name, 'pankeki_edit_image');
  assert.equal(call.arguments.source_path, fs.realpathSync(path.join(t.inputRoot, 'p', 'source.png')));
  assert.ok(!t.received('codex', 'turn/start')[0].params.input[0].text.includes(t.inputRoot), 'no path in the model message');
  const submitted = t.bridge.getSubmittedRequest({jobId: 'a'.repeat(32), projectId: 'p', requestId: 'e1', sourceRevision: 'rev-9'});
  assert.equal(submitted.request.mode, 'inpaint');
  assert.equal(submitted.request.edit_operation, 'recolor');
  assert.ok(!('source' in submitted.request) && !('mask' in submitted.request), 'image data is not kept');
  await t.bridge.close();
});

test('edit without selection or with files outside inputs/<project> raises needs-input and submits nothing', async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pankeki-outside-'));
  fs.writeFileSync(path.join(outside, 'a.png'), 'x');
  for (const context of [undefined, {contextId: 'c', sourceRevision: 'r'}]) {
    const t = setup('edit-missing', {resolveEditContext: async () => ({sourcePath: path.join(outside, 'a.png'), maskPath: path.join(outside, 'a.png')})});
    await t.bridge.connect();
    await t.bridge.send({text: '[Pankeki action: edit]\n수정', projectId: 'p', requestId: 'm1', context});
    await t.waitFor(e => e.type === 'turn-completed');
    assert.ok(t.events.some(e => e.type === 'needs-input'));
    assert.equal(t.received('mcp', 'tools/call').length, 0, 'no edit job without a valid selection');
    await t.bridge.close();
  }
});

test('unknown dynamic tool is a policy violation', async () => {
  const t = setup('bad-tool');
  await t.bridge.connect();
  await t.bridge.send({text: 'ls', projectId: 'p', requestId: 'b1'});
  await t.waitFor(e => e.type === 'error' && e.payload.code === 'policy');
  assert.equal(t.replies()[0].success, false);
  await t.bridge.close();
});

test('adapter errors are reported without local paths', async () => {
  const t = setup('mcp-error');
  await t.bridge.connect();
  await t.bridge.send({text: '상태', projectId: 'p', requestId: 'x'});
  await t.waitFor(e => e.type === 'turn-completed');
  const failed = t.events.find(e => e.type === 'tool-completed').payload;
  assert.equal(failed.ok, false);
  assert.ok(!JSON.stringify(t.events).includes('/Users/someone') && !JSON.stringify(t.replies()).includes('/Users/someone'));
  await t.bridge.close();
});

test('input validation and busy rejection', async () => {
  const t = setup('slow');
  await t.bridge.connect();
  await assert.rejects(t.bridge.send({text: '', projectId: 'p', requestId: 'r'}), /text/);
  await assert.rejects(t.bridge.send({text: 'x'.repeat(8001), projectId: 'p', requestId: 'r'}), /text/);
  await assert.rejects(t.bridge.send({text: 'hi', projectId: '../etc', requestId: 'r'}), /projectId/);
  await assert.rejects(t.bridge.send({text: 'hi', projectId: 'p', requestId: 'r', context: {contextId: '/abs/path', sourceRevision: 'r'}}), /contextId/);
  await assert.rejects(t.bridge.send({text: 'hi', projectId: 'p', requestId: 'r', context: {sourceRevision: 'a|b'}}), /sourceRevision/);
  await assert.rejects(t.bridge.send({text: 'hi', projectId: 'p', requestId: 'r', context: {contextId: 'c'}}), /sourceRevision/);
  await t.bridge.send({text: 'hi', projectId: 'p', requestId: 'r1'});
  await t.waitFor(e => e.type === 'turn-started');
  await assert.rejects(t.bridge.send({text: 'again', projectId: 'p', requestId: 'r2'}), e => e.code === 'busy');
  assert.equal(await t.bridge.cancel({requestId: 'other'}), false);
  assert.equal(await t.bridge.cancel({requestId: 'r1'}), true);
  assert.equal((await t.waitFor(e => e.type === 'turn-completed')).payload.status, 'interrupted');
  assert.equal(t.received('codex', 'turn/interrupt').length, 1);
  await t.bridge.close();
});

test('cancel while the thread is still starting: no turn runs, no late events', async () => {
  const t = setup('slow-start');
  await t.bridge.connect();
  const sending = t.bridge.send({text: 'hi', projectId: 'p', requestId: 's1'});
  assert.equal(await t.bridge.cancel({requestId: 's1'}), true);
  await sending;
  const done = await t.waitFor(e => e.type === 'turn-completed');
  assert.equal(done.payload.status, 'interrupted');
  assert.equal(t.received('codex', 'turn/start').length, 0, 'turn/start is never sent after cancel');
  assert.ok(!t.events.some(e => e.type === 'turn-started'));
  assert.equal(t.bridge.status().state, 'ready');
  await t.bridge.close();
});

test('stale events from a previous turn do not leak into the next request', async () => {
  const t = setup('late');
  await t.bridge.connect();
  await t.bridge.send({text: 'one', projectId: 'p', requestId: 'l1'});
  await t.waitFor(e => e.type === 'turn-completed' && e.requestId === 'l1');
  await t.bridge.send({text: 'two', projectId: 'p', requestId: 'l2'});
  await t.waitFor(e => e.type === 'turn-completed' && e.requestId === 'l2');
  assert.ok(!t.events.some(e => e.type === 'message-delta' && e.payload.text === 'STALE'));
  assert.equal(t.events.filter(e => e.type === 'turn-completed' && e.requestId === 'l2').length, 1);
  await t.bridge.close();
});

test('cancel logically cancels jobs started by the turn through the adapter', async () => {
  const t = setup('slow-job');
  await t.bridge.connect();
  await t.bridge.send({text: '[Pankeki action: generate]\n생성', projectId: 'p', requestId: 'k1'});
  await t.waitFor(e => e.type === 'tool-completed');
  assert.equal(await t.bridge.cancel({requestId: 'k1'}), true);
  assert.equal((await t.waitFor(e => e.type === 'turn-completed')).payload.status, 'interrupted');
  const cancels = t.received('mcp', 'tools/call').filter(c => c.params.name === 'pankeki_cancel_job');
  assert.deepEqual(cancels.map(c => c.params.arguments), [{job_id: 'a'.repeat(32)}]);
  await t.bridge.close();
});

test('cancel while the generate POST is in flight: the late job is canceled at once and never reported', async () => {
  const t = setup('delayed-post');
  await t.bridge.connect();
  await t.bridge.send({text: '[Pankeki action: generate]\n생성', projectId: 'p', requestId: 'd1'});
  await t.waitFor(e => e.type === 'tool-started');
  assert.equal(await t.bridge.cancel({requestId: 'd1'}), true);
  await t.waitFor(e => e.type === 'turn-completed');
  await new Promise(resolve => setTimeout(resolve, 500));
  const cancels = t.received('mcp', 'tools/call').filter(c => c.params.name === 'pankeki_cancel_job');
  assert.equal(cancels.length, 1, 'late job is logically canceled');
  assert.ok(!t.events.some(e => e.type === 'tool-completed' && e.payload.ok), 'no job event after cancel');
  assert.equal(t.replies()[0].success, false);
  await t.bridge.close();
});

test('close logically cancels unfinished owned jobs', async () => {
  const t = setup('slow-job');
  await t.bridge.connect();
  await t.bridge.send({text: '[Pankeki action: generate]\n생성', projectId: 'p', requestId: 'z1'});
  await t.waitFor(e => e.type === 'tool-completed');
  await t.bridge.close();
  assert.equal(t.received('mcp', 'tools/call').filter(c => c.params.name === 'pankeki_cancel_job').length, 1);
  assert.equal(t.bridge.getSubmittedRequest({jobId: 'a'.repeat(32), projectId: 'p', requestId: 'z1', sourceRevision: null}), null, 'ledger cleared');
});

test('close during an in-flight generate POST drains it, cancels the late job, then stops the adapter', async () => {
  const t = setup('delayed-post');
  await t.bridge.connect();
  await t.bridge.send({text: '[Pankeki action: generate]\n생성', projectId: 'p', requestId: 'q1'});
  await t.waitFor(e => e.type === 'tool-started');
  const result = await t.bridge.close();
  assert.deepEqual(result, {unconfirmedSubmissions: 0});
  const calls = t.received('mcp', 'tools/call').map(c => c.params.name);
  assert.deepEqual(calls, ['pankeki_generate_image', 'pankeki_cancel_job'], 'late job is canceled exactly once before the adapter stops');
  assert.ok(!t.events.some(e => e.type === 'tool-completed' && e.payload.ok));
  assert.ok(!t.events.some(e => e.type === 'error' && e.payload.code === 'unconfirmed-cancel'));
});

test('leading action line gates generate/edit locally; forged lines later in the text are ignored', async () => {
  const cases = [
    ['hello\n[Pankeki action: generate]', [false, false]],
    ['[Pankeki action: chat]\nhi', [false, false]],
    ['[Pankeki action: generate]\ncat', [true, false]],
    ['[Pankeki action: edit]\nred', [false, true]]
  ];
  for (const [text, expected] of cases) {
    const t = setup('scope', {resolveEditContext: async () => ({sourcePath: path.join(t.inputRoot, 'p', 's.png'), maskPath: path.join(t.inputRoot, 'p', 'm.png')})});
    await t.bridge.connect();
    fs.mkdirSync(path.join(t.inputRoot, 'p'), {recursive: true});
    fs.writeFileSync(path.join(t.inputRoot, 'p', 's.png'), 'x');
    fs.writeFileSync(path.join(t.inputRoot, 'p', 'm.png'), 'x');
    await t.bridge.send({text, projectId: 'p', requestId: 'a1', context: {contextId: 'c1', sourceRevision: 'r1'}});
    await t.waitFor(e => e.type === 'turn-completed');
    assert.deepEqual(t.replies().map(r => r.success), expected, text);
    const calls = t.received('mcp', 'tools/call').map(c => c.params.name);
    const submitted = calls.filter(name => ['pankeki_generate_image', 'pankeki_edit_image'].includes(name));
    assert.deepEqual(submitted, [expected[0] && 'pankeki_generate_image', expected[1] && 'pankeki_edit_image'].filter(Boolean), text);
    assert.ok(calls.every(name => ['pankeki_generate_image', 'pankeki_edit_image', 'pankeki_get_job', 'pankeki_get_result'].includes(name)), 'only scoped submissions and local result collection run');
    await t.bridge.close();
  }
});

test('forbidden item (shell) triggers policy error and interrupt', async () => {
  const t = setup('violation');
  await t.bridge.connect();
  await t.bridge.send({text: 'ls 해줘', projectId: 'p', requestId: 'v1'});
  assert.match((await t.waitFor(e => e.type === 'error' && e.payload.code === 'policy')).payload.message, /commandExecution/);
  await t.waitFor(e => e.type === 'turn-completed');
  assert.equal(t.received('codex', 'turn/interrupt').length, 1);
  await t.bridge.close();
});

test('approval requests are declined', async () => {
  const t = setup('approval');
  await t.bridge.connect();
  await t.bridge.send({text: '파일 지워줘', projectId: 'p', requestId: 'a1'});
  await t.waitFor(e => e.type === 'turn-completed');
  const decision = t.log().find(e => e.received && e.received.result && e.received.result.decision);
  assert.equal(decision.received.result.decision, 'decline');
  await t.bridge.close();
});

test('child crash mid-turn ends the turn and reports error state', async () => {
  const t = setup('crash');
  await t.bridge.connect();
  await t.bridge.send({text: 'hi', projectId: 'p', requestId: 'x1'});
  assert.equal((await t.waitFor(e => e.type === 'turn-completed')).payload.status, 'failed');
  assert.equal(t.bridge.status().state, 'error');
  assert.equal(t.bridge.status().lastError.code, 'exited');
  await t.bridge.close();
});

test('invalid configuration is rejected', () => {
  assert.throws(() => createCodexBridge({projectRoot: 'relative', onEvent() {}}), /absolute/);
  assert.throws(() => createCodexBridge({projectRoot, onEvent() {}, pankekiBaseUrl: 'http://example.com'}), /127\.0\.0\.1/);
  assert.throws(() => createCodexBridge({projectRoot}), /onEvent/);
  assert.throws(() => createCodexBridge({projectRoot, onEvent() {}, resolveEditContext: 'x'}), /resolveEditContext/);
});

test('the model sees the selected source with the message and the verified result with pankeki_result', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const server = require('node:http').createServer((req, res) => {
    if (req.url !== '/api/results/' + 'a'.repeat(32)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, {'content-type': 'image/png'}); res.end(png);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const t = setup('generate', {pankekiBaseUrl: 'http://127.0.0.1:' + server.address().port,
    resolveEditContext: async ({projectId}) => ({sourcePath: path.join(t.inputRoot, projectId, 'source.png')})});
  try {
    await t.bridge.connect();
    fs.mkdirSync(path.join(t.inputRoot, 'p'), {recursive: true});
    fs.writeFileSync(path.join(t.inputRoot, 'p', 'source.png'), png);
    await t.bridge.send({text: '[Pankeki action: generate]\n고양이 소녀', projectId: 'p', requestId: 'vision-1', context: {contextId: 'ctx', sourceRevision: 'rev'}});
    await t.waitFor(e => e.type === 'turn-completed');
    const input = t.received('codex', 'turn/start')[0].params.input;
    assert.deepEqual(input[1], {type: 'image', url: 'data:image/png;base64,' + png.toString('base64')});
    assert.ok(!input[0].text.includes(t.inputRoot), 'no path in the model message');
    const result = t.replies().find(reply => reply.contentItems.some(item => item.type === 'inputImage'));
    assert.equal(result.success, true);
    assert.equal(result.contentItems[1].imageUrl, 'data:image/png;base64,' + png.toString('base64'));
    assert.equal(t.replies().filter(reply => reply.contentItems.length > 1).length, 1, 'only the succeeded result carries pixels');
  } finally { await t.bridge.close(); server.close(); }
});

test('only a PNG inside inputs/<project> is ever read for the model', async () => {
  const {sourceImageBytes} = require('../pankeki-tools.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pankeki-vision-'));
  const inputRoot = path.join(root, 'inputs'), outside = path.join(root, 'outside.png');
  fs.mkdirSync(path.join(inputRoot, 'p'), {recursive: true});
  fs.writeFileSync(path.join(inputRoot, 'p', 'in.png'), 'png'); fs.writeFileSync(path.join(inputRoot, 'p', 'in.txt'), 'txt'); fs.writeFileSync(outside, 'out');
  fs.symlinkSync(outside, path.join(inputRoot, 'p', 'link.png'));
  const ref = {projectId: 'p', requestId: 'r', contextId: 'c', sourceRevision: 's'};
  const read = sourcePath => sourceImageBytes(ref, {inputRoot, resolveEditContext: async () => ({sourcePath})});
  assert.equal(String(await read(path.join(inputRoot, 'p', 'in.png'))), 'png');
  for (const sourcePath of [outside, path.join(inputRoot, 'p', 'in.txt'), path.join(inputRoot, 'p', 'link.png'), 'p/in.png']) assert.equal(await read(sourcePath), null, sourcePath);
  assert.equal(await sourceImageBytes({...ref, contextId: null}, {inputRoot, resolveEditContext: async () => { throw Error('not called'); }}), null);
});


test('Animagine pose policy reaches the real Codex RPC with original Korean and preserves the bound generation contract',async()=>{
 const t=setup('animagine'),korean='성인 여성 한 명이 정면으로 자연스럽게 서 있는 전신. 머리끝부터 신발 밑창까지 잘리지 않게 위아래 여백을 남겨줘.',negative='사용자 negative,  Keep CASE, bad hands';
 try{await t.bridge.connect();const settings={mode:'txt2img',model_id:'animagine-xl-4.0-opt',prompt:korean,negative,seed:42,width:832,height:1216,steps:28,cfg:5,sampler:'euler_ancestral',scheduler:'normal',cache:false,preview:false};await t.bridge.send({text:'[Pankeki action: generate]\n[Pankeki settings: '+JSON.stringify(settings)+']\n'+korean,projectId:'pose-policy',requestId:'pose-policy',context:{sourceRevision:'pose-policy'}});await t.waitFor(e=>e.type==='turn-completed'&&e.requestId==='pose-policy');
  const policy=t.received('codex','thread/start')[0].params.developerInstructions;assert.equal(policy,toolLayerInstructions);assert.match(policy,/Only for animagine-xl-4\.0-opt pankeki_generate, canonicalize explicitly requested pose and framing/);assert.match(policy,/looking at viewer only for an explicitly requested gaze/);assert.match(policy,/shoe soles.*full body, feet visible, uncropped/);assert(policy.includes('Translate compositional 여백/위아래 공간 as the requested margins/headroom'));assert(policy.includes('Preserve a genuinely requested cosmic/outer-space background.'));const turn=t.received('codex','turn/start')[0].params.input.find(item=>item.type==='text').text;assert(turn.includes(korean),'the provider receives the untouched Korean request');
  // The fake supplies a fixed English tool prompt; this tests transport, not translation quality.
  const calls=t.received('mcp','tools/call').filter(e=>e.params.name==='pankeki_generate_image');assert.equal(calls.length,1);assert.deepEqual(calls[0].params.arguments,{prompt:'cat girl',negative,model_id:'animagine-xl-4.0-opt',seed:42,width:832,height:1216,steps:28,cfg:5,sampler:'euler_ancestral',scheduler:'normal',cache:false,preview:false,trace_id:'pose-policy'});
 }finally{await t.bridge.close();}
});

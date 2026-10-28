'use strict';
// Stand-ins used by codex-bridge.test.cjs:
//   node codex-bridge-fake-server.cjs app-server ...   fake `codex app-server` (0.164.0 wire shapes)
//   node codex-bridge-fake-server.cjs --mcp            fake Pankeki MCP adapter (stdio JSON-RPC)
// Scenario comes from FAKE_SCENARIO; every message received, plus argv and env
// key names, is appended to FAKE_LOG as JSON lines.
const fs = require('node:fs');

const scenario = process.env.FAKE_SCENARIO || 'ok';
const logFile = process.env.FAKE_LOG;
const role = process.argv.includes('--mcp') ? 'mcp' : 'codex';
const record = entry => { if (logFile) fs.appendFileSync(logFile, JSON.stringify({role, ...entry}) + '\n'); };
record({argv: process.argv.slice(2), envKeys: Object.keys(process.env).sort(), cwd: process.cwd()});
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
const JOB = 'a'.repeat(32);

function lines(handler) {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      record({received: msg});
      handler(msg);
    }
  });
  process.stdin.on('end', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

if (role === 'mcp') {
  // Shapes follow plugins/pankeki-local/server/pankeki_mcp.py: jobs carry `state`,
  // submissions return provenance.request_path pointing at the POSTed body.
  const path = require('node:path');
  const state = process.argv[process.argv.indexOf('--state') + 1];
  let n = 0, polls = 0, submittedAt = 0;
  const job = (st, extra = {}) => ({job_id: JOB, state: st, revision: 1, session: 'mcp-fake', ...extra});
  function submit(request) {
    submittedAt = Date.now();
    const dir = path.join(state, 'submissions', String(++n));
    fs.mkdirSync(dir, {recursive: true});
    const file = path.join(dir, 'request.json');
    fs.writeFileSync(file, JSON.stringify({session: 'mcp-fake', request}));
    return job('queued', {provenance: {request_path: file, request_sha256: 'd'.repeat(64), inputs: {source: {path: '/Users/someone/in/source.png'}}}});
  }
  const tools = {
    pankeki_get_status: () => ({app_reachable: true, models: {'sdxl-base': {available: true, path: '/Users/someone/models/base.safetensors', manifest: {sha256: 'e'.repeat(64)}}}, health: {comfy: true, system: {os: 'darwin'}}}),
    pankeki_generate_image: a => submit({prompt: a.prompt, negative: a.negative || '', model_id: a.model_id || 'sdxl-base', seed: a.seed ?? 1, steps: a.steps ?? 25, cfg: a.cfg ?? 6, sampler: a.sampler || 'dpmpp_2m', scheduler: a.scheduler || 'karras', cache: a.cache ?? false, preview: a.preview ?? false, mode: 'txt2img', width: a.width || 1024, height: a.height || 1024}),
    pankeki_edit_image: a => submit(a.operation==='regenerate'?{mode:'inpaint',edit_operation:'regenerate',prompt:a.prompt||'',model_id:a.model_id||'sdxl-base',seed:a.seed??1,steps:a.steps??25,cfg:a.cfg??6,denoise:a.denoise??.55,sampler:a.sampler||'dpmpp_2m',scheduler:a.scheduler||'karras',roi:a.roi??false,halo:a.halo??32,cache:a.cache??false,preview:a.preview??false,feather:a.feather??4,source:'iVBORbase64',mask:'iVBORbase64'}:
      {target_color: (a.target_color || '').toUpperCase(), source_color: null, color_tolerance: 35, cache: false, preview: false, mode: 'inpaint', edit_operation: a.operation, feather: a.feather??4, source: 'iVBORbase64', mask: 'iVBORbase64'}),
    pankeki_get_job: () => {
      if(scenario==='terminal-submitting'&&++polls<3)return job('submitting');
      if (scenario.startsWith('terminal-')) {
        if (scenario === 'terminal-wrong-job') return job('succeeded', {job_id: 'b'.repeat(32)});
        return job({'terminal-failed': 'failed', 'terminal-canceled': 'canceled', 'terminal-uncertain': 'uncertain', 'terminal-orphaned':'orphaned'}[scenario] || 'succeeded');
      }
      if (scenario.startsWith('settle-')) {
        if (['settle-timeout', 'settle-close'].includes(scenario)) return job('running');
        if (Date.now() - submittedAt < (['settle-already-result', 'settle-overlap-result'].includes(scenario) ? 0 : 100)) return job('running');
        if (scenario === 'settle-wrong-job') return job('succeeded', {job_id: 'b'.repeat(32)});
        return job({'settle-failed': 'failed', 'settle-canceled': 'canceled', 'settle-uncertain': 'uncertain'}[scenario] || 'succeeded');
      }
      return job(scenario === 'slow-job' && ++polls < 4 ? 'running' : 'succeeded');
    },
    pankeki_get_result: () => ({job_id: JOB, state: 'succeeded', image_path: '/Users/someone/runtime/runs/x/result.png', mime_type: 'image/png', sha256: 'b'.repeat(64),
      dimensions: [768, 1024], request: {mode: 'txt2img', prompt: 'cat girl', seed: 7}, metrics: {elapsed_s: 3.5, result_path: '/Users/x'}, engine_recipe: {workflow_path: '/Users/x'}, provenance: {request_path: '/Users/x'}}),
    pankeki_cancel_job: () => job(process.env.FAKE_CANCEL_STATE || 'canceling', {cancel_semantics: 'local discard only; GPU work may continue'})
  };
  lines(async msg => {
    if (msg.method === 'initialize') send({jsonrpc: '2.0', id: msg.id, result: {protocolVersion: msg.params.protocolVersion, capabilities: {tools: {}}, serverInfo: {name: 'fake-pankeki', version: '0'}}});
    else if (msg.method === 'tools/call') {
      if (scenario === 'delayed-post' && /generate|edit/.test(msg.params.name)) await new Promise(resolve => setTimeout(resolve, 300));
      if (scenario==='auto-late-post'&&/generate_image|edit_image/.test(msg.params.name))await new Promise(resolve=>setTimeout(resolve,180));
      if (['auto-overlap','auto-cancel-result'].includes(scenario)&&msg.params.name==='pankeki_get_result')await new Promise(resolve=>setTimeout(resolve,120));
      if (scenario==='auto-adapter-error'&&msg.params.name==='pankeki_generate_image')return send({jsonrpc:'2.0',id:msg.id,result:{isError:true,content:[{type:'text',text:'Submission failed'}]}});
      if (['auto-result-error','auto-foreign-result-error'].includes(scenario)&&msg.params.name==='pankeki_get_result')return send({jsonrpc:'2.0',id:msg.id,result:{isError:true,content:[{type:'text',text:'Result verification failed'}]}});
      if (scenario === 'mcp-error') return send({jsonrpc: '2.0', id: msg.id, result: {isError: true, content: [{type: 'text', text: 'Pankeki connection failed at /Users/someone/app'}]}});
      if (scenario === 'settle-delayed-poll' && msg.params.name === 'pankeki_get_job') await new Promise(resolve => setTimeout(resolve, 180));
      if (['settle-delayed-result', 'settle-overlap-result'].includes(scenario) && msg.params.name === 'pankeki_get_result') await new Promise(resolve => setTimeout(resolve, 180));
      if (scenario === 'settle-result-error' && msg.params.name === 'pankeki_get_result') return send({jsonrpc: '2.0', id: msg.id, result: {isError: true, content: [{type: 'text', text: 'Result unavailable at /Users/someone/private'}]}});
      if (scenario.startsWith('terminal-') && msg.params.name === 'pankeki_get_result') {
        if (scenario === 'terminal-result-error') return send({jsonrpc: '2.0', id: msg.id, result: {isError: true, content: [{type: 'text', text: 'Result unavailable at /Users/someone/private'}]}});
        if (['terminal-overlap', 'terminal-settle', 'terminal-cancel', 'terminal-timeout', 'terminal-close'].includes(scenario)) await new Promise(resolve => setTimeout(resolve, 180));
      }
      const data = tools[msg.params.name](msg.params.arguments || {});
      if (scenario === 'terminal-result-wrong-job' && msg.params.name === 'pankeki_get_result') data.job_id = 'b'.repeat(32);
      if (scenario === 'terminal-result-uncertain' && msg.params.name === 'pankeki_get_result') data.state = 'uncertain';
      send({jsonrpc: '2.0', id: msg.id, result: {isError: false, content: [{type: 'text', text: JSON.stringify(data)}], structuredContent: data}});
    } else if (msg.id !== undefined) send({jsonrpc: '2.0', id: msg.id, error: {code: -32601, message: 'unknown'}});
  });
} else {
  const thread = 'thread-1';
  let turnCount = 0, serverRequestId = 1000;
  const waiting = new Map();   // server request id -> callback(result)
  const notify = (method, params) => send({method, params});
  const turnId = () => 'turn-' + turnCount;
  const toolCall = (tool, args) => new Promise(resolve => {
    const id = serverRequestId++;
    waiting.set(id, resolve);
    send({id, method: 'item/tool/call', params: {threadId: thread, turnId: turnId(), callId: 'call-' + id, namespace: null, tool, arguments: args}});
  });
  const message = text => {
    const id = 'msg-' + serverRequestId++;
    notify('item/agentMessage/delta', {threadId: thread, turnId: turnId(), itemId: id, delta: text});
    notify('item/completed', {threadId: thread, turnId: turnId(), item: {type: 'agentMessage', id, text}, completedAtMs: 0});
  };
  const complete = (status = 'completed', id = turnId()) => notify('turn/completed', {threadId: thread, turn: {id, items: [], status, error: null}});

  async function runTurn(params={}) {
    const mine = turnId();
    notify('turn/started', {threadId: thread, turn: {id: mine, items: [], status: 'inProgress', error: null}});
    if (scenario === 'late' && turnCount === 2) {
      // stale events from the previous turn arrive during the next request
      notify('item/agentMessage/delta', {threadId: thread, turnId: 'turn-1', itemId: 'old', delta: 'STALE'});
      complete('completed', 'turn-1');
    }
    if (scenario === 'violation') {
      notify('item/started', {threadId: thread, turnId: mine, item: {type: 'commandExecution', id: 'cmd', command: 'ls', status: 'inProgress'}, startedAtMs: 0});
      return;
    }
    if (scenario === 'bad-tool') { record({toolReply: await toolCall('shell', {cmd: 'ls'})}); return complete(); }
    if (scenario === 'approval') { send({id: serverRequestId++, method: 'item/commandExecution/requestApproval', params: {threadId: thread, turnId: mine, itemId: 'cmd'}}); return; }
    if (scenario === 'crash') { setTimeout(() => process.exit(3), 20); return; }
    if (scenario === 'slow' || scenario === 'slow-start') return;
    if(scenario.startsWith('auto-')){
      if(turnCount>1&&!scenario.startsWith('auto-foreign')){message('healthy');return complete();}
      if(scenario==='auto-chat'){message('새 그림을 원하시나요?');return complete();}
      if(scenario.startsWith('auto-foreign')){
        if(turnCount===1&&params.input[0].text.startsWith('[Pankeki action: generate]')){record({toolReply:await toolCall('pankeki_generate',{prompt:'first'})});return complete();}
        for(const tool of ['pankeki_job','pankeki_result','pankeki_cancel'])record({toolReply:await toolCall(tool,{job_id:JOB})});return complete();
      }
      if(['auto-edit-recolor','auto-edit-regenerate','auto-fallback'].includes(scenario)){
        record({toolReply:await toolCall('pankeki_edit',{operation:scenario==='auto-edit-recolor'?'recolor':'regenerate',target_color:'#FF0000',prompt:'red scarf',model_id:'sdxl-base',seed:7,steps:1,cfg:1,denoise:.1})});
        if(scenario==='auto-fallback')record({toolReply:await toolCall('pankeki_generate',{prompt:'fallback'})});return complete();
      }
      if(scenario==='auto-race'){
        for(const reply of await Promise.all([toolCall('pankeki_generate',{prompt:'first'}),toolCall('pankeki_generate',{prompt:'duplicate'})]))record({toolReply:reply});
        record({toolReply:await toolCall('pankeki_edit',{operation:'recolor',target_color:'#FF0000'})});return complete();
      }
      record({toolReply:await toolCall('pankeki_generate',{prompt:'one girl',...(scenario==='auto-invalid-fallback'?{source_path:'/tmp/forged'}:{})})});
      if(['auto-invalid-fallback','auto-adapter-error'].includes(scenario)){record({toolReply:await toolCall('pankeki_generate',{prompt:'fallback'})});return complete();}
      if(scenario==='auto-late-post')return;
      record({toolReply:await toolCall('pankeki_job',{job_id:JOB})});
      if(scenario==='auto-overlap'){for(const reply of await Promise.all([toolCall('pankeki_result',{job_id:JOB}),toolCall('pankeki_result',{job_id:JOB})]))record({toolReply:reply});}
      else record({toolReply:await toolCall('pankeki_result',{job_id:JOB})});
      return complete();
    }
    if (scenario.startsWith('terminal-')) {
      if (turnCount > 1 && scenario !== 'terminal-foreign') { message('healthy'); return complete(); }
      if (scenario === 'terminal-foreign' && turnCount === 1) {
        record({toolReply: await toolCall('pankeki_generate', {prompt: 'one girl'})});
        return complete('failed');
      }
      if (scenario !== 'terminal-foreign') record({toolReply: await toolCall('pankeki_generate', {prompt: 'one girl'})});
      record({toolReply: await toolCall('pankeki_job', {job_id: JOB})});
      if (scenario === 'terminal-overlap') {
        const results = await Promise.all([toolCall('pankeki_result', {job_id: JOB}), toolCall('pankeki_result', {job_id: JOB})]);
        for (const result of results) record({toolReply: result});
        complete(); complete(); return;
      }
      if (scenario === 'terminal-foreign') { record({toolReply: await toolCall('pankeki_result', {job_id: JOB})}); return complete(); }
      if (scenario === 'terminal-polling') {
        // Reproduce the actual live turn: it keeps polling terminal success and
        // never calls result or ends. Delivery must not wait for this loop.
        for (let i = 0; i < 25; i++) {
          await new Promise(resolve => setTimeout(resolve, 20));
          record({toolReply: await toolCall('pankeki_job', {job_id: JOB})});
        }
        return;
      }
      if (['terminal-cancel', 'terminal-timeout', 'terminal-close'].includes(scenario)) return;
      return complete();
    }
    if (scenario.startsWith('settle-') && turnCount === 1) {
      record({toolReply: await toolCall('pankeki_generate', {prompt: 'one girl with a red scarf'})});
      if (scenario === 'settle-overlap-result') {
        const pending = toolCall('pankeki_result', {job_id: JOB});
        complete(); await pending; return;
      }
      if (scenario === 'settle-already-result') {
        record({toolReply: await toolCall('pankeki_job', {job_id: JOB})});
        record({toolReply: await toolCall('pankeki_result', {job_id: JOB})});
      }
      message('Image job is still running.');
      complete(scenario === 'settle-turn-failed' ? 'failed' : 'completed');
      if (scenario === 'settle-slow') complete(); // duplicate raw completion
      return;
    }
    if (scenario === 'slow-job' || scenario === 'delayed-post') { record({toolReply: await toolCall('pankeki_generate', {prompt: 'cat'})}); return; }
    if (scenario === 'scope') {
      for (const tool of ['pankeki_generate', 'pankeki_edit']) record({toolReply: await toolCall(tool, tool === 'pankeki_generate' ? {prompt: 'cat'} : {operation: 'recolor', target_color: '#ff0000'})});
      message('done');
      return complete();
    }
    if (scenario === 'generate' || scenario === 'animagine') {
      for (const [tool, args] of [['pankeki_generate', {prompt: 'cat girl', seed: 7}], ['pankeki_job', {job_id: JOB}], ['pankeki_result', {job_id: JOB}]]) record({toolReply: await toolCall(tool, args)});
      record({toolReply: await toolCall('pankeki_job', {job_id: 'f'.repeat(32)})});
      message('생성했어요.');
      return complete();
    }
    if (scenario === 'edit' || scenario === 'edit-missing') {
      record({toolReply: await toolCall('pankeki_edit', {operation: 'recolor', target_color: '#ff0000', source_path: '/etc/passwd'})});
      record({toolReply: await toolCall('pankeki_edit', {operation: 'recolor', target_color: '#ff0000'})});
      message('done');
      return complete();
    }
    record({toolReply: await toolCall('pankeki_status', {})});
    message('앱이 정상입니다.');
    complete();
  }

  const handlers = {
    'model/list': params => {
      const row = {id: 'picker-a', model: 'wire-a', displayName: 'Model A', isDefault: true, hidden: false,
        defaultReasoningEffort: scenario === 'bad-effort' ? 'ultra' : 'low', supportedReasoningEfforts: [{reasoningEffort: 'low', description: 'Low'}]};
      if (scenario === 'model-pagination') {
        const page = params.cursor ? Number(params.cursor.slice(5)) : 1;
        return {data: Array.from({length: 25}, (_, index) => ({...row, id: 'picker-' + ((page - 1) * 25 + index)})), nextCursor: 'page-' + (page + 1)};
      }
      return {data: [row], nextCursor: scenario === 'bad-cursor' ? 'same-cursor' : null};
    },
    initialize: () => ({userAgent: 'codex_cli_rs/0.164.0 (fake)', codexHome: '/tmp/fake', platformFamily: 'unix', platformOs: 'macos'}),
    'account/read': () => {
      if (scenario === 'signed-out') return {account: null, requiresOpenaiAuth: true, workspaceRouting: null};
      if (scenario === 'apikey') return {account: {type: 'apiKey'}, requiresOpenaiAuth: true, workspaceRouting: null};
      return {account: {type: 'chatgpt', email: 'user@example.com', planType: 'plus'}, requiresOpenaiAuth: true, workspaceRouting: null};
    },
    'skills/list': () => {
      const disabled = process.argv.some(arg => arg.startsWith('skills.config='));
      return {data: [{cwd: process.cwd(), errors: [], skills: [{name: 'user-skill', description: '', path: '/x', scope: 'user', enabled: !disabled, pluginId: null}]}]};
    },
    'config/read': () => {
      const features = {};
      process.argv.forEach((arg, i) => { if (arg === '--disable') features[process.argv[i + 1]] = false; });
      const servers = {node_repl: {enabled: scenario === 'extra-mcp'}, 'pankeki-local': {enabled: false}};
      return {config: {mcp_servers: servers, features, approval_policy: 'never', sandbox_mode: 'read-only', web_search: 'disabled'}, origins: {}, layers: null};
    },
    'hooks/list': () => ({data: [{cwd: process.cwd(), hooks: scenario === 'hooks' ? [{}] : [], warnings: [], errors: []}]}),
    'thread/start': () => new Promise(resolve => setTimeout(() => resolve({thread: {id: thread}, model: 'fake', modelProvider: 'openai'}), scenario === 'slow-start' ? 300 : 0)),
    'turn/start': params => { turnCount++; setImmediate(()=>runTurn(params)); return {turn: {id: turnId(), items: [], status: 'inProgress', error: null}}; },
    'turn/interrupt': params => { setImmediate(() => complete('interrupted', params.turnId)); return {}; }
  };

  lines(async msg => {
    if (msg.method && msg.id !== undefined) {
      const handler = handlers[msg.method];
      if (handler) send({id: msg.id, result: await handler(msg.params)});
      else send({id: msg.id, error: {code: -32601, message: 'unknown ' + msg.method}});
    } else if (msg.id !== undefined && waiting.has(msg.id)) {
      const resolve = waiting.get(msg.id); waiting.delete(msg.id); resolve(msg.result);
    } else if (msg.id !== undefined && scenario === 'approval') complete();
  });
}

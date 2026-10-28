'use strict';
// Stand-in for the Claude Code CLI used by claude-bridge.test.cjs.
//   node claude-bridge-fake-cli.cjs auth status     -> FAKE_AUTH: ok | signed-out | apikey
//   node claude-bridge-fake-cli.cjs -p ...          -> stream-json session (2.1.310 wire shapes)
// Scenario comes from FAKE_SCENARIO; the user message text picks the turn script
// (STATUS, GENERATE, GIVEUP, EDIT, SLOW, LIMIT, FORBIDDEN, SPOOF, EARLY, CRASH). argv,
// env key names, stdin messages and MCP replies are appended to FAKE_LOG.
const fs = require('node:fs');

const scenario = process.env.FAKE_SCENARIO || 'ok';
const logFile = process.env.FAKE_LOG;
const record = entry => { if (logFile) fs.appendFileSync(logFile, JSON.stringify({role: 'claude', ...entry}) + '\n'); };
const argv = process.argv.slice(2);
record({argv, envKeys: Object.keys(process.env).sort(), cwd: process.cwd()});
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const TOOL = name => 'mcp__pankeki__' + name;

if (argv[0] === 'auth') {
  const auth = process.env.FAKE_AUTH || 'ok';
  const base = {loggedIn: auth !== 'signed-out', authMethod: auth === 'apikey' ? 'api_key' : 'claude.ai', apiProvider: 'firstParty', email: 'user@example.com'};
  process.stdout.write(JSON.stringify(auth === 'signed-out' ? {loggedIn: false} : base, null, 2) + '\n');
  process.exit(0);
}
if (argv[0] === '--help') {
  process.stdout.write('  --model <model> Model for the current session. Use an alias (e.g. \'opus\' or \'sonnet\').\n  --name <name> Session name\n');
  process.exit(0);
}

const config = JSON.parse(fs.readFileSync(argv[argv.indexOf('--mcp-config') + 1], 'utf8')).mcpServers.pankeki;
let rpcId = 1, interrupted = false, turn = 0, finishPendingTurn = null;
const unresponsive = ['interrupt-timeout', 'interrupt-no-result'].includes(scenario);
if (unresponsive) setInterval(() => {}, 1000); // Remains alive after EOF/SIGTERM so bounded SIGKILL is exercised.
function waitForFinish(mine) {
  return new Promise(resolve => {
    finishPendingTurn = () => { finishPendingTurn = null; resolve(); };
    record({waitingForFinish: mine});
  });
}
async function call(name, args, useId) {
  const response = await fetch(config.url, {method: 'POST', headers: {...config.headers, 'content-type': 'application/json', accept: 'application/json, text/event-stream'},
    body: JSON.stringify({jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: {name, arguments: args, _meta: {'claudecode/toolUseId': useId}}})});
  const body = await response.json();
  record({mcpReply: {name, result: body.result}});
  return body.result;
}
function toolUse(id, name, input) { send({type: 'assistant', message: {role: 'assistant', content: [{type: 'tool_use', id, name, input}]}, parent_tool_use_id: null}); }
function text(value) {
  send({type: 'stream_event', event: {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: value}}, parent_tool_use_id: null});
  send({type: 'assistant', message: {role: 'assistant', content: [{type: 'text', text: value}]}, parent_tool_use_id: null});
}
const result = (extra = {}) => send({type: 'result', subtype: 'success', is_error: false, result: 'done', ...extra});
async function useTool(id, name, args) {
  toolUse(id, TOOL(name), args);
  const out = await call(name, args, id);
  send({type: 'user', message: {role: 'user', content: [{type: 'tool_result', tool_use_id: id, content: out.content}]}});
  return out;
}

async function runTurn(content) {
  if (Array.isArray(content)) content = content.filter(block => block.type === 'text').map(block => block.text).join('\n');
  const mine = ++turn;
  interrupted = false;
  const tools = ['STATUS', 'GENERATE', 'GIVEUP', 'EDIT', 'SLOW', 'LIMIT', 'FORBIDDEN', 'SPOOF', 'EARLY', 'CRASH'];
  const script = tools.find(word => content.includes(word)) || 'CHAT';
  const names = ['pankeki_status', 'pankeki_generate', 'pankeki_edit', 'pankeki_job', 'pankeki_result', 'pankeki_cancel'].map(TOOL);
  send({type: 'system', subtype: 'init', tools: scenario === 'extra-tool' ? [...names, 'Bash'] : names,
    mcp_servers: scenario === 'extra-mcp' ? [{name: 'pankeki', status: 'connected'}, {name: 'other', status: 'connected'}] : [{name: 'pankeki', status: 'connected'}],
    model: 'claude-sonnet-5-5', permissionMode: 'dontAsk', slash_commands: [], apiKeySource: scenario === 'apikey-source' ? 'ANTHROPIC_API_KEY' : 'none',
    claude_code_version: '2.1.310', skills: [], plugins: [{name: 'cc-plugin-telemetry', path: 'builtin', source: 'cc-plugin-telemetry@builtin'}]});
  if(scenario.startsWith('auto-')){
    if(mine>1&&!scenario.startsWith('auto-foreign')){text('healthy');return result();}
    if(scenario==='auto-chat'){text('새 그림을 원하시나요?');return result();}
    if(scenario.startsWith('auto-foreign')){
      if(mine===1){await useTool('auto-first','pankeki_generate',{prompt:'first'});return result();}
      for(const name of ['pankeki_job','pankeki_result','pankeki_cancel'])await useTool('auto-read-'+name,name,{job_id:'a'.repeat(32)});return result();
    }
    if(['auto-edit-recolor','auto-edit-regenerate','auto-fallback'].includes(scenario)){
      await useTool('auto-edit','pankeki_edit',{operation:scenario==='auto-edit-recolor'?'recolor':'regenerate',target_color:'#FF0000',prompt:'red scarf',model_id:'sdxl-base',seed:7,steps:1,cfg:1,denoise:.1});
      if(scenario==='auto-fallback')await useTool('auto-fallback','pankeki_generate',{prompt:'fallback'});return result();
    }
    if(scenario==='auto-race'){
      await Promise.all([useTool('auto-race1','pankeki_generate',{prompt:'first'}),useTool('auto-race2','pankeki_generate',{prompt:'duplicate'})]);
      await useTool('auto-race3','pankeki_edit',{operation:'recolor',target_color:'#FF0000'});return result();
    }
    await useTool('auto-generate','pankeki_generate',{prompt:'one girl',...(scenario==='auto-invalid-fallback'?{source_path:'/tmp/forged'}:{})});
    if(['auto-invalid-fallback','auto-adapter-error'].includes(scenario)){await useTool('auto-fallback','pankeki_generate',{prompt:'fallback'});return result();}
    if(scenario==='auto-late-post')return result();
    await useTool('auto-job','pankeki_job',{job_id:'a'.repeat(32)});
    if(scenario==='auto-overlap')await Promise.all([useTool('auto-result1','pankeki_result',{job_id:'a'.repeat(32)}),useTool('auto-result2','pankeki_result',{job_id:'a'.repeat(32)})]);
    else await useTool('auto-result','pankeki_result',{job_id:'a'.repeat(32)});
    return result();
  }
  if (script === 'CHAT') { text('안녕하세요'); return result(); }
  if (script === 'STATUS') { await useTool('toolu_s1', 'pankeki_status', {}); text('앱이 준비됐어요.'); return result(); }
  if (script === 'GENERATE') {
    const started = await useTool('toolu_g1', 'pankeki_generate', {prompt: 'cat girl', seed: 7});
    const jobId = JSON.parse(started.content[0].text).job_id;
    if (scenario === 'cancel-race') { await waitForFinish(mine); return result(); }
    if (scenario === 'cancel-after-submit') { while (!interrupted) await sleep(10); return send({type: 'result', subtype: 'error_during_execution', is_error: true}); }
    await useTool('toolu_g2', 'pankeki_job', {job_id: jobId});
    await useTool('toolu_g3', 'pankeki_result', {job_id: jobId});
    text('완성했어요.'); return result();
  }
  if (script === 'GIVEUP') {   // submits, then ends the reply without fetching the result
    await useTool('toolu_v1', 'pankeki_generate', {prompt: 'cat girl'});
    text('아직 실행 중이에요.'); return result();
  }
  if (script === 'EDIT') {
    const args = content.includes('PATHARG') ? {operation: 'recolor', target_color: '#00ff00', source_path: '/etc/passwd'} : {operation: 'recolor', target_color: '#00ff00'};
    await useTool('toolu_e1', 'pankeki_edit', args); text('수정했어요.'); return result();
  }
  if (script === 'SLOW') {
    if (unresponsive) { text('.'); return; }
    if (scenario === 'cancel-race') {
      await waitForFinish(mine);
      return send({type: 'result', subtype: interrupted ? 'error_during_execution' : 'success', is_error: interrupted});
    }
    for (let i = 0; i < 200 && !interrupted && turn === mine; i++) { send({type: 'stream_event', event: {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: '.'}}, parent_tool_use_id: null}); await sleep(10); }
    return send({type: 'result', subtype: interrupted ? 'error_during_execution' : 'success', is_error: interrupted, result: interrupted ? undefined : 'done'});
  }
  if (script === 'LIMIT') {
    send({type: 'rate_limit_event', rate_limit_info: {status: 'rejected', resetsAt: 1793336400, rateLimitType: 'five_hour'}});
    return send({type: 'result', subtype: 'success', is_error: true, result: 'Claude AI usage limit reached|1793336400 https://claude.ai/upgrade'});
  }
  if (script === 'FORBIDDEN') {
    toolUse('toolu_f1', 'Bash', {command: 'ls'});
    while (!interrupted) await sleep(10);
    return send({type: 'result', subtype: 'error_during_execution', is_error: true});
  }
  if (script === 'SPOOF') { await call('pankeki_status', {}, 'toolu_never_shown'); text('x'); return result(); }
  if (script === 'EARLY') {
    const pending = call('pankeki_status', {}, 'toolu_early');
    await sleep(100);
    toolUse('toolu_early', TOOL('pankeki_status'), {});
    await pending; text('ok'); return result();
  }
  if (script === 'CRASH') { send({type: 'stream_event', event: {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: 'a'}}, parent_tool_use_id: null}); await sleep(20); process.exit(3); }
}

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
    if (msg.type === 'test-finish' && scenario === 'cancel-race') finishPendingTurn?.();
    else if (msg.type === 'control_request') {
      const subtype = msg.request.subtype;
      if (subtype === 'interrupt' && scenario === 'interrupt-timeout') continue;
      if (subtype === 'interrupt') interrupted = true;
      const response = subtype === 'initialize' ? {commands: scenario === 'commands' ? [{name: 'review'}] : [], current_permission_mode: 'dontAsk', claude_code_version: '2.1.310',
        models: scenario === 'no-models' ? undefined : [{value: 'default', displayName: 'Default'}, {value: 'opus', displayName: 'Opus'}, {value: 'sonnet', displayName: 'Sonnet'}],
        account: {email: 'user@example.com'}} : {};
      send({type: 'control_response', response: {subtype: 'success', request_id: msg.request_id, response}});
      if (subtype === 'interrupt') record({interruptAcknowledged: true});
    } else if (msg.type === 'user') void runTurn(Array.isArray(msg.message.content) ? msg.message.content : String(msg.message.content));
  }
});
process.stdin.on('end', () => { if (!unresponsive) process.exit(0); });
process.on('SIGTERM', () => { if (!unresponsive) process.exit(0); });

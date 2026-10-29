'use strict';
// Claude Code CLI bridge for the Pankeki desktop app (personal local use).
//
// Runs `claude -p` in stream-json mode as a child that reuses the user's
// existing claude.ai sign-in (no API keys, no token handling, no settings
// writes). Built-in tools, user/project settings, hooks, plugins, slash commands
// and every MCP server except the bridge's own are switched off by child-only
// flags, and each session's init report is checked before anything is
// forwarded. The model only sees the six Pankeki tools, served by a
// token-protected MCP endpoint on 127.0.0.1 inside this process and executed
// through pankeki-tools.cjs, so file paths never reach the remote model.
// Same public contract and events as codex-bridge.cjs. Verified against
// Claude Code 2.1.310 (output/desktop-codex-20261024/claude-provider).
const {spawn} = require('node:child_process');
const platformInfo = require('./platform.cjs');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {createToolRunner, createToolSchemas, BridgeError, TOOLS, TOOL_NAMES, ACTION, INSTRUCTIONS, MAX_TEXT, ID, redact, forModel, opaque, childEnv, stopProcess, generationSettingsFromMessage,automaticFromMessage,resolveAutomaticChat,reserveAutomaticSubmission,failAutomaticSubmission,automaticNote,sourceImageBytes,resultImageBytes,imageForModel: defaultImageForModel} = require('./pankeki-tools.cjs');

const PROTOCOL_VERSION = 2;
const SERVER = 'pankeki';
const MODEL_TOOLS = TOOL_NAMES.map(name => `mcp__${SERVER}__${name}`);
const MAX_BODY = 1024 * 1024;
const JOB_NOTE = 'pankeki_job waits up to 20 seconds for the job to finish. Keep calling it until the state is succeeded, failed or canceled, then call pankeki_result for a succeeded job. Do not end your reply while a job you started is still queued or running.';

function defaultClaudePath() {
  if (process.platform === 'win32') return platformInfo.findCli('claude');
  const home = process.env.HOME || '';
  for (const candidate of [path.join(home, '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']) {
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch {}
  }
  return null;
}

function sessionArgs(configFile, model) {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--tools', '', '--strict-mcp-config', '--mcp-config', configFile, '--allowedTools', MODEL_TOOLS.join(','),
    '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--setting-sources', '', '--disable-slash-commands',
    '--no-session-persistence', '--no-chrome', '--system-prompt', INSTRUCTIONS + ' ' + JOB_NOTE];
  if (model) args.push('--model', model);
  return args;
}

// Fails closed on anything beyond the six Pankeki tools.
function checkInit(init) {
  const problems = [];
  const tools = Array.isArray(init.tools) ? [...init.tools].sort() : null;
  if (!tools || tools.join(',') !== [...MODEL_TOOLS].sort().join(',')) problems.push('tools: ' + (tools || []).filter(t => !MODEL_TOOLS.includes(t)).join(', '));
  const servers = Array.isArray(init.mcp_servers) ? init.mcp_servers : [];
  if (servers.length !== 1 || servers[0].name !== SERVER || servers[0].status !== 'connected') problems.push('MCP servers: ' + servers.map(s => s.name).join(', '));
  if (init.apiKeySource !== 'none') problems.push('API key in use');
  if (init.permissionMode !== 'dontAsk') problems.push('permission mode ' + init.permissionMode);
  if ((init.slash_commands || []).length || (init.skills || []).length) problems.push('skills or commands are enabled');
  if ((init.plugins || []).some(p => !String(p.source || '').endsWith('@builtin'))) problems.push('user plugins are enabled');
  return problems;
}

function limitMessage(info) {
  const at = info && Number.isFinite(info.resetsAt) ? new Date(info.resetsAt * 1000).toLocaleString('en-US', {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'}) : null;
  return 'Claude usage limit reached.' + (at ? ` Try again at ${at}.` : '');
}

function createClaudeBridge({projectRoot, claudePath, onEvent, resolveEditContext, pankekiBaseUrl = 'http://127.0.0.1:8190', dataDir, inputRoot,
  mcpStateDir, mcpPython, mcpCommand, model = 'sonnet', log = () => {}, spawnImpl = spawn, timeouts = {}, clientVersion = '0.1.0', getCapabilities, imageForModel = defaultImageForModel} = {}) {
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) throw new BridgeError('invalid-config', 'projectRoot must be absolute');
  if (typeof onEvent !== 'function') throw new BridgeError('invalid-config', 'onEvent is required');
  if (resolveEditContext !== undefined && typeof resolveEditContext !== 'function') throw new BridgeError('invalid-config', 'resolveEditContext must be a function');
  if (!/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(pankekiBaseUrl)) throw new BridgeError('invalid-config', 'pankekiBaseUrl must be http://127.0.0.1:<port>');
  const limits = {request: 30000, tool: 60000, turn: 15 * 60000, close: 3000, drain: 10000, toolUse: 3000, jobWait: 20000, jobPoll: 1500, ...timeouts};
  const root = dataDir || path.join(projectRoot, 'runtime/desktop-codex');
  const paths = {
    work: path.join(root, 'claude-work'),
    inputs: inputRoot || path.join(projectRoot, 'runtime/desktop-codex/inputs'),
    // pankeki_mcp.py only accepts a state dir under <app-root>/runtime, whatever dataDir is.
    state: mcpStateDir || path.join(projectRoot, 'runtime/desktop-codex/mcp-state'),
    launcher: path.join(projectRoot, 'plugins/pankeki-local/scripts/launch.py'),
    mcpPython: mcpPython || path.join(projectRoot, ...platformInfo.layout(process.platform).mcpPython.split('/'))
  };
  const claude = claudePath === undefined ? defaultClaudePath() : claudePath;
  // Windows npm installs are .cmd shims; launchSpec turns them into `node cli.js` so the empty
  // `--tools ''` argument survives (a shell would drop it).
  const claudeLaunch = platformInfo.launchSpec(claude);
  const spawnClaude = (args, options) => spawnImpl(claudeLaunch.command, [...claudeLaunch.args, ...args], {...options, ...(process.platform === 'win32' ? {windowsHide: true} : {})});
  const {normalizeModels, validModelId} = require('./chat-model-settings.cjs');
  let modelCatalog = [], modelSource = null, modelChanging = false;

  let server = null, token = null, configFile = null, session = null, closing = false, epoch = 0, active = null;
  const state = {state: 'idle', provider: 'claude', version: null, authMode: null, toolsReady: false, activeRequestId: null, lastError: null};

  const snapshot = () => ({...state, activeRequestId: active ? active.requestId : null});
  function emit(type, payload = {}, ref = active) {
    try { onEvent({requestId: ref ? ref.requestId : null, projectId: ref ? ref.projectId : null, sourceRevision: ref ? ref.sourceRevision : null, type, payload}); }
    catch (error) { log('onEvent threw: ' + redact(error.message)); }
  }
  function setState(next, error) {
    state.state = next;
    if (error) state.lastError = {code: error.code || 'error', message: redact(error.message)};
    emit('status', snapshot(), null);
  }
  const current = ref => active === ref && !ref.canceled && ref.epoch === epoch;
  const tools = createToolRunner({projectRoot, paths, pankekiBaseUrl, resolveEditContext, mcpCommand, spawnImpl, limits, emit, current, log, clientVersion,getCapabilities});

  // ---- MCP endpoint for the CLI (streamable HTTP, JSON responses only) ----
  function startServer() {
    token = crypto.randomBytes(32).toString('hex');
    server = http.createServer((req, res) => {
      const reply = (status, body) => { res.writeHead(status, body ? {'content-type': 'application/json'} : {}); res.end(body ? JSON.stringify(body) : undefined); };
      if (req.headers.authorization !== `Bearer ${token}` || req.url !== '/mcp') return reply(401);
      if (req.method !== 'POST') return reply(405);
      let body = '', size = 0;
      req.setEncoding('utf8');
      req.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) req.destroy(); else body += chunk; });
      req.on('end', () => {
        let message;
        try { message = JSON.parse(body); } catch { return reply(400); }
        if (!message || message.id === undefined) return reply(202);
        const answer = result => reply(200, {jsonrpc: '2.0', id: message.id, result});
        if (message.method === 'initialize') return answer({protocolVersion: message.params && message.params.protocolVersion, capabilities: {tools: {}}, serverInfo: {name: SERVER, version: clientVersion}});
        if (message.method === 'tools/list') return void Promise.resolve(getCapabilities?getCapabilities():null).then(snapshot=>{const schemas=createToolSchemas(snapshot);answer({tools:TOOL_NAMES.map(name=>({name,description:schemas[name].description,inputSchema:schemas[name].inputSchema}))});}).catch(()=>reply(200,{jsonrpc:'2.0',id:message.id,error:{code:-32603,message:'Image capability snapshot unavailable'}}));
        if (message.method === 'tools/call') return void onToolCall(message.params || {}).then(answer);
        reply(200, {jsonrpc: '2.0', id: message.id, error: {code: -32601, message: 'Not supported by the Pankeki bridge'}});
      });
    });
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        configFile = path.join(paths.work, `mcp-${crypto.randomBytes(8).toString('hex')}.json`);
        const config = {mcpServers: {[SERVER]: {type: 'http', url: `http://127.0.0.1:${server.address().port}/mcp`, headers: {Authorization: `Bearer ${token}`}}}};
        fs.writeFileSync(configFile, JSON.stringify(config), {mode: 0o600});
        resolve();
      });
    });
  }

  async function stopServer() {
    if (configFile) { try { fs.unlinkSync(configFile); } catch {} configFile = null; }
    const s = server;
    server = null; token = null;
    if (s) await new Promise(resolve => { s.close(() => resolve()); s.closeAllConnections(); });
  }

  // A tool call is honoured only for the current turn, once the CLI has shown
  // the matching tool_use block on stdout.
  function seenToolUse(ref, id) {
    if (ref.toolUses.has(id)) return Promise.resolve(true);
    return new Promise(resolve => {
      const timer = setTimeout(() => { ref.waiters.delete(id); resolve(false); }, limits.toolUse);
      ref.waiters.set(id, () => { clearTimeout(timer); resolve(true); });
    });
  }

  async function onToolCall(params) {
    const fail = text => ({isError: true, content: [{type: 'text', text}]});
    const ref = active;
    const tool = params.name;
    const useId = params._meta && params._meta['claudecode/toolUseId'];
    if (!ref || !current(ref) || !session || !session.verified || session.projectId !== ref.projectId) return fail('This request is no longer active.');
    if (!TOOL_NAMES.includes(tool)) { policyViolation(ref, 'Claude tried an unknown tool.'); return fail('Unknown tool.'); }
    if (typeof useId !== 'string' || !(await seenToolUse(ref, useId)) || !current(ref)) return fail('This request is no longer active.');
    let permit;
    try {
      permit = reserveAutomaticSubmission(ref,tool,params.arguments,emit);
      if (!current(ref)) return fail('This request was canceled.');
      emit('tool-started', {tool}, ref);
      const {payload, data} = await tools.runTool(ref, tool, params.arguments,permit);
      if (!current(ref)) return fail('This request was canceled.');
      emit('tool-completed', {...payload, ok: true}, ref);
      const content = [{type: 'text', text: JSON.stringify(forModel(tool, data))}];
      if (tool === 'pankeki_result' && data && data.state === 'succeeded' && data.job_id === payload.jobId) {
        const image = imageForModel(await resultImageBytes(payload.jobId, {pankekiBaseUrl}));
        if (image) content.push({type: 'image', data: image.data, mimeType: image.mimeType});
      }
      return {content};
    } catch (error) {
      if(current(ref))failAutomaticSubmission(ref,permit,error,emit);
      if (current(ref)) emit('tool-completed', {tool, ok: false, error: redact(error.message)}, ref);
      return fail(redact(error.message));
    }
  }

  // ---- CLI sessions (one live conversation, bound to one project) ----
  function control(s, request) {
    const id = 'pk-' + crypto.randomBytes(6).toString('hex');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { s.pending.delete(id); reject(new BridgeError('timeout', request.subtype + ' timed out')); }, limits.request);
      s.pending.set(id, {resolve, reject, timer});
      try { write(s, {type: 'control_request', request_id: id, request}); } catch (error) { clearTimeout(timer); s.pending.delete(id); reject(error); }
    });
  }

  function write(s, message) {
    if (!s.proc.stdin.writable) throw new BridgeError('not-connected', 'Claude is not running');
    s.proc.stdin.write(JSON.stringify(message) + '\n');
  }

  async function startSession() {
    const proc = spawnClaude(sessionArgs(configFile, model), {cwd: paths.work, env: childEnv(process.env), stdio: ['pipe', 'pipe', 'pipe']});
    const s = {proc, projectId: null, verified: false, pending: new Map(), buffer: ''};
    session = s;
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', chunk => {
      s.buffer += chunk;
      let i;
      while ((i = s.buffer.indexOf('\n')) >= 0) {
        const line = s.buffer.slice(0, i); s.buffer = s.buffer.slice(i + 1);
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line); } catch { log('claude: non-JSON line ignored'); continue; }
        onMessage(s, message);
      }
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', chunk => log('claude: ' + redact(chunk)));
    proc.on('error', error => { log('spawn error: ' + redact(error.message)); onExit(s, null, 'spawn-error'); });
    proc.on('exit', (code, signal) => onExit(s, code, signal));
    const info = await control(s, {subtype: 'initialize'});
    if (!info || (info.commands || []).length || info.current_permission_mode !== 'dontAsk') throw new BridgeError('isolation', 'Claude started with commands or a different permission mode');
    if (typeof info.claude_code_version === 'string') state.version = info.claude_code_version.slice(0, 40);
    modelCatalog = normalizeModels('claude', info.models);
    modelSource = modelCatalog.length ? 'claude-initialize' : null;
    return s;
  }

  async function getModels() {
    if (modelChanging || active || state.state === 'starting') throw new BridgeError('busy', 'Claude is busy');
    if (state.state !== 'ready') throw new BridgeError('not-ready', 'Claude is not ready');
    if (!modelSource) {
      // Older CLIs can omit initialize.models. Only aliases actually printed by
      // this installed executable's --help may be used as a fallback.
      if (!state.version) throw new BridgeError('model-list-failed', 'Claude version is unknown');
      const help = await new Promise((resolve, reject) => {
        let text = '', proc, tooLarge = false;
        try { proc = spawnClaude(['--help'], {cwd: paths.work, env: childEnv(process.env), stdio: ['ignore', 'pipe', 'pipe']}); }
        catch { reject(new BridgeError('model-list-failed', 'Claude help is unavailable')); return; }
        const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new BridgeError('model-list-failed', 'Claude help timed out')); }, limits.request);
        proc.stdout.setEncoding('utf8'); proc.stdout.on('data', chunk => { if (tooLarge) return; text += chunk; if (text.length > 65536) { tooLarge = true; text = ''; proc.kill('SIGKILL'); } });
        proc.stderr.on('data', () => {});
        proc.on('error', () => { clearTimeout(timer); reject(new BridgeError('model-list-failed', 'Claude help is unavailable')); });
        proc.on('close', () => { clearTimeout(timer); resolve(text); });
      });
      const section = help.match(/--model\s+<model>([\s\S]*?)(?=\n\s{2}--|\n\s{2}-[A-Za-z],|$)/)?.[1] || '';
      const aliases = [...section.matchAll(/'([A-Za-z][A-Za-z0-9_-]{0,30})'/g)].map(match => ({value: match[1], displayName: match[1]}));
      modelCatalog = normalizeModels('claude', aliases);
      if (!modelCatalog.length) throw new BridgeError('model-list-failed', 'No supported model catalog');
      modelSource = 'claude-help';
    }
    return {source: modelSource, models: modelCatalog};
  }
  async function setModel({modelId} = {}) {
    if (!validModelId(modelId)) throw new BridgeError('invalid-input', 'Invalid model id');
    if (modelChanging || active || state.state === 'starting') throw new BridgeError('busy', 'Claude is busy');
    if (!modelCatalog.some(item => item.id === modelId)) throw new BridgeError('unknown-model', 'Choose a listed model');
    if (model === modelId) return;
    modelChanging = true;
    try { await stopSession(); model = modelId; epoch++; }
    finally { modelChanging = false; }
  }

  async function stopSession() {
    const s = session;
    session = null;
    if (!s) return;
    for (const entry of s.pending.values()) { clearTimeout(entry.timer); entry.reject(new BridgeError('exited', 'Claude stopped')); }
    s.pending.clear();
    try { await stopProcess(s.proc, limits.close); }
    catch (error) {
      // Still running: keep the session so no second Claude starts and the model is not switched.
      if (s.proc.exitCode === null && s.proc.signalCode === null && session === null) session = s;
      setState('error', new BridgeError('stop-failed', 'Claude could not be stopped'));
      throw new BridgeError('stop-failed', 'Claude could not be stopped');
    }
  }

  function onExit(s, code, signal) {
    for (const entry of s.pending.values()) { clearTimeout(entry.timer); entry.reject(new BridgeError('exited', 'Claude exited')); }
    s.pending.clear();
    if (session !== s) return;
    session = null;
    if (active) finishTurn(active, 'failed', {message: 'Claude stopped'});
    if (!closing && state.state !== 'error') setState('ready');
    log(`claude exited (${signal || code})`);
  }

  function onMessage(s, message) {
    if (message.type === 'control_response') {
      const response = message.response || {};
      const entry = s.pending.get(response.request_id);
      if (!entry) return;
      s.pending.delete(response.request_id); clearTimeout(entry.timer);
      if (response.subtype === 'success') entry.resolve(response.response || {});
      else entry.reject(new BridgeError('claude', redact(response.error || 'control request failed')));
      return;
    }
    if (message.type === 'control_request') {
      // Nothing should ask the host anything; refuse whatever it is.
      try { write(s, {type: 'control_response', response: {subtype: 'error', request_id: message.request_id, error: 'Not supported by the Pankeki bridge'}}); } catch {}
      return;
    }
    if (session !== s) return;
    const ref = active;
    if (message.type === 'system' && message.subtype === 'init') {
      const problems = checkInit(message);
      if (problems.length) return isolationFailure(problems);
      s.verified = true;
      return;
    }
    if (!ref || ref.epoch !== epoch || s.projectId !== ref.projectId) return;
    if (message.type === 'rate_limit_event') {
      const info = message.rate_limit_info || {};
      if (info.status === 'rejected') ref.limit = info;
      return;
    }
    if (message.type === 'result') return onResult(ref, message);
    if (!s.verified) return isolationFailure(['output before the session was verified']);
    if (ref.canceled) return;
    if (message.type === 'stream_event') {
      const event = message.event || {};
      if (!message.parent_tool_use_id && event.type === 'content_block_delta' && event.delta && event.delta.type === 'text_delta') emit('message-delta', {text: String(event.delta.text || '')}, ref);
      return;
    }
    if (message.type === 'assistant' && message.message && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (block.type === 'tool_use') {
          if (!MODEL_TOOLS.includes(block.name)) return policyViolation(ref, 'Claude tried to use ' + String(block.name).slice(0, 60) + ', which Pankeki does not allow.');
          ref.toolUses.add(block.id);
          const waiter = ref.waiters.get(block.id);
          if (waiter) { ref.waiters.delete(block.id); waiter(); }
        } else if (block.type === 'text' && block.text) emit('message', {text: String(block.text)}, ref);
      }
    }
  }

  // Runs a tool for the app (not for the model) with the same events as a model call.
  async function appTool(ref, tool, args) {
    emit('tool-started', {tool}, ref);
    try {
      const {payload, data} = await tools.runTool(ref, tool, args);
      if (current(ref)) emit('tool-completed', {...payload, ok: true}, ref);
      return data;
    } catch (error) {
      if (current(ref)) emit('tool-completed', {tool, ok: false, error: redact(error.message)}, ref);
      return null;
    }
  }

  // The model may end its reply before a job it started has finished. The bridge
  // then waits for the job and fetches its result itself, so the app still gets
  // the image; the turn completes afterwards. Cancel and the turn timeout apply.
  async function settle(ref) {
    ref.settling = true;
    for (const jobId of tools.unsettledJobs(ref)) {
      while (current(ref)) {
        const job = await appTool(ref, 'pankeki_job', {job_id: jobId});
        if (!job || !current(ref)) break;
        if (job.state === 'succeeded') { await appTool(ref, 'pankeki_result', {job_id: jobId}); break; }
        if (!['queued', 'submitting', 'running'].includes(job.state)) break;
      }
    }
    if (active === ref) finishTurn(ref, ref.canceled ? 'interrupted' : 'completed');
  }

  function onResult(ref, message) {
    if (ref.settling) return;
    if (ref.canceled) return finishTurn(ref, 'interrupted');
    if (message.subtype === 'success' && !message.is_error) {
      if (tools.unsettledJobs(ref).length) return void settle(ref);
      return finishTurn(ref, 'completed');
    }
    if (ref.interrupted) return finishTurn(ref, 'failed');   // policy stop, already reported
    const text = [message.result, ...(message.errors || [])].filter(v => typeof v === 'string').join(' ');
    if (ref.limit || /usage limit|rate limit/i.test(text)) emit('error', {code: 'rate-limit', message: limitMessage(ref.limit)}, ref);
    else emit('error', {code: 'claude', message: redact(text || 'Claude could not finish the reply')}, ref);
    finishTurn(ref, 'failed');
  }

  function isolationFailure(problems) {
    const error = new BridgeError('isolation', 'Claude session was not isolated: ' + problems.join('; '));
    if (active) { emit('error', {code: 'policy', message: error.message}, active); finishTurn(active, 'failed'); }
    state.toolsReady = false;
    setState('error', error);
    void stopSession();
  }

  function policyViolation(ref, reason) {
    if (!current(ref)) return;
    emit('error', {code: 'policy', message: reason}, ref);
    interrupt(ref);
  }

  // Both interrupt failure and an ACK without a final result retire only the
  // session that owns this turn. A late callback must never stop a newer turn.
  async function stopInterruptedTurn(ref, s) {
    if (active !== ref || ref.epoch !== epoch || session !== s) return;
    clearTimeout(ref.interruptTimer);
    await stopSession();
    if (active === ref && ref.epoch === epoch) finishTurn(ref, ref.canceled ? 'interrupted' : 'failed');
  }

  function interrupt(ref, s = session) {
    if (active !== ref || ref.epoch !== epoch || session !== s || !s || !ref.sent || ref.interrupted) return;
    ref.interrupted = true;
    control(s, {subtype: 'interrupt'}).catch(() => stopInterruptedTurn(ref, s));
    ref.interruptTimer = setTimeout(() => { void stopInterruptedTurn(ref, s); }, limits.request);
  }

  function finishTurn(ref, status, error) {
    if (active !== ref) return;
    if (status === 'completed' && !ref.canceled && (ref.autoSubmissionFailed||ref.autoResultFailed||ref.jobOrphaned)) status='failed';
    if (status === 'completed' && !ref.canceled) resolveAutomaticChat(ref,emit);
    clearTimeout(ref.timer);
    clearTimeout(ref.interruptTimer);
    for (const waiter of ref.waiters.values()) waiter();
    ref.waiters.clear();
    active = null;
    emit('turn-completed', {status: ref.canceled && status !== 'failed' ? 'interrupted' : status, error: error && error.message ? redact(error.message) : null}, ref);
    if (state.state === 'busy') setState('ready');
  }

  // Reads only the login method; the account email is never kept.
  function authStatus() {
    return new Promise(resolve => {
      let out = '';
      let proc;
      try { proc = spawnClaude(['auth', 'status'], {cwd: paths.work, env: childEnv(process.env), stdio: ['ignore', 'pipe', 'pipe']}); }
      catch { return resolve(null); }
      const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, limits.request);
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', chunk => { out += chunk; });
      proc.stderr.on('data', () => {});
      proc.on('error', () => { clearTimeout(timer); resolve(null); });
      proc.on('close', () => {
        clearTimeout(timer);
        try { const s = JSON.parse(out); resolve({loggedIn: s.loggedIn === true, authMethod: s.authMethod, apiProvider: s.apiProvider}); }
        catch { resolve(null); }
      });
    });
  }

  async function connect() {
    if (modelChanging) throw new BridgeError('busy', 'Claude is changing model');
    if (session && state.toolsReady) return snapshot();
    closing = false;
    if (!claudeLaunch) { setState('missing', new BridgeError('missing', 'Claude is not installed')); return snapshot(); }
    for (const dir of [paths.work, paths.inputs]) fs.mkdirSync(dir, {recursive: true});
    setState('starting');
    try {
      const auth = await authStatus();
      if (!auth) { setState('missing', new BridgeError('missing', 'Claude could not start')); return snapshot(); }
      state.authMode = auth.loggedIn && auth.authMethod === 'claude.ai' && auth.apiProvider === 'firstParty' ? 'claude' : null;
      if (!state.authMode) {
        setState(auth.loggedIn ? 'error' : 'signed-out', new BridgeError(auth.loggedIn ? 'unsupported-auth' : 'signed-out', auth.loggedIn ? 'Only the claude.ai sign-in is supported' : 'Sign in to Claude first'));
        return snapshot();
      }
      if (!server) await startServer();
      if (!session) await startSession();
      state.toolsReady = true;
      setState('ready');
    } catch (error) {
      await close();
      setState('error', error instanceof BridgeError ? error : new BridgeError('claude', error.message));
    }
    return snapshot();
  }

  // context: {contextId?, sourceRevision?} — opaque app ids; paths stay in the app.
  // The first line of text may be `[Pankeki action: chat|generate|edit]`.
  async function send({text, projectId, requestId, context, automatic} = {}) {
    if (modelChanging) throw new BridgeError('busy', 'Claude is changing model');
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) throw new BridgeError('invalid-input', 'text must be 1..' + MAX_TEXT + ' characters');
    if (!ID.test(projectId || '') || !ID.test(requestId || '')) throw new BridgeError('invalid-input', 'projectId and requestId must match ' + ID);
    const contextId = context && context.contextId !== undefined && context.contextId !== null ? opaque(context.contextId, 'contextId') : null;
    const sourceRevision = context && context.sourceRevision !== undefined && context.sourceRevision !== null ? opaque(context.sourceRevision, 'sourceRevision') : null;
    if (contextId && !sourceRevision) throw new BridgeError('invalid-input', 'sourceRevision is required with contextId');
    if (state.state !== 'ready') throw new BridgeError(active ? 'busy' : 'not-ready', 'Claude is ' + state.state);
    const auto = automaticFromMessage(text,automatic,{sourceRevision,contextId});
    fs.mkdirSync(path.join(paths.inputs, projectId), {recursive: true});
    epoch++;
    const first = ACTION.exec(text.split('\n', 1)[0].trim());
    const ref = {requestId, projectId, contextId, sourceRevision, action: first ? first[1] : 'chat', automatic:auto, generationSettings:generationSettingsFromMessage(text), epoch, jobs: new Set(), toolUses: new Set(), waiters: new Map(),
      timer: null, interruptTimer: null, canceled: false, interrupted: false, sent: false, limit: null};
    active = ref;
    setState('busy');
    const note = auto ? automaticNote(auto) : contextId ? 'The user has selected an image and a mask in the app; pankeki_edit will use them.' : 'No image source is bound to this request. Do not invent an edit source.';
    try {
      // One conversation per project: a different project starts a fresh session.
      if (session && session.projectId && session.projectId !== projectId) await stopSession();
      if (!session) await startSession();
      const image = imageForModel(await sourceImageBytes(ref, {resolveEditContext, inputRoot: paths.inputs}));
      if (active !== ref) return {requestId};
      if (ref.canceled) { finishTurn(ref, 'interrupted'); return {requestId}; }
      session.projectId = projectId;
      ref.timer = setTimeout(() => { emit('error', {code: 'timeout', message: 'Claude took too long'}, ref); cancel({requestId}); }, limits.turn);
      const prompt = text + '\n\n[Pankeki] ' + note;
      write(session, {type: 'user', message: {role: 'user', content: image ? [{type: 'text', text: prompt}, {type: 'image', source: {type: 'base64', media_type: image.mimeType, data: image.data}}] : prompt}});
      ref.sent = true;
      emit('turn-started', {}, ref);
    } catch (error) {
      if (active === ref) {
        clearTimeout(ref.timer);
        active = null;
        emit('error', {code: error.code || 'claude', message: redact(error.message)}, ref);
        if (state.state === 'busy') setState('ready');
      }
      throw error;
    }
    return {requestId};
  }

  async function cancel({requestId} = {}) {
    const ref = active;
    if (!ref || (requestId && ref.requestId !== requestId) || ref.canceled) return false;
    const s = session;
    ref.canceled = true;
    emit('status', {...snapshot(), canceling: true}, ref);
    // Logical discard through the adapter's own ledger; GPU work may continue.
    await tools.cancelJobs(ref);
    if (active === ref && ref.epoch === epoch && session === s && ref.sent && !ref.settling) interrupt(ref, s);
    return true;
  }

  // Returns {unconfirmedSubmissions}: submits still unanswered after the drain
  // window. Those may have been accepted by Pankeki without a logical cancel.
  async function close() {
    closing = true;
    if (active) { active.canceled = true; finishTurn(active, 'interrupted', {message: 'Bridge closed'}); }
    const unconfirmedSubmissions = await tools.close();
    state.toolsReady = false;
    await Promise.all([stopSession(), stopServer()]);
    if (state.state !== 'missing') state.state = 'idle';
    return {unconfirmedSubmissions};
  }

  return {status: snapshot, connect, send, cancel, close, getModels, setModel, getSubmittedRequest: tools.getSubmittedRequest, getResultDescriptor: tools.getResultDescriptor,
    protocolVersion: PROTOCOL_VERSION, _debug: {sessionArgs, paths, checkInit}};
}

module.exports = {createClaudeBridge, BridgeError, MODEL_TOOLS, PROTOCOL_VERSION};

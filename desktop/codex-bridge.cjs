'use strict';
// Codex App Server stdio bridge for the Pankeki desktop app.
//
// Spawns `codex app-server` as a child that reuses the user's existing Codex
// ChatGPT sign-in (no API keys, no token handling, no global config writes).
// Everything that could reach outside Pankeki is switched off with child-only
// `-c` / `--disable` overrides, and the child gets no MCP servers at all. The
// model only sees six dynamic tools (experimental `dynamicTools`) whose
// arguments never contain file paths. The bridge executes them locally by acting
// as an MCP client of the existing Pankeki adapter (plugins/pankeki-local), so
// source/mask paths are resolved through the app's resolver and never reach the
// remote model. Verified against codex-cli 0.164.0 (output/desktop-codex-20261024/claude).
const {spawn} = require('node:child_process');
const platformInfo = require('./platform.cjs');
const fs = require('node:fs');
const path = require('node:path');
const {TOOLS,createToolSchemas,authorizeTool,normalizedCapabilities,INSTRUCTIONS,generationSettingsFromMessage,automaticFromMessage,resolveAutomaticChat,reserveAutomaticSubmission,consumeAutomaticSubmission,failAutomaticSubmission,bindAutomaticSettings,automaticOwnsJob,automaticNote,sourceImageBytes,resultImageBytes,imageForModel: defaultImageForModel} = require('./pankeki-tools.cjs');

const PROTOCOL_VERSION = 2;
const MCP_PROTOCOL = '2025-06-18';
// Child-only feature switches (`codex features list`, 0.164.0). `code_mode_host`
// stays on: the 0.164.0 tool router dispatches tool calls through it.
const DISABLED_FEATURES = ['shell_tool', 'unified_exec', 'unified_exec_tty', 'shell_snapshot', 'apps', 'plugins', 'remote_plugin',
  'plugin_sharing', 'browser_use', 'browser_use_external', 'in_app_browser', 'computer_use', 'hooks', 'memories', 'chronicle',
  'multi_agent', 'image_generation', 'view_image', 'skill_mcp_dependency_install', 'skill_search', 'tool_suggest', 'goals',
  'workspace_dependencies', 'in_app_local_automation'];
const FORBIDDEN_ITEMS = new Set(['commandExecution', 'fileChange', 'webSearch', 'imageGeneration', 'imageView',
  'collabAgentToolCall', 'subAgentActivity', 'mcpToolCall']);
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const JOB = /^[0-9a-f]{32}$/;
const MAX_TEXT = 8000;
const JOB_STATUSES = new Set(['queued', 'submitting', 'running', 'canceling', 'canceled', 'succeeded', 'failed', 'uncertain', 'orphaned']);

const TOOL_NAMES = Object.keys(TOOLS);
// Leading action line written by the app's message formatter. Only the first
// line counts; it limits which submitting tool this request may run.
const ACTION = /^\[Pankeki action: (chat|generate|edit)\]$/;
const SUBMITS = {chat: [], generate: ['pankeki_generate'], edit: ['pankeki_edit']};
const TERMINAL = new Set(['canceled', 'succeeded', 'failed', 'orphaned']);
// Keys never forwarded from the adapter (paths, manifests, provenance, raw recipes).
const PRIVATE_KEY = /path|dir|file|root|manifest|sha|hash|snapshot|ledger|provenance|recipe|config|session|api_url|health/i;

class BridgeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// TOML inline value for `-c key=value`; JSON strings are valid TOML basic strings.
function toml(value) {
  if (Array.isArray(value)) return '[' + value.map(toml).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).map(([k, v]) => JSON.stringify(k) + '=' + toml(v)).join(',') + '}';
  return JSON.stringify(value);
}

function redact(text) {
  return String(text).replace(/[A-Za-z0-9_\-.]{32,}/g, '<redacted>').replace(/(?:\/(?:Users|Volumes|private|var|tmp)\/|~\/)[^\s"']*/g, '<local path>').slice(0, 2000);
}

// Strip private keys and path-like strings from adapter data.
function scrub(value, depth = 0) {
  if (depth > 5) return null;
  if (typeof value === 'string') return /^(\/|~\/|[A-Za-z]:\\)/.test(value) ? '<local file>' : redact(value).slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 20).map(v => scrub(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, v] of Object.entries(value)) if (!PRIVATE_KEY.test(key)) out[key] = scrub(v, depth + 1);
    return out;
  }
  return value;
}

// Minimal tool result sent to the remote model.
function forModel(tool, data) {
  const d = data && typeof data === 'object' ? data : {};
  if (tool === 'pankeki_status') return {app_reachable: d.app_reachable === true, models: scrub(d.models)};
  const out = {job_id: d.job_id, state: d.state};
  if (typeof d.error === 'string' && d.error) out.error = redact(d.error).slice(0, 300);
  if (tool === 'pankeki_result' && Array.isArray(d.dimensions)) out.dimensions = d.dimensions.slice(0, 2);
  return out;
}

function within(root, target) {
  const rel = path.relative(root, target);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function opaque(value, name) {
  if (typeof value !== 'string' || !ID.test(value)) throw new BridgeError('invalid-input', name + ' must match ' + ID);
  return value;
}

function defaultCodexPath() {
  if (process.platform === 'win32') return platformInfo.findCli('codex');
  const home = process.env.HOME || '';
  for (const candidate of [path.join(home, '.local/bin/codex'), '/opt/homebrew/bin/codex', '/usr/local/bin/codex']) {
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch {}
  }
  return null;
}

function childArgs(disabledSkills = [], disabledMcpCommand) {
  const args = ['app-server'];
  for (const feature of DISABLED_FEATURES) args.push('--disable', feature);
  const config = {web_search: 'disabled', notify: [], approval_policy: 'never', sandbox_mode: 'read-only', 'skills.bundled.enabled': false};
  // An enabled-only override can create an invalid transport for an absent server.
  // A complete disabled definition parses on Windows and cannot launch a tool.
  for (const name of ['node_repl','pankeki-local']) config[`mcp_servers.${name}`] = {command:disabledMcpCommand,enabled:false};
  // User skills cannot be switched off as a group; connect() lists them and
  // restarts the child once with each one disabled by name.
  if (disabledSkills.length) config['skills.config'] = disabledSkills.map(name => ({name, enabled: false}));
  for (const [key, value] of Object.entries(config)) args.push('-c', key + '=' + toml(value));
  return args;
}

// Environment for children: no API keys, so Codex uses its managed ChatGPT login.
function childEnv(base, extra = {}) {
  if (process.platform === 'win32') return {...platformInfo.minimalEnv(base, 'win32'), ...extra};
  const env = {};
  for (const key of ['HOME', 'PATH', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'SHELL']) if (base[key]) env[key] = base[key];
  return {...env, ...extra};
}

// Newline-delimited JSON-RPC over a child's stdio (Codex app-server and MCP stdio).
function rpc(proc, {onRequest, onNotification, log, label}) {
  let buffer = '', nextId = 1;
  const pending = new Map();
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', chunk => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { log(label + ': non-JSON line ignored'); continue; }
      if (message.id !== undefined && message.method) onRequest(message);
      else if (message.id !== undefined) {
        const entry = pending.get(message.id);
        if (!entry) continue;
        pending.delete(message.id); clearTimeout(entry.timer);
        if (message.error) entry.reject(new BridgeError(label, entry.method + ': ' + redact(message.error.message || 'error')));
        else entry.resolve(message.result);
      } else if (message.method) onNotification(message);
    }
  });
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', chunk => log(label + ': ' + redact(chunk)));
  const write = message => {
    if (!proc.stdin.writable) throw new BridgeError('not-connected', label + ' is not running');
    proc.stdin.write(JSON.stringify(message) + '\n');
  };
  return {
    write,
    request(method, params, timeout) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new BridgeError('timeout', method + ' timed out')); }, timeout);
        pending.set(id, {resolve, reject, timer, method});
        try { write({jsonrpc: label === 'mcp' ? '2.0' : undefined, id, method, params}); } catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
      });
    },
    failAll(error) { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); } pending.clear(); }
  };
}

async function stopProcess(proc, ms) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  // Signals are emulated on Windows and would end only the launcher; stop the whole tree and reject
  // (code process-not-stopped) if it is still alive, so the caller keeps its handle.
  if (process.platform === 'win32') return platformInfo.stopProcessTree(proc, ms);
  await new Promise(resolve => {
    const kill = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, ms);
    proc.once('exit', () => { clearTimeout(kill); resolve(); });
    try { proc.stdin.end(); proc.kill('SIGTERM'); } catch { clearTimeout(kill); resolve(); }
  });
}

function createCodexBridge({projectRoot, codexPath, onEvent, resolveEditContext, pankekiBaseUrl = 'http://127.0.0.1:8190', dataDir, inputRoot,
  mcpStateDir, mcpPython, mcpCommand, log = () => {}, trace = () => {}, spawnImpl = spawn, timeouts = {}, clientVersion = '0.1.0', getCapabilities, imageForModel = defaultImageForModel} = {}) {
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) throw new BridgeError('invalid-config', 'projectRoot must be absolute');
  if (typeof onEvent !== 'function') throw new BridgeError('invalid-config', 'onEvent is required');
  if (resolveEditContext !== undefined && typeof resolveEditContext !== 'function') throw new BridgeError('invalid-config', 'resolveEditContext must be a function');
  if (!/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(pankekiBaseUrl)) throw new BridgeError('invalid-config', 'pankekiBaseUrl must be http://127.0.0.1:<port>');
  const limits = {request: 30000, tool: 60000, turn: 15 * 60000, close: 3000, drain: 10000, jobPoll: 1500, ...timeouts};
  const root = dataDir || path.join(projectRoot, 'runtime/desktop-codex');
  const paths = {
    work: path.join(root, 'work'),
    inputs: inputRoot || path.join(projectRoot, 'runtime/desktop-codex/inputs'),
    // pankeki_mcp.py only accepts a state dir under <app-root>/runtime, whatever dataDir is.
    state: mcpStateDir || path.join(projectRoot, 'runtime/desktop-codex/mcp-state'),
    launcher: path.join(projectRoot, 'plugins/pankeki-local/scripts/launch.py'),
    mcpPython: mcpPython || path.join(projectRoot, ...platformInfo.layout(process.platform).mcpPython.split('/'))
  };
  const codex = codexPath === undefined ? defaultCodexPath() : codexPath;
  // A plain path (macOS, tests) or a Windows {command,args} launch spec for an npm .cmd shim.
  const codexLaunch = platformInfo.launchSpec(codex);
  const {normalizeModels, validModelId} = require('./chat-model-settings.cjs');
  let modelCatalog = null, modelChoice = null, capabilitySnapshot=null, toolSchemas=TOOLS;

  let child = null, codexRpc = null, closing = false, epoch = 0;
  const threads = new Map();                 // projectId -> threadId
  const mcp = new Map();                     // projectId -> {proc, rpc, ready}
  const ledger = new Map();                  // jobId -> {requestId, projectId, sourceRevision, tool, request, result}
  const inflight = new Set();                // submit sequences (POST + late-job cancel) close() must drain
  let active = null;                         // see send()
  const state = {state: 'idle', codexVersion: null, authMode: null, toolsReady: false, activeRequestId: null, lastError: null};

  const snapshot = () => ({...state, activeRequestId: active ? active.requestId : null});
  function emit(type, payload = {}, ref = active) {
    if(type==='error'&&ref?.automatic){
      const key=JSON.stringify([payload.code,payload.message]);
      ref.autoErrors ||= new Set();if(ref.autoErrors.has(key))return;ref.autoErrors.add(key);
    }
    try { onEvent({requestId: ref ? ref.requestId : null, projectId: ref ? ref.projectId : null, sourceRevision: ref ? ref.sourceRevision : null, type, payload}); }
    catch (error) { log('onEvent threw: ' + redact(error.message)); }
  }
  function setState(next, error) {
    state.state = next;
    if (error) state.lastError = {code: error.code || 'error', message: redact(error.message)};
    emit('status', snapshot(), null);
  }
  const current = ref => active === ref && !ref.canceled && ref.epoch === epoch;
  const request = (method, params, timeout = limits.request) => {
    if (!codexRpc) return Promise.reject(new BridgeError('not-connected', 'Codex is not running'));
    return codexRpc.request(method, params, timeout);
  };

  // ---- local MCP client of the existing Pankeki adapter (one per project) ----
  async function mcpFor(projectId) {
    const existing = mcp.get(projectId);
    if (existing) {
      // An adapter whose initialize failed stays owned until its process is confirmed gone (the 'exit'
      // handler then drops it). While it is still alive, never start a second one beside it.
      if (existing.failed) throw new BridgeError('stop-failed', 'Previous Pankeki tools process is still stopping');
      return existing.ready;
    }
    const inputs = path.join(paths.inputs, projectId);
    fs.mkdirSync(inputs, {recursive: true});
    fs.mkdirSync(paths.state, {recursive: true});
    const spec = mcpCommand ? mcpCommand({inputs, state: paths.state}) : {
      command: paths.mcpPython, args: [paths.launcher, '--input-root', inputs, '--state-dir', paths.state],
      env: {PANKEKI_APP_ROOT: projectRoot, PANKEKI_PYTHON: paths.mcpPython, PANKEKI_API_URL: pankekiBaseUrl}};
    const proc = spawnImpl(spec.command, spec.args, {cwd: paths.work, env: childEnv(process.env, spec.env), stdio: ['pipe', 'pipe', 'pipe'], ...(process.platform === 'win32' ? {windowsHide: true} : {})});
    const client = rpc(proc, {label: 'mcp', log, onNotification() {}, onRequest: m => client.write({jsonrpc: '2.0', id: m.id, error: {code: -32601, message: 'unsupported'}})});
    const entry = {proc, rpc: client};
    proc.on('error', error => { log('mcp spawn error: ' + redact(error.message)); client.failAll(new BridgeError('mcp', 'Pankeki tools could not start')); });
    proc.on('exit', () => { client.failAll(new BridgeError('mcp', 'Pankeki tools stopped')); if (mcp.get(projectId) === entry) mcp.delete(projectId); });
    entry.ready = (async () => {
      await client.request('initialize', {protocolVersion: MCP_PROTOCOL, capabilities: {}, clientInfo: {name: 'pankeki_desktop', version: clientVersion}}, limits.request);
      client.write({jsonrpc: '2.0', method: 'notifications/initialized'});
      return entry;
    })();
    entry.ready.catch(() => {
      entry.failed = true;
      // Keep the entry (and its handle) until the stop is proven; close() retries and reports a live one.
      stopProcess(proc, limits.close).then(() => { if (mcp.get(projectId) === entry) mcp.delete(projectId); },
        error => log('mcp stop failed: ' + redact(error.message)));
    });
    mcp.set(projectId, entry);
    return entry.ready;
  }

  async function callAdapter(projectId, name, args) {
    const entry = await mcpFor(projectId);
    const result = await entry.rpc.request('tools/call', {name, arguments: args}, limits.tool);
    let data = result.structuredContent;
    if (data && typeof data === 'object' && Object.keys(data).length === 1 && data.result !== undefined) data = data.result;
    if (data === undefined || data === null) for (const part of result.content || []) if (part.type === 'text') { try { data = JSON.parse(part.text); } catch { data = {message: part.text}; } }
    if (result.isError) throw new BridgeError('tool', redact((data && data.message) || (result.content || []).map(p => p.text).join(' ') || 'tool error'));
    return data;
  }

  // ---- dynamic tool execution ----
  function jobFor(ref, args) {
    const id = args && args.job_id;
    const entry = typeof id === 'string' && JOB.test(id) ? ledger.get(id) : null;
    if (!entry || entry.projectId !== ref.projectId) throw new BridgeError('tool', 'Unknown job for this conversation');
    return id;
  }

  // The request body the adapter actually POSTed (its own request.json under the
  // state dir), without source/mask image data.
  function submittedRequest(data) {
    try {
      const file = data && data.provenance && data.provenance.request_path;
      if (typeof file !== 'string') return null;
      const real = fs.realpathSync(file);
      if (!within(fs.realpathSync(paths.state), real)) return null;
      const body = JSON.parse(fs.readFileSync(real, 'utf8'));
      const request = body && body.request && typeof body.request === 'object' ? {...body.request} : null;
      if (request) { delete request.source; delete request.mask; delete request.trace_id; }
      return request;
    } catch { return null; }
  }

  function safeMetrics(data) {
    const out = {};
    if (!data || typeof data !== 'object') return out;
    if (Array.isArray(data.dimensions)) [out.width, out.height] = data.dimensions;
    if (data.metrics && typeof data.metrics === 'object') for (const [k, v] of Object.entries(data.metrics)) if (['string', 'number', 'boolean'].includes(typeof v) && !PRIVATE_KEY.test(k)) out[k] = v;
    return out;
  }

  async function adapterCancel(projectId, jobId, ref = null) {
    const entry = ledger.get(jobId);
    if (!entry || TERMINAL.has(entry.state) || entry.cancelRequested) return;
    entry.cancelRequested = true;
    try {
      const data = await callAdapter(projectId, 'pankeki_cancel_job', {job_id: jobId});
      if (data && typeof data.state === 'string') {entry.state = data.state;if(data.state==='orphaned'&&ref)ref.jobOrphaned=true;}
    } catch (error) { log('job cancel failed: ' + redact(error.message)); }
  }

  function ownsJob(ref, jobId, entry = ledger.get(jobId)) {
    return ref.jobs.has(jobId) && entry && entry.requestId === ref.requestId && entry.projectId === ref.projectId && entry.sourceRevision === ref.sourceRevision;
  }

  async function resultFor(ref, jobId, entry) {
    // The live turn, explicit result tools and post-turn settle share one fetch.
    // Keep failures too: a failed verification must not become a silent retry.
    if (!entry.resultTask) entry.resultTask = (async () => {
      const data = await callAdapter(ref.projectId, TOOLS.pankeki_result.mcp, {job_id: jobId});
      if (!current(ref) || ledger.get(jobId) !== entry || !ownsJob(ref, jobId, entry)) throw new BridgeError('stale', 'Request no longer owns this result');
      if (!data || data.job_id !== jobId || data.state !== 'succeeded' || ['failed', 'canceled', 'canceling', 'uncertain', 'orphaned'].includes(entry.state)) throw new BridgeError('result-unavailable', 'The image result could not be verified');
      entry.state = data.state;
      entry.result = {metrics: safeMetrics(data), request: data.request && typeof data.request === 'object' ? scrub(data.request) : null};
      return data;
    })();
    const data = await entry.resultTask;
    if (!current(ref) || ledger.get(jobId) !== entry || !ownsJob(ref, jobId, entry)) throw new BridgeError('stale', 'Request no longer owns this result');
    return data;
  }

  async function runTool(ref, tool, args, permit) {
    if (ref.automatic && !current(ref)) throw new BridgeError('stale','Request is no longer active');
    consumeAutomaticSubmission(ref,tool,permit);
    const spec = TOOLS[tool];
    const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
    for (const key of Object.keys(input)) if (!(key in spec.inputSchema.properties)) throw new BridgeError('tool', 'Unexpected argument ' + key);
    const payload = {tool};
    let data;
    if (tool === 'pankeki_generate' || tool === 'pankeki_edit') {
      if (!SUBMITS[ref.action].includes(tool)) throw new BridgeError('scope', `This ${ref.action} request cannot run ${tool}.`);
      let call = bindAutomaticSettings(ref,tool,{...input});
      if(tool==='pankeki_generate'&&ref.generationSettings)call={...call,...ref.generationSettings};
      authorizeTool(getCapabilities?await getCapabilities():null,tool,call,ref);
      if(!current(ref))throw new BridgeError('stale','Request is no longer active');
      if(tool==='pankeki_edit'&&call.operation!=='recompose'&&call.model_id==='animagine-xl-4.0-opt')throw new BridgeError('scope','Animagine is generation-only');
      if(tool==='pankeki_generate'){
        if(call.sampler!==undefined&&!['euler','euler_ancestral','dpmpp_2m'].includes(call.sampler)||call.scheduler!==undefined&&!['normal','simple','karras'].includes(call.scheduler))throw new BridgeError('tool','Unsupported sampler/scheduler');
      }
      if (tool === 'pankeki_edit') {
        if (!ref.contextId) { emit('needs-input', {reason: 'source'}, ref); throw new BridgeError('needs-input', 'No image or mask is selected in the app'); }
        const resolved = resolveEditContext ? await resolveEditContext({projectId: ref.projectId, requestId: ref.requestId, contextId: ref.contextId, sourceRevision: ref.sourceRevision}) : null;
        if (!current(ref)) throw new BridgeError('stale', 'Request is no longer active');
        if(call.operation==='recompose'&&(!ref.automatic?.recompose?.ready))throw new BridgeError('scope','Source-only recompose requires an app-bound automatic capability');
        const files = checkFiles(ref.projectId, resolved, call.operation!=='recompose');
        if (!files) { emit('needs-input', {reason: resolved && resolved.sourcePath ? 'mask' : 'source'}, ref); throw new BridgeError('needs-input', 'Select an image and paint a mask in the app'); }
        call = {...call, source_path: files.sourcePath,...(call.operation==='recompose'?{}:{mask_path:files.maskPath})};
      }
      if(ref.requestId)call.trace_id=ref.requestId;
      // Tracked as one unit so close() can wait for a late job id and cancel it
      // before the adapter process is stopped.
      const submission = (async () => {
        const result = await callAdapter(ref.projectId, spec.mcp, call);
        const jobId = result && result.job_id;
        if (ref.automatic && (typeof jobId !== 'string' || !JOB.test(jobId))) throw new BridgeError('tool','Image submission did not return an owned job ID');
        if (typeof jobId === 'string' && JOB.test(jobId)) {
          ledger.set(jobId, {requestId: ref.requestId, projectId: ref.projectId, sourceRevision: ref.sourceRevision, tool,
            traceId:ref.requestId,request: submittedRequest(result), state: result.state, result: null});
          ref.jobs.add(jobId);
          payload.jobId = jobId;
          // Canceled while the POST was in flight: discard the late job right away.
          if (!current(ref)) { await adapterCancel(ref.projectId, jobId, ref); throw new BridgeError('stale', 'Request was canceled'); }
        }
        return result;
      })();
      inflight.add(submission);
      submission.then(() => inflight.delete(submission), () => inflight.delete(submission));
      data = await submission;
    } else if (tool === 'pankeki_status') {
      data = await callAdapter(ref.projectId, spec.mcp, {});
      if (data && typeof data.app_reachable === 'boolean') payload.appReachable = data.app_reachable;
    } else {
      const jobId = jobFor(ref, input);
      const entry = ledger.get(jobId);
      if (ref.automatic && tool === 'pankeki_cancel' && !automaticOwnsJob(ref,jobId,entry)) throw new BridgeError('scope','Automatic requests cannot cancel another request job');
      payload.jobId = jobId;
      const ownedResult = tool === 'pankeki_result' && ownsJob(ref, jobId, entry);
      data = ownedResult ? await resultFor(ref, jobId, entry) : await callAdapter(ref.projectId, spec.mcp, {job_id: jobId});
      // A canceled/closed request must not register a late result or update a
      // replacement ledger entry, even when a newer request uses this project.
      if (!current(ref) || ledger.get(jobId) !== entry) throw new BridgeError('stale', 'Request is no longer active');
      if (data && data.job_id !== undefined && data.job_id !== jobId) throw new BridgeError('tool', 'Job response did not match the owned job');
      if (data && typeof data.state === 'string') {entry.state = data.state;if(data.state==='orphaned')ref.jobOrphaned=true;}
      if (ownedResult && !entry.resultPublished) {
        entry.resultPublished = true;
        payload.resultId = jobId;
        payload.previewUrl = `${pankekiBaseUrl}/api/results/${jobId}`;
      }
    }
    if (data && typeof data.state === 'string' && JOB_STATUSES.has(data.state)) payload.jobStatus = data.state;
    return {payload, data};
  }

  function checkFiles(projectId, resolved, requireMask=true) {
    if (!resolved || typeof resolved !== 'object') return null;
    const realDir = fs.realpathSync(path.join(paths.inputs, projectId));
    const out = {};
    for (const key of requireMask?['sourcePath','maskPath']:['sourcePath']) {
      const value = resolved[key];
      if (typeof value !== 'string' || !path.isAbsolute(value)) return null;
      let real;
      try { real = fs.realpathSync(value); } catch { return null; }
      if (!within(realDir, real) || !/\.png$/i.test(real) || !fs.statSync(real).isFile()) return null;
      out[key] = real;
    }
    return out;
  }

  async function onToolCall(message) {
    const {id, params = {}} = message;
    const ref = active;
    const reply = (success, text, image = null) => { try { codexRpc.write({id, result: {success, contentItems: [{type: 'inputText', text}, ...(image ? [{type: 'inputImage', imageUrl: `data:${image.mimeType};base64,${image.data}`}] : [])]}}); } catch {} };
    if (!ref || !current(ref) || ref.settling || params.threadId !== ref.threadId || (ref.turnId && params.turnId !== ref.turnId)) return reply(false, 'This request is no longer active.');
    if (!TOOL_NAMES.includes(params.tool) || params.namespace) { policyViolation(ref, 'Codex tried an unknown tool.'); return reply(false, 'Unknown tool.'); }
    const execution = (async () => {
      let permit;
      try {
        permit = reserveAutomaticSubmission(ref,params.tool,params.arguments,emit);
        if (!current(ref)) return reply(false,'This request was canceled.');
        emit('tool-started', {tool: params.tool}, ref);
        const {payload, data} = await runTool(ref, params.tool, params.arguments,permit);
        if (!current(ref)) return reply(false, 'This request was canceled.');
        emit('tool-completed', {...payload, ok: true}, ref);
        const image = params.tool === 'pankeki_result' && data && data.state === 'succeeded' && data.job_id === payload.jobId ? imageForModel(await resultImageBytes(payload.jobId, {pankekiBaseUrl})) : null;
        if (!current(ref)) return reply(false, 'This request was canceled.');
        reply(true, JSON.stringify(forModel(params.tool, data)), image);
        if (params.tool === 'pankeki_job' && data && data.state === 'succeeded' && data.job_id === payload.jobId) collectReadyResult(ref, payload.jobId);
      } catch (error) {
        if(current(ref))failAutomaticSubmission(ref,permit,error,emit);
        if (current(ref)) emit('tool-completed', {tool: params.tool, ok: false, error: redact(error.message)}, ref);
        reply(false, redact(error.message));
      }
    })();
    ref.toolTasks.add(execution);
    try { await execution; } finally { ref.toolTasks.delete(execution); }
  }

  const unsettledJobs = ref => [...ref.jobs].filter(jobId => {
    const entry = ledger.get(jobId);
    return ownsJob(ref, jobId, entry) && !entry.result && !['failed', 'canceled', 'orphaned'].includes(entry.state);
  });
  function collectReadyResult(ref, jobId) {
    const entry = ledger.get(jobId);
    if (!current(ref) || !ownsJob(ref, jobId, entry) || entry.state !== 'succeeded' || entry.result || entry.resultTask) return;
    // Do not await this task from the model's job tool: settle waits for both,
    // and waiting for toolTasks here would include that same in-flight job tool.
    const task = appTool(ref, 'pankeki_result', jobId).catch(error => {
      if (current(ref)) emit('error', {code: error.code || 'result-unavailable', message: redact(error.message)}, ref);
    });
    ref.toolTasks.add(task);
    task.then(() => ref.toolTasks.delete(task));
  }
  function wakePoll(ref) { if (ref.wakePoll) ref.wakePoll(); }
  function waitPoll(ref) {
    return new Promise(resolve => {
      const timer = setTimeout(done, Math.max(1, limits.jobPoll));
      function done() { clearTimeout(timer); ref.wakePoll = null; resolve(); }
      ref.wakePoll = done;
      if (!current(ref)) done();
    });
  }
  async function appTool(ref, tool, jobId) {
    if (!current(ref) || !unsettledJobs(ref).includes(jobId)) throw new BridgeError('stale', 'Request no longer owns an unsettled job');
    emit('tool-started', {tool}, ref);
    try {
      const {payload, data} = await runTool(ref, tool, {job_id: jobId});
      if (!current(ref)) throw new BridgeError('stale', 'Request is no longer active');
      emit('tool-completed', {...payload, ok: true}, ref);
      return data;
    } catch (error) {
      if (current(ref)) emit('tool-completed', {tool, ok: false, error: redact(error.message)}, ref);
      throw error;
    }
  }
  // A successful model turn can end before its image job. Keep the original
  // request/deadline busy until its own jobs settle and their result is emitted.
  async function settle(ref) {
    try {
      await Promise.allSettled([...ref.toolTasks]);
      if (!current(ref)) return;
      for (const jobId of unsettledJobs(ref)) {
        while (current(ref)) {
          const job = await appTool(ref, 'pankeki_job', jobId);
          if (!current(ref)) return;
          if (job && job.state === 'succeeded') {
            const result = await appTool(ref, 'pankeki_result', jobId);
            if (!current(ref)) return;
            if (!result || result.state !== 'succeeded') throw new BridgeError('result-unavailable', 'The image result could not be collected');
            break;
          }
          if (!job || !['queued', 'submitting', 'running'].includes(job.state)) throw new BridgeError('image-job-failed', 'The image job did not succeed');
          await waitPoll(ref);
          if (!current(ref)) return;
        }
      }
      if (current(ref)) finishTurn(ref, 'completed');
    } catch (error) {
      if (!current(ref)) return;
      emit('error', {code: error.code || 'image-job-failed', message: redact(error.message)}, ref);
      finishTurn(ref, 'failed', error);
    }
  }
  function completedTurn(ref, status, error) {
    if (active !== ref || ref.settling) return;
    if (!ref.canceled && status === 'completed' && (ref.toolTasks.size || unsettledJobs(ref).length)) {
      ref.settling = true; // set before the first await; duplicate notifications do nothing
      return void settle(ref);
    }
    finishTurn(ref, status, error);
  }

  // ---- Codex app-server ----
  function onServerRequest(message) {
    const {id, method} = message;
    if (method === 'item/tool/call') return void onToolCall(message);
    const declined = {
      'item/commandExecution/requestApproval': {decision: 'decline'},
      'item/fileChange/requestApproval': {decision: 'decline'},
      'execCommandApproval': {decision: 'denied'},
      'applyPatchApproval': {decision: 'denied'},
      'mcpServer/elicitation/request': {action: 'decline', content: null, _meta: null}
    }[method];
    emit('error', {code: 'blocked', message: 'Codex asked for an action outside Pankeki; it was declined.', method});
    if (declined) return codexRpc.write({id, result: declined});
    codexRpc.write({id, error: {code: -32000, message: 'Not supported by the Pankeki bridge'}});
  }

  function policyViolation(ref, reason) {
    if (!current(ref)) return;
    emit('error', {code: 'policy', message: reason}, ref);
    interrupt(ref);
  }

  function interrupt(ref) {
    if (ref.turnId && !ref.interrupted) { ref.interrupted = true; request('turn/interrupt', {threadId: ref.threadId, turnId: ref.turnId}).catch(() => {}); }
  }

  function onNotification({method, params = {}}) {
    trace(method, params);
    const ref = active;
    if (!ref || ref.epoch !== epoch || !params.threadId || params.threadId !== ref.threadId) return;
    if (method === 'turn/started') {
      const id = params.turn && params.turn.id;
      if (!ref.turnId && id) { ref.turnId = id; if (ref.canceled) interrupt(ref); else emit('turn-started', {}, ref); }
      return;
    }
    if (method === 'turn/completed' && params.turn && params.turn.id === ref.turnId) return completedTurn(ref, params.turn.status, params.turn.error);
    if (!ref.turnId || params.turnId !== ref.turnId) {
      return;
    }
    if (ref.canceled || ref.settling) return;
    if (method === 'item/agentMessage/delta') emit('message-delta', {text: String(params.delta || '')}, ref);
    else if (method === 'item/started' && params.item && FORBIDDEN_ITEMS.has(params.item.type)) policyViolation(ref, 'Codex tried to use ' + params.item.type + ', which Pankeki does not allow.');
    else if (method === 'item/completed' && params.item && params.item.type === 'agentMessage') emit('message', {text: String(params.item.text || '')}, ref);
    else if (method === 'error' && params.error && !params.willRetry) emit('error', {code: 'codex', message: redact(params.error.message || 'Codex error')}, ref);
  }

  function finishTurn(ref, status, error) {
    if (active !== ref) return;
    if (status === 'completed' && !ref.canceled && (ref.autoSubmissionFailed||ref.jobOrphaned)) status='failed';
    if (status === 'completed' && !ref.canceled) resolveAutomaticChat(ref,emit);
    clearTimeout(ref.timer);
    wakePoll(ref);
    active = null;
    emit('turn-completed', {status: ref.canceled && status !== 'failed' ? 'interrupted' : status, error: error && error.message ? redact(error.message) : null}, ref);
    if (state.state === 'busy') setState('ready');
  }

  function onExit(code, signal) {
    child = null;
    if (codexRpc) codexRpc.failAll(new BridgeError('exited', 'Codex exited'));
    codexRpc = null;
    threads.clear();
    if (active) finishTurn(active, 'failed', {message: 'Codex stopped'});
    state.toolsReady = false;
    if (!closing) setState('error', new BridgeError('exited', `Codex exited (${signal || code})`));
  }

  async function start(disabledSkills) {
    const disabledMcpCommand=path.join(paths.work,'disabled-mcp-command.exe');
    if(fs.existsSync(disabledMcpCommand))throw new BridgeError('isolation','Disabled MCP placeholder must not exist');
    const proc = spawnImpl(codexLaunch.command, [...codexLaunch.args, ...childArgs(disabledSkills,disabledMcpCommand)], {cwd: paths.work, env: childEnv(process.env), stdio: ['pipe', 'pipe', 'pipe'], ...(process.platform === 'win32' ? {windowsHide: true} : {})});
    child = proc;
    codexRpc = rpc(proc, {label: 'codex', log, onRequest: onServerRequest, onNotification});
    proc.on('error', error => { log('spawn error: ' + redact(error.message)); if (child === proc) onExit(null, 'spawn-error'); });
    proc.on('exit', (code, signal) => { if (child === proc) onExit(code, signal); });
    const init = await request('initialize', {clientInfo: {name: 'pankeki_desktop', title: 'Pankeki', version: clientVersion},
      capabilities: {experimentalApi: true, requestAttestation: false}});
    codexRpc.write({method: 'initialized'});
    const agent = init && typeof init.userAgent === 'string' ? init.userAgent.match(/(\d+\.\d+\.\d+)/) : null;
    state.codexVersion = agent ? agent[1] : null;
  }

  async function stopChild() {
    const proc = child;
    child = null;
    if (codexRpc) codexRpc.failAll(new BridgeError('exited', 'Codex restarted'));
    codexRpc = null;
    try { await stopProcess(proc, limits.close); }
    catch (error) {
      // Still running: keep owning it so connect() does not start a second Codex beside it.
      if (proc && proc.exitCode === null && proc.signalCode === null && child === null) child = proc;
      setState('error', new BridgeError('stop-failed', 'Codex could not be stopped'));
      throw new BridgeError('stop-failed', 'Codex could not be stopped');
    }
  }

  async function enabledSkills() {
    const result = await request('skills/list', {cwds: [paths.work], forceReload: true});
    return result.data.flatMap(entry => entry.skills).filter(skill => skill.enabled).map(skill => skill.name);
  }

  // Fails closed: any capability besides the bridge's dynamic tools stops connect().
  async function verifyIsolation() {
    const fail = message => { throw new BridgeError('isolation', message); };
    const {config} = await request('config/read', {includeLayers: false, cwd: paths.work});
    const servers = Object.entries(config.mcp_servers || {}).filter(([, server]) => server && server.enabled !== false).map(([name]) => name);
    if (servers.length) fail('MCP servers are still enabled: ' + servers.join(', '));
    const features = config.features || {};
    const on = DISABLED_FEATURES.filter(name => features[name] === true);
    if (on.length) fail('Features still enabled: ' + on.join(', '));
    if (config.approval_policy !== 'never' || config.sandbox_mode !== 'read-only' || config.web_search !== 'disabled') fail('Sandbox, approval or web search override was not applied');
    const hooks = await request('hooks/list', {cwds: [paths.work]});
    const hookCount = hooks.data.reduce((sum, entry) => sum + (entry.hooks || []).length, 0);
    if (hookCount) fail('Hooks are still active');
    const skills = await enabledSkills();
    if (skills.length) fail('Skills are still enabled: ' + skills.join(', '));
    return {mcpServers: servers, dynamicTools: TOOL_NAMES, hooks: hookCount, skills: skills.length};
  }

  async function connect() {
    if (child) return snapshot();
    closing = false;
    if (!codexLaunch) { setState('missing', new BridgeError('missing', 'Codex is not installed')); return snapshot(); }
    for (const dir of [paths.work, paths.inputs]) fs.mkdirSync(dir, {recursive: true});
    setState('starting');
    try {
      try { await start([]); }
      catch (error) { if (['exited', 'timeout', 'not-connected'].includes(error.code)) { await stopChild(); setState('missing', new BridgeError('missing', 'Codex could not start')); return snapshot(); } throw error; }
      const account = await request('account/read', {refreshToken: false});
      const type = account && account.account ? account.account.type : null;
      state.authMode = type === 'chatgpt' ? 'chatgpt' : null;
      if (type !== 'chatgpt') {
        await close();
        setState(type ? 'error' : 'signed-out', new BridgeError(type ? 'unsupported-auth' : 'signed-out', type ? 'Only the Codex ChatGPT sign-in is supported' : 'Sign in to Codex first'));
        return snapshot();
      }
      const skills = await enabledSkills();
      if (skills.length) { await stopChild(); await start(skills); }
      await verifyIsolation();
      state.toolsReady = true;
      setState('ready');
    } catch (error) {
      log('connect failed ('+String(error.code||'codex')+'): '+redact(error.message));
      await close();
      setState('error', error instanceof BridgeError ? error : new BridgeError('codex', error.message));
    }
    return snapshot();
  }

  async function threadFor(projectId) {
    if(getCapabilities){const snapshot=normalizedCapabilities(await getCapabilities());if(snapshot.revision!==capabilitySnapshot?.revision||snapshot.source!==capabilitySnapshot?.source)threads.clear();capabilitySnapshot=snapshot;toolSchemas=createToolSchemas(snapshot);}
    if (threads.has(projectId)) return threads.get(projectId);
    const result = await request('thread/start', {cwd: paths.work, approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true,
      ...(modelChoice ? {model: modelChoice.model} : {}),
      developerInstructions: INSTRUCTIONS, serviceName: 'pankeki_desktop',
      dynamicTools: TOOL_NAMES.map(name => ({type: 'function', name, description: toolSchemas[name].description, inputSchema: toolSchemas[name].inputSchema}))});
    threads.set(projectId, result.thread.id);
    return result.thread.id;
  }

  async function getModels() {
    if (modelCatalog) return {source: 'codex-model-list', models: modelCatalog};
    if (active || state.state === 'starting') throw new BridgeError('busy', 'Codex is busy');
    if (!child || state.state !== 'ready') throw new BridgeError('not-ready', 'Codex is not ready');
    const rows = [], cursors = new Set();
    let cursor = null;
    for (let page = 0; page < 4; page++) {
      const result = await request('model/list', {limit: 25, includeHidden: false, ...(cursor ? {cursor} : {})});
      if (!result || !Array.isArray(result.data)) throw new BridgeError('model-list-failed', 'Invalid model catalog');
      rows.push(...result.data.slice(0, 100));
      cursor = result.nextCursor;
      if (!cursor) break;
      if (typeof cursor !== 'string' || cursor.length > 2048 || cursors.has(cursor)) throw new BridgeError('model-list-failed', 'Invalid model cursor');
      cursors.add(cursor);
    }
    modelCatalog = normalizeModels('codex', rows);
    return {source: 'codex-model-list', models: modelCatalog};
  }
  async function setModel({modelId} = {}) {
    if (!validModelId(modelId)) throw new BridgeError('invalid-input', 'Invalid model id');
    if (active || state.state === 'starting') throw new BridgeError('busy', 'Codex is busy');
    const choice = modelId === 'default' ? null : modelCatalog?.find(item => item.id === modelId);
    if (modelId !== 'default' && !choice) throw new BridgeError('unknown-model', 'Choose a listed model');
    if ((modelChoice?.id || 'default') === modelId) return;
    threads.clear(); modelChoice = choice; epoch++;
  }

  // context: {contextId?, sourceRevision?} — opaque app ids; paths stay in the app.
  // The first line of text may be `[Pankeki action: chat|generate|edit]`.
  async function send({text, projectId, requestId, context, automatic} = {}) {
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) throw new BridgeError('invalid-input', 'text must be 1..' + MAX_TEXT + ' characters');
    if (!ID.test(projectId || '') || !ID.test(requestId || '')) throw new BridgeError('invalid-input', 'projectId and requestId must match ' + ID);
    const contextId = context && context.contextId !== undefined && context.contextId !== null ? opaque(context.contextId, 'contextId') : null;
    const sourceRevision = context && context.sourceRevision !== undefined && context.sourceRevision !== null ? opaque(context.sourceRevision, 'sourceRevision') : null;
    if (contextId && !sourceRevision) throw new BridgeError('invalid-input', 'sourceRevision is required with contextId');
    if (state.state !== 'ready') throw new BridgeError(active ? 'busy' : 'not-ready', 'Codex is ' + state.state);
    const auto = automaticFromMessage(text,automatic,{sourceRevision,contextId});
    fs.mkdirSync(path.join(paths.inputs, projectId), {recursive: true});
    epoch++;
    const first = ACTION.exec(text.split('\n', 1)[0].trim());
    const ref = {requestId, projectId, contextId, sourceRevision, action: first ? first[1] : 'chat', automatic:auto, generationSettings:generationSettingsFromMessage(text), epoch, threadId: null, turnId: null, jobs: new Set(), toolTasks: new Set(), timer: null, wakePoll: null, settling: false, canceled: false, interrupted: false};
    active = ref;
    setState('busy');
    const note = auto ? automaticNote(auto) : contextId ? 'The user has selected an image and a mask in the app; pankeki_edit will use them.' : 'No image source is bound to this request. Do not invent an edit source.';
    try {
      const threadId = await threadFor(projectId);
      const image = imageForModel(await sourceImageBytes(ref, {resolveEditContext, inputRoot: paths.inputs}));
      if (active !== ref) return {requestId};
      ref.threadId = threadId;
      if (ref.canceled) { finishTurn(ref, 'interrupted'); return {requestId}; }
      ref.timer = setTimeout(() => { if (!current(ref)) return; emit('error', {code: 'timeout', message: 'Codex took too long'}, ref); cancel({requestId}); }, limits.turn);
      const input = [{type: 'text', text: text + '\n\n[Pankeki] ' + note, text_elements: []}, ...(image ? [{type: 'image', url: `data:${image.mimeType};base64,${image.data}`}] : [])];
      const result = await request('turn/start', {threadId, clientUserMessageId: requestId, ...(modelChoice ? {effort: modelChoice.effort} : {}), input});
      if (active !== ref) return {requestId};
      const id = result && result.turn && result.turn.id;
      if (!ref.turnId && id) { ref.turnId = id; if (!ref.canceled) emit('turn-started', {}, ref); }
      if (ref.canceled) interrupt(ref);
    } catch (error) {
      if (active === ref) {
        clearTimeout(ref.timer);
        active = null;
        emit('error', {code: error.code || 'codex', message: redact(error.message)}, ref);
        if (child) setState('ready');
      }
      throw error;
    }
    return {requestId};
  }

  async function cancel({requestId} = {}) {
    const ref = active;
    if (!ref || (requestId && ref.requestId !== requestId) || ref.canceled) return false;
    ref.canceled = true;
    wakePoll(ref);
    emit('status', {...snapshot(), canceling: true}, ref);
    // Logical discard through the adapter's own ledger; GPU work may continue.
    for (const jobId of ref.jobs) await adapterCancel(ref.projectId, jobId, ref);
    // The native model turn already completed while settling. End locally after
    // scoped logical cancels; another native completed notification may never come.
    if (ref.settling) { if (active === ref) finishTurn(ref, 'interrupted'); }
    else if (active === ref) interrupt(ref); // a turn not yet started is interrupted as soon as its id arrives
    return true;
  }

  // Local-only metadata for Electron main; all four ids must match.
  const owned = ({jobId, projectId, requestId, sourceRevision = null} = {}) => {
    const entry = typeof jobId === 'string' ? ledger.get(jobId) : null;
    return entry && entry.projectId === projectId && entry.requestId === requestId && entry.sourceRevision === sourceRevision ? entry : null;
  };

  function getSubmittedRequest(query) {
    const entry = owned(query);
    return entry && entry.request ? {jobId: query.jobId, requestId: entry.requestId,traceId:entry.traceId, tool: entry.tool, state: entry.state || null, request: {...entry.request}} : null;
  }

  function getResultDescriptor(query) {
    const entry = owned(query);
    if (!entry || !entry.result) return null;
    return {jobId: query.jobId, resultId: query.jobId, requestId: entry.requestId,traceId:entry.traceId, state: 'succeeded',
      request: {...(entry.request || entry.result.request || {})}, metrics: {...entry.result.metrics}};
  }

  // Returns {unconfirmedSubmissions}: submits still unanswered after the drain
  // window. Those may have been accepted by Pankeki without a logical cancel.
  async function close() {
    closing = true;
    if (active) { active.canceled = true; finishTurn(active, 'interrupted', {message: 'Bridge closed'}); }
    let unconfirmedSubmissions = 0;
    if (inflight.size) {
      const pending = [...inflight];
      let timer;
      const drained = await Promise.race([Promise.allSettled(pending).then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), limits.drain); })]);
      clearTimeout(timer);
      if (!drained) {
        unconfirmedSubmissions = pending.filter(p => inflight.has(p)).length;
        emit('error', {code: 'unconfirmed-cancel', message: `${unconfirmedSubmissions} submission(s) were still pending at close; a job may run without a logical cancel.`}, null);
      }
    }
    // Logically cancel this bridge's unfinished jobs before the adapter stops.
    for (const [jobId, entry] of ledger) if (!TERMINAL.has(entry.state) && mcp.has(entry.projectId)) await adapterCancel(entry.projectId, jobId);
    threads.clear();
    state.toolsReady = false;
    const entries = [...mcp.entries()];
    mcp.clear();
    const results = await Promise.allSettled([stopChild(), ...entries.map(([, entry]) => stopProcess(entry.proc, limits.close))]);
    // Re-own any adapter whose process is still alive, so a later close can retry it.
    results.slice(1).forEach((result, i) => { if (result.status === 'rejected' && !mcp.has(entries[i][0])) mcp.set(entries[i][0], entries[i][1]); });
    if (results.some(result => result.status === 'rejected')) throw new BridgeError('stop-failed', 'Codex or Pankeki tools could not be stopped');
    ledger.clear();
    if (state.state !== 'missing') state.state = 'idle';
    return {unconfirmedSubmissions};
  }

  return {status: snapshot, connect, send, cancel, close, getModels, setModel, getSubmittedRequest, getResultDescriptor, protocolVersion: PROTOCOL_VERSION,
    _debug: {childArgs:skills=>childArgs(skills,path.join(paths.work,'disabled-mcp-command.exe')), paths, verifyIsolation, get tools(){return toolSchemas;}}};
}

module.exports = {createCodexBridge, BridgeError, TOOL_NAMES, DISABLED_FEATURES, PROTOCOL_VERSION};

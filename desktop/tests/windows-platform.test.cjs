'use strict';
// Windows branches exercised on any OS: platform, env, fs and process inspection are all injected.
// These are logic tests, not evidence that the app runs on a real Windows machine.
const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const platformInfo=require('../platform.cjs');
const {createBackendManager,listenerMatches,parseNetstat,stopChild}=require('../backend-manager.cjs');
const W=path.win32;

test('Windows command lines parse with quotes, spaces, Korean and trailing backslashes',()=>{
  const line='"C:\\Users\\김 판케\\Pankeki 앱\\.venv-windows\\Scripts\\python.exe" -u -m pankeki serve --port 8190 --config "D:\\내 프로젝트\\runtime\\windows\\config.json" --x "a\\\\" --empty ""';
  assert.deepEqual(platformInfo.parseWindowsCommandLine(line),['C:\\Users\\김 판케\\Pankeki 앱\\.venv-windows\\Scripts\\python.exe','-u','-m','pankeki','serve',
    '--port','8190','--config','D:\\내 프로젝트\\runtime\\windows\\config.json','--x','a\\','--empty','']);
  assert.deepEqual(platformInfo.parseWindowsCommandLine('a\\\\\\"b c'),['a\\"b','c']);
});

test('Windows layout keeps macOS paths untouched and adds runtime/windows',()=>{
  assert.equal(platformInfo.layout('darwin').python,'.venv-macos/bin/python');
  assert.equal(platformInfo.layout('darwin').mcpPython,'runtime/macos/pankeki-mcp-20261023/release/venv/bin/python');
  assert.equal(platformInfo.layout('win32').python,'.venv-windows/Scripts/python.exe');
  assert.deepEqual(platformInfo.requiredFiles('win32').slice(0,3),['.venv-windows/Scripts/python.exe','runtime/windows/config.json','runtime/windows/model-paths.yaml']);
});

test('Windows child env keeps the system minimum, drops secrets, ignores key case and forces UTF-8',()=>{
  const env=platformInfo.minimalEnv({Path:'C:\\Windows\\System32',SYSTEMROOT:'C:\\Windows',USERPROFILE:'C:\\Users\\김',APPDATA:'C:\\Users\\김\\AppData\\Roaming',
    OPENAI_API_KEY:'sk-secret',ANTHROPIC_API_KEY:'secret',HOME:'/ignored'},'win32');
  assert.equal(env.PATH,'C:\\Windows\\System32');assert.equal(env.SystemRoot,'C:\\Windows');assert.equal(env.USERPROFILE,'C:\\Users\\김');
  assert.equal(env.PYTHONUTF8,'1');assert.equal(env.OPENAI_API_KEY,undefined);assert.equal(env.ANTHROPIC_API_KEY,undefined);assert.equal(env.HOME,undefined);
});

function fakeFs(files){
  return {statSync:file=>{if(!(file in files))throw Object.assign(Error('ENOENT'),{code:'ENOENT'});return {isFile:()=>true};},
    accessSync:()=>{},readFileSync:file=>{if(!(file in files))throw Error('ENOENT');return files[file];}};
}
test('an npm .cmd shim resolves to node + script so empty arguments survive without a shell',()=>{
  const npm='C:\\Users\\김\\AppData\\Roaming\\npm';
  const files={[W.join(npm,'claude.cmd')]:'@ECHO off\r\nGOTO start\r\n:start\r\nSETLOCAL\r\n"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n',
    [W.join(npm,'node_modules\\@anthropic-ai\\claude-code\\cli.js')]:'',['C:\\Program Files\\nodejs\\node.exe']:''};
  const spec=platformInfo.findCli('claude',{platform:'win32',env:{APPDATA:W.join('C:\\Users\\김','AppData','Roaming'),USERPROFILE:'C:\\Users\\김',PATH:'C:\\Program Files\\nodejs'},fsImpl:fakeFs(files)});
  assert.deepEqual(spec,{command:'C:\\Program Files\\nodejs\\node.exe',args:[W.join(npm,'node_modules\\@anthropic-ai\\claude-code\\cli.js')]});
});
test('a native claude.exe is preferred and an unparseable shim is refused rather than shell-launched',()=>{
  const exe='C:\\Users\\김\\.local\\bin\\claude.exe';
  assert.deepEqual(platformInfo.findCli('claude',{platform:'win32',env:{USERPROFILE:'C:\\Users\\김'},fsImpl:fakeFs({[exe]:''})}),{command:exe,args:[]});
  const odd='C:\\Users\\김\\AppData\\Roaming\\npm\\codex.cmd';
  assert.equal(platformInfo.findCli('codex',{platform:'win32',env:{APPDATA:'C:\\Users\\김\\AppData\\Roaming'},fsImpl:fakeFs({[odd]:'powershell -File evil.ps1'})}),null);
  assert.equal(platformInfo.launchSpec('/usr/local/bin/codex').command,'/usr/local/bin/codex');
});

test('Korean netstat output is read by remote wildcard, not the localized LISTENING word',()=>{
  const text=['활성 연결','','  프로토콜  로컬 주소              외부 주소              상태            PID',
    '  TCP    127.0.0.1:8190         0.0.0.0:0              수신 대기       4120',
    '  TCP    127.0.0.1:8190         127.0.0.1:51000        설정됨          4120',
    '  TCP    0.0.0.0:8188           0.0.0.0:0              수신 대기       9000',
    '  TCP    [::]:8188              [::]:0                 수신 대기       9000'].join('\r\n');
  assert.deepEqual(parseNetstat(text,8190),[{address:'127.0.0.1',pid:4120}]);
  assert.deepEqual(parseNetstat(text,8188),[{address:'0.0.0.0',pid:9000},{address:'[::]',pid:9000}]);
});

const root='D:\\내 작업\\Pankeki';
const winPaths={platform:'win32',projectRoot:root,python:W.join(root,'.venv-windows\\Scripts\\python.exe'),config:W.join(root,'runtime\\windows\\config.json'),
  modelPaths:W.join(root,'runtime\\windows\\model-paths.yaml'),comfyRoot:W.join(root,'vendor\\ComfyUI'),runtime:fs.mkdtempSync(path.join(os.tmpdir(),'pankeki-win-'))};
const q=value=>'"'+value+'"';
function winListener(kind,pid,ancestors=[],overrides={}){
  const command=kind==='pankeki'
    ?`${q('C:\\Python312\\python.exe')} -u -m pankeki serve --port 8190 --comfy-url http://127.0.0.1:8188 --config ${q(winPaths.config.toUpperCase())}`
    :`${q('C:\\Python312\\python.exe')} -u ${q(W.join(winPaths.comfyRoot,'main.py'))} --listen 127.0.0.1 --port 8188 --extra-model-paths-config ${q(winPaths.modelPaths)}`;
  return {pid,loopback:true,command,args:platformInfo.parseWindowsCommandLine(command),executable:'C:\\Python312\\python.exe',created:'2026-10-29T06:00:00.0000000Z',ancestors,...overrides};
}
test('Windows identity matches parsed argv case-insensitively and rejects lookalikes',()=>{
  assert.equal(listenerMatches('pankeki',winListener('pankeki',10),winPaths),true);
  assert.equal(listenerMatches('comfy',winListener('comfy',11),winPaths),true);
  const evil=winListener('pankeki',12);evil.args=evil.args.map(a=>a.toLowerCase().endsWith('config.json')?a+'.evil':a);
  assert.equal(listenerMatches('pankeki',evil,winPaths),false);
  const foreign=winListener('comfy',13);foreign.args=foreign.args.map(a=>a.endsWith('main.py')?'C:\\Other\\ComfyUI\\main.py':a);
  assert.equal(listenerMatches('comfy',foreign,winPaths),false);
  assert.equal(listenerMatches('comfy',{...winListener('comfy',14),loopback:false},winPaths),false);
});

function fakeChild(pid){const child=new EventEmitter();child.pid=pid;child.exitCode=null;child.signalCode=null;child.kill=()=>true;return child;}
test('Windows launch uses absolute main.py, hides consoles, accepts the venv launcher\'s interpreter child and tree-stops it',async()=>{
  const calls=[],live={},children=[],trees=[];
  const manager=createBackendManager({paths:winPaths,probe:async()=>true,shutdownTimeouts:{interrupt:50,terminate:50,kill:50},
    inspectListener:async(kind,options)=>{const entry=live[kind];if(!entry)return null;return options?.full===false?{pid:entry.pid,loopback:true}:entry;},
    killTree:async(child,{force})=>{trees.push({pid:child.pid,force});if(!force)queueMicrotask(()=>{child.exitCode=0;child.emit('exit',0,null);});return true;},
    launch:(exe,args,options)=>{
      calls.push({exe,args,options});const child=fakeChild(100+children.length);children.push(child);
      const kind=args.includes('serve')?'pankeki':'comfy';
      live[kind]=winListener(kind,child.pid+1000,[child.pid,1]); // interpreter is a child of the launcher
      return child;}});
  await manager.start();
  assert.equal(calls[0].args[1],W.join(winPaths.comfyRoot,'main.py'));assert.equal(calls[0].options.windowsHide,true);assert.equal(calls[0].options.shell,false);
  assert.equal(calls[0].options.env.PYTORCH_ENABLE_MPS_FALLBACK,undefined);assert.equal(calls[0].options.env.HF_HUB_OFFLINE,'1');
  assert.equal(await manager.verifyIdentity(),true);
  live.pankeki={...live.pankeki,pid:4242};assert.equal(await manager.verifyIdentity(),false);
  await manager.close();
  assert.deepEqual(trees.map(t=>t.force),[false,false]);assert.equal(manager.status().comfy.ownership,'none');
});
test('Windows refuses a listener that is neither the launcher nor its descendant',async()=>{
  const live={};
  const manager=createBackendManager({paths:winPaths,probe:async()=>true,killTree:async(child)=>{queueMicrotask(()=>{child.exitCode=1;child.emit('exit',1,null);});return true;},
    inspectListener:async kind=>live[kind]||null,
    launch:(_exe,args)=>{const child=fakeChild(300);const kind=args.includes('serve')?'pankeki':'comfy';live[kind]=winListener(kind,777,[555]);return child;}});
  await assert.rejects(manager.start(),/identity-changed/);
});
test('Windows stop escalates to a forced tree kill when the polite one is ignored',async()=>{
  const child=fakeChild(50),forces=[];
  await stopChild(child,{interrupt:5,terminate:5,kill:5},{platform:'win32',killTree:async(_c,{force})=>{forces.push(force);if(force)queueMicrotask(()=>{child.exitCode=1;child.emit('exit',1,null);});return true;}});
  assert.deepEqual(forces,[false,true]);
});
test('taskkill is called with /T and only /F when forced, from SystemRoot',async()=>{
  const calls=[];const run=(file,args,options,callback)=>{calls.push({file,args,options});callback(null);};
  await platformInfo.taskkill(1234,{env:{SystemRoot:'C:\\Windows'},run});await platformInfo.taskkill(1234,{force:true,env:{SystemRoot:'C:\\Windows'},run});
  assert.equal(calls[0].file,'C:\\Windows\\System32\\taskkill.exe');assert.deepEqual(calls[0].args,['/PID','1234','/T']);assert.deepEqual(calls[1].args,['/PID','1234','/T','/F']);
  assert.equal(calls[0].options.windowsHide,true);
});

test('a refused polite taskkill goes straight to the forced kill without waiting the interrupt timeout',async()=>{
  const child=fakeChild(60),forces=[];const started=Date.now();
  await stopChild(child,{interrupt:5000,terminate:50,kill:50},{platform:'win32',killTree:async(_c,{force})=>{forces.push(force);if(!force)return false;queueMicrotask(()=>{child.exitCode=1;child.emit('exit',1,null);});return true;}});
  assert.deepEqual(forces,[false,true]);assert.ok(Date.now()-started<1000,'no 5 s polite wait');
});
test('an npm shim that points at a bundled native .exe runs that .exe directly',()=>{
  const npm='C:\\Users\\김\\AppData\\Roaming\\npm',exe=W.join(npm,'node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe');
  const files={[W.join(npm,'claude.cmd')]:'@ECHO off\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n',[exe]:''};
  assert.deepEqual(platformInfo.findCli('claude',{platform:'win32',env:{APPDATA:'C:\\Users\\김\\AppData\\Roaming'},fsImpl:fakeFs(files)}),{command:exe,args:[]});
});
test('IPv6 netstat rows count as listeners and proxy/git-bash settings reach the CLIs',()=>{
  assert.deepEqual(parseNetstat('  TCP    [::1]:8190             [::]:0                 LISTENING       77',8190),[{address:'[::1]',pid:77}]);
  const env=platformInfo.minimalEnv({HTTPS_PROXY:'http://proxy:8080',CLAUDE_CODE_GIT_BASH_PATH:'D:\\Git\\bin\\bash.exe',GITHUB_TOKEN:'x'},'win32');
  assert.equal(env.HTTPS_PROXY,'http://proxy:8080');assert.equal(env.CLAUDE_CODE_GIT_BASH_PATH,'D:\\Git\\bin\\bash.exe');assert.equal(env.GITHUB_TOKEN,undefined);
});

// --- Review findings (Codex, 2026-10-29): official npm shims, stop failures, identity re-proof -------
const officialJsShim=['@ECHO off','GOTO start',':find_dp0','SET dp0=%~dp0','EXIT /b',':start','SETLOCAL','CALL :find_dp0','',
  'IF EXIST "%dp0%\\node.exe" (','  SET "_prog=%dp0%\\node.exe"',') ELSE (','  SET "_prog=node"',')','',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & set PATHEXT=%PATHEXT:;.JS;=;% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*',''].join('\r\n');
const officialExeShim=['@ECHO off','GOTO start',':find_dp0','SET dp0=%~dp0','EXIT /b',':start','SETLOCAL','CALL :find_dp0',
  '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*',''].join('\r\n');
test('official npm cmd-shim (node probe before the call) resolves to node + script, with or without a companion node.exe',()=>{
  const npm='C:\\Users\\김\\AppData\\Roaming\\npm',shim=W.join(npm,'codex.cmd'),cli=W.join(npm,'node_modules\\@openai\\codex\\bin\\codex.js'),pathNode='C:\\Program Files\\nodejs\\node.exe';
  const env={APPDATA:'C:\\Users\\김\\AppData\\Roaming',USERPROFILE:'C:\\Users\\김',PATH:'C:\\Program Files\\nodejs'};
  assert.deepEqual(platformInfo.parseNpmShim(officialJsShim,shim),{target:cli,viaNode:true});
  assert.deepEqual(platformInfo.findCli('codex',{platform:'win32',env,fsImpl:fakeFs({[shim]:officialJsShim,[cli]:'',[pathNode]:''})}),{command:pathNode,args:[cli]});
  const companion=W.join(npm,'node.exe');
  assert.deepEqual(platformInfo.findCli('codex',{platform:'win32',env,fsImpl:fakeFs({[shim]:officialJsShim,[cli]:'',[pathNode]:'',[companion]:''})}),{command:companion,args:[cli]});
  assert.equal(platformInfo.findCli('codex',{platform:'win32',env:{...env,PATH:''},fsImpl:fakeFs({[shim]:officialJsShim,[cli]:''})}),null,'no node anywhere: missing, never node-only');
});
test('official native-target cmd-shim runs the bundled exe; a shim whose call targets node.exe itself is refused',()=>{
  const npm='C:\\Users\\김\\AppData\\Roaming\\npm',shim=W.join(npm,'claude.cmd'),exe=W.join(npm,'node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe');
  assert.deepEqual(platformInfo.findCli('claude',{platform:'win32',env:{APPDATA:'C:\\Users\\김\\AppData\\Roaming'},fsImpl:fakeFs({[shim]:officialExeShim,[exe]:''})}),{command:exe,args:[]});
  assert.equal(platformInfo.parseNpmShim('"%dp0%\\node.exe" %*',shim),null);
  assert.equal(platformInfo.parseNpmShim('"%_prog%" "%dp0%\\x\\tool.exe" %*',shim),null,'node cannot run an exe target');
});
function liveChild(pid){const child=new EventEmitter();child.pid=pid;child.exitCode=null;child.signalCode=null;child.stdin={end(){}};return child;}
test('stopProcessTree rejects (process-not-stopped) when both taskkills fail and no exit arrives',async()=>{
  const child=liveChild(70),calls=[];
  await assert.rejects(platformInfo.stopProcessTree(child,20,{killTree:async(_c,{force})=>{calls.push(force);return false;}}),error=>error.code==='process-not-stopped');
  assert.deepEqual(calls,[false,true]);assert.equal(child.listenerCount('exit'),0);
});
test('stopProcessTree resolves only on a real exit after the forced kill',async()=>{
  const child=liveChild(71);
  await platformInfo.stopProcessTree(child,200,{killTree:async(c,{force})=>{if(force)setTimeout(()=>{c.exitCode=1;c.emit('exit',1,null);},10);return force;}});
  assert.equal(child.exitCode,1);
});
test('Windows external server: same PID but foreign command, new creation time or missing time fails verifyIdentity',async()=>{
  const live={pankeki:winListener('pankeki',204),comfy:winListener('comfy',205)};
  const manager=createBackendManager({paths:winPaths,probe:async()=>true,inspectListener:async kind=>live[kind]});
  await manager.start();assert.equal(manager.status().pankeki.ownership,'external');
  assert.equal(await manager.verifyIdentity(),true);
  const foreign='"C:\\OtherApp\\foreign.exe" --port 8190';
  live.pankeki={...live.pankeki,command:foreign,args:platformInfo.parseWindowsCommandLine(foreign),executable:'C:\\OtherApp\\foreign.exe'};
  assert.equal(await manager.verifyIdentity(),false,'reviewer reproduction: foreign command on the verified PID');
  live.pankeki=winListener('pankeki',204,[],{created:'2026-10-29T07:00:00.0000000Z'});
  assert.equal(await manager.verifyIdentity(),false,'PID reused by a newer process');
  live.pankeki=winListener('pankeki',204,[],{created:null});
  assert.equal(await manager.verifyIdentity(),false,'creation time unavailable fails closed');
  live.pankeki=winListener('pankeki',204);
  assert.equal(await manager.verifyIdentity(),true);
});
test('Windows refuses to adopt a listener whose creation time cannot be read',async()=>{
  const manager=createBackendManager({paths:winPaths,probe:async()=>true,inspectListener:async kind=>winListener(kind,kind==='comfy'?301:302,[],{created:null})});
  await assert.rejects(manager.start(),/identity-changed/);
});

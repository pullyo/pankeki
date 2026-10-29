'use strict';
// Platform differences for the desktop shell, in one place so macOS behaviour stays byte-for-byte
// what it was and Windows gets its own explicit rules. Every function takes the platform (and
// env/fs) as arguments so both branches are testable on either OS.
const fs=require('node:fs');const path=require('node:path');const {execFile}=require('node:child_process');

const LAYOUTS={
  darwin:{python:'.venv-macos/bin/python',config:'runtime/macos/config.json',modelPaths:'runtime/macos/model-paths.yaml',
    runtime:'runtime/macos/desktop-codex',mcpPython:'runtime/macos/pankeki-mcp-20261023/release/venv/bin/python'},
  win32:{python:'.venv-windows/Scripts/python.exe',config:'runtime/windows/config.json',modelPaths:'runtime/windows/model-paths.yaml',
    runtime:'runtime/windows/desktop-codex',mcpPython:'runtime/windows/pankeki-mcp/venv/Scripts/python.exe'}
};
const COMMON_REQUIRED=['vendor/ComfyUI/main.py','pankeki/__main__.py','web/index.html'];
function layout(platform=process.platform){return LAYOUTS[platform==='win32'?'win32':'darwin'];}
function requiredFiles(platform=process.platform){const l=layout(platform);return [l.python,l.config,l.modelPaths,...COMMON_REQUIRED];}

// Children get a minimal environment (no API keys). Windows processes cannot even start sockets
// or find their profile without SystemRoot/USERPROFILE/APPDATA, so those are part of the minimum.
const POSIX_ENV=['HOME','PATH','USER','LOGNAME','LANG','LC_ALL','TMPDIR','SHELL'];
const WINDOWS_ENV=['PATH','PATHEXT','SystemRoot','SystemDrive','windir','ComSpec','TEMP','TMP','USERPROFILE','USERNAME','USERDOMAIN',
  'HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','ProgramData','ProgramFiles','ProgramFiles(x86)','ProgramW6432','CommonProgramFiles',
  'NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','OS','LANG','LC_ALL',
  // Not secrets, but needed on real Windows setups: Claude Code's Git Bash location, a custom Codex
  // home, and corporate proxies / certificate bundles.
  'CLAUDE_CODE_GIT_BASH_PATH','CODEX_HOME','HTTP_PROXY','HTTPS_PROXY','NO_PROXY','SSL_CERT_FILE','NODE_EXTRA_CA_CERTS'];
function envKeys(platform=process.platform){return platform==='win32'?WINDOWS_ENV:POSIX_ENV;}
function pick(base,keys){
  // Windows env names are case-insensitive; look each one up without caring how the parent spelled it.
  const env={};const lower=new Map(Object.keys(base||{}).map(key=>[key.toLowerCase(),key]));
  for(const key of keys){const found=lower.get(key.toLowerCase());if(found!==undefined&&base[found])env[key]=base[found];}
  return env;
}
function minimalEnv(base,platform=process.platform){
  const env=pick(base,envKeys(platform));
  // Korean user names and project folders: force UTF-8 for Python children on Windows.
  if(platform==='win32')Object.assign(env,{PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'});
  return env;
}

// --- Finding the Codex / Claude CLIs -------------------------------------------------------
// A launch spec is {command,args}: Windows npm installs are .cmd shims, and Node refuses to spawn
// .cmd/.bat without a shell (CVE-2024-27980). A shell would also drop the empty-string arguments the
// bridges pass, so a shim is resolved to `node <script.js>` instead.
function isExecutable(file,{platform=process.platform,fsImpl=fs}={}){
  try{const stat=fsImpl.statSync(file);if(!stat.isFile())return false;if(platform==='win32')return true;fsImpl.accessSync(file,fs.constants.X_OK);return true;}catch{return false;}
}
function parseNpmShim(text,shimPath){
  // npm/cmd-shim: "%dp0%\node_modules\@openai\codex\bin\codex.js" or "%~dp0\..."; quoted or not.
  // Newer packages (e.g. @anthropic-ai/claude-code) point the shim at a bundled native .exe instead.
  const match=/["']?%~?dp0%?\\([^"'\r\n]+?\.(?:(?:c|m)?js|exe))["']?/i.exec(text);
  if(!match)return null;
  const dir=path.win32.dirname(shimPath);
  return path.win32.join(dir,match[1]);
}
function findOnPath(names,{env,platform,fsImpl}){
  const dirs=String(pick(env,['PATH']).PATH||'').split(platform==='win32'?';':':').filter(Boolean);
  for(const dir of dirs)for(const name of names){const file=(platform==='win32'?path.win32:path.posix).join(dir.replace(/^"|"$/g,''),name);if(isExecutable(file,{platform,fsImpl}))return file;}
  return null;
}
function resolveWindowsShim(file,{env,fsImpl=fs}){
  if(!/\.(cmd|bat)$/i.test(file))return {command:file,args:[]};
  let text;try{text=fsImpl.readFileSync(file,'utf8');}catch{return null;}
  const script=parseNpmShim(text,file);
  if(!script||!isExecutable(script,{platform:'win32',fsImpl}))return null;
  if(/\.exe$/i.test(script))return {command:script,args:[]};
  const bundled=path.win32.join(path.win32.dirname(file),'node.exe');
  const node=isExecutable(bundled,{platform:'win32',fsImpl})?bundled:findOnPath(['node.exe'],{env,platform:'win32',fsImpl});
  return node?{command:node,args:[script]}:null;
}
function findCli(name,{platform=process.platform,env=process.env,fsImpl=fs}={}){
  if(platform!=='win32'){
    const home=env.HOME||'';
    const extra=name==='codex'?['/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex']:[];
    for(const candidate of [path.join(home,'.local/bin/'+name),'/opt/homebrew/bin/'+name,'/usr/local/bin/'+name,...extra])
      if(isExecutable(candidate,{platform,fsImpl}))return {command:candidate,args:[]};
    return null;
  }
  const w=path.win32,e=pick(env,['USERPROFILE','APPDATA','LOCALAPPDATA']);
  const candidates=[];
  // Native installers first (Claude Code installs claude.exe here; standalone Codex likewise).
  if(e.USERPROFILE)candidates.push(w.join(e.USERPROFILE,'.local','bin',name+'.exe'));
  if(e.LOCALAPPDATA)candidates.push(w.join(e.LOCALAPPDATA,'Programs',name,name+'.exe'));
  if(e.APPDATA)candidates.push(w.join(e.APPDATA,'npm',name+'.cmd'));
  for(const candidate of candidates){if(!isExecutable(candidate,{platform,fsImpl}))continue;const spec=resolveWindowsShim(candidate,{env,fsImpl});if(spec)return spec;}
  const onPath=findOnPath([name+'.exe',name+'.cmd'],{env,platform,fsImpl});
  return onPath?resolveWindowsShim(onPath,{env,fsImpl}):null;
}
// Bridges historically took a plain path; accept that or a spec.
function launchSpec(value){
  if(!value)return null;
  if(typeof value==='string')return {command:value,args:[]};
  if(typeof value.command==='string'&&Array.isArray(value.args))return {command:value.command,args:[...value.args]};
  return null;
}

// --- Windows command lines -----------------------------------------------------------------
// CommandLineToArgvW rules (2008+): backslashes are literal unless they precede a quote.
function parseWindowsCommandLine(line){
  const args=[];let i=0;const s=String(line||'');
  while(i<s.length){
    while(i<s.length&&(s[i]===' '||s[i]==='\t'))i++;
    if(i>=s.length)break;
    let arg='',quoted=false,started=false;
    for(;i<s.length;i++){
      const c=s[i];
      if(c==='\\'){let n=0;while(s[i]==='\\'){n++;i++;}
        if(s[i]==='"'){arg+='\\'.repeat(Math.floor(n/2));if(n%2){arg+='"';started=true;continue;}i--;continue;}
        arg+='\\'.repeat(n);i--;started=true;continue;}
      if(c==='"'){if(quoted&&s[i+1]==='"'){arg+='"';i++;continue;}quoted=!quoted;started=true;continue;}
      if(!quoted&&(c===' '||c==='\t'))break;
      arg+=c;started=true;
    }
    if(started||arg)args.push(arg);
  }
  return args;
}
const samePath=(a,b,platform=process.platform)=>{
  if(typeof a!=='string'||typeof b!=='string')return false;
  if(platform!=='win32')return a===b;
  return path.win32.normalize(a).toLowerCase()===path.win32.normalize(b).toLowerCase();
};

// --- Stopping a process tree on Windows ----------------------------------------------------
// Signals are emulated on Windows: child.kill() is TerminateProcess on the launcher only, and a
// venv python.exe is a launcher whose real interpreter is a child that would keep the port.
function taskkill(pid,{force=false,env=process.env,run=execFile}={}){
  const root=pick(env,['SystemRoot']).SystemRoot||'C:\\Windows';
  const args=['/PID',String(pid),'/T'];if(force)args.push('/F');
  return new Promise(resolve=>run(path.win32.join(root,'System32','taskkill.exe'),args,{windowsHide:true,timeout:10000},error=>resolve(!error)));
}
function killTree(child,{force=true,platform=process.platform,env=process.env,run}={}){
  if(!child||child.exitCode!==null||child.signalCode||!Number.isInteger(child.pid))return Promise.resolve(false);
  if(platform!=='win32'){try{child.kill(force?'SIGKILL':'SIGTERM');return Promise.resolve(true);}catch{return Promise.resolve(false);}}
  return taskkill(child.pid,{force,env,run});
}

module.exports={LAYOUTS,layout,requiredFiles,envKeys,minimalEnv,findCli,launchSpec,parseNpmShim,resolveWindowsShim,
  parseWindowsCommandLine,samePath,taskkill,killTree,isExecutable};

'use strict';
const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');const path=require('node:path');const fs=require('node:fs');
const run=promisify(execFile);
const platformInfo=require('./platform.cjs');
const PORTS={pankeki:8190,comfy:8188};
function argument(command,flag,value){const needle=flag+' '+value;const at=command.indexOf(needle);return at>=0 && (at===0||command[at-1]===' ') && (at+needle.length===command.length||command[at+needle.length]===' ');}
// Windows has no per-process cwd to inspect, so the launch uses absolute paths and the match is on
// the parsed argument vector (CommandLineToArgvW rules), compared case-insensitively.
function optionValue(args,flag){const at=args.indexOf(flag);return at>=0&&at+1<args.length?args[at+1]:undefined;}
function windowsListenerMatches(kind,listener,paths){
  const args=Array.isArray(listener.args)?listener.args:platformInfo.parseWindowsCommandLine(listener.command);
  const same=(a,b)=>platformInfo.samePath(a,b,'win32');
  if(optionValue(args,'--port')!==String(PORTS[kind]))return false;
  if(kind==='pankeki'){
    const at=args.indexOf('-m');
    return at>=0&&args[at+1]==='pankeki'&&args[at+2]==='serve'&&same(optionValue(args,'--config'),paths.config);
  }
  return args.some(value=>same(value,path.win32.join(paths.comfyRoot,'main.py')))&&optionValue(args,'--listen')==='127.0.0.1'
    &&same(optionValue(args,'--extra-model-paths-config'),paths.modelPaths);
}
function listenerMatches(kind,listener,paths,platform=paths?.platform||process.platform) {
  if(!listener?.loopback||!Number.isInteger(listener.pid)||listener.pid<=1)return false;
  if(platform==='win32')return windowsListenerMatches(kind,listener,paths);
  if(kind==='pankeki')return listener.cwd===paths.projectRoot && /(?:^| )-m pankeki serve(?: |$)/.test(listener.command) && argument(listener.command,'--config',paths.config) && argument(listener.command,'--port','8190');
  return listener.cwd===paths.comfyRoot && /(?:^| )main\.py(?: |$)/.test(listener.command) && argument(listener.command,'--listen','127.0.0.1') && argument(listener.command,'--port','8188');
}
// netstat state names are localized (Korean Windows prints "수신 대기"), so a listener is recognised by
// its wildcard remote address instead of the word LISTENING.
function parseNetstat(text,port){
  const rows=[];
  for(const line of String(text).split(/\r?\n/)){
    const cols=line.trim().split(/\s+/);
    if(cols.length<5||!/^TCP(V6)?$/i.test(cols[0]))continue;
    const local=cols[1],remote=cols[2],pid=Number(cols[cols.length-1]);
    const portAt=local.lastIndexOf(':');if(portAt<0||Number(local.slice(portAt+1))!==port)continue;
    if(!/^(0\.0\.0\.0|\[::\]|\*):(0|\*)$/.test(remote))continue;
    if(Number.isInteger(pid))rows.push({address:local.slice(0,portAt),pid});
  }
  return rows;
}
const WINDOWS_PROCESS_SCRIPT=pid=>[
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8',"$ErrorActionPreference='Stop'",
  `$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'`,
  "if(!$p){'null';exit 0}",
  '$a=@();$cur=[int]$p.ParentProcessId',
  "for($i=0;$i -lt 8 -and $cur -gt 0;$i++){$q=Get-CimInstance Win32_Process -Filter \"ProcessId=$cur\";if(!$q){break};$a+=[int]$q.ProcessId;$cur=[int]$q.ParentProcessId}",
  '[ordered]@{pid=[int]$p.ProcessId;commandLine=[string]$p.CommandLine;executable=[string]$p.ExecutablePath;ancestors=$a}|ConvertTo-Json -Compress'
].join(';');
function windowsTool(name,env=process.env){
  const root=(Object.entries(env).find(([key])=>key.toLowerCase()==='systemroot')||[])[1]||'C:\\Windows';
  return name==='powershell'?path.win32.join(root,'System32','WindowsPowerShell','v1.0','powershell.exe'):path.win32.join(root,'System32',name+'.exe');
}
async function inspectWindowsListener(kind,{full=true,runImpl=run,env=process.env}={}){
  let output;
  try{
    // -p TCP is IPv4 only; a foreign listener on [::1] must also count as occupying the port.
    const [v4,v6]=await Promise.all(['TCP','TCPv6'].map(protocol=>runImpl(windowsTool('netstat',env),['-ano','-p',protocol],{timeout:5000,windowsHide:true})));
    output=v4.stdout+'\n'+v6.stdout;
  }catch{throw Error('listener-inspection-failed');}
  const rows=parseNetstat(output,PORTS[kind]);
  if(!rows.length)return null;
  const pids=[...new Set(rows.map(row=>row.pid))];
  if(pids.length!==1)return {pid:0,loopback:false};
  const pid=pids[0],loopback=rows.every(row=>row.address==='127.0.0.1');
  if(!full)return {pid,loopback};
  let info;
  try{
    const encoded=Buffer.from(WINDOWS_PROCESS_SCRIPT(pid),'utf16le').toString('base64');
    info=JSON.parse((await runImpl(windowsTool('powershell',env),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',encoded],
      {timeout:15000,windowsHide:true,encoding:'utf8'})).stdout.trim()||'null');
  }catch{throw Error('listener-inspection-failed');}
  if(!info||info.pid!==pid)return {pid:0,loopback:false};
  return {pid,loopback,command:info.commandLine,args:platformInfo.parseWindowsCommandLine(info.commandLine),executable:info.executable,
    ancestors:Array.isArray(info.ancestors)?info.ancestors.filter(Number.isInteger):[]};
}
async function inspectListener(kind,options={}) {
  if((options.platform||process.platform)==='win32')return inspectWindowsListener(kind,options);
  let output;
  try{output=(await run('/usr/sbin/lsof',['-nP',`-iTCP:${PORTS[kind]}`,'-sTCP:LISTEN','-Fpn'],{timeout:5000})).stdout;}
  catch(error){if(error.code===1)return null;throw Error('listener-inspection-failed');}
  const pids=[...output.matchAll(/^p(\d+)$/gm)].map(x=>Number(x[1]));
  if(pids.length!==1)return {pid:0,loopback:false};
  const pid=pids[0];
  const [process,cwd]=await Promise.all([
    run('/bin/ps',['-p',String(pid),'-o','command='],{timeout:5000}),
    run('/usr/sbin/lsof',['-a','-p',String(pid),'-d','cwd','-Fn'],{timeout:5000})
  ]);
  const names=[...output.matchAll(/^n(.+)$/gm)].map(x=>x[1]);
  return {pid,command:process.stdout.trim(),cwd:cwd.stdout.split('\n').find(x=>x.startsWith('n'))?.slice(1),
    loopback:names.length>0 && names.every(n=>n===`127.0.0.1:${PORTS[kind]}`)};
}
async function probe(kind) {
  try {
    const response=await fetch(`http://127.0.0.1:${PORTS[kind]}/${kind==='pankeki'?'api/health':'system_stats'}`,{signal:AbortSignal.timeout(2000),redirect:'error'});
    const value=await response.json();return response.ok && (kind==='pankeki'?typeof value.comfy==='boolean':!!value.system);
  }catch{return false;}
}
async function stopChild(child,timeouts,{platform=process.platform,killTree=platformInfo.killTree}={}) {
  if(!child||child.exitCode!==null||child.signalCode)return;
  const ended=new Promise(resolve=>child.once('exit',resolve));
  if(platform==='win32'){
    // Polite tree stop, then forced tree stop: the venv launcher's interpreter child must go too.
    for(const [force,limit] of [[false,timeouts.interrupt],[true,timeouts.terminate+timeouts.kill]]){
      // taskkill without /F fails at once for windowless python.exe ("can only be terminated forcefully");
      // then go straight to the forced step instead of waiting out the polite timeout.
      const sent=await killTree(child,{force,platform});
      if(!sent&&!force&&child.exitCode===null&&!child.signalCode)continue;
      let timer;
      const exited=await Promise.race([ended.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),limit);})]);clearTimeout(timer);
      if(exited)return;
    }
    throw Error('owned-child-not-stopped');
  }
  for(const [signal,limit] of [['SIGINT',timeouts.interrupt],['SIGTERM',timeouts.terminate],['SIGKILL',timeouts.kill]]){
    child.kill(signal);let timer;
    const exited=await Promise.race([ended.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),limit);})]);clearTimeout(timer);
    if(exited)return;
  }
  throw Error('owned-child-not-stopped');
}
function createBackendManager({paths,platform=paths?.platform||process.platform,inspectListener:inspect=(kind,options)=>inspectListener(kind,{...options,platform}),
  probe:health=probe,launch=spawn,killTree,readyTimeout=120000,shutdownTimeouts={interrupt:10000,terminate:5000,kill:3000}}={}) {
  const windows=platform==='win32';
  const matches=(kind,listener)=>listenerMatches(kind,listener,paths,platform);
  // A Windows venv python.exe is a launcher; the socket belongs to its interpreter child.
  const ownedBy=(listener,expectedPid)=>listener.pid===expectedPid||(windows&&Array.isArray(listener.ancestors)&&listener.ancestors.includes(expectedPid));
  const stop=child=>stopChild(child,shutdownTimeouts,{platform,...(killTree?{killTree}:{})});
  const owned=new Map();let startPromise,closePromise,closing=false,epoch=0;
  const verified=new Map();
  const states={pankeki:{state:'stopped',ownership:'none'},comfy:{state:'stopped',ownership:'none'}};
  function status(){return structuredClone(states);}
  function guard(token){if(closing||token!==epoch)throw Error('startup-canceled');}
  async function close(){
    closing=true;epoch++;
    if(closePromise)return closePromise;
    closePromise=(async()=>{for(const kind of ['pankeki','comfy'])if(owned.has(kind)){await stop(owned.get(kind));owned.delete(kind);states[kind]={state:'stopped',ownership:'none'};}})();
    try{return await closePromise;}catch(error){closePromise=null;throw error;}
  }
  async function wait(kind,expectedPid,child,token){
    const until=Date.now()+readyTimeout;
    while(Date.now()<until){
      guard(token);
      if(child&&(child.exitCode!==null||child.signalCode))throw Error('backend-exited');
      if(await health(kind)){
        guard(token);
        const current=await inspect(kind);
        guard(token);
        if(!matches(kind,current)||!ownedBy(current,expectedPid))throw Error('backend-identity-changed');
        return current.pid;
      }
      await new Promise(resolve=>setTimeout(resolve,400));
    }
    throw Error('backend-timeout');
  }
  async function start(){
    guard(epoch);
    if(startPromise)return startPromise;
    const token=epoch;
    startPromise=(async()=>{
      const found={};
      for(const kind of ['comfy','pankeki']){
        found[kind]=await inspect(kind);
        guard(token);
        if(found[kind]&&!matches(kind,found[kind]))throw Error('port-occupied');
      }
      try {
        for(const kind of ['comfy','pankeki']){
          guard(token);
          if(found[kind]){const pid=await wait(kind,found[kind].pid,undefined,token);guard(token);verified.set(kind,pid);states[kind]={state:'ready',ownership:'external'};continue;}
          states[kind]={state:'starting',ownership:'app'};
          let env;
          if(windows){env=platformInfo.minimalEnv(process.env,'win32');Object.assign(env,{HF_HUB_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1',DO_NOT_TRACK:'1'});}
          else{env={};for(const key of ['HOME','PATH','USER','LOGNAME','LANG','LC_ALL','TMPDIR'])if(process.env[key])env[key]=process.env[key];
            Object.assign(env,{PYTORCH_ENABLE_MPS_FALLBACK:'1',HF_HUB_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1',DO_NOT_TRACK:'1'});}
          const args=kind==='pankeki'?['-u','-m','pankeki','serve','--port','8190','--comfy-url','http://127.0.0.1:8188','--config',paths.config]:
            ['-u',windows?path.win32.join(paths.comfyRoot,'main.py'):'main.py','--listen','127.0.0.1','--port','8188','--offline','--disable-all-custom-nodes','--use-pytorch-cross-attention',
              '--fp16-unet','--fp16-text-enc','--fp32-vae','--preview-method','latent2rgb','--extra-model-paths-config',paths.modelPaths,
              '--user-directory',path.join(paths.runtime,'comfy-user'),'--input-directory',path.join(paths.runtime,'comfy-input'),
              '--output-directory',path.join(paths.runtime,'comfy-output'),'--temp-directory',path.join(paths.runtime,'comfy-temp')];
          fs.mkdirSync(paths.runtime,{recursive:true});
          if(kind==='comfy')for(const name of ['user','input','output','temp'])
            fs.mkdirSync(path.join(paths.runtime,'comfy-'+name),{recursive:true});
          const child=launch(paths.python,args,{cwd:kind==='pankeki'?paths.projectRoot:paths.comfyRoot,env,shell:false,stdio:'ignore',...(windows?{windowsHide:true}:{})});
          owned.set(kind,child);child.once('error',()=>{states[kind]={state:'error',ownership:'app'};});
          child.once('exit',()=>{states[kind]={state:'stopped',ownership:'none'};});
          const pid=await wait(kind,child.pid,child,token);guard(token);verified.set(kind,pid);states[kind]={state:'ready',ownership:'app'};
        }
        guard(token);return status();
      }catch(error){await close();throw error;}
    })();
    try{return await startPromise;}catch(error){startPromise=null;throw error;}
  }
  async function verifyIdentity(){
    for(const kind of ['pankeki','comfy']){
      // Windows: every IPC call verifies, and a PowerShell process lookup costs about a second, so the
      // recheck is the fast netstat ownership test against the PID whose full identity was verified at start.
      const listener=await inspect(kind,windows?{full:false}:undefined);
      if(windows?(!listener?.loopback||listener.pid!==verified.get(kind)):(!matches(kind,listener)||listener.pid!==verified.get(kind)))return false;
    }
    return true;
  }
  return {start,close,status,verifyIdentity};
}
module.exports={createBackendManager,listenerMatches,inspectListener,parseNetstat,stopChild};

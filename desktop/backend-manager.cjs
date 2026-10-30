'use strict';
const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');const path=require('node:path');const fs=require('node:fs');
const run=promisify(execFile);
const PORTS={pankeki:8190,comfy:8188};
function argument(command,flag,value){const needle=flag+' '+value;const at=command.indexOf(needle);return at>=0 && (at===0||command[at-1]===' ') && (at+needle.length===command.length||command[at+needle.length]===' ');}
function listenerMatches(kind,listener,paths) {
  if(!listener?.loopback||!Number.isInteger(listener.pid)||listener.pid<=1)return false;
  if(kind==='pankeki')return listener.cwd===paths.projectRoot && /(?:^| )-m pankeki serve(?: |$)/.test(listener.command) && argument(listener.command,'--config',paths.config) && argument(listener.command,'--port','8190');
  return listener.cwd===paths.comfyRoot && /(?:^| )main\.py(?: |$)/.test(listener.command) && argument(listener.command,'--listen','127.0.0.1') && argument(listener.command,'--port','8188');
}
async function inspectListener(kind) {
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
async function stopChild(child,timeouts) {
  if(!child||child.exitCode!==null||child.signalCode)return;
  const ended=new Promise(resolve=>child.once('exit',resolve));
  for(const [signal,limit] of [['SIGINT',timeouts.interrupt],['SIGTERM',timeouts.terminate],['SIGKILL',timeouts.kill]]){
    child.kill(signal);let timer;
    const exited=await Promise.race([ended.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),limit);})]);clearTimeout(timer);
    if(exited)return;
  }
  throw Error('owned-child-not-stopped');
}
function createBackendManager({paths,inspectListener:inspect=inspectListener,probe:health=probe,launch=spawn,readyTimeout=120000,
  shutdownTimeouts={interrupt:10000,terminate:5000,kill:3000}}={}) {
  const owned=new Map();let startPromise,closePromise,closing=false,epoch=0;
  const verified=new Map();
  const states={pankeki:{state:'stopped',ownership:'none'},comfy:{state:'stopped',ownership:'none'}};
  function status(){return structuredClone(states);}
  function guard(token){if(closing||token!==epoch)throw Error('startup-canceled');}
  async function close(){
    closing=true;epoch++;
    if(closePromise)return closePromise;
    closePromise=(async()=>{for(const kind of ['pankeki','comfy'])if(owned.has(kind)){await stopChild(owned.get(kind),shutdownTimeouts);owned.delete(kind);states[kind]={state:'stopped',ownership:'none'};}})();
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
        if(!listenerMatches(kind,current,paths)||current.pid!==expectedPid)throw Error('backend-identity-changed');
        return;
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
        if(found[kind]&&!listenerMatches(kind,found[kind],paths))throw Error('port-occupied');
      }
      try {
        for(const kind of ['comfy','pankeki']){
          guard(token);
          if(found[kind]){await wait(kind,found[kind].pid,undefined,token);guard(token);verified.set(kind,found[kind].pid);states[kind]={state:'ready',ownership:'external'};continue;}
          states[kind]={state:'starting',ownership:'app'};
          const env={};for(const key of ['HOME','PATH','USER','LOGNAME','LANG','LC_ALL','TMPDIR'])if(process.env[key])env[key]=process.env[key];
          Object.assign(env,{PYTORCH_ENABLE_MPS_FALLBACK:'1',HF_HUB_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1',DO_NOT_TRACK:'1'});
          const args=kind==='pankeki'?['-u','-m','pankeki','serve','--port','8190','--comfy-url','http://127.0.0.1:8188','--config',paths.config]:
            ['-u','main.py','--listen','127.0.0.1','--port','8188','--offline','--disable-all-custom-nodes','--use-pytorch-cross-attention',
              '--fp16-unet','--fp16-text-enc','--fp32-vae','--preview-method','latent2rgb','--extra-model-paths-config',paths.modelPaths,
              '--user-directory',path.join(paths.runtime,'comfy-user'),'--input-directory',path.join(paths.runtime,'comfy-input'),
              '--output-directory',path.join(paths.runtime,'comfy-output'),'--temp-directory',path.join(paths.runtime,'comfy-temp')];
          fs.mkdirSync(paths.runtime,{recursive:true});
          if(kind==='comfy')for(const name of ['user','input','output','temp'])
            fs.mkdirSync(path.join(paths.runtime,'comfy-'+name),{recursive:true});
          const child=launch(paths.python,args,{cwd:kind==='pankeki'?paths.projectRoot:paths.comfyRoot,env,shell:false,stdio:'ignore'});
          owned.set(kind,child);child.once('error',()=>{states[kind]={state:'error',ownership:'app'};});
          child.once('exit',()=>{states[kind]={state:'stopped',ownership:'none'};});
          await wait(kind,child.pid,child,token);guard(token);verified.set(kind,child.pid);states[kind]={state:'ready',ownership:'app'};
        }
        guard(token);return status();
      }catch(error){await close();throw error;}
    })();
    try{return await startPromise;}catch(error){startPromise=null;throw error;}
  }
  async function verifyIdentity(){
    for(const kind of ['pankeki','comfy']){const listener=await inspect(kind);if(!listenerMatches(kind,listener,paths)||listener.pid!==verified.get(kind))return false;}
    return true;
  }
  return {start,close,status,verifyIdentity};
}
module.exports={createBackendManager,listenerMatches,inspectListener};

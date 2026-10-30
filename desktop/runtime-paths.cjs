'use strict';
const fs=require('node:fs');const path=require('node:path');
const platformInfo=require('./platform.cjs');
// macOS keeps its original layout; Windows uses .venv-windows and runtime/windows (see platform.cjs).
const REQUIRED=platformInfo.requiredFiles(process.platform);
const SAVED_ROOT_FILE='project-root.json';

function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}

// Candidates in priority order. A packaged app no longer depends on the build machine's
// absolute path: the user can point it at a moved checkout (env or saved choice).
function candidates({projectRoot,env=process.env,settingsDir,resourcesPath=process.resourcesPath}={}){
  const list=[];
  if(projectRoot)list.push({root:projectRoot,source:'argument'});
  if(env.PANKEKI_PROJECT_ROOT)list.push({root:env.PANKEKI_PROJECT_ROOT,source:'environment'});
  if(settingsDir){const saved=readJson(path.join(settingsDir,SAVED_ROOT_FILE));if(saved&&typeof saved.projectRoot==='string')list.push({root:saved.projectRoot,source:'saved'});}
  if(resourcesPath){const bundled=readJson(path.join(resourcesPath,'runtime.json'));if(bundled&&typeof bundled.projectRoot==='string')list.push({root:bundled.projectRoot,source:'bundled'});}
  // Source checkout: desktop/ sits inside the project. Inside a packaged app this path does not validate.
  list.push({root:path.resolve(__dirname,'..'),source:'development'});
  return list;
}

function inspectRoot(configured,platform=process.platform){
  if(typeof configured!=='string'||!path.isAbsolute(configured))return null;
  let root;try{root=fs.realpathSync(configured);}catch{return null;}
  const l=platformInfo.layout(platform),at=relative=>path.join(root,...relative.split('/'));
  const p={projectRoot:root,python:at(l.python),config:at(l.config),modelPaths:at(l.modelPaths),comfyRoot:path.join(root,'vendor','ComfyUI'),
    runtime:at(l.runtime),mcpPython:at(l.mcpPython),platform:platform==='win32'?'win32':'darwin'};
  for(const file of platformInfo.requiredFiles(platform))if(!fs.existsSync(at(file)))return null;
  return p;
}

// macOS returns the executable path (unchanged contract); Windows may need `node script.js`,
// so it returns a {command,args} launch spec that the bridges accept.
function findCodex(env=process.env,platform=process.platform){
  const spec=platformInfo.findCli('codex',{env,platform});
  if(!spec)return null;
  return platform==='win32'?spec:spec.command;
}

function resolveRuntime(options={}){
  // An explicit argument is authoritative: it never falls through to other locations.
  const list=options.projectRoot?[{root:options.projectRoot,source:'argument'}]:candidates(options);
  for(const candidate of list){
    const p=inspectRoot(candidate.root,options.platform);
    if(p)return {...p,rootSource:candidate.source,codexPath:options.codexPath===undefined?findCodex(options.env,options.platform):options.codexPath};
  }
  throw Error('runtime-missing');
}

function saveProjectRoot(settingsDir,projectRoot){
  if(!inspectRoot(projectRoot))throw Error('runtime-missing');
  fs.mkdirSync(settingsDir,{recursive:true});
  const file=path.join(settingsDir,SAVED_ROOT_FILE),temporary=file+'.tmp';
  fs.writeFileSync(temporary,JSON.stringify({projectRoot:fs.realpathSync(projectRoot)},null,2)+'\n',{mode:0o600});
  fs.renameSync(temporary,file);
}

module.exports={resolveRuntime,saveProjectRoot,REQUIRED,inspectRoot};

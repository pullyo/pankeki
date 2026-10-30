'use strict';
const fs=require('node:fs');const path=require('node:path');
const REQUIRED=['.venv-macos/bin/python','runtime/macos/config.json','runtime/macos/model-paths.yaml','vendor/ComfyUI/main.py','pankeki/__main__.py','web/index.html'];
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

function inspectRoot(configured){
  if(typeof configured!=='string'||!path.isAbsolute(configured))return null;
  let root;try{root=fs.realpathSync(configured);}catch{return null;}
  const p={projectRoot:root,python:path.join(root,'.venv-macos/bin/python'),config:path.join(root,'runtime/macos/config.json'),
    modelPaths:path.join(root,'runtime/macos/model-paths.yaml'),comfyRoot:path.join(root,'vendor/ComfyUI'),
    runtime:path.join(root,'runtime/macos/desktop-codex'),mcpPython:path.join(root,'runtime/macos/pankeki-mcp-20261023/release/venv/bin/python')};
  for(const file of REQUIRED)if(!fs.existsSync(path.join(root,file)))return null;
  return p;
}

function findCodex(env=process.env){
  for(const candidate of [path.join(env.HOME||'','.local/bin/codex'),'/opt/homebrew/bin/codex','/usr/local/bin/codex','/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex']){
    try{fs.accessSync(candidate,fs.constants.X_OK);return candidate;}catch{}
  }
  return null;
}

function resolveRuntime(options={}){
  // An explicit argument is authoritative: it never falls through to other locations.
  const list=options.projectRoot?[{root:options.projectRoot,source:'argument'}]:candidates(options);
  for(const candidate of list){
    const p=inspectRoot(candidate.root);
    if(p)return {...p,rootSource:candidate.source,codexPath:options.codexPath===undefined?findCodex(options.env):options.codexPath};
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

module.exports={resolveRuntime,saveProjectRoot,REQUIRED};

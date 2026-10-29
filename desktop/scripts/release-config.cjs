'use strict';
// Shared by freeze-release.cjs and package-mac.cjs so both check the same bundle inputs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),desktop=path.join(root,'desktop');
// Release target: 'mac' (package-mac.cjs) or 'windows' (package-win.cjs). Defaults to the host OS;
// PANKEKI_RELEASE_TARGET=windows freezes a Windows build from a Mac (cross build).
const target=process.env.PANKEKI_RELEASE_TARGET||(process.platform==='win32'?'windows':'mac');
if(!['mac','windows'].includes(target))throw Error('PANKEKI_RELEASE_TARGET must be mac or windows');
const packageScript=target==='windows'?'package-win.cjs':'package-mac.cjs';
const releaseDir=process.env.PANKEKI_RELEASE_DIR?path.resolve(process.env.PANKEKI_RELEASE_DIR):path.join(root,'output/desktop-release',target);
const files=['main.cjs','preload.cjs','ipc.cjs','security.cjs','platform.cjs','runtime-paths.cjs','backend-manager.cjs','edit-context.cjs','result-resolver.cjs','video-scene-picker.cjs','codex-bridge.cjs','pankeki-tools.cjs','claude-bridge.cjs','chat-providers.cjs','chat-model-settings.cjs','build-identity.cjs','profiles.cjs','shell.html'];
const sourceFor=file=>file==='profiles.cjs'?path.join(root,'web/src/profiles.js'):path.join(desktop,file);
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function currentInputs(){
  return {webSha256:sha(path.join(root,'web/index.html')),appJsSha256:sha(path.join(root,'web/src/app.js')),
    packageScriptSha256:sha(path.join(desktop,'scripts',packageScript)),entitlementsSha256:sha(path.join(desktop,'build/entitlements.mac.plist')),
    files:Object.fromEntries(files.map(file=>[file,sha(sourceFor(file))]))};
}
// Every bundled file must match the freeze, not only a few of them.
function staleInputs(freeze){
  const now=currentInputs(),stale=[];
  for(const key of ['webSha256','appJsSha256','packageScriptSha256','entitlementsSha256'])if(freeze[key]!==now[key])stale.push(key);
  for(const [file,digest] of Object.entries(now.files))if(!freeze.files||freeze.files[file]!==digest)stale.push(file);
  return stale;
}
module.exports={root,desktop,target,packageScript,releaseDir,files,sourceFor,sha,currentInputs,staleInputs};

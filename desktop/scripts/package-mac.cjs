'use strict';
// Build only this desktop client; Python/Comfy/models/Codex/Claude CLI stay external.
//   node scripts/freeze-release.cjs && node scripts/package-mac.cjs
// Signing: with PANKEKI_SIGN_IDENTITY ("Developer ID Application: Name (TEAMID)") the app is signed
// with the hardened runtime; with PANKEKI_NOTARY_PROFILE (an `xcrun notarytool store-credentials`
// keychain profile) the DMG is notarized and stapled. Without them the build is ad-hoc signed and
// Gatekeeper will block it on other Macs.
const fs=require('node:fs'),path=require('node:path');const {execFileSync}=require('node:child_process');
const {root,desktop,releaseDir,files,sourceFor,sha,staleInputs}=require('./release-config.cjs');
const run=(cmd,args)=>execFileSync(cmd,args,{stdio:'pipe'});
async function main(){
  const freezeFile=path.join(releaseDir,'release-inputs.json');
  if(!fs.existsSync(freezeFile))throw Error('release-inputs-missing: run node scripts/freeze-release.cjs');
  const freeze=JSON.parse(fs.readFileSync(freezeFile,'utf8'));
  const stale=freeze.frontendFrozen?staleInputs(freeze):['frontendFrozen'];
  if(stale.length)throw Error('release-inputs-not-frozen: '+stale.join(', ')+' changed; re-run node scripts/freeze-release.cjs');
  const build=path.join(releaseDir,'artifacts',new Date().toISOString().replace(/[:.]/g,'-'));
  const stage=path.join(build,'client');fs.mkdirSync(stage,{recursive:true});
  for(const file of files)fs.copyFileSync(sourceFor(file),path.join(stage,file));
  const pkg=JSON.parse(fs.readFileSync(path.join(desktop,'package.json'),'utf8'));
  fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify({name:pkg.name,version:pkg.version,description:pkg.description,main:'main.cjs',private:true},null,2));
  // Default location only; the app also accepts PANKEKI_PROJECT_ROOT or a folder the user picks.
  const runtimeFile=path.join(build,'runtime.json');
  fs.writeFileSync(runtimeFile,JSON.stringify({projectRoot:root,externalRuntimeRequired:true,...freeze},null,2)+'\n');
  const icon=path.join(desktop,'assets','Pankeki-user-20261025.icns');
  const electronVersion=require(path.join(desktop,'node_modules/electron/package.json')).version;
  const {packager}=await import('@electron/packager');
  const apps=await packager({dir:stage,out:build,name:'Pankeki',appBundleId:process.env.PANKEKI_BUNDLE_ID||'local.pankeki.desktop',appVersion:pkg.version,
    platform:'darwin',arch:process.env.PANKEKI_ARCH||'arm64',electronVersion,...(process.env.PANKEKI_ELECTRON_ZIP_DIR?{electronZipDir:process.env.PANKEKI_ELECTRON_ZIP_DIR}:{}),
    icon,asar:true,prune:false,overwrite:false,extraResource:[runtimeFile],osxSign:false});
  const appPath=path.join(apps[0],'Pankeki.app');
  const identity=process.env.PANKEKI_SIGN_IDENTITY||null,notaryProfile=process.env.PANKEKI_NOTARY_PROFILE||null;
  if(notaryProfile&&!identity)throw Error('notarization requires PANKEKI_SIGN_IDENTITY');
  if(identity)run('/usr/bin/codesign',['--force','--deep','--options','runtime','--timestamp','--entitlements',path.join(desktop,'build/entitlements.mac.plist'),'--sign',identity,appPath]);
  else run('/usr/bin/codesign',['--force','--deep','--sign','-',appPath]);
  run('/usr/bin/codesign',['--verify','--deep','--strict',appPath]);
  const signing=identity?'developer-id':'ad-hoc';
  const readme=`Pankeki ${pkg.version} ${process.env.PANKEKI_ARCH||'arm64'} desktop build\n\nThe app needs a Pankeki project checkout with its runtime (.venv-macos, vendor/ComfyUI, models).\nBuilt against: ${root}\nIf that folder is not present, the app asks for the project folder on first start (or set PANKEKI_PROJECT_ROOT).\n\nChat uses the external Codex CLI (ChatGPT sign-in) or Claude Code CLI (claude.ai sign-in); no models or runtimes are bundled.\nSigning: ${signing}${notaryProfile?', notarized':', not notarized'}.\n`;
  fs.writeFileSync(path.join(apps[0],'README.txt'),readme);
  const dmg=path.join(build,`Pankeki-${pkg.version}-${process.env.PANKEKI_ARCH||'arm64'}.dmg`);let dmgError=null,notarized=false;
  try{run('/usr/bin/hdiutil',['create','-volname','Pankeki','-srcfolder',apps[0],'-format','UDZO',dmg]);}catch(error){dmgError=String(error.stderr||error.message).slice(0,1000);}
  if(notaryProfile&&fs.existsSync(dmg)){
    if(identity)run('/usr/bin/codesign',['--force','--timestamp','--sign',identity,dmg]);
    run('/usr/bin/xcrun',['notarytool','submit',dmg,'--keychain-profile',notaryProfile,'--wait']);
    run('/usr/bin/xcrun',['stapler','staple',dmg]);notarized=true;
  }
  const manifest={builtAt:new Date().toISOString(),appPath,dmg:fs.existsSync(dmg)?{path:dmg,size:fs.statSync(dmg).size,sha256:sha(dmg)}:null,dmgError,
    appAsar:{path:path.join(appPath,'Contents/Resources/app.asar'),sha256:sha(path.join(appPath,'Contents/Resources/app.asar'))},
    freeze,versions:{electron:electronVersion,app:pkg.version},externalRuntimeRequired:true,signing,notarized,modelsCopied:0,venvCopied:false,
    files:Object.fromEntries(files.map(file=>[file,sha(sourceFor(file))]))};
  fs.writeFileSync(path.join(releaseDir,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({appPath,dmg:manifest.dmg,dmgError,signing,notarized},null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});

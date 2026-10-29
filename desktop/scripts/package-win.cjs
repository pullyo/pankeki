'use strict';
// Build only the Windows desktop client (x64); Python/ComfyUI/models/Codex/Claude CLI stay external,
// exactly like the macOS package.
//   set PANKEKI_RELEASE_TARGET=windows   (automatic on a Windows host)
//   node scripts/freeze-release.cjs && node scripts/package-win.cjs
// Cross build from macOS/Linux works for the app itself. Embedding the .exe icon needs rcedit, which
// runs natively on Windows or through wine elsewhere; without either the build is made without the
// embedded icon and the manifest says so. The build is not Authenticode-signed: SmartScreen will warn.
const fs=require('node:fs'),path=require('node:path');const {execFileSync}=require('node:child_process');
const {root,desktop,target,releaseDir,files,sourceFor,sha,staleInputs}=require('./release-config.cjs');
const ARCH=process.env.PANKEKI_ARCH||'x64';

// ICO with PNG-compressed entries (valid since Windows Vista).
function buildIco(pngFiles){
  const images=pngFiles.map(file=>{const data=fs.readFileSync(file);return {data,width:data.readUInt32BE(16),height:data.readUInt32BE(20)};})
    .filter(image=>image.width===image.height&&image.width<=256).sort((a,b)=>a.width-b.width);
  const header=Buffer.alloc(6);header.writeUInt16LE(0,0);header.writeUInt16LE(1,2);header.writeUInt16LE(images.length,4);
  const entries=[];let offset=6+16*images.length;
  for(const image of images){
    const entry=Buffer.alloc(16);entry.writeUInt8(image.width>=256?0:image.width,0);entry.writeUInt8(image.height>=256?0:image.height,1);
    entry.writeUInt16LE(1,4);entry.writeUInt16LE(32,6);entry.writeUInt32LE(image.data.length,8);entry.writeUInt32LE(offset,12);
    entries.push(entry);offset+=image.data.length;
  }
  return Buffer.concat([header,...entries,...images.map(image=>image.data)]);
}
function canEmbedIcon(){
  if(process.platform==='win32')return true;
  try{execFileSync('wine',['--version'],{stdio:'pipe',timeout:10000});return true;}catch{return false;}
}
function zipFolder(folder,zipFile){
  if(process.platform==='win32'){
    execFileSync(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),
      ['-NoProfile','-NonInteractive','-Command','Compress-Archive -LiteralPath $env:PANKEKI_ZIP_SRC -DestinationPath $env:PANKEKI_ZIP_DST'],
      {stdio:'pipe',env:{...process.env,PANKEKI_ZIP_SRC:folder,PANKEKI_ZIP_DST:zipFile}});
    return;
  }
  // -X: no macOS extended attributes; -y: keep links as links (there should be none).
  execFileSync('zip',['-q','-r','-X','-y',zipFile,path.basename(folder)],{cwd:path.dirname(folder),stdio:'pipe'});
}

async function main(){
  if(target!=='windows')throw Error('release-target-mismatch: set PANKEKI_RELEASE_TARGET=windows before freeze-release.cjs and package-win.cjs');
  const freezeFile=path.join(releaseDir,'release-inputs.json');
  if(!fs.existsSync(freezeFile))throw Error('release-inputs-missing: run node scripts/freeze-release.cjs');
  const freeze=JSON.parse(fs.readFileSync(freezeFile,'utf8'));
  if(freeze.target!=='windows')throw Error('release-inputs-not-frozen: target is '+(freeze.target||'mac')+'; re-run node scripts/freeze-release.cjs with PANKEKI_RELEASE_TARGET=windows');
  const stale=freeze.frontendFrozen?staleInputs(freeze):['frontendFrozen'];
  if(stale.length)throw Error('release-inputs-not-frozen: '+stale.join(', ')+' changed; re-run node scripts/freeze-release.cjs');
  const build=path.join(releaseDir,'artifacts',new Date().toISOString().replace(/[:.]/g,'-'));
  const stage=path.join(build,'client');fs.mkdirSync(path.join(stage,'assets'),{recursive:true});
  for(const file of files)fs.copyFileSync(sourceFor(file),path.join(stage,file));
  fs.copyFileSync(path.join(desktop,'assets','pankeki-256.png'),path.join(stage,'assets','pankeki-256.png'));
  const pkg=JSON.parse(fs.readFileSync(path.join(desktop,'package.json'),'utf8'));
  fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify({name:pkg.name,version:pkg.version,description:'Pankeki desktop with an external local engine',main:'main.cjs',private:true},null,2));
  // Default location only. A Mac build path never exists on Windows, so a cross-built app always asks
  // for the project folder (or reads PANKEKI_PROJECT_ROOT) on first start.
  const runtimeFile=path.join(build,'runtime.json');
  fs.writeFileSync(runtimeFile,JSON.stringify({projectRoot:process.env.PANKEKI_WIN_PROJECT_ROOT||(process.platform==='win32'?root:null),externalRuntimeRequired:true,...freeze},null,2)+'\n');
  const iconset=path.join(desktop,'assets','Pankeki-user-20261025.iconset');
  const ico=path.join(build,'Pankeki.ico');
  fs.writeFileSync(ico,buildIco(['icon_16x16.png','icon_32x32.png','icon_32x32@2x.png','icon_128x128.png','icon_256x256.png'].map(name=>path.join(iconset,name))));
  const embedIcon=canEmbedIcon();
  const electronVersion=require(path.join(desktop,'node_modules/electron/package.json')).version;
  const {packager}=await import('@electron/packager');
  const apps=await packager({dir:stage,out:build,name:'Pankeki',executableName:'Pankeki',appVersion:pkg.version,buildVersion:pkg.version,
    platform:'win32',arch:ARCH,electronVersion,...(process.env.PANKEKI_ELECTRON_ZIP_DIR?{electronZipDir:process.env.PANKEKI_ELECTRON_ZIP_DIR}:{}),
    ...(embedIcon?{icon:ico}:{}),asar:true,prune:false,overwrite:false,extraResource:[runtimeFile],
    win32metadata:{CompanyName:'Pankeki',FileDescription:'Pankeki',ProductName:'Pankeki',InternalName:'Pankeki',OriginalFilename:'Pankeki.exe'}});
  const appDir=apps[0];
  const exe=path.join(appDir,'Pankeki.exe');
  if(!fs.existsSync(exe))throw Error('package-incomplete: Pankeki.exe missing');
  const readme=[`Pankeki ${pkg.version} Windows ${ARCH} desktop build`,'',
    'This folder is the desktop client only. It needs a Pankeki project folder prepared with',
    '  powershell -ExecutionPolicy Bypass -File scripts\\setup-windows.ps1 [-Generation] [-Models]',
    'which creates .venv-windows, vendor\\ComfyUI and runtime\\windows. On first start the app asks for that',
    'folder (or set PANKEKI_PROJECT_ROOT).','',
    'Chat uses the external Codex CLI (ChatGPT sign-in) or Claude Code CLI (claude.ai sign-in); no models,',
    'Python runtimes or CLIs are bundled.','',
    `Code signing: none (SmartScreen will show an "unknown publisher" warning).`,
    `Icon embedded in Pankeki.exe: ${embedIcon?'yes':'no (built without rcedit/wine)'}.`,''].join('\r\n');
  fs.writeFileSync(path.join(appDir,'README.txt'),readme);
  const zip=path.join(build,`Pankeki-${pkg.version}-win32-${ARCH}.zip`);let zipError=null;
  try{zipFolder(appDir,zip);}catch(error){zipError=String(error.stderr||error.message).slice(0,1000);}
  const asar=path.join(appDir,'resources','app.asar');
  const manifest={builtAt:new Date().toISOString(),target:'windows',arch:ARCH,hostPlatform:process.platform,crossBuilt:process.platform!=='win32',
    appDir,exe:{path:exe,size:fs.statSync(exe).size,sha256:sha(exe)},zip:fs.existsSync(zip)?{path:zip,size:fs.statSync(zip).size,sha256:sha(zip)}:null,zipError,
    appAsar:{path:asar,sha256:sha(asar)},iconEmbedded:embedIcon,signing:'none',freeze,versions:{electron:electronVersion,app:pkg.version},
    externalRuntimeRequired:true,modelsCopied:0,venvCopied:false,testedOnWindows:false,
    files:Object.fromEntries(files.map(file=>[file,sha(sourceFor(file))]))};
  fs.writeFileSync(path.join(releaseDir,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({appDir,exe:manifest.exe,zip:manifest.zip,zipError,iconEmbedded:embedIcon,crossBuilt:manifest.crossBuilt},null,2));
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={buildIco};

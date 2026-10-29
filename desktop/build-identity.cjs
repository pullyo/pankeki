'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const identifier=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value)?value:null;
const compare=(a,b)=>!a||!b?'unknown':a===b?'match':'mismatch';
function bundleContentId(directory){
  try{
    if(!['main.cjs','preload.cjs','shell.html'].every(name=>fs.statSync(path.join(directory,name)).isFile()))return null;
    const files=fs.readdirSync(directory).filter(name=>name.endsWith('.cjs')||name==='shell.html').sort();
    // The source checkout loads profiles.js directly; the standalone package
    // copies those exact bytes as profiles.cjs. Frame both under that logical name.
    const shared=path.join(directory,'../web/src/profiles.js');
    if(!files.includes('profiles.cjs')&&fs.existsSync(shared))files.push('profiles.cjs');
    files.sort();
    const digest=crypto.createHash('sha256');
    for(const name of files){
      const file=name==='profiles.cjs'&&!fs.existsSync(path.join(directory,name))?shared:path.join(directory,name),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())return null;
      const data=fs.readFileSync(file),length=Buffer.alloc(8);length.writeBigUInt64BE(BigInt(data.length));
      digest.update(name+'\0','utf8');digest.update(length);digest.update(data);
    }
    return digest.digest('hex');
  }catch{return null;}
}
async function readBuildStatus(options={}){
  const {bundleDirectory=__dirname,fetchHealth}=options;
  let build={};
  try{const health=await fetchHealth();if(health?.build?.schema===1)build=health.build;}catch{}
  const source_id=identifier(build.source_id),html_source_id=identifier(build.html_source_id),html_sha256=identifier(build.html_sha256),desktop_source_id=identifier(build.desktop_source_id),process_source_id=identifier(build.process_source_id);
  const electron_bundle_id=Object.hasOwn(options,'electronBundleId')?identifier(options.electronBundleId):bundleContentId(bundleDirectory);
  return {schema:1,source_id,html_source_id,html_sha256,desktop_source_id,electron_bundle_id,process_source_id,
    status:compare(source_id,html_source_id),bundle_status:compare(desktop_source_id,electron_bundle_id),process_status:compare(source_id,process_source_id)};
}
function createBuildStatusReader(options={}){
  const captured=Object.hasOwn(options,'electronBundleId')?identifier(options.electronBundleId):bundleContentId(options.bundleDirectory||__dirname);
  return ()=>readBuildStatus({...options,electronBundleId:captured});
}
module.exports={bundleContentId,readBuildStatus,createBuildStatusReader};

'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const MAX_BYTES=128*1024*1024;
function fail(code){throw Object.assign(new Error(code),{code});}
function sameFile(a,b){return ['dev','ino','size','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]);}
function createVideoScenePicker({projectRoot,chooseFile}){
  const root=fs.realpathSync(projectRoot),grantDir=path.join(root,'runtime/video/scene-grants');let picking=false;
  return async function pickVideoScene(){
    if(picking)fail('busy');picking=true;
    let handle,temp;
    try{
      const picked=await chooseFile();
      if(picked?.canceled||!picked?.filePaths?.length)return null;
      if(picked.filePaths.length!==1)fail('invalid-video-scene');
      const selected=picked.filePaths[0];
      if(typeof selected!=='string'||!path.isAbsolute(selected)||path.extname(selected).toLowerCase()!=='.blend')fail('invalid-video-scene');
      const linkStat=await fs.promises.lstat(selected,{bigint:true});
      if(linkStat.isSymbolicLink()||!linkStat.isFile())fail('invalid-video-scene');
      const scene=await fs.promises.realpath(selected);
      handle=await fs.promises.open(selected,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
      const before=await handle.stat({bigint:true});
      if(!before.isFile()||before.size<=0n||before.size>BigInt(MAX_BYTES)||!sameFile(linkStat,before))fail('invalid-video-scene');
      const digest=crypto.createHash('sha256'),buffer=Buffer.alloc(1024*1024);let position=0;
      for(;;){const {bytesRead}=await handle.read(buffer,0,buffer.length,position);if(!bytesRead)break;position+=bytesRead;if(position>MAX_BYTES)fail('invalid-video-scene');digest.update(buffer.subarray(0,bytesRead));}
      const after=await handle.stat({bigint:true}),current=await fs.promises.lstat(selected,{bigint:true});
      if(!sameFile(before,after)||!sameFile(before,current)||current.isSymbolicLink()||BigInt(position)!==before.size||await fs.promises.realpath(selected)!==scene)fail('invalid-video-scene');
      await handle.close();handle=null;
      const scene_id=crypto.randomUUID(),name=path.basename(scene).replace(/[\x00-\x1f\x7f]/g,'').slice(0,255);
      const grant={version:1,scene_path:scene,name,size:position,mtime_ns:before.mtimeNs.toString(),sha256:digest.digest('hex'),created_at:new Date().toISOString()};
      await fs.promises.mkdir(grantDir,{recursive:true,mode:0o700});
      if(await fs.promises.realpath(grantDir)!==grantDir||!(await fs.promises.lstat(grantDir)).isDirectory())fail('invalid-video-scene');
      temp=path.join(grantDir,'.'+scene_id+'.tmp');
      await fs.promises.writeFile(temp,JSON.stringify(grant)+'\n',{flag:'wx',mode:0o600});
      await fs.promises.rename(temp,path.join(grantDir,scene_id+'.json'));temp=null;
      return {scene_id,name};
    }catch(error){if(error.code==='busy'||error.code==='invalid-video-scene')throw error;fail('scene-selection-failed');}
    finally{if(handle)await handle.close().catch(()=>{});if(temp)await fs.promises.unlink(temp).catch(()=>{});picking=false;}
  };
}
module.exports={createVideoScenePicker};

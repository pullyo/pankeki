'use strict';
const fs=require('node:fs');const path=require('node:path');const {randomUUID,createHash}=require('node:crypto');
const ID=/^[A-Za-z0-9_-]{1,80}$/;
const SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
function pngData(value,decode,isMask) {
  if(typeof value!=='string'||value.length>28*1024*1024||!/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(value))throw Error('png-format');
  const encoded=value.slice(22);const bytes=Buffer.from(encoded,'base64');
  if(bytes.toString('base64')!==encoded||bytes.length>20*1024*1024||bytes.length<45||!bytes.subarray(0,8).equals(SIGNATURE)||bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(8)!==13)throw Error('png-format');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(!width||!height||width>4096||height>4096||width*height>16777216)throw Error('png-limit');
  let alpha=[4,6].includes(bytes[25]);
  for(let at=8;at+12<=bytes.length;){const size=bytes.readUInt32BE(at);if(size>bytes.length-at-12)throw Error('png-format');
    if(bytes.toString('ascii',at+4,at+8)==='tRNS')alpha=true;at+=size+12;}
  if(isMask&&!alpha)throw Error('mask-alpha');
  const actual=decode(bytes);
  if(!actual||actual.width!==width||actual.height!==height)throw Error('png-decode');
  return {bytes,width,height,digest:createHash('sha256').update(bytes).digest('hex')};
}
function createEditContextStore({dataDir,decode}) {
  if(!path.isAbsolute(dataDir)||typeof decode!=='function')throw Error('invalid-config');
  fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
  const inputs=path.join(dataDir,'inputs');fs.mkdirSync(inputs,{recursive:true,mode:0o700});
  const entries=new Map(),latest=new Map(),snapshots=new Map(),bindings=new Map();let closed=false;
  async function prepare({projectId,sourceRevision,sourceDataUrl,maskDataUrl}) {
    if(closed||!ID.test(projectId||'')||!ID.test(sourceRevision||''))throw Error('invalid-context');
    const source=pngData(sourceDataUrl,decode,false),mask=maskDataUrl===undefined?null:pngData(maskDataUrl,decode,true);
    if(mask&&(source.width!==mask.width||source.height!==mask.height))throw Error('mask-size');
    const key=projectId+':'+sourceRevision,digest=source.digest+':'+(mask?.digest||'');
    if(snapshots.has(key)&&snapshots.get(key)!==digest)throw Error('snapshot-reused');
    snapshots.set(key,digest);
    const projectDir=path.join(inputs,projectId);fs.mkdirSync(projectDir,{recursive:true,mode:0o700});
    const result={projectId,sourceRevision};
    for(const [name,image] of [['sourceId',source],['maskId',mask]])if(image){
      const id=randomUUID(),filename=path.join(projectDir,id+'.png');fs.writeFileSync(filename,image.bytes,{flag:'wx',mode:0o600});
      entries.set(id,{projectId,sourceRevision,filename});result[name]=id;
    }
    latest.set(projectId,sourceRevision);return result;
  }
  function resolveInput({projectId,sourceRevision,id}) {
    const entry=entries.get(id);
    if(closed||!entry||entry.projectId!==projectId||entry.sourceRevision!==sourceRevision||latest.get(projectId)!==sourceRevision)throw Error('stale-context');
    const real=fs.realpathSync(entry.filename),parent=fs.realpathSync(path.join(inputs,projectId));
    if(path.dirname(real)!==parent)throw Error('stale-context');return real;
  }
  function resolve(projectId,context) {
    resolveInput({projectId,sourceRevision:context.sourceRevision,id:context.sourceId});
    if(context.maskId)resolveInput({projectId,sourceRevision:context.sourceRevision,id:context.maskId});
    return {sourceId:context.sourceId,...(context.maskId?{maskId:context.maskId}:{}),sourceRevision:context.sourceRevision};
  }
  function bindRequest({requestId,projectId,context}) {
    if(!context)return undefined;
    if(!ID.test(requestId||'')||!ID.test(projectId||'')||!ID.test(context.sourceRevision||''))throw Error('invalid-context');
    if(!context.sourceId)return {sourceRevision:context.sourceRevision};
    resolve(projectId,context);
    const contextId=randomUUID();bindings.set(contextId,{requestId,projectId,...context});
    return {contextId,sourceRevision:context.sourceRevision};
  }
  function resolveEditContext({requestId,projectId,contextId,sourceRevision}) {
    const binding=bindings.get(contextId);
    if(!binding||binding.requestId!==requestId||binding.projectId!==projectId||binding.sourceRevision!==sourceRevision)throw Error('stale-context');
    const sourcePath=resolveInput({projectId,sourceRevision,id:binding.sourceId});
    const maskPath=binding.maskId?resolveInput({projectId,sourceRevision,id:binding.maskId}):undefined;
    return {sourcePath,maskPath};
  }
  async function close(){
    closed=true;
    for(const entry of entries.values()){try{fs.unlinkSync(entry.filename);}catch{}}
    entries.clear();latest.clear();snapshots.clear();bindings.clear();
  }
  return {prepare,resolve,resolveInput,bindRequest,resolveEditContext,close};
}
module.exports={createEditContextStore};

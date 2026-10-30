(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(root);
  else root.PankekiCubismPackage=factory(root);
})(typeof globalThis==='object'?globalThis:this,function(root){
  'use strict';
  const MiB=1024*1024;
  const LIMITS=Object.freeze({files:256,totalBytes:256*MiB,fileBytes:64*MiB,jsonBytes:8*MiB,textures:32,decodedBytes:256*MiB,textureSide:8192,jsonDepth:24});
  function fail(code,message,details={}){const error=new Error(message);error.code=code;Object.assign(error,details);throw error;}
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  function abort(signal){if(signal?.aborted)fail('ABORTED','Package reading was cancelled');}
  function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

  // No URI decoding is used for lookup. Reject encoded separators, including
  // nested encodings, so a later consumer cannot reinterpret a local filename.
  function pathName(value,base=''){
    if(typeof value!=='string'||!value||/[:\\\u0000-\u001f\u007f]/u.test(value)||value.startsWith('/'))fail('INVALID_PATH','Expected a relative package path',{path:value});
    let encoded=value;
    for(let i=0;i<=value.length;i++){
      if(/%(?:2f|5c|00|2e)/i.test(encoded))fail('INVALID_PATH','Encoded path separators or traversal are not allowed',{path:value});
      const next=encoded.replace(/%25/ig,'%');if(next===encoded)break;encoded=next;
    }
    const parts=base?base.split('/'):[];
    for(const part of value.normalize('NFC').split('/')){
      if(part==='.'||part==='')continue;
      if(part==='..'){if(!parts.length)fail('INVALID_PATH','Path escapes the selected package',{path:value});parts.pop();}
      else parts.push(part);
    }
    if(!parts.length||value.endsWith('/'))fail('INVALID_PATH','Expected a file path',{path:value});
    return parts.join('/');
  }
  // Conservative Unicode caseless key: expansion handles e.g. sharp-s; NFC
  // before and after also catches composed/decomposed spelling collisions.
  const collisionKey=path=>path.normalize('NFC').toLowerCase().toUpperCase().toLowerCase().normalize('NFC');
  function jsonData(value,depth=0){
    if(depth>LIMITS.jsonDepth)fail('JSON_DEPTH_LIMIT','JSON nesting exceeds product limit 24');
    if(value===null||typeof value==='string'||typeof value==='boolean')return;
    if(typeof value==='number'){if(!Number.isFinite(value))fail('INVALID_JSON','JSON numbers must be finite');return;}
    if(!object(value)&&!Array.isArray(value))fail('INVALID_JSON','Expected plain JSON data');
    for(const key of Object.keys(value)){
      if(['__proto__','constructor','prototype'].includes(key))fail('INVALID_JSON','Unsafe JSON key');
      jsonData(value[key],depth+1);
    }
  }
  function parseJSON(bytes,path){
    if(bytes.byteLength>LIMITS.jsonBytes)fail('JSON_SIZE_LIMIT','JSON exceeds product limit 8 MiB',{path});
    let value;
    try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
    catch(error){fail('INVALID_JSON','Invalid UTF-8 JSON',{path});}
    jsonData(value);
    if(!object(value))fail('INVALID_JSON','JSON resource must have an object root',{path});
    return freeze(value);
  }
  function valid(condition,label){if(!condition)fail('INVALID_MANIFEST','Invalid manifest '+label);}
  function text(value,label){valid(typeof value==='string'&&value.length>0,label);}
  function number(value,label){valid(typeof value==='number'&&Number.isFinite(value),label);}
  function schema(m){
    valid(m.Version===3,'Version (only 3 is supported)');valid(object(m.FileReferences),'FileReferences');
    const refs=m.FileReferences;text(refs.Moc,'Moc');
    valid(Array.isArray(refs.Textures)&&refs.Textures.length>0,'Textures');
    if(refs.Textures.length>LIMITS.textures)fail('TEXTURE_COUNT_LIMIT','Texture slots exceed product limit 32');
    refs.Textures.forEach(p=>text(p,'texture path'));
    for(const key of ['Physics','Pose','DisplayInfo','UserData'])if(own(refs,key))text(refs[key],key);
    if(own(refs,'Expressions')){
      valid(Array.isArray(refs.Expressions),'Expressions');
      refs.Expressions.forEach(e=>{valid(object(e),'expression');text(e.Name,'expression Name');text(e.File,'expression File');});
    }
    if(own(refs,'Motions')){
      valid(object(refs.Motions),'Motions');
      for(const [group,list] of Object.entries(refs.Motions)){
        text(group,'motion group');valid(Array.isArray(list),'motion group entries');
        list.forEach(motion=>{
          valid(object(motion),'motion');text(motion.File,'motion File');
          if(own(motion,'Sound'))text(motion.Sound,'motion Sound');
          for(const key of ['FadeInTime','FadeOutTime'])if(own(motion,key))number(motion[key],key);
          if(own(motion,'Loop'))valid(typeof motion.Loop==='boolean','motion Loop');
        });
      }
    }
    if(own(m,'Layout')){valid(object(m.Layout),'Layout');Object.values(m.Layout).forEach(v=>number(v,'Layout value'));}
    if(own(m,'Groups')){
      valid(Array.isArray(m.Groups),'Groups');
      m.Groups.forEach(g=>{valid(object(g),'Group');text(g.Target,'Group Target');text(g.Name,'Group Name');valid(Array.isArray(g.Ids),'Group Ids');g.Ids.forEach(id=>text(id,'Group Id'));});
    }
    if(own(m,'HitAreas')){
      valid(Array.isArray(m.HitAreas),'HitAreas');
      m.HitAreas.forEach(area=>{valid(object(area),'HitArea');text(area.Id,'HitArea Id');text(area.Name,'HitArea Name');});
    }
  }
  function pngHeader(bytes,path){
    const signature=[137,80,78,71,13,10,26,10];
    if(!/\.png$/i.test(path)||bytes.length<33||signature.some((v,i)=>v!==bytes[i])||String.fromCharCode(...bytes.subarray(12,16))!=='IHDR')fail('INVALID_PNG','Texture must contain a PNG signature and IHDR',{path});
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),width=view.getUint32(16),height=view.getUint32(20);
    if(view.getUint32(8)!==13||!width||!height)fail('INVALID_PNG','Invalid PNG IHDR dimensions',{path});
    if(width>LIMITS.textureSide||height>LIMITS.textureSide)fail('TEXTURE_DIMENSION_LIMIT','Texture side exceeds product limit 8192',{path});
    return {width,height};
  }
  async function digest(bytes){
    let crypto=root.crypto;
    if(!crypto?.subtle&&typeof require==='function')crypto=require('node:crypto').webcrypto;
    if(!crypto?.subtle)fail('HASH_UNAVAILABLE','SHA-256 requires Web Crypto');
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  }
  async function readPackage(files,{entryPath,signal}={}){
    abort(signal);
    if(!Array.isArray(files))fail('INVALID_INPUT','Expected an array of local files');
    if(files.length>LIMITS.files)fail('FILE_COUNT_LIMIT','Package exceeds product limit 256 files');
    // Validate all budgets first; do not allocate a second oversized package.
    let total=0;const paths=[],collisions=new Set();
    for(const file of files){
      if(!object(file)||!(file.bytes instanceof Uint8Array))fail('INVALID_INPUT','Each file needs path and Uint8Array bytes');
      const path=pathName(file.path),key=collisionKey(path);
      if(collisions.has(key))fail('PATH_COLLISION','Package paths collide after Unicode/case normalization',{path});
      collisions.add(key);paths.push(path);
      if(file.bytes.byteLength>LIMITS.fileBytes)fail('FILE_SIZE_LIMIT','File exceeds product limit 64 MiB',{path});
      total+=file.bytes.byteLength;if(total>LIMITS.totalBytes)fail('TOTAL_SIZE_LIMIT','Package exceeds product limit 256 MiB');
      if(/\.json$/i.test(path)&&file.bytes.byteLength>LIMITS.jsonBytes)fail('JSON_SIZE_LIMIT','JSON exceeds product limit 8 MiB',{path});
    }
    // This complete private snapshot happens before the first await. The caller
    // retains ownership of its buffers, including Buffer views and subarrays.
    const snapshot=new Map(files.map((file,i)=>[paths[i],new Uint8Array(file.bytes)]));
    const entries=paths.filter(p=>/\.model3\.json$/i.test(p)).sort();
    if(!entries.length)fail('MANIFEST_REQUIRED','Select a package containing .model3.json');
    if(entryPath===undefined&&entries.length>1)fail('ENTRY_REQUIRED','Select a model manifest',{entries});
    const entry=entryPath===undefined?entries[0]:pathName(entryPath);
    if(!entries.includes(entry))fail('ENTRY_NOT_FOUND','Selected manifest is not in the package',{path:entry});
    const json=new Map();for(const [path,bytes] of snapshot)if(/\.json$/i.test(path))json.set(path,parseJSON(bytes,path));
    const manifest=json.get(entry);schema(manifest);
    const base=entry.includes('/')?entry.slice(0,entry.lastIndexOf('/')):'';
    function resource(reference,metadata={},jsonRequired=false){
      const path=pathName(reference,base);
      if(!snapshot.has(path))fail('MISSING_RESOURCE','Declared resource is missing',{path});
      if(jsonRequired&&!json.has(path))json.set(path,parseJSON(snapshot.get(path),path));
      const result={path,...metadata};
      // Returned bytes are always detached copies. Freezing a typed array does
      // not make its backing buffer immutable, so never expose that buffer.
      Object.defineProperty(result,'bytes',{enumerable:true,get:()=>new Uint8Array(snapshot.get(path))});
      return Object.freeze(result);
    }
    const refs=manifest.FileReferences;
    const mocPath=pathName(refs.Moc,base);valid(/\.moc3$/i.test(mocPath),'Moc extension');
    let decoded=0;
    const textures=refs.Textures.map((reference,slot)=>{
      const path=pathName(reference,base);
      if(!snapshot.has(path))fail('MISSING_RESOURCE','Declared texture is missing',{path});
      const size=pngHeader(snapshot.get(path),path);decoded+=size.width*size.height*4;
      if(decoded>LIMITS.decodedBytes)fail('DECODED_SIZE_LIMIT','RGBA texture estimate exceeds product limit 256 MiB');
      return resource(reference,{slot,...size});
    });
    const motions=[];
    for(const [group,list] of Object.entries(refs.Motions||{}))list.forEach((definition,index)=>motions.push(resource(definition.File,{group,index,definition,sound:own(definition,'Sound')?resource(definition.Sound):null},true)));
    const expressions=(refs.Expressions||[]).map((definition,index)=>resource(definition.File,{name:definition.Name,index,definition},true));
    const resources={moc:resource(refs.Moc),textures:Object.freeze(textures),motions:Object.freeze(motions),expressions:Object.freeze(expressions)};
    for(const [key,field] of [['physics','Physics'],['pose','Pose'],['displayInfo','DisplayInfo'],['userData','UserData']])resources[key]=own(refs,field)?resource(refs[field],{},true):null;
    Object.freeze(resources);
    const warnings=[];
    for(const key of Object.keys(manifest))if(!['Version','FileReferences','Groups','Layout','HitAreas'].includes(key))warnings.push({code:'UNKNOWN_FEATURE',field:key});
    for(const key of Object.keys(refs))if(!['Moc','Textures','Motions','Expressions','Physics','Pose','DisplayInfo','UserData'].includes(key))warnings.push({code:'UNKNOWN_FEATURE',field:'FileReferences.'+key});
    if(motions.some(m=>m.sound))warnings.push({code:'SOUND_NOT_SUPPORTED',message:'Sound is preserved; audio playback and real-time lipsync are unsupported.'});
    const hashes=Object.create(null);
    for(const [path,bytes] of snapshot){abort(signal);hashes[path]=await digest(bytes);abort(signal);}
    Object.freeze(hashes);
    const capabilities=freeze({packageRead:'verified',actualPlayback:'not-run',sdkValidation:'not-run',pngDecode:'not-run',mocValidation:'not-run',audioPlayback:'unsupported',unknownFeatures:warnings.some(w=>w.code==='UNKNOWN_FEATURE')?'unsupported':'none',motions:motions.length?'provided':'not-provided',expressions:expressions.length?'provided':'not-provided',physics:resources.physics?'provided':'not-provided',pose:resources.pose?'provided':'not-provided'});
    const pkg={entryPath:entry,manifest,hashes,resources,capabilities,warnings:freeze(warnings)};
    Object.defineProperty(pkg,'files',{enumerable:true,get:()=>new Map(Array.from(snapshot,([path,bytes])=>[path,new Uint8Array(bytes)]))});
    return Object.freeze(pkg);
  }
  return Object.freeze({readPackage,LIMITS});
});

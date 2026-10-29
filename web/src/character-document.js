(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports) module.exports=factory(require('./profiles.js'),globalThis);
  else root.PankekiDocument=factory(root.CharacterDesign,root);
})(typeof globalThis==='object'?globalThis:this,function(Design,root){
  'use strict';
  const MAX_JSON=64*1024*1024, MAX_ASSET=16*1024*1024, MAX_RGBA=128*1024*1024;
  const PARAMS={eyeOpen:1,mouthOpen:0,breath:0}, metadata=new Map(), validated=new WeakSet();
  const fail=message=>{throw Error(message);};
  const copy=value=>Array.isArray(value)?value.map(copy):plain(value)?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,copy(item)])):value;
  const bytes=text=>new TextEncoder().encode(text);
  function budget(text){if(text.length>MAX_JSON||bytes(text).length>MAX_JSON)fail('Project exceeds 64 MiB');}
  function plain(value){return value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));}
  function safeData(value,depth=0){
    if(depth>24)fail('Document nesting is too deep');
    if(value===null||typeof value==='string'||typeof value==='boolean')return;
    if(typeof value==='number'){if(!Number.isFinite(value))fail('Non-finite document value');return;}
    if(!plain(value)&&!Array.isArray(value))fail('Document must contain plain JSON data');
    if(Array.isArray(value)&&value.length>100000)fail('Array is too large');
    if(Object.getOwnPropertySymbols(value).length)fail('Unsupported symbol field');
    for(const key of Object.getOwnPropertyNames(value)){
      if(['__proto__','prototype','constructor'].includes(key))fail('Unsafe document key');
      const field=Object.getOwnPropertyDescriptor(value,key);if(!Object.hasOwn(field,'value'))fail('Accessor fields are not allowed');
      if(Array.isArray(value)&&key==='length')continue;
      if(Array.isArray(value)&&(!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=value.length))fail('Unsupported array field');
      safeData(field.value,depth+1);
    }
    if(Array.isArray(value)){if(value.length>100000)fail('Array is too large');for(let i=0;i<value.length;i++)if(!Object.hasOwn(value,i))fail('Sparse arrays are not allowed');}
  }
  function input(raw){if(typeof raw==='string'){budget(raw);raw=JSON.parse(raw);}safeData(raw);budget(JSON.stringify(raw));return copy(raw);}
  function keys(value,allowed,required=allowed){
    if(!plain(value))fail('Expected a plain object');
    for(const key of Object.keys(value))if(!allowed.includes(key))fail('Unsupported field: '+key);
    for(const key of required)if(!Object.hasOwn(value,key))fail('Missing field: '+key);
  }
  function list(value,max,label){if(!Array.isArray(value)||value.length>max)fail(label+' exceeds limit '+max);return value;}
  function number(value,min,max,label){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail('Invalid '+label);return value;}
  function integer(value,min,max,label){number(value,min,max,label);if(!Number.isSafeInteger(value))fail('Invalid integer '+label);return value;}
  function text(value,max,label){if(typeof value!=='string'||value.length>max)fail('Invalid '+label);return value;}
  function id(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(value))fail('Invalid identifier');return value;}
  function bool(value){if(typeof value!=='boolean')fail('Expected boolean');}
  function hash(value){if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))fail('Invalid hash');return value;}
  function mapUnique(items,label){const map=new Map();for(const item of items){if(map.has(item.id))fail('Duplicate '+label+' id');map.set(item.id,item);}return map;}
  function ref(map,value,label,nullable=false){if(nullable&&value===null)return;if(!map.has(value))fail('Missing '+label+' reference');}
  function floats(values,max,label){list(values,max,label);for(const v of values)number(v,-1e7,1e7,label);}
  async function digest(data){let crypto=root.crypto;if(!crypto?.subtle&&typeof require==='function')crypto=require('node:crypto').webcrypto;return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),n=>n.toString(16).padStart(2,'0')).join('');}
  function binary(data,mime){
    const prefix='data:'+mime+';base64,';if(typeof data!=='string'||data.length>MAX_ASSET||!data.startsWith(prefix))fail('Invalid asset data or 16 MiB limit');
    const encoded=data.slice(prefix.length);if(!encoded.length||encoded.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))fail('Invalid asset base64');
    const raw=typeof Buffer==='function'?new Uint8Array(Buffer.from(encoded,'base64')):Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
    const signatures={'image/png':[137,80,78,71,13,10,26,10],'image/jpeg':[255,216,255],'image/webp':[82,73,70,70]};
    if(!signatures[mime]||signatures[mime].some((v,i)=>raw[i]!==v))fail('Asset signature mismatch');
    if(mime==='image/webp'&&[87,69,66,80].some((v,i)=>raw[i+8]!==v))fail('Asset WEBP signature mismatch');
    if(mime==='image/png'){
      if(raw.length<33)fail('Truncated PNG');const view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
      if(view.getUint32(16)*view.getUint32(20)>16777216)fail('Asset exceeds 16MP');
    }
    return raw;
  }
  async function browserDecode(asset){
    if(typeof root.Image!=='function')fail('An asset decoder is required outside the browser');
    const image=new root.Image();image.src=asset.data;
    if(image.decode)await image.decode();else await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('Image decode failed'));});
    return image;
  }
  async function validateAssets(assets,options){
    list(assets,64,'Assets');let rgba=0;const map=mapUnique(assets,'asset');
    for(const asset of assets){
      keys(asset,['id','mime','width','height','data']);if(!/^sha256:[a-f0-9]{64}$/.test(asset.id))fail('Invalid asset hash');
      integer(asset.width,1,16777216,'asset width');integer(asset.height,1,16777216,'asset height');
      if(asset.width*asset.height>16777216)fail('Asset exceeds 16MP');rgba+=asset.width*asset.height*4;if(rgba>MAX_RGBA)fail('Decoded assets exceed 128 MiB');
      const raw=binary(asset.data,asset.mime);if(await digest(raw)!==asset.id.slice(7))fail('Asset hash mismatch');
      if(asset.mime==='image/png'){const header=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);if(header.getUint32(16)!==asset.width||header.getUint32(20)!==asset.height)fail('PNG header dimensions mismatch');}
      let decoded;
      if(options.decodeAsset)decoded=await options.decodeAsset(Object.freeze({...asset}));
      else decoded=metadata.get(asset.id)||await browserDecode(asset);
      const width=decoded?.naturalWidth||decoded?.width,height=decoded?.naturalHeight||decoded?.height;
      if(width!==asset.width||height!==asset.height)fail('Asset decoded dimensions mismatch');
      metadata.set(asset.id,{width,height});if(metadata.size>256)metadata.delete(metadata.keys().next().value);
    }
    return map;
  }
  function validateValues(values,complete=false){keys(values,Object.keys(PARAMS),complete?Object.keys(PARAMS):[]);for(const [name,value]of Object.entries(values))number(value,0,1,name);}
  function validateMotion(motion){
    keys(motion,['id','duration','fps','curves','rigHashes','label'],['id','duration','fps','curves','rigHashes']);id(motion.id);if(motion.label!==undefined)text(motion.label,80,'motion label');if(motion.duration!==2||motion.fps!==24)fail('Motion must be 2 seconds at 24fps');
    list(motion.curves,3,'Curves');const names=new Set();
    for(const curve of motion.curves){keys(curve,['parameterId','keys']);if(!Object.hasOwn(PARAMS,curve.parameterId)||names.has(curve.parameterId))fail('Invalid curve parameter');names.add(curve.parameterId);
      list(curve.keys,32,'Curve keys');if(curve.keys.length<2||curve.keys[0].t!==0||curve.keys.at(-1).t!==2)fail('Curve must cover 0..2');
      let previous=-1;for(const key of curve.keys){keys(key,['t','value']);number(key.t,0,2,'curve time');number(key.value,0,1,'curve value');if(key.t<=previous)fail('Curve keys must increase');previous=key.t;}
      if(curve.keys[0].value!==curve.keys.at(-1).value)fail('Loop endpoints must match');
    }
    list(motion.rigHashes,16,'Rig hashes').forEach(hash);
  }
  function area(vertices,a,b,c){return ((vertices[2*b]-vertices[2*a])*(vertices[2*c+1]-vertices[2*a+1])-(vertices[2*b+1]-vertices[2*a+1])*(vertices[2*c]-vertices[2*a]))/2;}
  function validateRig(rig,part){
    keys(rig,['id','partId','materialAssetId','rigHash','status','vertices','uv','triangles','bindings']);id(rig.id);hash(rig.rigHash);
    if(!['ready','stale','draft'].includes(rig.status))fail('Invalid rig status');
    floats(rig.vertices,512,'Vertices');floats(rig.uv,512,'UV');list(rig.triangles,1536,'Triangles');list(rig.bindings,3,'Bindings');
    if(!rig.vertices.length&&rig.status==='draft'&&!rig.uv.length&&!rig.triangles.length&&!rig.bindings.length)return;
    if(rig.vertices.length<6||rig.vertices.length%2||rig.uv.length!==rig.vertices.length||!rig.triangles.length||rig.triangles.length%3)fail('Invalid mesh dimensions');
    rig.uv.forEach(v=>number(v,0,1,'UV'));rig.triangles.forEach(v=>integer(v,0,rig.vertices.length/2-1,'triangle index'));
    const validatePose=vertices=>{for(let i=0;i<rig.triangles.length;i+=3){const [a,b,c]=rig.triangles.slice(i,i+3),base=area(rig.vertices,a,b,c),posed=area(vertices,a,b,c);if(Math.abs(base)<.0001||Math.abs(posed)<.0001||base*posed<=0)fail('Invalid triangle area or orientation');}};
    validatePose(rig.vertices);const names=new Set();
    for(const binding of rig.bindings){keys(binding,['parameterId','keys']);const name=binding.parameterId;if(!Object.hasOwn(PARAMS,name)||names.has(name))fail('Invalid binding');names.add(name);
      list(binding.keys,32,'Keyforms');if(binding.keys.length<2||binding.keys[0].at!==0||binding.keys.at(-1).at!==1)fail('Keyforms must cover 0..1');
      let previous=-1,neutral=false;for(const key of binding.keys){keys(key,['at','deltas']);number(key.at,0,1,'key value');if(key.at<=previous)fail('Keyforms must increase');previous=key.at;
        floats(key.deltas,512,'Deltas');if(key.deltas.length!==rig.vertices.length)fail('Keyform vertex count mismatch');
        if(key.at===PARAMS[name]){neutral=true;if(key.deltas.some(v=>v!==0))fail('Default key displacement must be zero');}
        validatePose(rig.vertices.map((v,i)=>v+key.deltas[i]));
      }if(!neutral)fail('Default key is missing');
    }
    if(rig.status==='ready'&&!part.materialAssetId)rig.status='draft';
  }
  async function computeRigHash(part,rig,assets){
    const map=assets instanceof Map?assets:new Map(assets.map(a=>[a.id,a])), material=map.get(part.materialAssetId);if(!material)fail('Missing rig material');
    const bindings=rig.bindings.slice().sort((a,b)=>a.parameterId<b.parameterId?-1:a.parameterId>b.parameterId?1:0).map(b=>[b.parameterId,b.keys.map(k=>[k.at,k.deltas])]);
    return digest(bytes(JSON.stringify([part.id,part.parentId,part.sourceAssetId,part.maskAssetId,part.materialAssetId,part.sourceRect,[material.width,material.height],rig.vertices,rig.uv,rig.triangles,bindings])));
  }
  async function parseDocument(raw,options={}){
    const d=input(raw);if(d.version===1)return fromV1(d,options);
    keys(d,['version','id','canvas','brief','assets','candidates','selectionHistory','sourceCandidateId','backgroundAssetId','parts','rigs','parameters','presets','motions','selection']);
    if(d.version!==2)fail('Unsupported document version');id(d.id);keys(d.canvas,['width','height','colorSpace','alpha']);
    integer(d.canvas.width,1,16777216,'canvas width');integer(d.canvas.height,1,16777216,'canvas height');if(d.canvas.width*d.canvas.height>16777216||d.canvas.colorSpace!=='srgb'||d.canvas.alpha!=='straight')fail('Invalid canvas');
    d.brief=Design.parseProject({version:1,brief:d.brief,versions:[]}).brief;const assets=await validateAssets(d.assets,options);
    list(d.candidates,20,'Candidates');
    for(const c of d.candidates){
      keys(c,['id','createdAt','label','assetId','brief','request','parentId','metrics','kind','derivation','annotations','execution'],['id','createdAt','label','assetId','brief','request']);ref(assets,c.assetId,'candidate asset');if(c.parentId!=null)id(c.parentId);
    }
    // Derived candidates must be checked with their real parents, not isolated
    // with a temporary null parent. Reuse the image project's strict metadata contract.
    const candidateAssetIds=d.candidates.map(c=>c.assetId),legacyCandidates=d.candidates.map(({assetId,...c})=>({...c,image:assets.get(assetId).data}));
    const normalized=Design.parseProject({version:1,brief:d.brief,versions:legacyCandidates,selectionHistory:d.selectionHistory});
    d.candidates=normalized.versions.map(({image,...c},n)=>({...c,assetId:candidateAssetIds[n]}));
    const candidates=mapUnique(d.candidates,'candidate');
    for(const c of d.candidates){
      if(c.kind!=='derived')continue;
      const provenance=c.derivation,parent=candidates.get(c.parentId),source=assets.get(parent.assetId),output=assets.get(c.assetId);
      if(provenance.sourceSha256!==parent.assetId.slice(7)||provenance.inputWidth!==source.width||provenance.inputHeight!==source.height||provenance.outputWidth!==output.width||provenance.outputHeight!==output.height)fail('Derived source hash or dimensions mismatch');
    }
    for(const c of d.candidates){const seen=new Set();let next=c;while(next){if(seen.has(next.id))fail('Candidate parent cycle');seen.add(next.id);if(next.parentId!=null)ref(candidates,next.parentId,'candidate parent');next=next.parentId==null?null:candidates.get(next.parentId);}}
    list(d.selectionHistory,1000,'Selection history');for(const h of d.selectionHistory){keys(h,['candidateId','action','at']);ref(candidates,h.candidateId,'history candidate');if(!['view','edit','compare'].includes(h.action)||typeof h.at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(h.at)||!Number.isFinite(Date.parse(h.at))||new Date(h.at).toISOString().slice(0,19)!==h.at.slice(0,19))fail('Invalid selection history');}
    ref(candidates,d.sourceCandidateId,'source candidate',true);ref(assets,d.backgroundAssetId,'background',true);
    if(d.backgroundAssetId){const a=assets.get(d.backgroundAssetId);if(a.width!==d.canvas.width||a.height!==d.canvas.height)fail('Background dimensions mismatch');}
    list(d.parts,16,'Parts');const parts=mapUnique(d.parts,'part');
    for(const p of d.parts){keys(p,['id','name','parentId','order','sourceAssetId','maskAssetId','materialAssetId','sourceRect','transform','visible','opacity','lockMaterial','lockTransform','backgroundReady']);id(p.id);text(p.name,80,'part name');ref(parts,p.parentId,'part parent',true);
      integer(p.order,-10000,10000,'part order');ref(assets,p.sourceAssetId,'part source');ref(assets,p.maskAssetId,'part mask',true);ref(assets,p.materialAssetId,'part material',true);
      const source=assets.get(p.sourceAssetId);if(p.materialAssetId&&assets.get(p.materialAssetId).mime!=='image/png')fail('Part material must be PNG');
      if(p.maskAssetId){const a=assets.get(p.maskAssetId);if(a.mime!=='image/png'||a.width!==source.width||a.height!==source.height)fail('Mask dimensions mismatch');}
      floats(p.sourceRect,4,'sourceRect');if(p.sourceRect.length!==4)fail('Invalid sourceRect');const [x,y,w,h]=p.sourceRect;if(x<0||y<0||w<=0||h<=0||x+w>source.width||y+h>source.height)fail('sourceRect exceeds source');
      floats(p.transform,6,'transform');if(p.transform.length!==6||p.transform[0]*p.transform[3]-p.transform[1]*p.transform[2]<=0)fail('Invalid part transform');
      for(const b of ['visible','lockMaterial','lockTransform','backgroundReady'])bool(p[b]);number(p.opacity,0,1,'opacity');
      const seen=new Set();let parent=p;while(parent){if(seen.has(parent.id))fail('Part parent cycle');seen.add(parent.id);parent=parent.parentId===null?null:parts.get(parent.parentId);}
    }
    list(d.parameters,3,'Parameters');if(d.parameters.length!==3)fail('Expected three parameters');const parameters=mapUnique(d.parameters,'parameter');
    for(const [name,def]of Object.entries(PARAMS)){const p=parameters.get(name);keys(p,['id','min','max','default','value']);if(p.min!==0||p.max!==1||p.default!==def)fail('Invalid parameter definition');number(p.value,0,1,'parameter value');}
    list(d.rigs,16,'Rigs');mapUnique(d.rigs,'rig');const targeted=new Set(),sourceAssetId=d.sourceCandidateId?candidates.get(d.sourceCandidateId)?.assetId:null;
    for(const r of d.rigs){ref(parts,r.partId,'rig part');if(targeted.has(r.partId))fail('Duplicate part rig');targeted.add(r.partId);ref(assets,r.materialAssetId,'rig material',true);const p=parts.get(r.partId);validateRig(r,p);
      if(p.materialAssetId){if(r.materialAssetId!==p.materialAssetId||await computeRigHash(p,r,assets)!==r.rigHash||p.sourceAssetId!==sourceAssetId||d.canvas.width>1024||d.canvas.height>1024)r.status='stale';}
      else r.status='draft';
    }
    list(d.presets,64,'Presets');mapUnique(d.presets,'preset');for(const p of d.presets){keys(p,['id','values','rigHashes','label'],['id','values','rigHashes']);id(p.id);if(p.label!==undefined)text(p.label,80,'preset label');validateValues(p.values,true);list(p.rigHashes,16,'Preset hashes').forEach(hash);}
    list(d.motions,32,'Motions');mapUnique(d.motions,'motion');d.motions.forEach(validateMotion);
    keys(d.selection,['activeCandidateId','compareCandidateIds','partId']);ref(candidates,d.selection.activeCandidateId,'active candidate',true);ref(parts,d.selection.partId,'selected part',true);
    list(d.selection.compareCandidateIds,2,'Comparison');if(new Set(d.selection.compareCandidateIds).size!==d.selection.compareCandidateIds.length)fail('Duplicate comparison selection');d.selection.compareCandidateIds.forEach(v=>ref(candidates,v,'compare candidate'));
    budget(JSON.stringify(d));validated.add(d);return d;
  }
  async function fromV1(raw,options={}){
    const original=input(raw),legacy=Design.parseProject(original),assets=[],map=new Map();
    const candidates=[];for(const c of legacy.versions){const mime=/^data:(image\/(?:png|jpeg|webp));/.exec(c.image)[1],binaryData=binary(c.image,mime),assetId='sha256:'+await digest(binaryData);
      if(!map.has(assetId)){const decoded=await (options.decodeAsset||browserDecode)({id:assetId,mime,data:c.image});const a={id:assetId,mime,data:c.image,width:decoded.naturalWidth||decoded.width,height:decoded.naturalHeight||decoded.height};assets.push(a);map.set(assetId,a);metadata.set(assetId,{width:a.width,height:a.height});}
      const {image,...rest}=c;candidates.push({...rest,assetId});
    }
    const selected=candidates.find(c=>c.id===legacy.selectionHistory.at(-1)?.candidateId)||candidates.at(-1),source=selected&&map.get(selected.assetId);
    const d={version:2,id:'v1-'+(await digest(bytes(JSON.stringify(legacy)))).slice(0,24),canvas:{width:source?.width||1024,height:source?.height||1024,colorSpace:'srgb',alpha:'straight'},brief:legacy.brief,assets,candidates,selectionHistory:legacy.selectionHistory,sourceCandidateId:selected?.id||null,backgroundAssetId:null,parts:[],rigs:[],parameters:Object.entries(PARAMS).map(([id,value])=>({id,min:0,max:1,default:value,value})),presets:[],motions:[],selection:{activeCandidateId:selected?.id||null,compareCandidateIds:[],partId:null}};
    return parseDocument(d,{decodeAsset:a=>metadata.get(a.id)});
  }
  async function serializeDocument(doc){return JSON.stringify(await parseDocument(doc));}
  function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
  function differences(before,after,path=[],out=[]){
    if(before===after)return out;
    if(path.length===1&&path[0]==='assets'){if(before.map(a=>a.id).join()!==after.map(a=>a.id).join())out.push({path,before:before.map(a=>a.id),after:after.map(a=>a.id)});return out;}
    if(before&&after&&typeof before==='object'&&typeof after==='object'&&Array.isArray(before)===Array.isArray(after)){
      for(const key of new Set([...Object.keys(before),...Object.keys(after)]))differences(before[key],after[key],path.concat(key),out);
    }else out.push({path,before,after});
    return out;
  }
  function createEditor(doc,{historyLimit=50,maxHistoryBytes=33554432,decodeAsset}={}){
    if(!validated.has(doc))fail('parseDocument must validate the initial document');
    integer(historyLimit,0,50,'history limit');integer(maxHistoryBytes,0,33554432,'history byte limit');
    let current=freeze(doc),revision=0,undo=[],redo=[],queue=Promise.resolve();
    const historyBytes=()=>[...undo,...redo].reduce((sum,entry)=>sum+entry.bytes,0);
    const snapshot=()=>Object.freeze({document:current,revision,canUndo:undo.length>0,canRedo:redo.length>0,undoCount:undo.length,redoCount:redo.length,historyBytes:historyBytes()});
    function enqueue(work){const pending=queue.then(work);queue=pending.catch(()=>null);return pending;}
    function getPart(d,partId){const p=d.parts.find(p=>p.id===partId);if(!p)fail('Missing part');return p;}
    function currentSource(d){return d.candidates.find(c=>c.id===d.sourceCandidateId)?.assetId||null;}
    function editableSource(d,p){if(p.sourceAssetId!==currentSource(d))fail('Part source is stale');}
    function compatible(d,hashes){const ready=new Set(d.rigs.filter(r=>r.status==='ready').map(r=>r.rigHash));if(!hashes.length||hashes.some(h=>!ready.has(h)))fail('Preset or motion rig is stale');}
    async function apply(d,command){
      keys(command,['type','args','expectedRevision']);integer(command.expectedRevision,0,Number.MAX_SAFE_INTEGER,'expected revision');if(command.expectedRevision!==revision)fail('Document revision changed');
      const a=command.args;
      switch(command.type){
        case 'addAsset':{keys(a,['asset']);keys(a.asset,['id','mime','data','width','height']);const old=d.assets.find(asset=>asset.id===a.asset.id);if(old){if(['id','mime','data','width','height'].some(key=>old[key]!==a.asset[key]))fail('Asset id already exists');}else d.assets.push(copy(a.asset));break;}
        case 'addPart':keys(a,['part']);editableSource(d,a.part);d.parts.push(copy(a.part));break;
        case 'removePart':{
          keys(a,['partId']);const p=getPart(d,a.partId);if(p.lockMaterial||p.lockTransform)fail('Part is locked');
          if(d.parts.some(p=>p.parentId===a.partId))fail('Part has children');
          const hashes=d.rigs.filter(r=>r.partId===a.partId).map(r=>r.rigHash);
          if([...d.presets,...d.motions].some(x=>x.rigHashes.some(h=>hashes.includes(h))))fail('Part is referenced by preset or motion');
          d.parts=d.parts.filter(p=>p.id!==a.partId);d.rigs=d.rigs.filter(r=>r.partId!==a.partId);if(d.selection.partId===a.partId)d.selection.partId=null;break;
        }
        case 'setPart':{
          keys(a,['partId','patch']);keys(a.patch,['name','parentId','order','transform','visible','opacity','lockMaterial','lockTransform'],[]);const p=getPart(d,a.partId);
          if(Object.hasOwn(a.patch,'transform')||Object.hasOwn(a.patch,'parentId')){editableSource(d,p);if(p.lockTransform)fail('Part transform is locked');if(Object.hasOwn(a.patch,'transform')&&!p.backgroundReady)fail('Background must be prepared before moving a part');}
          Object.assign(p,copy(a.patch));break;
        }
        case 'replaceMaterial':{
          keys(a,['partId','assetId']);const p=getPart(d,a.partId);editableSource(d,p);if(p.lockMaterial)fail('Part material is locked');
          if(!d.assets.some(asset=>asset.id===a.assetId&&asset.mime==='image/png'))fail('Missing PNG material');p.materialAssetId=a.assetId;break;
        }
        case 'setRig':{
          keys(a,['rig']);const p=getPart(d,a.rig.partId);editableSource(d,p);if(p.lockTransform)fail('Part transform is locked');
          if(a.rig.materialAssetId!==p.materialAssetId||a.rig.rigHash!==await computeRigHash(p,a.rig,d.assets))fail('New rig hash mismatch');
          const index=d.rigs.findIndex(r=>r.partId===p.id);if(index<0)d.rigs.push(copy(a.rig));else d.rigs[index]=copy(a.rig);break;
        }
        case 'setParameters':{
          keys(a,['values']);validateValues(a.values);
          for(const [name,value]of Object.entries(a.values)){const parameter=d.parameters.find(p=>p.id===name);if(parameter.value===value)continue;
            const targets=d.rigs.filter(r=>r.bindings.some(b=>b.parameterId===name));if(!targets.length||targets.some(r=>r.status!=='ready'))fail('Parameter binding is not ready or stale');parameter.value=value;
          }break;
        }
        case 'savePreset':{keys(a,['preset']);compatible(d,a.preset.rigHashes);const index=d.presets.findIndex(p=>p.id===a.preset.id);if(index<0)d.presets.push(copy(a.preset));else d.presets[index]=copy(a.preset);break;}
        case 'saveMotion':{keys(a,['motion']);compatible(d,a.motion.rigHashes);const index=d.motions.findIndex(m=>m.id===a.motion.id);if(index<0)d.motions.push(copy(a.motion));else d.motions[index]=copy(a.motion);break;}
        case 'setSelection':keys(a,['selection']);keys(a.selection,['activeCandidateId','compareCandidateIds','partId'],[]);Object.assign(d.selection,copy(a.selection));break;
        case 'setBackground':keys(a,['assetId','confirmed']);bool(a.confirmed);d.backgroundAssetId=a.assetId;for(const p of d.parts)if(p.sourceAssetId===currentSource(d))p.backgroundReady=a.confirmed;break;
        default:fail('Unsupported document command');
      }
    }
    function dispatchBatch(commands){return enqueue(async()=>{
      safeData(commands);list(commands,130,'Command batch');const before=current,draft=copy(current);
      for(const command of commands)await apply(draft,copy(command));
      const next=await parseDocument(draft,decodeAsset?{decodeAsset}:{});
      for(const command of commands)if(command.type==='setRig'&&next.rigs.find(r=>r.partId===command.args.rig.partId)?.status!=='ready')fail('New rig is not ready');
      const patches=differences(before,next);if(!patches.length)return snapshot();
      const size=bytes(JSON.stringify(patches)).length;redo=[];undo.push({document:before,bytes:size,patches});
      current=freeze(next);revision++;
      while(undo.length>historyLimit||historyBytes()>maxHistoryBytes)undo.shift();
      return snapshot();
    });}
    function move(backwards){return enqueue(async()=>{const from=backwards?undo:redo,to=backwards?redo:undo;const entry=from.pop();if(!entry)return snapshot();to.push({document:current,bytes:entry.bytes,patches:entry.patches});current=entry.document;revision++;return snapshot();});}
    return Object.freeze({snapshot,dispatch:command=>dispatchBatch([command]),dispatchBatch,undo:()=>move(true),redo:()=>move(false)});
  }
  return Object.freeze({parseDocument,serializeDocument,fromV1,computeRigHash,createEditor});
});

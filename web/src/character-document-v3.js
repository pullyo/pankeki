(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./character-document.js'),root);
  else root.PankekiDocumentV3=factory(root.PankekiDocument,root);
})(typeof globalThis==='object'?globalThis:this,function(Legacy,root){
  'use strict';
  const MAX_JSON=64*1024*1024, validated=new WeakMap();
  const fail=message=>{throw Error(message);};
  const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
  function safe(x,depth=0){
    if(depth>24)fail('Document nesting is too deep');
    if(x===null||typeof x==='string'||typeof x==='boolean')return;
    if(typeof x==='number'){if(!Number.isFinite(x))fail('Non-finite value');return;}
    if(!plain(x)&&!Array.isArray(x))fail('Expected plain JSON data');
    if(Object.getOwnPropertySymbols(x).length)fail('Symbol fields unsupported');
    if(Array.isArray(x)&&x.length>100000)fail('Array too large');
    for(const key of Object.getOwnPropertyNames(x)){
      if(['__proto__','prototype','constructor'].includes(key))fail('Unsafe key');
      const descriptor=Object.getOwnPropertyDescriptor(x,key);if(!Object.hasOwn(descriptor,'value'))fail('Accessor fields unsupported');
      if(Array.isArray(x)&&key==='length')continue;
      if(Array.isArray(x)&&(!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=x.length))fail('Unsupported array field');
      safe(descriptor.value,depth+1);
    }
    if(Array.isArray(x))for(let i=0;i<x.length;i++)if(!Object.hasOwn(x,i))fail('Sparse arrays unsupported');
  }
  const clone=x=>JSON.parse(JSON.stringify(x));
  function input(raw){if(typeof raw==='string'){if(raw.length>MAX_JSON)fail('Document exceeds 64 MiB');raw=JSON.parse(raw);}safe(raw);const json=JSON.stringify(raw);if(new TextEncoder().encode(json).length>MAX_JSON)fail('Document exceeds 64 MiB');return JSON.parse(json);}
  function fields(x,names,required=names){if(!plain(x))fail('Expected plain object');for(const k of Object.keys(x))if(!names.includes(k))fail('Unsupported field: '+k);for(const k of required)if(!Object.hasOwn(x,k))fail('Missing field: '+k);}
  function list(x,max){if(!Array.isArray(x)||x.length>max)fail('Array exceeds limit '+max);return x;}
  function num(x,min=-Infinity,max=Infinity){if(typeof x!=='number'||!Number.isFinite(x)||x<min||x>max)fail('Invalid finite number or range');return x;}
  function id(x){if(typeof x!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(x))fail('Invalid identifier');return x;}
  function text(x,max){if(typeof x!=='string'||x.length>max)fail('Invalid text');}
  function hash(x){if(typeof x!=='string'||!/^[a-f0-9]{64}$/.test(x))fail('Invalid rig hash');}
  function unique(xs){const result=new Map();for(const x of xs){id(x.id);if(result.has(x.id))fail('Duplicate id');result.set(x.id,x);}return result;}
  function freeze(x){if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.values(x).forEach(freeze);Object.freeze(x);}return x;}
  function canonical(x){if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';if(plain(x))return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';return JSON.stringify(x);}
  function definitions(d){const defs=unique(list(d.parameterDefinitions,32));for(const p of defs.values()){fields(p,['id','label','min','max','default','unit']);text(p.label,80);text(p.unit,40);num(p.min);num(p.max);if(p.min>=p.max)fail('Parameter range must increase');num(p.default,p.min,p.max);}return defs;}
  function values(value,defs,complete){fields(value,[...defs.keys()],complete?[...defs.keys()]:[]);for(const [k,v]of Object.entries(value))num(v,defs.get(k).min,defs.get(k).max);}
  function area(v,a,b,c){return ((v[2*b]-v[2*a])*(v[2*c+1]-v[2*a+1])-(v[2*b+1]-v[2*a+1])*(v[2*c]-v[2*a]))/2;}
  function checkGeometry(vertices,rig){vertices.forEach(v=>num(v,-1e7,1e7));for(let i=0;i<rig.triangles.length;i+=3){const [a,b,c]=rig.triangles.slice(i,i+3),base=area(rig.vertices,a,b,c),posed=area(vertices,a,b,c);if(!Number.isFinite(posed)||Math.abs(posed)<.0001||base*posed<=0)fail('Invalid triangle geometry');}}
  function extensions(d,defs){
    const rigs=new Map(d.baseDocument.rigs.map(r=>[r.partId,r])),parts=new Set(d.baseDocument.parts.map(p=>p.id));
    const deformers=unique(list(d.deformers,8));
    for(const w of deformers.values()){
      fields(w,['id','parentId','kind','rect','columns','rows','deltas']);
      if(w.kind!=='warp')fail('Unsupported deformer kind');
      if(w.parentId!==null){id(w.parentId);if(!deformers.has(w.parentId))fail('Missing parent deformer');}
      if(!Number.isInteger(w.columns)||!Number.isInteger(w.rows)||w.columns<2||w.columns>8||w.rows<2||w.rows>8)fail('Warp lattice must be 2..8');
      list(w.rect,4);if(w.rect.length!==4)fail('Invalid warp rect');w.rect.forEach(v=>num(v,-1e7,1e7));
      const [x,y,width,height]=w.rect;if(width<=0||height<=0)fail('Invalid warp rect extent');num(x+width,-1e7,1e7);num(y+height,-1e7,1e7);
      list(w.deltas,128);if(w.deltas.length!==w.columns*w.rows*2)fail('Warp lattice displacement count mismatch');w.deltas.forEach(v=>num(v,-1e7,1e7));
      const point=(col,row)=>{const i=2*(row*w.columns+col),px=x+width*col/(w.columns-1)+w.deltas[i],py=y+height*row/(w.rows-1)+w.deltas[i+1];num(px,-1e7,1e7);num(py,-1e7,1e7);return [px,py];};
      // A bilinear cell Jacobian determinant is affine in (u,v). All four
      // corner signs must be positive; a single diagonal/triangle is insufficient.
      for(let row=0;row<w.rows-1;row++)for(let col=0;col<w.columns-1;col++){
        const a=point(col,row),b=point(col+1,row),c=point(col,row+1),e=point(col+1,row+1);
        const dx0=[b[0]-a[0],b[1]-a[1]],dx1=[e[0]-c[0],e[1]-c[1]],dy0=[c[0]-a[0],c[1]-a[1]],dy1=[e[0]-b[0],e[1]-b[1]];
        for(const dx of [dx0,dx1])for(const dy of [dy0,dy1]){const determinant=dx[0]*dy[1]-dx[1]*dy[0];if(!Number.isFinite(determinant)||determinant<.0001)fail('Folded or degenerate warp cell');}
      }
      // Positive cell Jacobians alone allow a strip to wrap over itself.
      // A simple outer boundary plus the local orientation checks rules that out.
      const boundary=[];
      for(let col=0;col<w.columns;col++)boundary.push(point(col,0));
      for(let row=1;row<w.rows;row++)boundary.push(point(w.columns-1,row));
      for(let col=w.columns-2;col>=0;col--)boundary.push(point(col,w.rows-1));
      for(let row=w.rows-2;row>0;row--)boundary.push(point(0,row));
      const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
      const on=(a,b,p)=>p[0]>=Math.min(a[0],b[0])&&p[0]<=Math.max(a[0],b[0])&&p[1]>=Math.min(a[1],b[1])&&p[1]<=Math.max(a[1],b[1]);
      for(let i=0;i<boundary.length;i++)for(let j=i+1;j<boundary.length;j++){
        if(j===i+1||(i===0&&j===boundary.length-1))continue;
        const a=boundary[i],b=boundary[(i+1)%boundary.length],c=boundary[j],e=boundary[(j+1)%boundary.length],abC=cross(a,b,c),abE=cross(a,b,e),ceA=cross(c,e,a),ceB=cross(c,e,b);
        if((abC*abE<0&&ceA*ceB<0)||(abC===0&&on(a,b,c))||(abE===0&&on(a,b,e))||(ceA===0&&on(c,e,a))||(ceB===0&&on(c,e,b)))fail('Warp boundary overlaps');
      }
    }
    const deformerVisited=new Set(),deformerVisiting=new Set();
    function visitDeformer(id){if(deformerVisiting.has(id))fail('Deformer cycle');if(deformerVisited.has(id))return;deformerVisiting.add(id);const parent=deformers.get(id).parentId;if(parent!==null)visitDeformer(parent);deformerVisiting.delete(id);deformerVisited.add(id);}
    for(const id of deformers.keys())visitDeformer(id);
    fields(d.partDeformerIds,[...parts],[]);
    for(const [partId,deformerId]of Object.entries(d.partDeformerIds)){if(!rigs.has(partId))fail('Missing deformer part rig');if(deformerId!==null){id(deformerId);if(!deformers.has(deformerId))fail('Missing part deformer');}}
    const edges=new Map(),inversion=new Map(),clipPairs=new Set();
    for(const clip of list(d.clipRelations,32)){
      fields(clip,['sourcePartId','targetPartId','inverted']);id(clip.sourcePartId);id(clip.targetPartId);
      const {sourcePartId:source,targetPartId:target,inverted}=clip;
      if(!parts.has(source)||!parts.has(target)||!rigs.has(source)||!rigs.has(target))fail('Missing clip part/rig');
      if(source===target||typeof inverted!=='boolean')fail('Invalid self clip or inversion');
      const pair=source+'\0'+target;if(clipPairs.has(pair))fail('Duplicate clip relation');clipPairs.add(pair);
      if(inversion.has(target)&&inversion.get(target)!==inverted)fail('Mixed clip inversion for target');inversion.set(target,inverted);
      if(!edges.has(target))edges.set(target,[]);edges.get(target).push(source);
    }
    const visited=new Set(),visiting=new Set();
    function visit(part){if(visiting.has(part))fail('Clip cycle');if(visited.has(part))return;visiting.add(part);for(const source of edges.get(part)||[])visit(source);visiting.delete(part);visited.add(part);}
    for(const part of parts)visit(part);
    unique(list(d.bindings,512));const bound=new Set(),pairs=new Set();
    for(const b of d.bindings){
      if(!['axis','grid2d'].includes(b.mode))fail('Unsupported binding mode');
      fields(b,b.mode==='axis'?['id','partId','mode','parameterIds','keys']:['id','partId','mode','parameterIds','axes','deltas']);
      if(!parts.has(b.partId)||!rigs.has(b.partId))fail('Missing binding part/rig');
      const dimensions=b.mode==='axis'?1:2;list(b.parameterIds,dimensions);if(b.parameterIds.length!==dimensions)fail('Invalid binding parameter count');
      for(const parameterId of b.parameterIds){if(!defs.has(parameterId))fail('Invalid binding parameter');const pair=b.partId+'\0'+parameterId;if(pairs.has(pair))fail('Duplicate part parameter binding');pairs.add(pair);}bound.add(b.partId);
      const rig=rigs.get(b.partId);
      function delta(ds,neutral){list(ds,512);if(ds.length!==rig.vertices.length)fail('Key vertex count mismatch');ds.forEach(v=>num(v,-1e7,1e7));if(neutral&&ds.some(v=>v!==0))fail('Default key displacement must be zero');checkGeometry(rig.vertices.map((v,i)=>v+ds[i]),rig);}
      if(b.mode==='axis'){
        const p=defs.get(b.parameterIds[0]),keys=list(b.keys,32);if(keys.length<2||keys[0].at!==p.min||keys.at(-1).at!==p.max)fail('Binding keys must cover parameter range');let previous=-Infinity,neutral=false;
        for(const k of keys){fields(k,['at','deltas']);num(k.at,p.min,p.max);if(k.at<=previous)fail('Binding keys must increase');previous=k.at;if(k.at===p.default)neutral=true;delta(k.deltas,k.at===p.default);}
        if(!neutral)fail('Default key missing');
      }else{
        list(b.axes,2);if(b.axes.length!==2)fail('Grid needs two axes');
        const neutral=b.axes.map((axis,i)=>{const p=defs.get(b.parameterIds[i]);list(axis,8);if(axis.length<2||axis[0]!==p.min||axis.at(-1)!==p.max)fail('Grid axes must cover parameter range');let previous=-Infinity;for(const v of axis){num(v,p.min,p.max);if(v<=previous)fail('Grid axes must increase');previous=v;}const index=axis.indexOf(p.default);if(index<0)fail('Default key missing');return index;});
        list(b.deltas,64);if(b.deltas.length!==b.axes[0].length*b.axes[1].length)fail('Incomplete grid');
        b.deltas.forEach((ds,i)=>delta(ds,i===neutral[1]*b.axes[0].length+neutral[0]));
      }
    }
    // Unreplaced legacy bindings continue to require their original definitions.
    for(const rig of rigs.values())if(!bound.has(rig.partId))for(const b of rig.bindings){const p=defs.get(b.parameterId),old=d.baseDocument.parameters.find(p=>p.id===b.parameterId);if(!p||p.min!==old.min||p.max!==old.max||p.default!==old.default)fail('Legacy binding requires original parameter definition');}
  }
  async function computeHash(d){
    const b=d.baseDocument;
    const shape={canvas:b.canvas,sourceCandidateId:b.sourceCandidateId,candidateAssets:b.candidates.map(c=>[c.id,c.assetId]),backgroundAssetId:b.backgroundAssetId,assets:b.assets,parts:b.parts,rigs:b.rigs,parameters:b.parameters.map(({value,...p})=>p),parameterDefinitions:d.parameterDefinitions,bindings:d.bindings,clipRelations:d.clipRelations,deformers:d.deformers,partDeformerIds:d.partDeformerIds};
    let crypto=root.crypto;if(!crypto?.subtle&&typeof require==='function')crypto=require('node:crypto').webcrypto;
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(shape)));return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
  }
  function storedItems(d,defs){
    unique(list(d.presets,64));for(const p of d.presets){fields(p,['id','label','rigHash','values']);text(p.label,80);hash(p.rigHash);if(!plain(p.values))fail('Invalid preset values');for(const [k,v]of Object.entries(p.values)){id(k);num(v);}if(p.rigHash===d.rigHash)values(p.values,defs,true);}
    unique(list(d.motions,32));for(const m of d.motions){fields(m,['id','label','duration','fps','rigHash','curves']);text(m.label,80);hash(m.rigHash);if(m.duration!==2||m.fps!==24)fail('Motion must be 2 seconds at 24fps');list(m.curves,32);const seen=new Set();for(const c of m.curves){fields(c,['parameterId','keys']);id(c.parameterId);if(seen.has(c.parameterId))fail('Duplicate motion parameter');seen.add(c.parameterId);const p=defs.get(c.parameterId);if(m.rigHash===d.rigHash&&!p)fail('Unknown motion parameter');const keys=list(c.keys,32);if(keys.length<2||keys[0].t!==0||keys.at(-1).t!==2)fail('Motion must cover 0..2');let previous=-1;for(const k of keys){fields(k,['t','value']);num(k.t,0,2);if(k.t<=previous)fail('Motion times must increase');previous=k.t;num(k.value);if(m.rigHash===d.rigHash)num(k.value,p.min,p.max);}if(keys[0].value!==keys.at(-1).value)fail('Loop endpoints must match');}}
  }
  async function parseDocumentV3(raw,options={}){
    const d=input(raw);fields(d,['format','version','baseDocument','parameterDefinitions','values','bindings','clipRelations','deformers','partDeformerIds','rigHash','presets','motions']);
    if(d.format!=='pankeki-authoring'||d.version!==3)fail('Expected explicit pankeki-authoring v3');if(d.baseDocument?.version!==2)fail('baseDocument must be v2');hash(d.rigHash);
    const decodeAsset=options.decodeAsset||validated.get(raw)?.decodeAsset;d.baseDocument=await Legacy.parseDocument(d.baseDocument,decodeAsset?{decodeAsset}:{});
    if(d.baseDocument.canvas.width>1024||d.baseDocument.canvas.height>1024)fail('V3 canvas exceeds 1024 pixels');
    const defs=definitions(d);values(d.values,defs,true);extensions(d,defs);d.rigHash=await computeHash(d);storedItems(d,defs);freeze(d);validated.set(d,{decodeAsset});return d;
  }
  async function upgradeV2(raw,options={}){
    const source=input(raw);if(source.version!==2)fail('Explicit v2 document required');const base=await Legacy.parseDocument(source,options);
    const d={format:'pankeki-authoring',version:3,baseDocument:base,parameterDefinitions:base.parameters.map(({id,min,max,default:def})=>({id,label:id,min,max,default:def,unit:'normalized'})),values:Object.fromEntries(base.parameters.map(p=>[p.id,p.value])),bindings:[],clipRelations:[],deformers:[],partDeformerIds:{},rigHash:'0'.repeat(64),presets:[],motions:[]};
    for(const r of base.rigs)for(const b of r.bindings)d.bindings.push({id:'legacy-'+d.bindings.length,partId:r.partId,mode:'axis',parameterIds:[b.parameterId],keys:clone(b.keys)});
    return parseDocumentV3(d,options);
  }
  function assertDocumentV3(d){if(!validated.has(d))fail('parseDocumentV3 must validate the immutable document first');return d;}
  async function serializeDocumentV3(d,options={}){return JSON.stringify(await parseDocumentV3(d,options));}
  function compatibilityV3(d){assertDocumentV3(d);return freeze({stalePresetIds:d.presets.filter(p=>p.rigHash!==d.rigHash).map(p=>p.id),staleMotionIds:d.motions.filter(m=>m.rigHash!==d.rigHash).map(m=>m.id)});}
  function presetValuesV3(d,presetId){assertDocumentV3(d);const p=d.presets.find(p=>p.id===presetId);if(!p)fail('Missing preset');if(p.rigHash!==d.rigHash)fail('Preset is stale');return clone(p.values);}
  function resolveValuesV3(d,overrides={}){assertDocumentV3(d);safe(overrides);const defs=definitions(d);values(overrides,defs,false);return {...d.values,...overrides};}
  function createEditorV3(d,{decodeAsset,historyLimit=50,maxHistoryBytes=33554432}={}){
    assertDocumentV3(d);if(!Number.isInteger(historyLimit)||historyLimit<0||historyLimit>50||!Number.isInteger(maxHistoryBytes)||maxHistoryBytes<0||maxHistoryBytes>33554432)fail('Invalid history limit');
    decodeAsset=decodeAsset||validated.get(d).decodeAsset;let current=d,revision=0,undo=[],redo=[],queue=Promise.resolve();
    const historyBytes=()=>[...undo,...redo].reduce((sum,e)=>sum+e.bytes,0);
    const snapshot=()=>Object.freeze({document:current,revision,canUndo:!!undo.length,canRedo:!!redo.length,undoCount:undo.length,redoCount:redo.length,historyBytes:historyBytes()});
    function enqueue(fn){const pending=queue.then(fn);queue=pending.catch(()=>{});return pending;}
    function dispatchBatch(commands){
      let captured;try{captured=input(commands);list(captured,130);}catch(error){return Promise.reject(error);}
      return enqueue(async()=>{
        const draft=clone(current),saved=[];
        for(const c of captured){fields(c,['type','value']);switch(c.type){
          case 'setParameterDefinitions':draft.parameterDefinitions=c.value;break;
          case 'setValues':draft.values=c.value;break;
          case 'setBindings':draft.bindings=c.value;break;
          case 'setClipRelations':draft.clipRelations=c.value;break;
          case 'setDeformers':fields(c.value,['deformers','partDeformerIds']);draft.deformers=c.value.deformers;draft.partDeformerIds=c.value.partDeformerIds;break;
          case 'savePreset':case 'saveMotion':{const field=c.type==='savePreset'?'presets':'motions';if(!plain(c.value))fail('Expected saved object');const index=draft[field].findIndex(x=>x.id===c.value.id);if(index<0)draft[field].push(c.value);else draft[field][index]=c.value;saved.push([field,c.value.id]);break;}
          default:fail('Unsupported document command');
        }}
        const parsed=await parseDocumentV3(draft,decodeAsset?{decodeAsset}:{});
        // Commands cannot edit baseDocument. Share its frozen validated asset graph in history.
        const next=freeze({...parsed,baseDocument:current.baseDocument});validated.set(next,{decodeAsset});
        for(const [field,id]of saved)if(next[field].find(x=>x.id===id).rigHash!==next.rigHash)fail('Saved preset or motion is stale');
        if(canonical(current)===canonical(next))return snapshot();
        // Base is immutable across these commands; history cost counts only changing extensions.
        const withoutBase=doc=>Object.fromEntries(Object.entries(doc).filter(([k])=>k!=='baseDocument'));
        const size=new TextEncoder().encode(JSON.stringify([withoutBase(current),withoutBase(next)])).length;
        redo=[];undo.push({document:current,bytes:size});current=next;revision++;
        while(undo.length&&(undo.length>historyLimit||historyBytes()>maxHistoryBytes))undo.shift();return snapshot();
      });
    }
    function move(back){return enqueue(()=>{const from=back?undo:redo,to=back?redo:undo,entry=from.pop();if(!entry)return snapshot();to.push({document:current,bytes:entry.bytes});current=entry.document;revision++;return snapshot();});}
    return Object.freeze({snapshot,dispatchBatch,undo:()=>move(true),redo:()=>move(false)});
  }
  return Object.freeze({upgradeV2,parseDocumentV3,serializeDocumentV3,createEditorV3,assertDocumentV3,resolveValuesV3,compatibilityV3,presetValuesV3});
});

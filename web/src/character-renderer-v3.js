(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./character-document-v3.js'),require('./character-renderer.js'));
  else root.PankekiRendererV3=factory(root.PankekiDocumentV3,root.PankekiRenderer);
})(typeof globalThis==='object'?globalThis:this,function(Document,Legacy){
  'use strict';
  function interpolate(keys,value,coordinate,field){for(let i=1;i<keys.length;i++)if(value<=keys[i][coordinate]){const a=keys[i-1],b=keys[i],span=b[coordinate]-a[coordinate],t=Number.isFinite(span)?(value-a[coordinate])/span:(value/2-a[coordinate]/2)/(b[coordinate]/2-a[coordinate]/2);return field==='value'?a.value*(1-t)+b.value*t:a.deltas.map((v,j)=>v+(b.deltas[j]-v)*t);}return field==='value'?keys.at(-1).value:keys.at(-1).deltas.slice();}
  function interval(axis,value){
    for(let i=1;i<axis.length;i++)if(value<=axis[i]){const a=axis[i-1],b=axis[i],span=b-a;return [i-1,Number.isFinite(span)?(value-a)/span:(value/2-a/2)/(b/2-a/2)];}
    return [axis.length-2,1];
  }
  function gridDelta(binding,values){
    const [x,tx]=interval(binding.axes[0],values[binding.parameterIds[0]]),[y,ty]=interval(binding.axes[1],values[binding.parameterIds[1]]),n=binding.axes[0].length;
    const a=binding.deltas[y*n+x],b=binding.deltas[y*n+x+1],c=binding.deltas[(y+1)*n+x],d=binding.deltas[(y+1)*n+x+1];
    return a.map((v,i)=>(v*(1-tx)+b[i]*tx)*(1-ty)+(c[i]*(1-tx)+d[i]*tx)*ty);
  }
  function area(v,a,b,c){return ((v[2*b]-v[2*a])*(v[2*c+1]-v[2*a+1])-(v[2*b+1]-v[2*a+1])*(v[2*c]-v[2*a]))/2;}
  function warpVertices(vertices,w){
    const [x,y,width,height]=w.rect,result=[];
    for(let i=0;i<vertices.length;i+=2){
      const px=vertices[i],py=vertices[i+1];if(px<x||px>x+width||py<y||py>y+height)throw Error('Point outside warp rect');
      const gx=(px-x)/width*(w.columns-1),gy=(py-y)/height*(w.rows-1),col=Math.min(Math.floor(gx),w.columns-2),row=Math.min(Math.floor(gy),w.rows-2),u=gx-col,v=gy-row;
      const a=2*(row*w.columns+col),b=a+2,c=a+2*w.columns,d=c+2;
      for(let axis=0;axis<2;axis++)result.push(vertices[i+axis]+(w.deltas[a+axis]*(1-u)+w.deltas[b+axis]*u)*(1-v)+(w.deltas[c+axis]*(1-u)+w.deltas[d+axis]*u)*v);
    }
    return result;
  }
  function finalCoordinates(doc){
    const deformers=new Map(doc.deformers.map(w=>[w.id,w])),cache=new Map();
    return draw=>{
      if(cache.has(draw.partId))return {...draw,verticesDocument:cache.get(draw.partId)};
      let vertices=draw.verticesDocument,id=Object.hasOwn(doc.partDeformerIds,draw.partId)?doc.partDeformerIds[draw.partId]:null;
      // Part-parent affine inheritance is already complete in Legacy.evaluatePose.
      // Only this part's explicit inner mapping and its deformer ancestors follow.
      while(id!==undefined&&id!==null){
        const w=deformers.get(id),next=warpVertices(vertices,w);
        if(next.some(v=>!Number.isFinite(v)||Math.abs(v)>1e7))throw Error('Invalid warped coordinates');
        for(let i=0;i<draw.triangles.length;i+=3){const [a,b,c]=draw.triangles.slice(i,i+3),before=area(vertices,a,b,c),after=area(next,a,b,c);if(!Number.isFinite(after)||Math.abs(after)<.0001||before*after<=0)throw Error('Invalid warped triangle geometry');}
        vertices=next;id=w.parentId;
      }
      cache.set(draw.partId,vertices);return {...draw,verticesDocument:vertices};
    };
  }
  function evaluatePoseV3(doc,overrides){
    const values=Document.resolveValuesV3(doc,overrides),base=doc.baseDocument,byPart=new Map();
    for(const binding of doc.bindings){if(!byPart.has(binding.partId))byPart.set(binding.partId,[]);byPart.get(binding.partId).push(binding);}
    const rigs=base.rigs.map(rig=>{
      const bindings=byPart.get(rig.partId);if(!bindings)return rig;
      const vertices=rig.vertices.slice();for(const b of bindings){const delta=b.mode==='grid2d'?gridDelta(b,values):interpolate(b.keys,values[b.parameterIds[0]],'at','deltas');for(let i=0;i<vertices.length;i++)vertices[i]+=delta[i];}
      for(let i=0;i<rig.triangles.length;i+=3){const [a,b,c]=rig.triangles.slice(i,i+3),posed=area(vertices,a,b,c);if(vertices.some(v=>!Number.isFinite(v)||Math.abs(v)>1e7)||!Number.isFinite(posed)||Math.abs(posed)<.0001||area(rig.vertices,a,b,c)*posed<=0)throw Error('Invalid combined triangle geometry');}
      // Replacement happens exactly once. The original base remains untouched.
      return {...rig,vertices,bindings:[]};
    });
    const fallback=new Set(base.rigs.filter(r=>!byPart.has(r.partId)).flatMap(r=>r.bindings.map(b=>b.parameterId)));
    const parameters=base.parameters.map(p=>({...p,value:fallback.has(p.id)?values[p.id]:p.value}));
    const scene={canvas:base.canvas,sourceAssetId:base.candidates.find(c=>c.id===base.sourceCandidateId)?.assetId||null,backgroundAssetId:base.backgroundAssetId,parts:base.parts,rigs,parameters};
    const coordinate=finalCoordinates(doc),evaluated=Legacy.evaluatePose(scene),pose={...evaluated,draws:evaluated.draws.map(coordinate)};if(!doc.clipRelations.length)return pose;
    // Visibility suppresses display only. Geometry follows the same evaluated rigs
    // and parent affine chain; opacity is inherited independently and applied once.
    const all=Legacy.evaluatePose({...scene,parts:base.parts.map(p=>({...p,visible:true,opacity:1}))});
    const parts=new Map(base.parts.map(p=>[p.id,p])),opacities=new Map();
    function opacity(id){if(opacities.has(id))return opacities.get(id);const p=parts.get(id),value=p.opacity*(p.parentId===null?1:opacity(p.parentId));opacities.set(id,value);return value;}
    const sources=new Set(doc.clipRelations.map(c=>c.sourcePartId));
    return {...pose,clipRelations:doc.clipRelations,partIds:base.parts.map(p=>p.id),maskSources:all.draws.filter(d=>sources.has(d.partId)).map(d=>({...coordinate(d),opacity:opacity(d.partId)}))};
  }
  function sampleMotionV3(doc,motionId,time,{loop=false}={}){
    Document.assertDocumentV3(doc);const motion=doc.motions.find(m=>m.id===motionId);if(!motion)throw Error('Missing motion');if(motion.rigHash!==doc.rigHash)throw Error('Motion is stale');if(typeof time!=='number'||!Number.isFinite(time)||(loop&&time<0))throw Error('Invalid motion time');
    const t=loop?time%motion.duration:Math.max(0,Math.min(motion.duration,time)),values={};for(const c of motion.curves)values[c.parameterId]=interpolate(c.keys,t,'t','value');return values;
  }
  const MAX_SCRATCH=128*1024*1024;
  function drawPoseV3(canvas,pose,decodedAssets,{canvasFactory}={}){
    const fail=message=>{throw Error(message);};
    if(!canvas||!Number.isInteger(canvas.width)||!Number.isInteger(canvas.height)||canvas.width<1||canvas.height<1||canvas.width>1024||canvas.height>1024||typeof canvas.getContext!=='function')fail('Canvas must be 1..1024 pixels per side');
    if(!pose||!Array.isArray(pose.draws)||!Array.isArray(pose.blockedParts)||pose.blockedParts.length||!(decodedAssets instanceof Map))fail('Unprepared or invalid pose');
    const width=canvas.width,height=canvas.height,count=width*height,clips=pose.clipRelations||[],draws=new Map(),sources=new Map(),relations=new Map(),pairs=new Set();
    function register(items,map){
      if(!Array.isArray(items)||items.length>16)fail('At most 16 part draws');
      for(const d of items){
        if(!d||typeof d.partId!=='string'||!d.partId||map.has(d.partId)||!Number.isFinite(d.opacity)||d.opacity<0||d.opacity>1||!Number.isFinite(d.order))fail('Invalid draw item');
        if(!Array.isArray(d.verticesDocument)||d.verticesDocument.length<6||d.verticesDocument.length>512||d.verticesDocument.length%2||!d.verticesDocument.every(Number.isFinite)||!Array.isArray(d.uv)||d.uv.length!==d.verticesDocument.length||!d.uv.every(v=>Number.isFinite(v)&&v>=0&&v<=1)||!Array.isArray(d.triangles)||!d.triangles.length||d.triangles.length>1536||d.triangles.length%3||!d.triangles.every(i=>Number.isInteger(i)&&i>=0&&i<d.uv.length/2))fail('Invalid draw geometry');
        map.set(d.partId,d);
      }
    }
    register(pose.draws,draws);register(pose.maskSources||[],sources);
    const ids=new Set(pose.partIds||[...draws.keys()]);if(ids.size>16||!Array.isArray(clips)||clips.length>32)fail('Invalid clip graph');
    for(const c of clips){
      if(!c||Object.keys(c).length!==3||!ids.has(c.sourcePartId)||!ids.has(c.targetPartId)||c.sourcePartId===c.targetPartId||typeof c.inverted!=='boolean'||!sources.has(c.sourcePartId))fail('Invalid clip relation or missing mask source');
      const key=c.sourcePartId+'\0'+c.targetPartId;if(pairs.has(key))fail('Duplicate clip relation');pairs.add(key);
      if(!relations.has(c.targetPartId))relations.set(c.targetPartId,[]);const group=relations.get(c.targetPartId);
      if(group.length&&group[0].inverted!==c.inverted)fail('Mixed clip inversion');group.push(c);
    }
    const visited=new Set(),visiting=new Set();
    function visit(id){if(visiting.has(id))fail('Clip cycle');if(visited.has(id))return;visiting.add(id);for(const c of relations.get(id)||[])visit(c.sourcePartId);visiting.delete(id);visited.add(id);}
    for(const id of ids)visit(id);
    const required=new Set(clips.map(c=>c.sourcePartId));
    // Four reusable surfaces plus source caches. Retained arrays peak during
    // triangle reads: Float64 RGBA sums(32) + Uint32 coverage(4) + output(4)
    // + sample/coverage RGBA(8) =48 bytes/pixel. Silhouette is read only after
    // triangle reads leave scope, so its phase is44 bytes/pixel instead.
    const scratchBytes=count*(4*(4+required.size)+48);if(scratchBytes>MAX_SCRATCH)fail('Scratch exceeds 128 MiB');
    const target=canvas.getContext('2d');if(!target||(typeof target.isContextLost==='function'&&target.isContextLost()))fail('Destination Canvas2D unavailable');
    if(canvasFactory!==undefined&&typeof canvasFactory!=='function')fail('Invalid canvasFactory');
    const factory=canvasFactory||((w,h)=>{
      if(typeof OffscreenCanvas==='function')return new OffscreenCanvas(w,h);
      if(canvas.ownerDocument?.createElement){const c=canvas.ownerDocument.createElement('canvas');c.width=w;c.height=h;return c;}
      fail('Canvas factory required outside a browser');
    });
    const owned=[],contexts=new Map(),cache=new Map();let sums=null,weightsSum=null,output=null;
    function surface(){
      const c=factory(width,height);if(!c||c===canvas||owned.includes(c)||[...decodedAssets.values()].includes(c))fail('Canvas factory must return a fresh scratch surface');
      owned.push(c);if(c.width!==width||c.height!==height||typeof c.getContext!=='function')fail('Invalid scratch dimensions');
      const x=c.getContext('2d',{willReadFrequently:true});if(!x||(typeof x.isContextLost==='function'&&x.isContextLost()))fail('Scratch Canvas2D unavailable');contexts.set(c,x);return c;
    }
    function reset(c){const x=contexts.get(c);x.setTransform(1,0,0,1,0,0);x.globalAlpha=1;x.globalCompositeOperation='source-over';x.clearRect(0,0,width,height);return x;}
    function path(x,d,offset){for(let j=0;j<3;j++){const i=d.triangles[offset+j]*2;if(j)x.lineTo(d.verticesDocument[i],d.verticesDocument[i+1]);else x.moveTo(d.verticesDocument[i],d.verticesDocument[i+1]);}x.closePath();}
    try{
      const staging=surface(),union=surface(),triangle=surface(),shape=surface();
      sums=new Float64Array(count*4);weightsSum=new Uint32Array(count);output=contexts.get(triangle).createImageData(width,height);
      for(const id of required)cache.set(id,surface());
      function mapping(d,indices,size){
        const points=indices.map(i=>[d.uv[i*2]*size.width,d.uv[i*2+1]*size.height,d.verticesDocument[i*2],d.verticesDocument[i*2+1]]),[p,q,r]=points;
        const x1=q[0]-p[0],y1=q[1]-p[1],x2=r[0]-p[0],y2=r[1]-p[1],dx1=q[2]-p[2],dy1=q[3]-p[3],dx2=r[2]-p[2],dy2=r[3]-p[3],det=x1*y2-x2*y1;
        const a=(dx1*y2-dx2*y1)/det,b=(dy1*y2-dy2*y1)/det,c=(dx2*x1-dx1*x2)/det,dv=(dy2*x1-dy1*x2)/det;
        return[a,b,c,dv,p[2]-a*p[0]-c*p[1],p[3]-b*p[0]-dv*p[1]];
      }
      function wholeAffine(d,size){
        // Same farthest UV / largest-area basis and1e-4 tolerance as legacy.
        let second=0,third=0,distance=-1,largest=-1;
        for(let i=1;i<d.uv.length/2;i++){const dx=d.uv[i*2]-d.uv[0],dy=d.uv[i*2+1]-d.uv[1],n=dx*dx+dy*dy;if(n>distance){distance=n;second=i;}}
        for(let i=0;i<d.uv.length/2;i++){const n=Math.abs(area(d.uv,0,second,i));if(n>largest){largest=n;third=i;}}
        const m=mapping(d,[0,second,third],size);
        return m.every(Number.isFinite)&&d.uv.every((_,i)=>i%2||Math.abs(m[0]*d.uv[i]*size.width+m[2]*d.uv[i+1]*size.height+m[4]-d.verticesDocument[i])<=.0001&&Math.abs(m[1]*d.uv[i]*size.width+m[3]*d.uv[i+1]*size.height+m[5]-d.verticesDocument[i+1])<=.0001);
      }
      function paint(d,destination){
        const image=decodedAssets.get(d.assetId),size={width:image?.naturalWidth??image?.width,height:image?.naturalHeight??image?.height};
        if(!Number.isInteger(size.width)||!Number.isInteger(size.height)||size.width<=0||size.height<=0)fail('Missing decoded asset');
        if(wholeAffine(d,size)){
          // Preserve native whole-part RGBA/opacity; this branch cannot allocate
          // legacy non-affine scratch because its affine test is identical.
          Legacy.drawPose(destination,{backgroundAssetId:null,draws:[d],blockedParts:[]},decodedAssets);return;
        }
        const px=d.verticesDocument.filter((_,i)=>i%2===0),py=d.verticesDocument.filter((_,i)=>i%2===1),partLeft=Math.max(0,Math.floor(Math.min(...px))-1),partTop=Math.max(0,Math.floor(Math.min(...py))-1),partRight=Math.min(width,Math.ceil(Math.max(...px))+1),partBottom=Math.min(height,Math.ceil(Math.max(...py))+1),partWidth=partRight-partLeft,partHeight=partBottom-partTop;
        for(let y=partTop;y<partBottom;y++){sums.fill(0,(y*width+partLeft)*4,(y*width+partRight)*4);weightsSum.fill(0,y*width+partLeft,y*width+partRight);}
        for(let i=0;i<d.triangles.length;i+=3){
          const indices=d.triangles.slice(i,i+3),m=mapping(d,indices,size),vertices=indices.flatMap(j=>d.verticesDocument.slice(2*j,2*j+2));
          // Draw the full texture under this triangle's affine map WITHOUT its
          // triangle clip. Coverage is read separately, before alpha quantization.
          const quad={...d,opacity:1,verticesDocument:[[0,0],[size.width,0],[size.width,size.height],[0,size.height]].flatMap(([x,y])=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]]),uv:[0,0,1,0,1,1,0,1],triangles:[0,1,2,0,2,3]};
          const xs=vertices.filter((_,j)=>j%2===0),ys=vertices.filter((_,j)=>j%2===1),left=Math.max(0,Math.floor(Math.min(...xs))-1),top=Math.max(0,Math.floor(Math.min(...ys))-1),right=Math.min(width,Math.ceil(Math.max(...xs))+1),bottom=Math.min(height,Math.ceil(Math.max(...ys))+1),w=right-left,h=bottom-top;
          const bounded=contexts.get(triangle);bounded.save();try{bounded.beginPath();bounded.rect(left,top,Math.max(0,w),Math.max(0,h));bounded.clip();Legacy.drawPose(triangle,{backgroundAssetId:null,draws:[quad],blockedParts:[]},decodedAssets);}finally{bounded.restore();}
          const cx=reset(shape);cx.fillStyle='#fff';cx.beginPath();path(cx,d,i);cx.fill();
          
          if(w<=0||h<=0)continue;
          const pixels=contexts.get(triangle).getImageData(left,top,w,h).data,weights=cx.getImageData(left,top,w,h).data;
          for(let y=0;y<h;y++)for(let x=0;x<w;x++){
            const p=(y*w+x)*4,index=(top+y)*width+left+x,k=index*4,weight=weights[p+3],a=pixels[p+3]*weight;
            for(let ch=0;ch<3;ch++)sums[k+ch]+=pixels[p+ch]*a;
            sums[k+3]+=a;weightsSum[index]+=weight;
          }
        }
        const shapeContext=reset(shape);shapeContext.fillStyle='#fff';shapeContext.beginPath();for(let i=0;i<d.triangles.length;i+=3)path(shapeContext,d,i);shapeContext.fill();
        if(partWidth<=0||partHeight<=0){reset(destination);return;}
        const silhouette=shapeContext.getImageData(partLeft,partTop,partWidth,partHeight).data;
        for(let y=partTop;y<partBottom;y++)output.data.fill(0,(y*width+partLeft)*4,(y*width+partRight)*4);
        for(let y=partTop;y<partBottom;y++)for(let x=partLeft;x<partRight;x++){const i=y*width+x;
          const p=i*4,a=sums[p+3],weight=weightsSum[i];if(!a||!weight)continue;
          for(let ch=0;ch<3;ch++)output.data[p+ch]=Math.round(sums[p+ch]/a);
          output.data[p+3]=Math.min(255,Math.round(a*silhouette[((y-partTop)*partWidth+x-partLeft)*4+3]/(weight*255)));
        }
        // Reuse the silhouette surface after its readback as the raw RGBA layer.
        // One native image draw applies opacity with native premultiplied rounding.
        reset(shape).putImageData(output,0,0,partLeft,partTop,partWidth,partHeight);const x=reset(destination);x.globalAlpha=d.opacity;x.drawImage(shape,partLeft,partTop,partWidth,partHeight,partLeft,partTop,partWidth,partHeight);x.globalAlpha=1;
      }
      const ready=new Set();
      function source(id){if(!ready.has(id)){render(sources.get(id),cache.get(id));ready.add(id);}return cache.get(id);}
      function render(d,destination){
        const group=relations.get(d.partId)||[];
        // Dependencies must finish before using the shared union/paint surfaces.
        for(const c of group)source(c.sourcePartId);
        paint(d,destination);
        if(group.length){const ux=reset(union);for(const c of group)ux.drawImage(cache.get(c.sourcePartId),0,0);
          const x=contexts.get(destination);x.globalCompositeOperation=group[0].inverted?'destination-out':'destination-in';x.drawImage(union,0,0);x.globalCompositeOperation='source-over';}
      }
      // Validate and render every required source, even when its display is hidden.
      for(const id of required)source(id);
      const sx=reset(staging);if(pose.backgroundAssetId!==null){
        const background=decodedAssets.get(pose.backgroundAssetId);if(!background||(background.naturalWidth??background.width)!==width||(background.naturalHeight??background.height)!==height)fail('Missing or mismatched background');sx.drawImage(background,0,0);
      }
      const drawnPartIds=[];
      for(const d of [...draws.values()].sort((a,b)=>a.order-b.order)){
        if(d.opacity===0)continue;const cached=cache.get(d.partId);
        if(cached)sx.drawImage(cached,0,0);else{render(d,triangle);sx.drawImage(triangle,0,0);}drawnPartIds.push(d.partId);
      }
      // Single completed-frame blit: no clear or incremental part writes to target.
      target.save();try{target.setTransform(1,0,0,1,0,0);target.globalAlpha=1;target.globalCompositeOperation='copy';target.filter='none';target.shadowBlur=0;target.shadowOffsetX=0;target.shadowOffsetY=0;target.shadowColor='rgba(0,0,0,0)';target.drawImage(staging,0,0);}finally{target.restore();}
      return {width,height,drawnPartIds};
    }finally{
      sums=null;weightsSum=null;output=null;cache.clear();contexts.clear();
      for(const c of owned){try{c.width=1;c.height=1;}catch(_){/* Drop references even if a host refuses explicit release. */}}
      owned.length=0;
    }
  }
  return Object.freeze({evaluatePoseV3,sampleMotionV3,drawPoseV3});
});

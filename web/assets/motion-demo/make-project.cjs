'use strict';
// Build a normal v2 document from these manually prepared PNGs and keyforms.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Design=require('../../src/profiles.js'),Document=require('../../src/character-document.js');
const dir=__dirname,sha=data=>crypto.createHash('sha256').update(data).digest('hex'),round=v=>{const n=Math.round(v*1e4)/1e4;return n===0?0:n;};
function grid(width,height){
 const vertices=[],uv=[],triangles=[];for(let y=0;y<4;y++)for(let x=0;x<4;x++){vertices.push(round(width*x/3),round(height*y/3));uv.push(x/3,y/3);}
 for(let y=0;y<3;y++)for(let x=0;x<3;x++){const a=y*4+x,b=a+1,c=a+4,d=c+1;triangles.push(a,b,c,b,d,c);}return {vertices,uv,triangles};
}
function delta(vertices,fn){const d=[];for(let i=0;i<vertices.length;i+=2)d.push(...fn(vertices[i],vertices[i+1]).map(round));return d;}
function binding(parameterId,vertices,atOne,atZero=null){
 const zero=vertices.map(()=>0),one=delta(vertices,atOne),closed=atZero?delta(vertices,atZero):zero;
 return {parameterId,keys:[{at:0,deltas:closed},{at:.5,deltas:closed.map((v,i)=>round((v+one[i])/2))},{at:1,deltas:one}]};
}
(async()=>{
 const byName={},assets=[];for(const name of ['source','background','body','eyes','mouth']){
  const raw=fs.readFileSync(path.join(dir,name+'.png')),asset={id:'sha256:'+sha(raw),mime:'image/png',width:raw.readUInt32BE(16),height:raw.readUInt32BE(20),data:'data:image/png;base64,'+raw.toString('base64')};assets.push(asset);byName[name]=asset;
 }
 const brief=Design.sanitizeBrief({profile:'mascot',name:'팬케이크 파코 · 직접 제작 예제',brief:'버터 모자를 쓰고 아침 인사를 건네는 작은 팬케이크 친구.',appearance:'세 겹의 폭신한 팬케이크, 시럽과 버터, 둥근 눈과 작은 손발.',detail:'몸·눈·입이 분리된 RGBA 소재이며 눈·입·호흡을 같은 메시로 조절합니다.',palette:['#EFB458','#FFF0A0','#754321'],notes:'수동 제작·분리한 SVG/RGBA 예제입니다. 자동 부위 분리나 모델 생성 결과가 아닙니다. 다시 열면 과거 undo 스택은 복원되지 않습니다.',prompt:'',useBrief:true});
 const part=(id,name,parentId,order,rect,transform)=>({id,name,parentId,order,sourceAssetId:byName.source.id,maskAssetId:null,materialAssetId:byName[id].id,sourceRect:rect,transform,visible:true,opacity:1,lockMaterial:false,lockTransform:false,backgroundReady:true});
 const parts=[part('body','팬케이크 몸',null,0,[100,125,440,410],[1,0,0,1,100,125]),part('eyes','눈','body',1,[240,319,160,44],[1,0,0,1,140,194]),part('mouth','입','body',2,[286,369,68,8],[1,0,0,8/36,186,244])];
 const rigs=[];
 for(const p of parts){
  const geometry=grid(byName[p.id].width,byName[p.id].height);
  const r={id:'rig-'+p.id,partId:p.id,materialAssetId:p.materialAssetId,rigHash:'',status:'ready',...geometry,bindings:[]};
  if(p.id==='body')r.bindings.push(binding('breath',r.vertices,(x,y)=>[(x-220)*.018,(y-330)*.025]));
  if(p.id==='eyes'){
   r.bindings.push(binding('eyeOpen',r.vertices,()=>[0,0],(x,y)=>[0,(22-y)*.86]));
   r.bindings.push(binding('breath',r.vertices,()=>[0,-3]));
  }
  if(p.id==='mouth'){
   r.bindings.push(binding('mouthOpen',r.vertices,(x,y)=>[0,(y-18)*4]));
   r.bindings.push(binding('breath',r.vertices,()=>[0,-13.5]));
  }
  r.rigHash=await Document.computeRigHash(p,r,assets);rigs.push(r);
 }
 const hashes=rigs.map(r=>r.rigHash),f=n=>n/24,curves=[{parameterId:'eyeOpen',keys:[{t:0,value:1},{t:f(20),value:1},{t:f(22),value:0},{t:f(23),value:0},{t:f(26),value:1},{t:2,value:1}]},{parameterId:'breath',keys:[0,.25,.5,.75,1,1.25,1.5,1.75,2].map(t=>({t,value:round((1-Math.cos(Math.PI*t))/2)}))}];
 const request={mode:'txt2img',prompt:'',negative:'',seed:0,steps:1,width:640,height:640,cfg:1,denoise:1,halo:32,feather:4,cache:true,roi:false,preview:true,preview_interval:.2,sampler:'euler',scheduler:'normal'};
 const project={version:2,id:'pankeki-original-pancake-demo',canvas:{width:640,height:640,colorSpace:'srgb',alpha:'straight'},brief,assets,candidates:[{id:'pancake-source',createdAt:'2026-10-20T00:00:00Z',label:'직접 제작 팬케이크 기본 원본',assetId:byName.source.id,brief,request,parentId:null,metrics:{},kind:'upload'}],selectionHistory:[],sourceCandidateId:'pancake-source',backgroundAssetId:byName.background.id,parts,rigs,parameters:[{id:'eyeOpen',min:0,max:1,default:1,value:1},{id:'mouthOpen',min:0,max:1,default:0,value:0},{id:'breath',min:0,max:1,default:0,value:0}],presets:[{id:'neutral',values:{eyeOpen:1,mouthOpen:0,breath:0},rigHashes:hashes},{id:'cheerful',values:{eyeOpen:1,mouthOpen:.7,breath:.3},rigHashes:hashes}],motions:[{id:'blink-breath',duration:2,fps:24,curves,rigHashes:hashes},{id:'speaking-example',duration:2,fps:24,curves:[...curves,{parameterId:'mouthOpen',keys:[[0,0],[4,.6],[8,.25],[12,.8],[17,.1],[20,.45],[24,0],[30,0],[34,.7],[38,.3],[42,.55],[46,0],[48,0]].map(([n,value])=>({t:f(n),value}))}],rigHashes:hashes}],selection:{activeCandidateId:'pancake-source',compareCandidateIds:[],partId:'eyes'}};
 for(const preset of project.presets)preset.label={neutral:'편안한 기본 표정',cheerful:'반가운 인사'}[preset.id];
 for(const motion of project.motions)motion.label={'blink-breath':'눈 깜빡임과 호흡','speaking-example':'인사하는 입 움직임'}[motion.id];
 const serialized=JSON.stringify(project,null,2);fs.writeFileSync(path.join(dir,'project.json'),serialized);
 const provenance={title:'Pankeki original pancake motion demo',created:'2026-10-20',creator:'Original vector artwork authored by Codex for the Pankeki project',license:'CC0-1.0 (artwork only; application modules retain their licenses)',method:'Manually authored SVG shapes and existing Chrome Canvas rasterization. No Image Gen, external assets, downloaded model, inference, prerecorded animation, or rectangular stand-in fixture.',sources:['source-design.svg','background.svg','body.svg','eyes.svg','mouth.svg','render-assets.cjs','make-project.cjs'],manualPreparation:['Body contains syrup, butter, cheeks and limbs but no eyes or mouth.','Eyes and mouth are separate RGBA PNG materials. Background is a separately drawn clean breakfast nook.','Source is composed from actual PNG layers at the default pose; it is reference-only and is not used as an overdraw background.','Eye closed key compresses to 6.16px height, never zero-area. Mouth interior uses an ordinary 68x36 material-size grid, a normal part scaleY of 8/36, and valid keys that produce 8px default and 40px open height.','Breath uses 1.8% horizontal and 2.5% vertical body displacement; eye and mouth layers have matching small vertical displacement.','Mesh/keyforms/parents/curves are manually prepared and use the same document parser, controller, renderer and exporter as user PNG parts.'],defaultComposition:[{asset:'background.png',rect:[0,0,640,640]},{asset:'body.png',rect:[100,125,440,410]},{asset:'eyes.png',rect:[240,319,160,44]},{asset:'mouth.png',rect:[286,369,68,8]}],assetFiles:Object.fromEntries(Object.entries(byName).map(([name,a])=>[name+'.png',{sha256:a.id.slice(7),width:a.width,height:a.height,mime:a.mime}])),projectSha256:sha(Buffer.from(serialized)),sourceInvariant:'Original PNG bytes and UV/topology are never rewritten by parameters. The app validates references, geometry and hashes before accepting poses.'};
 fs.writeFileSync(path.join(dir,'provenance.json'),JSON.stringify(provenance,null,2));
 console.log(JSON.stringify({project:'project.json',bytes:Buffer.byteLength(serialized),assets:assets.length,parts:parts.length,rigs:rigs.length,motions:project.motions.length,sha256:provenance.projectSha256}));
})();

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../web/src/character-renderer.js');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/handoffs/fixtures/character-document-v2.fixture.json'), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
function scene() {
  const d = clone(fixture.document);
  d.sourceAssetId = d.candidates.find(c => c.id === d.sourceCandidateId).assetId;
  return d;
}
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-9, `${a} != ${b}`);
function draw(pose,id) { return pose.draws.find(d => d.partId === id); }
function blocked(pose,id,reason) { assert.ok(pose.blockedParts.some(p => p.partId === id && p.reason === reason), `${id}: ${reason}`); }
function singleTriangle() {
  const d=scene();d.parts=d.parts.slice(0,1);d.parts[0].transform=[1,0,0,1,0,0];
  d.rigs=[{...d.rigs[0],vertices:[0,0,10,0,0,10],uv:[0,0,1,0,0,1],triangles:[0,1,2],bindings:[]}];
  return d;
}
test('grid_and_intermediate_keyform_are_real_geometry', () => {
  const g=R.createGrid(8,6);
  assert.equal(g.vertices.length/2,16);assert.equal(g.triangles.length/3,18);
  assert.deepEqual(g.vertices.slice(0,4),[0,0,8/3,0]);assert.deepEqual(g.vertices.slice(-2),[8,6]);
  assert.ok(g.uv.every(v=>v>=0&&v<=1));assert.deepEqual(g.uv.slice(-2),[1,1]);
  const d=scene(), before=JSON.stringify(d),p=R.evaluatePose(d,{eyeOpen:.5,mouthOpen:.5,breath:.5});
  assert.deepEqual(p.blockedParts,[]);
  near(draw(p,'body').verticesDocument[0],11.9);near(draw(p,'body').verticesDocument[1],19.9);
  near(draw(p,'eye').verticesDocument[0],12);near(draw(p,'eye').verticesDocument[1],8.95);
  near(draw(p,'mouth').verticesDocument[1],13.5);
  near(draw(R.evaluatePose(d,{eyeOpen:.75}),'eye').verticesDocument[1],7.975);
  for(const item of p.draws) {
    const rig=d.rigs.find(r=>r.partId===item.partId);
    assert.deepEqual(item.uv,rig.uv);assert.deepEqual(item.triangles,rig.triangles);
    assert.notStrictEqual(item.uv,rig.uv);
  }
  assert.equal(JSON.stringify(d),before);
});
test('combined_pose_parent_and_invalid_geometry', () => {
  const d=scene();d.parts[0].transform=[2,0,0,3,5,7];d.parts[0].opacity=.5;
  d.parts[1].transform=[1,.5,.25,1,2,4];d.parts[1].opacity=.4;
  const p=R.evaluatePose(d,{eyeOpen:.5,breath:1});
  near(draw(p,'eye').verticesDocument[0],9.975);near(draw(p,'eye').verticesDocument[1],24.85);
  near(draw(p,'eye').opacity,.2);
  d.parts[0].visible=false;assert.deepEqual(R.evaluatePose(d,{}).draws,[]);
  const c=singleTriangle();
  const deltas=[0,0,-6,0,0,0];
  c.rigs[0].bindings=['breath','mouthOpen'].map(parameterId=>({parameterId,keys:[{at:0,deltas:[0,0,0,0,0,0]},{at:1,deltas}]}));
  assert.equal(R.evaluatePose(c,{breath:1,mouthOpen:0}).blockedParts.length,0);
  near(draw(R.evaluatePose(c,{breath:.5,mouthOpen:.5}),'body').verticesDocument[2],4);
  blocked(R.evaluatePose(c,{breath:1,mouthOpen:1}),'body','invalid_geometry');
  c.rigs[0].bindings=[{parameterId:'breath',keys:[{at:0,deltas:[0,0,0,0,0,0]},{at:1,deltas:[0,0,0,0,0,-9.999999]}]}];
  blocked(R.evaluatePose(c,{breath:1}),'body','invalid_geometry');
  const small=singleTriangle();small.parts[0].transform=[.0001,0,0,.0001,0,0];
  blocked(R.evaluatePose(small,{}),'body','invalid_geometry');
});
test('prepared_transparent_scene_is_allowed_but_original_overlay_is_blocked', () => {
  const d=scene();d.backgroundAssetId=null;
  assert.equal(R.evaluatePose(d,{}).draws.length,3);
  d.parts[1].backgroundReady=false;
  const p=R.evaluatePose(d,{});assert.equal(p.draws.length,0);blocked(p,'eye','background_not_ready');
  const empty=scene();empty.parts=[];empty.rigs=[];empty.backgroundAssetId=null;
  assert.ok(R.evaluatePose(empty,{}).blockedParts.length>0);
});
test('source_material_stale_and_default_delta_are_blocked', () => {
  const d=scene();d.sourceAssetId='different-source';
  const p=R.evaluatePose(d,{});assert.equal(p.draws.length,0);
  for(const part of d.parts) blocked(p,part.id,'source_mismatch');
  const stale=scene();stale.rigs[1].status='stale';blocked(R.evaluatePose(stale,{}),'eye','rig_stale');
  const material=scene();material.parts[1].materialAssetId='replaced';blocked(R.evaluatePose(material,{}),'eye','material_mismatch');
  const base=scene();base.rigs[1].bindings[0].keys[2].deltas[0]=.1;
  blocked(R.evaluatePose(base,{}),'eye','invalid_rig');
  for(const value of [NaN,Infinity,-.01,1.01]) assert.throws(()=>R.evaluatePose(scene(),{eyeOpen:value}),e=>e.code==='parameter_out_of_range');
  assert.throws(()=>R.createGrid(8,8,{columns:17,rows:17}));
  assert.throws(()=>R.createGrid(8,8,{columns:1}));
});
const blink={id:'blink',duration:2,fps:24,curves:[{parameterId:'eyeOpen',keys:[{t:0,value:1},{t:.85,value:1},{t:.95,value:0},{t:1.05,value:1},{t:2,value:1}]}]};
test('curves_are_deterministic', () => {
  const before=JSON.stringify(blink);
  assert.equal(R.sampleMotion(blink,.95).eyeOpen,0);near(R.sampleMotion(blink,.9).eyeOpen,.5);
  assert.deepEqual(R.sampleMotion(blink,2,{loop:true}),R.sampleMotion(blink,0));
  near(R.sampleMotion(blink,2000.9,{loop:true}).eyeOpen,.5);
  assert.equal(R.sampleMotion(blink,-1).eyeOpen,1);assert.equal(R.sampleMotion(blink,8).eyeOpen,1);
  assert.equal(Object.hasOwn(R.sampleMotion(blink,1),'mouthOpen'),false);
  assert.throws(()=>R.sampleMotion(blink,NaN));assert.throws(()=>R.sampleMotion(blink,-1,{loop:true}));
  const bad=clone(blink);bad.curves[0].keys[1].t=0;assert.throws(()=>R.sampleMotion(bad,1));
  const open=clone(blink);open.curves[0].keys.at(-1).value=0;
  assert.throws(()=>R.sampleMotion(open,1,{loop:true}));assert.equal(R.sampleMotion(open,2).eyeOpen,0);
  assert.equal(JSON.stringify(blink),before);
});

// This records the Canvas boundary; it is deliberately not a pixel renderer.
function canvasProbe(width=32,height=32) {
  const calls=[],stack=[];
  const ctx={matrix:[3,0,0,3,7,8],globalAlpha:.17,globalCompositeOperation:'xor',filter:'blur(2px)',shadowBlur:3,shadowOffsetX:2,shadowOffsetY:2,shadowColor:'#000',path:[],
    save(){stack.push({matrix:this.matrix.slice(),globalAlpha:this.globalAlpha,globalCompositeOperation:this.globalCompositeOperation,filter:this.filter,shadowBlur:this.shadowBlur,shadowOffsetX:this.shadowOffsetX,shadowOffsetY:this.shadowOffsetY,shadowColor:this.shadowColor,path:this.path.slice()});},
    restore(){Object.assign(this,stack.pop());},
    setTransform(...matrix){this.matrix=matrix;},
    clearRect(...args){calls.push({op:'clear',args,matrix:this.matrix.slice()});},
    beginPath(){this.path=[];},moveTo(x,y){this.path.push(x,y);},lineTo(x,y){this.path.push(x,y);},closePath(){},clip(){},
    drawImage(image,...args){calls.push({op:'image',image,args,matrix:this.matrix.slice(),path:this.path.slice(),alpha:this.globalAlpha,composite:this.globalCompositeOperation,filter:this.filter,shadowBlur:this.shadowBlur});}
  };
  return {width,height,calls,ctx,getContext(kind){assert.equal(kind,'2d');return ctx;}};
}
function decoded(d) {
  return new Map(d.assets.map(a=>[a.id,{name:a.id,width:a.width,height:a.height,complete:true}]));
}
test('draw_order_hidden_parent_and_missing_asset', () => {
  assert.equal(typeof R.drawPose,'function');
  const d=scene();d.parts[0].order=10;d.parts[1].order=-2;d.parts[2].order=5;
  d.parts[0].opacity=.5;d.parts[1].opacity=.4;
  const c=canvasProbe(),before=JSON.stringify(d),result=R.drawPose(c,R.evaluatePose(d,{}),decoded(d));
  assert.deepEqual(result,{width:32,height:32,drawnPartIds:['eye','mouth','body']});
  const images=c.calls.filter(x=>x.op==='image');assert.equal(images.length,4,'Affine parts must be composited once, including their opacity');
  assert.equal(images[0].image.name,d.backgroundAssetId);assert.equal(images[0].alpha,1);
  near(images[1].alpha,.2);near(images[2].alpha,.5);near(images[3].alpha,.5);
  assert.ok(images.every(x=>x.composite==='source-over'));
  assert.ok(images.every(x=>x.filter==='none'&&x.shadowBlur===0));
  assert.deepEqual(c.calls[0],{op:'clear',args:[0,0,32,32],matrix:[1,0,0,1,0,0]});
  assert.deepEqual(c.ctx.matrix,[3,0,0,3,7,8]);near(c.ctx.globalAlpha,.17);
  assert.equal(c.ctx.globalCompositeOperation,'xor');assert.equal(JSON.stringify(d),before);
  assert.equal(c.ctx.filter,'blur(2px)');assert.equal(c.ctx.shadowBlur,3);
  d.parts[0].visible=false;
  const hidden=canvasProbe();assert.deepEqual(R.drawPose(hidden,R.evaluatePose(d,{}),decoded(d)).drawnPartIds,[]);
  assert.equal(hidden.calls.filter(x=>x.op==='image').length,1);
});
test('invalid_pose_or_asset_does_not_clear_last_valid_canvas', () => {
  const d=scene(),pose=R.evaluatePose(d,{}),assets=decoded(d);
  assets.delete(d.parts[0].materialAssetId);
  const missing=canvasProbe();assert.throws(()=>R.drawPose(missing,pose,assets),e=>e.code==='missing_asset');assert.deepEqual(missing.calls,[]);
  const bad=clone(pose);bad.draws[1].verticesDocument[0]=NaN;
  const geometry=canvasProbe();assert.throws(()=>R.drawPose(geometry,bad,decoded(d)),e=>e.code==='invalid_geometry');assert.deepEqual(geometry.calls,[]);
  const blockedCanvas=canvasProbe();d.rigs[1].status='stale';
  assert.throws(()=>R.drawPose(blockedCanvas,R.evaluatePose(d,{}),decoded(d)),e=>e.code==='blocked_pose');assert.deepEqual(blockedCanvas.calls,[]);
});
test('triangle_uv_affine_maps_to_document_points_without_pixel_claims', () => {
  const d=scene();d.parts=d.parts.slice(0,1);d.rigs=d.rigs.slice(0,1);d.parts[0].transform=[2,.5,.25,1.5,3,2];
  d.backgroundAssetId=null;const c=canvasProbe(),p=R.evaluatePose(d,{});
  R.drawPose(c,p,decoded(d));const calls=c.calls.filter(x=>x.op==='image');assert.equal(calls.length,1);
  const v=p.draws[0].verticesDocument,uv=p.draws[0].uv,tri=p.draws[0].triangles;
  assert.deepEqual(v,[3,2,19,6,21,18,5,14]);
  for(let i=0;i<2;i++) for(let j=0;j<3;j++) {
    const index=tri[3*i+j],m=calls[0].matrix,x=uv[2*index]*8,y=uv[2*index+1]*8;
    near(m[0]*x+m[2]*y+m[4],v[2*index]);near(m[1]*x+m[3]*y+m[5],v[2*index+1]);
  }
  assert.deepEqual(calls[0].matrix,[2,.5,.25,1.5,3,2]);
});
test.todo('rgba_edges_and_three_parameter_positions: T9 browser must verify real decoded RGBA pixels, midpoint images, unchanged bytes and shared triangle seams');

test('real_browser_fractional_rotated_and_nonlinear_alpha_seams', {skip:process.env.PANKEKI_RENDERER_PIXELS!=='1'}, async t=>{
  const {chromium}=require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const source=fs.readFileSync(path.join(__dirname,'../web/src/character-renderer.js'),'utf8');
  const demoFile=path.join(process.env.PANKEKI_DEMO_ROOT||'D:/Pankeki','web/assets/motion-demo/project.json');
  const demo=JSON.parse(fs.readFileSync(demoFile,'utf8'));
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-background-networking']});
  try {
    const page=await browser.newPage();await page.addScriptTag({content:source});
    const result=await page.evaluate(async demo=>{
      const R=globalThis.PankekiRenderer,rows=[],captures=[];
      const make=(w=96,h=96)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
      const rgba=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      const image=async c=>{const i=new Image();i.src=c.toDataURL('image/png');await i.decode();return i;};
      const texture=make(),ctx=texture.getContext('2d'),data=ctx.createImageData(96,96);
      for(let y=0;y<96;y++)for(let x=0;x<96;x++){
        const n=(y*96+x)*4;data.data.set([239,80,40,128],n);
      }
      ctx.putImageData(data,0,0);const half=await image(texture),assets=new Map([['half',half]]);
      function pose(m,nonlinear=false,opacity=1){
        const g=R.createGrid(96,96);const v=g.vertices.map((n,i)=>i%2?m[1]*g.vertices[i-1]+m[3]*n+m[5]:m[0]*n+m[2]*g.vertices[i+1]+m[4]);
        if(nonlinear){v[10]+=4.25;v[11]-=2.5;v[20]-=3.5;v[21]+=2.75;}
        return {backgroundAssetId:null,draws:[{partId:'part',assetId:'half',verticesDocument:v,uv:g.uv,triangles:g.triangles,opacity,order:0}],blockedParts:[]};
      }
      const configs=[['identity',[1,0,0,1,0,0]],['fractional',[1,0,0,1,.375,.625]],['rotated',[.72,.16,-.16,.72,21,7]],['sheared',[.7,.11,.17,.69,6.25,8.5]]];
      for(const [name,m]of configs)for(const opacity of [1,.4]){
        const actual=make(),expected=make(),ec=expected.getContext('2d');
        R.drawPose(actual,pose(m,false,opacity),assets);ec.setTransform(...m);ec.globalAlpha=opacity;ec.drawImage(half,0,0);
        const a=rgba(actual),b=rgba(expected);let differences=0,max=0;
        for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d)differences++;max=Math.max(max,d);}
        rows.push({name,opacity,differentChannels:differences,maxChannelError:max,pass:differences===0});
        if(name==='rotated'&&opacity===1)captures.push({name:'rotated',actual:actual.toDataURL(),expected:expected.toDataURL()});
      }
      // A constant half-alpha texture has an independent flat-color interior
      // oracle even under a genuinely non-affine interior mesh deformation.
      for(const [name,m]of configs.slice(1))for(const opacity of [1,.4]){
        const actual=make(),p=pose(m,true,opacity);R.drawPose(actual,p,assets);
        const a=rgba(actual),det=m[0]*m[3]-m[1]*m[2],reference=make(),rc=reference.getContext('2d');rc.globalAlpha=opacity;rc.drawImage(half,0,0);const want=Array.from(rgba(reference).slice(0,4));
        let differences=0,maxAlpha=0,maxRGB=0,maxPremultipliedRGB=0,interior=0;
        for(let y=0;y<96;y++)for(let x=0;x<96;x++){
          const dx=x+.5-m[4],dy=y+.5-m[5],u=(m[3]*dx-m[2]*dy)/det,v=(-m[1]*dx+m[0]*dy)/det;
          if(u<4||v<4||u>92||v>92)continue;interior++;const i=(y*96+x)*4;
          const da=Math.abs(a[i+3]-want[3]);maxAlpha=Math.max(maxAlpha,da);if(da>1)differences++;
          for(let k=0;k<3;k++){
            maxRGB=Math.max(maxRGB,Math.abs(a[i+k]-want[k]));
            maxPremultipliedRGB=Math.max(maxPremultipliedRGB,Math.abs(Math.round(a[i+k]*a[i+3]/255)-Math.round(want[k]*want[3]/255)));
          }
        }
        rows.push({name:'nonlinear-'+name,opacity,interiorPixels:interior,alphaErrorsOver1:differences,maxAlphaError:maxAlpha,maxRGBError:maxRGB,maxPremultipliedRGBError:maxPremultipliedRGB,pass:differences===0&&maxPremultipliedRGB<=1});
        if(name==='rotated'&&opacity===1)captures.push({name:'nonlinear-rotated',actual:actual.toDataURL()});
      }
      // Real PNG default composition must be exactly the authored source.
      const decoded=new Map();for(const asset of demo.assets){const i=new Image();i.src=asset.data;await i.decode();decoded.set(asset.id,i);}
      const s={canvas:demo.canvas,sourceAssetId:demo.candidates.find(c=>c.id===demo.sourceCandidateId).assetId,backgroundAssetId:demo.backgroundAssetId,parts:demo.parts,rigs:demo.rigs,parameters:demo.parameters};
      const actual=make(640,640),expected=make(640,640);R.drawPose(actual,R.evaluatePose(s,{eyeOpen:1,mouthOpen:0,breath:0}),decoded);
      expected.getContext('2d').drawImage(decoded.get(s.sourceAssetId),0,0);const a=rgba(actual),b=rgba(expected);let diff=0,max=0;
      for(let i=0;i<a.length;i++){if(a[i]!==b[i])diff++;max=Math.max(max,Math.abs(a[i]-b[i]));}
      rows.push({name:'real-demo-default',differentChannels:diff,maxChannelError:max,pass:diff===0});
      captures.push({name:'real-demo-default',actual:actual.toDataURL(),expected:expected.toDataURL()});
      return {userAgent:navigator.userAgent,rows,captures};
    },demo);
    if(process.env.PANKEKI_PIXEL_ARTIFACTS){
      const folder=process.env.PANKEKI_PIXEL_ARTIFACTS;fs.mkdirSync(folder,{recursive:true});
      for(const capture of result.captures)for(const kind of ['actual','expected'])if(capture[kind])fs.writeFileSync(path.join(folder,capture.name+'-'+kind+'.png'),Buffer.from(capture[kind].split(',')[1],'base64'));
      fs.writeFileSync(path.join(folder,'browser-regression.json'),JSON.stringify({...result,captures:result.captures.map(({name})=>({name}))},null,2));
    }
    t.diagnostic(JSON.stringify(result.rows));assert.deepEqual(result.rows.filter(r=>!r.pass),[]);
  }finally{await browser.close();}
});

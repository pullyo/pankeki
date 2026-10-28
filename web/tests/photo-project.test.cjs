'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const D=require('../src/profiles.js');
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=';
const now='2026-10-26T12:00:00.000Z';
const source=()=>({id:'source',createdAt:now,label:'원본',image:PNG,kind:'upload',brief:D.sanitizeBrief({}),request:{mode:'txt2img',prompt:''},parentId:null,metrics:{}});
const derived=()=>({...source(),id:'resize',kind:'derived',label:'크기 조정',parentId:'source',request:null,derivation:{operation:'resize',sourceId:'source',sourceSha256:'a'.repeat(64),inputWidth:1,inputHeight:1,outputWidth:2,outputHeight:2,algorithm:'pillow-lanczos',algorithmVersion:'1',parameters:{width:2,height:2,keepAspect:true}}});
test('derived PNG and coordinate comments survive every project reconstruction and import',()=>{
 const a=source();a.annotations=[{id:'note',x:.25,y:.75,text:'목도리를 확인해요.',createdAt:now}];
 const b=derived();let p=D.createProject(a.brief,[a,b],[]);
 p=D.createProject(p.brief,p.versions,[{candidateId:'resize',action:'view',at:now}]);
 const restored=D.parseProject(JSON.stringify(p));
 assert.equal(restored.versions[0].image,PNG);assert.deepEqual(restored.versions[0].annotations,a.annotations);
 assert.equal(restored.versions[1].request,null);assert.equal(restored.versions[1].kind,'derived');assert.deepEqual(restored.versions[1].derivation,b.derivation);
});
test('legacy upload/generated candidates stay compatible and null is never a generated recipe',()=>{
 const a=source();const b={...source(),id:'generated',kind:'generated'};
 assert.equal(D.parseProject(JSON.stringify(D.createProject(a.brief,[a,b],[]))).versions.length,2);
 assert.throws(()=>D.createProject(a.brief,[{...b,request:null}],[]));
});
test('derived provenance cannot point at another parent or forge model execution',()=>{
 for(const change of [b=>b.derivation.sourceId='wrong',b=>b.parentId=null,b=>b.derivation.outputWidth=0,b=>b.derivation.sourceSha256='file:///secret',b=>b.derivation.operation='shell',b=>b.derivation.parameters={calls:Infinity},b=>b.request={mode:'txt2img',prompt:'pretend'}]){
  const b=derived();change(b);assert.throws(()=>D.createProject(source().brief,[source(),b],[]));
 }
});
test('annotations reject invalid natural coordinates, accessors, unknown fields and oversize text',()=>{
 for(const note of [{id:'n',x:-.1,y:0,text:'a',createdAt:now},{id:'n',x:0,y:Infinity,text:'a',createdAt:now},{id:'n',x:0,y:0,text:'a'.repeat(2001),createdAt:now},{id:'n',x:0,y:0,text:'a',createdAt:now,path:'/tmp/x'}]){
  const a=source();a.annotations=[note];assert.throws(()=>D.createProject(a.brief,[a],[]));
 }
 const a=source();a.annotations=Array.from({length:101},(_,i)=>({id:'n'+i,x:0,y:0,text:'a',createdAt:now}));assert.throws(()=>D.createProject(a.brief,[a],[]));
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const Design=require('../src/profiles.js');
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=';
const sha=createHash('sha256').update(Buffer.from(image.split(',')[1],'base64')).digest('hex');
const execution=()=>({schema:1,traceId:'turn_123',jobId:'a'.repeat(32),resultSha256:sha,runRef:'runs/'+'a'.repeat(32)});
const candidate=()=>({id:'c1',createdAt:'2026-10-28T00:00:00.000Z',label:'후보',image,brief:Design.sanitizeBrief({}),request:{mode:'txt2img',seed:1},parentId:null,metrics:{},execution:execution()});
test('optional execution survives create export import while legacy document stays unchanged',()=>{
 const entry=candidate(),saved=Design.createProject(entry.brief,[entry],[]),opened=Design.parseProject(JSON.stringify(saved));
 assert.deepEqual(opened.versions[0].execution,execution());entry.execution.traceId='changed';assert.equal(saved.versions[0].execution.traceId,'turn_123');
 const old=candidate();delete old.execution;assert.equal(Object.hasOwn(Design.parseProject(Design.createProject(old.brief,[old],[])).versions[0],'execution'),false);
});
test('execution rejects altered result bytes, unsafe run references and unexpected native fields',()=>{
 for(const patch of [{schema:2},{traceId:'/Users/private'},{jobId:'b'.repeat(31)},{resultSha256:'0'.repeat(64)},{runRef:'/Users/secret/result.png'},{runRef:'runs/../secret'},{runRef:'runs/'+'b'.repeat(32)},{recipe:'/private/recipe.json'}]){
  const entry=candidate();Object.assign(entry.execution,patch);assert.throws(()=>Design.createProject(entry.brief,[entry],[]),/execution|SHA|run|trace|job|Unsupported/i);
 }
});

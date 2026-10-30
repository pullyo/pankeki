'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const Design=require('../src/profiles.js'),fixture=require('../../tests/fixtures/system-capabilities.json');
const clone=()=>JSON.parse(JSON.stringify(fixture));
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
function revise(v){delete v.revision;v.revision=createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');return v;}
module.exports={clone,revise};
test('capability model choices derive from registry matrix and readiness rather than frontend ID lists',()=>{
 const data=clone(),base=data.models.find(v=>v.id==='sdxl-base');base.operations=base.operations.filter(id=>id!=='regenerate');data.operations.find(v=>v.id==='regenerate').model_ids=['sd-turbo','sdxl-inpaint-v01'];
 const value=Design.validateCapabilities(revise(data));
 assert.deepEqual(Design.capabilityModels(value,'regenerate').map(v=>v.id),['sd-turbo','sdxl-inpaint-v01']);
 assert.equal(Design.capabilityModels(value,'generate').find(v=>v.id==='sd-turbo').available,false);
 const op=data.operations.find(v=>v.id==='generate');op.ready=false;op.reason='fixture Comfy unavailable';const blocked=Design.validateCapabilities(revise(data));
 assert.equal(Design.capabilityModels(blocked,'generate').find(v=>v.id==='sdxl-base').available,false);
 assert.match(Design.capabilityModels(blocked,'generate')[0].reason,/fixture Comfy/);
});
test('capability validator rejects changed content, unknown schema and unknown operation',()=>{
 const changed=clone();changed.operations[0].ready=false;assert.throws(()=>Design.validateCapabilities(changed),/revision/);
 assert.throws(()=>Design.validateCapabilities({...clone(),schema:2}),/schema|revision/);
 const unknown=clone();unknown.operations.push({id:'shell',lane:'cpu',ready:true,reason:null,model_ids:[],experimental:false});assert.throws(()=>Design.validateCapabilities(revise(unknown)),/operation|matrix/i);
});
test('legacy catalog fallback is explicit and cannot mark an unsupported operation ready',()=>{
 const data=Design.legacyCapabilities({default_model_id:'sdxl-base',models:[{id:'sdxl-base',label:'Base',available:true,defaults:fixture.models[0].defaults}],edit_models:[]});
 assert.equal(data.source,'legacy');assert.match(data.reason,/legacy/i);assert.equal(Design.capabilityOperation(data,'background-remove').ready,false);
 assert.equal(Design.capabilityModels(data,'generate')[0].available,true);
});

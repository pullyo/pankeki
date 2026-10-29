'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
let api = {};
try { api = require('../web/src/cubism-session.js'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
const session = () => ({format:'pankeki-cubism-session',version:1,runtimeType:'cubism',entryPath:'한글/model.model3.json',fileHashes:{'한글/model.model3.json':'a'.repeat(64),'한글/a.moc3':'b'.repeat(64)},sdk:{coreVersion:'test-fixture-only',coreHash:'c'.repeat(64),frameworkCommit:'d'.repeat(40),bundleHash:'e'.repeat(64)},mode:'inspection',parameterOverrides:{ParamAngleX:0.5},motion:{group:'Idle',index:0,loop:true},expression:null,effects:{blink:true,physics:false,pose:true},resumePolicy:'restart'});
const parse = raw => { assert.equal(typeof api.parseSession,'function','session parser must exist'); return api.parseSession(raw); };
test('roundtrip creates detached frozen reference session and survives a real file save/reopen', () => {
 const input=session(); const parsed=parse(input); input.parameterOverrides.ParamAngleX=99;
 assert.equal(parsed.parameterOverrides.ParamAngleX,0.5); assert.ok(Object.isFrozen(parsed.sdk));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pankeki-session-'));
 try { const file=path.join(dir,'session.json'); fs.writeFileSync(file,api.serializeSession(parsed)); assert.deepEqual(parse(fs.readFileSync(file,'utf8')),parsed); } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('rejects wrong format version and legacy character documents', () => {
 for(const patch of [{format:'pankeki'},{version:2},{runtimeType:'own-v3'},{resumePolicy:'seek'}]) assert.throws(()=>parse({...session(),...patch}),{code:'INVALID_SESSION'});
 assert.throws(()=>parse({version:2,parts:[]}),{code:'INVALID_SESSION'});
});
test('rejects assets absolute paths escaping paths and unknown state', () => {
 for(const patch of [{assets:[1]},{entryPath:'/tmp/a.model3.json'},{entryPath:'../a.model3.json'},{entryPath:'https://a/model.model3.json'},{entryPath:'a\\b.model3.json'},{entryPath:'a/%252e%252e/model.model3.json'}]) assert.throws(()=>parse({...session(),...patch}),{code:'INVALID_SESSION'});
 assert.throws(()=>parse({...session(),fileHashes:{'/tmp/a':'a'.repeat(64)}}),{code:'INVALID_SESSION'});
});
test('rejects missing entry hashes malformed provenance and unsafe keys', () => {
 for(const patch of [{fileHashes:{}},{sdk:{...session().sdk,coreHash:null}},{sdk:{...session().sdk,frameworkCommit:'unknown'}},{sdk:{...session().sdk,coreVersion:''}},{parameterOverrides:JSON.parse('{"__proto__":0}')}]) assert.throws(()=>parse({...session(),...patch}),{code:'INVALID_SESSION'});
});
test('rejects nonfinite parameters malformed motion effects and expression', () => {
 for(const patch of [{parameterOverrides:{A:NaN}},{parameterOverrides:{A:Infinity}},{motion:{group:'Idle',index:-1,loop:true}},{motion:{group:'Idle',index:0,loop:'yes'}},{effects:{blink:true,physics:false}},{expression:3},{mode:'auto'}]) assert.throws(()=>parse({...session(),...patch}),{code:'INVALID_SESSION'});
});
test('rejects malformed JSON and excessive nested input without leaking native parse errors', () => {
 for(const raw of ['{',null,[],JSON.stringify({...session(),parameterOverrides:{x:{nested:1}}})]) assert.throws(()=>parse(raw),{code:'INVALID_SESSION'});
});

test('canonical safe percent paths and case-preserving manifest suffixes roundtrip without URL interpretation',()=>{
 const raw={...session(),entryPath:'히어로/Model.MODEL3.JSON',fileHashes:{'히어로/Model.MODEL3.JSON':'a'.repeat(64),'히어로/100%hero.moc3':'b'.repeat(64),'히어로/literal%20name.bin':'c'.repeat(64)}};
 const parsed=parse(raw);assert.equal(parsed.entryPath,'히어로/Model.MODEL3.JSON');
 assert.deepEqual(Object.keys(parsed.fileHashes),['히어로/100%hero.moc3','히어로/Model.MODEL3.JSON','히어로/literal%20name.bin']);
 assert.deepEqual(parse(api.serializeSession(parsed)),parsed);
});
test('actual and nested encoded separators traversal and NUL remain invalid canonical session paths',()=>{
 for(const key of ['a/%2fhero.moc3','a/%5chero.moc3','a/%00hero.moc3','a/%2e%2e/hero.moc3','a/%252fhero.moc3','a/%25252e%25252e/hero.moc3','a/../hero.moc3']){
  assert.throws(()=>parse({...session(),fileHashes:{...session().fileHashes,[key]:'f'.repeat(64)}}),{code:'INVALID_SESSION'});
 }
});

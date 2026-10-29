'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Design=require('../../web/src/profiles.js'),tools=require('../pankeki-tools.cjs');
const fixture=require('../../tests/fixtures/system-capabilities.json');
const clone=()=>JSON.parse(JSON.stringify(fixture));
function changed(){const value=clone();value.models.find(v=>v.id==='sdxl-base').installed=false;value.operations.find(v=>v.id==='recompose').ready=false;value.operations.find(v=>v.id==='recompose').reason='fixture source decoder offline';value.revision=Design.capabilityRevision(value);return value;}
test('same validated capability snapshot derives shared tool enums and rejects unavailable execution before spawning MCP',async()=>{
 const caps=changed(),schemas=tools.createToolSchemas(caps);
 assert.deepEqual(schemas.pankeki_generate.inputSchema.properties.model_id.enum,['animagine-xl-4.0-opt']);
 assert.deepEqual(schemas.pankeki_edit.inputSchema.properties.operation.enum,['regenerate','recolor']);
 assert.deepEqual(schemas.pankeki_edit.inputSchema.properties.model_id.enum,['sdxl-inpaint-v01']);
 let spawns=0;const runner=tools.createToolRunner({projectRoot:path.resolve(__dirname,'../..'),paths:{},getCapabilities:async()=>caps,limits:{},emit(){},current:()=>true,spawnImpl(){spawns++;throw Error('must not spawn');}});
 await assert.rejects(runner.runTool({action:'generate'},'pankeki_generate',{prompt:'one image',model_id:'sdxl-base'}),/unavailable|capability/);
 await assert.rejects(runner.runTool({action:'edit'},'pankeki_edit',{operation:'recompose',model_id:'animagine-xl-4.0-opt'}),/fixture source decoder offline/);
 assert.equal(spawns,0);await runner.close();
});
test('capability reader authenticates backend and distinguishes old 404 from malformed new snapshots',async()=>{
 const urls=[],reader=tools.createCapabilityReader({origin:'http://127.0.0.1:9999',verifyBackend:async()=>true,fetchImpl:async url=>{urls.push(url);return url.endsWith('/capabilities')?new Response('{}',{status:404}):new Response(JSON.stringify({default_model_id:'sdxl-base',models:[{id:'sdxl-base',label:'Base',available:true,defaults:fixture.models[0].defaults}]}));}});
 assert.equal((await reader()).source,'legacy');assert.equal(urls.length,2);
 const denied=tools.createCapabilityReader({origin:'http://127.0.0.1:9999',verifyBackend:async()=>false,fetchImpl:async()=>{throw Error('not reached');}});await assert.rejects(denied(),/identity/);
 const corrupt=tools.createCapabilityReader({origin:'http://127.0.0.1:9999',verifyBackend:async()=>true,fetchImpl:async()=>new Response(JSON.stringify({...clone(),schema:2}))});await assert.rejects(corrupt(),/schema|revision/);
});

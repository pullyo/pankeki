'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const Design=require('../../web/src/profiles.js'),caps=()=>JSON.parse(JSON.stringify(require('../../tests/fixtures/system-capabilities.json')));
function setupFor(provider){const filename=path.join(__dirname,provider+'-bridge.test.cjs'),source=fs.readFileSync(filename,'utf8'),boundary=source.indexOf("\ntest('auto "),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;mod._compile(source.slice(0,boundary)+'\nmodule.exports={setup};',filename);return mod.exports.setup;}
for(const provider of ['codex','claude']){
 const setup=setupFor(provider),calls=t=>provider==='claude'?t.adapterCalls():t.received('mcp','tools/call').map(v=>v.params);
 test(provider+' actual dynamic DTO derives enums from server matrix and execution rejects its unavailable default',async()=>{
  const snapshot=caps();snapshot.models.find(v=>v.id==='sdxl-base').installed=false;snapshot.revision=Design.capabilityRevision(snapshot);
  const t=setup('generate',{getCapabilities:async()=>snapshot});try{
   await t.bridge.connect();let schemas;
   if(provider==='claude'){
    const directory=path.join(t.dataDir,'claude-work'),file=fs.readdirSync(directory).find(v=>/^mcp-.*\.json$/.test(v)),server=Object.values(JSON.parse(fs.readFileSync(path.join(directory,file),'utf8')).mcpServers)[0];
    const response=await fetch(server.url,{method:'POST',headers:{...server.headers,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:123,method:'tools/list'})});schemas=(await response.json()).result.tools;
   }
   await t.bridge.send({text:'[Pankeki action: generate]\nGENERATE',projectId:'p',requestId:'matrix-turn',context:{sourceRevision:'rev'}});await t.waitFor(v=>v.type==='turn-completed');
   if(provider==='codex')schemas=t.received('codex','thread/start')[0].params.dynamicTools;
   assert.deepEqual(schemas.find(v=>v.name==='pankeki_generate').inputSchema.properties.model_id.enum,['animagine-xl-4.0-opt']);
   assert.equal(calls(t).filter(v=>v.name==='pankeki_generate_image').length,0);
   assert(t.events.some(v=>v.type==='tool-completed'&&!v.payload.ok));
   const serialized=JSON.stringify(schemas);assert.doesNotMatch(serialized,/source_path|mask_path|trace_id|recipe|run_ref/);
  }finally{await t.bridge.close();}
 });
 test(provider+' private trace reaches MCP once and orphaned terminal job never retries or resolves a result',async()=>{
  const t=setup('terminal-orphaned',{timeouts:{jobPoll:1,jobWait:50,turn:1000}});try{
   await t.bridge.connect();await t.bridge.send({text:'[Pankeki action: generate]\nGENERATE',projectId:'p',requestId:'trace-orphan',context:{sourceRevision:'rev'}});
   const done=await t.waitFor(v=>v.type==='turn-completed');const submitted=calls(t).filter(v=>v.name==='pankeki_generate_image');
   assert.equal(submitted.length,1);assert.equal(submitted[0].arguments.trace_id,'trace-orphan');
   assert.equal(calls(t).filter(v=>v.name==='pankeki_get_result').length,0);assert.equal(done.payload.status,'failed');
   assert(t.events.some(v=>v.payload.jobStatus==='orphaned'));assert.equal(t.bridge.getResultDescriptor({requestId:'trace-orphan',projectId:'p',sourceRevision:'rev',jobId:'a'.repeat(32)}),null);
  }finally{await t.bridge.close();}
 });
}

for(const provider of ['codex','claude'])test(provider+' submitting is a live state until its single owned job succeeds',async()=>{
 const t=setupFor(provider)('terminal-submitting',{timeouts:{jobPoll:1,jobWait:0,turn:1000}}),calls=()=>provider==='claude'?t.adapterCalls():t.received('mcp','tools/call').map(v=>v.params);
 try{await t.bridge.connect();await t.bridge.send({text:'[Pankeki action: generate]\nGIVEUP',projectId:'p',requestId:'submit-turn',context:{sourceRevision:'rev'}});const end=await t.waitFor(v=>v.type==='turn-completed');assert.equal(end.payload.status,'completed');assert.equal(calls().filter(v=>v.name==='pankeki_generate_image').length,1);assert.equal(calls().filter(v=>v.name==='pankeki_get_result').length,1);assert(calls().filter(v=>v.name==='pankeki_get_job').length>=3);}finally{await t.bridge.close();}
});

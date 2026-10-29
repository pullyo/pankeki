'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createEditContextStore}=require('../edit-context.cjs');
// Header parsing is tested here; nativeImage's actual PNG decode is exercised by Electron smoke.
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==','base64');
const url=buffer=>'data:image/png;base64,'+buffer.toString('base64');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'pankeki context '));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,store:createEditContextStore({dataDir:root,decode:()=>({width:1,height:1})})};}
test('staging returns opaque IDs without exposing a path and closes only its own directory',async t=>{
  const {root,store}=fixture(t);fs.writeFileSync(path.join(root,'unrelated.txt'),'keep');
  const value=await store.prepare({projectId:'p1',sourceRevision:'source_mask_1',sourceDataUrl:url(png),maskDataUrl:url(png)});
  assert.equal(value.projectId,'p1');assert.ok(value.sourceId);assert.ok(value.maskId);assert.equal(JSON.stringify(value).includes(root),false);
  const resolved=store.resolve('p1',value);assert.equal(resolved.sourceId,value.sourceId);
  assert.equal(fs.readFileSync(store.resolveInput({projectId:'p1',sourceRevision:value.sourceRevision,id:value.sourceId})).equals(png),true);
  await store.close();assert.equal(fs.readFileSync(path.join(root,'unrelated.txt'),'utf8'),'keep');
});
test('mask-only snapshot change invalidates old IDs and cross-project resolution',async t=>{
  const {store}=fixture(t);
  const first=await store.prepare({projectId:'p1',sourceRevision:'same_source_mask_1',sourceDataUrl:url(png),maskDataUrl:url(png)});
  await store.prepare({projectId:'p1',sourceRevision:'same_source_mask_2',sourceDataUrl:url(png),maskDataUrl:url(png)});
  assert.throws(()=>store.resolve('p1',first),/stale-context/);
  assert.throws(()=>store.resolve('p2',first),/stale-context/);
});
test('request-bound context uses only opaque IDs remotely and rejects mismatched request lookup',async t=>{
  const {store}=fixture(t);const prepared=await store.prepare({projectId:'p1',sourceRevision:'s1',sourceDataUrl:url(png),maskDataUrl:url(png)});
  const context=store.bindRequest({requestId:'r1',projectId:'p1',context:prepared});
  assert.deepEqual(Object.keys(context).sort(),['contextId','sourceRevision']);
  assert.throws(()=>store.resolveEditContext({requestId:'r2',projectId:'p1',...context}),/stale-context/);
  const local=await store.resolveEditContext({requestId:'r1',projectId:'p1',...context});assert.ok(local.sourcePath.endsWith('.png'));assert.ok(local.maskPath.endsWith('.png'));
});
test('malformed, oversized, wrong-size and no-alpha masks cannot be staged',async t=>{
  const {store}=fixture(t);const base={projectId:'p1',sourceRevision:'s1',sourceDataUrl:url(png)};
  for(const sourceDataUrl of ['https://host/image.png','file:///tmp/a.png','data:image/png;base64,YQ=='])await assert.rejects(store.prepare({...base,sourceDataUrl}));
  const giant=Buffer.from(png);giant.writeUInt32BE(9000,16);await assert.rejects(store.prepare({...base,sourceDataUrl:url(giant)}),/png-limit/);
  const rgb=Buffer.from(png);rgb[25]=2;await assert.rejects(store.prepare({...base,maskDataUrl:url(rgb)}),/mask-alpha/);
  const wide=Buffer.from(png);wide.writeUInt32BE(2,16);await assert.rejects(store.prepare({...base,maskDataUrl:url(wide)}),/png-decode|mask-size/);
});

'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
test('preload exposes data-only events and unsubscribe removes its wrapped listener',()=>{
  let exposed, listener, removed;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../preload.cjs'),'utf8'),{
    require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(name,api)=>{assert.equal(name,'pankekiDesktop');exposed=api;}},
      ipcRenderer:{invoke:()=>Promise.resolve({}),on:(channel,fn)=>{listener=fn;},removeListener:(channel,fn)=>{removed=fn;}}};}
  });
  assert.deepEqual(Object.keys(exposed).sort(),['cancelMessage','connectCodex','getChatModelOptions','getStatus','onCodexEvent','prepareEditContext','resolveResult','selectProvider','sendMessage','setChatModel']);
  const received=[];const unsubscribe=exposed.onCodexEvent((...args)=>received.push(args));
  listener({sender:'privileged'},{type:'status'});assert.equal(received[0].length,1);assert.equal(received[0][0].type,'status');
  unsubscribe();assert.equal(removed,listener);
});

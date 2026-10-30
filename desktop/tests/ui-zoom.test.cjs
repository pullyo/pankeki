'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module');
// main.cjs requires electron at load; stub it so the pure zoom rule can be tested without a window.
const load=Module._load;Module._load=function(request,...rest){return request==='electron'?{app:{},BrowserWindow:class{},session:{},ipcMain:{},dialog:{},nativeImage:{}}:load.call(this,request,...rest);};
const {uiZoomFactor}=require('../main.cjs');Module._load=load;
test('reference size and smaller windows keep 1x zoom',()=>{
  for(const [w,h] of [[1672,941],[1360,920],[960,640],[2400,900]])assert.equal(uiZoomFactor(w,h),1,w+'x'+h);
});
test('larger windows scale by the tighter side, in 0.05 steps, capped at 1.6',()=>{
  assert.equal(uiZoomFactor(2460,1384),1.45);
  assert.equal(uiZoomFactor(2090,1300),1.25);
  assert.equal(uiZoomFactor(5120,2880),1.6);
});
test('invalid sizes fall back to 1x',()=>{for(const [w,h] of [[0,0],[NaN,900],[-1,-1]])assert.equal(uiZoomFactor(w,h),1);});

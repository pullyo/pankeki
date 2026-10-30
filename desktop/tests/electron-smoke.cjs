'use strict';
// Real Electron renderer/preload/CSP with an injected bridge and an app-owned HTTP fixture.
const {app,nativeImage}=require('electron');const fs=require('node:fs');const path=require('node:path');const http=require('node:http');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'output/desktop-codex-20261024/mac');
app.setPath('userData',path.join(out,'smoke-profile'));
const report={kind:'real-electron-mock-bridge',startedAt:new Date().toISOString(),checks:[],liveCodex:false,inference:false};
let server,editor,store,unconfirmedReported=0;
const timeout=setTimeout(()=>{report.error='smoke-timeout';finish(1);},45000);
async function finish(code){clearTimeout(timeout);if(editor)await editor.close().catch(()=>{});if(store)await store.close();if(server)server.close();fs.writeFileSync(path.join(out,'electron-smoke.json'),JSON.stringify(report,null,2)+'\n');app.exit(code);}
app.whenReady().then(async()=>{
  try {
    const {createEditorWindow}=require('../main.cjs');const {createEditContextStore}=require('../edit-context.cjs');
    const html=fs.readFileSync(path.join(root,'web/index.html'),'utf8');
    server=http.createServer((req,res)=>{
      if(req.url==='/'){res.setHeader('content-type','text/html; charset=utf-8');return res.end(html);}
      res.setHeader('content-type','application/json');
      if(req.url==='/api/health')return res.end(JSON.stringify({comfy:false,cache:{}}));
      if(req.url==='/api/models')return res.end(JSON.stringify({models:[],default_model_id:null}));
      res.statusCode=404;res.end('{}');
    });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+server.address().port;
    store=createEditContextStore({dataDir:path.join(out,'smoke-context'),decode:bytes=>{const image=nativeImage.createFromBuffer(bytes);return image.isEmpty()?null:image.getSize();}});
    editor=await createEditorWindow({origin,html,contexts:store,allowLiveSend:true,notifyUnconfirmedClose:async count=>{unconfirmedReported=count;},
      getAppStatus:()=>({version:'0.1.0',externalRuntimeRequired:true}),
      bridgeFactory:onEvent=>{let state='idle',closeAttempts=0;return {status:()=>({state,codexVersion:'mock',authMode:null,toolsReady:state==='ready',activeRequestId:null,lastError:null}),
        connect:async function(){state='ready';return this.status();},send:async value=>{onEvent({requestId:value.requestId,projectId:value.projectId,type:'message',payload:{text:'mock reply'}});onEvent({requestId:value.requestId,projectId:value.projectId,type:'turn-completed',payload:{status:'completed'}});return {requestId:value.requestId};},cancel:async()=>false,close:async()=>{if(++closeAttempts===1)throw Error('simulated-close-failure');return {unconfirmedSubmissions:2};}};}});
    const win=editor.window;
    report.security=win.webContents.getLastWebPreferences();
    assert.equal(report.security.nodeIntegration,false);assert.equal(report.security.contextIsolation,true);assert.equal(report.security.sandbox,true);
    report.checks.push('sandboxed-window');
    const snapshot=await win.webContents.executeJavaScript(`({api:Object.keys(window.pankekiDesktop).sort(),menus:[...document.querySelectorAll('.pk-navigation button')].map(x=>x.textContent.trim()),logo:document.querySelector('.pk-brand img')?.naturalWidth,hasNode:typeof require})`);
    assert.equal(snapshot.menus.length,11);assert.ok(snapshot.logo>0);assert.equal(snapshot.hasNode,'undefined');report.snapshot=snapshot;report.checks.push('logo-and-11-menus');
    await win.webContents.executeJavaScript(`window.pankekiDesktop.connectCodex()`);
    const result=await win.webContents.executeJavaScript(`new Promise(async (resolve,reject)=>{const received=[];let off=window.pankekiDesktop.onCodexEvent(event=>{received.push(event);if(event.type==='turn-completed'){off();resolve(received);}});try{await window.pankekiDesktop.sendMessage({text:'연결 시험',requestId:'smoke_1',projectId:'smoke_project',context:{sourceRevision:'source_mask_project_1'}});}catch(e){reject(e);}})`);
    assert.equal(result[0].context.sourceRevision,'source_mask_project_1');assert.equal(result[0].payload.text,'mock reply');report.checks.push('preload-mock-turn-revision');
    assert.equal(await win.webContents.executeJavaScript(`(async()=>{const url=URL.createObjectURL(new Blob(['local input'],{type:'text/plain'}));try{return await (await fetch(url)).text();}finally{URL.revokeObjectURL(url);}})()`),'local input');
    report.checks.push('local-blob-fetch-upload-path');
    const image=nativeImage.createFromBitmap(Buffer.from([255,255,255,128]),{width:1,height:1}).toDataURL();
    const staged=await win.webContents.executeJavaScript(`window.pankekiDesktop.prepareEditContext(${JSON.stringify({projectId:'smoke_project',sourceRevision:'new_mask_snapshot',sourceDataUrl:image,maskDataUrl:image})})`);
    assert.ok(staged.maskId);report.checks.push('native-png-context');
    const file=path.join(out,'다운로드 경로 시험','프로젝트 저장.json');
    const downloaded=new Promise((resolve,reject)=>win.webContents.session.once('will-download',(_event,item)=>{item.setSavePath(file);item.once('done',(_e,state)=>state==='completed'?resolve():reject(Error('download-'+state)));}));
    await win.webContents.executeJavaScript(`(()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['{"pankekiSmoke":true}'],{type:'application/json'}));a.download='프로젝트 저장.json';a.click();})()`);
    await downloaded;assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).pankekiSmoke,true);report.checks.push('blob-save-korean-space-path');
    const before=win.webContents.getURL();await win.webContents.executeJavaScript(`window.location.href='https://example.com/'`);await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(win.webContents.getURL(),before);report.checks.push('external-navigation-denied');
    await assert.rejects(editor.close(),/simulated-close-failure/);assert.equal(win.isDestroyed(),false);
    assert.equal((await win.webContents.executeJavaScript('window.pankekiDesktop.getStatus()')).codex.state,'ready');
    await editor.close();assert.equal(win.isDestroyed(),true);report.checks.push('close-failure-retains-window-and-retry');
    assert.equal(unconfirmedReported,2);report.checks.push('unconfirmed-cancel-warning');
    report.unverified=['native file picker','native save dialog interaction','user-visible appearance while Mac locked','real Codex auth/turn','actual generation/edit','final frontend freeze/build'];
    report.ok=true;await finish(0);
  }catch(error){report.error=String(error.message).slice(0,1200);await finish(1);}
});

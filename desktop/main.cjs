'use strict';
const {app,BrowserWindow,session,ipcMain,dialog,nativeImage}=require('electron');
const fs=require('node:fs');const path=require('node:path');const {randomUUID}=require('node:crypto');
const {isTrustedSender,makeCsp,allowRequest,createPermissionPolicy}=require('./security.cjs');
const {createIpcController}=require('./ipc.cjs');

function createConnectionLogger(file,io=fs){
  return message=>{
    const match=/^connect failed \(([a-z][a-z0-9-]{0,63})\):/.exec(String(message));
    if(!match)return;
    const row=JSON.stringify({at:new Date().toISOString(),stage:'connect',code:match[1]})+'\n';
    try{
      let size=0;try{size=io.statSync(file).size;}catch(error){if(error.code!=='ENOENT')return;}
      if(size+Buffer.byteLength(row)>32768)return;
      io.appendFileSync(file,row,{mode:0o600});
    }catch{}
  };
}

async function createEditorWindow({origin,html,projectRoot,contexts,results,resultsFactory,bridgeFactory,getAppStatus,allowLiveSend=false,verifyBackend=async()=>true,mapBridgeMessage,notifyUnconfirmedClose,
  partition='persist:pankeki-editor'}={}) {
  const isolated=session.fromPartition(partition);
  // Windows shows the window icon in the taskbar; macOS takes it from the app bundle.
  const windowIcon=typeof process!=='undefined'&&process.platform==='win32'?path.join(__dirname,'assets','pankeki-256.png'):undefined;
  const win=new BrowserWindow({title:'Pankeki',width:1360,height:920,minWidth:960,minHeight:640,backgroundColor:'#f6f2ec',...(windowIcon&&fs.existsSync(windowIcon)?{icon:windowIcon}:{}),
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,session:isolated,spellcheck:false}});
  let closing=false,controller;
  const pickVideoScene=projectRoot?require('./video-scene-picker.cjs').createVideoScenePicker({projectRoot,
    chooseFile:()=>dialog.showOpenDialog(win,{title:'Blender 구도 파일 선택',buttonLabel:'이 구도 사용',filters:[{name:'Blender 구도',extensions:['blend']}],properties:['openFile','dontAddToRecent']})}):undefined;
  const bridge=bridgeFactory(event=>controller?.acceptEvent(event));
  const sendEnabled=typeof allowLiveSend==='function'?allowLiveSend(bridge):allowLiveSend;
  controller=createIpcController({bridge,contexts,results:resultsFactory?resultsFactory(bridge):results,pickVideoScene,origin,allowLiveSend:sendEnabled,mapBridgeMessage,getAppStatus,
    isTrusted:event=>isTrustedSender(event,win.webContents,origin),
    sendEvent:event=>{if(!win.isDestroyed()&&isTrustedSender({sender:win.webContents,senderFrame:win.webContents.mainFrame},win.webContents,origin))win.webContents.send('pankeki:codex-event',event);}});
  const csp=makeCsp(html,origin);
  isolated.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!allowRequest(details.url,origin)}));
  isolated.webRequest.onHeadersReceived((details,callback)=>callback({responseHeaders:{...details.responseHeaders,'Content-Security-Policy':[csp]}}));
  const permissions=createPermissionPolicy(win.webContents,origin);
  isolated.setPermissionRequestHandler(permissions.request);
  isolated.setPermissionCheckHandler(permissions.check);
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{
    try{const target=new URL(url);if(target.origin!==origin||target.pathname!=='/'||target.search)event.preventDefault();}catch{event.preventDefault();}
  });
  win.webContents.on('will-redirect',event=>event.preventDefault());
  const download=(event,item,contents)=>{
    if(contents!==win.webContents||item.getInitiatorOrigin()!==origin||!allowRequest(item.getURL(),origin)){event.preventDefault();return;}
    item.setSaveDialogOptions({title:'Pankeki 파일 저장',defaultPath:path.join(app.getPath('downloads'),path.basename(item.getFilename()||'Pankeki-export')),
      properties:['createDirectory','showOverwriteConfirmation']});
  };
  isolated.on('will-download',download);
  ipcMain.handle('pankeki:invoke',async(event,method,value)=>{
    if(closing)throw Error('closing');
    if(!isTrustedSender(event,win.webContents,origin))throw Error('untrusted-sender');
    if(!await verifyBackend())throw Error('backend-identity-changed');
    return controller.invoke(method,event,value);
  });
  let closePromise;
  async function close(){
    if(closePromise)return closePromise;
    closing=true;closePromise=(async()=>{
      const activeRequestId=controller.activeRequestId();
      if(activeRequestId)await bridge.cancel({requestId:activeRequestId});
      const result=await bridge.close();
      const count=result?.unconfirmedSubmissions;
      if(Number.isSafeInteger(count)&&count>0){
        if(notifyUnconfirmedClose)await notifyUnconfirmedClose(count);
        else await dialog.showMessageBox(win,{type:'warning',buttons:['내용을 확인하고 종료'],message:'일부 이미지 작업의 취소를 확인하지 못했습니다.',
          detail:count+'개 제출의 취소가 확인되지 않았습니다. 앱을 종료해도 GPU 계산이 계속될 수 있습니다. 기존 서버와 다른 작업은 전역 중단하지 않습니다.'});
      }
      ipcMain.removeHandler('pankeki:invoke');isolated.removeListener('will-download',download);
      if(!win.isDestroyed())win.destroy();return result;
    })();
    try{return await closePromise;}catch(error){closePromise=null;closing=false;throw error;}
  }
  win.on('close',event=>{
    if(closing)return;event.preventDefault();
    void(async()=>{
      let uiBusy=false;
      try{uiBusy=await win.webContents.executeJavaScript('Boolean(window.PankekiStudio?.getSummary?.().busy)');}catch{}
      const busy=controller.activeRequestId()!==null||uiBusy;
      if(busy){const answer=await dialog.showMessageBox(win,{type:'question',buttons:['계속 작업','진행 중 작업을 중단하고 종료'],defaultId:0,cancelId:0,
        message:'진행 중인 작업이 있습니다.',detail:'앱에서 시작한 작업과 연결을 정리한 뒤 종료합니다.'});if(answer.response===0)return;}
      if(uiBusy)await win.webContents.executeJavaScript('window.PankekiStudio.cancel()');
      await close();
    })().catch(()=>{if(!win.isDestroyed())void dialog.showMessageBox(win,{type:'error',message:'진행 중 작업이나 연결의 정리를 확인하지 못했습니다.',detail:'창을 유지했습니다. 다시 종료를 시도해 주세요.'});});
  });
  try{await win.loadURL(origin+'/');return {window:win,bridge,controller,close};}
  catch(error){await close();throw error;}
}

// The packaged app records the build machine's project path. When that folder is gone
// (moved checkout, renamed drive), let the user point the app at the project instead.
async function chooseProjectRoot(settingsDir){
  const {resolveRuntime,saveProjectRoot,REQUIRED}=require('./runtime-paths.cjs');
  for(let attempt=0;attempt<5;attempt++){
    const ask=await dialog.showMessageBox({type:'info',buttons:['프로젝트 폴더 선택…','종료'],defaultId:0,cancelId:1,
      message:attempt?'선택한 폴더에서 Pankeki 실행 환경을 찾지 못했어요.':'Pankeki 프로젝트 폴더를 찾을 수 없어요.',
      detail:'Pankeki 소스와 실행 환경이 있는 폴더를 골라 주세요.\n필요한 항목: '+REQUIRED.join(', ')+'\n\n선택은 '+(typeof process!=='undefined'&&process.platform==='win32'?'이 PC':'이 Mac')+'에만 저장되며 PANKEKI_PROJECT_ROOT 환경 변수로도 지정할 수 있어요.'+(typeof process!=='undefined'&&process.platform==='win32'?'\n준비는 프로젝트 폴더에서 scripts\\setup-windows.ps1 로 합니다.':'')});
    if(ask.response!==0)return null;
    const picked=await dialog.showOpenDialog({title:'Pankeki 프로젝트 폴더',properties:['openDirectory'],buttonLabel:'이 폴더 사용'});
    if(picked.canceled||!picked.filePaths[0])continue;
    try{saveProjectRoot(settingsDir,picked.filePaths[0]);return resolveRuntime({projectRoot:picked.filePaths[0]});}catch{}
  }
  return null;
}

async function boot() {
  const {bundleContentId,createBuildStatusReader}=require('./build-identity.cjs');
  // Observe bundle bytes once before startup waits; later path replacement is a different observation.
  const startupBundleId=bundleContentId(__dirname);
  const {resolveRuntime}=require('./runtime-paths.cjs');
  // Stable location for the user's folder choice; independent of the profile path set below.
  const settingsDir=path.join(app.getPath('appData'),'Pankeki');
  let paths;try{paths=resolveRuntime({settingsDir});}catch{
    await app.whenReady();
    paths=await chooseProjectRoot(settingsDir);
    if(!paths){const missing=new BrowserWindow({title:'Pankeki',width:620,height:420,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
      await missing.loadFile(path.join(__dirname,'shell.html'),{query:{code:'runtime-missing'}});return;}
  }
  app.setName('Pankeki');app.setPath('userData',path.join(paths.runtime,app.isPackaged?'electron-profile-release':'electron-profile-dev'));
  if(!app.requestSingleInstanceLock()){app.quit();return;}
  await app.whenReady();
  const {createBackendManager}=require('./backend-manager.cjs');const {createEditContextStore}=require('./edit-context.cjs');
  const backend=createBackendManager({paths});let editor,contexts;
  app.on('second-instance',()=>{if(editor&&!editor.window.isDestroyed()){editor.window.restore();editor.window.focus();}});
  let stopping=false;
  app.on('before-quit',event=>{
    if(stopping)return;event.preventDefault();
    if(editor&&!editor.window.isDestroyed()){editor.window.close();return;}
    stopping=true;
    void(async()=>{if(editor)await editor.close();if(contexts)await contexts.close();await backend.close();app.quit();})().catch(()=>{
      stopping=false;void dialog.showMessageBox({type:'error',message:'앱이 시작한 프로세스의 종료를 확인하지 못했습니다.',detail:'앱은 종료된 것으로 표시하지 않았습니다. 다시 종료를 시도해 주세요.'});
    });
  });
  app.on('window-all-closed',()=>app.quit());
  try {
    await backend.start();
    if(stopping)return;
    const dataDir=path.join(paths.runtime,'sessions',Date.now()+'-'+randomUUID());
    contexts=createEditContextStore({dataDir,decode:bytes=>{const image=nativeImage.createFromBuffer(bytes);return image.isEmpty()?null:image.getSize();}});
    const {createCodexBridge,PROTOCOL_VERSION}=require('./codex-bridge.cjs');
    const {createClaudeBridge}=require('./claude-bridge.cjs');const {createProviderBridge}=require('./chat-providers.cjs');
    const {createChatModelSettings}=require('./chat-model-settings.cjs');
    const chatModelSettings=createChatModelSettings({directory:app.getPath('userData')});
    const {createResultResolver}=require('./result-resolver.cjs');
    const getBuildStatus=createBuildStatusReader({electronBundleId:startupBundleId,fetchHealth:async()=>{
      if(!await backend.verifyIdentity())throw Error('backend-identity-changed');
      const response=await fetch('http://127.0.0.1:8190/api/health',{redirect:'error',signal:AbortSignal.timeout(2500),headers:{origin:'http://127.0.0.1:8190'}});
      if(!response.ok)throw Error('health-unavailable');
      return response.json();
    }});
    const getCapabilities=require('./pankeki-tools.cjs').createCapabilityReader({origin:'http://127.0.0.1:8190',verifyBackend:()=>backend.verifyIdentity()});
    const decode=bytes=>{const image=nativeImage.createFromBuffer(bytes);return image.isEmpty()?null:image.getSize();};
    // Images shown to the chat model: longest side at most 1024px, JPEG, so a turn stays small.
    const imageForModel=bytes=>{
      if(!Buffer.isBuffer(bytes))return null;const image=nativeImage.createFromBuffer(bytes);if(image.isEmpty())return null;
      const {width,height}=image.getSize(),scale=Math.min(1,1024/Math.max(width,height));
      const sized=scale<1?image.resize({width:Math.round(width*scale),height:Math.round(height*scale),quality:'good'}):image;
      return {mimeType:'image/jpeg',data:sized.toJPEG(85).toString('base64')};
    };
    const html=fs.readFileSync(path.join(paths.projectRoot,'web/index.html'),'utf8');
    editor=await createEditorWindow({origin:'http://127.0.0.1:8190',html,projectRoot:paths.projectRoot,contexts,
      allowLiveSend:bridge=>PROTOCOL_VERSION===2&&bridge.protocolVersion===2&&typeof bridge.getSubmittedRequest==='function'&&typeof bridge.getResultDescriptor==='function',
      mapBridgeMessage:value=>({...value,context:contexts.bindRequest(value)}),
      resultsFactory:bridge=>createResultResolver({bridge,origin:'http://127.0.0.1:8190',verifyBackend:()=>backend.verifyIdentity(),decode}),
      verifyBackend:()=>backend.verifyIdentity(),
      getAppStatus:async()=>({version:app.getVersion(),backend:backend.status(),externalRuntimeRequired:true,sendEnabled:PROTOCOL_VERSION===2,resultEnabled:PROTOCOL_VERSION===2,experimentalDynamicTools:true,providers:['codex','claude'],build:await getBuildStatus()}),
      bridgeFactory:onEvent=>{
        const shared={getCapabilities,projectRoot:paths.projectRoot,pankekiBaseUrl:'http://127.0.0.1:8190',dataDir,inputRoot:path.join(dataDir,'inputs'),
          resolveEditContext:context=>contexts.resolveEditContext(context),mcpPython:paths.mcpPython,imageForModel};
        const connectionLog=createConnectionLogger(path.join(dataDir,'codex-connection.log'));
        return createProviderBridge({onEvent,settings:chatModelSettings,factories:{codex:emit=>createCodexBridge({...shared,codexPath:paths.codexPath,log:connectionLog,onEvent:emit}),
          claude:emit=>createClaudeBridge({...shared,onEvent:emit})}});
      }});
    if(stopping){await editor.close();await contexts.close();return;}
  }catch(error){
    await backend.close();
    if(stopping){if(contexts)await contexts.close();return;}
    const code=['runtime-missing','port-occupied','backend-identity-changed','backend-timeout','listener-inspection-failed'].includes(error.message)?error.message:'startup-failed';
    const failure=new BrowserWindow({title:'Pankeki',width:620,height:420,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
    await failure.loadFile(path.join(__dirname,'shell.html'),{query:{code}});
  }
}
if(require.main===module)void boot();
module.exports={createEditorWindow,boot,createConnectionLogger};

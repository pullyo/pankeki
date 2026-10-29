'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const invoke=(method,value)=>ipcRenderer.invoke('pankeki:invoke',method,value);
contextBridge.exposeInMainWorld('pankekiDesktop',Object.freeze({
  getStatus:()=>invoke('getStatus'),
  connectCodex:()=>invoke('connectCodex'),
  selectProvider:payload=>invoke('selectProvider',payload),
  getChatModelOptions:payload=>invoke('getChatModelOptions',payload),
  setChatModel:payload=>invoke('setChatModel',payload),
  sendMessage:payload=>invoke('sendMessage',payload),
  cancelMessage:payload=>invoke('cancelMessage',payload),
  prepareEditContext:payload=>invoke('prepareEditContext',payload),
  pickVideoScene:()=>invoke('pickVideoScene'),
  resolveResult:payload=>invoke('resolveResult',payload),
  onCodexEvent:callback=>{
    if(typeof callback!=='function')throw new TypeError('callback must be a function');
    const listener=(_event,data)=>callback(data);
    ipcRenderer.on('pankeki:codex-event',listener);
    return ()=>ipcRenderer.removeListener('pankeki:codex-event',listener);
  }
}));

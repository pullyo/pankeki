'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {isTrustedSender, makeCsp, allowRequest, createPermissionPolicy} = require('../security.cjs');

test('clipboard permission policy permits only sanitized writes from the current main document',()=>{
  const origin='http://127.0.0.1:8190',frame={url:origin+'/'},contents={mainFrame:frame};
  const policy=createPermissionPolicy(contents,origin),details={isMainFrame:true,requestingUrl:frame.url};
  const request=(source,permission,value)=>{let allowed;policy.request(source,permission,result=>{allowed=result;},value);return allowed;};
  assert.equal(policy.check(contents,'clipboard-sanitized-write',origin,details),true);
  assert.equal(request(contents,'clipboard-sanitized-write',details),true);
  for(const permission of ['clipboard-read','deprecated-sync-clipboard-read','media','notifications','unknown','',null,undefined]){
    assert.equal(policy.check(contents,permission,origin,details),false);
    assert.equal(request(contents,permission,details),false);
  }
  for(const source of [null,undefined,{mainFrame:frame}]){
    assert.equal(policy.check(source,'clipboard-sanitized-write',origin,details),false);
    assert.equal(request(source,'clipboard-sanitized-write',details),false);
  }
  for(const value of [null,undefined,{}, {...details,isMainFrame:false},{...details,isMainFrame:'true'}, {...details,requestingUrl:undefined}]){
    assert.equal(policy.check(contents,'clipboard-sanitized-write',origin,value),false);
    assert.equal(request(contents,'clipboard-sanitized-write',value),false);
  }
  for(const requestedOrigin of [undefined,null,'null',origin+'/', 'http://localhost:8190','https://example.org'])assert.equal(policy.check(contents,'clipboard-sanitized-write',requestedOrigin,details),false);
  for(const url of ['','not a URL','file:///tmp/editor.html','http://localhost:8190/','http://127.0.0.1:8191/','https://example.org/',origin+'/evil',origin+'/?x=1','http://user:pass@127.0.0.1:8190/']){
    assert.equal(policy.check(contents,'clipboard-sanitized-write',origin,{...details,requestingUrl:url}),false);
    assert.equal(request(contents,'clipboard-sanitized-write',{...details,requestingUrl:url}),false);
    frame.url=url;assert.equal(policy.check(contents,'clipboard-sanitized-write',origin,{...details,requestingUrl:url}),false);assert.equal(request(contents,'clipboard-sanitized-write',{...details,requestingUrl:url}),false);frame.url=origin+'/';
  }
  // A local skip-link fragment is the same trusted document, never a new origin/path.
  frame.url=origin+'/#pcConversation';const anchored={...details,requestingUrl:frame.url};
  assert.equal(policy.check(contents,'clipboard-sanitized-write',origin,anchored),true);assert.equal(request(contents,'clipboard-sanitized-write',anchored),true);
  assert.equal(policy.check(contents,'clipboard-sanitized-write',origin,details),false,'stale requesting URL cannot impersonate the current document');
  for(const invalidOrigin of [undefined,null,'null',origin+'/',origin+'/other']){const denied=createPermissionPolicy(contents,invalidOrigin);assert.equal(denied.check(contents,'clipboard-sanitized-write',invalidOrigin,anchored),false);}
});

test('editor session installs the same write-only permission policy on both Electron hooks',async()=>{
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
  const mainFile=path.join(__dirname,'../main.cjs'),localRequire=createRequire(mainFile),origin='http://127.0.0.1:8190';let requestHook,checkHook,window;
  const isolated={webRequest:{onBeforeRequest(){},onHeadersReceived(){}},setPermissionRequestHandler(fn){requestHook=fn;},setPermissionCheckHandler(fn){checkHook=fn;},on(){}};
  class Window {constructor(){this.webContents={mainFrame:{url:origin+'/'},setWindowOpenHandler(){},on(){}};window=this;}on(){}async loadURL(url){this.webContents.mainFrame.url=url;}}
  const electron={BrowserWindow:Window,session:{fromPartition:()=>isolated},ipcMain:{handle(){}}};const entry={exports:{}};
  const read=name=>name==='electron'?electron:localRequire(name);
  vm.runInNewContext(fs.readFileSync(mainFile,'utf8'),{require:read,module:entry,__dirname:path.dirname(mainFile),URL},{filename:mainFile});
  await entry.exports.createEditorWindow({origin,html:'<html></html>',bridgeFactory:()=>({})});
  const contents=window.webContents,details={isMainFrame:true,requestingUrl:origin+'/'};
  assert.equal(checkHook(contents,'clipboard-sanitized-write',origin,details),true);
  let allowed;requestHook(contents,'clipboard-sanitized-write',value=>{allowed=value;},details);assert.equal(allowed,true);
  assert.equal(checkHook(contents,'clipboard-read',origin,details),false);
  requestHook(contents,'clipboard-read',value=>{allowed=value;},details);assert.equal(allowed,false);
});

test('a foreign frame or same-port foreign document cannot invoke desktop IPC', () => {
  const frame = {url:'http://127.0.0.1:8190/'};
  const contents = {mainFrame:frame};
  const event = {sender:contents,senderFrame:frame};
  assert.equal(isTrustedSender(event,contents,'http://127.0.0.1:8190'),true);
  for (const url of ['http://localhost:8190/','http://127.0.0.1:8190/evil','https://example.org/','file:///tmp/editor.html']) {
    frame.url=url; assert.equal(isTrustedSender(event,contents,'http://127.0.0.1:8190'),false);
  }
  frame.url='http://127.0.0.1:8190/';
  assert.equal(isTrustedSender({...event,senderFrame:{url:frame.url}},contents,'http://127.0.0.1:8190'),false);
  assert.equal(isTrustedSender({...event,sender:{}},contents,'http://127.0.0.1:8190'),false);
});

test('CSP permits only the actual inline script and required local data', () => {
  const csp=makeCsp('<html><script>window.ok=1;</script><script type="application/json">{}</script></html>','http://127.0.0.1:8190');
  assert.match(csp,/sha256-/); assert.doesNotMatch(csp,/unsafe-eval|script-src[^;]*unsafe-inline/);
  assert.match(csp,/object-src 'none'/); assert.match(csp,/frame-src 'none'/);
  // The UI font is a same-origin hashed file now; inline data: fonts are no longer allowed.
  assert.match(csp,/(?:^|; )font-src 'self'(?:;|$)/); assert.doesNotMatch(csp,/font-src[^;]*(?:data:|blob:|\*|https?:)/);
  assert.match(csp,/(?:^|; )default-src 'none'(?:;|$)/); assert.match(csp,/(?:^|; )connect-src http:\/\/127\.0\.0\.1:8190 blob: data:(?:;|$)/);
  assert.equal(allowRequest('http://127.0.0.1:8190/assets/fonts/pretendard-0123456789abcdef.woff2','http://127.0.0.1:8190'),true);
  assert.equal(allowRequest('http://127.0.0.1:8190/api/health','http://127.0.0.1:8190'),true);
  assert.equal(allowRequest('https://example.org/leak','http://127.0.0.1:8190'),false);
  assert.equal(allowRequest('http://user:pass@127.0.0.1:8190/','http://127.0.0.1:8190'),false);
});

test('the built page references its font only as a same-origin hashed file the CSP admits', () => {
  const html=require('node:fs').readFileSync(require('node:path').join(__dirname,'../../web/index.html'),'utf8');
  assert.doesNotMatch(html,/data:font\//);
  const urls=[...html.matchAll(/\/assets\/fonts\/pretendard-[0-9a-f]{16}\.woff2/g)].map(match=>match[0]);
  const font=require('node:fs').existsSync(require('node:path').join(__dirname,'../../web/vendor/pretendard/PretendardVariable.woff2'));
  if(!font){assert.equal(urls.length,0);return;}
  assert.ok(urls.length>=1); assert.equal(new Set(urls).size,1);
  assert.equal(allowRequest('http://127.0.0.1:8190'+urls[0],'http://127.0.0.1:8190'),true);
});

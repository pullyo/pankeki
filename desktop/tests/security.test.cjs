'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {isTrustedSender, makeCsp, allowRequest} = require('../security.cjs');

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

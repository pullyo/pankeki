'use strict';
const {createHash}=require('node:crypto');

function isTrustedSender(event, contents, origin) {
  try {
    if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame) return false;
    const u=new URL(event.senderFrame.url);
    return u.origin===origin && u.pathname==='/' && !u.username && !u.password && !u.search;
  } catch { return false; }
}
function createPermissionPolicy(contents,origin) {
  function allow(requestContents,permission,details) {
    try {
      if(permission!=='clipboard-sanitized-write'||!contents||requestContents!==contents||details?.isMainFrame!==true)return false;
      if(typeof origin!=='string'||new URL(origin).origin!==origin)return false;
      const currentUrl=contents.mainFrame?.url;
      if(typeof currentUrl!=='string'||typeof details.requestingUrl!=='string'||details.requestingUrl!==currentUrl)return false;
      const url=new URL(currentUrl);
      return url.origin===origin&&url.pathname==='/'&&!url.username&&!url.password&&!url.search;
    } catch {return false;}
  }
  return Object.freeze({
    check:(requestContents,permission,requestingOrigin,details)=>requestingOrigin===origin&&allow(requestContents,permission,details),
    request:(requestContents,permission,callback,details)=>callback(allow(requestContents,permission,details))
  });
}
function makeCsp(html,origin) {
  const hashes=[];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=|type\s*=\s*["']application\/json/i.test(match[1])) continue;
    hashes.push("'sha256-"+createHash('sha256').update(match[2].replace(/\r\n?/g,'\n')).digest('base64')+"'");
  }
  return [`default-src 'none'`,`script-src ${hashes.join(' ')||"'none'"}`,
    `style-src 'self' 'unsafe-inline'`,`img-src 'self' data: blob:`,`font-src 'self'`,
    `connect-src ${origin} blob: data:`,`media-src 'self' blob:`,`object-src 'none'`,`frame-src 'none'`,
    `base-uri 'none'`,`form-action 'none'`,`frame-ancestors 'none'`].join('; ');
}
function allowRequest(value,origin) {
  try { const u=new URL(value);return ['data:','blob:'].includes(u.protocol) || (u.origin===origin && !u.username && !u.password); }
  catch { return false; }
}
module.exports={isTrustedSender,makeCsp,allowRequest,createPermissionPolicy};

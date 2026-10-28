'use strict';
const {createHash}=require('node:crypto');

function isTrustedSender(event, contents, origin) {
  try {
    if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame) return false;
    const u=new URL(event.senderFrame.url);
    return u.origin===origin && u.pathname==='/' && !u.username && !u.password && !u.search;
  } catch { return false; }
}
function makeCsp(html,origin) {
  const hashes=[];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=|type\s*=\s*["']application\/json/i.test(match[1])) continue;
    hashes.push("'sha256-"+createHash('sha256').update(match[2]).digest('base64')+"'");
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
module.exports={isTrustedSender,makeCsp,allowRequest};

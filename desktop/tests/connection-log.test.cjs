'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createConnectionLogger}=require('../main.cjs');
test('connection logs retain only bounded stage and code, never stderr or account details',()=>{
  let bytes=0;const rows=[];
  const log=createConnectionLogger('ignored',{statSync:()=>({size:bytes}),appendFileSync:(_,text)=>{rows.push(text);bytes+=Buffer.byteLength(text);}});
  log('codex: stderr contains C:\\Users\\private user@example.com secret');
  log('connect failed (isolation): user@example.com C:\\Users\\private');
  assert.equal(rows.length,1);const row=JSON.parse(rows[0]);
  assert.equal(row.stage,'connect');assert.equal(row.code,'isolation');
  assert.deepEqual(Object.keys(row).sort(),['at','code','stage']);
  assert.doesNotMatch(rows.join(''),/private|example|secret|stderr/);
  for(let i=0;i<1000;i++)log('connect failed (timeout): sensitive detail');
  assert(bytes<=32768);
});

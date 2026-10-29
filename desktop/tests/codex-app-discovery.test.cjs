'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const w=require('node:path').win32;
const platform=require('../platform.cjs');
function fixture(){
  const files=new Map(),dirs=new Map();
  const local='C:\\Users\\김 판케\\AppData\\Local',home='C:\\Users\\김 판케';
  const bin=w.join(local,'OpenAI','Codex','bin');
  const fsImpl={statSync:file=>{if(!files.has(file))throw Error('ENOENT');return {isFile:()=>true,mtimeMs:files.get(file)};},
    readdirSync:dir=>{if(!dirs.has(dir))throw Error('ENOENT');return dirs.get(dir);}};
  const app=(name,mtime)=>{const file=w.join(bin,name,'codex.exe');files.set(file,mtime);dirs.set(bin,[...(dirs.get(bin)||[]),{name,isDirectory:()=>true}]);return file;};
  return {local,home,bin,files,dirs,fsImpl,app};
}
test('finds the newest installed Codex app CLI without a PATH entry on any test host',()=>{
  const f=fixture();f.app('zz-older',1);const newer=f.app('aa-newer',2);
  assert.deepEqual(platform.findCli('codex',{platform:'win32',env:{LOCALAPPDATA:f.local,PATH:''},fsImpl:f.fsImpl}),{command:newer,args:[]});
});
test('an existing standalone CLI keeps priority over the desktop app fallback',()=>{
  const f=fixture(),standalone=w.join(f.home,'.local','bin','codex.exe');f.files.set(standalone,1);f.app('build',2);
  assert.deepEqual(platform.findCli('codex',{platform:'win32',env:{USERPROFILE:f.home,LOCALAPPDATA:f.local},fsImpl:f.fsImpl}),{command:standalone,args:[]});
});
test('Codex app fallback never supplies Claude or a missing app executable',()=>{
  const f=fixture();f.app('build',1);
  assert.equal(platform.findCli('claude',{platform:'win32',env:{LOCALAPPDATA:f.local},fsImpl:f.fsImpl}),null);
  f.files.clear();assert.equal(platform.findCli('codex',{platform:'win32',env:{LOCALAPPDATA:f.local},fsImpl:f.fsImpl}),null);
});
test('app fallback rejects non-directory and traversal entries',()=>{
  const f=fixture();f.dirs.set(f.bin,[{name:'..',isDirectory:()=>true},{name:'bad\\entry',isDirectory:()=>true},{name:'file',isDirectory:()=>false}]);
  assert.equal(platform.findCli('codex',{platform:'win32',env:{LOCALAPPDATA:f.local},fsImpl:f.fsImpl}),null);
});

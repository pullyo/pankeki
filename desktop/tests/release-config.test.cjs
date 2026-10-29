'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const {spawnSync}=require('node:child_process');
const {currentInputs,staleInputs,files}=require('../scripts/release-config.cjs');
const packager=path.join(__dirname,'../scripts/package-mac.cjs');
function releaseDir(t){const d=fs.mkdtempSync(path.join(os.tmpdir(),'pankeki-release-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;}
function pack(dir){return spawnSync(process.execPath,[packager],{env:{...process.env,PANKEKI_RELEASE_DIR:dir},encoding:'utf8',timeout:30000});}

test('the freeze covers every bundled file, not only the bridge and web entry',()=>{
  const now=currentInputs();
  assert.deepEqual(Object.keys(now.files).sort(),[...files].sort());
  assert.deepEqual(staleInputs({frontendFrozen:true,...now}),[]);
  for(const file of ['main.cjs','claude-bridge.cjs','pankeki-tools.cjs','runtime-paths.cjs']){
    const changed={...now,files:{...now.files,[file]:'0'.repeat(64)}};
    assert.deepEqual(staleInputs(changed),[file]);
  }
  assert.deepEqual(staleInputs({...now,entitlementsSha256:'x'}),['entitlementsSha256']);
});
test('packaging refuses to start without a freeze or with stale inputs',t=>{
  const dir=releaseDir(t);
  let result=pack(dir);
  assert.equal(result.status,1);assert.match(result.stderr,/release-inputs-missing/);
  const now=currentInputs();
  fs.writeFileSync(path.join(dir,'release-inputs.json'),JSON.stringify({frontendFrozen:true,...now,files:{...now.files,'main.cjs':'0'.repeat(64)}}));
  result=pack(dir);
  assert.equal(result.status,1);assert.match(result.stderr,/release-inputs-not-frozen: main\.cjs/);
  assert.equal(fs.existsSync(path.join(dir,'artifacts')),false,'nothing is staged before the freeze check');
});
test('notarization without a signing identity is refused before any notary call',()=>{
  const source=fs.readFileSync(packager,'utf8');
  assert.match(source,/notarization requires PANKEKI_SIGN_IDENTITY/);
  assert.ok(source.indexOf("--options','runtime'")>0,'Developer ID signing uses the hardened runtime');
});

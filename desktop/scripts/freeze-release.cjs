'use strict';
// Record the exact inputs a desktop release is built from. Re-run after any source change.
// Usage: node scripts/freeze-release.cjs   (writes <release dir>/release-inputs.json)
const fs=require('node:fs'),path=require('node:path');const {execFileSync}=require('node:child_process');
const {root,releaseDir,target,currentInputs}=require('./release-config.cjs');
// The identity is computed by the host's project Python (a Mac cross-building for Windows uses .venv-macos).
const python=process.env.PANKEKI_RELEASE_PYTHON||path.join(root,...require('../platform.cjs').layout(process.platform).python.split('/'));
const identity=JSON.parse(execFileSync(python,['-c','import json,sys; from pathlib import Path; from pankeki.build_identity import get_build_identity, desktop_content_id; r=Path(sys.argv[1]); i=get_build_identity(r, html_bytes=(r/"web/index.html").read_bytes()); print(json.dumps({"sourceId":i["source_id"],"htmlSourceId":i["html_source_id"],"desktopSourceId":desktop_content_id(r/"desktop")}))',root],{cwd:root,encoding:'utf8'}));
if(identity.sourceId!==identity.htmlSourceId)throw Error('web/index.html is stale; run web/build.py with the project Python first');
const freeze={schema:2,target,frontendFrozen:true,frozenAt:new Date().toISOString(),...identity,...currentInputs()};
fs.mkdirSync(releaseDir,{recursive:true});
fs.writeFileSync(path.join(releaseDir,'release-inputs.json'),JSON.stringify(freeze,null,2)+'\n');
console.log(JSON.stringify({releaseDir,sourceId:freeze.sourceId,files:Object.keys(freeze.files).length},null,2));

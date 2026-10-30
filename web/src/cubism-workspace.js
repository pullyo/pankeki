/* UI owns selection and DOM; the controller alone owns runtime drawing/time. */
(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports) module.exports=factory(require('./cubism-session.js'));
  else root.PankekiCubismWorkspace=factory(root.PankekiCubismSession);
})(typeof globalThis==='object'?globalThis:this,function(sessions){
  'use strict';
  const fail=(code,message)=>Object.assign(new Error(message),{code});
  function mount(doc,{controller,readPackage,storage,onError=()=>{},availability={ready:false},onModeChange=()=>{}}){
    if(!controller||typeof readPackage!=='function') throw fail('INVALID_WORKSPACE','Controller and package reader required');
    const find=id=>doc.getElementById(id),disposers=[];
    let mode='native',screen=null,closed=false,pkg=null,activePkg=null,selected=[],readAbort=null,loadAbort=null,selectionEpoch=0,operationEpoch=0;
    let reading=false,loading=false,wantsPlay=false,savedSession=null,parametersGeneration=-1,writeQueue=Promise.resolve(),lastSaved=null,workspaceError=null;
    const parameterInputs=new Map();
    const text=(id,value)=>{const n=find(id);if(n)n.textContent=value;};
    const enabled=()=>availability.ready===true;
    const active=()=>!closed&&screen==='motion'&&mode==='cubism'&&!doc.hidden;
    function on(node,event,handler){if(!node)return;node.addEventListener(event,handler);disposers.push(()=>node.removeEventListener(event,handler));}
    function errorMessage(error){
      if(error.code==='MANIFEST_REQUIRED')return '.model3.json과 moc3·텍스처가 포함된 모델 폴더를 선택해주세요.';
      if(error.code==='ENTRY_REQUIRED')return '이 폴더에서 열 모델을 선택해주세요.';
      if(error.code==='MISSING_RESOURCE')return '참조 파일이 빠져 있어요. 폴더 구조를 유지해 다시 선택해주세요.';
      if(error.code==='SDK_UNAVAILABLE')return '현재 재생 준비가 필요해요. 모델 묶음 확인은 사용할 수 있어요.';
      if(error.code==='ABORTED')return '모델 열기를 취소했어요.';
      if(error.code==='PACKAGE_MISMATCH')return '저장할 때와 파일이 달라요. 원래 모델 폴더를 다시 선택해주세요. (PACKAGE_MISMATCH)';
      if(error.code==='CONTEXT_LOST')return '화면 연결이 끊겼어요. 모델 다시 열기 또는 저장한 세션 복원을 선택해주세요.';
      return (error.code||'ERROR')+' · '+error.message;
    }
    function report(error){workspaceError=error;text('cubismEmpty','모델 확인 또는 열기에 실패했어요. '+errorMessage(error));text('cubismStatus',errorMessage(error));find('cubismStatus')?.setAttribute('data-error','true');try{onError(error);}catch(_){} }
    function entryOptions(entries){const select=find('cubismEntry');if(!select)return;select.replaceChildren();for(const path of entries){const option=doc.createElement('option');option.value=path;option.textContent=path;select.append(option);}select.hidden=entries.length<2;find('cubismEntryLabel').hidden=entries.length<2;}
    function missing(error){const body=find('cubismMissing');if(!body)return;body.replaceChildren();if(error.code==='MISSING_RESOURCE'){const row=doc.createElement('tr'),path=doc.createElement('td'),status=doc.createElement('td');path.textContent=error.path||error.message;status.textContent='누락';row.append(path,status);body.append(row);}find('cubismMissingTable').hidden=!body.children.length;}
    function capabilities(){const list=find('cubismCapabilities');if(!list)return;list.replaceChildren();if(!pkg)return;
      const names={motions:'동작',expressions:'표정',physics:'물리',pose:'포즈'};
      for(const [key,label] of Object.entries(names)){const row=doc.createElement('li');row.textContent=label+' · '+(pkg.capabilities[key]==='provided'?'제공됨 · 재생 미검증':'미제공');list.append(row);}
      const row=doc.createElement('li');row.textContent='묶음 구조 확인 · SDK·MOC·이미지 디코드·실재생 미검증';list.append(row);
      for(const warning of pkg.warnings){const item=doc.createElement('li');item.textContent=warning.code==='SOUND_NOT_SUPPORTED'?'음성 재생 · 미지원':warning.code+' · 미지원 항목';list.append(item);}
    }
    function options(id,items,placeholder){const select=find(id);if(!select)return;select.replaceChildren();const empty=doc.createElement('option');empty.value='';empty.textContent=placeholder;select.append(empty);items.forEach((item,index)=>{const option=doc.createElement('option');option.value=String(index);option.textContent=item;select.append(option);});}
    function modelControls(){
      const container=find('cubismParameters');if(!container)return;container.replaceChildren();parameterInputs.clear();
      for(const [index,p] of controller.parameters().entries()){
        const row=doc.createElement('div'),label=doc.createElement('label'),input=doc.createElement('input');row.className='cubism-parameter';input.id='cubismParameter'+index;label.htmlFor=input.id;label.textContent=p.id+' · '+p.min+' ~ '+p.max+(p.repeat?' · 반복':'');input.type='range';input.min=String(p.min);input.max=String(p.max);input.step='any';input.value=String(p.value??p.default);input.setAttribute('aria-label',p.id+' · '+p.min+' ~ '+p.max);const value=doc.createElement('output');value.textContent=input.value;
        // Delegated controls are removed with the parameter container on reload.
        input.addEventListener('input',()=>run(()=>controller.setParameter(p.id,Number(input.value))));
        row.append(label,input,value);container.append(row);parameterInputs.set(p.id,{input,value,defaultValue:p.default});
      }
      options('cubismMotion',activePkg.resources.motions.map(m=>m.group+' / '+m.index),'자동 동작 없음');
      options('cubismExpression',activePkg.resources.expressions.map(e=>e.name),'표정 해제');
    }
    function refresh(){
      if(closed)return;
      const state=controller.getState(),snapshot=controller.snapshot(),ready=enabled()&&state.ready&&!!snapshot&&!!activePkg;
      if(state.error){wantsPlay=false;report(state.error);}
      if(find('cubismRuntimeControls'))find('cubismRuntimeControls').hidden=!ready;
      if(find('cubismSessionControls'))find('cubismSessionControls').hidden=!ready&&!savedSession;
      text('cubismEmpty',reading?'모델 묶음을 확인하고 있어요.':loading?'모델을 열고 있어요.':workspaceError?'모델 확인 또는 열기에 실패했어요. '+errorMessage(workspaceError):pkg?'모델 묶음을 확인했어요. '+(enabled()?'모델 열기를 선택해주세요. 실제 재생은 아직 확인 전입니다.':'현재는 재생 준비가 필요해요.'): '모델 폴더를 열어주세요.');
      text('cubismReadiness',ready?'재생 가능 · 현재 모델':pkg?'모델 묶음 확인됨 · 재생 준비 필요':'모델 폴더를 열어 묶음을 확인하세요.');
      const basic=['cubismLoad','cubismReload'];for(const id of basic)if(find(id))find(id).disabled=!enabled()||!pkg||reading||loading;
      for(const id of ['cubismPlay','cubismPause','cubismReset','cubismSave'])if(find(id))find(id).disabled=!ready||loading||!!state.error;
      for(const id of ['cubismMotion','cubismExpression','cubismBlink','cubismPhysics','cubismPose','cubismInspection','cubismLoop'])if(find(id))find(id).disabled=!ready||loading||!!state.error;
      if(find('cubismBlink'))find('cubismBlink').disabled||=!activePkg?.manifest.Groups?.some(group=>group.Name==='EyeBlink'&&group.Ids?.length);
      if(find('cubismMotion'))find('cubismMotion').disabled||=!activePkg?.resources.motions.length;
      if(find('cubismExpression'))find('cubismExpression').disabled||=!activePkg?.resources.expressions.length;
      if(find('cubismPhysics'))find('cubismPhysics').disabled||=!activePkg?.resources.physics;
      if(find('cubismPose'))find('cubismPose').disabled||=!activePkg?.resources.pose;
      if(find('cubismCancel'))find('cubismCancel').disabled=!reading&&!loadAbort;
      if(find('cubismRestore'))find('cubismRestore').disabled=!enabled()||!pkg||!savedSession||loading;
      if(ready&&parametersGeneration!==state.generation){modelControls();parametersGeneration=state.generation;}
      if(ready){
        for(const [id,row]of parameterInputs){const value=snapshot.parameterOverrides[id]??row.defaultValue;row.input.disabled=!!state.error||loading;if(doc.activeElement!==row.input)row.input.value=String(value);row.value.textContent=String(value);}
        for(const name of ['blink','physics','pose'])if(find('cubism'+name[0].toUpperCase()+name.slice(1)))find('cubism'+name[0].toUpperCase()+name.slice(1)).checked=snapshot.effects[name];
        if(find('cubismInspection'))find('cubismInspection').checked=snapshot.mode==='inspection';
        if(find('cubismExpression'))find('cubismExpression').value=snapshot.expression===null?'':String(activePkg.resources.expressions.findIndex(e=>e.name===snapshot.expression));
        if(find('cubismMotion'))find('cubismMotion').value=snapshot.motion===null?'':String(activePkg.resources.motions.findIndex(m=>m.group===snapshot.motion.group&&m.index===snapshot.motion.index));
      }
    }
    function resumeIfWanted(){const state=controller.getState();if(active()&&wantsPlay&&state.ready&&!state.error)controller.resume();}
    async function openFiles(files,{entryPath}={}){
      readAbort?.abort();loadAbort?.abort();const abort=new AbortController();readAbort=abort;const epoch=++selectionEpoch;reading=true;workspaceError=null;refresh();
      try{
        const incoming=Array.from(files);
        if(incoming.length>256)throw fail('FILE_COUNT_LIMIT','한 묶음은 256개 파일까지 선택할 수 있어요.');
        let total=0;for(const file of incoming){const size=file.size??file.bytes?.byteLength??0;if(size>64*1024*1024)throw fail('FILE_SIZE_LIMIT','파일 하나는 64MiB 이하만 열 수 있어요.');total+=size;}
        if(total>256*1024*1024)throw fail('TOTAL_SIZE_LIMIT','묶음은 256MiB 이하만 열 수 있어요.');
        const candidateFiles=await Promise.all(incoming.map(file=>{if(typeof file.path==='string'&&file.bytes)return {path:file.path,bytes:file.bytes};const path=file.webkitRelativePath||file.relativePath||file.name;return file.arrayBuffer().then(bytes=>({path,bytes:new Uint8Array(bytes)}));}));
        if(abort.signal.aborted||epoch!==selectionEpoch||closed)return false;
        selected=candidateFiles;
        const candidate=await readPackage(candidateFiles,{entryPath,signal:abort.signal});
        if(abort.signal.aborted||epoch!==selectionEpoch||closed)return false;
        pkg=candidate;entryOptions(candidateFiles.map(f=>f.path.normalize('NFC')).filter(path=>/\.model3\.json$/i.test(path)).sort());find('cubismEntry').value=pkg.entryPath;missing({});capabilities();text('cubismEntryPath',pkg.entryPath);text('cubismStatus','모델 묶음을 확인했어요. '+(enabled()?'모델 열기를 선택해주세요.':'현재 재생 준비가 필요해요.'));find('cubismStatus')?.setAttribute('data-error','false');return true;
      }catch(error){if(epoch!==selectionEpoch||closed)return false;if(error.code==='ENTRY_REQUIRED')entryOptions(error.entries);missing(error);report(error);return false;}
      finally{if(epoch===selectionEpoch){reading=false;readAbort=null;refresh();}}
    }
    function requireAvailable(){if(!enabled())throw fail('SDK_UNAVAILABLE','Official runtime is unavailable');if(!pkg)throw fail('PACKAGE_REQUIRED','모델 폴더를 먼저 선택해주세요.');}
    async function stage(restored){requireAvailable();loadAbort?.abort();const abort=restored===undefined?new AbortController():null;loadAbort=abort;const epoch=++operationEpoch,candidate=pkg;loading=true;workspaceError=null;refresh();
      try{const ok=restored===undefined?await controller.load(candidate,{signal:abort.signal}):await controller.restore(restored,candidate);if(closed||epoch!==operationEpoch)return false;if(ok){activePkg=candidate;wantsPlay=false;find('cubismCanvasHost')?.replaceChildren(controller.getCanvas());parametersGeneration=-1;text('cubismStatus',restored===undefined?'모델을 열었어요.':'세션을 복원했어요. 동작과 물리는 처음부터 시작합니다.');refresh();await persist().catch(report);}else{if(!controller.getState().error)workspaceError=fail('LOAD_FAILED','모델을 열지 못했어요. 이전 화면을 유지합니다.');refresh();}return ok;}
      finally{if(epoch===operationEpoch){loading=false;loadAbort=null;refresh();}}
    }
    function snapshotProject(){const snapshot=controller.snapshot();if(!enabled()||!controller.getState().ready||!snapshot)throw fail('SESSION_NOT_READY','실제 모델을 연 뒤 세션을 저장할 수 있어요.');return sessions.serializeSession(snapshot);}
    async function persist(){const raw=snapshotProject();if(!storage?.write||raw===lastSaved)return raw;writeQueue=writeQueue.catch(()=>{}).then(()=>storage.write(raw));await writeQueue;lastSaved=raw;savedSession=raw;refresh();return raw;}
    function run(action){try{const result=action();refresh();void persist().catch(report);return result;}catch(error){report(error);refresh();return false;}}
    function play(){return run(()=>{if(controller.getState().error)throw fail('RELOAD_REQUIRED','모델을 다시 열어주세요.');controller.setMode('play');const index=Number(find('cubismMotion')?.value);if(find('cubismMotion')?.value!==''&&activePkg.resources.motions[index]){const m=activePkg.resources.motions[index];controller.playMotion(m.group,m.index,{loop:!!find('cubismLoop')?.checked});}wantsPlay=true;resumeIfWanted();});}
    function setMode(next){if(!['native','cubism'].includes(next)||mode===next||closed)return;mode=next;doc.body.dataset.motionWorkspace=mode;if(mode==='native'){wantsPlay=false;controller.pause();}else resumeIfWanted();layout();onModeChange(mode);}
    function layout(){if(find('cubismWorkspace'))find('cubismWorkspace').hidden=mode!=='cubism';if(find('motionNativePanel'))find('motionNativePanel').hidden=mode==='cubism';if(find('motionProjectTools'))find('motionProjectTools').hidden=screen==='motion'&&mode==='cubism';for(const [id,value]of [['motionNativeMode','native'],['motionCubismMode','cubism']])find(id)?.setAttribute('aria-pressed',String(mode===value));}
    function show(next){if(closed)return;if(screen===next){layout();return;}const was=active();screen=next;layout();if(was&&!active())controller.pause();else resumeIfWanted();}
    function suspend({resetPlayback=false}={}){if(closed)return;if(resetPlayback)wantsPlay=false;screen=null;controller.pause();layout();}
    function destroy(){if(closed)return;closed=true;++selectionEpoch;++operationEpoch;readAbort?.abort();loadAbort?.abort();for(const dispose of disposers.splice(0))dispose();controller.dispose();pkg=null;activePkg=null;selected=[];parameterInputs.clear();}
    on(find('motionNativeMode'),'click',()=>setMode('native'));on(find('motionCubismMode'),'click',()=>setMode('cubism'));on(find('cubismBack'),'click',()=>setMode('native'));
    on(find('cubismPickFolder'),'click',()=>find('cubismFolder')?.click());
    on(find('cubismPickFiles'),'click',()=>find('cubismFiles')?.click());
    const folderInput=find('cubismFolder');
    if(folderInput&&!('webkitdirectory' in folderInput)){find('cubismPickFolder').hidden=true;text('cubismPathHelp','이 브라우저는 폴더 선택을 지원하지 않아요. 상대경로를 유지할 수 있는 전체 파일을 선택해주세요. 하위 폴더 경로가 사라지면 열 수 없습니다.');}
    for(const id of ['cubismFolder','cubismFiles'])on(find(id),'change',async event=>{await openFiles(event.target.files);event.target.value='';});
    on(find('cubismEntry'),'change',()=>openFiles(selected,{entryPath:find('cubismEntry').value}));
    for(const id of ['cubismLoad','cubismReload'])on(find(id),'click',()=>stage().catch(report));
    on(find('cubismCancel'),'click',()=>{readAbort?.abort();loadAbort?.abort();});on(find('cubismPlay'),'click',play);
    on(find('cubismPause'),'click',()=>{wantsPlay=false;controller.pause();refresh();});on(find('cubismReset'),'click',()=>run(()=>controller.reset()));
    on(find('cubismInspection'),'change',()=>run(()=>{wantsPlay=false;controller.pause();controller.setMode(find('cubismInspection').checked?'inspection':'play');}));
    on(find('cubismExpression'),'change',()=>run(()=>controller.setExpression(find('cubismExpression').value===''?null:activePkg.resources.expressions[Number(find('cubismExpression').value)]?.name??null)));
    for(const name of ['Blink','Physics','Pose'])on(find('cubism'+name),'change',()=>run(()=>controller.setEffects(Object.fromEntries(['Blink','Physics','Pose'].map(key=>[key.toLowerCase(),!!find('cubism'+key).checked])))));
    on(find('cubismRestore'),'click',()=>stage(savedSession).catch(report));on(find('cubismSave'),'click',()=>persist().then(()=>text('cubismStatus','세션을 별도로 저장했어요. 다시 열 때 원래 모델 폴더를 선택해주세요.')).catch(report));
    on(find('cubismSession'),'change',async event=>{const file=event.target.files[0];if(!file)return;try{if(file.size>1024*1024)throw fail('INVALID_SESSION','세션 파일은 1MiB 이하만 열 수 있어요.');savedSession=sessions.serializeSession(sessions.parseSession(await file.text()));text('cubismStatus','세션을 읽었어요. 원래 모델 폴더를 선택한 뒤 복원해주세요.');refresh();}catch(error){report(error);}finally{event.target.value='';}});
    on(doc,'visibilitychange',()=>{if(doc.hidden)controller.pause();else resumeIfWanted();});
    const ready=Promise.resolve().then(()=>storage?.read?.()).then(raw=>{if(raw&&!closed){savedSession=sessions.serializeSession(sessions.parseSession(raw));text('cubismStatus','저장한 세션이 있어요. 원래 모델 폴더를 다시 선택해주세요.');refresh();}}).catch(report);
    layout();refresh();
    return Object.freeze({show,suspend,destroy,setMode,refresh,play,openFiles,loadPackage:()=>stage(),restoreSession:async raw=>{requireAvailable();return stage(raw);},snapshotProject,saveProject:persist,ready,getSummary:()=>Object.freeze({mode,entryPath:pkg?.entryPath||null,packageRead:!!pkg,runtimeReady:enabled()&&controller.getState().ready,availability:enabled()?'available':'unavailable'})});
  }
  return Object.freeze({mount});
});

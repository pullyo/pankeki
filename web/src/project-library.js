(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./profiles.js'),globalThis);
  else root.PankekiProjectLibrary=factory(root.CharacterDesign,root);
})(typeof globalThis==='object'?globalThis:this,function(Design,root){
  'use strict';
  const DB_NAME='pankeki-project-library-v1';
  const fail=message=>{throw Error(message);};
  const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
  const validTime=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
  function createIndexedDBStore(indexedDB=root.indexedDB){
    const opened=new Promise((resolve,reject)=>{
      if(!indexedDB||typeof indexedDB.open!=='function')return reject(Error('로컬 프로젝트 저장소를 사용할 수 없어요.'));
      const request=indexedDB.open(DB_NAME,1);
      request.onupgradeneeded=()=>{const db=request.result;for(const name of ['projects','meta'])if(!db.objectStoreNames.contains(name))db.createObjectStore(name,name==='projects'?{keyPath:'id'}:undefined);};
      request.onerror=()=>reject(request.error||Error('프로젝트 저장소 열기 실패'));
      request.onblocked=()=>reject(Error('다른 창의 프로젝트 저장소를 닫고 다시 열어주세요.'));
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db);};
    });
    // Opening errors are delivered by read/commit even if the host awaits ready first.
    opened.catch(()=>{});
    return Object.freeze({
      async read(){const db=await opened;return new Promise((resolve,reject)=>{
        const tx=db.transaction(['projects','meta'],'readonly');let records,meta;
        const rows=tx.objectStore('projects').getAll(),state=tx.objectStore('meta').get('state');
        rows.onsuccess=()=>records=rows.result;state.onsuccess=()=>meta=state.result;
        tx.oncomplete=()=>resolve({revision:meta?.revision??0,activeId:meta?.activeId??null,records:records||[]});
        tx.onerror=tx.onabort=()=>reject(tx.error||Error('프로젝트 목록 읽기 실패'));
      });},
      async commit(change){const db=await opened;return new Promise((resolve,reject)=>{
        const tx=db.transaction(['projects','meta'],'readwrite');let failure=null,next;
        const meta=tx.objectStore('meta'),request=meta.get('state');
        request.onsuccess=()=>{try{
          const current=request.result||{revision:0,activeId:null};
          if(current.revision!==change.expectedRevision)fail('Catalog revision conflict');
          next={revision:current.revision+1,activeId:Object.hasOwn(change,'activeId')?change.activeId:current.activeId};
          const records=tx.objectStore('projects');for(const id of change.remove||[])records.delete(id);for(const record of change.put||[])records.put(record);
          meta.put(next,'state');
        }catch(error){failure=error;tx.abort();}};
        tx.oncomplete=()=>resolve(next);
        tx.onerror=tx.onabort=()=>reject(failure||tx.error||Error('프로젝트 저장 실패'));
      });}
    });
  }
  function create(options={}){
    const {ready,capture,load,newProject:reset,isBusy,getIdentity,getDraft,setDraft}=options;
    for(const fn of [capture,load,reset,isBusy,getIdentity,getDraft,setDraft])if(typeof fn!=='function')fail('프로젝트 host 계약이 필요해요.');
    const validate=options.validateRaw||Design.parseProject,store=options.store||createIndexedDBStore(options.indexedDB);
    if(options.persistCurrent!==undefined&&typeof options.persistCurrent!=='function')fail('현재 프로젝트 저장 host 계약이 필요해요.');
    const persistCurrent=options.persistCurrent||(()=>Promise.resolve());
    const now=options.now||(()=>new Date().toISOString()),makeId=options.makeId||(()=>root.crypto.randomUUID());
    const emptyBrief=JSON.stringify(Design.sanitizeBrief({})),initialIdentity=getIdentity(),listeners=new Set(),drafts=new Map(),documents=new Map();
    let records=new Map(),revision=0,persistedActiveId=null,activeId=null,activeKind='generation',lastGenerationId=null,boundIdentity=null,initialized=false,available=false,transitioning=false,saving=0,error=null,notice='',recovery=null,queue=Promise.resolve(),initializing=null;
    function document(raw){
      if(typeof raw!=='string')fail('v1 프로젝트 원문이 필요해요.');
      if(documents.has(raw))return documents.get(raw);
      const value=validate(raw);if(value.version!==1)fail('이미지 v1 프로젝트만 목록에 저장할 수 있어요.');documents.set(raw,value);return value;
    }
    const canonical=raw=>JSON.stringify(document(raw));
    const hasWork=raw=>{const doc=document(raw);return doc.versions.length>0||JSON.stringify(doc.brief)!==emptyBrief;};
    function item(record){const doc=document(record.raw),selected=doc.versions.find(v=>v.id===doc.selectionHistory.at(-1)?.candidateId)||doc.versions.at(-1);return Object.freeze({id:record.id,name:doc.brief.name||'이름 없는 프로젝트',candidateCount:doc.versions.length,preview:selected?.image||null,createdAt:record.createdAt,updatedAt:record.updatedAt,favorite:record.favorite,recovered:record.recovered});}
    const kindOf=entry=>entry?.kind||'project';
    function getState(){return Object.freeze({initialized,ready:available,transitioning,saving:saving>0,activeId,activeKind,items:Object.freeze([...records.values()].filter(entry=>kindOf(entry)==='project').map(item)),error,notice,recovery:recovery?Object.freeze({...recovery}):null});}
    function publish(){const state=getState();for(const listener of listeners)try{listener(state);}catch{/* A presentation observer cannot roll back committed storage. */}}
    function message(failure){return String(failure?.message||'프로젝트 저장소를 확인해주세요.').slice(0,300);}
    function rejected(text){notice=text;publish();return Promise.resolve(false);}
    function time(){const stamp=now();if(!validTime(stamp))fail('프로젝트 저장 시각을 확인해주세요.');return stamp;}
    function trimDocuments(){const retained=new Set([...records.values()].map(v=>v.raw));for(const raw of documents.keys())if(!retained.has(raw))documents.delete(raw);}
    function record(raw,recovered=false,reserved=new Set(),kind='generation'){let id;for(let i=0;i<8;i++){id=makeId();if(validId(id)&&!records.has(id)&&!reserved.has(id))break;id=null;}if(!id)fail('새 프로젝트 ID를 만들지 못했어요.');const stamp=time();document(raw);return {id,raw,createdAt:stamp,updatedAt:stamp,favorite:false,recovered,kind};}
    function readSnapshot(snapshot){
      if(!snapshot||!Number.isSafeInteger(snapshot.revision)||snapshot.revision<0||!Array.isArray(snapshot.records))fail('프로젝트 목록 형식을 확인해주세요.');
      const next=new Map();for(const entry of snapshot.records){
        if(!entry||Object.getOwnPropertySymbols(entry).length)fail('프로젝트 항목 형식을 확인해주세요.');
        for(const [key,field]of Object.entries(Object.getOwnPropertyDescriptors(entry)))if(!['id','raw','createdAt','updatedAt','favorite','recovered','kind'].includes(key)||!Object.hasOwn(field,'value'))fail('프로젝트 항목 형식을 확인해주세요.');
        if(!validId(entry.id)||next.has(entry.id)||!validTime(entry.createdAt)||!validTime(entry.updatedAt)||typeof entry.favorite!=='boolean'||typeof entry.recovered!=='boolean')fail('프로젝트 항목 형식을 확인해주세요.');
        if(Object.hasOwn(entry,'kind')&&!['project','generation'].includes(entry.kind))fail('작업 종류를 확인해주세요.');
        document(entry.raw);next.set(entry.id,{...entry});
      }
      if(snapshot.activeId!==null&&!next.has(snapshot.activeId))fail('현재 프로젝트 항목을 찾지 못했어요.');
      records=next;revision=snapshot.revision;persistedActiveId=snapshot.activeId;
    }
    async function commit(change){const result=await store.commit({...change,expectedRevision:revision});revision=result.revision;persistedActiveId=result.activeId;for(const id of change.remove||[])records.delete(id);for(const entry of change.put||[])records.set(entry.id,entry);}
    function bind(id){activeId=id;activeKind=kindOf(records.get(id));if(activeKind==='generation')lastGenerationId=id;boundIdentity=getIdentity();recovery=null;error=null;}
    function uncommitted(id,why,kind='commit',documentKind=activeKind){if(kind==='unlinked'){id=null;documentKind='generation';}const ownerId=activeId||recovery?.ownerId||persistedActiveId;activeId=null;activeKind=documentKind;boundIdentity=null;recovery={id,ownerId,reason:why,kind,documentKind,identity:getIdentity()};error=why;notice='현재 화면은 유지돼요. 앱 저장을 다시 시도하거나 프로젝트 파일로 저장해주세요.';publish();}
    function lastGeneration(){
      for(const id of [activeKind==='generation'?activeId:null,lastGenerationId,persistedActiveId]){const entry=records.get(id);if(entry&&kindOf(entry)==='generation')return entry;}
      return [...records.values()].filter(entry=>kindOf(entry)==='generation').sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)||Date.parse(b.createdAt)-Date.parse(a.createdAt)||a.id.localeCompare(b.id))[0]||null;
    }
    function run(action,{transition=false,allowRecovery=false}={}){
      if(!available)return rejected('프로젝트 저장소가 준비되지 않았어요. 기존 파일 열기·저장은 계속 사용할 수 있어요.');
      if(transitioning)return rejected('프로젝트 전환을 마친 뒤 다시 시도해주세요.');
      if(recovery&&!allowRecovery)return rejected('현재 화면의 프로젝트를 먼저 저장해주세요.');
      if(transition&&isBusy())return rejected('진행 중인 작업과 입력 조합을 마친 뒤 프로젝트를 바꿔주세요.');
      if(transition)transitioning=true;else saving++;publish();
      const task=queue.then(async()=>{try{error=null;if(transition&&isBusy())return false;return await action();}catch(failure){error=message(failure);notice='현재 작업과 저장된 프로젝트는 그대로 유지돼요.';if(error.includes('revision conflict')){available=false;activeId=null;recovery={id:null,ownerId:persistedActiveId,kind:'conflict',reason:error};}return false;}finally{if(transition)transitioning=false;else saving--;trimDocuments();publish();}});
      queue=task.catch(()=>{});return task;
    }
    async function saveBound(raw,id){const previous=records.get(id);if(!previous)fail('이 프로젝트 항목이 없어 저장하지 않았어요.');if(previous.raw!==raw)await commit({put:[{...previous,raw,updatedAt:time()}]});}
    async function saveBeforeTransition(){
      const identity=getIdentity(),raw=capture(),draft={...getDraft()};document(raw);
      if(activeId&&identity!==boundIdentity){uncommitted(null,'현재 화면의 프로젝트 연결을 다시 확인해주세요.','unlinked');fail('현재 화면의 프로젝트 연결을 다시 확인해주세요.');}
      await persistCurrent(raw);
      if(identity!==getIdentity()){uncommitted(null,'현재 작업이 바뀌어 이전 프로젝트 저장을 중단했어요.','unlinked');fail('현재 작업이 바뀌어 이전 프로젝트 저장을 중단했어요.');}
      if(activeId){if(getIdentity()!==boundIdentity)fail('현재 화면의 프로젝트 연결을 다시 확인해주세요.');drafts.set(activeId,draft);await saveBound(raw,activeId);}
      else if(hasWork(raw)||draft.text){const entry=record(raw,false,new Set(),activeKind);await commit({put:[entry],activeId:entry.id});if(identity===getIdentity())bind(entry.id);drafts.set(entry.id,draft);}
      if(identity!==getIdentity()){uncommitted(null,'저장 중 현재 작업이 바뀌어 이전 항목에 연결하지 않았어요.','unlinked');fail('저장 중 현재 작업이 바뀌어 이전 항목에 연결하지 않았어요.');}
      return {identity,raw,draft};
    }
    async function init(){
      if(initializing)return initializing;
      initializing=(async()=>{try{
        const [report,snapshot]=await Promise.all([ready,store.read()]);readSnapshot(snapshot);
        if(!report||report.reason==='error'||report.reason==='unavailable'||report.ok!==true&&report.reason!=='superseded')fail('이전 작업의 복원을 확인하지 못해 목록을 변경하지 않았어요. 원본 파일로 복구할 수 있어요.');
        const liveIdentity=getIdentity(),live=capture();document(live);const liveHasWork=hasWork(live),puts=[];
        function preserve(raw,recovered){const matches=[...records.values(),...puts].filter(entry=>canonical(entry.raw)===canonical(raw));const match=matches.find(entry=>entry.id===persistedActiveId)||matches.find(entry=>kindOf(entry)==='generation')||matches[0];if(match)return match;const entry=record(raw,recovered,new Set(puts.map(v=>v.id)));puts.push(entry);return entry;}
        if(report.reason==='superseded'&&report.legacyRead&&typeof report.legacyRaw==='string'&&hasWork(report.legacyRaw))preserve(report.legacyRaw,true);
        const stored=records.get(persistedActiveId);
        const restoredActive=stored&&report.ok===true&&report.restored===true&&report.reason==='restored'&&report.legacyRead===true&&typeof report.legacyRaw==='string'&&canonical(stored.raw)===canonical(live)&&canonical(report.legacyRaw)===canonical(live)&&!getDraft().text&&!isBusy();
        if(liveHasWork||restoredActive){const entry=stored&&canonical(stored.raw)===canonical(live)?stored:preserve(live,!!stored||report.reason==='superseded');
          if(puts.length||persistedActiveId!==entry.id)await commit({put:puts,activeId:entry.id});
          if(liveIdentity!==getIdentity()){uncommitted(null,'초기 저장 중 현재 작업이 바뀌어 이전 항목에 연결하지 않았어요.','unlinked');available=true;return true;}bind(entry.id);
          if(stored&&stored.id!==entry.id||report.reason==='superseded')notice='현재 화면의 작업과 기존 목록의 프로젝트를 모두 보존했어요. 마지막 작업의 자동 복원을 보장하는 것은 아니에요.';
        }else{
          if(puts.length)await commit({put:puts});
          const mayLoad=stored&&report.reason==='empty'&&report.legacyRead===true&&report.legacyRaw==null&&getIdentity()===initialIdentity&&!getDraft().text&&!isBusy();
          if(mayLoad){transitioning=true;publish();if(!await load(stored.raw))fail('저장된 프로젝트를 열지 못했어요. 현재 화면과 원본 항목은 유지돼요.');bind(stored.id);setDraft({text:'',start:0,end:0});}
          else if(stored)notice='현재 입력을 유지했어요. 목록에서 프로젝트를 직접 선택해주세요.';
        }
        available=true;return true;
      }catch(failure){error=message(failure);available=false;return false;}finally{initialized=true;transitioning=false;trimDocuments();publish();}})();return initializing;
    }
    function saveCurrent(){
      const capturedIdentity=getIdentity(),id=activeId;let pending=recovery,raw;
      try{raw=capture();document(raw);}catch(failure){error=message(failure);publish();return Promise.resolve(false);}
      if(id&&capturedIdentity!==boundIdentity){uncommitted(null,'다른 작업으로 바뀌어 이전 프로젝트에 자동 저장하지 않았어요.','unlinked');return Promise.resolve(false);}
      if(pending&&pending.identity!==capturedIdentity){uncommitted(null,'현재 작업이 바뀌어 이전 저장 대상과 분리했어요.','unlinked');pending=recovery;}
      return run(async()=>{
        if(getIdentity()!==capturedIdentity){uncommitted(null,'현재 작업이 바뀌어 이전 항목에 저장하지 않았어요.','unlinked');return false;}
        await persistCurrent(raw);
        if(getIdentity()!==capturedIdentity){uncommitted(null,'저장 중 현재 작업이 바뀌어 이전 항목에 저장하지 않았어요.','unlinked');return false;}
        if(pending){const prior=pending.id&&records.get(pending.id),entry=prior?{...prior,raw,updatedAt:time()}:record(raw,false,new Set(),pending.documentKind||activeKind);if(pending.id&&!prior&&validId(pending.id))entry.id=pending.id;await commit({put:[entry],activeId:entry.id});if(getIdentity()!==capturedIdentity){uncommitted(null,'저장 중 현재 화면이 바뀌어 이전 항목에 연결하지 않았어요.','unlinked');return false;}bind(entry.id);notice=activeKind==='project'?'현재 프로젝트를 앱에 저장했어요.':'이미지 생성 기록을 앱에 저장했어요.';return true;}
        if(id){await saveBound(raw,id);if(getIdentity()!==capturedIdentity){uncommitted(null,'저장 중 현재 화면이 바뀌어 이전 항목에 연결하지 않았어요.','unlinked');return false;}return true;}
        if(!hasWork(raw))return true;
        const entry=record(raw,false,new Set(),activeKind);await commit({put:[entry],activeId:entry.id});if(getIdentity()!==capturedIdentity){uncommitted(null,'저장 중 현재 화면이 바뀌어 이전 항목에 연결하지 않았어요.','unlinked');return false;}bind(entry.id);return true;
      },{allowRecovery:true});
    }
    function transition(kind,value){
      let target=kind==='switch'?records.get(value):kind==='generation'?lastGeneration():null;
      if(kind==='switch'&&!target)return rejected('목록의 프로젝트를 찾지 못했어요.');
      if(kind==='switch'&&value===activeId)return saveCurrent();
      if(kind==='import')try{document(value);}catch(failure){error=message(failure);publish();return Promise.resolve(false);}
      return run(async()=>{
        if(kind==='switch'){target=records.get(value);if(!target)fail('목록에서 제거된 프로젝트는 열지 않았어요.');}
        if(kind==='generation')target=lastGeneration();
        const prior=await saveBeforeTransition();
        if(prior.identity!==getIdentity()){uncommitted(null,'저장 중 현재 작업이 바뀌어 이전 전환을 중단했어요.','unlinked');return false;}
        if(prior.raw!==capture()||JSON.stringify(prior.draft)!==JSON.stringify(getDraft())){notice='새 편집과 입력을 유지하고 프로젝트 전환을 중단했어요.';return false;}
        if(isBusy())return false;
        const accepted=kind==='new'||kind==='generation'&&!target?await reset():await load(kind==='switch'||kind==='generation'?target.raw:value);
        if(!accepted){notice='프로젝트 전환을 취소했어요.';return false;}
        const identity=getIdentity();
        const documentKind=kind==='generation'?'generation':kind==='switch'?kindOf(target):'project';
        try{const raw=kind==='new'||kind==='generation'&&!target?capture():kind==='switch'||kind==='generation'?target.raw:value;document(raw);
          const existing=kind==='switch'||kind==='generation'&&target;
          if(!existing)target=record(raw,false,new Set(),documentKind);else target=records.get(target.id);
          setDraft(drafts.get(target.id)||{text:'',start:0,end:0});
          await persistCurrent(raw);
          if(identity!==getIdentity())fail('저장 중 현재 프로젝트가 바뀌었습니다.');
          await commit({put:existing?[]:[target],activeId:target.id});
        }catch(failure){if(identity!==getIdentity())uncommitted(null,message(failure),'unlinked');else uncommitted(target?.id||null,message(failure),'commit',documentKind);return false;}
        if(identity!==getIdentity()){uncommitted(null,'저장 중 현재 화면이 바뀌었어요.','unlinked',documentKind);return false;}
        bind(target.id);notice=activeKind==='project'?'프로젝트를 앱에 저장하고 열었어요.':'이미지 생성 기록을 열었어요.';return true;
      },{transition:true});
    }
    function openGeneration(){
      if(available&&!transitioning&&!recovery&&activeKind==='generation'){
        if(activeId&&getIdentity()!==boundIdentity){uncommitted(null,'다른 작업으로 바뀌어 이전 이미지 생성 기록에 연결하지 않았어요.','unlinked');return Promise.resolve(false);}
        return Promise.resolve(true);
      }
      return transition('generation');
    }
    function saveAsProject(){
      if(activeKind==='project'&&!recovery)return saveCurrent();
      try{const doc=document(capture());if(!doc.versions.length&&!['name','brief','appearance','detail','notes','prompt'].some(key=>doc.brief[key].trim()))return rejected('이미지를 생성하거나 작업 내용을 입력한 뒤 프로젝트로 저장해주세요.');}catch(failure){error=message(failure);publish();return Promise.resolve(false);}
      return run(async()=>{
        const prior=await saveBeforeTransition();
        if(prior.identity!==getIdentity()||prior.raw!==capture()||JSON.stringify(prior.draft)!==JSON.stringify(getDraft())){notice='새 작업과 입력을 유지하고 프로젝트 저장을 중단했어요.';return false;}
        if(isBusy())return false;
        const target=record(prior.raw,false,new Set(),'project');await commit({put:[target],activeId:target.id});
        if(prior.identity!==getIdentity()||prior.raw!==capture()||JSON.stringify(prior.draft)!==JSON.stringify(getDraft())){uncommitted(null,'저장 중 현재 작업이 바뀌어 새 프로젝트에 연결하지 않았어요.','unlinked','generation');return false;}
        drafts.set(target.id,prior.draft);bind(target.id);notice='현재 작업을 새 프로젝트로 저장했어요.';return true;
      },{transition:true});
    }
    function remove(id){if(id===activeId||id===persistedActiveId)return rejected('현재 프로젝트는 목록에서 제거할 수 없어요. 다른 프로젝트를 선택한 뒤 제거해주세요.');return run(async()=>{if(!records.has(id))return false;await commit({remove:[id]});drafts.delete(id);notice='앱 목록에서만 제거했어요. 외부 프로젝트 파일은 그대로예요.';return true;});}
    function setFavorite(id,value){if(typeof value!=='boolean')return rejected('즐겨찾기 값을 확인해주세요.');return run(async()=>{const previous=records.get(id);if(!previous)return false;await commit({put:[{...previous,favorite:value}]});return true;});}
    async function rebindCurrent(){
      if(!available||transitioning)return false;const owner=activeId||recovery?.ownerId,previous=records.get(owner);
      try{if(previous&&canonical(capture())===canonical(previous.raw)){bind(owner);publish();return true;}}catch{/* A foreign document is never converted into a fabricated v1 entry. */}
      uncommitted(null,'현재 작업을 이미지 프로젝트 목록과 연결하지 않았어요.','unlinked');return false;
    }
    return Object.freeze({init,getState,subscribe(listener){if(typeof listener!=='function')fail('구독 함수가 필요해요.');listeners.add(listener);listener(getState());return()=>listeners.delete(listener);},saveCurrent,saveAsProject,openGeneration,newProject:()=>transition('new'),importProject:raw=>transition('import',raw),switchTo:id=>transition('switch',id),remove,setFavorite,rebindCurrent,flush:()=>queue});
  }
  return Object.freeze({create,createIndexedDBStore});
});

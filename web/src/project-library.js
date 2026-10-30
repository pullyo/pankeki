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
      if(!indexedDB||typeof indexedDB.open!=='function')return reject(Error("Local project storage is unavailable."));
      const request=indexedDB.open(DB_NAME,1);
      request.onupgradeneeded=()=>{const db=request.result;for(const name of ['projects','meta'])if(!db.objectStoreNames.contains(name))db.createObjectStore(name,name==='projects'?{keyPath:'id'}:undefined);};
      request.onerror=()=>reject(request.error||Error("Could not open project storage."));
      request.onblocked=()=>reject(Error("Close project storage in the other window, then try again."));
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
        tx.onerror=tx.onabort=()=>reject(tx.error||Error("Could not read the project list."));
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
        tx.onerror=tx.onabort=()=>reject(failure||tx.error||Error("Could not save the project."));
      });}
    });
  }
  function create(options={}){
    const {ready,capture,load,newProject:reset,isBusy,getIdentity,getDraft,setDraft}=options;
    for(const fn of [capture,load,reset,isBusy,getIdentity,getDraft,setDraft])if(typeof fn!=='function')fail("The project host interface is required.");
    const validate=options.validateRaw||Design.parseProject,store=options.store||createIndexedDBStore(options.indexedDB);
    if(options.persistCurrent!==undefined&&typeof options.persistCurrent!=='function')fail("The current-project persistence interface is required.");
    const persistCurrent=options.persistCurrent||(()=>Promise.resolve());
    const now=options.now||(()=>new Date().toISOString()),makeId=options.makeId||(()=>root.crypto.randomUUID());
    const emptyBrief=JSON.stringify(Design.sanitizeBrief({})),initialIdentity=getIdentity(),listeners=new Set(),drafts=new Map(),documents=new Map();
    let records=new Map(),revision=0,persistedActiveId=null,activeId=null,activeKind='generation',lastGenerationId=null,boundIdentity=null,initialized=false,available=false,transitioning=false,saving=0,error=null,notice='',recovery=null,queue=Promise.resolve(),initializing=null;
    function document(raw){
      if(typeof raw!=='string')fail("A v1 project document is required.");
      if(documents.has(raw))return documents.get(raw);
      const value=validate(raw);if(value.version!==1)fail("Only v1 image projects can be stored in this list.");documents.set(raw,value);return value;
    }
    const canonical=raw=>JSON.stringify(document(raw));
    const hasWork=raw=>{const doc=document(raw);return doc.versions.length>0||JSON.stringify(doc.brief)!==emptyBrief;};
    function item(record){const doc=document(record.raw),selected=doc.versions.find(v=>v.id===doc.selectionHistory.at(-1)?.candidateId)||doc.versions.at(-1);return Object.freeze({id:record.id,name:doc.brief.name||"Untitled project",candidateCount:doc.versions.length,preview:selected?.image||null,createdAt:record.createdAt,updatedAt:record.updatedAt,favorite:record.favorite,recovered:record.recovered});}
    const kindOf=entry=>entry?.kind||'project';
    function getState(){return Object.freeze({initialized,ready:available,transitioning,saving:saving>0,activeId,activeKind,items:Object.freeze([...records.values()].filter(entry=>kindOf(entry)==='project').map(item)),error,notice,recovery:recovery?Object.freeze({...recovery}):null});}
    function getRecentImages(limit=5){
      const rows=[];
      if(initialized)for(const entry of records.values()){
        const doc=document(entry.raw);
        for(const candidate of doc.versions)if(candidate.kind==='generated')rows.push({recordId:entry.id,documentKind:kindOf(entry),projectName:doc.brief.name||(kindOf(entry)==='generation'?"Generation history":"Untitled project"),candidateId:candidate.id,label:candidate.label,image:candidate.image,createdAt:candidate.createdAt,resultSha256:candidate.execution?.resultSha256||null});
      }
      rows.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||Number(b.recordId===activeId)-Number(a.recordId===activeId)||Number(b.documentKind==='generation')-Number(a.documentKind==='generation')||a.recordId.localeCompare(b.recordId)||a.candidateId.localeCompare(b.candidateId));
      const images=new Set(),hashes=new Set(),unique=[];
      for(const row of rows){if(images.has(row.image)||row.resultSha256&&hashes.has(row.resultSha256))continue;images.add(row.image);if(row.resultSha256)hashes.add(row.resultSha256);unique.push(Object.freeze(row));}
      const count=Math.max(0,Math.min(100,Number.isSafeInteger(limit)?limit:5));
      return Object.freeze({items:Object.freeze(unique.slice(0,count)),total:unique.length});
    }
    function publish(){const state=getState();for(const listener of listeners)try{listener(state);}catch{/* A presentation observer cannot roll back committed storage. */}}
    function message(failure){return String(failure?.message||"Check project storage.").slice(0,300);}
    function rejected(text){notice=text;publish();return Promise.resolve(false);}
    function time(){const stamp=now();if(!validTime(stamp))fail("Check the project save timestamp.");return stamp;}
    function trimDocuments(){const retained=new Set([...records.values()].map(v=>v.raw));for(const raw of documents.keys())if(!retained.has(raw))documents.delete(raw);}
    function record(raw,recovered=false,reserved=new Set(),kind='generation'){let id;for(let i=0;i<8;i++){id=makeId();if(validId(id)&&!records.has(id)&&!reserved.has(id))break;id=null;}if(!id)fail("Could not create a project ID.");const stamp=time();document(raw);return {id,raw,createdAt:stamp,updatedAt:stamp,favorite:false,recovered,kind};}
    function readSnapshot(snapshot){
      if(!snapshot||!Number.isSafeInteger(snapshot.revision)||snapshot.revision<0||!Array.isArray(snapshot.records))fail("Check the project list format.");
      const next=new Map();for(const entry of snapshot.records){
        if(!entry||Object.getOwnPropertySymbols(entry).length)fail("Check the project entry format.");
        for(const [key,field]of Object.entries(Object.getOwnPropertyDescriptors(entry)))if(!['id','raw','createdAt','updatedAt','favorite','recovered','kind'].includes(key)||!Object.hasOwn(field,'value'))fail("Check the project entry format.");
        if(!validId(entry.id)||next.has(entry.id)||!validTime(entry.createdAt)||!validTime(entry.updatedAt)||typeof entry.favorite!=='boolean'||typeof entry.recovered!=='boolean')fail("Check the project entry format.");
        if(Object.hasOwn(entry,'kind')&&!['project','generation'].includes(entry.kind))fail("Check the document type.");
        document(entry.raw);next.set(entry.id,{...entry});
      }
      if(snapshot.activeId!==null&&!next.has(snapshot.activeId))fail("The current project entry could not be found.");
      records=next;revision=snapshot.revision;persistedActiveId=snapshot.activeId;
    }
    async function commit(change){const result=await store.commit({...change,expectedRevision:revision});revision=result.revision;persistedActiveId=result.activeId;for(const id of change.remove||[])records.delete(id);for(const entry of change.put||[])records.set(entry.id,entry);}
    function bind(id){activeId=id;activeKind=kindOf(records.get(id));if(activeKind==='generation')lastGenerationId=id;boundIdentity=getIdentity();recovery=null;error=null;}
    function uncommitted(id,why,kind='commit',documentKind=activeKind){if(kind==='unlinked'){id=null;documentKind='generation';}const ownerId=activeId||recovery?.ownerId||persistedActiveId;activeId=null;activeKind=documentKind;boundIdentity=null;recovery={id,ownerId,reason:why,kind,documentKind,identity:getIdentity()};error=why;notice="Your current work is still open. Retry saving in the app or save a project file.";publish();}
    function lastGeneration(){
      for(const id of [activeKind==='generation'?activeId:null,lastGenerationId,persistedActiveId]){const entry=records.get(id);if(entry&&kindOf(entry)==='generation')return entry;}
      return [...records.values()].filter(entry=>kindOf(entry)==='generation').sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)||Date.parse(b.createdAt)-Date.parse(a.createdAt)||a.id.localeCompare(b.id))[0]||null;
    }
    function run(action,{transition=false,allowRecovery=false}={}){
      if(!available)return rejected("Project storage is not ready. You can still open and save project files.");
      if(transitioning)return rejected("Wait for the project switch to finish, then try again.");
      if(recovery&&!allowRecovery)return rejected("Save the current project first.");
      if(transition&&isBusy())return rejected("Finish the current operation and text composition before switching projects.");
      if(transition)transitioning=true;else saving++;publish();
      const task=queue.then(async()=>{try{error=null;if(transition&&isBusy())return false;return await action();}catch(failure){error=message(failure);notice="Your current work and saved projects are unchanged.";if(error.includes('revision conflict')){available=false;activeId=null;recovery={id:null,ownerId:persistedActiveId,kind:'conflict',reason:error};}return false;}finally{if(transition)transitioning=false;else saving--;trimDocuments();publish();}});
      queue=task.catch(()=>{});return task;
    }
    async function saveBound(raw,id){const previous=records.get(id);if(!previous)fail("This project entry no longer exists, so it was not saved.");if(previous.raw!==raw)await commit({put:[{...previous,raw,updatedAt:time()}]});}
    async function saveBeforeTransition(){
      const identity=getIdentity(),raw=capture(),draft={...getDraft()};document(raw);
      if(activeId&&identity!==boundIdentity){uncommitted(null,"Check the current document’s project connection.",'unlinked');fail("Check the current document’s project connection.");}
      await persistCurrent(raw);
      if(identity!==getIdentity()){uncommitted(null,"The current work changed. Saving to the previous project was stopped.",'unlinked');fail("The current work changed. Saving to the previous project was stopped.");}
      if(activeId){if(getIdentity()!==boundIdentity)fail("Check the current document’s project connection.");drafts.set(activeId,draft);await saveBound(raw,activeId);}
      else if(hasWork(raw)||draft.text){const entry=record(raw,false,new Set(),activeKind);await commit({put:[entry],activeId:entry.id});if(identity===getIdentity())bind(entry.id);drafts.set(entry.id,draft);}
      if(identity!==getIdentity()){uncommitted(null,"The current work changed while saving and was not linked to the previous entry.",'unlinked');fail("The current work changed while saving and was not linked to the previous entry.");}
      return {identity,raw,draft};
    }
    async function init(){
      if(initializing)return initializing;
      initializing=(async()=>{try{
        const [report,snapshot]=await Promise.all([ready,store.read()]);readSnapshot(snapshot);
        if(!report||report.reason==='error'||report.reason==='unavailable'||report.ok!==true&&report.reason!=='superseded')fail("The previous work could not be verified, so the list was not changed. You can recover it from the original file.");
        const liveIdentity=getIdentity(),live=capture();document(live);const liveHasWork=hasWork(live),puts=[];
        function preserve(raw,recovered){const matches=[...records.values(),...puts].filter(entry=>canonical(entry.raw)===canonical(raw));const match=matches.find(entry=>entry.id===persistedActiveId)||matches.find(entry=>kindOf(entry)==='generation')||matches[0];if(match)return match;const entry=record(raw,recovered,new Set(puts.map(v=>v.id)));puts.push(entry);return entry;}
        if(report.reason==='superseded'&&report.legacyRead&&typeof report.legacyRaw==='string'&&hasWork(report.legacyRaw))preserve(report.legacyRaw,true);
        const stored=records.get(persistedActiveId);
        const restoredActive=stored&&report.ok===true&&report.restored===true&&report.reason==='restored'&&report.legacyRead===true&&typeof report.legacyRaw==='string'&&canonical(stored.raw)===canonical(live)&&canonical(report.legacyRaw)===canonical(live)&&!getDraft().text&&!isBusy();
        if(liveHasWork||restoredActive){const entry=stored&&canonical(stored.raw)===canonical(live)?stored:preserve(live,!!stored||report.reason==='superseded');
          if(puts.length||persistedActiveId!==entry.id)await commit({put:puts,activeId:entry.id});
          if(liveIdentity!==getIdentity()){uncommitted(null,"The current work changed during initial saving and was not linked to the previous entry.",'unlinked');available=true;return true;}bind(entry.id);
          if(stored&&stored.id!==entry.id||report.reason==='superseded')notice="The current work and existing projects were both preserved. This does not guarantee automatic restoration of the last session.";
        }else{
          if(puts.length)await commit({put:puts});
          const mayLoad=stored&&report.reason==='empty'&&report.legacyRead===true&&report.legacyRaw==null&&getIdentity()===initialIdentity&&!getDraft().text&&!isBusy();
          if(mayLoad){transitioning=true;publish();if(!await load(stored.raw))fail("The saved project could not be opened. Your current work and the original entry are unchanged.");bind(stored.id);setDraft({text:'',start:0,end:0});}
          else if(stored)notice="Your input was preserved. Choose a project from the list.";
        }
        available=true;return true;
      }catch(failure){error=message(failure);available=false;return false;}finally{initialized=true;transitioning=false;trimDocuments();publish();}})();return initializing;
    }
    function saveCurrent(){
      const capturedIdentity=getIdentity(),id=activeId;let pending=recovery,raw;
      try{raw=capture();document(raw);}catch(failure){error=message(failure);publish();return Promise.resolve(false);}
      if(id&&capturedIdentity!==boundIdentity){uncommitted(null,"The document changed, so it was not autosaved to the previous project.",'unlinked');return Promise.resolve(false);}
      if(pending&&pending.identity!==capturedIdentity){uncommitted(null,"The current work changed and was separated from the previous save target.",'unlinked');pending=recovery;}
      return run(async()=>{
        if(getIdentity()!==capturedIdentity){uncommitted(null,"The current work changed and was not saved to the previous entry.",'unlinked');return false;}
        await persistCurrent(raw);
        if(getIdentity()!==capturedIdentity){uncommitted(null,"The current work changed while saving and was not saved to the previous entry.",'unlinked');return false;}
        if(pending){const prior=pending.id&&records.get(pending.id),entry=prior?{...prior,raw,updatedAt:time()}:record(raw,false,new Set(),pending.documentKind||activeKind);if(pending.id&&!prior&&validId(pending.id))entry.id=pending.id;await commit({put:[entry],activeId:entry.id});if(getIdentity()!==capturedIdentity){uncommitted(null,"The current document changed while saving and was not linked to the previous entry.",'unlinked');return false;}bind(entry.id);notice=activeKind==='project'?"Project saved in the app.":"Generation history saved in the app.";return true;}
        if(id){await saveBound(raw,id);if(getIdentity()!==capturedIdentity){uncommitted(null,"The current document changed while saving and was not linked to the previous entry.",'unlinked');return false;}return true;}
        if(!hasWork(raw))return true;
        const entry=record(raw,false,new Set(),activeKind);await commit({put:[entry],activeId:entry.id});if(getIdentity()!==capturedIdentity){uncommitted(null,"The current document changed while saving and was not linked to the previous entry.",'unlinked');return false;}bind(entry.id);return true;
      },{allowRecovery:true});
    }
    function transition(kind,value){
      let target=kind==='switch'?records.get(value):kind==='generation'?lastGeneration():null;
      if(kind==='switch'&&!target)return rejected("The project could not be found in the list.");
      if(kind==='switch'&&value===activeId)return saveCurrent();
      if(kind==='import')try{document(value);}catch(failure){error=message(failure);publish();return Promise.resolve(false);}
      return run(async()=>{
        if(kind==='switch'){target=records.get(value);if(!target)fail("The project was removed from the list and was not opened.");}
        if(kind==='generation')target=lastGeneration();
        const prior=await saveBeforeTransition();
        if(prior.identity!==getIdentity()){uncommitted(null,"The current work changed while saving. The previous switch was stopped.",'unlinked');return false;}
        if(prior.raw!==capture()||JSON.stringify(prior.draft)!==JSON.stringify(getDraft())){notice="Your latest edits and input were preserved. The project switch was stopped.";return false;}
        if(isBusy())return false;
        const accepted=kind==='new'||kind==='generation'&&!target?await reset():await load(kind==='switch'||kind==='generation'?target.raw:value);
        if(!accepted){notice="Project switch canceled.";return false;}
        const identity=getIdentity();
        const documentKind=kind==='generation'?'generation':kind==='switch'?kindOf(target):'project';
        try{const raw=kind==='new'||kind==='generation'&&!target?capture():kind==='switch'||kind==='generation'?target.raw:value;document(raw);
          const existing=kind==='switch'||kind==='generation'&&target;
          if(!existing)target=record(raw,false,new Set(),documentKind);else target=records.get(target.id);
          setDraft(drafts.get(target.id)||{text:'',start:0,end:0});
          await persistCurrent(raw);
          if(identity!==getIdentity())fail("The current project changed while saving.");
          await commit({put:existing?[]:[target],activeId:target.id});
        }catch(failure){if(identity!==getIdentity())uncommitted(null,message(failure),'unlinked');else uncommitted(target?.id||null,message(failure),'commit',documentKind);return false;}
        if(identity!==getIdentity()){uncommitted(null,"The current document changed while saving.",'unlinked',documentKind);return false;}
        bind(target.id);notice=activeKind==='project'?"Project saved and opened.":"Generation history opened.";return true;
      },{transition:true});
    }
    function openGeneration(){
      if(available&&!transitioning&&!recovery&&activeKind==='generation'){
        if(activeId&&getIdentity()!==boundIdentity){uncommitted(null,"The document changed and was not linked to the previous generation history.",'unlinked');return Promise.resolve(false);}
        return Promise.resolve(true);
      }
      return transition('generation');
    }
    function saveAsProject(){
      if(activeKind==='project'&&!recovery)return saveCurrent();
      try{const doc=document(capture());if(!doc.versions.length&&!['name','brief','appearance','detail','notes','prompt'].some(key=>doc.brief[key].trim()))return rejected("Generate an image or enter some work before saving it as a project.");}catch(failure){error=message(failure);publish();return Promise.resolve(false);}
      return run(async()=>{
        const prior=await saveBeforeTransition();
        if(prior.identity!==getIdentity()||prior.raw!==capture()||JSON.stringify(prior.draft)!==JSON.stringify(getDraft())){notice="Your latest work and input were preserved. Project saving was stopped.";return false;}
        if(isBusy())return false;
        const target=record(prior.raw,false,new Set(),'project');await commit({put:[target],activeId:target.id});
        if(prior.identity!==getIdentity()||prior.raw!==capture()||JSON.stringify(prior.draft)!==JSON.stringify(getDraft())){uncommitted(null,"The current work changed while saving and was not linked to the new project.",'unlinked','generation');return false;}
        drafts.set(target.id,prior.draft);bind(target.id);notice="Current work saved as a new project.";return true;
      },{transition:true});
    }
    function remove(id){if(id===activeId||id===persistedActiveId)return rejected("The current project cannot be removed from the list. Open another project first.");return run(async()=>{if(!records.has(id))return false;await commit({remove:[id]});drafts.delete(id);notice="Removed from the app list only. External project files are unchanged.";return true;});}
    function setFavorite(id,value){if(typeof value!=='boolean')return rejected("Check the favorite value.");return run(async()=>{const previous=records.get(id);if(!previous)return false;await commit({put:[{...previous,favorite:value}]});return true;});}
    async function rebindCurrent(){
      if(!available||transitioning)return false;const owner=activeId||recovery?.ownerId,previous=records.get(owner);
      try{if(previous&&canonical(capture())===canonical(previous.raw)){bind(owner);publish();return true;}}catch{/* A foreign document is never converted into a fabricated v1 entry. */}
      uncommitted(null,"The current work was not linked to the image project list.",'unlinked');return false;
    }
    return Object.freeze({init,getState,getRecentImages,subscribe(listener){if(typeof listener!=='function')fail("A subscription callback is required.");listeners.add(listener);listener(getState());return()=>listeners.delete(listener);},saveCurrent,saveAsProject,openGeneration,newProject:()=>transition('new'),importProject:raw=>transition('import',raw),switchTo:id=>transition('switch',id),remove,setFavorite,rebindCurrent,flush:()=>queue});
  }
  return Object.freeze({create,createIndexedDBStore});
});

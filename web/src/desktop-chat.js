/* Installable-only AI chat view (Codex or Claude). No network, filesystem, authentication or model
 * implementation lives here: the constrained preload owns those operations. */
(function(root,factory){
  'use strict';
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else {root.PankekiDesktopChat=api;if(root.document&&root.PankekiStudio)api.mount(root.document);}
})(typeof globalThis==='object'?globalThis:this,function(root){
  'use strict';
  const STATES=new Set(['missing','signed-out','idle','starting','ready','busy','error']);
  const copy=value=>JSON.parse(JSON.stringify(value));
  const uiMessage=value=>root.PankekiUIStrings?.message(value)??String(value??'');
  const safeText=(value,limit=4000)=>typeof value==='string'?value.slice(0,limit):'';
  const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(value);
  const PROVIDERS={codex:'Codex',claude:'Claude'};
  function buildInformation(value={},rendererSourceId=null){
    const id=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x)?x:null,compare=(a,b)=>!a||!b?'unknown':a===b?'match':'mismatch';
    const sourceId=id(value?.source_id),htmlId=id(value?.html_source_id),htmlHash=id(value?.html_sha256),desktopSourceId=id(value?.desktop_source_id),bundleId=id(value?.electron_bundle_id),rendererId=id(rendererSourceId),processSourceId=id(value?.process_source_id);
    return {sourceId,htmlId,htmlHash,desktopSourceId,bundleId,rendererId,processSourceId,htmlStatus:compare(sourceId,htmlId),rendererStatus:compare(sourceId,rendererId),bundleStatus:compare(desktopSourceId,bundleId),processStatus:compare(sourceId,processSourceId)};
  }
  const providerName=state=>PROVIDERS[state?.codex?.provider]||PROVIDERS.codex;
  const TITLES={missing:'{name} is unavailable.','signed-out':'Sign in to {name}.',idle:'{name} ready to connect',starting:'Connecting to {name}',ready:'{name} ready',busy:'{name} responding',error:'{name} connection error'};
  // The bridge reports account limits as code 'codex' with the provider's own
  // English text, so the message is checked as well as the code.
  const isLimit=error=>/limit|quota|rate/i.test(safeText(error?.code,80))||/usage limit|rate limit|quota/i.test(safeText(error?.message));
  const withoutLinks=text=>text.replace(/https?:\/\/\S+/g,'').replace(/\s{2,}/g,' ').trim();
  function limitNotice(error,name='Codex'){
    const retry=/try again (?:at|after) ([^.]{3,60})/i.exec(safeText(error?.message));
    return name+' usage limit reached.'+(retry?` ${withoutLinks(retry[1])} or later, try again.`:' Check the connection again shortly.');
  }
  function statusTitle(state){
    const name=providerName(state);
    if(state?.canceling)return name+' canceling';
    if(state?.phase==='limited')return name+' usage limit';
    if(state?.phase==='error')return name+' request error';
    const phaseTitles={connecting:'Connecting',preparing:'Preparing request',working:'Responding','waiting-job':'Waiting for image',done:'Reply complete',canceled:'Request canceled','needs-input':'More input needed'};
    if(phaseTitles[state?.phase])return name+' '+phaseTitles[state.phase];
    return (TITLES[state?.codex?.state]||TITLES.error).replace('{name}',name);
  }
  // Replies use a small Markdown subset: **bold**, `code`, # headings and -/1. lists.
  // Built from text nodes only, so model text can never become live markup.
  function inlineMarkdown(doc,parent,text){
    const pattern=/\*\*([^*\n]+)\*\*|`([^`\n]+)`/g;let last=0,match;
    while((match=pattern.exec(text))){
      if(match.index>last)parent.append(text.slice(last,match.index));
      const node=doc.createElement(match[1]!==undefined?'b':'code');node.textContent=match[1]??match[2];parent.append(node);
      last=pattern.lastIndex;
    }
    if(last<text.length)parent.append(text.slice(last));
  }
  function renderMarkdown(doc,container,text){
    const blocks=[];let list=null,paragraph=null;
    for(const line of String(text).split('\n')){
      const item=/^\s*(?:[-*•]|(\d{1,3})[.)])\s+(.*)$/.exec(line);
      if(item){
        const ordered=item[1]!==undefined;
        if(!list||list.ordered!==ordered){list={ordered,node:doc.createElement(ordered?'ol':'ul')};if(ordered&&item[1]!=='1')list.node.setAttribute('start',item[1]);blocks.push(list.node);}
        const entry=doc.createElement('li');inlineMarkdown(doc,entry,item[2]);list.node.append(entry);paragraph=null;continue;
      }
      list=null;
      if(!line.trim()){paragraph=null;continue;}
      const heading=/^#{1,6}\s+(.*)$/.exec(line);
      if(heading){const node=doc.createElement('p'),bold=doc.createElement('b');inlineMarkdown(doc,bold,heading[1]);node.append(bold);blocks.push(node);paragraph=null;continue;}
      if(paragraph)paragraph.append('\n');else{paragraph=doc.createElement('p');blocks.push(paragraph);}
      inlineMarkdown(doc,paragraph,line);
    }
    container.replaceChildren(...blocks);
  }
  function checkedImageMessage(value,intent){
    if(typeof value!=='string')throw Error('Validated image operation settings are required.');
    const lines=value.split('\n'),match=/^\[Pankeki settings: (.*)\]$/.exec(lines[1]||'');
    if(lines[0]!==`[Pankeki action: ${intent}]`||!match)throw Error('Check the image operation settings binding.');
    const settings=JSON.parse(match[1]);
    const keys=new Set(['mode','prompt','negative','model_id','seed','width','height','steps','cfg','sampler','scheduler','denoise','roi','halo','feather','cache','preview','preview_interval','edit_operation','target_color','source_color','color_tolerance']);
    if(!settings||Array.isArray(settings)||typeof settings!=='object'||Object.entries(settings).some(([key,item])=>!keys.has(key)||item!==null&&!['string','number','boolean'].includes(typeof item)||typeof item==='number'&&!Number.isFinite(item)||typeof item==='string'&&/data:image\//i.test(item)))throw Error('Only validated settings may be sent with image operations.');
    return value;
  }
  function normalizeStatus(value){
    const status=value?.codex||value||{};
    return {state:STATES.has(status.state)?status.state:'error',provider:PROVIDERS[status.provider]?status.provider:'codex',toolsReady:status.toolsReady===true,modelId:safeText(status.modelId,120)||'default',modelRevision:Number.isSafeInteger(status.modelRevision)?status.modelRevision:0,
      lastError:status.lastError?{code:safeText(status.lastError.code,80),message:safeText(status.lastError.message)}:null};
  }
  // waitLimitMs: how long a finished reply may wait for its image result before
  // the panel gives the request up, so sending is never blocked indefinitely.
  function createController({ipc,adapter,subscribe,onChange=()=>{},makeId=()=>root.crypto.randomUUID(),resolveResult,formatMessage,beforeSend,getAutomaticContext=()=>({visibleCandidateId:null,generationStyle:null}),isWorkspaceBusy=()=>false,waitLimitMs=5*60000}={}){
    let dead=false,active=null,eventQueue=Promise.resolve(),unsubscribeEvents,unsubscribeStudio,catalogEpoch=0;
    let identity=adapter.getState();
    const state={codex:{state:'idle',provider:'codex',toolsReady:false,lastError:null},phase:'idle',notice:'Checking connection…',projectId:identity.projectId,messages:[],contextEpoch:0,activeRequestId:null,submittedTargetId:null,resolvedIntent:null,modelSaving:false,canceling:false,modelOptions:{provider:'codex',loading:false,options:[],error:'',availability:'unverified'},lastFailure:null,appBuild:{}};
    const snapshot=()=>copy(state);
    function publish(){if(!dead)onChange(snapshot());}
    function matches(request){return !dead&&active===request&&request.projectId===identity.projectId;}
    function referenceCurrent(request){
      if(request.operation!=='recompose')return true;
      const current=getAutomaticContext();return current.selectionEpoch===request.presentation?.selectionEpoch&&current.referenceCandidateId===request.presentation?.referenceCandidateId;
    }
    function finish(request,phase,notice){
      if(!matches(request))return;
      clearTimeout(request.waitTimer);
      if(['error','limited'].includes(phase))state.lastFailure={requestId:request.requestId,text:request.text,code:state.lastFailure?.requestId===request.requestId?state.lastFailure.code:phase};
      adapter.endRequest({requestId:request.requestId});active=null;state.activeRequestId=null;state.submittedTargetId=null;state.resolvedIntent=null;state.phase=phase;state.notice=notice;publish();
    }
    function errorState(error){
      const limited=isLimit(error);
      state.phase=limited?'limited':'error';state.notice=limited?limitNotice(error,providerName(state)):withoutLinks(uiMessage(safeText(error?.message)))||'Check the connection, then send again.';
      return state.phase;
    }
    const readyNotice=()=>state.codex.state==='ready'?'Enter a message to send.':state.codex.state==='signed-out'?providerName(state)+' requires sign-in.':'Check the connection.';
    function applyStatus(value,initial=false){const incoming=value?.codex||value||{};if(!initial&&(incoming.provider&&incoming.provider!==state.codex.provider||Number.isSafeInteger(incoming.modelRevision)&&incoming.modelRevision<state.codex.modelRevision))return;state.codex=normalizeStatus({...state.codex,...incoming});if(state.codex.lastError&&isLimit(state.codex.lastError))errorState(state.codex.lastError);else if(state.phase==='idle')state.notice=readyNotice();publish();}
    async function retire(reason='cancel'){
      const request=active;if(!request)return false;
      clearTimeout(request.waitTimer);
      // Retire locally before awaiting interrupt: a late delta/result can never
      // become current merely because the main process is slow to acknowledge.
      adapter.endRequest({requestId:request.requestId});active=null;state.activeRequestId=null;state.submittedTargetId=null;state.resolvedIntent=null;state.canceling=true;
      state.phase=['tools-unavailable','job-scope'].includes(reason)?'error':'canceled';state.notice=reason==='project'?'The project changed, so the previous response was stopped.':reason==='source'?'The source or mask changed, so the previous response was stopped.':reason==='selection'?'The reference selection changed. The previous composition result was not applied.':reason==='unexpected-tool'?'An image operation started outside the verified request scope. The request was stopped.':reason==='tools-unavailable'?'Check the Pankeki image tool connection, then try again.':reason==='job-scope'?'No image job could be verified for this request, so the response was stopped.':'Request canceled. Pending image results will not be added.';publish();
      try{await ipc.cancelMessage({requestId:request.requestId});}catch{/* Local retirement remains effective. */}
      finally{state.canceling=false;publish();}
      return true;
    }
    function syncProject(){
      const next=adapter.getState(),changed=next.projectId!==identity.projectId;
      const sourceChanged=next.sourceRevision!==identity.sourceRevision||next.maskRevision!==identity.maskRevision;
      identity=next;
      if(changed){
        const hadRequest=!!active;void retire('project');state.projectId=next.projectId;state.messages=[];state.contextEpoch=0;
        // A request error belongs to the old project; an account limit does not.
        if(!hadRequest&&state.phase!=='limited'){state.phase='idle';state.notice=readyNotice();}
        publish();
      }
      else if(sourceChanged&&active)void retire('source');
    }
    async function handle(event){
      if(dead||!event||typeof event!=='object')return;
      if(event.type==='status'){
        if(event.requestId&&(!active||event.requestId!==active.requestId||event.projectId!==active.projectId))return;
        applyStatus(event.payload);return;
      }
      const request=active;
      if(!request||event.requestId!==request.requestId||event.projectId!==request.projectId||!matches(request))return;
      const revision=event.context?.sourceRevision??event.sourceRevision;
      if(revision!==request.context.sourceRevision)return;
      if(event.seq!==undefined){if(!Number.isSafeInteger(event.seq)||event.seq<=request.seq)return;request.seq=event.seq;}
      const payload=event.payload||{};
      const automatic=request.context.intent==='auto';
      // A native pre-start refusal is not a started mutation or a failed winner.
      // The native owner reports genuine request failure via error/failed/needs-input.
      if(automatic&&event.type==='tool-completed'&&payload.ok===false)return;
      if(event.type==='intent-resolved'){
        if(!automatic||!['chat','generate','edit'].includes(payload.intent)||
          (payload.intent==='edit'?!['regenerate','recolor','recompose'].includes(payload.operation):payload.operation!==undefined))return;
        if(request.resolvedIntent)return;
        const accepted=await adapter.receiveEvent({requestId:request.requestId,projectId:request.projectId,sourceRevision:request.context.sourceRevision,
          type:'intent-resolved',payload:{intent:payload.intent,...(payload.operation?{operation:payload.operation}:{})}});
        if(!matches(request)||!accepted?.accepted)return;
        request.resolvedIntent=payload.intent;request.operation=payload.operation;state.resolvedIntent=payload.intent;if(payload.operation==='recompose')state.notice='Creating a new composition candidate from this image.';publish();return;
      }
      const intent=automatic?request.resolvedIntent:request.context.intent;
      const mutationIntent=payload.tool==='pankeki_generate'?'generate':payload.tool==='pankeki_edit'?'edit':null;
      if(['tool-started','tool-completed'].includes(event.type)&&mutationIntent){
        if(intent!==mutationIntent){await retire('unexpected-tool');return;}
        if(automatic&&!state.codex.toolsReady){await retire('tools-unavailable');return;}
      }
      if(event.type==='turn-started'){state.phase='working';state.notice=providerName(state)+' is responding.';}
      else if(event.type==='message-delta')request.reply.text=(request.reply.text+safeText(payload.text,100000)).slice(0,100000);
      else if(event.type==='message')request.reply.text=safeText(payload.text,100000);
      else if(event.type==='tool-started'){if(mutationIntent)request.expectedImage=true;state.notice=request.operation==='recompose'?'Creating a new composition candidate from this image.':'Checking the Pankeki image operation…';}
      else if(event.type==='tool-completed'){
        if(payload.ok===false){state.notice='The Pankeki operation could not be completed.';publish();return;}
        if(payload.jobId&&(intent==='chat'||automatic&&(!intent||!mutationIntent&&!request.jobs.has(payload.jobId)))){publish();return;}
        if(payload.jobId){
          if(request.jobs.get(payload.jobId)==='terminal'){publish();return;}
          const ref={requestId:request.requestId,projectId:request.projectId,sourceRevision:request.context.sourceRevision};
          const jobState=['queued','submitting','running','canceling','succeeded','failed','canceled','uncertain','orphaned'].includes(payload.jobStatus)?payload.jobStatus:payload.resultId?'succeeded':'queued';
          const acceptedJob=await adapter.receiveEvent({...ref,type:'job',payload:{jobId:payload.jobId,state:jobState}});
          if(!matches(request))return;
          if(automatic&&!acceptedJob?.accepted){await retire('job-scope');return;}
          request.expectedImage=true;
          request.jobs.set(payload.jobId,['failed','canceled','uncertain','orphaned'].includes(jobState)?'terminal':'pending');
          state.notice=jobState==='orphaned'?'The server restarted. The previous job was not automatically resubmitted. Check its result status.':payload.resultId?'Adding the image result to candidates…':'The Pankeki image operation is in progress.';
          if(payload.resultId){
            const resolver=resolveResult||ipc.resolveResult;
            if(typeof resolver!=='function'){state.notice='The local image-result connection is not ready.';publish();return;}
            const result=await resolver.call(ipc,{...ref,jobId:payload.jobId,resultId:payload.resultId});
            if(!matches(request))return;
            if(!referenceCurrent(request)){await retire('selection');return;}
            const accepted=await adapter.receiveEvent({...ref,type:'result',selectionCurrent:()=>referenceCurrent(request),payload:{...result,jobId:payload.jobId}});
            // A successful commit may itself advance the recent-image fallback.
            if(!accepted.accepted&&!referenceCurrent(request)){await retire('selection');return;}
            if(accepted.accepted&&accepted.candidateId){request.reply.candidateIds ||= [];if(!request.reply.candidateIds.includes(accepted.candidateId))request.reply.candidateIds.push(accepted.candidateId);}
            if(!matches(request))return;
            request.jobs.set(payload.jobId,'terminal');
            state.notice=accepted.accepted?'Result added to the canvas and candidates.':'The source or document changed. This result was not applied.';
          }
          if(request.turnDone&&request.jobs.size&&[...request.jobs.values()].every(value=>value==='terminal')){finish(request,'done',state.notice);return;}
        }
      }
      else if(event.type==='needs-input'){
        finish(request,'needs-input',payload.reason==='mask'?'Paint the area to edit or import a mask.':payload.reason==='target'?'Open the visible image for editing and paint the area to change.':payload.reason==='capability'?'The selected source and mask could not be prepared. Check the area on the same image.':'Import a source image to edit first.');return;
      }
      else if(event.type==='error'){
        state.lastFailure={requestId:request.requestId,text:request.text,code:safeText(payload.code,80)};const phase=errorState(payload);finish(request,phase,state.notice);return;
      }
      else if(event.type==='turn-completed'){
        const canceled=['canceled','cancelled','interrupted'].includes(payload.status);
        request.turnDone=true;
        if(automatic&&!intent&&!canceled&&payload.status!=='failed'){finish(request,'error','The request type could not be verified. Send the message again.');return;}
        if(!canceled&&payload.status!=='failed'&&request.expectedImage&&(!request.jobs.size||[...request.jobs.values()].some(value=>value==='pending'))){
          state.phase='waiting-job';state.notice='The reply is complete. Waiting for the image job result; cancel the request to stop waiting.';
          request.waitTimer=setTimeout(()=>{if(matches(request)&&state.phase==='waiting-job')finish(request,'error','The request ended without an image result. The job may continue, but its result will not be added to candidates. Submit a new request.');},waitLimitMs);
          publish();return;
        }
        finish(request,canceled?'canceled':payload.status==='failed'?'error':'done',canceled?'Request canceled.':payload.status==='failed'?'The reply could not be completed.':'Reply complete.');return;
      }
      publish();
    }
    function onEvent(event){
      const owner=active&&event?.requestId===active.requestId&&event?.projectId===active.projectId?active:null;
      eventQueue=eventQueue.then(()=>handle(event)).catch(error=>{if(owner&&matches(owner)){const phase=errorState(error);finish(owner,phase,state.notice);}});
      return eventQueue;
    }
    async function start(){
      unsubscribeEvents=ipc.onCodexEvent(onEvent);
      if(subscribe)unsubscribeStudio=subscribe(syncProject);
      try{const status=await ipc.getStatus();if(!dead){state.appBuild=status?.app?.build||{};applyStatus(status,true);void loadChatModels();}}catch(error){if(!dead){errorState(error);state.codex.state='error';publish();}}
      return snapshot();
    }
    async function refreshBuildInformation(){
      try{const status=await ipc.getStatus();if(!dead){state.appBuild=status?.app?.build||{};publish();}}
      catch{if(!dead){state.appBuild={};publish();}}
    }
    async function connect(){
      if(settingsLocked())return false;
      state.codex.state='starting';state.phase='connecting';state.notice=providerName(state)+' connection is being prepared.';publish();
      try{const status=await ipc.connectCodex();if(dead)return false;applyStatus(status);state.phase='idle';state.notice=state.codex.state==='signed-out'?providerName(state)+' sign-in must finish before checking the connection again.':'Connection checked.';publish();return true;}
      catch(error){if(!dead){state.codex.state='error';errorState(error);publish();}return false;}
    }
    async function send({text,intent='chat',includeEditAssets=false}={}){
      if(settingsLocked()||state.codex.state!=='ready'||state.phase==='limited')return false;
      if(typeof text!=='string'||!text.trim()||text.length>4000){state.notice='Enter a message between 1 and 4,000 characters.';publish();return false;}
      if(intent!=='chat'&&intent!=='auto'&&!state.codex.toolsReady){state.notice='Check the Pankeki image tool connection, then try again.';publish();return false;}
      syncProject();let context,request;
      try{
        beforeSend?.({intent});syncProject();const presentation=intent==='auto'?getAutomaticContext():null;
        context=adapter.captureContext({intent,...(presentation||{includeEditAssets})});
        let wireText;
        if(intent==='chat')wireText='[Pankeki action: chat]\n이 요청은 대화만 합니다. 이미지 생성·수정 도구를 실행하지 마세요.\n'+text.trim();
        else {
          const formatter=formatMessage||adapter.formatMessage;
          if(typeof formatter!=='function')throw Error('Check the image operation settings connection, then try again.');
          const formatted=formatter.call(adapter,{text:text.trim(),intent,context});
          if(intent==='auto'){
            if(!context.automatic||typeof context.automatic!=='object'||Array.isArray(context.automatic)||formatted!=='[Pankeki action: auto]\n'+text.trim())throw Error('Check the automatic request context binding.');
            wireText=formatted;
          }else wireText=checkedImageMessage(formatted,intent);
        }
        if(typeof wireText!=='string'||!wireText.trim()||wireText.length>8000)throw Error('Keep the operation description and settings within 8,000 characters.');
        request={requestId:makeId(),projectId:context.projectId,context,presentation:presentation?{referenceCandidateId:presentation.referenceCandidateId,selectionEpoch:presentation.selectionEpoch}:null,resolvedIntent:intent==='auto'?null:intent,text:text.trim(),seq:-1,jobs:new Map(),turnDone:false,expectedImage:false};
        if(!adapter.beginRequest({requestId:request.requestId,context,provider:providerName(state)}).accepted)throw Error('The source or document changed. Review your input.');
        request.reply={role:'assistant',requestId:request.requestId,text:'',contextEpoch:state.contextEpoch,provider:providerName(state),modelLabel:state.modelOptions.options.find(item=>item.id===state.codex.modelId)?.displayName||state.codex.modelId};active=request;
        state.activeRequestId=request.requestId;state.submittedTargetId=presentation?.referenceCandidateId||presentation?.visibleCandidateId||null;state.resolvedIntent=request.resolvedIntent;state.phase='preparing';state.notice='Preparing message…';
        state.messages.push({role:'user',requestId:request.requestId,text:text.trim(),contextEpoch:state.contextEpoch},request.reply);publish();
        const outbound={sourceRevision:context.sourceRevision};
        if(intent==='edit'||intent==='auto'&&(context.source||context.mask)){
          if(!context.source||intent==='edit'&&!context.mask||context.automatic?.edit.ready&&!context.mask)throw Error('Prepare the source and mask from the same image.');
          if(typeof ipc.prepareEditContext!=='function')throw Error('The local source and mask connection is not ready.');
          const source=typeof adapter.prepareSource==='function'?await adapter.prepareSource(context):context.source;
          if(!matches(request))return false;
          const prepared=await ipc.prepareEditContext({sourceDataUrl:source.dataUrl,...(context.mask?{maskDataUrl:context.mask.dataUrl}:{}),sourceRevision:context.sourceRevision,projectId:context.projectId});
          if(!matches(request))return false;
          syncProject();if(!matches(request))return false;
          if(prepared?.projectId!==context.projectId||prepared?.sourceRevision!==context.sourceRevision||!validId(prepared?.sourceId)||context.mask&&!validId(prepared?.maskId))throw Error('Could not prepare the source and mask.');
          if(presentation){const current=getAutomaticContext();if(current.selectionEpoch!==presentation.selectionEpoch||current.referenceCandidateId!==presentation.referenceCandidateId)throw Error('The reference selection changed. Send again.');}
          outbound.sourceId=prepared.sourceId;if(context.mask)outbound.maskId=prepared.maskId;
        }
        if(!matches(request))return false;
        state.phase='working';state.notice=providerName(state)+' is responding.';publish();
        await ipc.sendMessage({text:wireText,projectId:request.projectId,requestId:request.requestId,context:outbound,...(intent==='auto'?{automatic:context.automatic}:{})});
        return true;
      }catch(error){
        if(request&&!matches(request))return false;
        const phase=errorState(error);
        if(request)finish(request,phase,state.notice);else publish();
        return false;
      }
    }
    function conversationLocked(){return dead||!!active||state.canceling||state.modelSaving||state.phase==='connecting'||['starting','busy'].includes(state.codex.state);}
    function settingsLocked(){return conversationLocked()||isWorkspaceBusy();}
    async function loadChatModels(){
      if(dead||typeof ipc.getChatModelOptions!=='function')return false;
      const epoch=++catalogEpoch,provider=state.codex.provider,revision=state.codex.modelRevision;
      const ownsCatalog=()=>!dead&&epoch===catalogEpoch&&provider===state.codex.provider;
      state.modelOptions={...state.modelOptions,provider,loading:true,error:''};publish();
      try{
        const value=await ipc.getChatModelOptions({provider});
        if(!ownsCatalog())return false;
        if(value?.provider!==provider||!Number.isSafeInteger(value.modelRevision)||value.modelRevision<revision)throw Error('stale-catalog');
        if(value.modelRevision<state.codex.modelRevision){state.modelOptions.error='The model selection changed. Refresh the list.';return false;}
        // Reading metadata may legitimately restore a persisted model and raise
        // the native revision before or after its matching status event.
        const options=Array.isArray(value.options)?value.options.filter(item=>typeof item.id==='string'&&item.id.length>0&&item.id.length<=120&&typeof item.displayName==='string').slice(0,100).map(item=>({id:item.id,displayName:safeText(item.displayName,120)})):[];
        state.modelOptions={provider,loading:false,options,availability:'unverified',source:safeText(value.source,80),error:value.errorCode||!options.length?'Could not retrieve models. Check the connection and refresh the list.':''};
        if(typeof value.selectedModelId==='string'){state.codex.modelId=value.selectedModelId;state.codex.modelRevision=value.modelRevision;}
        return !state.modelOptions.error;
      }catch(error){if(ownsCatalog())state.modelOptions={provider,loading:false,options:[],availability:'unverified',error:'Could not retrieve models. Check the connection and refresh the list.'};return false;}
      finally{if(ownsCatalog()){state.modelOptions.loading=false;publish();}}
    }
    async function selectProvider(provider){
      if(settingsLocked()||!PROVIDERS[provider]||typeof ipc.selectProvider!=='function')return false;
      ++catalogEpoch;state.modelSaving=true;publish();
      try{const value=await ipc.selectProvider({provider});if(dead)return false;state.codex=normalizeStatus(value);state.phase='idle';state.notice=providerName(state)+' selected. Your draft was preserved.';state.modelOptions={provider,loading:false,options:[],error:'',availability:'unverified'};return true;}
      catch(error){if(!dead){state.modelOptions.error='Could not change the AI provider. The previous selection was preserved.';}return false;}
      finally{if(!dead){state.modelSaving=false;publish();void loadChatModels();}}
    }
    async function setChatModel(modelId){
      if(settingsLocked()||state.modelOptions.loading||typeof ipc.setChatModel!=='function'||!state.modelOptions.options.some(item=>item.id===modelId))return false;
      const provider=state.codex.provider,ownerProjectId=state.projectId,ownerContextEpoch=state.contextEpoch; ++catalogEpoch;state.modelSaving=true;state.modelOptions.error='';publish();
      try{
        const value=await ipc.setChatModel({provider,modelId});
        if(dead||provider!==state.codex.provider)return false;
        if(value?.provider!==provider||value.selectedModelId!==modelId||!Number.isSafeInteger(value.modelRevision)||value.modelRevision<state.codex.modelRevision)throw Error('stale-model');
        state.codex.modelId=modelId;state.codex.modelRevision=value.modelRevision;
        const contextReset=value.conversationReset===true&&state.projectId===ownerProjectId&&state.contextEpoch===ownerContextEpoch;
        if(contextReset)state.contextEpoch++;
        state.notice=contextReset?'AI model changed and a new AI context started. Earlier conversation and your draft were preserved.':value.conversationReset===true?'AI model changed. Your current work and draft were preserved.':'Keeping the current AI model.';return true;
      }catch(error){if(!dead)state.modelOptions.error='Could not save model settings. The previous model and your draft were preserved.';return false;}
      finally{if(!dead){state.modelSaving=false;publish();}}
    }
    function destroy(){if(dead)return;void retire();dead=true;unsubscribeEvents?.();unsubscribeStudio?.();}
    return Object.freeze({start,connect,send,refreshBuildInformation,selectProvider,loadChatModels,setChatModel,settingsLocked,conversationLocked,cancel:()=>retire(),destroy,getState:snapshot});
  }
  function mount(doc,{ipc=root.pankekiDesktop,studio=root.PankekiStudio,workflow=root.PankekiWorkflowController}={}){
    if(!ipc||!studio?.desktopChat||!['getStatus','connectCodex','sendMessage','cancelMessage','onCodexEvent'].every(name=>typeof ipc[name]==='function'))return null;
    const find=id=>doc.getElementById(id),form=find('pkPromptForm'),workspace=form?.pankekiComposer,input=find('pcPrompt'),modelPanel=find('pcModelPanel');
    if(!workspace||!input||!modelPanel||find('desktopChatControls'))return null;
    const listeners=[],listen=(node,type,fn)=>{node.addEventListener(type,fn);listeners.push(()=>node.removeEventListener(type,fn));};
    const controls=doc.createElement('div');controls.id='desktopChatControls';controls.className='pc-ai-controls';
    controls.innerHTML='<button type="button" id="desktopChatSelectedModel" class="pc-setting-button" aria-label="AI provider and model settings"></button><button type="button" id="desktopChatConnect" class="pc-setting-button">Check connection</button>';
    form.prepend(controls);
    const settings=doc.createElement('section');settings.className='pc-ai-model-settings';settings.id='desktopModelSettings';
    settings.innerHTML='<fieldset><legend>AI chat</legend><label for="desktopChatProvider">AI provider</label><select id="desktopChatProvider"><option value="codex">Codex</option><option value="claude">Claude</option></select><label for="desktopChatModel">Model</label><select id="desktopChatModel" disabled></select><p id="desktopChatModelHelp" class="hint" role="status"></p><button type="button" id="desktopChatModelsRefresh" class="text-button">Refresh models</button></fieldset><fieldset><legend>Generate images</legend><label for="desktopGenerationModel">Generation model</label><select id="desktopGenerationModel" disabled></select><p id="desktopGenerationModelHelp" class="hint" role="status"></p></fieldset><fieldset><legend>Selected-area edit</legend><label for="desktopEditModel">Edit model</label><select id="desktopEditModel" disabled></select><p id="desktopEditModelHelp" class="hint" role="status"></p></fieldset><p id="desktopImageSettingsHelp" class="hint" role="status"></p>';
    const information=doc.createElement('details');information.id='desktopBuildInformation';information.dataset.pkSettingsSection='environment';information.className='pc-build-information';
    information.innerHTML='<summary>App information and build identifiers</summary><p id="desktopBuildStatus" role="status"></p><dl id="desktopBuildIdentifiers"></dl><p class="hint">Startup identifiers describe the file bytes observed at that time. Module execution and image quality require separate verification.</p><button type="button" id="desktopBuildRefresh" class="text-button">Refresh identifiers</button>';
    const environmentSettings=modelPanel.querySelector('section[data-pk-settings-section="environment"]');(environmentSettings||settings).append(information);
    // The core picker stays in place for the shared adapter; only the three
    // model setting groups are exposed in the installed view. Keep preset reset
    // and numeric controls outside this hidden/inert presentation boundary.
    const legacyModelUI=[find('imageModel'),modelPanel.querySelector('label[for="imageModel"]'),find('imageModelHelp')].filter(Boolean).map(node=>({node,hidden:node.hidden,inert:node.inert}));
    for(const {node} of legacyModelUI){node.hidden=true;node.inert=true;}
    let controller=null,viewAlive=true;
    modelPanel.prepend(settings);workspace.registerSettings?.(settings);doc.body.classList.add('pankeki-desktop');workspace.bind({renderMarkdown,isLocked:()=>!controller||controller.settingsLocked(),isConversationLocked:()=>!controller||controller.conversationLocked(),refresh:()=>viewAlive&&controller&&renderState(controller.getState())});
    const drafts=new Map();let lastProject=null,draftVersion=0,composing=false,imageError='',latestState=null;
    const imageSettings=()=>typeof studio.getImageModelSettings==='function'?studio.getImageModelSettings():null;
    function choices(node,options,selected,placeholder){
      const key=JSON.stringify([options,selected,placeholder]);if(node.dataset.options===key)return;node.dataset.options=key;
      const nodes=[];if(!options.some(item=>item.id===selected)){const empty=doc.createElement('option');empty.value='';empty.textContent=placeholder;empty.disabled=true;nodes.push(empty);}
      for(const item of options){const option=doc.createElement('option');option.value=item.id;option.textContent=item.displayName||item.label||item.id;if(item.available===false){option.disabled=true;option.textContent+=' · '+(uiMessage(item.reason)||'Unavailable');}nodes.push(option);}
      node.replaceChildren(...nodes);node.value=selected||'';
    }
    controller=createController({ipc,adapter:studio.desktopChat,subscribe:studio.subscribe,isWorkspaceBusy:()=>studio.getSummary().busy||imageSettings()?.busy===true||workspace.isPhotoBusy?.()===true||workspace.isProjectBusy?.()===true||studio.photoTools?.getState().locked===true,
      getAutomaticContext:()=>workspace.getAutomaticContext(),
      beforeSend:({intent})=>{if(doc.body.dataset.studioScreen==='compare')throw Error('Finish comparing before sending a message.');if(doc.body.dataset.studioScreen==='home')workspace.enterConversation();const mode=intent==='generate'?'txt2img':intent==='edit'?'inpaint':null;if(mode&&studio.getSummary().mode!==mode)studio.setMode(mode);},
      formatMessage:({text,intent,context})=>{if(typeof studio.desktopChat.formatMessage!=='function')throw Error('The image operation settings connection is not ready.');return studio.desktopChat.formatMessage({text:intent==='auto'?text:workspace.prepareText(text,intent),intent,context});},
      onChange:renderState});
    function renderState(state){
      if(!viewAlive)return;
      latestState=state;
      const marker=doc.querySelector?.('meta[name="pankeki-source-id"]')?.getAttribute('content'),build=buildInformation(state.appBuild,marker),labels={match:'Match',mismatch:'Mismatch',unknown:'Unknown'};
      find('desktopBuildStatus').textContent='Server startup source: '+labels[build.processStatus]+' · Served HTML: '+labels[build.htmlStatus]+' · Current renderer: '+labels[build.rendererStatus]+' · Electron startup bundle: '+labels[build.bundleStatus];
      const entries=[];
      for(const [label,value]of [['Current source on disk',build.sourceId],['Source at server startup',build.processSourceId],['Served HTML source',build.htmlId],['Current renderer source',build.rendererId],['Served HTML SHA',build.htmlHash],['Current desktop code on disk',build.desktopSourceId],['Bundle at Electron startup',build.bundleId]]){
        const term=doc.createElement('dt'),description=doc.createElement('dd');term.textContent=label;description.textContent=value||'Unknown · Not verified';entries.push(term,description);
      }
      find('desktopBuildIdentifiers').replaceChildren(...entries);
      if(lastProject!==state.projectId){if(lastProject!==null){input.value='';draftVersion++;drafts.clear();}lastProject=state.projectId;}
      const user=state.messages.find(message=>message.requestId===state.activeRequestId&&message.role==='user');
      if(user&&!drafts.has(user.requestId))drafts.set(user.requestId,{text:input.value,clearVersion:null});
      const failed=state.lastFailure&&drafts.get(state.lastFailure.requestId);
      if(failed&&failed.clearVersion===draftVersion&&input.value===''){input.value=failed.text;draftVersion++;failed.clearVersion=null;}
      workspace.render(state);
      const locked=controller.settingsLocked(),name=providerName(state),catalog=state.modelOptions,modelLabel=catalog.options.find(item=>item.id===state.codex.modelId)?.displayName||state.codex.modelId||'Default';
      const modelButton=find('desktopChatSelectedModel'),modelDescription='AI chat model: '+name+' · '+modelLabel;modelButton.textContent='AI chat · '+name+' · '+modelLabel;modelButton.setAttribute('aria-label',modelDescription);modelButton.setAttribute('title',modelDescription+' — Image generation and edit models are selected separately in settings.');
      find('desktopChatConnect').textContent=state.codex.state==='signed-out'?name+' sign-in':name+' Check connection';find('desktopChatConnect').disabled=locked||state.codex.state==='missing';
      for(const node of doc.querySelectorAll('[data-desktop-codex-copy]'))node.textContent=statusTitle(state);
      const photoBusy=workspace.isPhotoBusy?.()===true,photoState=workspace.getPhotoState?.();
      const projectState=workspace.getProjectState?.(),projectError=projectState?.error||projectState?.recovery&&'Retry app storage in Projects or save a project file.',feedback=find('pkComposerStatus');feedback.textContent=projectError|| (photoBusy&&!state.activeRequestId?'Apply or cancel image editing before sending a message.':statusTitle(state)+' · '+state.notice);feedback.classList.toggle('error',!!projectError||['error','limited'].includes(state.phase));feedback.setAttribute('role',projectError||['error','limited'].includes(state.phase)?'alert':'status');
      find('pkGenerate').disabled=locked||state.codex.state!=='ready'||state.phase==='limited'||!input.value.trim()||doc.body.dataset.studioScreen==='compare';
      find('pkGenerate').setAttribute('aria-label','Send message');
      find('pkCancel').hidden=!state.activeRequestId&&!state.canceling&&!photoBusy;find('pkCancel').textContent=state.canceling?'Canceling…':state.activeRequestId?'Cancel request':photoState?.cancelling?'Canceling image edit…':'Cancel image edit';find('pkCancel').disabled=state.canceling||!state.activeRequestId&&photoState?.cancelling===true;
      const provider=find('desktopChatProvider');provider.value=state.codex.provider;provider.disabled=locked||typeof ipc.selectProvider!=='function';
      choices(find('desktopChatModel'),catalog.options,state.codex.modelId,catalog.loading?'Checking models…':'Refresh the model list');
      find('desktopChatModel').disabled=locked||catalog.loading||!!catalog.error||!catalog.options.length||typeof ipc.setChatModel!=='function';
      find('desktopChatModelsRefresh').disabled=locked||catalog.loading||typeof ipc.getChatModelOptions!=='function';
      find('desktopChatModelHelp').textContent=catalog.error||(state.modelSaving?'Saving model settings…':typeof ipc.getChatModelOptions!=='function'?'This installation does not support individual model selection.':catalog.loading?'Checking models from the installed CLI…':'This list is supplied by the CLI. Model access and usage limits are verified when a request is made.');
      const images=imageSettings();
      for(const [key,id] of [['generation','desktopGenerationModel'],['edit','desktopEditModel']]){
        const value=images?.[key];choices(find(id),value?.models||[],value?.selectedId||'',images?.ready?'Select a model':'Checking image model');find(id).disabled=locked||!images?.ready||typeof studio.setImageModelSettings!=='function';
        find(id+'Help').textContent=uiMessage(value?.reason||images?.capabilityReason||(!images?.ready?images?.error||'Checking installed image models…':'Only installed, available models can be selected.'));
      }
      find('desktopImageSettingsHelp').textContent=imageError||images?.persistenceError||'';
      const editing=studio.getSummary().mode==='inpaint',imageValue=images?.[editing?'edit':'generation'],imageLabel=imageValue?.models?.find(item=>item.id===imageValue.selectedId)?.label||imageValue?.selectedId||'Checking',imageButton=find('pcModelName').closest('button');imageButton.hidden=false;imageButton.setAttribute('data-pk-setting-target',editing?'desktopEditModel':'desktopGenerationModel');imageButton.setAttribute('aria-label',`${editing?'Image edit':'Generate images'} model settings: ${imageLabel}`);
      find('pcModelName').textContent=imageLabel;imageButton.title=`${editing?'Image edit':'Generate images'} model settings: ${imageLabel}`;
      const width=Number(find('width').value),height=Number(find('height').value),size=Number.isSafeInteger(width)&&width>0&&Number.isSafeInteger(height)&&height>0?`${width} × ${height}`:'Check image size';
      const resolution=find('pcResolution');resolution.hidden=false;resolution.textContent=size;resolution.setAttribute('aria-label','Image size: '+size);resolution.title='Image size: '+size;
    }
    const unsubscribeProjects=workspace.subscribeProjectState?.(()=>renderState(controller.getState()));if(unsubscribeProjects)listeners.push(unsubscribeProjects);
    listen(find('desktopChatSelectedModel'),'click',()=>workspace.settings('model','desktopChatProvider'));
    listen(find('desktopChatConnect'),'click',()=>void controller.connect());
    listen(find('desktopChatProvider'),'change',event=>{if(controller.settingsLocked()){renderState(controller.getState());return;}return controller.selectProvider(event.target.value);});
    listen(find('desktopChatModel'),'change',event=>{if(controller.settingsLocked()){renderState(controller.getState());return;}return controller.setChatModel(event.target.value);});
    listen(find('desktopChatModelsRefresh'),'click',()=>{if(!controller.settingsLocked())return controller.loadChatModels();});
    listen(find('desktopBuildRefresh'),'click',()=>void controller.refreshBuildInformation());
    for(const [id,key] of [['desktopGenerationModel','generationModelId'],['desktopEditModel','editModelId']])listen(find(id),'change',event=>{
      if(controller.settingsLocked()){renderState(controller.getState());return;}
      try{if(typeof studio.setImageModelSettings!=='function')throw Error('This installation does not support model settings.');studio.setImageModelSettings({[key]:event.target.value});imageError='';}
      catch(error){imageError=uiMessage(safeText(error.message))||'Could not save image model settings.';}
      renderState(controller.getState());
    });
    listen(find('pkCancel'),'click',()=>{if(controller.getState().activeRequestId)void controller.cancel();else void workspace.cancelPhoto?.();});
    listen(input,'input',()=>{draftVersion++;renderState(controller.getState());});listen(input,'compositionstart',()=>composing=true);listen(input,'compositionend',()=>composing=false);
    listen(form,'submit',async event=>{event.preventDefault();if(composing||event.isComposing||doc.body.dataset.studioScreen==='compare')return;const text=input.value,version=draftVersion;
      const accepted=await controller.send({text,intent:'auto'});
      const state=controller.getState(),requestId=state.messages.at(-1)?.requestId;
      if(accepted&&input.value===text&&version===draftVersion&&state.lastFailure?.requestId!==requestId){input.value='';draftVersion++;const draft=drafts.get(requestId);if(draft)draft.clearVersion=draftVersion;}
      renderState(state);
    });
    listen(input,'keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&!composing&&event.keyCode!==229){event.preventDefault();if(!find('pkGenerate').disabled)return form.requestSubmit();}});
    const unsubscribeImages=studio.subscribe(()=>{if(latestState)renderState(controller.getState());});void controller.start();
    return Object.freeze({controller,destroy(){if(!viewAlive)return;viewAlive=false;controller.destroy();unsubscribeImages?.();listeners.forEach(remove=>remove());controls.remove();settings.remove();for(const {node,hidden,inert} of legacyModelUI){node.hidden=hidden;node.inert=inert;}workspace.unbind();doc.body.classList.remove('pankeki-desktop');}});
  }
  return Object.freeze({createController,mount,normalizeStatus,statusTitle,renderMarkdown,buildInformation});
});

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
  const safeText=(value,limit=4000)=>typeof value==='string'?value.slice(0,limit):'';
  const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(value);
  const PROVIDERS={codex:'Codex',claude:'Claude'};
  function buildInformation(value={},rendererSourceId=null){
    const id=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x)?x:null,compare=(a,b)=>!a||!b?'unknown':a===b?'match':'mismatch';
    const sourceId=id(value?.source_id),htmlId=id(value?.html_source_id),htmlHash=id(value?.html_sha256),desktopSourceId=id(value?.desktop_source_id),bundleId=id(value?.electron_bundle_id),rendererId=id(rendererSourceId),processSourceId=id(value?.process_source_id);
    return {sourceId,htmlId,htmlHash,desktopSourceId,bundleId,rendererId,processSourceId,htmlStatus:compare(sourceId,htmlId),rendererStatus:compare(sourceId,rendererId),bundleStatus:compare(desktopSourceId,bundleId),processStatus:compare(sourceId,processSourceId)};
  }
  const providerName=state=>PROVIDERS[state?.codex?.provider]||PROVIDERS.codex;
  const TITLES={missing:'{name}를 사용할 수 없어요.','signed-out':'{name} 로그인이 필요해요.',idle:'{name} 연결 준비',starting:'{name} 연결 중',ready:'{name} 준비됨',busy:'{name} 응답 중',error:'{name} 연결 오류'};
  // The bridge reports account limits as code 'codex' with the provider's own
  // English text, so the message is checked as well as the code.
  const isLimit=error=>/limit|quota|rate/i.test(safeText(error?.code,80))||/usage limit|rate limit|quota/i.test(safeText(error?.message));
  const withoutLinks=text=>text.replace(/https?:\/\/\S+/g,'').replace(/\s{2,}/g,' ').trim();
  function limitNotice(error,name='Codex'){
    const retry=/try again (?:at|after) ([^.]{3,60})/i.exec(safeText(error?.message));
    return name+' 사용 한도에 도달했어요.'+(retry?` ${withoutLinks(retry[1])} 이후 다시 시도해주세요.`:' 잠시 후 연결 상태를 확인해주세요.');
  }
  function statusTitle(state){
    const name=providerName(state);
    if(state?.canceling)return name+' 취소 중';
    if(state?.phase==='limited')return name+' 사용 한도';
    if(state?.phase==='error')return name+' 요청 오류';
    const phaseTitles={connecting:'연결 중',preparing:'요청 준비 중',working:'응답 중','waiting-job':'이미지 결과 대기',done:'응답 완료',canceled:'요청 취소됨','needs-input':'추가 입력 필요'};
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
    if(typeof value!=='string')throw Error('검증된 이미지 작업 설정이 필요합니다.');
    const lines=value.split('\n'),match=/^\[Pankeki settings: (.*)\]$/.exec(lines[1]||'');
    if(lines[0]!==`[Pankeki action: ${intent}]`||!match)throw Error('이미지 작업과 설정의 연결을 확인해주세요.');
    const settings=JSON.parse(match[1]);
    const keys=new Set(['mode','prompt','negative','model_id','seed','width','height','steps','cfg','sampler','scheduler','denoise','roi','halo','feather','cache','preview','preview_interval','edit_operation','target_color','source_color','color_tolerance']);
    if(!settings||Array.isArray(settings)||typeof settings!=='object'||Object.entries(settings).some(([key,item])=>!keys.has(key)||item!==null&&!['string','number','boolean'].includes(typeof item)||typeof item==='number'&&!Number.isFinite(item)||typeof item==='string'&&/data:image\//i.test(item)))throw Error('이미지 작업에는 검증된 설정만 전달할 수 있어요.');
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
    const state={codex:{state:'idle',provider:'codex',toolsReady:false,lastError:null},phase:'idle',notice:'연결 상태를 확인하고 있어요.',projectId:identity.projectId,messages:[],contextEpoch:0,activeRequestId:null,submittedTargetId:null,resolvedIntent:null,modelSaving:false,canceling:false,modelOptions:{provider:'codex',loading:false,options:[],error:'',availability:'unverified'},lastFailure:null,appBuild:{}};
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
      state.phase=limited?'limited':'error';state.notice=limited?limitNotice(error,providerName(state)):withoutLinks(safeText(error?.message))||'연결을 확인한 뒤 다시 보내주세요.';
      return state.phase;
    }
    const readyNotice=()=>state.codex.state==='ready'?'메시지를 입력해 보내주세요.':state.codex.state==='signed-out'?providerName(state)+' 로그인이 필요해요.':'연결 상태를 확인해주세요.';
    function applyStatus(value,initial=false){const incoming=value?.codex||value||{};if(!initial&&(incoming.provider&&incoming.provider!==state.codex.provider||Number.isSafeInteger(incoming.modelRevision)&&incoming.modelRevision<state.codex.modelRevision))return;state.codex=normalizeStatus({...state.codex,...incoming});if(state.codex.lastError&&isLimit(state.codex.lastError))errorState(state.codex.lastError);else if(state.phase==='idle')state.notice=readyNotice();publish();}
    async function retire(reason='cancel'){
      const request=active;if(!request)return false;
      clearTimeout(request.waitTimer);
      // Retire locally before awaiting interrupt: a late delta/result can never
      // become current merely because the main process is slow to acknowledge.
      adapter.endRequest({requestId:request.requestId});active=null;state.activeRequestId=null;state.submittedTargetId=null;state.resolvedIntent=null;state.canceling=true;
      state.phase=['tools-unavailable','job-scope'].includes(reason)?'error':'canceled';state.notice=reason==='project'?'프로젝트가 바뀌어 이전 응답을 중단했어요.':reason==='source'?'원본 또는 마스크가 바뀌어 이전 응답을 중단했어요.':reason==='selection'?'참조 이미지 선택이 바뀌어 이전 구도 변경 결과를 적용하지 않았어요.':reason==='unexpected-tool'?'요청 범위가 확인되지 않은 이미지 작업이 시작되어 요청을 중단했어요.':reason==='tools-unavailable'?'Pankeki 이미지 도구 연결을 확인한 뒤 다시 요청해주세요.':reason==='job-scope'?'이 요청에 속한 이미지 작업을 확인하지 못해 응답을 중단했어요.':'요청을 취소했어요. 진행 중이던 이미지 결과는 추가하지 않아요.';publish();
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
        request.resolvedIntent=payload.intent;request.operation=payload.operation;state.resolvedIntent=payload.intent;if(payload.operation==='recompose')state.notice='이 이미지를 기준으로 구도를 바꾼 새 후보를 만들어요.';publish();return;
      }
      const intent=automatic?request.resolvedIntent:request.context.intent;
      const mutationIntent=payload.tool==='pankeki_generate'?'generate':payload.tool==='pankeki_edit'?'edit':null;
      if(['tool-started','tool-completed'].includes(event.type)&&mutationIntent){
        if(intent!==mutationIntent){await retire('unexpected-tool');return;}
        if(automatic&&!state.codex.toolsReady){await retire('tools-unavailable');return;}
      }
      if(event.type==='turn-started'){state.phase='working';state.notice=providerName(state)+'가 응답하고 있어요.';}
      else if(event.type==='message-delta')request.reply.text=(request.reply.text+safeText(payload.text,100000)).slice(0,100000);
      else if(event.type==='message')request.reply.text=safeText(payload.text,100000);
      else if(event.type==='tool-started'){if(mutationIntent)request.expectedImage=true;state.notice=request.operation==='recompose'?'이 이미지를 기준으로 구도를 바꾼 새 후보를 만들어요.':'Pankeki 이미지 작업을 확인하고 있어요.';}
      else if(event.type==='tool-completed'){
        if(payload.ok===false){state.notice='Pankeki 작업을 완료하지 못했어요.';publish();return;}
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
          state.notice=jobState==='orphaned'?'서버가 다시 시작되어 이전 작업을 자동 재제출하지 않았어요. 결과 상태를 확인해주세요.':payload.resultId?'이미지 결과를 후보에 연결하고 있어요.':'Pankeki 이미지 작업을 진행하고 있어요.';
          if(payload.resultId){
            const resolver=resolveResult||ipc.resolveResult;
            if(typeof resolver!=='function'){state.notice='이미지 작업 결과의 로컬 연결이 아직 준비되지 않았어요.';publish();return;}
            const result=await resolver.call(ipc,{...ref,jobId:payload.jobId,resultId:payload.resultId});
            if(!matches(request))return;
            if(!referenceCurrent(request)){await retire('selection');return;}
            const accepted=await adapter.receiveEvent({...ref,type:'result',selectionCurrent:()=>referenceCurrent(request),payload:{...result,jobId:payload.jobId}});
            // A successful commit may itself advance the recent-image fallback.
            if(!accepted.accepted&&!referenceCurrent(request)){await retire('selection');return;}
            if(accepted.accepted&&accepted.candidateId){request.reply.candidateIds ||= [];if(!request.reply.candidateIds.includes(accepted.candidateId))request.reply.candidateIds.push(accepted.candidateId);}
            if(!matches(request))return;
            request.jobs.set(payload.jobId,'terminal');
            state.notice=accepted.accepted?'작업 결과를 캔버스와 후보에 추가했어요.':'원본이나 작업이 바뀌어 이 결과를 적용하지 않았어요.';
          }
          if(request.turnDone&&request.jobs.size&&[...request.jobs.values()].every(value=>value==='terminal')){finish(request,'done',state.notice);return;}
        }
      }
      else if(event.type==='needs-input'){
        finish(request,'needs-input',payload.reason==='mask'?'수정할 영역을 브러시로 칠하거나 마스크를 불러와주세요.':payload.reason==='target'?'지금 보고 있는 이미지를 부분 수정으로 열고 바꿀 영역을 칠해주세요.':payload.reason==='capability'?'선택한 원본과 마스크를 준비하지 못했어요. 같은 이미지에서 영역을 다시 확인해주세요.':'수정할 원본 이미지를 먼저 불러오세요.');return;
      }
      else if(event.type==='error'){
        state.lastFailure={requestId:request.requestId,text:request.text,code:safeText(payload.code,80)};const phase=errorState(payload);finish(request,phase,state.notice);return;
      }
      else if(event.type==='turn-completed'){
        const canceled=['canceled','cancelled','interrupted'].includes(payload.status);
        request.turnDone=true;
        if(automatic&&!intent&&!canceled&&payload.status!=='failed'){finish(request,'error','요청 종류를 확인하지 못했어요. 다시 메시지를 보내주세요.');return;}
        if(!canceled&&payload.status!=='failed'&&request.expectedImage&&(!request.jobs.size||[...request.jobs.values()].some(value=>value==='pending'))){
          state.phase='waiting-job';state.notice='대화 응답은 끝났고 이미지 작업 결과를 기다리고 있어요. 기다리지 않으려면 요청을 취소하세요.';
          request.waitTimer=setTimeout(()=>{if(matches(request)&&state.phase==='waiting-job')finish(request,'error','이미지 결과를 받지 못해 요청을 마쳤어요. 이미지 작업은 계속될 수 있지만 후보에는 추가되지 않아요. 다시 요청해주세요.');},waitLimitMs);
          publish();return;
        }
        finish(request,canceled?'canceled':payload.status==='failed'?'error':'done',canceled?'요청을 취소했어요.':payload.status==='failed'?'응답을 완료하지 못했어요.':'응답을 마쳤어요.');return;
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
      state.codex.state='starting';state.phase='connecting';state.notice=providerName(state)+' 연결을 준비하고 있어요.';publish();
      try{const status=await ipc.connectCodex();if(dead)return false;applyStatus(status);state.phase='idle';state.notice=state.codex.state==='signed-out'?providerName(state)+' 로그인을 완료한 뒤 연결 상태를 다시 확인해주세요.':'연결 상태를 확인했어요.';publish();return true;}
      catch(error){if(!dead){state.codex.state='error';errorState(error);publish();}return false;}
    }
    async function send({text,intent='chat',includeEditAssets=false}={}){
      if(settingsLocked()||state.codex.state!=='ready'||state.phase==='limited')return false;
      if(typeof text!=='string'||!text.trim()||text.length>4000){state.notice='메시지는 1~4000자로 입력해주세요.';publish();return false;}
      if(intent!=='chat'&&intent!=='auto'&&!state.codex.toolsReady){state.notice='Pankeki 이미지 도구 연결을 확인한 뒤 다시 요청해주세요.';publish();return false;}
      syncProject();let context,request;
      try{
        beforeSend?.({intent});syncProject();const presentation=intent==='auto'?getAutomaticContext():null;
        context=adapter.captureContext({intent,...(presentation||{includeEditAssets})});
        let wireText;
        if(intent==='chat')wireText='[Pankeki action: chat]\n이 요청은 대화만 합니다. 이미지 생성·수정 도구를 실행하지 마세요.\n'+text.trim();
        else {
          const formatter=formatMessage||adapter.formatMessage;
          if(typeof formatter!=='function')throw Error('이미지 작업 설정 연결을 확인한 뒤 다시 요청해주세요.');
          const formatted=formatter.call(adapter,{text:text.trim(),intent,context});
          if(intent==='auto'){
            if(!context.automatic||typeof context.automatic!=='object'||Array.isArray(context.automatic)||formatted!=='[Pankeki action: auto]\n'+text.trim())throw Error('자동 요청 문맥의 연결을 확인해주세요.');
            wireText=formatted;
          }else wireText=checkedImageMessage(formatted,intent);
        }
        if(typeof wireText!=='string'||!wireText.trim()||wireText.length>8000)throw Error('전달할 작업 설명과 설정을 8000자 이내로 줄여주세요.');
        request={requestId:makeId(),projectId:context.projectId,context,presentation:presentation?{referenceCandidateId:presentation.referenceCandidateId,selectionEpoch:presentation.selectionEpoch}:null,resolvedIntent:intent==='auto'?null:intent,text:text.trim(),seq:-1,jobs:new Map(),turnDone:false,expectedImage:false};
        if(!adapter.beginRequest({requestId:request.requestId,context,provider:providerName(state)}).accepted)throw Error('원본이나 작업 상태가 바뀌었어요. 입력을 확인해주세요.');
        request.reply={role:'assistant',requestId:request.requestId,text:'',contextEpoch:state.contextEpoch,provider:providerName(state),modelLabel:state.modelOptions.options.find(item=>item.id===state.codex.modelId)?.displayName||state.codex.modelId};active=request;
        state.activeRequestId=request.requestId;state.submittedTargetId=presentation?.referenceCandidateId||presentation?.visibleCandidateId||null;state.resolvedIntent=null;state.phase='preparing';state.notice='메시지를 준비하고 있어요.';
        state.messages.push({role:'user',requestId:request.requestId,text:text.trim(),contextEpoch:state.contextEpoch},request.reply);publish();
        const outbound={sourceRevision:context.sourceRevision};
        if(intent==='edit'||intent==='auto'&&(context.source||context.mask)){
          if(!context.source||intent==='edit'&&!context.mask||context.automatic?.edit.ready&&!context.mask)throw Error('같은 이미지의 원본과 마스크를 함께 준비해주세요.');
          if(typeof ipc.prepareEditContext!=='function')throw Error('원본과 마스크의 로컬 연결이 아직 준비되지 않았어요.');
          const source=typeof adapter.prepareSource==='function'?await adapter.prepareSource(context):context.source;
          if(!matches(request))return false;
          const prepared=await ipc.prepareEditContext({sourceDataUrl:source.dataUrl,...(context.mask?{maskDataUrl:context.mask.dataUrl}:{}),sourceRevision:context.sourceRevision,projectId:context.projectId});
          if(!matches(request))return false;
          syncProject();if(!matches(request))return false;
          if(prepared?.projectId!==context.projectId||prepared?.sourceRevision!==context.sourceRevision||!validId(prepared?.sourceId)||context.mask&&!validId(prepared?.maskId))throw Error('원본과 마스크를 준비하지 못했어요.');
          if(presentation){const current=getAutomaticContext();if(current.selectionEpoch!==presentation.selectionEpoch||current.referenceCandidateId!==presentation.referenceCandidateId)throw Error('참조할 이미지 선택이 바뀌었어요. 다시 보내주세요.');}
          outbound.sourceId=prepared.sourceId;if(context.mask)outbound.maskId=prepared.maskId;
        }
        if(!matches(request))return false;
        state.phase='working';state.notice=providerName(state)+'가 응답하고 있어요.';publish();
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
        if(value.modelRevision<state.codex.modelRevision){state.modelOptions.error='모델 선택이 바뀌었어요. 목록을 다시 확인해주세요.';return false;}
        // Reading metadata may legitimately restore a persisted model and raise
        // the native revision before or after its matching status event.
        const options=Array.isArray(value.options)?value.options.filter(item=>typeof item.id==='string'&&item.id.length>0&&item.id.length<=120&&typeof item.displayName==='string').slice(0,100).map(item=>({id:item.id,displayName:safeText(item.displayName,120)})):[];
        state.modelOptions={provider,loading:false,options,availability:'unverified',source:safeText(value.source,80),error:value.errorCode||!options.length?'모델 목록을 조회하지 못했어요. 연결 상태를 확인하고 다시 조회해주세요.':''};
        if(typeof value.selectedModelId==='string'){state.codex.modelId=value.selectedModelId;state.codex.modelRevision=value.modelRevision;}
        return !state.modelOptions.error;
      }catch(error){if(ownsCatalog())state.modelOptions={provider,loading:false,options:[],availability:'unverified',error:'모델 목록 조회에 실패했어요. 연결 상태를 확인하고 다시 조회해주세요.'};return false;}
      finally{if(ownsCatalog()){state.modelOptions.loading=false;publish();}}
    }
    async function selectProvider(provider){
      if(settingsLocked()||!PROVIDERS[provider]||typeof ipc.selectProvider!=='function')return false;
      ++catalogEpoch;state.modelSaving=true;publish();
      try{const value=await ipc.selectProvider({provider});if(dead)return false;state.codex=normalizeStatus(value);state.phase='idle';state.notice=providerName(state)+'로 변경했어요. 입력 중인 초안은 유지했어요.';state.modelOptions={provider,loading:false,options:[],error:'',availability:'unverified'};return true;}
      catch(error){if(!dead){state.modelOptions.error='AI 공급자를 변경하지 못했어요. 기존 선택을 유지합니다.';}return false;}
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
        state.notice=contextReset?'AI 모델을 변경해 새 AI 문맥을 시작했어요. 이전 대화와 입력 중인 초안은 유지했어요.':value.conversationReset===true?'AI 모델을 변경했어요. 현재 작업과 입력 중인 초안은 유지했어요.':'현재 AI 모델을 유지합니다.';return true;
      }catch(error){if(!dead)state.modelOptions.error='모델 설정 저장에 실패했어요. 기존 모델과 입력 중인 초안을 유지합니다.';return false;}
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
    controls.innerHTML='<button type="button" id="desktopChatSelectedModel" class="pc-setting-button" aria-label="AI 공급자와 모델 설정"></button><button type="button" id="desktopChatConnect" class="pc-setting-button">연결 확인</button>';
    form.prepend(controls);
    const settings=doc.createElement('section');settings.className='pc-ai-model-settings';settings.id='desktopModelSettings';
    settings.innerHTML='<fieldset><legend>AI 대화</legend><label for="desktopChatProvider">AI 공급자</label><select id="desktopChatProvider"><option value="codex">Codex</option><option value="claude">Claude</option></select><label for="desktopChatModel">세부 모델</label><select id="desktopChatModel" disabled></select><p id="desktopChatModelHelp" class="hint" role="status"></p><button type="button" id="desktopChatModelsRefresh" class="text-button">모델 목록 다시 확인</button></fieldset><fieldset><legend>이미지 생성</legend><label for="desktopGenerationModel">생성 모델</label><select id="desktopGenerationModel" disabled></select><p id="desktopGenerationModelHelp" class="hint" role="status"></p></fieldset><fieldset><legend>선택 영역 수정</legend><label for="desktopEditModel">부분 수정 모델</label><select id="desktopEditModel" disabled></select><p id="desktopEditModelHelp" class="hint" role="status"></p></fieldset><p id="desktopImageSettingsHelp" class="hint" role="status"></p>';
    const information=doc.createElement('details');information.id='desktopBuildInformation';information.dataset.pkSettingsSection='environment';information.className='pc-build-information';
    information.innerHTML='<summary>앱 정보 · 빌드 식별자</summary><p id="desktopBuildStatus" role="status"></p><dl id="desktopBuildIdentifiers"></dl><p class="hint">시작 시 식별자는 그때 관찰한 파일 바이트입니다. 개별 모듈의 실행이나 이미지 품질은 따로 확인해요.</p><button type="button" id="desktopBuildRefresh" class="text-button">식별자 다시 확인</button>';
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
      for(const item of options){const option=doc.createElement('option');option.value=item.id;option.textContent=item.displayName||item.label||item.id;if(item.available===false){option.disabled=true;option.textContent+=' · '+(item.reason||'사용 불가');}nodes.push(option);}
      node.replaceChildren(...nodes);node.value=selected||'';
    }
    controller=createController({ipc,adapter:studio.desktopChat,subscribe:studio.subscribe,isWorkspaceBusy:()=>studio.getSummary().busy||imageSettings()?.busy===true||workspace.isPhotoBusy?.()===true||workspace.isProjectBusy?.()===true||studio.photoTools?.getState().locked===true,
      getAutomaticContext:()=>workspace.getAutomaticContext(),
      beforeSend:({intent})=>{if(doc.body.dataset.studioScreen==='compare')throw Error('비교를 마친 뒤 메시지를 보내주세요.');if(doc.body.dataset.studioScreen==='home')workspace.enterConversation();const mode=intent==='generate'?'txt2img':intent==='edit'?'inpaint':null;if(mode&&studio.getSummary().mode!==mode)studio.setMode(mode);},
      formatMessage:({text,intent,context})=>{if(typeof studio.desktopChat.formatMessage!=='function')throw Error('이미지 작업 설정 연결이 준비되지 않았어요.');return studio.desktopChat.formatMessage({text:intent==='auto'?text:workspace.prepareText(text,intent),intent,context});},
      onChange:renderState});
    function renderState(state){
      if(!viewAlive)return;
      latestState=state;
      const marker=doc.querySelector?.('meta[name="pankeki-source-id"]')?.getAttribute('content'),build=buildInformation(state.appBuild,marker),labels={match:'일치',mismatch:'불일치',unknown:'미확인'};
      find('desktopBuildStatus').textContent='서버 시작 소스: '+labels[build.processStatus]+' · 제공 HTML: '+labels[build.htmlStatus]+' · 현재 화면: '+labels[build.rendererStatus]+' · Electron 시작 번들: '+labels[build.bundleStatus];
      const entries=[];
      for(const [label,value]of [['현재 디스크 소스',build.sourceId],['서버 프로세스 시작 시 소스',build.processSourceId],['제공 HTML의 소스',build.htmlId],['현재 화면의 소스',build.rendererId],['제공 HTML 바이트 SHA',build.htmlHash],['현재 디스크 데스크톱 코드',build.desktopSourceId],['Electron 시작 시 번들',build.bundleId]]){
        const term=doc.createElement('dt'),description=doc.createElement('dd');term.textContent=label;description.textContent=value||'unknown · 확인되지 않음';entries.push(term,description);
      }
      find('desktopBuildIdentifiers').replaceChildren(...entries);
      if(lastProject!==state.projectId){if(lastProject!==null){input.value='';draftVersion++;drafts.clear();}lastProject=state.projectId;}
      const user=state.messages.find(message=>message.requestId===state.activeRequestId&&message.role==='user');
      if(user&&!drafts.has(user.requestId))drafts.set(user.requestId,{text:input.value,clearVersion:null});
      const failed=state.lastFailure&&drafts.get(state.lastFailure.requestId);
      if(failed&&failed.clearVersion===draftVersion&&input.value===''){input.value=failed.text;draftVersion++;failed.clearVersion=null;}
      workspace.render(state);
      const locked=controller.settingsLocked(),name=providerName(state),catalog=state.modelOptions,modelLabel=catalog.options.find(item=>item.id===state.codex.modelId)?.displayName||state.codex.modelId||'기본값';
      const modelButton=find('desktopChatSelectedModel'),modelDescription='AI 대화 모델 설정: '+name+' · '+modelLabel;modelButton.textContent='AI 대화 · '+name+' · '+modelLabel;modelButton.setAttribute('aria-label',modelDescription);modelButton.setAttribute('title',modelDescription+' — 이미지 생성·부분 수정 모델은 설정에서 별도로 선택해요.');
      find('desktopChatConnect').textContent=state.codex.state==='signed-out'?name+' 로그인':name+' 연결 확인';find('desktopChatConnect').disabled=locked||state.codex.state==='missing';
      for(const node of doc.querySelectorAll('[data-desktop-codex-copy]'))node.textContent=statusTitle(state);
      const photoBusy=workspace.isPhotoBusy?.()===true,photoState=workspace.getPhotoState?.();
      const projectState=workspace.getProjectState?.(),projectError=projectState?.error||projectState?.recovery&&'홈의 프로젝트 목록에서 앱 저장을 다시 시도하거나 파일로 저장해주세요.',feedback=find('pkComposerStatus');feedback.textContent=projectError|| (photoBusy&&!state.activeRequestId?'사진 편집을 마치거나 취소한 뒤 메시지를 보내주세요.':statusTitle(state)+' · '+state.notice);feedback.classList.toggle('error',!!projectError||['error','limited'].includes(state.phase));feedback.setAttribute('role',projectError||['error','limited'].includes(state.phase)?'alert':'status');
      find('pkGenerate').disabled=locked||state.codex.state!=='ready'||state.phase==='limited'||!input.value.trim()||doc.body.dataset.studioScreen==='compare';
      find('pkGenerate').setAttribute('aria-label','메시지 보내기');
      find('pkCancel').hidden=!state.activeRequestId&&!state.canceling&&!photoBusy;find('pkCancel').textContent=state.canceling?'취소 중…':state.activeRequestId?'요청 취소':photoState?.cancelling?'사진 편집 취소 중…':'사진 편집 취소';find('pkCancel').disabled=state.canceling||!state.activeRequestId&&photoState?.cancelling===true;
      const provider=find('desktopChatProvider');provider.value=state.codex.provider;provider.disabled=locked||typeof ipc.selectProvider!=='function';
      choices(find('desktopChatModel'),catalog.options,state.codex.modelId,catalog.loading?'모델 목록 확인 중':'모델 목록을 확인해주세요');
      find('desktopChatModel').disabled=locked||catalog.loading||!!catalog.error||!catalog.options.length||typeof ipc.setChatModel!=='function';
      find('desktopChatModelsRefresh').disabled=locked||catalog.loading||typeof ipc.getChatModelOptions!=='function';
      find('desktopChatModelHelp').textContent=catalog.error||(state.modelSaving?'모델 설정을 저장하고 있어요.':typeof ipc.getChatModelOptions!=='function'?'현재 설치본은 세부 모델 선택을 지원하지 않아요.':catalog.loading?'설치된 CLI의 모델 목록을 확인하고 있어요.':'CLI가 제공한 목록입니다. 모델 접근 권한과 사용 한도는 실제 요청에서 확인됩니다.');
      const images=imageSettings();
      for(const [key,id] of [['generation','desktopGenerationModel'],['edit','desktopEditModel']]){
        const value=images?.[key];choices(find(id),value?.models||[],value?.selectedId||'',images?.ready?'모델을 선택해주세요':'이미지 모델 확인 중');find(id).disabled=locked||!images?.ready||typeof studio.setImageModelSettings!=='function';
        find(id+'Help').textContent=value?.reason||images?.capabilityReason||(!images?.ready?images?.error||'설치된 이미지 모델을 확인하고 있어요.':'설치되어 사용 가능한 모델만 선택할 수 있어요.');
      }
      find('desktopImageSettingsHelp').textContent=imageError||images?.persistenceError||'';
      const editing=studio.getSummary().mode==='inpaint',imageValue=images?.[editing?'edit':'generation'],imageLabel=imageValue?.models?.find(item=>item.id===imageValue.selectedId)?.label||imageValue?.selectedId||'확인 중',imageButton=find('pcModelName').closest('button');imageButton.hidden=false;imageButton.setAttribute('data-pk-setting-target',editing?'desktopEditModel':'desktopGenerationModel');imageButton.setAttribute('aria-label',`${editing?'부분 수정':'이미지 생성'} 모델 설정: ${imageLabel}`);
      find('pcModelName').textContent=imageLabel;imageButton.title=`${editing?'부분 수정':'이미지 생성'} 모델 설정: ${imageLabel}`;
      const width=Number(find('width').value),height=Number(find('height').value),size=Number.isSafeInteger(width)&&width>0&&Number.isSafeInteger(height)&&height>0?`${width} × ${height}`:'크기 확인 필요';
      const resolution=find('pcResolution');resolution.hidden=false;resolution.textContent=size;resolution.setAttribute('aria-label','이미지 크기 설정: '+size);resolution.title='이미지 크기 설정: '+size;
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
      try{if(typeof studio.setImageModelSettings!=='function')throw Error('현재 설치본에서 모델 설정을 지원하지 않아요.');studio.setImageModelSettings({[key]:event.target.value});imageError='';}
      catch(error){imageError=safeText(error.message)||'이미지 모델 설정을 저장하지 못했어요.';}
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

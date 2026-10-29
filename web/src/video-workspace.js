/* Blender scene selection and local AI video jobs have their own state/storage.
 * A guide render is never promoted to an AI result. */
(function(root,factory){
  'use strict';
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else{root.PankekiVideoWorkspace=api;if(root.document&&root.PankekiStudio)root.PankekiVideoWorkspaceController=api.mount(root.document,root.PankekiStudio);}
})(typeof globalThis==='object'?globalThis:this,function(root){
  'use strict';
  const STORAGE_KEY='pankeki-blender-video-v1';
  const ACTIVE=new Set(['queued','submitting','running','canceling']);
  const TERMINAL=new Set(['succeeded','failed','canceled','orphaned','uncertain']);
  const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
  const text=(value,max=1200)=>typeof value==='string'?value.slice(0,max):'';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const fail=message=>{throw Error(message);};
  const assetUrl=(id,kind)=>'/api/video/assets/'+encodeURIComponent(id)+'/'+kind+'.mp4';
  function checkedAsset(url,id,kind){return url===assetUrl(id,kind)?url:null;}
  async function request(path,body){
    const response=await root.fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    let data;try{data=await response.json();}catch{throw Error('영상 서버의 응답을 읽지 못했어요. 연결을 다시 확인해주세요.');}
    if(!response.ok)throw Object.assign(Error(text(data?.error?.message||data?.error||data?.message,300)||'영상 서버에 연결하지 못했어요.'),{status:response.status});
    return data;
  }
  function createController({api=request,pickScene,storage,makeId=()=>root.crypto.randomUUID(),onChange=()=>{},schedule=(fn,ms)=>root.setTimeout(fn,ms),clearSchedule=id=>root.clearTimeout(id),pollMs=1200}={}){
    let dead=false,generation=0,timer=null,polling=null,failures=0,cancelRequested=null;
    const state={project_id:makeId(),epoch:0,scene:null,prompt:'',capabilities:null,checking:false,picking:false,submitting:false,pendingSubmission:null,canceling:false,job:null,result:null,guide_url:null,error:'',notice:'Blender에서 구도를 편집한 파일을 가져오세요.',storageError:''};
    const snapshot=()=>clone({...state,busy:state.submitting||!!state.pendingSubmission||state.canceling||ACTIVE.has(state.job?.status)});
    function publish(){if(!dead)onChange(snapshot());}
    function persist(){
      if(!storage)return;
      try{storage.setItem(STORAGE_KEY,JSON.stringify({schema:1,project_id:state.project_id,epoch:state.epoch,scene:state.scene,prompt:state.prompt,pendingSubmission:state.pendingSubmission,job:state.job?{id:state.job.id,project_id:state.project_id,epoch:state.epoch,cancel_requested:cancelRequested===state.job.id}:null}));state.storageError='';}
      catch{state.storageError='이 영상 작업을 앱에 기억하지 못했어요. 완료한 파일을 저장해주세요.';}
    }
    function current(token,project,epoch){return !dead&&token===generation&&project===state.project_id&&epoch===state.epoch;}
    function stopTimer(){if(timer!==null){clearSchedule(timer);timer=null;}}
    function queue(){stopTimer();if(!dead&&ACTIVE.has(state.job?.status))timer=schedule(()=>{timer=null;void refreshJob();},pollMs);}
    function busy(){return state.submitting||!!state.pendingSubmission||state.canceling||state.picking||ACTIVE.has(state.job?.status);}
    function setPrompt(value){if(busy())return false;state.prompt=text(value);persist();publish();return true;}
    async function check(){
      if(dead||state.checking)return false;
      state.checking=true;publish();
      try{const value=await api('/api/video/status');if(dead)return false;
        state.capabilities={ready:value?.ready===true,reason:text(value?.reason,500),model:{id:text(value?.model?.id,120),label:text(value?.model?.label,120)},defaults:{width:value?.defaults?.width,height:value?.defaults?.height,frames:value?.defaults?.frames,fps:value?.defaults?.fps,steps:value?.defaults?.steps},blender_available:value?.blender_available===true};
        if(!state.job&&!state.pendingSubmission)state.notice=state.capabilities.ready?'구도 파일을 가져오고 원하는 장면을 적어주세요.':state.capabilities.reason||'영상 생성 준비를 확인해주세요.';
        state.error='';return true;
      }catch(error){if(!dead)state.error=text(error.message,500);return false;}
      finally{if(!dead){state.checking=false;publish();}}
    }
    async function selectScene(){
      if(dead||busy())return false;
      if(typeof pickScene!=='function'){state.error='설치형 Pankeki 앱에서 Blender 파일을 가져올 수 있어요.';publish();return false;}
      state.picking=true;state.error='';publish();const token=generation;let accepted=false;
      try{const value=await pickScene();if(dead||token!==generation)return false;if(!value||value.canceled)return false;
        if(!validId(value.scene_id)||!text(value.name,255))fail('선택한 Blender 파일을 확인하지 못했어요. 다시 가져와주세요.');
        accepted=true;++state.epoch;++generation;stopTimer();cancelRequested=null;state.scene={scene_id:value.scene_id,name:text(value.name,255)};state.job=null;state.result=null;state.guide_url=null;state.notice='파일을 가져왔어요. 만들 장면을 간단히 적어주세요.';persist();return true;
      }catch(error){if(!dead&&token===generation)state.error=text(error.message,500);return false;}
      finally{if(!dead&&(token===generation||accepted&&token+1===generation)){state.picking=false;publish();}}
    }
    async function submit({recover=false}={}){
      if(dead||state.submitting||state.canceling||state.picking||ACTIVE.has(state.job?.status)||!!state.pendingSubmission&&!recover)return false;
      if(!recover&&(!state.capabilities?.ready||!state.scene||!state.prompt.trim())){state.error=!state.capabilities?.ready?state.capabilities?.reason||'영상 생성 준비를 확인해주세요.':!state.scene?'Blender 구도 파일을 가져와주세요.':'어떤 장면을 만들지 적어주세요.';publish();return false;}
      if(recover&&!state.pendingSubmission)return false;
      stopTimer();++generation;if(!recover)++state.epoch;const token=generation,project=state.project_id,epoch=state.epoch;
      const payload=recover?state.pendingSubmission:{scene_id:state.scene.scene_id,project_id:project,epoch,prompt:state.prompt.trim(),seed:42};state.pendingSubmission=payload;
      state.submitting=true;cancelRequested=null;state.result=null;state.guide_url=null;state.job=null;state.error='';state.notice='영상 작업을 요청하고 있어요.';persist();publish();
      try{const value=await api('/api/video/jobs',payload);
        if(!current(token,project,epoch)){if(validId(value?.id))void api('/api/video/jobs/'+encodeURIComponent(value.id)+'/cancel',{}).catch(()=>{});return false;}
        if(!validId(value?.id)||!ACTIVE.has(value.status)&&!TERMINAL.has(value.status))fail('영상 작업 번호를 확인하지 못했어요. 중복 요청 전 연결을 확인해주세요.');
        state.pendingSubmission=null;state.job={id:value.id,status:value.status,phase:'queued',project_id:project,epoch};failures=0;persist();return true;
      }catch(error){if(current(token,project,epoch)){if(Number.isInteger(error.status)&&error.status>=400&&error.status<500)state.pendingSubmission=null;state.error=text(error.message,500);state.notice=state.pendingSubmission?'요청 상태를 확인하지 못했어요. 연결 다시 확인을 눌러 같은 요청을 확인하세요.':'영상 요청을 시작하지 못했어요.';persist();}return false;}
      finally{if(current(token,project,epoch)){state.submitting=false;publish();if(state.job)void refreshJob();}}
    }
    async function refreshJob(){
      if(dead||!state.job||polling===generation)return false;
      stopTimer();const token=generation,project=state.project_id,epoch=state.epoch,id=state.job.id;polling=token;
      try{const value=await api('/api/video/jobs/'+encodeURIComponent(id));if(!current(token,project,epoch))return false;
        if(value?.id!==id||value.project_id!==project||value.epoch!==epoch||!ACTIVE.has(value.status)&&!TERMINAL.has(value.status))fail('이 영상 작업과 응답의 연결을 확인하지 못했어요.');
        state.job={id,status:value.status,phase:text(value.phase,80),project_id:project,epoch,progress:Number.isFinite(value.progress)?Math.min(1,Math.max(0,value.progress)):null,elapsed_seconds:Number.isFinite(value.elapsed_seconds)?Math.max(0,value.elapsed_seconds):null,width:value.width,height:value.height,frames:value.frames,fps:value.fps};
        state.guide_url=checkedAsset(value.guide_url,id,'guide');state.error='';failures=0;
        if(value.status==='succeeded'&&cancelRequested===id){state.result=null;state.notice='취소를 요청한 영상 결과는 표시하지 않아요.';}
        else if(value.status==='succeeded'){
          const result=await api('/api/video/results/'+encodeURIComponent(id));if(!current(token,project,epoch))return false;
          const url=checkedAsset(result?.url,id,'result');
          if(result?.ai_generated!==true||!url||result.project_id!==undefined&&result.project_id!==project||result.epoch!==undefined&&result.epoch!==epoch)fail('완료한 AI 영상 파일을 확인하지 못했어요. 연결을 다시 확인해주세요.');
          state.result={url,filename:text(result.filename,180).replace(/[/\\\x00-\x1f]/g,'_')||'Pankeki-video.mp4'};state.notice='AI 영상이 완성됐어요. 재생한 뒤 파일로 저장하세요.';
        }else if(value.status==='canceled'){state.result=null;state.notice='영상 작업을 취소했어요.';}
        else if(['failed','orphaned','uncertain'].includes(value.status)){state.result=null;state.error=text(value?.error?.message||value.error,500)||'영상 작업을 완료하지 못했어요. 준비 상태를 확인하고 다시 시도해주세요.';state.notice=value.status==='orphaned'?'앱을 다시 여는 동안 이전 작업이 중단됐어요.':'영상 작업을 완료하지 못했어요.';}
        else state.notice=phaseLabel(state.job);
        persist();return true;
      }catch(error){if(current(token,project,epoch)){++failures;state.error=text(error.message,500);state.notice='영상 작업 상태를 다시 확인해주세요.';}return false;}
      finally{if(polling===token)polling=null;if(current(token,project,epoch)){publish();if(failures<3)queue();}}
    }
    async function cancel(){
      if(dead||!state.job||!ACTIVE.has(state.job.status)||state.canceling)return false;
      const token=generation,project=state.project_id,epoch=state.epoch,id=state.job.id;
      cancelRequested=id;state.canceling=true;state.error='';state.notice='영상 작업 취소를 요청하고 있어요.';persist();publish();
      try{await api('/api/video/jobs/'+encodeURIComponent(id)+'/cancel',{});if(!current(token,project,epoch))return false;state.result=null;await refreshJob();return true;}
      catch(error){if(current(token,project,epoch))state.error=text(error.message,500);return false;}
      finally{if(current(token,project,epoch)){state.canceling=false;publish();queue();}}
    }
    function reset(){
      const previous=state.job;if(previous&&ACTIVE.has(previous.status))void api('/api/video/jobs/'+encodeURIComponent(previous.id)+'/cancel',{}).catch(()=>{});
      ++generation;stopTimer();cancelRequested=null;state.project_id=makeId();state.epoch=0;state.scene=null;state.prompt='';state.job=null;state.pendingSubmission=null;state.result=null;state.guide_url=null;state.error='';state.submitting=false;state.canceling=false;state.picking=false;state.notice='새 프로젝트에서 사용할 Blender 파일을 가져오세요.';persist();publish();
    }
    async function restore(){
      let value;try{value=JSON.parse(storage?.getItem(STORAGE_KEY)||'null');}catch{state.storageError='이전 영상 작업 기록을 읽지 못했어요.';}
      if(value?.schema===1&&validId(value.project_id)&&Number.isSafeInteger(value.epoch)&&value.epoch>=0){
        state.project_id=value.project_id;state.epoch=value.epoch;state.prompt=text(value.prompt);
        if(validId(value.scene?.scene_id)&&text(value.scene?.name,255))state.scene={scene_id:value.scene.scene_id,name:text(value.scene.name,255)};
        if(validId(value.job?.id)&&value.job.project_id===value.project_id&&value.job.epoch===value.epoch){state.job={id:value.job.id,status:'queued',phase:'restoring',project_id:value.project_id,epoch:value.epoch};if(value.job.cancel_requested===true)cancelRequested=value.job.id;}
        else if(value.pendingSubmission&&validId(value.pendingSubmission.scene_id)&&value.pendingSubmission.project_id===value.project_id&&value.pendingSubmission.epoch===value.epoch&&typeof value.pendingSubmission.prompt==='string'&&value.pendingSubmission.prompt.length<=1200&&value.pendingSubmission.seed===42){state.pendingSubmission={scene_id:value.pendingSubmission.scene_id,project_id:value.project_id,epoch:value.epoch,prompt:value.pendingSubmission.prompt,seed:42};state.notice='이전 요청의 응답을 확인하지 못했어요. 연결 다시 확인을 눌러 확인하세요.';}
      }
      publish();await check();if(state.job)await refreshJob();return snapshot();
    }
    return Object.freeze({getState:snapshot,check,selectScene,setPrompt,submit,cancel,refreshJob,recoverSubmission:()=>submit({recover:true}),restore,reset,destroy(){dead=true;++generation;stopTimer();}});
  }
  function phaseLabel(job){
    if(job.status==='canceling')return '영상 작업을 중단하고 있어요.';
    const labels={queued:'영상 생성 순서를 기다리고 있어요.',preparing:'영상 생성을 준비하고 있어요.',preparing_guide:'Blender에서 구도 가이드를 만들고 있어요.',waiting_gpu:'다른 이미지·영상 작업이 끝나기를 기다리고 있어요.',guide:'Blender에서 구도 가이드를 만들고 있어요.',blender:'Blender에서 구도 가이드를 만들고 있어요.',rendering:'Blender에서 구도 가이드를 만들고 있어요.',loading:'영상 모델을 불러오고 있어요.',model_loading:'영상 모델을 불러오고 있어요.',denoising:'AI가 영상을 만들고 있어요.',generating:'AI가 영상을 만들고 있어요.',sampling:'AI가 영상을 만들고 있어요.',encoding:'영상 파일을 저장하고 있어요.',verifying:'완성한 영상 파일을 확인하고 있어요.',restoring:'이전 영상 작업을 확인하고 있어요.'};
    return labels[job.phase]||(job.status==='queued'?labels.queued:'영상 작업을 진행하고 있어요.');
  }
  function mount(doc,studio){
    const find=id=>doc.getElementById(id),page=find('videoWorkspace');if(!page)return null;
    let controller,composing=false,dead=false,initialized=false,unsubscribe=null;const disposers=[];
    const on=(node,type,handler)=>{node?.addEventListener(type,handler);disposers.push(()=>node?.removeEventListener(type,handler));};
    const write=(id,value)=>{if(find(id))find(id).textContent=value;};
    function media(node,url){if(!node)return;if(url){if(node.getAttribute('src')!==url){node.src=url;node.load?.();}}else if(node.hasAttribute('src')){node.pause?.();node.removeAttribute('src');node.load?.();}}
    function render(state){
      const locked=!initialized||state.busy||state.picking,caps=state.capabilities,defaults=caps?.defaults||{},hasResult=!!state.result;
      page.dataset.videoState=state.job?.status||'idle';page.setAttribute('aria-busy',String(state.busy));
      find('videoPickScene').disabled=locked||!root.pankekiDesktop?.pickVideoScene;
      write('videoSceneName',state.scene?.name||'아직 선택한 파일이 없어요.');
      const prompt=find('videoPrompt');prompt.disabled=locked;if(!composing&&prompt.value!==state.prompt)prompt.value=state.prompt;
      find('videoGenerate').disabled=locked||!caps?.ready||!state.scene||!state.prompt.trim();
      find('videoCancel').hidden=!state.busy||!state.job;find('videoCancel').disabled=state.canceling||state.job?.status==='canceling';
      find('videoRefresh').disabled=state.checking||state.submitting;write('videoRefresh',state.checking?'준비 확인 중…':'연결 다시 확인');
      write('videoReadiness',!root.pankekiDesktop?.pickVideoScene?'설치형 Pankeki 앱에서 Blender 파일을 가져올 수 있어요.':state.checking&&!caps?'영상 생성 준비를 확인하고 있어요.':caps?.ready?'로컬 영상 생성 준비됨':caps?.reason||'영상 생성 준비를 확인해주세요.');
      const size=Number.isInteger(defaults.width)&&Number.isInteger(defaults.height)?defaults.width+' × '+defaults.height:'384 × 256';
      const duration=Number.isFinite(defaults.frames)&&Number.isFinite(defaults.fps)&&defaults.fps>0?(defaults.frames/defaults.fps).toFixed(1):'2.0';
      write('videoFormat','빠른 미리보기 · '+size+' · 약 '+duration+'초');write('videoStatus',state.picking?'Blender 파일을 가져오고 있어요.':state.notice);
      find('videoError').hidden=!state.error;write('videoError',state.error);find('videoStorageError').hidden=!state.storageError;write('videoStorageError',state.storageError);
      const progress=find('videoProgress');progress.hidden=!state.busy;if(Number.isFinite(state.job?.progress))progress.value=state.job.progress;else progress.removeAttribute('value');
      write('videoElapsed',state.busy&&Number.isFinite(state.job?.elapsed_seconds)?'진행 '+Math.floor(state.job.elapsed_seconds)+'초':'');
      find('videoResult').hidden=!hasResult;find('videoEmpty').hidden=hasResult;
      media(find('videoPlayer'),state.result?.url);find('videoSave').hidden=!hasResult;
      if(hasResult){find('videoSave').href=state.result.url;find('videoSave').download=state.result.filename;}else{find('videoSave').removeAttribute('href');find('videoSave').removeAttribute('download');}
      find('videoGuideDetails').hidden=!state.guide_url;media(find('videoGuidePlayer'),state.guide_url);
      write('videoEmptyTitle',state.busy?'영상을 만들고 있어요.':'완성한 영상이 여기에 표시돼요.');write('videoEmptyCopy',state.busy?'완료되면 이 화면에서 재생하고 저장할 수 있어요.':'Blender 파일과 짧은 설명으로 시작하세요.');
    }
    let storage;try{storage=root.localStorage;}catch{}
    controller=createController({storage,pickScene:root.pankekiDesktop?.pickVideoScene?()=>root.pankekiDesktop.pickVideoScene():null,onChange:render});
    on(find('videoPickScene'),'click',()=>void controller.selectScene());on(find('videoGenerate'),'click',()=>{if(!composing)void controller.submit();});on(find('videoCancel'),'click',()=>void controller.cancel());
    on(find('videoRefresh'),'click',async()=>{await controller.check();if(controller.getState().pendingSubmission)await controller.recoverSubmission();else if(controller.getState().job)await controller.refreshJob();});
    on(find('videoPrompt'),'compositionstart',()=>{composing=true;});on(find('videoPrompt'),'compositionend',event=>{composing=false;controller.setPrompt(event.target.value);});on(find('videoPrompt'),'input',event=>{if(!composing&&!event.isComposing)controller.setPrompt(event.target.value);});
    const observer=new root.MutationObserver(()=>{if(doc.body.dataset.studioScreen!=='video'){find('videoPlayer').pause?.();find('videoGuidePlayer').pause?.();}});observer.observe(doc.body,{attributes:true,attributeFilter:['data-studio-screen']});
    render(controller.getState());
    void Promise.resolve(studio.ready).then(async()=>{if(dead)return;unsubscribe=studio.subscribe((_summary,reason)=>{if(['reset','import','motion-import','v3-import','cubism-import'].includes(reason))controller.reset();});await controller.restore();if(dead)return;initialized=true;render(controller.getState());}).catch(()=>{initialized=true;render(controller.getState());});
    return Object.freeze({...controller,destroy(){dead=true;unsubscribe?.();observer.disconnect();for(const dispose of disposers.splice(0))dispose();controller.destroy();}});
  }
  return Object.freeze({STORAGE_KEY,createController,checkedAsset,phaseLabel,mount});
});

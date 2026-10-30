/* Blender scene selection and local AI video jobs have their own state/storage.
 * A guide render is never promoted to an AI result. */
(function(root,factory){
  'use strict';
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else{root.PankekiVideoWorkspace=api;if(root.document&&root.PankekiStudio)root.PankekiVideoWorkspaceController=api.mount(root.document,root.PankekiStudio);}
})(typeof globalThis==='object'?globalThis:this,function(root){
  'use strict';
  const uiMessage=value=>root.PankekiUIStrings?.message(value)??String(value??'');
  const STORAGE_KEY='pankeki-blender-video-v1';
  const ACTIVE=new Set(['queued','submitting','running','canceling']);
  const TERMINAL=new Set(['succeeded','failed','canceled','orphaned','uncertain']);
  const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
  const text=(value,max=1200)=>typeof value==='string'?value.slice(0,max):'';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const PROFILE_NAMES=new Set(['preview','fullbody']);
  const referenceId=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
  const referenceUrl=id=>'/api/video/references/'+id+'/source.png';
  function thinReference(value){
    if(!value||!referenceId(value.reference_id)||!Number.isSafeInteger(value.epoch)||!validId(value.project_id)||!validId(value.candidate_id)||!validId(value.source_revision)||!(/^[0-9a-f]{64}$/).test(value.sha256))return null;
    return {reference_id:value.reference_id,project_id:value.project_id,epoch:value.epoch,candidate_id:value.candidate_id,source_revision:value.source_revision,sha256:value.sha256,width:value.width,height:value.height,name:text(value.name,120),preview_url:referenceUrl(value.reference_id)};
  }
  function thinBinding(value){
    if(!value||!PROFILE_NAMES.has(value.profile)||Object.keys(value).some(key=>!['profile','reference_id','reference_sha256'].includes(key)))return null;
    if(value.reference_id===null){if(value.reference_sha256!==null)return null;}
    else if(!referenceId(value.reference_id)||!(/^[0-9a-f]{64}$/).test(value.reference_sha256))return null;
    return Object.freeze({profile:value.profile,reference_id:value.reference_id,reference_sha256:value.reference_sha256});
  }
  function submissionBinding(payload,reference){
    const id=payload.reference_id||null;
    const sha=id&&reference?.reference_id===id&&reference.project_id===payload.project_id&&reference.epoch===payload.epoch?reference.sha256:null;
    return thinBinding({profile:payload.profile||'preview',reference_id:id,reference_sha256:sha});
  }
  const legacyBinding=()=>thinBinding({profile:'preview',reference_id:null,reference_sha256:null});
  const bindingMatches=(binding,payload)=>!!binding&&binding.profile===(payload.profile||'preview')&&binding.reference_id===(payload.reference_id||null);
  const fail=message=>{throw Error(message);};
  const assetUrl=(id,kind)=>'/api/video/assets/'+encodeURIComponent(id)+'/'+kind+'.mp4';
  function checkedAsset(url,id,kind){return url===assetUrl(id,kind)?url:null;}
  async function request(path,body){
    const response=await root.fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    let data;try{data=await response.json();}catch{throw Error('Could not read the video server response. Check the connection again.');}
    if(!response.ok)throw Object.assign(Error(uiMessage(text(data?.error?.message||data?.error||data?.message,300))||'Could not connect to the video server.'),{status:response.status});
    return data;
  }
  function createController({api=request,pickScene,getSelectedReference,storage,makeId=()=>root.crypto.randomUUID(),onChange=()=>{},schedule=(fn,ms)=>root.setTimeout(fn,ms),clearSchedule=id=>root.clearTimeout(id),pollMs=1200}={}){
    let dead=false,generation=0,timer=null,polling=null,failures=0,cancelRequested=null;
    const state={project_id:makeId(),epoch:0,scene:null,prompt:'',profile:'preview',useReference:false,reference:null,referencePreviewUnavailable:false,selectingReference:false,capabilities:null,checking:false,picking:false,submitting:false,pendingSubmission:null,pendingBinding:null,canceling:false,job:null,result:null,guide_url:null,error:'',notice:'Import a composition file edited in Blender.',storageError:''};
    const snapshot=()=>clone({...state,busy:state.submitting||!!state.pendingSubmission||state.canceling||state.selectingReference||ACTIVE.has(state.job?.status)});
    function publish(){if(!dead)onChange(snapshot());}
    function persist(){
      if(!storage)return;
      try{storage.setItem(STORAGE_KEY,JSON.stringify({schema:1,project_id:state.project_id,epoch:state.epoch,scene:state.scene,prompt:state.prompt,profile:state.profile,useReference:state.useReference,reference:state.reference,pendingSubmission:state.pendingSubmission,pendingBinding:state.pendingBinding,job:state.job?{id:state.job.id,project_id:state.project_id,epoch:state.epoch,cancel_requested:cancelRequested===state.job.id,binding:state.job.binding}:null}));state.storageError='';}
      catch{state.storageError='Could not save this video task in the app. Save completed files.';}
    }
    function current(token,project,epoch){return !dead&&token===generation&&project===state.project_id&&epoch===state.epoch;}
    function stopTimer(){if(timer!==null){clearSchedule(timer);timer=null;}}
    function queue(){stopTimer();if(!dead&&ACTIVE.has(state.job?.status))timer=schedule(()=>{timer=null;void refreshJob();},pollMs);}
    function busy(){return state.submitting||!!state.pendingSubmission||state.canceling||state.selectingReference||state.picking||ACTIVE.has(state.job?.status);}
    function setPrompt(value){if(busy())return false;state.prompt=text(value);persist();publish();return true;}
    function setProfile(value){if(busy()||!PROFILE_NAMES.has(value))return false;state.profile=value;persist();publish();return true;}
    function clearReference(){if(busy())return false;state.useReference=false;state.reference=null;persist();publish();return true;}
    function referencePreviewFailed(id){if(state.reference?.reference_id!==id)return false;state.referencePreviewUnavailable=true;publish();return true;}
    async function selectReference(){
      if(dead||busy())return false;
      if(!state.scene||typeof getSelectedReference!=='function'){state.error=!state.scene?'Import a Blender composition file first.':'No image is selected. Select an image candidate.';publish();return false;}
      const token=generation,project=state.project_id,epoch=state.epoch,scene=state.scene.scene_id;
      state.selectingReference=true;state.error='';publish();
      try{
        // Snapshot on this explicit action, never later at Generate.
        const selected=await getSelectedReference();
        if(!current(token,project,epoch)||state.scene?.scene_id!==scene)return false;
        if(!selected||!validId(selected.candidate_id)||!validId(selected.source_revision)||typeof selected.image!=='string'||!selected.image.startsWith('data:image/png;base64,'))fail('Check the selected PNG candidate.');
        const response=await api('/api/video/references',{image:selected.image,project_id:project,epoch:epoch+1,candidate_id:selected.candidate_id,source_revision:selected.source_revision});
        if(!current(token,project,epoch)||state.scene?.scene_id!==scene)return false;
        if(response?.candidate_id!==selected.candidate_id||response?.source_revision!==selected.source_revision)fail('Could not verify the link between the reference image and selected candidate.');
        const reference=thinReference({...response,project_id:project,epoch:epoch+1,candidate_id:selected.candidate_id,source_revision:selected.source_revision,name:selected.name||selected.candidate_id});
        if(!reference)fail('Could not verify the saved reference image. Select it again.');
        state.reference=reference;state.referencePreviewUnavailable=false;state.useReference=true;persist();return true;
      }catch(error){if(current(token,project,epoch))state.error=uiMessage(text(error.message,500));return false;}
      finally{if(current(token,project,epoch)){state.selectingReference=false;publish();}}
    }
    async function check(){
      if(dead||state.checking)return false;
      state.checking=true;publish();
      try{const value=await api('/api/video/status');if(dead)return false;
        state.capabilities={ready:value?.ready===true,reason:text(value?.reason,500),model:{id:text(value?.model?.id,120),label:text(value?.model?.label,120)},profiles:value?.profiles&&typeof value.profiles==='object'?clone(value.profiles):null,defaults:{width:value?.defaults?.width,height:value?.defaults?.height,frames:value?.defaults?.frames,fps:value?.defaults?.fps,steps:value?.defaults?.steps},blender_available:value?.blender_available===true};
        if(!state.job&&!state.pendingSubmission)state.notice=state.capabilities.ready?'Import a composition file and describe the scene.':uiMessage(state.capabilities.reason)||'Check video generation readiness.';
        state.error='';return true;
      }catch(error){if(!dead)state.error=uiMessage(text(error.message,500));return false;}
      finally{if(!dead){state.checking=false;publish();}}
    }
    async function selectScene(){
      if(dead||busy())return false;
      if(typeof pickScene!=='function'){state.error='Import Blender files in the installed Pankeki app.';publish();return false;}
      state.picking=true;state.error='';publish();const token=generation;let accepted=false;
      try{const value=await pickScene();if(dead||token!==generation)return false;if(!value||value.canceled)return false;
        if(!validId(value.scene_id)||!text(value.name,255))fail('Could not verify the selected Blender file. Import it again.');
        accepted=true;++state.epoch;++generation;stopTimer();cancelRequested=null;state.scene={scene_id:value.scene_id,name:text(value.name,255)};state.reference=null;state.referencePreviewUnavailable=false;state.useReference=false;state.job=null;state.result=null;state.guide_url=null;state.notice='File imported. Briefly describe the scene to create.';persist();return true;
      }catch(error){if(!dead&&token===generation)state.error=uiMessage(text(error.message,500));return false;}
      finally{if(!dead&&(token===generation||accepted&&token+1===generation)){state.picking=false;publish();}}
    }
    async function submit({recover=false}={}){
      if(dead||state.submitting||state.canceling||state.selectingReference||state.picking||ACTIVE.has(state.job?.status)||!!state.pendingSubmission&&!recover)return false;
      if(!recover&&(!state.capabilities?.ready||!state.scene||!state.prompt.trim())){state.error=!state.capabilities?.ready?uiMessage(state.capabilities?.reason)||'Check video generation readiness.':!state.scene?'Import a Blender composition file.':'Describe the scene to create.';publish();return false;}
      if(recover&&!state.pendingSubmission)return false;
      if(!recover&&state.useReference&&(!state.reference||state.reference.project_id!==state.project_id||state.reference.epoch!==state.epoch+1)){state.error='Click Use current image again for this video.';publish();return false;}
      if(!recover&&state.profile==='fullbody'&&!state.capabilities?.profiles?.fullbody){state.error='Check readiness of the full-body video profile again.';publish();return false;}
      stopTimer();++generation;if(!recover)++state.epoch;const token=generation,project=state.project_id,epoch=state.epoch;
      const payload=recover?state.pendingSubmission:{scene_id:state.scene.scene_id,project_id:project,epoch,prompt:state.prompt.trim(),seed:42,...(state.profile==='fullbody'?{profile:'fullbody'}:{}),...(state.useReference?{reference_id:state.reference.reference_id}:{})};
      const binding=recover?state.pendingBinding:submissionBinding(payload,state.reference);
      if(!bindingMatches(binding,payload)){state.error='Could not find the previous video request profile and reference verification values. Check the record.';publish();return false;}
      state.pendingSubmission=payload;state.pendingBinding=binding;
      state.submitting=true;cancelRequested=null;state.result=null;state.guide_url=null;state.job=null;state.error='';state.notice='Submitting video task.';persist();publish();
      try{const value=await api('/api/video/jobs',payload);
        if(!current(token,project,epoch)){if(validId(value?.id))void api('/api/video/jobs/'+encodeURIComponent(value.id)+'/cancel',{}).catch(()=>{});return false;}
        if(!validId(value?.id)||!ACTIVE.has(value.status)&&!TERMINAL.has(value.status))fail('Could not verify the video task ID. Check the connection before submitting again.');
        state.pendingSubmission=null;state.pendingBinding=null;state.job={id:value.id,status:value.status,phase:'queued',project_id:project,epoch,binding};failures=0;persist();return true;
      }catch(error){if(current(token,project,epoch)){if(Number.isInteger(error.status)&&error.status>=400&&error.status<500){state.pendingSubmission=null;state.pendingBinding=null;}state.error=uiMessage(text(error.message,500));state.notice=state.pendingSubmission?'Could not verify request status. Click Recheck connection to check the same request.':'Could not start the video request.';persist();}return false;}
      finally{if(current(token,project,epoch)){state.submitting=false;publish();if(state.job)void refreshJob();}}
    }
    async function refreshJob(){
      if(dead||!state.job||polling===generation)return false;
      stopTimer();const token=generation,project=state.project_id,epoch=state.epoch,id=state.job.id;polling=token;
      const binding=state.job.binding||legacyBinding(),expectedProfile=binding.profile,expectedReference=binding.reference_id?{reference_id:binding.reference_id,sha256:binding.reference_sha256}:null;
      try{const value=await api('/api/video/jobs/'+encodeURIComponent(id));if(!current(token,project,epoch))return false;
        if(value?.id!==id||value.project_id!==project||value.epoch!==epoch||!ACTIVE.has(value.status)&&!TERMINAL.has(value.status))fail('Could not verify that the response belongs to this video task.');
        if(value.profile!=null&&value.profile!==expectedProfile||expectedProfile==='fullbody'&&value.profile!=='fullbody'||expectedReference&&value.reference_id!==expectedReference.reference_id){state.result=null;fail('Could not verify the response against the video profile or reference image.');}
        state.job={id,status:value.status,phase:text(value.phase,80),project_id:project,epoch,binding,progress:Number.isFinite(value.progress)?Math.min(1,Math.max(0,value.progress)):null,elapsed_seconds:Number.isFinite(value.elapsed_seconds)?Math.max(0,value.elapsed_seconds):null,width:value.width,height:value.height,frames:value.frames,fps:value.fps};
        state.guide_url=checkedAsset(value.guide_url,id,'guide');state.error='';failures=0;
        if(value.status==='succeeded'&&cancelRequested===id){state.result=null;state.notice='Results for a video with a cancellation request are hidden.';}
        else if(value.status==='succeeded'){
          const result=await api('/api/video/results/'+encodeURIComponent(id));if(!current(token,project,epoch))return false;
          const url=checkedAsset(result?.url,id,'result');
          if(result?.ai_generated!==true||!url||result.project_id!==undefined&&result.project_id!==project||result.epoch!==undefined&&result.epoch!==epoch)fail('Could not verify the completed AI video file. Recheck the connection.');
          if(result.profile!=null&&result.profile!==expectedProfile||expectedProfile==='fullbody'&&result.profile!=='fullbody'||expectedReference&&(result.reference?.reference_id!==expectedReference.reference_id||result.reference?.original_sha256!==expectedReference.sha256)){state.result=null;fail('The completed video profile or reference verification values do not match.');}
          state.result={url,filename:text(result.filename,180).replace(/[/\\\x00-\x1f]/g,'_')||'Pankeki-video.mp4'};state.notice='AI video complete. Play it, then save the file.';
        }else if(value.status==='canceled'){state.result=null;state.notice='Video task canceled.';}
        else if(['failed','orphaned','uncertain'].includes(value.status)){state.result=null;state.error=uiMessage(text(value?.error?.message||value.error,500))||'Could not complete the video task. Check readiness and try again.';state.notice=value.status==='orphaned'?'The previous task was interrupted while reopening the app.':'Could not complete the video task.';}
        else state.notice=phaseLabel(state.job);
        persist();return true;
      }catch(error){if(current(token,project,epoch)){++failures;state.error=uiMessage(text(error.message,500));state.notice='Check video task status again.';}return false;}
      finally{if(polling===token)polling=null;if(current(token,project,epoch)){publish();if(failures<3)queue();}}
    }
    async function cancel(){
      if(dead||!state.job||!ACTIVE.has(state.job.status)||state.canceling)return false;
      const token=generation,project=state.project_id,epoch=state.epoch,id=state.job.id;
      cancelRequested=id;state.canceling=true;state.error='';state.notice='Requesting video task cancellation.';persist();publish();
      try{await api('/api/video/jobs/'+encodeURIComponent(id)+'/cancel',{});if(!current(token,project,epoch))return false;state.result=null;await refreshJob();return true;}
      catch(error){if(current(token,project,epoch))state.error=uiMessage(text(error.message,500));return false;}
      finally{if(current(token,project,epoch)){state.canceling=false;publish();queue();}}
    }
    function reset(){
      const previous=state.job;if(previous&&ACTIVE.has(previous.status))void api('/api/video/jobs/'+encodeURIComponent(previous.id)+'/cancel',{}).catch(()=>{});
      ++generation;stopTimer();cancelRequested=null;state.project_id=makeId();state.epoch=0;state.scene=null;state.prompt='';state.profile='preview';state.useReference=false;state.reference=null;state.referencePreviewUnavailable=false;state.selectingReference=false;state.job=null;state.pendingSubmission=null;state.pendingBinding=null;state.result=null;state.guide_url=null;state.error='';state.submitting=false;state.canceling=false;state.picking=false;state.notice='Import a Blender file for the new project.';persist();publish();
    }
    async function restore(){
      let value;try{value=JSON.parse(storage?.getItem(STORAGE_KEY)||'null');}catch{state.storageError='Could not read the previous video task record.';}
      if(value?.schema===1&&validId(value.project_id)&&Number.isSafeInteger(value.epoch)&&value.epoch>=0){
        state.project_id=value.project_id;state.epoch=value.epoch;state.prompt=text(value.prompt);state.profile=PROFILE_NAMES.has(value.profile)?value.profile:'preview';state.reference=thinReference(value.reference);state.useReference=value.useReference===true&&!!state.reference&&state.reference.project_id===value.project_id;
        if(validId(value.scene?.scene_id)&&text(value.scene?.name,255))state.scene={scene_id:value.scene.scene_id,name:text(value.scene.name,255)};
        if(validId(value.job?.id)&&value.job.project_id===value.project_id&&value.job.epoch===value.epoch){
          const binding=Object.hasOwn(value.job,'binding')?thinBinding(value.job.binding):legacyBinding();
          if(binding){state.job={id:value.job.id,status:'queued',phase:'restoring',project_id:value.project_id,epoch:value.epoch,binding};if(value.job.cancel_requested===true)cancelRequested=value.job.id;}
          else state.storageError='Could not read the previous video task profile and reference verification values.';
        }
        else if(value.pendingSubmission&&validId(value.pendingSubmission.scene_id)&&value.pendingSubmission.project_id===value.project_id&&value.pendingSubmission.epoch===value.epoch&&typeof value.pendingSubmission.prompt==='string'&&value.pendingSubmission.prompt.length<=1200&&value.pendingSubmission.seed===42&&(!Object.hasOwn(value.pendingSubmission,'profile')||PROFILE_NAMES.has(value.pendingSubmission.profile))&&(!Object.hasOwn(value.pendingSubmission,'reference_id')||referenceId(value.pendingSubmission.reference_id))&&Object.keys(value.pendingSubmission).every(key=>['scene_id','project_id','epoch','prompt','seed','profile','reference_id'].includes(key))){state.pendingSubmission={scene_id:value.pendingSubmission.scene_id,project_id:value.project_id,epoch:value.epoch,prompt:value.pendingSubmission.prompt,seed:42,...(value.pendingSubmission.profile==='fullbody'?{profile:'fullbody'}:{}),...(referenceId(value.pendingSubmission.reference_id)?{reference_id:value.pendingSubmission.reference_id}:{})};const restoredBinding=Object.hasOwn(value,'pendingBinding')?thinBinding(value.pendingBinding):submissionBinding(state.pendingSubmission,state.reference);
          state.pendingBinding=bindingMatches(restoredBinding,state.pendingSubmission)?restoredBinding:null;
          if(!state.pendingBinding)state.storageError='Could not read the previous video request profile and reference verification values.';
          state.notice='Could not verify the previous request response. Click Recheck connection.';}
        else if(value.pendingSubmission)state.storageError='The previous video request record has invalid values and was not restored. Review it before making a new request.';
      }
      publish();await check();if(state.job)await refreshJob();return snapshot();
    }
    return Object.freeze({getState:snapshot,check,selectScene,setPrompt,setProfile,selectReference,clearReference,referencePreviewFailed,submit,cancel,refreshJob,recoverSubmission:()=>submit({recover:true}),restore,reset,destroy(){dead=true;++generation;stopTimer();}});
  }
  function phaseLabel(job){
    if(job.status==='canceling')return 'Stopping video task.';
    const labels={queued:'Waiting in the video generation queue.',preparing:'Preparing video generation.',preparing_guide:'Creating a composition guide in Blender.',checking_memory:'Checking memory for video generation.',waiting_gpu:'Waiting for other image or video tasks to finish.',guide:'Creating a composition guide in Blender.',blender:'Creating a composition guide in Blender.',rendering:'Creating a composition guide in Blender.',loading:'Loading video model.',model_loading:'Loading video model.',denoising:'AI is generating the video.',generating:'AI is generating the video.',sampling:'AI is generating the video.',encoding:'Saving video file.',verifying:'Verifying completed video file.',restoring:'Checking previous video task.'};
    return labels[job.phase]||(job.status==='queued'?labels.queued:'Processing video task.');
  }
  function mount(doc,studio){
    const find=id=>doc.getElementById(id),page=find('videoWorkspace');if(!page)return null;
    let controller,composing=false,dead=false,initialized=false,unsubscribe=null;const disposers=[];
    const on=(node,type,handler)=>{node?.addEventListener(type,handler);disposers.push(()=>node?.removeEventListener(type,handler));};
    const write=(id,value)=>{if(find(id))find(id).textContent=value;};
    function media(node,url){if(!node)return;if(url){if(node.getAttribute('src')!==url){node.src=url;node.load?.();}}else if(node.hasAttribute('src')){node.pause?.();node.removeAttribute('src');node.load?.();}}
    function render(state){
      const locked=!initialized||state.busy||state.picking,caps=state.capabilities,defaults=(state.profile==='fullbody'?caps?.profiles?.fullbody:caps?.defaults)||{},hasResult=!!state.result;
      const reference=state.reference,nextReference=state.useReference&&reference?.project_id===state.project_id&&reference.epoch===state.epoch+1?reference:null;
      const active=state.submitting||!!state.pendingSubmission||state.canceling||ACTIVE.has(state.job?.status),binding=active?(state.pendingBinding||state.job?.binding):null;
      const boundReference=binding?.reference_id&&reference?.reference_id===binding.reference_id&&reference.sha256===binding.reference_sha256&&reference.project_id===state.project_id&&reference.epoch===state.epoch?reference:null;
      const previewReference=active?boundReference:nextReference;
      const referenceDetails=value=>value.name+' · '+value.width+' × '+value.height;
      let referenceStatus;
      if(state.selectingReference)referenceStatus='Saving selected image.';
      else if(active&&binding?.reference_id)referenceStatus=(ACTIVE.has(state.job?.status)?'In use for current video · ':'Reference requested for this video · ')+(boundReference?referenceDetails(boundReference):'Saved reference image');
      else if(active)referenceStatus=binding?'The current video does not use a reference image.':'Checking video request reference information.';
      else if(nextReference)referenceStatus='Reference ready for next video · '+referenceDetails(nextReference);
      else if(state.useReference)referenceStatus=reference?.project_id===state.project_id&&reference.epoch===state.epoch?'This reference was used for the previous video. Click Use current image again for a new video.':'Click Use current image to prepare a reference for a new video.';
      else referenceStatus='No reference image. Creates a new video from the Blender composition and description.';
      if(previewReference&&state.referencePreviewUnavailable)referenceStatus+=' · Preview unavailable.';
      if(find('videoProfile')){find('videoProfile').disabled=locked;find('videoProfile').value=state.profile;}
      if(find('videoUseReference')){find('videoUseReference').disabled=locked;find('videoUseReference').checked=state.useReference;}
      if(find('videoSelectReference'))find('videoSelectReference').disabled=locked||!state.scene;
      if(find('videoReferencePreview')){const image=find('videoReferencePreview');image.hidden=state.selectingReference||!previewReference||state.referencePreviewUnavailable;if(!image.hidden)image.src=previewReference.preview_url;else image.removeAttribute('src');}
      write('videoReferenceStatus',referenceStatus);
      page.dataset.videoState=state.job?.status||'idle';page.setAttribute('aria-busy',String(state.busy));
      find('videoPickScene').disabled=locked||!root.pankekiDesktop?.pickVideoScene;
      write('videoSceneName',state.scene?.name||'No file selected.');
      const prompt=find('videoPrompt');prompt.disabled=locked;if(!composing&&prompt.value!==state.prompt)prompt.value=state.prompt;
      find('videoGenerate').disabled=locked||!caps?.ready||!state.scene||!state.prompt.trim()||state.useReference&&!nextReference;
      find('videoCancel').hidden=!state.busy||!state.job;find('videoCancel').disabled=state.canceling||state.job?.status==='canceling';
      find('videoRefresh').disabled=state.checking||state.submitting;write('videoRefresh',state.checking?'Checking readiness…':'Recheck connection');
      write('videoReadiness',!root.pankekiDesktop?.pickVideoScene?'Import Blender files in the installed Pankeki app.':state.checking&&!caps?'Checking video generation readiness.':caps?.ready?'Local video generation ready':uiMessage(caps?.reason)||'Check video generation readiness.');
      const size=Number.isInteger(defaults.width)&&Number.isInteger(defaults.height)?defaults.width+' × '+defaults.height:'384 × 256';
      const duration=Number.isFinite(defaults.frames)&&Number.isFinite(defaults.fps)&&defaults.fps>0?(defaults.frames/defaults.fps).toFixed(1):'2.0';
      write('videoFormat',(state.profile==='fullbody'?'Full-body video':'Quick preview')+' · '+size+' · About '+duration+'s');write('videoStatus',state.picking?'Importing Blender file.':state.notice);
      find('videoError').hidden=!state.error;write('videoError',uiMessage(state.error));find('videoStorageError').hidden=!state.storageError;write('videoStorageError',uiMessage(state.storageError));
      const progress=find('videoProgress');progress.hidden=!state.busy;if(Number.isFinite(state.job?.progress))progress.value=state.job.progress;else progress.removeAttribute('value');
      write('videoElapsed',state.busy&&Number.isFinite(state.job?.elapsed_seconds)?'Elapsed '+Math.floor(state.job.elapsed_seconds)+'s':'');
      find('videoResult').hidden=!hasResult;find('videoEmpty').hidden=hasResult;
      media(find('videoPlayer'),state.result?.url);find('videoSave').hidden=!hasResult;
      if(hasResult){find('videoSave').href=state.result.url;find('videoSave').download=state.result.filename;}else{find('videoSave').removeAttribute('href');find('videoSave').removeAttribute('download');}
      find('videoGuideDetails').hidden=!state.guide_url;media(find('videoGuidePlayer'),state.guide_url);
      write('videoEmptyTitle',state.busy?'Generating video.':'Completed video appears here.');write('videoEmptyCopy',state.busy?'Play and save it here when complete.':'Start with a Blender file and a brief description.');
    }
    let storage;try{storage=root.localStorage;}catch{}
    controller=createController({storage,getSelectedReference:()=>{
      const summary=studio.getSummary?.();if(!summary||summary.importing||summary.busy||!summary.imageUrl)fail('Select an image candidate and try again after the current task finishes.');
      const state=studio.getState?.(),candidates=state?.project?.versions||[];
      const candidate=candidates.find(item=>item.id===summary.sourceId&&item.image===summary.imageUrl)||candidates.find(item=>item.id===summary.latestId&&item.image===summary.imageUrl);
      if(!candidate)fail('Could not verify the visible image candidate. Select it again.');
      return {image:candidate.image,candidate_id:candidate.id,source_revision:String(summary.sourceRevision),name:candidate.label||candidate.id};
    },pickScene:root.pankekiDesktop?.pickVideoScene?()=>root.pankekiDesktop.pickVideoScene():null,onChange:render});
    on(find('videoReferencePreview'),'error',()=>{const reference=controller.getState().reference;if(reference)controller.referencePreviewFailed(reference.reference_id);});
    on(find('videoProfile'),'change',event=>controller.setProfile(event.target.value));
    on(find('videoUseReference'),'change',event=>{if(event.target.checked)void controller.selectReference();else controller.clearReference();});
    on(find('videoSelectReference'),'click',()=>void controller.selectReference());
    on(find('videoPickScene'),'click',()=>void controller.selectScene());on(find('videoGenerate'),'click',()=>{if(!composing)void controller.submit();});on(find('videoCancel'),'click',()=>void controller.cancel());
    on(find('videoRefresh'),'click',async()=>{await controller.check();if(controller.getState().pendingSubmission)await controller.recoverSubmission();else if(controller.getState().job)await controller.refreshJob();});
    on(find('videoPrompt'),'compositionstart',()=>{composing=true;});on(find('videoPrompt'),'compositionend',event=>{composing=false;controller.setPrompt(event.target.value);});on(find('videoPrompt'),'input',event=>{if(!composing&&!event.isComposing)controller.setPrompt(event.target.value);});
    const observer=new root.MutationObserver(()=>{if(doc.body.dataset.studioScreen!=='video'){find('videoPlayer').pause?.();find('videoGuidePlayer').pause?.();}});observer.observe(doc.body,{attributes:true,attributeFilter:['data-studio-screen']});
    render(controller.getState());
    void Promise.resolve(studio.ready).then(async()=>{if(dead)return;unsubscribe=studio.subscribe((_summary,reason)=>{if(['reset','import','motion-import','v3-import'].includes(reason))controller.reset();});await controller.restore();if(dead)return;initialized=true;render(controller.getState());}).catch(()=>{initialized=true;render(controller.getState());});
    return Object.freeze({...controller,destroy(){dead=true;unsubscribe?.();observer.disconnect();for(const dispose of disposers.splice(0))dispose();controller.destroy();}});
  }
  return Object.freeze({STORAGE_KEY,createController,checkedAsset,phaseLabel,mount});
});

/* The reference UI composes the existing editor; inference and documents retain
 * their original owners. Moving a control preserves its handlers and state. */
(function(root,factory){
  'use strict';
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else {
    root.PankekiRedesign=api;
    if(root.document&&root.PankekiStudio&&root.PankekiWorkflowController&&root.document.getElementById('redesignAssets')) api.mount(root.document,root.PankekiStudio,root.PankekiWorkflowController);
  }
})(typeof globalThis==='object'?globalThis:this,function(root){
  'use strict';
  const categories=Object.freeze([
    {id:'character',label:'캐릭터',asset:'catgirl-hero',style:'Expressive original character design, detailed 2d anime illustration.'},
    {id:'illustration',label:'일러스트',asset:'category-landscape',style:'Beautiful painterly illustration, harmonious colors, detailed composition.'},
    {id:'background',label:'배경',asset:'category-background',style:'Detailed environment background illustration, atmospheric lighting, no characters.'},
    {id:'concept',label:'콘셉트 아트',asset:'category-concept',style:'Fantasy concept art, cinematic lighting, rich environmental storytelling.'},
    {id:'portrait',label:'실사풍',asset:'category-portrait',style:'Natural photographic realism, soft cinematic light, detailed textures.'},
    {id:'chibi',label:'SD 캐릭터',asset:'category-chibi',style:'Cute chibi character illustration, small body, expressive face, clean shapes.'},
    {id:'other',label:'기타',asset:'category-other',style:'Creative colorful illustration, playful imaginative composition.'}
  ]);
  const templates=Object.freeze([
    {id:'catgirl',label:'고양이 귀',asset:'catgirl-hero',category:'character',prompt:'A gentle adult cat-eared girl with honey brown hair, amber eyes, a cream sweater and small red ribbons, warm sunlight, detailed anime illustration'},
    {id:'postman',label:'기본 남자 캐릭터',asset:'template-postman',category:'character',prompt:'A cheerful young adult male letter courier, tousled auburn hair, amber eyes, a cream shirt and an orange scarf, warm painterly anime illustration'},
    {id:'pink',label:'기본 여자 캐릭터',asset:'category-chibi',category:'chibi',prompt:'A cheerful pink-haired chibi girl with curled twin tails and small pink bows, rosy cheeks, pastel peach background, polished 2d illustration'},
    {id:'maid',label:'메이드복',asset:'template-maid',category:'character',prompt:'An adult anime woman with an ash gray bob, a modest black and cream Victorian maid outfit and a small bow headband, warm gentle portrait'},
    {id:'bedroom',label:'배경 일러스트',asset:'category-background',category:'background',prompt:'A cozy sunlit bedroom with warm wood, soft cream textiles and orange afternoon light, detailed background illustration, no characters'},
    {id:'landscape',label:'풍경 일러스트',asset:'category-landscape',category:'illustration',prompt:'A colorful fantasy castle landscape among mountains and trees, warm sunlight, detailed painterly illustration, no characters'}
  ]);
  function preparePrompt(value,id,mode='txt2img'){
    if(typeof value!=='string'||!value.trim())throw Error('원하는 이미지 설명을 먼저 입력해주세요.');
    let text=value.trim();
    if(mode==='inpaint'){
      text=descriptionText(text);
      if(text.length>4000)throw Error('이미지 설명이 너무 길어요. 조금 줄여주세요.');
      return text;
    }
    for(const item of categories)if(text.endsWith(item.style))text=text.slice(0,-item.style.length).trim();
    const style=(categories.find(item=>item.id===id)||categories[0]).style;
    if(text.length+style.length+2>4000)throw Error('이미지 설명이 너무 길어요. 조금 줄여주세요.');
    return text+'\n\n'+style;
  }
  async function submitPrompt(studio,input,category){
    const summary=studio.getSummary();
    if(summary.mode==='inpaint'&&summary.editOperation==='recolor')return studio.generate();
    input.value=preparePrompt(input.value,category,summary.mode);
    input.dispatchEvent(new root.Event('input',{bubbles:true}));
    return studio.generate();
  }
  function descriptionText(value){
    let text=(value||'').trim();
    for(const item of categories)if(text.endsWith('\n\n'+item.style)){text=text.slice(0,-item.style.length).trim();break;}
    return text;
  }
  function conversationEntries(project){
    return project.versions.map((item,index)=>{
      const request=item.request||{},metrics=item.metrics||{},derived=item.kind==='derived',recolor=request.edit_operation==='recolor';
      const operation=derived?item.derivation.operation:recolor?'recolor':'regenerate';
      const operationLabel=request.mode==='img2img'?'참조 이미지로 구도 변경':derived?({'markup':'마크업','background-remove':'배경 제거','erase':'지우기','resize':'크기 조정'})[operation]:null;
      const prompt=item.kind==='upload'||derived?'':recolor?`색상 변경 · ${request.target_color}`:descriptionText(item.brief.prompt||request.prompt);
      return {id:item.id,ordinal:index+1,kind:item.kind,image:item.image,prompt,label:item.label,createdAt:item.createdAt,requestMode:request.mode,
        operation,operationLabel,skipped:metrics.skipped===true||(typeof metrics.skipped==='string'&&metrics.skipped.length>0)||metrics.cache==='empty-mask-skip',targetColor:request.target_color,
        model:request.model_id||'',width:derived?item.derivation.outputWidth:request.width,height:derived?item.derivation.outputHeight:request.height,parentId:item.parentId};
    });
  }
  function mount(doc,studio,workflow){
    if(doc.body.classList.contains('pankeki-redesign'))return;
    let desktopBinding=null,aiState=null,aiCategory=null;const aiTurns=new Map();
    const $=id=>doc.getElementById(id), assets=JSON.parse($('redesignAssets').textContent);
    const art=assets.images, icons=assets.icons;
    const icon=name=>icons[name]||'';
    const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const img=(name,alt='',cls='')=>`<img src="${art[name]||''}" alt="${esc(alt)}" class="${cls}" draggable="false">`;
    const button=(label,name,attrs='',cls='pk-icon-button')=>`<button type="button" class="${cls}" ${attrs} aria-label="${esc(label)}" title="${esc(label)}">${icon(name)}</button>`;
    const shell=doc.querySelector('.app-shell'), home=doc.querySelector('[data-studio-page="home"]'),projectsPage=$('pcProjectsPage');
    const originalHeader=doc.querySelector('.app-header'), originalLogo=originalHeader.querySelector('.brand-logo');
    const layout=doc.createElement('div');layout.className='pk-layout';
    layout.innerHTML=`
      <aside class="pk-sidebar" aria-label="메인 메뉴">
        <a class="pk-brand" href="#home" aria-label="Pankeki 홈"><img src="${originalLogo.src}" alt=""><span>Pankeki</span></a>
        <nav class="pk-navigation" aria-label="Pankeki 작업 메뉴">
          ${[['home','home','홈'],['projects','folder','프로젝트'],['design','image','이미지 생성'],['inpaint','pencil','디자인'],['parts','layers','부위 편집'],['motion','sparkles','표정 · 동작'],['export','download','출력']].map(([route,name,label])=>`<button type="button" data-pk-route="${route}" aria-label="${label}" title="${label}">${icon(name)}<span>${label}</span></button>`).join('')}
          <button type="button" class="pk-gallery-nav" data-pk-action="gallery" aria-label="갤러리" title="갤러리">${icon('grid-2x2')}<span>갤러리</span></button><span class="pk-nav-divider"></span>
          <button type="button" data-pk-action="templates" aria-label="템플릿" title="템플릿">${icon('layers')}<span>템플릿</span></button>
          <button type="button" data-pk-action="models" aria-label="모델 관리" title="모델 관리">${icon('box')}<span>모델 관리</span></button>
          <button type="button" data-pk-action="settings" aria-label="설정" title="설정">${icon('settings')}<span>설정</span></button>
        </nav>
        <div class="pk-sidebar-bottom">
          <div class="pk-brand-card"><strong>Pankeki</strong><p>상상하는 캐릭터를<br>더 쉽게, 더 자유롭게.</p>${img('pancake-cat')}</div>
          <div class="pk-storage" role="group" aria-label="브라우저 저장소 추정값" title="화면을 열 때 확인한 브라우저 저장소 추정값입니다. 앱 전용 확보 공간이나 기기 전체 여유 공간을 뜻하지 않습니다."><span>${icon('hard-drive')}브라우저 저장소</span><progress id="pkStorageBar" max="100" value="0" hidden aria-label="브라우저 저장소 추정 사용 비율"></progress><small id="pkStorageText">저장소 추정값을 확인할 수 없어요.</small></div>
        </div>
      </aside>
      <div class="pk-surface">
        <header class="pk-header">
          <div class="pk-home-search">${icon('search')}<label class="sr-only" for="pkSearch">프로젝트와 현재 후보 검색</label><input id="pkSearch" type="search" placeholder="프로젝트·현재 후보 검색..."><kbd>⌘ K</kbd></div>
          <h1 id="pkScreenTitle" tabindex="-1">이미지 생성</h1>
          <span class="pc-header-context" id="pcProjectName"></span>
          <div class="pk-header-home-actions">${button('작업 알림','bell','data-pk-action="notifications" aria-controls="pcNotifications" aria-haspopup="dialog" aria-expanded="false" data-unread-count="0"')}${button('설정 열기','settings','data-pk-action="settings"')}<button type="button" class="pk-avatar" data-pk-action="profile" aria-label="로컬 프로필" title="로컬 프로필" aria-controls="pcProfilePopover" aria-haspopup="dialog" aria-expanded="false"><span id="pcProfileInitial" aria-hidden="true">로</span></button></div>
          <div class="pk-header-generation-actions"><button type="button" class="pk-toolbar-button" data-pk-action="prompts" aria-label="추천 프롬프트" title="추천 프롬프트">${icon('sparkles')}<span>추천 프롬프트</span></button><button type="button" class="pk-toolbar-button" data-pk-action="reference" aria-label="참고 이미지" title="참고 이미지">${icon('image')}<span>참고 이미지</span></button><button type="button" class="pk-toolbar-button" data-pk-action="settings" aria-label="고급 설정" title="고급 설정">${icon('sliders-horizontal')}<span>고급 설정</span></button></div>
          <div class="pc-reference-project-actions"><button type="button" id="pcSaveAsProject" class="pc-save-as-project" data-pk-action="save-as-project" aria-label="프로젝트로 저장">${icon('folder')}<span>프로젝트로 저장</span></button>${button('새 프로젝트','plus','data-pk-action="new"')}${button('프로젝트 열기','folder-open','data-pk-action="import"')}${button('갤러리','grid-2x2','data-pk-action="gallery"')}</div>
        </header>
        <div class="pk-pages"></div>
      </div>`;
    doc.body.prepend(layout);doc.body.classList.add('pankeki-redesign','pankeki-pc','pankeki-spacious');
    const pages=layout.querySelector('.pk-pages');
    home.className='pk-home';home.setAttribute('aria-label','Pankeki 홈');home.removeAttribute('aria-labelledby');
    home.innerHTML=`
      <main class="pc-home-main" aria-labelledby="pcHomeHeading">
        <section class="pc-home-hero"><div><p class="pc-home-brand-name">Pankeki</p><h1 id="pcHomeHeading">상상하는 캐릭터를<strong>더 쉽게, 더 자유롭게.</strong></h1><p class="pc-home-introduction">아이디어를 말하면, Pankeki가 이미지를 만들어 드려요.</p></div>${img('pancake-cat','','pc-home-hero-art')}</section>
        <section id="pcHomeComposer" class="pc-home-composer" aria-label="Pankeki에 작업 요청"></section>
        <section class="pk-home-templates"><div class="pk-section-title"><h2>추천 템플릿</h2><button type="button" class="pk-text-button" data-pk-action="templates">전체 보기 ${icon('chevron-right')}</button></div><div class="pk-template-thumbnails">${[templates[2],templates[1],templates[0],templates[3],templates[4],templates[5]].map(item=>`<button type="button" data-pk-template="${item.id}" aria-label="${esc(item.label)} 템플릿">${img(item.asset)}<span>${item.label}</span></button>`).join('')}</div></section>
      </main>
      <aside class="pc-home-rail" aria-label="프로젝트 목록과 시작 도구">
        <section class="pc-home-recent pc-home-projects"><div class="pk-section-title"><h2 id="pcProjectLibraryHeading" tabindex="-1">프로젝트 목록</h2><button type="button" class="pk-text-button" data-pk-action="gallery">현재 후보 보기 ${icon('chevron-right')}</button></div><div class="pc-home-project-summary"><div id="pcHomeProjectSummary"><strong>현재 작업</strong><span id="studioTitle" class="sr-only"></span><span id="pcHomeCandidateSummary"></span></div>${button('현재 프로젝트 즐겨찾기','star','id="pkFavorite" aria-pressed="false"')}${button('현재 프로젝트 작업으로 이동','ellipsis','data-pk-action="projects"')}</div><p id="pcProjectLibraryStatus" class="pc-project-status" role="status" aria-live="polite"></p><div id="pkRecentGrid" class="pc-project-list"></div><div id="pcProjectLibraryActions" class="pc-project-actions" role="group" aria-label="프로젝트 파일과 새 작업"><button type="button" class="pc-project-new" data-pk-action="new">${icon('plus')}새 프로젝트</button><button type="button" data-pk-action="import" aria-label="열기" title="열기">${icon('folder-open')}<span>열기</span></button><button type="button" data-pk-action="save" aria-label="파일 저장" title="파일 저장">${icon('download')}<span>파일 저장</span></button></div><div class="pc-project-paging" id="pcProjectPaging" hidden>${button('이전 프로젝트 페이지','chevron-right','id="pcProjectPrevious"')}<span id="pcProjectPage" aria-live="polite"></span>${button('다음 프로젝트 페이지','chevron-right','id="pcProjectNext"')}</div><button type="button" class="pc-project-retry" id="pcProjectRetry" hidden>앱 목록 저장 다시 시도</button><p class="pk-search-empty" id="pkSearchEmpty" hidden>프로젝트 이름과 현재 후보에서 검색 결과를 찾지 못했어요.</p></section>
        <section class="pk-quick-start"><h2>빠른 시작</h2>${[['reference','image','이미지로 시작하기','이미지를 불러와 편집해보세요.','violet'],['generate','sparkles','AI로 생성하기','원하는 이미지를 입력해보세요.','pink'],['new','file-plus','빈 프로젝트','새로운 프로젝트를 시작합니다.','orange']].map(([action,name,title,desc,color])=>`<button type="button" data-pk-action="${action}"><span class="pk-quick-icon ${color}">${icon(name)}</span><span><strong>${title}</strong><small>${desc}</small></span>${icon('chevron-right')}</button>`).join('')}</section>
        <section class="pc-home-tip">${icon('lightbulb')||icon('sparkles')}<div><h2>작업 팁</h2><p>원하는 스타일과 구도, 분위기를 함께 적어보세요.</p><button type="button" data-pk-action="prompts">추천 설명 보기 ${icon('chevron-right')}</button></div></section>
      </aside>`;
    if(art['home-honey-background'])layout.style.setProperty('--pc-home-background',`url("${art['home-honey-background']}")`);
    $('pkSearch').placeholder='프로젝트·현재 후보 검색…';layout.querySelector('label[for="pkSearch"]').textContent='프로젝트 이름과 현재 후보 이름·설명 검색';
    pages.append(home,projectsPage,shell);
    const motion=$('motionEditor');if(motion)pages.append(motion);
    const video=$('videoWorkspace');if(video)pages.append(video);
    // Existing tools live in one accessible drawer; retain every ID and handler.
    const drawer=doc.createElement('dialog');drawer.id='pkSettings';drawer.className='pk-drawer';
    drawer.setAttribute('aria-labelledby','pkSettingsTitle');
    const settingCategories=[['chat','pcChatTab','AI 대화'],['model','pcOptionsTab','이미지 생성'],['edit','pcEditTab','부분 수정'],['environment','pcEnvironmentTab','작업 환경'],['brief','pcBriefTab','캐릭터']];
    drawer.innerHTML=`<div class="pk-dialog-heading"><h2 id="pkSettingsTitle">이미지 생성 설정</h2>${button('설정 닫기','x','data-pk-close')}</div><div class="pk-drawer-tabs" role="tablist" aria-label="설정 종류" aria-orientation="vertical">${settingCategories.map(([key,id,label])=>`<button type="button" role="tab" id="${id}" aria-controls="${key==='brief'?'chatPanel':'pcModelPanel'}" data-pk-panel="${key}">${label}</button>`).join('')}</div><div class="pk-drawer-content"></div><div class="pk-library-actions"><button type="button" class="pk-primary pk-settings-done" data-pk-close>설정 완료</button></div>`;
    doc.body.append(drawer);
    const chatPanel=$('chatPanel'), modelPanel=shell.querySelector('.warm-generation-panel');
    modelPanel.id='pcModelPanel';modelPanel.setAttribute('role','tabpanel');modelPanel.setAttribute('aria-labelledby','pcOptionsTab');
    chatPanel.setAttribute('role','tabpanel');chatPanel.setAttribute('aria-labelledby','pcBriefTab');
    drawer.querySelector('.pk-drawer-content').append(chatPanel,modelPanel);
    drawer.dataset.panel='model';
    const advancedBody=$('advanced').querySelector('.details-body'),moreSettings=doc.createElement('details');
    moreSettings.className='pc-more-settings';moreSettings.innerHTML='<summary>세부 생성 설정</summary>';
    for(const node of Array.from(advancedBody.children).slice(3))if(!node.classList.contains('model-note'))moreSettings.append(node);
    // Keep candidate count configurable, but execute only from the composer.
    advancedBody.append(modelPanel.querySelector('.generation-count'));
    modelPanel.querySelector('.generate-dock').hidden=true;
    advancedBody.append(moreSettings);
    const modelNote=modelPanel.querySelector('.model-note'),modelGuide=doc.createElement('details');modelGuide.className='pc-model-guide';modelGuide.innerHTML='<summary>모델 안내</summary>';advancedBody.append(modelGuide);modelGuide.append(modelNote);
    for(const node of advancedBody.children)node.dataset.pkSettingsSection='model';
    modelPanel.querySelector('.model-note').dataset.pkSettingsSection='model';
    const editSettings=doc.createElement('section');editSettings.className='pc-settings-section';editSettings.dataset.pkSettingsSection='edit';
    editSettings.innerHTML='<h3>수정 옵션</h3>';
    const denoiseField=$('denoise').closest('.field');denoiseField.parentNode.classList.add('pc-single-field');editSettings.append(denoiseField,$('roiOptions'));advancedBody.append(editSettings);
    const environmentSettings=doc.createElement('section');environmentSettings.className='pc-settings-section';environmentSettings.dataset.pkSettingsSection='environment';
    const executionHeading=Array.from(moreSettings.querySelectorAll('.option-heading')).find(node=>node.textContent==='실행');
    environmentSettings.append(executionHeading,$('cache').closest('label'),$('previewOn').closest('label'),$('clearCache'));advancedBody.append(environmentSettings);
    const negativeLabel=modelPanel.querySelector('label[for="negative"]'),negativeHint=$('negative').closest('.field').querySelector('.hint');
    const negativePresentation={label:negativeLabel.textContent,hint:negativeHint.textContent};
    const projectName=originalHeader.querySelector('.project-name');environmentSettings.prepend(projectName);
    const prompt=$('prompt');prompt.placeholder='원하는 이미지를 입력하세요...';prompt.rows=1;prompt.setAttribute('aria-label','원하는 이미지 설명');
    // The original field remains the model/document boundary. Its appended
    // style instruction is represented by the style control, not editable UI.
    const editor=doc.createElement('textarea');editor.id='pcPrompt';editor.rows=1;editor.maxLength=4000;editor.placeholder=prompt.placeholder;editor.setAttribute('aria-label','원하는 이미지 설명');
    prompt.hidden=true;
    const workspace=$('workspace');workspace.classList.add('pk-generation-workspace');
    const empty=$('empty');
    if(empty){const illustration=doc.createElement('div');illustration.className='pk-empty-art';illustration.innerHTML=img('pancake-cat','팬케이크와 고양이 일러스트');empty.prepend(illustration);}
    const categoryRow=doc.createElement('div');categoryRow.className='pk-categories';categoryRow.dataset.pkSettingsSection='model';categoryRow.setAttribute('aria-label','이미지 스타일');
    categoryRow.setAttribute('role','group');categoryRow.setAttribute('aria-labelledby','pcStyleLabel');
    categoryRow.innerHTML='<span class="pc-style-label" id="pcStyleLabel">스타일</span>'+categories.map(item=>`<button type="button" class="pk-category ${item.id==='character'?'selected':''}" data-pk-category="${item.id}" aria-label="${item.label}" title="${item.id==='chibi'?'머리가 크고 몸이 작은 캐릭터 스타일':item.label+' 스타일을 이미지 설명에 함께 반영'}" aria-pressed="${item.id==='character'}">${img(item.asset)}<span>${item.label}</span></button>`).join('');
    const composer=doc.createElement('div');composer.className='pk-composer-dock';
    composer.innerHTML=`<form class="pk-composer" id="pkPromptForm"><label class="pc-prompt-label" for="prompt">이미지 설명</label><div class="pk-prompt-slot"></div><div class="pc-composer-bar"><div class="pc-composer-tools">${button('원본 이미지 첨부','paperclip','data-pk-action="reference"','pc-tool-button')}<button type="button" class="pc-setting-button" data-pk-action="settings" data-pk-setting-target="imageModel" aria-label="이미지 모델 설정"><span id="pcModelName">모델 확인 중</span>${icon('chevron-down')}</button><button type="button" class="pc-setting-button" id="pcResolution" data-pk-action="settings" data-pk-setting-target="width" aria-label="이미지 크기 설정"></button>${button('생성 옵션 열기','sliders-horizontal','data-pk-action="settings"','pc-tool-button')}</div><div class="pc-send-tools"><span class="pc-key-hint"><kbd>Enter</kbd> 생성 · <kbd>Shift Enter</kbd> 줄바꿈</span><button type="submit" id="pkGenerate" class="pk-send" aria-label="이미지 생성하기">${icon('send-horizontal')}</button></div></div></form><div class="pk-composer-meta"><span id="pkModelHint">이미지 모델 확인 중</span><span id="pkComposerStatus" role="status" aria-live="polite"></span><button type="button" data-pk-action="gallery" id="pkGalleryOpen">후보 0개</button><button type="button" id="pkCancel" hidden>생성 취소</button></div>`;
    composer.querySelector('label[for=prompt]').htmlFor='pcPrompt';
    const composerTarget=doc.createElement('button');composerTarget.type='button';composerTarget.id='pcComposerTarget';composerTarget.className='pc-composer-target';composerTarget.hidden=true;composerTarget.innerHTML='<img alt=""><span></span>';composer.prepend(composerTarget);
    const editContext=doc.createElement('div');editContext.className='pc-edit-context';editContext.dataset.pkSettingsSection='edit';editContext.append($('inpaintOperations'));composer.prepend(editContext);
    const operationSelect=composer.querySelector('#editOperation'),operationCaption=doc.createElement('span');
    operationCaption.textContent='수정 방식';
    operationSelect.closest('label').replaceChildren(operationCaption,operationSelect);
    const composerAnchor=doc.createElement('span');composerAnchor.id='pcComposerAnchor';composerAnchor.hidden=true;
    composer.querySelector('.pk-prompt-slot').append(composerTarget,prompt,editor);shell.append(categoryRow,composerAnchor,composer);
    const homeShortcuts=doc.createElement('div');homeShortcuts.className='pc-home-shortcuts';homeShortcuts.hidden=true;homeShortcuts.setAttribute('role','group');homeShortcuts.setAttribute('aria-label','작업 바로가기: 화면 이동과 프로젝트 파일 열기');homeShortcuts.innerHTML=`<span class="pc-home-shortcuts-label">작업 바로가기</span><button type="button" data-pk-action="generate" aria-label="이미지 생성 화면으로 이동" title="이미지 생성 화면으로 이동">${icon('image')}이미지 생성</button><button type="button" data-pk-route="inpaint" aria-label="디자인 화면으로 이동" title="디자인 화면으로 이동">${icon('pencil')}디자인</button><button type="button" data-pk-route="parts" aria-label="부위 편집 화면으로 이동" title="부위 편집 화면으로 이동">${icon('layers')}부위 편집</button><button type="button" data-pk-action="import" aria-label="저장한 프로젝트 파일 열기" title="저장한 프로젝트 파일 열기">${icon('folder-open')}프로젝트 열기</button>`;composer.querySelector('.pc-composer-tools').append(homeShortcuts);
    const thread=doc.createElement('main');thread.id='pcConversation';thread.tabIndex=-1;thread.className='pc-thread';thread.setAttribute('aria-label','이미지 생성 대화');
    thread.innerHTML=`<div class="pc-thread-inner"><div class="pc-welcome">${img('pancake-cat','')}<h2>무엇을 만들어볼까요?</h2><p>설명을 적거나 참고 이미지를 추가하세요.</p><button type="button" class="pc-template-start" data-pk-action="prompts">추천 프롬프트 ${icon('arrow-right')}</button></div><div class="pc-history" role="log" aria-label="저장된 생성 기록" aria-live="polite" aria-relevant="additions"></div><div class="pc-pending" hidden><div class="pc-message-author"><img src="${originalLogo.src}" alt=""><strong>Pankeki</strong></div><p role="status">이미지를 만들고 있어요…</p></div></div>`;
    shell.prepend(thread);
    shell.classList.add('pc-image-workspace','pc-spacious-workspace');shell.dataset.pcPane='conversation';shell.dataset.pcViewer='closed';
    const paneSwitcher=doc.createElement('div');paneSwitcher.className='pc-pane-switcher';paneSwitcher.setAttribute('aria-label','작업 화면 전환');
    paneSwitcher.innerHTML='<button type="button" id="pcShowConversation" aria-controls="pcConversation" aria-pressed="true">대화</button><button type="button" id="pcShowCanvas" aria-controls="workspace" aria-pressed="false">이미지 캔버스</button>';shell.prepend(paneSwitcher);
    const canvasHeader=doc.createElement('div');canvasHeader.className='pc-canvas-header';
    canvasHeader.innerHTML=`<div class="pc-canvas-heading"><h2 id="pcCanvasTitle">이미지 작업 캔버스</h2><p id="pcCanvasInfo"></p></div><div class="pc-canvas-controls" role="group" aria-label="이미지 보기 도구"><button type="button" id="pcCanvasFit" aria-pressed="true">화면 맞춤</button><button type="button" id="pcCanvasActual" aria-label="원본 픽셀 크기 100%" aria-pressed="false">100%</button><button type="button" id="pcCanvasZoomOut" aria-label="이미지 축소">축소</button><output id="pcCanvasScale" aria-label="이미지 확대 비율"></output><button type="button" id="pcCanvasZoomIn" aria-label="이미지 확대">확대</button><a id="pcCanvasSave" aria-label="선택한 이미지 저장" aria-disabled="true">${icon('download')}저장</a><button type="button" id="pcCanvasClose" aria-label="이미지 크게 보기 닫기">${icon('x')}닫기</button></div><p id="pcCanvasStatus" role="status" aria-live="polite"></p>`;
    workspace.prepend(canvasHeader);workspace.setAttribute('aria-labelledby','pcCanvasTitle');workspace.dataset.candidateId='';
    const canvasActions=doc.createElement('div');canvasActions.className='pc-canvas-actions';canvasActions.innerHTML=`<button type="button" id="pcCanvasEdit">${icon('pencil')}부분 수정</button>`;workspace.append(canvasActions);
    const viewport=$('canvasViewport');viewport.tabIndex=0;viewport.setAttribute('role','region');viewport.setAttribute('aria-label','이미지 작업 캔버스 · 확대하면 스크롤로 이동');viewport.dataset.pcZoom='fit';
    const viewerImage=doc.createElement('img');viewerImage.id='pcViewerImage';viewerImage.className='pc-viewer-image';viewerImage.hidden=true;viewerImage.alt='';viewport.append(viewerImage);
    const canvasOverlay=doc.createElement('div');canvasOverlay.className='pc-canvas-overlay';canvasOverlay.setAttribute('aria-label','캔버스 도구');canvasOverlay.hidden=true;
    const canvasPrimary=doc.createElement('div');canvasPrimary.className='pc-canvas-primary-actions';canvasPrimary.append($('pcCanvasSave'),$('pcCanvasClose'));canvasHeader.append(canvasPrimary);
    canvasOverlay.append(canvasHeader.querySelector('.pc-canvas-controls'),canvasActions,$('editorTools'));viewport.closest('.canvas-card').append(canvasOverlay);
    const candidateStrip=doc.createElement('div');candidateStrip.className='pc-candidate-strip';candidateStrip.setAttribute('role','group');candidateStrip.setAttribute('aria-label','저장된 이미지 후보 · 보기 선택');candidateStrip.hidden=true;viewport.closest('.canvas-card').append(candidateStrip);
    const photoControls=doc.createElement('div');photoControls.id='pcPhotoTools';photoControls.className='pc-photo-tools-host';photoControls.hidden=true;viewport.closest('.canvas-card').append(photoControls);
    const pinContext=doc.createElement('div');pinContext.id='pcPinContext';pinContext.className='pc-pin-context';pinContext.hidden=true;const pinContextText=doc.createElement('span'),pinClear=doc.createElement('button');pinClear.id='pcPinClear';pinClear.type='button';pinClear.textContent='핀 선택 해제';pinContext.append(pinContextText,pinClear);composer.prepend(pinContext);
    let pinModeActive=false,pinSelection=null;
    function setPinMode(active){
      if(active===pinModeActive)return;
      pinModeActive=active;pinContext.hidden=!active;
      if(active)pinContextText.textContent='이미지에서 핀 위치와 수정 범위를 선택하세요.';
      else {
        if(pinSelection&&studio.desktopChat.getState().projectId===pinSelection.projectId&&editor.value===pinSelection.insertedText){editor.value=pinSelection.priorText;editor.dispatchEvent(new root.Event('input',{bubbles:true}));}
        pinSelection=null;
      }
    }
    pinClear.addEventListener('click',()=>{void photoEditor?.cancel();});
    const sourceViews=$('sourceView').closest('.view-tabs'),sourceViewsHome=sourceViews.parentNode;
    const nativeToolPresentation=[$('brushTool'),$('eraserTool'),$('clearMask'),$('editorTools').querySelector('label[for="maskUpload"]')].map(node=>({node,html:node.innerHTML,label:node.getAttribute('aria-label'),title:node.getAttribute('title')}));
    if(empty){const copy=doc.createElement('div');copy.className='pc-workspace-empty-copy';copy.innerHTML='<h2>이미지를 선택하면 크게 볼 수 있어요.</h2><p>왼쪽에서 이미지를 만들거나 기존 후보를 선택하세요.</p>';empty.append(copy);}
    let workspaceEntries=[],viewerId=null,viewerTrigger=null,editorOpen=false,homeConversationOnly=false,workEntry=null,workImage=null,workKey='',workUrl='',zoomMode='fit',zoomPercent=100,fitScale=1,canvasLoadError=false,composerComposing=false,queuedRoute=null;
    let photoEditor=null,photoMounting=false,photoState=null,photoStateKey='',photoOwner=null,viewerEpoch=0;
    function syncPresentation(){const open=editorOpen&&!homeConversationOnly&&['design','inpaint'].includes(doc.body.dataset.studioScreen);shell.dataset.pcEditor=open?'open':'closed';doc.body.classList.toggle('pc-reference-open',!!desktopBinding&&open);}
    function showHomeConversation(){homeConversationOnly=true;followLatest=true;showPane('conversation',false);syncPresentation();revealLatest();}
    function showPane(pane,focus=true){if(pane==='canvas'&&!viewerId&&doc.body.dataset.studioScreen!=='inpaint')return;shell.dataset.pcPane=pane;$('pcShowConversation').setAttribute('aria-pressed',String(pane==='conversation'));$('pcShowCanvas').setAttribute('aria-pressed',String(pane==='canvas'));if(focus)(pane==='canvas'?workspace:editor).focus();}
    function canRestoreFocus(trigger){if(!trigger||!doc.body.contains(trigger)||trigger.disabled)return false;for(let node=trigger;node&&node!==doc;node=node.parentNode){if(node.hidden||node.inert||node.tagName==='DIALOG'&&!node.open)return false;const style=root.getComputedStyle&&node.tagName?root.getComputedStyle(node):null;if(style&&(style.display==='none'||['hidden','collapse'].includes(style.visibility)))return false;}return true;}
    function closeViewer(focus=false){const trigger=viewerTrigger;if(pinModeActive){setPinMode(false);void photoEditor?.cancel();}viewerEpoch++;viewerId=null;viewerTrigger=null;editorOpen=false;shell.dataset.pcViewer='closed';viewerImage.hidden=true;showPane(desktopBinding?'conversation':doc.body.dataset.studioScreen==='inpaint'?'canvas':'conversation',false);updateWorkspace(studio.getSummary());if(focus)(canRestoreFocus(trigger)?trigger:editor).focus();}
    function imageLoaded(){return workImage&&!workImage.hidden&&workImage.complete!==false&&workImage.naturalWidth>0&&workImage.naturalHeight>0&&!canvasLoadError;}
    function applyZoom(){
      const loaded=imageLoaded(),width=loaded?workImage.naturalWidth:0,height=loaded?workImage.naturalHeight:0;
      let padding={paddingLeft:'0',paddingRight:'0',paddingTop:'0',paddingBottom:'0'};if(root.getComputedStyle)padding=root.getComputedStyle(viewport);
      const availableWidth=viewport.clientWidth-(parseFloat(padding.paddingLeft)||0)-(parseFloat(padding.paddingRight)||0),availableHeight=viewport.clientHeight-(parseFloat(padding.paddingTop)||0)-(parseFloat(padding.paddingBottom)||0);
      fitScale=width&&height&&availableWidth>0&&availableHeight>0?Math.min(availableWidth/width,availableHeight/height):1;
      viewport.dataset.pcZoom=zoomMode;
      if(width&&height){viewport.style.setProperty('--pc-canvas-image-width',width*zoomPercent/100+'px');viewport.style.setProperty('--pc-canvas-image-height',height*zoomPercent/100+'px');}
      $('pcCanvasScale').textContent=width&&height?(zoomMode==='fit'?(desktopBinding?'':'맞춤 · ')+Math.round(fitScale*100)+'%':zoomPercent+'%'):'';
      $('pcCanvasFit').setAttribute('aria-pressed',String(zoomMode==='fit'));$('pcCanvasActual').setAttribute('aria-pressed',String(zoomMode==='pixels'&&zoomPercent===100));
      $('pcCanvasZoomOut').disabled=!loaded||(zoomMode==='fit'?fitScale*100:zoomPercent)<=25;
    }
    function setZoom(value){if(!imageLoaded())return;zoomMode=value==='fit'?'fit':'pixels';if(value!=='fit')zoomPercent=Math.min(400,Math.max(25,Number(value)));viewport.scrollTop=0;viewport.scrollLeft=0;applyZoom();}
    function coreResultEntry(summary){
      if(!desktopBinding||!editorOpen||viewerId||!['design','inpaint'].includes(doc.body.dataset.studioScreen)||!$('editor').hidden||!$('preview').hidden||$('result').hidden)return null;
      // Core showCandidate sets latestId and #result together; require the
      // displayed bytes to match that ID instead of inferring candidate order.
      const item=workspaceEntries.find(entry=>entry.id===summary.latestId);
      return item&&item.image===summary.imageUrl&&item.image===$('result').src?item:null;
    }
    function visibleEntry(summary=studio.getSummary()){
      if(!editorOpen||!['home','design','inpaint'].includes(doc.body.dataset.studioScreen))return null;
      if(viewerId)return workspaceEntries.find(entry=>entry.id===viewerId)||null;
      if(['home','inpaint'].includes(doc.body.dataset.studioScreen)&&studio.getSummary().mode==='inpaint'&&!$('editor').hidden)return workspaceEntries.find(entry=>entry.id===studio.desktopChat?.getState().sourceCandidateId)||null;
      return coreResultEntry(summary);
    }
    function updateWorkspace(summary){
      syncPresentation();
      const next=workspaceEntries.find(item=>item.id===viewerId)||null;
      if(viewerId&&!next){closeViewer();return;}
      doc.body.classList.toggle('pc-reading-image',!!viewerId&&['design','inpaint'].includes(doc.body.dataset.studioScreen));
      const coreResult=coreResultEntry(summary),rendered=next||coreResult;doc.body.classList.toggle('pc-native-result',!!coreResult);
      if((rendered?.id||'')!==workKey||(rendered?.image||'')!==workUrl){workKey=rendered?.id||'';workUrl=rendered?.image||'';zoomMode='fit';zoomPercent=100;canvasLoadError=false;viewport.scrollTop=0;viewport.scrollLeft=0;}
      workEntry=rendered;workImage=coreResult?$('result'):viewerImage;viewerImage.hidden=!next;if(next){if(viewerImage.src!==next.image)viewerImage.src=next.image;viewerImage.alt=next.label;}
      const paintEntry=desktopBinding&&editorOpen&&!viewerId&&doc.body.dataset.studioScreen==='inpaint'&&!$('editor').hidden?workspaceEntries.find(item=>item.id===studio.desktopChat.getState().sourceCandidateId):null;
      const displayEntry=workEntry||paintEntry,finalImage=!!displayEntry,ready=!!workEntry&&imageLoaded();
      workspace.dataset.candidateId=displayEntry?.id||'';
      $('pcShowCanvas').disabled=!finalImage&&doc.body.dataset.studioScreen!=='inpaint';
      $('pcCanvasTitle').textContent=desktopBinding?'이미지 편집':displayEntry?.label||'이미지 작업 캔버스';
      const model=({'sdxl-base':'SDXL Base','sd-turbo':'SD Turbo','sdxl-inpaint-v01':'SDXL Inpaint v0.1','animagine-xl-4.0-opt':'Animagine XL 4.0 Opt'})[displayEntry?.model]||displayEntry?.model||'';
      $('pcCanvasInfo').textContent=[desktopBinding?displayEntry?.label:null,paintEntry?'수정 마스크':displayEntry?.operationLabel||model,paintEntry?`${$('source').width} × ${$('source').height}`:ready?`${workImage.naturalWidth} × ${workImage.naturalHeight}`:''].filter(Boolean).join(' · ');$('pcCanvasInfo').title=$('pcCanvasInfo').textContent;
      const currentAI=desktopBinding&&aiState?.projectId===studio.desktopChat?.getState().projectId?aiState:null,active=!!currentAI?.activeRequestId||summary.busy;
      const imageForTurn=ready&&currentAI?.messages.some(message=>message.requestId===currentAI.activeRequestId&&message.candidateIds?.includes(workEntry.id));
      $('pcCanvasStatus').textContent=canvasLoadError?'이미지를 불러오지 못했어요. 다른 후보를 선택해주세요.':currentAI&&['error','limited'].includes(currentAI.phase)?currentAI.notice:imageForTurn?'이미지 준비 완료 · AI 답변 중':active?(currentAI?.notice||$('status').textContent):paintEntry?'수정 마스크를 칠할 수 있어요.':finalImage?(ready?'이미지 준비 완료':'이미지를 불러오고 있어요…'):'결과 이미지가 이곳에 표시됩니다.';
      workspace.setAttribute('aria-busy',String(active));
      for(const id of ['pcCanvasFit','pcCanvasActual','pcCanvasZoomOut','pcCanvasZoomIn'])$(id).disabled=!ready;
      const save=$('pcCanvasSave');save.setAttribute('aria-disabled',String(!finalImage||canvasLoadError));save.tabIndex=finalImage&&!canvasLoadError?0:-1;
      if(finalImage&&!canvasLoadError){save.href=displayEntry.image;save.download=imageFilename(displayEntry);}else{save.removeAttribute('href');save.removeAttribute('download');save.href='';save.download='';}
      for(const node of candidateStrip.querySelectorAll('button'))node.setAttribute('aria-pressed',String(node.dataset.pcCandidate===displayEntry?.id));
      syncComposerTarget();
      // Read the controller lock directly, including a pending cancel acknowledgement.
      syncEditLocks();root.queueMicrotask(syncEditLocks);
      syncCanvasTools();
      applyZoom();
      mountPhotoEditor();photoEditor?.render();
    }
    function syncComposerTarget(){
      const id=aiState?.activeRequestId?aiState.submittedTargetId:visibleEntry()?.id;
      const item=workspaceEntries.find(entry=>entry.id===id);composerTarget.hidden=!desktopBinding||!item;composerTarget.dataset.candidateId=item?.id||'';
      if(item){composerTarget.querySelector('img').src=item.image;const label=(aiState?.activeRequestId?'제출한 이미지 · ':'선택 이미지 · ')+item.label;composerTarget.querySelector('span').textContent=label;composerTarget.setAttribute('aria-label',label+' 보기');composerTarget.title=label+' 보기';}
    }
    function syncCanvasTools(){const screen=doc.body.dataset.studioScreen,legacyMask=!!desktopBinding&&editorOpen&&!viewerId&&screen==='inpaint'&&!$('editor').hidden;canvasOverlay.hidden=desktopBinding?!legacyMask:screen==='design'?!viewerId:screen==='inpaint'?!viewerId&&$('editor').hidden:true;doc.body.classList.toggle('pc-legacy-mask',legacyMask);photoControls.hidden=!desktopBinding||!editorOpen;if(desktopBinding){$('editorTools').hidden=!legacyMask;canvasActions.hidden=true;}}
    function photoBusy(){const core=studio.photoTools?.getState();return !!core?.active||!!photoState?.active||!!photoState?.starting||!!photoState?.applying||!!photoState?.cancelling;}
    function mountPhotoEditor(){
      if(photoEditor||photoMounting||!desktopBinding||!root.PankekiPhotoEditor||!studio.photoTools)return;
      const core=studio.photoTools,externalLocked=()=>desktopBinding?.isConversationLocked?.()===true;
      const photoCore={getState:()=>{const state=core.getState();return {...state,locked:state.locked===true||externalLocked()};},begin:(...args)=>{if(externalLocked())throw Error('진행 중인 요청을 마친 뒤 사진을 편집해주세요.');return core.begin(...args);},apply:(...args)=>{if(externalLocked())throw Error('진행 중인 요청을 마친 뒤 적용해주세요.');return core.apply(...args);},preparePinnedEdit:(...args)=>{if(externalLocked())throw Error('진행 중인 요청을 마친 뒤 핀을 준비해주세요.');return core.preparePinnedEdit(...args);},cancel:core.cancel.bind(core),listComments:core.listComments.bind(core),saveComment:core.saveComment.bind(core),deleteComment:core.deleteComment.bind(core)};
      photoMounting=true;try{photoEditor=root.PankekiPhotoEditor.mount({stage:viewport,image:viewerImage,controls:photoControls,core:photoCore,
        getCandidateId:()=>visibleEntry()?.id||null,getImage:()=>workImage,getSourceRevision:()=>studio.desktopChat.getState().sourceRevision,
        beforeOpen:(_tool,id)=>{if(visibleEntry()?.id!==id)throw Error('선택한 이미지를 다시 확인해주세요.');if(viewerId!==id)activateCandidate(id,doc.activeElement,false);photoOwner={projectId:studio.desktopChat.getState().projectId,candidateId:id,epoch:viewerEpoch};},
        onPinModeChange:setPinMode,
        beforePinnedEdit:selection=>{if(selection.text&&editor.value.length+selection.text.length+2>4000)throw Error('메모와 메시지를 합쳐 4000자 이내로 줄여주세요.');},
        onPinnedEdit:selection=>{
          if(visibleEntry()?.id!==selection.candidateId)return;
          const priorText=pinSelection&&editor.value===pinSelection.insertedText?pinSelection.priorText:editor.value,note=selection.text.trim(),insertedText=note?[priorText,note].filter(Boolean).join('\n\n'):priorText;
          pinSelection={...selection,projectId:studio.desktopChat.getState().projectId,priorText,insertedText};setPinMode(true);
          pinContextText.textContent=`핀 주변 범위 · 반경 ${Math.round(selection.radius*100)}%${note?' · 메모: '+note:''}`;pinContextText.title=pinContextText.textContent;
          editor.value=insertedText;editor.dispatchEvent(new root.Event('input',{bubbles:true}));editor.focus();fitPrompt();
        },
        onLockChange:(_locked,state)=>{const key=JSON.stringify(state);photoState=state;if(key!==photoStateKey){photoStateKey=key;desktopBinding?.refresh?.();}},
        onApplied:result=>{const owner=photoOwner;photoOwner=null;const summary=studio.getSummary();renderConversation(summary);if(owner&&editorOpen&&viewerEpoch===owner.epoch&&viewerId===owner.candidateId&&studio.desktopChat.getState().projectId===owner.projectId&&workspaceEntries.some(item=>item.id===result.candidateId&&item.image===result.image))activateCandidate(result.candidateId,viewerTrigger,false);},
        onError:message=>{$('pcCanvasStatus').textContent=message;}});}finally{photoMounting=false;}
    }
    function editLocked(){return studio.getSummary().busy||!!desktopBinding&&desktopBinding.isLocked?.()!==false;}
    function syncEditLocks(){const locked=editLocked();$('pcCanvasEdit').disabled=!workspace.dataset.candidateId||locked;if(desktopBinding)for(const id of ['sourceView','resultView'])$(id).disabled=locked;for(const node of history?.querySelectorAll('[data-pc-action="edit"]')||[])node.disabled=locked;for(const node of $('gallery').querySelectorAll('[data-action="edit"]'))node.disabled=locked;}
    function beginCandidateEdit(id){if(editLocked())return;homeConversationOnly=false;const sameSource=desktopBinding&&studio.desktopChat.getState().sourceCandidateId===id;if(viewerId)closeViewer();editorOpen=true;if(sameSource){$('sourceView').click();go('inpaint');}else candidateControl(id,'edit')?.click();updateWorkspace(studio.getSummary());}
    function revealCandidate(id){
      const thumb=Array.from(candidateStrip.querySelectorAll('button')).find(node=>node.dataset.pcCandidate===id);if(!thumb||!candidateStrip.clientWidth)return;
      const bounds=candidateStrip.getBoundingClientRect(),rect=thumb.getBoundingClientRect(),left=bounds.left+(candidateStrip.clientLeft||0),right=left+candidateStrip.clientWidth;
      const delta=rect.left<left?rect.left-left:rect.right>right?rect.right-right:0;
      if(delta)candidateStrip.scrollLeft=Math.max(0,Math.min(candidateStrip.scrollWidth-candidateStrip.clientWidth,(candidateStrip.scrollLeft||0)+delta));
    }
    function activateCandidate(id,trigger,focus=true){if(!workspaceEntries.some(item=>item.id===id))return;homeConversationOnly=false;if(pinModeActive&&viewerId!==id){setPinMode(false);void photoEditor?.cancel();}const screen=workflow.getScreen();if(screen!=='design'&&(!desktopBinding||screen!=='inpaint'))go(screen==='home'&&desktopBinding&&studio.getSummary().mode==='inpaint'?'inpaint':'design');viewerEpoch++;viewerId=id;viewerTrigger=trigger;editorOpen=true;shell.dataset.pcViewer='open';showPane('canvas',focus);updateWorkspace(studio.getSummary());revealCandidate(id);}
    $('pcShowConversation').addEventListener('click',()=>showPane('conversation'));$('pcShowCanvas').addEventListener('click',()=>{homeConversationOnly=false;editorOpen=true;updateWorkspace(studio.getSummary());showPane('canvas');});
    composerTarget.addEventListener('click',()=>activateCandidate(composerTarget.dataset.candidateId,composerTarget));
    candidateStrip.addEventListener('click',event=>{const control=event.target.closest('[data-pc-candidate]');if(control)activateCandidate(control.dataset.pcCandidate,control);});
    $('pcCanvasFit').addEventListener('click',()=>setZoom('fit'));$('pcCanvasActual').addEventListener('click',()=>setZoom(100));
    $('pcCanvasZoomIn').addEventListener('click',()=>setZoom((zoomMode==='fit'?Math.round(fitScale*100):zoomPercent)+25));$('pcCanvasZoomOut').addEventListener('click',()=>{const current=zoomMode==='fit'?fitScale*100:zoomPercent;if(current>25)setZoom(Math.max(25,current-25));});
    $('pcCanvasSave').addEventListener('click',event=>{if(event.currentTarget.getAttribute('aria-disabled')==='true'){event.preventDefault();return;}studio.downloadImage(event);});
    $('pcCanvasEdit').addEventListener('click',()=>{if(workEntry)beginCandidateEdit(workEntry.id);});
    $('pcCanvasClose').addEventListener('click',()=>closeViewer(true));
    shell.addEventListener('keydown',event=>{if(event.isComposing||event.keyCode===229)return;if(event.key==='Escape'&&(viewerId||desktopBinding&&editorOpen)&&['design','inpaint'].includes(doc.body.dataset.studioScreen)){event.preventDefault();closeViewer(true);}});
    for(const image of [viewerImage,$('result')]){image.addEventListener('load',()=>{if(image===workImage){canvasLoadError=false;updateWorkspace(studio.getSummary());}});image.addEventListener('error',()=>{if(image===workImage){canvasLoadError=true;updateWorkspace(studio.getSummary());}});}
    new root.ResizeObserver(()=>{if(workImage)applyZoom();}).observe(viewport);
    const history=thread.querySelector('.pc-history');let historyCount=-1,historyIds=[],followLatest=true,threadVisible=false,wasBusy=false;
    function revealLatest(){root.requestAnimationFrame(()=>{thread.scrollTop=thread.scrollHeight;});}
    thread.addEventListener('scroll',()=>{followLatest=thread.scrollHeight-thread.scrollTop-thread.clientHeight<96;},{passive:true});
    new root.ResizeObserver(entries=>{const height=entries[0].contentRect.height;if(height>0){thread.style.setProperty('--pc-thread-height',Math.round(height)+'px');if(followLatest)revealLatest();}}).observe(thread);
    function fitPrompt(restored=false){editor.style.height='auto';editor.style.height=Math.min(desktopBinding?96:88,Math.max(desktopBinding?32:38,editor.scrollHeight))+'px';if(restored){editor.setSelectionRange(0,0);editor.scrollTop=0;}}
    function messageFeedback(turn,text,error=false){const node=turn.querySelector('[data-pc-message-feedback]');if(!node)return;node.textContent=text;node.classList.toggle('error',error);node.setAttribute('role',error?'alert':'status');}
    const contextMarkers=new Map();
    function renderContextBoundaries(state){
      const targets=new Map();let previous=0;
      for(const message of state.messages){if(message.role!=='user')continue;const epoch=Number.isSafeInteger(message.contextEpoch)?message.contextEpoch:0;if(epoch>previous)targets.set(epoch,aiTurns.get(message.requestId));previous=epoch;}
      if(state.contextEpoch>previous)targets.set(state.contextEpoch,null);
      for(const [epoch,node]of contextMarkers)if(!targets.has(epoch)){node.remove();contextMarkers.delete(epoch);}
      for(const [epoch,turn]of targets){let node=contextMarkers.get(epoch);if(!node){node=doc.createElement('p');node.className='pc-context-boundary';node.dataset.pcContextBoundary='';node.dataset.pcContextEpoch=String(epoch);node.textContent='새 AI 문맥 시작';contextMarkers.set(epoch,node);}if(turn){if(node.nextSibling!==turn)history.insertBefore(node,turn);}else if(node!==history.lastChild)history.append(node);}
    }
    history.addEventListener('click',async event=>{
      const button=event.target.closest('[data-pc-copy-reply],[data-pc-reinput]');if(!button)return;event.preventDefault();event.stopPropagation();
      const turn=button.closest('.pc-ai-turn'),requestId=turn?.dataset.requestId,state=aiState;
      if(!desktopBinding||!turn||!state||aiTurns.get(requestId)!==turn||turn.dataset.projectId!==state.projectId)return;
      if(button.hasAttribute('data-pc-copy-reply')){
        const reply=state.messages.find(message=>message.requestId===requestId&&message.role==='assistant');if(!reply?.text||button.disabled)return;
        const owner=state.projectId;button.disabled=true;button.dataset.copying='true';messageFeedback(turn,'답변을 복사하고 있어요…');
        try{if(typeof root.navigator?.clipboard?.writeText!=='function')throw Error('clipboard-unavailable');await root.navigator.clipboard.writeText(reply.text);if(aiState?.projectId===owner&&aiTurns.get(requestId)===turn)messageFeedback(turn,'답변을 복사했어요.');}
        catch{if(aiState?.projectId===owner&&aiTurns.get(requestId)===turn)messageFeedback(turn,'답변을 복사하지 못했어요. 다시 시도해주세요.',true);}
        finally{delete button.dataset.copying;button.disabled=false;}
        return;
      }
      const failure=state.lastFailure,user=state.messages.find(message=>message.requestId===requestId&&message.role==='user');
      if(!failure||failure.requestId!==requestId||!user||!['error','limited'].includes(state.phase)||(user.contextEpoch||0)!==(state.contextEpoch||0)){messageFeedback(turn,'이전 요청이에요. 현재 입력은 유지했어요.',true);return;}
      if(composerComposing||desktopBinding.isLocked?.()||state.activeRequestId||state.canceling){messageFeedback(turn,'진행 중인 작업이나 한글 입력을 마친 뒤 다시 입력해주세요.',true);return;}
      const text=failure.text;
      if(typeof text!=='string'||!text)return;
      if(editor.value!==''&&editor.value!==text){messageFeedback(turn,'작성 중인 입력을 먼저 확인해주세요. 현재 입력은 유지했어요.',true);return;}
      if(editor.value!==text){editor.value=text;editor.setSelectionRange(text.length,text.length);editor.dispatchEvent(new root.Event('input',{bubbles:true}));}
      fitPrompt();editor.focus();messageFeedback(turn,'요청을 입력창에 다시 넣었어요. 확인한 뒤 보내주세요.');
    });
    function candidateControl(id,action){return Array.from($('gallery').querySelectorAll('[data-candidate-id]')).find(node=>node.dataset.candidateId===id)?.querySelector(`[data-action="${action}"]`);}
    function imageFilename(item){const type=item.image.startsWith('data:image/jpeg')?'jpg':item.image.startsWith('data:image/webp')?'webp':'png';return `pankeki-${item.id}.${type}`;}
    function renderConversation(summary,force=false){
      if(!force&&historyCount===summary.candidateCount)return;
      const entries=conversationEntries(JSON.parse(studio.exportProject()));workspaceEntries=entries;
      const atEnd=historyCount<0||thread.scrollHeight-thread.scrollTop-thread.clientHeight<96;
      const appendOnly=!force&&historyIds.every((id,index)=>entries[index]?.id===id);
      if(!appendOnly){history.replaceChildren();candidateStrip.replaceChildren();historyIds=[];aiTurns.clear();}
      for(const item of entries.slice(historyIds.length)){
        const thumb=doc.createElement('button');thumb.type='button';thumb.dataset.pcCandidate=item.id;thumb.setAttribute('aria-label',item.label+' 보기');thumb.setAttribute('aria-pressed','false');const thumbnail=doc.createElement('img');thumbnail.src=item.image;thumbnail.alt='';thumbnail.loading='lazy';const caption=doc.createElement('span');caption.textContent=item.label;thumb.append(thumbnail,caption);candidateStrip.append(thumb);
        const turn=doc.createElement('article');turn.className='pc-turn';turn.dataset.candidateId=item.id;
        if(item.prompt){const request=doc.createElement('div');request.className='pc-request';const name=doc.createElement('span');name.textContent='나';const text=doc.createElement('p');text.textContent=item.prompt;request.append(name,text);turn.append(request);}
        const response=doc.createElement('div');response.className='pc-response'+(item.kind==='upload'?' pc-reference':'');
        response.innerHTML=`<div class="pc-message-author"><img src="${originalLogo.src}" alt=""><strong>${item.kind==='upload'?'참고 이미지':'Pankeki'}</strong><span>${item.kind==='upload'?'불러온 원본':item.operation==='recolor'?esc(item.skipped?'색상 변경 · 변경 없음':`색상 변경 · ${item.targetColor}`):esc([item.operationLabel||({'sdxl-base':'SDXL Base','animagine-xl-4.0-opt':'Animagine XL 4.0 Opt'})[item.model]||item.model,item.width&&item.height?`${item.width} × ${item.height}`:''].filter(Boolean).join(' · '))}</span></div>`;
        const figure=doc.createElement('figure');figure.className='pc-image-frame';
        const open=doc.createElement('button');open.type='button';open.className='pc-image-open';open.dataset.pcCandidate=item.id;open.dataset.pcAction='view';open.setAttribute('aria-label',`후보 ${item.ordinal} · ${item.label} 크게 보기`);
        const picture=doc.createElement('img');picture.src=item.image;picture.alt=item.kind==='upload'?'불러온 참고 이미지':item.label+' · 생성 이미지';picture.decoding='async';picture.loading='lazy';
        const metadata=response.querySelector('.pc-message-author>span')||response.querySelector('.pc-message-author span');
        const modelLabel=item.operationLabel||({'sdxl-base':'SDXL Base','sd-turbo':'SD Turbo','sdxl-inpaint-v01':'SDXL Inpaint v0.1','animagine-xl-4.0-opt':'Animagine XL 4.0 Opt'})[item.model]||item.model;
        function imageMetadata(){const width=picture.naturalWidth,height=picture.naturalHeight;const size=width>0&&height>0?`${width} × ${height}`:'';metadata.textContent=[item.kind==='upload'?'불러온 원본':item.operation==='recolor'?item.skipped?'색상 변경 · 변경 없음':`색상 변경 · ${item.targetColor}`:modelLabel,size].filter(Boolean).join(' · ');}
        imageMetadata();picture.addEventListener('load',()=>{imageMetadata();if(followLatest)revealLatest();});open.append(picture);figure.append(open);
        const actions=doc.createElement('div');actions.className='pc-image-actions pc-image-overlay';actions.setAttribute('role','group');actions.setAttribute('aria-label','이미지 조작');
        actions.innerHTML=`<button type="button" data-pc-action="edit" data-pc-candidate="${esc(item.id)}" aria-label="이미지 편집" title="이미지 편집">${icon('pencil')}편집</button>`;
        const save=doc.createElement('a');save.href=item.image;save.download=imageFilename(item);save.innerHTML=icon('download');save.setAttribute('aria-label','이미지 저장');save.title='이미지 저장';save.addEventListener('click',event=>{event.stopPropagation();return studio.downloadImage(event);});actions.append(save);
        figure.append(actions);response.append(figure);turn.append(response);history.append(turn);
      }
      historyIds=entries.map(item=>item.id);historyCount=entries.length;
      thread.querySelector('.pc-welcome').hidden=entries.length>0;
      if(desktopBinding&&aiState&&aiState.projectId===studio.desktopChat.getState().projectId)renderAI(aiState);
      if(atEnd){followLatest=true;revealLatest();}
    }
    function renderAI(state){
      if(aiState?.activeRequestId&&!state.activeRequestId&&['done','error','limited','canceled','needs-input'].includes(state.phase))recordNotification('ai:'+aiState.activeRequestId,state.phase==='done'?'AI 요청 완료':state.phase==='canceled'?'AI 요청 취소':'AI 요청 확인',state.notice,['error','limited','needs-input'].includes(state.phase));
      if(generationDraftOverlay?.identity===state.projectId){
        if(generationDraftOverlay.pending&&state.activeRequestId){generationDraftOverlay.requestId=state.activeRequestId;generationDraftOverlay.pending=false;}
        if(generationDraftOverlay.requestId===state.lastFailure?.requestId||!state.activeRequestId&&['error','limited','canceled','needs-input'].includes(state.phase))generationDraftOverlay=null;
      }
      aiState=state;
      syncComposerFeedback(doc.body.dataset.studioScreen==='home');
      if(headerPopup?.kind==='notifications')renderConnection();
      const currentRequests=new Set(state.messages.map(message=>message.requestId));
      for(const [id,turn] of aiTurns)if(!currentRequests.has(id)){
        // Candidates belong to the image project, so keep current-project cards
        // when clearing an ephemeral conversation.
        for(const card of turn.querySelectorAll('.pc-turn'))if(historyIds.includes(card.dataset.candidateId)){const request=card.querySelector('.pc-request');if(request)request.hidden=false;history.append(card);}
        turn.remove();aiTurns.delete(id);
      }
      const atEnd=thread.scrollHeight-thread.scrollTop-thread.clientHeight<96;
      for(const message of state.messages){
        let turn=aiTurns.get(message.requestId);
        if(!turn){turn=doc.createElement('article');turn.className='pc-ai-turn';turn.dataset.requestId=message.requestId;
          turn.innerHTML='<div class="pc-request"><span>나</span><p></p></div><div class="pc-response"><div class="pc-message-author"><strong></strong></div><div class="desktop-chat-reply"></div><div class="pc-message-actions"><button type="button" data-pc-copy-reply hidden>답변 복사</button><button type="button" data-pc-reinput hidden>다시 입력</button><span data-pc-message-feedback role="status" aria-live="polite"></span></div><div class="pc-ai-results"></div></div>';
          history.append(turn);aiTurns.set(message.requestId,turn);}
        turn.dataset.projectId=state.projectId;
        if(message.role==='user')turn.querySelector('.pc-request p').textContent=message.text;
        else {
          turn.querySelector('.pc-message-author strong').textContent=[message.provider||'AI',message.modelLabel].filter(Boolean).join(' · ');
          const reply=turn.querySelector('.desktop-chat-reply');if(reply.dataset.rendered!==message.text){reply.dataset.rendered=message.text;desktopBinding.renderMarkdown(doc,reply,message.text);}
          for(const id of message.candidateIds||[]){const card=Array.from(history.querySelectorAll('.pc-turn')).find(node=>node.dataset.candidateId===id);if(card){const request=card.querySelector('.pc-request');if(request)request.hidden=true;const results=turn.querySelector('.pc-ai-results');if(card.parentNode!==results)results.append(card);}}
        }
      }
      for(const [requestId,turn]of aiTurns){const reply=state.messages.find(message=>message.requestId===requestId&&message.role==='assistant'),user=state.messages.find(message=>message.requestId===requestId&&message.role==='user'),copy=turn.querySelector('[data-pc-copy-reply]'),reinput=turn.querySelector('[data-pc-reinput]');copy.hidden=!reply?.text;copy.disabled=copy.dataset.copying==='true';reinput.hidden=state.lastFailure?.requestId!==requestId||!['error','limited'].includes(state.phase)||(user?.contextEpoch||0)!==(state.contextEpoch||0);}
      renderContextBoundaries(state);fitPrompt();
      thread.dataset.hasChat=String(state.messages.length>0);thread.setAttribute('aria-busy',String(!!state.activeRequestId||state.canceling===true));
      thread.querySelector('.pc-welcome').hidden=historyIds.length>0||state.messages.length>0;
      const pending=thread.querySelector('.pc-pending');pending.hidden=!state.activeRequestId&&!state.canceling;pending.querySelector('p').textContent=state.canceling?'요청 취소를 확인하고 있어요…':state.notice;
      if(atEnd&&followLatest)revealLatest();
      updateWorkspace(studio.getSummary());
    }
    function syncComposerFeedback(home){
      const state=aiState,summary=studio.getSummary();
      const modelControls=$('desktopChatControls');if(modelControls)modelControls.hidden=home;
      const attention=state?state.codex.state!=='ready'||state.codex.toolsReady===false||!!state.activeRequestId||state.canceling||state.modelSaving||['error','limited','needs-input','canceled'].includes(state.phase):summary.busy||$('status').classList.contains('error');
      const show=!!(attention||photoBusy()||projectState?.error||projectState?.recovery||projectTransition());
      $('pkComposerStatus').hidden=home&&!show;composer.classList.toggle('pc-composer-feedback',show);
    }
    const composerView=Object.freeze({
      bind(binding){desktopBinding=binding;editorOpen=false;editor.value='';fitPrompt();doc.body.classList.add('pc-central-chat','pankeki-reference','pankeki-photo-tools');
        const tools=composer.querySelector('.pc-composer-tools');tools.prepend($('desktopChatControls'));tools.setAttribute('role','group');tools.setAttribute('aria-label','메시지 도구');
        negativeLabel.textContent='제외 프롬프트 · 이미지 생성 전용';negativeHint.textContent='현재 AI 부분 수정에는 적용되지 않습니다. CFG 1에서는 이미지 생성에도 적용되지 않습니다.';
        canvasHeader.append(canvasOverlay.querySelector('.pc-canvas-controls'),canvasPrimary);canvasOverlay.classList.add('pc-editor-rail');candidateStrip.hidden=false;
        for(const [id,label] of [['brushTool','수정 마스크 브러시'],['eraserTool','마스크 지우개']]){$(id).setAttribute('aria-label',label);$(id).title=label;}
        for(const [id,label] of [['brushTool','브러시'],['eraserTool','마스크 지우개']]){const caption=doc.createElement('span');caption.className='pc-tool-caption';caption.textContent=label;$(id).append(caption);}
        $('clearMask').innerHTML=icon('rotate-ccw')+'<span>초기화</span>';$('clearMask').setAttribute('aria-label','수정 마스크 전체 지우기');$('clearMask').title='수정 마스크 전체 지우기 · 원본 이미지 유지';
        const maskPicker=$('editorTools').querySelector('label[for="maskUpload"]');maskPicker.innerHTML=icon('upload')+'<span>불러오기</span>';maskPicker.setAttribute('aria-label','수정 마스크 불러오기');maskPicker.title='수정 마스크 불러오기';
        $('pcCanvasFit').textContent='맞춤';$('pcCanvasZoomOut').textContent='−';$('pcCanvasZoomIn').textContent='+';
        $('pkGenerate').innerHTML=icon('send-horizontal')+'<span>보내기</span>';syncPresentation();
        $('desktopModelSettings').querySelector('fieldset').append($('desktopChatConnect'));
        // Keep existing optional generation styles in the existing settings drawer.
        sourceViews.dataset.pkSettingsSection='edit';modelPanel.append(categoryRow,editContext,sourceViews);sourceViews.classList.add('pc-source-views');categoryRow.hidden=false;settingsPanel(drawer.dataset.panel);
        const legacy=chatPanel.querySelector('.chat-composer-area');if(legacy){legacy.hidden=true;legacy.inert=true;}
        const none=doc.createElement('button');none.type='button';none.id='pcNoAIStyle';none.className='pk-category selected';none.textContent='선택 안 함';none.setAttribute('aria-pressed','true');
        none.addEventListener('click',()=>{aiCategory=null;for(const button of categoryRow.querySelectorAll('button')){const selected=button===none;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));}});categoryRow.insertBefore?categoryRow.insertBefore(none,categoryRow.children[1]):categoryRow.prepend(none);
        for(const node of categoryRow.querySelectorAll('[data-pk-category]')){node.classList.remove('selected');node.setAttribute('aria-pressed','false');}
        composer.classList.remove('pc-recolor');const label=composer.querySelector('label[for=pcPrompt]');label.textContent='메시지';editor.setAttribute('aria-label','메시지');editor.placeholder='메시지를 입력하세요.';
        composer.querySelector('.pc-key-hint').innerHTML='<kbd>Enter</kbd> 보내기 · <kbd>Shift Enter</kbd> 줄바꿈';
      },
      getAutomaticContext(){
        const visibleCandidateId=visibleEntry()?.id||null;
        const style=categories.find(item=>item.id===aiCategory);
        return {visibleCandidateId:visibleCandidateId||null,referenceCandidateId:visibleCandidateId||workspaceEntries.at(-1)?.id||null,selectionEpoch:viewerEpoch,generationStyle:style?{id:style.id,prompt:style.style}:null};
      },
      prepareText(text,intent){return intent==='generate'&&aiCategory?preparePrompt(text,aiCategory,'txt2img'):text;},
      render:renderAI,
      isPhotoBusy:photoBusy,
      getPhotoState:()=>photoState,
      cancelPhoto:()=>photoEditor?.cancel(),
      isProjectBusy:()=>projectTransition(),
      getProjectState:()=>projectState,
      subscribeProjectState(listener){projectListeners.add(listener);listener(projectState);return()=>projectListeners.delete(listener);},
      registerSettings(node){for(const [index,fieldset] of Array.from(node.querySelectorAll('fieldset')).entries())fieldset.dataset.pkSettingsSection=['chat','model','edit'][index];settingsPanel(drawer.dataset.panel);},
      enterConversation(){go(studio.getSummary().mode==='inpaint'?'inpaint':'design');showHomeConversation();},
      settings,
      unbind(){setPinMode(false);if(viewerId&&doc.body.dataset.studioScreen==='inpaint')closeViewer();desktopBinding=null;photoEditor?.destroy();photoEditor=null;photoState=null;photoOwner=null;photoControls.hidden=true;aiState=null;aiTurns.clear();for(const node of contextMarkers.values())node.remove();contextMarkers.clear();doc.body.classList.remove('pc-central-chat','pankeki-reference','pc-reference-open','pc-native-result','pankeki-photo-tools','pc-legacy-mask');negativeLabel.textContent=negativePresentation.label;negativeHint.textContent=negativePresentation.hint;for(const {node,html,label,title} of nativeToolPresentation){node.innerHTML=html;for(const [key,value] of [['aria-label',label],['title',title]])if(value===null)node.removeAttribute(key);else node.setAttribute(key,value);}sourceViewsHome.prepend(sourceViews);sourceViews.classList.remove('pc-source-views');sourceViews.hidden=false;editContext.hidden=false;categoryRow.hidden=false;for(const id of ['sourceView','resultView'])$(id).disabled=false;canvasOverlay.prepend(canvasHeader.querySelector('.pc-canvas-controls'));canvasOverlay.classList.remove('pc-editor-rail');candidateStrip.hidden=true;composerTarget.hidden=true;$('pkGenerate').innerHTML=icon('send-horizontal');$('pcNoAIStyle')?.remove();composer.prepend(editContext);shell.append(categoryRow,composer);const legacy=chatPanel.querySelector('.chat-composer-area');if(legacy){legacy.hidden=false;legacy.inert=false;}refresh(studio.getSummary(),'restore');}
    });
    $('pkPromptForm').pankekiComposer=composerView;
    thread.addEventListener('click',event=>{
      const control=event.target.closest('[data-pc-action]');if(!control)return;
      const id=control.dataset.pcCandidate;
      if(control.dataset.pcAction==='edit'){event.stopPropagation();beginCandidateEdit(id);}else activateCandidate(id,control);
    });
    const activities=modelPanel.querySelector('.image-activity');
    if(activities){activities.classList.add('pk-live-activity');workspace.append(activities);}
    // Header panels contain local presentation state, never project/account data.
    const bell=layout.querySelector('[data-pk-action="notifications"]'),avatar=layout.querySelector('.pk-avatar');
    const notificationBadge=doc.createElement('span');notificationBadge.className='pc-notification-badge';notificationBadge.hidden=true;notificationBadge.setAttribute('aria-hidden','true');bell.append(notificationBadge);
    const notificationAnnounce=doc.createElement('span');notificationAnnounce.className='sr-only';notificationAnnounce.setAttribute('role','status');notificationAnnounce.setAttribute('aria-live','polite');
    const notifications=doc.createElement('section');notifications.id='pcNotifications';notifications.className='pc-header-popover pc-notifications';notifications.hidden=true;notifications.setAttribute('role','dialog');notifications.setAttribute('aria-labelledby','pcNotificationsTitle');
    notifications.innerHTML=`<div class="pc-popover-heading"><h2 id="pcNotificationsTitle" tabindex="-1">작업 알림</h2>${button('알림 닫기','x','data-pc-popup-close')}</div><div class="pc-notification-connection"><span>현재 연결</span><p></p></div><div class="pc-notification-actions"><span>이번 실행의 작업 기록</span><button type="button" data-pc-notice-action="read-all">모두 읽음</button><button type="button" data-pc-notice-action="clear">비우기</button></div><div class="pc-notification-list"></div>`;
    const profilePopover=doc.createElement('section');profilePopover.id='pcProfilePopover';profilePopover.className='pc-header-popover pc-profile-popover';profilePopover.hidden=true;profilePopover.setAttribute('role','dialog');profilePopover.setAttribute('aria-labelledby','pcProfileTitle');
    profilePopover.innerHTML=`<div class="pc-popover-heading"><h2 id="pcProfileTitle">로컬 프로필</h2>${button('프로필 닫기','x','data-pc-popup-close')}</div><div class="pc-local-identity"><span class="pc-profile-initial" aria-hidden="true"></span><strong></strong></div><form><label for="pcLocalProfileName">표시 이름</label><input id="pcLocalProfileName" type="text" maxlength="40" autocomplete="off" aria-describedby="pcLocalProfileHelp"><p id="pcLocalProfileHelp">이 기기에만 저장돼요.</p><button type="submit">이름 저장</button><p id="pcLocalProfileStatus" role="status"></p></form>`;
    doc.body.append(notifications,profilePopover,notificationAnnounce);
    let headerPopup=null,noticeSequence=0,notices=[],profileName='로컬 사용자',profileComposing=false,settingsReturnFocus=null;
    try{profileName=root.localStorage.getItem('pankeki-local-profile-name')?.trim().slice(0,40)||profileName;}catch{}
    function renderProfile(){const initial=Array.from(profileName)[0]||'로';$('pcProfileInitial').textContent=initial;profilePopover.querySelector('.pc-profile-initial').textContent=initial;profilePopover.querySelector('.pc-local-identity strong').textContent=profileName;$('pcLocalProfileName').value=profileName;}
    renderProfile();
    function renderConnection(){
      const codex=aiState?.codex,aiConnection=codex?`${codex.provider==='claude'?'Claude':'Codex'} ${{ready:'연결됨','signed-out':'로그인 필요',missing:'설치 필요'}[codex.state]||'연결 확인 필요'}`:'';
      notifications.querySelector('.pc-notification-connection p').textContent=[$('healthText').textContent,aiConnection].filter(Boolean).join(' · ');
      if(headerPopup?.kind==='notifications')positionHeaderPopup();
    }
    function renderNotifications(){
      const focusedNotice=notifications.contains(doc.activeElement)?doc.activeElement?.closest('[data-pc-notice-id]')?.dataset.pcNoticeId:null;
      const unread=notices.filter(item=>!item.read).length;bell.setAttribute('data-unread-count',String(unread));bell.setAttribute('aria-label',unread?`작업 알림 · 미확인 ${unread}개`:'작업 알림');notificationBadge.textContent=String(unread);notificationBadge.hidden=!unread;renderConnection();
      notifications.querySelector('[data-pc-notice-action="read-all"]').disabled=!unread;notifications.querySelector('[data-pc-notice-action="clear"]').disabled=!notices.length;
      notifications.querySelector('.pc-notification-list').innerHTML=notices.length?notices.map(item=>`<button type="button" class="pc-notification-item${item.read?'':' pc-unread'}${item.error?' pc-notification-error':''}" data-pc-notice-id="${item.id}" aria-describedby="pcNoticeBody${item.id}" aria-label="${esc(item.title+(item.read?' · 읽음':' · 미확인'))}"><span class="pc-notice-title">${esc(item.title)}</span><time datetime="${new Date(item.at).toISOString()}">${esc(new Date(item.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}))}</time><p id="pcNoticeBody${item.id}">${esc(item.text)}</p><small>${item.read?'읽음':'미확인 · 눌러서 읽음 표시'}</small></button>`).join(''):'<p class="pc-notification-empty" tabindex="-1">새 알림이 없어요.</p>';
      if(focusedNotice)notifications.querySelector(`[data-pc-notice-id="${focusedNotice}"]`)?.focus({preventScroll:true});
      if(headerPopup?.kind==='notifications')positionHeaderPopup();
    }
    function recordNotification(key,title,text,error=false){
      text=String(text||'').trim();if(!text||notices.some(item=>item.key===key))return;
      notices.unshift({id:String(++noticeSequence),key,title,text:text.slice(0,1000),error,at:Date.now(),read:false});notices=notices.slice(0,50);renderNotifications();notificationAnnounce.textContent=`새 작업 알림: ${title}`;
    }
    function positionHeaderPopup(){
      if(!headerPopup)return;const {node,anchor}=headerPopup,box=anchor.getBoundingClientRect(),popup=node.getBoundingClientRect();
      const width=root.innerWidth||doc.documentElement.clientWidth||1360,height=root.innerHeight||doc.documentElement.clientHeight||920;
      const left=Math.max(8,Math.min(width-popup.width-8,box.right-popup.width)),top=box.bottom+8+popup.height<=height-8?box.bottom+8:Math.max(8,box.top-popup.height-8);
      node.style.left=left+'px';node.style.top=Math.min(Math.max(8,height-popup.height-8),top)+'px';
    }
    function closeHeaderPopup(restoreFocus=true){if(!headerPopup)return;const {node,anchor}=headerPopup;node.hidden=true;if(node===profilePopover)profileComposing=false;anchor.setAttribute('aria-expanded','false');headerPopup=null;if(restoreFocus&&doc.body.contains(anchor))anchor.focus();}
    function openHeaderPopup(kind){
      if(headerPopup?.kind===kind)return closeHeaderPopup();closeHeaderPopup(false);if(drawer.open)drawer.close();if(dialog.open)dialog.close();if(galleryDialog.open)galleryDialog.close();
      const node=kind==='notifications'?notifications:profilePopover,anchor=kind==='notifications'?bell:avatar;headerPopup={kind,node,anchor};
      if(kind==='notifications')renderNotifications();else{renderProfile();$('pcLocalProfileStatus').textContent='';}node.hidden=false;anchor.setAttribute('aria-expanded','true');positionHeaderPopup();(kind==='notifications'?$('pcNotificationsTitle'):$('pcLocalProfileName')).focus();
    }
    for(const popup of [notifications,profilePopover])popup.querySelector('[data-pc-popup-close]').addEventListener('click',()=>closeHeaderPopup());
    notifications.addEventListener('click',event=>{
      const item=event.target.closest('[data-pc-notice-id]'),action=event.target.closest('[data-pc-notice-action]');
      if(item){const notice=notices.find(value=>value.id===item.dataset.pcNoticeId);if(notice)notice.read=true;renderNotifications();notifications.querySelector(`[data-pc-notice-id="${item.dataset.pcNoticeId}"]`)?.focus();}
      else if(action){if(action.dataset.pcNoticeAction==='clear')notices=[];else for(const notice of notices)notice.read=true;renderNotifications();if(!notices.length)notifications.querySelector('.pc-notification-empty').focus();}
    });
    profilePopover.querySelector('form').addEventListener('submit',event=>{
      event.preventDefault();if(profileComposing||event.isComposing)return;const next=$('pcLocalProfileName').value.trim().slice(0,40)||'로컬 사용자';
      try{root.localStorage.setItem('pankeki-local-profile-name',next);profileName=next;renderProfile();$('pcLocalProfileStatus').textContent='이 기기에 저장했어요.';}
      catch{$('pcLocalProfileStatus').textContent='이름을 저장하지 못했어요. 다시 시도해주세요.';}
    });
    $('pcLocalProfileName').addEventListener('compositionstart',()=>profileComposing=true);$('pcLocalProfileName').addEventListener('compositionend',()=>profileComposing=false);
    doc.addEventListener('click',event=>{if(headerPopup&&!headerPopup.node.contains(event.target)&&!headerPopup.anchor.contains(event.target))closeHeaderPopup(false);},true);
    doc.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.isComposing&&event.keyCode!==229&&headerPopup){event.preventDefault();closeHeaderPopup();}});
    root.addEventListener?.('resize',positionHeaderPopup);
    new root.MutationObserver(renderConnection).observe($('healthText'),{childList:true,characterData:true,subtree:true});
    let observedProjectStatus=$('projectStatus').textContent,observedProjectError=$('projectStatus').classList.contains('error');
    new root.MutationObserver(()=>{
      const text=$('projectStatus').textContent,error=$('projectStatus').classList.contains('error');if(text===observedProjectStatus&&error===observedProjectError)return;observedProjectStatus=text;observedProjectError=error;
      // The legacy status also contains initialization hints and in-progress
      // copy. Only explicit completed file actions or failures are events.
      if(error)recordNotification('project-error:'+text,'프로젝트 작업 오류',text,true);
      else if(!/^이 브라우저에 자동 저장했어요\./.test(text)&&/(?:내보냈어요|저장했어요|불러왔어요|복원했어요|열었어요|중단했어요|확인했어요)\./.test(text))recordNotification('project:'+ ++noticeSequence,'프로젝트 작업',text);
    }).observe($('projectStatus'),{attributes:true,attributeFilter:['class'],childList:true,characterData:true,subtree:true});
    // Dialogs use ordinary controls so the same actions remain keyboard accessible.
    const dialog=doc.createElement('dialog');dialog.id='pkLibrary';dialog.className='pk-library';doc.body.append(dialog);
    const galleryDialog=doc.createElement('dialog');galleryDialog.className='pk-gallery-dialog';
    galleryDialog.setAttribute('aria-label','이미지 갤러리');
    galleryDialog.innerHTML=`<div class="pk-dialog-heading"><h2>이미지 갤러리</h2>${button('갤러리 닫기','x','data-pk-close')}</div>`;
    galleryDialog.append(workspace.querySelector('.candidates-section'));doc.body.append(galleryDialog);
    galleryDialog.querySelector('[data-pk-close]').addEventListener('click',()=>galleryDialog.close());
    galleryDialog.addEventListener('click',event=>{
      if(event.target.closest('button[data-action="edit"]')){if(editLocked()){event.preventDefault();event.stopImmediatePropagation();return;}if(viewerId)closeViewer();editorOpen=true;syncPresentation();}
      const control=event.target.closest('button[data-action="view"]');if(!control)return;
      event.preventDefault();event.stopImmediatePropagation();galleryDialog.close();activateCandidate(control.closest('[data-candidate-id]')?.dataset.candidateId,control);
    },true);
    galleryDialog.addEventListener('click',event=>{
      const control=event.target.closest('button');
      if(control?.dataset.action==='edit'){
        if(!editLocked())galleryDialog.close();
      }else if(control?.id==='compareSelected'&&!control.disabled){
        galleryDialog.close();
        if(workflow.getScreen()!=='compare')go('compare');
      }
    });
    workspace.querySelector('.candidate-jump')?.addEventListener('click',event=>{event.preventDefault();galleryDialog.showModal();});
    let category='character',lastSummary=null,heroTemplate=templates[0],lastRecentKey='',lastRoute=null;
    let projectLibrary=null,projectState=null,projectPage=0,projectListKey='',projectSaveTimer=null,projectInputLocked=false,foreignProjectLoading=false,lastProjectActive=null;
    let projectCatalogPage=0,projectCatalogKey='',projectSearchScope='home',generationOpening=false,homeSubmitPending=false,editorDraftEpoch=0,applyingHomeDraft=false,generationDraftOverlay=null;
    const projectSearchQueries={home:$('pkSearch').value,projects:''};
    const projectListeners=new Set(),projectReadOnly=new Map(),projectInert=new Map();
    function projectTransition(){return foreignProjectLoading||!!projectLibrary&&(!projectState?.initialized||projectState.transitioning);}
    function projectBusy(){const summary=studio.getSummary(),photo=studio.photoTools?.getState();return !!(summary.busy||summary.importing||summary.maskLoading||summary.drawing||photo?.active||aiState?.activeRequestId||aiState?.modelSaving||aiState?.canceling||studio.getImageModelSettings?.().busy||composerComposing||pinSelection||foreignProjectLoading);}
    function projectActionFailure(error){const feedback=$('pkComposerStatus');feedback.textContent=error.message;feedback.hidden=false;feedback.classList.add('error');feedback.setAttribute('role','alert');composer.classList.add('pc-composer-feedback');}
    async function enterGeneration(after=()=>{go('design');editor.focus();}){
      if(generationOpening||projectTransition()||projectBusy()||projectState?.recovery)return false;
      if(!projectLibrary){after();return true;}
      if(!projectState?.ready||typeof projectLibrary.openGeneration!=='function')return false;
      generationOpening=true;
      try{if(!await projectLibrary.openGeneration())return false;after();return true;}
      catch(error){projectActionFailure(error);return false;}
      finally{generationOpening=false;}
    }
    async function saveAsProject(){
      if(!projectLibrary||!projectState?.ready||projectTransition()||projectBusy()||projectState.recovery)return false;
      try{const saved=await projectLibrary.saveAsProject();if(!saved)projectActionFailure(Error(projectState?.error||projectState?.notice||'프로젝트로 저장하지 못했어요. 현재 작업은 유지됐어요.'));return saved;}catch(error){projectActionFailure(error);return false;}
    }
    function generationStorageText(){
      if(!projectState?.initialized)return '보관 상태 확인 중';
      if(!projectState.ready||projectState.error||projectState.recovery)return '보관 상태 확인 필요';
      return projectState.saving?'기록 보관 중':'기록 자동 보관';
    }
    function renderProjectContext(summary){
      const general=projectState?.activeKind!=='project',name=$('pcProjectName'),save=$('pcSaveAsProject');
      name.textContent=general?'일반 생성 · '+generationStorageText():'프로젝트 · '+(summary.name||'이름 없는 프로젝트');
      name.title=name.textContent;
      save.hidden=!general;save.disabled=!projectState?.ready||projectTransition()||projectBusy()||!!projectState?.recovery;
    }
    function composerDraft(){return {text:editor.value,start:editor.selectionStart||0,end:editor.selectionEnd||0};}
    function projectDraft(){return generationDraftOverlay?.identity===studio.desktopChat.getState().projectId?{...generationDraftOverlay.draft}:composerDraft();}
    function restoreProjectDraft(value){generationDraftOverlay=null;editor.value=value?.text||'';editor.setSelectionRange(value?.start||0,value?.end||0);fitPrompt();}
    function applyHomeDraft(value){
      applyingHomeDraft=true;
      try{editor.value=value.text;editor.setSelectionRange(value.start,value.end);editor.dispatchEvent(new root.Event('input',{bubbles:true}));fitPrompt();}
      finally{applyingHomeDraft=false;}
    }
    async function submitHomeGeneration(event){
      if(doc.body.dataset.studioScreen!=='home'||!projectLibrary)return;
      event.preventDefault();event.stopImmediatePropagation();
      if(homeSubmitPending||event.isComposing||composerComposing||projectBusy()||projectTransition()||!editor.value.trim()||$('pkGenerate').disabled)return false;
      const payload=composerDraft(),epoch=editorDraftEpoch,wasProject=projectState?.activeKind==='project';homeSubmitPending=true;
      try{
        if(!await enterGeneration(()=>{})){if(editorDraftEpoch===epoch&&!composerComposing)applyHomeDraft(payload);return false;}
        if(editorDraftEpoch!==epoch||composerComposing||projectBusy())return false;
        // Forward the home message without replacing the restored general draft.
        // The existing catalog draft Map receives it on the next transition.
        const identity=studio.desktopChat.getState().projectId;
        if(wasProject)generationDraftOverlay={identity,draft:composerDraft(),requestId:null,pending:true};
        else if(generationDraftOverlay?.identity===identity){generationDraftOverlay.requestId=null;generationDraftOverlay.pending=true;}
        applyHomeDraft(payload);go('design');showHomeConversation();
        return $('pkPromptForm').requestSubmit();
      }catch(error){if(editorDraftEpoch===epoch&&!composerComposing)applyHomeDraft(payload);projectActionFailure(error);return false;}
      finally{homeSubmitPending=false;}
    }
    function lockProjectInputs(){
      const locked=projectTransition();if(locked===projectInputLocked)return;projectInputLocked=locked;
      if(locked){for(const id of ['pcPrompt','prompt','projectName','brief','appearance','designDetail','notes']){const node=$(id);if(node){projectReadOnly.set(node,node.readOnly);node.readOnly=true;}}for(const node of [workspace,canvasOverlay,drawer]){projectInert.set(node,node.inert);node.inert=true;}}
      else{for(const [node,value] of projectReadOnly)node.readOnly=value;projectReadOnly.clear();for(const [node,value] of projectInert)node.inert=value;projectInert.clear();}
    }
    // While the host debounce is pending its completion calls autosaved(), so one edit burst exports once.
    function queueProjectSave(){if(!projectLibrary||!projectState?.ready||projectState.transitioning||projectState.recovery||foreignProjectLoading)return;clearTimeout(projectSaveTimer);if(studio.savePending?.())return;projectSaveTimer=root.setTimeout(()=>{if(projectState?.ready&&!projectState.transitioning&&!projectState.recovery&&!foreignProjectLoading)void projectLibrary.saveCurrent();},250);}
    function projectDate(value){const stamp=Date.parse(value);return Number.isFinite(stamp)?new Date(stamp).toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'';}
    function renderProjectRows(list,items,state,heading,restoreFocus,emptyText='저장된 프로젝트가 없어요.'){
      const focused=list.contains(doc.activeElement)?doc.activeElement?.closest?.('[data-pk-project-id]'):null,focusId=focused?.dataset.pkProjectId,focusAction=focused?.dataset.pkProjectAction;list.replaceChildren();
      for(const item of items){
        const row=doc.createElement('div');row.className='pc-project-item';row.classList.toggle('current',item.id===state.activeId);if(item.id===state.activeId&&lastProjectActive&&lastProjectActive!==item.id)row.classList.add('pc-project-changed');
        const open=doc.createElement('button');open.type='button';open.dataset.pkProjectId=item.id;open.dataset.pkProjectAction='open';open.className='pc-project-open';const name=doc.createElement('strong'),details=doc.createElement('small'),text=doc.createElement('span');name.innerHTML=esc(item.name)+(item.favorite?icon('star'):'')+(item.id===state.activeId?'<span class="pc-project-active">사용 중</span>':'');details.textContent=[`후보 ${item.candidateCount}개`,(list===$('pcProjectsPageList')?'수정 ':'')+projectDate(item.updatedAt)].filter(Boolean).join(' · ');open.setAttribute('aria-label',`${item.name}, 후보 ${item.candidateCount}개, ${projectDate(item.updatedAt)}, 프로젝트 ${item.id} ${item.id===state.activeId?'사용 중, 계속 작업':'열기'}`);open.setAttribute('aria-current',String(item.id===state.activeId));open.title=`프로젝트 ${item.id}. 전환하면 저장되지 않은 선택 영역은 초기화됩니다.`;text.append(name,details);
        if(item.preview){const preview=doc.createElement('img');preview.src=item.preview;preview.alt='';preview.className='pc-project-preview';open.append(preview);}else{const preview=doc.createElement('span');preview.className='pc-project-preview';preview.innerHTML=icon('folder');open.append(preview);}open.append(text);
        const remove=doc.createElement('button');remove.type='button';remove.dataset.pkProjectId=item.id;remove.dataset.pkProjectAction='remove';remove.className='pc-project-remove';remove.hidden=item.id===state.activeId;remove.innerHTML=icon('trash-2');remove.setAttribute('aria-label',`${item.name} 앱 목록에서 제거`);remove.title='앱 목록의 항목만 제거하며 원본 파일은 삭제하지 않아요.';row.append(open,remove);list.append(row);
      }
      if(!items.length){const empty=doc.createElement('p');empty.className='pc-home-recent-empty';empty.textContent=!state?.initialized?'프로젝트 목록을 확인하고 있어요.':!state.ready?'프로젝트 목록을 사용할 수 없어요.':emptyText;list.append(empty);}
      if(focusId&&restoreFocus){const target=Array.from(list.querySelectorAll('[data-pk-project-id]')).find(node=>node.dataset.pkProjectId===focusId&&node.dataset.pkProjectAction===focusAction)||list.querySelector('[data-pk-project-action=open]')||heading;target.focus({preventScroll:true});}
    }
    function lockProjectRows(list,state,locked){for(const node of list.querySelectorAll('[data-pk-project-id]'))node.disabled=locked||!!state?.recovery||node.dataset.pkProjectAction==='remove'&&(node.dataset.pkProjectId===state?.activeId||(state?.items.length||0)<2);}
    function renderProjectPage(){
      const list=$('pcProjectsPageList');if(doc.body.dataset.studioScreen!=='projects'){if(projectCatalogKey){list.replaceChildren();projectCatalogKey='';}return;}
      const state=projectState,query=projectSearchQueries.projects.trim().toLocaleLowerCase(),items=(state?.items||[]).filter(item=>!query||item.name.toLocaleLowerCase().includes(query)).slice().sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||a.id.localeCompare(b.id)),locked=projectTransition()||projectBusy(),pages=Math.max(1,Math.ceil(items.length/20));
      projectCatalogPage=Math.max(0,Math.min(projectCatalogPage,pages-1));
      const status=$('pcProjectsPageStatus');status.textContent=state?.error||(!state?.initialized?'프로젝트 목록을 확인하고 있어요.':state?.recovery?'현재 화면은 유지됐어요. 앱 목록 저장을 다시 시도하거나 파일로 저장해주세요.':state?.notice||'');status.classList.toggle('error',!!state?.error||!!state?.recovery);status.setAttribute('role',state?.error||state?.recovery?'alert':'status');
      const key=JSON.stringify([query,projectCatalogPage,state?.activeId,items.map(item=>[item.id,item.name,item.updatedAt,item.candidateCount,item.favorite]),state?.initialized,state?.ready]);
      if(key!==projectCatalogKey){projectCatalogKey=key;renderProjectRows(list,items.slice(projectCatalogPage*20,projectCatalogPage*20+20),state,$('pcProjectsHeading'),true,query?'검색한 프로젝트가 없어요.':'저장된 프로젝트가 없어요.');}lockProjectRows(list,state,locked);
      $('pcProjectsPagePaging').hidden=pages<=1;$('pcProjectsPageNumber').textContent=`${projectCatalogPage+1} / ${pages}`;
      projectsPage.querySelector('[data-pk-project-page=previous]').disabled=locked||projectCatalogPage===0;projectsPage.querySelector('[data-pk-project-page=next]').disabled=locked||projectCatalogPage>=pages-1;
      for(const node of projectsPage.querySelectorAll('[data-pk-action]'))node.disabled=locked||!!state?.recovery&&node.dataset.pkAction!=='save';
      const retry=projectsPage.querySelector('[data-pk-project-retry]');retry.hidden=!state?.error&&!state?.recovery;retry.disabled=projectTransition();
    }
    function syncProjectSearch(screen){
      const scope=screen==='projects'?'projects':'home',search=$('pkSearch');
      if(scope!==projectSearchScope){projectSearchQueries[projectSearchScope]=search.value;projectSearchScope=scope;search.value=projectSearchQueries[scope];}
      search.placeholder=scope==='projects'?'프로젝트 검색…':'프로젝트·현재 후보 검색…';layout.querySelector('label[for="pkSearch"]').textContent=scope==='projects'?'프로젝트 이름 검색':'프로젝트 이름과 현재 후보 이름·설명 검색';
    }
    function renderProjects(summary=lastSummary||studio.getSummary()){
      renderProjectContext(summary);
      const state=projectState,query=(projectSearchScope==='home'?$('pkSearch').value:projectSearchQueries.home).trim().toLocaleLowerCase(),currentCandidateMatch=workspaceEntries.some(item=>[item.label,item.prompt,item.operationLabel].some(value=>String(value||'').toLocaleLowerCase().includes(query)));
      const items=(state?.items||[]).filter(item=>!query||item.name.toLocaleLowerCase().includes(query)||item.id===state.activeId&&currentCandidateMatch).slice().sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||a.id.localeCompare(b.id));
      const pages=Math.max(1,Math.ceil(items.length/2));projectPage=Math.max(0,Math.min(projectPage,pages-1));
      const active=state?.items.find(item=>item.id===state.activeId),locked=projectTransition()||projectBusy(),status=$('pcProjectLibraryStatus');
      const general=state?.activeKind!=='project';
      $('studioTitle').textContent=general?'일반 생성 기록':summary.name||'이름 없는 프로젝트';$('pcHomeCandidateSummary').textContent=`현재 후보 ${summary.candidateCount}개${general?' · '+generationStorageText():state?.saving?' · 저장 중':active?' · 앱에 저장됨':''}`;
      status.textContent=state?.error||(state?.recovery?'현재 화면은 유지됐어요. 앱 목록 저장을 다시 시도하거나 파일로 저장해주세요.':state&&!state.initialized?'프로젝트 목록을 확인하고 있어요.':state?.notice||'');
      status.classList.toggle('error',!!state?.error||!!state?.recovery);status.setAttribute('role',state?.error||state?.recovery?'alert':'status');
      $('pkFavorite').disabled=locked||!active;$('pkFavorite').classList.toggle('selected',!!active?.favorite);$('pkFavorite').setAttribute('aria-pressed',String(!!active?.favorite));const favoriteLabel=active?`현재 프로젝트 ${active.name} 즐겨찾기 ${active.favorite?'해제':'추가'}`:'현재 프로젝트 즐겨찾기';$('pkFavorite').setAttribute('aria-label',favoriteLabel);$('pkFavorite').setAttribute('title',favoriteLabel);
      $('pcProjectPaging').hidden=pages<=1;$('pcProjectPage').textContent=`${projectPage+1} / ${pages}`;$('pcProjectPrevious').disabled=locked||projectPage===0;$('pcProjectNext').disabled=locked||projectPage>=pages-1;$('pcProjectRetry').hidden=!state?.error&&!state?.recovery;$('pcProjectRetry').disabled=projectTransition();
      for(const node of $('pcProjectLibraryActions').querySelectorAll('button'))node.disabled=locked||!!state?.recovery&&node.dataset.pkAction!=='save';
      const key=JSON.stringify([query,projectPage,state?.activeId,items.map(item=>[item.id,item.name,item.updatedAt,item.candidateCount,item.favorite]),state?.initialized]);
      const list=$('pkRecentGrid');if(key!==projectListKey){projectListKey=key;renderProjectRows(list,items.slice(projectPage*2,projectPage*2+2),state,$('pcProjectLibraryHeading'),doc.body.dataset.studioScreen==='home',query?'검색한 프로젝트가 없어요.':'저장된 프로젝트가 없어요.');}
      lockProjectRows(list,state,locked);renderProjectPage();
      $('pkSearchEmpty').hidden=!query||items.length>0;if(state?.activeId)lastProjectActive=state.activeId;
    }
    function setupProjects(){
      if(!root.PankekiProjectLibrary)return;
      projectLibrary=root.PankekiProjectLibrary.create({indexedDB:root.indexedDB,ready:studio.ready,capture:()=>studio.exportProject(),persistCurrent:raw=>studio.persistCurrentProject(raw,{skipUnchanged:true}),validateRaw:raw=>studio.validatedProject?.(raw)||root.CharacterDesign.parseProject(raw),load:raw=>studio.importProject(raw),newProject:()=>studio.resetProject(),isBusy:projectBusy,getIdentity:()=>studio.desktopChat.getState().projectId,getDraft:projectDraft,setDraft:restoreProjectDraft});
      projectLibrary.subscribe(state=>{projectState=state;lockProjectInputs();renderProjects();for(const listener of projectListeners)listener(state);});
      async function originalAction(action){if(projectBusy()||projectTransition()||projectState?.recovery)return false;foreignProjectLoading=true;lockProjectInputs();for(const listener of projectListeners)listener(projectState);try{return await action();}finally{foreignProjectLoading=false;lockProjectInputs();renderProjects();for(const listener of projectListeners)listener(projectState);}}
      const unavailable=()=>projectState?.initialized&&!projectState.ready&&!projectState.recovery;
      studio.setProjectActions({autosaved:()=>queueProjectSave(),newProject:()=>unavailable()?originalAction(()=>studio.resetProject()):projectLibrary.newProject(),saveCurrent:()=>unavailable()?'unavailable':projectLibrary.saveCurrent(),importProject:async raw=>{if(unavailable())return originalAction(()=>studio.importProject(raw));let parsed;try{parsed=typeof raw==='string'?JSON.parse(raw):raw;}catch{return projectLibrary.importProject(raw);}if(parsed?.version===1&&!parsed.format)return projectLibrary.importProject(raw);if(projectBusy()||projectTransition()||projectState?.recovery)return false;foreignProjectLoading=true;lockProjectInputs();for(const listener of projectListeners)listener(projectState);try{if(projectState?.ready&&!await projectLibrary.saveCurrent())return false;const loaded=await studio.importProject(raw);if(loaded)await projectLibrary.rebindCurrent();return loaded;}finally{foreignProjectLoading=false;lockProjectInputs();renderProjects();for(const listener of projectListeners)listener(projectState);}}});
      void projectLibrary.init();
    }
    function placeComposer(screen){
      const parent=screen==='home'?$('pcHomeComposer'):composerAnchor.parentNode;if(composer.parentNode===parent)return;
      const focused=doc.activeElement,inside=composer.contains(focused),start=editor.selectionStart,end=editor.selectionEnd;
      if(screen==='home')parent.append(composer);else parent.insertBefore(composer,composerAnchor.nextSibling);
      if(inside){focused.focus({preventScroll:true});if(focused===editor&&Number.isInteger(start)&&Number.isInteger(end))editor.setSelectionRange(start,end);}
    }
    function routes(){
      const screen=doc.body.dataset.studioScreen||'home',comparing=screen==='compare';
      if(!['home','projects','design'].includes(screen)&&(!desktopBinding||screen!=='inpaint')&&viewerId)closeViewer();
      if(screen==='inpaint'&&lastRoute!==screen)showPane('canvas',false);lastRoute=screen;
      syncPresentation();
      const activeRoute=comparing?'inpaint':screen==='video'?'motion':screen;syncProjectSearch(screen);renderProjects();
      placeComposer(screen);homeShortcuts.hidden=true;
      composer.querySelector('.pc-prompt-label').classList.toggle('sr-only',screen==='home');
      $('pkGalleryOpen').hidden=screen==='home';syncComposerFeedback(screen==='home');
      if(desktopBinding)editor.placeholder=screen==='home'?'어떤 이미지를 만들어볼까요?':'메시지를 입력하세요.';
      const children=Array.from(shell.children);
      if(screen==='design'){if(children.at(-1)!==workspace)shell.append(workspace);}
      else if(screen!=='home'&&children.indexOf(workspace)>children.indexOf(composer))shell.append(...(desktopBinding?[workspace,composerAnchor,composer]:[workspace,categoryRow,composerAnchor,composer]));
      for(const node of layout.querySelectorAll('[data-pk-route]')){
        const active=node.dataset.pkRoute===activeRoute;
        node.classList.toggle('active',active);if(active)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');
      }
      composer.hidden=comparing;composer.inert=comparing;
      categoryRow.hidden=comparing||!desktopBinding&&studio.getSummary().mode==='inpaint';
      $('editorTools').hidden=comparing||$('editor').hidden;
      $('pcShowCanvas').disabled=!viewerId&&screen!=='inpaint';syncCanvasTools();
      $('pkScreenTitle').textContent=({projects:'프로젝트',design:'이미지 생성',inpaint:'디자인 · 부분 수정',compare:'후보 비교',parts:'부위 편집',motion:'표정 · 동작',video:'Blender 영상',export:'출력'})[screen]||'홈';
      layout.dataset.screen=screen;
      const visible=screen==='design';
      if(visible&&!threadVisible){followLatest=true;root.requestAnimationFrame(()=>{fitPrompt();revealLatest();});}
      threadVisible=visible;
      const skip=doc.querySelector('.skip-link');if(skip)skip.href=screen==='projects'?'#pcProjectsHeading':visible?'#pcConversation':'#workspace';
    }
    function go(screen){if(composerComposing&&screen!==workflow.getScreen()){queuedRoute=screen;return;}if(screen==='inpaint'){homeConversationOnly=false;editorOpen=true;}workflow.go(screen);routes();updateWorkspace(studio.getSummary());}
    function settingsPanel(panel){
      if(!settingCategories.some(([key])=>key===panel))panel='model';
      drawer.dataset.panel=panel;
      const [,tab,label]=settingCategories.find(([key])=>key===panel);
      $('pkSettingsTitle').textContent=label+' 설정';chatPanel.hidden=panel!=='brief';modelPanel.hidden=panel==='brief';modelPanel.setAttribute('aria-labelledby',tab);
      for(const node of modelPanel.querySelectorAll('[data-pk-settings-section]'))node.hidden=node.dataset.pkSettingsSection!==panel;
      for(const node of drawer.querySelectorAll('[data-pk-panel]')){const selected=node.dataset.pkPanel===panel;node.setAttribute('aria-selected',String(selected));node.tabIndex=selected?0:-1;}
    }
    function settings(panel='model',field=null){
      closeHeaderPopup(false);if(dialog.open)dialog.close();if(galleryDialog.open)galleryDialog.close();
      if(desktopBinding&&field==='imageModel')field=studio.getSummary().mode==='inpaint'?'desktopEditModel':'desktopGenerationModel';
      const target=field&&$(field),category=target?.closest('[data-pk-settings-section]')?.dataset.pkSettingsSection;
      settingsPanel(category||panel);if(!drawer.open){settingsReturnFocus=doc.activeElement;drawer.showModal();}moreSettings.open=false;
      $('detailPanel').open=true;$('briefDrawer').open=true;$('advanced').open=true;
      const focus=target&&!target.hidden&&!target.inert?target:drawer.querySelector('[aria-selected="true"]');
      for(let node=focus?.parentNode;node&&node!==drawer;node=node.parentNode)if(node.tagName==='DETAILS')node.open=true;
      root.requestAnimationFrame(()=>{focus?.focus();focus?.scrollIntoView({block:'nearest'});});
    }
    function chooseCategory(id,{fromUser=true}={}){
      if(!categories.some(item=>item.id===id))return;
      if(desktopBinding){if(!fromUser)return;aiCategory=id;for(const node of categoryRow.querySelectorAll('button')){const selected=node.dataset.pkCategory===id;node.classList.toggle('selected',selected);node.setAttribute('aria-pressed',String(selected));}return;}
      category=id;
      // Environment/photo styles should not inherit the character brief's
      // silhouette and palette instructions. The drawer can enable it again.
      if(fromUser&&!['character','chibi'].includes(id)){
        $('useBrief').checked=false;$('useBrief').dispatchEvent(new root.Event('change',{bubbles:true}));
      }
      for(const node of categoryRow.querySelectorAll('[data-pk-category]')){const active=node.dataset.pkCategory===id;node.classList.toggle('selected',active);node.setAttribute('aria-pressed',String(active));}
    }
    async function useTemplate(id){
      const item=templates.find(value=>value.id===id);if(!item)return;
      if(doc.body.dataset.studioScreen==='home'&&!await enterGeneration(()=>{}))return false;
      generationDraftOverlay=null;
      heroTemplate=item;chooseCategory(item.category);
      const input=desktopBinding?editor:prompt;input.value=item.prompt;input.dispatchEvent(new root.Event('input',{bubbles:true}));
      if(!desktopBinding){editor.value=descriptionText(prompt.value);editor.setSelectionRange(editor.value.length,editor.value.length);fitPrompt();}
      $('useBrief').checked=false;$('useBrief').dispatchEvent(new root.Event('change',{bubbles:true}));
      go('design');editor.focus();
    }
    function library(kind){
      closeHeaderPopup(false);if(drawer.open)drawer.close();if(galleryDialog.open)galleryDialog.close();
      let title='추천 템플릿',body='';
      if(kind==='templates'||kind==='prompts'){
        title=kind==='prompts'?'추천 프롬프트':'추천 템플릿';
        body=`<p>마음에 드는 방향을 골라 나만의 설명으로 바꿔보세요.</p><div class="pk-library-grid">${templates.map(item=>`<button type="button" data-pk-template="${item.id}" aria-label="${esc(item.label)}">${img(item.asset)}<strong>${item.label}</strong><small>${esc(item.prompt)}</small></button>`).join('')}</div>`;
      }else if(kind==='stages'){
        title='작업 단계';body=`<div class="pk-stage-list">${[['design','이미지 생성'],['inpaint','디자인 · 부분 수정'],['parts','부위 편집'],['motion','표정 · 동작'],['export','출력']].map(([screen,label])=>`<button type="button" data-pk-route="${screen}">${label}${icon('arrow-right')}</button>`).join('')}</div>`;
      }else{
        title='내 프로젝트';const summary=studio.getSummary();
        body=`<p>이 브라우저의 현재 작업을 이어 열거나, 저장한 프로젝트 파일을 불러오세요.</p>${summary.imageUrl?`<button type="button" class="pk-library-current" data-pk-action="continue">${imgFromURL(summary.imageUrl)}<strong>${esc(summary.name||'이름 없는 프로젝트')}</strong><small>후보 ${summary.candidateCount}개</small></button>`:'<p class="pk-library-empty">아직 저장된 이미지가 없습니다.</p>'}<div class="pk-library-actions"><button type="button" class="pk-secondary" data-pk-action="import">${icon('folder-open')}프로젝트 불러오기</button><button type="button" class="pk-secondary" data-pk-action="save">${icon('download')}현재 프로젝트 저장</button><button type="button" class="pk-primary" data-pk-action="new">${icon('plus')}새 프로젝트</button></div>`;
      }
      dialog.innerHTML=`<div class="pk-dialog-heading"><h2>${title}</h2>${button('닫기','x','data-pk-close')}</div>${body}`;
      dialog.showModal();
    }
    function imgFromURL(url){return `<img src="${esc(url)}" alt="현재 프로젝트 이미지">`;}
    function action(name,field=null){
      if(name==='notifications'||name==='profile')return openHeaderPopup(name);
      closeHeaderPopup(false);
      if(name==='gallery'){galleryDialog.showModal();const query=$('pkSearch').value.trim().toLocaleLowerCase(),match=query&&workspaceEntries.find(item=>[item.label,item.prompt,item.operationLabel].some(value=>String(value||'').toLocaleLowerCase().includes(query)));if(match)galleryDialog.querySelector(`[data-candidate-id="${match.id}"] [data-action=view]`)?.focus({preventScroll:true});return;}
      if(name==='projects')return go('projects');
      if(['templates','prompts','stages'].includes(name))return library(name);
      if(name==='settings')return settings('model',field);
      if(name==='models')return settings('model',field||'imageModel');
      if(name==='brief')return settings('brief');
      if(dialog.open)dialog.close();
      if(name==='reference'){
        const openUpload=()=>{go('inpaint');$('upload').click();};
        if(doc.body.dataset.studioScreen==='home')return enterGeneration(openUpload);
        return openUpload();
      }
      if(name==='import')return $('loadProject').click();
      if(name==='save')return $('saveProject').click();
      if(name==='save-as-project')return saveAsProject();
      if(name==='new')return Promise.resolve(studio.requestNewProject?studio.requestNewProject():studio.resetProject()).then(done=>{if(done)go('design');});
      if(name==='generate')return enterGeneration();
      if(name==='hero'){if(studio.getSummary().imageUrl)go('design');else useTemplate(heroTemplate.id);return;}
      if(name==='continue')return go('design');
      if(['parts','motion','export'].includes(name))return go(name);
    }
    function recent(summary){renderProjects(summary);}
    function generateDisabled(summary){return summary.busy||(summary.mode==='inpaint'&&summary.editOperation==='recolor'?!summary.sourceLoaded:!summary.modelsReady||!prompt.value.trim());}
    function refresh(summary,reason){
      lastSummary=summary;const hasImage=!!summary.imageUrl;
      if(['restore','import','reset'].includes(reason)&&(viewerId||desktopBinding&&editorOpen))closeViewer();
      const editing=summary.mode==='inpaint';
      if(!desktopBinding)categoryRow.hidden=editing;
      const recolor=editing&&summary.editOperation==='recolor';
      if(!desktopBinding){
      composer.classList.toggle('pc-recolor',recolor);
      composer.querySelector('label[for=pcPrompt]').textContent=editing?'수정할 내용':'이미지 설명';
      composer.querySelector('.pc-key-hint').innerHTML=recolor?'선택 영역에 색상 적용':`<kbd>Enter</kbd> ${editing?'수정':'생성'} · <kbd>Shift Enter</kbd> 줄바꿈`;
      editor.placeholder=editing?'선택 영역에서 바꿀 내용을 적어주세요.':'원하는 이미지를 입력하세요...';
      editor.setAttribute('aria-label',editing?'수정할 내용':'원하는 이미지 설명');
      const text=descriptionText(prompt.value);if(doc.activeElement!==editor&&editor.value!==text){editor.value=text;fitPrompt(true);}
      }
      renderConversation(summary,['restore','import','reset'].includes(reason));
      updateWorkspace(summary);
      if(!desktopBinding)thread.querySelector('.pc-pending').hidden=!summary.busy;
      if(summary.busy&&!wasBusy){followLatest=true;revealLatest();}wasBusy=summary.busy;
      if(['restore','import','reset'].includes(reason)){const restoreSelection=!projectState?.transitioning;root.requestAnimationFrame(()=>fitPrompt(restoreSelection));}
      const selected=$('imageModel').selectedOptions?.[0];
      if(!desktopBinding){
      $('pcModelName').textContent=selected?.textContent||'모델 확인 중';
      $('pcResolution').textContent=`${$('width').value} × ${$('height').value}`;
      $('pkModelHint').textContent=`${selected?.textContent||'SDXL 1.0 Base'} · ${$('width').value} × ${$('height').value} · 영어 설명 권장`;
      $('pkGenerate').disabled=generateDisabled(summary);
      $('pkGenerate').innerHTML=recolor?'색상 적용':icon('send-horizontal');
      $('pkGenerate').setAttribute('aria-label',recolor?summary.busy?'색상 적용 중':'색상 적용':summary.busy?'이미지 생성 중':summary.mode==='inpaint'?'선택 영역 수정하기':'이미지 생성하기');
      $('pkGenerate').classList.toggle('busy',summary.busy);
      $('pkCancel').hidden=!summary.busy;
      }
      $('pkGalleryOpen').textContent=`후보 ${summary.candidateCount}개`;
      shell.classList.toggle('pk-has-results',hasImage||summary.busy);
      shell.classList.toggle('pk-is-busy',summary.busy);
      if(!desktopBinding)syncFeedback(summary.busy);
      recent(summary);routes();
    }
    function syncFeedback(busy=studio.getSummary().busy){
      updateWorkspace(studio.getSummary());
      if(desktopBinding)return;
      const status=$('status'),feedback=$('pkComposerStatus'),error=status.classList.contains('error');
      feedback.textContent=busy||error?status.textContent:'';
      feedback.classList.toggle('error',error);
      feedback.setAttribute('role',error?'alert':'status');
      syncComposerFeedback(doc.body.dataset.studioScreen==='home');
    }
    function projectAction(project){
      if(!projectLibrary||project.disabled)return;const id=project.dataset.pkProjectId;
      if(project.dataset.pkProjectAction==='remove'){if(root.confirm('앱의 프로젝트 목록에서 이 항목을 제거할까요? 원본 파일은 삭제하지 않습니다.'))return projectLibrary.remove(id);return;}
      const focusEditor=()=>{go(studio.getSummary().mode==='inpaint'?'inpaint':'design');editor.focus({preventScroll:true});};
      if(id===projectState.activeId)return focusEditor();return projectLibrary.switchTo(id).then(opened=>{if(opened)focusEditor();return opened;});
    }
    layout.addEventListener('click',event=>{
      const recent=event.target.closest('[data-pk-home-candidate]');if(recent){activateCandidate(recent.dataset.pkHomeCandidate,recent);return;}
      const project=event.target.closest('[data-pk-project-id]');if(project)return projectAction(project);
      const projectPageControl=event.target.closest('[data-pk-project-page]');if(projectPageControl&&!projectPageControl.disabled){projectCatalogPage+=projectPageControl.dataset.pkProjectPage==='previous'?-1:1;renderProjectPage();projectsPage.scrollTop=0;$('pcProjectsHeading').focus({preventScroll:true});return;}
      const projectRetry=event.target.closest('[data-pk-project-retry]');if(projectRetry&&!projectRetry.disabled)return projectLibrary?.saveCurrent();
      const route=event.target.closest('[data-pk-route]');if(route){const next=route.dataset.pkRoute;if(next==='projects')return action('projects');if(next==='design')return enterGeneration();go(next);return;}
      const target=event.target.closest('[data-pk-action]');if(target)return action(target.dataset.pkAction,target.dataset.pkSettingTarget);
      const template=event.target.closest('[data-pk-template]');if(template)return useTemplate(template.dataset.pkTemplate);
      const chosen=event.target.closest('[data-pk-category]');if(chosen)chooseCategory(chosen.dataset.pkCategory);
    });
    dialog.addEventListener('click',event=>{
      if(event.target.closest('[data-pk-close]'))return dialog.close();
      const template=event.target.closest('[data-pk-template]');if(template){dialog.close();return useTemplate(template.dataset.pkTemplate);}
      const route=event.target.closest('[data-pk-route]');if(route){dialog.close();return go(route.dataset.pkRoute);}
      const target=event.target.closest('[data-pk-action]');if(target)action(target.dataset.pkAction);
    });
    drawer.addEventListener('click',event=>{
      if(event.target.closest('[data-pk-close]'))return drawer.close();
      const chosen=event.target.closest('[data-pk-category]');if(chosen)return chooseCategory(chosen.dataset.pkCategory);
      const target=event.target.closest('[data-pk-panel]');if(target)settingsPanel(target.dataset.pkPanel);
    });
    drawer.querySelector('[role=tablist]').addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)){event.preventDefault();const index=settingCategories.findIndex(([key])=>key===drawer.dataset.panel),next=event.key==='Home'?0:event.key==='End'?settingCategories.length-1:(index+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)+settingCategories.length)%settingCategories.length,panel=settingCategories[next][0];settingsPanel(panel);drawer.querySelector(`[data-pk-panel="${panel}"]`).focus();}});
    drawer.addEventListener('close',()=>{if(settingsReturnFocus&&doc.body.contains(settingsReturnFocus))settingsReturnFocus.focus();settingsReturnFocus=null;});
    for(const modal of [dialog,drawer,galleryDialog])modal.addEventListener('click',event=>{if(event.target===modal){const box=modal.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)modal.close();}});
    layout.querySelector('.pk-brand').addEventListener('click',event=>{event.preventDefault();go('home');});
    $('pkSearch').addEventListener('input',()=>{projectSearchQueries[projectSearchScope]=$('pkSearch').value;if(projectSearchScope==='projects')projectCatalogPage=0;else projectPage=0;if(lastSummary)recent(lastSummary);});
    $('pkFavorite').addEventListener('click',()=>{const active=projectState?.items.find(item=>item.id===projectState.activeId);if(active&&!$('pkFavorite').disabled)return projectLibrary.setFavorite(active.id,!active.favorite);});
    $('pcProjectPrevious').addEventListener('click',()=>{if(!$('pcProjectPrevious').disabled){projectPage--;renderProjects();}});$('pcProjectNext').addEventListener('click',()=>{if(!$('pcProjectNext').disabled){projectPage++;renderProjects();}});$('pcProjectRetry').addEventListener('click',()=>projectLibrary?.saveCurrent());
    $('pkPromptForm').addEventListener('submit',submitHomeGeneration,{capture:true});
    $('pkPromptForm').addEventListener('submit',async event=>{event.preventDefault();if(desktopBinding||doc.body.dataset.studioScreen==='compare'||studio.getSummary().busy)return;try{if(!await submitPrompt(studio,prompt,category))generationDraftOverlay=null;syncFeedback();}catch(error){generationDraftOverlay=null;$('pkComposerStatus').textContent=error.message;$('pkComposerStatus').classList.add('error');$('pkComposerStatus').setAttribute('role','alert');}});
    $('pkCancel').addEventListener('click',()=>{if(!desktopBinding)studio.cancel();});
    // The host prompt handler already published a full refresh for this edit.
    prompt.addEventListener('input',()=>{fitPrompt();if(lastSummary&&!desktopBinding)$('pkGenerate').disabled=generateDisabled(lastSummary);});
    editor.addEventListener('compositionstart',()=>composerComposing=true);editor.addEventListener('compositionend',()=>{composerComposing=false;if(queuedRoute){const screen=queuedRoute;queuedRoute=null;go(screen);}});
    editor.addEventListener('input',()=>{if(!applyingHomeDraft){editorDraftEpoch++;if(doc.body.dataset.studioScreen!=='home')generationDraftOverlay=null;}if(desktopBinding){fitPrompt();return;}prompt.value=editor.value;prompt.dispatchEvent(new root.Event('input',{bubbles:true}));});
    editor.addEventListener('keydown',event=>{if(desktopBinding)return;if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(!$('pkGenerate').disabled)$('pkPromptForm').requestSubmit();}});
    doc.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(doc.body.dataset.studioScreen!=='projects')go('home');$('pkSearch').focus();}});
    doc.querySelector('.skip-link')?.addEventListener('click',event=>{if(doc.body.dataset.studioScreen==='design'){event.preventDefault();event.stopImmediatePropagation();thread.focus();}},{capture:true});
    new root.MutationObserver(routes).observe(doc.body,{attributes:true,attributeFilter:['data-studio-screen']});
    new root.MutationObserver(()=>syncFeedback()).observe($('status'),{attributes:true,attributeFilter:['class'],childList:true,characterData:true,subtree:true});
    $('candidateCount').value='1';
    studio.subscribe((summary,reason)=>{
      if(['restore','import'].includes(reason)){
        const restored=categories.find(item=>prompt.value.trim().endsWith(item.style));
        if(restored)chooseCategory(restored.id,{fromUser:false});
      }
      refresh(summary,reason);queueProjectSave();
    });setupProjects();settingsPanel('model');renderNotifications();routes();
    root.navigator?.storage?.estimate?.().then(value=>{
      const used=value.usage,quota=value.quota,available=Number.isFinite(used)&&used>=0&&Number.isFinite(quota)&&quota>0;
      $('pkStorageBar').hidden=true;
      $('pkStorageText').textContent=available?`약 ${(used/1000000).toFixed(1)} MB 사용`:'저장소 추정값을 확인할 수 없어요.';
      if(available){const detail=`브라우저 저장소 추정값: 약 ${(used/1000000).toFixed(1)} MB 사용 / ${(quota/1000000000).toFixed(1)} GB 추정 한도. 화면을 열 때 확인했으며 앱 전용 확보 공간이나 기기 전체 여유 공간을 뜻하지 않습니다.`;layout.querySelector('.pk-storage').setAttribute('title',detail);layout.querySelector('.pk-storage').setAttribute('aria-label',detail);}
    }).catch(()=>{$('pkStorageBar').hidden=true;$('pkStorageText').textContent='저장소 추정값을 확인할 수 없어요.';});
    return Object.freeze({go,chooseCategory,settings,composer:composerView,projects:projectLibrary});
  }
  return Object.freeze({categories,templates,preparePrompt,submitPrompt,conversationEntries,mount});
});

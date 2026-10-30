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
    {id:'character',label:'Character',asset:'catgirl-hero',style:'Expressive original character design, detailed 2d anime illustration.'},
    {id:'illustration',label:'Illustration',asset:'category-landscape',style:'Beautiful painterly illustration, harmonious colors, detailed composition.'},
    {id:'background',label:'Background',asset:'category-background',style:'Detailed environment background illustration, atmospheric lighting, no characters.'},
    {id:'concept',label:'Concept art',asset:'category-concept',style:'Fantasy concept art, cinematic lighting, rich environmental storytelling.'},
    {id:'portrait',label:'Realistic',asset:'category-portrait',style:'Natural photographic realism, soft cinematic light, detailed textures.'},
    {id:'chibi',label:'Chibi character',asset:'category-chibi',style:'Cute chibi character illustration, small body, expressive face, clean shapes.'},
    {id:'other',label:'Other',asset:'category-other',style:'Creative colorful illustration, playful imaginative composition.'}
  ]);
  const templates=Object.freeze([
    {id:'catgirl',label:'Cat ears',asset:'catgirl-hero',category:'character',prompt:'A gentle adult cat-eared girl with honey brown hair, amber eyes, a cream sweater and small red ribbons, warm sunlight, detailed anime illustration'},
    {id:'postman',label:'Male character',asset:'template-postman',category:'character',prompt:'A cheerful young adult male letter courier, tousled auburn hair, amber eyes, a cream shirt and an orange scarf, warm painterly anime illustration'},
    {id:'pink',label:'Female character',asset:'category-chibi',category:'chibi',prompt:'A cheerful pink-haired chibi girl with curled twin tails and small pink bows, rosy cheeks, pastel peach background, polished 2d illustration'},
    {id:'maid',label:'Maid outfit',asset:'template-maid',category:'character',prompt:'An adult anime woman with an ash gray bob, a modest black and cream Victorian maid outfit and a small bow headband, warm gentle portrait'},
    {id:'bedroom',label:'Background Illustration',asset:'category-background',category:'background',prompt:'A cozy sunlit bedroom with warm wood, soft cream textiles and orange afternoon light, detailed background illustration, no characters'},
    {id:'landscape',label:'Landscape illustration',asset:'category-landscape',category:'illustration',prompt:'A colorful fantasy castle landscape among mountains and trees, warm sunlight, detailed painterly illustration, no characters'},
    {id:'sd-character',label:'Chibi character',asset:'category-chibi',category:'chibi',prompt:'An original cute chibi character with a tiny body, expressive face, clear silhouette, soft warm colors and clean 2d line art'},
    {id:'expression-sheet',label:'Expression set',icon:'smile',category:'character',prompt:'A character expression sheet showing the same original adult character with happy, surprised, thoughtful and calm facial expressions, consistent hairstyle and outfit, clean anime line art'},
    {id:'simple-sketch',label:'Simple sketch',icon:'pencil',category:'character',prompt:'A simple monochrome pencil sketch of an original adult character, clear expressive lines, light construction marks and a plain paper background'}
  ]);
  function preparePrompt(value,id,mode='txt2img'){
    if(typeof value!=='string'||!value.trim())throw Error('Describe the image you want first.');
    let text=value.trim();
    if(mode==='inpaint'){
      text=descriptionText(text);
      if(text.length>4000)throw Error('The image description is too long. Shorten it and try again.');
      return text;
    }
    for(const item of categories)if(text.endsWith(item.style))text=text.slice(0,-item.style.length).trim();
    const style=(categories.find(item=>item.id===id)||categories[0]).style;
    if(text.length+style.length+2>4000)throw Error('The image description is too long. Shorten it and try again.');
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
  function compareProjectRecency(a,b){
    const stamp=value=>{const parsed=typeof value==='string'&&value.trim()?Date.parse(value):NaN;return Number.isFinite(parsed)?parsed:-Infinity;};
    const createdA=stamp(a.createdAt),createdB=stamp(b.createdAt),updatedA=stamp(a.updatedAt),updatedB=stamp(b.updatedAt);
    return (Number.isFinite(updatedB)?updatedB:createdB)-(Number.isFinite(updatedA)?updatedA:createdA)||createdB-createdA||String(a.id).localeCompare(String(b.id));
  }
  function conversationEntries(project){
    return project.versions.map((item,index)=>{
      const request=item.request||{},metrics=item.metrics||{},derived=item.kind==='derived',recolor=request.edit_operation==='recolor';
      const operation=derived?item.derivation.operation:recolor?'recolor':'regenerate';
      const operationLabel=request.mode==='img2img'?'Recompose from reference':derived?({'markup':'Markup','background-remove':'Remove background','erase':'Erase','resize':'Resize'})[operation]:null;
      const prompt=item.kind==='upload'||derived?'':recolor?`Recolor · ${request.target_color}`:descriptionText(item.brief.prompt||request.prompt);
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
    const templateVisual=item=>item.asset?img(item.asset):`<span class="pc-template-icon" aria-hidden="true">${icon(item.icon)}</span>`;
    const button=(label,name,attrs='',cls='pk-icon-button')=>`<button type="button" class="${cls}" ${attrs} aria-label="${esc(label)}" title="${esc(label)}">${icon(name)}</button>`;
    const shell=doc.querySelector('.app-shell'), home=doc.querySelector('[data-studio-page="home"]'),projectsPage=$('pcProjectsPage');
    const originalHeader=doc.querySelector('.app-header'), originalLogo=originalHeader.querySelector('.brand-logo');
    const layout=doc.createElement('div');layout.className='pk-layout';
    layout.innerHTML=`
      <aside class="pk-sidebar" aria-label="Main navigation">
        <a class="pk-brand" href="#home" aria-label="Pankeki home"><img src="${originalLogo.src}" alt=""><span>Pankeki</span></a>
        <nav class="pk-navigation" aria-label="Pankeki workspace navigation">
          ${[[['home','home','Home','route'],['projects','folder','Projects','route'],['design','image','Generate images','route'],['motion','sparkles','Motion','route'],['export','download','Export','route'],['gallery','grid-2x2','Gallery','action']],[['models','box','Models','action'],['settings','settings','Settings','action']]].map((group,index)=>(index?'<span class="pk-nav-divider"></span>':'')+group.map(([target,name,label,kind])=>`<button type="button" ${target==='gallery'?'class="pk-gallery-nav"':''} data-pk-${kind}="${target}" aria-label="${label}" title="${label}">${icon(name)}<span>${label}</span></button>`).join('')).join('')}
        </nav>
        <div class="pk-sidebar-bottom">
          <div class="pk-brand-card"><strong>Pankeki</strong><p>Create your characters<br>with more freedom.</p>${img('pancake-cat')}</div>
          <div class="pk-storage" role="group" aria-label="Browser storage estimate" title="Browser storage estimate checked when this screen opened. It is not reserved app space or total free disk space."><span>${icon('hard-drive')}<span id="pkStorageLabel">Browser storage</span></span><progress id="pkStorageBar" max="100" value="0" hidden aria-label="Estimated browser storage usage"></progress><span class="pk-storage-usage"><small id="pkStorageText">Storage estimate unavailable.</small><small id="pkStoragePercent" hidden></small></span></div>
        </div>
      </aside>
      <div class="pk-surface">
        <header class="pk-header">
          <div class="pk-home-search">${icon('search')}<label class="sr-only" for="pkSearch">Search projects and current candidates</label><input id="pkSearch" type="search" placeholder="Search projects and candidates…"><kbd>⌘ K</kbd></div>
          <h1 id="pkScreenTitle" tabindex="-1">Generate images</h1>
          <span class="pc-header-context" id="pcProjectName"></span>
          <div class="pk-header-home-actions">${button('Activity','bell','data-pk-action="notifications" aria-controls="pcNotifications" aria-haspopup="dialog" aria-expanded="false" data-unread-count="0"')}${button('Open settings','settings','data-pk-action="settings"')}<button type="button" class="pk-avatar" data-pk-action="profile" aria-label="Local profile" title="Local profile" aria-controls="pcProfilePopover" aria-haspopup="dialog" aria-expanded="false"><span id="pcProfileInitial" aria-hidden="true">L</span></button></div>
          <div class="pk-header-generation-actions"><button type="button" class="pk-toolbar-button" data-pk-action="prompts" aria-label="Prompt ideas" title="Prompt ideas">${icon('sparkles')}<span>Prompt ideas</span></button><button type="button" class="pk-toolbar-button" data-pk-action="reference" aria-label="Reference image" title="Reference image">${icon('image')}<span>Reference image</span></button><button type="button" class="pk-toolbar-button" data-pk-action="settings" aria-label="Advanced settings" title="Advanced settings">${icon('sliders-horizontal')}<span>Advanced settings</span></button></div>
          <div class="pc-reference-project-actions"><button type="button" id="pcSaveAsProject" class="pc-save-as-project" data-pk-action="save-as-project" aria-label="Save as project">${icon('folder')}<span>Save as project</span></button>${button('New project','plus','data-pk-action="new"')}${button('Open project','folder-open','data-pk-action="import"')}${button('Gallery','grid-2x2','data-pk-action="gallery"')}</div>
        </header>
        <div class="pk-pages"></div>
      </div>`;
    doc.body.prepend(layout);doc.body.classList.add('pankeki-redesign','pankeki-pc','pankeki-spacious');doc.body.dataset.theme='dark';
    const pages=layout.querySelector('.pk-pages');
    home.className='pk-home';home.setAttribute('aria-label','Pankeki home');home.removeAttribute('aria-labelledby');
    home.innerHTML=`
      <main class="pc-home-main" aria-labelledby="pcHomeHeading">
        <section class="pc-home-hero">${img('pancake-cat','','pc-home-hero-art')}<div class="pc-home-hero-copy"><h1 id="pcHomeHeading">What would you like to <strong>create today?</strong></h1><p class="pc-home-introduction">Bring your imagined characters to life, with more freedom.</p></div></section>
        <section id="pcHomeComposer" class="pc-home-composer" aria-label="Ask Pankeki"><div class="pc-home-composer-context"><p id="pcHomeDestination" class="pc-home-destination">Start in generation history</p><div class="pc-home-model-summary" role="group" aria-label="Current model and image size"><button type="button" id="pcHomeChatModel" data-pk-action="settings" data-pk-setting-target="desktopChatModel" hidden></button><button type="button" id="pcHomeImageModel" data-pk-action="settings" data-pk-setting-target="imageModel"></button><button type="button" id="pcHomeImageSize" data-pk-action="settings" data-pk-setting-target="width"></button><span id="pcHomeSourceSize" hidden></span></div><p id="pcHomeTargetNote" hidden>New image requests are saved in generation history. Use Resume to continue editing the current image.</p></div></section>
        <section class="pk-home-templates"><div class="pk-section-title"><div><h2>Templates</h2><p class="pc-home-template-introduction">Start with a template in a style you like.</p></div><button type="button" class="pk-text-button" data-pk-action="templates">View all ${icon('chevron-right')}</button></div><div class="pk-template-thumbnails">${[[templates[2],'Cute character illustration'],[templates[1],'Male characters in different moods'],[templates[0],'Cat-eared character illustration'],[templates[4],'Warm atmospheric background']].map(([item,description])=>`<button type="button" data-pk-template="${item.id}" aria-label="${esc(item.label)} Template">${img(item.asset)}<span class="pc-home-template-copy"><strong>${item.label}</strong><small>${description}</small></span><span class="pc-home-template-arrow" aria-hidden="true">${icon('chevron-right')}</span></button>`).join('')}</div></section>
      </main>
      <aside class="pc-home-rail" aria-label="Projects and starting tools">
        <section class="pc-home-recent pc-home-projects"><div class="pk-section-title"><h2 id="pcProjectLibraryHeading" tabindex="-1">Recent projects</h2><button type="button" class="pk-text-button" data-pk-route="projects" data-pk-home-projects>View all ${icon('chevron-right')}</button></div><div class="pc-home-project-summary"><div id="pcHomeProjectSummary"><strong id="pcHomeContextLabel">Current project</strong><span id="studioTitle"></span><span id="pcHomeCandidateSummary"></span></div>${button('Favorite current project','star','id="pkFavorite" aria-pressed="false"')}<button type="button" id="pcHomeResume" class="pk-text-button" data-pk-action="continue">Resume ${icon('chevron-right')}</button></div><p id="pcHomeSearchSummary" role="status" hidden></p><p id="pcProjectLibraryStatus" class="pc-project-status" role="status" aria-live="polite"></p><div id="pcHomeProjectEmpty" class="pc-home-project-empty" hidden>${icon('folder')}<strong>No saved projects yet.</strong><p>Generate an image and save your work as a project.</p></div><div id="pkRecentGrid" class="pc-project-list"></div><div id="pcProjectLibraryActions" class="pc-project-actions" role="group" aria-label="Project files and new work"><button type="button" class="pc-project-new" data-pk-action="new">${icon('plus')}New project</button><button type="button" data-pk-action="import" aria-label="Open" title="Open">${icon('folder-open')}<span>Open</span></button><button type="button" data-pk-action="save" aria-label="Save file" title="Save file">${icon('download')}<span>Save file</span></button></div><div class="pc-project-paging" id="pcProjectPaging" hidden>${button('Previous project page','chevron-right','id="pcProjectPrevious"')}<span id="pcProjectPage" aria-live="polite"></span>${button('Next project page','chevron-right','id="pcProjectNext"')}</div><button type="button" class="pc-project-retry" id="pcProjectRetry" hidden>Retry app storage</button><p class="pk-search-empty" id="pkSearchEmpty" hidden>No matching projects or current candidates.</p></section>
        <section class="pk-quick-start"><h2>Quick start</h2>${[['reference','image','Start from an image','Import an image to edit.','violet'],['generate','sparkles','Create with AI','Describe the image you want.','pink'],['new','file-plus','Blank project','Start a new project.','orange']].map(([action,name,title,desc,color])=>`<button type="button" data-pk-action="${action}"><span class="pk-quick-icon ${color}">${icon(name)}</span><span><strong>${title}</strong><small>${desc}</small></span>${icon('chevron-right')}</button>`).join('')}</section>
        <section class="pc-home-tip">${icon('lightbulb')||icon('sparkles')}<div><h2>Tips</h2><p id="pcHomeTipText">Describe the style, composition and mood together.</p><button type="button" class="pc-home-tip-more" data-pk-action="prompts">Browse prompt ideas ${icon('chevron-right')}</button></div></section>
      </aside>`;
    home.querySelector('.pc-home-rail').hidden=true;home.querySelector('.pk-home-templates').hidden=true;
    const recentImagesSection=doc.createElement('section');recentImagesSection.className='pc-home-generated';recentImagesSection.setAttribute('aria-labelledby','pcHomeRecentHeading');recentImagesSection.innerHTML=`<div class="pk-section-title"><h2 id="pcHomeRecentHeading">Recent generated images</h2><button type="button" class="pk-text-button" data-pk-action="recent-images">View all ${icon('chevron-right')}</button></div><p id="pcHomeRecentNotice" role="status" aria-live="polite" hidden></p><div id="pcHomeRecentImages" class="pc-home-image-strip"></div><p id="pcHomeRecentEmpty" class="pc-home-images-empty">No saved generated images yet.</p>`;
    home.querySelector('.pc-home-main').insertBefore(recentImagesSection,$('pcHomeComposer'));recentImagesSection.insertBefore($('pcProjectLibraryStatus'),$('pcHomeRecentImages'));
    if(art['home-honey-background'])layout.style.setProperty('--pc-home-background',`url("${art['home-honey-background']}")`);
    if(art['category-background'])layout.style.setProperty('--pc-home-room-background',`url("${art['category-background']}")`);
    if(art['pancake-cat'])layout.style.setProperty('--pc-avatar-cat',`url("${art['pancake-cat']}")`);
    $('pkSearch').placeholder='Search projects and candidates…';layout.querySelector('label[for="pkSearch"]').textContent='Search project names and current candidate names or descriptions';
    pages.append(home,projectsPage,shell);
    const projectIntroduction=doc.createElement('p');projectIntroduction.className='pc-projects-intro';projectIntroduction.textContent='Manage your images and work in projects.';layout.querySelector('.pk-header').append(projectIntroduction);
    const projectToolbar=doc.createElement('div');projectToolbar.className='pc-projects-toolbar';projectToolbar.innerHTML=`<div class="pc-project-filters" role="group" aria-label="Project filters"><button type="button" data-pk-project-filter="all" aria-pressed="true">${icon('grid-2x2')}All <span id="pcProjectsAllCount">…</span></button><button type="button" data-pk-project-filter="favorite" aria-pressed="false">${icon('star')}Favorites <span id="pcProjectsFavoriteCount">…</span></button><button type="button" data-pk-project-filter="recent" aria-pressed="false" title="Projects edited in the last 7 days">${icon('clock-3')}Recently edited</button></div><div class="pc-project-display"><label for="pcProjectsSort">Sort</label><select id="pcProjectsSort"><option value="updated">Last edited</option><option value="created">Date created</option><option value="name">Name</option></select><div class="pc-project-views" role="group" aria-label="Project view">${button('Grid view','grid-2x2','data-pk-project-view="grid" aria-pressed="true"')}<button type="button" class="pk-icon-button" data-pk-project-view="list" aria-pressed="false" aria-label="List view" title="List view"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M3 6h1M3 12h1M3 18h1"/></svg></button></div></div>`;projectsPage.insertBefore(projectToolbar,$('pcProjectsPageStatus'));$('pcProjectsSort').value='updated';projectsPage.dataset.view='grid';
    const motion=$('motionEditor');if(motion)pages.append(motion);
    const video=$('videoWorkspace');if(video)pages.append(video);
    // Existing tools live in one accessible drawer; retain every ID and handler.
    const drawer=doc.createElement('dialog');drawer.id='pkSettings';drawer.className='pk-drawer';
    drawer.setAttribute('aria-labelledby','pkSettingsTitle');
    const settingCategories=[['chat','pcChatTab','AI chat'],['model','pcOptionsTab','Generate images'],['edit','pcEditTab','Image edit'],['environment','pcEnvironmentTab','Environment'],['brief','pcBriefTab','Character']];
    drawer.innerHTML=`<div class="pk-dialog-heading"><h2 id="pkSettingsTitle">Generation settings</h2>${button('Close settings','x','data-pk-close')}</div><div class="pk-drawer-tabs" role="tablist" aria-label="Settings categories" aria-orientation="vertical">${settingCategories.map(([key,id,label])=>`<button type="button" role="tab" id="${id}" aria-controls="${key==='brief'?'chatPanel':'pcModelPanel'}" data-pk-panel="${key}">${label}</button>`).join('')}</div><div class="pk-drawer-content"></div><div class="pk-library-actions"><button type="button" class="pk-primary pk-settings-done" data-pk-close>Done</button></div>`;
    doc.body.append(drawer);
    const chatPanel=$('chatPanel'), modelPanel=shell.querySelector('.warm-generation-panel');
    modelPanel.id='pcModelPanel';modelPanel.setAttribute('role','tabpanel');modelPanel.setAttribute('aria-labelledby','pcOptionsTab');
    chatPanel.setAttribute('role','tabpanel');chatPanel.setAttribute('aria-labelledby','pcBriefTab');
    drawer.querySelector('.pk-drawer-content').append(chatPanel,modelPanel);
    drawer.dataset.panel='model';
    const advancedBody=$('advanced').querySelector('.details-body'),moreSettings=doc.createElement('details');
    moreSettings.className='pc-more-settings';moreSettings.innerHTML='<summary>Advanced generation settings</summary>';
    for(const node of Array.from(advancedBody.children).slice(3))if(!node.classList.contains('model-note'))moreSettings.append(node);
    // Keep candidate count configurable, but execute only from the composer.
    advancedBody.append(modelPanel.querySelector('.generation-count'));
    modelPanel.querySelector('.generate-dock').hidden=true;
    advancedBody.append(moreSettings);
    const modelNote=modelPanel.querySelector('.model-note'),modelGuide=doc.createElement('details');modelGuide.className='pc-model-guide';modelGuide.innerHTML='<summary>About models</summary>';advancedBody.append(modelGuide);modelGuide.append(modelNote);
    for(const node of advancedBody.children)node.dataset.pkSettingsSection='model';
    modelPanel.querySelector('.model-note').dataset.pkSettingsSection='model';
    const editSettings=doc.createElement('section');editSettings.className='pc-settings-section';editSettings.dataset.pkSettingsSection='edit';
    editSettings.innerHTML='<h3>Edit options</h3>';
    const denoiseField=$('denoise').closest('.field');denoiseField.parentNode.classList.add('pc-single-field');editSettings.append(denoiseField,$('roiOptions'));advancedBody.append(editSettings);
    const environmentSettings=doc.createElement('section');environmentSettings.className='pc-settings-section';environmentSettings.dataset.pkSettingsSection='environment';
    const executionHeading=Array.from(moreSettings.querySelectorAll('.option-heading')).find(node=>node.textContent==='Execution');
    environmentSettings.append(executionHeading,$('cache').closest('label'),$('previewOn').closest('label'),$('clearCache'));advancedBody.append(environmentSettings);
    const negativeLabel=modelPanel.querySelector('label[for="negative"]'),negativeHint=$('negative').closest('.field').querySelector('.hint');
    const negativePresentation={label:negativeLabel.textContent,hint:negativeHint.textContent};
    const seedInput=$('seed'),seedLabel=modelPanel.querySelector('label[for="seed"]'),seedHint=doc.createElement('small');
    seedHint.id='pcSeedPolicyHint';seedHint.className='hint pc-seed-policy-hint';seedHint.textContent='New images requested through AI chat skip seeds already used for this project and model. The actual seed is recorded with the result.';
    let seedPresentation=null;
    function syncNativeSeedHint(summary){
      if(desktopBinding&&summary.mode==='txt2img'){
        if(seedPresentation)return;
        seedPresentation={html:seedLabel.innerHTML,describedBy:seedInput.getAttribute('aria-describedby')};seedLabel.textContent='Base seed';seedInput.closest('.field').append(seedHint);
        seedInput.setAttribute('aria-describedby',[...new Set([...(seedPresentation.describedBy||'').split(/\s+/).filter(Boolean),seedHint.id])].join(' '));
      }else if(seedPresentation){
        seedLabel.innerHTML=seedPresentation.html;if(seedPresentation.describedBy===null)seedInput.removeAttribute('aria-describedby');else seedInput.setAttribute('aria-describedby',seedPresentation.describedBy);seedHint.remove();seedPresentation=null;
      }
    }

    const projectName=originalHeader.querySelector('.project-name');environmentSettings.prepend(projectName);
    const prompt=$('prompt');prompt.placeholder='Describe the image you want…';prompt.rows=1;prompt.setAttribute('aria-label','Image description');
    // The original field remains the model/document boundary. Its appended
    // style instruction is represented by the style control, not editable UI.
    const editor=doc.createElement('textarea');editor.id='pcPrompt';editor.rows=1;editor.maxLength=4000;editor.placeholder=prompt.placeholder;editor.setAttribute('aria-label','Image description');
    prompt.hidden=true;
    const workspace=$('workspace');workspace.classList.add('pk-generation-workspace');
    const empty=$('empty');
    if(empty){const illustration=doc.createElement('div');illustration.className='pk-empty-art';illustration.innerHTML=img('pancake-cat','Pancake and cat illustration');empty.prepend(illustration);}
    const categoryRow=doc.createElement('div');categoryRow.className='pk-categories';categoryRow.dataset.pkSettingsSection='model';categoryRow.setAttribute('aria-label','Image styles');
    categoryRow.setAttribute('role','group');categoryRow.setAttribute('aria-labelledby','pcStyleLabel');
    categoryRow.innerHTML='<span class="pc-style-label" id="pcStyleLabel">Style</span>'+categories.map(item=>`<button type="button" class="pk-category ${item.id==='character'?'selected':''}" data-pk-category="${item.id}" aria-label="${item.label}" title="${item.id==='chibi'?'A character style with a large head and small body':item.label+' style is added to the image description'}" aria-pressed="${item.id==='character'}">${img(item.asset)}<span>${item.label}</span></button>`).join('');
    const composer=doc.createElement('div');composer.className='pk-composer-dock';
    composer.innerHTML=`<form class="pk-composer" id="pkPromptForm"><label class="pc-prompt-label" for="prompt">Image description</label><div class="pk-prompt-slot"></div><div class="pc-composer-bar"><div class="pc-composer-tools">${button('Attach source image','paperclip','data-pk-action="reference"','pc-tool-button')}<button type="button" class="pc-setting-button" data-pk-action="settings" data-pk-setting-target="imageModel" aria-label="Image model settings"><span id="pcModelName">Checking model</span>${icon('chevron-down')}</button><button type="button" class="pc-setting-button" id="pcResolution" data-pk-action="settings" data-pk-setting-target="width" aria-label="Image size settings"></button>${button('Open generation options','sliders-horizontal','data-pk-action="settings"','pc-tool-button')}</div><div class="pc-send-tools"><span class="pc-key-hint"><kbd>Enter</kbd> Generate · <kbd>Shift Enter</kbd> New line</span><button type="submit" id="pkGenerate" class="pk-send" aria-label="Generate image">${icon('send-horizontal')}</button></div></div></form><div class="pk-composer-meta"><span id="pkModelHint">Checking image model</span><span id="pkComposerStatus" role="status" aria-live="polite"></span><button type="button" data-pk-action="gallery" id="pkGalleryOpen">0 candidates</button><button type="button" id="pkCancel" hidden>Cancel generation</button></div>`;
    composer.querySelector('label[for=prompt]').htmlFor='pcPrompt';
    const homeAttachIcon=doc.createElement('span');homeAttachIcon.className='pc-home-attach-icon';homeAttachIcon.setAttribute('aria-hidden','true');homeAttachIcon.innerHTML=icon('plus');composer.querySelector('[data-pk-action="reference"]').append(homeAttachIcon);
    const homeAISettings=doc.createElement('button');homeAISettings.type='button';homeAISettings.className='pc-home-ai-settings';homeAISettings.dataset.pkAction='settings';homeAISettings.dataset.pkSettingTarget='imageModel';homeAISettings.setAttribute('aria-label','Generation settings');homeAISettings.title='Generation settings';homeAISettings.innerHTML=icon('sparkles');composer.querySelector('.pc-send-tools').prepend(homeAISettings);
    categoryRow.querySelector('#pcStyleLabel').tabIndex=-1;
    const styleDialog=doc.createElement('dialog');styleDialog.id='pcStyleDialog';styleDialog.className='pc-style-dialog';styleDialog.setAttribute('aria-labelledby','pcStyleDialogTitle');styleDialog.innerHTML=`<header><h2 id="pcStyleDialogTitle">Style</h2>${button('Close style picker','x','data-pc-style-close')}</header><div class="pc-style-dialog-content"></div><footer><button type="button" data-pc-style-close>Done</button></footer>`;doc.body.append(styleDialog);
    const homeToolbar=doc.createElement('div');homeToolbar.className='pc-home-toolbar';homeToolbar.setAttribute('role','group');homeToolbar.setAttribute('aria-label','Home request tools');homeToolbar.innerHTML=`<button type="button" data-pk-action="reference">${icon('image')}<span>Reference image</span></button><button type="button" id="pcHomeStyle" data-pk-action="style" aria-controls="pcStyleDialog" aria-haspopup="dialog" aria-expanded="false" aria-label="Image style settings">${icon('brush')}<span>Style</span></button><button type="button" id="pcHomeRatio" data-pk-action="settings" data-pk-setting-target="width" aria-label="Aspect ratio and image size">${icon('grid-2x2')}<span>Aspect ratio</span>${icon('chevron-down')}</button>`;const homeOptionsTrigger=doc.createElement('button');homeOptionsTrigger.type='button';homeOptionsTrigger.id='pcHomeOptions';homeOptionsTrigger.className='pc-tool-button pc-home-options-trigger';homeOptionsTrigger.setAttribute('aria-label','Request settings');homeOptionsTrigger.title='Request settings';homeOptionsTrigger.setAttribute('aria-controls','pcHomeOptionsPanel');homeOptionsTrigger.setAttribute('aria-expanded','false');homeOptionsTrigger.setAttribute('aria-haspopup','dialog');homeOptionsTrigger.innerHTML=icon('sliders-horizontal');composer.querySelector('.pc-composer-tools').append(homeOptionsTrigger);
    const homeOptions=doc.createElement('div');homeOptions.id='pcHomeOptionsPanel';homeOptions.className='pc-home-options';homeOptions.hidden=true;homeOptions.setAttribute('role','dialog');homeOptions.setAttribute('aria-label','Request settings');homeOptions.innerHTML=`<div class="pc-home-options-heading"><strong>Request settings</strong>${button('Close request settings','x','data-pc-home-options-close')}</div>`;homeOptions.append(home.querySelector('.pc-home-composer-context'),homeToolbar);const moreOptions=doc.createElement('button');moreOptions.type='button';moreOptions.className='pc-home-more-options';moreOptions.dataset.pkAction='settings';moreOptions.innerHTML=icon('settings')+'<span>All generation settings</span>';homeOptions.append(moreOptions);composer.querySelector('#pkPromptForm').append(homeOptions);
    function closeHomeOptions(restoreFocus=false){if(homeOptions.hidden)return;homeOptions.hidden=true;homeOptions.style.maxHeight='';homeOptionsTrigger.setAttribute('aria-expanded','false');if(restoreFocus&&doc.body.contains(homeOptionsTrigger))homeOptionsTrigger.focus({preventScroll:true});}
    function toggleHomeOptions(){
      if(!homeOptions.hidden){closeHomeOptions(true);return;}
      homeOptions.hidden=false;homeOptionsTrigger.setAttribute('aria-expanded','true');homeOptions.classList.remove('pc-home-options-up');homeOptions.style.maxHeight='';
      const anchor=$('pkPromptForm').getBoundingClientRect(),viewport=root.innerHeight||doc.documentElement.clientHeight;
      if(Number.isFinite(viewport)&&viewport>24){
        const below=Math.max(0,viewport-12-anchor.bottom-10),above=Math.max(0,anchor.top-10-12),up=above>below;
        homeOptions.classList.toggle('pc-home-options-up',up);homeOptions.style.maxHeight=Math.min(360,up?above:below)+'px';
      }
      const first=Array.from(homeOptions.querySelectorAll('button')).find(node=>!node.hidden&&!node.disabled);first?.focus({preventScroll:true});
    }
    homeOptionsTrigger.addEventListener('click',()=>toggleHomeOptions());
    const composerTarget=doc.createElement('button');composerTarget.type='button';composerTarget.id='pcComposerTarget';composerTarget.className='pc-composer-target';composerTarget.hidden=true;composerTarget.innerHTML='<img alt=""><span></span>';composer.prepend(composerTarget);
    const editContext=doc.createElement('div');editContext.className='pc-edit-context';editContext.dataset.pkSettingsSection='edit';editContext.append($('inpaintOperations'));composer.prepend(editContext);
    const operationSelect=composer.querySelector('#editOperation'),operationCaption=doc.createElement('span');
    operationCaption.textContent='Edit method';
    operationSelect.closest('label').replaceChildren(operationCaption,operationSelect);
    const composerAnchor=doc.createElement('span');composerAnchor.id='pcComposerAnchor';composerAnchor.hidden=true;
    composer.querySelector('.pk-prompt-slot').append(composerTarget,prompt,editor);shell.append(categoryRow,composerAnchor,composer);
    const homeShortcuts=doc.createElement('div');homeShortcuts.className='pc-home-shortcuts';homeShortcuts.hidden=true;homeShortcuts.setAttribute('role','group');homeShortcuts.setAttribute('aria-label','Workspace shortcuts and project files');homeShortcuts.innerHTML=`<span class="pc-home-shortcuts-label">Workspace shortcuts</span><button type="button" data-pk-action="generate" aria-label="Go to image generation" title="Go to image generation">${icon('image')}Generate images</button><button type="button" data-pk-route="inpaint" aria-label="Go to image editing" title="Go to image editing">${icon('pencil')}Image editing</button><button type="button" data-pk-route="parts" aria-label="Go to parts preparation" title="Go to parts preparation">${icon('layers')}Parts preparation</button><button type="button" data-pk-action="import" aria-label="Open a saved project file" title="Open a saved project file">${icon('folder-open')}Open project</button>`;composer.querySelector('.pc-composer-tools').append(homeShortcuts);
    const thread=doc.createElement('main');thread.id='pcConversation';thread.tabIndex=-1;thread.className='pc-thread';thread.setAttribute('aria-label','Image generation conversation');
    thread.innerHTML=`<div class="pc-thread-inner"><div class="pc-welcome">${img('pancake-cat','')}<h2>What would you like to create?</h2><p>Enter a description or add a reference image.</p><div class="pc-template-starts"><button type="button" class="pc-template-start" data-pk-action="prompts">Prompt ideas ${icon('arrow-right')}</button><button type="button" class="pc-template-start" data-pk-action="templates">Template ${icon('arrow-right')}</button></div></div><div class="pc-history" role="log" aria-label="Saved generation history" aria-live="polite" aria-relevant="additions"></div><div class="pc-pending" hidden><div class="pc-message-author"><img src="${originalLogo.src}" alt=""><strong>Pankeki</strong></div><p role="status">Creating an image…</p></div></div>`;
    shell.prepend(thread);
    shell.classList.add('pc-image-workspace','pc-spacious-workspace');shell.dataset.pcPane='conversation';shell.dataset.pcViewer='closed';
    const paneSwitcher=doc.createElement('div');paneSwitcher.className='pc-pane-switcher';paneSwitcher.setAttribute('aria-label','Switch workspace view');
    paneSwitcher.innerHTML='<button type="button" id="pcShowConversation" aria-controls="pcConversation" aria-pressed="true">Conversation</button><button type="button" id="pcShowCanvas" aria-controls="workspace" aria-pressed="false">Image canvas</button>';shell.prepend(paneSwitcher);
    const canvasHeader=doc.createElement('div');canvasHeader.className='pc-canvas-header';
    canvasHeader.innerHTML=`<div class="pc-canvas-heading"><h2 id="pcCanvasTitle">Image canvas</h2><p id="pcCanvasInfo"></p></div><div class="pc-canvas-controls" role="group" aria-label="Image view controls"><button type="button" id="pcCanvasFit" aria-pressed="true">Fit to view</button><button type="button" id="pcCanvasActual" aria-label="Actual pixels, 100%" aria-pressed="false">100%</button><button type="button" id="pcCanvasZoomOut" aria-label="Zoom out">Zoom out</button><output id="pcCanvasScale" aria-label="Image zoom level"></output><button type="button" id="pcCanvasZoomIn" aria-label="Zoom in">Zoom in</button><a id="pcCanvasSave" aria-label="Save selected image" aria-disabled="true">${icon('download')}Save</a><button type="button" id="pcCanvasClose" aria-label="Close image viewer">${icon('x')}Close</button></div><p id="pcCanvasStatus" role="status" aria-live="polite"></p>`;
    workspace.prepend(canvasHeader);workspace.setAttribute('aria-labelledby','pcCanvasTitle');workspace.dataset.candidateId='';
    const canvasActions=doc.createElement('div');canvasActions.className='pc-canvas-actions';canvasActions.innerHTML=`<button type="button" id="pcCanvasEdit">${icon('pencil')}Image edit</button>`;workspace.append(canvasActions);
    const viewport=$('canvasViewport');viewport.tabIndex=0;viewport.setAttribute('role','region');viewport.setAttribute('aria-label','Image canvas. Scroll to pan when zoomed in.');viewport.dataset.pcZoom='fit';
    const viewerImage=doc.createElement('img');viewerImage.id='pcViewerImage';viewerImage.className='pc-viewer-image';viewerImage.hidden=true;viewerImage.alt='';viewport.append(viewerImage);
    const canvasOverlay=doc.createElement('div');canvasOverlay.className='pc-canvas-overlay';canvasOverlay.setAttribute('aria-label','Canvas tools');canvasOverlay.hidden=true;
    const canvasPrimary=doc.createElement('div');canvasPrimary.className='pc-canvas-primary-actions';canvasPrimary.append($('pcCanvasSave'),$('pcCanvasClose'));canvasHeader.append(canvasPrimary);
    canvasOverlay.append(canvasHeader.querySelector('.pc-canvas-controls'),canvasActions,$('editorTools'));viewport.closest('.canvas-card').append(canvasOverlay);
    const candidateStrip=doc.createElement('div');candidateStrip.className='pc-candidate-strip';candidateStrip.setAttribute('role','group');candidateStrip.setAttribute('aria-label','Saved image candidates, select to view');candidateStrip.hidden=true;viewport.closest('.canvas-card').append(candidateStrip);
    const photoControls=doc.createElement('div');photoControls.id='pcPhotoTools';photoControls.className='pc-photo-tools-host';photoControls.hidden=true;viewport.closest('.canvas-card').append(photoControls);
    const pinContext=doc.createElement('div');pinContext.id='pcPinContext';pinContext.className='pc-pin-context';pinContext.hidden=true;const pinContextText=doc.createElement('span'),pinClear=doc.createElement('button');pinClear.id='pcPinClear';pinClear.type='button';pinClear.textContent='Clear pin selection';pinContext.append(pinContextText,pinClear);composer.prepend(pinContext);
    let pinModeActive=false,pinSelection=null;
    function setPinMode(active){
      if(active===pinModeActive)return;
      pinModeActive=active;pinContext.hidden=!active;
      if(active)pinContextText.textContent='Choose a pin position and edit area on the image.';
      else {
        if(pinSelection&&studio.desktopChat.getState().projectId===pinSelection.projectId&&editor.value===pinSelection.insertedText){editor.value=pinSelection.priorText;editor.dispatchEvent(new root.Event('input',{bubbles:true}));}
        pinSelection=null;
      }
    }
    pinClear.addEventListener('click',()=>{void photoEditor?.cancel();});
    const sourceViews=$('sourceView').closest('.view-tabs'),sourceViewsHome=sourceViews.parentNode;
    const nativeToolPresentation=[$('brushTool'),$('eraserTool'),$('clearMask'),$('editorTools').querySelector('label[for="maskUpload"]')].map(node=>({node,html:node.innerHTML,label:node.getAttribute('aria-label'),title:node.getAttribute('title')}));
    if(empty){const copy=doc.createElement('div');copy.className='pc-workspace-empty-copy';copy.innerHTML='<h2>Select an image to view it here.</h2><p>Create an image on the left or select an existing candidate.</p>';empty.append(copy);}
    let workspaceEntries=[],viewerId=null,viewerTrigger=null,editorOpen=false,workEntry=null,workImage=null,workKey='',workUrl='',zoomMode='fit',zoomPercent=100,fitScale=1,canvasLoadError=false,composerComposing=false,queuedRoute=null;
    let photoEditor=null,photoMounting=false,photoState=null,photoStateKey='',photoOwner=null,viewerEpoch=0;
    function syncPresentation(){const open=editorOpen&&['design','inpaint'].includes(doc.body.dataset.studioScreen);shell.dataset.pcEditor=open?'open':'closed';doc.body.classList.toggle('pc-reference-open',!!desktopBinding&&open);}
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
      $('pcCanvasScale').textContent=width&&height?(zoomMode==='fit'?(desktopBinding?'':'Fit · ')+Math.round(fitScale*100)+'%':zoomPercent+'%'):'';
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
      $('pcCanvasTitle').textContent=desktopBinding?'Image editing':displayEntry?.label||'Image canvas';
      const model=({'sdxl-base':'SDXL Base','sd-turbo':'SD Turbo','sdxl-inpaint-v01':'SDXL Inpaint v0.1','animagine-xl-4.0-opt':'Animagine XL 4.0 Opt'})[displayEntry?.model]||displayEntry?.model||'';
      $('pcCanvasInfo').textContent=[desktopBinding?displayEntry?.label:null,paintEntry?'Edit mask':displayEntry?.operationLabel||model,paintEntry?`${$('source').width} × ${$('source').height}`:ready?`${workImage.naturalWidth} × ${workImage.naturalHeight}`:''].filter(Boolean).join(' · ');$('pcCanvasInfo').title=$('pcCanvasInfo').textContent;
      const currentAI=desktopBinding&&aiState?.projectId===studio.desktopChat?.getState().projectId?aiState:null,active=!!currentAI?.activeRequestId||summary.busy;
      const imageForTurn=ready&&currentAI?.messages.some(message=>message.requestId===currentAI.activeRequestId&&message.candidateIds?.includes(workEntry.id));
      $('pcCanvasStatus').textContent=canvasLoadError?'Could not load this image. Select another candidate.':currentAI&&['error','limited'].includes(currentAI.phase)?currentAI.notice:imageForTurn?'Image ready · AI reply in progress':active?(currentAI?.notice||$('status').textContent):paintEntry?'You can paint the edit mask.':finalImage?(ready?'Image ready':'Loading image…'):'The result image will appear here.';
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
      if(item){composerTarget.querySelector('img').src=item.image;const label=(aiState?.activeRequestId?'Submitted image · ':'Selected image · ')+item.label;composerTarget.querySelector('span').textContent=label;composerTarget.setAttribute('aria-label',label+' view');composerTarget.title=label+' view';}
    }
    function syncCanvasTools(){const screen=doc.body.dataset.studioScreen,legacyMask=!!desktopBinding&&editorOpen&&!viewerId&&screen==='inpaint'&&!$('editor').hidden;canvasOverlay.hidden=desktopBinding?!legacyMask:screen==='design'?!viewerId:screen==='inpaint'?!viewerId&&$('editor').hidden:true;doc.body.classList.toggle('pc-legacy-mask',legacyMask);photoControls.hidden=!desktopBinding||!editorOpen;if(desktopBinding){$('editorTools').hidden=!legacyMask;canvasActions.hidden=true;}}
    function photoBusy(){const core=studio.photoTools?.getState();return !!core?.active||!!photoState?.active||!!photoState?.starting||!!photoState?.applying||!!photoState?.cancelling;}
    function mountPhotoEditor(){
      if(photoEditor||photoMounting||!desktopBinding||!root.PankekiPhotoEditor||!studio.photoTools)return;
      const core=studio.photoTools,externalLocked=()=>desktopBinding?.isConversationLocked?.()===true;
      const photoCore={getState:()=>{const state=core.getState();return {...state,locked:state.locked===true||externalLocked()};},begin:(...args)=>{if(externalLocked())throw Error('Wait for the current request before editing the image.');return core.begin(...args);},apply:(...args)=>{if(externalLocked())throw Error('Wait for the current request before applying changes.');return core.apply(...args);},preparePinnedEdit:(...args)=>{if(externalLocked())throw Error('Wait for the current request before preparing a pin.');return core.preparePinnedEdit(...args);},cancel:core.cancel.bind(core),listComments:core.listComments.bind(core),saveComment:core.saveComment.bind(core),deleteComment:core.deleteComment.bind(core)};
      photoMounting=true;try{photoEditor=root.PankekiPhotoEditor.mount({stage:viewport,image:viewerImage,controls:photoControls,core:photoCore,
        getCandidateId:()=>visibleEntry()?.id||null,getImage:()=>workImage,getSourceRevision:()=>studio.desktopChat.getState().sourceRevision,
        beforeOpen:(_tool,id)=>{if(visibleEntry()?.id!==id)throw Error('Check the selected image again.');if(viewerId!==id)activateCandidate(id,doc.activeElement,false);photoOwner={projectId:studio.desktopChat.getState().projectId,candidateId:id,epoch:viewerEpoch};},
        onPinModeChange:setPinMode,
        beforePinnedEdit:selection=>{if(selection.text&&editor.value.length+selection.text.length+2>4000)throw Error('Keep the note and message within 4,000 characters combined.');},
        onPinnedEdit:selection=>{
          if(visibleEntry()?.id!==selection.candidateId)return;
          const priorText=pinSelection&&editor.value===pinSelection.insertedText?pinSelection.priorText:editor.value,note=selection.text.trim(),insertedText=note?[priorText,note].filter(Boolean).join('\n\n'):priorText;
          pinSelection={...selection,projectId:studio.desktopChat.getState().projectId,priorText,insertedText};setPinMode(true);
          pinContextText.textContent=`Area around pin · Radius ${Math.round(selection.radius*100)}%${note?' · Note: '+note:''}`;pinContextText.title=pinContextText.textContent;
          editor.value=insertedText;editor.dispatchEvent(new root.Event('input',{bubbles:true}));editor.focus();fitPrompt();
        },
        onLockChange:(_locked,state)=>{const key=JSON.stringify(state);photoState=state;if(key!==photoStateKey){photoStateKey=key;desktopBinding?.refresh?.();}},
        onApplied:result=>{const owner=photoOwner;photoOwner=null;const summary=studio.getSummary();renderConversation(summary);if(owner&&editorOpen&&viewerEpoch===owner.epoch&&viewerId===owner.candidateId&&studio.desktopChat.getState().projectId===owner.projectId&&workspaceEntries.some(item=>item.id===result.candidateId&&item.image===result.image))activateCandidate(result.candidateId,viewerTrigger,false);},
        onError:message=>{$('pcCanvasStatus').textContent=message;}});}finally{photoMounting=false;}
    }
    function editLocked(){return studio.getSummary().busy||!!desktopBinding&&desktopBinding.isLocked?.()!==false;}
    function syncEditLocks(){const locked=editLocked();$('pcCanvasEdit').disabled=!workspace.dataset.candidateId||locked;if(desktopBinding)for(const id of ['sourceView','resultView'])$(id).disabled=locked;for(const node of history?.querySelectorAll('[data-pc-action="edit"]')||[])node.disabled=locked;for(const node of $('gallery').querySelectorAll('[data-action="edit"]'))node.disabled=locked;}
    function beginCandidateEdit(id){if(editLocked())return;const sameSource=desktopBinding&&studio.desktopChat.getState().sourceCandidateId===id;if(viewerId)closeViewer();editorOpen=true;if(sameSource){$('sourceView').click();go('inpaint');}else candidateControl(id,'edit')?.click();updateWorkspace(studio.getSummary());}
    function revealCandidate(id){
      const thumb=Array.from(candidateStrip.querySelectorAll('button')).find(node=>node.dataset.pcCandidate===id);if(!thumb||!candidateStrip.clientWidth)return;
      const bounds=candidateStrip.getBoundingClientRect(),rect=thumb.getBoundingClientRect(),left=bounds.left+(candidateStrip.clientLeft||0),right=left+candidateStrip.clientWidth;
      const delta=rect.left<left?rect.left-left:rect.right>right?rect.right-right:0;
      if(delta)candidateStrip.scrollLeft=Math.max(0,Math.min(candidateStrip.scrollWidth-candidateStrip.clientWidth,(candidateStrip.scrollLeft||0)+delta));
    }
    function activateCandidate(id,trigger,focus=true){if(!workspaceEntries.some(item=>item.id===id))return;if(pinModeActive&&viewerId!==id){setPinMode(false);void photoEditor?.cancel();}const screen=workflow.getScreen();if(screen!=='design'&&(!desktopBinding||screen!=='inpaint'))go(screen==='home'&&desktopBinding&&studio.getSummary().mode==='inpaint'?'inpaint':'design');viewerEpoch++;viewerId=id;viewerTrigger=trigger;editorOpen=true;shell.dataset.pcViewer='open';showPane('canvas',focus);updateWorkspace(studio.getSummary());revealCandidate(id);}
    $('pcShowConversation').addEventListener('click',()=>showPane('conversation'));$('pcShowCanvas').addEventListener('click',()=>{editorOpen=true;updateWorkspace(studio.getSummary());showPane('canvas');});
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
      for(const [epoch,turn]of targets){let node=contextMarkers.get(epoch);if(!node){node=doc.createElement('p');node.className='pc-context-boundary';node.dataset.pcContextBoundary='';node.dataset.pcContextEpoch=String(epoch);node.textContent='New AI context';contextMarkers.set(epoch,node);}if(turn){if(node.nextSibling!==turn)history.insertBefore(node,turn);}else if(node!==history.lastChild)history.append(node);}
    }
    history.addEventListener('click',async event=>{
      const button=event.target.closest('[data-pc-copy-reply],[data-pc-reinput]');if(!button)return;event.preventDefault();event.stopPropagation();
      const turn=button.closest('.pc-ai-turn'),requestId=turn?.dataset.requestId,state=aiState;
      if(!desktopBinding||!turn||!state||aiTurns.get(requestId)!==turn||turn.dataset.projectId!==state.projectId)return;
      if(button.hasAttribute('data-pc-copy-reply')){
        const reply=state.messages.find(message=>message.requestId===requestId&&message.role==='assistant');if(!reply?.text||button.disabled)return;
        const owner=state.projectId;button.disabled=true;button.dataset.copying='true';messageFeedback(turn,'Copying reply…');
        try{if(typeof root.navigator?.clipboard?.writeText!=='function')throw Error('clipboard-unavailable');await root.navigator.clipboard.writeText(reply.text);if(aiState?.projectId===owner&&aiTurns.get(requestId)===turn)messageFeedback(turn,'Reply copied.');}
        catch{if(aiState?.projectId===owner&&aiTurns.get(requestId)===turn)messageFeedback(turn,'Could not copy the reply. Try again.',true);}
        finally{delete button.dataset.copying;button.disabled=false;}
        return;
      }
      const failure=state.lastFailure,user=state.messages.find(message=>message.requestId===requestId&&message.role==='user');
      if(!failure||failure.requestId!==requestId||!user||!['error','limited'].includes(state.phase)||(user.contextEpoch||0)!==(state.contextEpoch||0)){messageFeedback(turn,'This is an earlier request. Your current input was preserved.',true);return;}
      if(composerComposing||desktopBinding.isLocked?.()||state.activeRequestId||state.canceling){messageFeedback(turn,'Finish the current work or IME composition before restoring the input.',true);return;}
      const text=failure.text;
      if(typeof text!=='string'||!text)return;
      if(editor.value!==''&&editor.value!==text){messageFeedback(turn,'Check your current draft first. Your input was preserved.',true);return;}
      if(editor.value!==text){editor.value=text;editor.setSelectionRange(text.length,text.length);editor.dispatchEvent(new root.Event('input',{bubbles:true}));}
      fitPrompt();editor.focus();messageFeedback(turn,'The request was restored to the input. Review it before sending.');
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
        const thumb=doc.createElement('button');thumb.type='button';thumb.dataset.pcCandidate=item.id;thumb.setAttribute('aria-label',item.label+' view');thumb.setAttribute('aria-pressed','false');const thumbnail=doc.createElement('img');thumbnail.src=item.image;thumbnail.alt='';thumbnail.loading='lazy';const caption=doc.createElement('span');caption.textContent=item.label;thumb.append(thumbnail,caption);candidateStrip.append(thumb);
        const turn=doc.createElement('article');turn.className='pc-turn';turn.dataset.candidateId=item.id;
        if(item.prompt){const request=doc.createElement('div');request.className='pc-request';const name=doc.createElement('span');name.textContent='You';const text=doc.createElement('p');text.textContent=item.prompt;request.append(name,text);turn.append(request);}
        const response=doc.createElement('div');response.className='pc-response'+(item.kind==='upload'?' pc-reference':'');
        response.innerHTML=`<div class="pc-message-author"><img src="${originalLogo.src}" alt=""><strong>${item.kind==='upload'?'Reference image':'Pankeki'}</strong><span>${item.kind==='upload'?'Imported source':item.operation==='recolor'?esc(item.skipped?'Recolor · No change':`Recolor · ${item.targetColor}`):esc([item.operationLabel||({'sdxl-base':'SDXL Base','animagine-xl-4.0-opt':'Animagine XL 4.0 Opt'})[item.model]||item.model,item.width&&item.height?`${item.width} × ${item.height}`:''].filter(Boolean).join(' · '))}</span></div>`;
        const figure=doc.createElement('figure');figure.className='pc-image-frame';
        const open=doc.createElement('button');open.type='button';open.className='pc-image-open';open.dataset.pcCandidate=item.id;open.dataset.pcAction='view';open.setAttribute('aria-label',`Candidate ${item.ordinal} · View ${item.label}`);
        const picture=doc.createElement('img');picture.src=item.image;picture.alt=item.kind==='upload'?'Imported reference image':item.label+' · Generated image';picture.decoding='async';picture.loading='lazy';
        const metadata=response.querySelector('.pc-message-author>span')||response.querySelector('.pc-message-author span');
        const modelLabel=item.operationLabel||({'sdxl-base':'SDXL Base','sd-turbo':'SD Turbo','sdxl-inpaint-v01':'SDXL Inpaint v0.1','animagine-xl-4.0-opt':'Animagine XL 4.0 Opt'})[item.model]||item.model;
        function imageMetadata(){const width=picture.naturalWidth,height=picture.naturalHeight;const size=width>0&&height>0?`${width} × ${height}`:'';metadata.textContent=[item.kind==='upload'?'Imported source':item.operation==='recolor'?item.skipped?'Recolor · No change':`Recolor · ${item.targetColor}`:modelLabel,size].filter(Boolean).join(' · ');}
        imageMetadata();picture.addEventListener('load',()=>{imageMetadata();if(followLatest)revealLatest();});open.append(picture);figure.append(open);
        const actions=doc.createElement('div');actions.className='pc-image-actions pc-image-overlay';actions.setAttribute('role','group');actions.setAttribute('aria-label','Image actions');
        actions.innerHTML=`<button type="button" data-pc-action="edit" data-pc-candidate="${esc(item.id)}" aria-label="Image editing" title="Image editing">${icon('pencil')}Edit</button>`;
        const save=doc.createElement('a');save.href=item.image;save.download=imageFilename(item);save.innerHTML=icon('download');save.setAttribute('aria-label','Save image');save.title='Save image';save.addEventListener('click',event=>{event.stopPropagation();return studio.downloadImage(event);});actions.append(save);
        figure.append(actions);response.append(figure);turn.append(response);history.append(turn);
      }
      historyIds=entries.map(item=>item.id);historyCount=entries.length;
      thread.querySelector('.pc-welcome').hidden=entries.length>0;
      if(desktopBinding&&aiState&&aiState.projectId===studio.desktopChat.getState().projectId)renderAI(aiState);
      if(atEnd){followLatest=true;revealLatest();}
    }
    function renderAI(state){
      if(aiState?.activeRequestId&&!state.activeRequestId&&['done','error','limited','canceled','needs-input'].includes(state.phase))recordNotification('ai:'+aiState.activeRequestId,state.phase==='done'?'AI request completed':state.phase==='canceled'?'AI request canceled':'Review AI request',state.notice,['error','limited','needs-input'].includes(state.phase));
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
          turn.innerHTML='<div class="pc-request"><span>You</span><p></p></div><div class="pc-response"><div class="pc-message-author"><strong></strong></div><div class="desktop-chat-reply"></div><div class="pc-message-actions"><button type="button" data-pc-copy-reply hidden>Copy reply</button><button type="button" data-pc-reinput hidden>Restore input</button><span data-pc-message-feedback role="status" aria-live="polite"></span></div><div class="pc-ai-results"></div></div>';
          history.append(turn);aiTurns.set(message.requestId,turn);}
        turn.dataset.projectId=state.projectId;
        if(message.role==='user')turn.querySelector('.pc-request p').textContent=message.text;
        else {
          turn.querySelector('.pc-message-author strong').textContent=[message.provider||'AI',message.modelLabel].filter(Boolean).join(' · ');
          // An image result speaks for itself: show only the Pankeki card, not the chat model's header and reply.
          // While an image request runs, hide it too; a failure clears activeRequestId so its explanation shows.
          const imageOnly=(message.candidateIds||[]).length>0||state.activeRequestId===message.requestId&&['generate','edit'].includes(state.resolvedIntent);turn.classList.toggle('pc-ai-image-only',imageOnly);turn.querySelector('.pc-message-author').hidden=imageOnly;
          const reply=turn.querySelector('.desktop-chat-reply');reply.hidden=imageOnly;if(reply.dataset.rendered!==message.text){reply.dataset.rendered=message.text;desktopBinding.renderMarkdown(doc,reply,message.text);}
          for(const id of message.candidateIds||[]){const card=Array.from(history.querySelectorAll('.pc-turn')).find(node=>node.dataset.candidateId===id);if(card){const request=card.querySelector('.pc-request');if(request)request.hidden=true;const results=turn.querySelector('.pc-ai-results');if(card.parentNode!==results)results.append(card);}}
        }
      }
      for(const [requestId,turn]of aiTurns){const reply=state.messages.find(message=>message.requestId===requestId&&message.role==='assistant'),user=state.messages.find(message=>message.requestId===requestId&&message.role==='user'),copy=turn.querySelector('[data-pc-copy-reply]'),reinput=turn.querySelector('[data-pc-reinput]');copy.hidden=!reply?.text||turn.classList.contains('pc-ai-image-only');copy.disabled=copy.dataset.copying==='true';reinput.hidden=state.lastFailure?.requestId!==requestId||!['error','limited'].includes(state.phase)||(user?.contextEpoch||0)!==(state.contextEpoch||0);}
      renderContextBoundaries(state);fitPrompt();
      thread.dataset.hasChat=String(state.messages.length>0);thread.setAttribute('aria-busy',String(!!state.activeRequestId||state.canceling===true));
      thread.querySelector('.pc-welcome').hidden=historyIds.length>0||state.messages.length>0;
      const pending=thread.querySelector('.pc-pending');pending.hidden=!state.activeRequestId&&!state.canceling;pending.querySelector('p').textContent=state.canceling?'Checking cancellation…':state.notice;
      if(atEnd&&followLatest)revealLatest();
      updateWorkspace(studio.getSummary());
    }
    function plainHomeGenerationTarget(){return !desktopBinding&&doc.body.dataset.studioScreen==='home'&&!!projectLibrary;}
    function plainHomePendingConfiguration(){return plainHomeGenerationTarget()&&(projectState?.activeKind==='project'||studio.getSummary().mode==='inpaint');}
    function syncHomeModelSummary(){
      const chat=$('pcHomeChatModel'),image=$('pcHomeImageModel'),size=$('pcHomeImageSize'),state=aiState,images=studio.getImageModelSettings?.(),editing=!desktopBinding&&studio.getSummary().mode==='inpaint',target=plainHomeGenerationTarget(),pending=plainHomePendingConfiguration(),imageState=images?.[editing&&!target?'edit':'generation'];
      chat.hidden=!desktopBinding;
      if(desktopBinding){const provider=state?.codex.provider==='claude'?'Claude':state?.codex.provider==='codex'?'Codex':null,model=state?.modelOptions.options.find(item=>item.id===state.codex.modelId)?.displayName||state?.codex.modelId||'Checking model';chat.textContent=provider?`${provider} · ${model}`:'Checking AI model';chat.title=chat.textContent;chat.setAttribute('aria-label','AI chat model: '+chat.textContent);}
      const selected=$('imageModel').selectedOptions?.[0],label=(!desktopBinding&&!target&&selected?.textContent)||imageState?.models?.find(item=>item.id===imageState.selectedId)?.label||imageState?.selectedId||'Checking model';
      image.textContent='Image · '+label;image.title=image.textContent;image.dataset.pkSettingTarget=desktopBinding?'desktopGenerationModel':'imageModel';image.setAttribute('aria-label',(editing&&!target?'Image edit':'Generate images')+' model settings: '+label);image.hidden=pending;image.disabled=pending;
      $('pcHomeStyle').title='Image style: '+(desktopBinding?categories.find(item=>item.id===aiCategory)?.label||'None':categories.find(item=>item.id===category)?.label||'Style');
      for(const control of [$('pcHomeStyle'),$('pcHomeRatio'),size]){control.hidden=editing||pending;control.disabled=editing||pending;}
      const sourceSize=$('pcHomeSourceSize'),summary=studio.getSummary(),source=$('source');sourceSize.hidden=!editing||target;sourceSize.textContent=summary.sourceLoaded&&source.width>0&&source.height>0?`Source ${source.width} × ${source.height}`:'No source image';sourceSize.setAttribute('aria-label','Edit source size: '+sourceSize.textContent);
      const width=Number($('width').value),height=Number($('height').value);size.textContent=Number.isSafeInteger(width)&&width>0&&Number.isSafeInteger(height)&&height>0?`${width} × ${height}`:'Check image size';size.title='Image size: '+size.textContent;size.setAttribute('aria-label',size.title);$('pcHomeRatio').title='Aspect ratio and image size: '+size.textContent;$('pcHomeRatio').setAttribute('aria-label',$('pcHomeRatio').title);
      $('pcHomeTargetNote').hidden=!pending;
      if(target){editContext.hidden=true;composer.classList.remove('pc-recolor');composer.querySelector('label[for=pcPrompt]').textContent='New image description';editor.placeholder='Describe the new image you want.';editor.setAttribute('aria-label','New image request');composer.querySelector('.pc-key-hint').innerHTML='<kbd>Enter</kbd> Generate · <kbd>Shift Enter</kbd> New line';$('pkGenerate').innerHTML=icon('send-horizontal')+'<span class="pc-home-send-label">New image request</span>';$('pkGenerate').setAttribute('aria-label',summary.busy?'Creating new image':'Send new image request');}
    }
    function syncComposerFeedback(home){
      if(home)syncHomeModelSummary();
      const state=aiState,summary=studio.getSummary();syncNativeSeedHint(summary);
      const modelControls=$('desktopChatControls');if(modelControls)modelControls.hidden=home;
      const attention=state?state.codex.state!=='ready'||state.codex.toolsReady===false||!!state.activeRequestId||state.canceling||state.modelSaving||['error','limited','needs-input','canceled'].includes(state.phase):summary.busy||$('status').classList.contains('error');
      const show=!!(attention||photoBusy()||projectState?.error||projectState?.recovery||projectTransition());
      $('pkComposerStatus').hidden=home&&!show;composer.classList.toggle('pc-composer-feedback',show);
    }
    const composerView=Object.freeze({
      bind(binding){desktopBinding=binding;$('pkStorageLabel').textContent='Local storage';syncNativeSeedHint(studio.getSummary());homeAISettings.hidden=false;homeAISettings.dataset.pkSettingTarget='desktopChatModel';homeAISettings.setAttribute('aria-label','AI chat model settings');homeAISettings.title='AI chat model settings';editorOpen=false;editor.value='';fitPrompt();doc.body.classList.add('pc-central-chat','pankeki-reference','pankeki-photo-tools');
        const tools=composer.querySelector('.pc-composer-tools');tools.prepend($('desktopChatControls'));tools.setAttribute('role','group');tools.setAttribute('aria-label','Message tools');
        negativeLabel.textContent='Negative prompt · Image generation only';negativeHint.textContent='Not used for current AI image edits. At CFG 1 it also has no effect on image generation.';
        canvasHeader.append(canvasOverlay.querySelector('.pc-canvas-controls'),canvasPrimary);canvasOverlay.classList.add('pc-editor-rail');candidateStrip.hidden=false;
        for(const [id,label] of [['brushTool','Edit mask brush'],['eraserTool','Mask eraser']]){$(id).setAttribute('aria-label',label);$(id).title=label;}
        for(const [id,label] of [['brushTool','Brush'],['eraserTool','Mask eraser']]){const caption=doc.createElement('span');caption.className='pc-tool-caption';caption.textContent=label;$(id).append(caption);}
        $('clearMask').innerHTML=icon('rotate-ccw')+'<span>Reset</span>';$('clearMask').setAttribute('aria-label','Clear edit mask');$('clearMask').title='Clear edit mask · Preserve source image';
        const maskPicker=$('editorTools').querySelector('label[for="maskUpload"]');maskPicker.innerHTML=icon('upload')+'<span>Import</span>';maskPicker.setAttribute('aria-label','Import edit mask');maskPicker.title='Import edit mask';
        $('pcCanvasFit').textContent='Fit';$('pcCanvasZoomOut').textContent='−';$('pcCanvasZoomIn').textContent='+';
        $('pkGenerate').innerHTML=icon('send-horizontal')+'<span>Send</span>';syncPresentation();
        $('desktopModelSettings').querySelector('fieldset').append($('desktopChatConnect'));
        // Keep existing optional generation styles in the existing settings drawer.
        sourceViews.dataset.pkSettingsSection='edit';modelPanel.append(categoryRow,editContext,sourceViews);sourceViews.classList.add('pc-source-views');categoryRow.hidden=false;settingsPanel(drawer.dataset.panel);
        const legacy=chatPanel.querySelector('.chat-composer-area');if(legacy){legacy.hidden=true;legacy.inert=true;}
        const none=doc.createElement('button');none.type='button';none.id='pcNoAIStyle';none.className='pk-category selected';none.textContent='None';none.setAttribute('aria-pressed','true');
        none.addEventListener('click',()=>{aiCategory=null;for(const button of categoryRow.querySelectorAll('button')){const selected=button===none;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));}if(doc.body.dataset.studioScreen==='home')syncHomeModelSummary();});categoryRow.insertBefore?categoryRow.insertBefore(none,categoryRow.children[1]):categoryRow.prepend(none);
        for(const node of categoryRow.querySelectorAll('[data-pk-category]')){node.classList.remove('selected');node.setAttribute('aria-pressed','false');}
        composer.classList.remove('pc-recolor');const label=composer.querySelector('label[for=pcPrompt]');label.textContent='Message';editor.setAttribute('aria-label','Message');editor.placeholder='Enter a message.';
        composer.querySelector('.pc-key-hint').innerHTML='<kbd>Enter</kbd> Send · <kbd>Shift Enter</kbd> New line';
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
      enterConversation(){go(studio.getSummary().mode==='inpaint'?'inpaint':'design');},
      settings,
      unbind(){$('pkStorageLabel').textContent='Browser storage';homeAISettings.hidden=false;homeAISettings.dataset.pkSettingTarget='imageModel';homeAISettings.setAttribute('aria-label','Generation settings');homeAISettings.title='Generation settings';if(styleDialog.open)closeStyleDialog();setPinMode(false);if(viewerId&&doc.body.dataset.studioScreen==='inpaint')closeViewer();desktopBinding=null;syncNativeSeedHint(studio.getSummary());homeAISettings.hidden=false;photoEditor?.destroy();photoEditor=null;photoState=null;photoOwner=null;photoControls.hidden=true;aiState=null;aiTurns.clear();for(const node of contextMarkers.values())node.remove();contextMarkers.clear();doc.body.classList.remove('pc-central-chat','pankeki-reference','pc-reference-open','pc-native-result','pankeki-photo-tools','pc-legacy-mask');negativeLabel.textContent=negativePresentation.label;negativeHint.textContent=negativePresentation.hint;for(const {node,html,label,title} of nativeToolPresentation){node.innerHTML=html;for(const [key,value] of [['aria-label',label],['title',title]])if(value===null)node.removeAttribute(key);else node.setAttribute(key,value);}sourceViewsHome.prepend(sourceViews);sourceViews.classList.remove('pc-source-views');sourceViews.hidden=false;editContext.hidden=false;categoryRow.hidden=false;for(const id of ['sourceView','resultView'])$(id).disabled=false;canvasOverlay.prepend(canvasHeader.querySelector('.pc-canvas-controls'));canvasOverlay.classList.remove('pc-editor-rail');candidateStrip.hidden=true;composerTarget.hidden=true;$('pkGenerate').innerHTML=icon('send-horizontal');$('pcNoAIStyle')?.remove();composer.prepend(editContext);shell.append(categoryRow,composer);const legacy=chatPanel.querySelector('.chat-composer-area');if(legacy){legacy.hidden=false;legacy.inert=false;}refresh(studio.getSummary(),'restore');}
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
    notifications.innerHTML=`<div class="pc-popover-heading"><h2 id="pcNotificationsTitle" tabindex="-1">Activity</h2>${button('Close activity','x','data-pc-popup-close')}</div><div class="pc-notification-connection"><span>Current connection</span><p></p></div><div class="pc-notification-actions"><span>Activity in this session</span><button type="button" data-pc-notice-action="read-all">Mark all read</button><button type="button" data-pc-notice-action="clear">Clear</button></div><div class="pc-notification-list"></div>`;
    const profilePopover=doc.createElement('section');profilePopover.id='pcProfilePopover';profilePopover.className='pc-header-popover pc-profile-popover';profilePopover.hidden=true;profilePopover.setAttribute('role','dialog');profilePopover.setAttribute('aria-labelledby','pcProfileTitle');
    profilePopover.innerHTML=`<div class="pc-popover-heading"><h2 id="pcProfileTitle">Local profile</h2>${button('Close profile','x','data-pc-popup-close')}</div><div class="pc-local-identity"><span class="pc-profile-initial" aria-hidden="true"></span><strong></strong></div><form><label for="pcLocalProfileName">Display name</label><input id="pcLocalProfileName" type="text" maxlength="40" autocomplete="off" aria-describedby="pcLocalProfileHelp"><p id="pcLocalProfileHelp">Saved only on this device.</p><button type="submit">Save name</button><p id="pcLocalProfileStatus" role="status"></p></form>`;
    doc.body.append(notifications,profilePopover,notificationAnnounce);
    let headerPopup=null,noticeSequence=0,notices=[],profileName='Local user',profileComposing=false,settingsReturnFocus=null,styleOwnerPosition=null;
    try{profileName=root.localStorage.getItem('pankeki-local-profile-name')?.trim().slice(0,40)||profileName;}catch{}
    function renderProfile(){const initial=Array.from(profileName)[0]||'L';$('pcProfileInitial').textContent=initial;$('pcProfileInitial').closest('.pk-avatar').dataset.pcDefaultAvatar=String(profileName==='Local user'&&!!art['pancake-cat']);profilePopover.querySelector('.pc-profile-initial').textContent=initial;profilePopover.querySelector('.pc-local-identity strong').textContent=profileName;$('pcLocalProfileName').value=profileName;}
    renderProfile();
    function renderConnection(){
      const codex=aiState?.codex,aiConnection=codex?`${codex.provider==='claude'?'Claude':'Codex'} ${{ready:'Connected','signed-out':'Sign-in required',missing:'Installation required'}[codex.state]||'Check connection'}`:'';
      notifications.querySelector('.pc-notification-connection p').textContent=[$('healthText').textContent,aiConnection].filter(Boolean).join(' · ');
      if(headerPopup?.kind==='notifications')positionHeaderPopup();
    }
    function renderNotifications(){
      const focusedNotice=notifications.contains(doc.activeElement)?doc.activeElement?.closest('[data-pc-notice-id]')?.dataset.pcNoticeId:null;
      const unread=notices.filter(item=>!item.read).length;bell.setAttribute('data-unread-count',String(unread));bell.setAttribute('aria-label',unread?`Activity · ${unread} unread`:'Activity');notificationBadge.textContent=String(unread);notificationBadge.hidden=!unread;renderConnection();
      notifications.querySelector('[data-pc-notice-action="read-all"]').disabled=!unread;notifications.querySelector('[data-pc-notice-action="clear"]').disabled=!notices.length;
      notifications.querySelector('.pc-notification-list').innerHTML=notices.length?notices.map(item=>`<button type="button" class="pc-notification-item${item.read?'':' pc-unread'}${item.error?' pc-notification-error':''}" data-pc-notice-id="${item.id}" aria-describedby="pcNoticeBody${item.id}" aria-label="${esc(item.title+(item.read?' · Read':' · Unread'))}"><span class="pc-notice-title">${esc(item.title)}</span><time datetime="${new Date(item.at).toISOString()}">${esc(new Date(item.at).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}))}</time><p id="pcNoticeBody${item.id}">${esc(item.text)}</p><small>${item.read?'Read':'Unread · Click to mark as read'}</small></button>`).join(''):'<p class="pc-notification-empty" tabindex="-1">No new activity.</p>';
      if(focusedNotice)notifications.querySelector(`[data-pc-notice-id="${focusedNotice}"]`)?.focus({preventScroll:true});
      if(headerPopup?.kind==='notifications')positionHeaderPopup();
    }
    function recordNotification(key,title,text,error=false){
      text=String(text||'').trim();if(!text||notices.some(item=>item.key===key))return;
      notices.unshift({id:String(++noticeSequence),key,title,text:text.slice(0,1000),error,at:Date.now(),read:false});notices=notices.slice(0,50);renderNotifications();notificationAnnounce.textContent=`New activity: ${title}`;
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
      event.preventDefault();if(profileComposing||event.isComposing)return;const next=$('pcLocalProfileName').value.trim().slice(0,40)||'Local user';
      try{root.localStorage.setItem('pankeki-local-profile-name',next);profileName=next;renderProfile();$('pcLocalProfileStatus').textContent='Saved on this device.';}
      catch{$('pcLocalProfileStatus').textContent='Could not save the name. Try again.';}
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
      if(error)recordNotification('project-error:'+text,'Project operation error',text,true);
      else if(!/^Autosaved in this browser\./i.test(text)&&/\b(?:exported|saved|loaded|restored|opened|stopped|confirmed)\b/i.test(text))recordNotification('project:'+ ++noticeSequence,'Project activity',text);
    }).observe($('projectStatus'),{attributes:true,attributeFilter:['class'],childList:true,characterData:true,subtree:true});
    // Dialogs use ordinary controls so the same actions remain keyboard accessible.
    const dialog=doc.createElement('dialog');dialog.id='pkLibrary';dialog.className='pk-library';doc.body.append(dialog);
    const galleryDialog=doc.createElement('dialog');galleryDialog.className='pk-gallery-dialog';
    galleryDialog.setAttribute('aria-label','Image gallery');
    galleryDialog.innerHTML=`<div class="pk-dialog-heading"><h2>Image gallery</h2>${button('Close gallery','x','data-pk-close')}</div>`;
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
    const recentImageTargets=new WeakMap();let lastHomeImages=[],recentImageNotice='';
    let projectCatalogPage=0,projectCatalogKey='',projectCatalogFilter='all',projectCatalogSort='updated',projectCatalogView='grid',projectSearchScope='home',projectCatalogIncludesCandidates=false,generationOpening=false,homeSubmitPending=false,editorDraftEpoch=0,applyingHomeDraft=false,generationDraftOverlay=null;
    const projectSearchQueries={home:$('pkSearch').value,projects:''};
    const quietHomeProjectNotices=new Set(['Project saved in the app.','Generation history saved in the app.','Project saved and opened.','Generation history opened.','Current work saved as a new project.']);
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
      try{const saved=await projectLibrary.saveAsProject();if(!saved)projectActionFailure(Error(projectState?.error||projectState?.notice||'Could not save as a project. Your current work was preserved.'));return saved;}catch(error){projectActionFailure(error);return false;}
    }
    function generationStorageText(){
      if(!projectState?.initialized)return 'Checking storage';
      if(!projectState.ready||projectState.error||projectState.recovery)return 'Check storage';
      return projectState.saving?'Saving history':'History autosaved';
    }
    function renderProjectContext(summary){
      const general=projectState?.activeKind!=='project',name=$('pcProjectName'),save=$('pcSaveAsProject');
      name.textContent=general?'Generation · '+generationStorageText():'Project · '+(summary.name||'Untitled project');
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
        applyHomeDraft(payload);go('design');
        // A native form ignores requestSubmit while its first submit is firing.
        await new Promise(resolve=>root.setTimeout(resolve,0));
        if(editorDraftEpoch!==epoch||studio.desktopChat.getState().projectId!==identity||composerComposing||projectBusy()||projectTransition()||projectState?.recovery||doc.body.dataset.studioScreen!=='design'||$('pkGenerate').disabled||editor.value!==payload.text){if(!aiState?.activeRequestId)generationDraftOverlay=null;return false;}
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
    function projectDate(value){const stamp=Date.parse(value);return Number.isFinite(stamp)?new Date(stamp).toLocaleString('en-US',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'';}
    function renderProjectRows(list,items,state,heading,restoreFocus,emptyText='No saved projects yet.'){
      const focused=list.contains(doc.activeElement)?doc.activeElement?.closest?.('[data-pk-project-id]'):null,focusId=focused?.dataset.pkProjectId,focusAction=focused?.dataset.pkProjectAction;list.replaceChildren();
      for(const item of items){
        const row=doc.createElement('div');row.className='pc-project-item';row.classList.toggle('current',item.id===state.activeId);if(item.id===state.activeId&&lastProjectActive&&lastProjectActive!==item.id)row.classList.add('pc-project-changed');
        const open=doc.createElement('button');open.type='button';open.dataset.pkProjectId=item.id;open.dataset.pkProjectAction='open';open.className='pc-project-open';const name=doc.createElement('strong'),details=doc.createElement('small'),text=doc.createElement('span');name.innerHTML='<span class="pc-project-name">'+esc(item.name)+'</span>'+(item.favorite?icon('star'):'')+(item.id===state.activeId?'<span class="pc-project-active">Current</span>':'');details.textContent=[globalThis.PankekiUIStrings.quantity(item.candidateCount,'candidate'),(list===$('pcProjectsPageList')?'Edit ':'')+projectDate(item.updatedAt)].filter(Boolean).join(' · ');open.setAttribute('aria-label',`${item.name}, ${globalThis.PankekiUIStrings.quantity(item.candidateCount,'candidate')}, ${projectDate(item.updatedAt)}, Project ${item.id} ${item.id===state.activeId?'Current, resume work':'Open'}`);open.setAttribute('aria-current',String(item.id===state.activeId));open.title=`Project ${item.id}. Switching resets the unsaved selection.`;if(list===$('pkRecentGrid'))open.title=item.name+' · '+open.title;text.append(name,details);
        if(item.preview){const preview=doc.createElement('img');preview.src=item.preview;preview.alt='';preview.className='pc-project-preview';open.append(preview);}else{const preview=doc.createElement('span');preview.className='pc-project-preview';preview.innerHTML=icon('folder');open.append(preview);}open.append(text);
        const remove=doc.createElement('button');remove.type='button';remove.dataset.pkProjectId=item.id;remove.dataset.pkProjectAction='remove';remove.className='pc-project-remove';remove.hidden=item.id===state.activeId;remove.innerHTML=icon('trash-2');remove.setAttribute('aria-label',`${item.name} Remove from app list`);remove.title='Removes the app list entry only. Original files are not deleted.';row.append(open,remove);list.append(row);
        if(list===$('pcProjectsPageList')){
          const count=doc.createElement('span');count.className='pc-project-candidate-count';count.textContent=globalThis.PankekiUIStrings.quantity(item.candidateCount,'candidate');row.append(count);
          const favorite=doc.createElement('button');favorite.type='button';favorite.className='pc-project-favorite';favorite.dataset.pkProjectId=item.id;favorite.dataset.pkProjectAction='favorite';favorite.innerHTML=icon('star');favorite.setAttribute('aria-pressed',String(item.favorite));favorite.setAttribute('aria-label',`${item.name} Favorites ${item.favorite?'Remove':'Add'}`);favorite.title=favorite.getAttribute('aria-label');row.append(favorite);
          const menu=doc.createElement('details');menu.className='pc-project-menu';menu.dataset.pkProjectMenu=item.id;const trigger=doc.createElement('summary');trigger.innerHTML=icon('ellipsis');trigger.setAttribute('aria-label',`${item.name} more actions`);trigger.title=trigger.getAttribute('aria-label');const actions=doc.createElement('div');actions.className='pc-project-card-actions';const star=doc.createElement('button');star.type='button';star.dataset.pkProjectId=item.id;star.dataset.pkProjectAction='favorite';star.textContent=item.favorite?'Remove favorite':'Add favorite';actions.append(star,remove);remove.innerHTML=icon('trash-2')+'Remove from app list';menu.append(trigger,actions);row.append(menu);
        }
      }
      if(!items.length){const empty=doc.createElement('p');empty.className='pc-home-recent-empty';empty.textContent=!state?.initialized?'Checking projects…':!state.ready?'Project list unavailable.':emptyText;list.append(empty);}
      if(focusId&&restoreFocus){const target=Array.from(list.querySelectorAll('[data-pk-project-id]')).find(node=>node.dataset.pkProjectId===focusId&&node.dataset.pkProjectAction===focusAction)||list.querySelector('[data-pk-project-action=open]')||heading;target.focus({preventScroll:true});}
    }
    function lockProjectRows(list,state,locked){for(const node of list.querySelectorAll('[data-pk-project-id]'))node.disabled=locked||!!state?.recovery||node.dataset.pkProjectAction==='remove'&&(node.dataset.pkProjectId===state?.activeId||(state?.items.length||0)<2);}
    function currentCandidatesMatch(query){return workspaceEntries.some(item=>[item.label,item.prompt,item.operationLabel].some(value=>String(value||'').toLocaleLowerCase().includes(query)));}
    function renderProjectPage(){
      const list=$('pcProjectsPageList');if(doc.body.dataset.studioScreen!=='projects'){if(projectCatalogKey){list.replaceChildren();projectCatalogKey='';}return;}
      const state=projectState,query=projectSearchQueries.projects.trim().toLocaleLowerCase(),all=state?.items||[],recentSince=Date.now()-7*86400000;
      const order=projectCatalogSort==='name'?(a,b)=>a.name.localeCompare(b.name,'ko')||a.id.localeCompare(b.id):projectCatalogSort==='created'?(a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||a.id.localeCompare(b.id):compareProjectRecency;
      const items=all.filter(item=>(projectCatalogFilter!=='favorite'||item.favorite)&&(projectCatalogFilter!=='recent'||Date.parse(item.updatedAt)>=recentSince)&&(!query||item.name.toLocaleLowerCase().includes(query)||projectCatalogIncludesCandidates&&item.id===state.activeId&&currentCandidatesMatch(query))).slice().sort(order),locked=projectTransition()||projectBusy(),pages=Math.max(1,Math.ceil(items.length/20));
      $('pcProjectsAllCount').textContent=state?.initialized?String(all.length):'…';$('pcProjectsFavoriteCount').textContent=state?.initialized?String(all.filter(item=>item.favorite).length):'…';projectsPage.dataset.view=projectCatalogView;
      for(const node of projectToolbar.querySelectorAll('[data-pk-project-filter]'))node.setAttribute('aria-pressed',String(node.dataset.pkProjectFilter===projectCatalogFilter));
      for(const node of projectToolbar.querySelectorAll('[data-pk-project-view]'))node.setAttribute('aria-pressed',String(node.dataset.pkProjectView===projectCatalogView));
      projectCatalogPage=Math.max(0,Math.min(projectCatalogPage,pages-1));
      const status=$('pcProjectsPageStatus');status.textContent=state?.error||(!state?.initialized?'Checking projects…':state?.recovery?'Your current work is preserved. Retry saving in the app or save a project file.':state?.notice||'');status.classList.toggle('error',!!state?.error||!!state?.recovery);status.setAttribute('role',state?.error||state?.recovery?'alert':'status');
      const key=JSON.stringify([query,projectCatalogFilter,projectCatalogSort,projectCatalogView,projectCatalogPage,state?.activeId,items.map(item=>[item.id,item.name,item.updatedAt,item.candidateCount,item.favorite]),state?.initialized,state?.ready]);
      if(key!==projectCatalogKey){projectCatalogKey=key;renderProjectRows(list,items.slice(projectCatalogPage*20,projectCatalogPage*20+20),state,$('pcProjectsHeading'),true,query?'No matching projects.':projectCatalogFilter==='favorite'?'No favorite projects yet.':projectCatalogFilter==='recent'?'No projects edited in the last 7 days.':'No saved projects yet.');const create=doc.createElement('button');create.type='button';create.className='pc-project-create-card';create.dataset.pkAction='new';create.innerHTML=icon('plus')+'<strong>New project</strong><span>Start new work.</span>';list.append(create);}lockProjectRows(list,state,locked);
      $('pcProjectsPagePaging').hidden=pages<=1;$('pcProjectsPageNumber').textContent=`${projectCatalogPage+1} / ${pages}`;
      projectsPage.querySelector('[data-pk-project-page=previous]').disabled=locked||projectCatalogPage===0;projectsPage.querySelector('[data-pk-project-page=next]').disabled=locked||projectCatalogPage>=pages-1;
      for(const node of projectsPage.querySelectorAll('[data-pk-action]'))node.disabled=locked||!!state?.recovery&&node.dataset.pkAction!=='save';
      const retry=projectsPage.querySelector('[data-pk-project-retry]');retry.hidden=!state?.error&&!state?.recovery;retry.disabled=projectTransition();
    }
    function syncProjectSearch(screen){
      const scope=screen==='projects'?'projects':'home',search=$('pkSearch');
      if(scope!==projectSearchScope){projectSearchQueries[projectSearchScope]=search.value;projectSearchScope=scope;search.value=projectSearchQueries[scope];}
      const candidates=scope==='home'||projectCatalogIncludesCandidates;search.placeholder=candidates?'Search projects and candidates…':'Search projects…';layout.querySelector('label[for="pkSearch"]').textContent=candidates?'Search project names and current candidate names or descriptions':'Search project names';
    }
    function recentImageResult(limit=5){
      if(projectLibrary?.getRecentImages)return projectLibrary.getRecentImages(limit);
      const seen=new Set(),items=workspaceEntries.filter(item=>item.kind==='generated').slice().sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||a.id.localeCompare(b.id)).filter(item=>{if(seen.has(item.image))return false;seen.add(item.image);return true;}).map(item=>({recordId:null,candidateId:item.id,image:item.image,label:item.label,createdAt:item.createdAt,projectName:studio.getSummary().name||'Current work'}));
      return {items:items.slice(0,limit),total:items.length};
    }
    function fillRecentImages(container,items){
      container.replaceChildren();
      for(const item of items){const choice=doc.createElement('button'),image=doc.createElement('img');choice.type='button';choice.className='pc-recent-image';choice.dataset.pkRecentImage='true';choice.dataset.recordId=item.recordId||'';choice.dataset.candidateId=item.candidateId;choice.title=`${item.projectName} · ${item.label}`;choice.setAttribute('aria-label',choice.title+' Open');image.src=item.image;image.alt=item.label;image.loading='lazy';image.decoding='async';choice.append(image);recentImageTargets.set(choice,item);container.append(choice);}
    }
    function renderRecentImages(){
      const result=recentImageResult(4),items=result.items,list=$('pcHomeRecentImages');
      if(items.length!==lastHomeImages.length||items.some((item,index)=>{const old=lastHomeImages[index];return !old||item.recordId!==old.recordId||item.candidateId!==old.candidateId||item.image!==old.image||item.label!==old.label||item.projectName!==old.projectName;})){fillRecentImages(list,items);lastHomeImages=items;}
      const notice=$('pcHomeRecentNotice');notice.hidden=!recentImageNotice;notice.textContent=recentImageNotice;
      const empty=$('pcHomeRecentEmpty');empty.hidden=items.length>0;empty.textContent=projectState&&!projectState.initialized?'Checking generation history…':projectState&&!projectState.ready?'Could not read the history. Check storage in Projects.':'No saved generated images yet.';
      const selected=visibleEntry()?.id||studio.getSummary().latestId,locked=projectTransition()||projectBusy()||!!projectState?.recovery;
      for(const button of [...list.querySelectorAll('[data-pk-recent-image]'),...dialog.querySelectorAll('[data-pk-recent-image]')]){button.disabled=locked;button.setAttribute('aria-current',String(button.dataset.recordId===(projectState?.activeId||'')&&button.dataset.candidateId===selected));}
    }
    function recentImageUnavailable(){
      recentImageNotice='The image list changed. Your current work is unchanged. Reopen View all.';renderRecentImages();
      const feedback=dialog.querySelector('[data-pk-recent-feedback]');if(feedback)feedback.textContent=recentImageNotice;return false;
    }
    async function openRecentImage(button){
      const item=recentImageTargets.get(button);if(!item||button.disabled||projectTransition()||projectBusy()||projectState?.recovery)return false;
      const fresh=recentImageResult(100).items.find(row=>row.recordId===item.recordId&&row.candidateId===item.candidateId&&row.image===item.image);
      if(!fresh)return recentImageUnavailable();
      recentImageNotice='';renderRecentImages();
      if(item.recordId&&projectState?.activeId!==item.recordId){const opened=await projectLibrary.switchTo(item.recordId);if(!opened){const feedback=dialog.querySelector('[data-pk-recent-feedback]');if(feedback)feedback.textContent=projectState?.error||projectState?.notice||'Image opening was canceled. Your current work was preserved.';return false;}}
      if(item.recordId&&projectState?.activeId!==item.recordId||!workspaceEntries.some(row=>row.id===item.candidateId&&row.kind==='generated'&&row.image===item.image))return recentImageUnavailable();
      if(dialog.open)dialog.close();activateCandidate(item.candidateId,button);return true;
    }
    function renderProjects(summary=lastSummary||studio.getSummary()){
      renderProjectContext(summary);
      const state=projectState,query=(projectSearchScope==='home'?$('pkSearch').value:projectSearchQueries.home).trim().toLocaleLowerCase(),currentCandidateMatch=currentCandidatesMatch(query);
      const items=(state?.items||[]).filter(item=>!query||item.name.toLocaleLowerCase().includes(query)||item.id===state.activeId&&currentCandidateMatch).slice().sort(compareProjectRecency);
      const pages=1;projectPage=0;const searchSummary=$('pcHomeSearchSummary');searchSummary.hidden=!query||items.length===0;searchSummary.textContent=`Most recent ${Math.min(items.length,4)} of ${items.length} matches`;
      const active=state?.items.find(item=>item.id===state.activeId),locked=projectTransition()||projectBusy(),status=$('pcProjectLibraryStatus');
      const general=state?.activeKind!=='project';
      $('pcHomeContextLabel').textContent=general?'Current work':'Current project';$('pcHomeCandidateSummary').hidden=!general;$('pcHomeResume').disabled=locked||!!state?.recovery;
      $('studioTitle').textContent=general?'Generation history':summary.name||'Untitled project';$('pcHomeCandidateSummary').textContent=`${summary.candidateCount} current candidate${summary.candidateCount===1?'':'s'}${general?' · '+generationStorageText():state?.saving?' · Saving':active?' · Saved in app':''}`;
      const statusMessage=state?.error||(state?.recovery?'Your current work is preserved. Retry saving in the app or save a project file.':state&&!state.initialized?'Checking projects…':state?.notice||'');
      if(status.textContent!==statusMessage)status.textContent=statusMessage;
      status.classList.toggle('sr-only',!!state?.initialized&&!!state?.ready&&!state?.error&&!state?.recovery&&!state?.saving&&!locked&&quietHomeProjectNotices.has(statusMessage));
      status.classList.toggle('error',!!state?.error||!!state?.recovery);status.setAttribute('role',state?.error||state?.recovery?'alert':'status');
      $('pkFavorite').disabled=locked||!active;$('pkFavorite').classList.toggle('selected',!!active?.favorite);$('pkFavorite').setAttribute('aria-pressed',String(!!active?.favorite));const favoriteLabel=active?`Current project ${active.name} Favorites ${active.favorite?'Remove':'Add'}`:'Favorite current project';$('pkFavorite').setAttribute('aria-label',favoriteLabel);$('pkFavorite').setAttribute('title',favoriteLabel);
      $('pcProjectPaging').hidden=pages<=1;$('pcProjectPage').textContent=`${projectPage+1} / ${pages}`;$('pcProjectPrevious').disabled=locked||projectPage===0;$('pcProjectNext').disabled=locked||projectPage>=pages-1;$('pcProjectRetry').hidden=!state?.error&&!state?.recovery;$('pcProjectRetry').disabled=projectTransition();
      for(const node of $('pcProjectLibraryActions').querySelectorAll('button'))node.disabled=locked||!!state?.recovery&&node.dataset.pkAction!=='save';
      const key=JSON.stringify([query,projectPage,state?.activeId,items.map(item=>[item.id,item.name,item.updatedAt,item.candidateCount,item.favorite]),state?.initialized]);
      const list=$('pkRecentGrid');if(key!==projectListKey){projectListKey=key;renderProjectRows(list,items.slice(0,4),state,$('pcProjectLibraryHeading'),doc.body.dataset.studioScreen==='home',query?'No matching projects.':'No saved projects yet.');}
      const emptyHome=state?.initialized===true&&state?.ready===true&&!state.recovery&&!state.error&&!query&&items.length===0;
      $('pcHomeProjectEmpty').hidden=!emptyHome;list.hidden=emptyHome;home.querySelector('.pc-home-projects').classList.toggle('pc-home-projects-empty',emptyHome);home.querySelector('.pc-home-project-summary').hidden=emptyHome&&summary.candidateCount===0;
      lockProjectRows(list,state,locked);renderProjectPage();renderRecentImages();
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
      if(!desktopBinding){
        editContext.hidden=screen==='home'&&plainHomeGenerationTarget();
        const target=screen==='home'?homeOptions.querySelector('.pc-home-composer-context'):composer;
        if(editContext.parentNode!==target){const focus=doc.activeElement,inside=editContext.contains(focus);if(screen==='home')target.append(editContext);else target.prepend(editContext);if(inside)focus.focus({preventScroll:true});}
      }
      const parent=screen==='home'?$('pcHomeComposer'):composerAnchor.parentNode;if(composer.parentNode===parent)return;
      const focused=doc.activeElement,inside=composer.contains(focused),start=editor.selectionStart,end=editor.selectionEnd;
      if(screen==='home')parent.append(composer);else parent.insertBefore(composer,composerAnchor.nextSibling);
      if(inside){focused.focus({preventScroll:true});if(focused===editor&&Number.isInteger(start)&&Number.isInteger(end))editor.setSelectionRange(start,end);}
    }
    function routes(){
      if(doc.body.dataset.studioScreen!=='home')closeHomeOptions();
      const screen=doc.body.dataset.studioScreen||'home',comparing=screen==='compare';
      if(!['home','projects','design'].includes(screen)&&(!desktopBinding||screen!=='inpaint')&&viewerId)closeViewer();
      if(screen==='inpaint'&&lastRoute!==screen)showPane('canvas',false);lastRoute=screen;
      syncPresentation();
      const activeRoute=['inpaint','compare'].includes(screen)?'design':['parts','video'].includes(screen)?'motion':screen;syncProjectSearch(screen);renderProjects();
      placeComposer(screen);homeShortcuts.hidden=true;
      composer.querySelector('.pc-prompt-label').classList.toggle('sr-only',screen==='home');
      $('pkGalleryOpen').hidden=screen==='home';syncComposerFeedback(screen==='home');
      if(screen==='home')editor.placeholder='What would you like to create?';else if(desktopBinding)editor.placeholder='Enter a message.';
      const children=Array.from(shell.children);
      if(screen==='design'){if(children.at(-1)!==workspace)shell.append(workspace);}
      else if(screen!=='home'&&children.indexOf(workspace)>children.indexOf(composer))shell.append(...(desktopBinding?[workspace,composerAnchor,composer]:[workspace,categoryRow,composerAnchor,composer]));
      for(const node of layout.querySelectorAll('[data-pk-route]')){
        const active=node.dataset.pkRoute===activeRoute;
        node.classList.toggle('active',active);if(active)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');
      }
      composer.hidden=comparing;composer.inert=comparing;
      categoryRow.hidden=comparing||!desktopBinding&&studio.getSummary().mode==='inpaint'&&!stylesInSettings();
      $('editorTools').hidden=comparing||$('editor').hidden;
      $('pcShowCanvas').disabled=!viewerId&&screen!=='inpaint';syncCanvasTools();
      $('pkScreenTitle').textContent=({projects:'Projects',design:'Generate images',inpaint:'Image editing',compare:'Compare candidates',parts:'Parts preparation',motion:'Expressions & motion',video:'Blender video',export:'Export'})[screen]||'Home';
      layout.dataset.screen=screen;
      const visible=screen==='design';
      if(visible&&!threadVisible){followLatest=true;root.requestAnimationFrame(()=>{fitPrompt();revealLatest();});}
      threadVisible=visible;
      const skip=doc.querySelector('.skip-link');if(skip)skip.href=screen==='projects'?'#pcProjectsHeading':visible?'#pcConversation':'#workspace';
    }
    function go(screen){if(composerComposing&&screen!==workflow.getScreen()){queuedRoute=screen;return;}if(screen==='inpaint')editorOpen=true;workflow.go(screen);routes();updateWorkspace(studio.getSummary());}
    function restoreStyleOwner(){
      const position=styleOwnerPosition;if(!position)return;
      position.parent.insertBefore(categoryRow,position.next?.parentNode===position.parent?position.next:null);categoryRow.hidden=position.hidden;styleOwnerPosition=null;$('pcHomeStyle').setAttribute('aria-expanded','false');
      if(position.focus&&doc.body.contains(position.focus))position.focus.focus({preventScroll:true});
    }
    function closeStyleDialog(){restoreStyleOwner();if(styleDialog.open)styleDialog.close();}
    function openStyleDialog(){
      if(styleDialog.open||plainHomePendingConfiguration()||!desktopBinding&&studio.getSummary().mode==='inpaint')return;
      closeHeaderPopup(false);if(dialog.open)dialog.close();if(galleryDialog.open)galleryDialog.close();if(drawer.open){settingsReturnFocus=null;drawer.close();}
      styleOwnerPosition={parent:categoryRow.parentNode,next:categoryRow.nextSibling,hidden:categoryRow.hidden,focus:doc.body.dataset.studioScreen==='home'?homeOptionsTrigger:doc.activeElement};
      styleDialog.querySelector('.pc-style-dialog-content').append(categoryRow);categoryRow.hidden=false;$('pcHomeStyle').setAttribute('aria-expanded','true');styleDialog.showModal();
      const focus=categoryRow.querySelector('[aria-pressed=true]')||categoryRow.querySelector('button');root.requestAnimationFrame(()=>{if(styleDialog.open)focus?.focus();});
    }
    function stylesInSettings(){return styleDialog.open&&styleDialog.contains(categoryRow)||drawer.open&&drawer.dataset.panel==='model'&&categoryRow.parentNode===modelPanel;}
    function settingsPanel(panel){
      if(!settingCategories.some(([key])=>key===panel))panel='model';
      drawer.dataset.panel=panel;
      const [,tab,label]=settingCategories.find(([key])=>key===panel);
      $('pkSettingsTitle').textContent=label+' Settings';chatPanel.hidden=panel!=='brief';modelPanel.hidden=panel==='brief';modelPanel.setAttribute('aria-labelledby',tab);
      for(const node of modelPanel.querySelectorAll('[data-pk-settings-section]'))node.hidden=node.dataset.pkSettingsSection!==panel;
      for(const node of drawer.querySelectorAll('[data-pk-panel]')){const selected=node.dataset.pkPanel===panel;node.setAttribute('aria-selected',String(selected));node.tabIndex=selected?0:-1;}
    }
    function settings(panel='model',field=null){
      if(field==='pcStyleLabel')return openStyleDialog();if(styleDialog.open)closeStyleDialog();
      closeHeaderPopup(false);if(dialog.open)dialog.close();if(galleryDialog.open)galleryDialog.close();
      if(desktopBinding&&field==='imageModel')field=studio.getSummary().mode==='inpaint'?'desktopEditModel':'desktopGenerationModel';
      const target=field&&$(field),category=target?.closest('[data-pk-settings-section]')?.dataset.pkSettingsSection;
      settingsPanel(category||panel);if(!drawer.open){settingsReturnFocus=homeOptions.contains(doc.activeElement)?homeOptionsTrigger:doc.activeElement;drawer.showModal();}moreSettings.open=false;
      $('detailPanel').open=true;$('briefDrawer').open=true;$('advanced').open=true;
      const focus=target&&!target.hidden&&!target.inert?target:drawer.querySelector('[aria-selected="true"]');
      for(let node=focus?.parentNode;node&&node!==drawer;node=node.parentNode)if(node.tagName==='DETAILS')node.open=true;
      root.requestAnimationFrame(()=>{focus?.focus();focus?.scrollIntoView({block:'nearest'});});
    }
    function chooseCategory(id,{fromUser=true}={}){
      if(!categories.some(item=>item.id===id))return;
      if(desktopBinding){if(!fromUser)return;aiCategory=id;for(const node of categoryRow.querySelectorAll('button')){const selected=node.dataset.pkCategory===id;node.classList.toggle('selected',selected);node.setAttribute('aria-pressed',String(selected));}if(doc.body.dataset.studioScreen==='home')syncHomeModelSummary();return;}
      category=id;
      // Environment/photo styles should not inherit the character brief's
      // silhouette and palette instructions. The drawer can enable it again.
      if(fromUser&&!['character','chibi'].includes(id)){
        $('useBrief').checked=false;$('useBrief').dispatchEvent(new root.Event('change',{bubbles:true}));
      }
      for(const node of categoryRow.querySelectorAll('[data-pk-category]')){const active=node.dataset.pkCategory===id;node.classList.toggle('selected',active);node.setAttribute('aria-pressed',String(active));}
      if(doc.body.dataset.studioScreen==='home')syncHomeModelSummary();
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
      let title='Templates',body='';
      if(kind==='recent-images'){
        recentImageNotice='';const result=recentImageResult(100);title='Recent generated images';body=`<p>${result.total>100?'All '+result.total+' results: showing the most recent 100.':'Saved generated images: '+result.total} · Duplicates are excluded from generation and edit history.</p><p data-pk-recent-feedback role="status" aria-live="polite"></p><div class="pc-recent-image-grid"></div>${result.total?'':'<p class="pk-library-empty">No saved generated images yet.</p>'}`;
      }else if(kind==='templates'||kind==='prompts'){
        title=kind==='prompts'?'Prompt ideas':'Templates';
        body=`<p>Choose a starting point and make the description your own.</p><div class="pk-library-grid">${templates.map(item=>`<button type="button" data-pk-template="${item.id}" aria-label="${esc(item.label)}">${templateVisual(item)}<strong>${esc(item.label)}</strong><small>${esc(item.prompt)}</small></button>`).join('')}</div>`;
      }else if(kind==='stages'){
        title='Workflow';body=`<div class="pk-stage-list">${[['design','Generate images'],['inpaint','Image editing'],['parts','Parts preparation'],['motion','Expressions & motion'],['export','Export']].map(([screen,label])=>`<button type="button" data-pk-route="${screen}">${label}${icon('arrow-right')}</button>`).join('')}</div>`;
      }else{
        title='My projects';const summary=studio.getSummary();
        body=`<p>Resume the current work in this browser or open a saved project file.</p>${summary.imageUrl?`<button type="button" class="pk-library-current" data-pk-action="continue">${imgFromURL(summary.imageUrl)}<strong>${esc(summary.name||'Untitled project')}</strong><small>${globalThis.PankekiUIStrings.quantity(summary.candidateCount,'candidate')}</small></button>`:'<p class="pk-library-empty">No saved images yet.</p>'}<div class="pk-library-actions"><button type="button" class="pk-secondary" data-pk-action="import">${icon('folder-open')}Import project</button><button type="button" class="pk-secondary" data-pk-action="save">${icon('download')}Save current project</button><button type="button" class="pk-primary" data-pk-action="new">${icon('plus')}New project</button></div>`;
      }
      dialog.innerHTML=`<div class="pk-dialog-heading"><h2>${title}</h2>${button('Close','x','data-pk-close')}</div>${body}`;
      if(kind==='recent-images'){fillRecentImages(dialog.querySelector('.pc-recent-image-grid'),recentImageResult(100).items);renderRecentImages();}
      dialog.showModal();
    }
    function imgFromURL(url){return `<img src="${esc(url)}" alt="Current project image">`;}
    function action(name,field=null){
      if(name==='notifications'||name==='profile')return openHeaderPopup(name);
      closeHeaderPopup(false);
      if(name==='gallery'){galleryDialog.showModal();const query=$('pkSearch').value.trim().toLocaleLowerCase(),match=query&&workspaceEntries.find(item=>[item.label,item.prompt,item.operationLabel].some(value=>String(value||'').toLocaleLowerCase().includes(query)));if(match)galleryDialog.querySelector(`[data-candidate-id="${match.id}"] [data-action=view]`)?.focus({preventScroll:true});return;}
      if(name==='projects')return go('projects');
      if(['templates','prompts','stages','recent-images'].includes(name))return library(name);
      if(name==='style')return openStyleDialog();
      if(name==='settings')return settings(field?'model':'environment',field);
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
      if(name==='continue'){if(projectTransition()||projectBusy()||projectState?.recovery)return false;go(studio.getSummary().mode==='inpaint'?'inpaint':'design');editor.focus({preventScroll:true});return true;}
      if(['parts','motion','export'].includes(name))return go(name);
    }
    function recent(summary){renderProjects(summary);}
    function generateDisabled(summary){return summary.busy||(summary.mode==='inpaint'&&summary.editOperation==='recolor'?!summary.sourceLoaded:!summary.modelsReady||!prompt.value.trim());}
    function refresh(summary,reason){
      lastSummary=summary;const hasImage=!!summary.imageUrl;
      if(['restore','import','reset'].includes(reason)&&(viewerId||desktopBinding&&editorOpen))closeViewer();
      const editing=summary.mode==='inpaint';
      if(!desktopBinding)categoryRow.hidden=editing&&!stylesInSettings();
      const recolor=editing&&summary.editOperation==='recolor';
      if(!desktopBinding){
      composer.classList.toggle('pc-recolor',recolor);
      composer.querySelector('label[for=pcPrompt]').textContent=editing?'Edit instructions':'Image description';
      composer.querySelector('.pc-key-hint').innerHTML=recolor?'Apply color to the selected area':`<kbd>Enter</kbd> ${editing?'Edit':'Generate'} · <kbd>Shift Enter</kbd> New line`;
      editor.placeholder=editing?'Describe what to change in the selected area.':'Describe the image you want…';
      editor.setAttribute('aria-label',editing?'Edit instructions':'Image description');
      const text=descriptionText(prompt.value);if(doc.activeElement!==editor&&editor.value!==text){editor.value=text;fitPrompt(true);}
      }
      renderConversation(summary,['restore','import','reset'].includes(reason));
      updateWorkspace(summary);
      if(!desktopBinding)thread.querySelector('.pc-pending').hidden=!summary.busy;
      if(summary.busy&&!wasBusy){followLatest=true;revealLatest();}wasBusy=summary.busy;
      if(['restore','import','reset'].includes(reason)){const restoreSelection=!projectState?.transitioning;root.requestAnimationFrame(()=>fitPrompt(restoreSelection));}
      const selected=$('imageModel').selectedOptions?.[0];
      if(!desktopBinding){
      $('pcModelName').textContent=selected?.textContent||'Checking model';
      $('pcResolution').textContent=`${$('width').value} × ${$('height').value}`;
      $('pkModelHint').textContent=`${selected?.textContent||'SDXL 1.0 Base'} · ${$('width').value} × ${$('height').value} · English descriptions recommended`;
      $('pkGenerate').disabled=generateDisabled(summary);
      $('pkGenerate').innerHTML=recolor?'Apply color':icon('send-horizontal')+'<span class="pc-home-send-label">'+(editing?'Edit':'Generate')+'</span>';
      $('pkGenerate').setAttribute('aria-label',recolor?summary.busy?'Applying color':'Apply color':summary.busy?'Creating image':summary.mode==='inpaint'?'Edit selected area':'Generate image');
      $('pkGenerate').classList.toggle('busy',summary.busy);
      $('pkCancel').hidden=!summary.busy;
      }
      $('pkGalleryOpen').textContent=globalThis.PankekiUIStrings.quantity(summary.candidateCount,'candidate');
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
      if(project.dataset.pkProjectAction==='favorite'){const item=projectState?.items.find(item=>item.id===id);if(item&&!projectTransition()&&!projectBusy()&&!projectState.recovery)return projectLibrary.setFavorite(id,!item.favorite);return;}
      if(project.dataset.pkProjectAction==='remove'){if(root.confirm('Remove this entry from the app project list? Original files will not be deleted.'))return projectLibrary.remove(id);return;}
      const focusEditor=()=>{go(studio.getSummary().mode==='inpaint'?'inpaint':'design');editor.focus({preventScroll:true});};
      if(id===projectState.activeId)return focusEditor();return projectLibrary.switchTo(id).then(opened=>{if(opened)focusEditor();return opened;});
    }
    layout.addEventListener('click',event=>{
      if(event.target.closest('[data-pc-home-options-close]'))return closeHomeOptions(true);
      const filter=event.target.closest('[data-pk-project-filter]');if(filter){projectCatalogFilter=filter.dataset.pkProjectFilter;projectCatalogPage=0;renderProjectPage();return;}
      const projectView=event.target.closest('[data-pk-project-view]');if(projectView){projectCatalogView=projectView.dataset.pkProjectView;renderProjectPage();return;}
      const generated=event.target.closest('[data-pk-recent-image]');if(generated)return openRecentImage(generated);

      const recent=event.target.closest('[data-pk-home-candidate]');if(recent){activateCandidate(recent.dataset.pkHomeCandidate,recent);return;}
      const project=event.target.closest('[data-pk-project-id]');if(project)return projectAction(project);
      const projectPageControl=event.target.closest('[data-pk-project-page]');if(projectPageControl&&!projectPageControl.disabled){projectCatalogPage+=projectPageControl.dataset.pkProjectPage==='previous'?-1:1;renderProjectPage();projectsPage.scrollTop=0;$('pcProjectsHeading').focus({preventScroll:true});return;}
      const projectRetry=event.target.closest('[data-pk-project-retry]');if(projectRetry&&!projectRetry.disabled)return projectLibrary?.saveCurrent();
      const route=event.target.closest('[data-pk-route]');if(route){const next=route.dataset.pkRoute;if(next==='projects'){if(route.hasAttribute('data-pk-home-projects')){projectSearchQueries.projects=$('pkSearch').value;projectCatalogIncludesCandidates=!!projectSearchQueries.projects.trim();projectCatalogPage=0;}return action('projects');}if(next==='design')return enterGeneration();go(next);return;}
      const target=event.target.closest('[data-pk-action]');if(target){closeHomeOptions();return action(target.dataset.pkAction,target.dataset.pkSettingTarget);}
      const template=event.target.closest('[data-pk-template]');if(template)return useTemplate(template.dataset.pkTemplate);
      const chosen=event.target.closest('[data-pk-category]');if(chosen)chooseCategory(chosen.dataset.pkCategory);
    });
    $('pcProjectsSort').addEventListener('change',event=>{projectCatalogSort=['updated','created','name'].includes(event.target.value)?event.target.value:'updated';projectCatalogPage=0;renderProjectPage();});
    doc.addEventListener('click',event=>{for(const menu of projectsPage.querySelectorAll('.pc-project-menu'))if(menu.open&&!menu.contains(event.target))menu.open=false;});
    projectsPage.addEventListener('keydown',event=>{if(event.isComposing||event.keyCode===229||event.key!=='Escape')return;const menu=event.target.closest('.pc-project-menu');if(menu?.open){event.preventDefault();menu.open=false;menu.querySelector('summary').focus({preventScroll:true});}});
    doc.addEventListener('click',event=>{if(!homeOptions.hidden&&!homeOptions.contains(event.target)&&!homeOptionsTrigger.contains(event.target))closeHomeOptions();},true);
    doc.addEventListener('focusin',event=>{if(!homeOptions.hidden&&!homeOptions.contains(event.target)&&!homeOptionsTrigger.contains(event.target))closeHomeOptions();},true);
    doc.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.isComposing&&event.keyCode!==229&&!homeOptions.hidden){event.preventDefault();closeHomeOptions(true);}});
    dialog.addEventListener('click',event=>{
      const generated=event.target.closest('[data-pk-recent-image]');if(generated)return openRecentImage(generated);
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
    styleDialog.addEventListener('click',event=>{if(event.target.closest('[data-pc-style-close]'))return closeStyleDialog();const chosen=event.target.closest('[data-pk-category]');if(chosen)return chooseCategory(chosen.dataset.pkCategory);if(event.target===styleDialog){const box=styleDialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)closeStyleDialog();}});
    styleDialog.addEventListener('close',()=>{if(!styleDialog.open)restoreStyleOwner();});
    for(const modal of [dialog,drawer,galleryDialog])modal.addEventListener('click',event=>{if(event.target===modal){const box=modal.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)modal.close();}});
    layout.querySelector('.pk-brand').addEventListener('click',event=>{event.preventDefault();go('home');});
    $('pkSearch').addEventListener('input',()=>{projectSearchQueries[projectSearchScope]=$('pkSearch').value;if(projectSearchScope==='projects'){projectCatalogPage=0;projectCatalogIncludesCandidates=false;syncProjectSearch('projects');}else projectPage=0;if(lastSummary)recent(lastSummary);});
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
    doc.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(doc.body.dataset.studioScreen!=='projects')go('projects');$('pkSearch').focus();}});
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
      const percent=available?Math.min(100,Math.round(used/quota*100)):null;
      $('pkStorageBar').hidden=!available;$('pkStorageBar').value=percent??0;$('pkStoragePercent').hidden=!available;$('pkStoragePercent').textContent=available?`${percent}%`:'';
      $('pkStorageText').textContent=available?`About ${(used/1000000).toFixed(1)} MB used`:'Storage estimate unavailable.';
      if(available){const detail=`Browser storage estimate: about ${(used/1000000).toFixed(1)} MB used / ${(quota/1000000000).toFixed(1)} GB estimated quota. Checked when this screen opened; this is not reserved app space or total free disk space.`;layout.querySelector('.pk-storage').setAttribute('title',detail);layout.querySelector('.pk-storage').setAttribute('aria-label',detail);}
    }).catch(()=>{$('pkStorageBar').hidden=true;$('pkStoragePercent').hidden=true;$('pkStorageText').textContent='Storage estimate unavailable.';});
    return Object.freeze({go,chooseCategory,settings,composer:composerView,projects:projectLibrary});
  }
  return Object.freeze({categories,templates,preparePrompt,submitPrompt,conversationEntries,compareProjectRecency,mount});
});

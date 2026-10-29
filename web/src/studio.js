/* Workflow navigation for the existing Pankeki app. No generation or storage
 * implementation lives here; actions use the existing app handlers. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.PankekiWorkflow = api;
    if (root.document && root.PankekiStudio) root.PankekiWorkflowController = api.mount(root.document,root.PankekiStudio);
  }
})(typeof globalThis === 'object' ? globalThis : this,function () {
  'use strict';
  const labels = Object.freeze({home:'프로젝트 홈',projects:'프로젝트',design:'이미지 생성 · 기존 기능 · 실행 환경 확인 필요',
    compare:'후보 비교 · 기존 기능',inpaint:'부분 수정 · 기존 기능 · 실행 환경 확인 필요',
    parts:'부위 편집 · 개발 예정',motion:'표정과 동작 · 개발 예정',video:'Blender 영상',export:'저장과 출력 · 기본 저장 사용 가능'});
  const workspace = new Set(['design','compare','inpaint']);
  function mount(doc,studio) {
    const find = id => doc.getElementById(id), nodes = selector => Array.from(doc.querySelectorAll(selector));
    const pages = nodes('[data-studio-page]'), nav = nodes('[data-studio-go]'), headings = nodes('[data-studio-heading]');
    const shells = nodes('.app-shell'), disposers = [];
    let screen = Object.hasOwn(labels,doc.body.dataset.studioScreen) ? doc.body.dataset.studioScreen : 'home';
    let previous = null, switching = false, lastWorkspaceRoute = null;
    function text(id,value) { const node = find(id); if (node) node.textContent = value; }
    function show(message = labels[screen]) {
      const motion = rootMotion();
      if (motion && ['parts','motion'].includes(screen) && message === labels[screen]) message = screen === 'parts' ? '부위와 기준 형태 · PNG 준비 후 실제 메시 편집' : '표정과 동작 · 준비된 리그로 실제 재생';
      doc.body.dataset.studioScreen = screen;
      for (const page of pages) page.hidden = page.dataset.studioPage !== screen;
      for (const shell of shells) shell.hidden = !workspace.has(screen);
      for (const button of nav) {
        const active = button.dataset.studioGo === (screen === 'video' && button.dataset.studioGo === 'motion' ? 'motion' : screen);
        button.classList.toggle('active',active);
        if (active) button.setAttribute('aria-current','step'); else button.removeAttribute('aria-current');
      }
      text('studioStatus',message);
      const cubism = typeof globalThis === 'object' ? globalThis.PankekiCubismWorkspaceController : null;
      const cubismActive = screen === 'motion' && cubism?.getSummary().mode === 'cubism';
      const precise = typeof globalThis === 'object' ? globalThis.PankekiAuthoringV3Controller : null;
      const preciseActive = !!precise && ['motion','export'].includes(screen) && !cubismActive && studio.getAuthoringMode?.() === 'v3';
      const route = screen + ':' + (cubismActive ? 'cubism' : preciseActive ? 'v3' : 'native');
      if (route !== lastWorkspaceRoute) {
        if (cubismActive || preciseActive) motion?.suspend();
        if (!preciseActive && lastWorkspaceRoute?.endsWith(':v3')) precise?.suspend();
        else if (lastWorkspaceRoute?.endsWith(':cubism')) cubism?.suspend();
        lastWorkspaceRoute = route;
      }
      if (!cubismActive && !preciseActive) motion?.show(screen);
      cubism?.show(screen);
      if (preciseActive) precise.show(screen);
      if (find('v3Workspace')) find('v3Workspace').hidden = !preciseActive || screen !== 'motion';
      if (find('v3ExportActions')) find('v3ExportActions').hidden = !preciseActive || screen !== 'export';
      if (find('motionExportDetails') && screen === 'export') find('motionExportDetails').hidden = preciseActive;
      if (find('motionNativePanel')) find('motionNativePanel').hidden = cubismActive || preciseActive;
      if (find('motionProjectTools') && preciseActive) find('motionProjectTools').hidden = true;
      if (find('v3Mode')) find('v3Mode').setAttribute('aria-pressed',String(preciseActive));
      if (find('motionNativeMode') && preciseActive) find('motionNativeMode').setAttribute('aria-pressed','false');
    }
    function rootMotion() { return typeof globalThis === 'object' ? globalThis.PankekiMotionController : null; }
    function refresh(summary,reason) {
      text('studioTitle',summary.name || '이름 없는 프로젝트');
      text('studioCandidateCount',String(summary.candidateCount));
      text('studioCurrentSummary',`후보 ${summary.candidateCount}개 · ${summary.sourceLoaded ? '수정 원본 있음' : '수정 원본 없음'}`);
      const images = new Set([find('studioCurrentImage'),...nodes('[data-studio-image]')]);
      for (const image of images) {
        if (!image) continue;
        image.hidden = !summary.imageUrl;
        if (summary.imageUrl) { if (image.src !== summary.imageUrl) image.src = summary.imageUrl; image.alt = `${summary.name || '현재 프로젝트'} · 보관된 이미지`; }
        else image.removeAttribute('src');
      }
      const values = {name:summary.name || '이름 없는 프로젝트',candidates:`${summary.candidateCount}개 후보`,
        source:summary.sourceLoaded ? '수정 원본 있음' : '수정 원본 없음',status:summary.projectStatus};
      for (const node of nodes('[data-studio-summary]')) node.textContent = values[node.dataset.studioSummary] || '';
      if (!switching && previous && previous.mode !== summary.mode && workspace.has(screen)) screen = summary.mode === 'inpaint' ? 'inpaint' : 'design';
      if (reason === 'reset' || reason === 'import') screen = 'design';
      if (reason === 'motion-import') screen = 'motion';
      previous = summary; show();
    }
    function go(next,{focus = true} = {}) {
      if (!Object.hasOwn(labels,next)) return false;
      switching = true;
      try {
        screen = next;
        if (next === 'design' && studio.getSummary().mode !== 'txt2img') studio.setMode('txt2img');
        if (next === 'inpaint' && studio.getSummary().mode !== 'inpaint') studio.setMode('inpaint');
        if (next !== 'compare' && find('comparePanel')) find('comparePanel').hidden = true;
        show();
        if (next === 'compare') {
          if (studio.getSummary().selectedCount === 2) find('compareSelected')?.click();
          else { if (find('comparePanel')) find('comparePanel').hidden = true; show('비교할 두 후보를 목록에서 선택해주세요.'); }
        }
        if (focus && !(next === 'compare' && !find('comparePanel')?.hidden)) {
          const page = pages.find(node => node.dataset.studioPage === next);
          const heading = headings.find(node => node.dataset.studioHeading === next || page?.contains(node)) || (workspace.has(next) ? find('canvasHeading') : null);
          if (heading) { heading.setAttribute('tabindex','-1'); heading.focus({preventScroll:true}); }
        }
        return true;
      } finally { switching = false; }
    }
    async function action(name) {
      if (name === 'new') { if (await (studio.requestNewProject ? studio.requestNewProject() : studio.resetProject())) go('design'); return; }
      if (name === 'continue') { go('design'); return; }
      if (name === 'upload') { go('inpaint'); return find('upload')?.click(); }
      if (name === 'import') { go('design'); return find('loadProject')?.click(); }
      const targets = {save:'saveProject',board:'exportBoard',download:'download',help:'helpButton'};
      const target = Object.hasOwn(targets,name) ? find(targets[name]) : null;
      if (name === 'download' && (!target?.href || target.hidden)) { show('저장할 이미지를 후보 목록에서 먼저 선택해주세요.'); return; }
      if (target && !target.disabled) return target.click();
    }
    function on(node,event,handler) {
      node.addEventListener(event,handler); disposers.push(() => node.removeEventListener(event,handler));
    }
    for (const button of nav) on(button,'click',() => go(button.dataset.studioGo));
    for (const button of nodes('[data-studio-action]')) on(button,'click',() => action(button.dataset.studioAction));
    for (const link of nodes('.skip-link')) on(link,'click',() => go('design',{focus:false}));
    for (const button of nodes('[data-studio-planned]')) { button.disabled = true; button.setAttribute('aria-disabled','true'); }
    if (find('closeCompare')) on(find('closeCompare'),'click',() => { if (screen === 'compare') go('design'); });
    disposers.push(studio.subscribe(refresh)); show();
    return Object.freeze({go,getScreen:() => screen,destroy:() => { for (const dispose of disposers.splice(0)) dispose(); }});
  }
  return Object.freeze({mount,labels});
});

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
  const labels = Object.freeze({home:'Project home',projects:'Projects',design:'Image generation · Check runtime availability',
    compare:'Compare candidates',inpaint:'Image editing · Check runtime availability',
    parts:'Parts preparation',motion:'Expressions and motion',video:'Blender video',export:'Save and export'});
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
      if (motion && ['parts','motion'].includes(screen) && message === labels[screen]) message = screen === 'parts' ? 'Parts and reference forms · Prepare PNG parts to edit the mesh' : 'Expressions and motion · Play a prepared rig';
      doc.body.dataset.studioScreen = screen;
      for (const page of pages) page.hidden = page.dataset.studioPage !== screen;
      for (const shell of shells) shell.hidden = !workspace.has(screen);
      for (const button of nav) {
        const active = button.dataset.studioGo === (screen === 'video' && button.dataset.studioGo === 'motion' ? 'motion' : screen);
        button.classList.toggle('active',active);
        if (active) button.setAttribute('aria-current','step'); else button.removeAttribute('aria-current');
      }
      text('studioStatus',message);
      const precise = typeof globalThis === 'object' ? globalThis.PankekiAuthoringV3Controller : null;
      const preciseActive = !!precise && ['motion','export'].includes(screen) && studio.getAuthoringMode?.() === 'v3';
      const route = screen + ':' + (preciseActive ? 'v3' : 'native');
      if (route !== lastWorkspaceRoute) {
        if (preciseActive) motion?.suspend();
        if (!preciseActive && lastWorkspaceRoute?.endsWith(':v3')) precise?.suspend();
        lastWorkspaceRoute = route;
      }
      if (!preciseActive) motion?.show(screen);
      if (preciseActive) precise.show(screen);
      if (find('v3Workspace')) find('v3Workspace').hidden = !preciseActive || screen !== 'motion';
      if (find('v3ExportActions')) find('v3ExportActions').hidden = !preciseActive || screen !== 'export';
      if (find('motionExportDetails') && screen === 'export') find('motionExportDetails').hidden = preciseActive;
      if (find('motionNativePanel')) find('motionNativePanel').hidden = preciseActive;
      if (find('motionProjectTools')) find('motionProjectTools').hidden = preciseActive;
      if (find('v3Mode')) find('v3Mode').setAttribute('aria-pressed',String(preciseActive));
      if (find('motionNativeMode')) find('motionNativeMode').setAttribute('aria-pressed',String(!preciseActive));
    }
    function rootMotion() { return typeof globalThis === 'object' ? globalThis.PankekiMotionController : null; }
    function refresh(summary,reason) {
      text('studioTitle',summary.name || 'Untitled project');
      text('studioCandidateCount',String(summary.candidateCount));
      text('studioCurrentSummary',`${summary.candidateCount} candidate${summary.candidateCount===1?'':'s'} · ${summary.sourceLoaded ? 'Edit source available' : 'No edit source'}`);
      const images = new Set([find('studioCurrentImage'),...nodes('[data-studio-image]')]);
      for (const image of images) {
        if (!image) continue;
        image.hidden = !summary.imageUrl;
        if (summary.imageUrl) { if (image.src !== summary.imageUrl) image.src = summary.imageUrl; image.alt = `${summary.name || 'Current project'} · Saved image`; }
        else image.removeAttribute('src');
      }
      const values = {name:summary.name || 'Untitled project',candidates:`${summary.candidateCount} candidate${summary.candidateCount===1?'':'s'}`,
        source:summary.sourceLoaded ? 'Edit source available' : 'No edit source',status:summary.projectStatus};
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
          else { if (find('comparePanel')) find('comparePanel').hidden = true; show('Select two candidates in the gallery to compare.'); }
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
      if (name === 'download' && (!target?.href || target.hidden)) { show('Select an image from the gallery before saving.'); return; }
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

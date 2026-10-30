'use strict';
function resultWasSkipped(metrics) {
  const value = metrics?.skipped;
  return value === true || (typeof value === 'string' && value.length > 0) || metrics?.cache === 'empty-mask-skip';
}
/* Standalone Canvas renderer. Uses installed fonts; no network or app globals. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CharacterBoard = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const WIDTH = 1600;
  const MAX_HEIGHT = 10000; // At most 16,000,000 canvas pixels; never shrink text to fit.
  const MARGIN = 72;
  const GAP = 40;
  const FONT = '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  const textOf = value => value == null ? '' : String(value);
  const overflow = () => new RangeError('The board exceeds the 16MP limit. Split the content or selected images into separate exports.');

  /**
   * Measure without drawing or changing the input. Only ctx.font is temporarily
   * changed, then restored. Brief fields: name, profileLabel, brief, appearance,
   * detail, detailLabel (optional), notes, palette (three #RRGGBB values).
   * Candidates: 0–2 { image?, width?, height?, label?, kind?, brief? } objects.
   * image can be a decoded image, canvas or ImageBitmap with positive dimensions.
   * Returns inspectable text lines, images, frames and swatches with pixel bounds.
   * Throws RangeError for excess selections, invalid dimensions or >16MP content.
   */
  function createBoardLayout(ctx, brief, candidateInfos) {
    if (!ctx || typeof ctx.measureText !== 'function') throw new TypeError('Canvas 2D text measurement context is required.');
    if (!brief || typeof brief !== 'object') throw new TypeError('A character brief is required.');
    if (!Array.isArray(candidateInfos)) throw new TypeError('Selected candidates must be an array.');
    if (candidateInfos.length > 2) throw new RangeError('Select up to 2 images for the board.');
    const layout = { width: WIDTH, height: 0, text: [], images: [], swatches: [], frames: [], maxPixels: WIDTH * MAX_HEIGHT };
    const savedFont = ctx.font;
    const contentWidth = WIDTH - 2 * MARGIN;
    let y = MARGIN;
    const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ko', { granularity: 'grapheme' }) : null;

    function addText(field, value, x, top, width, size = 30, weight = 400, color = '#25313b') {
      const font = `${weight} ${size}px ${FONT}`;
      ctx.font = font;
      const probe = ctx.measureText('가Ag');
      const ascent = Number.isFinite(probe.actualBoundingBoxAscent) ? probe.actualBoundingBoxAscent : size;
      const descent = Number.isFinite(probe.actualBoundingBoxDescent) ? probe.actualBoundingBoxDescent : size * 0.25;
      const lineHeight = Math.ceil(Math.max(size * 1.55, ascent + descent + size * 0.25));
      const allowedLines = Math.floor((MAX_HEIGHT - MARGIN - top) / lineHeight);
      const strings = [];
      const push = line => {
        if (strings.length >= allowedLines) throw overflow();
        strings.push(line);
      };
      for (const paragraph of textOf(value).replace(/\r\n?/g, '\n').split('\n')) {
        const characters = segmenter ? Array.from(segmenter.segment(paragraph), item => item.segment) : Array.from(paragraph);
        let line = '';
        let wordBreak = 0;
        for (const character of characters) {
          if (ctx.measureText(line + character).width <= width) {
            line += character;
            if (/\s/u.test(character)) wordBreak = line.length;
            continue;
          }
          if (!line) throw new RangeError('A character is wider than the board text area.');
          if (wordBreak > 0) {
            push(line.slice(0, wordBreak));
            line = line.slice(wordBreak);
          } else {
            push(line);
            line = '';
          }
          // A wide grapheme can still overflow the word carried to the next line.
          if (line && ctx.measureText(line + character).width > width) {
            push(line);
            line = '';
          }
          line += character;
          if (ctx.measureText(line).width > width) throw new RangeError('A character is wider than the board text area.');
          wordBreak = 0;
          for (const match of line.matchAll(/\s/gu)) wordBreak = match.index + match[0].length;
        }
        push(line);
      }
      const block = {
        field, x, y: top, width, height: strings.length * lineHeight, font, color,
        lines: strings.map((text, index) => ({ text, x, y: top + index * lineHeight, height: lineHeight, baseline: top + index * lineHeight + (lineHeight - ascent - descent) / 2 + ascent })),
      };
      layout.text.push(block);
      return block.y + block.height;
    }

    function section(field, title, value) {
      y = addText(`${field}:heading`, title, MARGIN, y, contentWidth, 23, 700, '#536474') + 12;
      y = addText(field, textOf(value) || '—', MARGIN, y, contentWidth, 30) + 40;
    }

    try {
      y = addText('brand', 'PANKEKI  /  CHARACTER BOARD', MARGIN, y, contentWidth, 22, 700, '#58706a') + 22;
      y = addText('name', textOf(brief.name) || 'Untitled character', MARGIN, y, contentWidth, 58, 700, '#172c31') + 12;
      y = addText('profileLabel', textOf(brief.profileLabel) || 'Character design', MARGIN, y, contentWidth, 27, 400, '#596772') + 32;

      const colors = Array.isArray(brief.palette) ? brief.palette : [];
      const swatchWidth = (contentWidth - 2 * GAP) / 3;
      y = addText('palette:heading', 'Color guide', MARGIN, y, contentWidth, 23, 700, '#536474') + 14;
      let paletteBottom = y;
      for (let index = 0; index < 3; index++) {
        const raw = textOf(colors[index]);
        const color = /^#[0-9a-f]{6}$/i.test(raw) ? raw : '#e5e7eb';
        const x = MARGIN + index * (swatchWidth + GAP);
        layout.swatches.push({ index, x, y, width: swatchWidth, height: 64, color });
        paletteBottom = Math.max(paletteBottom, addText(`palette:${index}`, color.toUpperCase(), x, y + 78, swatchWidth, 24, 500));
      }
      y = paletteBottom + 48;

      if (candidateInfos.length) {
        const frameWidth = (contentWidth - GAP * (candidateInfos.length - 1)) / candidateInfos.length;
        const frameHeight = candidateInfos.length === 1 ? 1000 : 840;
        const labelTop = y + frameHeight + 22;
        let rowBottom = labelTop;
        candidateInfos.forEach((candidate, index) => {
          const source = candidate.image || candidate;
          const sourceWidth = Number(source.naturalWidth ?? source.width);
          const sourceHeight = Number(source.naturalHeight ?? source.height);
          if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
            throw new RangeError('Cannot read image dimensions. Decode the image and try again.');
          }
          const frame = { index, x: MARGIN + index * (frameWidth + GAP), y, width: frameWidth, height: frameHeight };
          const scale = Math.min(frameWidth / sourceWidth, frameHeight / sourceHeight);
          const width = sourceWidth * scale;
          const height = sourceHeight * scale;
          layout.frames.push(frame);
          layout.images.push({ index, x: frame.x + (frameWidth - width) / 2, y: frame.y + (frameHeight - height) / 2, width, height, frame });
          let bottom = addText(`candidate:${index}:label`, textOf(candidate.label) || `Candidate ${index + 1}`, frame.x, labelTop, frameWidth, 28, 700);
          const kinds = { upload: 'Uploaded source', uploaded: 'Uploaded source', source: 'Source', generated: 'Generated candidate', edited: 'Masked edit' };
          const kind = candidate.request?.edit_operation === 'recolor' ? resultWasSkipped(candidate.metrics) ? 'No change' : 'Recolor' : kinds[candidate.kind] || textOf(candidate.kind);
          if (candidate.kind) bottom = addText(`candidate:${index}:kind`, kind, frame.x, bottom + 8, frameWidth, 22, 400, '#596772');
          if (candidate.brief && candidate.brief.name && candidate.brief.name !== brief.name) {
            bottom = addText(`candidate:${index}:name`, `Name at generation: ${textOf(candidate.brief.name)}`, frame.x, bottom + 8, frameWidth, 22, 400, '#596772');
          }
          rowBottom = Math.max(rowBottom, bottom);
        });
        y = rowBottom + 52;
      }

      section('brief', 'Character brief', brief.brief);
      section('appearance', 'Appearance', brief.appearance);
      section('detail', textOf(brief.detailLabel) || 'Design details', brief.detail);
      section('notes', 'Work notes', brief.notes);
      y = addText('footer', 'Pankeki · A board for exploring and sharing character concepts', MARGIN, y + 8, contentWidth, 21, 400, '#647580');
      layout.height = Math.ceil(y + MARGIN);
      if (layout.height > MAX_HEIGHT) throw overflow();
      return layout;
    } finally {
      ctx.font = savedFont;
    }
  }

  /**
   * Draw on a fresh/export canvas and return the same inspectable layout.
   * Each candidate must contain its decoded CanvasImageSource as `image`.
   * This function does not decode URLs or export files. The caller handles both.
   * Validate the complete layout before resizing the canvas; never clip content.
   */
  function drawCharacterBoard(canvas, brief, candidates) {
    if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('A Canvas is required.');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable.');
    const layout = createBoardLayout(ctx, brief, candidates);
    for (const candidate of candidates) {
      if (!candidate.image || typeof candidate.image !== 'object') throw new TypeError('The board requires decoded image objects.');
    }
    canvas.width = layout.width;
    canvas.height = layout.height;
    ctx.save();
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, layout.width, layout.height);
      ctx.lineWidth = 1;
      for (const frame of layout.frames) {
        ctx.fillStyle = '#f6f7f5';
        ctx.fillRect(frame.x, frame.y, frame.width, frame.height);
      }
      for (const image of layout.images) ctx.drawImage(candidates[image.index].image, image.x, image.y, image.width, image.height);
      ctx.strokeStyle = '#d5ddd8';
      for (const frame of layout.frames) ctx.strokeRect(frame.x, frame.y, frame.width, frame.height);
      for (const swatch of layout.swatches) {
        ctx.fillStyle = swatch.color;
        ctx.fillRect(swatch.x, swatch.y, swatch.width, swatch.height);
        ctx.strokeRect(swatch.x, swatch.y, swatch.width, swatch.height);
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.direction = 'ltr';
      for (const block of layout.text) {
        ctx.font = block.font;
        ctx.fillStyle = block.color;
        for (const line of block.lines) ctx.fillText(line.text, line.x, line.baseline);
      }
    } finally {
      ctx.restore();
    }
    return layout;
  }

  return { createBoardLayout, drawCharacterBoard };
});
const uiMessage = value => globalThis.PankekiUIStrings?.message(value) ?? String(value ?? '');
const $ = id => document.getElementById(id);
const Design = globalThis.CharacterDesign;
const session = crypto.randomUUID();
let projectActions = null;
let desktopProjectGeneration = 0;
let desktopSnapshotGeneration = 0, desktopSnapshotTuple = '', desktopSnapshotToken = '';
const desktopRequests = new Map(), desktopAppliedJobs = new Set();
const desktopAutomaticCaptures = new WeakMap();
const MAX_FILE = 64 * 1024 * 1024, MAX_IMAGE = 16 * 1024 * 1024;
let current = null, serial = 0, sourceLoaded = false, drawing = false;
let latestUrl = null, latestId = null, sourceId = null, sourceDataURL = null;
let sourceRevision = 0, maskRevision = 0, maskLoading = false, importRevision = 0;
let editEpoch = 0, importing = false, view = 'result', previewVisible = false, busy = false;
let selectedIds = [], saveTimer = null, saveQueue = Promise.resolve();
// Text edits wait longer; the export below is memoized and reused by the catalog save.
const TEXT_SAVE_DELAY = 800;
let exported = null, persistedRaw = null;
let imageModels = [], editImageModels = [], modelsReady = false, modelLoadError = '', capabilitySnapshot = null;
const modelSelections = {txt2img:'',inpaint:''};
const modelLabels = {'sdxl-base':'SDXL Base','sd-turbo':'SD Turbo','sdxl-inpaint-v01':'SDXL Inpaint v0.1','animagine-xl-4.0-opt':'Animagine XL 4.0 Opt'};
const imageModelStorageKey = 'pankeki-image-model-settings-v1', modelSelectionReasons = {txt2img:'',inpaint:''};
let dedicatedCachePrior = null, imageModelPersistenceError = '';
const generationSettingLimits = {width:[64,2048,true],height:[64,2048,true],seed:[0,Number.MAX_SAFE_INTEGER,true],steps:[1,100,true],cfg:[0,30],denoise:[.01,1],candidateCount:[1,2,true]};
const generationSettingKeys = [...Object.keys(generationSettingLimits),'negative','sampler','scheduler','cache','previewOn'];
let generationSettings = null, generationSettingsTouched = false, inpaintSettings = null;
let imageMode = $('mode').value;
let activeOperation = null;
let photoActive = null, photoSequence = 0;
const studioListeners = new Set();
let motionController = null, motionDatabase = null, motionSaveTimer = null;
let authoringV3 = null, authoringV3Selected = false, authoringV3Database = null, authoringV3Restore = null;
let authoringV3Timer = null, authoringV3Queue = Promise.resolve(), authoringV3PersistenceEpoch = 0;
function activeAuthoringV3Workspace() { return authoringV3Selected && ['motion','export'].includes(document.body.dataset.studioScreen) ? authoringV3 : null; }
let motionSaveQueue = Promise.resolve(), motionPersistenceEpoch = 0;
const canvas = $('source'), paint = $('paint'), context = paint.getContext('2d');
const clone = value => JSON.parse(JSON.stringify(value));
const briefFields = {name:'projectName', brief:'brief', appearance:'appearance', detail:'designDetail', notes:'notes', prompt:'prompt'};
function readBrief() {
  const value = {profile:$('profile').value, palette:[1,2,3].map(n => $('palette' + n).value), useBrief:$('useBrief').checked};
  for (const [key,id] of Object.entries(briefFields)) value[key] = $(id).value;
  return Design.sanitizeBrief(value);
}
let project = Design.createProject(readBrief(), [], []);
let emptyBriefSnapshot = JSON.stringify(project.brief);
let projectStatusOwner=null;
function projectStatus(message, error = false, owner = null) {
  projectStatusOwner=owner;
  $('projectStatus').textContent = message; $('projectStatus').classList.toggle('error', error);
  notifyStudio();
}
function status(message, error = false) {
  $('status').textContent = message; $('status').classList.toggle('error', error);
}
function badge(label, state = '') {
  $('resultLabel').textContent = label; $('resultLabel').className = 'result-badge' + (state ? ' ' + state : '');
}
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  const value = await response.json();
  if (!response.ok) throw Object.assign(Error(uiMessage(value.error || response.statusText)),{status:response.status});
  return value;
}
function touch() {
  if (importing) projectStatus('Starting a new project canceled the import in progress.');
  ++editEpoch; ++importRevision; importing = false;
}
function updateBrief() {
  project.brief = readBrief();
  const profile = Design.profiles[project.brief.profile];
  $('profileHelp').textContent = profile.description; $('profileDetailLabel').textContent = profile.detailLabel;
  $('profileDetailHint').textContent = profile.detailHint;
  $('compiledPrompt').textContent = Design.buildPrompt(project.brief, $('mode').value);
  notifyStudio();
}
function applyBrief(brief) {
  $('profile').value = brief.profile;
  for (const [key,id] of Object.entries(briefFields)) $(id).value = brief[key];
  brief.palette.forEach((value,index) => $('palette' + (index + 1)).value = value);
  $('useBrief').checked = brief.useBrief; updateBrief();
}
function briefChanged() { touch(); scheduleSave(TEXT_SAVE_DELAY); updateBrief(); }
for (const id of ['profile', ...Object.values(briefFields), 'palette1','palette2','palette3','useBrief']) {
  $(id).oninput = briefChanged; $(id).onchange = briefChanged;
}
$('presetExample').onclick = () => {
  const profile = $('profile').value;
  touch(); applyBrief(Design.sanitizeBrief({...Design.profiles[profile].example, profile, useBrief:true})); scheduleSave();
  status('Example settings applied. Adjust the details to create your own character.');
};
function isRecolor() { return $('mode').value === 'inpaint' && $('editOperation').value === 'recolor'; }
function syncColorInput(pickerId, textId, fromText = false) {
  const picker = $(pickerId), field = $(textId), value = fromText ? field.value.trim() : picker.value;
  const valid = typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  if (fromText && valid) picker.value = value.toUpperCase();
  if (!fromText) field.value = valid ? value.toUpperCase() : value;
  field.setAttribute('aria-invalid', String(!valid));
  return valid;
}
function applyEditRequest(request = {}) {
  request ||= {};
  const recolor = request.edit_operation === 'recolor';
  $('editOperation').value = recolor ? 'recolor' : 'regenerate';
  $('targetColor').value = recolor ? request.target_color : '#D95D39';
  $('sourceColorMode').value = recolor && request.source_color !== null ? 'manual' : 'auto';
  $('sourceColor').value = recolor && request.source_color ? request.source_color : '#385C59';
  syncColorInput('targetColor', 'targetColorValue');
  syncColorInput('sourceColor', 'sourceColorValue');
  $('colorTolerance').value = String(recolor ? request.color_tolerance : 35);
  if (recolor) $('feather').value = String(request.feather);
}
function renderView() {
  if (photoActive && !photoCurrent(photoActive) && !photoActive.canceling) void photoCancel(photoActive.token).catch(()=>status('Could not confirm image task cancellation. Cancel again.',true));
  const recolor = isRecolor();
  $('generate').disabled = recolor ? busy || !sourceLoaded || maskLoading || importing || capabilitySnapshot?.source==='snapshot'&&!Design.capabilityOperation(capabilitySnapshot,'recolor').ready : !modelsReady || !selectedImageModel($('mode').value);
  $('imageModel').disabled = !modelsReady || imageModelSettingsBusy();
  $('resetModelPreset').disabled = imageModelSettingsBusy() || !selectedImageModel($('mode').value);
  $('inpaintOperations').hidden = $('mode').value !== 'inpaint';
  $('recolorOptions').hidden = !recolor;
  $('sourceColorField').hidden = !recolor || $('sourceColorMode').value !== 'manual';
  $('colorToleranceValue').textContent = $('colorTolerance').value || '35';
  for (const id of ['editOperation', 'targetColor', 'targetColorValue', 'sourceColorMode', 'sourceColor', 'sourceColorValue', 'colorTolerance']) $(id).disabled = busy;
  const showSource = view === 'source' && sourceLoaded, showPreview = view === 'result' && previewVisible;
  const showResult = view === 'result' && !showPreview && latestUrl !== null;
  $('editor').hidden = !showSource; $('editorTools').hidden = !showSource; $('sourceView').hidden = !sourceLoaded;
  for (const id of ['sourceView','resultView']) {
    const active = view === (id === 'sourceView' ? 'source' : 'result');
    $(id).classList.toggle('active', active); $(id).setAttribute('aria-pressed', String(active));
  }
  $('preview').hidden = !showPreview; $('previewTag').hidden = !showPreview;
  $('result').hidden = !showResult; $('empty').hidden = showSource || showPreview || showResult;
  $('useResult').hidden = !showResult;
  const shown = showPreview ? $('preview') : showResult ? $('result') : null;
  $('canvasSize').textContent = showSource ? `${canvas.width} × ${canvas.height}` : shown?.naturalWidth ? `${shown.naturalWidth} × ${shown.naturalHeight}` : `${$('width').value} × ${$('height').value}`;
  $('canvasHint').textContent = showSource ? 'Only brightly painted areas are edited. Areas outside the selection are preserved.' : busy ? 'Generating candidates in sequence. Previews may differ from the final image.' : showResult ? 'Compare candidates and continue editing your chosen design.' : 'Enter a brief or import a source image to begin.';
  $('generateLabel').textContent = recolor ? busy ? 'Applying color' : 'Apply color' : busy ? 'Generate with a new request' : $('mode').value === 'inpaint' ? 'Edit selected area' : 'Generate character candidates';
  $('cancel').hidden = !busy; $('cancel').disabled = !busy;
  if ($('emptyHeading')) $('emptyHeading').textContent = $('mode').value === 'inpaint' ? 'Import a source image to edit first.' : 'Start with an idea, even without a name.';
  if ($('emptyDescription')) $('emptyDescription').textContent = $('mode').value === 'inpaint' ? 'Upload an image or choose Continue editing on a candidate, then paint the areas to change.' : 'Describe the personality and appearance to create your first candidate. You can also import and refine an existing character.';
  notifyStudio();
}
function setMode(value) {
  const previous = imageMode, changed = previous !== value;
  if (changed && previous === 'txt2img') persistImageModelSettings();
  if (changed && previous === 'inpaint') {
    // Keep edit controls in memory only; the shared form must not become the generation snapshot.
    inpaintSettings = {values:Object.fromEntries(generationSettingKeys.map(key => [key,
      ['cache','previewOn'].includes(key) ? $(key).checked : $(key).value])),
      modelId:modelSelections.inpaint,cachePrior:dedicatedCachePrior};
  }
  imageMode = value; $('mode').value = value; const editing = value === 'inpaint';
  syncModelOptions(value);
  if (changed && !editing && generationSettings) applyGenerationSettings(generationSettings);
  if (changed && editing && inpaintSettings) {
    applyGenerationSettings(inpaintSettings.values);
    dedicatedCachePrior = inpaintSettings.modelId === modelSelections.inpaint ? inpaintSettings.cachePrior : null;
  }
  if (changed) updateModelHelp();
  document.querySelectorAll('[data-mode]').forEach(button => {
    const active = button.dataset.mode === value;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  $('modeTitle').textContent = editing ? 'Edit only what you need' : 'Create character candidates';
  $('modeDescription').textContent = editing ? 'Paint only the areas to change in the selected design.' : 'Explore designs from your brief and colors.';
  $('workspaceMode').textContent = editing ? 'Masked edit' : 'Candidate generation';
  $('canvasHeading').textContent = editing ? 'Refine the selected character.' : 'Create your own character.';
  $('roiOptions').hidden = !editing; view = editing ? 'source' : 'result'; updateBrief(); renderView();
}
function clearMask() {
  ++maskRevision; maskLoading = false; context.fillStyle = 'black'; context.fillRect(0,0,paint.width,paint.height);
}
function stopBatch() {
  ++serial; const id = current; current = null; busy = false; activeOperation = null; previewVisible = false; renderView();
  return id ? api('/api/jobs/' + id + '/cancel',{}).catch(() => null) : Promise.resolve();
}
async function cancel() {
  const recolor = activeOperation === 'recolor';
  const pending = stopBatch(); badge('Canceled');
  status(recolor ? 'Recolor canceled.' : 'Remaining candidate generation canceled. GPU work already started may continue.'); await pending;
}
async function decodeImage(url) {
  const image = new Image(); image.src = url; await image.decode();
  const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
  if (!width || !height || width * height > 16777216) throw Error('Images up to 16MP can be imported.');
  return image;
}
async function readDataURL(url) {
  if (url.startsWith('data:')) {
    if (url.length > MAX_IMAGE) throw Error('Base64 image data must be 16MiB or smaller.');
    return url;
  }
  const response = await fetch(url);
  if (!response.ok) throw Error('Could not load the source image.');
  const blob = await response.blob();
  if (blob.size > MAX_IMAGE * .75) throw Error('The image file is too large. Base64 storage is limited to 16MiB.');
  const data = await new Promise((resolve,reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || Error('Could not read the image file.')); reader.readAsDataURL(blob);
  });
  if (typeof data !== 'string' || data.length > MAX_IMAGE) throw Error('Base64 image storage is limited to 16MiB.');
  return data;
}
function commitSource(image,data,parentId) {
  canvas.width = paint.width = image.naturalWidth || image.width;
  canvas.height = paint.height = image.naturalHeight || image.height;
  canvas.getContext('2d').drawImage(image,0,0); clearMask();
  sourceDataURL = data; sourceLoaded = true; sourceId = parentId;
}
async function loadSource(url,{parentId = null,record = false} = {}) {
  if (record && project.versions.length >= 20) throw Error('Up to 20 candidates are supported. Save this project and start a new one.');
  if (parentId && !project.versions.some(item => item.id === parentId)) throw Error('The candidate to edit is not in the current project.');
  motionController?.suspend();
  touch(); void stopBatch(); const token = ++sourceRevision, snapshot = readBrief();
  const previous = {sourceDataURL,sourceLoaded:sourceDataURL !== null,sourceId};
  sourceLoaded = false; drawing = false; ++maskRevision; maskLoading = false; renderView();
  try {
    const image = await decodeImage(url); if (token !== sourceRevision) return false;
    const data = await readDataURL(url); if (token !== sourceRevision) return false;
    if (record) {
      const item = {id:crypto.randomUUID(),createdAt:new Date().toISOString(),label:'업로드 원본',image:data,kind:'upload',brief:snapshot,request:{mode:'txt2img',prompt:''},parentId:null,metrics:{}};
      project = Design.createProject(readBrief(),[...project.versions,item],project.selectionHistory); parentId = item.id;
    }
    commitSource(image,data,parentId);
    if (record) { renderGallery(); scheduleSave(); }
    renderView(); return true;
  } catch (error) {
    if (token !== sourceRevision) return false;
    ({sourceDataURL,sourceLoaded,sourceId} = previous); renderView(); throw error;
  }
}
$('mode').onchange = () => { touch(); setMode($('mode').value); };
document.querySelectorAll('[data-mode]').forEach(button => button.onclick = () => { touch(); setMode(button.dataset.mode); });
$('sourceView').onclick = () => { touch(); setMode('inpaint'); };
$('resultView').onclick = () => { touch(); view = 'result'; renderView(); };
$('result').onload = $('preview').onload = renderView;
for (const id of ['width','height','seed','steps','cfg','denoise','halo','feather','candidateCount','negative','cache','roi','previewOn','sampler','scheduler']) $(id).oninput = () => {
  touch();
  if (generationSettingKeys.includes(id) && imageMode === 'txt2img') {
    generationSettingsTouched = true;
    persistImageModelSettings();
  }
  renderView();
};
for (const id of ['editOperation', 'sourceColorMode', 'colorTolerance']) {
  $(id).oninput = $(id).onchange = () => {
    touch();
    if (id === 'editOperation' && isRecolor() && !busy) status('Replaces similar colors within the selected area.');
    renderView();
  };
}
for (const [pickerId, textId] of [['targetColor', 'targetColorValue'], ['sourceColor', 'sourceColorValue']]) {
  $(pickerId).oninput = $(pickerId).onchange = () => { touch(); syncColorInput(pickerId, textId); renderView(); };
  $(textId).oninput = $(textId).onchange = event => {
    touch();
    const valid = syncColorInput(pickerId, textId, true);
    if (valid && event.type === 'change') $(textId).value = $(pickerId).value.toUpperCase();
    renderView();
  };
}
$('upload').onchange = async () => {
  const file = $('upload').files[0]; if (!file) return;
  const url = URL.createObjectURL(file);
  try { if (await loadSource(url,{record:true})) { setMode('inpaint'); status('Source saved in the candidate list. Paint the areas to edit with the brush.'); } }
  catch (error) { status(uiMessage(error.message),true); }
  finally { URL.revokeObjectURL(url); $('upload').value = ''; }
};
$('maskUpload').onchange = async () => {
  const file = $('maskUpload').files[0]; if (!file) return;
  if (!sourceLoaded) { status('Import a source image first.',true); $('maskUpload').value = ''; return; }
  touch(); const token = ++maskRevision, sourceToken = sourceRevision;
  const url = URL.createObjectURL(file), isCurrent = () => token === maskRevision && sourceToken === sourceRevision;
  maskLoading = true; drawing = false;
  try {
    const image = await decodeImage(url); if (!isCurrent()) return;
    if ((image.naturalWidth || image.width) !== paint.width || (image.naturalHeight || image.height) !== paint.height) throw Error('The mask and source must have matching dimensions.');
    context.fillStyle = 'black'; context.fillRect(0,0,paint.width,paint.height); context.drawImage(image,0,0);
    status('Mask imported. Bright areas will be edited.');
  } catch (error) { if (isCurrent()) status(uiMessage(error.message),true); }
  finally { if (isCurrent()) {maskLoading = false;renderView();} URL.revokeObjectURL(url); $('maskUpload').value = ''; }
};
$('clearMask').onclick = () => { touch(); clearMask(); status('Edit mask cleared. The source image is unchanged.'); renderView(); };
$('brush').oninput = () => { $('brushValue').value = $('brush').value; };
function chooseTool(erase) {
  $('erase').checked = erase;
  for (const [id,active] of [['brushTool',!erase],['eraserTool',erase]]) { $(id).classList.toggle('selected',active); $(id).setAttribute('aria-pressed',String(active)); }
}
$('brushTool').onclick = () => chooseTool(false); $('eraserTool').onclick = () => chooseTool(true);
function stroke(event,start) {
  const box = paint.getBoundingClientRect();
  const x = (event.clientX - box.left) * paint.width / box.width, y = (event.clientY - box.top) * paint.height / box.height;
  context.strokeStyle = context.fillStyle = $('erase').checked ? 'black' : 'white';
  context.lineWidth = Number($('brush').value); context.lineCap = 'round'; context.lineJoin = 'round';
  if (start) { context.beginPath(); context.arc(x,y,context.lineWidth / 2,0,Math.PI * 2); context.fill(); context.beginPath(); context.moveTo(x,y); }
  else { context.lineTo(x,y); context.stroke(); }
}
paint.onpointerdown = event => {
  if (!sourceLoaded) return;
  touch(); ++maskRevision; maskLoading = false; drawing = true; paint.setPointerCapture(event.pointerId); stroke(event,true);notifyStudio('mask');
};
paint.onpointermove = event => { if (drawing) stroke(event,false); };
paint.onpointerup = paint.onpointercancel = () => { drawing = false;notifyStudio('mask'); };
function displayError(message) {
  return String(message).includes('Pankeki source changed') ? 'App code changed. Restart the Pankeki generation server before generating.' : uiMessage(message);
}
function inpaintSnapshot() {
  if (!sourceLoaded) throw Error('Import the source image to edit first.');
  if (maskLoading) throw Error('The mask is loading. Try again shortly.');
  return { source: sourceDataURL, mask: paint.toDataURL('image/png') };
}
function requestSnapshot(brief, mode = $('mode').value) {
  if (mode === 'inpaint' && !['', 'regenerate', 'recolor'].includes($('editOperation').value)) throw Error('Select a masked edit operation.');
  if (mode === 'inpaint' && $('editOperation').value === 'recolor') {
    const inputs = inpaintSnapshot(), target = $('targetColorValue').value.trim();
    if (typeof target !== 'string' || !/^#[0-9a-f]{6}$/i.test(target)) throw Error('Select a target color in #RRGGBB format.');
    const sourceMode = $('sourceColorMode').value || 'auto';
    if (!['auto', 'manual'].includes(sourceMode)) throw Error('Check the source color selection method.');
    const source = sourceMode === 'manual' ? $('sourceColorValue').value.trim() : null;
    if (source !== null && (typeof source !== 'string' || !/^#[0-9a-f]{6}$/i.test(source))) throw Error('Select a source color in #RRGGBB format.');
    const tolerance = Number($('colorTolerance').value), feather = Number($('feather').value);
    if (!$('colorTolerance').value.trim() || !Number.isFinite(tolerance) || tolerance < 0 || tolerance > 90) throw Error('Set the color tolerance from 0 to 90.');
    if (!$('feather').value.trim() || !Number.isSafeInteger(feather) || feather < 0 || feather > 64) throw Error('Enter an integer from 0 to 64 for feathering.');
    return { mode: 'inpaint', edit_operation: 'recolor', target_color: target.toUpperCase(), source_color: source === null ? null : source.toUpperCase(), color_tolerance: tolerance, feather, ...inputs };
  }
  const model = selectedImageModel(mode);
  if (!modelsReady || !model) throw Error(modelLoadError || (mode === 'inpaint' ? 'Select an available masked edit model first.' : 'Select an available image generation model first.'));
  const request = {model_id:model.id,mode,prompt:Design.buildPrompt(brief,mode,model.id),negative:$('negative').value,cache:model.id==='sdxl-inpaint-v01'?false:$('cache').checked,roi:$('roi').checked,preview:$('previewOn').checked,sampler:$('sampler').value,scheduler:$('scheduler').value};
  const limits = {seed:[0,Number.MAX_SAFE_INTEGER,true],steps:[1,100,true],width:[64,2048,true],height:[64,2048,true],cfg:[0,30],denoise:[.01,1],halo:[0,512,true],feather:[0,64,true]};
  for (const [key,[min,max,integer]] of Object.entries(limits)) {
    const text = $(key).value, value = Number(text);
    if (text.trim() === '' || !Number.isFinite(value) || value < min || value > max || integer && !Number.isSafeInteger(value)) throw Error(`${key}: enter ${integer ? 'an integer' : 'a number'} from ${min} to ${max}.`);
    request[key] = value;
  }
  if (request.width % 8 || request.height % 8) throw Error('Image dimensions must be multiples of 8.');
  if (request.mode === 'inpaint') {
    Object.assign(request, inpaintSnapshot());
  }
  return request;
}
function summaryMetrics(value = {}) {
  const result = {};
  for (const key of ['kind','cache','total_s','model_calls','outside_mask_max_error','outside_alpha_max_error','roi_used','skipped']) {
    const item = value[key];
    if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item) || typeof item === 'string' && item.length <= 240) result[key] = item;
  }
  return result;
}
async function poll(id,token,index,count) {
  let lastPreview = null, failures = 0;
  while (token === serial) {
    let job;
    try { job = await api('/api/jobs/' + id); failures = 0; }
    catch (error) {
      if (token !== serial) return null;
      if (++failures >= 5) throw Error('Check the server connection. Further generation stopped because the result status could not be verified.');
      status('Rechecking connection: ' + uiMessage(error.message),true);
      await new Promise(resolve => setTimeout(resolve,500)); continue;
    }
    if (token !== serial) return null;
    if (!job.is_current) throw Error('Candidate generation stopped because another request started.');
    status(activeOperation === 'recolor' ? 'Recoloring…' : `Candidate ${index + 1}/${count} · ${job.state === 'queued' ? 'Waiting in the generation queue.' : 'Generating image.'}`);
    if (job.preview != null && job.preview !== lastPreview && !['succeeded','failed','canceled','uncertain','orphaned'].includes(job.state)) {
      lastPreview = job.preview; $('preview').src = '/api/previews/' + id + '?v=' + encodeURIComponent(lastPreview);
      previewVisible = true; badge('Preview','busy'); renderView();
    }
    if (job.state === 'succeeded') return job.result;
    if (['failed','canceled','uncertain','orphaned'].includes(job.state)) throw Error(uiMessage(job.error) || {failed:'Generation failed',canceled:'Generation canceled.',uncertain:'Generation status needs verification.',orphaned:'The server restarted, so the previous task was not resubmitted automatically. Check the result status.'}[job.state]);
    await new Promise(resolve => setTimeout(resolve,250));
  }
  return null;
}
async function generate() {
  let token, completed = 0;
  try {
    if (photoActive) throw Error('Apply or cancel the photo edit before generating.');
    const recolor = isRecolor();
    if (!recolor) await modelCatalogReady;
    if (importing) throw Error('Project import in progress. Generate shortly.');
    const brief = readBrief(), count = recolor ? 1 : Number($('candidateCount').value);
    const snapshot = requestSnapshot(brief), requests = recolor ? [snapshot] : Design.makeRequests(snapshot,count);
    if (project.versions.length + count > 20) throw Error('Up to 20 candidates are supported. Save and start a new project, or reduce the candidate count.');
    const parentId = requests[0].mode === 'inpaint' ? sourceId : null;
    touch(); void stopBatch(); token = ++serial; busy = true; activeOperation = recolor ? 'recolor' : 'regenerate'; view = 'result'; badge(recolor ? 'Recoloring' : 'Generating','busy'); renderView();
    for (let index = 0; index < requests.length; index++) {
      if (token !== serial) return false;
      status(recolor ? 'Preparing recolor…' : `Preparing candidate ${index + 1}/${count}…`);
      const request = requests[index], job = await api('/api/jobs',{session,request:{...request,trace_id:crypto.randomUUID()}});
      if (token !== serial) { await api('/api/jobs/' + job.job_id + '/cancel',{}).catch(() => null); return false; }
      current = job.job_id;
      const result = await poll(current,token,index,count);
      if (!result || token !== serial) return false;
      const data = await readDataURL(result.image_url); if (token !== serial) return false;
      await decodeImage(data); if (token !== serial) return false;
      const metrics = summaryMetrics(result.metrics);
      const label = recolor ? `색상 변경 ${project.versions.filter(v => v.request?.edit_operation === 'recolor').length + 1}` : `후보 ${project.versions.filter(v => v.kind === 'generated').length + 1}`;
      const item = {id:crypto.randomUUID(),createdAt:new Date().toISOString(),label,image:data,kind:'generated',brief,request,parentId,metrics,...(Design.executionFromResult(result,data)?{execution:Design.executionFromResult(result,data)}:{})};
      project = Design.createProject(readBrief(),[...project.versions,item],project.selectionHistory);
      ++completed; ++editEpoch; current = null; previewVisible = false;
      showCandidate(item); renderGallery(); scheduleSave(); $('metrics').textContent = JSON.stringify(result.metrics || {},null,2);
    }
    if (token === serial) {
      const reused = project.versions.slice(-completed).filter(item => item.metrics.cache === 'hit').length;
      const copied = project.versions.slice(-completed).filter(item => item.metrics.cache === 'empty-mask-skip').length;
      const unchanged = recolor && resultWasSkipped(project.versions.at(-1).metrics);
      badge(unchanged ? 'No change' : copied === completed ? 'Source copy · No edit area' : recolor ? 'Color applied' : 'Candidates ready');
      status(recolor ? unchanged ? 'Check the selection and source color. A candidate with no changes was saved.' : 'Color applied. Saved 1 candidate.' : `${completed} candidates ready.${reused ? ` ${reused} reused a matching completed result.` : ''}${copied ? ` ${copied} were source copies with no edit area; inference was not run.` : ''} Select candidates to compare.`);
    }
    return true;
  } catch (error) {
    if (token === undefined || token === serial) {
      status((completed ? `${completed} candidates were saved. ` : '') + displayError(uiMessage(error.message)),true);
      if (token !== undefined) badge(activeOperation === 'recolor' ? 'Recolor stopped' : 'Generation stopped','failure');
    }
    return false;
  } finally { if (token !== undefined && token === serial) { current = null; busy = false; activeOperation = null; previewVisible = false; renderView(); } }
}
function kindLabel(item) {
  if(item.request?.mode==='img2img')return 'Recompose with reference image';
  if (item.kind === 'upload') return 'Uploaded source';
  if (item.kind === 'derived') return {markup:'Markup',resize:'Resize','background-remove':'Remove background',erase:'Erase object'}[item.derivation.operation];
  if (item.request?.edit_operation === 'recolor' && resultWasSkipped(item.metrics)) return 'No change';
  if (item.metrics.cache === 'empty-mask-skip') return 'Source copy · No edit area';
  if (item.request?.edit_operation === 'recolor') return 'Recolor';
  return item.kind === 'generated' ? (item.metrics.cache === 'hit' ? 'Generated result · Reused' : 'Generated result') : 'Imported image';
}
function showCandidate(item) {
  latestId = item.id; latestUrl = item.image; $('result').src = item.image;
  $('result').alt = item.label + ' · ' + kindLabel(item); $('download').href = item.image; $('download').hidden = false;
  const ext = item.image.startsWith('data:image/jpeg') ? 'jpg' : item.image.startsWith('data:image/webp') ? 'webp' : 'png';
  $('download').download = 'pankeki-' + item.id + '.' + ext; previewVisible = false; view = 'result'; badge(kindLabel(item)); renderView();
}
function recordSelection(id,action) {
  const history = [...project.selectionHistory,{candidateId:id,action,at:new Date().toISOString()}];
  project = Design.createProject(readBrief(),project.versions,history); touch(); scheduleSave();
}
async function editCandidate(item) {
  if (project.selectionHistory.length >= 1000) throw Error('Selection history reached 1,000 entries. Save and start a new project.');
  if (await loadSource(item.image,{parentId:item.id})) {
    applyEditRequest(item.request);
    recordSelection(item.id,'edit'); setMode('inpaint'); renderGallery();
    status('Using the selected candidate as the edit source. Paint the areas to change and add instructions.');
  }
}
function element(tag,text,className) {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text;
  if (className) node.className = className; return node;
}
function button(text,action) {
  const node = element('button',text); node.type = 'button';
  node.onclick = async () => { try { await action(); } catch (error) { status(uiMessage(error.message),true); } }; return node;
}
function renderGallery() {
  const focused = document.activeElement, focusedAction = focused?.dataset?.action;
  let focusedCard = focused?.parentNode;
  while (focusedCard && focusedCard !== $('gallery') && !focusedCard.dataset?.candidateId) focusedCard = focusedCard.parentNode;
  const focusedId = focusedCard?.dataset?.candidateId;
  let focusTarget = null;
  $('gallery').replaceChildren(); $('galleryEmpty').hidden = project.versions.length > 0;
  $('selectionCount').textContent = `${selectedIds.length}/2 selected · ${project.versions.length}/20 saved`;
  $('compareSelected').disabled = selectedIds.length !== 2;
  for (const [index,item] of project.versions.entries()) {
    const card = element('article',undefined,'candidate-card'); card.dataset.candidateId = item.id;
    card.classList.toggle('selected',selectedIds.includes(item.id)); card.classList.toggle('active',latestId === item.id);
    const title=`Candidate ${index+1} · ${item.label}`;
    const image = element('img'); image.src = item.image; image.alt = title; image.loading = 'lazy';
    const info = element('div',undefined,'candidate-info');
    info.append(element('strong',title),element('span',kindLabel(item)),element('span',Design.profiles[item.brief.profile].label),element('small',new Date(item.createdAt).toLocaleString('en-US')));
    if (item.kind === 'generated' && item.request.model_id) info.append(element('small',`${modelLabels[item.request.model_id] || item.request.model_id} · ${item.request.steps} steps · CFG ${item.request.cfg}`));
    if (item.parentId) info.append(element('small','Edit source: ' + (project.versions.find(v => v.id === item.parentId)?.label || item.parentId)));
    const actions = element('div',undefined,'candidate-actions');
    const select = button(selectedIds.includes(item.id) ? 'Remove from comparison' : 'Add to comparison',() => {
      if (selectedIds.includes(item.id)) { selectedIds = selectedIds.filter(id => id !== item.id); touch(); }
      else {
        if (selectedIds.length >= 2) throw Error('Compare up to two candidates. Deselect one first.');
        recordSelection(item.id,'compare'); selectedIds.push(item.id);
      }
      $('comparePanel').hidden = true; renderGallery();
    });
    select.setAttribute('aria-pressed',String(selectedIds.includes(item.id)));
    const controls = {
      view:button('View larger',() => { recordSelection(item.id,'view'); void stopBatch(); showCandidate(item); renderGallery(); }),
      edit:button('Continue editing',() => editCandidate(item)),
      compare:select
    };
    for (const [action,control] of Object.entries(controls)) {
      control.dataset.action = action;
      control.setAttribute('aria-label',title+' '+control.textContent);
      if (item.id === focusedId && action === focusedAction) focusTarget = control;
      actions.append(control);
    }
    card.append(image,info,actions); $('gallery').append(card);
  }
  if (project.selectionHistory.length) {
    const details = element('details',undefined,'selection-history'); details.append(element('summary',`Selection history · ${project.selectionHistory.length}`));
    const list = element('ol');
    for (const entry of project.selectionHistory) {
      const item = project.versions.find(v => v.id === entry.candidateId);
      list.append(element('li',`${item.label} · ${{view:'View',edit:'Select edit source',compare:'Add to comparison'}[entry.action]} · ${new Date(entry.at).toLocaleString('en-US')}`));
    }
    details.append(list); $('gallery').append(details);
  }
  if (focusTarget) focusTarget.focus({preventScroll:true});
  notifyStudio();
}
$('compareSelected').onclick = () => {
  if (selectedIds.length !== 2) return;
  $('compareGrid').replaceChildren();
  for (const id of selectedIds) {
    const item = project.versions.find(v => v.id === id), figure = element('figure');
    const image = element('img'); image.src = item.image; image.alt = item.label;
    image.style.width = '100%'; image.style.height = 'auto'; image.style.objectFit = 'contain';
    const settings = item.kind === 'derived' ? kindLabel(item) : item.request?.edit_operation === 'recolor' ? `Target color ${item.request.target_color}` : `seed ${item.request?.seed ?? '—'}`;
    figure.append(image,element('figcaption',`${item.label} · ${kindLabel(item)} · ${settings}`),button('Edit this candidate',() => editCandidate(item))); $('compareGrid').append(figure);
  }
  $('comparePanel').hidden = false; $('comparePanel').setAttribute('tabindex','-1'); $('comparePanel').focus();
};
$('closeCompare').onclick = () => { $('comparePanel').hidden = true; $('compareSelected').focus(); };
$('comparePanel').onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); $('closeCompare').onclick(); } };
function hasWork() {
  const motion = motionController?.getSummary();
  return busy || sourceLoaded || project.versions.length > 0 || motion?.dirty || motion?.partCount > 0 || JSON.stringify(readBrief()) !== emptyBriefSnapshot;
}
// Candidates are replaced, never mutated in place, so array identity plus the
// brief text identifies an export that was already validated and serialized.
function exportProject() {
  const brief = readBrief(), key = JSON.stringify(brief);
  if (exported && exported.versions === project.versions && exported.history === project.selectionHistory && exported.key === key) return exported.raw;
  const record = Design.createProjectRecord(brief,project.versions,project.selectionHistory);
  exported = {versions:project.versions,history:project.selectionHistory,key,raw:record.raw,project:record.project}; return record.raw;
}
function validatedProject(raw) { return exported && typeof raw === 'string' && exported.raw === raw ? exported.project : null; }
function downloadBlob(blob,name) {
  const url = URL.createObjectURL(blob), link = element('a'); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
}
function downloadImage(event) {
  const link = event.currentTarget, prefix = 'data:image/png;base64,';
  if (typeof link.href !== 'string' || !link.href.startsWith(prefix)) return;
  event.preventDefault();
  try {
    const bytes = Uint8Array.from(atob(link.href.slice(prefix.length)), char => char.charCodeAt(0));
    downloadBlob(new Blob([bytes], {type:'image/png'}), link.download);
  } catch (error) { status('Image save failed: ' + uiMessage(error.message), true); }
}
$('download').addEventListener('click', downloadImage);
function safeName(brief = readBrief()) { return (brief.name || 'pankeki-character').replace(/[<>:"/\\|?*\u0000-\u001F]/g,'_').slice(0,80); }
$('saveProject').onclick = async () => {
  try {
    const precise = activeAuthoringV3Workspace();
    if (precise) { downloadBlob(new Blob([await precise.saveProject()],{type:'application/json'}),safeName() + '.rigging.v3.json'); projectStatus('Precision rigging project saved.'); return; }
    const motion = motionController?.getSummary();
    if (motion && (motion.isMotionProject || motion.dirty || motion.partCount > 0)) {
      downloadBlob(new Blob([await motionController.saveProject()],{type:'application/json'}),safeName() + '.motion.v2.json');
      projectStatus('Motion v2 project saved. Previous undo history is not restored when reopening.'); return;
    }
    const raw=exportProject();
    await persistCurrentProject(raw);
    const catalog=projectActions?await projectActions.saveCurrent():true;
    if(catalog===false)throw Error('Could not save the project to the app list. Your current work is preserved.');
    downloadBlob(new Blob([raw],{type:'application/json'}),safeName() + '.pankeki.json');
    projectStatus(catalog==='unavailable'?'Project file exported. App list storage is unavailable, so the project was not saved to the list.':'Project file exported with its brief, candidate images, and selection history.',catalog==='unavailable');
  }
  catch (error) { projectStatus('Save failed: ' + uiMessage(error.message),true); }
};
async function importProject(raw,{restore = false} = {}) {
  let token;
  try {
    if (typeof raw === 'string' && (raw.length > MAX_FILE || new TextEncoder().encode(raw).length > MAX_FILE)) throw Error('Project files must be 64MiB or smaller.');
    const incoming = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const formatField = Object.getOwnPropertyDescriptor(incoming || {},'format');
    if (formatField && !Object.hasOwn(formatField,'value')) throw Error('Project fields cannot use accessors.');
    if (formatField?.value === 'pankeki-cubism-session') throw Error('Live2D session files are no longer supported.');
    const versionField = Object.getOwnPropertyDescriptor(incoming || {},'version');
    if (versionField && !Object.hasOwn(versionField,'value')) throw Error('Project fields cannot use accessors.');
    const version = versionField?.value;
    if (version === 3 && formatField?.value === 'pankeki-authoring') return await openAuthoringV3(raw);
    if (version === 2) {
      if (!motionController) throw Error('Motion editor unavailable.');
      if (!restore && hasWork() && !confirm('Replace the current project with a motion v2 file? Save any work you need first.')) return false;
      if (authoringV3Selected && authoringV3?.getSummary().loaded) { const rawV3=await authoringV3.snapshotProject(), db=await authoringV3Database; if(db) await storage(db,true,rawV3); authoringV3Restore=Promise.resolve(rawV3); }
      void stopBatch(); ++sourceRevision; ++maskRevision; ++importRevision; ++motionPersistenceEpoch;
      motionController.suspend();
      const loaded = await motionController.loadDocument(raw);
      if (loaded) { authoringV3Selected=false; document.body.dataset.nativeAuthoring='v2'; ++authoringV3PersistenceEpoch; clearTimeout(authoringV3Timer); authoringV3?.suspend?.(); projectStatus('Motion v2 loaded. Previous undo history is not restored.'); notifyStudio('motion-import'); scheduleMotionSave(); }
      return loaded;
    }
    const next = Design.parseProject(raw);
    if (!restore && hasWork() && !confirm('Replace the current work with the imported project? Unsaved work will be lost. Cancel and save a project file first if needed.')) return false;
    if (!restore) { touch(); generationSettingsTouched = true; }
    // The legacy confirmation also authorizes replacing the active motion scene.
    if (!restore) { ++motionPersistenceEpoch; motionController?.suspend(); }
    token = ++importRevision; const epoch = editEpoch; importing = true;
    // A confirmed import supersedes earlier jobs/uploads even during decoding.
    // Keep committed images and masks untouched until every imported image passes.
    void stopBatch(); ++sourceRevision; ++maskRevision; maskLoading = false; drawing = false;
    sourceLoaded = sourceDataURL !== null; renderView();
    projectStatus('Checking images in the imported project…');
    const active = () => token === importRevision && epoch === editEpoch;
    const chosenId = next.selectionHistory.at(-1)?.candidateId;
    const item = next.versions.find(v => v.id === chosenId) || next.versions.at(-1);
    let chosenImage = null; const decodedCandidates=new Map();
    for (const candidate of next.versions) {
      const decoded = await decodeImage(candidate.image);
      if (!active()) return false;
      decodedCandidates.set(candidate.id,{width:decoded.naturalWidth,height:decoded.naturalHeight});
      if (candidate.id === item?.id) chosenImage = decoded;
    }
    for(const candidate of next.versions.filter(value=>value.kind==='derived')){
      const d=candidate.derivation,decoded=decodedCandidates.get(candidate.id),parent=next.versions.find(value=>value.id===d.sourceId),source=decodedCandidates.get(d.sourceId);
      if(decoded.width!==d.outputWidth||decoded.height!==d.outputHeight||source.width!==d.inputWidth||source.height!==d.inputHeight||await photoSha(parent.image)!==d.sourceSha256)throw Error('The derived image source hash or actual dimensions do not match the document.');
      if(!active())return false;
    }
    if (!active()) return false;
    void stopBatch(); ++sourceRevision; ++maskRevision; drawing = false; maskLoading = false;
    sourceDataURL = null; sourceId = null; sourceLoaded = false; latestUrl = null; latestId = null; selectedIds = [];
    project = next; applyBrief(next.brief); $('comparePanel').hidden = true; $('download').hidden = true;
    applyEditRequest(item?.request);
    if (item) { commitSource(chosenImage,item.image,item.id); showCandidate(item); }
    else { clearMask(); $('result').removeAttribute('src'); badge('Ready'); }
    setMode('txt2img'); renderGallery(); ++editEpoch;
    projectStatus(restore ? 'Previous work restored automatically. Repaint the edit mask.' : 'Project loaded. Repaint the edit mask.');
    if (!restore) { await persistCurrentProject(exportProject()); void replaceMotionWithLegacy(); }
    notifyStudio(restore ? 'restore' : 'import'); return true;
  } catch (error) { if (token === undefined || token === importRevision) projectStatus('Import failed: ' + uiMessage(error.message),true); return false; }
  finally { if (token === importRevision) { importing = false; renderView(); } }
}
$('loadProject').onchange = async () => {
  const file = $('loadProject').files[0]; if (!file) return;
  touch(); const token = ++importRevision;
  try {
    if (file.size > MAX_FILE) throw Error('Project files must be 64MiB or smaller.');
    const raw = await file.text(); if (token !== importRevision) return; await requestImportProject(raw);
  } catch (error) { if (token === importRevision) projectStatus(uiMessage(error.message),true); }
  finally { $('loadProject').value = ''; }
};
function resetProject() {
  if (hasWork() && !confirm('Start a new project? Unsaved work will be lost. Cancel and save a project file first if needed.')) return false;
  ++motionPersistenceEpoch; motionController?.suspend();
  touch(); void stopBatch(); ++sourceRevision; clearMask(); drawing = false;
  project = Design.createProject(Design.sanitizeBrief({}),[],[]);
  applyEditRequest();
  emptyBriefSnapshot = JSON.stringify(project.brief);
  sourceLoaded = false; sourceDataURL = null; sourceId = null; latestUrl = null; latestId = null; selectedIds = [];
  $('result').removeAttribute('src'); $('preview').removeAttribute('src'); $('download').hidden = true; $('comparePanel').hidden = true;
  applyBrief(project.brief); setMode('txt2img'); renderGallery(); badge('Ready'); scheduleSave(); void replaceMotionWithLegacy(); status('New project started.'); notifyStudio('reset'); return true;
}
function setProjectActions(actions) {
  if(!actions || !['importProject','newProject','saveCurrent'].every(name=>typeof actions[name]==='function'))throw TypeError('Project action handlers are required.');
  projectActions=actions;
  return ()=>{if(projectActions===actions)projectActions=null;};
}
async function requestImportProject(raw) { return projectActions ? projectActions.importProject(raw) : importProject(raw); }
async function requestNewProject() { return projectActions ? projectActions.newProject() : resetProject(); }
const database = typeof indexedDB === 'undefined' ? Promise.resolve(null) : new Promise((resolve,reject) => {
  const request = indexedDB.open('pankeki-character-studio',1);
  request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('projects')) request.result.createObjectStore('projects'); };
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error || Error('Could not open browser storage.'));
  request.onblocked = () => reject(Error('Another tab is using storage. Close other Pankeki tabs.'));
});
function storage(db,write,value) {
  return new Promise((resolve,reject) => {
    const tx = db.transaction('projects',write ? 'readwrite' : 'readonly'), store = tx.objectStore('projects');
    const request = write ? store.put(value,'current') : store.get('current');
    request.onerror = () => reject(request.error || Error('Could not save to browser storage.'));
    tx.onerror = tx.onabort = () => reject(tx.error || Error('Could not save to browser storage.'));
    if (write) tx.oncomplete = () => resolve(); else request.onsuccess = () => resolve(request.result);
  });
}
// The startup current snapshot and catalog are separate stores. Explicit
// actions must await this transaction, not only cancel or wait for a timer.
// skipUnchanged lets the catalog path reuse this queue's last committed write.
function persistCurrentProject(raw=exportProject(),{skipUnchanged=false}={}) {
  clearTimeout(saveTimer);saveTimer=null;
  if(activeAuthoringV3Workspace())return Promise.resolve(false);
  if(!validatedProject(raw))Design.parseProject(raw);
  const task=saveQueue.catch(()=>null).then(async()=>{
    if(activeAuthoringV3Workspace())throw Error('Image project saving stopped because work in another format started.');
    const db=await database;
    if(!db)throw Error('Browser storage unavailable.');
    if(skipUnchanged&&persistedRaw!==null&&raw===persistedRaw)return true;
    persistedRaw=null;await storage(db,true,raw);persistedRaw=raw;
    return true;
  });
  saveQueue=task;
  return task;
}
// The catalog defers its own save while this debounce is pending; always hand it back.
function runScheduledSave() {
  const handOff=()=>{try{projectActions?.autosaved?.();}catch(error){console.error('Pankeki catalog autosave hook failed',error);}};
  if(activeAuthoringV3Workspace())return handOff();
  let raw;try{raw=exportProject();}catch(error){projectStatus(uiMessage(error.message),true);return handOff();}
  const epoch=editEpoch;
  void persistCurrentProject(raw).then(()=>{if(epoch===editEpoch)projectStatus('Autosaved in this browser. You can also save a project file.');}).catch(error=>projectStatus('Autosave failed: '+uiMessage(error.message)+' Your current work remains on screen.',true)).finally(handOff);
}
function scheduleSave(delay=200) {
  clearTimeout(saveTimer);saveTimer=null;
  if(activeAuthoringV3Workspace())return;
  saveTimer=setTimeout(()=>{saveTimer=null;runScheduledSave();},delay);
}
// A pending debounce is written now when the page may be discarded.
function flushScheduledSave() { if(saveTimer===null)return; clearTimeout(saveTimer);saveTimer=null;runScheduledSave(); }
globalThis.addEventListener?.('pagehide',flushScheduledSave);
document.addEventListener?.('visibilitychange',()=>{if(document.visibilityState==='hidden')flushScheduledSave();});
async function restoreSaved() {
  const epoch = editEpoch, revision = importRevision;
  let legacyRead=false,legacyRaw=null;
  try {
    const db = await database;
    if (!db) { projectStatus('Autosave unavailable. Save a project file.'); return Object.freeze({ok:false,restored:false,reason:'unavailable',legacyRead,legacyRaw,stage:'read'}); }
    const raw = await storage(db,false);
    legacyRead=true;legacyRaw=raw==null?null:typeof raw==='string'?raw:JSON.stringify(raw);
    if (epoch !== editEpoch || revision !== importRevision) return Object.freeze({ok:true,restored:false,reason:'superseded',legacyRead,legacyRaw,stage:'read'});
    if (raw) { const restored=await importProject(raw,{restore:true}),superseded=!restored&&epoch!==editEpoch;return Object.freeze({ok:restored===true||superseded,restored:restored===true,reason:restored?'restored':superseded?'superseded':'error',legacyRead,legacyRaw,stage:'import'}); }
    projectStatus('Candidates and settings are autosaved in this browser. Masks are not included in project files.');
    return Object.freeze({ok:true,restored:false,reason:'empty',legacyRead,legacyRaw,stage:'read'});
  } catch (error) { if (epoch === editEpoch) projectStatus('Auto-restore failed: ' + uiMessage(error.message) + ' You can import a project file.',true);return Object.freeze({ok:false,restored:false,reason:'error',legacyRead,legacyRaw,stage:legacyRead?'import':'read'}); }
}
$('newProject').onclick = requestNewProject; $('generate').onclick = generate; $('cancel').onclick = cancel;
$('useResult').onclick = async () => {
  const item = project.versions.find(v => v.id === latestId); if (!item) return;
  try { await editCandidate(item); } catch (error) { status(uiMessage(error.message),true); }
};
$('clearCache').onclick = async () => {
  try { await api('/api/cache/clear',{}); status('Cleared the result reuse cache. Project candidate images are preserved.'); }
  catch (error) { status(uiMessage(error.message),true); }
};
$('exportBoard').onclick = async () => {
  const snapshot = clone(project), epoch = editEpoch;
  const fallbackId = view === 'source' && sourceId ? sourceId : latestId || sourceId;
  const ids = selectedIds.length ? [...selectedIds] : fallbackId ? [fallbackId] : [];
  try {
    if (!ids.length) throw Error('Generate or select candidates for the board first.');
    const candidates = [];
    for (const id of ids) {
      const item = snapshot.versions.find(v => v.id === id);
      candidates.push({...item,kind:item.metrics.cache === 'empty-mask-skip' ? 'source' : item.kind,image:await decodeImage(item.image)});
    }
    const output = document.createElement('canvas'), profile = Design.profiles[snapshot.brief.profile];
    CharacterBoard.drawCharacterBoard(output,{...snapshot.brief,profileLabel:profile.label,detailLabel:profile.detailLabel},candidates);
    const blob = await new Promise((resolve,reject) => output.toBlob(value => value ? resolve(value) : reject(Error('Could not create a PNG file.')),'image/png'));
    downloadBlob(blob,safeName(snapshot.brief) + '-board.png');
    if (epoch === editEpoch) projectStatus('Character board PNG exported.');
  } catch (error) { if (epoch === editEpoch) projectStatus('Board save failed: ' + uiMessage(error.message),true); }
};
$('helpButton').onclick = () => $('helpDialog').showModal(); $('closeHelp').onclick = () => $('helpDialog').close();
$('helpDialog').onclick = event => {
  if (event.target === $('helpDialog')) { const box = $('helpDialog').getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) $('helpDialog').close(); }
};
// A small read-only boundary for navigation; do not clone embedded images on
// every status update or expose mutable project/candidate objects to observers.
function getSummary() {
  return Object.freeze({name:readBrief().name,candidateCount:project.versions.length,selectedCount:selectedIds.length,
    sourceLoaded,sourceId,latestId,imageUrl:view === 'source' && sourceLoaded ? sourceDataURL : latestUrl || sourceDataURL,mode:$('mode').value,editOperation:$('editOperation').value || 'regenerate',busy,
    projectStatus:$('projectStatus').textContent,modelsReady,editEpoch,sourceRevision,importing,maskLoading,drawing,photoTools:photoState()});
}
function notifyStudio(reason = 'state') {
  if (['reset','import','restore','motion-import','v3-import'].includes(reason)) {
    ++desktopProjectGeneration; desktopRequests.clear(); desktopAppliedJobs.clear();
  }
  motionController?.refreshSources();
  if (!studioListeners.size) return;
  const summary = getSummary();
  for (const listener of studioListeners) {
    try { listener(summary,reason); } catch (error) { console.error('Pankeki studio observer failed',error); }
  }
}
function subscribe(listener) {
  if (typeof listener !== 'function') throw TypeError('A studio listener is required.');
  studioListeners.add(listener); listener(getSummary());
  return () => studioListeners.delete(listener);
}
// The desktop bridge receives only explicitly captured input, never a project
// export. Results enter the same candidate/document/render path as local jobs.
function desktopState() {
  const tuple=JSON.stringify([desktopProjectGeneration,sourceRevision,maskRevision]);
  if(tuple!==desktopSnapshotTuple){desktopSnapshotTuple=tuple;desktopSnapshotToken='edit-'+session+'-'+(++desktopSnapshotGeneration);}
  return Object.freeze({projectId:'project-'+session+'-'+desktopProjectGeneration,revision:editEpoch,
    sourceRevision:desktopSnapshotToken,maskRevision,mode:$('mode').value,hasSource:sourceLoaded,
    sourceCandidateId:sourceId,selectedCandidateId:latestId});
}
function desktopAutomaticSettings(values, modelId, editing) {
  const result={model_id:modelId};
  if(!Design.capabilityModels(capabilitySnapshot,editing?'regenerate':'generate').some(model=>model.id===modelId&&model.available))throw Error('model');
  const limits=editing?{seed:[0,Number.MAX_SAFE_INTEGER,true],steps:[1,100,true],cfg:[0,30],denoise:[.01,1],halo:[0,512,true]}:
    {seed:[0,Number.MAX_SAFE_INTEGER,true],width:[64,2048,true],height:[64,2048,true],steps:[1,100,true],cfg:[0,30]};
  for(const [key,[low,high,integer]] of Object.entries(limits)){
    const raw=values[key],value=typeof raw==='number'?raw:typeof raw==='string'&&raw.trim()?Number(raw):NaN;
    if(!Number.isFinite(value)||value<low||value>high||integer&&!Number.isSafeInteger(value))throw Error('settings');result[key]=value;
  }
  if(!['euler','euler_ancestral','dpmpp_2m'].includes(values.sampler)||!['normal','simple','karras'].includes(values.scheduler))throw Error('settings');
  result.sampler=values.sampler;result.scheduler=values.scheduler;
  for(const key of ['cache','preview']){if(typeof values[key]!=='boolean')throw Error('settings');result[key]=values[key];}
  if(editing){if(typeof values.roi!=='boolean')throw Error('settings');result.roi=values.roi;if(modelId==='sdxl-inpaint-v01')result.cache=false;}
  else{
    if(result.width%8||result.height%8||typeof values.negative!=='string'||values.negative.length>4000||/\b(?:https?|wss?|ftp|file|data):|(?:^|\s)(?:\/[A-Za-z0-9]|\.{1,2}\/|~\/|[A-Za-z]:\\)/i.test(values.negative))throw Error('settings');
    result.negative=values.negative;
  }
  return Object.freeze(result);
}
// The snapshot overrides the model's seed, so a repeated chat generation with a
// model and seed already used in this project would only redraw the same image.
// It gets the next unused seed instead; the recipe records it.
function desktopFreshSeed(settings) {
  const used=new Set(project.versions.filter(item=>item.request?.mode==='txt2img'&&item.request.model_id===settings.model_id).map(item=>item.request.seed));
  let seed=settings.seed;
  while(used.has(seed))seed=seed<Number.MAX_SAFE_INTEGER?seed+1:0;
  return seed===settings.seed?settings:{...settings,seed};
}
// A recompose redraws its whole source, so starting from an earlier recompose result
// compounds contrast and line changes. Recompose starts from the image those results came
// from, and keeps the prompt of the nearest generated ancestor as its style anchor.
function recomposeBase(item) {
  const seen=new Set(),parent=next=>project.versions.find(version=>version.id===next.parentId)||null;
  while(item?.request?.mode==='img2img'&&item.parentId&&!seen.has(item.id)){seen.add(item.id);const up=parent(item);if(!up)break;item=up;}
  let prompted=item;
  while(prompted&&!(prompted.request?.mode==='txt2img'&&prompted.request.prompt)&&prompted.parentId&&!seen.has(prompted.id)){seen.add(prompted.id);prompted=parent(prompted);}
  const basePrompt=prompted?.request?.mode==='txt2img'&&typeof prompted.request.prompt==='string'?prompted.request.prompt.slice(0,2000):'';
  return {item,basePrompt};
}
function desktopAutomaticContext({visibleCandidateId=null,referenceCandidateId=visibleCandidateId,generationStyle=null}={}) {
  if(importing||maskLoading||drawing)throw Error('Finish the image or mask input before sending again.');
  if(visibleCandidateId!==null&&(typeof visibleCandidateId!=='string'||!project.versions.some(item=>item.id===visibleCandidateId)))throw Error('Check the currently visible image again.');
  if(generationStyle!==null){
    if(!generationStyle||Object.keys(generationStyle).some(key=>!['id','prompt'].includes(key))||!['character','illustration','background','concept','portrait','chibi','other'].includes(generationStyle.id)||typeof generationStyle.prompt!=='string'||generationStyle.prompt.length>512||/\b(?:https?|file|data):|(?:^|\s)\/(?:Users|Volumes|private|var|tmp)\//i.test(generationStyle.prompt))throw Error('Check the selected style.');
    generationStyle=Object.freeze({id:generationStyle.id,prompt:generationStyle.prompt});
  }
  const state=desktopState(),sourceCandidateId=sourceLoaded?sourceId:null;
  let maskReady=false;
  if(sourceLoaded&&typeof context.getImageData==='function'){
    const pixels=context.getImageData(0,0,paint.width,paint.height).data;
    for(let index=0;index<pixels.length;index+=4)if(Math.round(.299*pixels[index]+.587*pixels[index+1]+.114*pixels[index+2])>0){maskReady=true;break;}
  }
  const {item:reference,basePrompt}=recomposeBase(project.versions.find(item=>item.id===referenceCandidateId)||null);
  const targetRevision=reference?'ref-'+crypto.randomUUID():state.sourceRevision;
  const target=Object.freeze({visibleCandidateId,sourceCandidateId,referenceCandidateId:reference?.id||null,sourceRevision:targetRevision,maskReady});
  const generationModel=imageModels.find(item=>item.id===modelSelections.txt2img&&item.available===true);
  let generation={ready:false,settings:null,reason:'model'};
  if(modelsReady&&generationModel)try{
    const values=imageMode==='txt2img'?readGenerationSettings():generationSettings;
    generation={ready:true,settings:desktopFreshSeed(desktopAutomaticSettings({...values,preview:values?.previewOn},generationModel.id,false))};
  }catch{generation={ready:false,settings:null,reason:'settings'};}
  const editModel=modelsForMode('inpaint').find(item=>item.id===modelSelections.inpaint&&item.available===true);
  const prior=imageMode==='inpaint'?Object.fromEntries(generationSettingKeys.map(key=>[key,['cache','previewOn'].includes(key)?$(key).checked:$(key).value])):inpaintSettings?.values;
  const editValues=prior||{...editModel?.defaults,seed:$('seed').value,cache:$('cache').checked,previewOn:$('previewOn').checked};
  let regenerate={ready:false,settings:null,reason:'model'};
  if(modelsReady&&editModel)try{
    regenerate={ready:true,settings:desktopAutomaticSettings({...editValues,halo:$('halo').value,roi:$('roi').checked,preview:editValues.previewOn},editModel.id,true)};
  }catch{regenerate={ready:false,settings:null,reason:'settings'};}
  const featherText=$('feather').value,feather=featherText.trim()&&Number.isSafeInteger(Number(featherText))&&Number(featherText)>=0&&Number(featherText)<=64?Number(featherText):null;
  const reason=!sourceLoaded||!sourceCandidateId?'source':!visibleCandidateId||visibleCandidateId!==sourceCandidateId?'target':!maskReady?'mask':feather===null?'capability':null;
  const recolorCapability=Design.capabilityOperation(capabilitySnapshot,'recolor');
  const edit=Object.freeze({ready:reason===null,feather,...(reason?{reason}:{}),recolor:Object.freeze({ready:recolorCapability.ready,...(!recolorCapability.ready?{reason:recolorCapability.reason}:{})}),regenerate:Object.freeze(regenerate)});
  let recompose={ready:false,settings:null,reason:!reference?'source':'model'};
  if(reference&&generation.ready&&Design.capabilityModels(capabilitySnapshot,'recompose').some(model=>model.id===generation.settings.model_id&&model.available)){
    const {width,height,...settings}=generation.settings;
    recompose={ready:true,settings:Object.freeze({...settings,denoise:.55}),...(basePrompt?{basePrompt}:{})};
  }
  const output={version:2,intent:'auto',...state,sourceRevision:targetRevision,automatic:Object.freeze({version:1,capabilityRevision:capabilitySnapshot?.revision||null,capabilitySource:capabilitySnapshot?.source||'unavailable',target,generationStyle,generation:Object.freeze(generation),edit,recompose:Object.freeze(recompose)})};
  if(edit.ready){
    output.source=Object.freeze({dataUrl:sourceDataURL.startsWith('data:image/png;')?sourceDataURL:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height});
    output.mask=Object.freeze({dataUrl:paint.toDataURL('image/png'),width:paint.width,height:paint.height});
  }
  if(!output.source&&reference)output.source=Object.freeze({dataUrl:reference.image});
  desktopAutomaticCaptures.set(output,{stateSourceRevision:state.sourceRevision,referenceId:reference?.id||null,referenceImage:reference?.image||null});return Object.freeze(output);
}
function desktopContext({intent='chat',includeEditAssets=false,visibleCandidateId=null,referenceCandidateId=visibleCandidateId,generationStyle=null}={}) {
  if(photoActive)throw Error('Apply or cancel the photo edit before sending a message.');
  if(intent==='auto')return desktopAutomaticContext({visibleCandidateId,referenceCandidateId,generationStyle});
  if (!['chat','generate','edit'].includes(intent)) throw Error('Choose a conversation or image task.');
  if (importing || maskLoading || drawing) throw Error('Finish the image or mask input before sending again.');
  const state=desktopState(), output={version:1,intent,...state,
    generation:{modelId:$('imageModel').value,width:Number($('width').value),height:Number($('height').value)}};
  if (intent==='edit') {
    if (!sourceLoaded) throw Error('Import the source image to edit first.');
    if (!includeEditAssets) throw Error('Allow use of the selected source and mask.');
    const pixels=context.getImageData(0,0,paint.width,paint.height).data;
    let selected=false;
    for(let index=0;index<pixels.length;index+=4)if(Math.round(.299*pixels[index]+.587*pixels[index+1]+.114*pixels[index+2])>0){selected=true;break;}
    if (!selected) throw Error('Paint the edit area with the brush or import a mask.');
    output.source={dataUrl:sourceDataURL.startsWith('data:image/png;')?sourceDataURL:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height};
    output.mask={dataUrl:paint.toDataURL('image/png'),width:paint.width,height:paint.height};
  }
  return output;
}
async function desktopPrepareSource(captured) {
  const reference=desktopAutomaticCaptures.get(captured);
  if(!reference||!captured.source)return captured.source;
  const current=()=>{const state=desktopState();return state.projectId===captured.projectId&&state.sourceRevision===reference.stateSourceRevision&&state.maskRevision===captured.maskRevision&&state.revision===captured.revision&&project.versions.some(item=>item.id===reference.referenceId&&item.image===reference.referenceImage);};
  if(!current())throw Error('The reference image changed. Send again.');
  if(captured.source.dataUrl.startsWith('data:image/png;'))return captured.source;
  const image=await decodeImage(captured.source.dataUrl);
  if(!current())throw Error('The reference image changed. Send again.');
  const surface=document.createElement('canvas');surface.width=image.naturalWidth;surface.height=image.naturalHeight;
  surface.getContext('2d').drawImage(image,0,0);
  return Object.freeze({dataUrl:surface.toDataURL('image/png'),width:surface.width,height:surface.height});
}
function desktopCurrent(entry) {
  const now=desktopState();
  return desktopRequests.get(entry.requestId)===entry&&!importing&&!maskLoading&&!drawing&&!busy&&
    now.projectId===entry.projectId&&now.sourceRevision===(entry.stateSourceRevision||entry.sourceRevision)&&(!entry.referenceId||project.versions.some(item=>item.id===entry.referenceId&&item.image===entry.referenceImage))&&now.maskRevision===entry.maskRevision&&editEpoch===entry.liveRevision;
}
function desktopFormatMessage({text,intent,context:captured}={}) {
  if(typeof text!=='string'||!text.trim()||text.length>4000||!['chat','generate','edit','auto'].includes(intent))throw Error('Check the task description and selection.');
  const now=desktopState();
  if(!captured||captured.intent!==intent||captured.projectId!==now.projectId||(desktopAutomaticCaptures.get(captured)?.stateSourceRevision||captured.sourceRevision)!==now.sourceRevision||importing||maskLoading||drawing)throw Error('The source or mask changed. Select again.');
  if(intent==='auto'){if(!desktopAutomaticCaptures.has(captured))throw Error('Prepare the automatic request context again.');return '[Pankeki action: auto]\n'+text;}
  if(intent==='chat')return '[Pankeki action: chat]\n이 요청은 대화만 합니다. 이미지 생성·수정 도구를 실행하지 마세요.\n'+text;
  const brief=Design.sanitizeBrief({...readBrief(),prompt:text,useBrief:false});
  const request=requestSnapshot(brief,intent==='edit'?'inpaint':'txt2img');
  // Use the existing document validator without mutating or serializing the project/history.
  const normalized=Design.createProject(brief,[{id:'desktop-validation',createdAt:new Date().toISOString(),label:'Desktop validation',
    image:sourceDataURL||canvas.toDataURL('image/png'),kind:'generated',brief,request,parentId:null,metrics:{}}],[]).versions[0].request;
  const allowed=['mode','prompt','negative','model_id','seed','width','height','steps','cfg','sampler','scheduler','denoise','roi','halo','feather','cache','preview','preview_interval','edit_operation','target_color','source_color','color_tolerance'];
  const safe={};
  for(const key of allowed)if(Object.hasOwn(normalized,key)){
    const value=normalized[key];
    if(value!==null&&!['string','number','boolean'].includes(typeof value)||typeof value==='string'&&/data:image\/|file:\/\/|(?:^|\s)\/(?:Users|Volumes|private|var|tmp)\//i.test(value))throw Error('Only validated settings can be passed to image tasks.');
    safe[key]=value;
  }
  const message='[Pankeki action: '+intent+']\n[Pankeki settings: '+JSON.stringify(safe)+']\n'+text;
  if(message.length>8000)throw Error('Keep the task description and settings within 8000 characters.');
  return message;
}
// provider: the chat model's display name, used only in labels and status text.
function desktopBegin({requestId,context:captured,provider}={}) {
  if(photoActive)return {accepted:false,reason:'busy'};
  if (typeof requestId!=='string'||! /^[A-Za-z0-9_-]{1,80}$/.test(requestId)||!captured||desktopRequests.size) return {accepted:false,reason:'request'};
  if(captured.intent==='auto'&&!desktopAutomaticCaptures.has(captured))return {accepted:false,reason:'capability'};
  const entry={requestId,projectId:captured.projectId,sourceRevision:captured.sourceRevision,maskRevision:captured.maskRevision,
    liveRevision:captured.revision,intent:captured.intent,brief:readBrief(),parentId:desktopAutomaticCaptures.get(captured)?.referenceId||sourceId,...(desktopAutomaticCaptures.get(captured)||{}),jobs:new Set(),
    provider:['Codex','Claude'].includes(provider)?provider:'Codex',...(captured.intent==='auto'?{automatic:captured.automatic,resolvedIntent:null}: {})};
  if(!['chat','generate','edit','auto'].includes(entry.intent))return {accepted:false,reason:'intent'};
  desktopRequests.set(requestId,entry);
  if(!desktopCurrent(entry)){desktopRequests.delete(requestId);return {accepted:false,reason:'stale'};}
  renderView();
  return {accepted:true};
}
async function desktopReceive(event) {
  const entry=desktopRequests.get(event?.requestId),declined=reason=>({accepted:false,reason});
  if(!entry||event.projectId!==entry.projectId||event.sourceRevision!==undefined&&event.sourceRevision!==entry.sourceRevision||!desktopCurrent(entry))return declined('stale');
  const data=event.payload;
  if(event.type==='intent-resolved'){
    if(!entry.automatic||!data||!['chat','generate','edit'].includes(data.intent)||data.intent==='edit'&&!['regenerate','recolor','recompose'].includes(data.operation)||data.intent!=='edit'&&data.operation!==undefined)return declined('intent');
    if(entry.resolvedIntent)return {accepted:entry.resolvedIntent===data.intent&&entry.operation===data.operation,reason:'intent'};
    entry.intent=entry.resolvedIntent=data.intent;entry.operation=data.operation;return {accepted:true};
  }
  if(entry.automatic&&(!entry.resolvedIntent||entry.intent==='chat'))return declined('intent');
  if(entry.automatic&&(entry.intent==='generate'?!entry.automatic.generation.ready:entry.operation==='recompose'?!entry.automatic.recompose?.ready:!entry.automatic.edit.ready||entry.operation==='regenerate'&&!entry.automatic.edit.regenerate.ready))return declined('capability');
  if(!data||typeof data.jobId!=='string'||! /^[A-Za-z0-9_.-]{1,128}$/.test(data.jobId))return declined('job');
  if(event.type==='job'){
    if(!['queued','running','canceling','succeeded','failed','canceled','uncertain','orphaned'].includes(data.state))return declined('state');
    if(entry.automatic&&entry.jobs.size&&!entry.jobs.has(data.jobId))return declined('job');
    entry.jobs.add(data.jobId);status(entry.provider+(data.state==='queued'?' image task is queued.':data.state==='running'?' image task is running.':' image task: '+data.state));
    return {accepted:true};
  }
  if(event.type!=='result'||!entry.jobs.has(data.jobId)||desktopAppliedJobs.has(data.jobId))return declined('job');
  const selectionCurrent=()=>entry.operation!=='recompose'||typeof event.selectionCurrent==='function'&&event.selectionCurrent()===true;
  try {
    if(!selectionCurrent())return declined('stale');
    if(typeof data.imageDataUrl!=='string'||!/^data:image\/(png|jpeg|webp);base64,/.test(data.imageDataUrl)||data.imageDataUrl.length>MAX_IMAGE)return declined('image');
    if(!data.request||data.request.mode!==(entry.operation==='recompose'?'img2img':entry.intent==='edit'?'inpaint':'txt2img'))return declined('request');
    if(entry.automatic){
      if(entry.intent==='edit'&&entry.operation!=='recompose'&&data.request.edit_operation!==entry.operation)return declined('request');
      const settings=entry.intent==='generate'?entry.automatic.generation.settings:entry.operation==='recompose'?entry.automatic.recompose.settings:entry.operation==='regenerate'?entry.automatic.edit.regenerate.settings:{};
      for(const [key,value] of Object.entries(settings))if(data.request[key]!==value)return declined('settings');
      if(entry.intent==='edit'&&entry.operation!=='recompose'&&data.request.feather!==entry.automatic.edit.feather)return declined('settings');
    }
    const image=data.imageDataUrl,metrics=summaryMetrics(data.metrics||{});
    const item={id:crypto.randomUUID(),createdAt:new Date().toISOString(),label:typeof data.label==='string'?data.label.slice(0,120):entry.provider+' 후보',image,
      kind:'generated',brief:entry.brief,request:clone(data.request),parentId:entry.intent==='edit'?entry.parentId:null,metrics,...(data.execution?{execution:Design.validateExecution(data.execution,image)}:{})};
    // Validate bytes/request/document before decoding and repeat identity checks
    // after the asynchronous browser decoder yields to user input.
    Design.createProject(readBrief(),[...project.versions,item],project.selectionHistory);
    await decodeImage(image);
    if(!desktopCurrent(entry)||desktopAppliedJobs.has(data.jobId)||!selectionCurrent())return declined('stale');
    project=Design.createProject(readBrief(),[...project.versions,item],project.selectionHistory);
    desktopAppliedJobs.add(data.jobId);++editEpoch;entry.liveRevision=editEpoch;
    showCandidate(item);renderGallery();scheduleSave();
    badge(resultWasSkipped(metrics)?'No change':entry.provider+' candidate ready');
    status(resultWasSkipped(metrics)?'Saved a candidate with no changes.':entry.provider+' result added to candidates.');
    return {accepted:true,candidateId:item.id};
  }catch(error){return declined('invalid-result');}
}
// UI-only local image operations. No provider tools, paths or native capability changes.
function photoBytes(data) {
  if(typeof data!=='string'||data.length>MAX_IMAGE||!/^data:image\/(png|jpeg|webp);base64,/.test(data))throw Error('A source image that can be saved is required.');
  return Uint8Array.from(atob(data.slice(data.indexOf(',')+1)),char=>char.charCodeAt(0));
}
async function photoSha(data) {
  if(!crypto.subtle)throw Error('Image integrity verification unavailable.');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',photoBytes(data))),v=>v.toString(16).padStart(2,'0')).join('');
}
function photoCurrent(op) {
  return photoActive===op&&!op.canceled&&!importing&&op.generation===desktopProjectGeneration&&op.sourceRevision===sourceRevision&&project.versions.some(item=>item.id===op.candidateId&&item.image===op.original);
}
function photoState() {
  return Object.freeze({active:!!photoActive,applying:!!photoActive?.applying,canceling:!!photoActive?.canceling,locked:busy||desktopRequests.size>0||importing||maskLoading||drawing||!!photoActive?.applying||!!photoActive?.canceling,tool:photoActive?.tool||null,candidateId:photoActive?.candidateId||null,capabilitySource:capabilitySnapshot?.source||'unavailable',operations:Object.freeze(Object.fromEntries(['markup','comments','background-remove','erase','resize'].map(id=>[id,Object.freeze({...Design.capabilityOperation(capabilitySnapshot,id)})])))});
}
function photoRequire(token,tool) {
  const op=photoActive;
  if(!op||op.token!==token||!photoCurrent(op)||tool&&op.tool!==tool)throw Error('The image task source or project changed. Select again.');
  return op;
}
async function photoBegin(candidateId,tool) {
  if(!['markup','comments','background-remove','erase','resize'].includes(tool))throw Error('Unsupported image tool.');
  const capability=Design.capabilityOperation(capabilitySnapshot,tool);if(capabilitySnapshot?.source==='snapshot'&&!capability.ready)throw Error(uiMessage(capability.reason)||'This feature is not ready yet.');
  if(photoActive||photoState().locked)throw Error('Finish the current task before opening image tools.');
  const item=project.versions.find(value=>value.id===candidateId);
  if(!item)throw Error('Select an image in the current project.');
  const op={token:crypto.randomUUID(),sequence:++photoSequence,candidateId,tool,original:item.image,brief:clone(item.brief),generation:desktopProjectGeneration,sourceRevision,canceled:false,applying:false};
  if(tool==='erase'){
    const edit=desktopAutomaticContext({visibleCandidateId:candidateId}).automatic.edit;
    op.editSettings=edit.regenerate.ready&&edit.feather!==null?{...edit.regenerate.settings,feather:edit.feather}:null;
  }
  photoActive=op;renderView();
  try {
    const image=await decodeImage(item.image);op.sourceSha256=await photoSha(item.image);
    if(!photoCurrent(op))throw Error('The image selection changed.');
    op.width=image.naturalWidth;op.height=image.naturalHeight;op.png=item.image;
    if(!item.image.startsWith('data:image/png;base64,')){
      const copy=document.createElement('canvas');copy.width=op.width;copy.height=op.height;copy.getContext('2d').drawImage(image,0,0);op.png=copy.toDataURL('image/png');photoBytes(op.png);
    }
    return Object.freeze({token:op.token,tool,candidateId,image:op.png,width:op.width,height:op.height,annotations:photoListComments(candidateId),imageSettingsSnapshot:op.editSettings?Object.freeze({...op.editSettings}):null});
  }catch(error){if(photoActive===op){photoActive=null;renderView();}throw error;}
}
function photoCancelJob(op) {
  if(!op.jobId)return Promise.resolve();
  return op.cancelJobPromise ||= api('/api/jobs/'+op.jobId+'/cancel',{}).catch(error=>{op.cancelJobPromise=null;throw error;});
}
async function photoCancel(token) {
  const op=photoActive;if(!op||op.token!==token)return false;
  if(op.cancelPromise)return op.cancelPromise;
  op.canceled=true;op.canceling=true;op.controller?.abort();
  if(op.manualToken===serial){++serial;current=null;busy=false;activeOperation=null;previewVisible=false;}
  op.cancelPromise=(async()=>{
    try {if(op.submission)await op.submission;await photoCancelJob(op);}
    catch(error){op.cancelPromise=null;throw error;}
    if(photoActive===op){photoActive=null;renderView();}
    return true;
  })();
  return op.cancelPromise;
}
function photoListComments(candidateId) {
  const item=project.versions.find(value=>value.id===candidateId);if(!item)throw Error('This image is not in the current project.');
  return clone(item.annotations||[]);
}
function photoWriteComments(op,notes) {
  if(op.applying||photoState().locked)throw Error('Save annotations after the current task finishes.');
  const versions=project.versions.map(item=>item.id===op.candidateId?{...item,annotations:notes}:item);
  const next=Design.createProject(readBrief(),versions,project.selectionHistory);
  project=next;touch();scheduleSave();renderGallery();notifyStudio('annotation');
}
function photoSaveComment(token,input) {
  const op=photoRequire(token,'comments');
  if(!input||Object.keys(input).some(key=>!['id','x','y','text'].includes(key)))throw Error('Check the annotation input.');
  const notes=photoListComments(op.candidateId),index=input.id===undefined?-1:notes.findIndex(note=>note.id===input.id);
  if(input.id!==undefined&&index<0)throw Error('No annotation to edit.');
  const now=new Date().toISOString(),note={id:index<0?crypto.randomUUID():notes[index].id,x:input.x,y:input.y,text:input.text,createdAt:index<0?now:notes[index].createdAt,...(index>=0?{updatedAt:now}:{})};
  if(index<0)notes.push(note);else notes[index]=note;
  photoWriteComments(op,notes);return clone(note);
}
function photoDeleteComment(token,id) {
  const op=photoRequire(token,'comments'),notes=photoListComments(op.candidateId);
  if(!notes.some(note=>note.id===id))throw Error('No annotation to delete.');
  photoWriteComments(op,notes.filter(note=>note.id!==id));return true;
}
async function photoMask(op,data) {
  if(typeof data!=='string'||!data.startsWith('data:image/png;base64,'))throw Error('A PNG selection mask is required.');
  photoBytes(data);const image=await decodeImage(data);
  if(image.naturalWidth!==op.width||image.naturalHeight!==op.height)throw Error('Mask dimensions must match the source.');
  const copy=document.createElement('canvas');copy.width=op.width;copy.height=op.height;const ctx=copy.getContext('2d');ctx.fillStyle='black';ctx.fillRect(0,0,op.width,op.height);ctx.drawImage(image,0,0);
  const pixels=ctx.getImageData(0,0,op.width,op.height).data;
  if(!pixels.some((_,i)=>i%4===0&&pixels[i+3]>0&&Math.round(.299*pixels[i]+.587*pixels[i+1]+.114*pixels[i+2])>0))throw Error('Select the object to erase with a mask.');
  return copy.toDataURL('image/png');
}
function photoApply(token,options={}) {
  let op;try{op=photoRequire(token);}catch(error){return Promise.reject(error);}
  if(op.work)return op.work;
  if(op.tool==='comments')return Promise.reject(Error('Use Save comment to save annotations.'));
  if(photoState().locked)return Promise.reject(Error('Finish the current task before applying.'));
  try{options=clone(options);}catch{return Promise.reject(Error('Image task input must be JSON values.'));}
  op.applying=true;renderView();
  op.work=(async()=>{
    let image,metadata,request=null,metrics={},jobId=null,execution;
    if(project.versions.length>=20)throw Error('Up to 20 candidates are supported. Save this project and continue in a new one.');
    if(op.tool==='erase'){
      if(!options||Object.keys(options).some(key=>key!=='maskPng'))throw Error('Check the erase input.');
      const mask=await photoMask(op,options.maskPng);photoRequire(token);
      if(!op.editSettings)throw Error('Select an available masked edit model and its settings first.');
      request={...op.editSettings,mode:'inpaint',edit_operation:'regenerate',source:op.png,mask,prompt:'Remove the selected object and naturally fill the selected area with the surrounding background. Keep everything outside the mask unchanged.',negative:'',width:512,height:512};
      let submitted;op.submission=new Promise(resolve=>{submitted=resolve;});op.manualToken=++serial;busy=true;activeOperation='photo-erase';renderView();
      let job;try{job=await api('/api/jobs',{session,request:{...request,trace_id:op.token}});op.jobId=job.job_id;}finally{submitted();}
      if(!photoCurrent(op)){await photoCancelJob(op);throw Error('Canceled or source changed.');}
      current=op.jobId;const result=await poll(op.jobId,op.manualToken,0,1);
      if(!result||!photoCurrent(op))throw Error('Canceled or source changed.');
      image={png:await readDataURL(result.image_url),width:op.width,height:op.height};image.sha256=await photoSha(image.png);
      execution=Design.executionFromResult(result,image.png);
      metadata={algorithm:'configured-inpaint',algorithmVersion:'1',parameters:{maskSha256:await photoSha(mask)}};metrics=summaryMetrics(result.metrics);jobId=op.jobId;
    }else{
      const source={png:op.png,sha256:await photoSha(op.png),width:op.width,height:op.height};photoRequire(token);
      const body=JSON.stringify({version:1,operationId:op.token,operation:op.tool,...(capabilitySnapshot?.source==='snapshot'?{trace_id:op.token}:{}),source,options});
      if(body.length>32*1024*1024)throw Error('Image task requests must be 32MiB or smaller.');
      if(typeof AbortController==='function')op.controller=new AbortController();
      const response=await fetch('/api/image-ops',{method:'POST',headers:{'Content-Type':'application/json'},body,signal:op.controller?.signal});
      let result=await response.json();
      if(response.status===202&&result.code==='in-progress'){
        if(result.operationId!==op.token||!(/^[a-f0-9]{32}$/).test(result.job_id||''))throw Error('Invalid image task ID.');
        op.jobId=result.job_id;
        if(!photoCurrent(op)){await photoCancelJob(op);throw Error('Canceled or source changed.');}
        op.manualToken=++serial;current=op.jobId;busy=true;activeOperation='photo-'+op.tool;renderView();
        result=await poll(op.jobId,op.manualToken,0,1);photoRequire(token);
      }
      if(!response.ok||!result?.ok)throw Object.assign(Error(uiMessage(result.error)||'Image processing failed.'),{code:result.code});
      if(result.operationId!==op.token||result.operation!==op.tool)throw Error('This result belongs to another image task.');
      ({image,metadata}=result);execution=Design.executionFromResult(result,image?.png);
    }
    photoRequire(token);
    if(!image||!metadata||typeof image.png!=='string'||!image.png.startsWith('data:image/png;base64,')||await photoSha(image.png)!==image.sha256)throw Error('Result PNG integrity verification failed.');
    const decoded=await decodeImage(image.png);photoRequire(token);
    if(decoded.naturalWidth!==image.width||decoded.naturalHeight!==image.height)throw Error('Result PNG dimensions differ from the reported dimensions.');
    if(op.tool!=='resize'&&(image.width!==op.width||image.height!==op.height))throw Error('Result dimensions must match the source.');
    const derivation={operation:op.tool,sourceId:op.candidateId,sourceSha256:op.sourceSha256,inputWidth:op.width,inputHeight:op.height,outputWidth:image.width,outputHeight:image.height,algorithm:metadata.algorithm,algorithmVersion:metadata.algorithmVersion,parameters:metadata.parameters||{},...(jobId?{jobId}:{})};
    const item={id:crypto.randomUUID(),createdAt:new Date().toISOString(),label:{markup:'마크업','background-remove':'배경 제거',erase:'객체 지우기',resize:'크기 조정'}[op.tool],image:image.png,kind:'derived',brief:op.brief,request,parentId:op.candidateId,metrics,derivation,...(execution?{execution}:{})};
    const next=Design.createProject(readBrief(),[...project.versions,item],project.selectionHistory);photoRequire(token);
    project=next;touch();showCandidate(item);renderGallery();scheduleSave();return Object.freeze({candidateId:item.id,image:item.image,width:image.width,height:image.height,operation:op.tool});
  })().finally(()=>{
    if(op.manualToken===serial){current=null;busy=false;activeOperation=null;previewVisible=false;}
    if(photoActive===op&&!op.canceling){photoActive=null;renderView();}
  });
  return op.work;
}
async function photoPreparePinnedEdit(token,input) {
  const op=photoRequire(token,'comments');
  if(photoState().locked||op.applying||op.canceling)throw Error('Finish the current task before preparing the pin area.');
  if(!input||Object.keys(input).some(key=>!['x','y','radius'].includes(key))||['x','y','radius'].some(key=>!Object.hasOwn(Object.getOwnPropertyDescriptor(input,key)||{},'value')||typeof input[key]!=='number'||!Number.isFinite(input[key]))||input.x<0||input.x>1||input.y<0||input.y>1||input.radius<.02||input.radius>.4)throw Error('Check the pin location and surrounding area again.');
  const point={x:input.x,y:input.y,radius:input.radius},generation=desktopProjectGeneration,revision=sourceRevision,mask=maskRevision,sequence=photoSequence;
  op.applying=true;renderView();
  try {
    const image=await decodeImage(op.png);
    if(!photoCurrent(op)||sourceRevision!==revision||maskRevision!==mask||photoSequence!==sequence)throw Error('The pin image or edit area changed. Select again.');
    const prepared=document.createElement('canvas');prepared.width=op.width;prepared.height=op.height;
    const preparedContext=prepared.getContext('2d');preparedContext.fillStyle='black';preparedContext.fillRect(0,0,op.width,op.height);preparedContext.fillStyle='white';preparedContext.beginPath();preparedContext.arc(point.x*op.width,point.y*op.height,point.radius*Math.min(op.width,op.height),0,Math.PI*2);preparedContext.fill();
    await photoCancel(token);
    if(photoActive!==null||photoSequence!==sequence||desktopProjectGeneration!==generation||sourceRevision!==revision||maskRevision!==mask||photoState().locked||!project.versions.some(item=>item.id===op.candidateId&&item.image===op.original))throw Error('The pin image or task changed. Select again.');
    // Decoding and validation finish before this synchronous source/mask commit.
    touch();++sourceRevision;drawing=false;commitSource(image,op.png,op.candidateId);context.drawImage(prepared,0,0);++maskRevision;setMode('inpaint');
    status('Replaced the edit mask with a circle around the pin. Send an AI request below.');
    return Object.freeze({candidateId:op.candidateId,...point,width:op.width,height:op.height,sourceRevision:desktopState().sourceRevision});
  } finally {if(photoActive===op)op.applying=false;renderView();}
}
const photoTools=Object.freeze({begin:photoBegin,apply:photoApply,cancel:photoCancel,getState:photoState,listComments:photoListComments,saveComment:photoSaveComment,deleteComment:photoDeleteComment,preparePinnedEdit:photoPreparePinnedEdit});
const desktopChat=Object.freeze({getState:desktopState,captureContext:desktopContext,prepareSource:desktopPrepareSource,formatMessage:desktopFormatMessage,beginRequest:desktopBegin,receiveEvent:desktopReceive,
  endRequest:({requestId}={})=>{const removed=desktopRequests.delete(requestId);if(removed)renderView();return removed;}});
globalThis.PankekiStudio = Object.freeze({generate,cancel,loadSource,importProject,exportProject,resetProject,requestImportProject,requestNewProject,setProjectActions,persistCurrentProject,validatedProject,flushScheduledSave,savePending:()=>saveTimer!==null,get ready(){return initialRestore;},getSummary,subscribe,downloadImage,desktopChat,photoTools,getImageModelSettings,setImageModelSettings,
  getAuthoringMode:() => authoringV3Selected ? 'v3' : 'v2',
  snapshotProject:async () => activeAuthoringV3Workspace() ? activeAuthoringV3Workspace().snapshotProject() : motionController?.getSummary().isMotionProject ? motionController.snapshotProject() : exportProject(),
  setMode:mode => { if (!['txt2img','inpaint'].includes(mode)) throw Error('Unsupported workspace mode'); touch(); setMode(mode); },
  getState:() => clone({project,sourceDataURL,sourceLoaded,latestUrl,selectedIds,sourceId,serial,busy,sourceRevision,maskRevision,maskLoading,importing})});
// Motion uses its own database/key. A v1 restore never overwrites a v2 scene.
function mountMotionWorkspace() {
  if (motionController || !globalThis.PankekiMotion || !globalThis.PankekiRenderer || !$('motionEditor')) return motionController;
  motionDatabase = typeof indexedDB === 'undefined' ? Promise.resolve(null) : new Promise((resolve,reject) => {
    const request = indexedDB.open('pankeki-motion-studio-v2',1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('projects')) request.result.createObjectStore('projects'); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error('Could not open motion storage.'));
    request.onblocked = () => reject(Error('Another tab is using motion storage.'));
  });
  motionController = globalThis.PankekiMotion.mount(document,{
    renderer:globalThis.PankekiRenderer,exporter:globalThis.PankekiExport,
    getSourceCandidates:() => project.versions.map(c => ({id:c.id,label:c.label})),
    getSourceDocument:async candidateId => {
      const candidate = project.versions.find(c => c.id === candidateId);
      if (!candidate) throw Error('Select a candidate from the current project.');
      return JSON.stringify(Design.createProject(readBrief(),project.versions,[...project.selectionHistory,{candidateId,action:'edit',at:new Date().toISOString()}].slice(-1000)));
    },
    onError:error => projectStatus('Motion task failed: ' + uiMessage(error.message),true,'motion'),
    onSuccess:() => { if (projectStatusOwner==='motion') projectStatus('Motion input and project verified.'); },
    onChange:() => scheduleMotionSave()
  });
  globalThis.PankekiMotionController = motionController;
  const persistenceEpoch = motionPersistenceEpoch;
  const controllerGeneration = motionController.getSummary().generation;
  void motionController.ready.then(async () => {
    const db = await motionDatabase, raw = db ? await storage(db,false) : null;
    if (persistenceEpoch !== motionPersistenceEpoch || controllerGeneration !== motionController.getSummary().generation || motionController.getSummary().dirty || motionController.getSummary().partCount > 0) return;
    await motionController.loadDocument(raw || exportProject());
    if (raw) projectStatus('Motion v2 restored automatically. Previous undo history is not restored.');
  }).catch(error => projectStatus('Motion auto-restore failed: ' + uiMessage(error.message),true));
  return motionController;
}
function scheduleMotionSave() {
  if (!motionController || activeAuthoringV3Workspace()) return;
  clearTimeout(motionSaveTimer);
  const persistenceEpoch = motionPersistenceEpoch;
  motionSaveTimer = setTimeout(() => {
    // Saving pauses playback to commit the pose; while playing, retry after it stops.
    if (motionController.getSummary().playing) { scheduleMotionSave(); return; }
    motionSaveQueue = motionSaveQueue.then(async () => {
      if (activeAuthoringV3Workspace()) return;
      const summary = motionController.getSummary(), db = await motionDatabase;
      if (persistenceEpoch !== motionPersistenceEpoch || !db || activeAuthoringV3Workspace()) return;
      if (summary.isMotionProject || summary.dirty || summary.partCount > 0) {
        if (motionController.getSummary().playing) { scheduleMotionSave(); return; }
        const raw = await motionController.snapshotProject();
        if (persistenceEpoch === motionPersistenceEpoch && !activeAuthoringV3Workspace()) await storage(db,true,raw);
      } else await new Promise((resolve,reject) => {
        const tx = db.transaction('projects','readwrite'); tx.objectStore('projects').delete('current');
        tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error || Error('Could not initialize motion storage'));
      });
    }).catch(error => projectStatus('Motion autosave failed: ' + uiMessage(error.message) + ' Save a v2 file.',true));
  },200);
}
async function replaceMotionWithLegacy() {
  if (!motionController) return;
  try { await motionController.loadDocument(exportProject()); }
  catch (error) { projectStatus('Motion project replacement failed: ' + uiMessage(error.message),true); }
}
// Availability is an explicit composition gate, never inferred from package bytes.
// Task 3 must supply a reviewed official adapter before enabling load/restore.
let authoringPageRestoreBound=false;
function bindAuthoringPageRestore() {
  if(authoringPageRestoreBound)return; authoringPageRestoreBound=true;
  globalThis.addEventListener?.('pageshow',event => { if(event.persisted) { const workflow=globalThis.PankekiWorkflowController; workflow?.go(workflow.getScreen(),{focus:false}); } });
}
function mountAuthoringV3Workspace() {
  if (authoringV3 || !globalThis.PankekiAuthoringV3 || !globalThis.PankekiDocumentV3 || !globalThis.PankekiRendererV3 || !$('v3Workspace')) return authoringV3;
  authoringV3Database = typeof indexedDB === 'undefined' ? Promise.resolve(null) : new Promise((resolve,reject) => {
    const request = indexedDB.open('pankeki-authoring-v3',1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('projects')) request.result.createObjectStore('projects'); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error || Error('Could not open rigging storage.'));
    request.onblocked = () => reject(Error('Another tab is using rigging storage.'));
  });
  authoringV3 = globalThis.PankekiAuthoringV3.mount(document,{renderer:globalThis.PankekiRendererV3,exporter:globalThis.PankekiExportV3,
    onError:error => projectStatus('Precision rigging: ' + uiMessage(error.message),true),onChange:() => scheduleAuthoringV3Save()});
  globalThis.PankekiAuthoringV3Controller = authoringV3;
  // Read a candidate only. A late DB read never installs a document by itself.
  authoringV3Restore = authoringV3Database.then(db => db ? storage(db,false) : null).catch(error => { projectStatus(uiMessage(error.message),true); return null; });
  const action = fn => () => Promise.resolve().then(fn).catch(error => projectStatus('Precision rigging: ' + uiMessage(error.message),true));
  $('v3ExportPng')?.addEventListener('click',action(() => authoringV3.exportPosePng()));
  $('v3ExportZip')?.addEventListener('click',action(() => authoringV3.exportFrames()));
  $('v3Mode')?.addEventListener('click',action(() => setAuthoringV3Mode(true)));
  $('motionNativeMode')?.addEventListener('click',action(() => setAuthoringV3Mode(false)));
  $('v3CopyFromMotion')?.addEventListener('click',action(async () => {
    if (!motionController) throw Error('Prepare parts and meshes in basic authoring first.');
    const raw = await motionController.snapshotProject();
    const documentV3 = await globalThis.PankekiDocumentV3.upgradeV2(raw);
    await openAuthoringV3(documentV3);
  }));
  $('v3Open')?.addEventListener('click',() => $('v3OpenFile')?.click());
  $('v3OpenFile')?.addEventListener('change',action(async () => {
    const file = $('v3OpenFile').files?.[0]; if (!file) return;
    try { if (file.size > MAX_FILE) throw Error('Rigging projects must be 64MiB or smaller.'); await openAuthoringV3(await file.text()); }
    finally { $('v3OpenFile').value = ''; }
  }));
  globalThis.addEventListener?.('pagehide',event => { clearTimeout(authoringV3Timer); ++authoringV3PersistenceEpoch; if(event.persisted) authoringV3.suspend(); else authoringV3.destroy(); });
  bindAuthoringPageRestore();
  return authoringV3;
}
async function setAuthoringV3Mode(selected) {
  if (!authoringV3) return;
  if (!selected && authoringV3.getSummary().loaded) await authoringV3.snapshotProject();
  authoringV3Selected = selected; document.body.dataset.nativeAuthoring = selected ? 'v3' : 'v2';
  const workflow = globalThis.PankekiWorkflowController;
  workflow?.go(workflow.getScreen(),{focus:false});
  if (selected && !authoringV3.getSummary().loaded) {
    const epoch = authoringV3PersistenceEpoch, generation = authoringV3.getSummary().generation, raw = await authoringV3Restore;
    if (raw && authoringV3Selected && epoch === authoringV3PersistenceEpoch && generation === authoringV3.getSummary().generation && !authoringV3.getSummary().loaded) { notifyStudio('v3-import'); await authoringV3.loadDocument(raw); }
  }
  scheduleAuthoringV3Save();
}
async function openAuthoringV3(raw) {
  if (!authoringV3) throw Error('Precision rigging editor unavailable.');
  notifyStudio('v3-import');
  if (authoringV3.getSummary().loaded) await authoringV3.snapshotProject();
  ++authoringV3PersistenceEpoch;
  const loaded = await authoringV3.loadDocument(raw);
  if (loaded) { await setAuthoringV3Mode(true); globalThis.PankekiWorkflowController?.go('motion'); scheduleAuthoringV3Save(); projectStatus('Precision rigging project opened. The basic authoring source is preserved.'); }
  return loaded;
}
function scheduleAuthoringV3Save() {
  clearTimeout(authoringV3Timer);
  if (!activeAuthoringV3Workspace() || !authoringV3.getSummary().loaded) return;
  const epoch = authoringV3PersistenceEpoch, generation = authoringV3.getSummary().generation;
  authoringV3Timer = setTimeout(() => {
    authoringV3Queue = authoringV3Queue.catch(() => {}).then(async () => {
      if (!activeAuthoringV3Workspace() || epoch !== authoringV3PersistenceEpoch || generation !== authoringV3.getSummary().generation) return;
      const raw = await authoringV3.snapshotProject(), db = await authoringV3Database;
      if (!db) throw Error('Autosave unavailable. Save a project file.');
      if (!activeAuthoringV3Workspace() || epoch !== authoringV3PersistenceEpoch || generation !== authoringV3.getSummary().generation) return;
      await storage(db,true,raw);
    }).catch(error => projectStatus('Rigging autosave failed: ' + uiMessage(error.message),true));
  },200);
}
try { generationSettings = readGenerationSettings(); } catch { /* Retain only complete generation controls during startup. */ }
clearMask(); setMode('txt2img'); renderGallery(); const initialRestore=restoreSaved(); mountMotionWorkspace(); globalThis.addEventListener?.('pagehide',() => motionController?.suspend()); bindAuthoringPageRestore(); mountAuthoringV3Workspace();
function modelsForMode(mode) {
  return mode === 'txt2img' ? imageModels : mode === 'inpaint' ? editImageModels : [];
}
function selectedImageModel(mode) {
  return modelsForMode(mode).find(item => item.id === $('imageModel').value && item.available === true);
}
function imageModelSettingsBusy() {
  return busy || desktopRequests.size > 0 || importing || maskLoading || drawing || !!photoActive;
}
function imageModelSettingsError(code,message) { return Object.assign(Error(message),{code}); }
function validateImageModelSelection(mode,id) {
  const model = typeof id === 'string' && modelsForMode(mode).find(item => item.id === id);
  if (!model) throw imageModelSettingsError('IMAGE_MODEL_SETTINGS_INVALID',mode === 'txt2img' ? 'Select an available image generation model.' : 'Select an available masked edit model.');
  if (model.available !== true) throw imageModelSettingsError('IMAGE_MODEL_UNAVAILABLE',model.label + ': ' + (model.reason||'This model is not installed or is currently unavailable.'));
  return model.id;
}
function getImageModelSettings() {
  const section = mode => Object.freeze({selectedId:modelSelections[mode],
    models:Object.freeze(modelsForMode(mode).map(model => Object.freeze({id:model.id,label:model.label,available:model.available === true,
      ...(model.available === true ? {} : {reason:model.reason||'This model is not installed or is currently unavailable.'})}))),
    ...(modelSelectionReasons[mode] ? {reason:modelSelectionReasons[mode]} : {})});
  return Object.freeze({ready:modelsReady,source:capabilitySnapshot?.source||'unavailable',revision:capabilitySnapshot?.revision||null,capabilityReason:capabilitySnapshot?.reason||null,busy:imageModelSettingsBusy(),error:modelLoadError,persistenceError:imageModelPersistenceError,
    generation:section('txt2img'),edit:section('inpaint')});
}
function validateGenerationSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== generationSettingKeys.length ||
      Object.keys(value).some(key => !generationSettingKeys.includes(key))) throw Error('Invalid saved generation settings');
  const result = {};
  for (const [key,[min,max,integer]] of Object.entries(generationSettingLimits)) {
    const number = value[key];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max || integer && !Number.isSafeInteger(number)) throw Error('Invalid saved ' + key);
    result[key] = number;
  }
  if (result.width % 8 || result.height % 8 || typeof value.negative !== 'string' || value.negative.length > 10000 ||
      !['dpmpp_2m','euler','euler_ancestral'].includes(value.sampler) || !['karras','normal','simple'].includes(value.scheduler) ||
      typeof value.cache !== 'boolean' || typeof value.previewOn !== 'boolean') throw Error('Invalid saved generation settings');
  for (const key of ['negative','sampler','scheduler','cache','previewOn']) result[key] = value[key];
  return result;
}
function readGenerationSettings() {
  const value = {};
  for (const key of generationSettingKeys) {
    const input = $(key);
    if (Object.hasOwn(generationSettingLimits,key)) {
      if (!input.value.trim()) throw Error('Incomplete generation setting');
      value[key] = Number(input.value);
    } else value[key] = ['cache','previewOn'].includes(key) ? input.checked : input.value;
  }
  return validateGenerationSettings(value);
}
function applyGenerationSettings(value) {
  for (const key of generationSettingKeys) {
    if (typeof value[key] === 'boolean') $(key).checked = value[key];
    else $(key).value = String(value[key]);
  }
}
function persistImageModelSettings() {
  // The form is shared with inpaint. Only generation edits may replace this snapshot.
  if (imageMode === 'txt2img') {
    try { generationSettings = readGenerationSettings(); } catch { /* Keep the last complete, valid values while typing. */ }
  }
  if (!modelsReady) return;
  try {
    localStorage.setItem(imageModelStorageKey,JSON.stringify({version:1,generationModelId:modelSelections.txt2img,editModelId:modelSelections.inpaint,
      ...(generationSettings && modelSelections.txt2img ? {generationSettings} : {})}));
    imageModelPersistenceError = '';
  } catch { imageModelPersistenceError = 'Could not save image model and generation settings on this device. Current settings remain until the app closes.'; }
}
function restoreImageModelSettings(initialId) {
  modelSelections.txt2img = initialId;
  let raw;
  try { raw = localStorage.getItem(imageModelStorageKey); }
  catch { imageModelPersistenceError = 'Could not read saved image model selections on this device. Model selection is still available in this app session.'; return; }
  if (raw === null) return;
  let saved;
  try {
    if (raw.length > 65536) throw Error('Saved image settings too large');
    saved = JSON.parse(raw);
    if (!saved || Array.isArray(saved) || saved.version !== 1 || typeof saved.generationModelId !== 'string' || typeof saved.editModelId !== 'string' ||
        Object.keys(saved).some(key => !['version','generationModelId','editModelId','generationSettings'].includes(key))) throw Error('Invalid saved image settings');
  } catch {
    for (const mode of ['txt2img','inpaint']) { modelSelections[mode] = ''; modelSelectionReasons[mode] = 'Could not verify saved image model settings. Select the models again.'; }
    return;
  }
  for (const [mode,key] of [['txt2img','generationModelId'],['inpaint','editModelId']]) {
    if (saved[key] === '' && mode === 'inpaint') { modelSelections[mode] = ''; continue; }
    try { modelSelections[mode] = validateImageModelSelection(mode,saved[key]); }
    catch (error) { modelSelections[mode] = ''; modelSelectionReasons[mode] = 'Saved model unavailable. ' + uiMessage(error.message); }
  }
  if (modelSelections.txt2img && Object.hasOwn(saved,'generationSettings')) {
    try { generationSettings = validateGenerationSettings(saved.generationSettings); } catch { generationSettings = null; }
  }
}
function setImageModelSettings(patch) {
  if (!modelsReady) throw imageModelSettingsError('IMAGE_MODELS_NOT_READY',modelLoadError || 'Check the image model list and select again.');
  if (imageModelSettingsBusy()) throw imageModelSettingsError('IMAGE_MODELS_BUSY','Change the image model after the current task finishes.');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !['generationModelId','editModelId'].includes(key))) {
    throw imageModelSettingsError('IMAGE_MODEL_SETTINGS_INVALID','Check generation and masked edit model settings.');
  }
  const changes = [];
  for (const [mode,key] of [['txt2img','generationModelId'],['inpaint','editModelId']]) {
    if (Object.hasOwn(patch,key)) changes.push([mode,validateImageModelSelection(mode,patch[key])]);
  }
  if (!changes.length) return getImageModelSettings();
  if (changes.some(([mode,id]) => modelSelections[mode] !== id)) touch();
  for (const [mode,id] of changes) { modelSelections[mode] = id; modelSelectionReasons[mode] = ''; }
  persistImageModelSettings(); syncModelOptions($('mode').value); renderView(); notifyStudio('image-model-settings');
  return getImageModelSettings();
}
function updateModelHelp() {
  const model = selectedImageModel($('mode').value), dedicated = model?.id === 'sdxl-inpaint-v01';
  if (dedicated) {
    if (dedicatedCachePrior === null) dedicatedCachePrior = $('cache').checked;
    $('cache').checked = false;
  } else if (dedicatedCachePrior !== null) {
    $('cache').checked = dedicatedCachePrior; dedicatedCachePrior = null;
  }
  $('cache').disabled = dedicated;
  $('resetModelPreset').disabled = imageModelSettingsBusy() || !model;
  $('imageModelHelp').textContent = (capabilitySnapshot?.reason?uiMessage(capabilitySnapshot.reason)+' · ':'')+(uiMessage(model?.description) || 'Select a model to use.');
  $('imageModelNote').textContent = model ? model.id === 'animagine-xl-4.0-opt' ? `${model.label} · Generation only. Use English comma-separated tags with quality tags at the end. The preset applies 28 steps, CFG 5, Euler a, and the recommended negative prompt: ${model.recommended_negative || "None"}. Check result quality yourself.` : `${model.label} · English descriptions recommended. Check results for detail, color, and masked edit accuracy.${dedicated?' Dedicated editing bypasses cache and preserves your strength and settings.':''}` : 'Select an installed, available model to run.';
}
function syncModelOptions(mode) {
  if (!modelsReady) return;
  $('imageModel').replaceChildren();
  if (mode === 'inpaint') {
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.disabled = true;
    placeholder.textContent = 'Select masked edit model'; $('imageModel').appendChild(placeholder);
  }
  for (const model of modelsForMode(mode)) {
    const option = document.createElement('option'); option.value = model.id; option.disabled = !model.available;
    option.textContent = model.label + (model.available ? '' : ' · '+(uiMessage(model.reason)||'Unavailable')); option.title=uiMessage(model.reason)||''; $('imageModel').appendChild(option);
  }
  $('imageModel').value = modelSelections[mode];
  $('imageModel').disabled = imageModelSettingsBusy();
  updateModelHelp();
}
function applyModelPreset(reset = false) {
  const model = selectedImageModel($('mode').value);
  if (model && (!['sdxl-inpaint-v01','animagine-xl-4.0-opt'].includes(model.id) || reset)) {
    for (const key of ['width','height','steps','cfg','denoise','sampler','scheduler']) $(key).value = String(model.defaults[key]);
    if (reset && model.id === 'animagine-xl-4.0-opt' && typeof model.recommended_negative === 'string') $('negative').value = model.recommended_negative;
  }
  updateModelHelp();
  renderView();
}
$('imageModel').onchange = () => {
  try { setImageModelSettings({[$('mode').value === 'txt2img' ? 'generationModelId' : 'editModelId']:$('imageModel').value}); applyModelPreset(); persistImageModelSettings(); }
  catch (error) { syncModelOptions($('mode').value); renderView(); status(uiMessage(error.message),true); }
};
$('resetModelPreset').onclick = () => {
  if (imageModelSettingsBusy()) { status('Change image model settings after the current task finishes.',true); return; }
  touch(); if (imageMode === 'txt2img') generationSettingsTouched = true; applyModelPreset(true); persistImageModelSettings();
};
async function loadImageCapabilities() {
  let response;
  try {response=await fetch('/api/capabilities');}
  catch {return Design.legacyCapabilities(await api('/api/models'));}
  if(response.status===404)return Design.legacyCapabilities(await api('/api/models'));
  if(!response.ok)throw Error('Capability snapshot unavailable: '+response.status);
  return Design.validateCapabilities(await response.json());
}
const modelCatalogReady = loadImageCapabilities().then(snapshot => {
  capabilitySnapshot=snapshot;
  imageModels=Design.capabilityModels(snapshot,'generate');
  editImageModels=Design.capabilityModels(snapshot,'regenerate');
  for(const model of snapshot.models)modelLabels[model.id]=model.label;
  const initial=imageModels.find(item=>item.id===snapshot.default_model_id)||null;
  const pendingGenerationSettings = generationSettings;
  generationSettings = null;
  restoreImageModelSettings(initial?.id||''); modelsReady = true;
  const restoredGenerationSettings = generationSettings !== null;
  const generationModel = imageModels.find(item => item.id === modelSelections.txt2img && item.available);
  if (generationSettingsTouched && pendingGenerationSettings) generationSettings = pendingGenerationSettings;
  // Initialize the missing generation snapshot independently of the visible edit form.
  if (!generationSettings && pendingGenerationSettings && generationModel) {
    const initialSettings = {...pendingGenerationSettings};
    for (const key of ['width','height','steps','cfg','denoise','sampler','scheduler']) initialSettings[key] = generationModel.defaults[key];
    if (generationModel.id === 'animagine-xl-4.0-opt' && typeof generationModel.recommended_negative === 'string') initialSettings.negative = generationModel.recommended_negative;
    generationSettings = validateGenerationSettings(initialSettings);
  }
  syncModelOptions(imageMode);
  // Saved values win over metadata. ID-only installations initialize once;
  // a late catalog must leave user input, explicit imports and edit forms alone.
  if (imageMode === 'txt2img' && !generationSettingsTouched && generationModel) {
    if (restoredGenerationSettings) applyGenerationSettings(generationSettings);
    else applyModelPreset(true);
  }
  persistImageModelSettings(); updateModelHelp(); renderView();
}).catch(error => {
  modelLoadError = 'Could not check image models. Check the server and refresh. ' + uiMessage(error.message);
  $('imageModelHelp').textContent = $('imageModelNote').textContent = modelLoadError;
  modelsReady = false; renderView();
});
api('/api/health').then(health => {
  $('healthText').textContent = health.comfy ? 'ComfyUI connected' : 'Connect ComfyUI'; $('health').classList.toggle('offline',!health.comfy);
  if (!health.comfy && editEpoch === 0) status(uiMessage(health.error) || 'Start the ComfyUI server first.',true);
}).catch(error => { $('healthText').textContent = 'Connect server'; $('health').classList.add('offline'); if (editEpoch === 0) status('Check the Pankeki generation server connection. ' + uiMessage(error.message),true); });

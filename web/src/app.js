'use strict';
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
  const overflow = () => new RangeError('보드가 16MP 한도를 넘습니다. 내용이나 선택 이미지를 나누어 내보내세요.');

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
    if (candidateInfos.length > 2) throw new RangeError('보드에는 이미지를 최대 2개 선택할 수 있습니다.');
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
          if (!line) throw new RangeError('한 글자가 보드 텍스트 영역보다 넓습니다.');
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
          if (ctx.measureText(line).width > width) throw new RangeError('한 글자가 보드 텍스트 영역보다 넓습니다.');
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
      y = addText('name', textOf(brief.name) || '이름 없는 캐릭터', MARGIN, y, contentWidth, 58, 700, '#172c31') + 12;
      y = addText('profileLabel', textOf(brief.profileLabel) || '캐릭터 디자인', MARGIN, y, contentWidth, 27, 400, '#596772') + 32;

      const colors = Array.isArray(brief.palette) ? brief.palette : [];
      const swatchWidth = (contentWidth - 2 * GAP) / 3;
      y = addText('palette:heading', '컬러 가이드', MARGIN, y, contentWidth, 23, 700, '#536474') + 14;
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
            throw new RangeError('이미지 크기를 읽을 수 없습니다. 이미지 디코딩 후 다시 시도하세요.');
          }
          const frame = { index, x: MARGIN + index * (frameWidth + GAP), y, width: frameWidth, height: frameHeight };
          const scale = Math.min(frameWidth / sourceWidth, frameHeight / sourceHeight);
          const width = sourceWidth * scale;
          const height = sourceHeight * scale;
          layout.frames.push(frame);
          layout.images.push({ index, x: frame.x + (frameWidth - width) / 2, y: frame.y + (frameHeight - height) / 2, width, height, frame });
          let bottom = addText(`candidate:${index}:label`, textOf(candidate.label) || `후보 ${index + 1}`, frame.x, labelTop, frameWidth, 28, 700);
          const kinds = { upload: '업로드 원본', uploaded: '업로드 원본', source: '원본', generated: '생성 후보', edited: '부분 수정' };
          if (candidate.kind) bottom = addText(`candidate:${index}:kind`, kinds[candidate.kind] || textOf(candidate.kind), frame.x, bottom + 8, frameWidth, 22, 400, '#596772');
          if (candidate.brief && candidate.brief.name && candidate.brief.name !== brief.name) {
            bottom = addText(`candidate:${index}:name`, `생성 당시 이름: ${textOf(candidate.brief.name)}`, frame.x, bottom + 8, frameWidth, 22, 400, '#596772');
          }
          rowBottom = Math.max(rowBottom, bottom);
        });
        y = rowBottom + 52;
      }

      section('brief', '캐릭터 설정', brief.brief);
      section('appearance', '외형과 인상', brief.appearance);
      section('detail', textOf(brief.detailLabel) || '디자인 디테일', brief.detail);
      section('notes', '작업 메모', brief.notes);
      y = addText('footer', 'Pankeki · 캐릭터 콘셉트 탐색과 공유를 위한 보드', MARGIN, y + 8, contentWidth, 21, 400, '#647580');
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
    if (!ctx) throw new Error('Canvas 2D를 사용할 수 없습니다.');
    const layout = createBoardLayout(ctx, brief, candidates);
    for (const candidate of candidates) {
      if (!candidate.image || typeof candidate.image !== 'object') throw new TypeError('보드에는 디코딩한 이미지 객체가 필요합니다.');
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
const $ = id => document.getElementById(id);
const Design = globalThis.CharacterDesign;
const session = crypto.randomUUID();
const MAX_FILE = 64 * 1024 * 1024, MAX_IMAGE = 16 * 1024 * 1024;
let current = null, serial = 0, sourceLoaded = false, drawing = false;
let latestUrl = null, latestId = null, sourceId = null, sourceDataURL = null;
let sourceRevision = 0, maskRevision = 0, maskLoading = false, importRevision = 0;
let editEpoch = 0, importing = false, view = 'result', previewVisible = false, busy = false;
let selectedIds = [], saveTimer = null, saveQueue = Promise.resolve();
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
function projectStatus(message, error = false) {
  $('projectStatus').textContent = message; $('projectStatus').classList.toggle('error', error);
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
  if (!response.ok) throw Error(value.error || response.statusText);
  return value;
}
function touch() {
  if (importing) projectStatus('새 작업을 시작하여 진행 중인 프로젝트 불러오기를 중단했어요.');
  ++editEpoch; ++importRevision; importing = false;
}
function updateBrief() {
  project.brief = readBrief();
  const profile = Design.profiles[project.brief.profile];
  $('profileHelp').textContent = profile.description; $('profileDetailLabel').textContent = profile.detailLabel;
  $('profileDetailHint').textContent = profile.detailHint;
  $('compiledPrompt').textContent = Design.buildPrompt(project.brief, $('mode').value);
}
function applyBrief(brief) {
  $('profile').value = brief.profile;
  for (const [key,id] of Object.entries(briefFields)) $(id).value = brief[key];
  brief.palette.forEach((value,index) => $('palette' + (index + 1)).value = value);
  $('useBrief').checked = brief.useBrief; updateBrief();
}
function briefChanged() { touch(); updateBrief(); scheduleSave(); }
for (const id of ['profile', ...Object.values(briefFields), 'palette1','palette2','palette3','useBrief']) {
  $(id).oninput = briefChanged; $(id).onchange = briefChanged;
}
$('presetExample').onclick = () => {
  const profile = $('profile').value;
  touch(); applyBrief(Design.sanitizeBrief({...Design.profiles[profile].example, profile, useBrief:true})); scheduleSave();
  status('예시 설정을 적용했어요. 세부 내용을 바꿔 나만의 캐릭터로 만들어보세요.');
};
function renderView() {
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
  $('canvasHint').textContent = showSource ? '밝게 칠한 영역만 수정합니다. 선택 밖 영역은 원본을 보존해요.' : busy ? '후보를 순서대로 만들고 있어요. 미리보기는 최종 이미지와 다를 수 있어요.' : showResult ? '후보를 비교하고 선택한 디자인을 이어서 수정해보세요.' : '설정을 작성하거나 원본을 불러와 시작하세요.';
  $('generateLabel').textContent = busy ? '새 요청으로 다시 생성' : $('mode').value === 'inpaint' ? '선택 영역 수정' : '캐릭터 후보 생성';
  $('cancel').hidden = !busy; $('cancel').disabled = !busy;
  if ($('emptyHeading')) $('emptyHeading').textContent = $('mode').value === 'inpaint' ? '수정할 원본을 먼저 불러오세요.' : '아직 이름 없는 아이디어도 좋아요.';
  if ($('emptyDescription')) $('emptyDescription').textContent = $('mode').value === 'inpaint' ? '이미지를 업로드하거나 후보의 ‘이어서 수정’을 선택한 뒤, 바꾸고 싶은 부분을 칠해주세요.' : '성격과 생김새를 적고 첫 후보를 만들어보세요. 기존 캐릭터를 불러와 다듬을 수도 있어요.';
}
function setMode(value) {
  $('mode').value = value; const editing = value === 'inpaint';
  document.querySelectorAll('[data-mode]').forEach(button => {
    const active = button.dataset.mode === value;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  $('modeTitle').textContent = editing ? '필요한 부분만 수정' : '캐릭터 후보 만들기';
  $('modeDescription').textContent = editing ? '선택한 디자인에서 바꾸고 싶은 곳만 칠해주세요.' : '설정과 색을 바탕으로 디자인을 탐색해보세요.';
  $('workspaceMode').textContent = editing ? '부분 수정' : '후보 생성';
  $('canvasHeading').textContent = editing ? '선택한 캐릭터를 다듬어보세요.' : '나만의 캐릭터를 만들어보세요.';
  $('roiOptions').hidden = !editing; view = editing ? 'source' : 'result'; updateBrief(); renderView();
}
function clearMask() {
  ++maskRevision; maskLoading = false; context.fillStyle = 'black'; context.fillRect(0,0,paint.width,paint.height);
}
function stopBatch() {
  ++serial; const id = current; current = null; busy = false; previewVisible = false; renderView();
  return id ? api('/api/jobs/' + id + '/cancel',{}).catch(() => null) : Promise.resolve();
}
async function cancel() {
  const pending = stopBatch(); badge('취소됨');
  status('남은 후보 생성을 취소했어요. 이미 시작한 GPU 연산은 계속될 수 있습니다.'); await pending;
}
async function decodeImage(url) {
  const image = new Image(); image.src = url; await image.decode();
  const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
  if (!width || !height || width * height > 16777216) throw Error('이미지는 최대 16MP까지 불러올 수 있습니다.');
  return image;
}
async function readDataURL(url) {
  if (url.startsWith('data:')) {
    if (url.length > MAX_IMAGE) throw Error('이미지는 Base64 저장 크기 16MiB 이하여야 합니다.');
    return url;
  }
  const response = await fetch(url);
  if (!response.ok) throw Error('원본 이미지를 불러오지 못했습니다.');
  const blob = await response.blob();
  if (blob.size > MAX_IMAGE * .75) throw Error('이미지 파일이 너무 큽니다. 저장 크기는 Base64 16MiB까지입니다.');
  const data = await new Promise((resolve,reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || Error('이미지 파일을 읽지 못했습니다.')); reader.readAsDataURL(blob);
  });
  if (typeof data !== 'string' || data.length > MAX_IMAGE) throw Error('이미지 저장 크기는 Base64 16MiB까지입니다.');
  return data;
}
function commitSource(image,data,parentId) {
  canvas.width = paint.width = image.naturalWidth || image.width;
  canvas.height = paint.height = image.naturalHeight || image.height;
  canvas.getContext('2d').drawImage(image,0,0); clearMask();
  sourceDataURL = data; sourceLoaded = true; sourceId = parentId;
}
async function loadSource(url,{parentId = null,record = false} = {}) {
  if (record && project.versions.length >= 20) throw Error('후보는 최대 20개입니다. 프로젝트를 저장한 뒤 새 프로젝트를 시작해주세요.');
  if (parentId && !project.versions.some(item => item.id === parentId)) throw Error('수정할 후보가 현재 프로젝트에 없습니다.');
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
for (const id of ['width','height','seed','steps','cfg','denoise','halo','feather','candidateCount','negative','cache','roi','previewOn']) $(id).oninput = () => { touch(); renderView(); };
$('upload').onchange = async () => {
  const file = $('upload').files[0]; if (!file) return;
  const url = URL.createObjectURL(file);
  try { if (await loadSource(url,{record:true})) { setMode('inpaint'); status('원본을 후보 목록에 보관했어요. 수정할 곳을 브러시로 칠해주세요.'); } }
  catch (error) { status(error.message,true); }
  finally { URL.revokeObjectURL(url); $('upload').value = ''; }
};
$('maskUpload').onchange = async () => {
  const file = $('maskUpload').files[0]; if (!file) return;
  if (!sourceLoaded) { status('원본 이미지를 먼저 불러오세요.',true); $('maskUpload').value = ''; return; }
  touch(); const token = ++maskRevision, sourceToken = sourceRevision;
  const url = URL.createObjectURL(file), isCurrent = () => token === maskRevision && sourceToken === sourceRevision;
  maskLoading = true; drawing = false;
  try {
    const image = await decodeImage(url); if (!isCurrent()) return;
    if ((image.naturalWidth || image.width) !== paint.width || (image.naturalHeight || image.height) !== paint.height) throw Error('마스크와 원본의 크기가 같아야 합니다.');
    context.fillStyle = 'black'; context.fillRect(0,0,paint.width,paint.height); context.drawImage(image,0,0);
    status('마스크를 불러왔어요. 밝은 부분이 수정 영역입니다.');
  } catch (error) { if (isCurrent()) status(error.message,true); }
  finally { if (isCurrent()) maskLoading = false; URL.revokeObjectURL(url); $('maskUpload').value = ''; }
};
$('clearMask').onclick = () => { touch(); clearMask(); status('수정 마스크를 지웠어요. 원본 이미지는 그대로입니다.'); };
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
  touch(); ++maskRevision; maskLoading = false; drawing = true; paint.setPointerCapture(event.pointerId); stroke(event,true);
};
paint.onpointermove = event => { if (drawing) stroke(event,false); };
paint.onpointerup = paint.onpointercancel = () => { drawing = false; };
function displayError(message) {
  return String(message).includes('Pankeki source changed') ? '앱 코드가 갱신되었습니다. Pankeki 생성 서버를 다시 시작한 뒤 생성해주세요.' : message;
}
function requestSnapshot(brief) {
  const request = {mode:$('mode').value,prompt:Design.buildPrompt(brief,$('mode').value),negative:$('negative').value,cache:$('cache').checked,roi:$('roi').checked,preview:$('previewOn').checked};
  const limits = {seed:[0,Number.MAX_SAFE_INTEGER,true],steps:[1,100,true],width:[64,2048,true],height:[64,2048,true],cfg:[0,30],denoise:[.01,1],halo:[0,512,true],feather:[0,64,true]};
  for (const [key,[min,max,integer]] of Object.entries(limits)) {
    const text = $(key).value, value = Number(text);
    if (text.trim() === '' || !Number.isFinite(value) || value < min || value > max || integer && !Number.isSafeInteger(value)) throw Error(`${key}: ${min}~${max} 범위의 ${integer ? '정수' : '숫자'}를 입력해주세요.`);
    request[key] = value;
  }
  if (request.width % 8 || request.height % 8) throw Error('이미지 크기는 8의 배수여야 합니다.');
  if (request.mode === 'inpaint') {
    if (!sourceLoaded) throw Error('수정할 원본 이미지를 먼저 불러오세요.');
    if (maskLoading) throw Error('마스크를 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
    request.source = sourceDataURL; request.mask = paint.toDataURL('image/png');
  }
  return request;
}
function summaryMetrics(value = {}) {
  const result = {};
  for (const key of ['cache','total_s','model_calls','outside_mask_max_error','outside_alpha_max_error','roi_used','skipped']) {
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
      if (++failures >= 5) throw Error('서버 연결을 확인해주세요. 결과 상태를 확인할 수 없어 후속 생성을 중단했습니다.');
      status('연결을 다시 확인하고 있어요: ' + error.message,true);
      await new Promise(resolve => setTimeout(resolve,500)); continue;
    }
    if (token !== serial) return null;
    if (!job.is_current) throw Error('다른 요청이 시작되어 이 후보 생성을 중단했습니다.');
    status(`후보 ${index + 1}/${count} · ${job.state === 'queued' ? '생성 순서를 기다리고 있어요.' : '이미지를 만들고 있어요.'}`);
    if (job.preview != null && job.preview !== lastPreview && !['succeeded','failed','canceled','uncertain'].includes(job.state)) {
      lastPreview = job.preview; $('preview').src = '/api/previews/' + id + '?v=' + encodeURIComponent(lastPreview);
      previewVisible = true; badge('미리보기','busy'); renderView();
    }
    if (job.state === 'succeeded') return job.result;
    if (['failed','canceled','uncertain'].includes(job.state)) throw Error(job.error || {failed:'생성 실패',canceled:'생성이 취소되었습니다.',uncertain:'생성 상태를 확인해야 합니다.'}[job.state]);
    await new Promise(resolve => setTimeout(resolve,250));
  }
  return null;
}
async function generate() {
  let token, completed = 0;
  try {
    if (importing) throw Error('프로젝트를 불러오는 중입니다. 잠시 후 생성해주세요.');
    const brief = readBrief(), count = Number($('candidateCount').value);
    const requests = Design.makeRequests(requestSnapshot(brief),count);
    if (project.versions.length + count > 20) throw Error('후보는 최대 20개입니다. 프로젝트를 저장하고 새 프로젝트를 시작하거나 후보 수를 줄여주세요.');
    const parentId = requests[0].mode === 'inpaint' ? sourceId : null;
    touch(); void stopBatch(); token = ++serial; busy = true; view = 'result'; badge('생성 중','busy'); renderView();
    for (let index = 0; index < requests.length; index++) {
      if (token !== serial) return false;
      status(`후보 ${index + 1}/${count} 생성을 준비하고 있어요…`);
      const request = requests[index], job = await api('/api/jobs',{session,request});
      if (token !== serial) { await api('/api/jobs/' + job.job_id + '/cancel',{}).catch(() => null); return false; }
      current = job.job_id;
      const result = await poll(current,token,index,count);
      if (!result || token !== serial) return false;
      const data = await readDataURL(result.image_url); if (token !== serial) return false;
      await decodeImage(data); if (token !== serial) return false;
      const metrics = summaryMetrics(result.metrics);
      const item = {id:crypto.randomUUID(),createdAt:new Date().toISOString(),label:`후보 ${project.versions.filter(v => v.kind === 'generated').length + 1}`,image:data,kind:'generated',brief,request,parentId,metrics};
      project = Design.createProject(readBrief(),[...project.versions,item],project.selectionHistory);
      ++completed; ++editEpoch; current = null; previewVisible = false;
      showCandidate(item); renderGallery(); scheduleSave(); $('metrics').textContent = JSON.stringify(result.metrics || {},null,2);
    }
    if (token === serial) {
      const reused = project.versions.slice(-completed).filter(item => item.metrics.cache === 'hit').length;
      const copied = project.versions.slice(-completed).filter(item => item.metrics.cache === 'empty-mask-skip').length;
      badge(copied === completed ? '원본 복사 · 수정 영역 없음' : '후보 준비 완료');
      status(`${completed}개 후보를 준비했어요.${reused ? ` 이 중 ${reused}개는 동일 완료 결과를 재사용했습니다.` : ''}${copied ? ` ${copied}개는 수정 영역이 없어 원본 복사로 처리했으며 추론을 실행하지 않았습니다.` : ''} 비교할 후보를 선택해주세요.`);
    }
    return true;
  } catch (error) {
    if (token === undefined || token === serial) {
      status((completed ? `${completed}개 후보는 보관했습니다. ` : '') + displayError(error.message),true);
      if (token !== undefined) badge('생성 중단','failure');
    }
    return false;
  } finally { if (token !== undefined && token === serial) { current = null; busy = false; previewVisible = false; renderView(); } }
}
function kindLabel(item) {
  if (item.kind === 'upload') return '업로드 원본';
  if (item.metrics.cache === 'empty-mask-skip') return '원본 복사 · 수정 영역 없음';
  return item.kind === 'generated' ? (item.metrics.cache === 'hit' ? '생성 결과 · 재사용' : '생성 결과') : '불러온 이미지';
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
  if (project.selectionHistory.length >= 1000) throw Error('선택 기록이 1,000개에 도달했습니다. 저장한 뒤 새 프로젝트를 시작해주세요.');
  if (await loadSource(item.image,{parentId:item.id})) {
    recordSelection(item.id,'edit'); setMode('inpaint'); renderGallery();
    status('선택한 후보를 수정 원본으로 사용합니다. 바꿀 곳을 칠하고 추가 지시를 입력해주세요.');
  }
}
function element(tag,text,className) {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text;
  if (className) node.className = className; return node;
}
function button(text,action) {
  const node = element('button',text); node.type = 'button';
  node.onclick = async () => { try { await action(); } catch (error) { status(error.message,true); } }; return node;
}
function renderGallery() {
  const focused = document.activeElement, focusedAction = focused?.dataset?.action;
  let focusedCard = focused?.parentNode;
  while (focusedCard && focusedCard !== $('gallery') && !focusedCard.dataset?.candidateId) focusedCard = focusedCard.parentNode;
  const focusedId = focusedCard?.dataset?.candidateId;
  let focusTarget = null;
  $('gallery').replaceChildren(); $('galleryEmpty').hidden = project.versions.length > 0;
  $('selectionCount').textContent = `${selectedIds.length}/2 선택 · ${project.versions.length}/20 보관`;
  $('compareSelected').disabled = selectedIds.length !== 2;
  for (const item of project.versions) {
    const card = element('article',undefined,'candidate-card'); card.dataset.candidateId = item.id;
    card.classList.toggle('selected',selectedIds.includes(item.id)); card.classList.toggle('active',latestId === item.id);
    const image = element('img'); image.src = item.image; image.alt = item.label; image.loading = 'lazy';
    const info = element('div',undefined,'candidate-info');
    info.append(element('strong',item.label),element('span',kindLabel(item)),element('span',Design.profiles[item.brief.profile].label));
    if (item.parentId) info.append(element('small','수정 원본: ' + (project.versions.find(v => v.id === item.parentId)?.label || item.parentId)));
    const actions = element('div',undefined,'candidate-actions');
    const select = button(selectedIds.includes(item.id) ? '비교 선택 해제' : '비교 선택',() => {
      if (selectedIds.includes(item.id)) { selectedIds = selectedIds.filter(id => id !== item.id); touch(); }
      else {
        if (selectedIds.length >= 2) throw Error('비교는 두 후보까지 선택할 수 있어요. 선택을 하나 해제해주세요.');
        recordSelection(item.id,'compare'); selectedIds.push(item.id);
      }
      $('comparePanel').hidden = true; renderGallery();
    });
    select.setAttribute('aria-pressed',String(selectedIds.includes(item.id)));
    const controls = {
      view:button('크게 보기',() => { recordSelection(item.id,'view'); void stopBatch(); showCandidate(item); renderGallery(); }),
      edit:button('이어서 수정',() => editCandidate(item)),
      compare:select
    };
    for (const [action,control] of Object.entries(controls)) {
      control.dataset.action = action;
      if (item.id === focusedId && action === focusedAction) focusTarget = control;
      actions.append(control);
    }
    card.append(image,info,actions); $('gallery').append(card);
  }
  if (project.selectionHistory.length) {
    const details = element('details',undefined,'selection-history'); details.append(element('summary',`선택 기록 ${project.selectionHistory.length}개`));
    const list = element('ol');
    for (const entry of project.selectionHistory) {
      const item = project.versions.find(v => v.id === entry.candidateId);
      list.append(element('li',`${item.label} · ${{view:'보기',edit:'수정 원본 선택',compare:'비교 선택'}[entry.action]} · ${new Date(entry.at).toLocaleString()}`));
    }
    details.append(list); $('gallery').append(details);
  }
  if (focusTarget) focusTarget.focus({preventScroll:true});
}
$('compareSelected').onclick = () => {
  if (selectedIds.length !== 2) return;
  $('compareGrid').replaceChildren();
  for (const id of selectedIds) {
    const item = project.versions.find(v => v.id === id), figure = element('figure');
    const image = element('img'); image.src = item.image; image.alt = item.label;
    image.style.width = '100%'; image.style.height = 'auto'; image.style.objectFit = 'contain';
    figure.append(image,element('figcaption',`${item.label} · ${kindLabel(item)} · seed ${item.request.seed}`),button('이 후보로 수정',() => editCandidate(item))); $('compareGrid').append(figure);
  }
  $('comparePanel').hidden = false; $('comparePanel').setAttribute('tabindex','-1'); $('comparePanel').focus();
};
$('closeCompare').onclick = () => { $('comparePanel').hidden = true; $('compareSelected').focus(); };
$('comparePanel').onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); $('closeCompare').onclick(); } };
function hasWork() {
  return busy || sourceLoaded || project.versions.length > 0 || JSON.stringify(readBrief()) !== emptyBriefSnapshot;
}
function exportProject() { return JSON.stringify(Design.createProject(readBrief(),project.versions,project.selectionHistory)); }
function downloadBlob(blob,name) {
  const url = URL.createObjectURL(blob), link = element('a'); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
}
function safeName(brief = readBrief()) { return (brief.name || 'pankeki-character').replace(/[<>:"/\\|?*\u0000-\u001F]/g,'_').slice(0,80); }
$('saveProject').onclick = () => {
  try { downloadBlob(new Blob([exportProject()],{type:'application/json'}),safeName() + '.pankeki.json'); projectStatus('프로젝트 파일을 내보냈어요. 브리프·후보 이미지·선택 기록이 포함됩니다.'); }
  catch (error) { projectStatus('저장 실패: ' + error.message,true); }
};
async function importProject(raw,{restore = false} = {}) {
  let token;
  try {
    const next = Design.parseProject(raw);
    if (!restore && hasWork() && !confirm('현재 프로젝트를 불러온 파일로 교체할까요? 저장하지 않은 작업은 사라집니다. 필요하면 취소하고 프로젝트 파일을 먼저 저장해주세요.')) return false;
    if (!restore) touch();
    token = ++importRevision; const epoch = editEpoch; importing = true;
    // A confirmed import supersedes earlier jobs/uploads even during decoding.
    // Keep committed images and masks untouched until every imported image passes.
    void stopBatch(); ++sourceRevision; ++maskRevision; maskLoading = false; drawing = false;
    sourceLoaded = sourceDataURL !== null; renderView();
    projectStatus('프로젝트의 이미지 파일을 확인하고 있어요…');
    const active = () => token === importRevision && epoch === editEpoch;
    const chosenId = next.selectionHistory.at(-1)?.candidateId;
    const item = next.versions.find(v => v.id === chosenId) || next.versions.at(-1);
    let chosenImage = null;
    for (const candidate of next.versions) {
      const decoded = await decodeImage(candidate.image);
      if (!active()) return false;
      if (candidate.id === item?.id) chosenImage = decoded;
    }
    if (!active()) return false;
    void stopBatch(); ++sourceRevision; ++maskRevision; drawing = false; maskLoading = false;
    sourceDataURL = null; sourceId = null; sourceLoaded = false; latestUrl = null; latestId = null; selectedIds = [];
    project = next; applyBrief(next.brief); $('comparePanel').hidden = true; $('download').hidden = true;
    if (item) { commitSource(chosenImage,item.image,item.id); showCandidate(item); }
    else { clearMask(); $('result').removeAttribute('src'); badge('준비'); }
    setMode('txt2img'); renderGallery(); ++editEpoch;
    projectStatus(restore ? '이전 프로젝트를 자동 복원했어요. 편집 마스크는 다시 칠해주세요.' : '프로젝트를 불러왔어요. 편집 마스크는 다시 칠해주세요.');
    if (!restore) scheduleSave(); return true;
  } catch (error) { if (token === undefined || token === importRevision) projectStatus('불러오기 실패: ' + error.message,true); return false; }
  finally { if (token === importRevision) importing = false; }
}
$('loadProject').onchange = async () => {
  const file = $('loadProject').files[0]; if (!file) return;
  touch(); const token = ++importRevision;
  try {
    if (file.size > MAX_FILE) throw Error('프로젝트 파일은 최대 64MiB까지입니다.');
    const raw = await file.text(); if (token !== importRevision) return; await importProject(raw);
  } catch (error) { if (token === importRevision) projectStatus(error.message,true); }
  finally { $('loadProject').value = ''; }
};
function resetProject() {
  if (hasWork() && !confirm('새 프로젝트를 시작할까요? 저장하지 않은 작업은 사라집니다. 필요하면 취소하고 프로젝트 파일을 먼저 저장해주세요.')) return false;
  touch(); void stopBatch(); ++sourceRevision; clearMask(); drawing = false;
  project = Design.createProject(Design.sanitizeBrief({}),[],[]);
  emptyBriefSnapshot = JSON.stringify(project.brief);
  sourceLoaded = false; sourceDataURL = null; sourceId = null; latestUrl = null; latestId = null; selectedIds = [];
  $('result').removeAttribute('src'); $('preview').removeAttribute('src'); $('download').hidden = true; $('comparePanel').hidden = true;
  applyBrief(project.brief); setMode('txt2img'); renderGallery(); badge('준비'); scheduleSave(); status('새 캐릭터 프로젝트를 시작했어요.'); return true;
}
const database = typeof indexedDB === 'undefined' ? Promise.resolve(null) : new Promise((resolve,reject) => {
  const request = indexedDB.open('pankeki-character-studio',1);
  request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('projects')) request.result.createObjectStore('projects'); };
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error || Error('브라우저 저장소를 열지 못했습니다.'));
  request.onblocked = () => reject(Error('다른 탭에서 저장소를 사용하고 있습니다. 다른 Pankeki 탭을 닫아주세요.'));
});
function storage(db,write,value) {
  return new Promise((resolve,reject) => {
    const tx = db.transaction('projects',write ? 'readwrite' : 'readonly'), store = tx.objectStore('projects');
    const request = write ? store.put(value,'current') : store.get('current');
    request.onerror = () => reject(request.error || Error('브라우저 저장에 실패했습니다.'));
    tx.onerror = tx.onabort = () => reject(tx.error || Error('브라우저 저장에 실패했습니다.'));
    if (write) tx.oncomplete = () => resolve(); else request.onsuccess = () => resolve(request.result);
  });
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    let raw; try { raw = exportProject(); } catch (error) { projectStatus(error.message,true); return; }
    const epoch = editEpoch;
    saveQueue = saveQueue.catch(() => null).then(async () => {
      const db = await database;
      if (!db) throw Error('자동 저장을 사용할 수 없습니다. 프로젝트 파일로 저장해주세요.');
      await storage(db,true,raw);
      if (epoch === editEpoch) projectStatus('이 브라우저에 자동 저장했어요. 프로젝트 파일로도 보관할 수 있습니다.');
    }).catch(error => projectStatus('자동 저장 실패: ' + error.message + ' 프로젝트 파일 저장은 계속 사용할 수 있어요.',true));
  },200);
}
async function restoreSaved() {
  const epoch = editEpoch, revision = importRevision;
  try {
    const db = await database;
    if (!db) { projectStatus('자동 저장을 사용할 수 없습니다. 프로젝트 파일로 저장해주세요.'); return; }
    const raw = await storage(db,false);
    if (epoch !== editEpoch || revision !== importRevision) return;
    if (raw) await importProject(raw,{restore:true});
    else projectStatus('후보와 설정을 이 브라우저에 자동 저장합니다. 마스크는 프로젝트 파일에 포함되지 않습니다.');
  } catch (error) { if (epoch === editEpoch) projectStatus('자동 복원 실패: ' + error.message + ' 프로젝트 파일로 불러올 수 있어요.',true); }
}
$('newProject').onclick = resetProject; $('generate').onclick = generate; $('cancel').onclick = cancel;
$('useResult').onclick = async () => {
  const item = project.versions.find(v => v.id === latestId); if (!item) return;
  try { await editCandidate(item); } catch (error) { status(error.message,true); }
};
$('clearCache').onclick = async () => {
  try { await api('/api/cache/clear',{}); status('동일 결과 재사용 캐시를 비웠어요. 프로젝트의 후보 이미지는 유지됩니다.'); }
  catch (error) { status(error.message,true); }
};
$('exportBoard').onclick = async () => {
  const snapshot = clone(project), epoch = editEpoch;
  const fallbackId = view === 'source' && sourceId ? sourceId : latestId || sourceId;
  const ids = selectedIds.length ? [...selectedIds] : fallbackId ? [fallbackId] : [];
  try {
    if (!ids.length) throw Error('보드에 담을 후보를 먼저 생성하거나 선택해주세요.');
    const candidates = [];
    for (const id of ids) {
      const item = snapshot.versions.find(v => v.id === id);
      candidates.push({...item,kind:item.metrics.cache === 'empty-mask-skip' ? 'source' : item.kind,image:await decodeImage(item.image)});
    }
    const output = document.createElement('canvas'), profile = Design.profiles[snapshot.brief.profile];
    CharacterBoard.drawCharacterBoard(output,{...snapshot.brief,profileLabel:profile.label,detailLabel:profile.detailLabel},candidates);
    const blob = await new Promise((resolve,reject) => output.toBlob(value => value ? resolve(value) : reject(Error('PNG 파일을 만들지 못했습니다.')),'image/png'));
    downloadBlob(blob,safeName(snapshot.brief) + '-board.png');
    if (epoch === editEpoch) projectStatus('캐릭터 보드 PNG를 내보냈어요.');
  } catch (error) { if (epoch === editEpoch) projectStatus('보드 저장 실패: ' + error.message,true); }
};
$('helpButton').onclick = () => $('helpDialog').showModal(); $('closeHelp').onclick = () => $('helpDialog').close();
$('helpDialog').onclick = event => {
  if (event.target === $('helpDialog')) { const box = $('helpDialog').getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) $('helpDialog').close(); }
};
globalThis.PankekiStudio = Object.freeze({generate,cancel,loadSource,importProject,exportProject,resetProject,
  getState:() => clone({project,sourceDataURL,sourceLoaded,latestUrl,selectedIds,sourceId,serial,busy,sourceRevision,maskRevision,maskLoading,importing})});
clearMask(); setMode('txt2img'); renderGallery(); void restoreSaved();
api('/api/health').then(health => {
  $('healthText').textContent = health.comfy ? 'ComfyUI 연결됨' : 'ComfyUI 연결 필요'; $('health').classList.toggle('offline',!health.comfy);
  if (!health.comfy && editEpoch === 0) status(health.error || 'ComfyUI 서버를 먼저 시작해주세요.',true);
}).catch(error => { $('healthText').textContent = '서버 연결 필요'; $('health').classList.add('offline'); if (editEpoch === 0) status('Pankeki 생성 서버의 연결을 확인해주세요. ' + error.message,true); });

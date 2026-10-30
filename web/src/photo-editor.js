(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PankekiPhotoEditor = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const uiMessage = value => root.PankekiUIStrings?.message(value) ?? String(value ?? '');
  const TOOLS = Object.freeze(['markup', 'comments', 'background-remove', 'erase', 'resize']);
  const LABELS = Object.freeze({markup:'Markup', comments:'Comments', 'background-remove':'Remove background', erase:'Erase', resize:'Resize'});
  const MAX_PIXELS = 16777216, MAX_HISTORY = 60, MAX_POINTS = 100000;
  const MARKUP_LIMITS=Object.freeze({strokes:128,pointsPerStroke:4096,totalPoints:16384});
  let mountCount=0;
  const copy = value => JSON.parse(JSON.stringify(value));
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function validSize(width, height) {
    return Number.isInteger(width) && Number.isInteger(height) && width >= 1 && height >= 1 && width <= 8192 && height <= 8192 && width * height <= MAX_PIXELS;
  }
  function resizeDimensions(sourceWidth, sourceHeight, width, height, keepAspect, changed = 'width') {
    if (!validSize(sourceWidth, sourceHeight)) return {valid:false, error:'Cannot determine the source image dimensions.'};
    const parse = value => /^\d+$/.test(String(value)) ? Number(value) : NaN;
    let w = parse(width), h = parse(height);
    if (keepAspect) {
      if (changed === 'height') w = Math.round(h * sourceWidth / sourceHeight);
      else h = Math.round(w * sourceHeight / sourceWidth);
    }
    const valid = validSize(w, h);
    return {width:w, height:h, keepAspect:!!keepAspect, valid, error:valid ? '' : 'Width and height must be integers from 1–8192px, up to 16MP total.'};
  }
  // box is the image element's CSS content box, in viewport coordinates.
  function contentRect(box, width, height, fit = 'contain', position = '50% 50%') {
    if (![box.left,box.top,box.width,box.height,width,height].every(finite) || box.width <= 0 || box.height <= 0 || width <= 0 || height <= 0) return null;
    let w = box.width, h = box.height;
    if (fit !== 'fill') {
      let scale = fit === 'cover' ? Math.max(w / width, h / height) : fit === 'none' ? 1 : Math.min(w / width, h / height);
      if (fit === 'scale-down') scale = Math.min(1, scale);
      w = width * scale; h = height * scale;
    }
    const values = String(position).trim().split(/\s+/);
    if (values.length === 1) values.push('50%');
    if (['top','bottom'].includes(values[0])) values.reverse();
    const offset = (value, free) => value === 'left' || value === 'top' ? 0 : value === 'right' || value === 'bottom' ? free : value === 'center' ? free / 2 : /^-?[\d.]+%$/.test(value) ? free * parseFloat(value) / 100 : /^-?[\d.]+px$/.test(value) ? parseFloat(value) : free / 2;
    const left = box.left + offset(values[0], box.width - w), top = box.top + offset(values[1], box.height - h);
    return {left, top, width:w, height:h, right:left+w, bottom:top+h};
  }
  function pointerToImage(rect, x, y, width, height, constrained = false) {
    if (!rect || ![x,y,width,height].every(finite) || rect.width <= 0 || rect.height <= 0) return null;
    const px = (x - rect.left) / rect.width, py = (y - rect.top) / rect.height;
    if (!constrained && (px < 0 || py < 0 || px > 1 || py > 1)) return null;
    return {x:clamp(px,0,1)*width, y:clamp(py,0,1)*height};
  }
  function measureImageContent(image, win = root) {
    if (!image || image.hidden || image.complete === false || !image.naturalWidth || !image.naturalHeight) return null;
    const rect = image.getBoundingClientRect(), style = win.getComputedStyle ? win.getComputedStyle(image) : {};
    const number = name => parseFloat(style[name]) || 0;
    const sx = image.offsetWidth ? rect.width / image.offsetWidth : 1, sy = image.offsetHeight ? rect.height / image.offsetHeight : 1;
    const left = (number('borderLeftWidth')+number('paddingLeft'))*sx, right = (number('borderRightWidth')+number('paddingRight'))*sx;
    const top = (number('borderTopWidth')+number('paddingTop'))*sy, bottom = (number('borderBottomWidth')+number('paddingBottom'))*sy;
    return contentRect({left:rect.left+left, top:rect.top+top, width:rect.width-left-right, height:rect.height-top-bottom},image.naturalWidth,image.naturalHeight,style.objectFit || 'contain',style.objectPosition || '50% 50%');
  }
  function validateMarkup(strokes,width,height) {
    const fail=error=>({valid:false,error});
    if(!Array.isArray(strokes)||strokes.length>MARKUP_LIMITS.strokes)return fail('Markup supports up to 128 strokes.');
    let total=0;
    for(const stroke of strokes){
      if(!stroke||!Array.isArray(stroke.points)||!stroke.points.length||stroke.points.length>MARKUP_LIMITS.pointsPerStroke)return fail('Each stroke supports up to 4096 points.');
      total+=stroke.points.length;if(total>MARKUP_LIMITS.totalPoints)return fail('Markup supports up to 16384 points in total.');
      if(!/^#[0-9a-f]{6}$/i.test(stroke.color)||!finite(stroke.width)||stroke.width<1||stroke.width>256||!finite(stroke.opacity)||stroke.opacity<0||stroke.opacity>1)return fail('Brush size must be 1–256px, opacity 0–100%, and color a HEX value.');
      if(!stroke.points.every(p=>p&&finite(p.x)&&finite(p.y)&&p.x>=0&&p.y>=0&&p.x<=width&&p.y<=height))return fail('Markup coordinates are outside the image.');
    }
    return {valid:true,error:''};
  }
  function createHistory(limit = MAX_HISTORY) {
    const max = Math.max(1,Math.min(MAX_HISTORY,Math.floor(limit)||MAX_HISTORY));
    let past = [], future = [], value = [];
    return Object.freeze({
      get:() => copy(value), canUndo:() => past.length > 0, canRedo:() => future.length > 0,
      push(next) { past.push(value); if (past.length > max) past.shift(); value=copy(next); future=[]; },
      undo() { if(past.length){future.push(value);value=past.pop();} return copy(value); },
      redo() { if(future.length){past.push(value);value=future.pop();} return copy(value); },
      clear() {past=[];future=[];value=[];}
    });
  }
  function mount(host) {
    const {stage, image, controls, core, getCandidateId} = host || {};
    if (!stage || !image || !controls || !core || typeof getCandidateId !== 'function' || !['begin','apply','cancel','getState','listComments','saveComment','deleteComment'].every(name => typeof core[name] === 'function')) throw new Error('The photo editor host/core interface is required.');
    const doc = stage.ownerDocument || root.document, win = doc.defaultView || root;
    let destroyed=false, session=null, starting=false, applying=false, cancelling=false, epoch=0, activityEpoch=0, pending=null, message='', error=false, drawing=null, composing=false, restoreFocus=null,lastNotification='';
    const drafts = new Map(), listeners=new Map(), releases=new Map(), watchedImages=new Set([image]);
    let observedImage=image,resizeObserver=null,mutationObserver=null;
    const release = token => {if(!releases.has(token))releases.set(token,Promise.resolve().then(()=>core.cancel(token)).catch(failure=>{releases.delete(token);throw failure;}));return releases.get(token);};
    const create = (tag, className, text) => { const node=doc.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node; };
    const listen = (node,type,fn,options) => {node.addEventListener(type,fn,options);if(!listeners.has(node))listeners.set(node,new Set());listeners.get(node).add(()=>node.removeEventListener(type,fn,options));};
    const clearListenersWithin = parent => {for(const [node,removers] of listeners)if(node!==win&&parent.contains(node)){removers.forEach(remove=>remove());listeners.delete(node);}};
    const button = (text,action,className='ppe-button') => {const node=create('button',className,text);node.type='button';listen(node,'click',action);return node;};
    const field = (text,input) => {const label=create('label','ppe-field'),caption=create('span','',text);label.append(caption,input);return label;};
    const overlay=create('div','ppe-overlay'),canvas=create('canvas','ppe-preview'),pins=create('div','ppe-pins');
    overlay.hidden=true;overlay.append(canvas,pins);stage.append(overlay);stage.classList.add('ppe-stage');
    canvas.setAttribute('aria-label','Photo edit preview');
    const panel=create('section','ppe-tools'),tabs=create('div','ppe-tabs'),body=create('div','ppe-body'),status=create('p','ppe-status'),actions=create('div','ppe-actions');
    panel.setAttribute('aria-label','Photo editing tools');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Photo tools');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    body.id='ppe-body-'+(++mountCount);body.setAttribute('role','tabpanel');
    const tabNodes=TOOLS.map(tool=>{const node=button(LABELS[tool],()=>run(()=>open(tool,getCandidateId())),'ppe-tab');node.id=body.id+'-'+tool;node.dataset.ppeTool=tool;node.setAttribute('role','tab');node.setAttribute('aria-controls',body.id);node.setAttribute('aria-selected','false');tabs.append(node);return node;});
    const cancelButton=button('Cancel',()=>run(cancel)), applyButton=button('Apply',()=>run(apply),'ppe-button ppe-primary');actions.append(cancelButton,applyButton);panel.append(tabs,body,status,actions);controls.append(panel);body.hidden=true;actions.hidden=true;
    let undoButton,redoButton,colorInput,brushInput,opacityInput,widthInput,heightInput,aspectInput,resizeOutput,commentInput,commentSave,commentDelete,commentList,popoverOpen=false,pinnedEdit=null,preparedDraft=null,pinModeNotified=false;
    const popover=create('div','ppe-pin-popover'),popoverTitle=create('strong','ppe-pin-title'),popoverText=create('p','ppe-pin-text'),popoverMemo=create('div','ppe-pin-memo'),rangeLabel=create('span'),pinRange=input('range',12,2,40),popoverClose=button('Close',closePopover);
    popover.id=body.id+'-pin';popover.hidden=true;popover.setAttribute('role','dialog');popover.setAttribute('aria-label','Selected pin');popover.setAttribute('popover','manual');pinRange.setAttribute('aria-label','Area around pin');
    const preparePin=button('Write edit request',()=>run(preparePinnedEdit),'ppe-button ppe-primary');
    const rangeField=field('Edit area',pinRange),rangeDetails=create('details','ppe-pin-range'),rangeSummary=create('summary');rangeField.append(rangeLabel);rangeDetails.append(rangeSummary,rangeField);popover.append(popoverTitle,popoverText,popoverMemo,rangeDetails,preparePin,popoverClose);controls.append(popover);
    listen(pinRange,'input',()=>{const draft=currentDraft();if(!draft)return;draft.radius=clamp(Number(pinRange.value)/100,.02,.4);render();});
    function closePopover(){popoverOpen=false;hidePopover();const pin=Array.from(pins.querySelectorAll('.ppe-pin')).find(node=>node.getAttribute('aria-expanded')==='true');if(pin)pin.focus();else stage.focus?.();}
    function hidePopover(){try{popover.hidePopover?.();}catch{}popover.hidden=true;}
    listen(popover,'keydown',event=>{if(event.key==='Escape'&&!event.isComposing&&event.keyCode!==229&&!composing){event.preventDefault();event.stopPropagation();closePopover();}});
    function updatePopover(rect,draft){
      if(!popoverOpen||!rect||!draft?.pin||session?.tool!=='comments'&&!pinnedEdit){hidePopover();return;}
      const index=draft.comments.findIndex(note=>note.id===draft.editingId);popoverTitle.textContent=index<0?'New pin':`Pin ${index+1}`;popoverText.textContent=draft.text||'Add a note here or request an AI edit.';
      popoverText.hidden=true;popoverMemo.hidden=!!pinnedEdit;if(commentInput)commentInput.disabled=!!pinnedEdit||busy()||!!core.getState()?.locked;
      pinRange.value=String(Math.round((draft.radius||.12)*100));rangeLabel.textContent=pinRange.value+'%';pinRange.disabled=!!pinnedEdit||busy()||!!core.getState()?.locked;
      rangeSummary.textContent='Edit area · '+pinRange.value+'%';
      preparePin.hidden=!!pinnedEdit||typeof core.preparePinnedEdit!=='function';preparePin.disabled=busy()||!!core.getState()?.locked;
      popover.hidden=false;try{if(popover.showPopover&&!popover.matches?.(':popover-open'))popover.showPopover();}catch{}
      const px=rect.left+draft.pin.x*rect.width,py=rect.top+draft.pin.y*rect.height,viewportWidth=win.innerWidth||rect.right+12,width=Math.min(244,viewportWidth-24),viewportHeight=win.innerHeight||rect.bottom+400;
      if(px<0||py<0||px>viewportWidth||py>viewportHeight){hidePopover();return;}
      popover.style.width=width+'px';const height=popover.getBoundingClientRect().height||260,left=px+18+width>viewportWidth?px-width-18:px+18;
      Object.assign(popover.style,{left:clamp(left,12,Math.max(12,viewportWidth-width-12))+'px',top:clamp(py+18+height>viewportHeight?py-height-18:py+18,12,Math.max(12,viewportHeight-height-12))+'px'});
    }
    function currentDraft() {return session ? drafts.get(session.candidateId+'\n'+session.tool) : null;}
    function busy() {return starting||applying||cancelling;}
    function state() {const remote=core.getState()||{};return {active:session?{tool:session.tool,candidateId:session.candidateId}:null,pinnedEdit:pinnedEdit?copy(pinnedEdit):null,pinMode:session?.tool==='comments'&&isVisible()||!!pinnedEdit,starting,applying,cancelling,locked:busy()||!!remote.locked,message,error};}
    function announce(text,failed=false) {message=text;error=failed;status.textContent=text;status.classList.toggle('ppe-error',failed);status.setAttribute('role',failed?'alert':'status');if(failed)host.onError?.(text);}
    function notify() {const next=state(),key=JSON.stringify([next.active,next.pinnedEdit,next.starting,next.applying,next.cancelling,next.locked]);if(key!==lastNotification){lastNotification=key;host.onLockChange?.(next.locked,next);}if(next.pinMode!==pinModeNotified){pinModeNotified=next.pinMode;host.onPinModeChange?.(next.pinMode);}}
    async function run(fn) {try{return await fn();}catch(failure){if(!destroyed)announce(uiMessage(failure?.message)||'Could not complete the photo edit.',true);render();return null;}}
    function render() {
      if(destroyed)return;
      if(pinnedEdit&&(getCandidateId()!==pinnedEdit.candidateId||typeof host.getSourceRevision==='function'&&host.getSourceRevision()!==pinnedEdit.sourceRevision)){pinnedEdit=null;preparedDraft=null;popoverOpen=false;}
      const remote=core.getState()||{},different=!!session&&getCandidateId()!==session.candidateId, locked=busy()||!!remote.locked;
      if(different)drawing=null;
      panel.dataset.tool=session?.tool||'';panel.setAttribute('aria-busy',String(busy()));
      for(const node of tabNodes){const capability=remote.operations?.[node.dataset.ppeTool],unavailable=remote.capabilitySource==='snapshot'&&capability?.ready===false;node.disabled=locked||!getCandidateId()||unavailable;node.setAttribute('title',unavailable?uiMessage(capability.reason)||'This feature is not ready yet.':'');node.setAttribute('aria-selected',String(node.dataset.ppeTool===session?.tool));node.tabIndex=node.dataset.ppeTool===(session?.tool||TOOLS[0])?0:-1;}
      const compactComments=session?.tool==='comments'||!!pinnedEdit;
      body.hidden=!session||session.tool==='comments';actions.hidden=compactComments||!session&&!starting&&!pinnedEdit;status.hidden=compactComments&&!error&&!busy()&&!different;
      if(session)body.setAttribute('aria-labelledby',body.id+'-'+session.tool);
      cancelButton.disabled=cancelling;cancelButton.textContent=cancelling?'Canceling…':'Cancel';
      applyButton.disabled=!session||locked||different||session?.tool==='comments';
      applyButton.hidden=!!pinnedEdit||['comments','background-remove'].includes(session?.tool);applyButton.textContent=applying?'Applying…':session?.tool==='erase'?'Erase selected area':'Apply';
      for(const input of [...body.querySelectorAll('input,textarea,button'),...popoverMemo.querySelectorAll('input,textarea,button')])input.disabled=locked||different;
      const draft=currentDraft();
      if(undoButton){undoButton.disabled=locked||different||(!draft?.limitError&&!draft?.history?.canUndo());redoButton.disabled=locked||different||!!draft?.limitError||!draft?.history?.canRedo();}
      if(session?.tool==='markup'&&draft?.limitError)applyButton.disabled=true;
      if(commentSave)commentSave.disabled=locked||different||!draft?.pin||!String(draft?.text||'').trim();
      if(commentDelete)commentDelete.disabled=locked||different||!draft?.editingId;
      if(resizeOutput&&draft){const next=dimensions(draft);resizeOutput.textContent=next.valid?`${next.width} × ${next.height} px · ${ (next.width*next.height/1000000).toFixed(2)} MP`:next.error;resizeOutput.classList.toggle('ppe-error',!next.valid);applyButton.disabled=applyButton.disabled||!next.valid;}
      if(different)status.textContent='This edit is bound to the previous image. Reopen that image or cancel.';
      else status.textContent=message;
      updateOverlay();notify();
    }
    function dimensions(draft) {return resizeDimensions(session.width,session.height,draft.width,draft.height,draft.keepAspect,draft.changed);}
    function getRect() {
      const img=typeof host.getImage==='function'?host.getImage():image;
      if(img&&img!==observedImage){resizeObserver?.unobserve?.(observedImage);resizeObserver?.observe(img);mutationObserver?.disconnect();mutationObserver?.observe(img,{attributes:true,attributeFilter:['style','class','hidden','src']});observedImage=img;if(!watchedImages.has(img)){watchedImages.add(img);listen(img,'load',render);}}
      return measureImageContent(img,win);
    }
    function isVisible() {return !!session&&getCandidateId()===session.candidateId;}
    function updateOverlay() {
      clearListenersWithin(pins);pins.replaceChildren();
      const source=session||pinnedEdit,tool=session?.tool||(pinnedEdit?'comments':null),rect=(isVisible()||pinnedEdit&&getCandidateId()===pinnedEdit.candidateId)?getRect():null,draft=currentDraft()||preparedDraft;overlay.hidden=!rect||!source||!['markup','erase','comments'].includes(tool);
      if(overlay.hidden){hidePopover();return;}
      const bounds=stage.getBoundingClientRect();Object.assign(overlay.style,{left:(rect.left-bounds.left+(stage.scrollLeft||0)-(stage.clientLeft||0))+'px',top:(rect.top-bounds.top+(stage.scrollTop||0)-(stage.clientTop||0))+'px',width:rect.width+'px',height:rect.height+'px'});
      overlay.dataset.tool=tool;overlay.style.pointerEvents=pinnedEdit||busy()||core.getState()?.locked?'none':'auto';
      if(canvas.width!==source.width)canvas.width=source.width;if(canvas.height!==source.height)canvas.height=source.height;
      const context=canvas.getContext('2d');context.clearRect(0,0,canvas.width,canvas.height);
      const strokes=[...(draft?.history?.get()||[]),...(drawing?[drawing.stroke]:[])];
      for(const stroke of strokes)drawStroke(context,stroke,tool==='erase'?'#b34422':null,tool==='erase'?0.45:null);
      if(tool==='comments'){
        if(draft.pin){context.save();context.globalAlpha=.18;context.fillStyle='#b34422';context.beginPath();context.arc(draft.pin.x*source.width,draft.pin.y*source.height,(draft.radius||.12)*Math.min(source.width,source.height),0,Math.PI*2);context.fill();context.globalAlpha=1;context.strokeStyle='#b34422';context.lineWidth=Math.max(2,source.width/400);context.stroke();context.restore();}
        (draft.comments||[]).forEach((comment,index)=>{const pin=button(String(index+1),()=>editComment(comment),'ppe-pin');pin.style.left=(comment.x*100)+'%';pin.style.top=(comment.y*100)+'%';pin.setAttribute('aria-label',`Comment ${index+1}: ${comment.text}`);pin.setAttribute('aria-controls',popover.id);pin.setAttribute('aria-expanded',String(popoverOpen&&draft.editingId===comment.id));pin.classList.toggle('ppe-pin-selected',draft.editingId===comment.id);pin.title=comment.text;pins.append(pin);});
        if(draft.pin&&!draft.editingId){const point=create('span','ppe-pin ppe-pin-draft',String(draft.comments.length+1));point.style.left=(draft.pin.x*100)+'%';point.style.top=(draft.pin.y*100)+'%';point.setAttribute('aria-hidden','true');pins.append(point);}
      }
      updatePopover(rect,draft);
    }
    function drawStroke(context,stroke,color,opacity) {
      if(!stroke.points.length)return;
      context.save();context.globalAlpha=opacity??stroke.opacity;context.strokeStyle=color||stroke.color;context.fillStyle=color||stroke.color;context.lineWidth=stroke.width;context.lineCap='round';context.lineJoin='round';context.beginPath();
      if(stroke.points.length===1){context.arc(stroke.points[0].x,stroke.points[0].y,stroke.width/2,0,Math.PI*2);context.fill();}
      else {context.moveTo(stroke.points[0].x,stroke.points[0].y);for(let i=1;i<stroke.points.length;i++)context.lineTo(stroke.points[i].x,stroke.points[i].y);context.stroke();}context.restore();
    }
    function input(type,value,min,max) {const node=create('input');node.type=type;node.value=String(value);if(min!==undefined)node.min=String(min);if(max!==undefined)node.max=String(max);return node;}
    function stepHistory(redo=false) {const draft=currentDraft();if(!draft?.history)return;if(draft.limitError){if(redo)return;draft.limitError='';announce('Discarded the rejected stroke. Previous markup is preserved.');}else redo?draft.history.redo():draft.history.undo();render();}
    function buildBody() {
      clearListenersWithin(popoverMemo);popoverMemo.replaceChildren();
      clearListenersWithin(body);body.replaceChildren();undoButton=redoButton=resizeOutput=commentSave=commentDelete=null;
      const draft=currentDraft(),tool=session.tool;
      if(tool==='markup'||tool==='erase'){
        const settings=create('div','ppe-settings');brushInput=input('range',draft.brush,1,256);listen(brushInput,'input',()=>{draft.brush=Number(brushInput.value);brushInput.setAttribute('aria-valuetext',draft.brush+'px');brushValue.textContent=draft.brush+'px';});
        const brushValue=create('output','ppe-brush-value',draft.brush+'px');settings.append(field('Brush size',brushInput),brushValue);
        if(tool==='markup'){colorInput=input('color',draft.color);listen(colorInput,'input',()=>{draft.color=colorInput.value;});opacityInput=input('range',draft.opacity*100,1,100);listen(opacityInput,'input',()=>{draft.opacity=Number(opacityInput.value)/100;});settings.append(field('Color',colorInput),field('Opacity',opacityInput));}
        undoButton=button('Undo',()=>stepHistory());redoButton=button('Redo',()=>stepHistory(true));settings.append(undoButton,redoButton);
        if(tool==='markup')settings.append(button('Clear',()=>{drawing=null;draft.history.clear();draft.limitError='';announce('Cleared the markup preview.');render();}));
        body.append(settings,create('p','ppe-hint',tool==='erase'?'Paint over the object to erase. Apply to fill the selected area with an image edit.':'Draw on the image. Up to 128 strokes, 4096 points per stroke, and 16384 points total.'));
      } else if(tool==='comments') {
        commentInput=create('textarea','ppe-comment-input');commentInput.rows=2;commentInput.maxLength=2000;commentInput.value=draft.text;commentInput.placeholder='Note for this location';commentInput.setAttribute('aria-label','Pin note');listen(commentInput,'input',()=>{draft.text=commentInput.value;render();});listen(commentInput,'compositionstart',()=>{composing=true;});listen(commentInput,'compositionend',()=>{composing=false;});
        commentSave=button('Save comment',()=>run(saveComment));commentDelete=button('Delete comment',()=>run(deleteComment));const fresh=button('New comment',()=>{draft.editingId=null;draft.pin=null;draft.text='';commentInput.value='';announce('Click the image to place a comment.');render();});
        const row=create('div','ppe-comment-actions'),saved=create('details','ppe-pin-comments');row.append(commentSave,commentDelete,fresh);commentList=create('div','ppe-comment-list');saved.append(create('summary','','Saved pins'),commentList);popoverMemo.append(field('Pin note',commentInput),row,saved);renderComments();
      } else if(tool==='resize') {
        widthInput=input('number',draft.width,1,8192);heightInput=input('number',draft.height,1,8192);widthInput.step=heightInput.step='1';aspectInput=input('checkbox','');aspectInput.checked=draft.keepAspect;resizeOutput=create('output','ppe-resize-output');
        function change(side){draft.width=widthInput.value;draft.height=heightInput.value;draft.keepAspect=aspectInput.checked;draft.changed=side;const next=dimensions(draft);if(draft.keepAspect){if(side==='width'&&Number.isFinite(next.height)){draft.height=String(next.height);heightInput.value=draft.height;}if(side==='height'&&Number.isFinite(next.width)){draft.width=String(next.width);widthInput.value=draft.width;}}render();}
        listen(widthInput,'input',()=>change('width'));listen(heightInput,'input',()=>change('height'));listen(aspectInput,'change',()=>change(draft.changed));
        const row=create('div','ppe-settings');row.append(field('Width (px)',widthInput),field('Height (px)',heightInput),field('Keep aspect ratio',aspectInput));body.append(row,resizeOutput,create('p','ppe-hint',`Source ${session.width} × ${session.height} px · Creates a new PNG at the entered size.`));
      } else body.append(create('p','ppe-hint','Detects the subject and removes the background to create a transparent PNG. The source is preserved.'));
    }
    function renderComments() {
      if(!commentList)return;clearListenersWithin(commentList);commentList.replaceChildren();const draft=currentDraft();
      commentList.parentNode.hidden=!draft.comments.length;
      draft.comments.forEach((comment,index)=>{const node=button(`${index+1}. ${comment.text}`,()=>editComment(comment),'ppe-comment-item');commentList.append(node);});
    }
    function editComment(comment) {const draft=currentDraft();if(!draft||busy()||core.getState()?.locked||!isVisible())return;draft.editingId=comment.id;draft.pin={x:comment.x,y:comment.y};draft.text=comment.text;popoverOpen=true;commentInput.value=comment.text;announce('You can edit or delete this comment.');render();commentInput.focus();}
    async function commentsFor(candidateId) {const result=await core.listComments(candidateId);if(!Array.isArray(result))throw new Error('Could not retrieve the comment list.');return copy(result);}
    async function preparePinnedEdit(){
      if(!session||session.tool!=='comments'||busy()||core.getState()?.locked||!isVisible()||typeof core.preparePinnedEdit!=='function')return;
      const source=session,draft=currentDraft(),request=epoch;if(!draft.pin)return;
      host.beforePinnedEdit?.({candidateId:source.candidateId,text:draft.text,...draft.pin,radius:draft.radius||.12});
      const activity=++activityEpoch;applying=true;render();try{
        const result=await core.preparePinnedEdit(source.token,{...draft.pin,radius:draft.radius||.12});
        if(destroyed||request!==epoch||session!==source||getCandidateId()!==source.candidateId)return;
        if(result?.candidateId!==source.candidateId)throw Error('Check the source image for this pin.');
        releases.set(source.token,Promise.resolve());session=null;pinnedEdit={...result,text:draft.text,pinId:draft.editingId};preparedDraft={comments:copy(draft.comments),pin:{...draft.pin},radius:draft.radius,text:draft.text,editingId:draft.editingId};popoverOpen=true;
        announce('The area around the pin is ready. Request an edit in the AI message below.');host.onPinnedEdit?.(copy(pinnedEdit));
      }finally{if(activity===activityEpoch)applying=false;render();}
    }
    async function saveComment() {
      if(!session||session.tool!=='comments'||busy()||core.getState()?.locked||!isVisible())return;
      const source=session,draft=currentDraft(),text=String(draft.text||'').trim();if(!draft.pin)throw new Error('First click the image to place a comment.');if(!text||text.length>2000)throw new Error('Enter a comment of 1–2000 characters.');
      const activity=++activityEpoch;applying=true;render();try{await core.saveComment(source.token,{...(draft.editingId?{id:draft.editingId}:{}),x:draft.pin.x,y:draft.pin.y,text});if(session!==source||destroyed)return;draft.comments=await commentsFor(source.candidateId);if(session!==source||destroyed)return;draft.editingId=null;draft.pin=null;draft.text='';commentInput.value='';renderComments();announce('Comment saved.');}catch(failure){if(session!==source||destroyed)return;throw failure;}finally{if(activity===activityEpoch)applying=false;render();}
    }
    async function deleteComment() {
      if(!session||session.tool!=='comments'||busy()||core.getState()?.locked||!isVisible())return;
      const source=session,draft=currentDraft();if(!draft.editingId)return;
      const activity=++activityEpoch;applying=true;render();try{await core.deleteComment(source.token,draft.editingId);if(session!==source||destroyed)return;draft.comments=await commentsFor(source.candidateId);if(session!==source||destroyed)return;draft.editingId=null;draft.pin=null;draft.text='';commentInput.value='';renderComments();announce('Comment deleted.');}catch(failure){if(session!==source||destroyed)return;throw failure;}finally{if(activity===activityEpoch)applying=false;render();}
    }
    async function open(tool,candidateId) {
      if(destroyed)return null;if(!TOOLS.includes(tool))throw new Error('Unsupported photo tool.');if(!candidateId)throw new Error('Select an image to edit first.');
      if(busy())throw new Error('Finish or cancel the current photo edit.');
      if(core.getState()?.locked)throw new Error('Finish the current task before editing the photo.');
      if(session?.tool===tool&&session.candidateId===candidateId){render();return state();}
      const request=++epoch;pinnedEdit=null;preparedDraft=null;starting=true;restoreFocus=doc.activeElement;announce('Preparing image…');render();
      try {
        if(session){const previous=session;session=null;await release(previous.token);if(request!==epoch||destroyed)return null;}
        if(typeof host.beforeOpen==='function')await host.beforeOpen(tool,candidateId);
        if(request!==epoch||destroyed)return null;
        if(getCandidateId()!==candidateId)throw new Error('Reopen the selected image to edit it.');
        pending=Promise.resolve(core.begin(candidateId,tool));const next=await pending;pending=null;
        if(request!==epoch||destroyed){if(next?.token)await release(next.token);return null;}
        if(!next?.token||next.tool!==tool||next.candidateId!==candidateId||!validSize(next.width,next.height)||typeof next.image!=='string'){if(next?.token)await release(next.token);throw new Error('Could not verify the image to edit.');}
        session=next;const key=candidateId+'\n'+tool;
        if(!drafts.has(key))drafts.set(key,{history:createHistory(),brush:tool==='erase'?40:8,color:'#b34422',opacity:1,width:String(next.width),height:String(next.height),keepAspect:true,changed:'width',comments:[],text:'',pin:null,editingId:null,radius:.12,limitError:''});
        if(tool==='comments'){const comments=await commentsFor(candidateId);if(request!==epoch||destroyed)return null;currentDraft().comments=comments;}
        buildBody();
        if(tool==='background-remove'){starting=false;return await applySession(true);}
        if(currentDraft().limitError)announce(currentDraft().limitError,true);
        else announce(tool==='comments'?'Click the image to place a comment.':'Preview your changes, then apply them.');
        return state();
      } catch(failure) {if(request===epoch){const failed=session;session=null;if(failed)await release(failed.token).catch(()=>{});throw failure;}return null;}
      finally{if(request===epoch){starting=false;pending=null;render();}}
    }
    async function cancel() {
      if(destroyed)return;
      let source=session;const begin=pending;epoch++;activityEpoch++;session=null;pinnedEdit=null;preparedDraft=null;popoverOpen=false;drawing=null;starting=false;cancelling=true;announce('Canceling photo edit…');render();
      try{if(source)await release(source.token);else if(begin){source=await begin.catch(()=>null);if(source?.token)await release(source.token);}drafts.clear();announce('Photo edit canceled.');}
      catch(failure){if(!destroyed&&source?.token){session=source;if(currentDraft())buildBody();}throw failure;}
      finally{cancelling=false;applying=false;pending=null;render();if(restoreFocus?.isConnected!==false&&!restoreFocus?.disabled)restoreFocus?.focus?.({preventScroll:true});}
    }
    function apply() {return applySession(false);}
    async function applySession(automatic) {
      if(!session||busy()||core.getState()?.locked||(!isVisible()&&!(automatic&&session.tool==='background-remove'))||session.tool==='comments')return null;
      if(drawing)finishStroke();
      const source=session,draft=currentDraft(),request=epoch;let options={};
      if(source.tool==='markup'){if(draft.limitError)throw new Error(draft.limitError);options={strokes:draft.history.get()};const checked=validateMarkup(options.strokes,source.width,source.height);if(!checked.valid){draft.limitError=checked.error;announce(checked.error,true);render();throw new Error(checked.error);}if(!options.strokes.length)throw new Error('Draw markup first.');}
      else if(source.tool==='erase'){
        const strokes=draft.history.get();if(!strokes.length)throw new Error('Paint the area to erase first.');
        const mask=create('canvas');mask.width=source.width;mask.height=source.height;const context=mask.getContext('2d');context.fillStyle='#000000';context.fillRect(0,0,mask.width,mask.height);for(const stroke of strokes)drawStroke(context,stroke,'#ffffff',1);options={maskPng:mask.toDataURL('image/png')};
      }else if(source.tool==='resize'){const next=dimensions(draft);if(!next.valid)throw new Error(next.error);options={width:next.width,height:next.height,keepAspect:next.keepAspect};}
      const activity=++activityEpoch;applying=true;announce(source.tool==='erase'?'Erasing and filling the selected area…':source.tool==='background-remove'?'Removing background…':'Applying to image…');render();
      try{
        const result=await core.apply(source.token,options);
        if(destroyed||epoch!==request||session!==source)return null;
        if(!result?.candidateId||result.candidateId===source.candidateId||typeof result.image!=='string'||!validSize(result.width,result.height)||result.operation!==source.tool)throw new Error('Could not verify the applied result.');
        session=null;drafts.delete(source.candidateId+'\n'+source.tool);announce('Applied to a new image.');host.onApplied?.(result);return result;
      }catch(failure){if(destroyed||epoch!==request||session!==source)return null;if(core.getState()?.active===false)session=null;throw failure;}finally{if(activity===activityEpoch)applying=false;render();}
    }
    function point(event,constrained=false) {return pointerToImage(getRect(),event.clientX,event.clientY,session.width,session.height,constrained);}
    function rejectStroke(reason) {const draft=currentDraft(),rejected=drawing;drawing=null;if(draft)draft.limitError=reason+' This stroke was not added. Undo or clear before continuing.';try{if(rejected)overlay.releasePointerCapture?.(rejected.pointerId);}catch{}announce(draft?.limitError||reason,true);render();}
    function finishStroke() {if(!drawing)return;const draft=currentDraft(),finished=drawing,next=draft?[...draft.history.get(),finished.stroke]:[];if(session.tool==='markup'){const checked=validateMarkup(next,session.width,session.height);if(!checked.valid){rejectStroke(checked.error);return;}}drawing=null;if(draft)draft.history.push(next);try{overlay.releasePointerCapture?.(finished.pointerId);}catch{}render();}
    listen(overlay,'pointerdown',event=>{
      if(!session||busy()||core.getState()?.locked||!isVisible()||event.button>0||event.target?.closest?.('.ppe-pin'))return;const p=point(event);if(!p)return;
      event.preventDefault();const draft=currentDraft();
      if(session.tool==='comments'){draft.editingId=null;draft.pin={x:p.x/session.width,y:p.y/session.height};popoverOpen=true;announce('Enter a comment for the selected location.');render();commentInput.focus();return;}
      if(!['markup','erase'].includes(session.tool))return;
      if(session.tool==='markup'&&draft.limitError){announce(draft.limitError,true);return;}
      const existing=draft.history.get(),total=existing.reduce((count,stroke)=>count+stroke.points.length,0),stroke={points:[p],color:draft.color,width:draft.brush,opacity:draft.opacity};
      if(session.tool==='markup'){const checked=validateMarkup([...existing,stroke],session.width,session.height);if(!checked.valid){rejectStroke(checked.error);return;}}
      else if(total>=MAX_POINTS){announce('The selection is too complex. Undo and paint it again.',true);return;}
      drawing={pointerId:event.pointerId,total,stroke};overlay.setPointerCapture?.(event.pointerId);updateOverlay();
    });
    listen(overlay,'pointermove',event=>{if(!drawing||event.pointerId!==drawing.pointerId||!session)return;event.preventDefault();const p=point(event,true),last=drawing.stroke.points.at(-1);if(p&&(p.x!==last.x||p.y!==last.y)){if(session.tool==='markup'){if(drawing.stroke.points.length>=MARKUP_LIMITS.pointsPerStroke){rejectStroke('Each stroke supports up to 4096 points.');return;}if(drawing.total+drawing.stroke.points.length>=MARKUP_LIMITS.totalPoints){rejectStroke('Markup supports up to 16384 points in total.');return;}}if(drawing.total+drawing.stroke.points.length<MAX_POINTS)drawing.stroke.points.push(p);}updateOverlay();});
    listen(overlay,'pointerup',event=>{if(drawing?.pointerId===event.pointerId)finishStroke();});
    listen(overlay,'pointercancel',()=>{drawing=null;render();});
    listen(overlay,'lostpointercapture',()=>{if(drawing)finishStroke();});
    listen(tabs,'keydown',event=>{if(event.isComposing)return;const index=tabNodes.indexOf(event.target);if(index<0||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?TOOLS.length-1:(index+(event.key==='ArrowRight'?1:-1)+TOOLS.length)%TOOLS.length;if(!tabNodes[next].disabled){tabNodes[next].focus();run(()=>open(TOOLS[next],getCandidateId()));}});
    listen(doc,'keydown',event=>{
      if(!session&&!starting)return;if(event.isComposing||event.keyCode===229||composing)return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(popoverOpen){closePopover();return;}run(cancel);return;}
      if(!panel.contains(doc.activeElement)&&!stage.contains(doc.activeElement))return;
      const tag=doc.activeElement?.tagName;if(['INPUT','TEXTAREA'].includes(tag))return;
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'&&!busy()&&!core.getState()?.locked){const draft=currentDraft();if(draft?.history){event.preventDefault();stepHistory(!!event.shiftKey);}}
    },true);
    listen(stage,'scroll',updateOverlay,{passive:true});listen(win,'resize',updateOverlay);listen(image,'load',render);
    resizeObserver=win.ResizeObserver?new win.ResizeObserver(updateOverlay):null;resizeObserver?.observe(stage);resizeObserver?.observe(image);
    mutationObserver=win.MutationObserver?new win.MutationObserver(updateOverlay):null;mutationObserver?.observe(image,{attributes:true,attributeFilter:['style','class','hidden','src']});
    function destroy() {if(destroyed)return;const source=session,begin=pending;destroyed=true;epoch++;session=null;pinnedEdit=null;preparedDraft=null;drawing=null;listeners.forEach(removers=>removers.forEach(remove=>remove()));listeners.clear();resizeObserver?.disconnect();mutationObserver?.disconnect();hidePopover();popover.remove();overlay.remove();panel.remove();stage.classList.remove('ppe-stage');drafts.clear();if(source)release(source.token).catch(()=>{});else if(begin)begin.then(next=>next?.token&&release(next.token)).catch(()=>{});host.onLockChange?.(!!core.getState()?.locked,{active:null,applying:false,locked:!!core.getState()?.locked});host.onPinModeChange?.(false);}
    render();return Object.freeze({open,render,cancel,apply,destroy,getState:state});
  }
  return Object.freeze({TOOLS,LABELS,MARKUP_LIMITS,contentRect,pointerToImage,measureImageContent,resizeDimensions,validateMarkup,createHistory,mount});
}));

(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CharacterDesign = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_PROMPT = 10000;
  var MAX_PROJECT = 64 * 1024 * 1024;
  var MAX_IMAGE = 16 * 1024 * 1024;
  var MAX_CANDIDATES = 20;
  var MAX_HISTORY = 1000;
  var TEXT_LIMITS = { name: 80, brief: 1200, appearance: 1200, detail: 800, notes: 1200, prompt: 4000 };
  var BAD_KEYS = ['__proto__', 'prototype', 'constructor'];
  var FALLBACK_PALETTE = ['#B89166', '#385C59', '#E9DCC8'];
  var profiles = {
    original: {
      label: '자유 창작', description: '세계관과 개성이 드러나는 나만의 캐릭터를 구상해요.',
      detailLabel: '세계관과 소품', detailHint: '살아가는 장소, 직업, 꼭 필요한 소품을 적어주세요.', boardLabel: '캐릭터 콘셉트 보드',
      guidance: 'Original character concept art, a distinctive coherent silhouette, readable outfit and meaningful accessories, one character.',
      example: { name: '사막의 연금술사', brief: 'An original desert alchemist who collects rare minerals and travels between oasis towns.', appearance: 'A young adult with short dark curly hair, a sand-colored layered cloak, teal gloves, and a practical leather satchel.', detail: 'A small brass distillation flask and mineral samples hang from the belt. Warm desert light, simple uncluttered background.', palette: ['#C49A6C', '#2F6C68', '#E7D7B8'], notes: '소품과 옷의 실루엣을 비교해보세요.', prompt: 'Full body character concept art of an original desert alchemist, sand cloak, teal gloves, brass flask, clear silhouette, warm light.' }
    },
    comic: {
      label: '웹툰·웹소설', description: '웹툰과 웹소설의 이야기 속 역할과 개성이 드러나는 캐릭터를 구상해요.',
      detailLabel: '역할과 표정', detailHint: '이야기에서 맡은 역할, 성격, 대표 표정을 적어주세요.', boardLabel: '웹툰·웹소설 캐릭터 보드',
      guidance: 'Character concept for a webtoon or web novel, expressive personality and readable facial expression, distinctive costume and silhouette suited to the story, one character.',
      example: { name: '새벽 배달부', brief: 'An optimistic comic protagonist who delivers letters through a seaside town before sunrise.', appearance: 'A young adult with a short auburn bob, a blue delivery jacket, rolled sleeves, and a bright yellow shoulder bag.', detail: 'A confident friendly smile, a windblown scarf, clear expressive eyes, simple seaside background.', palette: ['#457B9D', '#F4C95D', '#E8A490'], notes: '작은 컷에서도 읽히는 표정과 옷을 확인하세요.', prompt: 'Comic character design of a cheerful seaside letter courier, auburn bob, blue jacket, yellow shoulder bag, clean linework, expressive smile.' }
    },
    avatar: {
      label: '버튜버', description: '프로필이나 방송 화면에서 인상이 잘 드러나는 디자인이에요.',
      detailLabel: '방송 콘셉트와 포인트', detailHint: '활동 콘셉트와 눈에 띄는 헤어·장식 요소를 적어주세요.', boardLabel: '아바타 콘셉트 보드',
      guidance: 'Avatar concept portrait, clear face and eye shapes, readable head silhouette, restrained decorative details, one character, not a rigged asset.',
      example: { name: '달빛 라디오', brief: 'An original virtual radio host with a calm moonlit astronomy theme.', appearance: 'An adult character with silver-blue shoulder-length hair, amber eyes, a navy high-collar jacket, and a crescent hair clip.', detail: 'A warm welcoming expression, soft portrait lighting, a simple midnight-blue background.', palette: ['#24324F', '#B8CDE0', '#E5B66A'], notes: '이 결과는 디자인 이미지이며 리깅된 모델이 아닙니다.', prompt: 'Original virtual radio host character portrait, silver-blue hair, amber eyes, navy jacket, crescent hair clip, welcoming smile, clean face design.' }
    },
    mascot: {
      label: '마스코트', description: '작게 보아도 기억하기 쉬운 친근한 캐릭터를 탐색해요.',
      detailLabel: '브랜드 성격과 상징', detailHint: '전하고 싶은 분위기와 대표할 사물·동물을 적어주세요.', boardLabel: '마스코트 디자인 보드',
      guidance: 'Mascot character concept, bold simple geometric silhouette, limited color areas, friendly expression, easy to read at a small size, no lettering or logos.',
      example: { name: '정원 친구 모모', brief: 'A friendly original seedling mascot for a community gardening club.', appearance: 'A round cream-colored body, two broad green leaf ears, tiny boots, and simple dark eyes.', detail: 'A cheerful wave, a small watering can, flat clean shapes on a plain light background, no text.', palette: ['#5B8C5A', '#F3E7CB', '#D99559'], notes: '축소했을 때의 실루엣과 색 구분을 확인하세요.', prompt: 'Friendly seedling mascot, round cream body, green leaf ears, tiny boots, small watering can, bold simple shapes, plain background, no text.' }
    },
    game: {
      label: '게임', description: '역할과 장비가 구분되는 게임용 캐릭터 콘셉트를 만들어요.',
      detailLabel: '클래스와 장비', detailHint: '플레이 역할, 장비, 움직임을 떠올릴 수 있는 특징을 적어주세요.', boardLabel: '게임 캐릭터 콘셉트 보드',
      guidance: 'Game character concept art, readable full-body silhouette, functional layered equipment, visual cues for the character role, one character, not a finished 3D asset.',
      example: { name: '구름섬 탐험가', brief: 'An original agile scout exploring floating islands in a lighthearted fantasy game.', appearance: 'An adult explorer with braided dark hair, a teal short cape, fitted brown travel clothes, and lightweight boots.', detail: 'A compact folding glider on the back, a brass compass, an alert balanced standing pose, simple sky background.', palette: ['#367C80', '#865C43', '#D7B56D'], notes: '장비와 역할이 실루엣으로 읽히는지 비교하세요.', prompt: 'Full body fantasy game scout character concept, teal short cape, practical brown travel clothes, folding glider, brass compass, clear silhouette.' }
    }
  };

  function plain(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    var proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }
  function boundedText(value, limit) { return typeof value === 'string' ? value.trim().slice(0, limit) : ''; }
  function dataField(value, key) {
    var descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return undefined;
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new Error('Accessor fields are not allowed');
    return descriptor.value;
  }
  function ownKeys(value) {
    if (Object.getOwnPropertySymbols(value).length) throw new Error('Symbol fields are not allowed');
    return Object.getOwnPropertyNames(value);
  }
  function denseArray(value, max, context) {
    if (!Array.isArray(value) || value.length > max) throw new Error(context + ' array exceeds its limit of ' + max);
    ownKeys(value).forEach(function (key) {
      if (key !== 'length' && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) throw new Error('Unsupported ' + context + ' array field');
      dataField(value, key);
    });
    var result = [];
    for (var index = 0; index < value.length; index++) {
      if (!Object.prototype.hasOwnProperty.call(value, String(index))) throw new Error('Sparse ' + context + ' arrays are not allowed');
      result.push(dataField(value, String(index)));
    }
    return result;
  }
  // Count UTF-8 without allocating another 64 MiB buffer; lone surrogates have
  // the same three-byte replacement behavior as TextEncoder/UTF-8 encoding.
  function utf8Bytes(value, limit) {
    var bytes = 0;
    if (value.length > limit) return value.length;
    for (var index = 0; index < value.length; index++) {
      var code = value.charCodeAt(index);
      if (code <= 0x7f) bytes++;
      else if (code <= 0x7ff) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index++; }
      else bytes += 3;
      if (bytes > limit) return bytes;
    }
    return bytes;
  }
  function safeKeys(value, allowed, context) {
    if (!plain(value)) throw new TypeError(context + ' must be a plain object');
    ownKeys(value).forEach(function (key) {
      if (BAD_KEYS.indexOf(key) !== -1 || allowed.indexOf(key) === -1) throw new Error('Unsupported ' + context + ' field: ' + key);
      dataField(value, key);
    });
  }
  function sanitizeBrief(input) {
    var value = plain(input) ? input : {};
    var requestedProfile = dataField(value, 'profile');
    var profile = typeof requestedProfile === 'string' && Object.prototype.hasOwnProperty.call(profiles, requestedProfile) ? requestedProfile : 'original';
    var output = { profile: profile };
    Object.keys(TEXT_LIMITS).forEach(function (key) { output[key] = boundedText(dataField(value, key), TEXT_LIMITS[key]); });
    var palette = dataField(value, 'palette');
    output.palette = FALLBACK_PALETTE.map(function (fallback, index) {
      var color = Array.isArray(palette) ? dataField(palette, String(index)) : null;
      return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : fallback;
    });
    output.useBrief = dataField(value, 'useBrief') !== false;
    return output;
  }
  function buildPrompt(input, mode, modelId) {
    if (mode !== 'txt2img' && mode !== 'inpaint') throw new Error('Unsupported generation mode');
    var brief = sanitizeBrief(input);
    if (modelId === 'animagine-xl-4.0-opt') {
      if (mode !== 'txt2img') throw new Error('Animagine is a generation-only model');
      var quality = ['masterpiece', 'high score', 'great score', 'absurdres'];
      var userParts = [brief.prompt].concat(brief.useBrief ? [brief.brief, brief.appearance, brief.detail] : []);
      var tags = userParts.filter(Boolean).join(', ').split(/[,\n]+/).map(function (tag) { return tag.trim(); })
        .filter(function (tag) { return tag && quality.indexOf(tag.toLowerCase()) < 0; });
      return tags.concat(quality).join(', ').slice(0, MAX_PROMPT);
    }
    if (mode === 'inpaint' || !brief.useBrief) return brief.prompt;
    var parts = [brief.prompt, brief.brief, brief.appearance, brief.detail, profiles[brief.profile].guidance];
    parts.push('Suggested palette: ' + brief.palette.join(', ') + '.');
    return parts.filter(Boolean).join('\n').slice(0, MAX_PROMPT);
  }
  function cloneValue(value, depth) {
    if (depth > 12) throw new Error('Request nesting is too deep');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) {
      return denseArray(value, 100, 'Request').map(function (entry) { return cloneValue(entry, depth + 1); });
    }
    if (plain(value)) {
      var keys = ownKeys(value);
      if (keys.length > 100) throw new Error('Request object is too large');
      var result = {};
      keys.forEach(function (key) {
        if (BAD_KEYS.indexOf(key) !== -1) throw new Error('Unsafe request field');
        result[key] = cloneValue(dataField(value, key), depth + 1);
      });
      return result;
    }
    throw new TypeError('Request contains a non-JSON value');
  }
  function makeRequests(base, count) {
    if (!plain(base)) throw new TypeError('Base request must be a plain object');
    if (count !== 1 && count !== 2) throw new Error('Choose one or two candidates');
    var seed = dataField(base, 'seed');
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > Number.MAX_SAFE_INTEGER - (count - 1)) throw new RangeError('Seed exceeds the safe integer range');
    var snapshot = cloneValue(base, 0);
    return Array.from({ length: count }, function (_, index) {
      var request = cloneValue(snapshot, 0);
      request.seed = snapshot.seed + index;
      return request;
    });
  }
  function strictText(value, limit, context) {
    if (typeof value !== 'string' || value.length > limit) throw new Error(context + ' must be text of at most ' + limit + ' characters');
    return value;
  }
  function validateBrief(value) {
    safeKeys(value, ['profile', 'name', 'brief', 'appearance', 'detail', 'palette', 'notes', 'prompt', 'useBrief'], 'brief');
    if (typeof value.profile !== 'string' || !Object.prototype.hasOwnProperty.call(profiles, value.profile)) throw new Error('Unknown profile');
    Object.keys(TEXT_LIMITS).forEach(function (key) { strictText(value[key], TEXT_LIMITS[key], key); });
    if (typeof value.useBrief !== 'boolean') throw new Error('useBrief must be boolean');
    if (!Array.isArray(value.palette) || value.palette.length !== 3 || denseArray(value.palette, 3, 'Palette').some(function (color) { return typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color); })) throw new Error('Palette must contain three six-digit hex colors');
    return sanitizeBrief(value);
  }
  var REQUEST_DEFAULTS = { mode: 'txt2img', prompt: '', negative: '', seed: 1, steps: 1, width: 512, height: 512, cfg: 1, denoise: 1, halo: 32, feather: 4, cache: true, roi: false, preview: true, preview_interval: 0.2, sampler: 'euler', scheduler: 'normal' };
  function validateRequest(value, allowInputImages) {
    if (plain(value) && dataField(value, 'edit_operation') === 'recolor') {
      safeKeys(value, ['mode', 'edit_operation', 'target_color', 'source_color', 'color_tolerance', 'feather'].concat(allowInputImages ? ['source', 'mask'] : []), 'request');
      if (value.mode !== 'inpaint') throw new Error('Recolor requires inpaint mode');
      if (typeof value.target_color !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.target_color)) throw new Error('Invalid target color');
      var sourceColor = value.source_color == null ? null : value.source_color;
      if (sourceColor !== null && (typeof sourceColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(sourceColor))) throw new Error('Invalid source color');
      var tolerance = value.color_tolerance === undefined ? 35 : value.color_tolerance;
      if (typeof tolerance !== 'number' || !Number.isFinite(tolerance) || tolerance < 0 || tolerance > 90) throw new Error('Invalid color tolerance');
      var feather = value.feather === undefined ? 4 : value.feather;
      if (!Number.isSafeInteger(feather) || feather < 0 || feather > 64) throw new Error('Invalid request feather');
      return { mode: 'inpaint', edit_operation: 'recolor', target_color: value.target_color.toUpperCase(), source_color: sourceColor === null ? null : sourceColor.toUpperCase(), color_tolerance: tolerance, feather: feather };
    }
    safeKeys(value, Object.keys(REQUEST_DEFAULTS).concat(['model_id', 'edit_operation'], allowInputImages ? ['source', 'mask'] : []), 'request');
    var result = {};
    if (value.edit_operation !== undefined) {
      if (value.edit_operation !== 'regenerate') throw new Error('Unsupported edit operation');
      result.edit_operation = value.edit_operation;
    }
    Object.keys(REQUEST_DEFAULTS).forEach(function (key) { result[key] = value[key] === undefined ? REQUEST_DEFAULTS[key] : value[key]; });
    if (value.model_id !== undefined) {
      if (['sdxl-base', 'sd-turbo'].indexOf(value.model_id) < 0 && !(value.model_id === 'sdxl-inpaint-v01' && result.mode === 'inpaint')
        && !(value.model_id === 'animagine-xl-4.0-opt' && (result.mode === 'txt2img' || result.mode === 'img2img'))) throw new Error('Unsupported image model');
      result.model_id = value.model_id;
    }
    if (result.mode !== 'txt2img' && result.mode !== 'inpaint' && result.mode !== 'img2img') throw new Error('Unsupported request mode');
    if(result.mode === 'img2img' && (result.model_id && ['sdxl-base','animagine-xl-4.0-opt'].indexOf(result.model_id) < 0 || !(result.denoise > 0 && result.denoise < 1) || value.mask !== undefined || value.edit_operation !== undefined))throw new Error('Invalid source-conditioned img2img request');
    strictText(result.prompt, MAX_PROMPT, 'Request prompt');
    strictText(result.negative, MAX_PROMPT, 'Negative prompt');
    [['seed', 0, Number.MAX_SAFE_INTEGER], ['steps', 1, 100], ['width', 64, 2048], ['height', 64, 2048], ['halo', 0, 512], ['feather', 0, 64]].forEach(function (limit) {
      if (!Number.isSafeInteger(result[limit[0]]) || result[limit[0]] < limit[1] || result[limit[0]] > limit[2]) throw new Error('Invalid request ' + limit[0]);
    });
    if (result.width % 8 || result.height % 8) throw new Error('Dimensions must be multiples of eight');
    [['cfg', 0, 30], ['denoise', 0.01, 1], ['preview_interval', 0.05, 5]].forEach(function (limit) {
      if (typeof result[limit[0]] !== 'number' || !Number.isFinite(result[limit[0]]) || result[limit[0]] < limit[1] || result[limit[0]] > limit[2]) throw new Error('Invalid request ' + limit[0]);
    });
    ['cache', 'roi', 'preview'].forEach(function (key) { if (typeof result[key] !== 'boolean') throw new Error(key + ' must be boolean'); });
    if (['euler', 'euler_ancestral', 'dpmpp_2m'].indexOf(result.sampler) < 0 || ['normal', 'simple', 'karras'].indexOf(result.scheduler) < 0) throw new Error('Unsupported sampler or scheduler');
    return result;
  }
  function dataImage(value) {
    if (typeof value !== 'string' || value.length > MAX_IMAGE) throw new Error('Candidate image is missing or exceeds 16 MiB of encoded text');
    var prefix = /^data:image\/(png|jpeg|webp);base64,/.exec(value);
    if (!prefix) throw new Error('Only embedded PNG, JPEG, and WEBP images are allowed');
    var payload = value.slice(prefix[0].length);
    var padding = payload.indexOf('=');
    if (payload.length < 16 || payload.length % 4 || /[^A-Za-z0-9+/=]/.test(payload) || (padding >= 0 && (padding < payload.length - 2 || !/^={1,2}$/.test(payload.slice(padding))))) throw new Error('Invalid image base64');
    var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var bytes = [];
    for (var i = 0; i < Math.min(24, payload.length); i += 4) {
      var block = (alphabet.indexOf(payload[i]) << 18) | (alphabet.indexOf(payload[i + 1]) << 12) | ((alphabet.indexOf(payload[i + 2]) & 63) << 6) | (alphabet.indexOf(payload[i + 3]) & 63);
      bytes.push((block >>> 16) & 255, (block >>> 8) & 255, block & 255);
    }
    var signatures = { png: [137, 80, 78, 71, 13, 10, 26, 10], jpeg: [255, 216, 255], webp: [82, 73, 70, 70] };
    if (signatures[prefix[1]].some(function (byte, index) { return byte !== bytes[index]; }) || (prefix[1] === 'webp' && [87, 69, 66, 80].some(function (byte, index) { return byte !== bytes[index + 8]; }))) throw new Error('Image type does not match its bytes');
    return value;
  }
  function identifier(value, context) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new Error('Invalid ' + context);
    return value;
  }
  function validateMetrics(value) {
    if (value === undefined || value === null) return {};
    if (!plain(value) || ownKeys(value).length > 40) throw new Error('Metrics must contain at most 40 scalar values');
    var output = {};
    ownKeys(value).forEach(function (key) {
      if (BAD_KEYS.indexOf(key) !== -1 || !/^[A-Za-z0-9_]{1,64}$/.test(key)) throw new Error('Invalid metric name');
      var descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new Error('Accessor fields are not allowed');
      var entry = descriptor.value;
      if (!(entry === null || typeof entry === 'boolean' || (typeof entry === 'number' && Number.isFinite(entry)) || (typeof entry === 'string' && entry.length <= 240))) throw new Error('Invalid metric value');
      output[key] = entry;
    });
    return output;
  }
  function timestamp(value, context) {
    strictText(value, 40, context);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)) throw new Error(context + ' must be an ISO UTC timestamp');
    return value;
  }
  // Synchronous SHA256 keeps the document parser deterministic in browsers and
  // Node. Hash the embedded file bytes, never a decoded/re-encoded canvas image.
  function sha256Bytes(bytes) {
    var words=[],length=bytes.length,bitLength=length*8;
    for(var i=0;i<length;i++)words[i>>>2]=(words[i>>>2]||0)|(bytes[i]<<(24-(i%4)*8));
    words[length>>>2]=(words[length>>>2]||0)|(0x80<<(24-(length%4)*8));
    words[(((length+8)>>>6)<<4)+15]=bitLength;
    var h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    function r(x,n){return(x>>>n)|(x<<(32-n));}
    for(var offset=0;offset<words.length;offset+=16){
      var w=[],v=h.slice();
      for(i=0;i<64;i++){
        if(i<16)w[i]=words[offset+i]|0;
        else {var x=w[i-15],y=w[i-2];w[i]=((r(x,7)^r(x,18)^(x>>>3))+w[i-16]+(r(y,17)^r(y,19)^(y>>>10))+w[i-7])|0;}
        var t1=(v[7]+(r(v[4],6)^r(v[4],11)^r(v[4],25))+((v[4]&v[5])^(~v[4]&v[6]))+k[i]+w[i])|0;
        var t2=((r(v[0],2)^r(v[0],13)^r(v[0],22))+((v[0]&v[1])^(v[0]&v[2])^(v[1]&v[2])))|0;
        v=[(t1+t2)|0,v[0],v[1],v[2],(v[3]+t1)|0,v[4],v[5],v[6]];
      }
      h=h.map(function(x,index){return(x+v[index])|0;});
    }
    return h.map(function(x){return(x>>>0).toString(16).padStart(8,'0');}).join('');
  }
  function imageSha256(image) {
    dataImage(image);
    var payload=image.slice(image.indexOf(',')+1),alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',bytes=[];
    for(var i=0;i<payload.length;i+=4){var n=(alphabet.indexOf(payload[i])<<18)|(alphabet.indexOf(payload[i+1])<<12)|((alphabet.indexOf(payload[i+2])&63)<<6)|(alphabet.indexOf(payload[i+3])&63);bytes.push((n>>>16)&255);if(payload[i+2]!=='=')bytes.push((n>>>8)&255);if(payload[i+3]!=='=')bytes.push(n&255);}
    return sha256Bytes(bytes);
  }
  function validateExecution(value,image) {
    safeKeys(value,['schema','traceId','jobId','resultSha256','runRef'],'execution');
    if(value.schema!==1||typeof value.traceId!=='string'||!(/^[A-Za-z0-9_-]{1,128}$/).test(value.traceId)||typeof value.jobId!=='string'||!(/^[a-f0-9]{32}$/).test(value.jobId)||typeof value.resultSha256!=='string'||!(/^[a-f0-9]{64}$/).test(value.resultSha256)||value.runRef!=='runs/'+value.jobId)throw new Error('Invalid execution trace, job, SHA or run reference');
    if(image!==undefined&&imageSha256(image)!==value.resultSha256)throw new Error('Execution result SHA mismatch');
    return {schema:1,traceId:value.traceId,jobId:value.jobId,resultSha256:value.resultSha256,runRef:value.runRef};
  }
  function executionFromResult(value,image) {
    var keys=['trace_id','job_id','result_sha256','run_ref'];
    if(!value||!keys.some(function(key){return value[key]!==undefined;}))return undefined;
    return validateExecution({schema:1,traceId:value.trace_id,jobId:value.job_id,resultSha256:value.result_sha256,runRef:value.run_ref},image);
  }
  var CAPABILITY_OPERATIONS=['generate','regenerate','recolor','recompose','markup','comments','background-remove','erase','resize'];
  function canonicalJSON(value) {
    if(Array.isArray(value))return '['+value.map(canonicalJSON).join(',')+']';
    if(plain(value))return '{'+Object.keys(value).sort().map(function(key){return JSON.stringify(key)+':'+canonicalJSON(value[key]);}).join(',')+'}';
    if(value===null||typeof value==='boolean'||typeof value==='string'||typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
    throw new Error('Invalid capability JSON');
  }
  function textBytes(text) {
    var bytes=[];for(var i=0;i<text.length;i++){var code=text.codePointAt(i);if(code>65535)i++;if(code<128)bytes.push(code);else if(code<2048)bytes.push(192|(code>>6),128|(code&63));else if(code<65536)bytes.push(224|(code>>12),128|((code>>6)&63),128|(code&63));else bytes.push(240|(code>>18),128|((code>>12)&63),128|((code>>6)&63),128|(code&63));}return bytes;
  }
  function capabilityRevision(value) {var raw={};Object.keys(value).forEach(function(key){if(key!=='revision')raw[key]=value[key];});return sha256Bytes(textBytes(canonicalJSON(raw)));}
  function validateCapabilities(input) {
    var value=cloneValue(input,0);
    if(value.schema!==1||!(/^[a-f0-9]{64}$/).test(value.revision)||capabilityRevision(value)!==value.revision)throw new Error('Unknown capability schema or content revision');
    if(!Array.isArray(value.models)||value.models.length>100||!Array.isArray(value.operations)||value.operations.length!==CAPABILITY_OPERATIONS.length)throw new Error('Invalid capability matrix');
    var ids=new Set(),operations=new Set();
    value.models.forEach(function(row){
      if(!plain(row)||typeof row.id!=='string'||!(/^[a-z0-9][a-z0-9._-]{0,79}$/).test(row.id)||ids.has(row.id)||typeof row.label!=='string'||row.label.length>160||typeof row.installed!=='boolean'||!plain(row.defaults)||!Array.isArray(row.operations)||new Set(row.operations).size!==row.operations.length||row.operations.some(function(id){return CAPABILITY_OPERATIONS.indexOf(id)<0;}))throw new Error('Invalid capability model');ids.add(row.id);
    });
    value.operations.forEach(function(row){
      if(!plain(row)||CAPABILITY_OPERATIONS.indexOf(row.id)<0||operations.has(row.id)||['cpu','gpu'].indexOf(row.lane)<0||typeof row.ready!=='boolean'||row.experimental!==false||!(row.reason===null||typeof row.reason==='string'&&row.reason.length<=2000)||!row.ready&&!row.reason||!Array.isArray(row.model_ids)||new Set(row.model_ids).size!==row.model_ids.length||row.model_ids.some(function(id){return !ids.has(id);}))throw new Error('Invalid capability operation');
      var expected=value.models.filter(function(model){return model.operations.indexOf(row.id)>=0;}).map(function(model){return model.id;});
      if(expected.slice().sort().join('\0')!==row.model_ids.slice().sort().join('\0'))throw new Error('Capability model operation matrix mismatch');operations.add(row.id);
    });
    if(value.default_model_id!==null&&value.default_model_id!==undefined&&!value.models.some(function(row){return row.id===value.default_model_id&&row.operations.indexOf('generate')>=0;}))throw new Error('Invalid capability default model');
    value.source='snapshot';return freeze(value);
  }
  function capabilityOperation(value,id) {
    if(CAPABILITY_OPERATIONS.indexOf(id)<0)throw new Error('Unknown capability operation');
    return value&&value.operations.find(function(row){return row.id===id;})||{id:id,ready:false,reason:'Capability snapshot is unavailable',model_ids:[]};
  }
  function capabilityModels(value,id) {
    var operation=capabilityOperation(value,id);
    return (value&&value.models||[]).filter(function(row){return row.operations.indexOf(id)>=0&&operation.model_ids.indexOf(row.id)>=0;}).map(function(row){return Object.assign({},row,{available:row.installed===true&&operation.ready===true,reason:!row.installed?(row.reason||'Model is not installed'):!operation.ready?operation.reason:row.reason||null});});
  }
  // Old servers have no authoritative operation snapshot. Preserve only the
  // historical feature contract and label it explicitly; absent tools stay unknown.
  function legacyCapabilities(catalog) {
    if(!plain(catalog)||!Array.isArray(catalog.models)||catalog.edit_models!==undefined&&!Array.isArray(catalog.edit_models))throw new Error('Invalid legacy model catalog');
    var legacy={'sdxl-base':['generate','regenerate','recompose'],'sd-turbo':['generate','regenerate'],'animagine-xl-4.0-opt':['generate','recompose'],'sdxl-inpaint-v01':['regenerate']};
    var models=catalog.models.concat(catalog.edit_models||[]).filter(function(row){return row&&Object.prototype.hasOwnProperty.call(legacy,row.id);}).map(function(row){return Object.assign({},cloneValue(row,0),{installed:row.available===true,operations:legacy[row.id].slice(),reason:row.available===true?null:'미설치 또는 현재 사용할 수 없는 모델입니다.'});});
    var operations=CAPABILITY_OPERATIONS.map(function(id){var model_ids=models.filter(function(row){return row.operations.indexOf(id)>=0;}).map(function(row){return row.id;}),cpu=['recolor','markup','comments','resize'].indexOf(id)>=0,ready=cpu||models.some(function(row){return row.installed&&row.operations.indexOf(id)>=0;});return {id:id,lane:cpu?'cpu':'gpu',ready:ready,reason:ready?null:'Legacy server does not publish readiness for this operation',model_ids:model_ids,experimental:false};});
    return freeze({schema:1,revision:null,source:'legacy',reason:'Legacy fallback: server capability snapshot unavailable',default_model_id:catalog.default_model_id,models:models,operations:operations});
  }
  function candidate(value, creating) {
    safeKeys(value, ['id', 'createdAt', 'label', 'image', 'brief', 'request', 'parentId', 'metrics', 'kind', 'derivation', 'annotations', 'execution'], 'candidate');
    var derived = value.kind === 'derived';
    var output = { id: identifier(value.id, 'candidate id'), createdAt: timestamp(value.createdAt, 'createdAt'), label: strictText(value.label, 120, 'Candidate label'), image: dataImage(value.image), brief: validateBrief(value.brief), request: derived && value.request === null ? null : validateRequest(value.request, creating), parentId: value.parentId == null ? null : identifier(value.parentId, 'parent id'), metrics: validateMetrics(value.metrics) };
    if(value.execution!==undefined)output.execution=validateExecution(value.execution,output.image);
    // Legacy v1 files did not record provenance. Keep it unspecified instead of
    // presenting an old upload as an AI-generated candidate.
    if (Object.prototype.hasOwnProperty.call(value, 'kind')) {
      if (value.kind !== 'upload' && value.kind !== 'generated' && !derived) throw new Error('Candidate kind must be upload, generated or derived');
      output.kind = value.kind;
    }
    if (derived) {
      if (!output.image.startsWith('data:image/png;base64,')) throw new Error('Derived images must be PNG');
      var d = value.derivation;
      safeKeys(d, ['operation','sourceId','sourceSha256','inputWidth','inputHeight','outputWidth','outputHeight','algorithm','algorithmVersion','parameters','jobId'], 'derivation');
      if (['markup','background-remove','erase','resize'].indexOf(d.operation) < 0 || output.parentId === null || d.sourceId !== output.parentId || !/^[a-f0-9]{64}$/.test(d.sourceSha256)) throw new Error('Invalid derived source provenance');
      ['inputWidth','inputHeight','outputWidth','outputHeight'].forEach(function (key) { if (!Number.isSafeInteger(d[key]) || d[key] < 1 || d[key] > 16777216) throw new Error('Invalid derived image dimensions'); });
      if (d.inputWidth*d.inputHeight>16777216 || d.outputWidth*d.outputHeight>16777216) throw new Error('Derived image exceeds 16MP');
      if (d.operation === 'erase' ? !output.request || output.request.mode !== 'inpaint' || output.request.edit_operation === 'recolor' : output.request !== null) throw new Error('Derived operation must record its actual request');
      output.derivation = {operation:d.operation,sourceId:d.sourceId,sourceSha256:d.sourceSha256,inputWidth:d.inputWidth,inputHeight:d.inputHeight,outputWidth:d.outputWidth,outputHeight:d.outputHeight,algorithm:strictText(d.algorithm,120,'Algorithm'),algorithmVersion:strictText(d.algorithmVersion,80,'Algorithm version'),parameters:validateMetrics(d.parameters)};
      if (d.jobId !== undefined) output.derivation.jobId = identifier(d.jobId,'Derived job id');
    } else if (value.derivation !== undefined) throw new Error('Only derived candidates may contain derivation');
    if (value.annotations !== undefined) {
      var notes = new Set();
      output.annotations = denseArray(value.annotations,100,'annotations').map(function (note) {
        safeKeys(note,['id','x','y','text','createdAt','updatedAt'],'annotation');
        var id=identifier(note.id,'annotation id');
        if (notes.has(id) || typeof note.x !== 'number' || !Number.isFinite(note.x) || note.x<0 || note.x>1 || typeof note.y !== 'number' || !Number.isFinite(note.y) || note.y<0 || note.y>1) throw new Error('Invalid annotation coordinates or duplicate id');
        notes.add(id); var text=strictText(note.text,2000,'Annotation');
        if (!text.trim()) throw new Error('Annotation text is empty');
        var entry={id:id,x:note.x,y:note.y,text:text,createdAt:timestamp(note.createdAt,'Annotation timestamp')};
        if(note.updatedAt!==undefined)entry.updatedAt=timestamp(note.updatedAt,'Annotation update timestamp');
        return entry;
      });
    }
    return output;
  }
  function historyEntry(value, ids) {
    safeKeys(value, ['candidateId', 'action', 'at'], 'selection history');
    var candidateId = identifier(value.candidateId, 'history candidate id');
    if (!ids.has(candidateId)) throw new Error('Selection history references a missing candidate');
    if (['view', 'edit', 'compare'].indexOf(value.action) < 0) throw new Error('Unsupported selection history action');
    return { candidateId: candidateId, action: value.action, at: timestamp(value.at, 'History timestamp') };
  }
  // Returns the validated project and the exact JSON text used for its size check.
  function checkedProject(value, creating) {
    safeKeys(value, ['version', 'brief', 'versions', 'selectionHistory'], 'project');
    if (value.version !== 1) throw new Error('Unsupported project version');
    if (!Array.isArray(value.versions) || value.versions.length > MAX_CANDIDATES) throw new Error('A project can contain at most 20 candidates');
    var versions = denseArray(value.versions, MAX_CANDIDATES, 'candidate').map(function (item) { return candidate(item, creating); });
    var ids = new Set();
    versions.forEach(function (item) { if (ids.has(item.id)) throw new Error('Duplicate candidate id'); ids.add(item.id); });
    var byId = new Map(versions.map(function (item) { return [item.id, item]; }));
    versions.forEach(function (item) {
      if (item.parentId !== null && !ids.has(item.parentId)) throw new Error('Candidate parent does not exist in this project');
      var seen = new Set();
      var current = item;
      while (current) {
        if (seen.has(current.id)) throw new Error('Candidate parent cycle is not allowed');
        seen.add(current.id);
        current = current.parentId === null ? null : byId.get(current.parentId);
      }
    });
    var history = value.selectionHistory === undefined ? [] : denseArray(value.selectionHistory, MAX_HISTORY, 'selection history');
    var output = { version: 1, brief: validateBrief(value.brief), versions: versions, selectionHistory: history.map(function (item) { return historyEntry(item, ids); }) };
    var text = JSON.stringify(output);
    if (utf8Bytes(text, MAX_PROJECT) > MAX_PROJECT) throw new Error('Project exceeds 64 MiB of UTF-8 JSON text');
    return { project: output, raw: text };
  }
  function project(value, creating) { return checkedProject(value, creating).project; }
  function createProjectRecord(brief, versions, selectionHistory) { return checkedProject({ version: 1, brief: sanitizeBrief(brief), versions: versions, selectionHistory: selectionHistory === undefined ? [] : selectionHistory }, true); }
  function createProject(brief, versions, selectionHistory) { return createProjectRecord(brief, versions, selectionHistory).project; }
  function parseProject(raw) {
    if (typeof raw === 'string') {
      if (utf8Bytes(raw, MAX_PROJECT) > MAX_PROJECT) throw new Error('Project exceeds 64 MiB of UTF-8 JSON text');
      raw = JSON.parse(raw);
    }
    return project(raw, false);
  }
  function freeze(value) {
    Object.keys(value).forEach(function (key) { if (value[key] && typeof value[key] === 'object') freeze(value[key]); });
    return Object.freeze(value);
  }
  freeze(profiles);
  return Object.freeze({ profiles: profiles, sanitizeBrief: sanitizeBrief, buildPrompt: buildPrompt, makeRequests: makeRequests, createProject: createProject, createProjectRecord: createProjectRecord, parseProject: parseProject, validateExecution: validateExecution, executionFromResult: executionFromResult, imageSha256: imageSha256, sha256Bytes: sha256Bytes, validateCapabilities: validateCapabilities, legacyCapabilities: legacyCapabilities, capabilityModels: capabilityModels, capabilityOperation: capabilityOperation, capabilityRevision: capabilityRevision });
}));

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
  function buildPrompt(input, mode) {
    if (mode !== 'txt2img' && mode !== 'inpaint') throw new Error('Unsupported generation mode');
    var brief = sanitizeBrief(input);
    if (!brief.useBrief) return brief.prompt;
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
    safeKeys(value, Object.keys(REQUEST_DEFAULTS).concat(allowInputImages ? ['source', 'mask'] : []), 'request');
    var result = {};
    Object.keys(REQUEST_DEFAULTS).forEach(function (key) { result[key] = value[key] === undefined ? REQUEST_DEFAULTS[key] : value[key]; });
    if (result.mode !== 'txt2img' && result.mode !== 'inpaint') throw new Error('Unsupported request mode');
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
  function candidate(value, creating) {
    safeKeys(value, ['id', 'createdAt', 'label', 'image', 'brief', 'request', 'parentId', 'metrics', 'kind'], 'candidate');
    var output = { id: identifier(value.id, 'candidate id'), createdAt: timestamp(value.createdAt, 'createdAt'), label: strictText(value.label, 120, 'Candidate label'), image: dataImage(value.image), brief: validateBrief(value.brief), request: validateRequest(value.request, creating), parentId: value.parentId == null ? null : identifier(value.parentId, 'parent id'), metrics: validateMetrics(value.metrics) };
    // Legacy v1 files did not record provenance. Keep it unspecified instead of
    // presenting an old upload as an AI-generated candidate.
    if (Object.prototype.hasOwnProperty.call(value, 'kind')) {
      if (value.kind !== 'upload' && value.kind !== 'generated') throw new Error('Candidate kind must be upload or generated');
      output.kind = value.kind;
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
  function project(value, creating) {
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
    if (utf8Bytes(JSON.stringify(output), MAX_PROJECT) > MAX_PROJECT) throw new Error('Project exceeds 64 MiB of UTF-8 JSON text');
    return output;
  }
  function createProject(brief, versions, selectionHistory) { return project({ version: 1, brief: sanitizeBrief(brief), versions: versions, selectionHistory: selectionHistory === undefined ? [] : selectionHistory }, true); }
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
  return Object.freeze({ profiles: profiles, sanitizeBrief: sanitizeBrief, buildPrompt: buildPrompt, makeRequests: makeRequests, createProject: createProject, parseProject: parseProject });
}));

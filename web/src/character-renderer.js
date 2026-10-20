(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PankekiRenderer = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MIN_AREA = 0.0001;
  var DEFAULTS = { eyeOpen: 1, mouthOpen: 0, breath: 0 };
  var IDENTITY = [1, 0, 0, 1, 0, 0];
  function fail(code, message) {
    var error = new Error(message); error.code = code; throw error;
  }
  function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
  function array(value, code) {
    if (!Array.isArray(value)) fail(code, 'Expected a dense array');
    for (var i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) fail(code, 'Sparse array');
    return value;
  }
  function numbers(value, length, code) {
    array(value, code);
    if ((length !== null && value.length !== length) || !value.every(finite)) fail(code, 'Invalid numeric array');
    return value;
  }
  function area(v, a, b, c) {
    return ((v[b * 2] - v[a * 2]) * (v[c * 2 + 1] - v[a * 2 + 1]) -
      (v[b * 2 + 1] - v[a * 2 + 1]) * (v[c * 2] - v[a * 2])) / 2;
  }
  function geometry(vertices, uv, triangles, base) {
    numbers(vertices, null, 'invalid_geometry'); numbers(uv, vertices.length, 'invalid_geometry');
    if (vertices.length < 6 || vertices.length % 2 || vertices.length > 512 ||
        !uv.every(function (v) { return v >= 0 && v <= 1; })) fail('invalid_geometry', 'Invalid vertices or UV');
    array(triangles, 'invalid_geometry');
    if (!triangles.length || triangles.length % 3 || triangles.length > 1536 ||
        !triangles.every(function (v) { return Number.isInteger(v) && v >= 0 && v < vertices.length / 2; })) {
      fail('invalid_geometry', 'Invalid triangle indices');
    }
    for (var i = 0; i < triangles.length; i += 3) {
      var a = triangles[i], b = triangles[i + 1], c = triangles[i + 2];
      var current = area(vertices, a, b, c);
      if (!finite(current) || Math.abs(current) < MIN_AREA || area(uv, a, b, c) === 0 ||
          (base && current * area(base, a, b, c) <= 0)) fail('invalid_geometry', 'Collapsed or inverted triangle ' + i / 3);
    }
  }
  function multiply(p, m) {
    return [p[0] * m[0] + p[2] * m[1], p[1] * m[0] + p[3] * m[1],
      p[0] * m[2] + p[2] * m[3], p[1] * m[2] + p[3] * m[3],
      p[0] * m[4] + p[2] * m[5] + p[4], p[1] * m[4] + p[3] * m[5] + p[5]];
  }
  function transform(vertices, matrix) {
    var result = [];
    for (var i = 0; i < vertices.length; i += 2) {
      result.push(matrix[0] * vertices[i] + matrix[2] * vertices[i + 1] + matrix[4],
        matrix[1] * vertices[i] + matrix[3] * vertices[i + 1] + matrix[5]);
    }
    return result;
  }
  function interpolate(keys, value, coordinate, field) {
    for (var i = 1; i < keys.length; i++) {
      if (value <= keys[i][coordinate]) {
        var left = keys[i - 1], right = keys[i];
        var amount = (value - left[coordinate]) / (right[coordinate] - left[coordinate]);
        if (field === 'value') return left.value + (right.value - left.value) * amount;
        return left.deltas.map(function (v, index) { return v + (right.deltas[index] - v) * amount; });
      }
    }
    return field === 'value' ? keys[keys.length - 1].value : keys[keys.length - 1].deltas.slice();
  }
  function createGrid(width, height, options) {
    options = options || {};
    var columns = options.columns === undefined ? 4 : options.columns;
    var rows = options.rows === undefined ? 4 : options.rows;
    if (!finite(width) || !finite(height) || width <= 0 || height <= 0 ||
        !Number.isInteger(columns) || !Number.isInteger(rows) || columns < 2 || rows < 2 || columns * rows > 256) {
      fail('invalid_grid', 'Positive dimensions and 2..256 grid vertices required');
    }
    var vertices = [], uv = [], triangles = [];
    for (var y = 0; y < rows; y++) for (var x = 0; x < columns; x++) {
      vertices.push(x * width / (columns - 1), y * height / (rows - 1));
      uv.push(x / (columns - 1), y / (rows - 1));
      if (x < columns - 1 && y < rows - 1) {
        var index = y * columns + x;
        triangles.push(index, index + 1, index + columns + 1, index, index + columns + 1, index + columns);
      }
    }
    geometry(vertices, uv, triangles);
    return { vertices: vertices, uv: uv, triangles: triangles };
  }
  function parameterValues(parameters, values) {
    var definitions = new Map(), resolved = new Map();
    array(parameters, 'invalid_scene'); values = values === undefined ? {} : values;
    if (!values || typeof values !== 'object' || Array.isArray(values)) fail('parameter_out_of_range', 'Expected parameter values');
    parameters.forEach(function (p) {
      if (!p || !Object.hasOwn(DEFAULTS, p.id) || definitions.has(p.id) || p.min !== 0 || p.max !== 1 || p.default !== DEFAULTS[p.id]) {
        fail('invalid_scene', 'Invalid parameter definition');
      }
      var value = Object.hasOwn(values, p.id) ? values[p.id] : (p.value === undefined ? p.default : p.value);
      if (!finite(value) || value < 0 || value > 1) fail('parameter_out_of_range', 'Invalid value for ' + p.id);
      definitions.set(p.id, p); resolved.set(p.id, value);
    });
    Object.keys(values).forEach(function (id) {
      if (!definitions.has(id)) fail('parameter_out_of_range', 'Unknown parameter ' + id);
    });
    return { definitions: definitions, values: resolved };
  }
  function displaced(rig, parameters) {
    geometry(rig.vertices, rig.uv, rig.triangles);
    var vertices = rig.vertices.slice(), seen = new Set();
    array(rig.bindings, 'invalid_rig').forEach(function (binding) {
      var definition = parameters.definitions.get(binding.parameterId);
      if (!definition || seen.has(binding.parameterId)) fail('invalid_rig', 'Invalid binding parameter');
      seen.add(binding.parameterId);
      var keys = array(binding.keys, 'invalid_rig');
      if (keys.length < 2 || keys[0].at !== definition.min || keys[keys.length - 1].at !== definition.max) {
        fail('invalid_rig', 'Binding must contain parameter endpoints');
      }
      var defaultKey;
      keys.forEach(function (key, i) {
        if (!key || !finite(key.at) || key.at < 0 || key.at > 1 || (i && key.at <= keys[i - 1].at)) fail('invalid_rig', 'Unordered keyforms');
        numbers(key.deltas, vertices.length, 'invalid_rig');
        if (key.at === definition.default) defaultKey = key;
      });
      if (!defaultKey || !defaultKey.deltas.every(function (v) { return v === 0; })) fail('invalid_rig', 'Default key displacement must be zero');
      var delta = interpolate(keys, parameters.values.get(binding.parameterId), 'at', 'deltas');
      for (var i = 0; i < vertices.length; i++) vertices[i] += delta[i];
    });
    geometry(vertices, rig.uv, rig.triangles, rig.vertices);
    return vertices;
  }
  function evaluatePose(scene, values) {
    if (!scene || !scene.canvas || !Number.isInteger(scene.canvas.width) || !Number.isInteger(scene.canvas.height) ||
        scene.canvas.width < 1 || scene.canvas.height < 1 || scene.canvas.width > 1024 || scene.canvas.height > 1024) {
      fail('unsupported_canvas', 'Motion canvas must be 1..1024 pixels per side');
    }
    var parameters = parameterValues(scene.parameters, values), parts = new Map(), rigs = new Map(), states = new Map(), visiting = new Set();
    if (typeof scene.sourceAssetId !== 'string' || !scene.sourceAssetId) fail('invalid_scene', 'Explicit sourceAssetId required');
    if (scene.backgroundAssetId !== null && (typeof scene.backgroundAssetId !== 'string' || !scene.backgroundAssetId)) fail('invalid_scene', 'Invalid background asset');
    array(scene.parts, 'invalid_scene').forEach(function (part) {
      if (!part || typeof part.id !== 'string' || !part.id || parts.has(part.id)) fail('invalid_scene', 'Duplicate or invalid part');
      parts.set(part.id, part);
    });
    if (parts.size > 16) fail('invalid_scene', 'At most 16 parts');
    array(scene.rigs, 'invalid_scene').forEach(function (rig) {
      if (!rig || !parts.has(rig.partId) || rigs.has(rig.partId)) fail('invalid_scene', 'Invalid rig reference');
      rigs.set(rig.partId, rig);
    });
    parts.forEach(function (part) {
      var seen = new Set([part.id]), parent = part;
      while (parent.parentId !== null) {
        if (!parts.has(parent.parentId) || seen.has(parent.parentId)) fail('invalid_scene', 'Invalid parent hierarchy');
        seen.add(parent.parentId); parent = parts.get(parent.parentId);
      }
    });
    function inspect(part) {
      if (states.has(part.id)) return states.get(part.id);
      if (visiting.has(part.id)) fail('invalid_scene', 'Parent cycle');
      visiting.add(part.id);
      var state;
      try {
        if (part.sourceAssetId !== scene.sourceAssetId) fail('source_mismatch', 'Part belongs to another source');
        if (part.backgroundReady !== true) fail('background_not_ready', 'Confirm prepared separated artwork/background first');
        if (!part.materialAssetId) fail('material_missing', 'Separated RGBA material required');
        var rig = rigs.get(part.id);
        if (!rig) fail('rig_missing', 'Mesh not prepared');
        if (rig.status !== 'ready') fail('rig_stale', 'Rig is not ready; document adapter must verify hashes');
        if (rig.materialAssetId !== part.materialAssetId) fail('material_mismatch', 'Rig material differs from part');
        numbers(part.transform, 6, 'invalid_geometry');
        if (typeof part.visible !== 'boolean' || !finite(part.opacity) || part.opacity < 0 || part.opacity > 1 || !finite(part.order)) fail('invalid_scene', 'Invalid visibility, opacity or order');
        var parent = part.parentId === null ? { matrix: IDENTITY, visible: true, opacity: 1 } : inspect(parts.get(part.parentId));
        if (parent.blocked) fail('ancestor_blocked', 'Parent ' + part.parentId + ' is blocked');
        var matrix = multiply(parent.matrix, part.transform);
        var local = displaced(rig, parameters), documentVertices = transform(local, matrix);
        geometry(documentVertices, rig.uv, rig.triangles, transform(rig.vertices, matrix));
        state = { matrix: matrix, visible: parent.visible && part.visible, opacity: parent.opacity * part.opacity,
          draw: { partId: part.id, assetId: part.materialAssetId, verticesDocument: documentVertices,
            uv: rig.uv.slice(), triangles: rig.triangles.slice(), opacity: parent.opacity * part.opacity, order: part.order } };
      } catch (error) {
        if (!error.code) throw error;
        state = { blocked: { partId: part.id, reason: error.code, message: error.message } };
      }
      visiting.delete(part.id); states.set(part.id, state); return state;
    }
    var draws = [], blockedParts = [], prepared = true;
    parts.forEach(function (part) {
      var state = inspect(part);
      if (!part.backgroundReady) prepared = false;
      if (state.blocked) blockedParts.push(state.blocked);
      else if (state.visible && state.opacity > 0) draws.push(state.draw);
    });
    if (!parts.size) blockedParts.push({ partId: null, reason: 'parts_missing', message: 'Prepared separated parts required' });
    draws.sort(function (a, b) { return a.order - b.order; });
    return { backgroundAssetId: scene.backgroundAssetId, draws: prepared ? draws : [], blockedParts: blockedParts };
  }
  function sampleMotion(motion, t, options) {
    options = options || {};
    if (!motion || motion.duration !== 2 || motion.fps !== 24 || !finite(t) || (options.loop && t < 0)) fail('invalid_motion', 'Expected finite time and a 2 second/24fps motion');
    var curves = array(motion.curves, 'invalid_motion'), seen = new Set(), result = {};
    if (curves.length > 3) fail('invalid_motion', 'At most three parameter curves');
    var time = options.loop ? t % motion.duration : Math.max(0, Math.min(motion.duration, t));
    curves.forEach(function (curve) {
      if (!curve || !Object.hasOwn(DEFAULTS, curve.parameterId) || seen.has(curve.parameterId)) fail('invalid_motion', 'Invalid curve parameter');
      seen.add(curve.parameterId);
      var keys = array(curve.keys, 'invalid_motion');
      if (keys.length < 2 || keys.length > 32 || keys[0].t !== 0 || keys[keys.length - 1].t !== motion.duration) fail('invalid_motion', 'Curve needs endpoints and at most 32 keys');
      keys.forEach(function (key, i) {
        if (!key || !finite(key.t) || key.t < 0 || key.t > motion.duration || (i && key.t <= keys[i - 1].t) ||
            !finite(key.value) || key.value < 0 || key.value > 1) fail('invalid_motion', 'Invalid curve key');
      });
      if (options.loop && keys[0].value !== keys[keys.length - 1].value) fail('invalid_motion_loop', 'Loop endpoints must match');
      result[curve.parameterId] = interpolate(keys, time, 't', 'value');
    });
    return result;
  }
  function imageSize(image) {
    if (!image || image.complete === false) fail('missing_asset', 'Image is not decoded');
    var width = image.naturalWidth === undefined ? image.width : image.naturalWidth;
    var height = image.naturalHeight === undefined ? image.height : image.naturalHeight;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > 16 * 1024 * 1024) {
      fail('missing_asset', 'Invalid decoded image dimensions');
    }
    return { width: width, height: height };
  }
  function triangleMapping(draw, offset, size) {
    var source = [], target = [];
    for (var j = 0; j < 3; j++) {
      var index = draw.triangles[offset + j];
      source.push(draw.uv[index * 2] * size.width, draw.uv[index * 2 + 1] * size.height);
      target.push(draw.verticesDocument[index * 2], draw.verticesDocument[index * 2 + 1]);
    }
    var x1 = source[2] - source[0], y1 = source[3] - source[1];
    var x2 = source[4] - source[0], y2 = source[5] - source[1];
    var dx1 = target[2] - target[0], dy1 = target[3] - target[1];
    var dx2 = target[4] - target[0], dy2 = target[5] - target[1];
    var det = x1 * y2 - x2 * y1;
    var a = (dx1 * y2 - dx2 * y1) / det, b = (dy1 * y2 - dy2 * y1) / det;
    var c = (dx2 * x1 - dx1 * x2) / det, d = (dy2 * x1 - dy1 * x2) / det;
    var matrix = [a, b, c, d, target[0] - a * source[0] - c * source[1], target[1] - b * source[0] - d * source[1]];
    numbers(matrix, 6, 'invalid_geometry');
    return { target: target, matrix: matrix };
  }
  function sharedAffine(draw, size) {
    // Use widely separated UV points, avoiding cell-rounding amplification.
    var first = 0, second = 0, third = 0, distance = -1, largest = -1;
    for (var i = 1; i < draw.uv.length / 2; i++) {
      var dx = draw.uv[i * 2] - draw.uv[0], dy = draw.uv[i * 2 + 1] - draw.uv[1];
      if (dx * dx + dy * dy > distance) { distance = dx * dx + dy * dy; second = i; }
    }
    for (var j = 0; j < draw.uv.length / 2; j++) {
      var magnitude = Math.abs(area(draw.uv, first, second, j));
      if (magnitude > largest) { largest = magnitude; third = j; }
    }
    var m = triangleMapping({ uv: draw.uv, verticesDocument: draw.verticesDocument, triangles: [first, second, third] }, 0, size).matrix;
    for (var n = 0; n < draw.uv.length; n += 2) {
      var x = draw.uv[n] * size.width, y = draw.uv[n + 1] * size.height;
      // Authored grids store four decimal places. This is below pixel coverage
      // precision, and never changes the pose/document vertices themselves.
      if (Math.abs(m[0] * x + m[2] * y + m[4] - draw.verticesDocument[n]) > 0.0001 ||
          Math.abs(m[1] * x + m[3] * y + m[5] - draw.verticesDocument[n + 1]) > 0.0001) return null;
    }
    return m;
  }
  function fullRectangle(draw) {
    var edges = new Map(), total = 0;
    for (var i = 0; i < draw.triangles.length; i += 3) {
      var t = draw.triangles.slice(i, i + 3); total += Math.abs(area(draw.uv, t[0], t[1], t[2]));
      for (var j = 0; j < 3; j++) {
        var a = t[j], b = t[(j + 1) % 3], key = Math.min(a, b) + ':' + Math.max(a, b);
        var edge = edges.get(key) || { a: a, b: b, count: 0 }; edge.count++; edges.set(key, edge);
      }
    }
    var boundary = 0, rectangle = Math.abs(total - 1) < 1e-9;
    edges.forEach(function (edge) {
      if (edge.count > 2) rectangle = false;
      if (edge.count !== 1) return;
      boundary++;
      var u = draw.uv[edge.a * 2], v = draw.uv[edge.a * 2 + 1], x = draw.uv[edge.b * 2], y = draw.uv[edge.b * 2 + 1];
      if (!((u === x && (u === 0 || u === 1)) || (v === y && (v === 0 || v === 1)))) rectangle = false;
    });
    return rectangle && boundary >= 4;
  }
  function trianglePath(context, target) {
    context.moveTo(target[0], target[1]); context.lineTo(target[2], target[3]);
    context.lineTo(target[4], target[5]); context.closePath();
  }
  function scratchCanvas(canvas) {
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(canvas.width, canvas.height);
    if (canvas.ownerDocument && typeof canvas.ownerDocument.createElement === 'function') {
      var scratch = canvas.ownerDocument.createElement('canvas'); scratch.width = canvas.width; scratch.height = canvas.height; return scratch;
    }
    fail('render_unavailable', 'An offscreen Canvas2D surface is required for a deformed mesh');
  }
  function meshLayer(job, buffers, width, height) {
    var color = buffers[0].getContext('2d', { willReadFrequently: true });
    var coverage = buffers[1].getContext('2d', { willReadFrequently: true });
    var shape = buffers[2].getContext('2d', { willReadFrequently: true });
    [color, coverage, shape].forEach(function (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, width, height); ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#fff';
    });
    // Canvas lighter clamps at 255, including coverage where several clipped
    // triangles meet. Keep unbounded integer sums outside the Canvas buffers.
    var sums = new Uint32Array(width * height * 5);
    job.triangles.forEach(function (triangle) {
      var v = triangle.target;
      var left = Math.max(0, Math.floor(Math.min(v[0], v[2], v[4])) - 1), top = Math.max(0, Math.floor(Math.min(v[1], v[3], v[5])) - 1);
      var right = Math.min(width, Math.ceil(Math.max(v[0], v[2], v[4])) + 1), bottom = Math.min(height, Math.ceil(Math.max(v[1], v[3], v[5])) + 1);
      var w = right - left, h = bottom - top;
      if (w <= 0 || h <= 0) return;
      color.clearRect(left, top, w, h); coverage.clearRect(left, top, w, h);
      color.save(); coverage.save();
      try {
        color.beginPath(); trianglePath(color, triangle.target); color.clip();
        color.setTransform.apply(color, triangle.matrix); color.drawImage(job.image, 0, 0);
        coverage.beginPath(); trianglePath(coverage, triangle.target); coverage.clip(); coverage.fillRect(0, 0, width, height);
      } finally { color.restore(); coverage.restore(); }
      var pixels = color.getImageData(left, top, w, h).data, weights = coverage.getImageData(left, top, w, h).data;
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var pixel = (y * w + x) * 4, total = ((top + y) * width + left + x) * 5, alpha = pixels[pixel + 3];
        sums[total] += Math.round(pixels[pixel] * alpha / 255);
        sums[total + 1] += Math.round(pixels[pixel + 1] * alpha / 255);
        sums[total + 2] += Math.round(pixels[pixel + 2] * alpha / 255);
        sums[total + 3] += alpha; sums[total + 4] += weights[pixel + 3];
      }
    });
    // One union fill has no internal antialiased cuts. Normalize accumulated
    // triangle coverage to that silhouette, retaining exterior edge coverage.
    shape.globalCompositeOperation = 'source-over'; shape.beginPath();
    job.triangles.forEach(function (triangle) { trianglePath(shape, triangle.target); }); shape.fill();
    var pixels = color.createImageData(width, height);
    var silhouette = shape.getImageData(0, 0, width, height).data;
    for (var i = 0; i < width * height; i++) {
      var offset = i * 5, out = i * 4, sumAlpha = sums[offset + 3], sumCoverage = sums[offset + 4];
      if (!sumAlpha || !sumCoverage) continue;
      for (var channel = 0; channel < 3; channel++) pixels.data[out + channel] = Math.round(sums[offset + channel] * 255 / sumAlpha);
      pixels.data[out + 3] = Math.min(255, Math.round(sumAlpha * silhouette[out + 3] / sumCoverage));
    }
    color.putImageData(pixels, 0, 0); return buffers[0];
  }
  function drawPose(canvas, pose, decodedAssets) {
    if (!canvas || !Number.isInteger(canvas.width) || !Number.isInteger(canvas.height) || canvas.width < 1 ||
        canvas.height < 1 || canvas.width > 1024 || canvas.height > 1024 || typeof canvas.getContext !== 'function') {
      fail('unsupported_canvas', 'Canvas must be 1..1024 pixels per side');
    }
    if (!pose || !(decodedAssets instanceof Map)) fail('invalid_pose', 'Pose and decoded asset Map required');
    if (array(pose.blockedParts, 'invalid_pose').length) {
      var blocked = new Error('Pose contains unprepared or invalid parts');
      blocked.code = 'blocked_pose'; blocked.blockedParts = pose.blockedParts; throw blocked;
    }
    var background = null, seen = new Set();
    function asset(id) {
      if (typeof id !== 'string' || !id || !decodedAssets.has(id)) fail('missing_asset', 'Missing decoded asset ' + id);
      var image = decodedAssets.get(id);
      return { image: image, size: imageSize(image) };
    }
    if (pose.backgroundAssetId !== null) {
      background = asset(pose.backgroundAssetId);
      if (background.size.width !== canvas.width || background.size.height !== canvas.height) fail('invalid_pose', 'Background/canvas dimensions differ');
    }
    // Validate every item and precompute every matrix before touching the target.
    var jobs = array(pose.draws, 'invalid_pose').map(function (draw) {
      if (!draw || typeof draw.partId !== 'string' || !draw.partId || seen.has(draw.partId) || !finite(draw.opacity) ||
          draw.opacity < 0 || draw.opacity > 1 || !finite(draw.order)) fail('invalid_pose', 'Invalid draw item');
      seen.add(draw.partId); geometry(draw.verticesDocument, draw.uv, draw.triangles);
      var decoded = asset(draw.assetId), triangles = [];
      for (var i = 0; i < draw.triangles.length; i += 3) triangles.push(triangleMapping(draw, i, decoded.size));
      return { partId: draw.partId, order: draw.order, opacity: draw.opacity, image: decoded.image, triangles: triangles,
        affine: sharedAffine(draw, decoded.size), rectangle: fullRectangle(draw) };
    });
    if (jobs.length > 16) fail('invalid_pose', 'At most 16 part draws');
    jobs.sort(function (a, b) { return a.order - b.order; });
    var buffers = jobs.some(function (job) { return !job.affine; }) ? [scratchCanvas(canvas), scratchCanvas(canvas), scratchCanvas(canvas)] : null;
    var context = canvas.getContext('2d');
    if (!context || (typeof context.isContextLost === 'function' && context.isContextLost())) fail('render_unavailable', 'Canvas2D unavailable');
    var drawnPartIds = [];
    context.save();
    try {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
      context.filter = 'none'; context.shadowBlur = 0;
      context.shadowOffsetX = 0; context.shadowOffsetY = 0; context.shadowColor = 'rgba(0,0,0,0)';
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (background) context.drawImage(background.image, 0, 0);
      jobs.forEach(function (job) {
        if (job.opacity === 0) return;
        context.globalAlpha = job.opacity;
        context.save();
        try {
          if (job.affine) {
            if (!job.rectangle) {
              context.beginPath(); job.triangles.forEach(function (triangle) { trianglePath(context, triangle.target); }); context.clip();
            }
            context.setTransform.apply(context, job.affine); context.drawImage(job.image, 0, 0);
          } else {
            context.setTransform(1, 0, 0, 1, 0, 0);
            context.drawImage(meshLayer(job, buffers, canvas.width, canvas.height), 0, 0);
          }
        } finally { context.restore(); }
        drawnPartIds.push(job.partId);
      });
    } finally { context.restore(); }
    return { width: canvas.width, height: canvas.height, drawnPartIds: drawnPartIds };
  }
  return { createGrid: createGrid, evaluatePose: evaluatePose, sampleMotion: sampleMotion, drawPose: drawPose };
}));

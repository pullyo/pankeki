"""Request recipe -> exact cache -> model -> validated final pixel composite."""
import base64
import copy
import hashlib
import io
import inspect
import json
import math
import os
import platform
import threading
import time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps, __version__ as pillow_version

from .cache import ExactCache, canonical_hash, content_hash, make_cache_key
from .comfy_adapter import Canceled, ComfyClient, attest_atomic_cancel_listener, validate_atomic_attestation
from .composite import composite
from .environment import process_start_token, server_signature, source_fingerprint
from .metrics import JsonlMetrics
from .model_lease import ReadOnlyModelLease
from .model_presets import (ANIMAGINE_MODEL_ID, INPAINT_MODEL_ID, MODEL_PRESETS, configured_models,
                           is_available, model_components, model_listing)
from .planning import crop_for_plan, model_scale_size, plan_roi, restore_model_output, scale_for_model, unpad_generated
from .recolor import recolor, validate_options as validate_recolor_options
from .run_store import RunStore
from .workflows import img2img, inpaint, inpaint_sdxl, txt2img

Image.MAX_IMAGE_PIXELS = 16_777_216


def png_bytes(image):
    buffer = io.BytesIO()
    image.save(buffer, format='PNG')
    return buffer.getvalue()


def decode_image(data):
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.width * image.height > Image.MAX_IMAGE_PIXELS:
                raise ValueError('Image exceeds 16 megapixel limit')
            image.load()
            return ImageOps.exif_transpose(image).copy()
    except Image.DecompressionBombError as exc:
        raise ValueError('Image exceeds 16 megapixel limit') from exc


def file_sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


class ModelDigestCache:
    """Reuse a full model SHA256 only while the file's identity metadata is unchanged.

    The first check of each file in a process still reads every byte. Later checks
    compare device, inode, size, mtime and ctime; any content write, replacement,
    rename-over or utime call changes ctime, so the file is hashed again. A digest
    whose metadata changed during the read is never stored.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._entries = {}
        self.hits = 0
        self.misses = 0

    @staticmethod
    def _signature(path):
        stat = os.stat(path)
        return (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)

    def sha256(self, path):
        key = os.path.realpath(path)
        before = self._signature(key)
        with self._lock:
            cached = self._entries.get(key)
            if cached is not None and cached[0] == before:
                self.hits += 1
                return cached[1]
        digest = file_sha256(key)
        after = self._signature(key)
        with self._lock:
            self.misses += 1
            if after == before:
                self._entries[key] = (after, digest)
            else:
                self._entries.pop(key, None)
        return digest


def validate_request(value, model_defaults=None):
    if not isinstance(value, dict):
        raise ValueError('Request must be an object')
    result = dict(value)
    defaults = dict(mode='txt2img', prompt='', negative='', seed=1, width=512, height=512,
                    steps=1, cfg=1., denoise=1., cache=True, roi=False, halo=32,
                    feather=4, preview=True, preview_interval=.2, sampler='euler', scheduler='normal')
    if model_defaults:
        defaults.update(model_defaults)
    for name, default in defaults.items():
        result.setdefault(name, default)
    operation = result.get('edit_operation', 'regenerate')
    if operation not in ('regenerate', 'recolor'):
        raise ValueError('edit_operation must be regenerate or recolor')
    local_recolor = operation == 'recolor'
    if result.get('model_id') == ANIMAGINE_MODEL_ID and (result['mode'] not in ('txt2img', 'img2img') or local_recolor):
        raise ValueError(f'{ANIMAGINE_MODEL_ID} is generation-only and requires mode=txt2img')
    if result.get('model_id') == INPAINT_MODEL_ID and (result['mode'] != 'inpaint' or local_recolor):
        raise ValueError(f'{INPAINT_MODEL_ID} requires mode=inpaint and edit_operation=regenerate')
    if local_recolor:
        if result['mode'] != 'inpaint':
            raise ValueError('recolor requires mode=inpaint')
        result.update(validate_recolor_options(result))
        result['cache'] = False
    if not local_recolor and 'model_id' in result and (not isinstance(result['model_id'], str) or result['model_id'] not in MODEL_PRESETS):
        raise ValueError('Unknown model_id')
    if result['mode'] not in ('txt2img', 'inpaint', 'img2img'):
        raise ValueError('mode must be txt2img, inpaint or img2img')
    if result['mode'] == 'img2img':
        if 'mask' in result or 'edit_operation' in result:
            raise ValueError('img2img is source-only, not a masked operation')
        if result.get('model_id') not in (None, 'sdxl-base', ANIMAGINE_MODEL_ID):
            raise ValueError('img2img requires SDXL Base or Animagine; no fallback is permitted')
        if type(result['denoise']) not in (int, float) or not 0 < result['denoise'] < 1:
            raise ValueError('img2img requires 0 < denoise < 1')
    for name in ('prompt', 'negative'):
        if not isinstance(result[name], str) or len(result[name]) > 10000:
            raise ValueError(f'{name} must be text <= 10000 characters')
    for name, low, high in [('seed', 0, 2**64-1), ('steps', 1, 100), ('width', 64, 2048),
                            ('height', 64, 2048), ('halo', 0, 512), ('feather', 0, 64)]:
        if type(result[name]) is not int or not low <= result[name] <= high:
            raise ValueError(f'{name} must be an integer in {low}..{high}')
    if result['width'] % 8 or result['height'] % 8:
        raise ValueError('Text generation dimensions must be multiples of 8')
    for name, low, high in [('cfg', 0, 30), ('denoise', .01, 1), ('preview_interval', .05, 5)]:
        if type(result[name]) not in (int, float) or not math.isfinite(result[name]) or not low <= result[name] <= high:
            raise ValueError(f'{name} must be finite in {low}..{high}')
    for name in ('cache', 'roi', 'preview'):
        if type(result[name]) is not bool:
            raise ValueError(f'{name} must be boolean')
    if result.get('model_id') == INPAINT_MODEL_ID:
        result['cache'] = False  # Dedicated multi-component graphs are outside the exact-cache contract.
    if result['sampler'] not in ('euler', 'euler_ancestral', 'dpmpp_2m') or result['scheduler'] not in ('normal', 'simple', 'karras'):
        raise ValueError('Unsupported sampler/scheduler in minimal adapter')
    for name in ('source', 'mask'):
        if result['mode'] == 'inpaint' or result['mode'] == 'img2img' and name == 'source':
            if not isinstance(result.get(name), str):
                raise ValueError(f'{name} PNG base64 is required')
            data = base64.b64decode(result[name].split(',', 1)[-1], validate=True)
            if len(data) > 20 * 1024 * 1024:
                raise ValueError('Image file exceeds 20 MiB')
            image = decode_image(data)
            if name == 'source':
                source_size = image.size
                if result['mode'] == 'img2img':
                    if any(size < 64 or size > 2048 or size % 8 for size in image.size):
                        raise ValueError('img2img source dimensions must be 64..2048 and multiples of 8')
                    result['width'], result['height'] = image.size
            elif image.size != source_size:
                raise ValueError('Mask dimensions must match original image')
    return result


class Engine:
    def __init__(self, root, base_url='http://127.0.0.1:8188', config=None, client=None):
        self.root = Path(root)
        self.runtime = self.root / 'runtime'
        self.runs = self.runtime / 'runs'
        self.runs.mkdir(parents=True, exist_ok=True)
        self.run_store = RunStore(self.runtime)
        self.config = copy.deepcopy(config or {})
        self._closed = False
        self._model_lease = None
        self._model_leases = {}
        self.models, self._preferred_model, self._explicit_models = configured_models(self.config)
        self.fingerprint_policy = self.config.get('fingerprint_policy', 'strict')
        if self.fingerprint_policy not in ('strict', 'windows_read_lock', 'stat_cache'):
            raise ValueError('Unknown fingerprint policy')
        self.fingerprint_fallback = None
        self._digests = ModelDigestCache()
        setup_started = time.perf_counter()
        try:
            if self.fingerprint_policy == 'windows_read_lock' and self.config.get('managed_builtin_only'):
                try:
                    if self.models:
                        for model_id, entry in self.models.items():
                            if is_available(entry, self.models):
                                self._model_leases[model_id] = ReadOnlyModelLease(entry['model_path'], entry['manifest']['model_sha256'])
                    elif self.config.get('model_path'):
                        self._model_lease = ReadOnlyModelLease(self.config['model_path'], self.config['manifest']['model_sha256'])
                except OSError as exc:
                    # If any requested lease is unavailable, all requests retain full byte checks.
                    for lease in self._model_leases.values():
                        lease.close()
                    self._model_leases.clear()
                    self.fingerprint_policy = 'strict'
                    self.fingerprint_fallback = str(exc)
            self.fingerprint_setup_s = time.perf_counter() - setup_started
            self.adapter_sources = source_fingerprint(Path(__file__).parent)
            self.client_software = {'python': platform.python_version(), 'numpy': np.__version__, 'pillow': pillow_version}
            if client is not None:
                self.client = client
            elif self.config.get('transport', 'direct') == 'direct':
                self.client = ComfyClient(base_url)
            else:
                raise ValueError('Unknown Comfy transport')
            if isinstance(self.client, ComfyClient):
                attestation = self.config.get('comfy_atomic_cancel')
                if isinstance(attestation, dict):
                    valid = validate_atomic_attestation(self.root, attestation,base_url=self.client.base_url)
                    self.client.atomic_cancel_guard = lambda: validate_atomic_attestation(self.root, attestation,base_url=self.client.base_url)
                    self.client.targeted_cancel_capability.update(atomic_source_verified=valid,
                        reason='Owned pinned source verified; actual jobs route and owned known job probe pending' if valid else 'Launcher source/process attestation is unavailable or stale')
            self.cache = ExactCache(self.runtime / 'cache')
            self.metrics = JsonlMetrics(self.runtime / 'metrics.jsonl')
        except BaseException:
            self.close()
            raise

    def _atomic_cancel_attestation(self):
        """Launcher evidence when present; otherwise check the reused listener at
        submit time (the desktop app writes no launcher evidence)."""
        attestation = self.config.get('comfy_atomic_cancel')
        if attestation is not None or not isinstance(self.client, ComfyClient):
            return attestation
        try:
            identity = self.client._server_identity()
        except Exception as exc:
            return {'schema':1,'state':'unknown','reason':str(exc)[:1000]}
        evidence = attest_atomic_cancel_listener(self.root, origin=self.client.base_url, server_identity=identity)
        if evidence.get('state') == 'source_verified':
            self.config['comfy_atomic_cancel'] = evidence
            self.client.atomic_cancel_guard = lambda: validate_atomic_attestation(self.root, evidence, base_url=self.client.base_url)
        return evidence

    def models_info(self):
        return model_listing(self.models, self._preferred_model)

    def validate_request(self, value):
        if not isinstance(value, dict):
            raise ValueError('Request must be an object')
        if value.get('edit_operation') == 'recolor':
            # A CPU operation has no checkpoint/default-model dependency.
            return validate_request(value)
        model_id = value.get('model_id') if 'model_id' in value else self.models_info()['default_model_id']
        if 'model_id' in value or self.models or self._explicit_models:
            if not isinstance(model_id, str) or model_id not in MODEL_PRESETS:
                raise ValueError('Unknown model_id or no model is available')
            if not is_available(self.models.get(model_id), self.models):
                raise ValueError(f'Model {model_id} is not installed/configured')
            return validate_request(dict(value, model_id=model_id), MODEL_PRESETS[model_id]['defaults'])
        # Unconfigured legacy engines keep their offline empty-mask and discovery behavior.
        return validate_request(value)

    def _model_sha256(self, path):
        if self.fingerprint_policy == 'stat_cache':
            return self._digests.sha256(path)
        return file_sha256(path)

    def _dependencies(self, workflow, input_hashes, recipe, model_id=None):
        # An arbitrary existing ComfyUI server cannot be attested by node names alone.
        dedicated = model_id == INPAINT_MODEL_ID
        if not self.config.get('managed_builtin_only') and not dedicated:
            if model_id == ANIMAGINE_MODEL_ID:
                selected = self.models[model_id]
                if self._model_sha256(selected['model_path']) != selected['manifest']['model_sha256']:
                    raise ValueError('Animagine configured model bytes differ from its SHA256 manifest')
                return {}, 'Animagine configured file SHA256 checked; unmanaged server: exact cache bypass'
            return {}, 'unmanaged server: exact cache bypass'
        guard = self.config.get('runtime_guard') if self.config.get('managed_builtin_only') else None
        if guard:
            if process_start_token(guard['pid']) != guard['process_start_token']:
                raise ValueError('Managed ComfyUI process changed; restart and rebuild manifest')
            if server_signature(self.client.get('/system_stats')['system']) != guard['server_signature']:
                raise ValueError('ComfyUI launch environment changed; rebuild manifest')
            for source, expected_hash in guard['source_trees'].items():
                if source_fingerprint(source) != expected_hash:
                    raise ValueError('ComfyUI source changed after start; restart and rebuild manifest')
            for path, expected_hash in guard.get('configuration_files', {}).items():
                if file_sha256(path) != expected_hash:
                    raise ValueError('ComfyUI configuration changed after start; restart and rebuild manifest')
        if dedicated:
            components = model_components(self.models, model_id)
            for component in components.values():
                key = component['model_id']
                entry = self.models[key]
                lease = self._model_leases.get(key)
                current = lease.sha256 if lease else self._model_sha256(entry['model_path'])
                if current != component['model_sha256']:
                    raise ValueError(f'Model {key} bytes differ from configured manifest; rebuild manifest before editing')
            dependencies = {'model_components': components, 'input_hashes': input_hashes,
                            'request_recipe': recipe, 'component_verification': 'configured_files_sha256'}
            scope = ('managed runtime guard checked' if guard else
                     'unmanaged ComfyUI runtime not attested' if not self.config.get('managed_builtin_only') else
                     'no runtime guard configured')
            return dependencies, ('dedicated inpaint graph: exact cache disabled; configured UNet and Base '
                                  'files SHA256 verified; ' + scope)
        selected = self.models[model_id] if model_id is not None else self.config
        expected = selected.get('manifest', {})
        model_path = selected.get('model_path')
        if not model_path:
            return {}, 'model content is not verifiable'
        lease = self._model_leases.get(model_id) if model_id is not None else self._model_lease
        current = lease.sha256 if lease else self._model_sha256(model_path)
        if current != expected.get('model_sha256'):
            raise ValueError('Model bytes changed since managed server start. Restart and rebuild manifest before generating.')
        dependencies = dict(expected)
        dependencies['input_hashes'] = input_hashes
        dependencies['request_recipe'] = recipe
        if guard:
            # Process identity is checked but excluded from the key to permit identical safe restarts.
            dependencies['request_recipe'] = dict(recipe, runtime_content={
                'server_signature': guard['server_signature'], 'source_trees': guard['source_trees'],
                'configuration_files': guard.get('configuration_files', {})})
        reason = ('managed builtin graph; checkpoint SHA256 verified once and Windows read-only lease retained'
                  if lease else 'managed builtin graph; full checkpoint SHA256 checked this request')
        return dependencies, reason

    def close(self):
        self._closed = True
        if self._model_lease is not None:
            self._model_lease.close()
        for lease in self._model_leases.values():
            lease.close()

    def __call__(self, job, on_preview):
        if self._closed:
            raise ValueError('Engine is closed')
        started = time.perf_counter()
        trace_id = getattr(job, 'trace_id', job.job_id)
        directory = self.run_store.begin(job.job_id, trace_id)
        r = self.validate_request(job.request)
        local_recolor = r.get('edit_operation') == 'recolor'
        model_id = None if local_recolor else r.get('model_id')
        selected_model = {} if local_recolor else (self.models[model_id] if model_id is not None else self.config)
        recipe = {key: value for key, value in r.items() if key not in ('source', 'mask', 'cache', 'preview', 'preview_interval')}
        if source_fingerprint(Path(__file__).parent) != self.adapter_sources:
            raise ValueError('Pankeki source changed while running. Restart Pankeki before generating.')
        recipe['adapter_source_sha256'] = self.adapter_sources
        recipe['client_software'] = self.client_software
        if not local_recolor and hasattr(self.client, 'fingerprint'):
            recipe['transport'] = self.client.fingerprint()
        observations = {'job_id': job.job_id, 'trace_id': trace_id, 'run_ref': 'runs/' + job.job_id,
                        'lane': getattr(job, 'lane', 'cpu' if local_recolor else 'gpu'),
                        'revision': job.revision, 'queue_s': job.queue_s,
                        'model_id': model_id, 'model_name': selected_model.get('model_name'),
                        'created_utc': datetime.now(timezone.utc).isoformat(), 'kind': 'real_comfyui',
                        'cache': 'off', 'model_calls': 0, 'gpu_completed': False,
                        'fingerprint_policy': self.fingerprint_policy,
                        'fingerprint_setup_s': self.fingerprint_setup_s,
                        'fingerprint_fallback': self.fingerprint_fallback,
                        'cuda_denoiser_s': None, 'cuda_vae_s': None, 'peak_vram_allocated_bytes': None,
                        'peak_vram_reserved_bytes': None, 'outside_mask_max_error': None,
                        'preview_received_count': 0, 'preview_received_bytes': 0,
                        'comfy_cached_nodes': [], 'node_wall_s': None}
        if model_id == INPAINT_MODEL_ID:
            components = model_components(self.models, model_id)
            recipe['model_components'] = copy.deepcopy(components)
            observations.update(model_components=components, component_verification='not_run')
        try:
            if local_recolor:
                observations.update(kind='local_recolor', cache='off', model_calls=0,
                    denoiser_executed=False, model_pixels=0, model_size=None,
                    cache_reason='local CPU operation; no model or exact cache', model_used=False)
                data = self._local_recolor(directory, job, r, recipe, observations, on_preview)
                return self._save(directory, job, data, recipe, observations, started)
            model = selected_model.get('model_name')
            if not model and r['mode'] != 'inpaint':
                names = self.client.get('/object_info/CheckpointLoaderSimple')['CheckpointLoaderSimple']['input']['required']['ckpt_name'][0]
                if not names:
                    raise ValueError('No ComfyUI checkpoint installed')
                model = names[0]
            common = dict(model_name=model, prompt=r['prompt'], negative=r['negative'], seed=r['seed'],
                          steps=r['steps'], cfg=r['cfg'], sampler=r['sampler'], scheduler=r['scheduler'])
            input_hashes = {}
            original = mask = plan = original_alpha = None
            upload_data = None
            if r['mode'] == 'img2img':
                reference = decode_image(base64.b64decode(r['source'].split(',', 1)[-1])).convert('RGBA')
                upload_data = png_bytes(reference)
                (directory / 'original.png').write_bytes(upload_data)
                recipe['original_sha256'] = content_hash(upload_data)
                image_name = content_hash(upload_data) + '.png'
                input_hashes[image_name] = content_hash(upload_data)
                workflow = img2img(image_name=image_name, denoise=r['denoise'], **common)
                observations.update(model_pixels=r['width'] * r['height'], model_size=[r['width'], r['height']], plan_mode='img2img', source_conditioned=True)
            elif r['mode'] == 'inpaint':
                source_image = decode_image(base64.b64decode(r['source'].split(',', 1)[-1]))
                if source_image.mode in ('RGBA', 'LA') or 'transparency' in source_image.info:
                    original_alpha = source_image.convert('RGBA').getchannel('A')
                original = source_image.convert('RGB')
                mask = decode_image(base64.b64decode(r['mask'].split(',', 1)[-1])).convert('L')
                preserved = original.copy()
                if original_alpha is not None:
                    preserved.putalpha(original_alpha)
                source_png, mask_png = png_bytes(preserved), png_bytes(mask)
                (directory / 'original.png').write_bytes(source_png)
                (directory / 'mask.png').write_bytes(mask_png)
                recipe['original_sha256'] = content_hash(source_png)
                recipe['mask_sha256'] = content_hash(mask_png)
                # Baseline is a full-frame crop. Min 256 is a conservative SD Turbo experiment setting.
                plan = plan_roi(mask, halo=r['halo'], min_size=256)
                if plan.mode != 'empty' and not r['roi']:
                    full = Image.new('L', mask.size, 255)
                    plan = plan_roi(full, halo=0, min_size=256)
                recipe['plan'] = json.loads(json.dumps(asdict(plan)))
                observations.update({'mask_pixels': int(np.count_nonzero(np.asarray(mask))),
                                     'model_pixels': plan.processed_area, 'model_size': list(plan.padded_size),
                                     'plan_mode': plan.mode, 'buffer_rgb_bytes': original.width * original.height * 3 * 2})
                if plan.mode == 'empty':
                    data = source_png
                    observations.update(cache='empty-mask-skip', kind='pixel_copy', outside_mask_max_error=0)
                    if model_id == INPAINT_MODEL_ID:
                        observations['cache_reason'] = 'empty mask: pixel copy; component hashes and model execution not run'
                    return self._save(directory, job, data, recipe, observations, started)
                if not model:
                    names = self.client.get('/object_info/CheckpointLoaderSimple')['CheckpointLoaderSimple']['input']['required']['ckpt_name'][0]
                    if not names:
                        raise ValueError('No ComfyUI checkpoint installed')
                    common['model_name'] = names[0]
                crop = crop_for_plan(original, plan)
                crop_mask = crop_for_plan(mask, plan, is_mask=True)
                model_size = plan.padded_size
                if plan.mode == 'roi' and model_id in MODEL_PRESETS:
                    # A small crop sampled at its own size is far below SDXL's native
                    # resolution and comes back broken; sample at the model's area.
                    defaults = MODEL_PRESETS[model_id]['defaults']
                    model_size = model_scale_size(plan.padded_size, defaults['width'] * defaults['height'])
                    crop, crop_mask = scale_for_model(crop, model_size), scale_for_model(crop_mask, model_size, is_mask=True)
                recipe['model_size'] = list(model_size)
                observations.update(model_size=list(model_size), model_pixels=model_size[0] * model_size[1],
                                    roi_scale=round(model_size[0] / plan.padded_size[0], 4))
                crop = crop.convert('RGBA')
                crop.putalpha(ImageOps.invert(crop_mask))
                upload_data = png_bytes(crop)
                image_name = content_hash(upload_data) + '.png'
                input_hashes[image_name] = content_hash(upload_data)
                if model_id == INPAINT_MODEL_ID:
                    common['model_name'] = self.models['sdxl-base']['model_name']
                    workflow = inpaint_sdxl(unet_name=model, image_name=image_name, denoise=r['denoise'], **common)
                else:
                    workflow = inpaint(image_name=image_name, denoise=r['denoise'], **common)
            else:
                workflow = txt2img(width=r['width'], height=r['height'], **common)
                observations.update(model_pixels=r['width'] * r['height'], model_size=[r['width'], r['height']], plan_mode='baseline')
            fingerprint_started = time.perf_counter()
            digest_hits = self._digests.hits
            dependencies, reason = self._dependencies(workflow, input_hashes, recipe, model_id)
            if model_id == INPAINT_MODEL_ID:
                observations['component_verification'] = dependencies['component_verification']
            key = make_cache_key(workflow, dependencies) if r['cache'] else None
            observations.update(fingerprint_s=time.perf_counter() - fingerprint_started,
                                fingerprint_reused=self._digests.hits - digest_hits, cache_reason=reason,
                                cache_key=key, workflow_sha256=canonical_hash(workflow))
            (directory / 'workflow.json').write_text(json.dumps(workflow, indent=2), encoding='utf-8')
            (directory / 'dependencies.json').write_text(json.dumps(dependencies, indent=2), encoding='utf-8')
            data = self.cache.get(key) if key else None
            observations['cache'] = ('hit' if data is not None else 'miss') if key else ('bypass' if r['cache'] else 'off')
            if job.cancel.is_set():
                raise Canceled('Canceled during preprocessing')
            if data is None:
                if upload_data:
                    # Collision-safe upload; graph binds the actual returned filename and hash.
                    actual = self.client.upload_png(upload_data, image_name)
                    if actual != image_name:
                        workflow['4']['inputs']['image'] = actual
                        dependencies.get('input_hashes', {})[actual] = content_hash(upload_data)
                        # Do not key by a variable collision suffix: skip cache for this request.
                        key = None
                        observations.update(cache='bypass', cache_reason='upload basename collision; no cache write', cache_key=None)
                        (directory / 'workflow.json').write_text(json.dumps(workflow, indent=2), encoding='utf-8')
                        observations['workflow_sha256'] = canonical_hash(workflow)
                observations['model_calls'] = 1  # submission count, actual denoiser may be Comfy cached
                def submitted(prompt_id):
                    callback = getattr(job, 'on_submitted', None)
                    if callback:
                        callback(prompt_id)
                    else:
                        job.prompt_id = prompt_id
                    attestation = self._atomic_cancel_attestation()
                    if isinstance(attestation, dict) and hasattr(self.client, 'verify_targeted_cancel'):
                        self.client.verify_targeted_cancel(prompt_id,
                            expected_server_identity=attestation.get('server_identity'),
                            atomic_source_verified=validate_atomic_attestation(self.root, attestation,base_url=self.client.base_url))
                execute_options = dict(cancel=job.cancel, on_preview=on_preview if r['preview'] else None,
                                       on_submitted=submitted)
                # Preserve older injected/SDK clients. Direct transport durably stores its
                # own client ID before POST; unsupported transports never pretend it did.
                parameters = inspect.signature(self.client.execute).parameters
                if 'on_submitting' in parameters:
                    execute_options['on_submitting'] = getattr(job, 'persist_submission', None)
                if 'on_cancelled' in parameters:
                    execute_options['on_cancelled'] = getattr(job, 'on_cancelled', None)
                raw, measured = self.client.execute(workflow, **execute_options)
                observations.update(measured, gpu_completed=True)
                generated = decode_image(raw).convert('RGB')
                if plan:
                    (directory / 'generated-crop.png').write_bytes(png_bytes(generated))
                    if generated.size != tuple(recipe['model_size']):
                        raise ValueError('Unexpected generated crop size')
                    output = composite(original, unpad_generated(restore_model_output(generated, plan), plan), mask,
                                       plan.bbox, feather=r['feather'])
                    if original_alpha is not None:
                        output.putalpha(original_alpha)
                else:
                    if generated.size != (r['width'], r['height']):
                        raise ValueError('Unexpected generated image size')
                    output = generated
                data = png_bytes(output)
            output = decode_image(data).convert('RGB')
            if original:
                outside = np.asarray(mask) == 0
                delta = np.abs(np.asarray(output).astype(np.int16) - np.asarray(original).astype(np.int16))
                observations['outside_mask_max_error'] = int(delta[outside].max()) if outside.any() else 0
                if observations['outside_mask_max_error'] != 0:
                    raise ValueError('Outside-mask preservation failed')
            if job.cancel.is_set():
                raise Canceled('Canceled before completion; result not cached')
            if key and observations['cache'] == 'miss':
                # JobManager runs this under its revision/cancellation lock only on successful commit.
                def commit():
                    cache_started = time.perf_counter()
                    observations.update(cache_stored=self.cache.put(key, data, {'workflow_sha256': observations['workflow_sha256']}),
                                        cache_write_s=time.perf_counter() - cache_started,
                                        total_s=time.perf_counter() - started,
                                        end_to_ready_s=time.perf_counter() - job.created)
                    # The successful result record was already validated before cache commit.
                    # A late telemetry failure must not turn a committed success into a failed job.
                    try:
                        (directory / 'metrics.json').write_text(json.dumps(observations, ensure_ascii=False, indent=2), encoding='utf-8')
                        self.metrics.write(observations)
                    except OSError as exc:
                        observations['metrics_warning'] = str(exc)
                job.commit = commit
            return self._save(directory, job, data, recipe, observations, started)
        except Exception as exc:
            observations.update(status='canceled' if isinstance(exc, Canceled) else 'failed', error=str(exc), total_s=time.perf_counter() - started)
            (directory / 'metrics.json').write_text(json.dumps(observations, ensure_ascii=False, indent=2), encoding='utf-8')
            self.metrics.write(observations)
            raise

    def _local_recolor(self, directory, job, request, recipe, observations, on_preview):
        def check_cancel():
            if job.cancel.is_set():
                raise Canceled('Canceled during local recolor')
        check_cancel()
        started = time.perf_counter()
        original = decode_image(base64.b64decode(request['source'].split(',', 1)[-1]))
        original = original.convert('RGBA' if original.mode in ('RGBA', 'LA')
            or 'transparency' in original.info else 'RGB')
        mask = decode_image(base64.b64decode(request['mask'].split(',', 1)[-1])).convert('L')
        original_png, mask_png = png_bytes(original), png_bytes(mask)
        (directory / 'original.png').write_bytes(original_png)
        (directory / 'mask.png').write_bytes(mask_png)
        recipe.update(original_sha256=content_hash(original_png), mask_sha256=content_hash(mask_png),
            execution='cpu', requested_model_id=recipe.pop('model_id', None))
        output, parameters = recolor(original, mask, request['target_color'],
            source_color=request['source_color'], color_tolerance=request['color_tolerance'],
            feather=request['feather'], check_cancel=check_cancel)
        check_cancel()
        recipe['recolor'] = parameters
        (directory / 'recolor-params.json').write_text(json.dumps(parameters, ensure_ascii=False, indent=2), encoding='utf-8')
        delta = np.abs(np.asarray(output.convert('RGBA')).astype(np.int16)
            - np.asarray(original.convert('RGBA')).astype(np.int16))
        inside = np.asarray(mask) > 0
        outside_error = int(delta[~inside, :3].max()) if (~inside).any() else 0
        alpha_error = int(delta[..., 3].max())
        if outside_error or alpha_error:
            raise ValueError('Local recolor pixel preservation failed')
        observations.update(outside_mask_max_error=outside_error, alpha_max_error=alpha_error,
            changed_inside_pixels=int(np.count_nonzero(np.any(delta[inside, :3], axis=1))),
            mask_pixels=int(np.count_nonzero(inside)), algorithm=parameters['algorithm'],
            estimated_source_color=parameters.get('estimated_source_color'),
            source_color=parameters.get('resolved_source_color', request['source_color']),
            target_color=request['target_color'], color_tolerance=request['color_tolerance'],
            skipped=parameters['skipped'], local_cpu_s=time.perf_counter() - started,
            processed_pixels=original.width * original.height, plan_mode='local_recolor')
        data = png_bytes(output)
        check_cancel()
        if request['preview'] and not parameters['skipped']:
            on_preview(data)
            observations.update(preview_received_count=1, preview_received_bytes=len(data))
        return data

    def _save(self, directory, job, data, recipe, observations, started):
        if job.cancel.is_set():
            raise Canceled('Canceled before final save')
        output = directory / 'result.png'
        output.write_bytes(data)
        recipe.update(job_id=job.job_id, revision=job.revision, seed=job.request.get('seed', 1))
        observations.update(status='ready', total_s=time.perf_counter() - started,
                            end_to_ready_s=time.perf_counter() - job.created,
                            preview_accepted_count=job.preview_version, preview_dropped_count=job.preview_dropped,
                            image_sha256=content_hash(data), image_path=str(output),
                            recipe_sha256=canonical_hash(recipe))
        (directory / 'recipe.json').write_text(json.dumps(recipe, ensure_ascii=False, indent=2), encoding='utf-8')
        (directory / 'metrics.json').write_text(json.dumps(observations, ensure_ascii=False, indent=2), encoding='utf-8')
        def finalize(state, error):
            observations.update(status=state, error=error, total_s=time.perf_counter() - started,
                                end_to_ready_s=time.perf_counter() - job.created)
            (directory / 'metrics.json').write_text(json.dumps(observations, ensure_ascii=False, indent=2), encoding='utf-8')
            if state != 'succeeded' or job.commit is None:
                self.metrics.write(observations)
        job.finalize = finalize
        job.seal = lambda: self.run_store.complete('runs/' + job.job_id, content_hash(data))
        return {'image_url': '/api/results/' + job.job_id, 'image_path': str(output), 'metrics': observations,
                'trace_id': getattr(job, 'trace_id', job.job_id), 'job_id': job.job_id,
                'result_sha256': content_hash(data), 'run_ref': 'runs/' + job.job_id}

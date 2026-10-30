"""Official MCP stdio tools over the existing Pankeki HTTP API; no inference here."""
import argparse
import base64
import hashlib
from http.client import HTTPException
import io
import json
import logging
import math
from pathlib import Path
import re
import sys
from typing import Any, Literal
from urllib import error, parse, request as http
import uuid

from PIL import Image, ImageChops, ImageOps

MAX_INPUT = 20 * 1024 * 1024
MAX_RESPONSE = 80 * 1024 * 1024
MAX_BODY = 32 * 1024 * 1024
JOB_ID = re.compile(r'[0-9a-f]{32}\Z')
HEX = re.compile(r'#[0-9a-fA-F]{6}\Z')
SHA256 = re.compile(r'[0-9a-f]{64}\Z')
DEDICATED_INPAINT_MODEL = 'sdxl-inpaint-v01'
ANIMAGINE_MODEL = 'animagine-xl-4.0-opt'
STATES = {'queued', 'running', 'submitting', 'canceling', 'canceled', 'succeeded', 'failed', 'uncertain', 'orphaned'}
CAPABILITY_OPERATIONS = {'generate','regenerate','recolor','recompose','markup','comments','background-remove','erase','resize'}
PRIVATE_EXECUTION_KEYS = {'trace_id','traceId','run_ref','runRef','execution'}


def public_metadata(value):
    if isinstance(value, dict):
        return {key:public_metadata(item) for key,item in value.items() if key not in PRIVATE_EXECUTION_KEYS}
    if isinstance(value, list):
        return [public_metadata(item) for item in value]
    return value


def capability_numbers(value):
    if isinstance(value,float) and value.is_integer():
        return int(value)
    if isinstance(value,dict):
        return {key:capability_numbers(item) for key,item in value.items()}
    if isinstance(value,list):
        return [capability_numbers(item) for item in value]
    return value


class AdapterError(ValueError):
    """An explicit tool failure; never substitute an image or retry submission."""


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded_json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')


def number(value, name, low, high, integer=False):
    if type(value) not in ((int,) if integer else (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise AdapterError(f'{name} must be {"an integer" if integer else "finite"} in {low}..{high}')
    return value


def text(value, name, limit=10000):
    if not isinstance(value, str) or len(value) > limit:
        raise AdapterError(f'{name} must be text <= {limit} characters')
    return value


def choice(value, name, allowed):
    if not isinstance(value, str) or value not in allowed:
        raise AdapterError(f'Invalid {name}: choose {", ".join(allowed)}')
    return value


def model_component(model_id, configured):
    """Freeze a declared identity; this does not hash or attest model weights."""
    if not isinstance(configured, dict):
        raise AdapterError('Missing model component configuration: ' + model_id)
    name, manifest = configured.get('model_name'), configured.get('manifest')
    sha = manifest.get('model_sha256') if isinstance(manifest, dict) else None
    if not isinstance(name, str) or not name.strip() or not isinstance(sha, str) or not SHA256.fullmatch(sha):
        raise AdapterError('Invalid model component name/manifest: ' + model_id)
    return dict(model_id=model_id, model_name=name, model_sha256=sha)


def scoped(path, roots, exists=True):
    path = Path(path)
    if not path.is_absolute():
        raise AdapterError('Absolute local path required')
    try:
        resolved = path.resolve(strict=exists)
    except OSError as exc:
        raise AdapterError(f'Local path unavailable: {path}') from exc
    if not any(resolved.is_relative_to(root) for root in roots):
        raise AdapterError('Local path escapes approved roots')
    return resolved


def read_file(path, limit=MAX_RESPONSE):
    try:
        if not path.is_file() or path.stat().st_size > limit:
            raise AdapterError('Expected bounded regular file: ' + str(path))
        with path.open('rb') as stream:
            data = stream.read(limit + 1)
        if len(data) > limit:
            raise AdapterError('File exceeds size limit')
        return data
    except OSError as exc:
        raise AdapterError('Could not read file: ' + str(path)) from exc


def json_object(raw):
    try:
        value = json.loads(raw, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
        if not isinstance(value, dict):
            raise ValueError('Expected object')
        return value
    except (ValueError, UnicodeError) as exc:
        raise AdapterError('Invalid JSON object in API response or provenance file') from exc


def image(raw, name):
    try:
        with Image.open(io.BytesIO(raw)) as opened:
            if opened.format != 'PNG' or opened.width * opened.height > 16_000_000:
                raise AdapterError(name + ' must be PNG <=16MP')
            opened.load()
            return ImageOps.exif_transpose(opened).copy()
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        if isinstance(exc, AdapterError):
            raise
        raise AdapterError('Invalid PNG: ' + name) from exc


class NoRedirect(http.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Adapter:
    def __init__(self, app_root, api_url='http://127.0.0.1:8190', state_dir=None, input_roots=None, timeout=10):
        self.root = Path(app_root)
        if not self.root.is_absolute() or not self.root.is_dir():
            raise AdapterError('app-root must be an existing absolute directory')
        self.root = self.root.resolve()
        self.runtime = scoped(self.root / 'runtime', [self.root], exists=False)
        self.state = scoped(Path(state_dir) if state_dir else self.runtime / 'macos/pankeki-mcp-20261023/implementation/state', [self.runtime], exists=False)
        self.input_roots = [Path(p).resolve() for p in (input_roots or [self.root / 'output', self.runtime])]
        if any(not Path(p).is_absolute() for p in (input_roots or [])):
            raise AdapterError('input-root must be absolute')
        self.timeout = number(timeout, 'timeout', .1, 30)
        try:
            url = parse.urlsplit(api_url)
            if (url.scheme != 'http' or url.hostname not in ('127.0.0.1', 'localhost') or url.username or url.password
                    or url.path not in ('', '/') or url.query or url.fragment or not 1 <= (url.port or 80) <= 65535):
                raise ValueError('Invalid loopback URL')
        except ValueError as exc:
            raise AdapterError('api-url must be a loopback HTTP origin without credentials/path') from exc
        self.api_url = f'http://{url.netloc}'
        self.opener = http.build_opener(http.ProxyHandler({}), NoRedirect())
        self._legacy_capabilities = False

    def _http(self, path, body=None, binary=False):
        raw = encoded_json(body) if body is not None else None
        if raw is not None and len(raw) > MAX_BODY:
            raise AdapterError('Request exceeds 32MiB')
        req = http.Request(self.api_url + path, data=raw, headers={'Content-Type': 'application/json'},
            method='POST' if body is not None else 'GET')
        try:
            with self.opener.open(req, timeout=self.timeout) as response:
                data = response.read(MAX_RESPONSE + 1)
                if len(data) > MAX_RESPONSE:
                    raise AdapterError('HTTP response exceeds size limit')
            return data if binary else json_object(data)
        except error.HTTPError as exc:
            # No POST retry even for an error status; original error is explicit.
            failure = AdapterError(f'Pankeki HTTP {exc.code} at {path}')
            failure.status_code = exc.code
            exc.close()
            raise failure from exc
        except (error.URLError, OSError, HTTPException) as exc:
            caution = ' Request may have been submitted; do not automatically retry.' if body is not None else ''
            raise AdapterError('Pankeki connection failed.' + caution) from exc

    def get_status(self):
        models = self._http('/api/models')
        try:
            health = self._http('/api/health')
        except AdapterError as exc:
            health = {'comfy': False, 'error': str(exc)}
        return {'app_reachable': True, 'models': models, 'health': health,
                'capabilities':self.capabilities(), 'capability_mode':'legacy-404' if self._legacy_capabilities else 'schema1'}

    def capabilities(self):
        if self._legacy_capabilities:
            return None
        try:
            value = self._http('/api/capabilities')
        except AdapterError as exc:
            if getattr(exc, 'status_code', None) != 404:
                raise
            self._legacy_capabilities = True
            logging.warning('Pankeki /api/capabilities returned 404; explicit legacy schema fallback, current readiness unavailable')
            return None
        revision = value.get('revision') if isinstance(value, dict) else None
        content = {key:item for key,item in value.items() if key != 'revision'} if isinstance(value, dict) else {}
        if (not isinstance(value,dict) or type(value.get('schema')) is not int or value['schema'] != 1 or not isinstance(revision,str) or not SHA256.fullmatch(revision)
                or digest(json.dumps(capability_numbers(content),sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()) != revision):
            raise AdapterError('Unknown or invalid Pankeki capability schema/revision')
        models, operations = value.get('models'), value.get('operations')
        if not isinstance(models,list) or not isinstance(operations,list):
            raise AdapterError('Malformed Pankeki capability matrix')
        for row in models:
            if (not isinstance(row,dict) or not isinstance(row.get('id'),str)
                    or not re.fullmatch('[a-z0-9][a-z0-9._-]{0,79}',row['id']) or type(row.get('installed')) is not bool
                    or not isinstance(row.get('operations'),list) or any(op not in CAPABILITY_OPERATIONS for op in row['operations'])):
                raise AdapterError('Unknown model operation in capability snapshot')
        for row in operations:
            if (not isinstance(row,dict) or row.get('id') not in CAPABILITY_OPERATIONS or type(row.get('ready')) is not bool
                    or row.get('lane') not in ('cpu','gpu') or row.get('experimental') is not False):
                raise AdapterError('Unknown operation in capability snapshot')
        if len({row['id'] for row in models}) != len(models) or len({row['id'] for row in operations}) != len(operations):
            raise AdapterError('Duplicate capability identities')
        return value

    def schema_options(self):
        value = self.capabilities()
        if value is None:
            return {'generate_models':['sdxl-base','sd-turbo',ANIMAGINE_MODEL],
                'edit_models':['sdxl-base','sd-turbo',DEDICATED_INPAINT_MODEL,ANIMAGINE_MODEL],
                'edit_operations':['regenerate','recolor','recompose']}
        options = {'generate_models':[row['id'] for row in value['models'] if 'generate' in row['operations']],
            'edit_models':[row['id'] for row in value['models'] if any(op in row['operations'] for op in ('regenerate','recompose'))],
            'edit_operations':[name for name in ('regenerate','recolor','recompose') if any(row['id']==name for row in value['operations'])]}
        if not all(options.values()):
            raise AdapterError('Capability schema has no compatible tool choices')
        return options

    def _allowed_models(self, operation, legacy):
        value = self.capabilities()
        if value is None:
            return legacy
        row = next((row for row in value['operations'] if row['id']==operation), None)
        if row is None or not row['ready']:
            raise AdapterError('Operation unavailable: ' + (str(row.get('reason')) if row else operation))
        return tuple(row['id'] for row in value['models'] if operation in row['operations'])

    def _require_operation(self, operation, model_id=None):
        value = self.capabilities()
        if value is None:
            return
        row = next((row for row in value['operations'] if row['id']==operation),None)
        if row is None or not row['ready']:
            raise AdapterError('Operation unavailable: ' + (str(row.get('reason')) if row else operation))
        if model_id is not None:
            model = next((model for model in value['models'] if model['id']==model_id),None)
            if model is None or operation not in model['operations']:
                raise AdapterError('Selected model does not support operation ' + operation)
            if not model['installed']:
                raise AdapterError('Selected model is not installed/configured: ' + str(model.get('reason') or model_id))

    def _remember_execution(self, job, record):
        result = job.get('result') or {}
        values = {key:job.get(key) or result.get(key) for key in ('trace_id','run_ref','result_sha256')}
        if values['run_ref'] is not None and values['run_ref'] != 'runs/' + job['job_id']:
            raise AdapterError('Unsafe execution run reference')
        if values['result_sha256'] is not None and (not isinstance(values['result_sha256'],str) or not SHA256.fullmatch(values['result_sha256'])):
            raise AdapterError('Invalid execution result SHA256')
        if any(value is not None for value in values.values()):
            record['execution'] = {key:value for key,value in values.items() if value is not None}
            path = scoped(self.state / 'jobs', [self.state], exists=False) / (job['job_id'] + '.json')
            path.parent.mkdir(parents=True,exist_ok=True)
            temporary = path.with_suffix('.' + uuid.uuid4().hex + '.tmp')
            temporary.write_bytes(encoded_json(record)); temporary.replace(path)

    def _options(self, prompt='', negative='', model_id='sdxl-base', seed=1, steps=25, cfg=6.,
                 sampler='dpmpp_2m', scheduler='karras', cache=False, preview=False,
                 allowed_models=('sdxl-base', 'sd-turbo', ANIMAGINE_MODEL)):
        for name, value in [('cache', cache), ('preview', preview)]:
            if type(value) is not bool:
                raise AdapterError(name + ' must be boolean')
        return dict(prompt=text(prompt, 'prompt'), negative=text(negative, 'negative'),
            model_id=choice(model_id, 'model_id', allowed_models),
            seed=number(seed, 'seed', 0, 2**53 - 1, True), steps=number(steps, 'steps', 1, 100, True),
            cfg=number(cfg, 'cfg', 0, 30), sampler=choice(sampler, 'sampler', ('euler', 'euler_ancestral', 'dpmpp_2m')),
            scheduler=choice(scheduler, 'scheduler', ('normal', 'simple', 'karras')), cache=cache, preview=preview)

    def generate_image(self, prompt, negative='', model_id='sdxl-base', seed=1, width=1024, height=1024,
                       steps=25, cfg=6., sampler='dpmpp_2m', scheduler='karras', cache=False, preview=False, session=None, trace_id=None):
        allowed = self._allowed_models('generate', ('sdxl-base','sd-turbo',ANIMAGINE_MODEL))
        options = self._options(prompt, negative, model_id, seed, steps, cfg, sampler, scheduler, cache, preview, allowed_models=allowed)
        self._require_operation('generate', model_id)
        for name, value in [('width', width), ('height', height)]:
            number(value, name, 64, 2048, True)
            if value % 8:
                raise AdapterError(name + ' must be a multiple of8')
        return self._submit(dict(options, mode='txt2img', width=width, height=height), {}, session, trace_id)

    def edit_image(self, source_path, mask_path=None, prompt='', operation='regenerate', target_color=None,
                   source_color=None, color_tolerance=35, feather=4, model_id='sdxl-base', seed=1, steps=25,
                   cfg=6., denoise=.55, sampler='dpmpp_2m', scheduler='karras', roi=False, halo=32,
                   cache=False, preview=False, session=None, negative='', trace_id=None):
        if operation == 'recompose':
            allowed = self._allowed_models('recompose', ('sdxl-base',ANIMAGINE_MODEL))
            self._require_operation('recompose', model_id)
            if mask_path is not None or target_color is not None or source_color is not None:
                raise AdapterError('recompose uses a source only, never a mask or recolor')
            options = self._options(prompt, negative, model_id, seed, steps, cfg, sampler, scheduler, cache, preview,
                allowed_models=allowed)
            number(denoise, 'denoise', .01, .99)
            resolved = scoped(source_path, self.input_roots)
            raw = read_file(resolved, MAX_INPUT); decoded = image(raw, 'source')
            if any(size < 64 or size > 2048 or size % 8 for size in decoded.size):
                raise AdapterError('img2img source dimensions must be 64..2048 and multiples of 8')
            inputs = {'source': {'path':str(resolved), 'sha256':digest(raw), 'dimensions':list(decoded.size), 'raw':raw}}
            return self._submit(dict(options, mode='img2img', denoise=denoise, width=decoded.width, height=decoded.height,
                source=base64.b64encode(raw).decode('ascii')), inputs, session, trace_id)
        choice(operation, 'operation', ('regenerate', 'recolor'))
        if model_id == ANIMAGINE_MODEL:
            raise AdapterError('animagine-xl-4.0-opt is generation-only and requires mode=txt2img')
        number(feather, 'feather', 0, 64, True)
        if model_id == DEDICATED_INPAINT_MODEL and operation != 'regenerate':
            raise AdapterError('sdxl-inpaint-v01 requires operation=regenerate')
        if operation == 'recolor':
            self._require_operation('recolor')
            if not isinstance(target_color, str) or not HEX.fullmatch(target_color):
                raise AdapterError('target_color must be #RRGGBB')
            if source_color is not None and (not isinstance(source_color, str) or not HEX.fullmatch(source_color)):
                raise AdapterError('source_color must be #RRGGBB or null')
            number(color_tolerance, 'color_tolerance', 0, 90)
            if type(preview) is not bool:
                raise AdapterError('preview must be boolean')
            options = dict(target_color=target_color.upper(), source_color=source_color.upper() if source_color else None,
                color_tolerance=color_tolerance, cache=False, preview=preview)
        else:
            allowed = self._allowed_models('regenerate', ('sdxl-base','sd-turbo',DEDICATED_INPAINT_MODEL))
            self._require_operation('regenerate',model_id)
            options = self._options(prompt, '', model_id, seed, steps, cfg, sampler, scheduler, cache, preview,
                allowed_models=allowed)
            if model_id == DEDICATED_INPAINT_MODEL and cache:
                raise AdapterError('sdxl-inpaint-v01 requires cache=False')
            number(denoise, 'denoise', .01, 1); number(halo, 'halo', 0, 512, True)
            if type(roi) is not bool:
                raise AdapterError('roi must be boolean')
            options.update(denoise=denoise, roi=roi, halo=halo)
        inputs = {}
        for name, path in [('source', source_path), ('mask', mask_path)]:
            resolved = scoped(path, self.input_roots)
            raw = read_file(resolved, MAX_INPUT); decoded = image(raw, name)
            inputs[name] = {'path': str(resolved), 'sha256': digest(raw), 'dimensions': list(decoded.size), 'raw': raw}
        if inputs['source']['dimensions'] != inputs['mask']['dimensions']:
            raise AdapterError('Source and mask dimensions must match')
        return self._submit(dict(options, mode='inpaint', edit_operation=operation, feather=feather,
            **{name: base64.b64encode(v['raw']).decode('ascii') for name, v in inputs.items()}), inputs, session, trace_id)

    def _submit(self, options, inputs, session, trace_id=None):
        if trace_id is not None and (not isinstance(trace_id,str) or re.fullmatch('[A-Za-z0-9_-]{1,128}',trace_id) is None):
            raise AdapterError('Invalid private trace identity')
        options = dict(options, trace_id=trace_id or uuid.uuid4().hex)
        session = 'mcp-' + (uuid.uuid4().hex if session is None else text(session, 'session', 90))
        if session == 'mcp-':
            raise AdapterError('session must be nonempty')
        body = {'session': session, 'request': options}; raw = encoded_json(body)
        if len(raw) > MAX_BODY:
            raise AdapterError('Request exceeds 32MiB')
        directory = self.state / 'submissions' / uuid.uuid4().hex
        directory.mkdir(parents=True, exist_ok=False)
        request_path = directory / 'request.json'; request_path.write_bytes(raw)
        frozen = {}
        for name, info in inputs.items():
            snapshot = directory / (name + '.png'); snapshot.write_bytes(info['raw'])
            frozen[name] = {k: v for k, v in info.items() if k != 'raw'}
            frozen[name]['snapshot_path'] = str(snapshot)
        model = None
        models = {}
        for config_path in [self.root / 'runtime/macos/config.json', self.runtime / 'config.json']:
            if config_path.is_file():
                config = json_object(read_file(scoped(config_path, [self.runtime]), 1024 * 1024))
                models = config.get('models', {})
                if not isinstance(models, dict):
                    raise AdapterError('Invalid model component configuration')
                model = models.get(options.get('model_id'))
                break
        components = None
        if options.get('model_id') == DEDICATED_INPAINT_MODEL:
            if not isinstance(model, dict) or model.get('conditioning_model_id') != 'sdxl-base':
                raise AdapterError('Invalid dedicated conditioning component: expected sdxl-base')
            components = dict(primary=model_component(DEDICATED_INPAINT_MODEL, model),
                conditioning=model_component('sdxl-base', models.get('sdxl-base')))
        record = dict(api_url=self.api_url, session=session, request_path=str(request_path),
            request_sha256=digest(raw), inputs=frozen, configured_model_at_submission=model,
            model_evidence_scope='configuration manifest only; no new weight attestation')
        if components is not None:
            record['model_components_at_submission'] = components
            record['model_evidence_scope'] = 'primary and conditioning configuration manifests only; no new weight attestation'
        (directory / 'submission.json').write_bytes(encoded_json(record))
        job = self._http('/api/jobs', body)
        self._job_shape(job)
        if job.get('session') != session:
            raise AdapterError('Pankeki returned a different session; request may have been submitted')
        record.update(job_id=job['job_id'], revision=job['revision'])
        ledger = self.state / 'jobs'; ledger.mkdir(parents=True, exist_ok=True)
        with (ledger / (job['job_id'] + '.json')).open('xb') as output:
            output.write(encoded_json(record))
        self._remember_execution(job, record)
        return public_metadata(dict(job, provenance={'request_path': str(request_path), 'request_sha256': digest(raw), 'inputs': frozen}))

    def _job_shape(self, job, expected=None):
        if (not isinstance(job.get('job_id'), str) or not JOB_ID.fullmatch(job['job_id'])
                or job.get('state') not in STATES or type(job.get('revision')) is not int
                or (expected is not None and job['job_id'] != expected)):
            raise AdapterError('Malformed or mismatched Pankeki job response')

    def _record(self, job_id):
        if not isinstance(job_id, str) or not JOB_ID.fullmatch(job_id):
            raise AdapterError('job_id must be exactly32 lowercase hex characters')
        path = scoped(self.state / 'jobs' / (job_id + '.json'), [self.state])
        record = json_object(read_file(path, 2 * 1024 * 1024))
        if record.get('job_id') != job_id or record.get('api_url') != self.api_url:
            raise AdapterError('Job is not owned by this adapter/API origin')
        return record

    def get_job(self, job_id):
        record = self._record(job_id)
        job = self._http('/api/jobs/' + job_id); self._job_shape(job, job_id)
        if job.get('session') != record['session'] or job['revision'] != record['revision']:
            raise AdapterError('Job session/revision does not match submission')
        self._remember_execution(job, record)
        return public_metadata(job)

    def cancel_job(self, job_id):
        self.get_job(job_id)  # Ownership and identity verified before mutation.
        result = self._http('/api/jobs/' + job_id + '/cancel', {})
        self._job_shape(result, job_id)
        return public_metadata(result)

    def get_result(self, job_id):
        record = self._record(job_id); job = self.get_job(job_id)
        if job['state'] != 'succeeded':
            raise AdapterError(f'Result unavailable: job is {job["state"]}; {job.get("error") or "no successful final artifact"}')
        run = scoped(self.runtime / 'runs' / job_id, [self.runtime])
        def artifact(name):
            return scoped(run / name, [run])
        png_path = artifact('result.png'); raw = read_file(png_path)
        if self._http('/api/results/' + job_id, binary=True) != raw:
            raise AdapterError('HTTP result and local artifact bytes/hash do not match')
        decoded = image(raw, 'result')
        recipe_path, metrics_path = artifact('recipe.json'), artifact('metrics.json')
        recipe, metrics = json_object(read_file(recipe_path)), json_object(read_file(metrics_path))
        for info in (recipe, metrics):
            if info.get('job_id') != job_id or info.get('revision') != record['revision']:
                raise AdapterError('Artifact job/revision mismatch')
        if metrics.get('status') != 'succeeded' or metrics.get('image_sha256') != digest(raw):
            raise AdapterError('Artifact status/content hash mismatch')
        if job.get('result', {}).get('metrics', {}).get('image_sha256') != digest(raw):
            raise AdapterError('Job result content hash mismatch')
        submitted_path = scoped(record['request_path'], [self.state]); submitted_raw = read_file(submitted_path, MAX_BODY)
        if digest(submitted_raw) != record['request_sha256']:
            raise AdapterError('Submitted request hash mismatch')
        submitted = json_object(submitted_raw)
        request = submitted['request']
        if submitted['session'] != record['session']:
            raise AdapterError('Submitted session mismatch')
        for key, value in request.items():
            if key not in ('source', 'mask', 'cache', 'preview') and recipe.get(key) != value:
                raise AdapterError('Actual recipe differs from submitted request: ' + key)
        if 'model_id' in request:
            if metrics.get('model_id') != request['model_id']:
                raise AdapterError('Actual model metrics differ from submitted model_id')
            configured = record.get('configured_model_at_submission')
            if configured and metrics.get('model_name') != configured.get('model_name'):
                raise AdapterError('Actual model_name differs from submission configuration')
        components = None
        if request.get('model_id') == DEDICATED_INPAINT_MODEL:
            if request.get('mode') != 'inpaint' or request.get('edit_operation') != 'regenerate':
                raise AdapterError('Dedicated model requires an inpaint regenerate request')
            if request.get('cache') is not False:
                raise AdapterError('Dedicated model request requires cache=False')
            components = record.get('model_components_at_submission')
            if not isinstance(components, dict) or set(components) != {'primary', 'conditioning'}:
                raise AdapterError('Missing frozen model components at submission')
            for role, expected_id in (('primary', DEDICATED_INPAINT_MODEL), ('conditioning', 'sdxl-base')):
                if not isinstance(components[role], dict) or components[role].get('model_id') != expected_id:
                    raise AdapterError('Invalid frozen model component identity: ' + role)
            for label, info in (('recipe', recipe), ('metrics', metrics)):
                if info.get('model_components') != components:
                    raise AdapterError('Actual ' + label + ' model components differ from submission configuration')
            empty_copy = (metrics.get('cache') == 'empty-mask-skip' and metrics.get('kind') == 'pixel_copy'
                and metrics.get('model_calls') == 0)
            if metrics.get('cache') != 'off' and not empty_copy:
                raise AdapterError('Dedicated model result violates cache=False contract')
            if empty_copy:
                if (metrics.get('component_verification') != 'not_run'
                        or ('denoiser_executed' in metrics and metrics['denoiser_executed'] is not False)
                        or (run / 'workflow.json').exists()):
                    raise AdapterError('Empty-copy component verification must remain not_run without a workflow')
            elif metrics.get('component_verification') != 'configured_files_sha256':
                raise AdapterError('Dedicated model result lacks app-reported component verification')
        if request.get('edit_operation') == 'recolor' and (
                metrics.get('kind') != 'local_recolor' or metrics.get('model_calls') != 0 or metrics.get('cache') != 'off'):
            raise AdapterError('Local recolor execution metrics do not match CPU/cache contract')
        provenance = dict(record, recipe_path=str(recipe_path), metrics_path=str(metrics_path),
            adapter_source_sha256=recipe.get('adapter_source_sha256'),
            workflow_path=str(artifact('workflow.json')) if (run / 'workflow.json').exists() else None)
        preservation = None
        if request['mode'] == 'img2img':
            info = record['inputs']['source']
            frozen = read_file(scoped(info['snapshot_path'], [self.state]), MAX_INPUT)
            if digest(frozen) != info['sha256'] or base64.b64decode(request['source'], validate=True) != frozen:
                raise AdapterError('Submitted img2img source snapshot/hash mismatch')
            engine_raw = read_file(artifact('original.png'))
            if digest(engine_raw) != recipe.get('original_sha256'):
                raise AdapterError('Engine img2img source hash mismatch')
            before, engine_image = image(frozen, 'source'), image(engine_raw, 'original')
            if before.size != engine_image.size or before.convert('RGBA').tobytes() != engine_image.convert('RGBA').tobytes():
                raise AdapterError('Engine img2img source pixels differ from submission')
            workflow = json_object(read_file(artifact('workflow.json')))
            encoders = {key for key,node in workflow.items() if isinstance(node, dict) and node.get('class_type') == 'VAEEncode'
                and isinstance(node.get('inputs'), dict) and node['inputs'].get('pixels') == ['4', 0]}
            loader = workflow.get('4', {})
            if not isinstance(loader, dict) or loader.get('class_type') != 'LoadImage' or loader.get('inputs', {}).get('image') != digest(engine_raw) + '.png':
                raise AdapterError('img2img workflow does not load the verified source')
            samplers = [node for node in workflow.values() if isinstance(node, dict) and node.get('class_type') == 'KSampler']
            if (not encoders or not samplers or any(node['inputs'].get('latent_image', [None])[0] not in encoders
                    or node['inputs'].get('denoise') != request['denoise'] or not 0 < node['inputs'].get('denoise', 1) < 1 for node in samplers)
                    or any(not isinstance(node, dict) or node.get('class_type') in ('EmptyLatentImage','SetLatentNoiseMask','InpaintModelConditioning') for node in workflow.values())):
                raise AdapterError('img2img result lacks source-conditioned VAEEncode sampling')
        if request['mode'] == 'inpaint':
            original = mask = None
            for name, engine_name in [('source', 'original'), ('mask', 'mask')]:
                info = record['inputs'][name]
                snapshot = scoped(info['snapshot_path'], [self.state]); frozen = read_file(snapshot, MAX_INPUT)
                if digest(frozen) != info['sha256'] or base64.b64decode(request[name], validate=True) != frozen:
                    raise AdapterError('Submitted input snapshot/hash mismatch: ' + name)
                engine_path = artifact(engine_name + '.png'); engine_raw = read_file(engine_path)
                if digest(engine_raw) != recipe.get(engine_name + '_sha256'):
                    raise AdapterError('Engine input hash mismatch: ' + name)
                before, engine_image = image(frozen, name), image(engine_raw, engine_name)
                mode = 'RGBA' if name == 'source' else 'L'
                if before.size != engine_image.size or before.convert(mode).tobytes() != engine_image.convert(mode).tobytes():
                    raise AdapterError('Engine input pixels differ from submission: ' + name)
                if name == 'source': original = engine_image.convert('RGBA')
                else: mask = engine_image.convert('L')
                provenance['inputs'][name] = dict(info, engine_path=str(engine_path), engine_sha256=digest(engine_raw))
            if components is not None and empty_copy and mask.getbbox() is not None:
                raise AdapterError('Empty-copy result requires an empty submitted mask')
            if decoded.size != original.size:
                raise AdapterError('Result dimensions differ from original')
            difference = ImageChops.difference(original.convert('RGB'), decoded.convert('RGB'))
            outside = mask.point(lambda a: 255 if a == 0 else 0)
            outside_difference = Image.composite(difference, Image.new('RGB', difference.size), outside)
            rgb_error = max(high for _, high in outside_difference.getextrema())
            alpha_error = ImageChops.difference(original.getchannel('A'), decoded.convert('RGBA').getchannel('A')).getextrema()[1]
            preservation = dict(outside_mask_max_error=rgb_error, alpha_max_error=alpha_error)
            if rgb_error or alpha_error:
                raise AdapterError('Result pixel preservation failed')
        elif decoded.size != (request['width'], request['height']):
            raise AdapterError('Generated result dimensions differ from request')
        actual_request = {key: value for key, value in recipe.items() if key in request and key not in ('source', 'mask')}
        result = dict(job_id=job_id, state='succeeded', image_path=str(png_path), mime_type='image/png',
            sha256=digest(raw), dimensions=list(decoded.size), request=actual_request, metrics=metrics,
            engine_recipe=recipe, provenance=provenance, preservation=preservation)
        if components is not None:
            result['model_components'] = components
            result['component_verification'] = metrics['component_verification']
        return public_metadata(result)


def create_server(adapter):
    # SDK is owned/installed by the Mac runtime owner. Core tests need no SDK.
    from mcp.server import MCPServer
    from mcp.server.mcpserver.exceptions import ToolError
    from pydantic import StrictBool, StrictFloat, StrictInt, StrictStr
    server = MCPServer('Pankeki Local')
    choices = adapter.schema_options()
    GenerateModel = Literal.__getitem__(tuple(choices['generate_models']))
    EditModel = Literal.__getitem__(tuple(choices['edit_models']))
    EditOperation = Literal.__getitem__(tuple(choices['edit_operations']))

    def invoke(method, *args):
        try:
            return method(*args)
        except AdapterError as exc:
            # Preserve anticipated input/state/transport failures for the client.
            # Other exceptions retain the SDK's default internal-error masking.
            raise ToolError(str(exc)) from exc

    @server.tool()
    def pankeki_get_status() -> dict[str, Any]:
        """Read Pankeki model availability and Comfy health; CPU recolor is independent of Comfy."""
        return invoke(adapter.get_status)

    @server.tool()
    def pankeki_generate_image(prompt: StrictStr, negative: StrictStr = '', model_id: GenerateModel = 'sdxl-base',
            seed: StrictInt = 1, width: StrictInt = 1024, height: StrictInt = 1024, steps: StrictInt = 25,
            cfg: StrictFloat = 6., sampler: Literal['euler', 'euler_ancestral', 'dpmpp_2m'] = 'dpmpp_2m',
            scheduler: Literal['normal', 'simple', 'karras'] = 'karras', cache: StrictBool = False,
            preview: StrictBool = False, session: StrictStr | None = None, trace_id: StrictStr | None = None) -> dict[str, Any]:
        """Submit a real Pankeki txt2img job asynchronously. Poll get_job, then get_result. No external fallback."""
        return invoke(adapter.generate_image, prompt, negative, model_id, seed, width, height, steps, cfg, sampler, scheduler, cache, preview, session, trace_id)

    @server.tool()
    def pankeki_edit_image(source_path: StrictStr, mask_path: StrictStr | None = None, prompt: StrictStr = '',
            operation: EditOperation = 'regenerate', target_color: StrictStr | None = None,
            source_color: StrictStr | None = None, color_tolerance: StrictFloat = 35., feather: StrictInt = 4,
            model_id: EditModel = 'sdxl-base', seed: StrictInt = 1, steps: StrictInt = 25,
            cfg: StrictFloat = 6., denoise: StrictFloat = .55, sampler: Literal['euler', 'euler_ancestral', 'dpmpp_2m'] = 'dpmpp_2m',
            scheduler: Literal['normal', 'simple', 'karras'] = 'karras', roi: StrictBool = False, halo: StrictInt = 32,
            cache: StrictBool = False, preview: StrictBool = False, session: StrictStr | None = None, negative: StrictStr = '', trace_id: StrictStr | None = None) -> dict[str, Any]:
        """Submit a source-only img2img recompose, or a masked edit or CPU recolor. sdxl-inpaint-v01 is regenerate-only with cache=false and two model identities."""
        return invoke(adapter.edit_image, source_path, mask_path, prompt, operation, target_color, source_color, color_tolerance,
            feather, model_id, seed, steps, cfg, denoise, sampler, scheduler, roi, halo, cache, preview, session, negative, trace_id)

    @server.tool()
    def pankeki_get_job(job_id: StrictStr) -> dict[str, Any]:
        """Read an adapter-owned job's actual state; failed/canceled/uncertain never mean succeeded."""
        return invoke(adapter.get_job, job_id)

    @server.tool()
    def pankeki_get_result(job_id: StrictStr) -> dict[str, Any]:
        """Return only a verified succeeded PNG path/hash with exact request, model/seed and input provenance."""
        return invoke(adapter.get_result, job_id)

    @server.tool()
    def pankeki_cancel_job(job_id: StrictStr) -> dict[str, Any]:
        """Logically cancel this adapter's job. GPU work may continue; cancellation is not GPU-stop confirmation."""
        return invoke(adapter.cancel_job, job_id)

    return server


def main():
    parser = argparse.ArgumentParser(description='Pankeki HTTP adapter over official MCP stdio')
    parser.add_argument('--app-root', required=True, type=Path)
    parser.add_argument('--api-url', default='http://127.0.0.1:8190')
    parser.add_argument('--state-dir', type=Path)
    parser.add_argument('--input-root', type=Path, action='append')
    parser.add_argument('--timeout', type=float, default=10)
    args = parser.parse_args()
    logging.basicConfig(stream=sys.stderr, level=logging.WARNING)
    try:
        adapter = Adapter(args.app_root, args.api_url, args.state_dir, args.input_root, args.timeout)
        server = create_server(adapter)
    except (ImportError, AdapterError) as exc:
        print('Pankeki MCP startup failed: ' + str(exc), file=sys.stderr)
        return 2
    server.run(transport='stdio')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

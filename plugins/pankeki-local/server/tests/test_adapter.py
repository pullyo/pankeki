"""Actual temporary HTTP fixtures; never Comfy, GPU, or the running app."""
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import io
import json
import os
import queue
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest

from PIL import Image

SCRIPT = Path(__file__).resolve().parents[1] / 'pankeki_mcp.py'
api = None
if SCRIPT.exists():
    spec = importlib.util.spec_from_file_location('pankeki_mcp', SCRIPT)
    api = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = api
    spec.loader.exec_module(api)


def png(image):
    out = io.BytesIO(); image.save(out, format='PNG'); return out.getvalue()


class FakeHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, status, value):
        raw = value if isinstance(value, bytes) else json.dumps(value).encode()
        self.send_response(status); self.send_header('Content-Length', str(len(raw)))
        self.end_headers(); self.wfile.write(raw)

    def do_GET(self):
        state = self.server.fixture
        state['gets'].append(self.path)
        if state.get('disconnect_get'):
            self.close_connection = True
            return
        if self.path in state['errors']:
            return self.reply(503, {'error': 'fixture offline'})
        if self.path == '/api/models':
            return self.reply(200, state.get('models', {'default_model_id': 'sdxl-base', 'models': []}))
        if self.path == '/api/health':
            return self.reply(200, {'comfy': False, 'error': 'fixture Comfy deliberately absent'})
        job_id = self.path.split('/')[-1]
        if job_id not in state['jobs']:
            return self.reply(404, {'error': 'Unknown job'})
        if self.path.startswith('/api/results/'):
            return self.reply(200, (state['root'] / 'runtime/runs' / job_id / 'result.png').read_bytes())
        return self.reply(200, state['jobs'][job_id])

    def do_POST(self):
        state = self.server.fixture
        raw = self.rfile.read(int(self.headers['Content-Length'])); body = json.loads(raw)
        with state['lock']:
            state['posts'].append((self.path, body))
            if self.path in state['errors']:
                return self.reply(503, {'error': 'fixture offline'})
            if self.path == '/api/jobs':
                job_id = f'{len(state["jobs"]) + 1:032x}'
                previous = [j for j in state['jobs'].values() if j['session'] == body['session']]
                revision = len(previous) + 1
                for item in previous:
                    if item['state'] == 'queued': item['state'] = 'canceled'
                job = dict(job_id=job_id, session=body['session'], revision=revision,
                    state='queued', is_current=True, result=None, error=None, prompt_id=None)
                state['jobs'][job_id] = job; state['requests'][job_id] = body['request']
                if state['disconnect']:
                    self.close_connection = True
                    return
                return self.reply(202, job)
            job_id = self.path.split('/')[-2]
            job = state['jobs'][job_id]; job['state'] = 'canceling'
            job['cancel_semantics'] = 'local discard only; GPU work may continue'
            return self.reply(200, job)


class AdapterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), FakeHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True); cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.thread.join(); cls.server.server_close()

    def setUp(self):
        self.assertIsNotNone(api, 'Pankeki HTTP adapter is not implemented')
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'app'; self.inputs = self.root / 'output'; self.inputs.mkdir(parents=True)
        self.state = self.root / 'runtime/mcp-state'
        config = self.root / 'runtime/macos/config.json'; config.parent.mkdir(parents=True)
        config.write_text(json.dumps({'models': {'sdxl-base': {'model_name': 'sd_xl_base_1.0.safetensors',
            'manifest': {'model_sha256': 'a' * 64}}}}))
        self.source = self.inputs / 'original image.png'; self.mask = self.inputs / 'mask.png'
        self.source.write_bytes(png(Image.new('RGBA', (64, 64), (0, 0, 255, 123))))
        mask = Image.new('L', (64, 64)); mask.paste(255, (8, 8, 48, 48)); self.mask.write_bytes(png(mask))
        self.server.fixture = {'root': self.root, 'jobs': {}, 'requests': {}, 'posts': [],
            'gets': [], 'errors': set(), 'disconnect': False, 'lock': threading.Lock()}
        self.url = 'http://127.0.0.1:' + str(self.server.server_port)
        self.adapter = api.Adapter(self.root, self.url, self.state, [self.inputs], timeout=2)

    def submit_edit(self, **options):
        return self.adapter.edit_image(str(self.source), str(self.mask), **options)

    def test_source_only_recompose_posts_real_reference_with_no_mask_and_freezes_source(self):
        before = self.source.read_bytes()
        submitted = self.adapter.edit_image(str(self.source), None, operation='recompose',
            prompt='front view', model_id='sdxl-base', denoise=.55, negative='keep negative')
        request = self.server.fixture['requests'][submitted['job_id']]
        self.assertEqual(request['mode'], 'img2img')
        self.assertEqual(request['denoise'], .55)
        self.assertNotIn('mask', request)
        self.assertNotIn('edit_operation', request)
        self.assertEqual(base64.b64decode(request['source']), before)
        self.assertEqual(self.source.read_bytes(), before)
        self.assertEqual(request['negative'], 'keep negative')
        self.complete(submitted)
        result = self.adapter.get_result(submitted['job_id'])
        self.assertEqual(result['request']['mode'], 'img2img')
        self.assertIsNone(result['preservation'])
        self.source.write_bytes(png(Image.new('RGBA', (64,64), 'green')))
        self.assertEqual(self.adapter.get_result(submitted['job_id'])['request']['mode'], 'img2img')
        workflow_path = self.root / 'runtime/runs' / submitted['job_id'] / 'workflow.json'
        workflow = json.loads(workflow_path.read_text()); workflow['4']['inputs']['image'] = 'unrelated.png'
        workflow_path.write_text(json.dumps(workflow))
        with self.assertRaisesRegex(api.AdapterError, 'verified source'):
            self.adapter.get_result(submitted['job_id'])
        for options in ({'denoise':1}, {'mask_path':str(self.mask)}, {'model_id':'sdxl-inpaint-v01'}):
            count = len(self.server.fixture['posts'])
            with self.assertRaises(api.AdapterError):
                self.adapter.edit_image(str(self.source), operation='recompose', **options)
            self.assertEqual(len(self.server.fixture['posts']), count)

    def test_animagine_generation_keeps_explicit_values_and_rejects_all_edits_before_post(self):
        config_path = self.root / 'runtime/macos/config.json'
        config = json.loads(config_path.read_text()); config['models']['animagine-xl-4.0-opt'] = {
            'model_name':'animagine-xl-4.0-opt.safetensors', 'manifest':{'model_sha256':'c' * 64}}
        config_path.write_text(json.dumps(config))
        submitted = self.adapter.generate_image('1girl, red scarf', negative='custom negative', model_id='animagine-xl-4.0-opt',
            width=64, height=64, seed=42, steps=19, cfg=7., sampler='dpmpp_2m', scheduler='karras')
        request = self.server.fixture['requests'][submitted['job_id']]
        self.assertEqual(request['model_id'], 'animagine-xl-4.0-opt'); self.assertEqual(request['steps'], 19)
        self.assertEqual(request['negative'], 'custom negative'); self.assertEqual(request['sampler'], 'dpmpp_2m')
        self.complete(submitted)
        result = self.adapter.get_result(submitted['job_id'])
        self.assertEqual(result['request']['model_id'], 'animagine-xl-4.0-opt')
        self.assertEqual(result['request']['negative'], 'custom negative')
        for operation in ['regenerate', 'recolor']:
            before = len(self.server.fixture['posts'])
            with self.assertRaisesRegex(api.AdapterError, 'generation|txt2img'):
                self.adapter.edit_image('/missing/source.png', '/missing/mask.png', model_id='animagine-xl-4.0-opt', operation=operation, target_color='#FF0000')
            self.assertEqual(len(self.server.fixture['posts']), before)

    def complete(self, submitted):
        job_id = submitted['job_id']; state = self.server.fixture; request = state['requests'][job_id]
        directory = self.root / 'runtime/runs' / job_id; directory.mkdir(parents=True)
        recipe = {k: v for k, v in request.items() if k not in ('source', 'mask', 'cache', 'preview')}
        if request['mode'] == 'inpaint':
            original = Image.open(io.BytesIO(base64.b64decode(request['source']))).copy()
            mask = Image.open(io.BytesIO(base64.b64decode(request['mask']))).convert('L')
            (directory / 'original.png').write_bytes(png(original)); (directory / 'mask.png').write_bytes(png(mask))
            recipe.update(original_sha256=hashlib.sha256(png(original)).hexdigest(), mask_sha256=hashlib.sha256(png(mask)).hexdigest())
            result = original.copy()
            if mask.getbbox() is not None:
                result.paste((255, 0, 0, 123), (8, 8, 48, 48))
        else:
            if request['mode'] == 'img2img':
                original = Image.open(io.BytesIO(base64.b64decode(request['source']))).convert('RGBA')
                (directory / 'original.png').write_bytes(png(original))
                recipe['original_sha256'] = hashlib.sha256(png(original)).hexdigest()
                (directory / 'workflow.json').write_text(json.dumps({'4':{'class_type':'LoadImage','inputs':{'image':recipe['original_sha256']+'.png'}},'8':{'class_type':'VAEEncode','inputs':{'pixels':['4',0]}},'5':{'class_type':'KSampler','inputs':{'latent_image':['8',0],'denoise':request['denoise']}}}))
            result = Image.new('RGB', (request['width'], request['height']), 'red')
        raw = png(result); (directory / 'result.png').write_bytes(raw)
        recipe.update(job_id=job_id, revision=submitted['revision'], adapter_source_sha256='b' * 64)
        metrics = dict(job_id=job_id, revision=submitted['revision'], status='succeeded',
            image_sha256=hashlib.sha256(raw).hexdigest(), kind='real_comfyui', model_calls=1,
            model_id=request.get('model_id'), model_name='sd_xl_base_1.0.safetensors', cache='off', denoiser_executed=True)
        if request.get('model_id') == 'animagine-xl-4.0-opt':
            metrics['model_name'] = 'animagine-xl-4.0-opt.safetensors'
        if request.get('model_id') == 'sdxl-inpaint-v01':
            # Literal app-contract fixture, independent of the adapter's builder.
            components = {
                'primary': {'model_id': 'sdxl-inpaint-v01', 'model_name': 'dedicated-unet.safetensors', 'model_sha256': 'c' * 64},
                'conditioning': {'model_id': 'sdxl-base', 'model_name': 'sd_xl_base_1.0.safetensors', 'model_sha256': 'a' * 64}}
            recipe['model_components'] = components
            metrics.update(model_name='dedicated-unet.safetensors', model_components=components,
                component_verification='configured_files_sha256')
        (directory / 'recipe.json').write_text(json.dumps(recipe)); (directory / 'metrics.json').write_text(json.dumps(metrics))
        if request['mode'] != 'img2img':
            (directory / 'workflow.json').write_text(json.dumps({'fixture': 'not a GPU result'}))
        state['jobs'][job_id].update(state='succeeded', result={'image_url': '/api/results/' + job_id,
            'image_path': str(directory / 'result.png'), 'metrics': metrics})
        return directory

    def configure_inpaint(self):
        path = self.root / 'runtime/macos/config.json'
        config = json.loads(path.read_text())
        config['models']['sdxl-inpaint-v01'] = {
            'model_name': 'dedicated-unet.safetensors',
            'manifest': {'model_sha256': 'c' * 64}, 'conditioning_model_id': 'sdxl-base'}
        path.write_text(json.dumps(config))
        return path

    def submit_dedicated(self, **options):
        try:
            return self.submit_edit(model_id='sdxl-inpaint-v01', **options)
        except api.AdapterError as exc:
            self.fail('Dedicated regenerate request was rejected: ' + str(exc))

    def test_dedicated_edit_freezes_both_components_and_returns_verified_provenance(self):
        config_path = self.configure_inpaint()
        job = self.submit_dedicated(prompt='subtle natural knees', seed=20261024)
        posted = self.server.fixture['requests'][job['job_id']]
        self.assertEqual(posted['model_id'], 'sdxl-inpaint-v01')
        self.assertFalse(posted['cache'])
        self.complete(job)
        # A later config edit must not rewrite this job's provenance.
        config = json.loads(config_path.read_text())
        config['models']['sdxl-base']['manifest']['model_sha256'] = 'd' * 64
        config['models']['sdxl-inpaint-v01']['model_name'] = 'later-unet.safetensors'
        config_path.write_text(json.dumps(config))
        result = self.adapter.get_result(job['job_id'])
        expected = {
            'primary': {'model_id': 'sdxl-inpaint-v01', 'model_name': 'dedicated-unet.safetensors', 'model_sha256': 'c' * 64},
            'conditioning': {'model_id': 'sdxl-base', 'model_name': 'sd_xl_base_1.0.safetensors', 'model_sha256': 'a' * 64}}
        self.assertEqual(result['model_components'], expected)
        self.assertEqual(result['provenance']['model_components_at_submission'], expected)
        self.assertEqual(result.get('component_verification'), 'configured_files_sha256')
        self.assertEqual(result['preservation'], {'outside_mask_max_error': 0, 'alpha_max_error': 0})

    def test_dedicated_generate_is_rejected_before_post(self):
        self.configure_inpaint()
        with self.assertRaises(api.AdapterError):
            self.adapter.generate_image('human', model_id='sdxl-inpaint-v01')
        self.assertFalse(self.server.fixture['posts'])

    def test_dedicated_recolor_is_rejected_without_changing_cpu_policy(self):
        self.configure_inpaint()
        with self.assertRaisesRegex(api.AdapterError, 'regenerate'):
            self.submit_edit(operation='recolor', target_color='#FEE7DE', model_id='sdxl-inpaint-v01')
        self.assertFalse(self.server.fixture['posts'])
        job = self.submit_edit(operation='recolor', target_color='#FEE7DE', cache=True)
        request = self.server.fixture['requests'][job['job_id']]
        self.assertNotIn('model_id', request)
        self.assertFalse(request['cache'])

    def test_dedicated_cache_true_is_rejected_before_post(self):
        self.configure_inpaint()
        with self.assertRaisesRegex(api.AdapterError, 'cache'):
            self.submit_edit(model_id='sdxl-inpaint-v01', cache=True)
        self.assertFalse(self.server.fixture['posts'])

    def test_dedicated_missing_or_invalid_component_config_is_rejected_before_post(self):
        config_path = self.configure_inpaint()
        valid = json.loads(config_path.read_text())
        for role, field, value in (
                ('sdxl-inpaint-v01', 'conditioning_model_id', 'sd-turbo'),
                ('sdxl-inpaint-v01', 'model_name', ''),
                ('sdxl-inpaint-v01', 'manifest', {'model_sha256': 'invalid'}),
                ('sdxl-base', 'model_name', ''),
                ('sdxl-base', 'manifest', {})):
            config = json.loads(json.dumps(valid)); config['models'][role][field] = value
            config_path.write_text(json.dumps(config))
            with self.subTest(role=role, field=field), self.assertRaisesRegex(api.AdapterError, 'component|conditioning'):
                self.submit_edit(model_id='sdxl-inpaint-v01')
        config_path.write_text(json.dumps({'models': {}}))
        with self.assertRaisesRegex(api.AdapterError, 'component|conditioning'):
            self.submit_edit(model_id='sdxl-inpaint-v01')
        self.assertFalse(self.server.fixture['posts'])

    def test_dedicated_rejects_either_artifact_component_id_name_or_hash_mismatch(self):
        self.configure_inpaint()
        for filename in ('recipe.json', 'metrics.json'):
            for role in ('primary', 'conditioning'):
                for field, wrong in (('model_id', 'sd-turbo'), ('model_name', 'wrong.safetensors'), ('model_sha256', 'd' * 64)):
                    job = self.submit_dedicated(); directory = self.complete(job)
                    path = directory / filename; info = json.loads(path.read_text())
                    info['model_components'][role][field] = wrong; path.write_text(json.dumps(info))
                    with self.subTest(file=filename, role=role, field=field), self.assertRaisesRegex(api.AdapterError, 'component'):
                        self.adapter.get_result(job['job_id'])

    def test_dedicated_missing_components_or_submission_snapshot_is_rejected(self):
        self.configure_inpaint()
        for filename in ('recipe.json', 'metrics.json'):
            job = self.submit_dedicated(); directory = self.complete(job)
            path = directory / filename; info = json.loads(path.read_text()); info.pop('model_components'); path.write_text(json.dumps(info))
            with self.subTest(file=filename), self.assertRaisesRegex(api.AdapterError, 'component'):
                self.adapter.get_result(job['job_id'])
        job = self.submit_dedicated(); self.complete(job)
        path = self.state / 'jobs' / (job['job_id'] + '.json'); info = json.loads(path.read_text()); info.pop('model_components_at_submission', None); path.write_text(json.dumps(info))
        with self.assertRaisesRegex(api.AdapterError, 'component'):
            self.adapter.get_result(job['job_id'])

    def test_dedicated_runtime_cache_hit_is_not_returned_as_verified_result(self):
        self.configure_inpaint(); job = self.submit_dedicated(); directory = self.complete(job)
        path = directory / 'metrics.json'; info = json.loads(path.read_text()); info['cache'] = 'hit'; path.write_text(json.dumps(info))
        with self.assertRaisesRegex(api.AdapterError, 'cache'):
            self.adapter.get_result(job['job_id'])

    def test_dedicated_empty_mask_copy_remains_distinct_from_cached_inference(self):
        self.configure_inpaint(); self.mask.write_bytes(png(Image.new('L', (64, 64))))
        job = self.submit_dedicated(); directory = self.complete(job)
        path = directory / 'metrics.json'; metrics = json.loads(path.read_text())
        metrics.update(cache='empty-mask-skip', kind='pixel_copy', model_calls=0, denoiser_executed=False,
            component_verification='not_run')
        metrics.pop('denoiser_executed')  # The app omits this field on its early-copy return.
        path.write_text(json.dumps(metrics)); self.server.fixture['jobs'][job['job_id']]['result']['metrics'] = metrics
        (directory / 'workflow.json').unlink()
        result = self.adapter.get_result(job['job_id'])
        self.assertEqual(result['metrics']['kind'], 'pixel_copy')
        self.assertNotIn('denoiser_executed', result['metrics'])
        self.assertEqual(result.get('component_verification'), 'not_run')
        self.assertIsNone(result['provenance']['workflow_path'])
        self.assertEqual(result['preservation'], {'outside_mask_max_error': 0, 'alpha_max_error': 0})

    def test_dedicated_model_result_requires_app_reported_component_file_verification(self):
        self.configure_inpaint(); job = self.submit_dedicated(); directory = self.complete(job)
        path = directory / 'metrics.json'; metrics = json.loads(path.read_text())
        metrics['component_verification'] = 'not_run'; path.write_text(json.dumps(metrics))
        with self.assertRaisesRegex(api.AdapterError, 'component verification'):
            self.adapter.get_result(job['job_id'])

    def test_dedicated_nonempty_frozen_mask_rejects_empty_copy_metrics(self):
        self.configure_inpaint(); job = self.submit_dedicated(); directory = self.complete(job)
        # All artifacts are consistent except the claimed empty-mask execution class.
        self.assertIsNotNone(Image.open(directory / 'mask.png').convert('L').getbbox())
        self.assertNotEqual((directory / 'original.png').read_bytes(), (directory / 'result.png').read_bytes())
        path = directory / 'metrics.json'; metrics = json.loads(path.read_text())
        metrics.update(cache='empty-mask-skip', kind='pixel_copy', model_calls=0,
            component_verification='not_run')
        metrics.pop('denoiser_executed')
        path.write_text(json.dumps(metrics)); self.server.fixture['jobs'][job['job_id']]['result']['metrics'] = metrics
        (directory / 'workflow.json').unlink()
        # A later edit of the user's path must not hide the nonempty frozen input.
        self.mask.write_bytes(png(Image.new('L', (64, 64))))
        with self.assertRaisesRegex(api.AdapterError, 'Empty-copy.*mask'):
            self.adapter.get_result(job['job_id'])

    def test_status_preserves_dedicated_availability_without_model_substitution(self):
        self.server.fixture['models'] = {'default_model_id': 'sdxl-base',
            'models': [{'id': 'sdxl-base', 'available': True}], 'edit_models': [
            {'id': 'sdxl-inpaint-v01', 'available': False, 'conditioning_model_id': 'sdxl-base'}]}
        status = self.adapter.get_status()['models']
        self.assertEqual(status['models'], [{'id': 'sdxl-base', 'available': True}])
        self.assertEqual(status['edit_models'], [
            {'id': 'sdxl-inpaint-v01', 'available': False, 'conditioning_model_id': 'sdxl-base'}])

    def test_generate_returns_async_job_and_records_actual_model_seed_request(self):
        job = self.adapter.generate_image('an adult anime character', seed=51, width=64, height=64)
        self.assertEqual(job['state'], 'queued'); self.assertTrue(job['session'].startswith('mcp-'))
        request = self.server.fixture['requests'][job['job_id']]
        self.assertEqual((request['mode'], request['model_id'], request['seed']), ('txt2img', 'sdxl-base', 51))
        self.assertFalse(request['cache']); self.assertNotIn('/api/results/' + job['job_id'], self.server.fixture['gets'])

    def test_concurrent_default_submissions_use_independent_sessions(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            jobs = list(pool.map(lambda n: self.adapter.generate_image('human', seed=n), range(4)))
        self.assertEqual(len({j['session'] for j in jobs}), 4)
        self.assertTrue(all(self.adapter.get_job(j['job_id'])['state'] == 'queued' for j in jobs))

    def test_explicit_same_session_is_scoped_and_keeps_revision_semantics(self):
        a = self.adapter.generate_image('a', session='browser-session')
        b = self.adapter.generate_image('b', session='browser-session')
        self.assertEqual(a['session'], 'mcp-browser-session')
        self.assertEqual(b['revision'], 2); self.assertEqual(self.adapter.get_job(a['job_id'])['state'], 'canceled')

    def test_mask_snapshot_preserves_original_files_and_exact_posted_input_bytes(self):
        before = self.source.read_bytes(), self.mask.read_bytes(); job = self.submit_edit(prompt='correct knee')
        request = self.server.fixture['requests'][job['job_id']]
        self.assertEqual(base64.b64decode(request['source']), before[0]); self.assertEqual(base64.b64decode(request['mask']), before[1])
        self.assertEqual((self.source.read_bytes(), self.mask.read_bytes()), before)

    def test_paths_outside_roots_and_symlink_escape_are_rejected_before_post(self):
        outside = Path(self.temp.name) / 'other.png'; outside.write_bytes(self.source.read_bytes())
        link = self.inputs / 'escape.png'; link.symlink_to(outside)
        for path in (str(outside), str(link), 'relative.png'):
            with self.subTest(path=path), self.assertRaises(api.AdapterError):
                self.adapter.edit_image(path, str(self.mask))
        self.assertFalse(self.server.fixture['posts'])

    def test_mask_dimension_mismatch_and_corrupt_png_are_rejected_before_post(self):
        self.mask.write_bytes(png(Image.new('L', (32, 32))))
        with self.assertRaisesRegex(api.AdapterError, 'dimensions'): self.submit_edit()
        self.mask.write_bytes(b'not png')
        with self.assertRaises(api.AdapterError): self.submit_edit()
        self.assertFalse(self.server.fixture['posts'])

    def test_color_branch_is_cpu_request_and_validates_target_and_tolerance(self):
        job = self.submit_edit(operation='recolor', target_color='#ff0000')
        request = self.server.fixture['requests'][job['job_id']]
        self.assertEqual(request['target_color'], '#FF0000'); self.assertIsNone(request['source_color'])
        self.assertNotIn('model_id', request); self.assertFalse(request['cache'])
        for changes in ({'target_color': None}, {'target_color': 'red'}, {'target_color': '#FF0000', 'color_tolerance': True}):
            with self.subTest(changes=changes), self.assertRaises(api.AdapterError):
                self.submit_edit(operation='recolor', **changes)

    def test_invalid_numbers_are_not_coerced_or_sent(self):
        for options in ({'seed': True}, {'cfg': float('nan')}, {'width': 65}, {'steps': 0}, {'cache': 1}):
            with self.subTest(options=options), self.assertRaises(api.AdapterError):
                self.adapter.generate_image('human', **options)
        self.assertFalse(self.server.fixture['posts'])

    def test_http_error_and_submission_disconnect_never_retry_or_fallback(self):
        self.server.fixture['errors'].add('/api/jobs')
        with self.assertRaisesRegex(api.AdapterError, '503'): self.adapter.generate_image('human')
        self.server.fixture['errors'].clear(); self.server.fixture['disconnect'] = True
        with self.assertRaisesRegex(api.AdapterError, 'may have been submitted'): self.adapter.generate_image('human')
        self.assertEqual(len(self.server.fixture['posts']), 2)

    def test_status_distinguishes_missing_comfy_from_app_failure(self):
        status = self.adapter.get_status(); self.assertTrue(status['app_reachable']); self.assertFalse(status['health']['comfy'])
        self.server.fixture['errors'].add('/api/models')
        with self.assertRaises(api.AdapterError): self.adapter.get_status()

    def test_unfinished_failed_canceled_and_uncertain_jobs_have_no_result_success(self):
        job = self.adapter.generate_image('human')
        for state in ('queued', 'running', 'canceling', 'canceled', 'failed', 'uncertain'):
            self.server.fixture['jobs'][job['job_id']]['state'] = state
            with self.subTest(state=state), self.assertRaisesRegex(api.AdapterError, state):
                self.adapter.get_result(job['job_id'])
        self.assertNotIn('/api/results/' + job['job_id'], self.server.fixture['gets'])

    def test_success_result_links_actual_request_model_seed_png_and_edit_provenance(self):
        job = self.submit_edit(prompt='correct only knee', seed=321); directory = self.complete(job)
        result = self.adapter.get_result(job['job_id'])
        self.assertEqual(result['image_path'], str((directory / 'result.png').resolve()))
        self.assertEqual(result['sha256'], hashlib.sha256((directory / 'result.png').read_bytes()).hexdigest())
        self.assertEqual(result['request']['seed'], 321)
        self.assertEqual(result['provenance']['inputs']['source']['sha256'], hashlib.sha256(self.source.read_bytes()).hexdigest())
        self.assertEqual(result['preservation'], {'outside_mask_max_error': 0, 'alpha_max_error': 0})

    def test_result_uses_frozen_submission_inputs_and_survives_adapter_restart(self):
        job = self.submit_edit(); self.complete(job)
        old_hash = hashlib.sha256(self.source.read_bytes()).hexdigest()
        self.source.write_bytes(png(Image.new('RGBA', (64, 64), 'white')))
        restarted = api.Adapter(self.root, self.url, self.state, [self.inputs], timeout=2)
        self.assertEqual(restarted.get_result(job['job_id'])['provenance']['inputs']['source']['sha256'], old_hash)

    def test_wrong_result_hash_or_seed_is_rejected(self):
        job = self.adapter.generate_image('human', width=64, height=64); directory = self.complete(job)
        path = directory / 'metrics.json'; metrics = json.loads(path.read_text()); metrics['image_sha256'] = '0' * 64; path.write_text(json.dumps(metrics))
        with self.assertRaisesRegex(api.AdapterError, 'hash'): self.adapter.get_result(job['job_id'])
        metrics['image_sha256'] = hashlib.sha256((directory / 'result.png').read_bytes()).hexdigest(); path.write_text(json.dumps(metrics))
        path = directory / 'recipe.json'; recipe = json.loads(path.read_text()); recipe['seed'] = 99; path.write_text(json.dumps(recipe))
        with self.assertRaisesRegex(api.AdapterError, 'seed'): self.adapter.get_result(job['job_id'])

    def test_valid_png_with_rehashed_outside_rgb_or_alpha_damage_is_rejected(self):
        job = self.submit_edit(); directory = self.complete(job)
        result = Image.open(directory / 'result.png'); result.putpixel((0, 0), (255, 0, 0, 5))
        raw = png(result); (directory / 'result.png').write_bytes(raw)
        path = directory / 'metrics.json'; metrics = json.loads(path.read_text()); metrics['image_sha256'] = hashlib.sha256(raw).hexdigest(); path.write_text(json.dumps(metrics))
        self.server.fixture['jobs'][job['job_id']]['result']['metrics'] = metrics
        with self.assertRaisesRegex(api.AdapterError, 'preservation'): self.adapter.get_result(job['job_id'])

    def test_cancel_only_owned_job_and_never_claims_gpu_stopped(self):
        with self.assertRaises(api.AdapterError): self.adapter.cancel_job('f' * 32)
        self.assertFalse(self.server.fixture['posts'])
        job = self.adapter.generate_image('human'); response = self.adapter.cancel_job(job['job_id'])
        self.assertEqual(response['state'], 'canceling'); self.assertIn('may continue', response['cancel_semantics'])

    def test_result_symlink_outside_app_and_forged_model_metrics_are_rejected(self):
        job = self.adapter.generate_image('human', width=64, height=64); directory = self.complete(job)
        path = directory / 'metrics.json'; metrics = json.loads(path.read_text()); metrics['model_id'] = 'sd-turbo'; path.write_text(json.dumps(metrics))
        self.server.fixture['jobs'][job['job_id']]['result']['metrics'] = metrics
        with self.assertRaisesRegex(api.AdapterError, 'model'): self.adapter.get_result(job['job_id'])
        metrics['model_id'] = 'sdxl-base'; path.write_text(json.dumps(metrics))
        outside = Path(self.temp.name) / 'external.png'; outside.write_bytes((directory / 'result.png').read_bytes())
        (directory / 'result.png').unlink(); (directory / 'result.png').symlink_to(outside)
        with self.assertRaisesRegex(api.AdapterError, 'escapes'): self.adapter.get_result(job['job_id'])

    @unittest.skipUnless(importlib.util.find_spec('mcp'), 'official SDK runtime owned by Mac release')
    def test_official_sdk_stdio_schema_errors_async_job_and_clean_stdout(self):
        command = [sys.executable, '-B', str(SCRIPT), '--app-root', str(self.root), '--api-url', self.url,
            '--state-dir', str(self.state), '--input-root', str(self.inputs)]
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        lines, errors = [], []; inbox = queue.Queue()
        def read_stdout():
            for line in process.stdout:
                lines.append(line)
                try: inbox.put(json.loads(line))
                except ValueError: inbox.put({'invalid_stdout': line})
        reader = threading.Thread(target=read_stdout, daemon=True); reader.start()
        def read_stderr():
            errors.extend(process.stderr.readlines())
        error_reader = threading.Thread(target=read_stderr, daemon=True); error_reader.start()
        next_id = 0
        error_checks = {}
        def call(method, params):
            nonlocal next_id
            next_id += 1
            process.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': next_id, 'method': method, 'params': params}) + '\n'); process.stdin.flush()
            while True:
                response = inbox.get(timeout=15)
                self.assertNotIn('invalid_stdout', response)
                self.assertEqual(response.get('jsonrpc'), '2.0')
                if response.get('id') == next_id:
                    self.assertNotIn('error', response, response)
                    return response['result']
        try:
            initialized = call('initialize', {'protocolVersion': '2025-11-25', 'capabilities': {}, 'clientInfo': {'name': 'fixture', 'version': '1'}})
            self.assertEqual(initialized['protocolVersion'], '2025-11-25')
            process.stdin.write(json.dumps({'jsonrpc': '2.0', 'method': 'notifications/initialized'}) + '\n'); process.stdin.flush()
            tools = call('tools/list', {})['tools']
            self.assertEqual({t['name'] for t in tools}, {'pankeki_get_status', 'pankeki_generate_image', 'pankeki_edit_image', 'pankeki_get_job', 'pankeki_get_result', 'pankeki_cancel_job'})
            schemas = {tool['name']: tool['inputSchema'] for tool in tools}
            self.assertEqual(schemas['pankeki_generate_image']['properties']['model_id']['enum'], ['sdxl-base', 'sd-turbo', 'animagine-xl-4.0-opt'])
            self.assertEqual(schemas['pankeki_edit_image']['properties']['model_id']['enum'], ['sdxl-base', 'sd-turbo', 'sdxl-inpaint-v01', 'animagine-xl-4.0-opt'])
            self.assertIn('recompose', schemas['pankeki_edit_image']['properties']['operation']['enum'])
            self.assertNotIn('mask_path', schemas['pankeki_edit_image'].get('required', []))
            status = call('tools/call', {'name': 'pankeki_get_status', 'arguments': {}})
            self.assertFalse(status.get('isError', False), status)
            self.assertTrue(status['structuredContent']['app_reachable'])
            invalid = call('tools/call', {'name': 'pankeki_generate_image', 'arguments': {'prompt': 'human', 'seed': True}})
            self.assertTrue(invalid['isError']); self.assertFalse(self.server.fixture['posts'])
            submitted = call('tools/call', {'name': 'pankeki_generate_image', 'arguments': {'prompt': 'human', 'width': 64, 'height': 64}})
            job = submitted['structuredContent']; self.assertEqual(job['state'], 'queued')
            pending = call('tools/call', {'name': 'pankeki_get_result', 'arguments': {'job_id': job['job_id']}})
            self.assertTrue(pending['isError'])
            def check_error(label, response, expected):
                detail = '\n'.join(c.get('text', '') for c in response.get('content', []))
                error_checks[label] = {'isError': response.get('isError'), 'detail': detail}
                with self.subTest(error_case=label):
                    self.assertTrue(response['isError'])
                    self.assertIn(expected, detail)
            check_error('pending', pending, 'job is queued')
            check_error('bad_job_id', call('tools/call', {'name': 'pankeki_get_result', 'arguments': {'job_id': 'bad'}}),
                'job_id must be exactly32 lowercase hex characters')
            check_error('negative_seed', call('tools/call', {'name': 'pankeki_generate_image', 'arguments': {'prompt': 'human', 'seed': -1}}),
                'seed must be an integer')
            animagine = call('tools/call', {'name':'pankeki_generate_image', 'arguments':{
                'prompt':'1girl, red scarf', 'model_id':'animagine-xl-4.0-opt', 'negative':'custom',
                'steps':28, 'cfg':5., 'sampler':'euler_ancestral', 'scheduler':'normal', 'width':64, 'height':64}})
            self.assertFalse(animagine.get('isError', False), animagine)
            actual = self.server.fixture['requests'][animagine['structuredContent']['job_id']]
            self.assertEqual(actual['model_id'], 'animagine-xl-4.0-opt'); self.assertEqual(actual['steps'], 28)
            before = len(self.server.fixture['posts'])
            rejected = call('tools/call', {'name':'pankeki_edit_image', 'arguments':{'source_path':'/not-read/source.png', 'mask_path':'/not-read/mask.png',
                'model_id':'animagine-xl-4.0-opt', 'operation':'recolor', 'target_color':'#FF0000'}})
            self.assertTrue(rejected['isError']); self.assertEqual(len(self.server.fixture['posts']), before)
            self.server.fixture['disconnect_get'] = True
            check_error('connection_failure', call('tools/call', {'name': 'pankeki_get_status', 'arguments': {}}),
                'Pankeki connection failed')
            self.server.fixture['disconnect_get'] = False
            self.server.fixture['disconnect'] = True
            before_posts = len(self.server.fixture['posts'])
            uncertain = call('tools/call', {'name': 'pankeki_generate_image', 'arguments': {'prompt': 'human'}})
            check_error('uncertain_submission', uncertain, 'do not automatically retry')
            self.assertIn('may have been submitted', error_checks['uncertain_submission']['detail'])
            self.assertEqual(len(self.server.fixture['posts']), before_posts + 1)
            self.server.fixture['disconnect'] = False
            self.complete(job)
            # A malformed backend result provokes an unexpected internal error.
            # Its Python exception details must remain masked by the SDK.
            self.server.fixture['jobs'][job['job_id']]['result'] = None
            internal = call('tools/call', {'name': 'pankeki_get_result', 'arguments': {'job_id': job['job_id']}})
            check_error('unexpected_internal', internal, 'Error executing tool pankeki_get_result')
            self.assertNotIn('NoneType', error_checks['unexpected_internal']['detail'])
            self.assertNotIn('has no attribute', error_checks['unexpected_internal']['detail'])
            recomposed = call('tools/call', {'name':'pankeki_edit_image', 'arguments':{
                'source_path':str(self.source), 'operation':'recompose', 'prompt':'front view',
                'model_id':'animagine-xl-4.0-opt', 'denoise':.55, 'negative':'keep negative'}})
            self.assertFalse(recomposed.get('isError', False), recomposed)
            recompose_job = recomposed['structuredContent']
            actual = self.server.fixture['requests'][recompose_job['job_id']]
            self.assertEqual(actual['mode'], 'img2img'); self.assertNotIn('mask', actual)
            self.assertEqual(base64.b64decode(actual['source']), self.source.read_bytes())
            self.complete(recompose_job)
            recompose_result = call('tools/call', {'name':'pankeki_get_result', 'arguments':{'job_id':recompose_job['job_id']}})
            self.assertFalse(recompose_result.get('isError', False), recompose_result)
            self.assertEqual(recompose_result['structuredContent']['request']['mode'], 'img2img')

        finally:
            process.stdin.close()
            try: process.wait(timeout=8)
            except subprocess.TimeoutExpired: process.terminate(); process.wait(timeout=5)
            reader.join(2); error_reader.join(2)
            process.stdout.close(); process.stderr.close()
        self.assertEqual(process.returncode, 0, ''.join(errors))
        self.assertTrue(all(json.loads(line).get('jsonrpc') == '2.0' for line in lines))
        if os.environ.get('PANKEKI_MCP_TEST_EVIDENCE'):
            Path(os.environ['PANKEKI_MCP_TEST_EVIDENCE']).write_text(json.dumps({
                'scope': 'official SDK stdio with temporary fake HTTP only; no live app/GPU',
                'server_sha256': hashlib.sha256(SCRIPT.read_bytes()).hexdigest(),
                'error_checks': error_checks, 'exit_code': process.returncode,
                'stdout_jsonrpc_only': True}, ensure_ascii=False, indent=2))

    def test_loopback_url_only_and_help_does_not_start_sdk_or_app(self):
        for url in ('http://example.com:8190', 'https://127.0.0.1:8190', 'http://user@127.0.0.1:8190', self.url + '/other'):
            with self.subTest(url=url), self.assertRaises(api.AdapterError): api.Adapter(self.root, url, self.state, [self.inputs])
        result = subprocess.run([sys.executable, str(SCRIPT), '--help'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr); self.assertIn('--app-root', result.stdout)


if __name__ == '__main__':
    unittest.main()

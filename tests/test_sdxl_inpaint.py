"""Dedicated inpaint routing with tiny model files and an in-process Comfy double."""
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

from pankeki.engine import Engine
from pankeki.environment import server_signature, source_fingerprint
from pankeki.jobs import JobManager
from pankeki.model_presets import configured_models, model_listing
from pankeki import workflows
from scripts import run_macos
from tests.test_engine import PNGComfyClient, image_data


INPAINT = 'sdxl-inpaint-v01'
ALIAS = 'sdxl-inpainting-0.1-unet-fp16.safetensors'
BASE = 'sd_xl_base_1.0.safetensors'


class DedicatedInpaintTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='dedicated-inpaint-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.models = {}
        for model_id, name in [('sdxl-base', BASE), (INPAINT, ALIAS)]:
            path = self.root / name
            path.write_bytes((model_id + ' test bytes').encode())
            self.models[model_id] = {
                'model_name': name, 'model_path': str(path),
                'manifest': {'schema': 1, 'model_name': name,
                             'model_sha256': hashlib.sha256(path.read_bytes()).hexdigest()}}
        self.models[INPAINT]['conditioning_model_id'] = 'sdxl-base'
        self.config = {'models': self.models, 'default_model_id': 'sdxl-base',
                       'managed_builtin_only': False}
        self.source = Image.new('RGBA', (64, 64), (17, 45, 91, 83))
        self.mask = Image.new('L', self.source.size)
        self.mask.paste(255, (24, 24, 40, 40))

    def engine(self, config=None):
        client = PNGComfyClient()
        engine = Engine(self.root, config=config or self.config, client=client)
        self.addCleanup(engine.close)
        return engine, client

    def request(self, **changes):
        return {'mode': 'inpaint', 'edit_operation': 'regenerate', 'model_id': INPAINT,
                'source': image_data(self.source), 'mask': image_data(self.mask),
                'prompt': 'repair fabric', 'steps': 2, 'feather': 0, **changes}

    def run_job(self, engine, request):
        manager = JobManager(engine)
        self.addCleanup(manager.close)
        submitted = manager.submit('dedicated-inpaint-test', request)
        return manager.wait(submitted['job_id'], timeout=10)

    def components(self):
        return {role: {'model_id': model_id,
                       'model_name': self.models[model_id]['model_name'],
                       'model_sha256': self.models[model_id]['manifest']['model_sha256']}
                for role, model_id in [('primary', INPAINT), ('conditioning', 'sdxl-base')]}

    def test_catalog_keeps_generation_default_and_lists_edit_availability(self):
        models, preferred, _ = configured_models(self.config)
        listing = model_listing(models, preferred)
        self.assertEqual(listing['default_model_id'], 'sdxl-base')
        self.assertEqual([m['id'] for m in listing['models']], ['sdxl-base', 'sd-turbo', 'animagine-xl-4.0-opt'])
        self.assertFalse(next(m for m in listing['models'] if m['id'] == 'animagine-xl-4.0-opt')['available'])
        self.assertTrue(listing['edit_models'][0]['available'])
        Path(models['sdxl-base']['model_path']).unlink()
        self.assertFalse(model_listing(models, preferred)['edit_models'][0]['available'])

    def test_invalid_conditioning_and_generation_default_are_rejected(self):
        for ref in (None, INPAINT, 'sd-turbo'):
            config = copy.deepcopy(self.config)
            config['models'][INPAINT]['conditioning_model_id'] = ref
            with self.subTest(ref=ref), self.assertRaisesRegex(ValueError, 'conditioning'):
                configured_models(config)
        config = dict(self.config, default_model_id=INPAINT)
        with self.assertRaisesRegex(ValueError, 'default'):
            configured_models(config)

    def test_edit_only_and_forced_cache_off_preserve_base_and_cpu_routes(self):
        engine, _ = self.engine()
        self.assertFalse(engine.validate_request(self.request(cache=True))['cache'])
        for change in ({'mode': 'txt2img'}, {'edit_operation': 'recolor'}):
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, 'regenerate'):
                engine.validate_request(self.request(**change))
        self.assertEqual(engine.validate_request({'prompt': 'base'})['model_id'], 'sdxl-base')
        cpu = self.request(model_id='sdxl-base', edit_operation='recolor',
                           target_color='#ff0000', source_color='#112d5b')
        self.assertEqual(engine.validate_request(cpu)['edit_operation'], 'recolor')

    def test_dedicated_graph_uses_unet_and_base_conditioning(self):
        graph = workflows.inpaint_sdxl(BASE, ALIAS, 'repair', 'input.png', steps=2, denoise=.7)
        self.assertEqual(graph['1']['inputs']['ckpt_name'], BASE)
        self.assertEqual(graph['8']['class_type'], 'UNETLoader')
        self.assertEqual(graph['8']['inputs']['unet_name'], ALIAS)
        self.assertEqual(graph['9']['class_type'], 'InpaintModelConditioning')
        self.assertEqual(graph['9']['inputs']['vae'], ['1', 2])
        self.assertEqual(graph['9']['inputs']['mask'], ['4', 1])
        self.assertEqual(graph['5']['inputs']['model'], ['8', 0])
        self.assertEqual(graph['5']['inputs']['positive'], ['9', 0])
        self.assertEqual(graph['5']['inputs']['negative'], ['9', 1])
        self.assertEqual(graph['5']['inputs']['latent_image'], ['9', 2])
        self.assertEqual(workflows.inpaint(BASE, 'old', 'input.png')['8']['class_type'], 'VAEEncode')

    def test_job_records_both_components_and_preserves_outside_rgb_and_full_alpha(self):
        engine, client = self.engine()
        request = self.request(cache=True)
        untouched = copy.deepcopy(request)
        job = self.run_job(engine, request)
        self.assertEqual(job['state'], 'succeeded', job['error'])
        self.assertEqual(request, untouched)
        output_path = Path(job['result']['image_path'])
        recipe = json.loads((output_path.parent / 'recipe.json').read_text())
        metrics = job['result']['metrics']
        self.assertEqual(recipe['model_components'], self.components())
        self.assertEqual(metrics['model_components'], self.components())
        self.assertEqual(metrics['model_id'], INPAINT)
        self.assertEqual(metrics['cache'], 'off')
        self.assertIsNone(metrics['cache_key'])
        self.assertEqual(metrics['component_verification'], 'configured_files_sha256')
        self.assertIn('unmanaged', metrics['cache_reason'])
        self.assertEqual(engine.cache.stats()['entries'], 0)
        self.assertEqual(len(client.workflows), 1)
        with Image.open(io.BytesIO(next(iter(client.uploads.values())))) as upload:
            restored_mask = 255 - np.asarray(upload.getchannel('A'))
        self.assertEqual(np.count_nonzero(restored_mask), np.count_nonzero(np.asarray(self.mask)))
        self.assertEqual(restored_mask.max(), 255)
        with Image.open(output_path) as output:
            actual, original = np.asarray(output.convert('RGBA')), np.asarray(self.source)
        outside = np.asarray(self.mask) == 0
        np.testing.assert_array_equal(actual[outside, :3], original[outside, :3])
        np.testing.assert_array_equal(actual[:, :, 3], original[:, :, 3])
        self.assertTrue(np.any(actual[~outside, :3] != original[~outside, :3]))

    def test_each_changed_component_rejects_before_upload_or_submission(self):
        for model_id in (INPAINT, 'sdxl-base'):
            with self.subTest(model_id=model_id):
                engine, client = self.engine()
                path = Path(self.models[model_id]['model_path'])
                before, stamp = path.read_bytes(), path.stat()
                path.write_bytes(b'x' * len(before))
                os.utime(path, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
                job = self.run_job(engine, self.request())
                self.assertEqual(job['state'], 'failed')
                self.assertIn(model_id, job['error'])
                self.assertEqual(client.workflows, [])
                self.assertEqual(client.uploads, {})
                path.write_bytes(before)

    def test_cache_off_retains_all_managed_environment_guards(self):
        for change in ('process', 'server', 'source', 'configuration'):
            with self.subTest(change=change):
                source = self.root / 'comfy-source'
                source.mkdir(exist_ok=True)
                module = source / 'nodes.py'
                module.write_text('original nodes')
                config_file = self.root / 'paths.yaml'
                config_file.write_text('original paths')
                config = copy.deepcopy(self.config)
                config.update(managed_builtin_only=True, runtime_guard={
                    'pid': 123, 'process_start_token': 'owned-process',
                    'server_signature': server_signature(PNGComfyClient().system),
                    'source_trees': {str(source): source_fingerprint(source)},
                    'configuration_files': {str(config_file): hashlib.sha256(config_file.read_bytes()).hexdigest()}})
                if change == 'process':
                    config['runtime_guard']['process_start_token'] = 'different process'
                engine, client = self.engine(config)
                if change == 'server':
                    client.system['pytorch_version'] = 'changed torch'
                elif change == 'source':
                    module.write_text('changed nodes')
                elif change == 'configuration':
                    config_file.write_text('changed paths')
                # OS process tokens are Windows-only; all source/config hashes below are real files.
                with patch('pankeki.engine.process_start_token', return_value='owned-process'):
                    job = self.run_job(engine, self.request(cache=False))
                self.assertEqual(job['state'], 'failed')
                self.assertIn('ComfyUI', job['error'])
                self.assertEqual(client.workflows, [])
                self.assertEqual(client.uploads, {})

    def test_dedicated_request_retains_pankeki_source_guard(self):
        source = self.root / 'adapter-source'
        source.mkdir()
        module = source / 'core.py'
        module.write_text('original')
        with patch('pankeki.engine.source_fingerprint', side_effect=lambda _: source_fingerprint(source)):
            engine, client = self.engine()
            module.write_text('changed')
            job = self.run_job(engine, self.request(cache=False))
        self.assertEqual(job['state'], 'failed')
        self.assertIn('Pankeki source changed', job['error'])
        self.assertEqual(client.workflows, [])

    def test_empty_mask_copies_without_claiming_model_verification(self):
        engine, client = self.engine()
        job = self.run_job(engine, self.request(mask=image_data(Image.new('L', self.source.size))))
        self.assertEqual(job['state'], 'succeeded', job['error'])
        metrics = job['result']['metrics']
        self.assertEqual(metrics['kind'], 'pixel_copy')
        self.assertEqual(metrics['model_calls'], 0)
        self.assertEqual(metrics['model_components'], self.components())
        self.assertEqual(metrics['component_verification'], 'not_run')
        self.assertFalse((Path(job['result']['image_path']).parent / 'workflow.json').exists())
        self.assertEqual(client.workflows, [])

    def test_launcher_config_is_pure_and_registers_known_components(self):
        config = run_macos.build_config(self.root)
        self.assertEqual(config['default_model_id'], 'animagine-xl-4.0-opt')
        self.assertEqual(config['models'][INPAINT]['conditioning_model_id'], 'sdxl-base')
        self.assertEqual(config['models'][INPAINT]['model_name'], ALIAS)
        self.assertFalse((self.root / 'runtime' / 'macos' / 'config.json').exists())
        models, preferred, _ = configured_models(config)
        self.assertFalse(model_listing(models, preferred)['edit_models'][0]['available'])

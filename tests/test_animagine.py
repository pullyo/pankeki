"""Animagine source contract with tiny checkpoint/PNG fixtures; no model/GPU/server."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

from pankeki.engine import Engine, validate_request
from pankeki.jobs import JobManager
from pankeki.model_presets import MODEL_PRESETS, configured_models, model_listing
from tests.test_engine import PNGComfyClient

MODEL = 'animagine-xl-4.0-opt'
NAME = 'animagine-xl-4.0-opt.safetensors'
SHA = '6327eca98bfb6538dd7a4edce22484a1bbc57a8cff6b11d075d40da1afb847ac'


class AnimagineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.models = {}
        for model_id, name in [('sdxl-base', 'sd_xl_base_1.0.safetensors'), (MODEL, NAME)]:
            file = self.root / name; file.write_bytes(('tiny fixture ' + model_id).encode())
            self.models[model_id] = dict(model_name=name, model_path=str(file),
                manifest=dict(schema=1, model_name=name, model_sha256=hashlib.sha256(file.read_bytes()).hexdigest()))
        self.client = PNGComfyClient()

    def engine(self):
        engine = Engine(self.root, config={'transport':'direct', 'managed_builtin_only':False,
            'models':self.models, 'default_model_id':'sdxl-base'}, client=self.client)
        self.addCleanup(engine.close)
        return engine

    def run_job(self, **patch):
        manager = JobManager(self.engine()); self.addCleanup(manager.close)
        request = dict(model_id=MODEL, mode='txt2img', prompt='1girl, red scarf', width=64, height=64, cache=False, preview=False)
        request.update(patch)
        submitted = manager.submit('animagine-fixture', request)
        return manager.wait(submitted['job_id'], timeout=5)

    def test_generation_capability_and_existing_default(self):
        listing = self.engine().models_info()
        self.assertEqual(listing['default_model_id'], 'sdxl-base')
        entry = next(item for item in listing['models'] if item['id'] == MODEL)
        self.assertTrue(entry['available']); self.assertEqual(entry['supported_modes'], ['txt2img', 'img2img'])
        self.assertNotIn('inpaint', entry['supported_modes'])
        self.assertNotIn(MODEL, [item['id'] for item in listing['edit_models']])
        self.assertEqual(MODEL_PRESETS['sdxl-base']['defaults']['steps'], 25)

    def test_recommended_settings_reach_checkpoint_graph_and_saved_identity(self):
        job = self.run_job()
        self.assertEqual(job['state'], 'succeeded', job['error'])
        graph = self.client.workflows[-1]
        self.assertEqual(graph['1']['inputs']['ckpt_name'], NAME)
        self.assertEqual(graph['5']['inputs']['steps'], 28); self.assertEqual(graph['5']['inputs']['cfg'], 5)
        self.assertEqual(graph['5']['inputs']['sampler_name'], 'euler_ancestral')
        self.assertEqual(graph['5']['inputs']['scheduler'], 'normal')
        recipe = json.loads((Path(job['result']['image_path']).parent / 'recipe.json').read_text())
        self.assertEqual(recipe['model_id'], MODEL); self.assertEqual(job['result']['metrics']['model_name'], NAME)
        self.assertEqual(recipe['negative'], '', 'recommendations never silently fill an omitted negative')

    def test_explicit_settings_and_negative_survive(self):
        job = self.run_job(steps=17, cfg=7, sampler='dpmpp_2m', scheduler='karras', negative='custom negative')
        self.assertEqual(job['state'], 'succeeded', job['error'])
        graph = self.client.workflows[-1]
        self.assertEqual(graph['5']['inputs']['steps'], 17); self.assertEqual(graph['5']['inputs']['cfg'], 7)
        self.assertEqual(graph['3']['inputs']['text'], 'custom negative')

    def test_every_edit_operation_rejects_new_model_before_input_decode(self):
        for operation in ['regenerate', 'recolor']:
            for validator in [validate_request, self.engine().validate_request]:
                with self.assertRaisesRegex(ValueError, 'txt2img|generation'):
                    validator(dict(mode='inpaint', edit_operation=operation, model_id=MODEL, source='invalid PNG', mask='invalid PNG'))
        self.assertEqual(self.client.workflows, [])

    def test_missing_checkpoint_never_falls_back_to_base(self):
        Path(self.models[MODEL]['model_path']).unlink()
        with self.assertRaisesRegex(ValueError, 'not installed|configured'):
            self.engine().validate_request(dict(model_id=MODEL, prompt='one girl'))
        self.assertEqual(self.client.workflows, [])

    def test_changed_optional_weight_rejects_even_with_unmanaged_comfy(self):
        Path(self.models[MODEL]['model_path']).write_bytes(b'wrong bytes')
        job = self.run_job()
        self.assertEqual(job['state'], 'failed'); self.assertRegex(job['error'], 'bytes|SHA256|manifest')
        self.assertEqual(self.client.workflows, [])

    def test_launcher_registers_optional_model_without_changing_base_only_readiness(self):
        spec = importlib.util.spec_from_file_location('animagine_run_macos', Path(__file__).parents[1] / 'scripts/run_macos.py')
        launcher = importlib.util.module_from_spec(spec); spec.loader.exec_module(launcher)
        config = launcher.build_config(self.root)
        self.assertEqual(config['models'][MODEL]['manifest']['model_sha256'], SHA)
        self.assertEqual(config['models'][MODEL]['model_name'], NAME)
        base = self.root / 'models/checkpoints/sd_xl_base_1.0.safetensors'; base.parent.mkdir(parents=True); base.write_bytes(b'base only')
        models, preferred, _ = configured_models(config)
        listing = model_listing(models, preferred)
        self.assertEqual(listing['default_model_id'], 'sdxl-base')
        self.assertFalse(next(item for item in listing['models'] if item['id'] == MODEL)['available'])
        self.assertTrue(any((self.root / 'models/checkpoints' / name).is_file() for name, _ in launcher.MODELS.values()))
        self.assertFalse((self.root / 'runtime/macos/config.json').exists())

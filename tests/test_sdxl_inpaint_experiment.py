"""Offline contracts for the isolated method trial; never calls an API/GPU."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image
from safetensors.numpy import save_file

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/experiment_sdxl_inpaint_macos.py'
spec = importlib.util.spec_from_file_location('inpaint_trial', SCRIPT)
trial = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trial)


class IsolatedInpaintTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.recipe = dict(prompt='a red scarf', negative='', seed=20261023,
            steps=25, cfg=6., denoise=.65, sampler='dpmpp_2m', scheduler='karras')

    def preparation_baseline(self):
        """Synthetic fixture; archived comparison recipes stay immutable."""
        baseline = self.root / 'baseline'; baseline.mkdir()
        Image.new('RGB', (64, 64), 'blue').save(baseline / 'original.png')
        Image.new('L', (64, 64), 255).save(baseline / 'mask.png')
        recipe = dict(self.recipe, feather=4, roi=True, width=64, height=64,
            job_id='test-baseline', adapter_source_sha256=trial.source_fingerprint(trial.ROOT / 'pankeki'))
        recipe['original_sha256'] = hashlib.sha256((baseline / 'original.png').read_bytes()).hexdigest()
        recipe['mask_sha256'] = hashlib.sha256((baseline / 'mask.png').read_bytes()).hexdigest()
        (baseline / 'recipe.json').write_text(json.dumps(recipe))
        return baseline

    def test_nine_channel_method_uses_separate_unet_and_all_conditioning_outputs(self):
        graph = trial.build_workflow(self.recipe, 'inpaint-v01', 'inpaint.safetensors', 'trial')
        self.assertEqual(graph.get('8'), {'class_type': 'UNETLoader',
            'inputs': {'unet_name': 'inpaint.safetensors', 'weight_dtype': 'default'}})
        self.assertEqual(graph['5']['inputs']['model'], ['8', 0])
        self.assertEqual(graph['5']['inputs']['positive'], ['9', 0])
        self.assertEqual(graph['5']['inputs']['negative'], ['9', 1])
        self.assertEqual(graph['5']['inputs']['latent_image'], ['9', 2])
        self.assertEqual(graph['9']['class_type'], 'InpaintModelConditioning')
        self.assertEqual(graph['9']['inputs']['mask'], ['4', 1])
        self.assertEqual(graph['6']['inputs']['vae'], ['1', 2])
        self.assertEqual(graph['2']['inputs']['clip'], ['1', 1])
        self.assertEqual(graph['10']['inputs']['samples'], ['5', 0])

    def test_base_control_keeps_source_encoding_and_the_identical_sampler_settings(self):
        graph = trial.build_workflow(self.recipe, 'base', None, 'control')
        self.assertEqual(graph.get('8', {}).get('class_type'), 'VAEEncode')
        self.assertEqual(graph['9']['class_type'], 'SetLatentNoiseMask')
        settings = graph['5']['inputs']
        self.assertEqual([settings[k] for k in ('seed', 'steps', 'cfg', 'denoise', 'sampler_name', 'scheduler')],
                         [20261023, 25, 6., .65, 'dpmpp_2m', 'karras'])

    def test_same_size_weight_mutation_fails_exact_hash_verification(self):
        path = self.root / 'weight'; path.write_bytes(b'good')
        identity = {'bytes': 4, 'sha256': hashlib.sha256(b'good').hexdigest()}
        self.assertEqual(trial.verify_file(path, identity).get('sha256'), identity['sha256'])
        path.write_bytes(b'evil')
        with self.assertRaisesRegex(ValueError, 'SHA256'):
            trial.verify_file(path, identity)

    def test_missing_or_incomplete_gpu_handoff_cannot_authorize_network(self):
        with self.assertRaisesRegex(ValueError, 'handoff'):
            trial.validate_handoff(self.root / 'missing.json')
        path = self.root / 'handoff.json'
        path.write_text(json.dumps({'released_by': 'root', 'ui_verification_complete': False,
            'scope': 'sdxl-inpaint-v01-limited'}))
        with self.assertRaisesRegex(ValueError, 'handoff'):
            trial.validate_handoff(path)

    def test_each_phase_is_claimed_once_and_comparisons_require_successful_smoke(self):
        with self.assertRaisesRegex(ValueError, 'smoke'):
            trial.claim_attempt(self.root, 'compare-inpaint-065')
        first = trial.claim_attempt(self.root, 'smoke')
        self.assertIsInstance(first, Path)
        with self.assertRaises((FileExistsError, ValueError)):
            trial.claim_attempt(self.root, 'smoke')
        (self.root / 'smoke/summary.json').write_text(json.dumps({'technical_pass': True}))
        self.assertIsInstance(trial.claim_attempt(self.root, 'compare-inpaint-065'), Path)
        with self.assertRaises(ValueError):
            trial.claim_attempt(self.root, 'unplanned-strength')

    def test_nan_and_inf_are_detected_in_sampler_latent_not_hidden_by_png(self):
        path = self.root / 'sample.latent'
        save_file({'latent_tensor': np.array([0., np.nan, np.inf], dtype=np.float32)}, path)
        result = trial.latent_finiteness(path)
        self.assertEqual(result.get('nonfinite_values'), 2)
        self.assertFalse(result['all_finite'])

    def test_composite_preserves_nonuniform_source_alpha_and_exterior_rgb(self):
        source = Image.new('RGBA', (8, 8), (10, 20, 30, 90))
        source.putpixel((0, 0), (10, 20, 30, 0))
        mask = Image.new('L', source.size); mask.paste(255, (2, 2, 6, 6))
        result = trial.compose_result(source, mask, Image.new('RGB', source.size, 'red'), 0)
        self.assertEqual(result.getpixel((3, 3)), (255, 0, 0, 90))
        self.assertTrue(np.array_equal(np.asarray(result)[..., 3], np.asarray(source)[..., 3]))
        self.assertEqual(result.getpixel((0, 0)), (10, 20, 30, 0))

    def test_pixel_audit_catches_outside_rgb_and_alpha_damage_independently(self):
        source = Image.new('RGBA', (8, 8), (0, 0, 0, 255))
        mask = Image.new('L', source.size); mask.paste(255, (2, 2, 6, 6))
        output = source.copy(); output.putpixel((0, 0), (255, 0, 0, 7))
        result = trial.pixel_metrics(source, mask, output)
        self.assertEqual(result.get('outside_mask_max_error'), 255)
        self.assertEqual(result['alpha_max_error'], 248)

    def test_preparation_rejects_changed_source_instead_of_relabeling_a_comparison(self):
        baseline = self.preparation_baseline()
        with Image.open(baseline / 'original.png') as im:
            modified = im.copy(); modified.putpixel((0, 0), (0, 0, 0)); modified.save(baseline / 'original.png')
        with patch.object(trial, 'BASELINE', baseline), patch.object(trial, 'TRIAL', self.root / 'trial'):
            with self.assertRaisesRegex(ValueError, 'baseline input'):
                trial.prepare()

    def test_preparation_rejects_stale_product_fingerprint(self):
        baseline = self.preparation_baseline()
        recipe = json.loads((baseline / 'recipe.json').read_text())
        recipe['adapter_source_sha256'] = '0' * 64
        (baseline / 'recipe.json').write_text(json.dumps(recipe))
        with patch.object(trial, 'BASELINE', baseline), patch.object(trial, 'TRIAL', self.root / 'trial'):
            with self.assertRaisesRegex(ValueError, 'Product sources differ'):
                trial.prepare()

    def test_default_command_prepares_without_model_checks_or_http(self):
        baseline = self.preparation_baseline()
        with patch.object(trial, 'BASELINE', baseline), patch.object(trial, 'TRIAL', self.root / 'trial'), \
                patch.object(sys, 'argv', ['trial']), \
                patch.object(trial, 'ComfyClient', side_effect=AssertionError('HTTP client created')), \
                patch.object(trial, 'verify_file', side_effect=AssertionError('weights read during prepare')):
            trial.main()
        plan = json.loads((self.root / 'trial/plan.json').read_text())
        self.assertEqual(plan['status'], 'prepared-not-run')
        self.assertEqual(plan['max_submissions'], 3)
        self.assertEqual(set(plan['phases']), {'smoke', 'compare-inpaint-065', 'compare-base-099'})
        self.assertEqual(plan['phases']['smoke']['recipe'], plan['phases']['compare-base-099']['recipe'])
        self.assertEqual(plan['phases']['smoke']['recipe']['denoise'], .99)
        self.assertEqual(plan['phases']['compare-inpaint-065']['recipe']['denoise'], .65)
        self.assertFalse((self.root / 'trial/smoke').exists())

    def test_unreleased_run_fails_before_even_a_read_only_http_client_exists(self):
        args = type('Arguments', (), {'handoff': self.root / 'missing.json'})()
        with patch.object(trial, 'ComfyClient', side_effect=AssertionError('HTTP client created')):
            with self.assertRaisesRegex(ValueError, 'handoff'):
                trial.execute(args)

    def test_core_symlink_alias_does_not_duplicate_download_or_reject_verified_target(self):
        target = self.root / 'models/inpaint.safetensors'; target.parent.mkdir()
        target.write_bytes(b'verified by separate SHA256 check')
        core = self.root / 'vendor/ComfyUI/models/diffusion_models'; core.mkdir(parents=True)
        link = core / 'inpaint-fp16.safetensors'; link.symlink_to(target)
        with patch.object(trial, 'ROOT', self.root):
            try:
                actual = trial.unet_alias(link)
            except ValueError:
                actual = None
        self.assertEqual(actual, 'inpaint-fp16.safetensors')

    def test_downloading_report_is_not_a_verified_gpu_input(self):
        report = {'state': 'downloading', 'expected_sha256': trial.UNET_IDENTITY['sha256'],
            'revision': trial.UNET_IDENTITY['revision'], 'full_sha256_verified': False}
        with self.assertRaisesRegex(ValueError, 'verified'):
            trial.validate_download_report(report)

    def test_handoff_submission_limit_is_enforced_instead_of_ignored(self):
        path = self.root / 'handoff.json'
        record = {'released_by': 'root', 'ui_verification_complete': True,
            'scope': 'sdxl-inpaint-v01-limited', 'message': 'GPU released',
            'max_new_inference_submissions': 2,
            'phases': list(trial.PHASES), 'stop_on_smoke_technical_failure': True}
        path.write_text(json.dumps(record))
        with self.assertRaisesRegex(ValueError, 'handoff'):
            trial.validate_handoff(path)
        record['max_new_inference_submissions'] = 3
        path.write_text(json.dumps(record))
        self.assertEqual(trial.validate_handoff(path)['max_new_inference_submissions'], 3)



if __name__ == '__main__':
    unittest.main()

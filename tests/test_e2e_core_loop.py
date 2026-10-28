"""Safety and artifact gates; no service/model/browser is started."""
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('e2e_core_loop', ROOT / 'scripts/e2e_core_loop.py')
e2e = importlib.util.module_from_spec(spec)
spec.loader.exec_module(e2e)


class CoreLoopHarnessTests(unittest.TestCase):
    def test_live_original_port_and_remote_service_rejected(self):
        for url in ('http://127.0.0.1:8190', 'http://example.com:8197', 'http://127.0.0.1:8188'):
            with self.assertRaises(ValueError):
                e2e.validate_base_url(url)
        self.assertEqual(e2e.validate_base_url('http://127.0.0.1:8197'), 'http://127.0.0.1:8197')

    def test_identity_requires_separate_html_disk_and_process(self):
        good = 'a' * 64
        build = dict(source_id=good, html_source_id=good, process_source_id=good, status='match')
        e2e.validate_identity({'build': build}, f'<meta name="pankeki-source-id" content="{good}">'.encode(), good)
        for field in ('source_id', 'html_source_id', 'process_source_id'):
            with self.assertRaises(ValueError):
                e2e.validate_identity({'build': dict(build, **{field: None})}, b'', good)

    def test_unknown_queue_is_not_idle(self):
        for value in ({}, {'queue_running': [], 'queue_pending': None}, {'queue_running': 'x', 'queue_pending': []}):
            with self.assertRaises(ValueError):
                e2e.queue_state(value)
        self.assertEqual(e2e.queue_state({'queue_running': [], 'queue_pending': []}), 'idle')
        self.assertEqual(e2e.queue_state({'queue_running': [[1, 'foreign']], 'queue_pending': []}), 'busy')

    def test_gpu_requires_explicit_permission(self):
        with self.assertRaises(ValueError):
            e2e.require_gpu(False)
        e2e.require_gpu(True)

    def test_terminal_uncertainty_never_passes(self):
        for state in ('orphaned', 'uncertain', 'failed', 'canceled', 'running'):
            with self.assertRaises(ValueError):
                e2e.validate_job({'state': state})

    def test_real_png_and_sampler_required(self):
        from PIL import Image
        from io import BytesIO
        image = Image.new('RGBA', (512, 512), (10, 20, 30, 255)); raw = BytesIO(); image.save(raw, format='PNG')
        import hashlib
        data = raw.getvalue(); sha = hashlib.sha256(data).hexdigest(); job_id = 'b' * 32
        job = {'job_id': job_id, 'trace_id': 'trace', 'state': 'succeeded', 'lane': 'gpu', 'client_id': 'own', 'result': {'job_id': job_id, 'trace_id': 'trace', 'result_sha256': sha, 'run_ref': 'runs/' + job_id}}
        metrics = {'model_calls': 1, 'gpu_completed': True, 'denoiser_executed': True}
        e2e.validate_artifact(job, data, metrics)
        for bad in (dict(metrics, denoiser_executed=False), dict(metrics, model_calls=0)):
            with self.assertRaises(ValueError):
                e2e.validate_artifact(job, data, bad)
        with self.assertRaises(ValueError):
            e2e.validate_artifact(job, b'mock', metrics)

    def test_mask_requires_inside_change_and_exact_exterior_alpha(self):
        from PIL import Image
        import numpy as np
        source = Image.new('RGBA', (8, 8), (20, 30, 40, 123)); mask = Image.new('L', (8, 8), 0)
        mask.putpixel((4, 4), 255); edited = source.copy(); edited.putpixel((4, 4), (200, 40, 20, 123))
        report = e2e.pixel_invariants(source, edited, mask)
        self.assertEqual(report['outside_rgb_max_error'], 0)
        self.assertEqual(report['alpha_max_error'], 0)
        self.assertGreater(report['inside_changed_pixels'], 0)
        with self.assertRaises(ValueError): e2e.pixel_invariants(source, source, mask)
        changed = np.asarray(edited).copy(); changed[0, 0, 0] += 1
        with self.assertRaises(ValueError): e2e.pixel_invariants(source, Image.fromarray(changed), mask)

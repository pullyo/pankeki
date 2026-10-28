"""CPU color/pixel contracts; no model, server, network or GPU required."""
import base64
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

from pankeki.engine import Engine, validate_request
from pankeki.jobs import JobManager
from pankeki.recolor import recolor, validate_options


def image64(image):
    stream = io.BytesIO(); image.save(stream, format='PNG')
    return base64.b64encode(stream.getvalue()).decode('ascii')


class ForbiddenComfy:
    def get(self, *args, **kwargs):
        raise AssertionError('Local recolor contacted Comfy')

    upload_png = execute = fingerprint = get


class RecolorPixels(unittest.TestCase):
    def test_canonical_hex_and_finite_tolerance_contract(self):
        self.assertEqual(validate_options({'target_color': '#ff0000'}).get('target_color'), '#FF0000')
        for changes in ({}, {'target_color': 'red'}, {'target_color': '#FFFF'},
                {'target_color': '#FF0000', 'source_color': True},
                {'target_color': '#FF0000', 'color_tolerance': True},
                {'target_color': '#FF0000', 'color_tolerance': float('nan')},
                {'target_color': '#FF0000', 'color_tolerance': 91}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate_options(changes)

    def test_blue_turns_red_without_changing_other_colors_or_dimensions(self):
        source = Image.new('RGB', (12, 8), '#0000FF')
        source.paste('#C08020', (6, 0, 12, 8))
        mask = Image.new('L', source.size, 255)
        output, _ = recolor(source, mask, '#FF0000', source_color='#0000FF', feather=0)
        self.assertEqual(output.getpixel((2, 3)), (255, 0, 0))
        self.assertEqual(output.crop((6, 0, 12, 8)).tobytes(), source.crop((6, 0, 12, 8)).tobytes())
        self.assertEqual(output.size, source.size)

    def test_manual_reference_recolors_a_single_pixel_missed_by_context_sampling(self):
        source = Image.new('RGB', (257, 257), 'blue')
        source.putpixel((1, 0), (255, 0, 0))
        output, params = recolor(source, Image.new('L', source.size, 255), '#00FF00',
            source_color='#FF0000', feather=0)
        expected = source.copy(); expected.putpixel((1, 0), (0, 255, 0))
        self.assertEqual(output.tobytes(), expected.tobytes())
        self.assertIsNone(params['skipped'])

    def test_manual_reference_absent_from_all_pixels_remains_a_noop_after_sampling(self):
        source = Image.new('RGB', (257, 257), 'blue')
        output, params = recolor(source, Image.new('L', source.size, 255), '#00FF00',
            source_color='#FF0000', feather=0)
        self.assertEqual(output.tobytes(), source.tobytes())
        self.assertEqual(params['skipped'], 'no-matching-color')

    def test_auto_blue_reference_ignores_orange_neutrals_and_hidden_pixels(self):
        source = Image.new('RGBA', (16, 12), '#2070B0')
        source.paste((190, 110, 20, 255), (12, 0, 16, 12))
        source.putpixel((0, 0), (255, 255, 255, 255))
        source.putpixel((1, 0), (0, 0, 0, 255))
        source.putpixel((2, 0), (255, 0, 0, 0))
        output, params = recolor(source, Image.new('L', source.size, 255), '#FF0000', feather=0)
        red = output.getpixel((5, 5))
        self.assertGreater(red[0], red[2] * 2)
        self.assertIsInstance(params.get('estimated_source_color'), str)
        for point in ((0, 0), (1, 0), (2, 0), (14, 5)):
            self.assertEqual(output.getpixel(point), source.getpixel(point))

    def test_wraparound_red_hues_match_the_same_source_range(self):
        source = Image.new('RGB', (3, 1))
        source.putdata([(255, 0, 4), (255, 4, 0), (255, 128, 0)])
        output, _ = recolor(source, Image.new('L', source.size, 255), '#00FF00',
            source_color='#FF0000', color_tolerance=5, feather=0)
        for point in ((0, 0), (1, 0)):
            r, g, b = output.getpixel(point); self.assertGreater(g, max(r, b))
        self.assertEqual(output.getpixel((2, 0)), source.getpixel((2, 0)))

    def test_red_green_black_white_keep_shading_order_and_thin_black_lines(self):
        source = Image.new('RGB', (8, 6), '#0000FF')
        for x, blue in enumerate((64, 128, 192, 255)):
            source.paste((0, 0, blue), (x * 2, 0, x * 2 + 2, 6))
        source.paste('black', (0, 3, 8, 4))
        for target in ('#FF0000', '#00FF00', '#000000', '#FFFFFF'):
            with self.subTest(target=target):
                output, _ = recolor(source, Image.new('L', source.size, 255), target,
                    source_color='#0000FF', color_tolerance=0, feather=0)
                colors = np.array([output.getpixel((x, 1)) for x in (0, 2, 4, 6)])
                self.assertTrue(np.array_equal(np.asarray(output)[3], np.asarray(source)[3]))
                if target in ('#000000', '#FFFFFF'):
                    self.assertTrue(np.all(np.ptp(colors, axis=1) <= 1))
                    self.assertTrue(np.all(np.diff(colors[:, 0].astype(int)) > 0))
                    if target == '#000000': self.assertLess(int(colors[2].max()), 100)
                    else: self.assertGreater(int(colors[2].min()), 170)
                else:
                    channel = 0 if target == '#FF0000' else 1
                    self.assertTrue(np.all(colors[:, channel] > colors[:, 2]))

    def test_fractional_mask_caps_change_and_feather_never_spills(self):
        source = Image.new('RGBA', (16, 16), (0, 0, 255, 80))
        source.putpixel((0, 0), (17, 23, 49, 0))
        mask = Image.new('L', source.size); mask.paste(128, (4, 4, 12, 12))
        output, _ = recolor(source, mask, '#FF0000', source_color='#0000FF', feather=2)
        original, actual = np.asarray(source), np.asarray(output)
        self.assertTrue(np.array_equal(actual[..., 3], original[..., 3]))
        self.assertTrue(np.array_equal(actual[np.asarray(mask) == 0], original[np.asarray(mask) == 0]))
        self.assertGreater(output.getpixel((8, 8))[0], 0)
        self.assertLessEqual(output.getpixel((8, 8))[0], 128)
        self.assertGreaterEqual(output.getpixel((8, 8))[2], 127)

    def test_visible_rgb_mapping_is_independent_of_alpha_and_hidden_rgb_is_untouched(self):
        source = Image.new('RGBA', (4, 1))
        source.putdata([(0, 0, 255, a) for a in (0, 1, 128, 255)])
        output, _ = recolor(source, Image.new('L', source.size, 255), '#FF0000',
            source_color='#0000FF', feather=0)
        self.assertEqual(np.asarray(output).tolist()[0],
            [[0, 0, 255, 0], [255, 0, 0, 1], [255, 0, 0, 128], [255, 0, 0, 255]])

    def test_explicit_neutral_reference_changes_gray_and_protects_chromatic_color(self):
        source = Image.new('RGB', (4, 1))
        source.putdata([(112, 112, 112), (128, 128, 128), (144, 144, 144), (0, 0, 255)])
        output, params = recolor(source, Image.new('L', source.size, 255), '#FF0000',
            source_color='#808080', feather=0)
        self.assertIsNone(params['skipped'])
        colors = [output.getpixel((x, 0)) for x in range(3)]
        self.assertTrue(all(r > max(g, b) for r, g, b in colors))
        self.assertGreater(sum(colors[2]), sum(colors[0]))
        self.assertEqual(output.getpixel((3, 0)), (0, 0, 255))

    def test_noop_reasons_are_explicit_and_never_invent_a_color(self):
        source = Image.new('RGB', (8, 8), 'blue')
        cases = [(Image.new('L', source.size), '#FF0000', None, 'empty-mask'),
            (Image.new('L', source.size, 255), '#00FF00', '#FF0000', 'no-matching-color'),
            (Image.new('L', source.size, 255), '#0000FF', '#0000FF', 'same-color')]
        for mask, target, reference, reason in cases:
            with self.subTest(reason=reason):
                output, params = recolor(source, mask, target, source_color=reference, feather=0)
                self.assertEqual(params.get('skipped'), reason)
                self.assertEqual(output.tobytes(), source.tobytes())
        gray = Image.new('RGB', source.size, '#808080')
        output, params = recolor(gray, Image.new('L', source.size, 255), '#FF0000')
        self.assertEqual(params.get('skipped'), 'no-matching-color')
        self.assertEqual(output.tobytes(), gray.tobytes())

    def test_direct_module_honors_cancellation_callback(self):
        def canceled(): raise InterruptedError('caller canceled')
        with self.assertRaisesRegex(InterruptedError, 'caller canceled'):
            recolor(Image.new('RGB', (8, 8), 'blue'), Image.new('L', (8, 8), 255),
                '#FF0000', check_cancel=canceled)


class RecolorEngine(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.engine = Engine(self.root, config={'models': {}}, client=ForbiddenComfy())
        self.manager = JobManager(self.engine)
        self.addCleanup(self.engine.close)
        self.addCleanup(self.manager.close)
        self.source = Image.new('RGBA', (64, 64), (0, 0, 255, 123))
        self.source.putpixel((0, 0), (10, 20, 30, 0))
        self.mask = Image.new('L', self.source.size); self.mask.paste(255, (8, 8, 48, 48))

    def request(self, **changes):
        return dict(mode='inpaint', edit_operation='recolor', target_color='#FF0000',
            source_color='#0000FF', source=image64(self.source), mask=image64(self.mask),
            model_id='sdxl-base', feather=0, **changes)

    def test_offline_job_skips_model_discovery_fingerprint_and_comfy_but_finalizes_artifacts(self):
        job = self.manager.submit('offline-recolor', self.request())
        done = self.manager.wait(job['job_id'], 5)
        self.assertEqual(done['state'], 'succeeded', done['error'])
        metrics = done['result']['metrics']
        self.assertEqual((metrics['kind'], metrics['model_calls'], metrics['cache']), ('local_recolor', 0, 'off'))
        self.assertFalse(metrics['denoiser_executed'])
        self.assertEqual(metrics['status'], 'succeeded')
        path = self.root / 'runtime/runs' / job['job_id']
        self.assertTrue(all((path / name).exists() for name in ('original.png', 'mask.png', 'result.png',
            'recipe.json', 'recolor-params.json', 'metrics.json')))
        result = Image.open(path / 'result.png')
        self.assertEqual(result.getpixel((20, 20)), (255, 0, 0, 123))
        self.assertEqual(result.getpixel((0, 0)), (10, 20, 30, 0))
        recipe = json.loads((path / 'recipe.json').read_text())
        self.assertIsInstance(recipe['recolor']['algorithm'], str)
        self.assertEqual(self.engine.cache.stats()['puts'], 0)

    def test_request_validation_rejects_txt2img_unknown_operation_and_bad_color(self):
        for change in ({'mode': 'txt2img'}, {'edit_operation': 'other'},
                {'target_color': 'blue'}, {'color_tolerance': -1}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_request({**self.request(), **change})

    def test_local_noop_records_skipped_and_zero_changed_pixels(self):
        request = {**self.request(), 'mask': image64(Image.new('L', self.source.size))}
        job = self.manager.submit('noop', request); done = self.manager.wait(job['job_id'], 5)
        self.assertEqual(done['state'], 'succeeded', done['error'])
        self.assertEqual(done['result']['metrics']['skipped'], 'empty-mask')
        self.assertEqual(done['result']['metrics']['changed_inside_pixels'], 0)

    def test_legacy_operation_is_unchanged_when_missing_or_explicit_regenerate(self):
        implicit = validate_request({'prompt': 'hello'})
        explicit = validate_request({'prompt': 'hello', 'edit_operation': 'regenerate'})
        self.assertNotIn('edit_operation', implicit)
        self.assertEqual({**implicit, 'edit_operation': 'regenerate'}, explicit)
        self.assertTrue(implicit['cache'])

    def test_late_cancel_or_new_revision_discards_saved_result_and_finalizes_canceled(self):
        for action in ('cancel', 'supersede'):
            with self.subTest(action=action):
                entered, release = threading.Event(), threading.Event()
                save = self.engine._save
                def saved_then_blocked(*args, **kwargs):
                    result = save(*args, **kwargs)
                    if not entered.is_set():
                        entered.set(); release.wait(3)
                    return result
                try:
                    with patch.object(self.engine, '_save', saved_then_blocked):
                        job = self.manager.submit(action, self.request())
                        self.assertTrue(entered.wait(2), 'Local result was not saved')
                        if action == 'cancel':
                            self.manager.cancel(job['job_id'])
                        else:
                            latest = self.manager.submit(action, self.request())
                        release.set()
                        done = self.manager.wait(job['job_id'], 5)
                        if action == 'supersede':
                            self.assertEqual(self.manager.wait(latest['job_id'], 5)['state'], 'succeeded')
                    self.assertEqual(done['state'], 'canceled')
                    self.assertIsNone(done['result'])
                    self.assertIsNone(self.manager.get_preview(job['job_id']))
                    metrics = json.loads((self.root / 'runtime/runs' / job['job_id'] / 'metrics.json').read_text())
                    self.assertEqual(metrics['status'], 'canceled')
                    self.assertEqual(self.engine.cache.stats()['puts'], 0)
                finally:
                    release.set()

    def test_cancel_during_local_operation_does_not_publish_or_commit_cache(self):
        entered, release = threading.Event(), threading.Event()
        from pankeki import recolor as module
        original = module.recolor
        def blocked(*args, **kwargs):
            entered.set(); release.wait(3); return original(*args, **kwargs)
        try:
            with patch('pankeki.engine.recolor', blocked, create=True):
                job = self.manager.submit('cancel', self.request())
                self.assertTrue(entered.wait(2), 'Local recolor branch was not entered')
                self.manager.cancel(job['job_id']); release.set()
                done = self.manager.wait(job['job_id'], 5)
            self.assertEqual(done['state'], 'canceled')
            self.assertIsNone(done['result'])
            self.assertEqual(self.engine.cache.stats()['puts'], 0)
            metrics = json.loads((self.root / 'runtime/runs' / job['job_id'] / 'metrics.json').read_text())
            self.assertEqual(metrics['status'], 'canceled')
            self.assertEqual(metrics['kind'], 'local_recolor')
        finally:
            release.set()


if __name__ == '__main__':
    unittest.main()

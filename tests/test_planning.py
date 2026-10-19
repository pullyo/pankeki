import unittest
from PIL import Image, ImageDraw


class ROIPlanningTests(unittest.TestCase):
    def setUp(self):
        from pankeki import planning
        self.p = planning

    def test_empty_skips_generation(self):
        plan = self.p.plan_roi(Image.new('L', (127, 93)))
        self.assertEqual((plan.mode, plan.bbox, plan.processed_area), ('empty', None, 0))

    def test_single_pixel_has_context_and_model_alignment(self):
        mask = Image.new('L', (256, 256)); mask.putpixel((120, 130), 255)
        plan = self.p.plan_roi(mask, halo=8, min_size=64)
        self.assertEqual(plan.mode, 'roi')
        self.assertEqual(plan.mask_area, 1)
        self.assertEqual(plan.padded_size, (64, 64))
        self.assertLessEqual(plan.bbox[0], 112)
        self.assertGreaterEqual(plan.bbox[2], 129)
        self.assertEqual(plan.processed_area, 4096)

    def test_edge_and_small_odd_image_uses_padding_without_resize(self):
        mask = Image.new('L', (13, 7)); mask.putpixel((12, 6), 255)
        plan = self.p.plan_roi(mask, halo=0, min_size=16)
        self.assertEqual(plan.mode, 'baseline')
        self.assertEqual(plan.bbox, (0, 0, 13, 7))
        self.assertEqual(plan.padded_size, (16, 16))
        source = Image.new('RGB', (13, 7), (1, 2, 3))
        crop = self.p.crop_for_plan(source, plan)
        self.assertEqual(crop.size, (16, 16))
        self.assertEqual(crop.getpixel((15, 15)), (1, 2, 3))
        padded_mask = self.p.crop_for_plan(mask, plan, is_mask=True)
        self.assertEqual(padded_mask.getpixel((13, 6)), 0)
        self.assertEqual(self.p.unpad_generated(crop, plan).tobytes(), source.tobytes())

    def test_disjoint_mask_includes_both_regions_and_full_falls_back(self):
        mask = Image.new('L', (257, 191)); mask.putpixel((3, 5), 255); mask.putpixel((250, 180), 100)
        plan = self.p.plan_roi(mask)
        self.assertEqual(plan.mode, 'baseline')
        self.assertEqual(plan.mask_area, 2)
        self.assertEqual(plan.padded_size, (264, 192))
        full = self.p.plan_roi(Image.new('L', (257, 191), 255))
        self.assertEqual(full.mode, 'baseline')
        self.assertEqual(full.mask_area, 257 * 191)

    def test_geometry_validation_and_crop_shape_rejection(self):
        mask = Image.new('L', (100, 100), 255)
        for args in ({'halo': -1}, {'multiple': 0}, {'min_size': 0}, {'max_area_ratio': 1.1}):
            with self.subTest(args=args), self.assertRaises(ValueError):
                self.p.plan_roi(mask, **args)
        plan = self.p.plan_roi(mask)
        with self.assertRaises(ValueError): self.p.crop_for_plan(Image.new('RGB', (99, 100)), plan)
        with self.assertRaises(ValueError): self.p.unpad_generated(Image.new('RGB', (99, 100)), plan)

    def test_display_coordinates_include_resize_zoom_and_pan(self):
        actual = self.p.canvas_to_image(210, 130, image_size=(400, 200), display_size=(200, 100), zoom=2, pan=(10, 30))
        self.assertEqual(actual, (200.0, 100.0))
        self.assertEqual(self.p.canvas_to_image(-1, 500, image_size=(400, 200), display_size=(200, 100), clamp=True), (0.0, 200.0))
        with self.assertRaises(ValueError): self.p.canvas_to_image(0, 0, image_size=(10, 10), display_size=(0, 1))


class ExperimentalPlanningTests(unittest.TestCase):
    def setUp(self):
        from pankeki import planning
        self.p = planning
        self.mask = Image.new('L', (1024, 768)); ImageDraw.Draw(self.mask).rectangle((10, 10, 180, 180), fill=255)

    def test_experiments_are_disabled_by_default(self):
        self.assertEqual(self.p.plan_tiles(self.mask).mode, 'disabled')
        self.assertEqual(self.p.plan_lod(self.mask).mode, 'disabled')

    def test_fixed_and_adaptive_are_bounded_and_count_overlap(self):
        for strategy in ('fixed', 'adaptive'):
            with self.subTest(strategy=strategy):
                plan = self.p.plan_tiles(self.mask, strategy=strategy, enabled=True, tile_size=128, min_tile=64, max_depth=4, max_tiles=16, overlap=16)
                self.assertLessEqual(len(plan.tiles), 16)
                self.assertGreater(len(plan.tiles), 0)
                self.assertTrue(all(t.depth <= 4 for t in plan.tiles))
                self.assertGreaterEqual(plan.processed_area, plan.core_area)
                self.assertEqual(plan, self.p.plan_tiles(self.mask, strategy=strategy, enabled=True, tile_size=128, min_tile=64, max_depth=4, max_tiles=16, overlap=16))
                coverage = Image.new('L', self.mask.size)
                draw = ImageDraw.Draw(coverage)
                for tile in plan.tiles:
                    x0, y0, x1, y1 = tile.core_bbox
                    draw.rectangle((x0, y0, x1 - 1, y1 - 1), fill=255)
                self.assertTrue(all(c > 0 for m, c in zip(self.mask.tobytes(), coverage.tobytes()) if m))

    def test_tile_count_limit_has_explicit_baseline_fallback(self):
        plan = self.p.plan_tiles(Image.new('L', (1024, 1024), 255), enabled=True, strategy='fixed', tile_size=64, max_tiles=2)
        self.assertEqual(plan.mode, 'baseline')
        self.assertEqual(len(plan.tiles), 1)
        self.assertEqual(plan.tiles[0].core_bbox, (0, 0, 1024, 1024))

    def test_adaptive_retains_dense_regions_while_fixed_grid_subdivides(self):
        mask = Image.new('L', (512, 512), 255)
        fixed = self.p.plan_tiles(mask, enabled=True, strategy='fixed', tile_size=128)
        adaptive = self.p.plan_tiles(mask, enabled=True, strategy='adaptive', tile_size=128)
        self.assertEqual(len(fixed.tiles), 16)
        self.assertEqual(len(adaptive.tiles), 1)
        self.assertEqual(adaptive.tiles[0].core_bbox, (0, 0, 512, 512))
        self.assertLess(adaptive.processed_area, fixed.processed_area)

    def test_lod_draft_and_final_are_distinct(self):
        plan = self.p.plan_lod(self.mask, enabled=True, draft_scale=.5)
        self.assertEqual(plan.draft_size, (512, 384))
        self.assertFalse(plan.draft_is_final)
        self.assertEqual(plan.refinement.original_size, self.mask.size)


if __name__ == '__main__': unittest.main()

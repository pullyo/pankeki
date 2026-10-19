import unittest
import numpy as np
from PIL import Image, ImageDraw


class CompositeTests(unittest.TestCase):
    def setUp(self):
        from pankeki.composite import composite
        self.composite = composite
        self.original = Image.fromarray(np.arange(32 * 24 * 3, dtype=np.uint8).reshape(24, 32, 3))

    def test_crop_edit_preserves_every_exterior_byte_and_source(self):
        mask = Image.new('L', (32, 24)); ImageDraw.Draw(mask).rectangle((8, 6, 14, 11), fill=255)
        original_bytes = self.original.tobytes()
        result = self.composite(self.original, Image.new('RGB', (16, 16), (255, 0, 0)), mask, (4, 2, 20, 18))
        outside = np.asarray(mask) == 0
        self.assertTrue(np.array_equal(np.asarray(result)[outside], np.asarray(self.original)[outside]))
        self.assertEqual(result.getpixel((10, 8)), (255, 0, 0))
        self.assertEqual(result.size, self.original.size)
        self.assertEqual(self.original.tobytes(), original_bytes)

    def test_feather_never_spills_into_zero_mask_or_increases_soft_alpha(self):
        mask = Image.new('L', (32, 24)); ImageDraw.Draw(mask).rectangle((5, 4, 25, 19), fill=128)
        black = Image.new('RGB', (32, 24))
        result = self.composite(black, Image.new('RGB', (32, 24), 'white'), mask, None, feather=3)
        pixels = np.asarray(result)
        self.assertTrue(np.all(pixels[np.asarray(mask) == 0] == 0))
        self.assertLessEqual(int(pixels.max()), 128)
        self.assertLess(result.getpixel((5, 4))[0], result.getpixel((15, 12))[0])

    def test_empty_and_full_mask(self):
        generated = Image.new('RGB', self.original.size, 'red')
        result = self.composite(self.original, generated, Image.new('L', self.original.size), None)
        self.assertEqual(result.tobytes(), self.original.tobytes())
        self.assertIsNot(result, self.original)
        full = self.composite(self.original, generated, Image.new('L', self.original.size, 255), None)
        self.assertEqual(full.tobytes(), generated.tobytes())

    def test_rejects_mismatched_or_uncovered_inputs(self):
        mask = Image.new('L', self.original.size, 255)
        cases = [
            (Image.new('RGB', (31, 24)), mask, None, 0),
            (self.original, Image.new('L', (31, 24)), None, 0),
            (Image.new('RGB', (4, 4)), mask, (-1, 0, 3, 4), 0),
            (Image.new('RGB', (4, 4)), mask, (1, 1, 5, 5), 0),
            (self.original, mask, None, -1),
        ]
        for generated, candidate_mask, bbox, feather in cases:
            with self.subTest(bbox=bbox, sizes=(generated.size, candidate_mask.size)), self.assertRaises(ValueError):
                self.composite(self.original, generated, candidate_mask, bbox, feather)


if __name__ == '__main__': unittest.main()

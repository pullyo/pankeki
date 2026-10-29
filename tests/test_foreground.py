"""The fixed local Vision boundary; no ComfyUI jobs or model download."""
import importlib
import importlib.util
import io
import unittest
from unittest.mock import patch
from PIL import Image


def png(mode='RGBA', size=(2, 3), color=(10, 20, 30, 255)):
    stream = io.BytesIO()
    Image.new(mode, size, color).save(stream, format='PNG')
    return stream.getvalue()


class ForegroundTests(unittest.TestCase):
    def adapter(self):
        self.assertIsNotNone(importlib.util.find_spec('pankeki.foreground'), 'local foreground adapter is not implemented')
        return importlib.import_module('pankeki.foreground')

    def test_invalid_png_is_rejected_without_starting_helper(self):
        module = self.adapter()
        with patch('subprocess.run', side_effect=AssertionError('invalid input started a process')):
            with self.assertRaises(ValueError):
                module.foreground_mask(b'not an image')

    def test_wrong_size_matte_is_rejected(self):
        module = self.adapter()
        with patch.object(module, '_run', return_value=png('L', (1, 1), 100)):
            with self.assertRaisesRegex(ValueError, 'dimensions'):
                module.foreground_mask(png())

    def test_degenerate_matte_is_not_a_success(self):
        module = self.adapter()
        for color in (0, 255):
            with self.subTest(color=color), patch.object(module, '_run', return_value=png('L', (2, 3), color)):
                with self.assertRaisesRegex(ValueError, 'foreground'):
                    module.foreground_mask(png())

    def test_valid_matte_keeps_natural_dimensions(self):
        module = self.adapter()
        image = Image.new('L', (2, 3), 0); image.putpixel((1, 1), 255)
        stream = io.BytesIO(); image.save(stream, format='PNG'); matte = stream.getvalue()
        with patch.object(module, '_run', return_value=matte):
            self.assertEqual(module.foreground_mask(png()), matte)

    def test_process_failure_is_a_bounded_public_error(self):
        module = self.adapter()
        import subprocess
        with patch.object(module, 'HELPER') as helper, patch('subprocess.run', side_effect=subprocess.TimeoutExpired('fixed helper', 45)):
            helper.is_file.return_value = True
            with self.assertRaisesRegex(ValueError, 'timed out'):
                module.foreground_mask(png())


if __name__ == '__main__':
    unittest.main()

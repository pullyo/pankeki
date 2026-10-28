"""Unit tests for imageops using only synthetic in-memory images."""
import dataclasses
import hashlib
import io
import struct
import unittest

import numpy as np
from PIL import Image

from pankeki import imageops as ops


def encode(obj, **kw):
    im = obj if isinstance(obj, Image.Image) else Image.fromarray(np.ascontiguousarray(obj))
    buf = io.BytesIO()
    im.save(buf, format="PNG", **kw)
    return buf.getvalue()


def rgba(png):
    im = Image.open(io.BytesIO(png))
    im.load()
    assert im.mode == "RGBA", im.mode
    return np.array(im)


def pattern(h, w, alpha=255):
    y, x = np.mgrid[0:h, 0:w]
    a = np.zeros((h, w, 4), np.uint8)
    a[..., 0] = (x * 37 + y * 11) % 256
    a[..., 1] = (x * 5 + y * 91) % 256
    a[..., 2] = (x * 13 + y * 7 + 50) % 256
    a[..., 3] = alpha
    return a


def full_mask(h, w, v=255):
    return encode(np.full((h, w), v, np.uint8))


def square_mask(n=32, lo=8, hi=24):
    m = np.zeros((n, n), np.uint8)
    m[lo:hi, lo:hi] = 255
    return m


class DecodeAndLimitTests(unittest.TestCase):
    def setUp(self):
        self.good = encode(pattern(16, 16))
        self.mask = full_mask(16, 16)

    def rb(self, img, mask=None):
        return ops.remove_background(img, self.mask if mask is None else mask)

    def test_non_bytes(self):
        for bad in ("x", bytearray(self.good), None, 5):
            with self.assertRaises(TypeError):
                ops.resize_png(bad, 4, 4, False)

    def test_malformed(self):
        for bad in (b"", b"garbage" * 20, encode(Image.new("RGB", (8, 8)), ) [:30]):
            with self.assertRaises(ops.InvalidImageError):
                self.rb(bad)

    def test_not_png(self):
        buf = io.BytesIO()
        Image.new("RGB", (8, 8)).save(buf, format="JPEG")
        with self.assertRaises(ops.InvalidImageError):
            self.rb(buf.getvalue())

    def test_truncated_and_trailing(self):
        with self.assertRaises(ops.InvalidImageError):
            self.rb(self.good[:-20])
        with self.assertRaises(ops.InvalidImageError):
            self.rb(self.good + b"\x00")
        with self.assertRaises(ops.InvalidImageError):  # corrupt IDAT, IEND re-appended
            self.rb(self.good[:-24] + ops._PNG_IEND)

    def test_oversized_header_rejected_before_decode(self):
        patched = self.good[:16] + struct.pack(">II", 100000, 100000) + self.good[24:]
        with self.assertRaises(ops.ResourceLimitError):
            self.rb(patched)

    def test_limits(self):
        with self.assertRaises(ops.ResourceLimitError):
            ops.resize_png(self.good, 4, 4, False, limits=ops.Limits(max_png_bytes=50))
        with self.assertRaises(ops.ResourceLimitError):
            ops.resize_png(self.good, 4, 4, False, limits=ops.Limits(max_pixels=100, max_aggregate_pixels=100))
        with self.assertRaises(ops.ResourceLimitError):  # 3 images * 256 px > 600
            ops.remove_background(self.good, self.mask,
                                  limits=ops.Limits(max_pixels=256, max_aggregate_pixels=600))
        with self.assertRaises(ValueError):
            ops.Limits(max_pixels=0)
        with self.assertRaises(TypeError):
            ops.resize_png(self.good, 4, 4, False, limits=object())

    def test_multi_frame_rejected(self):
        f1 = Image.new("RGBA", (8, 8), (255, 0, 0, 255))
        f2 = Image.new("RGBA", (8, 8), (0, 0, 255, 255))
        buf = io.BytesIO()
        f1.save(buf, format="PNG", save_all=True, append_images=[f2])
        with self.assertRaises(ops.UnsupportedImageError):
            self.rb(buf.getvalue(), full_mask(8, 8))

    def test_unsupported_mode(self):
        with self.assertRaises(ops.UnsupportedImageError):
            self.rb(encode(Image.new("I;16", (16, 16))))

    def test_orientation(self):
        for value, ok in ((1, True), (6, False), (3, False)):
            exif = Image.Exif()
            exif[0x0112] = value
            png = encode(Image.fromarray(pattern(16, 16)), exif=exif)
            if ok:
                self.rb(png)
            else:
                with self.assertRaises(ops.OrientationError):
                    self.rb(png)
        exif = Image.Exif()
        exif[0x0112] = 6
        with self.assertRaises(ops.OrientationError):
            self.rb(self.good, encode(Image.new("L", (16, 16)), exif=exif))

    def test_palette_transparency_preserved(self):
        im = Image.new("P", (2, 1))
        im.putpalette([255, 0, 0, 0, 255, 0])
        im.putpixel((0, 0), 0)
        im.putpixel((1, 0), 1)
        png = encode(im, transparency=0)
        out = rgba(ops.remove_background(png, full_mask(1, 2)).png)
        self.assertEqual(out[0, :, 3].tolist(), [0, 255])
        self.assertEqual(out[0, 0, :3].tolist(), [255, 0, 0])


class RemoveBackgroundTests(unittest.TestCase):
    def test_exactly_one_source(self):
        img = encode(pattern(8, 8))
        calls = []
        with self.assertRaises(ops.MaskSourceError):
            ops.remove_background(img)
        with self.assertRaises(ops.MaskSourceError):
            ops.remove_background(img, full_mask(8, 8), lambda a: calls.append(1))
        self.assertEqual(calls, [])
        with self.assertRaises(TypeError):
            ops.remove_background(img, None, "not callable")

    def test_mask_mode_rejected(self):
        img = encode(pattern(8, 8))
        for mode in ("RGB", "RGBA", "LA", "P", "1", "I;16"):
            with self.subTest(mode=mode), self.assertRaises(ops.MaskError):
                ops.remove_background(img, encode(Image.new(mode, (8, 8))))

    def test_mask_size_mismatch(self):
        with self.assertRaises(ops.SizeMismatchError):
            ops.remove_background(encode(pattern(8, 8)), full_mask(8, 9))

    def test_alpha_multiplication_and_rgb_preserved(self):
        h, w = 16, 16
        y, x = np.mgrid[0:h, 0:w]
        alpha = ((x * 16 + y * 3) % 256).astype(np.uint8)
        m = ((y * 16 + x * 5) % 256).astype(np.uint8)
        m[0, 0], m[0, 1], m[0, 2] = 0, 255, 100
        src = pattern(h, w, alpha)
        res = ops.remove_background(encode(src), encode(m))
        out = rgba(res.png)
        expected = ((2 * alpha.astype(int) * m.astype(int) + 255) // 510)
        np.testing.assert_array_equal(out[..., 3], expected)
        np.testing.assert_array_equal(out[..., :3], src[..., :3])  # even where alpha == 0
        self.assertEqual((out[0, 2, 3], int(src[0, 2, 3]) * 100 // 255 <= out[0, 2, 3]), (expected[0, 2], True))
        self.assertTrue((out[..., 3][m == 0] == 0).all())

    def test_callback_contract_and_metadata(self):
        src = pattern(8, 6)
        seen = {}

        def cb(arr):
            seen["ro"] = not arr.flags.writeable
            seen["shape"], seen["dtype"] = arr.shape, arr.dtype
            return np.full(arr.shape[:2], 128, np.uint8)

        res = ops.remove_background(encode(src), segmentation_callback=cb)
        self.assertEqual(seen, {"ro": True, "shape": (8, 6, 4), "dtype": np.uint8})
        self.assertEqual(rgba(res.png)[0, 0, 3], (255 * 128 + 127) // 255)
        md = res.metadata
        self.assertEqual((md.mask_source, md.callback_used), ("callback", True))
        self.assertIsNotNone(md.mask_sha256)

    def test_provided_mask_metadata(self):
        res = ops.remove_background(encode(pattern(8, 8)), full_mask(8, 8))
        self.assertEqual((res.metadata.mask_source, res.metadata.callback_used), ("provided_mask", False))

    def test_bad_callback_results(self):
        img = encode(pattern(8, 6))
        bad_values = [
            lambda a: np.zeros((6, 8), np.float32),
            lambda a: np.zeros((6, 8), bool),
            lambda a: np.zeros((6, 8), np.uint8),
            lambda a: np.zeros((6, 8, 1), np.uint8),
            lambda a: [[0] * 8] * 6,
            lambda a: None,
        ]
        for cb in bad_values:
            with self.assertRaises(ops.CallbackError):
                ops.remove_background(img, segmentation_callback=cb)

        def boom(a):
            raise RuntimeError("secret detail")

        with self.assertRaises(ops.CallbackError) as cm:
            ops.remove_background(img, segmentation_callback=boom)
        self.assertIsInstance(cm.exception.__cause__, RuntimeError)
        self.assertNotIn("secret", str(cm.exception))

    def test_cancel(self):
        with self.assertRaises(ops.OperationCancelled):
            ops.remove_background(encode(pattern(8, 8)), full_mask(8, 8), cancel_check=lambda: True)
        with self.assertRaises(TypeError):
            ops.remove_background(encode(pattern(8, 8)), full_mask(8, 8), cancel_check=5)


class CompositeTests(unittest.TestCase):
    def setUp(self):
        n = 32
        y, x = np.mgrid[0:n, 0:n]
        self.src = pattern(n, n, np.where((x + y) % 3 == 0, 0, 200).astype(np.uint8))
        self.pred = pattern(n, n)[::-1].copy()
        self.pred[..., :3] = 255 - self.pred[..., :3]
        self.sp, self.pp = encode(self.src), encode(self.pred)
        self.m = square_mask()
        self.mp = encode(self.m)
        self.support = self.m == 255

    def test_outside_exact_and_inside_prediction_when_unfeathered(self):
        out = rgba(ops.composite_erase_result(self.sp, self.mp, self.pp, 0).png)
        np.testing.assert_array_equal(out[~self.support], self.src[~self.support])
        np.testing.assert_array_equal(out[self.support], self.pred[self.support])

    def test_feather_support_containment(self):
        for f in (0.5, 2.5, 6, 64):
            res = ops.composite_erase_result(self.sp, self.mp, self.pp, f)
            out = rgba(res.png)
            np.testing.assert_array_equal(out[~self.support], self.src[~self.support])
        one = np.zeros((32, 32), np.uint8)
        one[16, 16] = 255
        out = rgba(ops.composite_erase_result(self.sp, encode(one), self.pp, ops.MAX_FEATHER_PX).png)
        keep = one == 0
        np.testing.assert_array_equal(out[keep], self.src[keep])

    def test_feather_is_soft_inside_support(self):
        src = np.zeros((32, 32, 4), np.uint8)
        src[..., :] = (10, 20, 30, 255)
        pred = np.zeros_like(src)
        pred[..., :] = (200, 100, 50, 255)
        out = rgba(ops.composite_erase_result(encode(src), self.mp, encode(pred), 3).png)
        self.assertTrue(10 < out[8, 8, 0] < 200)
        self.assertGreaterEqual(out[16, 16, 0], 180)
        inside = out[self.support]
        self.assertTrue((inside[:, 0] >= 10).all() and (inside[:, 0] <= 200).all())

    def test_no_halo_from_transparent_source_rgb(self):
        src = np.zeros((32, 32, 4), np.uint8)
        src[..., :] = (255, 0, 0, 0)
        pred = np.zeros_like(src)
        pred[..., :] = (0, 0, 255, 255)
        out = rgba(ops.composite_erase_result(encode(src), self.mp, encode(pred), 3).png)
        vis = out[self.support & (out[..., 3] > 0)]
        self.assertTrue(len(vis) > 0)
        self.assertTrue((vis[:, :3] == (0, 0, 255)).all())
        self.assertTrue(0 < out[8, 8, 3] < 255)

    def test_zero_mask_returns_source(self):
        res = ops.composite_erase_result(self.sp, full_mask(32, 32, 0), self.pp, 5)
        np.testing.assert_array_equal(rgba(res.png), self.src)
        self.assertFalse(res.metadata.prediction_used)
        self.assertIsNotNone(res.metadata.prediction_sha256)

    def test_full_mask_uses_prediction(self):
        res = ops.composite_erase_result(self.sp, full_mask(32, 32), self.pp, 0)
        np.testing.assert_array_equal(rgba(res.png), self.pred)
        self.assertTrue(res.metadata.prediction_used)

    def test_invalid_feather(self):
        for bad in (True, "2", None, [1]):
            with self.assertRaises(TypeError):
                ops.composite_erase_result(self.sp, self.mp, self.pp, bad)
        for bad in (-1, float("nan"), float("inf"), ops.MAX_FEATHER_PX + 1, 10 ** 400):
            with self.assertRaises(ops.ParameterError):
                ops.composite_erase_result(self.sp, self.mp, self.pp, bad)

    def test_mask_validation(self):
        soft = self.m.copy()
        soft[10, 10] = 128
        with self.assertRaises(ops.MaskError):
            ops.composite_erase_result(self.sp, encode(soft), self.pp, 0)
        with self.assertRaises(ops.MaskError):
            ops.composite_erase_result(self.sp, encode(Image.new("RGB", (32, 32))), self.pp, 0)

    def test_size_mismatch(self):
        with self.assertRaises(ops.SizeMismatchError):
            ops.composite_erase_result(self.sp, self.mp, encode(pattern(31, 32)), 0)
        with self.assertRaises(ops.SizeMismatchError):
            ops.composite_erase_result(self.sp, full_mask(32, 31), self.pp, 0)


class ResizeTests(unittest.TestCase):
    def dims(self, w, h, bw, bh, keep):
        res = ops.resize_png(encode(pattern(h, w)), bw, bh, keep)
        out = rgba(res.png)
        self.assertEqual(out.shape[:2][::-1], (res.metadata.output_width, res.metadata.output_height))
        return out.shape[1], out.shape[0]

    def test_exact_and_fit(self):
        self.assertEqual(self.dims(20, 10, 7, 33, False), (7, 33))
        self.assertEqual(self.dims(100, 50, 40, 40, True), (40, 20))
        self.assertEqual(self.dims(50, 100, 40, 40, True), (20, 40))
        self.assertEqual(self.dims(3, 7, 10, 10, True), (4, 10))
        self.assertEqual(self.dims(1000, 1, 10, 10, True), (10, 1))
        self.assertEqual(self.dims(10, 10, 30, 20, True), (20, 20))  # upscale fits box

    def test_invalid_params(self):
        img = encode(pattern(8, 8))
        for bad in (True, 1.5, "10", None):
            with self.assertRaises(TypeError):
                ops.resize_png(img, bad, 4, False)
            with self.assertRaises(TypeError):
                ops.resize_png(img, 4, bad, False)
        for bad in (0, -3):
            with self.assertRaises(ops.ParameterError):
                ops.resize_png(img, bad, 4, False)
        for bad in ("yes", 1, None):
            with self.assertRaises(TypeError):
                ops.resize_png(img, 4, 4, bad)

    def test_output_bound(self):
        img = encode(pattern(8, 8))
        with self.assertRaises(ops.ResourceLimitError):
            ops.resize_png(img, 11, 10, False, limits=ops.Limits(max_pixels=100, max_aggregate_pixels=1000))
        with self.assertRaises(ops.ResourceLimitError):
            ops.resize_png(img, 10 ** 9, 10 ** 9, True)

    def test_alpha_preserved(self):
        opaque = rgba(ops.resize_png(encode(pattern(16, 16)), 7, 9, False).png)
        self.assertTrue((opaque[..., 3] == 255).all())
        clear = np.zeros((16, 16, 4), np.uint8)
        clear[..., :3] = 77
        self.assertTrue((rgba(ops.resize_png(encode(clear), 5, 5, False).png)[..., 3] == 0).all())
        flat = np.zeros((16, 16, 4), np.uint8)
        flat[...] = (200, 50, 10, 100)
        out = rgba(ops.resize_png(encode(flat), 8, 8, False).png)
        self.assertTrue((abs(out[..., 3].astype(int) - 100) <= 1).all())
        self.assertTrue((abs(out[..., :3].astype(int) - (200, 50, 10)) <= 4).all())

    def test_no_halo_from_transparent_rgb(self):
        src = np.zeros((8, 16, 4), np.uint8)
        src[:, :8] = (255, 0, 0, 255)
        src[:, 8:] = (0, 0, 255, 0)  # transparent but blue
        for size in ((8, 4), (32, 16)):
            out = rgba(ops.resize_png(encode(src), size[0], size[1], False).png)
            vis = out[out[..., 3] > 0]
            self.assertTrue((vis[:, 2] <= 2).all())
            strong = out[out[..., 3] >= 128]
            self.assertTrue((strong[:, 0] >= 250).all())

    def test_same_size_is_pixel_identity(self):
        src = pattern(6, 5, 0)
        np.testing.assert_array_equal(rgba(ops.resize_png(encode(src), 5, 6, False).png), src)


class MetadataTests(unittest.TestCase):
    def test_deterministic_hashes(self):
        img = encode(pattern(16, 16))
        a = ops.resize_png(img, 8, 8, True)
        b = ops.resize_png(img, 8, 8, True)
        self.assertEqual(a.png, b.png)
        self.assertEqual(a.metadata, b.metadata)
        md = a.metadata
        self.assertEqual(md.input_sha256, hashlib.sha256(img).hexdigest())
        self.assertEqual(md.output_sha256, hashlib.sha256(a.png).hexdigest())
        self.assertEqual((md.operation, md.input_width, md.input_height), ("resize_png", 16, 16))
        self.assertEqual((md.output_width, md.output_height), (8, 8))
        self.assertFalse(md.callback_used or md.prediction_used)
        self.assertIsNone(md.mask_source)

    def test_composite_metadata(self):
        n = 32
        sp, pp = encode(pattern(n, n)), encode(pattern(n, n)[::-1].copy())
        mp = encode(square_mask())
        md = ops.composite_erase_result(sp, mp, pp, 2).metadata
        self.assertEqual(md.prediction_sha256, hashlib.sha256(pp).hexdigest())
        self.assertEqual(md.input_sha256, hashlib.sha256(sp).hexdigest())
        self.assertEqual(md.mask_sha256, hashlib.sha256(square_mask().tobytes()).hexdigest())
        self.assertEqual(dict(md.parameters)["feather_px"], "2.0")
        self.assertTrue(md.prediction_used)

    def test_frozen_and_strict(self):
        res = ops.resize_png(encode(pattern(4, 4)), 2, 2, False)
        with self.assertRaises(dataclasses.FrozenInstanceError):
            res.metadata.operation = "x"
        with self.assertRaises(dataclasses.FrozenInstanceError):
            res.png = b""
        d = dataclasses.asdict(res.metadata)
        self.assertTrue(all(isinstance(v, (str, int, bool, type(None), tuple, list)) for v in d.values()))
        with self.assertRaises(ValueError):
            dataclasses.replace(res.metadata, output_sha256="abc")
        with self.assertRaises(ValueError):
            dataclasses.replace(res.metadata, operation="other")
        with self.assertRaises(ValueError):
            dataclasses.replace(res.metadata, callback_used=True)
        with self.assertRaises(ValueError):
            ops.ImageResult(b"not the hashed bytes", res.metadata)


class ReviewedBoundaryTests(unittest.TestCase):
    """Codex review regressions, added after preserving the original draft."""

    def test_defaults_and_explicit_output_limit(self):
        self.assertEqual(ops.DEFAULT_LIMITS.max_pixels, 16 * 1024 * 1024)
        self.assertEqual(ops.DEFAULT_LIMITS.max_output_png_bytes, 16 * 1024 * 1024)
        for bad in (0, -1, True, 1.5):
            with self.assertRaises(ValueError):
                ops.Limits(max_output_png_bytes=bad)

    def test_each_operation_bounds_encoded_output(self):
        source = encode(pattern(16, 16))
        mask = full_mask(16, 16)
        limits = ops.Limits(max_output_png_bytes=64)
        operations = [
            lambda: ops.remove_background(source, mask, limits=limits),
            lambda: ops.composite_erase_result(source, mask, source, 0, limits=limits),
            lambda: ops.resize_png(source, 8, 8, False, limits=limits),
        ]
        for operation in operations:
            with self.subTest(operation=operation), self.assertRaises(ops.ResourceLimitError):
                operation()

    def test_duplicate_iend_and_invalid_chunk_crc_are_rejected(self):
        import zlib
        source = encode(pattern(4, 4))
        bad_chunk = struct.pack('>I', 3) + b'tEXt' + b'a\x00b' + struct.pack('>I', 0)
        self.assertNotEqual(zlib.crc32(b'tEXta\x00b'), 0)
        for malformed in (source + ops._PNG_IEND, source[:-12] + bad_chunk + source[-12:]):
            with self.subTest(malformed=malformed[-32:]), self.assertRaises(ops.InvalidImageError):
                ops.resize_png(malformed, 4, 4, False)

    def test_cancel_after_decode_before_result_encoding(self):
        source = encode(pattern(16, 16))
        mask = full_mask(16, 16)
        for operation in (
            lambda check: ops.remove_background(source, mask, cancel_check=check),
            lambda check: ops.composite_erase_result(source, mask, source, 0, cancel_check=check),
            lambda check: ops.resize_png(source, 8, 8, False, cancel_check=check),
        ):
            calls = []
            def check():
                calls.append(True)
                return len(calls) >= 3
            with self.subTest(operation=operation), self.assertRaises(ops.OperationCancelled):
                operation(check)

    def test_large_selected_region_observes_cancellation_during_work(self):
        source = encode(pattern(512, 512))
        mask = full_mask(512, 512)
        calls = []
        def check():
            calls.append(True)
            return len(calls) >= 4
        with self.assertRaises(ops.OperationCancelled):
            ops.composite_erase_result(source, mask, source, 0, cancel_check=check)

    def test_callback_cannot_mutate_original_rgb(self):
        original = pattern(9, 7, 173)
        source = encode(original)
        def callback(copy):
            copy.flags.writeable = True
            copy[..., :3] = 0
            return np.full((9, 7), 128, dtype=np.uint8)
        out = rgba(ops.remove_background(source, segmentation_callback=callback).png)
        np.testing.assert_array_equal(out[..., :3], original[..., :3])
        np.testing.assert_array_equal(out[..., 3], np.full((9, 7), 87, dtype=np.uint8))





# Claude public markup test draft, imports adapted by Codex.
import io
import math
import unittest
from unittest import mock

import numpy as np
from PIL import Image

from pankeki import imageops as M
from pankeki.imageops import (Limits, ParameterError, ResourceLimitError,
                     OperationCancelled)


def _png(arr):
    b = io.BytesIO()
    Image.fromarray(np.ascontiguousarray(arr, dtype=np.uint8)).save(b, "PNG")
    return b.getvalue()


def _dec(png):
    return np.array(Image.open(io.BytesIO(png)).convert("RGBA"))


def _solid(w, h, rgba):
    a = np.zeros((h, w, 4), np.uint8)
    a[:] = rgba
    return a


def _st(points, color="#000000", width=3, opacity=1.0):
    return {"points": [{"x": x, "y": y} for x, y in points],
            "color": color, "width": width, "opacity": opacity}


def _params(res):
    return dict(res.metadata.parameters)


def _cov_black_on_white(out):
    return float(((255 - out[..., 0].astype(float)) / 255.0).sum())


def _seg_dist(px, py, a, b):
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    l2 = dx * dx + dy * dy
    t = 0.0 if l2 == 0 else np.clip(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1)
    return np.hypot(px - (ax + t * dx), py - (ay + t * dy))


class MarkupPngTests(unittest.TestCase):

    def run_markup(self, arr, strokes, **kw):
        return M.markup_png(_png(arr), strokes, **kw)

    # ---- geometry -------------------------------------------------------
    def test_single_point_is_round_dot(self):
        base = _solid(41, 41, (255, 255, 255, 255))
        out = _dec(self.run_markup(base, [_st([(20, 20)], "#FF0000", 15, 1.0)]).png)
        yy, xx = np.mgrid[0:41, 0:41]
        d = np.hypot(xx - 20, yy - 20)
        self.assertTrue((out[d <= 6.0] == (255, 0, 0, 255)).all())
        self.assertTrue((out[d >= 8.5] == (255, 255, 255, 255)).all())
        diff = np.abs(out.astype(int) - out.transpose(1, 0, 2).astype(int)).max()
        self.assertLessEqual(diff, 1)
        area = (255 - out[..., 1].astype(float)).sum() / 255.0
        self.assertAlmostEqual(area, math.pi * 7.5 ** 2, delta=0.04 * math.pi * 7.5 ** 2)

    def test_segment_continuity_and_round_caps(self):
        base = _solid(40, 21, (255, 255, 255, 255))
        out = _dec(self.run_markup(base, [_st([(3, 10), (36, 10)], width=3)]).png)
        self.assertTrue((out[10, 2:38, :3] == 0).all())
        self.assertTrue((out[10, :2] == 255).all())      # cap ends at x=2.0
        self.assertTrue((out[10, 38:] == 255).all())
        diag = _dec(self.run_markup(_solid(40, 40, (255, 255, 255, 255)),
                                    [_st([(2, 2), (30, 30), (30, 5)], width=3)]).png)
        for x in range(2, 31):
            self.assertGreater(((255 - diag[:, x, 0]) / 255.0).max(), 0.5)

    def test_width_scales_in_natural_coordinates(self):
        for w in (2, 3, 4, 8):
            base = _solid(41, 41, (255, 255, 255, 255))
            out = _dec(self.run_markup(base, [_st([(5, 20), (35, 20)], width=w)]).png)
            col = ((255 - out[:, 20, 0].astype(float)) / 255.0).sum()
            self.assertAlmostEqual(col, w, delta=0.05)

    def test_canvas_edge_clipping(self):
        base = _solid(20, 20, (255, 255, 255, 255))
        res = self.run_markup(base, [_st([(0, 0)], width=10)])
        out = _dec(res.png)
        self.assertEqual(out.shape, base.shape)
        self.assertEqual(tuple(out[0, 0]), (0, 0, 0, 255))
        g = (np.arange(8 * 40) + 0.5) / 40.0
        inside = (g[None, :] - 0.5) ** 2 + (g[:, None] - 0.5) ** 2 <= 25.0
        area = inside.sum() / 1600.0
        self.assertAlmostEqual(_cov_black_on_white(out), area, delta=0.04 * area)
        self.assertEqual(_params(res)["overlay_bbox"], "0,0,6,6")
        out2 = _dec(self.run_markup(base, [_st([(19, 19)], width=10)]).png)
        self.assertEqual(tuple(out2[19, 19]), (0, 0, 0, 255))

    # ---- identity / compositing -----------------------------------------
    def _rand_rgba(self, w=40, h=40, seed=12345):
        rng = np.random.default_rng(seed)
        a = rng.integers(0, 256, (h, w, 4), dtype=np.uint8)
        a[rng.random((h, w)) < 0.25, 3] = 0   # transparent, RGB retained
        return a

    def test_empty_opacity0_and_tiny_opacity_are_identity(self):
        base = self._rand_rgba()
        want = _dec(_png(base))
        for strokes, n in (([], 0),
                           ([_st([(5, 5), (30, 30)], width=9, opacity=0.0)], 1),
                           ([_st([(5, 5), (30, 30)], width=9, opacity=1e-4)], 1)):
            res = self.run_markup(base, strokes)
            self.assertTrue(np.array_equal(_dec(res.png), want))
            p = _params(res)
            self.assertEqual(p["stroke_count"], str(n))
            self.assertEqual(p["overlay_positive_pixels"], "0")
            self.assertEqual(p["overlay_bbox"], "empty")

    def test_translucent_source_over(self):
        base = _solid(21, 21, (200, 100, 50, 255))
        out = _dec(self.run_markup(base, [_st([(10, 10)], "#0000FF", 12, 0.5)]).png)
        exp = [200 * 0.5, 100 * 0.5, 255 * 0.5 + 50 * 0.5]
        for c in range(3):
            self.assertAlmostEqual(int(out[10, 10, c]), exp[c], delta=2)
        self.assertEqual(out[10, 10, 3], 255)
        # over alpha-0 pixel: colour is stroke colour, alpha ~ opacity
        t = _solid(21, 21, (9, 8, 7, 0))
        o = _dec(self.run_markup(t, [_st([(10, 10)], "#0000FF", 12, 0.5)]).png)
        self.assertLessEqual(max(abs(int(o[10, 10, 0])), abs(int(o[10, 10, 1]))), 1)
        self.assertAlmostEqual(int(o[10, 10, 2]), 255, delta=1)
        self.assertAlmostEqual(int(o[10, 10, 3]), 127.5, delta=1)
        # opaque stroke over semi-transparent pixel -> opaque stroke colour
        s = _solid(21, 21, (100, 100, 100, 128))
        o = _dec(self.run_markup(s, [_st([(10, 10)], "#FF0000", 12, 1.0)]).png)
        self.assertEqual(tuple(o[10, 10]), (255, 0, 0, 255))

    def test_stroke_order_matters(self):
        base = _solid(21, 21, (255, 255, 255, 255))
        r, b = _st([(10, 10)], "#FF0000", 12, 0.5), _st([(10, 10)], "#0000FF", 12, 0.5)
        o1 = _dec(self.run_markup(base, [r, b]).png)[10, 10]
        o2 = _dec(self.run_markup(base, [b, r]).png)[10, 10]
        for got, exp in ((o1, (127.5, 63.75, 191.25)), (o2, (191.25, 63.75, 127.5))):
            for c in range(3):
                self.assertAlmostEqual(int(got[c]), exp[c], delta=3)

    def test_exact_rgba_outside_final_overlay_support(self):
        base = self._rand_rgba()
        a, b = (10.0, 10.0), (30.0, 25.0)
        strokes = [_st([a, b], "#336699", 6, 0.7),
                   _st([(5, 35)], "#FFFFFF", 4, 1e-5)]   # rounds to nothing
        res = self.run_markup(base, strokes)
        out, src = _dec(res.png), _dec(_png(base))
        yy, xx = np.mgrid[0:40, 0:40]
        d = _seg_dist(xx.astype(float), yy.astype(float), a, b)
        self.assertTrue(np.array_equal(out[d > 4.0], src[d > 4.0]))
        self.assertTrue((out[d <= 2.0] != src[d <= 2.0]).any(axis=1).all())
        changed = (out != src).any(axis=2)
        self.assertLessEqual(int(changed.sum()), int(_params(res)["overlay_positive_pixels"]))
        self.assertFalse(changed[33:38, 3:8].any())      # sub-quantum stroke

    # ---- metadata -------------------------------------------------------
    def test_deterministic_metadata_and_counts(self):
        base = _solid(40, 30, (255, 255, 255, 255))
        strokes = [_st([(5, 5), (20, 15), (30, 8)], width=4),
                   _st([(2, 25)], width=3, opacity=0.0)]
        r1 = self.run_markup(base, strokes)
        r2 = self.run_markup(base, strokes)
        self.assertEqual(r1.png, r2.png)
        self.assertEqual(r1.metadata, r2.metadata)
        m, p = r1.metadata, _params(r1)
        self.assertEqual(m.operation, "markup_png")
        self.assertEqual((m.input_width, m.input_height, m.output_width, m.output_height),
                         (40, 30, 40, 30))
        self.assertFalse(m.callback_used)
        self.assertFalse(m.prediction_used)
        self.assertIsNone(m.mask_source)
        self.assertEqual((p["stroke_count"], p["point_count"], p["supersample"]), ("2", "4", "4"))
        out = _dec(r1.png)
        ch = (out != _dec(_png(base))).any(axis=2)
        self.assertEqual(int(p["overlay_positive_pixels"]), int(ch.sum()))
        ys, xs = np.nonzero(ch)
        self.assertEqual(p["overlay_bbox"],
                         "%d,%d,%d,%d" % (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
        for k, v in m.parameters:
            self.assertIsInstance(k, str)
            self.assertIsInstance(v, str)

    def test_caller_mutation_during_execution_is_ignored(self):
        base = _solid(30, 30, (255, 255, 255, 255))
        strokes = [_st([(5, 5), (20, 20)], width=3), _st([(5, 20), (25, 5)], width=3)]
        want = self.run_markup(base, strokes).png

        def mutate():
            strokes[1]["points"][0]["x"] = float("nan")
            strokes[1]["opacity"] = 0.0
            strokes.append("junk")
            return False
        self.assertEqual(self.run_markup(base, strokes, cancel_check=mutate).png, want)

    # Codex review regressions for resource and final-encode boundaries.
    def test_wide_supersample_band_has_a_hard_predecode_cap(self):
        source = _png(_solid(70000, 1, (12, 34, 56, 255)))
        with mock.patch.object(M, "_rgba_array", side_effect=AssertionError("decoded before working cap")):
            with self.assertRaises(ResourceLimitError):
                M.markup_png(source, [_st([(0, 0), (69999, 0)], width=1)])

    def test_zero_coverage_does_not_allocate_supersample_work(self):
        base = _solid(32, 32, (19, 23, 41, 0))
        limits = Limits(max_pixels=1024, max_aggregate_pixels=2048)
        for opacity in (0.0, 0.0001):
            result = self.run_markup(base, [_st([(16, 16)], width=256, opacity=opacity)], limits=limits)
            np.testing.assert_array_equal(_dec(result.png), base)
            self.assertEqual(_params(result)["overlay_positive_pixels"], "0")

    def test_cancellation_is_retained_through_result_encoding(self):
        calls = []
        def check():
            calls.append(True)
            return len(calls) >= 4
        with self.assertRaises(OperationCancelled):
            self.run_markup(_solid(8, 8, (0, 0, 0, 0)), [], cancel_check=check)

    # ---- validation -----------------------------------------------------
    def test_accepts_boundaries_and_ints(self):
        base = _solid(10, 8, (255, 255, 255, 255))
        for w in (1, 256, 1.0):
            self.run_markup(base, [_st([(0, 0), (9, 7)], width=w, opacity=1)])

    def test_rejects_malformed_input(self):
        base = _solid(10, 8, (255, 255, 255, 255))
        ok = lambda **o: {**_st([(1, 1)]), **o}
        pt = lambda **o: {"points": [{"x": 1, "y": 1, **o}], "color": "#000000",
                          "width": 2, "opacity": 1}
        bad = [
            None, (), (ok(),), {"a": 1}, ["x"],
            [{k: v for k, v in ok().items() if k != "width"}],
            [ok(extra=1)],
            [ok(points=[])], [ok(points=())], [ok(points=[(1, 1)])],
            [ok(points=[{"x": 1}])], [ok(points=[{"x": 1, "y": 1, "z": 2}])],
            [ok(points=[{"x": "1", "y": 1}])], [ok(points=[{"x": True, "y": 1}])],
            [ok(points=[{"x": None, "y": 1}])],
            [ok(points=[{"x": float("nan"), "y": 1}])],
            [ok(points=[{"x": 1, "y": float("inf")}])],
            [ok(points=[{"x": -float("inf"), "y": 1}])],
            [ok(points=[{"x": -0.501, "y": 1}])], [ok(points=[{"x": 9.501, "y": 1}])],
            [ok(points=[{"x": 1, "y": 7.501}])], [ok(points=[{"x": 1, "y": -1}])],
            [ok(points=[{"x": 10**400, "y": 1}])],
            [ok(color="red")], [ok(color="#FFF")], [ok(color="#GGGGGG")],
            [ok(color="#000000\n")], [ok(color="000000")], [ok(color="#0000000")],
            [ok(color=0)], [ok(color=None)],
            [ok(width=0.99)], [ok(width=256.01)], [ok(width=float("nan"))],
            [ok(width=float("inf"))], [ok(width=True)], [ok(width="3")],
            [ok(opacity=-0.01)], [ok(opacity=1.01)], [ok(opacity=float("nan"))],
            [ok(opacity=True)], [ok(opacity=None)], [ok(opacity="1")],
        ]
        for i, s in enumerate(bad):
            with self.subTest(i=i):
                with self.assertRaises(ParameterError):
                    self.run_markup(base, s)
        # unknown keys inside point dicts (via helper) and bool-in-point
        with self.assertRaises(ParameterError):
            self.run_markup(base, [pt(z=1)])

    def test_count_caps(self):
        base = _solid(10, 8, (255, 255, 255, 255))
        one = _st([(1, 1)])
        self.run_markup(base, [one] * M.MARKUP_MAX_STROKES)
        with self.assertRaises(ParameterError):
            self.run_markup(base, [one] * (M.MARKUP_MAX_STROKES + 1))
        pts = [(1, 1)] * M.MARKUP_MAX_POINTS_PER_STROKE
        self.run_markup(base, [_st(pts, opacity=0.0)])
        with self.assertRaises(ParameterError):
            self.run_markup(base, [_st(pts + [(1, 1)])])
        per = M.MARKUP_MAX_TOTAL_POINTS // 5 + 1      # 5 strokes exceed total cap
        self.assertLessEqual(per, M.MARKUP_MAX_POINTS_PER_STROKE)
        with self.assertRaises(ParameterError):
            self.run_markup(base, [_st([(1, 1)] * per, opacity=0.0)] * 5)

    # ---- resource limits ------------------------------------------------
    def test_oversize_supersampling_rejected_before_decode(self):
        base = _solid(32, 32, (255, 255, 255, 255))
        png = _png(base)
        lim = Limits(max_png_bytes=1 << 20, max_pixels=1024, max_aggregate_pixels=4096,
                     max_output_png_bytes=1 << 20)
        # small stroke fits: 3x3 region -> 12x12 hi-res
        M.markup_png(png, [_st([(16, 16)], width=1)], limits=lim)
        # near full-canvas stroke: 128x128 hi-res > max_pixels
        with mock.patch.object(M, "_rgba_array", side_effect=AssertionError("decoded")):
            with self.assertRaises(ResourceLimitError):
                M.markup_png(png, [_st([(16, 16)], width=60)], limits=lim)

    # ---- cancellation ---------------------------------------------------
    def _canceller(self, k):
        calls = [0]

        def f():
            calls[0] += 1
            return k is not None and calls[0] >= k
        return f, calls

    def test_cancellation_points(self):
        base = _solid(30, 30, (255, 255, 255, 255))
        png = _png(base)
        s1 = [_st([(5, 5), (20, 20)], width=3)]
        s2 = s1 + [_st([(5, 20), (25, 5)], width=3)]
        f, c1 = self._canceller(None)
        M.markup_png(png, s1, cancel_check=f)
        f, c2 = self._canceller(None)
        M.markup_png(png, s2, cancel_check=f)
        n1, n2 = c1[0], c2[0]
        self.assertGreater(n2, n1)          # polled between strokes
        for k in range(1, n2 + 1):
            f, _ = self._canceller(k)
            with self.assertRaises(OperationCancelled):
                M.markup_png(png, s2, cancel_check=f)
        # cancel at the first poll: nothing decoded
        with mock.patch.object(M, "_rgba_array", side_effect=AssertionError("decoded")):
            f, _ = self._canceller(1)
            with self.assertRaises(OperationCancelled):
                M.markup_png(png, s1, cancel_check=f)
        # The full range above includes result/PNG-writer cancellation polls.
        # Replacing _result would remove those real polls and invalidate n1/n2.





class MarkupCoordinateCompatTests(unittest.TestCase):
    """HTTP corner coordinates are translated by -.5 before this helper."""

    def test_corner_edge_centers_clip_without_moving_the_dot(self):
        source = _solid(8, 6, (9, 8, 7, 0))
        # A radius1 circle centered exactly on a canvas corner covers13/16
        # quarter-pixel samples in that corner pixel: round(255*13/16)=207.
        for x, y, px, py in [(-.5, -.5, 0, 0), (7.5, -.5, 7, 0),
                              (-.5, 5.5, 0, 5), (7.5, 5.5, 7, 5)]:
            with self.subTest(point=(x, y)):
                result = M.markup_png(_png(source), [_st([(x, y)], '#123456', 2)])
                out = _dec(result.png)
                self.assertEqual(tuple(out[py, px]), (0x12, 0x34, 0x56, 207))
                untouched = np.ones((6, 8), dtype=bool)
                untouched[py, px] = False
                np.testing.assert_array_equal(out[untouched], source[untouched])
                self.assertEqual(_params(result)['overlay_positive_pixels'], '1')
                self.assertEqual(_params(result)['overlay_bbox'], f'{px},{py},{px+1},{py+1}')

    def test_half_pixel_mapping_keeps_actual_interior_position_and_alpha(self):
        source = _solid(8, 6, (7, 6, 5, 0))
        # UI corner-space(4,3) -> helper(3.5,2.5). Radius.5 at the pixel
        # intersection covers3/16 samples in each adjacent pixel: alpha48.
        result = M.markup_png(_png(source), [_st([(3.5, 2.5)], '#FF0000', 1)])
        out = _dec(result.png)
        expected = source.copy()
        expected[2:4, 3:5] = (255, 0, 0, 48)
        np.testing.assert_array_equal(out, expected)
        self.assertEqual(_params(result)['overlay_bbox'], '3,2,5,4')

    def test_edge_to_edge_stroke_retains_full_natural_width_and_clip(self):
        source = _solid(8, 6, (13, 17, 19, 0))
        # UI(0,2)->(8,2), translated only at the HTTP boundary.
        result = M.markup_png(_png(source), [_st([(-.5, 1.5), (7.5, 1.5)], '#00FF00', 2)])
        out = _dec(result.png)
        expected = source.copy()
        expected[1:3, :] = (0, 255, 0, 255)
        np.testing.assert_array_equal(out, expected)
        self.assertEqual(_params(result)['overlay_bbox'], '0,1,8,3')
        self.assertEqual(_params(result)['overlay_positive_pixels'], '16')

    def test_points_just_outside_expanded_domain_are_rejected(self):
        source = _png(_solid(8, 6, (1, 2, 3, 0)))
        for point in [(-.500001, 0), (7.500001, 0), (0, -.500001), (0, 5.500001)]:
            with self.subTest(point=point), self.assertRaises(ParameterError):
                M.markup_png(source, [_st([point], width=1)])


if __name__ == "__main__":
    unittest.main()

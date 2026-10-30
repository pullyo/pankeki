"""imageops: small, bytes-in / PNG-bytes-out image helpers (Pillow + numpy).

Initial implementation: Claude public-spec draft. Codex review additions:
bounded PNG encoding/chunk validation, 16 MP limits and cancellable chunk work.

Scope and non-claims
--------------------
* All image inputs are ``bytes`` holding a PNG; all image outputs are PNG bytes.
  No paths, URLs, network, subprocesses, model loading or global state.
* Nothing here segments objects or inpaints. ``remove_background`` applies a
  mask the caller supplies (data or callback). ``composite_erase_result``
  blends a prediction the caller supplies. Segmentation quality, inpainting
  quality and visual/product acceptance are outside these helpers' claims.

Decoding policy
---------------
* PNG only (signature, IHDR first, file ends exactly at IEND). Trailing bytes,
  truncation, APNG/multi-frame, and modes other than 1, L, LA, P, RGB, RGBA are
  rejected. Images are converted to 8-bit RGBA (palette/tRNS transparency is
  honoured by Pillow's conversion). Gamma/ICC chunks are NOT applied.
* Dimensions and byte length are checked from the IHDR *before* decoding;
  an aggregate pixel budget (all inputs + output) is checked before allocation.
* Orientation: a PNG EXIF orientation other than 1 is REJECTED
  (OrientationError), never applied, so mask coordinates are unambiguous.
  Absent or 1 means identity.
"""
from __future__ import annotations

import hashlib
import io
import math
import re
import numbers
import struct
import zlib
from dataclasses import dataclass
from typing import Callable, Optional, Tuple

import numpy as np
from PIL import Image, ImageFilter

__all__ = [
    "SCHEMA_VERSION", "MAX_FEATHER_PX", "Limits", "DEFAULT_LIMITS", "Metadata",
    "ImageResult", "ImageOpsError", "InvalidImageError", "UnsupportedImageError",
    "ResourceLimitError", "OrientationError", "MaskError", "MaskSourceError",
    "SizeMismatchError", "CallbackError", "ParameterError", "OperationCancelled",
    "remove_background", "composite_erase_result", "resize_png", "markup_png",
]

SCHEMA_VERSION = 1
MAX_FEATHER_PX = 64.0
_PNG_SIG = b"\x89PNG\r\n\x1a\n"
_PNG_IEND = b"\x00\x00\x00\x00IEND\xaeB`\x82"
_EXIF_ORIENTATION = 0x0112
_IMAGE_MODES = frozenset({"1", "L", "LA", "P", "RGB", "RGBA"})
_OPERATIONS = frozenset({"remove_background", "composite_erase_result", "resize_png", "markup_png"})
_RESAMPLING = getattr(Image, "Resampling", Image)


# ----------------------------------------------------------------- errors ---
class ImageOpsError(Exception):
    """Base class for all errors raised deliberately by this module."""


class InvalidImageError(ImageOpsError):
    """Malformed, truncated, trailing-garbage or undecodable PNG."""


class UnsupportedImageError(ImageOpsError):
    """Well-formed but unsupported PNG (multi-frame, unsupported mode)."""


class ResourceLimitError(ImageOpsError):
    """Byte-length, pixel or aggregate budget exceeded."""


class OrientationError(ImageOpsError):
    """Non-identity EXIF orientation (rejected, not applied)."""


class MaskError(ImageOpsError):
    """Mask has an unsuitable mode / encoding / values."""


class SizeMismatchError(ImageOpsError):
    """Image, mask and/or prediction dimensions differ."""


class CallbackError(ImageOpsError):
    """Caller callback raised or returned an unusable value."""


class OperationCancelled(ImageOpsError):
    """cancel_check() reported cancellation."""


class ParameterError(ImageOpsError, ValueError):
    """Invalid parameter value (wrong type raises TypeError instead)."""


class MaskSourceError(ParameterError):
    """Not exactly one mask source was supplied."""


# ------------------------------------------------------------ data classes ---
@dataclass(frozen=True)
class Limits:
    """Resource bounds. All values are positive ints.

    max_png_bytes: max length of each input PNG byte string.
    max_pixels: max width*height of any single input or output image.
    max_aggregate_pixels: max summed pixels of all inputs plus the output.
    max_output_png_bytes: hard cap checked during PNG encoding.
    Defaults (16 MP / ~64 MP aggregate) are explicit, not measured peak RAM.
    """
    max_png_bytes: int = 32 * 1024 * 1024
    max_pixels: int = 16_777_216
    max_aggregate_pixels: int = 67_108_864
    max_output_png_bytes: int = 16 * 1024 * 1024

    def __post_init__(self):
        for name in ("max_png_bytes", "max_pixels", "max_aggregate_pixels", "max_output_png_bytes"):
            v = getattr(self, name)
            if type(v) is not int or v <= 0:
                raise ValueError(f"{name} must be a positive int")
        if self.max_aggregate_pixels < self.max_pixels:
            raise ValueError("max_aggregate_pixels must be >= max_pixels")


DEFAULT_LIMITS = Limits()


def _is_sha(s) -> bool:
    return isinstance(s, str) and len(s) == 64 and all(c in "0123456789abcdef" for c in s)


@dataclass(frozen=True)
class Metadata:
    """Deterministic provenance of one operation (no paths, secrets or refs).

    input_sha256 / prediction_sha256: SHA-256 of the supplied PNG byte strings.
    mask_sha256: SHA-256 of the final 8-bit mask pixels (row-major, no header),
        for a provided mask and a callback mask alike.
    output_sha256: SHA-256 of the output PNG bytes.
    mask_source: None, "provided_mask" or "callback". A mask is data; this does
        NOT assert that any model ran or that the mask is semantically right.
    callback_used: a caller callback produced the mask.
    prediction_used: a caller prediction influenced the output (False when the
        mask was empty, even though the prediction was validated).
    parameters: sorted-by-insertion (name, str(value)) pairs.
    """
    operation: str
    input_width: int
    input_height: int
    output_width: int
    output_height: int
    input_sha256: str
    output_sha256: str
    mask_source: Optional[str] = None
    mask_sha256: Optional[str] = None
    prediction_sha256: Optional[str] = None
    callback_used: bool = False
    prediction_used: bool = False
    parameters: Tuple[Tuple[str, str], ...] = ()
    schema_version: int = SCHEMA_VERSION

    def __post_init__(self):
        if self.operation not in _OPERATIONS:
            raise ValueError("unknown operation")
        if self.schema_version != SCHEMA_VERSION:
            raise ValueError("unsupported schema_version")
        for n in ("input_width", "input_height", "output_width", "output_height"):
            v = getattr(self, n)
            if type(v) is not int or v <= 0:
                raise ValueError(f"{n} must be a positive int")
        if not _is_sha(self.input_sha256) or not _is_sha(self.output_sha256):
            raise ValueError("input/output sha256 must be 64 lowercase hex chars")
        for n in ("mask_sha256", "prediction_sha256"):
            v = getattr(self, n)
            if v is not None and not _is_sha(v):
                raise ValueError(f"{n} must be None or 64 lowercase hex chars")
        if self.mask_source not in (None, "provided_mask", "callback"):
            raise ValueError("invalid mask_source")
        if type(self.callback_used) is not bool or type(self.prediction_used) is not bool:
            raise ValueError("callback_used/prediction_used must be bool")
        if self.callback_used != (self.mask_source == "callback"):
            raise ValueError("callback_used inconsistent with mask_source")
        if not isinstance(self.parameters, tuple) or not all(
            isinstance(p, tuple) and len(p) == 2 and all(isinstance(x, str) for x in p)
            for p in self.parameters
        ):
            raise ValueError("parameters must be a tuple of (str, str) pairs")


@dataclass(frozen=True)
class ImageResult:
    """Output PNG bytes (8-bit RGBA) plus its Metadata."""
    png: bytes
    metadata: Metadata

    def __post_init__(self):
        if not isinstance(self.png, bytes) or not isinstance(self.metadata, Metadata):
            raise TypeError("png must be bytes and metadata a Metadata")
        if hashlib.sha256(self.png).hexdigest() != self.metadata.output_sha256:
            raise ValueError("metadata.output_sha256 does not match png")


# ---------------------------------------------------------------- helpers ---
def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _check_common(limits, cancel_check):
    if not isinstance(limits, Limits):
        raise TypeError("limits must be a Limits instance")
    if cancel_check is not None and not callable(cancel_check):
        raise TypeError("cancel_check must be callable or None")


def _checkpoint(cancel_check):
    if cancel_check is not None and cancel_check():
        raise OperationCancelled("operation cancelled by cancel_check")


def _read_header(data, limits: Limits) -> Tuple[int, int]:
    """Validate bytes / signature / IHDR / IEND / pixel bound; return (w, h).
    Runs before any decoding so hostile headers cannot trigger allocation."""
    if not isinstance(data, bytes):
        raise TypeError("image data must be bytes")
    if len(data) > limits.max_png_bytes:
        raise ResourceLimitError("PNG byte length exceeds limit")
    if len(data) < 45 or data[:8] != _PNG_SIG or data[8:16] != b"\x00\x00\x00\rIHDR":
        raise InvalidImageError("not a PNG stream")
    if not data.endswith(_PNG_IEND):
        raise InvalidImageError("PNG is truncated or has trailing data")
    w, h = struct.unpack(">II", data[16:24])
    if w == 0 or h == 0:
        raise InvalidImageError("zero image dimension")
    if w * h > limits.max_pixels:
        raise ResourceLimitError("image pixel count exceeds limit")
    # Pillow may ignore data appended after the first IEND or some ancillary
    # CRCs. Check framing and CRCs before decoding rather than accepting it.
    offset, chunks = 8, 0
    view = memoryview(data)
    while offset < len(data):
        if len(data) - offset < 12:
            raise InvalidImageError("truncated PNG chunk")
        length = struct.unpack_from(">I", data, offset)[0]
        end = offset + length + 12
        if end > len(data):
            raise InvalidImageError("PNG chunk exceeds stream")
        kind = data[offset + 4:offset + 8]
        crc = zlib.crc32(view[offset + 4:end - 4]) & 0xffffffff
        if crc != struct.unpack_from(">I", data, end - 4)[0]:
            raise InvalidImageError("PNG chunk CRC mismatch")
        chunks += 1
        if chunks > 65536:
            raise ResourceLimitError("too many PNG chunks")
        if kind == b'IHDR' and (offset != 8 or length != 13):
            raise InvalidImageError("duplicate or invalid PNG header")
        if kind == b'acTL':
            raise UnsupportedImageError("multi-frame PNG is unsupported")
        if kind == b'IEND':
            if length or end != len(data):
                raise InvalidImageError("PNG has trailing data")
            break
        offset = end
    return w, h


def _budget(limits: Limits, *sizes):
    if sum(w * h for w, h in sizes) > limits.max_aggregate_pixels:
        raise ResourceLimitError("aggregate pixel budget exceeded")


def _open(data, limits: Limits) -> Image.Image:
    """Decode a single-frame PNG with identity orientation; mode unchecked."""
    size = _read_header(data, limits)
    try:
        img = Image.open(io.BytesIO(data), formats=["PNG"])
        if img.size != size:
            raise InvalidImageError("IHDR size disagrees with decoder")
        if getattr(img, "n_frames", 1) != 1 or getattr(img, "is_animated", False):
            raise UnsupportedImageError("multi-frame PNG is unsupported")
        img.load()
        orientation = img.getexif().get(_EXIF_ORIENTATION, 1)
    except ImageOpsError:
        raise
    except MemoryError as exc:
        raise ResourceLimitError("out of memory while decoding") from exc
    except Exception as exc:  # Pillow raises OSError/SyntaxError/ValueError/...
        raise InvalidImageError("PNG could not be decoded") from exc
    if type(orientation) is not int or orientation != 1:
        raise OrientationError("non-identity EXIF orientation is rejected, not applied")
    return img


def _rgba_array(data, limits: Limits) -> np.ndarray:
    img = _open(data, limits)
    if img.mode not in _IMAGE_MODES:
        raise UnsupportedImageError(f"unsupported PNG mode {img.mode}")
    return np.array(img.convert("RGBA"))  # (H, W, 4) uint8, writable copy


def _mask_array(data, limits: Limits) -> np.ndarray:
    img = _open(data, limits)
    if img.mode != "L" or "transparency" in img.info:
        raise MaskError("mask must be an 8-bit grayscale (mode L) PNG without transparency")
    return np.array(img)  # (H, W) uint8


def _encode(img: Image.Image, limits: Limits, cancel_check=None) -> bytes:
    class BoundedPNGBuffer(io.BytesIO):
        def write(self, data):
            _checkpoint(cancel_check)
            if self.tell() + len(data) > limits.max_output_png_bytes:
                raise ResourceLimitError("encoded PNG byte length exceeds limit")
            return super().write(data)
    _checkpoint(cancel_check)
    buf = BoundedPNGBuffer()
    img.save(buf, format="PNG", compress_level=6)
    _checkpoint(cancel_check)
    return buf.getvalue()


def _from_rgba(arr: np.ndarray) -> Image.Image:
    return Image.fromarray(np.ascontiguousarray(arr, dtype=np.uint8))


def _result(operation, input_png, in_size, out_img, *, mask_source=None, mask=None,
            prediction_png=None, callback_used=False, prediction_used=False,
            parameters=(), limits=DEFAULT_LIMITS, cancel_check=None) -> ImageResult:
    _checkpoint(cancel_check)
    png = _encode(out_img, limits, cancel_check)
    meta = Metadata(
        operation=operation,
        input_width=in_size[0], input_height=in_size[1],
        output_width=out_img.size[0], output_height=out_img.size[1],
        input_sha256=_sha(input_png), output_sha256=_sha(png),
        mask_source=mask_source,
        mask_sha256=None if mask is None else _sha(np.ascontiguousarray(mask).tobytes()),
        prediction_sha256=None if prediction_png is None else _sha(prediction_png),
        callback_used=callback_used, prediction_used=prediction_used,
        parameters=tuple((k, str(v)) for k, v in parameters),
    )
    return ImageResult(png, meta)


def _run_callback(callback, rgba: np.ndarray) -> np.ndarray:
    h, w = rgba.shape[:2]
    view = rgba.copy()
    view.flags.writeable = False
    try:
        res = callback(view)
    except ImageOpsError:
        raise
    except Exception as exc:
        raise CallbackError(f"segmentation callback raised {type(exc).__name__}") from exc
    if type(res) is not np.ndarray or res.dtype != np.uint8 or res.ndim != 2:
        raise CallbackError("callback must return a 2-D numpy uint8 ndarray")
    if res.shape != (h, w):
        raise CallbackError("callback mask shape must equal (height, width)")
    return np.array(res, dtype=np.uint8, copy=True)


# ------------------------------------------------------------- public API ---
def remove_background(image_png: bytes, provided_alpha_mask_png: Optional[bytes] = None,
                      segmentation_callback: Optional[Callable[[np.ndarray], np.ndarray]] = None,
                      *, limits: Limits = DEFAULT_LIMITS,
                      cancel_check: Optional[Callable[[], bool]] = None) -> ImageResult:
    """Apply a caller-supplied foreground mask to an image's alpha channel.

    Input: ``image_png`` PNG bytes; EXACTLY ONE of ``provided_alpha_mask_png``
    (PNG bytes, mode "L" only, same size, no tRNS; 0 = background, 255 =
    foreground, intermediate values = soft coverage) or ``segmentation_callback``.
    The callback receives a read-only copy of the decoded image as a numpy
    uint8 array of shape (H, W, 4) (RGBA) and must return a numpy uint8
    ndarray of shape (H, W) with the same meaning. Anything else (floats,
    bools, 3-D, wrong shape, exceptions) raises CallbackError; nothing is guessed.
    Nothing is inferred when no mask is given (MaskSourceError).

    Output: ImageResult with RGBA PNG. RGB is copied unchanged from the decoded
    original, including pixels whose final alpha is 0 (PNG stores it; viewers
    or later tools may discard it). Final alpha = round(orig_alpha * mask / 255)
    with exact nearest-integer rounding, i.e. (a*m + 127) // 255 (a*m/255 never
    has a fractional part of exactly .5). Soft values are never thresholded.
    Metadata records mask provenance only; it makes no claim about semantic
    or visual correctness.
    """
    _check_common(limits, cancel_check)
    if (provided_alpha_mask_png is None) == (segmentation_callback is None):
        raise MaskSourceError("supply exactly one of provided_alpha_mask_png or segmentation_callback")
    if segmentation_callback is not None and not callable(segmentation_callback):
        raise TypeError("segmentation_callback must be callable")
    size = _read_header(image_png, limits)
    if provided_alpha_mask_png is not None and _read_header(provided_alpha_mask_png, limits) != size:
        raise SizeMismatchError("mask size differs from image size")
    _budget(limits, size, size, size)
    _checkpoint(cancel_check)
    rgba = _rgba_array(image_png, limits)
    if provided_alpha_mask_png is not None:
        mask = _mask_array(provided_alpha_mask_png, limits)
        if mask.shape != rgba.shape[:2]:
            raise SizeMismatchError("mask size differs from image size")
        source = "provided_mask"
    else:
        _checkpoint(cancel_check)
        mask = _run_callback(segmentation_callback, rgba)
        source = "callback"
    _checkpoint(cancel_check)
    out = rgba.copy()
    alpha_in, alpha_out, matte = rgba.reshape(-1, 4), out.reshape(-1, 4), mask.ravel()
    for start in range(0, matte.size, 65536):
        _checkpoint(cancel_check)
        stop = start + 65536
        # 255*255+127 fits uint16; no full-image int32/float temporaries.
        product = alpha_in[start:stop, 3].astype(np.uint16) * matte[start:stop].astype(np.uint16)
        alpha_out[start:stop, 3] = ((product + 127) // 255).astype(np.uint8)
    return _result("remove_background", image_png, size, _from_rgba(out),
                   mask_source=source, mask=mask, callback_used=segmentation_callback is not None,
                   limits=limits, cancel_check=cancel_check,
                   parameters=(("alpha_rounding", "nearest(a*m/255)"),))


def _check_feather(f) -> float:
    if isinstance(f, bool) or not isinstance(f, numbers.Real):
        raise TypeError("feather_px must be a real number")
    try:
        f = float(f)
    except OverflowError as exc:
        raise ParameterError("feather_px out of range") from exc
    if not math.isfinite(f) or f < 0 or f > MAX_FEATHER_PX:
        raise ParameterError(f"feather_px must be finite and within [0, {MAX_FEATHER_PX}]")
    return f


def composite_erase_result(source_png: bytes, mask_png: bytes, prediction_png: bytes,
                           feather_px: float, *, limits: Limits = DEFAULT_LIMITS,
                           cancel_check: Optional[Callable[[], bool]] = None) -> ImageResult:
    """Blend a caller-supplied prediction into a source image inside a mask.

    This is a compositing helper only: it does not remove objects or inpaint;
    ``prediction_png`` is produced elsewhere by the caller.

    Input: three PNG byte strings with identical dimensions (orientation must be
    identity, see module docs) and ``feather_px``, a finite real in
    [0, MAX_FEATHER_PX] (bool rejected). The mask must be mode "L" and strictly
    binary: only 0 (keep source) and 255 (selected); any other value raises
    MaskError.

    Weights: w = 255 inside the selection and 0 outside. If feather_px > 0, w
    inside is Gaussian-blurred (sigma = feather_px) and then forced to 0 outside
    the selection, so softening happens only inside the original support and
    nothing outside changes.

    Blend (integers, per selected pixel, weights ws = As*(255-w), wp = Ap*w):
    alpha = (ws+wp+127)//255; rgb = (Cs*ws + Cp*wp + (ws+wp)//2) // (ws+wp),
    i.e. alpha-weighted colour so transparent pixels' RGB does not tint results.
    If ws+wp == 0 the RGB comes from the prediction when w >= 128, else from the
    source. With w = 255 the output equals the prediction pixel (including its alpha).
    Unselected pixels (mask 0) are copied byte-for-byte from the decoded source RGBA.

    An all-zero mask returns the decoded source pixels (re-encoded as RGBA PNG);
    the prediction is still validated but prediction_used is False.
    """
    _check_common(limits, cancel_check)
    f = _check_feather(feather_px)
    size = _read_header(source_png, limits)
    if _read_header(mask_png, limits) != size or _read_header(prediction_png, limits) != size:
        raise SizeMismatchError("source, mask and prediction dimensions must be equal")
    _budget(limits, size, size, size, size)
    _checkpoint(cancel_check)
    src = _rgba_array(source_png, limits)
    mask = _mask_array(mask_png, limits)
    pred = _rgba_array(prediction_png, limits)
    if not ((mask == 0) | (mask == 255)).all():
        raise MaskError("mask must contain only 0 and 255")
    _checkpoint(cancel_check)
    out = src.copy()
    used = bool(mask.any())
    if used:
        if f > 0:
            blurred = Image.fromarray(mask).filter(ImageFilter.GaussianBlur(f))
            weights = np.array(blurred, dtype=np.uint8).ravel()
        else:
            weights = mask.ravel()
        src_flat, pred_flat, out_flat = src.reshape(-1, 4), pred.reshape(-1, 4), out.reshape(-1, 4)
        mask_flat = mask.ravel()
        for start in range(0, mask_flat.size, 65536):
            _checkpoint(cancel_check)
            stop = start + 65536
            selected = mask_flat[start:stop] == 255
            if not selected.any():
                continue
            S = src_flat[start:stop][selected].astype(np.int32)
            P = pred_flat[start:stop][selected].astype(np.int32)
            wv = weights[start:stop][selected].astype(np.int32)
            ws, wp = S[:, 3] * (255 - wv), P[:, 3] * wv
            den = ws + wp
            safe = np.maximum(den, 1)
            rgb = (S[:, :3] * ws[:, None] + P[:, :3] * wp[:, None] + (safe // 2)[:, None]) // safe[:, None]
            fallback = np.where((wv >= 128)[:, None], P[:, :3], S[:, :3])
            blended = np.empty_like(S)
            blended[:, :3] = np.where((den == 0)[:, None], fallback, rgb)
            blended[:, 3] = (den + 127) // 255
            out_flat[start:stop][selected] = blended.astype(np.uint8)
    return _result("composite_erase_result", source_png, size, _from_rgba(out),
                   mask_source="provided_mask", mask=mask, prediction_png=prediction_png,
                   limits=limits, cancel_check=cancel_check,
                   prediction_used=used, parameters=(("feather_px", repr(f)),))


def _int_param(v, name) -> int:
    if isinstance(v, bool) or not isinstance(v, numbers.Integral):
        raise TypeError(f"{name} must be an int (not bool)")
    v = int(v)
    if v <= 0:
        raise ParameterError(f"{name} must be positive")
    return v


def _fit(sw, sh, bw, bh) -> Tuple[int, int]:
    if bw * sh <= bh * sw:  # width is the limiting side
        ow, oh = bw, (2 * sh * bw + sw) // (2 * sw)
    else:
        oh, ow = bh, (2 * sw * bh + sh) // (2 * sh)
    return max(1, min(ow, bw)), max(1, min(oh, bh))


def resize_png(image_png: bytes, width: int, height: int, keep_aspect: bool,
               *, limits: Limits = DEFAULT_LIMITS,
               cancel_check: Optional[Callable[[], bool]] = None) -> ImageResult:
    """Resize with LANCZOS, preserving alpha; returns RGBA PNG in ImageResult.

    ``width``/``height``: positive non-bool ints. ``keep_aspect`` must be a bool.
    keep_aspect=False: output is exactly (width, height).
    keep_aspect=True: (width, height) is a bounding box; the image is scaled
    (up or down) to the largest size that fits inside it, with no crop or
    padding. The limiting side equals the box side; the other side is the exact
    ratio rounded half up, clamped to [1, box side].
    Output pixel count must be <= limits.max_pixels (ResourceLimitError).
    Resampling runs on premultiplied alpha (RGBa), so RGB under transparent
    pixels does not bleed into edges; consequence: RGB of fully transparent
    pixels is not preserved by a real resize (it becomes 0). If the output size
    equals the input size, decoded pixels are returned untouched.
    """
    _check_common(limits, cancel_check)
    bw, bh = _int_param(width, "width"), _int_param(height, "height")
    if not isinstance(keep_aspect, bool):
        raise TypeError("keep_aspect must be a bool")
    sw, sh = _read_header(image_png, limits)
    ow, oh = _fit(sw, sh, bw, bh) if keep_aspect else (bw, bh)
    if ow * oh > limits.max_pixels:
        raise ResourceLimitError("output pixel count exceeds limit")
    _budget(limits, (sw, sh), (ow, oh))
    _checkpoint(cancel_check)
    img = Image.fromarray(_rgba_array(image_png, limits))
    if (ow, oh) != (sw, sh):
        img = img.convert("RGBa").resize((ow, oh), _RESAMPLING.LANCZOS).convert("RGBA")
    _checkpoint(cancel_check)
    return _result("resize_png", image_png, (sw, sh), img,
                   limits=limits, cancel_check=cancel_check,
                   parameters=(("width", bw), ("height", bh), ("keep_aspect", keep_aspect),
                               ("resample", "LANCZOS"), ("alpha", "premultiplied")))


# Claude public-spec markup addition; follow-up review changes tracked separately.
# ---- markup_png: published hard limits and constants -----------------------
MARKUP_MAX_STROKES = 128
MARKUP_MAX_POINTS_PER_STROKE = 4096
MARKUP_MAX_TOTAL_POINTS = 16384
MARKUP_MIN_WIDTH = 1.0
MARKUP_MAX_WIDTH = 256.0
MARKUP_SUPERSAMPLE = 4              # S x S sub-samples per output pixel
_MARKUP_BAND_HIRES_PIXELS = 1 << 20  # hard cap of one hi-res working band
_MARKUP_POLL_EVERY_SEGMENTS = 1
_MARKUP_COLOR_RE = re.compile(r"#[0-9A-Fa-f]{6}")
_MARKUP_STROKE_KEYS = frozenset(("points", "color", "width", "opacity"))
_MARKUP_POINT_KEYS = frozenset(("x", "y"))


def _markup_real(v, lo, hi):
    """Finite, non-bool int/float within [lo, hi] -> float, else ParameterError."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise ParameterError("markup: numeric value required")
    try:
        f = float(v)
    except (OverflowError, ValueError):
        raise ParameterError("markup: numeric value out of range")
    if not math.isfinite(f) or f < lo or f > hi:
        raise ParameterError("markup: numeric value out of range")
    return f


def _markup_validate(strokes, w, h):
    """Validate and copy into immutable tuples:
    ((points((x, y), ...), (r, g, b), width, opacity), ...).
    Containers must be exactly `list`/`dict` (no subclasses). Runs before any
    decode or large allocation. Error messages never echo caller values."""
    if type(strokes) is not list:
        raise ParameterError("markup: strokes must be a list")
    if len(strokes) > MARKUP_MAX_STROKES:
        raise ParameterError("markup: too many strokes")
    out = []
    total = 0
    for s in strokes:
        if type(s) is not dict or set(s.keys()) != _MARKUP_STROKE_KEYS:
            raise ParameterError("markup: stroke must have exactly points,color,width,opacity")
        pts = s["points"]
        if type(pts) is not list or not pts:
            raise ParameterError("markup: points must be a nonempty list")
        if len(pts) > MARKUP_MAX_POINTS_PER_STROKE:
            raise ParameterError("markup: too many points in a stroke")
        total += len(pts)
        if total > MARKUP_MAX_TOTAL_POINTS:
            raise ParameterError("markup: too many total points")
        color = s["color"]
        if not isinstance(color, str) or _MARKUP_COLOR_RE.fullmatch(color) is None:
            raise ParameterError("markup: color must be '#RRGGBB'")
        width = _markup_real(s["width"], MARKUP_MIN_WIDTH, MARKUP_MAX_WIDTH)
        opacity = _markup_real(s["opacity"], 0.0, 1.0)
        cp = []
        for p in pts:
            if type(p) is not dict or set(p.keys()) != _MARKUP_POINT_KEYS:
                raise ParameterError("markup: point must have exactly x,y")
            cp.append((_markup_real(p["x"], -0.5, w - 0.5),
                       _markup_real(p["y"], -0.5, h - 0.5)))
        rgb = (int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16))
        out.append((tuple(cp), rgb, width, opacity))
    return tuple(out)


def _markup_plan(stroke, w, h, limits):
    """Clipped output-pixel region and band height for one stroke, with
    resource checks on the hi-res band size BEFORE anything is allocated."""
    pts, _rgb, width, _op = stroke
    r = width / 2.0
    S = MARKUP_SUPERSAMPLE
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    # Pixel (i, j) occupies [i, i+1] x [j, j+1]; point (x, y) sits at its centre.
    x0 = max(0, int(math.floor(min(xs) + 0.5 - r)))
    y0 = max(0, int(math.floor(min(ys) + 0.5 - r)))
    x1 = min(w, int(math.ceil(max(xs) + 0.5 + r)))
    y1 = min(h, int(math.ceil(max(ys) + 0.5 + r)))
    rw, rh = x1 - x0, y1 - y0
    band_rows = max(1, min(rh, _MARKUP_BAND_HIRES_PIXELS // (rw * S * S)))
    hw, hh = rw * S, band_rows * S
    if hw * hh > min(limits.max_pixels, _MARKUP_BAND_HIRES_PIXELS):
        raise ResourceLimitError("markup: supersampled working band exceeds pixel limit")
    # decoded source + working copy + touched mask (counted conservatively
    # as full canvases) + one hi-res band.
    _budget(limits, (w, h), (w, h), (w, h), (hw, hh))
    return x0, y0, x1, y1, band_rows


def _markup_band_mask(pts, x0, y0, rw, h0, h1, width, cancel_check):
    """Boolean hi-res coverage of the stroke (union of capsules; one point =
    dot) for hi-res rows [h0, h1) of the region. Sub-sample centres are tested
    against exact distance-to-segment in float32 windows; peak memory is
    bounded by the band."""
    S = MARKUP_SUPERSAMPLE
    R = width / 2.0 * S
    R2 = R * R
    HW = rw * S
    px = np.array([(p[0] + 0.5 - x0) * S for p in pts], dtype=np.float64)
    py = np.array([(p[1] + 0.5 - y0) * S for p in pts], dtype=np.float64)
    if len(pts) == 1:
        ax, ay, bx, by = px, py, px, py
    else:
        ax, ay, bx, by = px[:-1], py[:-1], px[1:], py[1:]
    ylo = np.minimum(ay, by) - R
    yhi = np.maximum(ay, by) + R
    xlo = np.minimum(ax, bx) - R
    xhi = np.maximum(ax, bx) + R
    mask = np.zeros((h1 - h0, HW), dtype=bool)
    sel = np.flatnonzero((yhi >= h0) & (ylo < h1))
    for n, i in enumerate(sel):
        if n and n % _MARKUP_POLL_EVERY_SEGMENTS == 0:
            _checkpoint(cancel_check)
        c0 = max(0, int(math.floor(xlo[i])))
        c1 = min(HW, int(math.ceil(xhi[i])) + 1)
        r0 = max(h0, int(math.floor(ylo[i])))
        r1 = min(h1, int(math.ceil(yhi[i])) + 1)
        if c0 >= c1 or r0 >= r1:
            continue
        sx = (np.arange(c0, c1, dtype=np.float64) + 0.5 - ax[i]).astype(np.float32)[None, :]
        sy = (np.arange(r0, r1, dtype=np.float64) + 0.5 - ay[i]).astype(np.float32)[:, None]
        dx = float(bx[i] - ax[i])
        dy = float(by[i] - ay[i])
        len2 = dx * dx + dy * dy
        inv = 1.0 / len2 if len2 > 1e-12 else 0.0
        t = np.clip((sx * dx + sy * dy) * inv, 0.0, 1.0)
        ex = sx - t * dx
        ey = sy - t * dy
        mask[r0 - h0:r1 - h0, c0:c1] |= (ex * ex + ey * ey) <= R2
    return mask


def markup_png(source_png, strokes, *, limits=DEFAULT_LIMITS, cancel_check=None):
    """Rasterise caller-provided strokes over a PNG (no AI/inference involved).

    Coordinates: natural pixel coordinates; x=i, y=j is the CENTRE of pixel
    (i, j). The accepted center domain includes canvas edges:
    [-.5, width-.5] / [-.5, height-.5]. Callers with continuous corner-space
    coordinates [0,width]/[0,height] subtract .5 exactly once. Round caps/joins,
    dots for single points. Each stroke is the
    union of its capsules (self-overlap is not double-composited). Rendering:
    S x S supersampling (S = MARKUP_SUPERSAMPLE) on the stroke's clipped
    bounding region, in bands. Per-stroke per-pixel alpha is quantised:
        sa = rint(coverage_count * opacity * 255 / S^2), integer 0..255.
    Pixels with sa == 0 are NOT touched (so opacity 0, or opacity so small
    that it rounds to 0, draws nothing). Pixels with sa > 0 get 8-bit
    source-over compositing in stroke order. Geometry outside the canvas is
    clipped. Pixels never touched keep byte-identical original RGBA
    (including RGB under alpha 0).
    """
    _check_common(limits, cancel_check)
    w, h = _read_header(source_png, limits)
    snap = _markup_validate(strokes, w, h)          # immutable copy
    # Capture caller data before invoking any external cancellation hook.
    _checkpoint(cancel_check)
    plans = [_markup_plan(s, w, h, limits) if s[3] * 255 >= 0.5 else None for s in snap]
    _budget(limits, (w, h), (w, h))
    _checkpoint(cancel_check)                        # before decode
    arr = _rgba_array(source_png, limits)
    S = MARKUP_SUPERSAMPLE
    canvas = arr
    touched = None
    if any(plan is not None for plan in plans):
        canvas = np.array(arr, dtype=np.uint8, copy=True)
        touched = np.zeros((h, w), dtype=bool)
    for stroke, plan in zip(snap, plans):
        _checkpoint(cancel_check)                    # before each stroke
        pts, rgb, width, opacity = stroke
        if plan is None:
            continue
        x0, y0, x1, y1, band_rows = plan
        rw, rh = x1 - x0, y1 - y0
        scale = opacity * 255.0 / (S * S)
        color_f = np.array(rgb, dtype=np.float32)
        for rb0 in range(0, rh, band_rows):
            rb1 = min(rh, rb0 + band_rows)
            if opacity > 0.0:
                bm = _markup_band_mask(pts, x0, y0, rw, rb0 * S, rb1 * S, width, cancel_check)
                counts = bm.reshape(rb1 - rb0, S, rw, S).sum(axis=(1, 3), dtype=np.uint16)
                del bm
                sa = np.minimum(np.rint(counts.astype(np.float32) * np.float32(scale)),
                                255).astype(np.uint8)
                m = sa > 0
                if m.any():
                    view = canvas[y0 + rb0:y0 + rb1, x0:x1]
                    dest = view[m].astype(np.float32)
                    a_s = sa[m].astype(np.float32) / 255.0
                    w_d = (dest[:, 3] / 255.0) * (1.0 - a_s)
                    a_o = a_s + w_d
                    res = np.empty_like(dest)
                    res[:, :3] = (color_f[None, :] * a_s[:, None]
                                  + dest[:, :3] * w_d[:, None]) / a_o[:, None]
                    res[:, 3] = a_o * 255.0
                    view[m] = np.clip(np.rint(res), 0, 255).astype(np.uint8)
                    touched[y0 + rb0:y0 + rb1, x0:x1] |= m
            _checkpoint(cancel_check)                # after each band/stroke
    if touched is not None and touched.any():
        count = int(touched.sum())
        rows = np.flatnonzero(touched.any(axis=1))
        cols = np.flatnonzero(touched.any(axis=0))
        bbox = "%d,%d,%d,%d" % (cols[0], rows[0], cols[-1] + 1, rows[-1] + 1)  # max exclusive
    else:
        count, bbox = 0, "empty"
    params = (
        ("stroke_count", str(len(snap))),
        ("point_count", str(sum(len(s[0]) for s in snap))),
        ("supersample", str(S)),
        ("coordinates", "pixel_centers"),
        ("overlay_positive_pixels", str(count)),
        ("overlay_bbox", bbox),
    )
    _checkpoint(cancel_check)                        # before encode
    return _result("markup_png", source_png, (w, h), _from_rgba(canvas),
                   limits=limits, cancel_check=cancel_check, parameters=params)

"""Strict original-resolution pixel-space compositing."""
import numpy as np
from PIL import Image, ImageFilter


def composite(original: Image.Image, generated: Image.Image, mask: Image.Image,
              bbox: tuple[int, int, int, int] | None, feather: int = 0) -> Image.Image:
    """Blend a generated crop, preserving every zero-mask RGB pixel exactly.

    mask is full-resolution luminance alpha (0=original, 255=generated).
    bbox is half-open original pixel coordinates, or None for a full image.
    Feather is Gaussian radius in original pixels, clipped to mask support and
    never increases its alpha. Padding must be removed before this call.
    Inputs are never modified. RGB conversion defines original pixel values.
    """
    if mask.size != original.size:
        raise ValueError('mask size must match original image')
    if isinstance(feather, bool) or not isinstance(feather, int) or feather < 0:
        raise ValueError('feather must be a nonnegative integer')
    width, height = original.size
    box = bbox if bbox is not None else (0, 0, width, height)
    if len(box) != 4 or any(isinstance(v, bool) or not isinstance(v, int) for v in box):
        raise ValueError('bbox must contain four integer coordinates')
    x0, y0, x1, y1 = box
    if not (0 <= x0 < x1 <= width and 0 <= y0 < y1 <= height):
        raise ValueError('bbox must be nonempty and within the original image')
    if generated.size != (x1 - x0, y1 - y0):
        raise ValueError('generated size must exactly match bbox; remove padding first')
    mask_image = mask.convert('L')
    alpha = np.asarray(mask_image)
    # Reject a partial crop that would silently ignore some requested edits.
    inside_count = int(np.count_nonzero(alpha[y0:y1, x0:x1]))
    if inside_count != int(np.count_nonzero(alpha)):
        raise ValueError('bbox does not cover every nonzero mask pixel')
    if feather:
        alpha = np.minimum(alpha, np.asarray(mask_image.filter(ImageFilter.GaussianBlur(feather))))
    output = np.array(original.convert('RGB'), copy=True)
    generated_pixels = np.asarray(generated.convert('RGB'), dtype=np.uint32)
    local_alpha = alpha[y0:y1, x0:x1].astype(np.uint32)[..., None]
    base = output[y0:y1, x0:x1].astype(np.uint32)
    # Integer arithmetic makes both zero and full-alpha cases exact.
    blended = ((base * (255 - local_alpha) + generated_pixels * local_alpha + 127) // 255).astype(np.uint8)
    output[y0:y1, x0:x1] = blended
    return Image.fromarray(output)

"""Deterministic CPU recoloring at original pixel coordinates.

HSV angular selection, OKLab tone/chroma transfer, and fixed-lightness gamut
compression. Neutral highlights and unrelated hues are protected. The final
mask/feather arithmetic is the existing pixel-space composite contract.

OKLab matrices: https://bottosson.github.io/posts/oklab/ (public-domain/MIT).
"""
import math
import re

import numpy as np
from PIL import Image

from .composite import composite

ALGORITHM = 'oklab-recolor-v1'
_HEX = re.compile(r'#[0-9a-fA-F]{6}\Z')
_LMS = np.array([[.4122214708, .5363325363, .0514459929],
    [.2119034982, .6806995451, .1073969566], [.0883024619, .2817188376, .6299787005]])
_LAB = np.array([[.2104542553, .7936177850, -.0040720468],
    [1.9779984951, -2.4285922050, .4505937099], [.0259040371, .7827717662, -.8086757660]])
_INV_LAB = np.array([[1., .3963377774, .2158037573],
    [1., -.1055613458, -.0638541728], [1., -.0894841775, -1.2914855480]])
_INV_LMS = np.array([[4.0767416621, -3.3077115913, .2309699292],
    [-1.2684380046, 2.6097574011, -.3413193965], [-.0041960863, -.7034186147, 1.7076147010]])


def validate_options(value):
    target = value.get('target_color')
    reference = value.get('source_color')
    tolerance = value.get('color_tolerance', 35)
    if not isinstance(target, str) or _HEX.fullmatch(target) is None:
        raise ValueError('target_color must be #RRGGBB')
    if reference is not None and (not isinstance(reference, str) or _HEX.fullmatch(reference) is None):
        raise ValueError('source_color must be #RRGGBB or null')
    if type(tolerance) not in (int, float) or not math.isfinite(tolerance) or not 0 <= tolerance <= 90:
        raise ValueError('color_tolerance must be finite in 0..90 degrees')
    return {'target_color': target.upper(), 'source_color': reference.upper() if reference else None,
        'color_tolerance': float(tolerance)}


def _rgb(hex_color):
    return np.array([int(hex_color[i:i + 2], 16) for i in (1, 3, 5)], dtype=float) / 255.


def _to_lab(rgb):
    linear = np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)
    return np.cbrt(linear @ _LMS.T) @ _LAB.T


def _to_linear(lab):
    return ((lab @ _INV_LAB.T) ** 3) @ _INV_LMS.T


def _to_srgb(linear):
    linear = np.clip(linear, 0, 1)
    return np.where(linear <= .0031308, linear * 12.92, 1.055 * linear ** (1 / 2.4) - .055)


def _hsv(rgb):
    maximum, minimum = rgb.max(axis=-1), rgb.min(axis=-1)
    chroma = maximum - minimum
    safe = np.where(chroma > 0, chroma, 1)
    r, g, b = np.moveaxis(rgb, -1, 0)
    hue = np.where(maximum == r, (g - b) / safe,
        np.where(maximum == g, (b - r) / safe + 2, (r - g) / safe + 4)) * 60
    hue = np.where(chroma > 0, hue % 360, 0)
    saturation = chroma / np.where(maximum > 0, maximum, 1)
    return hue, saturation, maximum


def _smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def _angle_distance(a, b):
    return np.abs((a - b + 180) % 360 - 180)


def _selection(rgb, context, tolerance):
    hue, saturation, value = _hsv(rgb)
    if context['chromatic']:
        distance = _angle_distance(hue, context['hue'])
        angular = (distance <= 1e-5).astype(float) if tolerance == 0 else (
            1 - _smooth((distance - tolerance * .7) / (tolerance * .3)))
        # Actual gray/black/white has no reliable hue; never assign it one.
        return angular * _smooth((saturation * value - .012) / .045)
    lab = _to_lab(rgb)
    neutral = 1 - _smooth(np.hypot(lab[..., 1], lab[..., 2]) / .035)
    band = 1 / 255 if tolerance == 0 else .02 + .35 * tolerance / 90
    distance = np.abs(lab[..., 0] - context['neutral_l'])
    return neutral * (1 - _smooth((distance - band * .7) / (band * .3)))


def _weighted_median(values, weights):
    order = np.argsort(values, kind='stable')
    index = np.searchsorted(np.cumsum(weights[order]), weights.sum() * .5)
    return float(values[order[min(index, len(order) - 1)]])


def _context(rgb, mask, alpha, options):
    # Deterministic sample of selected visible pixels; no sampling can miss a
    # thin mask merely because it happens to fall between image grid columns.
    positions = np.flatnonzero((mask > 0) & (alpha > 0))
    if not len(positions):
        return None
    positions = positions[::max(1, math.ceil(len(positions) / 65536))]
    samples = rgb.reshape(-1, 3)[positions].astype(float) / 255.
    weights = mask.ravel()[positions].astype(float) / 255 * alpha.ravel()[positions].astype(float) / 255
    hue, saturation, value = _hsv(samples)
    reference = options['source_color']
    if reference is None:
        weights *= saturation * value * (saturation * value >= .035)
        if weights.sum() <= 1e-10:
            return None
        bins = np.floor(hue / 5).astype(int) % 72
        histogram = np.bincount(bins, weights=weights, minlength=72)
        smoothed = histogram * .5 + np.roll(histogram, 1) * .25 + np.roll(histogram, -1) * .25
        peak = int(smoothed.argmax()) * 5 + 2.5
        cohort = _angle_distance(hue, peak) <= max(10., options['color_tolerance'])
        local = weights * cohort
        if local.sum() <= 1e-10:
            return None
        radians = np.deg2rad(hue)
        angle = float(np.rad2deg(np.arctan2(np.sum(local * np.sin(radians)),
            np.sum(local * np.cos(radians)))) % 360)
        representative = np.rint(np.average(samples, weights=local, axis=0) * 255).astype(np.uint8)
        resolved = '#' + ''.join(f'{int(x):02X}' for x in representative)
        context = {'chromatic': True, 'hue': angle, 'resolved_source_color': resolved,
            'estimated_source_color': resolved}
    else:
        source_rgb = _rgb(reference)
        source_hue = float(_hsv(source_rgb)[0])
        context = {'chromatic': bool(np.ptp(source_rgb) >= .035), 'hue': source_hue,
            'neutral_l': float(_to_lab(source_rgb)[0]), 'resolved_source_color': reference,
            'estimated_source_color': None}
    matching = weights * _selection(samples, context, options['color_tolerance'])
    if matching.sum() <= 1e-10:
        if reference is None:
            return None
        # A manual reference can exist between sample strides. Let the full
        # resolution selection decide whether it is present.
        source_lab = _to_lab(source_rgb)
        context.update(reference_l=float(source_lab[0]),
            reference_c=max(.01, float(np.hypot(source_lab[1], source_lab[2]))),
            sample_count=len(samples))
        return context
    lab = _to_lab(samples)
    context.update(reference_l=_weighted_median(lab[:, 0], matching),
        reference_c=max(.01, _weighted_median(np.hypot(lab[:, 1], lab[:, 2]), matching)),
        sample_count=len(samples))
    return context


def _tone(lightness, reference, target):
    # Monotone transfer. Black/white targets intentionally change the tone
    # reference; identical luminance would contradict those target colors.
    if reference <= 1e-6:
        return target + lightness * (1 - target)
    if reference >= 1 - 1e-6:
        return lightness * target
    return np.where(lightness <= reference, lightness * target / reference,
        target + (lightness - reference) * (1 - target) / (1 - reference))


def _gamut_rgb(lightness, chroma, hue):
    direction = np.array([math.cos(hue), math.sin(hue)])
    def linear_at(scale):
        ab = (chroma * scale)[..., None] * direction
        return _to_linear(np.concatenate([lightness[..., None], ab], axis=-1))
    full = linear_at(np.ones_like(chroma))
    valid = (full.min(axis=-1) >= -1e-6) & (full.max(axis=-1) <= 1 + 1e-6)
    low, high = valid.astype(float), np.ones_like(chroma)
    for _ in range(10):
        middle = (low + high) * .5
        linear = linear_at(middle)
        valid = (linear.min(axis=-1) >= -1e-6) & (linear.max(axis=-1) <= 1 + 1e-6)
        low = np.where(valid, middle, low)
        high = np.where(valid, high, middle)
    return _to_srgb(linear_at(low))


def recolor(source, mask, target_color, source_color=None, color_tolerance=35,
            feather=4, check_cancel=None):
    options = validate_options(dict(target_color=target_color, source_color=source_color,
        color_tolerance=color_tolerance))
    if source.size != mask.size:
        raise ValueError('Mask dimensions must match original image')
    if type(feather) is not int or not 0 <= feather <= 64:
        raise ValueError('feather must be an integer in 0..64')
    check = check_cancel or (lambda: None)
    check()
    params = dict(options, algorithm=ALGORITHM, estimated_source_color=None,
        selection_space='circular HSV hue degrees; neutral source uses OKLab lightness band',
        transform_space='OKLab', gamut_mapping='fixed lightness/hue, 10-step chroma compression',
        tone_rule='monotone piecewise mapping; neutral target reference clamped to L=.20..94',
        feather=feather, skipped=None, selected_color_pixels=0)
    grayscale = mask.convert('L')
    bbox = grayscale.getbbox()
    if bbox is None:
        params['skipped'] = 'empty-mask'
        return source.copy(), params
    if options['source_color'] == options['target_color']:
        params['skipped'] = 'same-color'
        return source.copy(), params
    rgba = source.convert('RGBA')
    values = np.asarray(rgba.crop(bbox))
    rgb = values[..., :3]
    alpha = values[..., 3]
    mask_values = np.asarray(grayscale.crop(bbox))
    context = _context(rgb, mask_values, alpha, options)
    check()
    if context is None:
        params['skipped'] = 'no-matching-color'
        return source.copy(), params
    params.update(estimated_source_color=context['estimated_source_color'],
        resolved_source_color=context['resolved_source_color'], source_hue_degrees=context['hue'],
        reference_lightness=context['reference_l'], reference_chroma=context['reference_c'],
        source_estimation_sample_count=context['sample_count'], bbox=list(bbox))
    if context['resolved_source_color'] == options['target_color']:
        params['skipped'] = 'same-color'
        return source.copy(), params
    target = _to_lab(_rgb(options['target_color']))
    target_c = float(np.hypot(target[1], target[2]))
    target_l = float(np.clip(target[0], .20, .94)) if target_c < .015 else float(target[0])
    target_hue = math.atan2(float(target[2]), float(target[1]))
    params.update(target_reference_lightness=target_l, target_chroma=target_c)
    generated = np.array(rgb, copy=True)
    for y in range(0, rgb.shape[0], 128):
        check()
        original = rgb[y:y + 128].astype(float) / 255.
        lab = _to_lab(original)
        selection = _selection(original, context, options['color_tolerance'])
        selection *= (mask_values[y:y + 128] > 0) & (alpha[y:y + 128] > 0)
        params['selected_color_pixels'] += int(np.count_nonzero(selection))
        lightness = np.clip(_tone(lab[..., 0], context['reference_l'], target_l), 0, 1)
        if target_c < .015:
            chroma = np.zeros_like(lightness)
        elif context['chromatic']:
            chroma = target_c * np.hypot(lab[..., 1], lab[..., 2]) / context['reference_c']
        else:
            chroma = np.full_like(lightness, target_c)
        transformed = _gamut_rgb(lightness, chroma, target_hue)
        blended = original + (transformed - original) * selection[..., None]
        generated[y:y + 128] = np.rint(np.clip(blended, 0, 1) * 255).astype(np.uint8)
    check()
    output = composite(source.convert('RGB'), Image.fromarray(generated), grayscale, bbox, feather=feather)
    if source.mode in ('RGBA', 'LA') or 'transparency' in source.info:
        output.putalpha(rgba.getchannel('A'))
    check()
    if not params['selected_color_pixels']:
        params['skipped'] = 'no-matching-color'
    elif np.array_equal(np.asarray(output.convert('RGBA')), np.asarray(rgba)):
        params['skipped'] = 'no-visible-change'
    return output, params

"""Pixel-space ROI plans and opt-in spatial planning experiments.

All rectangles are half-open (x0, y0, x1, y1) in original image pixels.
No plan executes inference or promises speed or perceptual equivalence.
"""
from dataclasses import dataclass
import math
from typing import Literal

import numpy as np
from PIL import Image

BBox = tuple[int, int, int, int]


@dataclass(frozen=True)
class ROIPlan:
    bbox: BBox | None
    original_size: tuple[int, int]
    mode: Literal['empty', 'roi', 'baseline']
    mask_area: int
    processed_area: int
    reason: str
    padded_size: tuple[int, int]
    padding: tuple[int, int, int, int]  # left, top, right, bottom
    halo: int
    multiple: int


def _positive_int(value: int, name: str, allow_zero: bool = False) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < (0 if allow_zero else 1):
        raise ValueError(f'{name} must be a {"nonnegative" if allow_zero else "positive"} integer')


def _mask_array(mask: Image.Image) -> np.ndarray:
    if min(mask.size) <= 0:
        raise ValueError('mask must have positive dimensions')
    return np.asarray(mask.convert('L'))


def _aligned(value: int, multiple: int, minimum: int = 1) -> int:
    return math.ceil(max(value, minimum) / multiple) * multiple


def _axis(start: int, end: int, extent: int, halo: int, multiple: int, minimum: int) -> tuple[int, int, int]:
    low, high = max(0, start - halo), min(extent, end + halo)
    target = _aligned(high - low, multiple, minimum)
    available = min(target, extent)
    low = min(max(0, (low + high - available) // 2), extent - available)
    return low, low + available, target


def plan_roi(mask: Image.Image, halo: int = 32, multiple: int = 8,
             min_size: int = 64, max_area_ratio: float = .75) -> ROIPlan:
    """Plan a real crop, falling back at the padded baseline area threshold.

    The ratio compares model pixel counts after alignment, including padding.
    Padding is on the right/bottom; image pixels replicate their edge, mask
    padding is zero. Model-specific minimum sizes remain the caller's duty.
    """
    _positive_int(halo, 'halo', True)
    _positive_int(multiple, 'multiple')
    _positive_int(min_size, 'min_size')
    if not math.isfinite(max_area_ratio) or not 0 < max_area_ratio <= 1:
        raise ValueError('max_area_ratio must be finite and in (0, 1]')
    values = _mask_array(mask)
    active = values > 0
    area = int(np.count_nonzero(active))
    size = mask.size
    if not area:
        return ROIPlan(None, size, 'empty', 0, 0, 'empty mask: skip generation', (0, 0), (0, 0, 0, 0), halo, multiple)
    ys, xs = np.nonzero(active)
    x0, x1, width = _axis(int(xs.min()), int(xs.max()) + 1, size[0], halo, multiple, min_size)
    y0, y1, height = _axis(int(ys.min()), int(ys.max()) + 1, size[1], halo, multiple, min_size)
    baseline_size = tuple(_aligned(s, multiple, min_size) for s in size)
    mode = 'roi'
    reason = 'crop including context and model alignment'
    if width * height >= baseline_size[0] * baseline_size[1] * max_area_ratio:
        mode = 'baseline'
        reason = 'aligned crop meets area threshold: use full-frame baseline'
        x0, y0, x1, y1 = 0, 0, *size
        width, height = baseline_size
    return ROIPlan((x0, y0, x1, y1), size, mode, area, width * height, reason,
                   (width, height), (0, 0, width - (x1 - x0), height - (y1 - y0)), halo, multiple)


def crop_for_plan(image: Image.Image, plan: ROIPlan, *, is_mask: bool = False) -> Image.Image:
    """Return a detached, padded model input; never resize source pixels."""
    if image.size != plan.original_size:
        raise ValueError('image size does not match ROI plan')
    if plan.bbox is None:
        raise ValueError('empty ROI has no model input')
    crop = image.convert('L' if is_mask else 'RGB').crop(plan.bbox)
    left, top, right, bottom = plan.padding
    values = np.asarray(crop)
    padding = ((top, bottom), (left, right)) + (() if is_mask else ((0, 0),))
    padded = np.pad(values, padding, mode='constant' if is_mask else 'edge')
    result = Image.fromarray(padded)
    if result.size != plan.padded_size:
        raise ValueError('inconsistent ROI plan dimensions')
    return result


def unpad_generated(generated: Image.Image, plan: ROIPlan) -> Image.Image:
    """Remove alignment padding before passing a crop into composite()."""
    if plan.bbox is None or generated.size != plan.padded_size:
        raise ValueError('generated dimensions do not match padded ROI plan')
    x0, y0, x1, y1 = plan.bbox
    left, top, _, _ = plan.padding
    return generated.crop((left, top, left + x1 - x0, top + y1 - y0))


def canvas_to_image(x: float, y: float, *, image_size: tuple[int, int],
                    display_size: tuple[float, float], zoom: float = 1.,
                    pan: tuple[float, float] = (0., 0.), clamp: bool = False) -> tuple[float, float]:
    """Invert display = pan + original * display_size/image_size * zoom.

    pan is the canvas location of the image's top-left after any letterboxing.
    Coordinates describe continuous pixel edges; rasterization is caller policy.
    """
    numbers = (x, y, *image_size, *display_size, zoom, *pan)
    if not all(math.isfinite(v) for v in numbers) or min(*image_size, *display_size, zoom) <= 0:
        raise ValueError('coordinates must be finite and dimensions/zoom positive')
    result = ((x - pan[0]) * image_size[0] / (display_size[0] * zoom),
              (y - pan[1]) * image_size[1] / (display_size[1] * zoom))
    return tuple(max(0., min(float(limit), value)) for value, limit in zip(result, image_size)) if clamp else result


@dataclass(frozen=True)
class Tile:
    core_bbox: BBox
    bbox: BBox
    depth: int
    padded_size: tuple[int, int]
    processed_area: int


@dataclass(frozen=True)
class TilePlan:
    mode: Literal['disabled', 'empty', 'fixed', 'adaptive', 'baseline']
    tiles: tuple[Tile, ...]
    mask_area: int
    core_area: int
    processed_area: int
    reason: str


def plan_tiles(mask: Image.Image, *, enabled: bool = False, strategy: str = 'fixed',
               tile_size: int = 256, overlap: int = 32, min_tile: int = 64,
               max_depth: int = 4, max_tiles: int = 64, multiple: int = 8) -> TilePlan:
    """Bounded planning experiment only. No tiles are submitted to a model.

    Fixed grid retains only cells intersecting the mask. Adaptive quadtree
    splits partially active cells until target size or limits; fully active
    regions stay as covering parents. Importance is mask support.
    Incomplete subdivision keeps a parent, so every masked pixel is covered.
    """
    for name, value in [('tile_size', tile_size), ('min_tile', min_tile), ('max_tiles', max_tiles), ('multiple', multiple)]:
        _positive_int(value, name)
    _positive_int(overlap, 'overlap', True)
    _positive_int(max_depth, 'max_depth', True)
    if strategy not in ('fixed', 'adaptive'):
        raise ValueError('strategy must be fixed or adaptive')
    if not enabled:
        return TilePlan('disabled', (), 0, 0, 0, 'experimental tile planner is disabled')
    active = _mask_array(mask) > 0
    area = int(np.count_nonzero(active))
    if not area:
        return TilePlan('empty', (), 0, 0, 0, 'empty mask')
    width, height = mask.size
    # Summed-area table makes each rectangle occupancy query O(1).
    integral = np.zeros((height + 1, width + 1), dtype=np.int64)
    integral[1:, 1:] = active.cumsum(axis=0, dtype=np.int64).cumsum(axis=1, dtype=np.int64)

    def mask_count(box: BBox) -> int:
        x0, y0, x1, y1 = box
        return int(integral[y1, x1] - integral[y0, x1] - integral[y1, x0] + integral[y0, x0])

    cores: list[tuple[BBox, int]] = []
    mode, reason = strategy, 'experimental planning only; model quality and latency unverified'
    if strategy == 'fixed':
        for y0 in range(0, height, tile_size):
            for x0 in range(0, width, tile_size):
                box = (x0, y0, min(width, x0 + tile_size), min(height, y0 + tile_size))
                if mask_count(box):
                    cores.append((box, 0))
                    if len(cores) > max_tiles:
                        break
            if len(cores) > max_tiles:
                break
        if len(cores) > max_tiles:
            cores = [((0, 0, width, height), 0)]
            mode, reason = 'baseline', 'fixed tile count exceeds max_tiles: full-frame fallback'
    else:
        pending = [((0, 0, width, height), 0)]
        limit_reached = False
        while pending:
            box, depth = pending.pop(0)
            x0, y0, x1, y1 = box
            can_split = (mask_count(box) < (x1 - x0) * (y1 - y0)
                         and depth < max_depth and max(x1 - x0, y1 - y0) > tile_size
                         and (x1 - x0) // 2 >= min_tile and (y1 - y0) // 2 >= min_tile)
            if can_split:
                mx, my = (x0 + x1) // 2, (y0 + y1) // 2
                children = [(b, depth + 1) for b in ((x0, y0, mx, my), (mx, y0, x1, my),
                            (x0, my, mx, y1), (mx, my, x1, y1)) if mask_count(b)]
                if len(cores) + len(pending) + len(children) <= max_tiles:
                    pending.extend(children)
                    continue
                limit_reached = True
            cores.append((box, depth))
        if limit_reached:
            reason = 'tile count bounded by retaining covering parent regions; planning only'
    tiles = []
    core_area = 0
    for core, depth in cores:
        x0, y0, x1, y1 = core
        box = (max(0, x0 - overlap), max(0, y0 - overlap), min(width, x1 + overlap), min(height, y1 + overlap))
        padded_size = (_aligned(box[2] - box[0], multiple, min_tile), _aligned(box[3] - box[1], multiple, min_tile))
        tiles.append(Tile(core, box, depth, padded_size, padded_size[0] * padded_size[1]))
        core_area += (x1 - x0) * (y1 - y0)
    return TilePlan(mode, tuple(tiles), area, core_area, sum(t.processed_area for t in tiles), reason)


@dataclass(frozen=True)
class LODPlan:
    mode: Literal['disabled', 'empty', 'experimental']
    draft_size: tuple[int, int] | None
    draft_is_final: bool
    refinement: ROIPlan | None
    reason: str


def plan_lod(mask: Image.Image, *, enabled: bool = False, draft_scale: float = .5,
             multiple: int = 8, min_size: int = 64, halo: int = 32) -> LODPlan:
    """Describe a whole-image draft followed by ROI refinement, without execution."""
    if not math.isfinite(draft_scale) or not 0 < draft_scale < 1:
        raise ValueError('draft_scale must be finite and in (0, 1)')
    _positive_int(multiple, 'multiple')
    _positive_int(min_size, 'min_size')
    if not enabled:
        return LODPlan('disabled', None, False, None, 'experimental LOD planner is disabled')
    refinement = plan_roi(mask, halo=halo, multiple=multiple, min_size=min_size)
    if refinement.mode == 'empty':
        return LODPlan('empty', None, False, refinement, 'empty mask: no stages')
    size = tuple(_aligned(math.ceil(s * draft_scale), multiple, min_size) for s in mask.size)
    return LODPlan('experimental', size, False, refinement,
                   'draft is not a final image; no quality or model acceleration claim')

"""Reproducible CPU planning-only experiment; not a diffusion benchmark."""
from __future__ import annotations
import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import platform
import random
import statistics
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
import PIL
from PIL import Image, ImageDraw
from pankeki.planning import plan_lod, plan_roi, plan_tiles


def masks(size: int):
    for fraction in (.01, .05, .10, .25, .50, 1.):
        side = min(size, round(size * math.sqrt(fraction)))
        for location in ('center', 'edge'):
            mask = Image.new('L', (size, size))
            origin = (size - side) // 2 if location == 'center' else 0
            ImageDraw.Draw(mask).rectangle((origin, origin, origin + side - 1, origin + side - 1), fill=255)
            yield f'{location}_{fraction:.2f}', mask, fraction
    mask = Image.new('L', (size, size))
    draw = ImageDraw.Draw(mask)
    draw.rectangle((8, 8, 39, 39), fill=255)
    draw.rectangle((size - 40, size - 40, size - 9, size - 9), fill=255)
    yield 'disjoint_corners', mask, None
    yield 'empty', Image.new('L', (size, size)), 0.


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('evidence/planning-benchmark.json'))
    parser.add_argument('--size', type=int, default=1024)
    parser.add_argument('--warmup', type=int, default=3)
    parser.add_argument('--repeats', type=int, default=10)
    args = parser.parse_args()
    if args.size < 64 or args.warmup < 0 or args.repeats < 1:
        parser.error('size >= 64, warmup >= 0 and repeats >= 1 required')
    parameters = dict(halo=32, multiple=8, min_size=64, max_area_ratio=.75)
    tile_parameters = dict(tile_size=256, overlap=32, min_tile=64, max_depth=4, max_tiles=64, multiple=8)
    operations = {
        'B0_full_frame_plan': lambda m: plan_roi(m, **{**parameters, 'max_area_ratio': 0.000001}),
        'R2_roi_plan': lambda m: plan_roi(m, **parameters),
        'T1_fixed_plan': lambda m: plan_tiles(m, enabled=True, strategy='fixed', **tile_parameters),
        'T2_adaptive_plan': lambda m: plan_tiles(m, enabled=True, strategy='adaptive', **tile_parameters),
        'L1_lod_plan': lambda m: plan_lod(m, enabled=True, draft_scale=.5),
    }
    records = []
    cases = list(masks(args.size))
    rng = random.Random(20261019)
    for name, mask, fraction in cases:
        for _ in range(args.warmup):
            for operation in operations.values():
                operation(mask)
        timings = {name: [] for name in operations}
        plans = {}
        execution_order = []
        for iteration in range(args.repeats):
            order = list(operations)
            rng.shuffle(order)
            execution_order.append(order)
            for mode in order:
                started = time.perf_counter_ns()
                plan = operations[mode](mask)
                elapsed = time.perf_counter_ns() - started
                timings[mode].append({'iteration': iteration, 'duration_ns': elapsed})
                plans[mode] = asdict(plan)
        records.append({
            'case': name, 'size': mask.size, 'requested_mask_fraction': fraction,
            'actual_mask_pixels': int(np.count_nonzero(np.asarray(mask))),
            'mask_sha256': hashlib.sha256(mask.tobytes()).hexdigest(),
            'plans': plans, 'execution_order': execution_order, 'samples': timings,
            'summary_ms': {mode: {'p50': statistics.median([r['duration_ns'] for r in values]) / 1e6,
                                  'p95': float(np.percentile([r['duration_ns'] for r in values], 95)) / 1e6}
                           for mode, values in timings.items()},
        })
    output = {
        'schema': 'pankeki.planning.v1', 'created_utc': datetime.now(timezone.utc).isoformat(),
        'status': 'CPU planning experiment only; no model execution',
        'environment': {'python': sys.version, 'executable': sys.executable, 'platform': platform.platform(),
                        'pillow': PIL.__version__, 'numpy': np.__version__},
        'source_sha256': {str(path.relative_to(Path(__file__).resolve().parents[1])):
                          hashlib.sha256(path.read_bytes()).hexdigest()
                          for path in (Path(__file__).resolve(), Path(__file__).resolve().parents[1] / 'pankeki' / 'planning.py')},
        'settings': {'roi': parameters, 'tiles': tile_parameters, 'warmup': args.warmup, 'repeats': args.repeats,
                     'random_order_seed': 20261019, 'lod_draft_scale': .5},
        'limitations': ['p95 is descriptive with only the recorded sample count',
                       'model latency, VRAM, seam quality and semantic quality were not measured',
                       'processed_area counts overlap and model alignment; it is not FLOPs or speed',
                       'all masks are synthetic; retained tile parents can include unmasked area'],
        'gpu_latency_ms': None, 'gpu_peak_memory_bytes': None, 'quality_pass': None,
        'records': records,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Do not silently replace prior evidence.
    with args.output.open('x', encoding='utf-8') as handle:
        json.dump(output, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    print(f'{args.output.resolve()} | {len(records)} cases, {args.repeats} measured repetitions each')


if __name__ == '__main__':
    main()

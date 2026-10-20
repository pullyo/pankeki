"""Reproducible actual ComfyUI experiments; never creates synthetic AI outputs."""
import argparse
import base64
import csv
import json
import math
import random
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pankeki.engine import Engine, png_bytes
from pankeki.cache import ExactCache
from pankeki.jobs import JobManager


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repeat', type=int, default=10)
    parser.add_argument('--roi-repeat', type=int, default=3)
    parser.add_argument('--warmup', type=int, default=3)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--fingerprint-policy', choices=['strict', 'windows_read_lock'], default='strict')
    args = parser.parse_args()
    destination = args.output or ROOT / 'evidence' / ('gpu-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    destination.mkdir(parents=True, exist_ok=False)
    config = json.loads((ROOT / 'runtime' / 'config.json').read_text(encoding='utf-8-sig'))
    config['fingerprint_policy'] = args.fingerprint_policy
    (destination / 'config.json').write_text(json.dumps(config, indent=2), encoding='utf-8')
    engine = Engine(ROOT, config=config)
    engine.cache = ExactCache(destination / 'cache')
    manager = JobManager(engine)
    records = []
    rng = random.Random(20261019)
    common = dict(prompt='A small blue ceramic teapot on a wooden table, natural window light, product photograph',
                  seed=42, width=512, height=512, steps=1, cfg=1., denoise=1., feather=4)

    def run(condition, request, iteration=0, **tags):
        start = time.perf_counter()
        item = manager.submit('benchmark', request)
        result = manager.wait(item['job_id'], 900)
        if result['state'] != 'succeeded':
            (destination / 'failure.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
            raise RuntimeError(result['error'])
        row = dict(result['result']['metrics'], condition=condition, iteration=iteration,
                   client_submit_to_result_s=time.perf_counter() - start, **tags)
        records.append(row)
        with (destination / 'raw.jsonl').open('a', encoding='utf-8') as file:
            file.write(json.dumps(row, ensure_ascii=False) + '\n')
        print(f'{condition} {iteration}: {row["total_s"]:.3f}s cache={row["cache"]} input={row["model_size"]}', flush=True)
        return result['result']

    try:
        for i in range(args.warmup):
            run('warmup-new-seed', dict(common, seed=9000+i, cache=False), i)
        first = run('C1-app-miss', dict(common, cache=True))
        original = Image.open(first['image_path']).convert('RGB')
        original.save(destination / 'original.png')
        for i in range(args.repeat):
            conditions = ['B1-repeat-app-off', 'C2-exact-hit']
            rng.shuffle(conditions)
            for name in conditions:
                run(name, dict(common, cache=name == 'C2-exact-hit'), i)
            # New seed is a different inference task, reported separately from reuse.
            run('new-seed-app-miss', dict(common, seed=1000+i, cache=True), i)
        # Preview ablation on different seeds with matched steps/shapes. No speed claim from differing images.
        for i in range(3):
            for preview in (False, True):
                run('preview-on' if preview else 'preview-off', dict(common, seed=2000+i+int(preview)*100, cache=False, preview=preview), i)
        source = base64.b64encode(png_bytes(original)).decode()
        compare = []
        for ratio in (.01, .05, .10, .25, .50, 1.):
            side = round(512 * math.sqrt(ratio))
            x = (512-side)//2
            mask = Image.new('L', original.size)
            mask.paste(255, (x, x, x+side, x+side))
            mask_path = destination / f'mask-{ratio:g}.png'
            mask.save(mask_path)
            mask64 = base64.b64encode(png_bytes(mask)).decode()
            for i in range(args.roi_repeat):
                order = [False, True]
                rng.shuffle(order)
                pair = []
                for roi in order:
                    row = run('R2-app-roi' if roi else 'R1-full-mask', dict(common, mode='inpaint',
                        prompt='A small red ceramic teapot on a wooden table, natural window light, product photograph',
                        source=source, mask=mask64, roi=roi, cache=False, seed=4000+i, halo=32), i, requested_mask_ratio=ratio)
                    pair.append((roi, row['image_path']))
                if i == 0:
                    compare.append((ratio, sorted(pair)))
        sheet = Image.new('RGB', (512*3, 550*len(compare)), '#202822')
        draw = ImageDraw.Draw(sheet)
        for y, (ratio, pair) in enumerate(compare):
            sheet.paste(original, (0, y*550+30))
            draw.text((12,y*550+8), f'Mask target {ratio:.0%} | original / full inpaint / app ROI', fill='white')
            for x, (_, path) in enumerate(pair, 1):
                with Image.open(path) as image:
                    sheet.paste(image.convert('RGB'), (x*512,y*550+30))
        sheet.save(destination / 'roi-contact-sheet.jpg', quality=92)
    finally:
        manager.close()
        if not manager.worker.is_alive():
            engine.close()
    summaries = {}
    for condition in sorted({row['condition'] for row in records}):
        values = [row['client_submit_to_result_s'] for row in records if row['condition'] == condition]
        summaries[condition] = {'n': len(values), 'p50_s': statistics.median(values),
            'p95_s_empirical': float(np.percentile(values,95)), 'min_s': min(values), 'max_s': max(values)}
    summary = {'status':'completed', 'kind':'actual GPU ComfyUI plus exact reuse', 'conditions':summaries,
        'fingerprint_policy': engine.fingerprint_policy, 'fingerprint_setup_s': engine.fingerprint_setup_s,
        'notes':['B1 repeated graph retains default ComfyUI RAM cache; C2 skips ComfyUI submission entirely.',
                 'Source/process checks always run; strict policy rehashes model per request, read-lock policy pays setup once.',
                 'Experiment uses a fresh dedicated completed-result cache; the user app cache is preserved.',
                 'New seed is a different inference task, not an exact-hit speedup baseline.',
                 'ROI changes context/shape; quality equivalence is not assumed. ROI default remains off.',
                 'p95 from small samples is descriptive only. ROI3 repeats per area is exploratory; not a stable tail estimate.',
                 'CUDA per-component timing and allocated/reserved peak VRAM are unmeasured (null).',
                 'Client ready time is measured; browser final paint time is not measured.']}
    (destination / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    with (destination / 'summary.csv').open('w', newline='', encoding='utf-8-sig') as file:
        writer = csv.DictWriter(file, fieldnames=['condition','n','p50_s','p95_s_empirical','min_s','max_s'])
        writer.writeheader()
        for name,value in summaries.items():
            writer.writerow(dict(condition=name,**value))
    print(destination, flush=True)


if __name__ == '__main__':
    main()

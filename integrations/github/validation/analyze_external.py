"""Derive comparison summaries without editing raw generation measurements."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import statistics
import numpy as np
from PIL import Image


def sampler_cached(record):
    metrics = record['adapter_metrics']
    cached = set(metrics.get('comfy_cached_nodes') or [])
    for kind, event in metrics.get('history_messages', []):
        if kind == 'execution_cached':
            cached.update(event.get('nodes', []))
    return '5' in cached


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run', type=Path)
    args = parser.parse_args()
    records = json.loads((args.run / 'gpu' / 'gpu-comparison.json').read_text(encoding='utf-8'))['records']
    measured = [r for r in records if not r.get('warmup', True)]
    summary = []
    for case in sorted({r['case'] for r in measured}):
        for mode in ('baseline', 'app_roi', 'crop_and_stitch'):
            selected = [r for r in measured if r['case'] == case and r['mode'] == mode]
            uncached = [r for r in selected if not sampler_cached(r)]
            summary.append({'case': case, 'mode': mode, 'n_total': len(selected),
                            'sampler_cached_samples': sum(sampler_cached(r) for r in selected),
                            'n_not_cached': len(uncached),
                            'p50_adapter_s_all': statistics.median(r['adapter_metrics']['submit_to_download_s'] for r in selected),
                            'p50_adapter_s_sampler_not_cached': statistics.median(r['adapter_metrics']['submit_to_download_s'] for r in uncached) if uncached else None,
                            'model_size': selected[0]['model_size'],
                            'outside_mask_max_error': max(r['outside_mask_max_error'] for r in selected)})
    pairs = []
    for case in sorted({r['case'] for r in measured}):
        for iteration in sorted({r['iteration'] for r in measured if r['case'] == case}):
            paths = {r['mode']: Path(r['path']) for r in measured if r['case'] == case and r['iteration'] == iteration}
            images = {}
            for mode, path in paths.items():
                with Image.open(path) as image:
                    images[mode] = np.array(image.convert('RGB'), dtype=np.int16)
            for mode in ('baseline', 'crop_and_stitch'):
                delta = np.abs(images['app_roi'] - images[mode])
                pairs.append({'case': case, 'iteration': iteration, 'pair': ['app_roi', mode],
                              'pixel_identical': bool(not delta.any()), 'max_channel_difference': int(delta.max()),
                              'mean_absolute_channel_difference': float(delta.mean())})
    result = {'kind': 'derived analysis of saved actual ComfyUI runs', 'raw_records': len(records),
              'measured_records': len(measured), 'summaries': summary, 'pairwise_pixels': pairs,
              'limitations': ['n=3 per mode is a smoke comparison, not a stable performance estimate',
                             'No event marking sampler cached does not prove a CUDA stage duration',
                             'Pixel differences are not a semantic/perceptual quality score',
                             'Crop contexts differ and synthetic gradient inputs are not a real editing quality suite']}
    output = args.run / 'analysis.json'
    with output.open('x', encoding='utf-8') as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    print(json.dumps(result, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()

"""Bounded, pre-change SDXL ablations on the existing Comfy server.

This records an experimental graph, not a successful Pankeki application job.
It refuses to run after product sources change from the completed baseline.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import sys
import time
import uuid

import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pankeki.comfy_adapter import ComfyClient
from pankeki.composite import composite
from pankeki.environment import source_fingerprint
from pankeki.workflows import inpaint


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--name', required=True, choices=['neutral-065', 'preserve-normal-065'])
    parser.add_argument('--denoise', required=True, type=float)
    args = parser.parse_args()
    if args.denoise != .65:
        parser.error('Name and denoise must identify the declared single-variable trial')
    root = ROOT / 'runtime/macos/inpaint-quality/ai'
    baseline_job = json.loads((root / 'baseline/edit-job.json').read_text())
    baseline = Path(baseline_job['result']['image_path']).parent
    recipe = json.loads((baseline / 'recipe.json').read_text())
    if source_fingerprint(ROOT / 'pankeki') != recipe['adapter_source_sha256']:
        raise RuntimeError('Product sources changed since baseline; coordinator restart/integration required')
    attempts = sum(1 for p in root.iterdir() if p.is_dir() and (
        (p / 'edit-job.json').exists() or (p / 'attempt-started.json').exists()))
    if attempts >= 4:
        raise RuntimeError('Initial four-submission experiment budget exhausted; do not resubmit')
    directory = root / args.name
    directory.mkdir(exist_ok=False)
    started = time.monotonic()
    job_id = 'experiment-' + uuid.uuid4().hex
    with Image.open(baseline / 'original.png') as im:
        source = im.copy()
    with Image.open(baseline / 'mask.png') as im:
        mask = im.convert('L')
    source.save(directory / 'original.png')
    mask.save(directory / 'mask.png')
    upload = source.convert('RGBA')
    upload.putalpha(ImageOps.invert(mask))
    buffer = io.BytesIO()
    upload.save(buffer, format='PNG')
    data = buffer.getvalue()
    client = ComfyClient('http://127.0.0.1:8188')
    model = 'sd_xl_base_1.0.safetensors'
    workflow = inpaint(model, recipe['prompt'], hashlib.sha256(data).hexdigest() + '.png',
        negative=recipe['negative'], seed=recipe['seed'], steps=recipe['steps'],
        cfg=recipe['cfg'], denoise=args.denoise, sampler=recipe['sampler'],
        scheduler='normal' if args.name == 'preserve-normal-065' else recipe['scheduler'])
    # The neutral trial changes only the encoder; the normal trial changes
    # only the scheduler. Node 9 retains the original noise mask in both.
    if args.name == 'neutral-065':
        workflow['8'] = {'class_type': 'VAEEncodeForInpaint', 'inputs': {
            'pixels': ['4', 0], 'vae': ['1', 2], 'mask': ['4', 1], 'grow_mask_by': 0}}
    request_recipe = dict(recipe, denoise=args.denoise, experiment_id=job_id,
        route='direct Comfy graph ablation before product changes', cache=False,
        scheduler='normal' if args.name == 'preserve-normal-065' else recipe['scheduler'],
        changed_variable='encoder' if args.name == 'neutral-065' else 'scheduler',
        comparison='baseline')
    request_recipe['baseline_app_job_id'] = request_recipe.pop('job_id')
    request_recipe.pop('revision', None)
    (directory / 'recipe.json').write_text(json.dumps(request_recipe, ensure_ascii=False, indent=2))
    # Persist intent before network submission: an uncertain submit is never retried.
    (directory / 'attempt-started.json').write_text(json.dumps({'experiment_id': job_id,
        'baseline_app_job_id': baseline_job['job_id'], 'attempt': attempts + 1}))
    actual = client.upload_png(data, workflow['4']['inputs']['image'])
    workflow['4']['inputs']['image'] = actual
    (directory / 'workflow.json').write_text(json.dumps(workflow, ensure_ascii=False, indent=2))
    previews = []

    def submitted(prompt_id):
        (directory / 'submitted.json').write_text(json.dumps({'experiment_id': job_id, 'prompt_id': prompt_id}))
        print(json.dumps({'experiment_id': job_id, 'prompt_id': prompt_id, 'attempt': attempts + 1}), flush=True)

    raw, metrics = client.execute(workflow, timeout=900, on_preview=lambda frame: previews.append(len(frame)), on_submitted=submitted)
    (directory / 'raw.png').write_bytes(raw)
    with Image.open(io.BytesIO(raw)) as im:
        generated = im.convert('RGB')
    output = composite(source.convert('RGB'), generated, mask, None, feather=recipe['feather'])
    if source.mode == 'RGBA':
        output.putalpha(source.getchannel('A'))
    output.save(directory / 'result.png')
    original, pixels = np.asarray(source.convert('RGBA')), np.asarray(output.convert('RGBA'))
    inside = np.asarray(mask) > 0
    delta = np.abs(pixels.astype(np.int16) - original.astype(np.int16))
    summary = {'experiment_id': job_id, 'prompt_id': metrics['prompt_id'], 'model_id': 'sdxl-base',
        'model_name': model, 'seed': recipe['seed'], 'denoise': args.denoise,
        'denoiser_executed': metrics['denoiser_executed'], 'cache': 'Pankeki exact cache not used; direct graph ablation',
        'outside_mask_max_error': int(delta[~inside, :3].max()),
        'alpha_max_error': int(delta[..., 3].max()),
        'alpha_scope': 'opaque RGB source; RGBA preservation separately requires unit coverage',
        'changed_inside_pixels': int(np.count_nonzero(np.any(delta[inside, :3], axis=1))),
        'preview_accepted_count': len(previews), 'elapsed_s': round(time.monotonic() - started, 3),
        'source_sha256': hashlib.sha256((directory / 'original.png').read_bytes()).hexdigest(),
        'mask_sha256': hashlib.sha256((directory / 'mask.png').read_bytes()).hexdigest(),
        'image_sha256': hashlib.sha256((directory / 'result.png').read_bytes()).hexdigest(),
        'file': str(directory / 'result.png')}
    (directory / 'metrics.json').write_text(json.dumps(metrics, ensure_ascii=False, indent=2))
    (directory / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    print(json.dumps(summary, ensure_ascii=False), flush=True)
    if not summary['denoiser_executed']:
        raise RuntimeError('Sampler cache hit: no new model inference; no automatic retry')
    if summary['outside_mask_max_error'] or summary['alpha_max_error']:
        raise RuntimeError('Pixel preservation failed')


if __name__ == '__main__':
    main()

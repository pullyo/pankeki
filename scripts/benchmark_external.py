"""Validate pinned CropAndStitch geometry and optionally run real ComfyUI GPU comparisons.

No dependency installation, server restart, approximate cache or model download.
CPU node tests are actual plugin calls, but are not diffusion inference.
"""
from __future__ import annotations
import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import platform
import random
import sys
import time
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]
INTEGRATION = ROOT / 'integrations' / 'github'
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(INTEGRATION))

import numpy as np
from PIL import Image, ImageOps
from pankeki.comfy_adapter import ComfyClient
from pankeki.composite import composite
from pankeki.planning import plan_roi, crop_for_plan, unpad_generated
from pankeki.workflows import inpaint
from workflow_bridge import add_crop_and_stitch


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + '\n', encoding='utf-8')


def png(image):
    stream = io.BytesIO()
    image.save(stream, format='PNG')
    return stream.getvalue()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def source_image(size):
    width, height = size
    ys, xs = np.indices((height, width))
    return Image.fromarray(np.stack(((xs * 3) % 256, (ys * 5) % 256, (xs + ys) % 256), axis=-1).astype(np.uint8))


def mask_cases():
    cases = []
    for name, size, boxes in [
        ('empty', (512, 512), []),
        ('single_pixel', (512, 512), [(255, 255, 256, 256)]),
        ('edge_one_pixel', (513, 385), [(512, 384, 513, 385)]),
        ('center', (768, 512), [(272, 144, 496, 368)]),
        ('edge', (768, 512), [(0, 0, 224, 224)]),
        ('disjoint', (768, 512), [(8, 8, 24, 24), (744, 488, 760, 504)]),
        ('full', (512, 512), [(0, 0, 512, 512)]),
        ('above_maximum', (2049, 256), [(0, 0, 2049, 256)]),
    ]:
        mask = Image.new('L', size)
        for box in boxes:
            mask.paste(255, box)
        cases.append((name, source_image(size), mask))
    return cases


def model_shape_policy(size, minimum, maximum, multiple=8):
    if min(size) < minimum:
        return 'fallback: below conservative model minimum'
    if max(size) > maximum:
        return 'fallback: above configured model maximum'
    if any(side % multiple for side in size):
        return 'fallback: model spatial multiple mismatch'
    return 'eligible'


def crop_graph(model='unused', image_name='unused.png', seed=42):
    return add_crop_and_stitch(inpaint(model, 'a red ceramic teapot', image_name, seed=seed), encode_node_id='8', output_node_id='7')


def load_plugin():
    path = INTEGRATION / 'sources' / 'ComfyUI-Inpaint-CropAndStitch' / 'inpaint_cropandstitch.py'
    spec = importlib.util.spec_from_file_location('pankeki_validation_cropandstitch', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def cpu_validation(destination, minimum, maximum):
    import torch
    plugin = load_plugin()
    graph = crop_graph()
    kwargs = dict(next(node['inputs'] for node in graph.values() if node['class_type'] == 'InpaintCropImproved'))
    kwargs.pop('image'); kwargs.pop('mask')
    results = []
    for name, original, mask in mask_cases():
        case_dir = destination / name
        case_dir.mkdir()
        original.save(case_dir / 'original.png'); mask.save(case_dir / 'mask.png')
        image_tensor = torch.from_numpy(np.array(original).astype(np.float32) / 255.).unsqueeze(0)
        mask_tensor = torch.from_numpy(np.array(mask).astype(np.float32) / 255.).unsqueeze(0)
        started = time.perf_counter()
        stitcher, crop, cropped_mask = plugin.InpaintCropImproved().inpaint_crop(image=image_tensor, mask=mask_tensor, **kwargs)
        crop_s = time.perf_counter() - started
        shape = (int(crop.shape[2]), int(crop.shape[1]))
        generated = torch.zeros_like(crop)
        generated[..., 0] = 1.
        started = time.perf_counter()
        stitched, = plugin.InpaintStitchImproved().inpaint_stitch(stitcher, generated)
        stitch_s = time.perf_counter() - started
        assert tuple(stitched.shape) == tuple(image_tensor.shape), (name, stitched.shape, image_tensor.shape)
        guarded = image_tensor * (1 - mask_tensor.unsqueeze(-1)) + stitched * mask_tensor.unsqueeze(-1)
        pixels = np.clip(guarded[0].detach().cpu().numpy() * 255., 0, 255).astype(np.uint8)
        outside = np.asarray(mask) == 0
        errors = np.abs(pixels.astype(np.int16) - np.asarray(original).astype(np.int16))
        outside_error = int(errors[outside].max()) if outside.any() else 0
        assert outside_error == 0, (name, outside_error)
        Image.fromarray(pixels).save(case_dir / 'guarded-stitch.png')
        Image.fromarray(np.clip(crop[0].detach().cpu().numpy() * 255., 0, 255).astype(np.uint8)).save(case_dir / 'crop.png')
        Image.fromarray(np.clip(cropped_mask[0].detach().cpu().numpy() * 255., 0, 255).astype(np.uint8)).save(case_dir / 'crop-mask.png')
        results.append({'case': name, 'input_size': list(original.size), 'mask_pixels': int(np.count_nonzero(np.asarray(mask))),
                        'crop_size': list(shape), 'model_pixels': shape[0] * shape[1], 'crop_cpu_s': crop_s,
                        'stitch_cpu_s': stitch_s, 'outside_mask_max_error': outside_error,
                        'policy': 'skip: empty mask' if not mask.getbbox() else model_shape_policy(shape, minimum, maximum),
                        'original_sha256': sha(png(original)), 'mask_sha256': sha(png(mask)),
                        'resize_requested': False, 'diffusion_executed': False})
    record = {'status': 'passed', 'kind': 'actual pinned plugin CPU crop/stitch calls; synthetic generated crop',
              'torch': torch.__version__, 'cases': results, 'model_minimum': minimum, 'model_maximum': maximum}
    write_json(destination / 'cpu-validation.json', record)
    return record


def guarded_baseline(model, prompt, image_name, seed, steps):
    graph = inpaint(model, prompt, image_name, seed=seed, steps=steps, cfg=1., denoise=1.)
    graph['9'] = {'class_type': 'ImageCompositeMasked', 'inputs': {
        'destination': ['4', 0], 'source': ['6', 0], 'mask': ['4', 1], 'x': 0, 'y': 0, 'resize_source': False}}
    graph['7']['inputs']['images'] = ['9', 0]
    return graph


def upload(client, original, mask):
    image = original.convert('RGBA')
    image.putalpha(ImageOps.invert(mask))
    data = png(image)
    return client.upload_png(data, sha(data) + '.png')


def gpu_validation(destination, args, cpu):
    client = ComfyClient(args.url)
    schema = client.get('/object_info')
    missing = [name for name in ('InpaintCropImproved', 'InpaintStitchImproved') if name not in schema]
    if missing:
        raise RuntimeError('Pinned nodes are not registered: ' + ', '.join(missing))
    write_json(destination / 'object-info-selected.json', {name: schema[name] for name in ('InpaintCropImproved', 'InpaintStitchImproved', 'VAEEncodeForInpaint', 'ImageCompositeMasked')})
    models = schema['CheckpointLoaderSimple']['input']['required']['ckpt_name'][0]
    if args.model not in models:
        raise RuntimeError(f'Requested model {args.model!r} is not installed; no model downloaded')
    crop_schema = schema['InpaintCropImproved']
    if crop_schema['output'][:3] != ['STITCHER', 'IMAGE', 'MASK']:
        raise RuntimeError('Unexpected crop output slots')
    cpu_cases = {case['case']: case for case in cpu['cases']}
    rng = random.Random(20261019)
    raw = []
    for name, original, mask in mask_cases():
        if name not in args.cases:
            continue
        if not mask.getbbox():
            raw.append({'case': name, 'status': 'skipped-empty-mask', 'model_calls': 0})
            continue
        crop_metadata = cpu_cases[name]
        if crop_metadata['policy'] != 'eligible':
            raw.append({'case': name, 'status': crop_metadata['policy'], 'model_calls': 0})
            continue
        case_dir = destination / name
        case_dir.mkdir()
        plan = plan_roi(mask, halo=32, min_size=args.minimum)
        original.save(case_dir / 'original.png'); mask.save(case_dir / 'mask.png')
        full_name = upload(client, original, mask)
        roi_name = upload(client, crop_for_plan(original, plan), crop_for_plan(mask, plan, is_mask=True))
        for iteration in range(-args.warmup, args.repeats):
            seed = 42 + (iteration if iteration >= 0 else 1000 - iteration)
            order = ['baseline', 'app_roi', 'crop_and_stitch']
            rng.shuffle(order)
            for mode in order:
                run_dir = case_dir / f'{iteration:+03d}-{mode}'
                run_dir.mkdir()
                graph = inpaint(args.model, args.prompt, roi_name if mode == 'app_roi' else full_name,
                                seed=seed, steps=args.steps, cfg=1., denoise=1.)
                if mode == 'baseline':
                    graph = guarded_baseline(args.model, args.prompt, full_name, seed, args.steps)
                elif mode == 'crop_and_stitch':
                    graph = add_crop_and_stitch(graph, encode_node_id='8', output_node_id='7')
                    crop_id = next(key for key, node in graph.items() if node['class_type'] == 'InpaintCropImproved')
                    graph['pankeki_crop_evidence'] = {'class_type': 'PreviewImage', 'inputs': {'images': [crop_id, 1]}}
                # SaveImage prefix changes only the output node; denoiser cache
                # behavior remains observable in the adapter's cached-node log.
                graph['7']['inputs']['filename_prefix'] = 'PankekiExternalValidation'
                write_json(run_dir / 'workflow.json', graph)
                started = time.perf_counter()
                data, measured = client.execute(graph, timeout=args.timeout)
                (run_dir / 'raw-output.png').write_bytes(data)
                with Image.open(io.BytesIO(data)) as output:
                    output = output.convert('RGB')
                if mode == 'app_roi':
                    output = composite(original, unpad_generated(output, plan), mask, plan.bbox, feather=0)
                    model_size = list(plan.padded_size)
                elif mode == 'crop_and_stitch':
                    history = client.get('/history/' + measured['prompt_id'])[measured['prompt_id']]
                    item = history['outputs']['pankeki_crop_evidence']['images'][0]
                    crop_data = client._request('/view?' + urlencode(item))
                    (run_dir / 'actual-model-input.png').write_bytes(crop_data)
                    with Image.open(io.BytesIO(crop_data)) as actual_crop:
                        model_size = list(actual_crop.size)
                    assert model_size == crop_metadata['crop_size'], (model_size, crop_metadata)
                else:
                    model_size = list(original.size)
                elapsed = time.perf_counter() - started
                if output.size != original.size:
                    raise RuntimeError(f'{mode}: output dimensions changed')
                delta = np.abs(np.asarray(output).astype(np.int16) - np.asarray(original).astype(np.int16))
                outside = np.asarray(mask) == 0
                outside_error = int(delta[outside].max()) if outside.any() else 0
                if outside_error:
                    raise RuntimeError(f'{mode}: outside-mask pixels changed, max={outside_error}')
                final = png(output)
                (run_dir / 'result.png').write_bytes(final)
                record = {'case': name, 'mode': mode, 'iteration': iteration, 'warmup': iteration < 0,
                          'seed': seed, 'steps': args.steps, 'cfg': 1., 'denoise': 1., 'sampler': 'euler', 'scheduler': 'normal',
                          'total_observed_s': elapsed, 'model_size': model_size, 'model_pixels': model_size[0] * model_size[1],
                          'outside_mask_max_error': outside_error, 'sha256': sha(final), 'path': str(run_dir / 'result.png'),
                          'denoiser_cuda_s': None, 'gpu_peak_memory_bytes': None, 'perceptual_quality_approved': None,
                          'app_plan': asdict(plan) if mode == 'app_roi' else None, 'adapter_metrics': measured}
                write_json(run_dir / 'measurement.json', record)
                raw.append(record)
                print(f'{name} {mode} iteration={iteration} input={model_size} wall={elapsed:.3f}s outside={outside_error}', flush=True)
    write_json(destination / 'gpu-comparison.json', {
        'status': 'completed', 'kind': 'real ComfyUI model generation', 'records': raw,
        'fairness': ['Same source, mask, seed, prompt and sampler settings per iteration',
                     'New seed each iteration prevents identical denoiser-result hits across repetitions',
                     'Mode execution order shuffled with fixed seed; upstream Comfy caches remain active and logged',
                     'Uploads occur before timed runs; output fetch and app composite are included',
                     'External crop evidence fetch adds observation overhead; use adapter submit_to_download_s for comparison',
                     'Crop context differs across modes; output quality equivalence is NOT established',
                     'CUDA stage timings and peak GPU memory are not measured'],
    })
    return raw


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--phase', choices=('cpu', 'all'), default='cpu')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--url', default='http://127.0.0.1:8188')
    parser.add_argument('--model', default='sd_turbo.safetensors')
    parser.add_argument('--prompt', default='a red ceramic teapot, detailed product photograph, soft daylight')
    parser.add_argument('--minimum', type=int, default=256)
    parser.add_argument('--maximum', type=int, default=2048)
    parser.add_argument('--steps', type=int, default=1)
    parser.add_argument('--warmup', type=int, default=1)
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--cases', nargs='+', choices=['empty', 'single_pixel', 'edge_one_pixel', 'center', 'edge', 'disjoint', 'full', 'above_maximum'], default=['center', 'edge', 'full'])
    parser.add_argument('--timeout', type=float, default=600)
    args = parser.parse_args()
    if not 8 <= args.minimum <= args.maximum or args.repeats < 1 or args.warmup < 0 or not 1 <= args.steps <= 100 or args.timeout <= 0:
        parser.error('valid size bounds, repeats>=1, warmup>=0, 1<=steps<=100 and timeout>0 required')
    destination = args.output or INTEGRATION / 'validation' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    destination.mkdir(parents=True, exist_ok=False)
    summary = {'started_utc': datetime.now(timezone.utc).isoformat(), 'python': sys.version, 'executable': sys.executable,
               'platform': platform.platform(), 'arguments': {key: str(value) if isinstance(value, Path) else value for key, value in vars(args).items()},
               'source_lock': json.loads((INTEGRATION / 'sources.lock.json').read_text(encoding='utf-8')),
               'source_sha256': {str(path.relative_to(ROOT)): sha(path.read_bytes()) for path in [
                   Path(__file__), INTEGRATION / 'workflow_bridge.py',
                   INTEGRATION / 'sources' / 'ComfyUI-Inpaint-CropAndStitch' / 'inpaint_cropandstitch.py']},
               'cpu_status': 'not_run', 'gpu_status': 'not_run', 'wavespeed_enabled': False}
    try:
        cpu_dir = destination / 'cpu'; cpu_dir.mkdir()
        cpu = cpu_validation(cpu_dir, args.minimum, args.maximum)
        summary['cpu_status'] = 'passed'
        if args.phase == 'all':
            gpu_dir = destination / 'gpu'; gpu_dir.mkdir()
            gpu_validation(gpu_dir, args, cpu)
            summary['gpu_status'] = 'passed_pixel_checks_quality_unreviewed'
        summary['status'] = 'completed'
        return 0
    except Exception as exc:
        summary['status'] = 'failed_or_environment_unavailable'
        summary['error'] = f'{type(exc).__name__}: {exc}'
        print(summary['error'], file=sys.stderr)
        return 1
    finally:
        write_json(destination / 'summary.json', summary)
        print(str(destination.resolve()))


if __name__ == '__main__':
    raise SystemExit(main())

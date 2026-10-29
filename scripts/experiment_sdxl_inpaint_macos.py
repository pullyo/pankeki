"""Isolated SDXL Inpaint 0.1 trial; offline preparation is the default.

No downloads, model defaults, application sources, or server restarts are changed.
Run only after the coordinator releases the GPU and the Mac model report exists.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import threading
import time

import numpy as np
from PIL import Image, ImageOps
from safetensors.numpy import load_file

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pankeki.comfy_adapter import ComfyClient
from pankeki.composite import composite
from pankeki.environment import source_fingerprint
from pankeki.workflows import inpaint

TRIAL = ROOT / 'runtime/macos/inpaint-quality/ai/inpaint-v01'
BASELINE = ROOT / 'runtime/macos/inpaint-quality/ai/baseline'
BASE_PATH = ROOT / 'models/checkpoints/sd_xl_base_1.0.safetensors'
BASE_IDENTITY = {'bytes': 6938078334,
    'sha256': '31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b'}
UNET_IDENTITY = {'bytes': 5135178560,
    'sha256': '6470840731e98cc16713ddf3ac7ee458c9fdbcb881a98c6727cd4a938f227d3f',
    'repo_id': 'diffusers/stable-diffusion-xl-1.0-inpainting-0.1',
    'revision': '115134f363124c53c7d878647567d04daf26e41e',
    'filename': 'unet/diffusion_pytorch_model.fp16.safetensors'}
PHASES = ('smoke', 'compare-inpaint-065', 'compare-base-099')


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + '\n')


def build_workflow(recipe, method, unet_name, prefix):
    """Connect the chosen method to the same sampler/decoder boundary."""
    if method not in ('base', 'inpaint-v01'):
        raise ValueError('Unknown method')
    graph = inpaint(BASE_PATH.name, recipe['prompt'], 'unbound.png',
        negative=recipe['negative'], seed=recipe['seed'], steps=recipe['steps'],
        cfg=recipe['cfg'], denoise=recipe['denoise'], sampler=recipe['sampler'], scheduler=recipe['scheduler'])
    if method == 'inpaint-v01':
        if not unet_name:
            raise ValueError('A verified UNETLoader alias is required')
        graph['8'] = {'class_type': 'UNETLoader', 'inputs': {
            'unet_name': unet_name, 'weight_dtype': 'default'}}
        graph['9'] = {'class_type': 'InpaintModelConditioning', 'inputs': {
            'positive': ['2', 0], 'negative': ['3', 0], 'vae': ['1', 2],
            'pixels': ['4', 0], 'mask': ['4', 1], 'noise_mask': True}}
        graph['5']['inputs'].update(model=['8', 0], positive=['9', 0],
            negative=['9', 1], latent_image=['9', 2])
    graph['7']['inputs']['filename_prefix'] = prefix
    graph['10'] = {'class_type': 'SaveLatent', 'inputs': {
        'samples': ['5', 0], 'filename_prefix': 'latents/' + prefix}}
    return graph


def verify_file(path, identity):
    """Verify the exact weight bytes, not only size or timestamp."""
    path = Path(path)
    stat = path.stat()
    if stat.st_size != identity['bytes']:
        raise ValueError(f'Weight size mismatch: {path}')
    with path.open('rb') as stream:
        actual = hashlib.file_digest(stream, 'sha256').hexdigest()
    if actual != identity['sha256']:
        raise ValueError(f'Weight SHA256 mismatch: {path}')
    return dict(identity, path=str(path.resolve()), verified=True,
        stat_identity=[stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns])


def validate_handoff(path):
    """Require the coordinator's recorded GPU release before any HTTP call."""
    try:
        record = json.loads(Path(path).read_text())
    except (OSError, ValueError) as exc:
        raise ValueError('GPU handoff record is missing or invalid') from exc
    if (record.get('released_by') != 'root' or record.get('ui_verification_complete') is not True
            or record.get('scope') != 'sdxl-inpaint-v01-limited' or not record.get('message')
            or record.get('max_new_inference_submissions') != 3
            or set(record.get('phases', [])) != set(PHASES)
            or record.get('stop_on_smoke_technical_failure') is not True):
        raise ValueError('GPU handoff has not been completed by the coordinator')
    return record


def claim_attempt(root, phase):
    """Reserve one non-retryable phase after offline/live preflight."""
    if phase not in PHASES:
        raise ValueError('Unplanned phase')
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    if phase != 'smoke':
        summary = root / 'smoke/summary.json'
        if not summary.exists() or json.loads(summary.read_text()).get('technical_pass') is not True:
            raise ValueError('A technically successful smoke is required; no parameter retries')
    directory = root / phase
    directory.mkdir(exist_ok=False)
    write_json(directory / 'attempt-started.json', {'phase': phase,
        'time_utc': datetime.now(timezone.utc).isoformat(), 'automatic_retry': False})
    return directory


def latent_finiteness(path):
    """Inspect saved sampler floats before PNG quantization."""
    values = load_file(path)['latent_tensor']
    if not values.size:
        raise ValueError('Saved sampler latent is empty')
    finite = np.isfinite(values)
    return {'all_finite': bool(finite.all()), 'nonfinite_values': int((~finite).sum()),
        'shape': list(values.shape), 'dtype': str(values.dtype),
        'minimum_finite': float(values[finite].min()) if finite.any() else None,
        'maximum_finite': float(values[finite].max()) if finite.any() else None,
        'scope': 'actual saved sampler float tensor; not VAE decoded float tensor'}


def compose_result(source, mask, generated, feather):
    """Preserve exterior RGB and every original alpha value."""
    output = composite(source.convert('RGB'), generated.convert('RGB'), mask, None, feather=feather)
    if source.mode in ('RGBA', 'LA') or 'transparency' in source.info:
        output.putalpha(source.convert('RGBA').getchannel('A'))
    return output


def pixel_metrics(source, mask, output):
    """Measure preservation separately from color/quality heuristics."""
    if source.size != mask.size or source.size != output.size:
        raise ValueError('Image dimensions do not match')
    original = np.asarray(source.convert('RGBA'))
    pixels = np.asarray(output.convert('RGBA'))
    inside = np.asarray(mask.convert('L')) > 0
    if not inside.any():
        raise ValueError('The controlled mask must not be empty')
    delta = np.abs(pixels.astype(np.int16) - original.astype(np.int16))
    selected_rgb = pixels[inside, :3].astype(np.int16)
    return {'outside_mask_max_error': int(delta[~inside, :3].max()) if (~inside).any() else None,
        'alpha_max_error': int(delta[..., 3].max()),
        'changed_inside_pixels': int(np.count_nonzero(np.any(delta[inside, :3], axis=1))),
        'nonopaque_source_pixels': int(np.count_nonzero(original[..., 3] != 255)),
        'selected_gray_fraction': float((np.ptp(selected_rgb, axis=1) <= 8).mean()),
        'selected_black_fraction': float((selected_rgb.max(axis=1) <= 4).mean()),
        'color_heuristic_scope': 'red-scarf diagnostic alert only; four-axis quality requires image review'}


def prepare():
    """Write reviewable plans without reading weights, probing servers or using GPU."""
    TRIAL.mkdir(parents=True, exist_ok=True)
    if any((TRIAL / phase).exists() for phase in PHASES):
        raise ValueError('An attempt exists; do not rewrite its preparation')
    recipe = json.loads((BASELINE / 'recipe.json').read_text())
    if source_fingerprint(ROOT / 'pankeki') != recipe['adapter_source_sha256']:
        raise ValueError('Product sources differ from baseline; ask coordinator to reconcile')
    packet = {key: recipe[key] for key in ('prompt', 'negative', 'seed', 'steps', 'cfg',
        'denoise', 'sampler', 'scheduler', 'feather', 'roi', 'width', 'height')}
    prepared = TRIAL / 'prepared'
    prepared.mkdir(exist_ok=True)
    inputs = {}
    for name in ('original.png', 'mask.png'):
        expected = recipe['original_sha256' if name == 'original.png' else 'mask_sha256']
        if hashlib.sha256((BASELINE / name).read_bytes()).hexdigest() != expected:
            raise ValueError('Saved baseline input does not match its recipe')
        shutil.copyfile(BASELINE / name, prepared / name)
        inputs[name] = hashlib.sha256((prepared / name).read_bytes()).hexdigest()
    phases = {}
    for phase in PHASES:
        strength = .65 if phase == 'compare-inpaint-065' else .99
        request = dict(packet, denoise=strength)
        method = 'base' if phase == 'compare-base-099' else 'inpaint-v01'
        phases[phase] = {'method': method, 'recipe': request,
            'departures_from_baseline': {'denoise': [packet['denoise'], strength]} if strength != packet['denoise'] else {}}
        graph = build_workflow(request, method, '<verified core UNETLoader alias>', 'Pankeki_Inpaint01_' + phase)
        write_json(prepared / (phase + '-workflow.json'), graph)
    plan = {'status': 'prepared-not-run', 'scope': 'sdxl-inpaint-v01-limited', 'max_submissions': 3,
        'baseline_job_id': recipe['job_id'], 'inputs': inputs, 'phases': phases,
        'comparison_pairs': {'denoise065': ['reuse verified ai/baseline', 'compare-inpaint-065'],
            'denoise099': ['compare-base-099', 'smoke']},
        'base_identity': BASE_IDENTITY, 'unet_identity': UNET_IDENTITY,
        'adapter_source_sha256': recipe['adapter_source_sha256'],
        'method_comparison': 'model plus required nine-channel conditioning; not a UNet-only ablation',
        'official_example_difference': 'smoke and fresh Base control use Comfy denoise .99; inpaint comparison .65 reuses verified Base .65. All retain 25 steps/CFG6/dpmpp_2m/karras. Model card has Diffusers strength .99, 20 steps/CFG8; strength and denoise schedules are not asserted equivalent.',
        'gpu_gate': 'coordinator handoff and verified Mac download report required; neither inferred from elapsed time',
        'quality': {k: 'not_evaluated' for k in ('instruction', 'shape', 'boundary_material', 'character_identity')}}
    write_json(TRIAL / 'plan.json', plan)
    print(json.dumps({'status': plan['status'], 'plan': str(TRIAL / 'plan.json'), 'gpu_calls': 0}), flush=True)


def unet_alias(path):
    """Use an actual core diffusion_models/unet path, never a replacement Base."""
    requested = Path(path).absolute()
    if '..' in requested.parts:
        raise ValueError('Use the exact core symlink path without parent traversal')
    # Normalize macOS /var -> /private/var parents while retaining the final
    # core filename: resolving the last symlink would discard its loader alias.
    lexical = requested.parent.resolve() / requested.name
    for folder in ('diffusion_models', 'unet'):
        root = (ROOT / 'vendor/ComfyUI/models' / folder).resolve()
        if lexical.is_relative_to(root) and lexical.is_file():
            return lexical.relative_to(root).as_posix()
    raise ValueError('UNet must be in a core model directory; do not change server path configuration')


def validate_download_report(report):
    """Do not treat an expected hash or a partial file as completed verification."""
    if (report.get('state') != 'verified' or report.get('full_sha256_verified') is not True
            or report.get('size_verified') is not True
            or report.get('actual_sha256') != UNET_IDENTITY['sha256']
            or report.get('actual_bytes') != UNET_IDENTITY['bytes']
            or report.get('revision') != UNET_IDENTITY['revision']):
        raise ValueError('Mac model download is not fully verified')
    return report


def check_unet_header(path):
    with Path(path).open('rb') as stream:
        size = struct.unpack('<Q', stream.read(8))[0]
        if not 0 < size < 16 * 1024 * 1024:
            raise ValueError('Invalid safetensors header')
        header = json.loads(stream.read(size))
    tensor = header.get('conv_in.weight', {})
    if tensor.get('shape') != [320, 9, 3, 3] or tensor.get('dtype') != 'F16':
        raise ValueError('Expected official FP16 nine-channel SDXL inpaint UNet')
    return tensor


def observed_memory(client, pid):
    stats = client.get('/system_stats')
    rss = subprocess.run(['ps', '-p', str(pid), '-o', 'rss='], capture_output=True, text=True)
    return {'monotonic': time.monotonic(), 'process_rss_bytes': int(rss.stdout.strip()) * 1024
        if rss.returncode == 0 and rss.stdout.strip().isdigit() else None,
        'ram_free': stats['system'].get('ram_free'),
        'mps_devices': [d for d in stats['devices'] if d['type'] == 'mps']}


def execute(args):
    # All offline authorization/integrity checks precede even read-only HTTP.
    handoff = validate_handoff(args.handoff)
    plan = json.loads((TRIAL / 'plan.json').read_text())
    if source_fingerprint(ROOT / 'pankeki') != plan['adapter_source_sha256']:
        raise ValueError('Product source guard changed; coordinator must reconcile before experiment')
    report_text = args.download_report.read_text()
    report = validate_download_report(json.loads(report_text))
    alias = unet_alias(args.unet)
    weights = {'base': verify_file(BASE_PATH, BASE_IDENTITY), 'unet': verify_file(args.unet, UNET_IDENTITY)}
    weights['unet_header'] = check_unet_header(args.unet)
    if (Path(report['local_path']).resolve() != args.unet.resolve()
            or report['comfy_unet_name'] != alias):
        raise ValueError('Core alias and verified Mac download target do not match')
    weights['unet'].update(core_loader_path=str(args.unet.absolute()), core_alias=alias)
    prepared = TRIAL / 'prepared'
    for name, expected in plan['inputs'].items():
        if hashlib.sha256((prepared / name).read_bytes()).hexdigest() != expected:
            raise ValueError('Prepared source/mask changed')
    client = ComfyClient()
    stats = client.get('/system_stats')
    if not any(d['type'] == 'mps' for d in stats['devices']):
        raise ValueError('Existing server is not using MPS')
    if '--disable-all-custom-nodes' not in stats['system']['argv']:
        raise ValueError('Expected unchanged core-only server')
    queue = client.get('/queue')
    if queue.get('queue_running') or queue.get('queue_pending'):
        raise ValueError('Comfy server is busy; do not overlap or interrupt another job')
    for node, field, required in (('UNETLoader', 'unet_name', alias),
            ('CheckpointLoaderSimple', 'ckpt_name', BASE_PATH.name)):
        options = client.get('/object_info/' + node)[node]['input']['required'][field][0]
        if required not in options:
            raise ValueError(f'{node} does not expose the verified weight alias: {required}')
    for node in ('InpaintModelConditioning', 'SaveLatent'):
        if node not in client.get('/object_info/' + node):
            raise ValueError('Required core node unavailable: ' + node)
    pids = subprocess.check_output(['lsof', '-t', '-iTCP:8188', '-sTCP:LISTEN'], text=True).split()
    if len(set(pids)) != 1:
        raise ValueError('Cannot identify the Comfy process for memory observation')
    pid = int(pids[0])
    directory = claim_attempt(TRIAL, args.phase)
    started = time.monotonic()
    write_json(directory / 'handoff.json', handoff)
    write_json(directory / 'download-report.json', report)
    write_json(directory / 'weights.json', weights)
    write_json(directory / 'server-before.json', stats)
    request = plan['phases'][args.phase]['recipe']
    method = plan['phases'][args.phase]['method']
    recipe = dict(request, phase=args.phase, method=method, cache=False, input_hashes=plan['inputs'],
        adapter_source_sha256=plan['adapter_source_sha256'], baseline_job_id=plan['baseline_job_id'],
        method_comparison=plan['method_comparison'], departures_from_baseline=plan['phases'][args.phase]['departures_from_baseline'])
    write_json(directory / 'recipe.json', recipe)
    for name in plan['inputs']:
        shutil.copyfile(prepared / name, directory / name)
    with Image.open(directory / 'original.png') as image:
        source = image.copy()
    with Image.open(directory / 'mask.png') as image:
        mask = image.convert('L')
    upload = source.convert('RGBA'); upload.putalpha(ImageOps.invert(mask))
    buffer = io.BytesIO(); upload.save(buffer, format='PNG'); data = buffer.getvalue()
    graph = build_workflow(request, method, alias, 'Pankeki_Inpaint01_' + args.phase)
    graph['4']['inputs']['image'] = client.upload_png(data, hashlib.sha256(data).hexdigest() + '.png')
    write_json(directory / 'workflow.json', graph)
    memory_samples, memory_errors, previews = [observed_memory(client, pid)], [], []
    stop = threading.Event()

    def observe():
        probe = ComfyClient(request_timeout=3)
        while not stop.is_set():
            try:
                memory_samples.append(observed_memory(probe, pid))
            except Exception as exc:
                memory_errors.append(str(exc))
            stop.wait(1)

    def submitted(prompt_id):
        write_json(directory / 'submitted.json', {'prompt_id': prompt_id, 'phase': args.phase})
        print(json.dumps({'phase': args.phase, 'prompt_id': prompt_id}), flush=True)

    def event_received(event):
        with (directory / 'events.jsonl').open('a', encoding='utf-8') as stream:
            stream.write(json.dumps(event, ensure_ascii=False, allow_nan=False) + '\n')

    observer = threading.Thread(target=observe, daemon=True)
    log = ROOT / 'runtime/macos/comfy.log'
    log_offset = log.stat().st_size if log.exists() else 0
    observer.start()
    summary = {'phase': args.phase, 'method': method, 'technical_pass': False,
        'cache': 'Pankeki exact cache unused; Comfy sampler cache inspected separately',
        'four_axis_quality': {k: 'not_evaluated' for k in ('instruction', 'shape', 'boundary_material', 'character_identity')},
        'vae_decoded_float_finiteness': 'not directly exposed; do not infer from PNG integer pixels'}
    failure = None
    try:
        raw, metrics = client.execute(graph, timeout=900,
            on_preview=lambda frame: previews.append(len(frame)), on_submitted=submitted,
            on_event=event_received)
        write_json(directory / 'metrics.json', metrics)
        (directory / 'raw.png').write_bytes(raw)
        history = client.get('/history/' + metrics['prompt_id'])[metrics['prompt_id']]
        write_json(directory / 'history.json', history)
        outputs = history['outputs']['10']['latents']
        if len(outputs) != 1 or outputs[0]['type'] != 'output':
            raise ValueError('Expected one core SaveLatent output')
        argv = stats['system']['argv']
        output_root = Path(argv[argv.index('--output-directory') + 1]).resolve()
        latent_path = (output_root / outputs[0]['subfolder'] / outputs[0]['filename']).resolve()
        if not latent_path.is_relative_to(output_root):
            raise ValueError('Unexpected latent output path')
        shutil.copyfile(latent_path, directory / 'sampler.latent')
        finite = latent_finiteness(directory / 'sampler.latent')
        with Image.open(io.BytesIO(raw)) as image:
            output = compose_result(source, mask, image, request['feather'])
        output.save(directory / 'result.png')
        pixels = pixel_metrics(source, mask, output)
        pid_value = metrics['prompt_id']
        sampler_event = any(e.get('type') == 'executing' and e.get('data', {}).get('node') == '5'
            and e.get('data', {}).get('prompt_id') == pid_value for e in metrics.get('events', []))
        success = any(kind == 'execution_success' and event.get('prompt_id') == pid_value
            for kind, event in metrics.get('history_messages', []))
        passed = (finite['all_finite'] and sampler_event and success and metrics['denoiser_executed']
            and '5' not in metrics['comfy_cached_nodes'] and pixels['outside_mask_max_error'] == 0
            and pixels['alpha_max_error'] == 0 and pixels['changed_inside_pixels'] > 0
            and pixels['selected_gray_fraction'] < .95 and pixels['selected_black_fraction'] < .95)
        summary.update(prompt_id=pid_value, technical_pass=bool(passed), sampler_latent=finite,
            pixels=pixels, sampler_executing_event=sampler_event, history_success=success,
            sampler_cached='5' in metrics['comfy_cached_nodes'], preview_count=len(previews),
            result_sha256=hashlib.sha256((directory / 'result.png').read_bytes()).hexdigest())
        if not passed:
            raise ValueError('Technical smoke/comparison failed; stop without parameter retry')
    except Exception as exc:
        failure = exc
        summary.update(error_type=type(exc).__name__, error=str(exc))
        if (directory / 'submitted.json').exists() and not (directory / 'history.json').exists():
            try:
                prompt_id = json.loads((directory / 'submitted.json').read_text())['prompt_id']
                write_json(directory / 'history.json', client.get('/history/' + prompt_id))
            except Exception as history_error:
                summary['history_read_error'] = str(history_error)
    finally:
        stop.set(); observer.join(timeout=5)
        try:
            memory_samples.append(observed_memory(client, pid))
        except Exception as exc:
            memory_errors.append(str(exc))
        rss = [s['process_rss_bytes'] for s in memory_samples if s['process_rss_bytes'] is not None]
        write_json(directory / 'memory.json', {'server_pid': pid, 'samples': memory_samples,
            'sampled_peak_process_rss_bytes': max(rss) if rss else None, 'errors': memory_errors,
            'caveat': 'RSS and system_stats MPS/unified-memory reports; not instrumented GPU allocator peaks'})
        if log.exists():
            with log.open('rb') as stream:
                stream.seek(log_offset); excerpt = stream.read(1024 * 1024)
            (directory / 'comfy-log.txt').write_bytes(excerpt)
            summary['server_log_has_nan_or_cast_warning'] = any(term in excerpt.lower()
                for term in (b'nan', b'invalid value encountered in cast'))
            if summary['server_log_has_nan_or_cast_warning']:
                summary['technical_pass'] = False
                if failure is None:
                    failure = ValueError('Server log contains NaN/cast warning; inspect before continuing')
        summary.update(elapsed_s=round(time.monotonic() - started, 3), memory_samples=len(memory_samples),
            timing='client wall time including uploads, model loading and observation; not GPU event time')
        write_json(directory / 'summary.json', summary)
        print(json.dumps(summary, ensure_ascii=False), flush=True)
    if failure is not None:
        raise RuntimeError('Trial failed; preserve evidence and report to coordinator') from failure


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command')
    commands.add_parser('prepare', help='offline only; creates plans, no model/API access')
    run = commands.add_parser('run', help='coordinator release plus verified weights required')
    run.add_argument('--phase', choices=PHASES, required=True)
    run.add_argument('--unet', type=Path, required=True)
    run.add_argument('--download-report', type=Path, required=True)
    run.add_argument('--handoff', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'run':
        execute(args)
    else:
        prepare()


if __name__ == '__main__':
    main()

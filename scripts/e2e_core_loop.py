"""Explicitly gated isolated browser/GPU core loop. Never starts/restarts services.

Use --preflight-only for read-only preflight. A full run requires --allow-gpu and sends at most
2 Pankeki job POSTs, without retry. SDXL Base 512x512/2 steps is an explicit
installed-model substitute for the review's unavailable SD-Turbo smoke.
"""
import argparse
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def validate_base_url(value):
    parsed = urlsplit(value)
    if parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost') or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment or not parsed.port or parsed.port in (8188, 8190):
        raise ValueError('An explicit isolated loopback staging port is required; 8188/8190 are protected')
    return value.rstrip('/')


def require_gpu(allowed):
    if allowed is not True:
        raise ValueError('GPU execution requires explicit --allow-gpu; no job was submitted')


def queue_state(value):
    if not isinstance(value, dict) or not all(isinstance(value.get(key), list) for key in ('queue_running', 'queue_pending')):
        raise ValueError('Comfy queue state is unknown; execution is forbidden')
    return 'busy' if value['queue_running'] or value['queue_pending'] else 'idle'


def validate_identity(health, html, expected):
    from pankeki.build_identity import html_source_id
    if not re.fullmatch(r'[0-9a-f]{64}', expected):
        raise ValueError('Expected source ID must be lowercase SHA256')
    build = health.get('build') or {}
    for key in ('source_id', 'html_source_id', 'process_source_id'):
        if build.get(key) != expected:
            raise ValueError(f'Staging identity mismatch/unknown: {key}')
    if build.get('status') != 'match' or html_source_id(html) != expected:
        raise ValueError('Actual served HTML does not match the expected staging source')
    if build.get('html_sha256') is not None and build['html_sha256'] != hashlib.sha256(html).hexdigest():
        raise ValueError('Served HTML SHA differs from backend identity')


def validate_job(job):
    if job.get('state') != 'succeeded':
        raise ValueError('Owned job is not succeeded; never resubmit: ' + str(job.get('state')))


def validate_artifact(job, data, metrics):
    from PIL import Image
    validate_job(job)
    result = job.get('result') or {}
    job_id = job.get('job_id')
    if not isinstance(job_id, str) or not re.fullmatch(r'[0-9a-f]{32}', job_id):
        raise ValueError('Missing owned backend job ID')
    if result.get('job_id') != job_id or result.get('trace_id') != job.get('trace_id') or result.get('run_ref') != 'runs/' + job_id or result.get('result_sha256') != hashlib.sha256(data).hexdigest():
        raise ValueError('Trace/run/result SHA provenance mismatch')
    if job.get('lane') != 'gpu' or not job.get('client_id'):
        raise ValueError('GPU lane and durable Comfy client ownership evidence required')
    if metrics.get('model_calls') != 1 or metrics.get('gpu_completed') is not True or metrics.get('denoiser_executed') is not True:
        raise ValueError('Real denoiser evidence required; cache/no-op/mock cannot pass')
    if not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('Actual PNG artifact required')
    with Image.open(io.BytesIO(data)) as image:
        image.load()
        if image.size != (512, 512):
            raise ValueError('Unexpected actual image dimensions')


def pixel_invariants(source, edited, mask):
    import numpy as np
    a, b, m = np.asarray(source.convert('RGBA')), np.asarray(edited.convert('RGBA')), np.asarray(mask.convert('L'))
    if a.shape != b.shape or m.shape != a.shape[:2] or not (m > 0).any() or not (m == 0).any():
        raise ValueError('Nonempty bounded mask and same dimensions required')
    delta = np.abs(a.astype('int16') - b.astype('int16'))
    report = {'outside_rgb_max_error': int(delta[:, :, :3][m == 0].max()), 'alpha_max_error': int(delta[:, :, 3].max()), 'inside_changed_pixels': int(((delta[:, :, :3] > 0).any(axis=2) & (m > 0)).sum()), 'mask_pixels': int((m > 0).sum())}
    if report['outside_rgb_max_error'] or report['alpha_max_error'] or not report['inside_changed_pixels']:
        raise ValueError('Pixel invariant or actual requested-region change failed: ' + json.dumps(report))
    return report


def get(url, raw=False):
    with urlopen(url, timeout=20) as response:
        data = response.read()
    return data if raw else json.loads(data)


def listener_evidence(base_url, stage_root):
    port = urlsplit(base_url).port
    pid_text = subprocess.check_output(['/usr/sbin/lsof', '-nP', '-iTCP:' + str(port), '-sTCP:LISTEN', '-t'], text=True).split()
    pids = sorted(set(pid_text))
    if len(pids) != 1:
        raise ValueError('Staging listener process is missing or ambiguous')
    pid = pids[0]
    cwd = subprocess.check_output(['/usr/sbin/lsof', '-a', '-p', pid, '-d', 'cwd', '-Fn'], text=True)
    paths = [line[1:] for line in cwd.splitlines() if line.startswith('n')]
    if len(paths) != 1 or Path(paths[0]).resolve() != stage_root.resolve():
        raise ValueError('Listening process cwd is not the isolated staging root')
    command = subprocess.check_output(['/bin/ps', '-p', pid, '-o', 'command='], text=True).strip()
    started = subprocess.check_output(['/bin/ps', '-p', pid, '-o', 'lstart='], text=True).strip()
    return {'pid': int(pid), 'cwd': paths[0], 'command': command, 'process_started': started}


def preflight(args, output):
    from pankeki.build_identity import source_content_id
    from pankeki.capabilities import validate_snapshot
    base = validate_base_url(args.base_url)
    if ROOT.resolve() != args.stage_root.resolve() or 'staging' not in args.stage_root.parts:
        raise ValueError('Harness must run from its isolated staging source tree')
    actual = source_content_id(ROOT)
    if actual != args.expected_source_id:
        raise ValueError('Current staging disk source changed since expected snapshot')
    health, html = get(base + '/api/health'), get(base + '/', raw=True)
    validate_identity(health, html, args.expected_source_id)
    if health.get('comfy') is not True:
        raise ValueError('Comfy health is unavailable')
    process = listener_evidence(base, ROOT)
    caps = validate_snapshot(get(base + '/api/capabilities'))
    models = {row['id']: row for row in caps.get('models', [])}
    model = models.get('sdxl-base') or {}
    if model.get('installed') is not True or not {'txt2img', 'inpaint'}.issubset(set(model.get('supported_modes', model.get('operations', [])))):
        # Registry model operations use public operation names in schema1.
        if model.get('installed') is not True or not {'generate', 'regenerate'}.issubset(set(model.get('operations', []))):
            raise ValueError('Installed SDXL Base generation+regenerate capability is required')
    for op in ('generate', 'regenerate'):
        row = next((row for row in caps.get('operations', []) if row.get('id') == op), {})
        if row.get('ready') is not True or 'sdxl-base' not in row.get('model_ids', []):
            raise ValueError('SDXL Base operation unavailable: ' + op)
    comfy = urlsplit(args.comfy_url)
    if comfy.scheme != 'http' or comfy.hostname not in ('127.0.0.1', 'localhost') or comfy.path not in ('', '/') or comfy.username or comfy.password:
        raise ValueError('Comfy read-only queue probe must be loopback')
    object_info = get(args.comfy_url.rstrip('/') + '/object_info/CheckpointLoaderSimple')
    names = object_info.get('CheckpointLoaderSimple', {}).get('input', {}).get('required', {}).get('ckpt_name', [[]])[0]
    if not isinstance(names, list) or 'sd_xl_base_1.0.safetensors' not in names:
        raise ValueError('Existing Comfy service does not list the configured SDXL Base checkpoint')
    system = get(args.comfy_url.rstrip('/') + '/system_stats').get('system')
    if not isinstance(system, dict):
        raise ValueError('Existing Comfy stable service identity is unknown')
    stable_system = {key: system.get(key) for key in ('python_version', 'pytorch_version', 'comfyui_version', 'argv')}
    queue = get(args.comfy_url.rstrip('/') + '/queue')
    state = queue_state(queue)
    for name, value in [('health', health), ('capabilities', caps), ('process', process), ('queue', queue), ('comfy-checkpoints', {'checkpoint_names': names}), ('comfy-system-stable', stable_system)]:
        (output / (name + '.json')).write_text(json.dumps(value, indent=2, ensure_ascii=False))
    (output / 'served.html').write_bytes(html)
    return {'comfy_stable_system': stable_system, 'source_id': actual, 'html_sha256': hashlib.sha256(html).hexdigest(), 'queue_state': state, 'process': process, 'model': 'sdxl-base', 'substitution': 'SD-Turbo configured path missing; installed SDXL Base 512x512, 2 steps, fixed seed, generate+regenerate exactly once each; technical pipeline only'}


def verify_outputs(output, stage_root, comfy_url):
    from PIL import Image
    from pankeki.run_store import RunStore
    browser = json.loads((output / 'browser-report.json').read_text())
    jobs = browser.get('jobs', [])
    if browser.get('job_posts') != 2 or len(jobs) != 2:
        raise ValueError('Expected exactly 2 original job submissions and 2 succeeded observations')
    store = RunStore(stage_root / 'runtime')
    for index, job in enumerate(jobs):
        result = job.get('result') or {}
        data = store.read_result(result.get('run_ref'), result.get('result_sha256'))
        directory = store.resolve(result['run_ref'])
        from pankeki.comfy_adapter import ComfyClient
        history = get(comfy_url.rstrip('/') + '/history/' + job['prompt_id'])
        entry = history.get(job['prompt_id']) if isinstance(history, dict) else None
        if not isinstance(entry, dict) or not ComfyClient._owned(entry.get('prompt'), job.get('client_id'), job.get('workflow_sha256'), job['prompt_id']):
            raise ValueError('Actual Comfy history does not prove prompt/client/workflow ownership')
        (output / ('comfy-history-' + str(index) + '.json')).write_text(json.dumps(history, indent=2))
        metrics = json.loads((directory / 'metrics.json').read_text())
        recipe = json.loads((directory / 'recipe.json').read_text())
        validate_artifact(job, data, metrics)
        if recipe.get('model_id') != 'sdxl-base' or recipe.get('steps') != 2 or recipe.get('seed') != (2026102801 + index):
            raise ValueError('Actual recipe differs from bounded SDXL smoke settings')
        if recipe.get('mode') != ('txt2img' if index == 0 else 'inpaint') or index == 1 and recipe.get('denoise') != 1:
            raise ValueError('Actual mode/denoise differs from sampling contract')
        target = output / ('generation' if index == 0 else 'edit'); target.mkdir(exist_ok=True)
        for file in directory.iterdir():
            if not file.is_symlink() and file.is_file() and file.suffix in ('.json', '.png'):
                shutil.copy2(file, target / file.name)
    original = Image.open(output / 'generation/result.png')
    edited = Image.open(output / 'edit/result.png')
    mask = Image.open(output / 'mask.png')
    invariants = pixel_invariants(original, edited, mask)
    if len({job.get('prompt_id') for job in jobs}) != 2:
        raise ValueError('Expected 2 distinct owned Comfy submissions')
    if not browser.get('persistence', {}).get('passed'):
        raise ValueError('Actual browser save/import/reload/resave did not pass')
    (output / 'pixel-invariants.json').write_text(json.dumps(invariants, indent=2))
    return {'artifact_sampling': 'PASS', 'mask_preservation_and_change': invariants, 'browser_persistence': 'PASS', 'installed_native_app': 'UNVERIFIED', 'visual_quality': 'UNVERIFIED'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--expected-source-id', required=True)
    parser.add_argument('--stage-root', type=Path, default=ROOT)
    parser.add_argument('--comfy-url', default='http://127.0.0.1:8188')
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--allow-gpu', action='store_true')
    parser.add_argument('--preflight-only', action='store_true')
    parser.add_argument('--persistence-only-project', type=Path, help='Import existing actual two-result project and verify explicit save/immediate reopen with every POST blocked')
    parser.add_argument('--resume', action='store_true', help='Reuse same QA profile and one consumed successful generation; never replay generation')
    parser.add_argument('--node', type=Path, default=Path(shutil.which('node') or 'node'))
    parser.add_argument('--browser-executable', type=Path, default=Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'))
    parser.add_argument('--timeout-s', type=int, default=1800)
    args = parser.parse_args(argv)
    output = args.output_dir.resolve()
    allowed_output = ROOT.parents[3] / 'output/finalization-20261028/system-refactor/e2e'
    if not output.is_relative_to(allowed_output.resolve()) or output == allowed_output.resolve():
        raise ValueError('Evidence output must be a fresh child of the authorized e2e directory')
    # A fresh evidence directory prevents overwriting a prior run or silently replaying it.
    if args.resume:
        if not output.is_dir() or not (output / 'browser-report.json.first-attempt').is_file():
            raise ValueError('Resume requires the preserved first-attempt report in the same output/profile')
    else:
        output.mkdir(parents=True, exist_ok=False)
    report = {'started': datetime.now(timezone.utc).isoformat(), 'status': 'FAIL', 'job_posts': 0, 'native_acceptance': 'UNVERIFIED', 'visual_quality': 'UNVERIFIED', 'resumed_after_harness_failure': args.resume}
    try:
        if args.persistence_only_project and args.allow_gpu:
            raise ValueError('Persistence-only mode forbids --allow-gpu')
        if not args.preflight_only and not args.persistence_only_project: require_gpu(args.allow_gpu)
        report['preflight'] = preflight(args, output)
        if args.preflight_only:
            report['status'] = 'PREFLIGHT_ONLY'
        else:
            spec = {'baseUrl': validate_base_url(args.base_url), 'comfyUrl': args.comfy_url.rstrip('/'), 'expectedSourceId': args.expected_source_id, 'stageRoot': str(ROOT), 'outputDir': str(output), 'browserExecutable': str(args.browser_executable), 'timeoutMs': args.timeout_s * 1000, 'allowGpu': args.allow_gpu, 'expectedComfySystem': report['preflight']['comfy_stable_system'], 'resume': args.resume, 'mode': 'persistence-only' if args.persistence_only_project else 'gpu-core-loop', 'projectPath': str(args.persistence_only_project.resolve()) if args.persistence_only_project else None}
            config = output / 'browser-input.json'; config.write_text(json.dumps(spec, indent=2))
            env = dict(os.environ, NODE_PATH=str(args.node.parent.parent / 'node_modules'))
            subprocess.run([str(args.node), str(ROOT / 'scripts/e2e_core_loop.cjs'), str(config)], cwd=ROOT, env=env, check=True, timeout=args.timeout_s + 90)
            if args.persistence_only_project:
                persistence = json.loads((output / 'persistence-report.json').read_text())
                if persistence.get('status') != 'PERSISTENCE_ONLY_PASS' or persistence.get('gpu_job_posts') != 0 or persistence.get('blocked_posts'):
                    raise ValueError('Actual non-generating persistence verification did not pass')
                report['stages'] = persistence['stages']
                report['job_posts'] = 0
                report['status'] = 'PERSISTENCE_ONLY_PASS'
            else:
                report['stages'] = verify_outputs(output, ROOT, args.comfy_url)
                report['job_posts'] = 2
                report['status'] = 'ENGINEERING_E2E_RESUMED_PASS' if args.resume else 'ENGINEERING_E2E_PASS'
    except Exception as exc:
        report['error'] = str(exc)
        if (output / 'browser-report.json').exists():
            report['browser'] = json.loads((output / 'browser-report.json').read_text())
        raise
    finally:
        if (output / 'browser-report.json').exists():
            observed = json.loads((output / 'browser-report.json').read_text())
            report['job_posts'] = observed.get('job_posts')
            report['browser_stages'] = observed.get('stages', {})
            report['known_comfy_prompt_ids'] = [job.get('prompt_id') for job in observed.get('jobs', []) if job.get('prompt_id')]
        report['finished'] = datetime.now(timezone.utc).isoformat()
        (output / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
        print(json.dumps(report, indent=2, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()

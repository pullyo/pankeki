"""Start the restored local app and ComfyUI on Apple Silicon."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / 'runtime' / 'macos'
MODELS = {
    'sdxl-base': ('sd_xl_base_1.0.safetensors', '31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b'),
    'sd-turbo': ('sd_turbo.safetensors', '3f067a1b943cf162f2b8f8588f6cf5824bd5b4c7d1d88d87164b9ca123616549'),
    # Optional checkpoint: startup still needs any available generation model,
    # not every registered file. Base-only installations remain supported.
    'animagine-xl-4.0-opt': ('animagine-xl-4.0-opt.safetensors', '6327eca98bfb6538dd7a4edce22484a1bbc57a8cff6b11d075d40da1afb847ac'),
}
INPAINT_UNET = ('sdxl-inpainting-0.1-unet-fp16.safetensors',
                '6470840731e98cc16713ddf3ac7ee458c9fdbcb881a98c6727cd4a938f227d3f')


def build_config(root):
    """Build registration only; no file writes, model loading or process startup."""
    root = Path(root)
    models = {key: {'model_name': name, 'model_path': str(root / 'models' / 'checkpoints' / name),
                    'manifest': {'schema': 1, 'model_name': name, 'model_sha256': digest}}
              for key, (name, digest) in MODELS.items()}
    name, digest = INPAINT_UNET
    models['sdxl-inpaint-v01'] = {
        'model_name': name,
        'model_path': str(root / 'models' / 'diffusion_models' / 'sdxl-inpainting-0.1' /
                          'unet' / 'diffusion_pytorch_model.fp16.safetensors'),
        'conditioning_model_id': 'sdxl-base',
        'manifest': {'schema': 1, 'model_name': name, 'model_sha256': digest}}
    return {'transport': 'direct', 'managed_builtin_only': False, 'fingerprint_policy': 'stat_cache',
            'models': models, 'default_model_id': 'sdxl-base'}


def free_port(port):
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', port))


def wait_ready(url, process, timeout):
    opener = build_opener(ProxyHandler({}))
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f'Server stopped (exit {process.returncode}). See {RUNTIME}')
        try:
            with opener.open(url, timeout=2) as response:
                if response.status == 200:
                    return
        except (URLError, TimeoutError, OSError):
            time.sleep(.3)
    raise RuntimeError(f'Server startup timed out: {url}. See {RUNTIME}')


def main():
    parser = argparse.ArgumentParser(description='Pankeki for macOS')
    parser.add_argument('--editor-only', action='store_true', help='Run editing/motion without starting image generation')
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--port', type=int, default=8190)
    parser.add_argument('--comfy-port', type=int, default=8188)
    args = parser.parse_args()
    if not args.editor_only and (importlib.util.find_spec('torch') is None or not any(
            (ROOT / 'models' / 'checkpoints' / name).is_file() for name, _ in MODELS.values())):
        print('이미지 생성 환경이 아직 준비되지 않아 편집·움직임 모드로 실행합니다.', flush=True)
        args.editor_only = True
    free_port(args.port)
    if not args.editor_only:
        free_port(args.comfy_port)
    RUNTIME.mkdir(parents=True, exist_ok=True)
    config = build_config(ROOT)
    config_path = RUNTIME / 'config.json'
    config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    model_paths = RUNTIME / 'model-paths.yaml'
    model_paths.write_text('pankeki:\n  base_path: ' + json.dumps(str(ROOT / 'models')) + '\n  checkpoints: checkpoints\n', encoding='utf-8')
    children = []
    logs = []

    def stop(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    try:
        if not args.editor_only:
            comfy_directories = {name: RUNTIME / ('comfy-' + name) for name in ('user', 'input', 'output', 'temp')}
            for directory in comfy_directories.values():
                directory.mkdir(parents=True, exist_ok=True)
            environment = dict(os.environ, PYTORCH_ENABLE_MPS_FALLBACK='1', HF_HUB_OFFLINE='1',
                               HF_HUB_DISABLE_TELEMETRY='1', DO_NOT_TRACK='1')
            log = (RUNTIME / 'comfy.log').open('a', encoding='utf-8')
            logs.append(log)
            comfy = subprocess.Popen([
                sys.executable, '-u', 'main.py', '--listen', '127.0.0.1', '--port', str(args.comfy_port),
                '--offline', '--disable-all-custom-nodes', '--use-pytorch-cross-attention',
                '--fp16-unet', '--fp16-text-enc', '--fp32-vae', '--preview-method', 'latent2rgb',
                '--extra-model-paths-config', str(model_paths),
                '--user-directory', str(comfy_directories['user']),
                '--input-directory', str(comfy_directories['input']),
                '--output-directory', str(comfy_directories['output']),
                '--temp-directory', str(comfy_directories['temp']),
            ], cwd=ROOT / 'vendor' / 'ComfyUI', env=environment, stdout=log, stderr=subprocess.STDOUT)
            children.append(comfy)
            print('ComfyUI / Metal 시작 중…', flush=True)
            wait_ready(f'http://127.0.0.1:{args.comfy_port}/system_stats', comfy, 180)
            # Attest only this launcher's child, using reviewed byte pins. An
            # older/changed vendor or unverifiable listener stays fail-closed.
            sys.path.insert(0, str(ROOT))
            from pankeki.comfy_adapter import ComfyClient, attest_atomic_cancel
            client = ComfyClient(f'http://127.0.0.1:{args.comfy_port}')
            try:
                identity = client._server_identity()
                config['comfy_atomic_cancel'] = attest_atomic_cancel(ROOT, pid=comfy.pid,
                    port=args.comfy_port, server_identity=identity,origin=client.base_url)
            except (OSError, ValueError, RuntimeError):
                config['comfy_atomic_cancel'] = {'schema':1,'state':'unknown',
                    'reason':'Owned Comfy identity or atomic cancellation source could not be verified'}
            config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        app_log = (RUNTIME / 'app.log').open('a', encoding='utf-8')
        logs.append(app_log)
        app = subprocess.Popen([
            sys.executable, '-u', '-m', 'pankeki', 'serve', '--port', str(args.port),
            '--comfy-url', f'http://127.0.0.1:{args.comfy_port}', '--config', str(config_path),
        ], cwd=ROOT, stdout=app_log, stderr=subprocess.STDOUT)
        children.append(app)
        url = f'http://127.0.0.1:{args.port}'
        wait_ready(url + '/', app, 30)
        (RUNTIME / 'processes.json').write_text(json.dumps({
            'launcher_pid': os.getpid(), 'children': [p.pid for p in children], 'url': url,
            'mode': 'editor' if args.editor_only else 'generation', 'python': sys.executable,
        }, indent=2) + '\n')
        print(f'Pankeki: {url}\n종료: 이 터미널에서 Control+C', flush=True)
        if not args.no_browser:
            webbrowser.open(url)
        while app.poll() is None:
            if not args.editor_only and children[0].poll() is not None:
                raise RuntimeError('ComfyUI stopped. See runtime/macos/comfy.log')
            time.sleep(.5)
        if app.returncode:
            raise RuntimeError(f'Pankeki stopped (exit {app.returncode}). See runtime/macos/app.log')
    except KeyboardInterrupt:
        print('\nPankeki 종료 중…', flush=True)
    finally:
        for child in reversed(children):
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
        for log in logs:
            log.close()


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError) as error:
        print(f'실행 실패: {error}', file=sys.stderr)
        sys.exit(1)

"""Start Pankeki and ComfyUI on Windows 10/11 x64 (NVIDIA CUDA first, editor-only without a GPU).

Same shape as run_macos.py: regenerate runtime/windows/config.json and model-paths.yaml for the
current folder, start ComfyUI (owned child), then `python -m pankeki serve`. Differences that matter
on Windows:
- a venv python.exe is a launcher whose interpreter is a child process, so children are stopped as
  a tree with taskkill /T (Popen.terminate would leave the interpreter holding the port);
- ComfyUI is started with an absolute main.py path, the same command the desktop app recognises,
  so the app can reuse a server started here;
- no NVIDIA CUDA device means editor-only, unless --cpu is given explicitly (very slow).
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / 'runtime' / 'windows'
sys.path.insert(0, str(Path(__file__).resolve().parent))
from run_macos import MODELS, build_config, free_port, wait_ready  # noqa: E402  (shared, side-effect free)

CREATE_NO_WINDOW = 0x08000000


def is_windows():
    return os.name == 'nt'


def cuda_status(python, timeout=180):
    """Ask the generation interpreter itself; importing torch here would pin CUDA in the launcher."""
    probe = ('import json, torch; ok = torch.cuda.is_available(); '
             'print(json.dumps({"cuda": ok, "torch": torch.__version__, "cuda_build": torch.version.cuda, '
             '"device": torch.cuda.get_device_name(0) if ok else None}))')
    try:
        done = subprocess.run([python, '-c', probe], capture_output=True, text=True, timeout=timeout,
                              creationflags=CREATE_NO_WINDOW if is_windows() else 0)
    except (OSError, subprocess.TimeoutExpired) as error:
        return {'cuda': False, 'error': str(error)[:300]}
    if done.returncode != 0:
        return {'cuda': False, 'error': (done.stderr or '').strip()[-300:]}
    try:
        return json.loads(done.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return {'cuda': False, 'error': 'unreadable torch probe output'}


def stop_tree(process, timeout=15):
    if process.poll() is not None:
        return
    if is_windows():
        taskkill = os.environ.get('SystemRoot', 'C:\\Windows').rstrip('\\/') + '\\System32\\taskkill.exe'
        subprocess.run([taskkill, '/PID', str(process.pid), '/T'], capture_output=True, creationflags=CREATE_NO_WINDOW)
        try:
            process.wait(timeout=timeout)
            return
        except subprocess.TimeoutExpired:
            subprocess.run([taskkill, '/PID', str(process.pid), '/T', '/F'], capture_output=True, creationflags=CREATE_NO_WINDOW)
            process.wait(timeout=timeout)
            return
    process.terminate()
    try:
        process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def comfy_command(python, model_paths, directories, port, cpu=False):
    command = [python, '-u', str(ROOT / 'vendor' / 'ComfyUI' / 'main.py'), '--listen', '127.0.0.1', '--port', str(port),
               '--offline', '--disable-all-custom-nodes', '--use-pytorch-cross-attention',
               '--fp16-unet', '--fp16-text-enc', '--fp32-vae', '--preview-method', 'latent2rgb',
               '--extra-model-paths-config', str(model_paths),
               '--user-directory', str(directories['user']), '--input-directory', str(directories['input']),
               '--output-directory', str(directories['output']), '--temp-directory', str(directories['temp'])]
    if cpu:
        command.append('--cpu')
    return command


def child_environment():
    environment = dict(os.environ, HF_HUB_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1', DO_NOT_TRACK='1',
                       PYTHONUTF8='1', PYTHONIOENCODING='utf-8')
    environment.pop('PYTORCH_ENABLE_MPS_FALLBACK', None)
    return environment


def main():
    parser = argparse.ArgumentParser(description='Pankeki for Windows')
    parser.add_argument('--editor-only', action='store_true', help='Run editing/motion without starting image generation')
    parser.add_argument('--cpu', action='store_true', help='Generate on the CPU when no NVIDIA GPU is present (very slow)')
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--port', type=int, default=8190)
    parser.add_argument('--comfy-port', type=int, default=8188)
    args = parser.parse_args()
    python = sys.executable
    gpu = None
    if not args.editor_only:
        if importlib.util.find_spec('torch') is None or not any(
                (ROOT / 'models' / 'checkpoints' / name).is_file() for name, _ in MODELS.values()):
            print('이미지 생성 환경(torch 또는 모델)이 아직 준비되지 않아 편집·움직임 모드로 실행합니다.', flush=True)
            args.editor_only = True
        elif not (ROOT / 'vendor' / 'ComfyUI' / 'main.py').is_file():
            print('vendor\\ComfyUI 가 없어 편집·움직임 모드로 실행합니다. scripts\\setup-windows.ps1 -Generation 을 먼저 실행하세요.', flush=True)
            args.editor_only = True
        else:
            gpu = cuda_status(python)
            if gpu.get('cuda'):
                print(f"NVIDIA GPU: {gpu.get('device')} (torch {gpu.get('torch')}, CUDA {gpu.get('cuda_build')})", flush=True)
            elif args.cpu:
                print('NVIDIA GPU(CUDA)를 찾지 못했습니다. --cpu 로 CPU 생성을 시작합니다. 이미지 한 장에 수 분 이상 걸릴 수 있습니다.', flush=True)
            else:
                print('NVIDIA GPU(CUDA)를 찾지 못해 편집·움직임 모드로 실행합니다. CPU로 생성하려면 --cpu 를 붙이세요(매우 느림).', flush=True)
                if gpu.get('error'):
                    print('  torch 확인 결과: ' + gpu['error'], flush=True)
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
    children, logs = [], []

    def stop(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    if hasattr(signal, 'SIGBREAK'):
        signal.signal(getattr(signal, "SIGBREAK"), stop)
    try:
        if not args.editor_only:
            directories = {name: RUNTIME / ('comfy-' + name) for name in ('user', 'input', 'output', 'temp')}
            for directory in directories.values():
                directory.mkdir(parents=True, exist_ok=True)
            log = (RUNTIME / 'comfy.log').open('a', encoding='utf-8')
            logs.append(log)
            comfy = subprocess.Popen(comfy_command(python, model_paths, directories, args.comfy_port, cpu=args.cpu and not (gpu or {}).get('cuda')),
                                     cwd=ROOT / 'vendor' / 'ComfyUI', env=child_environment(), stdout=log, stderr=subprocess.STDOUT)
            children.append(comfy)
            print('ComfyUI / CUDA 시작 중…' if (gpu or {}).get('cuda') else 'ComfyUI / CPU 시작 중…', flush=True)
            wait_ready(f'http://127.0.0.1:{args.comfy_port}/system_stats', comfy, 300)
            sys.path.insert(0, str(ROOT))
            from pankeki.comfy_adapter import ComfyClient, attest_atomic_cancel
            client = ComfyClient(f'http://127.0.0.1:{args.comfy_port}')
            try:
                identity = client._server_identity()
                # The attestation tools are macOS (ps/lsof); on Windows this records 'unknown' and
                # targeted GPU cancel stays off, which is the documented fail-closed behaviour.
                config['comfy_atomic_cancel'] = attest_atomic_cancel(ROOT, pid=comfy.pid, port=args.comfy_port,
                                                                     server_identity=identity, origin=client.base_url)
            except (OSError, ValueError, RuntimeError):
                config['comfy_atomic_cancel'] = {'schema': 1, 'state': 'unknown',
                                                 'reason': 'Owned Comfy identity or atomic cancellation source could not be verified'}
            config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        app_log = (RUNTIME / 'app.log').open('a', encoding='utf-8')
        logs.append(app_log)
        app = subprocess.Popen([python, '-u', '-m', 'pankeki', 'serve', '--port', str(args.port),
                                '--comfy-url', f'http://127.0.0.1:{args.comfy_port}', '--config', str(config_path)],
                               cwd=ROOT, env=child_environment(), stdout=app_log, stderr=subprocess.STDOUT)
        children.append(app)
        url = f'http://127.0.0.1:{args.port}'
        wait_ready(url + '/', app, 60)
        (RUNTIME / 'processes.json').write_text(json.dumps({
            'launcher_pid': os.getpid(), 'children': [p.pid for p in children], 'url': url,
            'mode': 'editor' if args.editor_only else ('generation-cuda' if (gpu or {}).get('cuda') else 'generation-cpu'),
            'python': python, 'gpu': gpu,
        }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(f'Pankeki: {url}\n종료: 이 창에서 Ctrl+C', flush=True)
        if not args.no_browser:
            webbrowser.open(url)
        while app.poll() is None:
            if not args.editor_only and children[0].poll() is not None:
                raise RuntimeError('ComfyUI stopped. See runtime\\windows\\comfy.log')
            time.sleep(.5)
        if app.returncode:
            raise RuntimeError(f'Pankeki stopped (exit {app.returncode}). See runtime\\windows\\app.log')
    except KeyboardInterrupt:
        print('\nPankeki 종료 중…', flush=True)
    finally:
        for child in reversed(children):
            stop_tree(child)
        for log in logs:
            log.close()


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError) as error:
        print(f'실행 실패: {error}', file=sys.stderr)
        sys.exit(1)

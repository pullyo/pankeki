"""Run only after this project's owned ComfyUI server starts successfully."""
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pankeki.comfy_adapter import ComfyClient
from pankeki.engine import file_sha256
from pankeki.environment import process_start_token, server_signature, source_fingerprint


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pid', required=True, type=int)
    parser.add_argument('--url', default='http://127.0.0.1:8188')
    parser.add_argument('--fingerprint-policy', choices=['strict', 'windows_read_lock'], default='strict')
    args = parser.parse_args()
    comfy = ROOT / 'vendor' / 'ComfyUI'
    model = ROOT / 'models' / 'checkpoints' / 'sd_turbo.safetensors'
    client = ComfyClient(args.url)
    stats = client.get('/system_stats')
    argv = stats['system']['argv']
    if '--disable-all-custom-nodes' not in argv:
        raise ValueError('Managed server must disable arbitrary custom nodes')
    source_trees = {str(comfy): source_fingerprint(comfy)}
    for name in ('transformers', 'tokenizers'):
        package = ROOT / '.venv-comfy' / 'Lib' / 'site-packages' / name
        source_trees[str(package)] = source_fingerprint(package)
    if '--whitelist-custom-nodes' in argv:
        source = ROOT / 'integrations' / 'github' / 'sources' / 'ComfyUI-Inpaint-CropAndStitch'
        source_trees[str(source)] = source_fingerprint(source)
    commit = subprocess.check_output(['git', '-c', 'safe.directory=' + comfy.as_posix(), '-C', str(comfy), 'rev-parse', 'HEAD'], text=True).strip()
    environment = json.loads((ROOT / 'evidence' / 'environment.json').read_text(encoding='utf-8-sig'))
    # CUDA version from the installed interpreter, not nvidia-smi's driver capability.
    cuda = subprocess.check_output([str(ROOT / '.venv-comfy' / 'Scripts' / 'python.exe'), '-c', 'import torch;print(torch.version.cuda)'], text=True).strip()
    result = {'model_path': str(model), 'model_name': model.name, 'managed_builtin_only': True,
              'fingerprint_policy': args.fingerprint_policy,
              'manifest': {'schema': 1, 'comfy_commit': commit, 'model_name': model.name,
                  'model_sha256': file_sha256(model), 'input_hashes': {},
                  'software': {'torch': stats['system']['pytorch_version'], 'cuda': cuda,
                    'dtype': 'unet-fp16,text-fp16,vae-fp32', 'attention': 'pytorch-sdpa', 'adapter_revision': 'pankeki-0.1.0'}},
              'runtime_guard': {'pid': args.pid, 'process_start_token': process_start_token(args.pid),
                    'server_signature': server_signature(stats['system']), 'source_trees': source_trees,
                    'configuration_files': {str(ROOT / 'vendor' / 'pankeki-model-paths.yaml'): file_sha256(ROOT / 'vendor' / 'pankeki-model-paths.yaml')}}}
    target = ROOT / 'runtime' / 'config.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        import time
        backup = target.with_name(f'config-{time.time_ns()}.json')
        backup.write_bytes(target.read_bytes())
    target.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(target)


if __name__ == '__main__':
    main()

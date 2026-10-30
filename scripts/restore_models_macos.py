"""Restore app model weights from pinned publisher revisions; every file is SHA256-verified before use."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import time
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = {
    'sd-turbo': {
        'name': 'sd_turbo.safetensors',
        'url': 'https://huggingface.co/stabilityai/sd-turbo/resolve/b261bac6fd2cf515557d5d0707481eafa0485ec2/sd_turbo.safetensors',
        'sha256': '3f067a1b943cf162f2b8f8588f6cf5824bd5b4c7d1d88d87164b9ca123616549',
    },
    'sdxl-base': {
        'name': 'sd_xl_base_1.0.safetensors',
        'url': 'https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/462165984030d82259a11f4367a4eed129e94a7b/sd_xl_base_1.0.safetensors',
        'sha256': '31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b',
    },
    # CreativeML Open RAIL++-M (unchanged SDXL license per the publisher's model card).
    'animagine-xl-4.0-opt': {
        'name': 'animagine-xl-4.0-opt.safetensors',
        'url': 'https://huggingface.co/cagliostrolab/animagine-xl-4.0/resolve/2b7c1b397761bf5bd3cc42e5b39ec99314a75a96/animagine-xl-4.0-opt.safetensors',
        'sha256': '6327eca98bfb6538dd7a4edce22484a1bbc57a8cff6b11d075d40da1afb847ac',
    },
    # Edit-only UNet; uses the sdxl-base CLIP/VAE. CreativeML Open RAIL++-M.
    'sdxl-inpaint-v01': {
        'name': 'diffusion_pytorch_model.fp16.safetensors',
        'directory': 'diffusion_models/sdxl-inpainting-0.1/unet',
        'url': 'https://huggingface.co/diffusers/stable-diffusion-xl-1.0-inpainting-0.1/resolve/115134f363124c53c7d878647567d04daf26e41e/unet/diffusion_pytorch_model.fp16.safetensors',
        'sha256': '6470840731e98cc16713ddf3ac7ee458c9fdbcb881a98c6727cd4a938f227d3f',
    },
}
PRODUCT_MODELS = ['sdxl-base', 'animagine-xl-4.0-opt', 'sdxl-inpaint-v01']


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def restore(model, workers):
    item = MANIFEST[model]
    directory = ROOT / 'models' / item.get('directory', 'checkpoints')
    directory.mkdir(parents=True, exist_ok=True)
    final = directory / item['name']
    if final.exists():
        if sha256(final) != item['sha256']:
            raise ValueError(f'Existing model SHA256 mismatch; preserved: {final}')
        print(f'{model}: already verified', flush=True)
        return
    with urlopen(Request(item['url'], method='HEAD'), timeout=60) as response:
        size = int(response.headers['Content-Length'])
        resolved = response.url
    chunks = directory / (item['name'] + '.parts')
    chunks.mkdir(exist_ok=True)
    chunk_size = 32 * 1024 * 1024
    ranges = [(index, start, min(start + chunk_size, size) - 1)
              for index, start in enumerate(range(0, size, chunk_size))]

    def fetch(record):
        index, start, end = record
        target = chunks / f'{index:05d}'
        expected = end - start + 1
        for attempt in range(4):
            have = target.stat().st_size if target.exists() else 0
            if have == expected:
                return expected
            if have > expected:
                raise ValueError(f'Oversized saved chunk: {target}')
            try:
                request = Request(resolved, headers={'Range': f'bytes={start + have}-{end}'})
                with urlopen(request, timeout=90) as response:
                    if response.status != 206 or not response.headers.get('Content-Range', '').startswith(f'bytes {start + have}-'):
                        raise ValueError('Publisher did not honor the requested byte range')
                    with target.open('ab') as out:
                        while block := response.read(1024 * 1024):
                            out.write(block)
                if target.stat().st_size != expected:
                    raise OSError('Incomplete model chunk')
                return expected
            except (OSError, TimeoutError):
                if attempt == 3:
                    raise
                time.sleep(2 ** attempt)

    print(json.dumps({'model': model, 'bytes': size, 'workers': workers}), flush=True)
    completed = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        jobs = [pool.submit(fetch, record) for record in ranges]
        for job in as_completed(jobs):
            completed += job.result()
            print(f'{model}: {completed / size:.1%}', flush=True)
    assembled = directory / (item['name'] + '.assembling')
    with assembled.open('wb') as out:
        for index, _, _ in ranges:
            with (chunks / f'{index:05d}').open('rb') as stream:
                while block := stream.read(4 * 1024 * 1024):
                    out.write(block)
    if sha256(assembled) != item['sha256']:
        raise ValueError(f'Download SHA256 mismatch; not activated: {assembled}')
    assembled.rename(final)
    for index, _, _ in ranges:
        (chunks / f'{index:05d}').unlink()
    chunks.rmdir()
    print(f'{model}: SHA256 verified, ready', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', choices=[*MANIFEST, 'product', 'all'], default='product',
                        help='product = models the Mac app registers (sdxl-base, animagine-xl-4.0-opt, sdxl-inpaint-v01)')
    parser.add_argument('--workers', type=int, choices=range(1, 33), default=16)
    args = parser.parse_args()
    selected = list(MANIFEST) if args.model == 'all' else PRODUCT_MODELS if args.model == 'product' else [args.model]
    for model in selected:
        restore(model, args.workers)

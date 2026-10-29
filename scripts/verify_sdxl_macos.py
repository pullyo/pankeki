"""Verify real SDXL generation and masked editing through the Pankeki HTTP API."""
import argparse
import base64
import io
import json
from pathlib import Path
import time
from urllib.request import ProxyHandler, Request, build_opener
import uuid

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
PROMPT = ('a friendly little pancake mascot character, full body, wearing a blue scarf, '
          'simple clean 2d illustration, cream background, centered composition, no text')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['generate', 'edit'])
    parser.add_argument('--url', default='http://127.0.0.1:8190')
    parser.add_argument('--directory', type=Path, default=ROOT / 'runtime/macos/sdxl-verification')
    parser.add_argument('--mask', type=int, nargs=4, default=[320, 384, 384, 256], metavar=('X', 'Y', 'WIDTH', 'HEIGHT'))
    parser.add_argument('--mask-image', type=Path, help='Use a painted grayscale PNG mask instead of a rectangle')
    parser.add_argument('--denoise', type=float, default=.65, help='Masked edit strength')
    parser.add_argument('--edit-prompt', default=PROMPT.replace('blue scarf', 'bright red fabric scarf'))
    parser.add_argument('--negative', default='')
    args = parser.parse_args()
    args.directory.mkdir(parents=True, exist_ok=True)
    opener = build_opener(ProxyHandler({}))

    def call(path, value=None):
        request = Request(args.url + path, data=json.dumps(value).encode() if value is not None else None,
                          headers={'Content-Type': 'application/json'})
        with opener.open(request, timeout=30) as response:
            data = response.read()
            return json.loads(data) if response.headers.get_content_type() == 'application/json' else data

    health = call('/api/health')
    assert health.get('comfy'), health
    assert health.get('default_model_id') == 'sdxl-base', health
    assert any(device.get('type') == 'mps' for device in health['system']['devices']), health
    (args.directory / 'health.json').write_text(json.dumps(health, indent=2) + '\n')
    recipe = dict(model_id='sdxl-base', mode='txt2img', prompt=PROMPT, seed=20261022,
                  width=1024, height=1024, steps=25, cfg=6., sampler='dpmpp_2m', scheduler='karras',
                  cache=False, preview=True, negative=args.negative)
    if args.action == 'edit':
        source = (args.directory / 'generated.png').read_bytes()
        with Image.open(io.BytesIO(source)) as image:
            mask = Image.new('L', image.size, 0)
        if args.mask_image:
            with Image.open(args.mask_image) as image:
                assert image.size == mask.size, image.size
                mask = image.convert('L').copy()
            assert mask.getbbox(), 'Mask must select at least one pixel'
        else:
            x, y, width, height = args.mask
            assert width > 0 and height > 0 and 0 <= x < x + width <= mask.width and 0 <= y < y + height <= mask.height
            ImageDraw.Draw(mask).rectangle((x, y, x + width - 1, y + height - 1), fill=255)
        mask.save(args.directory / 'edit-mask.png')
        buffer = io.BytesIO()
        mask.save(buffer, format='PNG')
        recipe.update(mode='inpaint', source=base64.b64encode(source).decode(),
                      mask=base64.b64encode(buffer.getvalue()).decode(), denoise=args.denoise, roi=False,
                      prompt=args.edit_prompt, seed=20261023)
    job = call('/api/jobs', {'session': 'mac-sdxl-check-' + uuid.uuid4().hex, 'request': recipe})
    print(json.dumps({'action': args.action, 'job_id': job['job_id']}), flush=True)
    started = time.monotonic()
    deadline = started + 900
    last_report = started
    while job['state'] in ('queued', 'running', 'canceling'):
        if time.monotonic() > deadline:
            raise TimeoutError('Verification timed out; the server job was not resubmitted')
        time.sleep(1)
        job = call('/api/jobs/' + job['job_id'])
        if time.monotonic() - last_report >= 15:
            print(json.dumps({'action': args.action, 'state': job['state'], 'elapsed_s': round(time.monotonic() - started, 1)}), flush=True)
            last_report = time.monotonic()
    (args.directory / (args.action + '-job.json')).write_text(json.dumps(job, ensure_ascii=False, indent=2) + '\n')
    assert job['state'] == 'succeeded', job
    data = call(job['result']['image_url'])
    output = args.directory / ('generated.png' if args.action == 'generate' else 'edited.png')
    output.write_bytes(data)
    with Image.open(io.BytesIO(data)) as image:
        image.load()
        assert image.size == (1024, 1024), image.size
        pixels = np.array(image.convert('RGBA'))
    result = {'action': args.action, 'state': 'passed', 'job_id': job['job_id'],
              'elapsed_s': round(time.monotonic() - started, 2), 'file': str(output),
              'metrics': job['result']['metrics']}
    assert result['metrics']['model_calls'] == 1, result
    assert result['metrics']['denoiser_executed'], result
    if args.action == 'edit':
        with Image.open(args.directory / 'generated.png') as image:
            original = np.array(image.convert('RGBA'))
        inside = np.array(mask) > 0
        difference = np.abs(pixels.astype(np.int16) - original.astype(np.int16))
        result.update(outside_mask_max_error=int(difference[~inside, :3].max()),
                      alpha_max_error=int(difference[:, :, 3].max()),
                      changed_inside_pixels=int(np.count_nonzero(np.any(difference[inside, :3], axis=1))))
        assert result['outside_mask_max_error'] == 0, result
        assert result['alpha_max_error'] == 0, result
        assert result['changed_inside_pixels'] > 0, result
    (args.directory / (args.action + '-verification.json')).write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    summary = {key: value for key, value in result.items() if key != 'metrics'}
    summary['metrics'] = {key: result['metrics'].get(key) for key in (
        'model_id', 'model_calls', 'denoiser_executed', 'server_service_s', 'preview_received_count')}
    print(json.dumps(summary, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()

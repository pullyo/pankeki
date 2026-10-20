"""Actual local HTTP -> managed ComfyUI -> PNG smoke, with preserved evidence."""
import base64
import io
import json
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
URL = 'http://127.0.0.1:8190'
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def call(path, value=None):
    request = urllib.request.Request(URL + path, data=json.dumps(value).encode() if value is not None else None,
                                     headers={'Content-Type': 'application/json'})
    with opener.open(request, timeout=30) as response:
        data = response.read()
        return json.loads(data) if response.headers.get_content_type() == 'application/json' else data


def main():
    destination = ROOT / 'evidence' / ('live-http-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    destination.mkdir(parents=True, exist_ok=False)
    session = 'verification-' + uuid.uuid4().hex
    (destination / 'health.json').write_text(json.dumps(call('/api/health'), indent=2), encoding='utf-8')
    results = []

    def run(name, recipe):
        job = call('/api/jobs', {'session': session, 'request': recipe})
        deadline = time.monotonic() + 120
        while job['state'] in ('queued', 'running', 'canceling'):
            if time.monotonic() > deadline:
                raise TimeoutError(job)
            time.sleep(.1)
            job = call('/api/jobs/' + job['job_id'])
        assert job['state'] == 'succeeded', job
        png = call(job['result']['image_url'])
        with Image.open(io.BytesIO(png)) as image:
            image.load()
            assert image.size == (512, 512)
        (destination / (name + '.png')).write_bytes(png)
        (destination / (name + '.json')).write_text(json.dumps(job, indent=2), encoding='utf-8')
        results.append({'condition': name, 'job_id': job['job_id'], **job['result']['metrics']})
        print(name, job['result']['metrics']['cache'], flush=True)
        return png

    recipe = dict(prompt='a blue ceramic teapot on a wooden table, soft window light', seed=20261019, steps=1, cfg=1.)
    original = run('generated', recipe)
    assert run('exact-reuse', recipe) == original
    mask = Image.new('L', (512, 512), 0)
    buffer = io.BytesIO()
    mask.save(buffer, format='PNG')
    encoded = base64.b64encode(original).decode()
    edit = dict(recipe, mode='inpaint', source=encoded, mask=base64.b64encode(buffer.getvalue()).decode(), roi=True)
    empty = run('empty-mask', edit)
    with Image.open(io.BytesIO(empty)) as a, Image.open(io.BytesIO(original)) as b:
        assert a.tobytes() == b.tobytes()
    ImageDraw.Draw(mask).rectangle((160, 160, 351, 351), fill=255)
    buffer = io.BytesIO()
    mask.save(buffer, format='PNG')
    edit.update(mask=base64.b64encode(buffer.getvalue()).decode(), prompt='a green ceramic teapot on a wooden table')
    run('roi-edit', edit)
    assert results[-1]['outside_mask_max_error'] == 0
    assert results[-1]['model_size'] == [256, 256]
    try:
        call('/api/jobs', {'session': session, 'request': {'width': 513}})
        raise AssertionError('invalid width accepted')
    except urllib.error.HTTPError as exc:
        assert exc.code == 400
        (destination / 'expected-error.json').write_bytes(exc.read())
    (destination / 'summary.json').write_text(json.dumps({'status': 'passed', 'kind': 'actual HTTP and GPU', 'runs': results}, indent=2), encoding='utf-8')
    print(destination, flush=True)


if __name__ == '__main__':
    main()

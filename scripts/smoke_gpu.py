"""One real GPU graph and one deliberate validation error; save every result."""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pankeki.comfy_adapter import ComfyClient, ComfyError
from pankeki.engine import decode_image, file_sha256
from pankeki.workflows import txt2img

destination = ROOT / 'evidence' / ('smoke-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
destination.mkdir(parents=True, exist_ok=False)
client = ComfyClient()
workflow = txt2img('sd_turbo.safetensors', 'A blue ceramic teapot on a wooden table, product photograph, natural daylight', seed=42, steps=1)
(destination / 'workflow.json').write_text(json.dumps(workflow, indent=2), encoding='utf-8')
(destination / 'system.json').write_text(json.dumps(client.get('/system_stats'), indent=2), encoding='utf-8')
data, metrics = client.execute(workflow)
image = decode_image(data)
if image.size != (512, 512):
    raise ValueError(f'Unexpected image: {image.size}')
(destination / 'result.png').write_bytes(data)
metrics['image_sha256'] = file_sha256(destination / 'result.png')
try:
    client.submit({'1': {'class_type': 'PankekiIntentionalMissingNode', 'inputs': {}}}, 'pankeki-validation-error')
except ComfyError as exc:
    metrics['expected_error_verified'] = str(exc)
else:
    raise AssertionError('Invalid graph unexpectedly accepted')
(destination / 'metrics.json').write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'directory': str(destination), 'prompt_id': metrics['prompt_id'], 'image_size': image.size,
                  'submit_to_download_s': metrics['submit_to_download_s'], 'expected_error': True}, indent=2), flush=True)

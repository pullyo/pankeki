"""Fixed, bounded macOS Vision foreground matte adapter. Never downloads models."""
import io
from pathlib import Path
import subprocess

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
HELPER = ROOT / '.tools' / 'photo-tools' / 'vision-foreground-mask'
MAX_BYTES = 20 * 1024 * 1024
MAX_PIXELS = 16_777_216


def _image(data):
    if not isinstance(data, bytes) or not 0 < len(data) <= MAX_BYTES or not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('A bounded PNG image is required')
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format != 'PNG' or image.width * image.height > MAX_PIXELS:
                raise ValueError('Image exceeds the 16 megapixel limit')
            if image.n_frames != 1 or image.getexif().get(274,1)!=1 or not data.endswith(b'\x00\x00\x00\x00IEND\xaeB`\x82'):
                raise ValueError('A single, unrotated PNG without trailing data is required')
            image.load()
            return image.copy()
    except (OSError, Image.DecompressionBombError) as exc:
        raise ValueError('Invalid PNG image') from exc


def _run(data):
    if not HELPER.is_file():
        raise ValueError('Local foreground removal is not prepared')
    try:
        result = subprocess.run([str(HELPER)], input=data, capture_output=True, timeout=45, check=False)
    except subprocess.TimeoutExpired as exc:
        raise ValueError('Local foreground removal timed out') from exc
    except OSError as exc:
        raise ValueError('Local foreground removal is unavailable') from exc
    if result.returncode != 0:
        raise ValueError('Local foreground detection failed; no result was applied')
    if not 0 < len(result.stdout) <= MAX_BYTES:
        raise ValueError('Local foreground output exceeds the image limit')
    return result.stdout


def foreground_mask(data):
    source = _image(data)
    raw = _run(data)
    matte = _image(raw)
    if matte.size != source.size:
        raise ValueError('Foreground mask dimensions do not match the image')
    if matte.mode != 'L':
        raise ValueError('Foreground mask must be grayscale')
    if matte.getextrema() in ((0, 0), (255, 255)):
        raise ValueError('No usable foreground separation was detected')
    return raw

"""Fixed, reviewed local video shapes. No user-provided CLI dimensions."""
import hashlib
from pathlib import Path

LOADED_SOURCE_SHA256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()

PROFILES = {
    'preview': {'width': 384, 'height': 256, 'frames': 49, 'fps': 24, 'steps': 8},
    'fullbody': {'width': 384, 'height': 512, 'frames': 241, 'fps': 24, 'steps': 8},
}
DEFAULTS = dict(PROFILES['preview'])
DEPTH_NORMALIZATION_VERSION = 'sequence-visible-minmax-pad02-v1'


def video_profile(name='preview'):
    if not isinstance(name, str) or name not in PROFILES:
        raise ValueError('지원하지 않는 영상 프로필입니다.')
    return dict(PROFILES[name])

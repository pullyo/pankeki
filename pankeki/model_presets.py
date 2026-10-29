"""Explicit local checkpoint identities and conservative starting settings."""
import copy
from pathlib import Path
import re

INPAINT_MODEL_ID = 'sdxl-inpaint-v01'
ANIMAGINE_MODEL_ID = 'animagine-xl-4.0-opt'


MODEL_PRESETS = {
    'sdxl-base': {
        'label': 'SDXL 1.0 Base',
        'checkpoint': 'sd_xl_base_1.0.safetensors',
        'defaults': {'width': 1024, 'height': 1024, 'steps': 25, 'cfg': 6.,
                     'sampler': 'dpmpp_2m', 'scheduler': 'karras', 'denoise': .55},
        'description': '1024px 캐릭터 콘셉트 탐색용 일반 이미지 모델. 부분 수정의 재질·형태 정확성은 보장되지 않습니다.',
    },
    'sd-turbo': {
        'label': 'SD Turbo',
        'checkpoint': 'sd_turbo.safetensors',
        'defaults': {'width': 512, 'height': 512, 'steps': 1, 'cfg': 1.,
                     'sampler': 'euler', 'scheduler': 'normal', 'denoise': 1.},
        'description': '512px 빠른 시안용 일반 이미지 모델. 인물·소품의 정확성과 부분 수정 품질에 한계가 있습니다.',
    },
    ANIMAGINE_MODEL_ID: {
        'label': 'Animagine XL 4.0 Opt',
        'checkpoint': 'animagine-xl-4.0-opt.safetensors',
        'supported_modes': ['txt2img', 'img2img'],
        'defaults': {'width': 1024, 'height': 1024, 'steps': 28, 'cfg': 5.,
                     'sampler': 'euler_ancestral', 'scheduler': 'normal', 'denoise': 1.},
        'recommended_negative': 'lowres, bad anatomy, bad hands, text, extra digits, missing fingers, worst quality, low quality, watermark, blurry',
        'description': '태그 기반 애니메 생성 및 참조 이미지 전체 변형. 영어 comma-tag와 끝의 품질 태그를 권장하며 정밀 부분 수정 모델이 아닙니다.',
    },
    INPAINT_MODEL_ID: {
        'label': 'SDXL Inpaint v0.1',
        'checkpoint': 'sdxl-inpainting-0.1-unet-fp16.safetensors',
        'edit_only': True,
        'defaults': {'width': 1024, 'height': 1024, 'steps': 25, 'cfg': 6.,
                     'sampler': 'dpmpp_2m', 'scheduler': 'karras', 'denoise': .55},
        'description': '전용 UNet과 SDXL Base CLIP/VAE를 사용하는 부분 재생성 모델. 시각 품질은 별도 검수가 필요합니다.',
    },
}

# Execution support, separate from installation, inference and visual acceptance.
MODEL_OPERATIONS = {
    'sdxl-base': ('generate', 'regenerate', 'recompose', 'erase'),
    'sd-turbo': ('generate', 'regenerate', 'erase'),
    ANIMAGINE_MODEL_ID: ('generate', 'recompose'),
    INPAINT_MODEL_ID: ('regenerate', 'erase'),
}


def model_operations(model_id):
    return list(MODEL_OPERATIONS.get(model_id, ()))


def configured_models(config):
    """Read full per-model manifests; retain legacy single-checkpoint configs."""
    explicit = 'models' in config
    if explicit:
        models = config['models']
        if not isinstance(models, dict) or any(key not in MODEL_PRESETS for key in models):
            raise ValueError('models must map supported model ids to checkpoint configurations')
    else:
        models = {}
        name = str(config.get('model_name', '')).replace('\\', '/').split('/')[-1]
        for model_id, preset in MODEL_PRESETS.items():
            if name == preset['checkpoint'] and config.get('model_path') and config.get('manifest'):
                models[model_id] = {key: config[key] for key in ('model_name', 'model_path', 'manifest')}
    for model_id, entry in models.items():
        if not isinstance(entry, dict) or not all(isinstance(entry.get(key), str) and entry[key] for key in ('model_name', 'model_path')):
            raise ValueError(f'{model_id} requires model_name and model_path')
        checkpoint = entry['model_name'].replace('\\', '/').split('/')[-1]
        if checkpoint != MODEL_PRESETS[model_id]['checkpoint']:
            raise ValueError(f'{model_id} checkpoint does not match its model preset identity')
        manifest = entry.get('manifest')
        if not isinstance(manifest, dict) or manifest.get('model_name') != entry['model_name']:
            raise ValueError(f'{model_id} manifest/model_name identity mismatch')
        if not isinstance(manifest.get('model_sha256'), str) or re.fullmatch('[0-9a-f]{64}', manifest['model_sha256']) is None:
            raise ValueError(f'{model_id} requires an attested model SHA256')
        if model_id == INPAINT_MODEL_ID and (
                entry.get('conditioning_model_id') != 'sdxl-base' or 'sdxl-base' not in models):
            raise ValueError(f'{model_id} requires conditioning_model_id=sdxl-base and its configuration')
    default = config.get('default_model_id')
    if default is not None and (not isinstance(default, str) or default not in MODEL_PRESETS
                                or default not in models or MODEL_PRESETS[default].get('edit_only')):
        raise ValueError('default_model_id must identify a configured supported model')
    return copy.deepcopy(models), default, explicit


def is_available(entry, models=None):
    if not entry or not Path(entry['model_path']).is_file():
        return False
    conditioning = entry.get('conditioning_model_id')
    return not conditioning or bool(models and is_available(models.get(conditioning)))


def model_components(models, model_id):
    """Configured identities, separate from evidence that execution used them."""
    if model_id != INPAINT_MODEL_ID:
        return {}
    return {role: {'model_id': key, 'model_name': models[key]['model_name'],
                   'model_sha256': models[key]['manifest']['model_sha256']}
            for role, key in (('primary', model_id), ('conditioning', 'sdxl-base'))}


def model_listing(models, preferred=None):
    available = [model_id for model_id in MODEL_PRESETS if is_available(models.get(model_id), models)]
    generation = [key for key, preset in MODEL_PRESETS.items() if not preset.get('edit_only')]
    default = preferred if preferred in generation and preferred in available else next(
        (key for key in generation if key in available), None)
    entries = [
        {'id': model_id, 'label': preset['label'], 'available': model_id in available,
         'operations': model_operations(model_id),
         'defaults': dict(preset['defaults']), 'description': preset['description'],
         **({'supported_modes': list(preset['supported_modes']),
             'recommended_negative': preset['recommended_negative']} if model_id == ANIMAGINE_MODEL_ID else {})}
        for model_id, preset in MODEL_PRESETS.items()
    ]
    return {'default_model_id': default,
            'models': [entry for entry in entries if entry['id'] in generation],
            'edit_models': [entry for entry in entries if entry['id'] not in generation]}

"""Explicit local checkpoint identities and conservative starting settings."""
import copy
from pathlib import Path
import re


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
}


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
    default = config.get('default_model_id')
    if default is not None and (not isinstance(default, str) or default not in MODEL_PRESETS or default not in models):
        raise ValueError('default_model_id must identify a configured supported model')
    return copy.deepcopy(models), default, explicit


def is_available(entry):
    return bool(entry and Path(entry['model_path']).is_file())


def model_listing(models, preferred=None):
    available = [model_id for model_id in MODEL_PRESETS if is_available(models.get(model_id))]
    default = preferred if preferred in available else next(iter(available), None)
    return {'default_model_id': default, 'models': [
        {'id': model_id, 'label': preset['label'], 'available': model_id in available,
         'defaults': dict(preset['defaults']), 'description': preset['description']}
        for model_id, preset in MODEL_PRESETS.items()
    ]}

"""Pure local readiness snapshot. No inference, downloads, login or health requests."""
import copy
import hashlib
import json
import re

from .model_presets import MODEL_PRESETS, is_available, model_listing, model_operations

OPERATIONS = ('generate', 'regenerate', 'recolor', 'recompose', 'markup', 'comments',
              'background-remove', 'erase', 'resize')


def json_numbers(value):
    """Match JS canonical JSON for the bounded numbers used in this schema."""
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {key:json_numbers(item) for key,item in value.items()}
    if isinstance(value, list):
        return [json_numbers(item) for item in value]
    return value


def content_revision(snapshot):
    value = json_numbers({key: value for key, value in snapshot.items() if key != 'revision'})
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False,
                                     allow_nan=False).encode()).hexdigest()


# Cancel verification finishes at the first submitted job, so it is runtime status
# (reported by /api/health), not part of the revision a page captures before chatting.
def targeted_cancel_status(engine):
    return copy.deepcopy(getattr(engine.client, 'targeted_cancel_capability',
        {'state':'unknown','atomic_source_verified':False,'route_verified':False,
         'reason':'Transport does not publish a verified atomic cancellation capability'}))


def capability_snapshot(engine, *, build=None, preflight=None):
    config = engine.config
    models = []
    for model_id, preset in MODEL_PRESETS.items():
        installed = is_available(engine.models.get(model_id), engine.models)
        models.append({'id':model_id,'label':preset['label'],'installed':installed,
            'operations':model_operations(model_id),'defaults':copy.deepcopy(preset['defaults']),
            'description':preset['description'],
            **({'recommended_negative':preset['recommended_negative']} if 'recommended_negative' in preset else {}),
            'reason':None if installed else 'Required model or conditioning checkpoint is not installed/configured',
            'execution_verified':False, 'quality':'unknown'})
    vision = (engine.root / '.tools/photo-tools/vision-foreground-mask').is_file()
    available = {
        'recolor':(True, 'Local integer recolor; no model dependency'),
        'markup':(True, 'Local bounded PNG markup'),
        'comments':(True, 'Local positioned comments; no inference'),
        'background-remove':(vision, 'Local Vision helper present; execution unverified' if vision else 'Local foreground helper is not installed'),
        'resize':(True, 'Local bounded Pillow resize'),
    }
    rows = copy.deepcopy(preflight) if preflight is not None else [
        {'id':'comfy','state':'unknown','reason':'Not contacted by the pure capability snapshot'},
        {'id':'vision','state':'ready' if vision else 'unavailable','reason':available['background-remove'][1]},
        {'id':'cli-login','state':'unknown','reason':'Optional CLI sign-in is not required for local readiness'},
        {'id':'image-review','state':'unavailable','reason':'Optional remote image review is not enabled'},
        {'id':'visual-quality','state':'unknown','reason':'No visual quality acceptance is inferred from installation or metrics'},
    ]
    if not isinstance(rows, list) or any(not isinstance(row, dict) or row.get('state') not in ('ready','unavailable','unknown') for row in rows):
        raise ValueError('Invalid preflight snapshot')
    comfy_unavailable = any(row.get('id') == 'comfy' and row['state'] == 'unavailable' for row in rows)
    operations = []
    for operation in OPERATIONS:
        model_ids = [row['id'] for row in models if operation in row['operations']]
        if operation in available:
            ready, reason = available[operation]
            lane = 'cpu'
        else:
            ready = any(row['installed'] and operation in row['operations'] for row in models) and not comfy_unavailable
            reason = ('Comfy preflight unavailable' if comfy_unavailable else None if ready else 'No installed/configured model supports this operation')
            lane = 'gpu'
        operations.append({'id':operation,'lane':lane,'ready':ready,'reason':reason,
            'model_ids':model_ids,'experimental':False,'execution_verified':False,'quality':'unknown'})
    managed = bool(config.get('managed_builtin_only'))
    snapshot = {'schema':1,'build':copy.deepcopy(build),'models':models,'operations':operations,
        'default_model_id':model_listing(engine.models, engine._preferred_model)['default_model_id'],
        'cache':{'policy':'managed-exact' if managed else 'strict-direct-bypass','enabled':managed,
            'reason':'Managed model/runtime fingerprint checks remain required' if managed else 'Unmanaged direct server: exact cache bypass; strict model fingerprint policy retained'},
        'preflight':rows}
    snapshot = json_numbers(snapshot)
    snapshot['revision'] = content_revision(snapshot)
    return snapshot


def validate_snapshot(snapshot):
    if (not isinstance(snapshot, dict) or snapshot.get('schema') != 1
            or not isinstance(snapshot.get('revision'), str) or not re.fullmatch('[0-9a-f]{64}', snapshot['revision'])
            or content_revision(snapshot) != snapshot['revision']):
        raise ValueError('Unknown or invalid capability schema/revision')
    models, operations = snapshot.get('models'), snapshot.get('operations')
    if not isinstance(models, list) or not isinstance(operations, list):
        raise ValueError('Malformed capability matrix')
    if len({row.get('id') for row in models}) != len(models) or len({row.get('id') for row in operations}) != len(operations):
        raise ValueError('Duplicate capability identity')
    for row in models:
        if row.get('id') not in MODEL_PRESETS or type(row.get('installed')) is not bool or row.get('operations') != model_operations(row['id']):
            raise ValueError('Unknown model or model operation')
    for row in operations:
        if (row.get('id') not in OPERATIONS or row.get('lane') not in ('cpu','gpu')
                or type(row.get('ready')) is not bool or row.get('experimental') is not False
                or not isinstance(row.get('model_ids'), list)
                or any(key not in MODEL_PRESETS for key in row['model_ids'])):
            raise ValueError('Unknown or invalid operation')
    return snapshot

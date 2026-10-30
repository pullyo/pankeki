"""Independently audit saved inpaint run directories, without API/GPU calls.

Usage: .venv-macos/bin/python -B scripts/qa_inpaint_quality.py RUN [RUN ...]
       --output runtime/macos/inpaint-quality/qa/report.json
Exit 0: recorded technical gates pass; exit 1: failed/missing evidence.
Neither exit code nor changed pixels constitutes a visual quality verdict.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def canonical_hash(value):
    return sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                             allow_nan=False, separators=(',', ':')).encode('utf-8'))


def read_pixels(path, mode):
    with Image.open(path) as image:
        image.load()
        info = {'path': str(path.resolve()), 'size': list(image.size), 'mode': image.mode,
                'sha256': sha256(path.read_bytes()),
                'has_alpha': image.mode in ('RGBA', 'LA', 'PA') or 'transparency' in image.info}
        return np.asarray(image.convert(mode), dtype=np.int16), info


def inspect_inference(metrics, samplers):
    prompt_id = metrics.get('prompt_id')
    events = [(event.get('type'), event.get('data', {})) for event in metrics.get('events', [])]
    events += [(item[0], item[1]) for item in metrics.get('history_messages', [])]
    relevant = [(kind, data) for kind, data in events if prompt_id and data.get('prompt_id') == prompt_id]
    cached = {str(node) for node in metrics.get('comfy_cached_nodes', [])}
    for kind, data in relevant:
        if kind == 'execution_cached':
            cached.update(str(node) for node in data.get('nodes', []))
    executed = {str(data['node']) for kind, data in relevant
                if kind == 'executing' and data.get('node') is not None}
    success = any(kind == 'execution_success' for kind, _ in relevant)
    foreign = sum(bool(data.get('prompt_id')) and data['prompt_id'] != prompt_id for _, data in events)
    cache_hit = metrics.get('cache') == 'hit' or bool(set(samplers) & cached)
    fresh = (not cache_hit and bool(samplers) and set(samplers) <= executed and success and not foreign
             and metrics.get('cache') in ('off', 'miss', 'bypass')
             and metrics.get('kind') == 'real_comfyui' and metrics.get('model_calls') == 1
             and metrics.get('gpu_completed') is True and metrics.get('denoiser_executed') is True
             and metrics.get('status') == 'succeeded' and metrics.get('error') is None)
    return {'classification': 'fresh_sampler_execution_recorded' if fresh else 'cache_hit' if cache_hit else 'not_proven',
            'fresh': fresh, 'prompt_id': prompt_id, 'cache': metrics.get('cache'),
            'cache_reason': metrics.get('cache_reason'), 'model_calls': metrics.get('model_calls'),
            'reported_denoiser_executed': metrics.get('denoiser_executed'),
            'model_id': metrics.get('model_id'), 'model_name': metrics.get('model_name'),
            'model_size': metrics.get('model_size'),
            'sampler_nodes': samplers, 'executed_nodes': sorted(executed), 'cached_nodes': sorted(cached),
            'success_event_recorded': success, 'foreign_prompt_event_count': foreign,
            'total_s': metrics.get('total_s'), 'server_service_s': metrics.get('server_service_s'),
            'basis': 'Saved same-prompt execution events/history and cache records; no fresh hardware observation.'}


def inspect_workflow(recipe, workflow, metrics, samplers):
    differences = []
    if len(samplers) != 1:
        return ['expected exactly one built-in KSampler; review other graph types manually']
    inputs = workflow[samplers[0]]['inputs']
    fields = {'seed': 'seed', 'steps': 'steps', 'cfg': 'cfg', 'sampler': 'sampler_name',
              'scheduler': 'scheduler', 'denoise': 'denoise'}
    for key, field in fields.items():
        if key not in recipe or field not in inputs or recipe[key] != inputs[field]:
            differences.append(key)
    for key, field in [('prompt', 'positive'), ('negative', 'negative')]:
        node = workflow[str(inputs[field][0])]
        if node.get('class_type') != 'CLIPTextEncode' or node['inputs'].get('text') != recipe.get(key):
            differences.append(key)
    model = workflow[str(inputs['model'][0])]
    if model.get('class_type') != 'CheckpointLoaderSimple' or model['inputs'].get('ckpt_name') != metrics.get('model_name'):
        differences.append('model_name')
    if not recipe.get('model_id') or recipe.get('model_id') != metrics.get('model_id'):
        differences.append('model_id')
    if recipe.get('mode') != 'inpaint':
        differences.append('mode')
    return differences


def audit_run(directory):
    directory = directory.resolve()
    recipe, workflow, metrics = [json.loads((directory/name).read_text(encoding='utf-8'))
                                 for name in ('recipe.json', 'workflow.json', 'metrics.json')]
    original, original_info = read_pixels(directory/'original.png', 'RGBA')
    mask, mask_info = read_pixels(directory/'mask.png', 'L')
    result, result_info = read_pixels(directory/'result.png', 'RGBA')
    if original.shape != result.shape or original.shape[:2] != mask.shape:
        raise ValueError('Image size mismatch: original/mask/result must match without resize or crop')
    inside = mask > 0
    outside = ~inside
    difference = np.abs(result - original)
    rgb_changed = np.any(difference[:, :, :3] != 0, axis=2)
    outside_error = int(difference[outside, :3].max()) if outside.any() else None
    alpha_error = int(difference[:, :, 3].max())
    pixels = {'outside_mask_max_rgb_error': outside_error, 'alpha_max_error': alpha_error,
              'mask_pixels': int(inside.sum()), 'outside_pixels': int(outside.sum()),
              'changed_inside_pixels': int(np.count_nonzero(rgb_changed & inside)),
              'changed_outside_pixels': int(np.count_nonzero(rgb_changed & outside)),
              'nonopaque_original_pixels': int(np.count_nonzero(original[:, :, 3] != 255)),
              'mask_support': 'luminance > 0; no thresholding, dilation, resize or feather applied by QA'}
    samplers = sorted(str(node) for node, value in workflow.items() if value.get('class_type') == 'KSampler')
    inference = inspect_inference(metrics, samplers)
    workflow_differences = inspect_workflow(recipe, workflow, metrics, samplers)
    hashes = {'recipe_canonical_sha256': canonical_hash(recipe), 'workflow_canonical_sha256': canonical_hash(workflow)}
    checks = {
        'dimensions_match': True,
        'nonempty_mask': bool(inside.any()),
        'outside_mask_rgb_exact': outside_error == 0,
        'alpha_preserved': alpha_error == 0,
        'actual_inside_rgb_change': pixels['changed_inside_pixels'] > 0,
        'original_hash_matches': original_info['sha256'] == recipe.get('original_sha256'),
        'mask_hash_matches': mask_info['sha256'] == recipe.get('mask_sha256'),
        'result_hash_matches': result_info['sha256'] == metrics.get('image_sha256'),
        'recipe_hash_matches': hashes['recipe_canonical_sha256'] == metrics.get('recipe_sha256'),
        'workflow_hash_matches': hashes['workflow_canonical_sha256'] == metrics.get('workflow_sha256'),
        'job_ids_match': bool(recipe.get('job_id')) and recipe.get('job_id') == metrics.get('job_id'),
        'recipe_matches_workflow': not workflow_differences,
        'fresh_inference_recorded': inference['fresh'],
    }
    plan = recipe.get('plan', {})
    if 'original_size' in plan:
        checks['plan_original_size_matches'] = plan['original_size'] == original_info['size']
    return {'directory': str(directory), 'job_id': recipe.get('job_id'),
            'technical_gate_passed': all(checks.values()), 'checks': checks,
            'files': {'original': original_info, 'mask': mask_info, 'result': result_info},
            'pixels': pixels, 'inference': inference, 'recipe': recipe,
            'workflow_recipe_differences': workflow_differences, 'hashes': hashes,
            'quality_verdict': 'not_evaluated',
            'quality_axes': ['instruction_adherence', 'unintended_shape_change', 'boundary_material', 'character_identity'],
            'coverage_notes': ['Opaque RGB input does not exercise transparent-alpha preservation.'
                               if not original_info['has_alpha'] else 'Alpha compared over the entire decoded RGBA image.',
                               'No zero-mask pixels: outside preservation is unexercised.' if not outside.any()
                               else 'Outside RGB compared including invisible RGB under alpha zero.']}


def compare_runs(baseline, candidate):
    if 'error' in baseline or 'error' in candidate:
        return {'comparable': False, 'reason': 'Cannot compare an unreadable run'}
    same = {key: baseline['files'][key]['sha256'] == candidate['files'][key]['sha256']
            for key in ('original', 'mask')}
    same.update({key: baseline['recipe'].get(key) == candidate['recipe'].get(key)
                 for key in ('seed', 'model_id')})
    same['model_name'] = (bool(baseline['inference']['model_name'])
                          and baseline['inference']['model_name'] == candidate['inference']['model_name'])
    ignored = {'job_id', 'revision', 'adapter_source_sha256', 'client_software', 'transport', 'plan'}
    keys = (baseline['recipe'].keys() | candidate['recipe'].keys()) - ignored
    changed = sorted(key for key in keys if baseline['recipe'].get(key) != candidate['recipe'].get(key))
    technical = baseline['technical_gate_passed'] and candidate['technical_gate_passed']
    provenance_keys = ('adapter_source_sha256', 'client_software', 'transport')
    return {'baseline_job_id': baseline['job_id'], 'candidate_job_id': candidate['job_id'],
            'same_inputs_seed_model': same,
            'comparable': all(same.values()) and technical and len(changed) <= 1,
            'both_technical_gates_passed': technical,
            'changed_request_fields': changed, 'request_variable_count': len(changed),
            'single_request_variable_or_less': len(changed) <= 1,
            'changed_provenance_fields': [key for key in provenance_keys
                                          if baseline['recipe'].get(key) != candidate['recipe'].get(key)],
            'quality_improvement': 'not_evaluated; requires controlled comparison and visual review',
            'note': 'Code/model bytes and environment equivalence require separate provenance review.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('runs', nargs='+', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if any(args.output.resolve().is_relative_to(run.resolve()) for run in args.runs):
        parser.error('Report output must be outside audited run directories; input artifacts are read-only')
    rows = []
    for directory in args.runs:
        try:
            rows.append(audit_run(directory))
        except (OSError, ValueError, KeyError, TypeError, IndexError) as error:
            rows.append({'directory': str(directory.resolve()), 'technical_gate_passed': False,
                         'error': str(error), 'quality_verdict': 'not_evaluated'})
    report = {'schema_version': 1, 'audited_at_utc': datetime.now(timezone.utc).isoformat(),
              'mode': 'offline_saved_artifacts_only', 'runs': rows,
              'comparisons_to_first': [compare_runs(rows[0], row) for row in rows[1:]],
              'all_technical_gates_passed': all(row['technical_gate_passed'] for row in rows),
              'quality_verdict': 'not_evaluated'}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, allow_nan=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'report': str(args.output.resolve()), 'runs': len(rows),
                      'all_technical_gates_passed': report['all_technical_gates_passed'],
                      'quality_verdict': 'not_evaluated'}))
    return 0 if report['all_technical_gates_passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())

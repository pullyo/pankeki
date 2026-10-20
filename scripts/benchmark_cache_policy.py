"""Actual managed app latency, strict hashing versus retained Windows read lease.

Repetition baseline deliberately retains ComfyUI's own cache. This measures
completion reuse and integrity overhead, not a faster diffusion algorithm.
"""
import argparse
import json
import math
import random
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pankeki.engine import Engine
from pankeki.cache import ExactCache
from pankeki.jobs import JobManager


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repeat', type=int, default=10)
    parser.add_argument('--warmup', type=int, default=3)
    parser.add_argument('--seed-base', type=int, default=None)
    args = parser.parse_args()
    destination = ROOT / 'evidence' / ('cache-policy-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    destination.mkdir(parents=True, exist_ok=False)
    config = json.loads((ROOT / 'runtime' / 'config.json').read_text(encoding='utf-8-sig'))
    engines, managers, rows = {}, {}, []
    try:
        for policy in ('strict', 'windows_read_lock'):
            engines[policy] = Engine(ROOT, config=dict(config, fingerprint_policy=policy))
            engines[policy].cache = ExactCache(destination / 'cache')
            managers[policy] = JobManager(engines[policy])
            if engines[policy].fingerprint_policy != policy:
                raise RuntimeError('Requested lease unavailable: ' + str(engines[policy].fingerprint_fallback))
        (destination / 'setup.json').write_text(json.dumps({
            key: {'setup_s': engine.fingerprint_setup_s, 'actual_policy': engine.fingerprint_policy}
            for key, engine in engines.items()}, indent=2), encoding='utf-8')
        seed_base = args.seed_base if args.seed_base is not None else time.time_ns() % (2**63)
        request = dict(prompt='a blue ceramic teapot on a wooden table, soft window light',
                       width=512, height=512, seed=seed_base, steps=1, cfg=1., preview=False)
        (destination / 'request.json').write_text(json.dumps(request, indent=2), encoding='utf-8')

        def run(policy, condition, iteration, changes):
            recipe = dict(request, **changes)
            started = time.perf_counter()
            manager = managers[policy]
            submitted = manager.submit('cache-policy-' + policy, recipe)
            job = manager.wait(submitted['job_id'])
            if job['state'] != 'succeeded':
                raise RuntimeError(job)
            measured = job['result']['metrics']
            row = dict(measured, condition=condition, iteration=iteration, policy=policy,
                       client_wait_s=time.perf_counter() - started)
            rows.append(row)
            with (destination / 'raw.jsonl').open('a', encoding='utf-8') as stream:
                stream.write(json.dumps(row, ensure_ascii=False) + '\n')
            print(json.dumps({key: row.get(key) for key in ('policy','condition','iteration','cache','total_s','denoiser_executed')}), flush=True)
            return row

        prime = run('strict', 'prime', 0, {'cache': True})
        for iteration in range(args.warmup):
            for policy in engines:
                run(policy, 'warmup', iteration, {'cache': False})
        rng = random.Random(20261019)
        for iteration in range(args.repeat):
            tasks = [(policy, condition) for policy in engines for condition in ('repeated_app_off', 'exact_hit', 'new_seed')]
            rng.shuffle(tasks)
            for policy, condition in tasks:
                changes = {'cache': condition != 'repeated_app_off'}
                if condition == 'new_seed':
                    changes['seed'] = seed_base + 1 + iteration * 2 + int(policy == 'windows_read_lock')
                row = run(policy, condition, iteration, changes)
                if condition == 'exact_hit':
                    assert row['cache'] == 'hit' and row['model_calls'] == 0
                    assert row['image_sha256'] == prime['image_sha256']
        summary = {'status': 'passed', 'repeat': args.repeat, 'warmup': args.warmup, 'conditions': {},
                   'setup': json.loads((destination / 'setup.json').read_text()),
                   'notes': ['Integrity setup cost is paid once per Engine and excluded from per-job totals.',
                             'The lease holds file and ancestor directory handles until Engine close; normal writes/replacements are denied.',
                             'ComfyUI internal node cache is enabled and cached_nodes recorded, including repeated-app-off baseline.',
                             'Exact hits reuse byte-identical completed PNGs, not new diffusion.',
                             'New seeds differ across policies to prevent ComfyUI cross-policy denoiser reuse; they are not paired quality tests.',
                             'Source/process/runtime checks still execute on every request. Browser paint and CUDA component time unmeasured.']}
        for policy in engines:
            for condition in ('repeated_app_off', 'exact_hit', 'new_seed'):
                selected = [r for r in rows if r['policy'] == policy and r['condition'] == condition]
                samples = sorted(r['total_s'] for r in selected)
                summary['conditions'][policy + '/' + condition] = {
                    'n': len(samples), 'p50_s': statistics.median(samples), 'p95_s_empirical': samples[max(0, math.ceil(.95 * len(samples)) - 1)],
                    'fingerprint_p50_s': statistics.median(r['fingerprint_s'] for r in selected),
                    'submissions': sum(r['model_calls'] for r in selected),
                    'denoiser_executed': sum(r.get('denoiser_executed') is True for r in selected)}
        (destination / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
        print(destination, flush=True)
    finally:
        for manager in managers.values():
            manager.close()
        for policy, engine in engines.items():
            if policy not in managers or not managers[policy].worker.is_alive():
                engine.close()


if __name__ == '__main__':
    main()

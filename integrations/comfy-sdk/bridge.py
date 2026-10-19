"""Official Comfy SDK subprocess bridge; local API proxy only, JSON lines out."""
from __future__ import annotations

import argparse
import base64
import copy
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import struct
import sys
import threading
import time
import uuid
from datetime import datetime, timezone

BASE_URL = 'http://127.0.0.1:8189'


def graph_hash(graph):
    return hashlib.sha256(json.dumps(graph, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')).hexdigest()


def output_name(index, content_type):
    extension = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp'}.get(content_type, '.bin')
    return f'output-{index:03d}{extension}'


def validate_request(request):
    if not isinstance(request, dict) or 'base_url' in request:
        raise ValueError('Request must be an object; this bridge has a fixed loopback route.')
    graph = request.get('workflow')
    if not isinstance(graph, dict) or not graph:
        raise ValueError('A nonempty API-format workflow is required.')
    for node in graph.values():
        if not isinstance(node, dict) or not isinstance(node.get('class_type'), str) or not isinstance(node.get('inputs'), dict):
            raise ValueError('Workflow must contain API-format nodes.')
    timeout = request.get('timeout_seconds', 600)
    if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or not 0 < timeout <= 7200:
        raise ValueError('timeout_seconds must be finite and within (0, 7200].')
    assets = request.get('assets', [])
    if not isinstance(assets, list):
        raise ValueError('assets must be an array.')
    for asset in assets:
        if not isinstance(asset, dict) or asset.get('node_id') not in graph or asset.get('input_name') not in graph[asset['node_id']]['inputs'] or not isinstance(asset.get('path'), str):
            raise ValueError('An asset must name an existing node/input and a local file path.')
    if 'idempotency_key' in request:
        key = request['idempotency_key']
        if not isinstance(key, str) or not 1 <= len(key) <= 255 or any(not 32 <= ord(char) <= 126 for char in key):
            raise ValueError('idempotency_key must be 1–255 printable ASCII characters.')
    return request


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    temporary.replace(path)


def run_workflow(request, output_dir, receipt_path, *, request_dir=None, cancel_file=None, emit=lambda value: None):
    from comfy_sdk import Comfy, Preview, Progress, StatusChange

    validate_request(request)
    request_dir = Path(request_dir or Path.cwd())
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    receipt_path = Path(receipt_path)
    if receipt_path.exists():
        raise FileExistsError('Receipt already exists. Inspect its job_id; never blindly resubmit.')
    canceled = lambda: cancel_file is not None and Path(cancel_file).exists()
    if canceled():
        raise InterruptedError('Canceled before submission.')
    started = time.perf_counter()
    receipt = {
        'schema': 1, 'transport': 'official-comfy-sdk', 'base_url': BASE_URL,
        'upstream': 'http://127.0.0.1:8188', 'sdk_version': importlib.metadata.version('comfy-sdk'),
        'proxy_version': importlib.metadata.version('comfy-api-proxy'),
        'workflow_sha256': graph_hash(request['workflow']),
        'idempotency_key': request.get('idempotency_key') or str(uuid.uuid4()),
        'started_utc': datetime.now(timezone.utc).isoformat(), 'state': 'prepared', 'job_id': None, 'outputs': [],
        'preview_received_count': 0, 'preview_received_bytes': 0, 'first_preview_s': None,
    }
    save_json(receipt_path, receipt)
    # Only this isolated process is configured; never use inherited cloud/key settings.
    os.environ['COMFY_BASE_URL'] = BASE_URL
    os.environ['COMFY_ROUTER_BASE_URL'] = BASE_URL
    os.environ.pop('COMFY_API_KEY', None)
    os.environ['NO_PROXY'] = '127.0.0.1,localhost,::1'
    done = threading.Event()
    stream = None
    try:
        with Comfy(api_key='', timeout=10.0, client_info='pankeki-local-bridge') as client:
            workflow = client.workflows.from_json(copy.deepcopy(request['workflow']))
            for asset in request.get('assets', []):
                path = Path(asset['path'])
                path = path if path.is_absolute() else request_dir / path
                workflow.set_input(asset['node_id'], asset['input_name'], client.assets.from_file(path))
            if canceled():
                raise InterruptedError('Canceled before submission.')
            # Exactly one submit call. SDK handles explicit queue-full responses only.
            job = client.submit(workflow, idempotency_key=receipt['idempotency_key'])
            receipt.update(state='submitted', job_id=job.id)
            save_json(receipt_path, receipt)
            emit({'event': 'submitted', 'job_id': job.id})

            def observe_events():
                try:
                    handle = client.jobs.get(job.id)
                    for event in handle.events():
                        if done.is_set():
                            break
                        if isinstance(event, Preview):
                            receipt['preview_received_count'] += 1
                            receipt['preview_received_bytes'] += len(event.data)
                            if receipt['first_preview_s'] is None:
                                receipt['first_preview_s'] = time.perf_counter() - started
                            emit({'event': 'preview', 'node_id': event.node_id, 'content_type': event.content_type, 'data_base64': base64.b64encode(event.data).decode('ascii')})
                        elif isinstance(event, Progress):
                            emit({'event': 'progress', 'value': event.value, 'node_id': event.current_node, 'step': event.step, 'steps': event.steps})
                        elif isinstance(event, StatusChange):
                            emit({'event': 'status', 'status': event.status})
                except Exception as exc:
                    if not done.is_set():
                        emit({'event': 'stream_unavailable', 'message': str(exc)})

            stream = threading.Thread(target=observe_events, name='sdk-events', daemon=True)
            stream.start()
            deadline = started + request.get('timeout_seconds', 600)
            last_status = None
            while True:
                if canceled():
                    raise InterruptedError('Result ignored locally; ComfyUI may finish. No interrupt sent.')
                if time.perf_counter() >= deadline:
                    raise TimeoutError(f'Observation timed out for job {job.id}; it may still run. Do not resubmit.')
                job.refresh()
                if job.status != last_status:
                    emit({'event': 'status', 'status': job.status})
                    last_status = job.status
                if job.status in ('succeeded', 'failed', 'canceled', 'cancelled', 'expired'):
                    break
                time.sleep(0.25)
            if job.status != 'succeeded':
                raise RuntimeError(f'SDK job ended {job.status}: {job.error}')
            selected = request.get('output_nodes')
            outputs = job.outputs if selected is None else [output for node in selected for output in job.get_outputs(str(node))]
            if not outputs:
                raise RuntimeError('SDK job succeeded without requested outputs.')
            for index, output in enumerate(outputs):
                path = output_dir / output_name(index, output.content_type)
                if path.exists():
                    raise FileExistsError(f'Output already exists: {path}')
                output.to_file(path)
                data = path.read_bytes()
                record = {'path': str(path), 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data), 'content_type': output.content_type, 'job_id': output.job_id, 'name': output.name}
                if data.startswith(b'\x89PNG\r\n\x1a\n') and len(data) >= 24:
                    record['width'], record['height'] = struct.unpack('>II', data[16:24])
                receipt['outputs'].append(record)
                emit({'event': 'output', **record})
            executed = job.get_workflow()
            save_json(output_dir / 'executed-workflow.json', {'format': executed.format, 'graph': executed.graph})
            done.set()
            receipt.update(state='succeeded', elapsed_s=time.perf_counter() - started)
            save_json(receipt_path, receipt)
            emit({'event': 'complete', 'receipt': receipt})
            return receipt
    except Exception as exc:
        done.set()
        receipt.update(state='canceled_locally' if isinstance(exc, InterruptedError) else 'error', error_type=type(exc).__name__, error=str(exc), elapsed_s=time.perf_counter() - started)
        save_json(receipt_path, receipt)
        raise
    finally:
        done.set()
        if stream is not None:
            stream.join(timeout=0.2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--receipt', type=Path, required=True)
    parser.add_argument('--cancel-file', type=Path)
    args = parser.parse_args()
    lock = threading.Lock()
    def emit(value):
        with lock:
            print(json.dumps(value, ensure_ascii=False, allow_nan=False), flush=True)
    try:
        request = json.loads(args.request.read_text(encoding='utf-8-sig'))
        run_workflow(request, args.output_dir, args.receipt, request_dir=args.request.parent, cancel_file=args.cancel_file, emit=emit)
        return 0
    except Exception as exc:
        emit({'event': 'error', 'type': type(exc).__name__, 'message': str(exc), 'receipt_path': str(args.receipt)})
        return 2


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())

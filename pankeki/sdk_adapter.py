"""Official local Comfy SDK bridge with isolated, exactly-once subprocesses."""
from __future__ import annotations

import base64
from contextlib import ExitStack
from copy import deepcopy
import hashlib
import io
import json
import math
import os
from pathlib import Path
import queue
import re
import subprocess
import threading
import time
import uuid

from PIL import Image

from .comfy_adapter import Canceled, ComfyClient, ComfyError, SubmissionUncertain
from .model_lease import ReadOnlyModelLease


_ASSET = re.compile(r'[0-9a-f]{64}\.png\Z')
_MAX_IMAGE_BYTES = 64 * 1024 * 1024
_MAX_LINE = 24 * 1024 * 1024


def _hash(data):
    return hashlib.sha256(data).hexdigest()


def _file_hash(path):
    return _hash(path.read_bytes())


def _image_check(data, png_only=False):
    if not data or len(data) > _MAX_IMAGE_BYTES:
        raise ValueError('Image byte size is invalid')
    with Image.open(io.BytesIO(data)) as image:
        if image.format not in (('PNG',) if png_only else ('PNG', 'JPEG', 'WEBP')):
            raise ValueError('Unsupported image format')
        if image.width * image.height > 16_777_216 or getattr(image, 'n_frames', 1) != 1:
            raise ValueError('Image dimensions/frame count are invalid')
        image.verify()
    with Image.open(io.BytesIO(data)) as image:
        image.load()


class SDKComfyClient(ComfyClient):
    """Retains native read-only health/manifest calls; SDK owns submit/assets/results.

    The bridge/proxy has a fixed upstream, so alternate native servers are rejected.
    Cancel only discards this result. It never interrupts another ComfyUI job.
    A failed/lost submission is never retried, including after the child exits.
    """

    def __init__(self, base_url='http://127.0.0.1:8188', *, root=None, runtime_dir=None,
                 python_executable=None, bridge_path=None, lock_path=None, request_timeout=15):
        super().__init__(base_url, request_timeout=request_timeout)
        if self.base_url not in ('http://127.0.0.1:8188', 'http://localhost:8188'):
            raise ValueError('SDK bridge requires its fixed loopback ComfyUI upstream on port 8188')
        root = Path(root or Path(__file__).resolve().parents[1]).resolve()
        integration = root / 'integrations/comfy-sdk'
        self.python_executable = Path(python_executable or integration / '.venv/Scripts/python.exe').resolve()
        self.bridge_path = Path(bridge_path or integration / 'bridge.py').resolve()
        self.lock_path = Path(lock_path or integration / 'requirements.lock.txt').resolve()
        if not all(path.is_file() for path in (self.python_executable, self.bridge_path, self.lock_path)):
            raise ValueError('SDK interpreter, bridge or dependency lock is missing')
        self.runtime_dir = Path(runtime_dir or root / 'runtime/sdk').resolve()
        self.assets_dir = self.runtime_dir / 'assets'
        self.assets_dir.mkdir(parents=True, exist_ok=True)
        self._asset_lock = threading.RLock()
        self._fingerprint = self.fingerprint()

    def fingerprint(self):
        return {'transport': 'official-comfy-sdk', 'bridge_sha256': _file_hash(self.bridge_path),
                'requirements_lock_sha256': _file_hash(self.lock_path),
                'proxy_url': 'http://127.0.0.1:8189', 'upstream_url': 'http://127.0.0.1:8188'}

    def health(self):
        proxy = ComfyClient('http://127.0.0.1:8189', request_timeout=self.request_timeout)
        status = proxy.get('/api/v2/health')
        if status.get('status') != 'healthy' or status.get('upstream') != 'http://127.0.0.1:8188':
            raise ComfyError('SDK proxy is unhealthy or its upstream has changed')
        return self.get('/system_stats')

    def upload_png(self, data, name):
        if not isinstance(name, str) or _ASSET.fullmatch(name) is None or _hash(data) != name[:-4]:
            raise ValueError('SDK asset name must match its PNG content SHA256')
        _image_check(data, png_only=True)
        target = self.assets_dir / name
        with self._asset_lock:
            if target.exists():
                if target.is_symlink() or _file_hash(target) != name[:-4]:
                    raise ValueError('SDK asset content changed after staging')
            else:
                temporary = self.assets_dir / (uuid.uuid4().hex + '.tmp')
                try:
                    temporary.write_bytes(data)
                    try:
                        os.link(temporary, target)  # Publish the complete file without replacing an existing path.
                    except FileExistsError:
                        if _file_hash(target) != name[:-4]:
                            raise ValueError('SDK asset content changed while staging')
                finally:
                    temporary.unlink(missing_ok=True)
        return name

    def _assets(self, workflow, leases):
        assets = []
        seen = set()
        for node_id, node in workflow.items():
            if node.get('class_type') not in ('LoadImage', 'LoadImageMask'):
                continue
            name = node.get('inputs', {}).get('image')
            if not isinstance(name, str) or _ASSET.fullmatch(name) is None:
                raise ValueError('SDK LoadImage requires a staged content-hash PNG asset')
            path = self.assets_dir / name
            if not path.is_file() or path.is_symlink() or _file_hash(path) != name[:-4]:
                raise ValueError('SDK asset is missing or its content hash changed')
            if path not in seen and os.name == 'nt':
                leases.enter_context(ReadOnlyModelLease(path, name[:-4]))
                seen.add(path)
            assets.append({'node_id': node_id, 'input_name': 'image', 'path': str(path)})
        return assets

    @staticmethod
    def _read_receipt(path):
        try:
            if path.stat().st_size > 1024 * 1024:
                raise ValueError('oversized receipt')
            value = json.loads(path.read_text(encoding='utf-8'))
            if not isinstance(value, dict):
                raise ValueError('receipt is not an object')
            return value
        except (OSError, ValueError) as exc:
            return {'state': 'unavailable', 'error': f'Bridge receipt unavailable: {exc}'}

    @staticmethod
    def _stop(process, cancel_file):
        cancel_file.touch(exist_ok=True)
        if process.poll() is None:
            try:
                process.wait(timeout=.6)
            except subprocess.TimeoutExpired:
                process.terminate()
                try:
                    process.wait(timeout=.6)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=1)

    def execute(self, workflow, timeout=600, cancel=None, on_preview=None, on_event=None, on_submitted=None):
        if cancel and cancel.is_set():
            raise Canceled('Canceled before SDK submission')
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or not 0 < timeout <= 7200:
            raise ValueError('SDK timeout must be finite and within (0, 7200]')
        if self.fingerprint() != self._fingerprint:
            raise ValueError('SDK bridge/dependency fingerprint changed; restart the app')
        graph = deepcopy(workflow)
        if not isinstance(graph, dict) or not graph or any(not isinstance(node, dict) or not isinstance(node.get('inputs'), dict) for node in graph.values()):
            raise ValueError('SDK workflow must be a nonempty API graph')
        with ExitStack() as leases:
            assets = self._assets(graph, leases)
            if os.name == 'nt':
                leases.enter_context(ReadOnlyModelLease(self.bridge_path, self._fingerprint['bridge_sha256']))
                leases.enter_context(ReadOnlyModelLease(self.lock_path, self._fingerprint['requirements_lock_sha256']))
            directory = self.runtime_dir / 'jobs' / uuid.uuid4().hex
            output_dir = directory / 'outputs'
            output_dir.mkdir(parents=True, exist_ok=False)
            request_path, receipt_path, cancel_file = (directory / name for name in ('request.json', 'receipt.json', 'cancel'))
            request = {'workflow': graph, 'assets': assets, 'timeout_seconds': timeout,
                       'idempotency_key': str(uuid.uuid4()),
                       'output_nodes': [node for node, value in graph.items() if value.get('class_type') == 'SaveImage']}
            if not request['output_nodes']:
                raise ValueError('SDK workflow requires a SaveImage output')
            request_path.write_text(json.dumps(request, ensure_ascii=False, allow_nan=False), encoding='utf-8')
            if cancel and cancel.is_set():
                raise Canceled('Canceled before SDK submission')
            env = dict(os.environ)
            for key in ('COMFY_API_KEY', 'COMFY_BASE_URL', 'COMFY_ROUTER_BASE_URL'):
                env.pop(key, None)
            env.update(COMFY_BASE_URL='http://127.0.0.1:8189', COMFY_ROUTER_BASE_URL='http://127.0.0.1:8189',
                       NO_PROXY='127.0.0.1,localhost,::1', PYTHONIOENCODING='utf-8')
            command = [str(self.python_executable), '-u', str(self.bridge_path), '--request', str(request_path),
                       '--output-dir', str(output_dir), '--receipt', str(receipt_path), '--cancel-file', str(cancel_file)]
            started = time.perf_counter()
            process = subprocess.Popen(command, cwd=str(self.bridge_path.parent), env=env, stdin=subprocess.DEVNULL,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
            messages = queue.Queue()
            stderr_tail = bytearray()

            def read_stdout():
                try:
                    while line := process.stdout.readline(_MAX_LINE + 1):
                        if len(line) > _MAX_LINE:
                            messages.put(('reader_error', 'Bridge event exceeded the size limit'))
                            return
                        messages.put(('line', line))
                finally:
                    messages.put(('eof', None))

            def read_stderr():
                while chunk := process.stderr.read(4096):
                    stderr_tail.extend(chunk)
                    del stderr_tail[:-8192]

            readers = [threading.Thread(target=read_stdout, daemon=True), threading.Thread(target=read_stderr, daemon=True)]
            for reader in readers:
                reader.start()
            submitted = None
            complete = None
            bridge_error = None
            eof = False
            preview_count = preview_bytes = 0
            first_preview = None
            try:
                while not eof or process.poll() is None:
                    if cancel and cancel.is_set():
                        self._stop(process, cancel_file)
                        raise Canceled('SDK result discarded locally; GPU work may still finish')
                    if time.perf_counter() - started >= timeout:
                        self._stop(process, cancel_file)
                        receipt = self._read_receipt(receipt_path)
                        known = submitted or receipt.get('job_id')
                        error = ComfyError if known else SubmissionUncertain
                        raise error(f'SDK observation timed out; job {known or "unknown"} may still run. No resubmission. Receipt: {receipt_path}')
                    try:
                        kind, value = messages.get(timeout=.025)
                    except queue.Empty:
                        continue
                    if kind == 'eof':
                        eof = True
                        continue
                    if kind == 'reader_error':
                        raise ComfyError(value)
                    try:
                        event = json.loads(value)
                    except (ValueError, UnicodeDecodeError) as exc:
                        raise ComfyError('SDK bridge emitted invalid JSON') from exc
                    if not isinstance(event, dict):
                        raise ComfyError('SDK bridge event is not an object')
                    event_type = event.get('event')
                    if event_type == 'submitted':
                        job_id = event.get('job_id')
                        if not isinstance(job_id, str) or not job_id or (submitted and submitted != job_id):
                            raise ComfyError('SDK bridge emitted an invalid job id')
                        if submitted is None:
                            submitted = job_id
                            if on_submitted:
                                on_submitted(job_id)
                    elif event_type == 'preview':
                        try:
                            data = base64.b64decode(event['data_base64'], validate=True)
                            _image_check(data)
                        except (KeyError, ValueError, OSError) as exc:
                            raise ComfyError('SDK bridge emitted an invalid preview') from exc
                        preview_count += 1
                        preview_bytes += len(data)
                        if first_preview is None:
                            first_preview = time.perf_counter() - started
                        if on_preview and not (cancel and cancel.is_set()):
                            on_preview(data)
                    elif event_type == 'complete':
                        complete = event.get('receipt')
                    elif event_type == 'error':
                        bridge_error = str(event.get('message', 'SDK bridge failed'))
                    elif on_event and event_type in ('progress', 'status', 'stream_unavailable'):
                        if event_type == 'progress':
                            converted = {'type': 'progress', 'data': {'prompt_id': submitted, 'node': event.get('node_id'),
                                         'value': event.get('step', event.get('value')), 'max': event.get('steps')}}
                        else:
                            converted = {'type': 'sdk_' + event_type, 'data': dict(event, prompt_id=submitted)}
                        on_event(converted)
                receipt = self._read_receipt(receipt_path)
                known = submitted or receipt.get('job_id')
                if cancel and cancel.is_set() or receipt.get('state') == 'canceled_locally':
                    raise Canceled('SDK result discarded locally; GPU work may still finish')
                if process.returncode != 0 or receipt.get('state') != 'succeeded':
                    error = ComfyError if known else SubmissionUncertain
                    reason = bridge_error or receipt.get('error') or stderr_tail.decode('utf-8', 'replace')
                    raise error(f'SDK job {known or "unknown"} failed: {reason}. No resubmission. Receipt: {receipt_path}')
                if not isinstance(complete, dict) or complete != receipt or not known:
                    raise ComfyError('SDK bridge completion does not match its terminal receipt')
                records = receipt.get('outputs')
                if not isinstance(records, list) or len(records) != 1:
                    raise ComfyError('Expected exactly one successful SDK output image')
                record = records[0]
                path = Path(record.get('path', '')).resolve()
                if not path.is_relative_to(output_dir.resolve()) or not path.is_file() or path.stat().st_size > _MAX_IMAGE_BYTES:
                    raise ComfyError('SDK output path or size is invalid')
                data = path.read_bytes()
                if _hash(data) != record.get('sha256') or len(data) != record.get('bytes'):
                    raise ComfyError('SDK output hash or byte count mismatch')
                try:
                    _image_check(data)
                except (ValueError, OSError) as exc:
                    raise ComfyError('SDK output is not a valid single image') from exc
                for asset in assets:
                    if _file_hash(Path(asset['path'])) != Path(asset['path']).stem:
                        raise ComfyError('SDK input asset changed during execution')
                return data, {'transport': 'official-comfy-sdk', 'sdk_job_id': known, 'prompt_id': known,
                              'sdk_receipt': str(receipt_path), 'sdk_fingerprint': self._fingerprint,
                              'output': record, 'preview_received_count': preview_count,
                              'preview_received_bytes': preview_bytes, 'first_preview_s': first_preview,
                              'observe_s': time.perf_counter() - started,
                              'submit_to_download_s': time.perf_counter() - started,
                              'comfy_cached_nodes': [], 'node_wall_s': None, 'denoiser_executed': None,
                              'denoiser_execution_basis': 'SDK success does not attest native sampler cache/execution'}
            except ComfyError as exc:
                if not isinstance(exc, (Canceled, SubmissionUncertain)) and not submitted:
                    self._stop(process, cancel_file)
                    receipt = self._read_receipt(receipt_path)
                    if not receipt.get('job_id'):
                        raise SubmissionUncertain(f'{exc}. SDK submission status unknown; no resubmission. Receipt: {receipt_path}') from exc
                raise
            finally:
                if process.poll() is None:
                    self._stop(process, cancel_file)
                for reader in readers:
                    reader.join(timeout=1)
                process.stdout.close()
                process.stderr.close()

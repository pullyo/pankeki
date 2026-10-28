"""Loopback ComfyUI API. Submission is exactly once, observation is retryable."""
import json
import hashlib
import math
import subprocess
from pathlib import Path
import socket
import time
import uuid
from urllib import error, parse, request

from .metrics import EventMetrics
from .environment import server_signature


class ComfyError(RuntimeError):
    pass


class SubmissionUncertain(ComfyError):
    """Server may have queued this request; resubmission requires reconciliation."""


class Canceled(ComfyError):
    pass


def workflow_sha256(workflow):
    """Semantic JSON number identity for submission/queue/history ownership.

    Comfy may coerce cfg=5 to 5.0 in history. Only equal numeric values are
    normalized; booleans, strings, array order and all other graph data remain
    distinct. Previously persisted raw-JSON digests are never rewritten.
    """
    def numbers(value):
        if isinstance(value, float):
            if not math.isfinite(value):
                raise ValueError('Workflow ownership cannot hash NaN or infinity')
            return int(value) if value.is_integer() else value
        if isinstance(value, dict):
            if any(not isinstance(key,str) for key in value):
                raise ValueError('Workflow JSON object keys must be strings')
            return {key:numbers(item) for key,item in value.items()}
        if isinstance(value, (list, tuple)):
            return [numbers(item) for item in value]
        return value
    raw=json.dumps(numbers(workflow),sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()
    return hashlib.sha256(raw).hexdigest()


def normalize_origin(value):
    """Exact loopback origin. localhost/IPv4/IPv6 are distinct listener targets."""
    try:
        parsed = parse.urlsplit(value)
        port = parsed.port if parsed.port is not None else 80
        if (parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1','localhost','::1')
                or parsed.username is not None or parsed.password is not None
                or parsed.path not in ('','/') or parsed.query or parsed.fragment
                or not 1 <= port <= 65535):
            raise ValueError('Invalid loopback origin')
        host = '[::1]' if parsed.hostname == '::1' else parsed.hostname
        return f'http://{host}:{port}'
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError('Only exact local HTTP origins without credentials/path/query are supported') from exc


# Reviewed current vendor bytes: endpoint calls interrupt_if_running under the
# queue mutex, with the interrupt flag reset at the next prompt's entry.
# SHA256 of upstream ComfyUI 8f04fd6ecf4a548937971e840af2a985529fab76 with LF line endings.
# Files are hashed after CRLF->LF normalization so a Windows (autocrlf) checkout and a
# fresh macOS clone of the same commit attest identically; any other byte change still fails.
ATOMIC_CANCEL_SOURCE_PINS = {
    'server.py': '6e3614c753c95b037e57e25dfc2de979de70136baad2a3abb5d2d32aaf05281e',
    'execution.py': 'bf61eed32e9db0fe87ab8c108ea21adeb948e0596242c9cc55334de4a6e451a1',
    'comfy_execution/jobs.py': 'c4cacb27796ec2ab5704d4b594a4e5351a9747ccd04aa1e102d52d42261834c4',
}


def _process_token(pid):
    if type(pid) is not int or pid < 1:
        return None
    try:
        process = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'lstart='], capture_output=True,
                                 text=True, timeout=2, check=False)
        return process.stdout.strip() if process.returncode == 0 and process.stdout.strip() else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def _owns_listener(pid, port):
    if type(pid) is not int or type(port) is not int or not 1 <= port <= 65535:
        return False
    try:
        process = subprocess.run(['/usr/sbin/lsof', '-nP', '-a', '-p', str(pid), '-iTCP:' + str(port),
                                  '-sTCP:LISTEN', '-Fp'], capture_output=True, text=True, timeout=2, check=False)
        return process.returncode == 0 and ('p' + str(pid)) in process.stdout.splitlines()
    except (OSError, subprocess.TimeoutExpired):
        return False


def _atomic_sources(root):
    base = Path(root) / 'vendor/ComfyUI'
    values = {}
    for name in ATOMIC_CANCEL_SOURCE_PINS:
        path = base / name
        if path.is_symlink() or not path.is_file():
            raise ValueError('Atomic cancellation vendor source is missing or linked')
        values[name] = hashlib.sha256(path.read_bytes().replace(b'\r\n', b'\n')).hexdigest()
    return values


def attest_atomic_cancel(root, *, pid, port, server_identity, origin=None):
    """Launcher-only evidence for its own child. Does not start or mutate a server."""
    evidence = {'schema':1,'state':'unknown','pid':pid,'port':port,'server_identity':server_identity}
    try:
        origin = normalize_origin(origin or f'http://127.0.0.1:{port}')
        if parse.urlsplit(origin).port != port:
            raise ValueError('Attested origin does not match the owned listener port')
        sources = _atomic_sources(root)
        token = _process_token(pid)
        if sources != ATOMIC_CANCEL_SOURCE_PINS or not token or not _owns_listener(pid, port):
            raise ValueError('Pinned atomic source, owned process start or listener identity is unverified')
        if not isinstance(server_identity, str) or len(server_identity) != 64:
            raise ValueError('Server software identity unavailable')
        evidence.update(state='source_verified', source_hashes=sources, process_token=token, origin=origin,
                        reason='Owned launcher child and exact reviewed atomic cancellation source bytes verified; route probe pending')
    except (OSError, ValueError) as exc:
        evidence['reason'] = str(exc)[:1000]
    return evidence


def _listener_pid(port):
    process = subprocess.run(['/usr/sbin/lsof', '-nP', '-iTCP:' + str(port), '-sTCP:LISTEN', '-Fp'],
                             capture_output=True, text=True, timeout=2, check=False)
    pids = {int(line[1:]) for line in process.stdout.splitlines() if line[:1] == 'p' and line[1:].isdigit()}
    if process.returncode != 0 or len(pids) != 1:
        raise ValueError('Exactly one listener process is required')
    return pids.pop()


def _process_cwd(pid):
    process = subprocess.run(['/usr/sbin/lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'],
                             capture_output=True, text=True, timeout=2, check=False)
    names = [line[1:] for line in process.stdout.splitlines() if line[:1] == 'n']
    if process.returncode != 0 or len(names) != 1:
        raise ValueError('Listener working directory unavailable')
    return Path(names[0])


def _process_started(pid):
    process = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'lstart=,command='], capture_output=True, text=True,
                             timeout=2, check=False, env={'LC_ALL': 'C', 'LANG': 'C', 'PATH': '/usr/bin:/bin'})
    line = process.stdout.strip()
    if process.returncode != 0 or len(line) < 25:
        raise ValueError('Listener process start time unavailable')
    return time.mktime(time.strptime(' '.join(line[:24].split()), '%a %b %d %H:%M:%S %Y')), line[24:].strip()


def attest_atomic_cancel_listener(root, *, origin, server_identity):
    """Evidence for a ComfyUI listener this process did not start (the desktop app
    reuses or starts its own). Accepted only for this root's vendor/ComfyUI main.py
    started after the pinned files were last written, so its loaded code is the
    reviewed bytes; otherwise targeted cancel stays off."""
    try:
        origin = normalize_origin(origin)
        port = parse.urlsplit(origin).port
        pid = _listener_pid(port)
        vendor = (Path(root) / 'vendor/ComfyUI').resolve()
        if _process_cwd(pid).resolve() != vendor:
            raise ValueError('Listener does not run this project vendor ComfyUI')
        started, command = _process_started(pid)
        if ' main.py' not in ' ' + command:
            raise ValueError('Listener is not ComfyUI main.py')
        if max((vendor / name).stat().st_mtime for name in ATOMIC_CANCEL_SOURCE_PINS) >= started:
            raise ValueError('Pinned source changed after the listener started')
    except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
        return {'schema':1,'state':'unknown','reason':str(exc)[:1000]}
    return attest_atomic_cancel(root, pid=pid, port=port, server_identity=server_identity, origin=origin)


def validate_atomic_attestation(root, evidence, *, base_url=None):
    if not isinstance(evidence, dict) or evidence.get('schema') != 1 or evidence.get('state') != 'source_verified':
        return False
    try:
        actual = normalize_origin(base_url)
        attested = normalize_origin(evidence.get('origin'))
        return (evidence.get('origin') == attested == actual
                and parse.urlsplit(actual).port == evidence.get('port')
                and evidence.get('source_hashes') == ATOMIC_CANCEL_SOURCE_PINS == _atomic_sources(root)
                and isinstance(evidence.get('process_token'), str) and bool(evidence['process_token'])
                and evidence['process_token'] == _process_token(evidence.get('pid'))
                and _owns_listener(evidence.get('pid'), evidence.get('port')))
    except (OSError, ValueError):
        return False


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ComfyError('ComfyUI redirects are not allowed for loopback-only connections')


class ComfyClient:
    def __init__(self, base_url='http://127.0.0.1:8188', request_timeout=15):
        self.base_url = normalize_origin(base_url)
        self.request_timeout = request_timeout
        self.opener = request.build_opener(request.ProxyHandler({}), NoRedirect())
        self.targeted_cancel_capability = {'state': 'unknown', 'atomic_source_verified': False,
            'route_verified': False, 'reason': 'Atomic source and actual jobs route not verified for this server'}
        self.atomic_cancel_guard = None
        self.cancel_observe_timeout = 2.0

    def _request(self, path, data=None, content_type='application/json'):
        req = request.Request(self.base_url + path, data=data,
                              headers={'Content-Type': content_type} if data is not None else {})
        try:
            with self.opener.open(req, timeout=self.request_timeout) as response:
                return response.read()
        except error.HTTPError as exc:
            raw = exc.read().decode('utf-8', 'replace')[:4000]
            failure = ComfyError(f'ComfyUI HTTP {exc.code}: {raw}')
            failure.status_code = exc.code
            failure.content_type = exc.headers.get_content_type()
            try:
                failure.json_body = json.loads(raw)
            except ValueError:
                failure.json_body = None
            raise failure from exc

    def get(self, path):
        return json.loads(self._request(path))

    def submit(self, workflow, client_id):
        try:
            response = json.loads(self._request('/prompt', json.dumps({'prompt': workflow, 'client_id': client_id}).encode()))
        except ComfyError as exc:
            if getattr(exc, 'status_code', 0) >= 500 or getattr(exc, 'status_code', 0) == 408:
                raise SubmissionUncertain('Submission server response is uncertain; no automatic retry') from exc
            raise
        except Exception as exc:
            raise SubmissionUncertain('Submission response lost. It may still be queued; no automatic retry. Inspect ComfyUI queue/history.') from exc
        if isinstance(response, dict) and response.get('error'):
            raise ComfyError(f'ComfyUI rejected workflow: {response}')
        if not isinstance(response, dict) or not isinstance(response.get('prompt_id'), str) or not response['prompt_id']:
            raise SubmissionUncertain('Submission acknowledgement has no valid prompt ID; no automatic retry')
        return response['prompt_id']

    @staticmethod
    def _owned(row, client_id, digest, prompt_id=None):
        return (isinstance(client_id, str) and bool(client_id)
                and isinstance(digest, str) and len(digest) == 64
                and isinstance(row, (list, tuple)) and len(row) >= 4
                and isinstance(row[1], str) and (prompt_id is None or row[1] == prompt_id)
                and isinstance(row[2], dict) and isinstance(row[3], dict)
                and row[3].get('client_id') == client_id and workflow_sha256(row[2]) == digest)

    def reconcile_submission(self, client_id, workflow_digest):
        """Scan supported queue/history metadata; a zero match never permits retry."""
        try:
            queued, history = self.get('/queue'), self.get('/history')
            if (not isinstance(queued, dict) or not isinstance(history, dict)
                    or not all(isinstance(queued.get(k), list) for k in ('queue_running', 'queue_pending'))):
                raise ValueError('Invalid Comfy queue/history shape')
            matches = {}
            for location in ('queue_running', 'queue_pending'):
                for row in queued[location]:
                    if self._owned(row, client_id, workflow_digest):
                        matches[row[1]] = location
            for prompt_id, entry in history.items():
                if isinstance(entry, dict) and self._owned(entry.get('prompt'), client_id, workflow_digest, prompt_id):
                    matches[prompt_id] = 'history'
            if len(matches) == 1:
                prompt_id, location = next(iter(matches.items()))
                return {'state': 'found', 'prompt_id': prompt_id, 'location': location}
            return {'state': 'ambiguous' if matches else 'not_found', 'prompt_id': None, 'location': None}
        except (OSError, ValueError, TypeError, ComfyError) as exc:
            return {'state': 'unavailable', 'prompt_id': None, 'location': None, 'reason': str(exc)[:1000]}

    def _server_identity(self):
        value = self.get('/system_stats')
        system = value.get('system') if isinstance(value, dict) else None
        if not isinstance(system, dict) or not system.get('comfyui_version'):
            raise ValueError('Server software identity unavailable')
        return server_signature(system)

    def verify_targeted_cancel(self, known_prompt_id, *, expected_server_identity=None, atomic_source_verified=False):
        """Read-only verification. Route presence alone cannot establish atomicity."""
        capability = {'state': 'unknown', 'atomic_source_verified': bool(atomic_source_verified),
                      'route_verified': False, 'server_identity': None}
        try:
            if not atomic_source_verified or not expected_server_identity:
                raise ValueError('Root-verified atomic source and expected server identity required')
            identity = self._server_identity()
            if identity != expected_server_identity:
                raise ValueError('Server software identity mismatch')
            try:
                self.get('/api/jobs/' + str(uuid.uuid4()))
                raise ValueError('Unknown jobs probe unexpectedly succeeded')
            except ComfyError as exc:
                if (getattr(exc, 'status_code', None) != 404 or getattr(exc, 'json_body', None) != {'error': 'Job not found'}
                        or getattr(exc, 'content_type', None) != 'application/json'):
                    raise ValueError('Jobs route did not return the supported structured JSON404') from exc
            known = self.get('/api/jobs/' + parse.quote(known_prompt_id, safe=''))
            if (not isinstance(known, dict) or known.get('id') != known_prompt_id
                    or known.get('status') not in ('pending', 'in_progress', 'completed', 'failed', 'cancelled')):
                raise ValueError('Known jobs route shape/identity mismatch')
            capability.update(state='verified', route_verified=True, server_identity=identity,
                              reason='Atomic source attested by root; actual JSON404/known jobs route and software identity checked')
        except (OSError, ValueError, TypeError, ComfyError) as exc:
            capability['reason'] = str(exc)[:1000]
        self.targeted_cancel_capability = capability
        return dict(capability)

    @staticmethod
    def _interrupted(history, prompt_id, client_id, digest):
        entry = history.get(prompt_id) if isinstance(history, dict) else None
        if not isinstance(entry, dict) or not ComfyClient._owned(entry.get('prompt'), client_id, digest, prompt_id):
            return False
        status = entry.get('status')
        if not isinstance(status, dict) or not isinstance(status.get('messages', []), list):
            return False
        messages = status.get('messages', [])
        return any(isinstance(message, (list, tuple)) and len(message) == 2 and message[0] == 'execution_interrupted'
                   and isinstance(message[1], dict) and message[1].get('prompt_id', prompt_id) == prompt_id for message in messages)

    def cancel_owned(self, prompt_id, client_id, workflow_digest):
        """Cancel an exactly owned prompt through verified facilities only.

        Pending IDs may be deleted and observed. Running interruption requires
        the verified atomic jobs route; otherwise keep local-discard semantics.
        The legacy global /interrupt route is never used.
        """
        try:
            before = self.get('/queue')
            if not isinstance(before, dict) or not all(isinstance(before.get(k), list) for k in ('queue_running', 'queue_pending')):
                raise ValueError('Invalid queue shape')
            if any(self._owned(row, client_id, workflow_digest, prompt_id) for row in before['queue_running']):
                capability = self.targeted_cancel_capability
                if (capability.get('state') != 'verified' or not capability.get('atomic_source_verified')
                        or (self.atomic_cancel_guard is not None and not self.atomic_cancel_guard())
                        or self._server_identity() != capability.get('server_identity')):
                    return {'state': 'local_only', 'reason': 'No verified atomic targeted running interrupt; result discarded locally'}
                response = json.loads(self._request('/api/jobs/' + parse.quote(prompt_id, safe='') + '/cancel', b'{}'))
                after, history = self.get('/queue'), self.get('/history')
                # The interrupt lands a moment after the route answers; watch history briefly
                # so a real stop is recorded as confirmed rather than merely requested.
                deadline = time.monotonic() + self.cancel_observe_timeout
                while (isinstance(response, dict) and response.get('cancelled') is True and time.monotonic() < deadline
                       and not self._interrupted(history, prompt_id, client_id, workflow_digest)):
                    time.sleep(.1)
                    history = self.get('/history')
                if self._interrupted(history, prompt_id, client_id, workflow_digest):
                    return {'state': 'confirmed', 'reason': 'Owned prompt history reports execution_interrupted'}
                if isinstance(response, dict) and response.get('cancelled') is True:
                    return {'state': 'requested', 'reason': 'Targeted cancellation dispatched; physical interruption not yet observed'}
                return {'state': 'unconfirmed', 'reason': 'Targeted cancellation was a no-op or not acknowledged; result discarded locally'}
            if not any(self._owned(row, client_id, workflow_digest, prompt_id) for row in before['queue_pending']):
                return {'state': 'unconfirmed', 'reason': 'Owned queued prompt not observed'}
            self._request('/queue', json.dumps({'delete': [prompt_id]}).encode())
            after = self.get('/queue')
            if not isinstance(after, dict) or not all(isinstance(after.get(k), list) for k in ('queue_running', 'queue_pending')):
                raise ValueError('Invalid cancellation observation')
            if any(isinstance(row, (list, tuple)) and len(row) > 1 and row[1] == prompt_id
                   for key in ('queue_running', 'queue_pending') for row in after[key]):
                return {'state': 'unconfirmed', 'reason': 'Prompt remains queued or began running during cancellation'}
            history = self.get('/history')
            if not isinstance(history, dict):
                raise ValueError('Invalid history observation')
            if prompt_id in history:
                return {'state': 'unconfirmed', 'reason': 'Prompt entered history; deletion did not establish cancellation'}
            return {'state': 'confirmed', 'reason': 'Owned pending ID deletion acknowledged and absent from queue/history'}
        except (OSError, ValueError, TypeError, ComfyError) as exc:
            return {'state': 'unconfirmed', 'reason': str(exc)[:1000]}

    def upload_png(self, data, name):
        boundary = 'Pankeki' + uuid.uuid4().hex
        # Caller supplies a content hash basename; never relay user file paths.
        if not name.endswith('.png') or not name[:-4].isalnum():
            raise ValueError('Invalid upload name')
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\nContent-Type: image/png\r\n\r\n'.encode()
                + data + f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\nfalse\r\n--{boundary}--\r\n'.encode())
        value = json.loads(self._request('/upload/image', body, f'multipart/form-data; boundary={boundary}'))
        return (value.get('subfolder', '').strip('/') + '/' + value['name']).lstrip('/')

    @staticmethod
    def check_history(entry):
        status = entry.get('status', {})
        messages = status.get('messages', [])
        for kind, data in messages:
            if kind in ('execution_error', 'execution_interrupted'):
                raise ComfyError(data.get('exception_message', kind))
        if status.get('status_str') == 'error':
            raise ComfyError(f'ComfyUI execution failed: {messages}')
        return status.get('completed', False) and status.get('status_str') == 'success'

    def _connect_ws(self, client_id):
        try:
            import websocket
            return websocket.create_connection(self.base_url.replace('http:', 'ws:', 1) + '/ws?clientId=' + client_id,
                                               timeout=.25, http_proxy_host=None, suppress_origin=True)
        except Exception:
            return None

    def wait(self, prompt_id, timeout=600, cancel=None, ws=None, client_id=None, on_preview=None, on_event=None):
        started = time.perf_counter()
        metrics = EventMetrics(prompt_id)
        last_history = 0
        last_reconnect = started
        preview_count = preview_bytes = 0
        first_preview = None
        last_error = None
        entry = None
        try:
            while time.perf_counter() - started < timeout:
                if cancel and cancel.is_set():
                    raise Canceled('Result ignored locally; ComfyUI may still finish. No global interrupt sent.')
                now = time.perf_counter()
                if now - last_history >= .25:
                    last_history = now
                    try:
                        entry = self.get('/history/' + parse.quote(prompt_id, safe='')).get(prompt_id)
                        if entry and self.check_history(entry):
                            break
                    except ComfyError:
                        raise
                    except (OSError, ValueError) as exc:
                        last_error = str(exc)
                if ws is not None:
                    try:
                        message = ws.recv()
                        if isinstance(message, bytes):
                            # Comfy PREVIEW_IMAGE: uint32 event, uint32 format, JPEG/PNG bytes.
                            if len(message) > 8 and int.from_bytes(message[:4], 'big') == 1:
                                preview_count += 1
                                preview_bytes += len(message)
                                first_preview = first_preview if first_preview is not None else now - started
                                if on_preview:
                                    on_preview(message[8:])
                        elif message:
                            event = json.loads(message)
                            if metrics.feed(event) and on_event:
                                on_event(event)
                        else:
                            ws.close()
                            ws = None
                    except Exception as exc:
                        # Socket timeout is expected. History remains the completion authority.
                        if not isinstance(exc, socket.timeout) and type(exc).__name__ != 'WebSocketTimeoutException':
                            ws.close()
                            ws = None
                            last_error = str(exc)
                else:
                    if client_id and now - last_reconnect > 2:
                        last_reconnect = now
                        ws = self._connect_ws(client_id)
                    time.sleep(.05)
            else:
                raise ComfyError(f'Timed out observing prompt {prompt_id}; it may still run. No resubmission. Last connection error: {last_error}')
        finally:
            if ws is not None:
                ws.close()
        observations = metrics.result()
        observations.update({'observe_s': time.perf_counter() - started,
                             'preview_received_count': preview_count, 'preview_received_bytes': preview_bytes,
                             'first_preview_s': first_preview, 'last_connection_error': last_error})
        # History includes authoritative timestamps even when WebSocket was unavailable.
        observations['history_messages'] = entry.get('status', {}).get('messages', [])
        history_times = {}
        for kind, data in observations['history_messages']:
            if kind == 'execution_cached':
                observations['comfy_cached_nodes'] = data.get('nodes', [])
            if 'timestamp' in data:
                history_times[kind] = data['timestamp']
        observations['server_service_s'] = ((history_times['execution_success'] - history_times['execution_start']) / 1000
            if 'execution_success' in history_times and 'execution_start' in history_times else None)
        observations['denoiser_executed'] = '5' not in observations['comfy_cached_nodes']
        observations['denoiser_execution_basis'] = 'built-in workflow sampler node 5 and history execution_cached'
        return entry, observations

    def execute(self, workflow, timeout=600, cancel=None, on_preview=None, on_event=None, on_submitted=None, on_submitting=None, on_cancelled=None):
        if cancel and cancel.is_set():
            raise Canceled('Canceled before submission')
        client_id = uuid.uuid4().hex
        digest = workflow_sha256(workflow)
        if on_submitting:
            # A failed durable write must prevent POST, not merely lose telemetry.
            on_submitting(client_id, digest)
        ws = self._connect_ws(client_id)
        start = time.perf_counter()
        try:
            if cancel and cancel.is_set():
                raise Canceled('Canceled before submission')
            try:
                prompt_id = self.submit(workflow, client_id)
            except SubmissionUncertain as exc:
                reconciliation = self.reconcile_submission(client_id, digest)
                if reconciliation['state'] != 'found':
                    raise SubmissionUncertain(f'{exc} Reconciliation: {reconciliation["state"]}; no automatic retry.') from exc
                prompt_id = reconciliation['prompt_id']
        except BaseException:
            if ws is not None:
                ws.close()
            raise
        if on_submitted:
            on_submitted(prompt_id)
        try:
            history, metrics = self.wait(prompt_id, timeout, cancel, ws, client_id, on_preview, on_event)
        except Canceled as exc:
            outcome = self.cancel_owned(prompt_id, client_id, digest)
            if on_cancelled:
                on_cancelled(outcome)
            if outcome.get('state') == 'confirmed':
                raise Canceled('Canceled; ComfyUI confirmed: ' + outcome['reason']) from exc
            raise
        images = [image for output in history.get('outputs', {}).values() for image in output.get('images', []) if image.get('type') == 'output']
        if len(images) != 1:
            raise ComfyError(f'Expected one completed output image, received {len(images)}')
        image = images[0]
        data = self._request('/view?' + parse.urlencode(image))
        metrics['submit_to_download_s'] = time.perf_counter() - start
        return data, {'prompt_id': prompt_id, 'client_id': client_id, 'workflow_sha256': digest, 'output': image, **metrics}

"""Loopback ComfyUI API. Submission is exactly once, observation is retryable."""
import json
import socket
import time
import uuid
from urllib import error, parse, request

from .metrics import EventMetrics


class ComfyError(RuntimeError):
    pass


class SubmissionUncertain(ComfyError):
    """Server may have queued this request; resubmission requires reconciliation."""


class Canceled(ComfyError):
    pass


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ComfyError('ComfyUI redirects are not allowed for loopback-only connections')


class ComfyClient:
    def __init__(self, base_url='http://127.0.0.1:8188', request_timeout=15):
        parsed = parse.urlsplit(base_url)
        if parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost', '::1') or parsed.username or parsed.path not in ('', '/'):
            raise ValueError('Only local HTTP ComfyUI servers are supported')
        self.base_url = base_url.rstrip('/')
        self.request_timeout = request_timeout
        self.opener = request.build_opener(request.ProxyHandler({}), NoRedirect())

    def _request(self, path, data=None, content_type='application/json'):
        req = request.Request(self.base_url + path, data=data,
                              headers={'Content-Type': content_type} if data is not None else {})
        try:
            with self.opener.open(req, timeout=self.request_timeout) as response:
                return response.read()
        except error.HTTPError as exc:
            raise ComfyError(f'ComfyUI HTTP {exc.code}: {exc.read().decode("utf-8", "replace")[:4000]}') from exc

    def get(self, path):
        return json.loads(self._request(path))

    def submit(self, workflow, client_id):
        try:
            response = json.loads(self._request('/prompt', json.dumps({'prompt': workflow, 'client_id': client_id}).encode()))
        except ComfyError:
            raise
        except Exception as exc:
            raise SubmissionUncertain('Submission response lost. It may still be queued; no automatic retry. Inspect ComfyUI queue/history.') from exc
        if not response.get('prompt_id'):
            raise ComfyError(f'ComfyUI rejected workflow: {response}')
        return response['prompt_id']

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

    def execute(self, workflow, timeout=600, cancel=None, on_preview=None, on_event=None, on_submitted=None):
        if cancel and cancel.is_set():
            raise Canceled('Canceled before submission')
        client_id = uuid.uuid4().hex
        ws = self._connect_ws(client_id)
        start = time.perf_counter()
        try:
            if cancel and cancel.is_set():
                raise Canceled('Canceled before submission')
            prompt_id = self.submit(workflow, client_id)
        except BaseException:
            if ws is not None:
                ws.close()
            raise
        if on_submitted:
            on_submitted(prompt_id)
        history, metrics = self.wait(prompt_id, timeout, cancel, ws, client_id, on_preview, on_event)
        images = [image for output in history.get('outputs', {}).values() for image in output.get('images', []) if image.get('type') == 'output']
        if len(images) != 1:
            raise ComfyError(f'Expected one completed output image, received {len(images)}')
        image = images[0]
        data = self._request('/view?' + parse.urlencode(image))
        metrics['submit_to_download_s'] = time.perf_counter() - start
        return data, {'prompt_id': prompt_id, 'output': image, **metrics}

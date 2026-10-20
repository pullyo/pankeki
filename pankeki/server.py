"""Loopback-only local UI with bounded JSON input and same-origin mutations."""
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from .engine import Engine
from .jobs import JobManager


def make_server(root, port=8190, comfy_url='http://127.0.0.1:8188', config=None):
    root = Path(root)
    engine = Engine(root, comfy_url, config)
    manager = JobManager(engine)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            pass

        def send(self, status, data, content_type='application/json'):
            if isinstance(data, (dict, list)):
                data = json.dumps(data, ensure_ascii=False).encode()
            elif isinstance(data, str):
                data = data.encode()
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(data)

        def guard(self, mutation=False):
            hosts = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
            if self.headers.get('Host') not in hosts:
                raise ValueError('Invalid Host')
            origin = self.headers.get('Origin')
            if origin and origin not in {'http://' + host for host in hosts}:
                raise ValueError('Cross-origin request rejected')
            if mutation and self.headers.get_content_type() != 'application/json':
                raise ValueError('JSON content type required')

        def do_GET(self):
            try:
                self.guard()
                path = urlsplit(self.path).path
                if path == '/':
                    return self.send(200, (root / 'web' / 'index.html').read_bytes(), 'text/html; charset=utf-8')
                if path == '/api/models':
                    return self.send(200, engine.models_info())
                if path == '/api/health':
                    try:
                        health_check = getattr(engine.client, 'health', None)
                        status = health_check() if health_check else engine.client.get('/system_stats')
                        default_id = engine.models_info()['default_model_id']
                        default_model = engine.models.get(default_id, engine.config)
                        return self.send(200, {'comfy': True, 'system': status, 'cache': engine.cache.stats(), 'managed': engine.config.get('managed_builtin_only', False), 'transport': engine.config.get('transport', 'direct'), 'model_name': default_model.get('model_name'), 'default_model_id': default_id})
                    except Exception as exc:
                        return self.send(200, {'comfy': False, 'error': str(exc), 'cache': engine.cache.stats()})
                match = re.fullmatch(r'/api/(jobs|previews|results)/([0-9a-f]{32})', path)
                if match:
                    kind, job_id = match.groups()
                    if kind == 'jobs':
                        return self.send(200, manager.get(job_id))
                    if kind == 'previews':
                        data = manager.get_preview(job_id)
                        if data:
                            return self.send(200, data, 'image/png' if data.startswith(b'\x89PNG') else 'image/jpeg')
                    if kind == 'results':
                        item = manager.get(job_id)
                        if item['state'] == 'succeeded':
                            return self.send(200, (engine.runs / job_id / 'result.png').read_bytes(), 'image/png')
                return self.send(404, {'error': 'Not found'})
            except KeyError:
                self.send(404, {'error': 'Unknown job'})
            except (ValueError, OSError) as exc:
                self.send(400, {'error': str(exc)})

        def do_POST(self):
            try:
                length = int(self.headers.get('Content-Length', 0))
                if not 0 < length <= 32 * 1024 * 1024:
                    raise ValueError('Request body must be <= 32 MiB')
                # Drain only a valid bounded body before rejecting Host/Origin/
                # Content-Type. Closing with unread incoming bytes can reset the
                # connection on Windows and discard our JSON error response.
                previous_timeout = self.connection.gettimeout()
                self.connection.settimeout(15)
                try:
                    raw_body = self.rfile.read(length)
                finally:
                    self.connection.settimeout(previous_timeout)
                if len(raw_body) != length:
                    raise ValueError('Request body ended before Content-Length')
                self.guard(mutation=True)
                body = json.loads(raw_body)
                if not isinstance(body, dict):
                    raise ValueError('Expected JSON object')
                if self.path == '/api/jobs':
                    recipe = engine.validate_request(body['request'])
                    return self.send(202, manager.submit(body['session'], recipe))
                match = re.fullmatch(r'/api/jobs/([0-9a-f]{32})/cancel', self.path)
                if match:
                    return self.send(200, manager.cancel(match[1]))
                if self.path == '/api/cache/clear':
                    engine.cache.clear()
                    return self.send(200, engine.cache.stats())
                self.send(404, {'error': 'Not found'})
            except (KeyError, ValueError, TypeError, OSError) as exc:
                self.send(400, {'error': str(exc)})

    try:
        server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    except BaseException:
        manager.close()
        engine.close()
        raise
    server.manager = manager
    server.engine = engine
    return server

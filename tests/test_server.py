"""Real loopback HTTP tests; controlled runners do not perform GPU inference."""
import base64
import hashlib
import http.client
import io
import json
from pathlib import Path
import socket
import struct
import tempfile
import threading
import unittest
from unittest.mock import patch
import zlib

from PIL import Image, ImageOps

from pankeki.server import make_server


def png(image):
    stream = io.BytesIO()
    image.save(stream, format='PNG')
    return stream.getvalue()


def image64(image):
    return base64.b64encode(png(image)).decode('ascii')


class NoNetworkClient:
    def __init__(self):
        self.calls = 0

    def get(self, path):
        self.calls += 1
        raise AssertionError('Offline test must not contact ComfyUI')


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'web').mkdir()
        (self.root / 'web' / 'index.html').write_text('<title>fixture</title>', encoding='utf-8')
        self.server = make_server(self.root, port=0)
        self.client = NoNetworkClient()
        self.server.engine.client = self.client
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': .02}, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.server.manager.close()
        self.server.engine.close()
        self.thread.join(timeout=2)
        self.temp.cleanup()

    def request(self, method, path, value=None, *, raw=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        body = json.dumps(value).encode() if raw is None and value is not None else raw
        merged = {'Content-Type': 'application/json', **(headers or {})}
        try:
            connection.request(method, path, body=body, headers=merged)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def submit(self, request=None, session='http-tests'):
        status, _, data = self.request('POST', '/api/jobs', {'session': session, 'request': request or {}})
        self.assertEqual(status, 202, data)
        return json.loads(data)

    def wait(self, job):
        return self.server.manager.wait(job['job_id'], timeout=3)

    def get_job(self, job):
        code, _, body = self.request('GET', '/api/jobs/' + job['job_id'])
        self.assertEqual(code, 200, body)
        return json.loads(body)

    def test_page_and_unknown_job_response_headers(self):
        code, headers, data = self.request('GET', '/')
        self.assertEqual(code, 200)
        self.assertIn(b'<title>fixture</title>', data)
        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertEqual(self.request('GET', '/api/jobs/' + '0' * 32)[0], 404)
        self.assertEqual(self.request('GET', '/api/results/../../outside')[0], 404)

    def test_mutations_reject_cross_origin_wrong_host_and_content_type(self):
        for headers in ({'Origin': 'https://example.invalid'}, {'Host': 'attacker.invalid'},
                        {'Content-Type': 'text/plain'}, {'Origin': 'null'}):
            with self.subTest(headers=headers):
                status, _, body = self.request('POST', '/api/jobs', {'session': 's', 'request': {}}, headers=headers)
                self.assertEqual(status, 400, body)
                self.assertIn('error', json.loads(body))
        self.assertEqual(len(self.server.manager.jobs), 0)

    def test_rejected_post_consumes_bounded_declared_body_before_reply(self):
        body = b'{"session":"s","request":{}}'
        request_headers = (f'POST /api/jobs HTTP/1.1\r\nHost: 127.0.0.1:{self.server.server_port}\r\n'
                           f'Content-Type: text/plain\r\nContent-Length: {len(body)}\r\n\r\n').encode('ascii')
        with socket.create_connection(('127.0.0.1', self.server.server_port), timeout=2) as connection:
            connection.sendall(request_headers)
            connection.settimeout(.1)
            # Closing while the declared body is still in flight may turn an
            # HTTP 400 into TCP RST on Windows. Wait for the bounded body first.
            with self.assertRaises(TimeoutError):
                connection.recv(1)
            connection.sendall(body)
            connection.settimeout(2)
            response = http.client.HTTPResponse(connection)
            response.begin()
            self.assertEqual(response.status, 400)
            self.assertIn('JSON content type', json.loads(response.read())['error'])
        self.assertEqual(len(self.server.manager.jobs), 0)

    def test_malformed_json_images_and_dimensions_are_http_errors(self):
        source = image64(Image.new('RGB', (64, 64)))
        valid = {'mode': 'inpaint', 'source': source, 'mask': image64(Image.new('L', (64, 64)))}
        cases = [
            {}, {'session': 's', 'request': None},
            {'session': 's', 'request': {**valid, 'source': 'not base64!'}},
            {'session': 's', 'request': {**valid, 'source': base64.b64encode(b'not an image').decode()}},
            {'session': 's', 'request': {**valid, 'mask': image64(Image.new('L', (63, 64)))}},
            {'session': [], 'request': {}},
        ]
        for body in cases:
            with self.subTest(body=str(body)[:100]):
                status, _, data = self.request('POST', '/api/jobs', body)
                self.assertEqual(status, 400, data)
                self.assertTrue(json.loads(data)['error'])
        self.assertEqual(self.request('POST', '/api/jobs', raw=b'{')[0], 400)
        self.assertEqual(len(self.server.manager.jobs), 0)

    def test_oversized_png_header_returns_json_error_instead_of_connection_drop(self):
        data = bytearray(png(Image.new('L', (1, 1))))
        # Change only IHDR dimensions and CRC. Pillow detects the decompression
        # bomb before decoding IDAT; there is no huge allocation in this test.
        data[16:24] = struct.pack('>II', 65536, 65536)
        data[29:33] = struct.pack('>I', zlib.crc32(data[12:29]) & 0xffffffff)
        request = {'mode': 'inpaint', 'source': base64.b64encode(data).decode(),
                   'mask': image64(Image.new('L', (1, 1)))}
        status, headers, body = self.request('POST', '/api/jobs', {'session': 's', 'request': request})
        self.assertEqual(status, 400, body)
        self.assertEqual(headers['Content-Type'], 'application/json')
        self.assertTrue(json.loads(body)['error'])

    def test_empty_mask_runs_offline_and_result_pixels_match_original(self):
        source = Image.new('RGB', (77, 53), (23, 45, 67))
        source.putpixel((76, 52), (123, 99, 7))
        job = self.submit({'mode': 'inpaint', 'source': image64(source),
                           'mask': image64(Image.new('L', source.size))})
        completed = self.wait(job)
        self.assertEqual(completed['state'], 'succeeded', completed['error'])
        self.assertEqual(self.get_job(job)['result']['metrics']['cache'], 'empty-mask-skip')
        self.assertEqual(self.client.calls, 0)
        status, headers, data = self.request('GET', '/api/results/' + job['job_id'])
        self.assertEqual(status, 200)
        self.assertEqual(headers['Content-Type'], 'image/png')
        with Image.open(io.BytesIO(data)) as result:
            self.assertEqual(result.size, source.size)
            self.assertEqual(result.tobytes(), source.tobytes())

    def test_empty_mask_preserves_transparent_source_alpha_through_http(self):
        source = Image.new('RGBA', (64, 64), (20, 30, 40, 255))
        source.putpixel((0, 0), (20, 30, 40, 0))
        request = {'mode': 'inpaint', 'source': image64(source),
                   'mask': image64(Image.new('L', source.size))}
        job = self.submit(request)
        completed = self.wait(job)
        self.assertEqual(completed['state'], 'succeeded', completed['error'])
        status, _, body = self.request('GET', '/api/results/' + job['job_id'])
        self.assertEqual(status, 200, body)
        with Image.open(io.BytesIO(body)) as result:
            self.assertEqual(result.mode, 'RGBA')
            self.assertEqual(result.tobytes(), source.tobytes())

    def test_exif_rotated_jpeg_uses_display_orientation_for_mask_coordinates(self):
        original = Image.new('RGB', (64, 96), (17, 29, 41))
        original.paste((255, 0, 0), (0, 0, 10, 20))
        exif = Image.Exif()
        exif[274] = 6  # Stored 64x96, browser displays rotated 96x64.
        buffer = io.BytesIO()
        original.save(buffer, format='JPEG', quality=95, exif=exif)
        data = buffer.getvalue()
        with Image.open(io.BytesIO(data)) as stored:
            expected = ImageOps.exif_transpose(stored).convert('RGB')
        job = self.submit({'mode': 'inpaint', 'source': base64.b64encode(data).decode(),
                           'mask': image64(Image.new('L', (96, 64)))})
        completed = self.wait(job)
        self.assertEqual(completed['state'], 'succeeded', completed['error'])
        status, _, body = self.request('GET', '/api/results/' + job['job_id'])
        self.assertEqual(status, 200, body)
        with Image.open(io.BytesIO(body)) as output:
            self.assertEqual(output.size, (96, 64))
            self.assertEqual(output.tobytes(), expected.tobytes())

    def write_fixture_result(self, job):
        directory = self.server.engine.runs / job.job_id
        directory.mkdir(exist_ok=True)
        (directory / 'result.png').write_bytes(png(Image.new('RGB', (64, 64), 'red')))
        return {'image_url': '/api/results/' + job.job_id, 'metrics': {}}

    def test_new_revision_hides_old_preview_and_denies_canceled_result(self):
        started, release = threading.Event(), threading.Event()

        def runner(job, on_preview):
            result = self.write_fixture_result(job)
            on_preview(png(Image.new('RGB', (64, 64), 'blue')))
            if job.revision == 1:
                started.set()
                if not release.wait(3):
                    raise TimeoutError('test runner release missing')
            return result

        self.server.manager.runner = runner
        first = self.submit()
        try:
            self.assertTrue(started.wait(3))
            self.assertEqual(self.request('GET', '/api/previews/' + first['job_id'])[0], 200)
            self.assertEqual(self.request('GET', '/api/results/' + first['job_id'])[0], 404)
            second = self.submit()
            self.assertEqual(second['revision'], 2)
            self.assertFalse(self.get_job(first)['is_current'])
            self.assertEqual(self.request('GET', '/api/previews/' + first['job_id'])[0], 404)
        finally:
            release.set()
        self.assertEqual(self.wait(first)['state'], 'canceled')
        self.assertEqual(self.wait(second)['state'], 'succeeded')
        self.assertEqual(self.request('GET', '/api/results/' + first['job_id'])[0], 404)
        self.assertEqual(self.request('GET', '/api/results/' + second['job_id'])[0], 200)

    def test_explicit_cancel_is_logical_discard_and_result_is_unavailable(self):
        started = threading.Event()

        def runner(job, on_preview):
            self.write_fixture_result(job)
            started.set()
            if not job.cancel.wait(3):
                raise TimeoutError('cancel flag not delivered')
            return {'image_url': '/api/results/' + job.job_id}

        self.server.manager.runner = runner
        job = self.submit()
        self.assertTrue(started.wait(3))
        status, _, body = self.request('POST', '/api/jobs/' + job['job_id'] + '/cancel', {})
        self.assertEqual(status, 200, body)
        self.assertIn(json.loads(body)['state'], ('canceling', 'canceled'))
        self.assertEqual(self.wait(job)['state'], 'canceled')
        self.assertIsNone(self.get_job(job)['result'])
        self.assertEqual(self.request('GET', '/api/results/' + job['job_id'])[0], 404)

    def test_failed_job_does_not_expose_written_result(self):
        def runner(job, on_preview):
            self.write_fixture_result(job)
            raise ValueError('controlled failure')

        self.server.manager.runner = runner
        job = self.submit()
        self.assertEqual(self.wait(job)['state'], 'failed')
        public = self.get_job(job)
        self.assertIn('controlled failure', public['error'])
        self.assertIsNone(public['result'])
        self.assertEqual(self.request('GET', '/api/results/' + job['job_id'])[0], 404)

    def configure_two_models(self):
        self.server.shutdown()
        self.server.server_close()
        self.server.manager.close()
        self.server.engine.close()
        self.thread.join(timeout=2)
        models = {}
        for model_id, filename in [('sdxl-base', 'sd_xl_base_1.0.safetensors'), ('sd-turbo', 'sd_turbo.safetensors')]:
            path = self.root / filename
            path.write_bytes(model_id.encode())
            models[model_id] = {'model_name': filename, 'model_path': str(path), 'manifest': {
                'schema': 1, 'model_name': filename, 'model_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                'comfy_commit': '1' * 40, 'input_hashes': {},
                'software': {'torch': 'test', 'cuda': 'test', 'dtype': 'test', 'attention': 'test', 'adapter_revision': 'test'}}}
        self.server = make_server(self.root, port=0, config={'models': models, 'managed_builtin_only': True})
        self.server.engine.client = self.client
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': .02}, daemon=True)
        self.thread.start()

    def test_models_endpoint_lists_local_availability_and_defaults_without_comfy_calls(self):
        self.configure_two_models()
        code, _, raw = self.request('GET', '/api/models')
        self.assertEqual(code, 200, raw)
        info = json.loads(raw)
        self.assertEqual(info['default_model_id'], 'sdxl-base')
        models = {row['id']: row for row in info['models']}
        self.assertEqual(set(models), {'sdxl-base', 'sd-turbo'})
        self.assertTrue(all(row['available'] for row in models.values()))
        self.assertEqual(models['sdxl-base']['defaults']['steps'], 25)
        self.assertEqual(models['sd-turbo']['defaults']['width'], 512)
        self.assertEqual(self.client.calls, 0)
        self.assertNotIn('model_path', raw.decode())

    def test_model_defaulting_happens_before_queue_and_invalid_selection_preserves_revision(self):
        self.configure_two_models()
        self.server.manager.runner = lambda job, preview: {'accepted': job.request}
        first = self.submit({'prompt': 'single character'})
        accepted = self.wait(first)['result']['accepted']
        self.assertEqual(accepted['model_id'], 'sdxl-base')
        self.assertEqual((accepted['width'], accepted['steps'], accepted['cfg']), (1024, 25, 6))
        previous_revision = self.server.manager.revisions['http-tests']
        for value in ['unknown', None, 4]:
            code, _, raw = self.request('POST', '/api/jobs', {'session': 'http-tests', 'request': {'model_id': value}})
            self.assertEqual(code, 400, raw)
            self.assertEqual(self.server.manager.revisions['http-tests'], previous_revision)
        (self.root / 'sd_xl_base_1.0.safetensors').unlink()
        code, _, raw = self.request('POST', '/api/jobs', {'session': 'http-tests', 'request': {'model_id': 'sdxl-base'}})
        self.assertEqual(code, 400, raw)
        self.assertEqual(self.server.manager.revisions['http-tests'], previous_revision)
        second = self.submit({'model_id': 'sd-turbo', 'steps': 9, 'width': 768, 'height': 768})
        explicit = self.wait(second)['result']['accepted']
        self.assertEqual((explicit['model_id'], explicit['steps'], explicit['width']), ('sd-turbo', 9, 768))

    def test_failed_server_bind_closes_worker_and_engine_resources(self):
        from pankeki.engine import Engine
        from pankeki.jobs import JobManager
        engines, managers = [], []
        def capture_engine(*args, **kwargs):
            engine = Engine(*args, **kwargs)
            engines.append(engine)
            return engine
        def capture_manager(*args, **kwargs):
            manager = JobManager(*args, **kwargs)
            managers.append(manager)
            return manager
        try:
            with patch('pankeki.server.Engine', side_effect=capture_engine), patch('pankeki.server.JobManager', side_effect=capture_manager), patch('pankeki.server.ThreadingHTTPServer', side_effect=OSError('bind failed')):
                with self.assertRaises(OSError):
                    make_server(self.root, port=self.server.server_port)
            self.assertTrue(engines[0]._closed)
            self.assertFalse(managers[0].worker.is_alive())
        finally:
            for manager in managers:
                manager.close()
            for engine in engines:
                engine.close()


if __name__ == '__main__':
    unittest.main()

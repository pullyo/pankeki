"""Ephemeral HTTP fixtures only; no live service or GPU calls."""
import base64
import hashlib
import http.client
import json
import threading
import unittest
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from pankeki.server import make_server
from tests import test_server as fixture


class BackendLifecycleHTTPTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixture.ServerTests('runTest')
        self.fixture.setUp()

    def tearDown(self):
        self.fixture.tearDown()

    def empty_mask_job(self):
        source = fixture.Image.new('RGBA', (64, 64), (20, 40, 60, 90))
        return self.fixture.submit({'mode': 'inpaint', 'source': fixture.image64(source),
            'mask': fixture.image64(fixture.Image.new('L', source.size)), 'width': 64, 'height': 64})

    def test_completed_result_is_historical_after_restart_and_tamper_is_rejected(self):
        f = self.fixture
        submitted = self.empty_mask_job()
        completed = f.wait(submitted)
        self.assertEqual(completed['state'], 'succeeded')
        code, _, original = f.request('GET', '/api/results/' + submitted['job_id'])
        self.assertEqual(code, 200)
        self.assertEqual(hashlib.sha256(original).hexdigest(), completed['result']['result_sha256'])
        # A legacy ownership digest is independent from completed-artifact SHA validation.
        legacy_digest='f'*64
        self.assertTrue(f.server.manager.store.transition(submitted['job_id'],['succeeded'],
            {'workflow_sha256':legacy_digest}))
        f.server.shutdown(); f.server.server_close(); f.server.manager.close(); f.server.engine.close(); f.thread.join(2)
        f.server = make_server(f.root, port=0)
        f.server.engine.client = f.client
        f.thread = threading.Thread(target=f.server.serve_forever, kwargs={'poll_interval': .02}, daemon=True)
        f.thread.start()
        historical = f.get_job(submitted)
        self.assertTrue(historical['historical'])
        self.assertEqual(historical['state'], 'succeeded')
        self.assertEqual(historical['workflow_sha256'],legacy_digest)
        self.assertEqual(f.request('GET', '/api/results/' + submitted['job_id'])[2], original)
        (f.server.engine.runs / submitted['job_id'] / 'result.png').write_bytes(b'tampered')
        self.assertEqual(f.request('GET', '/api/results/' + submitted['job_id'])[0], 400)

    def test_failed_comfy_health_still_contains_independent_build_identity(self):
        code, _, raw = self.fixture.request('GET', '/api/health')
        value = json.loads(raw)
        self.assertEqual(code, 200)
        self.assertFalse(value['comfy'])
        self.assertEqual(value['build']['schema'], 1)
        self.assertEqual(value['build']['status'], 'unknown')

    def test_process_identity_http_status_tracks_captured_startup_id(self):
        from tests.test_build_identity import BuildIdentityTests
        identity_fixture = BuildIdentityTests('runTest')
        identity_fixture.setUp()
        root = identity_fixture.root
        module = identity_fixture.identity()
        started = module.source_content_id(root)
        (root/'web/index.html').write_bytes(identity_fixture.html(started))
        server = make_server(root,port=0)
        thread = threading.Thread(target=server.serve_forever,kwargs={'poll_interval':.02},daemon=True)
        thread.start()
        def build(route):
            connection=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=3)
            try:
                connection.request('GET',route)
                response=connection.getresponse()
                self.assertEqual(response.status,200)
                return json.loads(response.read())['build']
            finally: connection.close()
        try:
            for expected in ('match','mismatch','unknown'):
                if expected=='mismatch': (root/'web/src/app.js').write_text('const value=2;\n')
                if expected=='unknown': (root/'pankeki/__init__.py').unlink()
                for client in (fixture.NoNetworkClient(),SimpleNamespace(get=lambda path:{})):
                    server.engine.client=client
                    for route in ('/api/health','/api/capabilities'):
                        value=build(route)
                        self.assertEqual(value['process_source_id'],started)
                        self.assertEqual(value['process_status'],expected)
        finally:
            server.shutdown(); server.server_close(); server.manager.close(); server.engine.close(); thread.join(2)
            identity_fixture.doCleanups()

    def test_failed_bind_and_second_port_cannot_orphan_a_live_owner(self):
        f = self.fixture
        entered, release = threading.Event(), threading.Event()
        def run(job, preview): entered.set(); release.wait(3); return {}
        f.server.manager.runner = run
        job = f.submit()
        try:
            self.assertTrue(entered.wait(1))
            with self.assertRaises(OSError): make_server(f.root,port=f.server.server_port)
            self.assertEqual(f.server.manager.store.get(job['job_id'])['state'],'running')
            with self.assertRaisesRegex(RuntimeError,'owner'): make_server(f.root,port=0)
            self.assertEqual(f.server.manager.store.get(job['job_id'])['state'],'running')
        finally:
            release.set(); f.wait(job)

    def test_bind_failure_leaves_every_runtime_byte_and_directory_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            (root/'keep.bin').write_bytes(b'user-owned-byte-snapshot')
            def snapshot():
                return {str(path.relative_to(root)):None if path.is_dir() else path.read_bytes()
                        for path in root.rglob('*')}
            before=snapshot()
            with patch('pankeki.server.ThreadingHTTPServer',side_effect=OSError('controlled bind failure')):
                with self.assertRaises(OSError): make_server(root,port=0)
            self.assertEqual(snapshot(),before)

    def test_image_operation_timeout_retains_owned_cpu_job_and_finishes(self):
        f = self.fixture
        f.server.engine.config['image_ops_wait_s'] = .02
        entered, release = threading.Event(), threading.Event()
        raw = fixture.png(fixture.Image.new('RGBA', (2, 3), (10, 20, 30, 255)))
        body = {'version':1,'operationId':'timeout','operation':'resize','trace_id':'image-tool-trace',
            'source':{'png':'data:image/png;base64,'+base64.b64encode(raw).decode(),
                'sha256':hashlib.sha256(raw).hexdigest(),'width':2,'height':3},
            'options':{'width':4,'height':6,'keepAspect':True}}
        def perform(*args):
            entered.set(); release.wait(2)
            return fixture.png(fixture.Image.new('RGBA', (4, 6), 'red')), {'algorithm':'fixture'}
        try:
            with patch('pankeki.server.perform_image_op', side_effect=perform):
                code, _, raw_response = f.request('POST', '/api/image-ops', body)
                response = json.loads(raw_response)
                self.assertEqual(code, 202)
                self.assertTrue(entered.is_set())
                job = f.server.manager.get(response['job_id'])
                self.assertEqual(job['lane'], 'cpu')
                release.set()
                completed = f.server.manager.wait(job['job_id'], 2)
                self.assertEqual(completed['state'], 'succeeded')
                self.assertEqual(completed['result']['operationId'], 'timeout')
                self.assertEqual(completed['result']['trace_id'], 'image-tool-trace')
                self.assertNotIn('image_path', completed['result'])
        finally:
            release.set()

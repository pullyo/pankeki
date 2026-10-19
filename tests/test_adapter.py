import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from pankeki.comfy_adapter import ComfyClient, ComfyError, SubmissionUncertain
from pankeki.metrics import EventMetrics


class Handler(BaseHTTPRequestHandler):
    calls = 0
    behavior = "ok"

    def log_message(self, *args):
        pass

    def do_POST(self):
        type(self).calls += 1
        self.rfile.read(int(self.headers['Content-Length']))
        if self.behavior == 'disconnect':
            self.connection.close()
            return
        self.send_response(400 if self.behavior == 'bad' else 200)
        self.end_headers()
        self.wfile.write(json.dumps({'error': 'invalid graph'} if self.behavior == 'bad' else {'prompt_id': 'p1'}).encode())

    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(json.dumps({'p1': {'status': {'completed': True, 'status_str': 'error', 'messages': [['execution_error', {'exception_message': 'OOM'}]]}}}).encode())


class AdapterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.client = ComfyClient(f'http://127.0.0.1:{cls.server.server_port}', request_timeout=1)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        Handler.calls = 0
        Handler.behavior = 'ok'

    def test_ambiguous_submission_never_retried(self):
        Handler.behavior = 'disconnect'
        with self.assertRaises(SubmissionUncertain):
            self.client.submit({'x': {}}, 'client1')
        self.assertEqual(Handler.calls, 1)

    def test_validation_error_is_explicit(self):
        Handler.behavior = 'bad'
        with self.assertRaisesRegex(ComfyError, 'invalid graph'):
            self.client.submit({}, 'client1')

    def test_history_error_cannot_be_success(self):
        with self.assertRaisesRegex(ComfyError, 'OOM'):
            self.client.wait('p1', timeout=2)

    def test_remote_server_is_rejected(self):
        with self.assertRaises(ValueError):
            ComfyClient('https://example.com')

    def test_timing_ignores_other_prompt_and_counts_node_cache(self):
        metrics = EventMetrics('p1')
        metrics.feed({'type': 'execution_start', 'data': {'prompt_id': 'other'}}, 1)
        metrics.feed({'type': 'execution_start', 'data': {'prompt_id': 'p1'}}, 2)
        metrics.feed({'type': 'execution_cached', 'data': {'prompt_id': 'p1', 'nodes': ['1','2']}}, 3)
        metrics.feed({'type': 'executing', 'data': {'prompt_id': 'p1', 'node': '3'}}, 4)
        metrics.feed({'type': 'executing', 'data': {'prompt_id': 'p1', 'node': None}}, 7)
        result = metrics.result()
        self.assertEqual(result['comfy_cached_nodes'], ['1','2'])
        self.assertEqual(result['node_wall_s'], {'3': 3})


if __name__ == '__main__':
    unittest.main()

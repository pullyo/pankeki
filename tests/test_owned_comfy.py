import json
import unittest
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

from pankeki.comfy_adapter import ComfyClient, SubmissionUncertain, workflow_sha256


class OwnedComfyTests(unittest.TestCase):
    def setUp(self):
        self.client = ComfyClient()
        self.graph = {'1': {'class_type': 'Test', 'inputs': {}}}
        self.digest = workflow_sha256(self.graph)
        self.row = [0, 'owned', self.graph, {'client_id': 'client'}, []]

    def test_reconcile_real_queue_history_shapes_and_ambiguity(self):
        with patch.object(self.client, 'get', side_effect=[{'queue_running': [], 'queue_pending': [self.row]}, {}]) as get:
            self.assertEqual(self.client.reconcile_submission('client', self.digest)['prompt_id'], 'owned')
            self.assertEqual([call.args[0] for call in get.call_args_list], ['/queue', '/history'])
        with patch.object(self.client, 'get', side_effect=[{'queue_running': [], 'queue_pending': []}, {'owned': {'prompt': self.row}}]):
            self.assertEqual(self.client.reconcile_submission('client', self.digest)['location'], 'history')
        other = [0, 'second', self.graph, {'client_id': 'client'}, []]
        with patch.object(self.client, 'get', side_effect=[{'queue_running': [], 'queue_pending': [self.row, other]}, {}]):
            self.assertEqual(self.client.reconcile_submission('client', self.digest)['state'], 'ambiguous')

    def test_foreign_running_and_check_delete_race_never_interrupt(self):
        foreign = [0, 'foreign', self.graph, {'client_id': 'other'}, []]
        with patch.object(self.client, 'get', return_value={'queue_running': [], 'queue_pending': [foreign]}), patch.object(self.client, '_request') as post:
            self.assertEqual(self.client.cancel_owned('foreign', 'client', self.digest)['state'], 'unconfirmed')
            post.assert_not_called()
        with patch.object(self.client, 'get', return_value={'queue_running': [self.row], 'queue_pending': []}), patch.object(self.client, '_request') as post:
            self.assertEqual(self.client.cancel_owned('owned', 'client', self.digest)['state'], 'local_only')
            post.assert_not_called()
        with patch.object(self.client, 'get', side_effect=[{'queue_running': [], 'queue_pending': [self.row]}, {'queue_running': [self.row], 'queue_pending': []}]), patch.object(self.client, '_request', return_value=b'{}') as post:
            self.assertEqual(self.client.cancel_owned('owned', 'client', self.digest)['state'], 'unconfirmed')
            self.assertEqual(post.call_args.args[0], '/queue')
            self.assertEqual(json.loads(post.call_args.args[1]), {'delete': ['owned']})

    def test_missing_owner_metadata_cannot_authorize_delete(self):
        row = [0, 'owned', self.graph, {}, []]
        with patch.object(self.client, 'get', return_value={'queue_running': [], 'queue_pending': [row]}), patch.object(self.client, '_request') as post:
            self.assertEqual(self.client.cancel_owned('owned', None, self.digest)['state'], 'unconfirmed')
            post.assert_not_called()

    def test_server_error_after_post_and_malformed_ack_remain_uncertain(self):
        from pankeki.comfy_adapter import ComfyError
        failure = ComfyError('server failed after acceptance')
        failure.status_code = 500
        with patch.object(self.client, '_request', side_effect=failure) as post:
            with self.assertRaises(SubmissionUncertain): self.client.submit(self.graph, 'client')
            self.assertEqual(post.call_count, 1)
        with patch.object(self.client, '_request', return_value=b'[]'):
            with self.assertRaises(SubmissionUncertain): self.client.submit(self.graph, 'client')

    def test_persist_before_post_and_lost_response_reconciles_without_retry(self):
        calls = []
        def persist(client_id, digest): calls.append(('persist', client_id, digest))
        def submit(graph, client_id):
            self.assertEqual(calls[0], ('persist', client_id, self.digest))
            calls.append(('post',))
            raise SubmissionUncertain('lost')
        history = {'outputs': {'1': {'images': [{'type': 'output', 'filename': 'x.png'}]}}}
        with patch.object(self.client, '_connect_ws', return_value=None), patch.object(self.client, 'submit', side_effect=submit), patch.object(self.client, 'reconcile_submission', return_value={'state': 'found', 'prompt_id': 'owned', 'location': 'history'}), patch.object(self.client, 'wait', return_value=(history, {})), patch.object(self.client, '_request', return_value=b'png'):
            self.assertEqual(self.client.execute(self.graph, on_submitting=persist)[0], b'png')
        self.assertEqual(len([c for c in calls if c[0] == 'post']), 1)

    def test_verified_targeted_cancel_is_request_until_interrupted_history(self):
        evidence = {'state': 'verified', 'server_identity': 'identity', 'atomic_source_verified': True}
        self.client.targeted_cancel_capability = evidence
        row = self.row
        interrupted = {'owned': {'prompt': row, 'status': {'messages': [['execution_interrupted', {'prompt_id': 'owned'}]]}}}
        with patch.object(self.client, '_server_identity', return_value='identity'), patch.object(self.client, 'get', side_effect=[{'queue_running': [row], 'queue_pending': []}, {'queue_running': [], 'queue_pending': []}, interrupted]), patch.object(self.client, '_request', return_value=b'{"cancelled":true}') as post:
            self.assertEqual(self.client.cancel_owned('owned', 'client', self.digest)['state'], 'confirmed')
            self.assertEqual(post.call_args.args[0], '/api/jobs/owned/cancel')
        with patch.object(self.client, '_server_identity', return_value='identity'), patch.object(self.client, 'get', side_effect=[{'queue_running': [row], 'queue_pending': []}, {'queue_running': [row], 'queue_pending': []}, {}]), patch.object(self.client, '_request', return_value=b'{"cancelled":false}'):
            self.assertEqual(self.client.cancel_owned('owned', 'client', self.digest)['state'], 'unconfirmed')

    def test_late_interrupt_is_confirmed_and_named_in_the_cancel_error(self):
        from pankeki.comfy_adapter import Canceled
        self.client.targeted_cancel_capability = {'state': 'verified', 'server_identity': 'identity', 'atomic_source_verified': True}
        row = self.row
        interrupted = {'owned': {'prompt': row, 'status': {'messages': [['execution_interrupted', {'prompt_id': 'owned'}]]}}}
        observations = [{'queue_running': [row], 'queue_pending': []}, {'queue_running': [], 'queue_pending': []}, {}, {}, interrupted]
        with patch.object(self.client, '_server_identity', return_value='identity'), patch.object(self.client, 'get', side_effect=observations), patch.object(self.client, '_request', return_value=b'{"cancelled":true}'):
            self.assertEqual(self.client.cancel_owned('owned', 'client', self.digest)['state'], 'confirmed')
        outcomes = []
        with patch.object(self.client, '_connect_ws', return_value=None), patch.object(self.client, 'submit', return_value='owned'), patch.object(self.client, 'wait', side_effect=Canceled('Result ignored locally; ComfyUI may still finish. No global interrupt sent.')), patch.object(self.client, 'cancel_owned', return_value={'state': 'confirmed', 'reason': 'Owned prompt history reports execution_interrupted'}):
            with self.assertRaisesRegex(Canceled, 'ComfyUI confirmed'):
                self.client.execute(self.graph, on_cancelled=outcomes.append)
        self.assertEqual(outcomes[0]['state'], 'confirmed')

    def test_targeted_probe_requires_structured_404_known_shape_and_identity(self):
        from pankeki.comfy_adapter import ComfyError
        missing = ComfyError('missing')
        missing.status_code, missing.json_body, missing.content_type = 404, {'error': 'Job not found'}, 'application/json'
        with patch.object(self.client, '_server_identity', return_value='identity'), patch.object(self.client, 'get', side_effect=[missing, {'id': 'owned', 'status': 'in_progress'}]):
            self.assertEqual(self.client.verify_targeted_cancel('owned', expected_server_identity='identity', atomic_source_verified=True)['state'], 'verified')
        self.client.targeted_cancel_capability = {'state': 'unknown'}
        missing.content_type = 'text/html'
        with patch.object(self.client, '_server_identity', return_value='identity'), patch.object(self.client, 'get', side_effect=missing):
            self.assertNotEqual(self.client.verify_targeted_cancel('owned', expected_server_identity='identity', atomic_source_verified=True)['state'], 'verified')


class FixtureComfyHTTPTests(unittest.TestCase):
    def setUp(self):
        self.pending, self.history, self.posts, self.gets = [], {}, [], []
        owner = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def send(self, value):
                self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers()
                self.wfile.write(json.dumps(value).encode())
            def do_POST(self):
                value = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                owner.posts.append((self.path, value))
                if self.path == '/prompt':
                    row = [0, 'owned-http', value['prompt'], {'client_id': value['client_id']}, []]
                    owner.history['owned-http'] = {'prompt': row, 'status': {'completed': True, 'status_str': 'success', 'messages': []},
                        'outputs': {'1': {'images': [{'type': 'output', 'filename': 'fixture.png'}]}}}
                    self.connection.close()  # request accepted, response lost
                elif self.path == '/queue':
                    owner.pending[:] = [row for row in owner.pending if row[1] not in value['delete']]
                    self.send({})
            def do_GET(self):
                owner.gets.append(self.path)
                if self.path == '/queue': self.send({'queue_running': [], 'queue_pending': owner.pending})
                elif self.path == '/history': self.send(owner.history)
                elif self.path == '/history/owned-http': self.send(owner.history)
                elif self.path.startswith('/view?'):
                    self.send_response(200); self.end_headers(); self.wfile.write(b'fixture-png')
                else:
                    self.send_response(404); self.end_headers()
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': .02}, daemon=True)
        self.thread.start()
        self.client = ComfyClient('http://127.0.0.1:' + str(self.server.server_port), request_timeout=1)

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(2)

    def test_real_http_response_loss_finds_history_without_second_submission(self):
        persisted = []
        with patch.object(self.client, '_connect_ws', return_value=None):
            data, result = self.client.execute({'1': {}}, on_submitting=lambda *args: persisted.append(args))
        self.assertEqual(data, b'fixture-png')
        self.assertEqual(result['prompt_id'], 'owned-http')
        self.assertEqual(len([path for path, _ in self.posts if path == '/prompt']), 1)
        self.assertEqual(persisted[0][0], self.posts[0][1]['client_id'])
        self.assertIn('/history', self.gets)
        self.assertNotIn('/history/' + persisted[0][0], self.gets)

    def test_real_http_owned_dequeue_leaves_foreign_prompt_unchanged(self):
        graph = {'1': {}}
        own = [0, 'owned-http', graph, {'client_id': 'client'}, []]
        foreign = [1, 'foreign-http', graph, {'client_id': 'foreign'}, []]
        self.pending[:] = [own, foreign]
        self.assertEqual(self.client.cancel_owned('owned-http', 'client', workflow_sha256(graph))['state'], 'confirmed')
        self.assertEqual(self.pending, [foreign])
        self.assertEqual(self.posts, [('/queue', {'delete': ['owned-http']})])

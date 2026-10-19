import copy
import json
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from pathlib import Path
import bridge


class BridgeContractTests(unittest.TestCase):
    def test_local_route_cannot_be_redirected_by_request(self):
        with self.assertRaises(ValueError):
            bridge.validate_request({'workflow': {'9': {'class_type': 'SaveImage', 'inputs': {}}}, 'base_url': 'https://cloud.comfy.org'})

    def test_empty_workflow_rejected_before_submission(self):
        with self.assertRaises(ValueError):
            bridge.validate_request({'workflow': {}})

    def test_request_preserves_graph_and_requires_explicit_existing_asset_input(self):
        request = {'workflow': {'9': {'class_type': 'SaveImage', 'inputs': {}}}, 'assets': [{'node_id': 'missing', 'input_name': 'image', 'path': 'source.png'}]}
        original = copy.deepcopy(request)
        with self.assertRaises(ValueError):
            bridge.validate_request(request)
        self.assertEqual(request, original)

    def test_workflow_hash_is_key_order_independent(self):
        self.assertEqual(bridge.graph_hash({'b': 2, 'a': 1}), bridge.graph_hash({'a': 1, 'b': 2}))

    def test_output_path_ignores_remote_names(self):
        self.assertEqual(bridge.output_name(3, 'image/png'), 'output-003.png')

    def test_timeout_is_bounded_and_finite(self):
        for timeout in [0, -1, float('nan'), float('inf'), 7201]:
            with self.assertRaises(ValueError):
                bridge.validate_request({'workflow': {'9': {'class_type': 'SaveImage', 'inputs': {}}}, 'timeout_seconds': timeout})

    def test_invalid_caller_key_is_rejected_instead_of_replaced(self):
        for key in ['', None, 123, '한글', 'line\nbreak']:
            with self.assertRaises(ValueError):
                bridge.validate_request({'workflow': {'9': {'class_type': 'SaveImage', 'inputs': {}}}, 'idempotency_key': key})

    def test_submission_failure_is_not_retried_and_keeps_recovery_key(self):
        request = {'workflow': {'9': {'class_type': 'SaveImage', 'inputs': {}}}, 'idempotency_key': 'test-once'}
        client = MagicMock()
        client.__enter__.return_value = client
        client.submit.side_effect = ConnectionError('ambiguous response loss')
        with tempfile.TemporaryDirectory() as directory, patch('comfy_sdk.Comfy', return_value=client):
            receipt = Path(directory) / 'receipt.json'
            with self.assertRaises(ConnectionError):
                bridge.run_workflow(request, Path(directory) / 'outputs', receipt)
            saved = json.loads(receipt.read_text(encoding='utf-8'))
            self.assertEqual(saved['idempotency_key'], 'test-once')
            self.assertEqual(saved['state'], 'error')
            self.assertIsNone(saved['job_id'])
        client.submit.assert_called_once()

    def test_local_sdk_client_does_not_inherit_api_key(self):
        import os
        def construct(**kwargs):
            self.assertFalse(os.environ.get('COMFY_API_KEY'))
            self.assertEqual(os.environ['COMFY_BASE_URL'], 'http://127.0.0.1:8189')
            raise ConnectionError('stop before any network')
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'COMFY_API_KEY': 'not-a-real-key'}), patch('comfy_sdk.Comfy', side_effect=construct):
            with self.assertRaises(ConnectionError):
                bridge.run_workflow({'workflow': {'9': {'class_type': 'SaveImage', 'inputs': {}}}}, Path(directory) / 'outputs', Path(directory) / 'receipt.json')

    def test_expired_job_is_terminal_and_keeps_submitted_id(self):
        client = MagicMock()
        client.__enter__.return_value = client
        job = client.submit.return_value
        job.id, job.status, job.error = 'known-job-id', 'expired', None
        job.refresh.side_effect = [job, AssertionError('expired jobs must not be polled again')]
        client.jobs.get.return_value.events.return_value = iter(())
        with tempfile.TemporaryDirectory() as directory, patch('comfy_sdk.Comfy', return_value=client):
            receipt = Path(directory) / 'receipt.json'
            with self.assertRaisesRegex(RuntimeError, 'ended expired'):
                bridge.run_workflow({'workflow': {'9': {'class_type': 'SaveImage', 'inputs': {}}}}, Path(directory) / 'outputs', receipt)
            self.assertEqual(json.loads(receipt.read_text(encoding='utf-8'))['job_id'], 'known-job-id')
        job.refresh.assert_called_once()

    def test_cancel_before_submission_does_not_construct_sdk_client(self):
        with tempfile.TemporaryDirectory() as directory, patch('comfy_sdk.Comfy') as factory:
            marker = Path(directory) / 'cancel'
            marker.touch()
            with self.assertRaises(InterruptedError):
                bridge.run_workflow({'workflow': {'9': {'class_type': 'SaveImage', 'inputs': {}}}}, Path(directory) / 'outputs', Path(directory) / 'receipt.json', cancel_file=marker)
            factory.assert_not_called()

    def test_cancel_after_submission_records_id_without_global_interrupt(self):
        client = MagicMock()
        client.__enter__.return_value = client
        job = MagicMock(id='cancel-this-job')
        client.jobs.get.return_value.events.return_value = iter(())
        with tempfile.TemporaryDirectory() as directory, patch('comfy_sdk.Comfy', return_value=client):
            marker = Path(directory) / 'cancel'
            def submit(*args, **kwargs):
                marker.touch()
                return job
            client.submit.side_effect = submit
            receipt = Path(directory) / 'receipt.json'
            with self.assertRaises(InterruptedError):
                bridge.run_workflow({'workflow': {'9': {'class_type': 'SaveImage', 'inputs': {}}}}, Path(directory) / 'outputs', receipt, cancel_file=marker)
            saved = json.loads(receipt.read_text(encoding='utf-8'))
            self.assertEqual(saved['state'], 'canceled_locally')
            self.assertEqual(saved['job_id'], 'cancel-this-job')
            job.cancel.assert_not_called()


if __name__ == '__main__':
    unittest.main()

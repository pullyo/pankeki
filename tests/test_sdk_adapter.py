"""Real subprocess boundary tests; no SDK/proxy/model or GPU is contacted."""
import base64
from copy import deepcopy
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from PIL import Image

from pankeki.comfy_adapter import Canceled, ComfyClient, ComfyError, SubmissionUncertain
try:
    from pankeki.sdk_adapter import SDKComfyClient
except ImportError:
    SDKComfyClient = None


BRIDGE = r'''
import argparse, base64, hashlib, json, os, pathlib, sys, time
p=argparse.ArgumentParser()
for name in ['request','output-dir','receipt','cancel-file']: p.add_argument('--'+name, required=True)
a=p.parse_args(); request=json.loads(pathlib.Path(a.request).read_text())
out=pathlib.Path(a.output_dir); out.mkdir(parents=True, exist_ok=True)
with pathlib.Path(__file__).with_name('launches.txt').open('a') as f: f.write('one\n')
behavior=request['workflow']['5']['inputs'].get('fixture_behavior','ok')
def emit(value): print(json.dumps(value), flush=True)
receipt={'state':'prepared','job_id':None,'outputs':[], 'idempotency_key':request['idempotency_key']}
def save(): pathlib.Path(a.receipt).write_text(json.dumps(receipt))
save()
if behavior=='broken-protocol':
    print('{incomplete', flush=True); sys.exit(2)
if behavior=='uncertain':
    receipt.update(state='error',error='response lost',error_type='ConnectionError'); save()
    emit({'event':'error','message':'response lost','type':'ConnectionError'}); sys.exit(2)
receipt.update(state='submitted',job_id='sdk-job-1'); save()
emit({'event':'submitted','job_id':'sdk-job-1'})
if behavior=='fail':
    receipt.update(state='error',error='GPU OOM',error_type='RuntimeError'); save()
    emit({'event':'error','message':'GPU OOM','type':'RuntimeError'}); sys.exit(2)
if behavior in ['wait','hang']:
    if behavior=='hang': time.sleep(30)
    while not pathlib.Path(a.cancel_file).exists(): time.sleep(.01)
    pathlib.Path(__file__).with_name('cancel-observed.txt').write_text('yes')
    receipt.update(state='canceled_locally',error='locally canceled'); save(); sys.exit(2)
data=base64.b64decode(request['workflow']['5']['inputs']['fixture_png'])
emit({'event':'preview','data_base64':base64.b64encode(data).decode(),'content_type':'image/png','node_id':'5'})
emit({'event':'progress','value':.5,'step':1,'steps':2,'node_id':'5'})
emit({'event':'status','status':'succeeded'})
if behavior=='invalid-image': data=b'not an image'
output=out/'output-000.png'
if behavior=='escape': output=out.parent.parent/'escaped.png'
output.write_bytes(data)
record={'path':str(output),'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'content_type':'image/png'}
if behavior=='bad-hash': record['sha256']='0'*64
receipt['outputs']=[record]
if behavior=='multiple': receipt['outputs'].append(dict(record))
receipt.update(state='succeeded',elapsed_s=.01,preview_received_count=1,preview_received_bytes=len(data),first_preview_s=.005)
if behavior=='false-success': receipt['state']='error'
save()
emit({'event':'output',**record})
emit({'event':'complete','receipt':receipt})
'''


class SDKAdapterTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(SDKComfyClient, 'SDKComfyClient is not implemented')
        self.temporary = tempfile.TemporaryDirectory(prefix='sdk-test-', dir=Path(__file__).resolve().parents[1])
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.bridge = self.directory / 'bridge.py'
        self.bridge.write_text(BRIDGE, encoding='utf-8')
        self.lock = self.directory / 'requirements.lock.txt'
        self.lock.write_text('comfy-sdk==0.5.0\n', encoding='utf-8')
        self.runtime = self.directory / 'runtime'
        self.client = SDKComfyClient(runtime_dir=self.runtime, python_executable=sys.executable,
                                    bridge_path=self.bridge, lock_path=self.lock)
        stream = io.BytesIO()
        Image.new('RGBA', (16, 16), (99, 37, 210, 0)).save(stream, format='PNG')
        self.png = stream.getvalue()
        self.name = hashlib.sha256(self.png).hexdigest() + '.png'
        self.graph = {'5': {'class_type': 'KSampler', 'inputs': {'fixture_png': base64.b64encode(self.png).decode()}},
                      '7': {'class_type': 'SaveImage', 'inputs': {'images': ['5', 0]}}}

    def behavior(self, name):
        self.graph['5']['inputs']['fixture_behavior'] = name

    def launches(self):
        path = self.directory / 'launches.txt'
        return len(path.read_text().splitlines()) if path.exists() else 0

    def asset_graph(self):
        self.client.upload_png(self.png, self.name)
        self.graph['4'] = {'class_type': 'LoadImage', 'inputs': {'image': self.name}}
        return self.runtime / 'assets' / self.name

    def test_staging_preserves_hidden_rgb_and_never_overwrites_different_bytes(self):
        self.assertIsInstance(self.client, ComfyClient)
        self.assertEqual(self.client.upload_png(self.png, self.name), self.name)
        asset = self.runtime / 'assets' / self.name
        self.assertEqual(asset.read_bytes(), self.png)
        self.assertEqual(self.client.upload_png(self.png, self.name), self.name)
        asset.write_bytes(b'tampered')
        with self.assertRaisesRegex((ValueError, ComfyError), 'hash|changed|SHA|content'):
            self.client.upload_png(self.png, self.name)
        self.assertEqual(asset.read_bytes(), b'tampered')

    def test_untrusted_asset_names_and_content_mismatch_are_rejected(self):
        for name in ['../source.png', 'source.png', '0' * 64 + '.png']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.client.upload_png(self.png, name)

    def test_tampered_asset_prevents_submission_without_mutating_graph(self):
        asset = self.asset_graph()
        before = deepcopy(self.graph)
        asset.write_bytes(b'changed after upload')
        with self.assertRaises((ValueError, ComfyError)):
            self.client.execute(self.graph)
        self.assertEqual(self.launches(), 0)
        self.assertEqual(self.graph, before)

    def test_real_process_streams_callbacks_and_returns_only_verified_image(self):
        self.asset_graph()
        before = deepcopy(self.graph)
        submitted, previews, events = [], [], []
        data, metrics = self.client.execute(self.graph, on_submitted=submitted.append,
                                            on_preview=previews.append, on_event=events.append)
        self.assertEqual(data, self.png)
        self.assertEqual(submitted, ['sdk-job-1'])
        self.assertEqual(previews, [self.png])
        progress = next(e for e in events if e['type'] == 'progress')
        self.assertEqual(progress['data']['prompt_id'], 'sdk-job-1')
        self.assertEqual(progress['data']['value'], 1)
        self.assertEqual(progress['data']['max'], 2)
        self.assertEqual(metrics['sdk_job_id'], 'sdk-job-1')
        self.assertEqual(metrics['transport'], 'official-comfy-sdk')
        self.assertIsNone(metrics['denoiser_executed'])
        self.assertEqual(self.graph, before)
        self.assertEqual(self.launches(), 1)

    def test_ambiguous_failure_is_uncertain_and_never_retried(self):
        self.behavior('uncertain')
        with self.assertRaisesRegex(SubmissionUncertain, 'response lost'):
            self.client.execute(self.graph)
        self.assertEqual(self.launches(), 1)

    def test_lost_protocol_before_submission_ack_is_uncertain_and_not_retried(self):
        self.behavior('broken-protocol')
        with self.assertRaises(SubmissionUncertain):
            self.client.execute(self.graph)
        self.assertEqual(self.launches(), 1)

    def test_known_job_failure_keeps_job_id_and_is_not_submission_uncertainty(self):
        self.behavior('fail')
        with self.assertRaises(ComfyError) as raised:
            self.client.execute(self.graph)
        self.assertNotIsInstance(raised.exception, SubmissionUncertain)
        self.assertIn('GPU OOM', str(raised.exception))
        self.assertIn('sdk-job-1', str(raised.exception))
        self.assertEqual(self.launches(), 1)

    def test_output_events_cannot_bypass_terminal_receipt_hash_path_or_image_validation(self):
        for behavior in ['false-success', 'multiple', 'bad-hash', 'escape', 'invalid-image']:
            with self.subTest(behavior=behavior):
                self.behavior(behavior)
                with self.assertRaises(ComfyError):
                    self.client.execute(self.graph)

    def test_pre_canceled_request_never_starts_subprocess(self):
        cancel = threading.Event()
        cancel.set()
        with self.assertRaises(Canceled):
            self.client.execute(self.graph, cancel=cancel)
        self.assertEqual(self.launches(), 0)

    def test_cancel_writes_cooperative_file_and_discards_result(self):
        self.behavior('wait')
        cancel = threading.Event()
        with self.assertRaises(Canceled):
            self.client.execute(self.graph, cancel=cancel, on_submitted=lambda _: cancel.set())
        self.assertEqual((self.directory / 'cancel-observed.txt').read_text(), 'yes')
        self.assertEqual(self.launches(), 1)

    def test_deadline_works_when_child_stdout_is_silent_and_does_not_resubmit(self):
        self.behavior('hang')
        start = time.monotonic()
        with self.assertRaisesRegex(ComfyError, 'timed out|deadline'):
            self.client.execute(self.graph, timeout=.2)
        self.assertLess(time.monotonic() - start, 3)
        self.assertEqual(self.launches(), 1)

    def test_fingerprint_change_blocks_execution_before_child_starts(self):
        fingerprint = self.client.fingerprint()
        self.assertEqual(fingerprint['bridge_sha256'], hashlib.sha256(self.bridge.read_bytes()).hexdigest())
        self.assertEqual(fingerprint['requirements_lock_sha256'], hashlib.sha256(self.lock.read_bytes()).hexdigest())
        self.lock.write_text('changed dependency lock')
        with self.assertRaisesRegex((ValueError, ComfyError), 'changed|fingerprint'):
            self.client.execute(self.graph)
        self.assertEqual(self.launches(), 0)

    def test_fixed_bridge_route_rejects_other_upstreams(self):
        for url in ['https://example.com', 'http://127.0.0.1:9999']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                SDKComfyClient(url, runtime_dir=self.runtime, python_executable=sys.executable,
                               bridge_path=self.bridge, lock_path=self.lock)

    def test_health_requires_live_proxy_with_expected_upstream_before_reporting_native_stats(self):
        stats = {'system': {'comfyui_version': 'fixture'}}
        with patch.object(ComfyClient, 'get', side_effect=[{'status': 'healthy', 'upstream': 'http://127.0.0.1:8188'}, stats]):
            self.assertEqual(self.client.health(), stats)
        for unavailable in [OSError('proxy stopped'), {'status': 'healthy', 'upstream': 'http://example.com'}, {'status': 'unhealthy'}]:
            effect = [unavailable] if not isinstance(unavailable, Exception) else unavailable
            with self.subTest(unavailable=unavailable), patch.object(ComfyClient, 'get', side_effect=effect) as read:
                with self.assertRaises((OSError, ComfyError)):
                    self.client.health()
                self.assertEqual(read.call_count, 1)

    @unittest.skipUnless(os.name == 'nt', 'Windows read-share exclusion')
    def test_asset_cannot_change_during_bridge_execution_and_lease_is_released(self):
        asset = self.asset_graph()
        def change_during_execution(_):
            with self.assertRaises(OSError):
                asset.write_bytes(b'concurrent change')
        self.client.execute(self.graph, on_submitted=change_during_execution)
        asset.write_bytes(b'now released')
        self.assertEqual(asset.read_bytes(), b'now released')


if __name__ == '__main__':
    unittest.main()

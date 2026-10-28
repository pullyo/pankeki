import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pankeki.comfy_adapter import attest_atomic_cancel, attest_atomic_cancel_listener, validate_atomic_attestation, normalize_origin
from pankeki.engine import Engine


class AtomicCancelAttestationTests(unittest.TestCase):
    def test_origin_policy_keeps_loopback_names_distinct_and_rejects_other_targets(self):
        self.assertEqual(normalize_origin('http://127.0.0.1:8188/'),'http://127.0.0.1:8188')
        self.assertNotEqual(normalize_origin('http://localhost:8188'),normalize_origin('http://127.0.0.1:8188'))
        self.assertNotEqual(normalize_origin('http://[::1]:8188'),normalize_origin('http://127.0.0.1:8188'))
        for value in ('http://127.0.0.1:0','http://127.0.0.1:65536','http://:password@127.0.0.1:8188',
                      'http://127.0.0.1:8188/path','http://127.0.0.1:8188?other=1','http://127.0.0.1:8188#other'):
            with self.assertRaises(ValueError): normalize_origin(value)

    def test_crlf_and_lf_checkouts_of_the_pinned_commit_attest_identically(self):
        from pankeki.comfy_adapter import _atomic_sources, ATOMIC_CANCEL_SOURCE_PINS
        with tempfile.TemporaryDirectory() as tmp:
            lf, crlf, edited = Path(tmp) / 'lf', Path(tmp) / 'crlf', Path(tmp) / 'edited'
            for root, body in [(lf, b'a = 1\nb = 2\n'), (crlf, b'a = 1\r\nb = 2\r\n'), (edited, b'a = 1\nb = 3\n')]:
                for name in ATOMIC_CANCEL_SOURCE_PINS:
                    path = root / 'vendor/ComfyUI' / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(body)
            self.assertEqual(_atomic_sources(lf), _atomic_sources(crlf))
            self.assertNotEqual(_atomic_sources(lf), _atomic_sources(edited))

    def test_project_vendor_checkout_matches_upstream_pins(self):
        from pankeki.comfy_adapter import _atomic_sources, ATOMIC_CANCEL_SOURCE_PINS
        root = Path(__file__).resolve().parents[1]
        if not (root / 'vendor/ComfyUI/server.py').is_file():
            self.skipTest('vendor/ComfyUI is not installed')
        self.assertEqual(_atomic_sources(root), ATOMIC_CANCEL_SOURCE_PINS)

    def test_owned_process_and_exact_pins_required_and_rechecked(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pins = {'server.py':hashlib.sha256(b'server').hexdigest(), 'execution.py':hashlib.sha256(b'execution').hexdigest(),
                    'comfy_execution/jobs.py':hashlib.sha256(b'jobs').hexdigest()}
            for name, content in [('server.py',b'server'),('execution.py',b'execution'),('comfy_execution/jobs.py',b'jobs')]:
                path = root / 'vendor/ComfyUI' / name; path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(content)
            with patch('pankeki.comfy_adapter.ATOMIC_CANCEL_SOURCE_PINS', pins), patch('pankeki.comfy_adapter._process_token', return_value='started'), patch('pankeki.comfy_adapter._owns_listener', return_value=True):
                evidence = attest_atomic_cancel(root, pid=123, port=8188, server_identity='a'*64)
                self.assertEqual(evidence['state'], 'source_verified')
                self.assertTrue(validate_atomic_attestation(root, evidence,base_url='http://127.0.0.1:8188'))
                self.assertFalse(validate_atomic_attestation(root, evidence,base_url='http://127.0.0.1:8189'))
                self.assertFalse(validate_atomic_attestation(root, evidence,base_url='http://localhost:8188'))
                self.assertFalse(validate_atomic_attestation(root, evidence,base_url='http://[::1]:8188'))
                self.assertFalse(validate_atomic_attestation(root, evidence,base_url='http://user@127.0.0.1:8188'))
                self.assertFalse(validate_atomic_attestation(root, evidence,base_url='http://127.0.0.1:8188/other'))
                engine = Engine(root,base_url='http://127.0.0.1:8189',config={'comfy_atomic_cancel':evidence})
                try:
                    self.assertFalse(engine.client.atomic_cancel_guard())
                    self.assertFalse(engine.client.targeted_cancel_capability['atomic_source_verified'])
                finally: engine.close()
                (root / 'vendor/ComfyUI/server.py').write_bytes(b'old route')
                self.assertFalse(validate_atomic_attestation(root, evidence,base_url='http://127.0.0.1:8188'))
            with patch('pankeki.comfy_adapter._process_token', return_value=None):
                self.assertNotEqual(attest_atomic_cancel(root,pid=123,port=8188,server_identity='a'*64)['state'], 'source_verified')

    def test_reused_listener_needs_this_vendor_and_a_start_after_the_pinned_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pins = {}
            for name, content in [('server.py',b'server'),('execution.py',b'execution'),('comfy_execution/jobs.py',b'jobs')]:
                path = root / 'vendor/ComfyUI' / name; path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(content)
                pins[name] = hashlib.sha256(content).hexdigest()
            vendor = (root / 'vendor/ComfyUI').resolve()
            later = max((vendor / name).stat().st_mtime for name in pins) + 60
            common = [patch('pankeki.comfy_adapter.ATOMIC_CANCEL_SOURCE_PINS', pins), patch('pankeki.comfy_adapter._listener_pid', return_value=123),
                      patch('pankeki.comfy_adapter._process_token', return_value='started'), patch('pankeki.comfy_adapter._owns_listener', return_value=True)]
            for item in common: item.start()
            try:
                def attest(cwd, started, command='python -u main.py --port 8188'):
                    with patch('pankeki.comfy_adapter._process_cwd', return_value=cwd), patch('pankeki.comfy_adapter._process_started', return_value=(started, command)):
                        return attest_atomic_cancel_listener(root, origin='http://127.0.0.1:8188', server_identity='a'*64)
                evidence = attest(vendor, later)
                self.assertEqual(evidence['state'], 'source_verified')
                self.assertTrue(validate_atomic_attestation(root, evidence, base_url='http://127.0.0.1:8188'))
                self.assertEqual(attest(root, later)['state'], 'unknown')
                self.assertEqual(attest(vendor, later - 120)['state'], 'unknown')
                self.assertEqual(attest(vendor, later, 'python other.py')['state'], 'unknown')
            finally:
                for item in common: item.stop()
            with patch('pankeki.comfy_adapter._listener_pid', side_effect=ValueError('Exactly one listener process is required')):
                self.assertEqual(attest_atomic_cancel_listener(root, origin='http://127.0.0.1:8188', server_identity='a'*64)['state'], 'unknown')

    def test_missing_vendor_never_manufactures_verification(self):
        with tempfile.TemporaryDirectory() as tmp:
            evidence = attest_atomic_cancel(Path(tmp),pid=123,port=8188,server_identity='a'*64)
            self.assertNotEqual(evidence['state'], 'source_verified')
            self.assertFalse(validate_atomic_attestation(Path(tmp), {'atomic_source_verified':True}))

import hashlib
import json
import tempfile
import unittest
import threading
import time
from pathlib import Path

from pankeki.run_store import RunStore, plan_retention
from pankeki.engine import Engine
from pankeki.jobs import JobManager


class RunStoreTests(unittest.TestCase):
    def test_only_final_marker_and_matching_result_authorize_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = RunStore(Path(tmp))
            ref = 'runs/' + 'a' * 32
            directory = store.begin('a' * 32, 'trace')
            (directory / 'result.png').write_bytes(b'png')
            (directory / 'recipe.json').write_text('{}')
            (directory / 'metrics.json').write_text('{}')
            sha = hashlib.sha256(b'png').hexdigest()
            with self.assertRaises(ValueError):
                store.read_result(ref, sha)
            store.complete(ref, sha)
            self.assertEqual(store.read_result(ref, sha), b'png')
            (directory / 'result.png').write_bytes(b'tampered')
            with self.assertRaises(ValueError):
                store.read_result(ref, sha)

    def test_invalid_refs_symlink_and_dry_run_preserve_every_byte(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            store = RunStore(root)
            ref = 'runs/' + 'a' * 32
            directory = store.begin('a' * 32, 'trace')
            for name in ('result.png', 'recipe.json', 'metrics.json'):
                (directory / name).write_bytes(b'{}')
            store.complete(ref, hashlib.sha256(b'{}').hexdigest())
            before = {str(p): p.read_bytes() for p in root.rglob('*') if p.is_file()}
            report = plan_retention(root, {'keep_latest': 0}, [ref])
            self.assertTrue(report['dry_run'])
            self.assertNotIn(ref, report['candidates'])
            self.assertEqual(before, {str(p): p.read_bytes() for p in root.rglob('*') if p.is_file()})
            for bad in ('../x', '/runs/' + 'a' * 32, 'runs/../x'):
                with self.assertRaises(ValueError): store.read_result(bad, 'a' * 64)
            (root / 'runs' / ('b' * 32)).symlink_to(directory, target_is_directory=True)
            with self.assertRaises(ValueError): store.read_result('runs/' + 'b' * 32, 'a' * 64)

    def test_saved_metadata_is_not_complete_and_late_cancel_never_seals(self):
        with tempfile.TemporaryDirectory() as tmp:
            engine = Engine(Path(tmp))
            entered, release = threading.Event(), threading.Event()
            def run(job, preview):
                directory = engine.run_store.begin(job.job_id, job.trace_id)
                result = engine._save(directory, job, b'controlled-result', {}, {}, time.perf_counter())
                entered.set(); release.wait(2)
                return result
            manager = JobManager(run)
            try:
                submitted = manager.submit('same', {'_image_operation':'resize'})
                self.assertTrue(entered.wait(1))
                directory = engine.runs / submitted['job_id']
                self.assertTrue((directory / 'metrics.json').is_file())
                self.assertFalse((directory / 'complete.json').exists())
                manager.cancel(submitted['job_id']); release.set()
                self.assertEqual(manager.wait(submitted['job_id'],1)['state'],'canceled')
                self.assertFalse((directory / 'complete.json').exists())
                self.assertEqual(json.loads((directory / 'metrics.json').read_text())['status'],'canceled')
            finally:
                release.set(); manager.close(); engine.close()

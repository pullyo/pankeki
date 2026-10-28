import tempfile
import threading
import unittest
import sqlite3
from unittest.mock import patch
from pathlib import Path

from pankeki.job_store import JobStore
from pankeki.jobs import JobManager


class JobLaneTests(unittest.TestCase):
    def test_cpu_progress_and_shared_final_revision_guard(self):
        entered, release = threading.Event(), threading.Event()
        def run(job, preview):
            if job.lane == 'gpu':
                entered.set()
                release.wait(3)
            return {'revision': job.revision}
        manager = JobManager(run)
        try:
            gpu = manager.submit('same', {})
            self.assertTrue(entered.wait(1))
            cpu = manager.submit('same', {'edit_operation': 'recolor'})
            self.assertEqual(manager.wait(cpu['job_id'], 1)['state'], 'succeeded')
            release.set()
            self.assertEqual(manager.wait(gpu['job_id'], 1)['state'], 'canceled')
        finally:
            release.set()
            manager.close()

    def test_restart_reads_terminal_jobs_without_replay(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'jobs.sqlite'
            store = JobStore(path)
            store.create({'job_id': 'a' * 32, 'session': 's', 'state': 'running'})
            calls = []
            manager = JobManager(lambda *args: calls.append(args), store=store)
            try:
                self.assertEqual(manager.get('a' * 32)['state'], 'orphaned')
                self.assertEqual(calls, [])
                new = manager.submit('s', {})
                self.assertEqual(new['revision'], 2)
                manager.wait(new['job_id'], 1)
            finally:
                manager.close()

    def test_failed_store_transition_does_not_kill_lane_or_publish_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = JobStore(Path(tmp) / 'jobs.sqlite')
            manager = JobManager(lambda job, preview: {'ok': True}, store=store)
            try:
                original = store.transition
                failures = [True, True]
                def transition(*args):
                    if failures:
                        failures.pop()
                        raise sqlite3.OperationalError('controlled database is locked')
                    return original(*args)
                with patch.object(store, 'transition', side_effect=transition):
                    first = manager.submit('first', {})
                    self.assertEqual(manager.wait(first['job_id'], 1)['state'], 'failed')
                second = manager.submit('second', {})
                self.assertEqual(manager.wait(second['job_id'], 1)['state'], 'succeeded')
            finally:
                manager.close()

    def test_lane_capacity_is_independent_and_shutdown_joins_both_workers(self):
        entered, release = threading.Event(), threading.Event()
        def run(job, preview):
            if job.lane == 'gpu':
                entered.set(); release.wait(2)
            return {'ok': True}
        manager = JobManager(run, max_jobs=1)
        try:
            first = manager.submit('gpu', {})
            self.assertTrue(entered.wait(1))
            with self.assertRaisesRegex(ValueError, 'GPU'):
                manager.submit('second-gpu', {})
            cpu = manager.submit('cpu', {'edit_operation': 'recolor'})
            self.assertEqual(manager.wait(cpu['job_id'], 1)['state'], 'succeeded')
        finally:
            release.set(); manager.close()
        self.assertTrue(all(not worker.is_alive() for worker in manager.workers.values()))

    def test_durable_revision_advance_prevents_old_worker_final_commit(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = JobStore(Path(tmp) / 'jobs.sqlite')
            entered, release = threading.Event(), threading.Event()
            sealed = []
            def run(job, preview):
                job.seal = lambda: sealed.append(job.job_id)
                entered.set(); release.wait(2)
                return {'ok':True}
            manager = JobManager(run, store=store)
            try:
                old = manager.submit('same', {})
                self.assertTrue(entered.wait(1))
                store.create({'job_id':'e'*32,'session':'same'})
                release.set()
                self.assertEqual(manager.wait(old['job_id'],1)['state'],'canceled')
                self.assertEqual(sealed,[])
            finally:
                release.set(); manager.close()

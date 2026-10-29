import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest

from pankeki.job_store import JobStore
from pankeki.jobs import JobManager


class JobOwnerLeaseTests(unittest.TestCase):
    def test_live_owner_refuses_second_manager_without_orphaning(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'jobs.sqlite'
            entered, release = threading.Event(), threading.Event()
            def run(job, preview): entered.set(); release.wait(2); return {}
            first = JobManager(run,store=JobStore(path))
            second_store = JobStore(path)
            try:
                item = first.submit('s',{})
                self.assertTrue(entered.wait(1))
                with self.assertRaisesRegex(RuntimeError,'owner'):
                    second_store.mark_orphaned()
                with self.assertRaisesRegex(RuntimeError,'owner'):
                    JobManager(run,store=second_store)
                self.assertEqual(second_store.get(item['job_id'])['state'],'running')
            finally:
                release.set(); first.close(); second_store.close()
            second = JobManager(lambda *args: {},store=JobStore(path))
            second.close()

    def test_real_process_crash_releases_kernel_lease_and_recovers_without_replay(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'jobs.sqlite'
            script = """import json,os,sys,threading
from pankeki.jobs import JobManager
from pankeki.job_store import JobStore
entered=threading.Event()
def run(job,preview):
 entered.set(); threading.Event().wait(60)
manager=JobManager(run,store=JobStore(sys.argv[1]))
job=manager.submit('crash',{})
assert entered.wait(3)
print(json.dumps(job),flush=True)
os._exit(0)
"""
            child = subprocess.run([sys.executable,'-B','-c',script,str(path)],capture_output=True,text=True,timeout=5,check=False)
            self.assertEqual(child.returncode,0,child.stderr)
            job_id = json.loads(child.stdout)['job_id']
            store = JobStore(path)
            self.assertEqual(store.get(job_id)['state'],'running')
            calls = []
            manager = JobManager(lambda *args:calls.append(args),store=store)
            try:
                self.assertEqual(manager.get(job_id)['state'],'orphaned')
                self.assertEqual(calls,[])
            finally: manager.close()

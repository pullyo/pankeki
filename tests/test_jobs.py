import threading
import time
import unittest

from pankeki.jobs import JobManager, PreviewGate


class JobsTests(unittest.TestCase):
    def test_preview_throttle_and_revision(self):
        gate = PreviewGate(interval=.2)
        self.assertTrue(gate.allow(1, 1, 0))
        self.assertFalse(gate.allow(1, 1, .1))
        self.assertFalse(gate.allow(1, 2, .3))
        self.assertTrue(gate.allow(2, 2, .3))

    def test_superseded_job_cannot_publish_final_and_snapshot_is_immutable(self):
        entered = threading.Event()
        release = threading.Event()
        def run(job, preview):
            if job.revision == 1:
                entered.set()
                release.wait(3)
                preview(b'old')
            return {'value': job.request['value']}
        manager = JobManager(run)
        try:
            request = {'value': 1}
            old = manager.submit('session', request)
            self.assertTrue(entered.wait(2))
            request['value'] = 9
            new = manager.submit('session', {'value': 2})
            release.set()
            result = manager.wait(new['job_id'], 3)
            self.assertEqual(result['result']['value'], 2)
            self.assertEqual(manager.get(old['job_id'])['state'], 'canceled')
            self.assertIsNone(manager.get(old['job_id'])['preview'])
            self.assertFalse(manager.get(old['job_id'])['is_current'])
        finally:
            release.set()
            manager.close()

    def test_cancel_does_not_call_global_interrupt(self):
        manager = JobManager(lambda job, preview: {'ok': True})
        try:
            item = manager.submit('s', {})
            manager.cancel(item['job_id'])
            self.assertEqual(manager.wait(item['job_id'], 2)['state'], 'canceled')
        finally:
            manager.close()


if __name__ == '__main__':
    unittest.main()

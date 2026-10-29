"""Video safety, persistence and loopback API tests; no AI inference."""
import hashlib
import http.client
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
import uuid
import subprocess
import sys


class VideoTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(importlib.util.find_spec('pankeki.video_runtime'), 'video runtime is implemented')
        from pankeki.video_runtime import VideoRuntime
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.runtime = VideoRuntime(self.root)
        self.scene = self.root / 'original.blend'
        self.scene.write_bytes(b'BLENDER-v500 scene fixture')
        self.scene_id = self.grant()

    def tearDown(self):
        if hasattr(self, 'temp'):
            self.temp.cleanup()

    def grant(self, **changes):
        scene_id = str(uuid.uuid4())
        directory = self.root / 'runtime/video/scene-grants'
        directory.mkdir(parents=True, exist_ok=True)
        info = self.scene.stat()
        value = {'version': 1, 'scene_path': str(self.scene), 'name': self.scene.name,
                 'size': info.st_size, 'mtime_ns': info.st_mtime_ns,
                 'sha256': hashlib.sha256(self.scene.read_bytes()).hexdigest(), 'created_at': time.time()}
        value.update(changes)
        path = directory / (scene_id + '.json')
        path.write_text(json.dumps(value))
        path.chmod(0o600)
        return scene_id

    def request(self, **changes):
        value = {'scene_id': self.scene_id, 'project_id': 'video-test', 'epoch': 2,
                 'prompt': 'A white ceramic cube in a warm studio.', 'seed': 42}
        value.update(changes)
        return value

    def test_grant_rejects_changed_expired_symlink_and_raw_path_inputs(self):
        from pankeki.video_runtime import VideoError
        self.assertEqual(self.runtime.validate_request(self.request())['scene_sha256'], hashlib.sha256(self.scene.read_bytes()).hexdigest())
        for changes in ({'scene_id': '../outside'}, {'scene_id': self.grant(created_at=time.time()-90000)},
                        {'epoch': True}, {'seed': -1}, {'prompt': ''}, {'scene_path': str(self.scene)}):
            with self.subTest(changes=changes), self.assertRaises(VideoError):
                self.runtime.validate_request(self.request(**changes))
        self.scene.write_bytes(b'changed file')
        with self.assertRaises(VideoError):
            self.runtime.validate_request(self.request())
        self.scene.unlink()
        other = self.root / 'other.blend'
        other.write_bytes(b'scene')
        self.scene.symlink_to(other)
        with self.assertRaises(VideoError):
            self.runtime.validate_request(self.request(scene_id=self.grant()))

    def test_scene_size_matches_desktop_128_mib_limit(self):
        from pankeki.video_runtime import VideoError
        with self.scene.open('wb') as stream:
            stream.truncate(128*1024*1024+1)
        scene_id=self.grant()
        with self.assertRaises(VideoError):
            self.runtime.validate_request(self.request(scene_id=scene_id))

    def test_missing_runtime_reports_honest_readiness(self):
        status = self.runtime.status()
        self.assertFalse(status['ready'])
        self.assertTrue(status['reason'])
        self.assertEqual(status['defaults'], {'width':384,'height':256,'frames':49,'fps':24,'steps':8})

    def test_iso_grant_bigint_mtime_and_sequence_depth_range(self):
        from datetime import datetime, timezone
        import numpy as np
        from pankeki.video_runtime import depth_range
        scene_id = self.grant(mtime_ns=str(self.scene.stat().st_mtime_ns),created_at=datetime.now(timezone.utc).isoformat())
        self.assertEqual(self.runtime.validate_request(self.request(scene_id=scene_id))['scene_id'],scene_id)
        arrays = [np.array([[2.,3.,1e10]],dtype=np.float32),np.array([[4.,6.,1e10]],dtype=np.float32)]
        near,far = depth_range(arrays)
        self.assertAlmostEqual(near,1.92)
        self.assertAlmostEqual(far,6.08)
        levels = [np.clip((far-array)/(far-near),0,1) for array in arrays]
        self.assertEqual(levels[0][0,2],0)
        self.assertEqual(levels[1][0,2],0)
        self.assertGreater(levels[0][0,0],levels[1][0,0])

    def test_owned_child_cancel_waits_for_actual_exit(self):
        from pankeki.video_runtime import VideoCanceled
        directory=self.root/'run'
        directory.mkdir()
        cancel=threading.Event()
        outcome=[]
        def run():
            try:
                self.runtime.run_process([sys.executable,'-c','import time; time.sleep(30)'],directory,'process.log',cancel)
            except VideoCanceled:
                outcome.append('canceled')
        thread=threading.Thread(target=run)
        thread.start()
        deadline=time.monotonic()+2
        process=None
        while time.monotonic()<deadline:
            with self.runtime.owned_lock:
                process=self.runtime.owned.get('run')
            if process:
                break
            time.sleep(.01)
        self.assertIsNotNone(process)
        cancel.set()
        self.runtime.cancel('run')
        thread.join(4)
        self.assertFalse(thread.is_alive())
        self.assertIsNotNone(process.poll())
        self.assertEqual(outcome,['canceled'])

    def test_live_orphan_blocks_gpu_without_killing_it(self):
        from pankeki.video_runtime import VideoError, atomic_json
        process=subprocess.Popen([sys.executable,'-c','import time; time.sleep(5)'])
        try:
            run=self.root/'runtime/video/runs'/uuid.uuid4().hex
            atomic_json(run/'process.json',{'state':'running','pid':process.pid,'start_token':self.runtime.process_start_token(process.pid)})
            with self.assertRaises(VideoError):
                with self.runtime.gate.hold(threading.Event()):
                    self.fail('live orphan must block a new GPU owner')
            self.assertIsNone(process.poll())
        finally:
            process.terminate()
            process.wait(timeout=2)

    def test_gpu_lease_survives_owner_crash_until_inherited_child_exits(self):
        from pankeki.video_runtime import ResourceGate, VideoCanceled
        lease=self.root/'inherited.lock'
        ready=self.root/'child-ready'
        child_code='import pathlib,time; pathlib.Path('+repr(str(ready))+').write_text("ready"); time.sleep(1)'
        parent_code=('import os,subprocess,threading; from pathlib import Path; '
                     'from pankeki.video_runtime import ResourceGate; '
                     'context=ResourceGate(Path('+repr(str(lease))+')).hold(threading.Event()); fd=context.__enter__(); '
                     'subprocess.Popen(['+repr(sys.executable)+',"-c",'+repr(child_code)+'],pass_fds=(fd,)); os._exit(0)')
        parent=subprocess.Popen([sys.executable,'-c',parent_code])
        parent.wait(timeout=2)
        deadline=time.monotonic()+1
        while not ready.exists() and time.monotonic()<deadline:
            time.sleep(.01)
        self.assertTrue(ready.exists())
        cancel=threading.Event()
        timer=threading.Timer(.1,cancel.set)
        timer.start()
        try:
            with self.assertRaises(VideoCanceled):
                with ResourceGate(lease).hold(cancel):
                    self.fail('crashed owner child retains the GPU lease')
        finally:
            timer.join()

    def test_idempotent_submit_and_result_tamper_fail_closed(self):
        from pankeki.video_jobs import VideoJobManager
        from pankeki.video_runtime import VideoError, atomic_json
        entered=threading.Event()
        finish=threading.Event()
        def run(request,directory,cancel,update):
            entered.set()
            finish.wait(2)
            data=b'owned video test fixture'
            (directory/'result.pending.mp4').write_bytes(data)
            result={'ai_generated':True,'full_decode_verified':True,'sha256':hashlib.sha256(data).hexdigest(),
                    'url':f'/api/video/assets/{directory.name}/result.mp4'}
            atomic_json(directory/'verification.json',result)
            return result
        self.runtime.run=run
        manager=VideoJobManager(self.runtime)
        try:
            item=manager.submit(self.request())
            self.assertTrue(entered.wait(1))
            self.assertEqual(manager.submit(self.request())['id'],item['id'])
            with self.assertRaises(VideoError):
                manager.submit(self.request(prompt='different prompt'))
            finish.set()
            self.assertEqual(manager.wait(item['id'],2)['status'],'succeeded')
            self.assertTrue(manager.result(item['id'])['ai_generated'])
            self.assertFalse((manager.runs/item['id']/'result.pending.mp4').exists())
            (manager.runs/item['id']/'result.mp4').write_bytes(b'changed')
            with self.assertRaises(VideoError):
                manager.result(item['id'])
        finally:
            finish.set()
            manager.close()

    def test_accepted_submission_recovers_without_revalidating_grant_after_source_changes(self):
        from unittest.mock import patch
        from pankeki.video_jobs import VideoJobManager
        from pankeki.video_runtime import VideoCanceled, VideoError, atomic_json
        for restart in (False,True):
            for change in ('expired','modified','deleted'):
                with self.subTest(restart=restart,change=change):
                    self.scene.write_bytes(b'BLENDER-v500 scene fixture')
                    scene_id=self.grant()
                    body=self.request(scene_id=scene_id,project_id=f'recover-{restart}-{change}')
                    entered=threading.Event()
                    calls=[]
                    def run(request,directory,cancel,update):
                        calls.append(directory.name)
                        entered.set()
                        cancel.wait(2)
                        raise VideoCanceled('controlled CPU runner stopped')
                    self.runtime.run=run
                    manager=VideoJobManager(self.runtime)
                    try:
                        accepted=manager.submit(body)
                        self.assertTrue(entered.wait(1))
                        if restart:
                            manager.close()
                            # Model a crash journal after stopping our controlled runner.
                            item=manager.jobs[accepted['id']]
                            item.pop('durable_request_sha256',None)
                            item['request_sha256']=hashlib.sha256(json.dumps(item['request'],sort_keys=True,ensure_ascii=False).encode()).hexdigest()
                            item.update(status='running',phase='denoising')
                            atomic_json(manager.journal/(accepted['id']+'.json'),item)
                            manager=VideoJobManager(self.runtime)
                            self.assertEqual(manager.get(accepted['id'])['status'],'orphaned')
                        if change=='expired':
                            path=self.root/'runtime/video/scene-grants'/(scene_id+'.json')
                            grant=json.loads(path.read_text())
                            grant['created_at']=time.time()-90000
                            atomic_json(path,grant)
                        elif change=='modified':
                            self.scene.write_bytes(b'changed source scene')
                        else:
                            self.scene.unlink()
                        with patch.object(self.runtime,'read_grant',wraps=self.runtime.read_grant) as grant_reader:
                            try:
                                recovered=manager.submit(dict(body))
                            except VideoError as exc:
                                self.fail(f'accepted submission recovery revalidated mutable grant: {exc}')
                            self.assertEqual(recovered['id'],accepted['id'])
                            self.assertEqual(grant_reader.call_count,0)
                        self.assertEqual(calls,[accepted['id']],'recovery must not schedule another execution')
                    finally:
                        manager.close()

    def test_gpu_gate_serializes_image_and_video_and_cancels_waiter(self):
        from pankeki.video_runtime import ResourceGate, VideoCanceled
        gate = ResourceGate(self.root / 'gpu.lock')
        cancel = threading.Event()
        entered = threading.Event()
        canceled = threading.Event()
        def waiter():
            try:
                with gate.hold(cancel):
                    entered.set()
            except VideoCanceled:
                canceled.set()
        with gate.hold(threading.Event()):
            thread = threading.Thread(target=waiter)
            thread.start()
            self.assertFalse(entered.wait(.05))
            cancel.set()
            self.assertTrue(canceled.wait(1))
        thread.join(1)
        self.assertFalse(entered.is_set())

    def test_job_persistence_restart_orphans_without_reexecuting(self):
        from pankeki.video_jobs import VideoJobManager
        from pankeki.video_runtime import atomic_json
        jobs = self.root / 'runtime/video/jobs'
        jobs.mkdir(parents=True)
        job_id = uuid.uuid4().hex
        atomic_json(jobs / (job_id + '.json'), {'id':job_id,'status':'running','phase':'denoising',
                    'project_id':'old','epoch':1,'created_at':time.time(),'result_url':None})
        manager = VideoJobManager(self.runtime)
        try:
            item = manager.get(job_id)
            self.assertEqual(item['status'], 'orphaned')
            self.assertIsNone(item['result_url'])
            self.assertFalse(list((self.root/'runtime/video/runs').glob('*')))
        finally:
            manager.close()

    def test_cancel_prevents_publication_and_preserves_original(self):
        from pankeki.video_jobs import VideoJobManager
        from pankeki.video_runtime import VideoCanceled
        entered = threading.Event()
        def run(request, directory, cancel, update):
            entered.set()
            cancel.wait(2)
            raise VideoCanceled('canceled by owner')
        self.runtime.run = run
        manager = VideoJobManager(self.runtime)
        try:
            item = manager.submit(self.request())
            self.assertTrue(entered.wait(1))
            manager.cancel(item['id'])
            item = manager.wait(item['id'], 2)
            self.assertEqual(item['status'], 'canceled')
            self.assertIsNone(item['result_url'])
            self.assertEqual(self.scene.read_bytes(), b'BLENDER-v500 scene fixture')
        finally:
            manager.close()


class VideoHTTPTests(unittest.TestCase):
    def test_unsupported_video_platform_preserves_image_server(self):
        from unittest.mock import patch
        from pankeki.server import make_server
        with tempfile.TemporaryDirectory() as temporary:
            with patch('pankeki.server.VIDEO_SUPPORTED',False,create=True):
                server=make_server(Path(temporary).resolve(),port=0)
            try:
                self.assertIsNone(server.video_manager)
                self.assertIsNotNone(server.manager)
                self.assertIsNotNone(server.engine)
            finally:
                server.server_close()
                server.manager.close()
                server.engine.close()

    def test_status_and_missing_grant_api_preserve_image_jobs(self):
        from pankeki.server import make_server
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            server = make_server(root, port=0)
            thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval':.01}, daemon=True)
            thread.start()
            def request(method, path, value=None, headers=None):
                connection = http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=2)
                try:
                    connection.request(method,path,body=json.dumps(value) if value is not None else None,
                                       headers={'Content-Type':'application/json',**(headers or {})})
                    response=connection.getresponse()
                    return response.status,json.loads(response.read())
                finally:
                    connection.close()
            try:
                code, value = request('GET','/api/video/status')
                self.assertEqual(code,200)
                self.assertFalse(value['ready'])
                code, value = request('POST','/api/video/jobs',{'scene_id':str(uuid.uuid4()),'project_id':'p','epoch':0,'prompt':'scene','seed':42})
                self.assertIn(code,(400,503))
                self.assertEqual(len(server.manager.jobs),0)
                self.assertEqual(request('POST','/api/video/jobs',{},headers={'Origin':'https://outside.invalid'})[0],400)
                self.assertEqual(request('GET','/api/video/assets/'+'0'*32+'/../result.mp4')[0],404)
                from pankeki.video_runtime import atomic_json
                job_id=uuid.uuid4().hex
                directory=server.video_manager.runs/job_id
                directory.mkdir()
                data=b'controlled video bytes for range delivery'
                (directory/'result.mp4').write_bytes(data)
                metadata={'ai_generated':True,'full_decode_verified':True,'sha256':hashlib.sha256(data).hexdigest(),
                          'url':f'/api/video/assets/{job_id}/result.mp4'}
                atomic_json(directory/'verification.json',metadata)
                server.video_manager.jobs[job_id]={'id':job_id,'status':'running','project_id':'fixture','epoch':1}
                self.assertEqual(request('GET',metadata['url'])[0],404,'uncommitted video is unavailable')
                atomic_json(directory/'complete.json',{'job_id':job_id,'verification_sha256':hashlib.sha256((directory/'verification.json').read_bytes()).hexdigest(),
                                                      'result_sha256':metadata['sha256']})
                server.video_manager.jobs[job_id]['status']='succeeded'
                for range_value,expected,expected_code in [('bytes=2-8',data[2:9],206),('bytes=-4',data[-4:],206),('bytes=9999-',b'',416),('bytes=8-2',b'',416)]:
                    connection=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=2)
                    try:
                        connection.request('GET',metadata['url'],headers={'Range':range_value})
                        response=connection.getresponse()
                        self.assertEqual(response.status,expected_code)
                        self.assertEqual(response.read(),expected)
                    finally:
                        connection.close()
            finally:
                server.shutdown()
                server.server_close()
                server.manager.close()
                server.engine.close()
                thread.join(2)


if __name__ == '__main__':
    unittest.main()

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


class VideoUpgradeTests(unittest.TestCase):
    setUp = VideoTests.setUp
    tearDown = VideoTests.tearDown
    grant = VideoTests.grant
    request = VideoTests.request

    def test_named_fullbody_profile_propagates_without_accepting_arbitrary_sizes(self):
        from pankeki.video_runtime import VideoError
        result = self.runtime.validate_request(self.request(profile='fullbody'))
        self.assertEqual({k:result[k] for k in ('width','height','frames','fps','steps')},
                         {'width':384,'height':512,'frames':241,'fps':24,'steps':8})
        self.assertEqual(self.runtime.normalize_request(self.request(profile='preview')), self.runtime.normalize_request(self.request()))
        for changes in ({'profile':'unbounded'}, {'profile':'fullbody','frames':1000}, {'reference_id':'../bad'}):
            with self.subTest(changes=changes), self.assertRaises(VideoError):
                self.runtime.validate_request(self.request(**changes))

    def test_opted_in_reference_is_owned_bound_and_immutable(self):
        import base64, io
        from PIL import Image
        from pankeki.video_runtime import VideoError
        self.assertTrue(hasattr(self.runtime,'create_reference'),'explicit PNG snapshots are not implemented')
        image=Image.new('RGB',(80,160),'orange'); stream=io.BytesIO();image.save(stream,format='PNG')
        raw=stream.getvalue()
        grant=self.runtime.create_reference({'image':'data:image/png;base64,'+base64.b64encode(raw).decode(),
              'project_id':'video-test','epoch':2,'candidate_id':'chosen-one','source_revision':'rev-7'})
        request=self.runtime.validate_request(self.request(profile='fullbody',reference_id=grant['reference_id']))
        directory=self.root/'runtime/video/runs'/('a'*32); directory.mkdir(parents=True)
        prepared=self.runtime.prepare_reference(request,directory)
        self.assertEqual((directory/'reference-original.png').read_bytes(),raw)
        with Image.open(directory/'reference.png') as output:self.assertEqual(output.size,(384,512))
        self.assertEqual(prepared['fit'],'contain'); self.assertEqual(prepared['content_bounds'],[64,0,320,512])
        self.assertEqual(prepared['original_sha256'],hashlib.sha256(raw).hexdigest())
        with self.assertRaises(VideoError):self.runtime.validate_request(self.request(reference_id=grant['reference_id'],epoch=3))
        source=self.runtime.directory/'references'/grant['reference_id']/'source.png';source.write_bytes(b'changed')
        with self.assertRaises(VideoError):self.runtime.validate_request(self.request(reference_id=grant['reference_id']))

    def test_reference_rejects_non_png_oversize_stale_and_symlink(self):
        from pankeki.video_runtime import VideoError
        self.assertTrue(hasattr(self.runtime,'create_reference'),'reference validation is missing')
        for image in ('data:image/jpeg;base64,eA==','data:image/png;base64,%%%%','data:image/png;base64,eA=='):
            with self.subTest(image=image),self.assertRaises(VideoError):
                self.runtime.create_reference({'image':image,'project_id':'video-test','epoch':2,'candidate_id':'one','source_revision':'r'})

    def test_completed_guide_cache_exact_hit_tamper_cancel_and_profile_miss(self):
        from unittest.mock import patch
        from pankeki.video_runtime import VideoCanceled
        self.assertTrue(hasattr(self.runtime,'guide_cache_key'),'completed guide cache is missing')
        request=self.runtime.validate_request(self.request())
        stage=Path(__file__).resolve().parents[1]
        for rel in ('scripts/blender_video_runner.py','pankeki/blender_video.py','pankeki/video_runtime.py','pankeki/video_profiles.py'):
            path=self.root/rel;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes((stage/rel).read_bytes())
        for name in ('blender','ffmpeg','ffprobe'):
            path=self.root/'bin'/name;path.parent.mkdir(exist_ok=True);path.write_bytes(name.encode());setattr(self.runtime,name,path)
        identity=self.runtime.guide_identity(request)
        key=self.runtime.guide_cache_key(request,identity=identity)
        source=self.runtime.directory/'runs'/('a'*32);source.mkdir(parents=True)
        for name in ('guide.mp4','control-depth.mp4'):(source/name).write_bytes(name.encode())
        def verify(path,**kwargs):
            return {**{k:request[k] for k in ('width','height','frames','fps')},'full_decode_verified':True,
                    'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size}
        from pankeki.video_runtime import atomic_json
        atomic_json(source/'guide-verification.json',{'guide':verify(source/'guide.mp4'),'control':verify(source/'control-depth.mp4'),
                    'normalization':{'near':1,'far':2},'scene_sha256':request['scene_sha256'],'cache_key':key,'cache_identity':identity,'profile':'preview'})
        atomic_json(source/'request.json',request)
        target=self.runtime.directory/'runs'/('b'*32);target.mkdir()
        cancel=threading.Event()
        with patch.object(self.runtime,'verify_mp4',side_effect=verify):
            self.assertFalse(self.runtime.publish_guide_cache(source,cancel),'an uncommitted guide is not reusable')
            atomic_json(source/'complete.json',{'job_id':source.name})
            atomic_json(self.runtime.directory/'jobs'/(source.name+'.json'),{'id':source.name,'status':'succeeded'})
            with patch('pankeki.video_runtime.GUIDE_CACHE_LIMIT_COUNT',0):
                self.assertFalse(self.runtime.publish_guide_cache(source,cancel))
            self.assertFalse(self.runtime.publish_guide_cache(source,cancel,commit=lambda publish:False))
            self.assertFalse((self.runtime.directory/'guide-cache'/key).exists())
            self.assertTrue(self.runtime.publish_guide_cache(source,cancel))
            hit=self.runtime.restore_guide_cache(request,target,cancel)
            self.assertTrue(hit);self.assertEqual((target/'control-depth.mp4').read_bytes(),b'control-depth.mp4')
            changed={**request,'scene_sha256':'f'*64}
            self.assertFalse(self.runtime.restore_guide_cache(changed,target,threading.Event()))
            self.assertNotEqual(key,self.runtime.guide_cache_key({**request,'profile':'fullbody','height':512,'frames':241}))
            helper=self.root/'scripts/blender_video_runner.py';helper.write_text('changed renderer source')
            self.assertFalse(self.runtime.restore_guide_cache(request,target,threading.Event()))
            helper.write_bytes((stage/'scripts/blender_video_runner.py').read_bytes())
            journal=self.runtime.directory/'jobs'/(source.name+'.json')
            atomic_json(journal,{'id':source.name,'status':'canceled'})
            self.assertFalse(self.runtime.restore_guide_cache(request,target,threading.Event()))
            atomic_json(journal,{'id':source.name,'status':'succeeded'})
            cache=self.runtime.directory/'guide-cache'/key
            (cache/'control-depth.mp4').write_bytes(b'corrupt')
            self.assertFalse(self.runtime.restore_guide_cache(request,target,threading.Event()))
            cancel.set()
            with self.assertRaises(VideoCanceled):self.runtime.restore_guide_cache(request,target,cancel)


    def test_runner_rejects_unowned_reference_and_arbitrary_cli_fields(self):
        import importlib.util
        spec=importlib.util.spec_from_file_location('owned_video_runner',Path(__file__).resolve().parents[1]/'scripts/pankeki_video_runner.py')
        runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
        directory=self.root/'runtime/video/runs'/('b'*32);directory.mkdir(parents=True)
        control=directory/'control-depth.mp4';control.write_bytes(b'control')
        body={'root':str(self.root),'prompt':'A fullbody dance.','seed':42,'profile':'fullbody',
              'width':384,'height':512,'frames':241,'fps':24,'steps':8,
              'control_sha256':hashlib.sha256(control.read_bytes()).hexdigest()}
        path=directory/'ltx-request.json';path.write_text(json.dumps(body))
        command,profile=runner.build_command(path,self.root)
        self.assertEqual(profile,'fullbody');self.assertEqual(command[command.index('-f')+1],'241')
        self.assertNotIn('--image',command)
        for changes in ({'frames':242},{'width':768},{'extra_cli':['--arbitrary']},{'reference':{'prepared_sha256':'a'*64}}):
            path.write_text(json.dumps({**body,**changes}))
            with self.subTest(changes=changes),self.assertRaises(ValueError):runner.build_command(path,self.root)

    def test_fullbody_guide_uses_exact_241_frames_and_cache_hit_skips_render(self):
        from unittest.mock import patch
        from pankeki.blender_video import GuideRequest,GuideError
        from pankeki.video_runtime import atomic_json
        GuideRequest(self.scene,'project',1,start=1,end=241,fps=24,width=384,height=512).validate()
        with self.assertRaises(GuideError):GuideRequest(self.scene,'project',1,start=1,end=242).validate()
        request=self.runtime.validate_request(self.request(profile='fullbody'))
        directory=self.root/'runtime/video/runs'/('c'*32);directory.mkdir(parents=True)
        verification={'guide':{'sha256':'a'*64},'control':{'sha256':'b'*64},'normalization':{'near':1,'far':2}}
        def cache_hit(*args,**kwargs):atomic_json(directory/'guide-verification.json',verification);return {'hit':True}
        with patch.object(self.runtime,'restore_guide_cache',side_effect=cache_hit),patch('pankeki.video_runtime.BlenderGuideJob') as render:
            result,cache=self.runtime.prepare_guide(request,directory,threading.Event(),lambda **changes:None)
            self.assertEqual(result,verification);self.assertTrue(cache['hit']);render.assert_not_called()

    def test_fullbody_verify_uses_requested_frame_count_and_dimensions(self):
        from unittest.mock import patch
        from pankeki.video_runtime import VideoError
        path=self.root/'test.mp4';path.write_bytes(b'video')
        probe={'streams':[{'codec_type':'video','codec_name':'h264','width':384,'height':512,'nb_read_frames':'241','avg_frame_rate':'24/1'}],
               'format':{'duration':str(241/24)}}
        def process(command,**kwargs):
            return subprocess.CompletedProcess(command,0,json.dumps(probe).encode() if '-show_streams' in command else b'',b'')
        with patch('pankeki.video_runtime.subprocess.run',side_effect=process):
            self.assertEqual(self.runtime.verify_mp4(path,profile='fullbody')['frames'],241)
            with self.assertRaises(VideoError):self.runtime.verify_mp4(path)
            probe['streams'][0]['nb_read_frames']='240'
            with self.assertRaises(VideoError):self.runtime.verify_mp4(path,profile='fullbody')


    def test_fullbody_pipeline_binds_profile_reference_and_monotonic_phases(self):
        from unittest.mock import patch
        from pankeki.video_runtime import atomic_json
        import io,base64
        from PIL import Image
        stream=io.BytesIO();Image.new('RGB',(40,80),'green').save(stream,format='PNG')
        grant=self.runtime.create_reference({'image':'data:image/png;base64,'+base64.b64encode(stream.getvalue()).decode(),
                    'project_id':'video-test','epoch':2,'candidate_id':'chosen','source_revision':'r'})
        request=self.runtime.validate_request(self.request(profile='fullbody',reference_id=grant['reference_id']))
        directory=self.runtime.directory/'runs'/('d'*32);directory.mkdir(parents=True)
        guide={'guide':{'sha256':'a'*64},'control':{'sha256':'b'*64},'normalization':{'near':1,'far':2}}
        calls=[];updates=[]
        def process(command,directory,logfile,cancel,**kwargs):
            calls.append((command,logfile,kwargs))
            if logfile=='inference.log':
                (directory/'inference.log').write_text('[Loading transformer] done\nDenoising: 100%| | 8/8\n')
                (directory/'raw.mp4').write_bytes(b'raw video')
            elif logfile=='silent-remux.log':(directory/'result.pending.mp4').write_bytes(b'final video')
        def verify(path,**kwargs):
            self.assertEqual(kwargs.get('profile'),'fullbody')
            return {'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'full_decode_verified':True,
                    **{key:request[key] for key in ('width','height','frames','fps')}}
        with patch.object(self.runtime,'status',return_value={'ready':True}),patch.object(self.runtime,'prepare_guide',return_value=(guide,{'hit':False})),\
             patch.object(self.runtime,'comfy_queue',return_value=0),patch.object(self.runtime,'memory_preflight') as memory,\
             patch.object(self.runtime,'run_process',side_effect=process),patch.object(self.runtime,'verify_mp4',side_effect=verify):
            result=self.runtime.run(request,directory,threading.Event(),lambda **value:updates.append(value))
        self.assertEqual(memory.call_args.kwargs['profile'],'fullbody');self.assertIn('cancel',memory.call_args.kwargs)
        execution=json.loads((directory/'ltx-request.json').read_text())
        self.assertEqual(execution['frames'],241);self.assertEqual(execution['profile'],'fullbody')
        self.assertEqual(execution['reference']['reference_id'],grant['reference_id'])
        self.assertEqual(result['reference']['fit'],'contain');self.assertEqual(result['frames'],241)
        self.assertEqual(set(result['phase_timings_s']),{'reference_prepare','guide_prepare','gpu_lease_and_queue_wait','memory_preflight','engine_load_denoise_decode_mux','result_verify'})
        self.assertTrue(all(value>=0 for value in result['phase_timings_s'].values()))
        self.assertEqual(len([value for value in calls if value[1]=='inference.log']),1)

    def test_reference_expiry_symlink_and_size_limits_fail_closed(self):
        import io,base64
        from PIL import Image
        from pankeki.video_runtime import VideoError,atomic_json
        stream=io.BytesIO();Image.new('RGB',(8,8),'red').save(stream,format='PNG')
        body={'image':'data:image/png;base64,'+base64.b64encode(stream.getvalue()).decode(),
              'project_id':'video-test','epoch':2,'candidate_id':'chosen','source_revision':'r'}
        grant=self.runtime.create_reference(body);directory=self.runtime.directory/'references'/grant['reference_id']
        manifest=json.loads((directory/'manifest.json').read_text());manifest['created_at']=time.time()-90000
        atomic_json(directory/'manifest.json',manifest)
        with self.assertRaises(VideoError):self.runtime.read_reference(grant['reference_id'],self.request())
        manifest['created_at']=time.time();atomic_json(directory/'manifest.json',manifest)
        source=directory/'source.png';source.unlink();source.symlink_to(self.scene)
        with self.assertRaises(VideoError):self.runtime.read_reference(grant['reference_id'],self.request())
        with self.assertRaises(VideoError):self.runtime.create_reference({**body,'image':'data:image/png;base64,'+'A'*(16*1024**2)})


    def test_fullbody_memory_guard_stops_critical_or_sustained_pressure(self):
        from pankeki.video_runtime import VideoError
        self.assertTrue(hasattr(self.runtime,'check_memory_guard'),'fullbody guard must match the reviewed local execution')
        self.assertEqual(self.runtime.check_memory_guard({'pressure_level':1,'reported_free_percent':60},2),0)
        self.assertEqual(self.runtime.check_memory_guard({'pressure_level':2,'reported_free_percent':30},0),1)
        with self.assertRaises(VideoError):self.runtime.check_memory_guard({'pressure_level':4,'reported_free_percent':60},0)
        with self.assertRaises(VideoError):self.runtime.check_memory_guard({'pressure_level':1,'reported_free_percent':20},2)


    def test_fullbody_render_and_depth_command_propagate_named_contract(self):
        from unittest.mock import patch
        import numpy as np
        request=self.runtime.validate_request(self.request(profile='fullbody'))
        directory=self.runtime.directory/'runs'/('e'*32);directory.mkdir(parents=True)
        captured={}
        class FakeGuide:
            def __init__(inner,request,output_dir,**options):
                captured['request']=request;inner.output_dir=output_dir;inner.request=request
            def prepare(inner):
                inner.request.validate();inner.output_dir.mkdir();(inner.output_dir/'scene.blend').write_bytes(self.scene.read_bytes())
            def run(inner):(inner.output_dir/'guide.mp4').write_bytes(b'guide');return {'camera_clip_start':.1,'camera_clip_end':100}
        def run_process(command,*args,**kwargs):
            captured['command']=command;(directory/'control-depth.mp4').write_bytes(b'control')
        def verify(path,**kwargs):
            self.assertEqual(kwargs['profile'],'fullbody')
            return {'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),**{key:request[key] for key in ('width','height','frames','fps')}}
        def depth(path,size):
            self.assertEqual(size,(384,512));return np.array([[1.,2.],[3.,1e10]],dtype=np.float32)
        with patch.object(self.runtime,'restore_guide_cache',return_value=False),patch('pankeki.video_runtime.BlenderGuideJob',FakeGuide),\
             patch.object(self.runtime,'run_process',side_effect=run_process),patch.object(self.runtime,'verify_mp4',side_effect=verify),\
             patch('pankeki.video_runtime.read_depth',side_effect=depth) as read:
            verification,cache=self.runtime.prepare_guide(request,directory,threading.Event(),lambda **changes:None)
        self.assertEqual(captured['request'].end,241);self.assertEqual(captured['request'].height,512)
        command=captured['command'];self.assertEqual(command[command.index('-frames:v')+1],'241')
        self.assertEqual(command[command.index('-framerate')+1],'24');self.assertEqual(read.call_count,482)
        self.assertEqual(len(list((directory/'depth-png').glob('*.png'))),241)
        self.assertFalse(cache['hit']);self.assertEqual(verification['profile'],'fullbody')


    def test_legacy_journal_public_profile_remains_preview_after_restart(self):
        from pankeki.video_jobs import VideoJobManager
        manager=VideoJobManager.__new__(VideoJobManager)
        legacy={'id':'a'*32,'status':'succeeded','project_id':'old','epoch':2,'request':{'scene_id':self.scene_id},'elapsed_seconds':2}
        self.assertEqual(manager._public(legacy)['profile'],'preview')
        self.assertIsNone(manager._public(legacy)['reference_id'])
        fullbody={**legacy,'request':{'profile':'fullbody','reference_id':str(uuid.uuid4())}}
        self.assertEqual(manager._public(fullbody)['profile'],'fullbody')
        self.assertEqual(manager._public(fullbody)['reference_id'],fullbody['request']['reference_id'])


    def test_slow_cache_publish_does_not_hold_job_state_lock(self):
        from pankeki.video_jobs import VideoJobManager
        from pankeki.video_runtime import atomic_json
        entered,release,polled=threading.Event(),threading.Event(),threading.Event()
        def run(request,directory,cancel,update):
            (directory/'result.pending.mp4').write_bytes(b'fake video')
            result={'ai_generated':True,'full_decode_verified':True,'sha256':hashlib.sha256(b'fake video').hexdigest(),'url':f'/api/video/assets/{directory.name}/result.mp4'}
            atomic_json(directory/'verification.json',result);return result
        def publish(*args,**kwargs):entered.set();release.wait(3);return False
        self.runtime.run=run;self.runtime.publish_guide_cache=publish
        manager=VideoJobManager(self.runtime)
        try:
            item=manager.submit(self.request());self.assertTrue(entered.wait(2))
            reader=threading.Thread(target=lambda:(manager.get(item['id']),polled.set()));reader.start()
            self.assertTrue(polled.wait(.3),'polling must remain responsive while cache decode/copy is blocked')
        finally:
            release.set();manager.close()


    def test_memory_probe_cancel_and_timeout_are_bounded_and_classified(self):
        from pankeki.video_runtime import VideoCanceled,VideoError
        self.assertTrue(hasattr(self.runtime,'probe_command'),'memory probes need a cancel-aware owned child')
        cancel=threading.Event();threading.Timer(.15,cancel.set).start();began=time.monotonic()
        with self.assertRaises(VideoCanceled):self.runtime.probe_command([sys.executable,'-c','import time; time.sleep(30)'],cancel=cancel,timeout=5)
        self.assertLess(time.monotonic()-began,1.5)
        with self.assertRaisesRegex(VideoError,'시간'):
            self.runtime.probe_command([sys.executable,'-c','import time; time.sleep(30)'],cancel=threading.Event(),timeout=.05)

    def test_reference_namespace_limits_and_expiry_never_delete_foreign_artifacts(self):
        from unittest.mock import patch
        import io,base64
        from PIL import Image
        from pankeki.video_runtime import VideoError,atomic_json
        stream=io.BytesIO();Image.new('RGB',(8,8),'red').save(stream,format='PNG')
        body={'image':'data:image/png;base64,'+base64.b64encode(stream.getvalue()).decode(),'project_id':'p','epoch':1,'candidate_id':'c','source_revision':'r'}
        grant=self.runtime.create_reference(body);base=self.runtime.directory/'references'
        foreign=base/str(uuid.uuid4());foreign.mkdir();(foreign/'user-note.txt').write_text('preserve')
        with patch('pankeki.video_runtime.REFERENCE_LIMIT_COUNT',2):
            with self.assertRaises(VideoError):self.runtime.create_reference(body)
        owned=base/grant['reference_id'];manifest=json.loads((owned/'manifest.json').read_text());manifest['created_at']=time.time()-90000
        atomic_json(owned/'manifest.json',manifest)
        with patch('pankeki.video_runtime.REFERENCE_LIMIT_COUNT',2):new=self.runtime.create_reference(body)
        self.assertNotEqual(new['reference_id'],grant['reference_id']);self.assertFalse(owned.exists());self.assertEqual((foreign/'user-note.txt').read_text(),'preserve')
        with patch('pankeki.video_runtime.REFERENCE_LIMIT_BYTES',1):
            with self.assertRaises(VideoError):self.runtime.create_reference(body)

    def test_reference_exact_12_mib_png_payload_accepts_prefix_and_rejects_one_byte_over(self):
        import base64,io
        from PIL import Image,PngImagePlugin
        from pankeki.video_runtime import VideoError
        def png(size):
            stream=io.BytesIO();Image.new('RGB',(1,1),'red').save(stream,format='PNG');base=len(stream.getvalue())
            info=PngImagePlugin.PngInfo();info.add(b'tEXt',b'padding\0'+b'0'*(size-base-12-8))
            stream=io.BytesIO();Image.new('RGB',(1,1),'red').save(stream,format='PNG',pnginfo=info)
            self.assertEqual(len(stream.getvalue()),size);return stream.getvalue()
        body={'project_id':'p','epoch':1,'candidate_id':'c','source_revision':'r'}
        exact=png(12*1024**2);grant=self.runtime.create_reference({**body,'image':'data:image/png;base64,'+base64.b64encode(exact).decode()})
        self.assertEqual(self.runtime.read_reference(grant['reference_id'])['bytes'],12*1024**2)
        with self.assertRaises(VideoError):self.runtime.create_reference({**body,'image':'data:image/png;base64,'+base64.b64encode(png(12*1024**2+1)).decode()})


    def test_render_identity_uses_loaded_sources_snapshot_helper_and_tool_bytes(self):
        from unittest.mock import patch
        from pankeki.video_runtime import sha256,VideoError
        from pankeki.blender_video import GuideRequest
        import numpy as np
        helper=self.root/'scripts/blender_video_runner.py';helper.parent.mkdir();helper.write_bytes(b'fixed helper source')
        for name in ('blender','ffmpeg','ffprobe'):
            path=self.root/'bin'/name;path.parent.mkdir(exist_ok=True);path.write_bytes(name.encode());setattr(self.runtime,name,path)
        request=self.runtime.validate_request(self.request())
        identity=self.runtime.guide_identity(request);frozen=self.runtime.guide_cache_key(request,identity=identity)
        changed_source=self.root/'pankeki/video_runtime.py';changed_source.parent.mkdir();changed_source.write_bytes(b'new disk source after import')
        self.assertNotEqual(sha256(changed_source),identity['loaded_source_sha256']['pankeki/video_runtime.py'])
        self.assertEqual(self.runtime.guide_cache_key(request),frozen,'disk source cannot relabel loaded Python code')
        directory=self.runtime.directory/'runs'/('e'*32);directory.mkdir(parents=True)
        class FakeGuide:
            def __init__(inner,request,output_dir,**kwargs):inner.request=request;inner.output_dir=output_dir
            def prepare(inner):inner.output_dir.mkdir();(inner.output_dir/'scene.blend').write_bytes(self.scene.read_bytes())
            def run(inner):
                self.assertEqual(inner.runner.read_bytes(),b'fixed helper source');helper.write_bytes(b'changed while rendering')
                (inner.output_dir/'guide.mp4').write_bytes(b'guide');return {}
        def process(*args,**kwargs):(directory/'control-depth.mp4').write_bytes(b'control')
        def verify(path,**kwargs):return {'sha256':sha256(path)}
        with patch('pankeki.video_runtime.BlenderGuideJob',FakeGuide),patch.object(self.runtime,'verify_mp4',side_effect=verify),\
             patch.object(self.runtime,'run_process',side_effect=process),patch('pankeki.video_runtime.read_depth',return_value=np.array([[1.,2.]],dtype=np.float32)):
            verification,_=self.runtime.prepare_guide(request,directory,threading.Event(),lambda **changes:None)
        self.assertEqual(verification['cache_key'],frozen);self.assertEqual(verification['cache_identity'],identity)
        self.assertNotEqual(self.runtime.guide_cache_key(request),frozen)
        helper.write_bytes(b'fixed helper source');self.runtime.ffmpeg.write_bytes(b'new encoder binary')
        self.assertNotEqual(self.runtime.guide_cache_key(request),frozen)

    def test_expired_cache_cleanup_is_owned_only_and_capacity_is_bounded(self):
        from unittest.mock import patch
        from pankeki.video_runtime import VideoError,atomic_json
        base=self.runtime.directory/'guide-cache';owned=base/('a'*64);owned.mkdir(parents=True)
        atomic_json(owned/'manifest.json',{'owner':'pankeki-video-runtime-v1','schema':'pankeki.completed-guide.v1','cache_key':owned.name,'created_at':time.time()-8*24*3600})
        (owned/'guide.mp4').write_bytes(b'owned guide')
        foreign=base/('b'*64);foreign.mkdir();(foreign/'user.blend').write_bytes(b'original user data')
        self.runtime.storage_usage('guide-cache');self.assertFalse(owned.exists());self.assertEqual((foreign/'user.blend').read_bytes(),b'original user data')
        with patch('pankeki.video_runtime.GUIDE_CACHE_LIMIT_BYTES',1):
            with self.assertRaises(VideoError):self.runtime.admit_storage('guide-cache',2)


    def test_optional_cache_subprocess_and_metadata_failures_preserve_committed_video(self):
        from unittest.mock import patch
        from pankeki.video_runtime import atomic_json
        from pankeki.video_jobs import VideoJobManager
        errors=[subprocess.CalledProcessError(1,['ffprobe']),subprocess.TimeoutExpired(['ffmpeg'],60),RuntimeError('unexpected optional cache error')]
        for index,error in enumerate(errors):
            with self.subTest(error=type(error).__name__):
                runtime=type(self.runtime)(self.root/str(index))
                runtime.directory.mkdir(parents=True)
                # Validation remains the real source-grant validation on our temp fixture.
                runtime.validate_request=self.runtime.validate_request
                def run(request,directory,cancel,update):
                    data=b'committed result';(directory/'result.pending.mp4').write_bytes(data)
                    result={'ai_generated':True,'full_decode_verified':True,'sha256':hashlib.sha256(data).hexdigest(),'url':f'/api/video/assets/{directory.name}/result.mp4'}
                    atomic_json(directory/'verification.json',result);return result
                runtime.run=run
                with patch.object(runtime,'publish_guide_cache',side_effect=error):
                    manager=VideoJobManager(runtime)
                    try:
                        item=manager.submit(self.request());done=manager.wait(item['id'],2)
                        self.assertEqual(done['status'],'succeeded');self.assertTrue(manager.result(item['id'])['ai_generated'])
                        self.assertIn(type(error).__name__,done['guide_cache_error'])
                    finally:manager.close()
        runtime=type(self.runtime)(self.root/'metadata-failure');runtime.directory.mkdir(parents=True)
        runtime.validate_request=self.runtime.validate_request;runtime.run=run;runtime.publish_guide_cache=lambda *args,**kwargs:False
        manager=VideoJobManager(runtime);save=manager._save
        def save_optional(item):
            if item.get('guide_cache_publish')=='skipped':raise OSError('optional metadata write unavailable')
            return save(item)
        manager._save=save_optional
        try:
            item=manager.submit(self.request());done=manager.wait(item['id'],2)
            self.assertEqual(done['status'],'succeeded');self.assertTrue(manager.result(item['id'])['ai_generated'])
        finally:manager.close()


class VideoReferenceHandlerTests(unittest.TestCase):
    """Exercise the real Handler without an Engine, server, socket, or GPU."""
    def setUp(self):
        import ast
        from types import SimpleNamespace
        import pankeki.server as module
        from pankeki.video_runtime import VideoRuntime
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name).resolve();self.runtime=VideoRuntime(self.root)
        tree=ast.parse(Path(module.__file__).read_text())
        handler=next(node for node in ast.walk(tree) if isinstance(node,ast.ClassDef) and node.name=='Handler')
        namespace={**vars(module),'root':self.root,'video_manager':SimpleNamespace(runtime=self.runtime)}
        exec(compile(ast.Module(body=[handler],type_ignores=[]),module.__file__,'exec'),namespace)
        self.handler=namespace['Handler']
    def tearDown(self):self.temp.cleanup()
    def request(self,method,path,body=None,origin='http://127.0.0.1:8190'):
        from types import SimpleNamespace
        from email.message import Message
        import io
        request=self.handler.__new__(self.handler)
        raw=json.dumps(body).encode() if body is not None else b''
        request.rfile=io.BytesIO(raw);request.wfile=io.BytesIO();request.path=path
        request.server=SimpleNamespace(server_port=8190);request.connection=SimpleNamespace(gettimeout=lambda:None,settimeout=lambda value:None)
        request.headers=Message();request.headers['Host']='127.0.0.1:8190';request.headers['Origin']=origin
        request.headers['Content-Type']='application/json';request.headers['Content-Length']=str(len(raw))
        request.request_version='HTTP/1.1';request.requestline=method+' '+path+' HTTP/1.1';request.command=method
        getattr(request,'do_'+method)()
        headers,data=request.wfile.getvalue().split(b'\r\n\r\n',1)
        return int(headers.split(b' ')[1]),data
    def test_same_origin_reference_api_rejects_foreign_upload_and_serves_verified_png(self):
        import base64,io
        from PIL import Image
        stream=io.BytesIO();Image.new('RGB',(8,16),'blue').save(stream,format='PNG');raw=stream.getvalue()
        body={'image':'data:image/png;base64,'+base64.b64encode(raw).decode(),'project_id':'p','epoch':1,'candidate_id':'c','source_revision':'r'}
        status,_=self.request('POST','/api/video/references',body,origin='https://outside.invalid')
        self.assertEqual(status,400);self.assertFalse((self.runtime.directory/'references').exists())
        status,data=self.request('POST','/api/video/references',body)
        self.assertEqual(status,201);reference=json.loads(data)
        self.assertNotIn('image',reference);self.assertNotIn('path',reference)
        route='/api/video/references/'+reference['reference_id']+'/source.png'
        self.assertEqual(self.request('GET',route),(200,raw))
        source=self.runtime.directory/'references'/reference['reference_id']/'source.png';source.write_bytes(b'corrupt')
        self.assertEqual(self.request('GET',route)[0],400)


if __name__ == '__main__':
    unittest.main()

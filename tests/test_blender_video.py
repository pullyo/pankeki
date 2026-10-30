import json
from pathlib import Path
import sys
import struct
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import runpy
from PIL import Image

from pankeki.blender_video import GuideRequest, GuideError, BlenderGuideJob, exr_channels, sha256


class BlenderVideoTests(unittest.TestCase):
    def frame_fixture(self, job, *, png_size=(512, 288), exr_size=(512, 288)):
        for kind in ('rgb', 'depth'):
            (job.output_dir / kind).mkdir()
        Image.new('RGB', png_size).save(job.output_dir / 'rgb/000001.png')
        def attribute(name, kind, value):
            return name + b'\0' + kind + b'\0' + struct.pack('<I', len(value)) + value
        channels = b'ViewLayer.Depth.Z\0' + struct.pack('<iB3xii', 2, 0, 1, 1) + b'\0'
        window = struct.pack('<iiii', 0, 0, exr_size[0] - 1, exr_size[1] - 1)
        header = attribute(b'channels', b'chlist', channels)
        header += attribute(b'dataWindow', b'box2i', window) + attribute(b'displayWindow', b'box2i', window)
        (job.output_dir / 'depth/000001.exr').write_bytes(b'v/1\x01' + struct.pack('<I', 2) + header + b'\0')

    def test_cancel_during_final_hash_cannot_publish_completed_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            job = BlenderGuideJob(self.request(root, end=1), root / 'job', blender=Path(sys.executable))
            job.prepare()
            self.frame_fixture(job)
            (job.output_dir / 'render-info.json').write_text('{}')
            (job.output_dir / 'guide.mp4').write_bytes(b'fake-encoder-output' * 4)
            hashing, release = threading.Event(), threading.Event()
            errors = []
            def paused_hash(path):
                if Path(path).name == 'guide.mp4':
                    hashing.set()
                    if not release.wait(3):
                        raise RuntimeError('test synchronization timeout')
                return sha256(path)
            def run():
                try:
                    job.run()
                except GuideError as exc:
                    errors.append(str(exc))
            with patch.object(job, '_run_process', return_value=0), patch('pankeki.blender_video.sha256', paused_hash):
                thread = threading.Thread(target=run)
                thread.start()
                try:
                    self.assertTrue(hashing.wait(3))
                    job.cancel()
                finally:
                    release.set()
                    thread.join(3)
            self.assertFalse(thread.is_alive())
            self.assertFalse((job.output_dir / 'manifest.json').exists())
            self.assertEqual(json.loads((job.output_dir / 'status.json').read_text())['state'], 'canceled')
            self.assertTrue(errors)

    def test_actual_png_and_exr_windows_must_match_requested_dimensions(self):
        for png_size, exr_size in (((256, 144), (512, 288)), ((512, 288), (256, 144))):
            with self.subTest(png=png_size, exr=exr_size), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                job = BlenderGuideJob(self.request(root, end=1), root / 'job', blender=Path(sys.executable))
                job.prepare()
                self.frame_fixture(job, png_size=png_size, exr_size=exr_size)
                with self.assertRaisesRegex(GuideError, 'dimensions|window'):
                    job.verify_frames()

    def test_cancel_after_commit_started_waits_and_reports_already_completed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            job = BlenderGuideJob(self.request(root, end=1), root / 'job', blender=Path(sys.executable))
            job.prepare()
            self.frame_fixture(job)
            (job.output_dir / 'render-info.json').write_text('{}')
            (job.output_dir / 'guide.mp4').write_bytes(b'fake-encoder-output' * 4)
            publishing, release = threading.Event(), threading.Event()
            atomic_json = job._atomic_json
            def paused_publish(name, value):
                if name == 'manifest.json':
                    publishing.set()
                    if not release.wait(3):
                        raise RuntimeError('test synchronization timeout')
                atomic_json(name, value)
            accepted = []
            with patch.object(job, '_run_process', return_value=0), patch.object(job, '_atomic_json', paused_publish):
                runner = threading.Thread(target=job.run)
                runner.start()
                self.assertTrue(publishing.wait(3))
                canceler = threading.Thread(target=lambda: accepted.append(job.cancel()))
                canceler.start()
                try:
                    canceler.join(.05)
                    self.assertTrue(canceler.is_alive())
                finally:
                    release.set()
                    runner.join(3)
                    canceler.join(3)
            self.assertEqual(accepted, [False])
            self.assertFalse(job._cancel.is_set())
            self.assertEqual(json.loads((job.output_dir / 'manifest.json').read_text())['state'], 'completed')

    def test_runner_rejects_disk_point_cache_before_render(self):
        with tempfile.TemporaryDirectory() as tmp:
            bpy, scene, request = self.runner_fixture(Path(tmp))
            class EmptyPointCache(SimpleNamespace):
                def __bool__(self):
                    return False  # Blender RNA can be falsey despite having settings.
            cache = EmptyPointCache(use_disk_cache=True, use_external=False, filepath='')
            bpy.data.objects.append(SimpleNamespace(modifiers=[SimpleNamespace(point_cache=cache)], particle_systems=[]))
            with patch.dict(sys.modules, {'bpy': bpy}), patch.object(sys, 'argv', ['runner', '--', str(request)]):
                runner = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/blender_video_runner.py'))
                with self.assertRaisesRegex(RuntimeError, 'external scene dependencies'):
                    runner['main']()

    def runner_fixture(self, root, external_paths=()):
        scene = SimpleNamespace(camera=SimpleNamespace(type='CAMERA', name='camera'),
            render=SimpleNamespace(image_settings=SimpleNamespace(), use_border=True, use_crop_to_border=True, use_multiview=True),
            cycles=SimpleNamespace(), view_settings=SimpleNamespace(),
            view_layers=[SimpleNamespace(name='ViewLayer')], frame_set=lambda frame: None)
        def render(**kwargs):
            raise RuntimeError('render boundary reached')
        data = SimpleNamespace(**{name: [] for name in ('libraries', 'images', 'movieclips', 'sounds', 'cache_files', 'volumes', 'fonts', 'objects', 'particles')})
        bpy = SimpleNamespace(context=SimpleNamespace(scene=scene), data=data,
            utils=SimpleNamespace(blend_paths=lambda **kwargs: list(external_paths)),
            ops=SimpleNamespace(wm=SimpleNamespace(open_mainfile=lambda **kwargs: None), render=SimpleNamespace(render=render)))
        request = root / 'request.json'
        request.write_text(json.dumps(dict(scene_path=str(root / 'scene.blend'), camera=None, width=512, height=288, fps=12, start=1, end=1)))
        return bpy, scene, request

    def test_runner_disables_inherited_crop_and_multiview_before_render(self):
        with tempfile.TemporaryDirectory() as tmp:
            bpy, scene, request = self.runner_fixture(Path(tmp))
            with patch.dict(sys.modules, {'bpy': bpy}), patch.object(sys, 'argv', ['runner', '--', str(request)]):
                runner = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/blender_video_runner.py'))
                with self.assertRaisesRegex(RuntimeError, 'render boundary reached'):
                    runner['main']()
            self.assertFalse(scene.render.use_border)
            self.assertFalse(scene.render.use_crop_to_border)
            self.assertFalse(scene.render.use_multiview)

    def test_runner_rejects_external_file_dependencies_before_render(self):
        for filename in ('smoke.vdb', 'font.ttf', 'cache.abc'):
            with self.subTest(filename=filename), tempfile.TemporaryDirectory() as tmp:
                bpy, scene, request = self.runner_fixture(Path(tmp), ['/outside/' + filename])
                with patch.dict(sys.modules, {'bpy': bpy}), patch.object(sys, 'argv', ['runner', '--', str(request)]):
                    runner = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/blender_video_runner.py'))
                    with self.assertRaisesRegex(RuntimeError, 'external scene dependencies'):
                        runner['main']()

    def request(self, root, **changes):
        scene = root / 'scene.blend'
        scene.write_bytes(b'BLENDER-test')
        values = dict(scene_path=scene, project_id='project-a', epoch=2,
                      start=1, end=12, fps=12, width=512, height=288)
        values.update(changes)
        return GuideRequest(**values)

    def test_multipart_exr_depth_in_second_part_is_detected(self):
        def header(channel):
            value = channel.encode() + b'\0' + struct.pack('<iB3xii', 2, 0, 1, 1) + b'\0'
            return b'channels\0chlist\0' + struct.pack('<I', len(value)) + value + b'\0'
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'depth.exr'
            path.write_bytes(b'v/1\x01' + struct.pack('<I', 0x1002) +
                             header('ViewLayer.Combined.R') + header('ViewLayer.Depth.Z') + b'\0')
            self.assertIn('ViewLayer.Depth.Z', exr_channels(path))
            path.write_bytes(b'v/1\x01' + struct.pack('<I', 2) + header('ViewLayer.Combined.R'))
            self.assertNotIn('ViewLayer.Depth.Z', exr_channels(path))

    def test_resource_bounds_reject_before_creating_job(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for changes in ({'end': 242}, {'width': 1282}, {'fps': 0},
                            {'start': 8, 'end': 2}, {'height': 289}, {'epoch': -1}):
                with self.subTest(changes=changes), self.assertRaises(GuideError):
                    self.request(root, **changes).validate()

    def test_scene_is_snapshotted_and_source_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            request = self.request(root)
            job = BlenderGuideJob(request, root / 'job', blender=Path(sys.executable))
            job.prepare()
            self.assertEqual(request.scene_path.read_bytes(), b'BLENDER-test')
            self.assertEqual((root / 'job' / 'scene.blend').read_bytes(), b'BLENDER-test')
            with self.assertRaises(GuideError):
                BlenderGuideJob(request, root / 'job', blender=Path(sys.executable)).prepare()
            argv = job.blender_command()
            self.assertLess(argv.index('--disable-autoexec'), argv.index('--python'))
            self.assertIn('--factory-startup', argv)
            self.assertNotIn(str(request.scene_path), argv)

    def test_cancel_terminates_only_owned_process_before_returning(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            job = BlenderGuideJob(self.request(root), root / 'job', blender=Path(sys.executable))
            job.prepare()
            errors = []
            def run():
                try:
                    job._run_process([sys.executable, '-c', 'import time; time.sleep(30)'], 'child.log')
                except GuideError as exc:
                    errors.append(str(exc))
            thread = threading.Thread(target=run)
            thread.start()
            deadline = time.monotonic() + 3
            while job.active_pid is None and time.monotonic() < deadline:
                time.sleep(.01)
            self.assertIsNotNone(job.active_pid)
            job.cancel()
            thread.join(3)
            self.assertFalse(thread.is_alive())
            self.assertIsNone(job.active_pid)
            self.assertTrue(errors)

    def test_process_failure_has_log_and_nonzero_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            job = BlenderGuideJob(self.request(root), root / 'job', blender=Path(sys.executable))
            job.prepare()
            with self.assertRaisesRegex(GuideError, '7'):
                job._run_process([sys.executable, '-c', 'print("fail detail"); raise SystemExit(7)'], 'child.log')
            self.assertIn('fail detail', (root / 'job' / 'child.log').read_text())

    def test_failed_run_records_failure_without_publishing_ai_result(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            job = BlenderGuideJob(self.request(root), root / 'job', blender=Path(sys.executable))
            with self.assertRaises(GuideError):
                job.run()
            status = json.loads((root / 'job' / 'status.json').read_text())
            self.assertEqual(status['state'], 'failed')
            self.assertFalse(status['ai_generated'])
            self.assertFalse((root / 'job' / 'manifest.json').exists())

    def test_incomplete_outputs_cannot_publish_completed_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            job = BlenderGuideJob(self.request(root), root / 'job', blender=Path(sys.executable))
            job.prepare()
            with self.assertRaises(GuideError):
                job.verify_frames()
            self.assertFalse((root / 'job' / 'manifest.json').exists())


if __name__ == '__main__':
    unittest.main()

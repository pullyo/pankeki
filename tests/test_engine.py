"""Engine integration with real PNG/SQLite/files and a local Comfy API double.

These tests exercise orchestration and pixels, not model inference or GPU speed.
"""
import base64
import copy
import hashlib
import io
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image

from pankeki.cache import canonical_hash
from pankeki.comfy_adapter import ComfyError
from pankeki.engine import Engine
from pankeki.environment import process_start_token, server_signature, source_fingerprint
from pankeki.jobs import JobManager


def png(image):
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    return stream.getvalue()


def image_data(image):
    return base64.b64encode(png(image)).decode("ascii")


class PNGComfyClient:
    """Known-size actual PNG responses; no network, custom nodes or GPU."""
    def __init__(self):
        self.workflows = []
        self.uploads = {}
        self.lookups = 0
        self.failure = None
        self.allow_lookup = True
        self.system = {"python_version": "test-python", "pytorch_version": "test-torch",
                       "comfyui_version": "test-comfy", "argv": ["main.py", "--disable-all-custom-nodes"]}

    def get(self, path):
        self.lookups += 1
        if not self.allow_lookup:
            raise ComfyError("offline ComfyUI must not be contacted")
        if path == "/system_stats":
            return {"system": copy.deepcopy(self.system)}
        if path != "/object_info/CheckpointLoaderSimple":
            raise AssertionError(path)
        return {"CheckpointLoaderSimple": {"input": {"required": {"ckpt_name": [["model.safetensors"]]}}}}

    def upload_png(self, data, name):
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            assert image.mode == "RGBA"
        self.uploads[name] = data
        return name

    def execute(self, workflow, *, cancel, on_preview, on_submitted):
        self.workflows.append(copy.deepcopy(workflow))
        prompt_id = "mock-prompt-" + str(len(self.workflows))
        on_submitted(prompt_id)
        if self.failure:
            raise self.failure
        source = workflow["4"]
        if source["class_type"] == "EmptyLatentImage":
            size = (source["inputs"]["width"], source["inputs"]["height"])
        else:
            with Image.open(io.BytesIO(self.uploads[source["inputs"]["image"]])) as image:
                size = image.size
        data = png(Image.new("RGB", size, (250, 130, 10)))
        if on_preview:
            on_preview(data)
        return data, {"prompt_id": prompt_id, "test_double": True,
                      "preview_received_count": int(on_preview is not None),
                      "preview_received_bytes": len(data) if on_preview else 0}


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='engine-test-', dir=Path(__file__).resolve().parents[1])
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.model = self.root / "model.safetensors"
        self.model.write_bytes(b"test checkpoint bytes" * 128)
        self.config = {
            "managed_builtin_only": True,
            "model_name": "model.safetensors",
            "model_path": str(self.model),
            "manifest": {
                "schema": 1, "comfy_commit": "1" * 40,
                "model_name": "model.safetensors",
                "model_sha256": hashlib.sha256(self.model.read_bytes()).hexdigest(),
                "software": {"torch": "test-only", "cuda": "test-only", "dtype": "float16",
                             "attention": "pytorch", "adapter_revision": "1"},
                "input_hashes": {},
            },
        }
        self.client = PNGComfyClient()
        self.engine = Engine(self.root, config=self.config, client=self.client)
        self.manager = JobManager(self.engine)
        self.addCleanup(self.manager.close)

    def run_job(self, request, manager=None):
        manager = manager or self.manager
        submitted = manager.submit("engine-test", request)
        return manager.wait(submitted["job_id"], timeout=10)

    @staticmethod
    def request(**changes):
        return {"prompt": "a red cube", "width": 64, "height": 64, "seed": 7,
                "steps": 2, "feather": 0, **changes}

    def assert_success(self, job):
        self.assertEqual(job["state"], "succeeded", job["error"])
        self.assertTrue(Path(job["result"]["image_path"]).is_file())
        return job["result"]

    def test_completed_then_exact_hit_skips_submission_and_preserves_output(self):
        first = self.assert_success(self.run_job(self.request()))
        second = self.assert_success(self.run_job(self.request()))
        self.assertEqual(first["metrics"]["cache"], "miss")
        self.assertEqual(second["metrics"]["cache"], "hit")
        self.assertEqual(first["metrics"]["model_calls"], 1)
        self.assertEqual(second["metrics"]["model_calls"], 0)
        self.assertEqual(len(self.client.workflows), 1)
        self.assertEqual(Path(first["image_path"]).read_bytes(), Path(second["image_path"]).read_bytes())
        self.assertEqual(self.engine.cache.stats()["entries"], 1)
        persisted = json.loads((Path(first['image_path']).parent / 'metrics.json').read_text())
        self.assertTrue(persisted['cache_stored'])
        self.assertEqual(persisted['total_s'], first['metrics']['total_s'])

    def test_transport_revision_changes_do_not_reuse_previous_transport_cache(self):
        self.client.fingerprint = lambda: {'transport': 'sdk', 'bridge_sha256': 'first'}
        first = self.assert_success(self.run_job(self.request()))
        self.client.fingerprint = lambda: {'transport': 'sdk', 'bridge_sha256': 'second'}
        second = self.assert_success(self.run_job(self.request()))
        self.assertEqual(second['metrics']['cache'], 'miss')
        self.assertNotEqual(first['metrics']['cache_key'], second['metrics']['cache_key'])
        self.assertEqual(len(self.client.workflows), 2)

    @unittest.skipUnless(os.name == 'nt', 'Windows lease integration')
    def test_read_lease_reuses_strict_cache_and_blocks_model_writes_until_close(self):
        first = self.assert_success(self.run_job(self.request()))
        config = dict(self.config, fingerprint_policy='windows_read_lock')
        engine = Engine(self.root, config=config, client=self.client)
        manager = JobManager(engine)
        self.addCleanup(engine.close)
        self.addCleanup(manager.close)
        second = self.assert_success(self.run_job(self.request(), manager))
        self.assertEqual(second['metrics']['cache'], 'hit')
        self.assertEqual(second['metrics']['fingerprint_policy'], 'windows_read_lock')
        self.assertEqual(first['metrics']['cache_key'], second['metrics']['cache_key'])
        with self.assertRaises(OSError):
            self.model.write_bytes(b'changed')
        manager.close()
        engine.close()
        self.model.write_bytes(b'changed')
        closed_manager = JobManager(engine)
        self.addCleanup(closed_manager.close)
        closed = self.run_job(self.request(), closed_manager)
        self.assertEqual(closed['state'], 'failed')
        self.assertIn('closed', closed['error'])

    def test_lease_unavailable_falls_back_to_full_model_hash_checks(self):
        config = dict(self.config, fingerprint_policy='windows_read_lock')
        with patch('pankeki.engine.ReadOnlyModelLease', side_effect=OSError('share denied')):
            engine = Engine(self.root, config=config, client=self.client)
        manager = JobManager(engine)
        self.addCleanup(engine.close)
        self.addCleanup(manager.close)
        result = self.assert_success(self.run_job(self.request(), manager))
        self.assertEqual(result['metrics']['fingerprint_policy'], 'strict')
        self.assertIn('share denied', result['metrics']['fingerprint_fallback'])
        self.model.write_bytes(b'changed')
        failed = self.run_job(self.request(cache=False), manager)
        self.assertEqual(failed['state'], 'failed')
        self.assertIn('Model bytes changed', failed['error'])

    def test_lease_digest_mismatch_fails_closed(self):
        config = dict(self.config, fingerprint_policy='windows_read_lock')
        with patch('pankeki.engine.ReadOnlyModelLease', side_effect=ValueError('digest mismatch')):
            with self.assertRaisesRegex(ValueError, 'digest mismatch'):
                Engine(self.root, config=config, client=self.client)

    def test_prompt_seed_and_cache_off_force_real_adapter_path(self):
        for request in [self.request(), self.request(seed=8), self.request(prompt="a blue sphere"), self.request(cache=False)]:
            self.assert_success(self.run_job(request))
        self.assertEqual(len(self.client.workflows), 4)
        self.assertEqual(self.client.workflows[1]["5"]["inputs"]["seed"], 8)
        self.assertEqual(self.client.workflows[2]["2"]["inputs"]["text"], "a blue sphere")
        self.assertEqual(self.engine.cache.stats()["entries"], 3)

    def test_checkpoint_bytes_changed_with_same_size_and_mtime_reject_hit(self):
        self.assert_success(self.run_job(self.request()))
        original_stat = self.model.stat()
        self.model.write_bytes(b"x" * original_stat.st_size)
        os.utime(self.model, ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns))
        changed = self.run_job(self.request())
        self.assertEqual(changed["state"], "failed")
        self.assertIn("Model bytes changed", changed["error"])
        self.assertEqual(len(self.client.workflows), 1)

    def test_cache_off_still_rejects_changed_checkpoint_bytes(self):
        self.assert_success(self.run_job(self.request(cache=False)))
        original_stat = self.model.stat()
        self.model.write_bytes(b"x" * original_stat.st_size)
        os.utime(self.model, ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns))
        changed = self.run_job(self.request(cache=False))
        self.assertEqual(changed["state"], "failed")
        self.assertIn("Model bytes changed", changed["error"])
        self.assertEqual(len(self.client.workflows), 1)
        self.assertEqual(self.engine.cache.stats()["entries"], 0)

    def test_engine_snapshots_nested_config_against_caller_mutation(self):
        first = self.assert_success(self.run_job(self.request()))
        self.config["manifest"]["software"]["dtype"] = "float32"
        self.config["manifest"]["model_sha256"] = "0" * 64
        self.config["model_name"] = "other.safetensors"
        self.config["model_path"] = str(self.root / "missing-model.safetensors")
        second = self.assert_success(self.run_job(self.request()))
        self.assertEqual(second["metrics"]["cache"], "hit")
        self.assertEqual(second["metrics"]["cache_key"], first["metrics"]["cache_key"])
        self.assertEqual(len(self.client.workflows), 1)

    def test_changed_adapter_sources_block_running_engine_until_restart(self):
        fixture = self.root / "adapter-sources"
        fixture.mkdir()
        source = fixture / "core.py"
        source.write_text("VALUE = 1\n", encoding="utf-8")
        first_source_hash = source_fingerprint(fixture)
        # Redirect only source-tree selection; hash real temporary file bytes.
        with patch("pankeki.engine.source_fingerprint", side_effect=lambda _: source_fingerprint(fixture)):
            engine = Engine(self.root, config=self.config, client=self.client)
            manager = JobManager(engine)
            try:
                first = self.assert_success(self.run_job(self.request(), manager))
                source.write_text("VALUE = 2\n", encoding="utf-8")
                changed = self.run_job(self.request(), manager)
                self.assertEqual(changed["state"], "failed")
                self.assertIn("source changed", changed["error"])
                self.assertEqual(len(self.client.workflows), 1)
            finally:
                manager.close()
            restarted = Engine(self.root, config=self.config, client=self.client)
            manager = JobManager(restarted)
            try:
                second = self.assert_success(self.run_job(self.request(), manager))
                self.assertEqual(second["metrics"]["cache"], "miss")
                self.assertNotEqual(first["metrics"]["cache_key"], second["metrics"]["cache_key"])
                recipe = json.loads((Path(second["image_path"]).parent / "recipe.json").read_text(encoding="utf-8"))
                self.assertEqual(recipe["adapter_source_sha256"], source_fingerprint(fixture))
                self.assertNotEqual(recipe["adapter_source_sha256"], first_source_hash)
            finally:
                manager.close()

    @unittest.skipUnless(os.name == "nt", "managed process attestation currently targets Windows")
    def test_managed_runtime_guard_blocks_process_backend_and_source_changes(self):
        fixture = self.root / "comfy-sources"
        fixture.mkdir()
        source = fixture / "nodes.py"
        source.write_text("VALUE = 1\n", encoding="utf-8")
        baseline_system = copy.deepcopy(self.client.system)
        config = copy.deepcopy(self.config)
        config["runtime_guard"] = {
            "pid": os.getpid(), "process_start_token": process_start_token(os.getpid()),
            "server_signature": server_signature(baseline_system),
            "source_trees": {str(fixture): source_fingerprint(fixture)},
        }
        for changed in ("process", "backend", "source"):
            with self.subTest(changed=changed):
                source.write_text("VALUE = 1\n", encoding="utf-8")
                self.client.system = copy.deepcopy(baseline_system)
                current_config = copy.deepcopy(config)
                if changed == "process":
                    current_config["runtime_guard"]["process_start_token"] += "0"
                elif changed == "backend":
                    self.client.system["argv"].append("--fp32-vae")
                else:
                    source.write_text("VALUE = 2\n", encoding="utf-8")
                engine = Engine(self.root, config=current_config, client=self.client)
                manager = JobManager(engine)
                try:
                    result = self.run_job(self.request(cache=False), manager)
                    self.assertEqual(result["state"], "failed")
                    self.assertIn("changed", result["error"])
                finally:
                    manager.close()
        self.assertEqual(len(self.client.workflows), 0)
        self.assertEqual(self.engine.cache.stats()["entries"], 0)

    @unittest.skipUnless(os.name == "nt", "managed process attestation currently targets Windows")
    def test_runtime_source_and_tokenizer_changes_require_restart_and_invalidate_key(self):
        cases = [("nodes.py", "VALUE = 1\n", "VALUE = 2\n"),
                 ("vocab.json", '{"token": 1}', '{"token": 2}'),
                 ("comfy/ldm/models/autoencoder.py", "VALUE = 1\n", "VALUE = 2\n")]
        for index, (filename, before, after) in enumerate(cases):
            with self.subTest(filename=filename):
                fixture = self.root / ("guard-sources-" + str(index))
                fixture.mkdir()
                source = fixture / filename
                source.parent.mkdir(parents=True, exist_ok=True)
                source.write_text(before, encoding="utf-8")
                config = copy.deepcopy(self.config)
                config["runtime_guard"] = {
                    "pid": os.getpid(), "process_start_token": process_start_token(os.getpid()),
                    "server_signature": server_signature(self.client.system),
                    "source_trees": {str(fixture): source_fingerprint(fixture)},
                }
                request = self.request(prompt="cache dependency test for " + filename)
                engine = Engine(self.root, config=config, client=self.client)
                manager = JobManager(engine)
                try:
                    first = self.assert_success(self.run_job(request, manager))
                    source.write_text(after, encoding="utf-8")
                    changed = self.run_job(request, manager)
                    self.assertEqual(changed["state"], "failed", filename + " change went undetected")
                    self.assertIn("source changed", changed["error"])
                finally:
                    manager.close()
                config["runtime_guard"]["source_trees"][str(fixture)] = source_fingerprint(fixture)
                restarted = Engine(self.root, config=config, client=self.client)
                manager = JobManager(restarted)
                try:
                    second = self.assert_success(self.run_job(request, manager))
                    self.assertEqual(second["metrics"]["cache"], "miss")
                    self.assertNotEqual(first["metrics"]["cache_key"], second["metrics"]["cache_key"])
                finally:
                    manager.close()

    def test_failed_execution_is_not_cached_and_retry_reaches_adapter(self):
        self.client.failure = ComfyError("synthetic OOM")
        failed = self.run_job(self.request())
        self.assertEqual(failed["state"], "failed")
        self.assertIn("synthetic OOM", failed["error"])
        self.assertEqual(self.engine.cache.stats()["entries"], 0)
        self.client.failure = None
        self.assert_success(self.run_job(self.request()))
        self.assertEqual(len(self.client.workflows), 2)

    def test_invalid_preview_interval_fails_job_and_worker_accepts_next(self):
        submitted = self.manager.submit("invalid-interval", self.request(preview_interval="bad"))
        try:
            failed = self.manager.wait(submitted["job_id"], timeout=1)
        except TimeoutError:
            self.fail("invalid preview interval killed/stalled the queue worker")
        self.assertEqual(failed["state"], "failed")
        self.assert_success(self.run_job(self.request()))

    def test_finalizer_failure_does_not_kill_queue_worker(self):
        def run_with_broken_metrics(job, on_preview):
            result = self.engine(job, on_preview)
            if job.request.get("break_metrics"):
                def broken_finalize(state, error):
                    raise OSError("synthetic metric write failure")
                job.finalize = broken_finalize
            return result
        manager = JobManager(run_with_broken_metrics)
        try:
            first = manager.submit("metrics-failure", self.request(break_metrics=True))
            failed = manager.wait(first["job_id"], 5)
            self.assertEqual(failed["state"], "failed")
            self.assertIn("synthetic metric write failure", failed["error"])
            self.assertEqual(self.engine.cache.stats()["entries"], 0)
            second = manager.submit("metrics-failure", self.request(seed=8))
            try:
                result = manager.wait(second["job_id"], timeout=2)
            except TimeoutError:
                self.fail("metrics finalizer failure killed/stalled the queue worker")
            self.assert_success(result)
        finally:
            manager.close()

    def test_canceled_after_runner_returns_cannot_commit_cache(self):
        returned, release = threading.Event(), threading.Event()
        def delayed_commit(job, on_preview):
            result = self.engine(job, on_preview)
            returned.set()
            if not release.wait(5):
                raise TimeoutError("test release missing")
            return result
        manager = JobManager(delayed_commit)
        try:
            submitted = manager.submit("cancel-test", self.request())
            self.assertTrue(returned.wait(5))
            manager.cancel(submitted["job_id"])
            release.set()
            result = manager.wait(submitted["job_id"], 5)
            self.assertEqual(result["state"], "canceled")
            self.assertIsNone(result["result"])
            self.assertEqual(self.engine.cache.stats()["entries"], 0)
            run_dir = self.root / "runtime" / "runs" / submitted["job_id"]
            stored = json.loads((run_dir / "metrics.json").read_text(encoding="utf-8"))
            self.assertEqual(stored["status"], "canceled")
            self.assertNotIn("cache_stored", stored)
            rows = [json.loads(line) for line in (self.root / "runtime" / "metrics.jsonl").read_text(encoding="utf-8").splitlines()]
            matching = [row for row in rows if row["job_id"] == submitted["job_id"]]
            self.assertEqual(len(matching), 1)
            self.assertEqual(matching[0]["status"], "canceled")
        finally:
            release.set()
            manager.close()

    def test_empty_mask_preserves_pixels_without_model_or_server_lookup(self):
        original = Image.new("RGB", (512, 512), (12, 34, 56))
        mask = Image.new("L", original.size, 0)
        self.client.allow_lookup = False
        offline_engine = Engine(self.root, config={}, client=self.client)
        manager = JobManager(offline_engine)
        try:
            result = self.assert_success(self.run_job(self.request(mode="inpaint", roi=True,
                source=image_data(original), mask=image_data(mask)), manager))
            with Image.open(result["image_path"]) as output:
                self.assertEqual(output.tobytes(), original.tobytes())
            self.assertEqual(result["metrics"]["cache"], "empty-mask-skip")
            self.assertEqual(result["metrics"]["model_calls"], 0)
            self.assertEqual(self.client.lookups, 0)
            self.assertEqual(len(self.client.workflows), 0)
        finally:
            manager.close()

    def test_roi_changes_only_selected_pixels_and_uploads_smaller_input(self):
        original = Image.new("RGB", (768, 512), (12, 34, 56))
        mask = Image.new("L", original.size, 0)
        mask.paste(255, (300, 200, 320, 220))
        result = self.assert_success(self.run_job(self.request(mode="inpaint", roi=True,
            halo=16, source=image_data(original), mask=image_data(mask))))
        with Image.open(result["image_path"]) as output:
            self.assertEqual(output.size, original.size)
            pixels = np.array(output)
        selected = np.asarray(mask) > 0
        self.assertTrue(np.array_equal(pixels[~selected], np.asarray(original)[~selected]))
        self.assertTrue(np.all(pixels[selected] == [250, 130, 10]))
        self.assertEqual(result["metrics"]["outside_mask_max_error"], 0)
        self.assertLess(result["metrics"]["model_pixels"], original.width * original.height)
        self.assertEqual(len(self.client.uploads), 1)
        upload = next(iter(self.client.uploads.values()))
        with Image.open(io.BytesIO(upload)) as image:
            alpha = np.asarray(image.getchannel("A"))
            self.assertEqual(int(np.count_nonzero(alpha == 0)), 400)
            self.assertTrue(np.all(np.isin(alpha, [0, 255])))

    def test_original_edit_outside_roi_invalidates_composite_cache(self):
        original = Image.new("RGB", (768, 512), (12, 34, 56))
        mask = Image.new("L", original.size, 0)
        mask.paste(255, (300, 200, 320, 220))
        request = self.request(mode="inpaint", roi=True, halo=16,
                               source=image_data(original), mask=image_data(mask))
        first = self.assert_success(self.run_job(request))
        original.putpixel((0, 0), (90, 80, 70))
        request["source"] = image_data(original)
        second = self.assert_success(self.run_job(request))
        self.assertEqual(second["metrics"]["cache"], "miss")
        self.assertNotEqual(first["metrics"]["cache_key"], second["metrics"]["cache_key"])
        self.assertEqual(len(self.client.workflows), 2)
        with Image.open(second["image_path"]) as output:
            self.assertEqual(output.getpixel((0, 0)), (90, 80, 70))

    def test_full_frame_inpaint_baseline_preserves_all_unselected_pixels(self):
        original = Image.new("RGB", (768, 512), (12, 34, 56))
        mask = Image.new("L", original.size, 0)
        mask.paste(255, (300, 200, 320, 220))
        result = self.assert_success(self.run_job(self.request(mode="inpaint", roi=False,
            source=image_data(original), mask=image_data(mask))))
        with Image.open(result["image_path"]) as output:
            pixels = np.asarray(output)
        selected = np.asarray(mask) > 0
        self.assertTrue(np.array_equal(pixels[~selected], np.asarray(original)[~selected]))
        self.assertTrue(np.all(pixels[selected] == [250, 130, 10]))
        self.assertEqual(result["metrics"]["model_pixels"], 768 * 512)
        self.assertEqual(result["metrics"]["outside_mask_max_error"], 0)

    def test_mask_content_change_same_bbox_invalidates_cached_composite(self):
        original = Image.new("RGB", (768, 512), (12, 34, 56))
        mask = Image.new("L", original.size, 0)
        mask.paste(255, (300, 200, 320, 220))
        request = self.request(mode="inpaint", roi=True, halo=16,
                               source=image_data(original), mask=image_data(mask))
        first = self.assert_success(self.run_job(request))
        mask.putpixel((310, 210), 0)
        request["mask"] = image_data(mask)
        second = self.assert_success(self.run_job(request))
        self.assertEqual(second["metrics"]["cache"], "miss")
        self.assertNotEqual(first["metrics"]["cache_key"], second["metrics"]["cache_key"])
        self.assertEqual(len(self.client.workflows), 2)
        with Image.open(second["image_path"]) as output:
            self.assertEqual(output.getpixel((310, 210)), (12, 34, 56))

    def test_rgba_outside_pixels_and_alpha_survive_generation_and_exact_hit(self):
        original = Image.new("RGBA", (768, 512), (12, 34, 56, 80))
        original.putpixel((0, 0), (19, 29, 39, 0))
        original.putpixel((1, 0), (51, 61, 71, 255))
        mask = Image.new("L", original.size, 0)
        mask.paste(255, (300, 200, 320, 220))
        request = self.request(mode="inpaint", roi=True, halo=16,
                               source=image_data(original), mask=image_data(mask))
        selected = np.asarray(mask) > 0
        for expected_cache in ["miss", "hit"]:
            with self.subTest(expected_cache=expected_cache):
                result = self.assert_success(self.run_job(request))
                self.assertEqual(result["metrics"]["cache"], expected_cache)
                with Image.open(result["image_path"]) as output:
                    self.assertEqual(output.mode, "RGBA")
                    pixels = np.asarray(output)
                self.assertTrue(np.array_equal(pixels[~selected], np.asarray(original)[~selected]))
                self.assertTrue(np.array_equal(pixels[..., 3], np.asarray(original)[..., 3]))
                self.assertTrue(np.all(pixels[selected, :3] == [250, 130, 10]))
        self.assertEqual(len(self.client.workflows), 1)

    def test_saved_recipe_fingerprint_matches_saved_json(self):
        result = self.assert_success(self.run_job(self.request()))
        recipe = json.loads((Path(result["image_path"]).parent / "recipe.json").read_text(encoding="utf-8"))
        self.assertEqual(result["metrics"]["recipe_sha256"], canonical_hash(recipe))

    def multiple_models(self, *, policy='strict', missing_sdxl=False):
        turbo = self.root / 'sd_turbo.safetensors'
        turbo.write_bytes(self.model.read_bytes())
        self.model = turbo
        turbo_manifest = copy.deepcopy(self.config['manifest'])
        turbo_manifest.update(model_name=turbo.name, model_sha256=hashlib.sha256(turbo.read_bytes()).hexdigest())
        sdxl = self.root / 'sd_xl_base_1.0.safetensors'
        sdxl.write_bytes(b'separate SDXL checkpoint fixture')
        second_manifest = copy.deepcopy(self.config['manifest'])
        second_manifest.update(model_name=sdxl.name, model_sha256=hashlib.sha256(sdxl.read_bytes()).hexdigest())
        config = {'managed_builtin_only': True, 'fingerprint_policy': policy, 'models': {
            'sd-turbo': {'model_name': turbo.name, 'model_path': str(turbo), 'manifest': turbo_manifest},
            'sdxl-base': {'model_name': sdxl.name, 'model_path': str(sdxl), 'manifest': second_manifest},
        }}
        if missing_sdxl:
            sdxl.unlink()
        engine = Engine(self.root, config=config, client=self.client)
        manager = JobManager(engine)
        self.addCleanup(engine.close)
        self.addCleanup(manager.close)
        return engine, manager, sdxl, config

    def test_selected_model_defaults_reach_actual_graph_and_output_dimensions(self):
        engine, manager, _, _ = self.multiple_models()
        result = self.assert_success(self.run_job({'prompt': 'one character'}, manager))
        graph = self.client.workflows[-1]
        self.assertEqual(graph['1']['inputs']['ckpt_name'], 'sd_xl_base_1.0.safetensors')
        self.assertEqual((graph['4']['inputs']['width'], graph['4']['inputs']['height']), (1024, 1024))
        self.assertEqual((graph['5']['inputs']['steps'], graph['5']['inputs']['cfg'],
                          graph['5']['inputs']['sampler_name'], graph['5']['inputs']['scheduler']),
                         (25, 6, 'dpmpp_2m', 'karras'))
        with Image.open(result['image_path']) as output:
            self.assertEqual(output.size, (1024, 1024))
        recipe = json.loads((Path(result['image_path']).parent / 'recipe.json').read_text(encoding='utf-8'))
        self.assertEqual(recipe['model_id'], 'sdxl-base')
        self.assertEqual(recipe['denoise'], .55)
        self.assertEqual(engine.models_info()['default_model_id'], 'sdxl-base')

    def test_explicit_legacy_settings_survive_named_model_selection(self):
        _, manager, _, _ = self.multiple_models()
        request = self.request(model_id='sdxl-base', steps=1, cfg=1, sampler='euler', scheduler='normal', denoise=.75)
        self.assert_success(self.run_job(request, manager))
        graph = self.client.workflows[-1]
        self.assertEqual(graph['1']['inputs']['ckpt_name'], 'sd_xl_base_1.0.safetensors')
        self.assertEqual(graph['4']['inputs']['width'], 64)
        self.assertEqual(graph['5']['inputs']['steps'], 1)
        self.assertEqual(graph['5']['inputs']['cfg'], 1)
        self.assertEqual(graph['5']['inputs']['scheduler'], 'normal')
        self.assertEqual(graph['5']['inputs']['sampler_name'], 'euler')

    def test_sdxl_partial_edit_uses_model_denoise_default_and_keeps_exterior_pixels(self):
        _, manager, _, _ = self.multiple_models()
        source = Image.new('RGBA', (128, 128), (31, 41, 59, 67))
        mask = Image.new('L', source.size)
        mask.paste(255, (32, 40, 72, 80))
        result = self.assert_success(self.run_job({'mode': 'inpaint', 'model_id': 'sdxl-base',
            'source': image_data(source), 'mask': image_data(mask)}, manager))
        self.assertEqual(self.client.workflows[-1]['5']['inputs']['denoise'], .55)
        self.assertEqual(self.client.workflows[-1]['5']['inputs']['steps'], 25)
        with Image.open(result['image_path']) as output:
            actual = np.asarray(output)
        selected = np.asarray(mask) != 0
        self.assertTrue(np.array_equal(actual[~selected], np.asarray(source)[~selected]))
        self.assertTrue(np.array_equal(actual[..., 3], np.asarray(source)[..., 3]))

    def test_model_switch_isolates_exact_cache_and_checks_only_selected_checkpoint(self):
        _, manager, sdxl, _ = self.multiple_models()
        request = self.request(cfg=1, sampler='euler', scheduler='normal', denoise=1)
        turbo = self.assert_success(self.run_job(dict(request, model_id='sd-turbo'), manager))
        large = self.assert_success(self.run_job(dict(request, model_id='sdxl-base'), manager))
        self.assertNotEqual(turbo['metrics']['cache_key'], large['metrics']['cache_key'])
        self.assertEqual(self.client.workflows[0]['1']['inputs']['ckpt_name'], self.model.name)
        self.assertEqual(self.client.workflows[1]['1']['inputs']['ckpt_name'], sdxl.name)
        old = sdxl.stat()
        sdxl.write_bytes(b'x' * old.st_size)
        os.utime(sdxl, ns=(old.st_atime_ns, old.st_mtime_ns))
        turbo_again = self.assert_success(self.run_job(dict(request, model_id='sd-turbo'), manager))
        self.assertEqual(turbo_again['metrics']['cache'], 'hit')
        for use_cache in [True, False]:
            failure = self.run_job(dict(request, model_id='sdxl-base', cache=use_cache), manager)
            self.assertEqual(failure['state'], 'failed')
            self.assertIn('Model bytes changed', failure['error'])
        self.assertEqual(len(self.client.workflows), 2)

    def test_unknown_or_missing_model_never_reaches_adapter_and_available_default_falls_back(self):
        engine, manager, _, _ = self.multiple_models(missing_sdxl=True)
        self.assertEqual(engine.models_info()['default_model_id'], 'sd-turbo')
        info = {row['id']: row for row in engine.models_info()['models']}
        self.assertFalse(info['sdxl-base']['available'])
        self.assertTrue(info['sd-turbo']['available'])
        for model_id in ['unknown', 'sdxl-base', None, 42]:
            with self.subTest(model_id=model_id):
                failure = self.run_job(self.request(model_id=model_id), manager)
                self.assertEqual(failure['state'], 'failed')
        self.assertEqual(self.client.workflows, [])

    def test_model_manifest_loader_identity_mismatch_fails_closed(self):
        engine, manager, _, config = self.multiple_models()
        manager.close()
        engine.close()
        config['models']['sdxl-base']['manifest']['model_name'] = 'wrong-checkpoint.safetensors'
        with self.assertRaisesRegex(ValueError, 'model_name|identity|manifest'):
            Engine(self.root, config=config, client=self.client)

    def test_checkpoint_cannot_be_mislabeled_as_a_different_model_preset(self):
        engine, manager, _, config = self.multiple_models()
        manager.close()
        engine.close()
        config['models']['sdxl-base'] = copy.deepcopy(config['models']['sd-turbo'])
        with self.assertRaisesRegex(ValueError, 'checkpoint|preset|identity'):
            Engine(self.root, config=config, client=self.client)

    @unittest.skipUnless(os.name == 'nt', 'Windows per-model lease integration')
    def test_both_named_model_leases_block_changes_and_close_releases_both(self):
        engine, manager, sdxl, _ = self.multiple_models(policy='windows_read_lock')
        for model_id, path in [('sd-turbo', self.model), ('sdxl-base', sdxl)]:
            result = self.assert_success(self.run_job(self.request(model_id=model_id), manager))
            self.assertEqual(result['metrics']['fingerprint_policy'], 'windows_read_lock')
            with self.assertRaises(OSError):
                path.write_bytes(b'blocked during lease')
        manager.close()
        engine.close()
        for path in [self.model, sdxl]:
            path.write_bytes(b'released after close')

    @unittest.skipUnless(os.name == 'nt', 'Windows partial acquisition cleanup')
    def test_later_model_digest_failure_releases_already_acquired_lease(self):
        engine, manager, _, config = self.multiple_models()
        manager.close()
        engine.close()
        config['fingerprint_policy'] = 'windows_read_lock'
        config['models']['sdxl-base']['manifest']['model_sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'SHA256 mismatch'):
            Engine(self.root, config=config, client=self.client)
        # Turbo was acquired first. A failed later acquisition must release it.
        self.model.write_bytes(b'constructor released earlier lease')

    @unittest.skipUnless(os.name == 'nt', 'Windows per-model fallback cleanup')
    def test_one_unavailable_lease_closes_other_lease_and_falls_back_to_selected_byte_checks(self):
        engine, manager, _, config = self.multiple_models()
        manager.close()
        engine.close()
        config['fingerprint_policy'] = 'windows_read_lock'
        from pankeki.model_lease import ReadOnlyModelLease
        def open_one(path, digest):
            if Path(path) == self.model:
                return ReadOnlyModelLease(path, digest)
            raise OSError('second file has incompatible writer')
        with patch('pankeki.engine.ReadOnlyModelLease', side_effect=open_one):
            fallback = Engine(self.root, config=config, client=self.client)
        fallback_manager = JobManager(fallback)
        self.addCleanup(fallback.close)
        self.addCleanup(fallback_manager.close)
        self.assert_success(self.run_job(self.request(model_id='sd-turbo'), fallback_manager))
        self.model.write_bytes(b'allowed after whole-registry fallback')
        failure = self.run_job(self.request(model_id='sd-turbo'), fallback_manager)
        self.assertEqual(failure['state'], 'failed')
        self.assertIn('Model bytes changed', failure['error'])


if __name__ == "__main__":
    unittest.main()

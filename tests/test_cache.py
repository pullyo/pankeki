"""Contract tests for exact result reuse; no GPU or third-party packages."""

import copy
import hashlib
import sqlite3
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path

from pankeki import cache as cache_api


def png(pixel=b"\x20\x40\x80"):
    def chunk(kind, data):
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data)))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"\0" + pixel))
            + chunk(b"IEND", b""))


def manifest():
    return {
        "schema": 1,
        "comfy_commit": "1" * 40,
        "model_name": "model.safetensors",
        "model_sha256": "a" * 64,
        "software": {"torch": "2.12.0", "cuda": "13.0", "dtype": "float16",
                     "attention": "pytorch", "adapter_revision": "1"},
        "input_hashes": {},
    }


def workflow():
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "model.safetensors"}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": "a tree", "clip": ["1", 1]}},
        "3": {"class_type": "EmptyLatentImage", "inputs": {"width": 64, "height": 64, "batch_size": 1}},
        "4": {"class_type": "KSampler", "inputs": {"seed": 42, "model": ["1", 0],
              "positive": ["2", 0], "negative": ["2", 0], "latent_image": ["3", 0],
              "steps": 2, "cfg": 7.0, "sampler_name": "euler", "scheduler": "normal", "denoise": 1.0}},
        "5": {"class_type": "VAEDecode", "inputs": {"samples": ["4", 0], "vae": ["1", 2]}},
        "6": {"class_type": "SaveImage", "inputs": {"images": ["5", 0], "filename_prefix": "Pankeki"}},
    }


class CacheTests(unittest.TestCase):
    api = cache_api

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_hash_is_canonical_and_rejects_nonfinite_or_non_json_values(self):
        self.assertEqual(self.api.content_hash(b"abc"),
                         "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        self.assertEqual(self.api.canonical_hash({"b": [2], "a": 1}),
                         self.api.canonical_hash({"a": 1, "b": [2]}))
        for invalid in ({"x": float("nan")}, {"x": float("inf")}, {1: "ambiguous"}, {"x": (1, 2)}):
            with self.subTest(invalid=repr(invalid)):
                with self.assertRaises((TypeError, ValueError)):
                    self.api.canonical_hash(invalid)

    def test_key_invalidates_prompt_seed_model_input_and_software(self):
        base = workflow()
        base["7"] = {"class_type": "LoadImage", "inputs": {"image": "input.png"}}
        deps = manifest()
        deps["input_hashes"]["input.png"] = "b" * 64
        initial = self.api.make_cache_key(base, deps)
        self.assertRegex(initial, r"^[0-9a-f]{64}$")
        changed_prompt = copy.deepcopy(base)
        changed_prompt["2"]["inputs"]["text"] = "a mountain"
        changed_seed = copy.deepcopy(base)
        changed_seed["4"]["inputs"]["seed"] = 43
        variants = [(changed_prompt, deps), (changed_seed, deps)]
        for field, value in [("model_sha256", "c" * 64), ("comfy_commit", "2" * 40)]:
            changed = copy.deepcopy(deps)
            changed[field] = value
            variants.append((base, changed))
        changed = copy.deepcopy(deps)
        changed["input_hashes"]["input.png"] = "d" * 64
        variants.append((base, changed))
        changed = copy.deepcopy(deps)
        changed["software"]["dtype"] = "float32"
        variants.append((base, changed))
        for graph, dependencies in variants:
            with self.subTest(graph=graph, dependencies=dependencies):
                self.assertIsNotNone(self.api.make_cache_key(graph, dependencies))
                self.assertNotEqual(initial, self.api.make_cache_key(graph, dependencies))

    def test_incomplete_unknown_external_or_mismatched_dependencies_bypass(self):
        variants = []
        for field in manifest():
            deps = manifest()
            del deps[field]
            variants.append((workflow(), deps))
        for field in manifest()["software"]:
            deps = manifest()
            del deps["software"][field]
            variants.append((workflow(), deps))
        for field, value in [("model_name", "other.safetensors"), ("model_sha256", "path-only"),
                             ("comfy_commit", "unknown"), ("schema", True), ("external_state", "clock")]:
            deps = manifest()
            deps[field] = value
            variants.append((workflow(), deps))
        for node in ["CustomClock", "LoraLoader", "UNETLoader"]:
            graph = workflow()
            graph["8"] = {"class_type": node, "inputs": {}}
            variants.append((graph, manifest()))
        graph = workflow()
        graph["8"] = {"class_type": "LoadImage", "inputs": {"image": "missing.png"}}
        variants.append((graph, manifest()))
        graph = workflow()
        graph["4"]["inputs"]["seed"] = "random"
        variants.append((graph, manifest()))
        graph = workflow()
        graph["4"]["inputs"]["cfg"] = float("nan")
        variants.append((graph, manifest()))
        graph = workflow()
        graph["2"]["inputs"]["text"] = "portrait EMBEDDING:local-style"
        variants.append((graph, manifest()))
        for graph, deps in variants:
            with self.subTest(graph=graph, deps=deps):
                self.assertIsNone(self.api.make_cache_key(graph, deps))

    def test_output_recipe_changes_key_and_is_optional(self):
        original = self.api.make_cache_key(workflow(), manifest())
        deps = manifest()
        deps["request_recipe"] = {"mode": "roi", "crop": [0, 0, 64, 64], "feather": 4}
        revised = self.api.make_cache_key(workflow(), deps)
        self.assertIsNotNone(revised)
        self.assertNotEqual(original, revised)
        deps["request_recipe"]["feather"] = 8
        self.assertNotEqual(revised, self.api.make_cache_key(workflow(), deps))

    def test_completed_results_survive_restart_and_are_immutable(self):
        cache = self.api.ExactCache(self.root)
        key = "a" * 64
        data = png()
        metadata = {"recipe": {"seed": 42}}
        self.assertIsNone(cache.get(key))
        self.assertTrue(cache.put(key, data, metadata))
        metadata["recipe"]["seed"] = 99
        self.assertEqual(cache.get(key), data)
        self.assertIsInstance(cache.get(key), bytes)
        restarted = self.api.ExactCache(self.root)
        self.assertEqual(restarted.get(key), data)
        stats = restarted.stats()
        self.assertEqual(stats["entries"], 1)
        self.assertGreaterEqual(stats["bytes"], len(data))
        stats["entries"] = 500
        self.assertEqual(restarted.stats()["entries"], 1)

    def test_lru_access_evicts_oldest_and_oversized_put_keeps_existing(self):
        data = png()
        cache = self.api.ExactCache(self.root, max_bytes=2 * (len(data) + 2))
        for key in ["a" * 64, "b" * 64]:
            self.assertTrue(cache.put(key, data))
        self.assertEqual(cache.get("a" * 64), data)
        self.assertTrue(cache.put("c" * 64, data))
        self.assertIsNone(cache.get("b" * 64))
        self.assertEqual(cache.get("a" * 64), data)
        self.assertFalse(cache.put("a" * 64, data, {"large": "x" * 1000}))
        self.assertEqual(cache.get("a" * 64), data)
        self.assertEqual(cache.stats()["evictions"], 1)
        self.assertLessEqual(cache.stats()["bytes"], cache.stats()["max_bytes"])

    def test_invalid_or_partial_png_and_invalid_keys_never_enter_cache(self):
        cache = self.api.ExactCache(self.root)
        for invalid in [b"not a png", png()[:-1], png() + b"trailing", png()[:40] + b"x" + png()[41:]]:
            self.assertFalse(cache.put("a" * 64, invalid))
        for key in ["../escape", "A" * 64, "a" * 63, None]:
            with self.subTest(key=key):
                with self.assertRaises(ValueError):
                    cache.put(key, png())
                with self.assertRaises(ValueError):
                    cache.get(key)
        self.assertEqual(cache.stats()["entries"], 0)

    def test_corrupted_payload_is_a_miss_and_is_removed(self):
        cache = self.api.ExactCache(self.root)
        cache.put("a" * 64, png())
        with closing(sqlite3.connect(self.root / "exact-cache.sqlite3")) as conn:
            with conn:
                conn.execute("UPDATE entries SET payload = ? WHERE key = ?", (png(b"\xff\x00\x00"), "a" * 64))
        self.assertIsNone(cache.get("a" * 64))
        self.assertEqual(cache.stats()["corruptions"], 1)
        self.assertEqual(cache.stats()["entries"], 0)

    def test_clear_leaves_unrelated_files_intact(self):
        cache = self.api.ExactCache(self.root)
        other = self.root / "user-image.png"
        other.write_bytes(png())
        cache.put("a" * 64, png())
        cache.clear()
        self.assertEqual(other.read_bytes(), png())
        self.assertIsNone(cache.get("a" * 64))
        self.assertEqual(cache.stats()["entries"], 0)

    def test_corrupt_or_unrelated_database_falls_back_without_deletion(self):
        path = self.root / "exact-cache.sqlite3"
        original = b"user file must not be replaced"
        path.write_bytes(original)
        cache = self.api.ExactCache(self.root)
        self.assertFalse(cache.stats()["available"])
        self.assertFalse(cache.put("a" * 64, png()))
        self.assertIsNone(cache.get("a" * 64))
        cache.clear()
        self.assertEqual(path.read_bytes(), original)

    def test_metadata_is_snapshotted_and_corruption_invalidates_result(self):
        cache = self.api.ExactCache(self.root)
        metadata = {"recipe": {"seed": 42}}
        self.assertTrue(cache.put("a" * 64, png(), metadata))
        metadata["recipe"]["seed"] = 99
        with closing(sqlite3.connect(self.root / "exact-cache.sqlite3")) as conn:
            saved = conn.execute("SELECT metadata FROM entries WHERE key = ?", ("a" * 64,)).fetchone()[0]
            self.assertEqual(saved, '{"recipe":{"seed":42}}')
            with conn:
                conn.execute("UPDATE entries SET metadata = ?", ('{"recipe":{"seed":99}}',))
        self.assertIsNone(cache.get("a" * 64))
        self.assertEqual(cache.stats()["corruptions"], 1)

    def test_processes_share_transactions_without_partial_rows(self):
        script = (
            "import sys; from pathlib import Path; from pankeki.cache import ExactCache; "
            "cache=ExactCache(Path(sys.argv[1])); "
            "data=bytes.fromhex(sys.argv[3]); "
            "assert cache.put(sys.argv[2],data); assert cache.get(sys.argv[2])==data"
        )
        jobs = []
        for index in range(4):
            key = hashlib.sha256(str(index).encode()).hexdigest()
            jobs.append(subprocess.Popen([sys.executable, "-c", script, str(self.root), key, png().hex()],
                                         cwd=Path(__file__).resolve().parents[1],
                                         stdout=subprocess.PIPE, stderr=subprocess.PIPE))
        for job in jobs:
            stdout, stderr = job.communicate(timeout=30)
            self.assertEqual(job.returncode, 0, (stdout, stderr))
        self.assertEqual(self.api.ExactCache(self.root).stats()["entries"], 4)

    def test_multiple_instances_and_threads_install_complete_rows(self):
        caches = [self.api.ExactCache(self.root) for _ in range(4)]
        def worker(index):
            key = hashlib.sha256(str(index).encode()).hexdigest()
            data = png(bytes([index, 0, 0]))
            cache = caches[index % len(caches)]
            self.assertTrue(cache.put(key, data, {"index": index}))
            self.assertEqual(cache.get(key), data)
            return key, data
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(worker, range(32)))
        restarted = self.api.ExactCache(self.root)
        self.assertEqual(restarted.stats()["entries"], 32)
        for key, data in results:
            self.assertEqual(restarted.get(key), data)


if __name__ == "__main__":
    unittest.main()

"""Model digest reuse under the stat_cache fingerprint policy; tiny fixtures, no model/GPU/server."""
import hashlib
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from pankeki import engine as engine_module
from pankeki.engine import Engine, ModelDigestCache
from pankeki.jobs import JobManager
from tests.test_engine import PNGComfyClient

MODEL = 'animagine-xl-4.0-opt'
NAME = 'animagine-xl-4.0-opt.safetensors'


class DigestCacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.file = Path(self.temp.name) / 'weights.safetensors'
        self.file.write_bytes(b'A' * 4096)

    def counted(self):
        calls = []
        real = engine_module.file_sha256
        def spy(path):
            calls.append(path)
            return real(path)
        return calls, patch.object(engine_module, 'file_sha256', spy)

    def test_unchanged_file_is_read_once(self):
        cache = ModelDigestCache()
        calls, spy = self.counted()
        with spy:
            first = cache.sha256(self.file)
            second = cache.sha256(self.file)
        self.assertEqual(first, second)
        self.assertEqual(first, hashlib.sha256(self.file.read_bytes()).hexdigest())
        self.assertEqual(len(calls), 1)
        self.assertEqual((cache.hits, cache.misses), (1, 1))

    def test_same_size_rewrite_with_restored_mtime_is_rehashed(self):
        cache = ModelDigestCache()
        before = cache.sha256(self.file)
        stat = os.stat(self.file)
        with self.file.open('r+b') as stream:
            stream.write(b'B')
        os.utime(self.file, ns=(stat.st_atime_ns, stat.st_mtime_ns))
        after = cache.sha256(self.file)
        self.assertNotEqual(before, after)
        self.assertEqual(after, hashlib.sha256(self.file.read_bytes()).hexdigest())

    def test_replaced_file_is_rehashed(self):
        cache = ModelDigestCache()
        before = cache.sha256(self.file)
        replacement = self.file.with_suffix('.new')
        replacement.write_bytes(b'C' * 4096)
        os.replace(replacement, self.file)
        self.assertNotEqual(cache.sha256(self.file), before)

    def test_digest_changed_during_read_is_not_stored(self):
        cache = ModelDigestCache()
        real = engine_module.file_sha256
        def mutating(path):
            digest = real(path)
            with open(path, 'ab') as stream:
                stream.write(b'!')
            return digest
        with patch.object(engine_module, 'file_sha256', mutating):
            cache.sha256(self.file)
        self.assertEqual(cache._entries, {})


class EngineDigestPolicyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.models = {}
        for model_id, name in [('sdxl-base', 'sd_xl_base_1.0.safetensors'), (MODEL, NAME)]:
            file = self.root / name; file.write_bytes(('tiny fixture ' + model_id).encode())
            self.models[model_id] = dict(model_name=name, model_path=str(file),
                manifest=dict(schema=1, model_name=name, model_sha256=hashlib.sha256(file.read_bytes()).hexdigest()))
        self.client = PNGComfyClient()

    def manager(self, policy):
        engine = Engine(self.root, config={'transport': 'direct', 'managed_builtin_only': False, 'fingerprint_policy': policy,
                                           'models': self.models, 'default_model_id': 'sdxl-base'}, client=self.client)
        self.addCleanup(engine.close)
        manager = JobManager(engine); self.addCleanup(manager.close)
        return manager

    @staticmethod
    def generate(manager):
        request = dict(model_id=MODEL, mode='txt2img', prompt='1girl', width=64, height=64, cache=False, preview=False)
        return manager.wait(manager.submit('digest-fixture', request)['job_id'], timeout=5)

    def test_stat_cache_reuses_the_verified_digest_and_records_it(self):
        manager = self.manager('stat_cache')
        first, second = self.generate(manager), self.generate(manager)
        self.assertEqual(first['state'], 'succeeded', first['error'])
        self.assertEqual(second['state'], 'succeeded', second['error'])
        self.assertEqual(first['result']['metrics']['fingerprint_reused'], 0)
        self.assertEqual(second['result']['metrics']['fingerprint_reused'], 1)
        self.assertEqual(second['result']['metrics']['fingerprint_policy'], 'stat_cache')

    def test_stat_cache_still_rejects_changed_weights(self):
        manager = self.manager('stat_cache')
        self.assertEqual(self.generate(manager)['state'], 'succeeded')
        weight = Path(self.models[MODEL]['model_path'])
        weight.write_bytes(b'x' * len(weight.read_bytes()))
        job = self.generate(manager)
        self.assertEqual(job['state'], 'failed')
        self.assertRegex(job['error'], 'SHA256|bytes|manifest')

    def test_strict_policy_reads_every_time(self):
        manager = self.manager('strict')
        self.generate(manager)
        second = self.generate(manager)
        self.assertEqual(second['result']['metrics']['fingerprint_reused'], 0)
        self.assertEqual(second['result']['metrics']['fingerprint_policy'], 'strict')

    def test_unknown_policy_is_still_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Unknown fingerprint policy'):
            Engine(self.root, config={'fingerprint_policy': 'trust_me'}, client=self.client)

    def test_mac_launcher_selects_stat_cache(self):
        spec = importlib.util.spec_from_file_location('digest_run_macos', Path(__file__).parents[1] / 'scripts/run_macos.py')
        launcher = importlib.util.module_from_spec(spec); spec.loader.exec_module(launcher)
        self.assertEqual(launcher.build_config(self.root)['fingerprint_policy'], 'stat_cache')


if __name__ == '__main__':
    unittest.main()

import copy
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from pankeki.capabilities import capability_snapshot, targeted_cancel_status, validate_snapshot
from pankeki.engine import Engine
from pankeki.model_presets import MODEL_PRESETS


class CapabilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        models = {}
        for key, preset in MODEL_PRESETS.items():
            path = self.root / preset['checkpoint']; path.write_bytes(b'fixture')
            models[key] = {'model_name':preset['checkpoint'],'model_path':str(path),
                'manifest':{'model_name':preset['checkpoint'],'model_sha256':'a'*64}}
        models['sdxl-inpaint-v01']['conditioning_model_id'] = 'sdxl-base'
        self.engine = Engine(self.root, config={'models':models,'default_model_id':'sdxl-base'})
        self.addCleanup(self.engine.close)

    def test_matrix_defaults_cpu_readiness_and_cache_reason(self):
        snapshot = capability_snapshot(self.engine)
        self.assertEqual(validate_snapshot(snapshot), snapshot)
        models = {row['id']:row for row in snapshot['models']}
        self.assertEqual(models['animagine-xl-4.0-opt']['operations'], ['generate','recompose'])
        self.assertNotIn('recompose', models['sd-turbo']['operations'])
        self.assertEqual(models['sdxl-inpaint-v01']['operations'], ['regenerate','erase'])
        self.assertEqual(models['sdxl-base']['defaults'], MODEL_PRESETS['sdxl-base']['defaults'])
        operations = {row['id']:row for row in snapshot['operations']}
        self.assertTrue(operations['recolor']['ready'])
        self.assertEqual(operations['recolor']['lane'], 'cpu')
        self.assertFalse(snapshot['cache']['enabled'])
        self.assertIn('bypass', snapshot['cache']['reason'])
        self.assertTrue(operations['erase']['ready'])
        self.assertEqual(operations['erase']['lane'], 'gpu')
        self.assertNotIn('targeted_cancel', snapshot)
        self.assertEqual(targeted_cancel_status(self.engine)['state'], 'unknown')
        # Cancel verification at the first job must not invalidate a page's captured revision.
        self.engine.client.targeted_cancel_capability = {'state':'verified','atomic_source_verified':True,'route_verified':True}
        self.assertEqual(capability_snapshot(self.engine)['revision'], snapshot['revision'])

    def test_missing_conditioning_and_revision_or_operation_rejection(self):
        original = capability_snapshot(self.engine)
        Path(self.engine.models['sdxl-base']['model_path']).unlink()
        missing = capability_snapshot(self.engine)
        models = {row['id']:row for row in missing['models']}
        self.assertFalse(models['sdxl-inpaint-v01']['installed'])
        self.assertNotEqual(missing['revision'], original['revision'])
        bad = copy.deepcopy(missing); bad['revision'] = '0'*64
        with self.assertRaises(ValueError): validate_snapshot(bad)
        bad = copy.deepcopy(missing); bad['operations'][0]['id'] = 'invented'
        with self.assertRaises(ValueError): validate_snapshot(bad)

    @unittest.skipUnless(shutil.which('node'), 'Node runtime unavailable')
    def test_actual_python_snapshot_json_roundtrip_matches_shared_js_validator(self):
        snapshot = capability_snapshot(self.engine)
        self.assertIsInstance(MODEL_PRESETS['sdxl-base']['defaults']['cfg'], float)
        self.assertIsInstance(snapshot['models'][0]['defaults']['cfg'], int)
        script = "const fs=require('fs');const p=require(process.argv[1]);const v=JSON.parse(fs.readFileSync(0,'utf8'));p.validateCapabilities(v);process.stdout.write(p.capabilityRevision(v));"
        process = subprocess.run([shutil.which('node'), '-e', script,
            str(Path(__file__).resolve().parents[1] / 'web/src/profiles.js')],
            input=json.dumps(snapshot,ensure_ascii=False),capture_output=True,text=True,timeout=10,check=False)
        self.assertEqual(process.returncode,0,process.stderr)
        self.assertEqual(process.stdout,snapshot['revision'])

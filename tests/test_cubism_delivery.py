"""Synthetic route bytes verify delivery guards, never official SDK supply."""
import hashlib
import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from pankeki.server import make_server

class CubismDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        self.vendor = self.root / 'web/vendor/cubism'; self.vendor.mkdir(parents=True)
        (self.root/'web/index.html').write_text('fixture')
        self.files = {'live2dcubismcore.js': b'/* synthetic core */', 'pankeki-cubism-framework.js': b'/* synthetic framework */', 'Shaders/test.frag': b'void main() {}'}
        for name, data in self.files.items():
            p = self.vendor/name; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(data)
        self.manifest = {'format':'pankeki-cubism-runtime','version':1,'sdk':{'coreVersion':'synthetic-test','coreHash':self.digest(self.files['live2dcubismcore.js']),'frameworkCommit':'a'*40,'bundleHash':self.digest(self.files['pankeki-cubism-framework.js'])},'files':{name:self.digest(data) for name,data in self.files.items()}}
        self.write_manifest()
        self.server = make_server(self.root, port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval':.02}, daemon=True); self.thread.start()
    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.server.manager.close(); self.server.engine.close(); self.thread.join(timeout=2); self.temp.cleanup()
    @staticmethod
    def digest(data): return hashlib.sha256(data).hexdigest()
    def write_manifest(self): (self.vendor/'runtime-manifest.json').write_text(json.dumps(self.manifest))
    def get(self,path,headers=None):
        c=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=3)
        try:
            c.request('GET',path,headers=headers or {}); r=c.getresponse(); return r.status,dict(r.getheaders()),r.read()
        finally: c.close()
    def test_fixed_assets_shaders_and_manifest_match_hash_mime(self):
        for name,data in self.files.items():
            with self.subTest(name=name):
                code,headers,body=self.get('/vendor/cubism/'+name); self.assertEqual(code,200); self.assertEqual(body,data); self.assertEqual(self.digest(body),self.manifest['files'][name]); self.assertEqual(headers['X-Content-Type-Options'],'nosniff'); self.assertIn('javascript' if name.endswith('.js') else 'text/plain',headers['Content-Type'])
        self.assertEqual(self.get('/vendor/cubism/runtime-manifest.json')[0],200)
    def test_missing_manifest_core_bundle_or_asset_is_404(self):
        for name in ['runtime-manifest.json','live2dcubismcore.js','pankeki-cubism-framework.js','Shaders/test.frag']:
            p=self.vendor/name; original=p.read_bytes(); p.unlink(); self.assertEqual(self.get('/vendor/cubism/'+name)[0],404); p.write_bytes(original)
    def test_unknown_files_traversal_and_encoded_paths_are_404(self):
        (self.vendor/'secret.txt').write_text('private')
        for suffix in ['secret.txt','../index.html','Shaders/../live2dcubismcore.js','Shaders/%2e%2e/secret.txt','Shaders/%252e%252e/secret.txt','Shaders%2ftest.frag','Shaders//test.frag','Shaders/unknown.frag','live2dcubismcore.js%00']:
            with self.subTest(suffix=suffix): self.assertEqual(self.get('/vendor/cubism/'+suffix)[0],404)
    def test_tampered_asset_manifest_hash_or_schema_is_404(self):
        p=self.vendor/'Shaders/test.frag'; p.write_bytes(b'tampered'); self.assertEqual(self.get('/vendor/cubism/Shaders/test.frag')[0],404)
        self.manifest['sdk']['coreHash']='0'*64; self.write_manifest(); self.assertEqual(self.get('/vendor/cubism/runtime-manifest.json')[0],404)
        self.manifest['version']=2; self.write_manifest(); self.assertEqual(self.get('/vendor/cubism/live2dcubismcore.js')[0],404)
    def test_symlink_escape_and_symlink_directory_are_404(self):
        p=self.vendor/'Shaders/test.frag'; p.unlink(); outside=self.root/'outside.frag'; outside.write_bytes(self.files['Shaders/test.frag']); p.symlink_to(outside); self.assertEqual(self.get('/vendor/cubism/Shaders/test.frag')[0],404)
        p.unlink(); (self.vendor/'Shaders').rmdir(); (self.vendor/'Shaders').symlink_to(self.root,target_is_directory=True); self.assertEqual(self.get('/vendor/cubism/Shaders/test.frag')[0],404)
    def test_existing_host_origin_guards_remain(self):
        for headers in [{'Host':'evil.invalid'},{'Origin':'https://evil.invalid'},{'Origin':'null'}]: self.assertEqual(self.get('/vendor/cubism/live2dcubismcore.js',headers)[0],400)

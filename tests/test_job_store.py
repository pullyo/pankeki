import json
import base64
import hashlib
import io
import tempfile
import unittest
from pathlib import Path
from PIL import Image

from pankeki.job_store import JobStore


class JobStoreTests(unittest.TestCase):
    def test_plain_and_data_uri_payloads_store_only_decoded_hash_and_size(self):
        stream = io.BytesIO(); Image.new('RGBA',(2,2),(20,30,40,50)).save(stream,format='PNG')
        raw = stream.getvalue(); encoded = base64.b64encode(raw).decode()
        reference = {'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
        with tempfile.TemporaryDirectory() as tmp:
            store = JobStore(Path(tmp)/'jobs.sqlite')
            store.create({'job_id':'d'*32,'session':'s','request':{
                'source':encoded,'mask':'data:image/png;base64,'+encoded,
                'nested':{'image':{'png':encoded,'sha256':reference['sha256'],
                                   'attachments':[encoded,{'data':encoded}]}},
                'prompt':'ordinary illustration prompt'}})
            item = store.get('d'*32)
            self.assertEqual(item['request']['source'],reference)
            self.assertEqual(item['request']['mask'],reference)
            self.assertEqual(item['request']['nested']['image']['png'],reference)
            persisted = store.connection.execute('SELECT record FROM jobs').fetchone()[0]
            self.assertNotIn(encoded,persisted)
            self.assertNotIn('data:image/',persisted)
            store.transition('d'*32,['queued'],{'result':{'image':{'png':encoded}}})
            self.assertNotIn(encoded,store.connection.execute('SELECT record FROM jobs').fetchone()[0])
            store.close()

    def test_base64_like_prompt_is_text_and_malformed_nested_payload_is_opaque(self):
        text = base64.b64encode(b'keep this user prompt').decode()
        with tempfile.TemporaryDirectory() as tmp:
            store = JobStore(Path(tmp)/'jobs.sqlite')
            store.create({'job_id':'e'*32,'session':'s','request':{'prompt':text,'negative':text,
                'source':{'nested':{'payload':'not-valid-base64!','raw':[1,2,3,4]}}}})
            item = store.get('e'*32)['request']
            self.assertEqual(item['prompt'],text)
            self.assertEqual(item['negative'],text)
            self.assertNotIn('not-valid-base64!',json.dumps(item['source']))
            self.assertIsInstance(item['source']['nested']['raw'],dict)
            store.close()

    def test_reopen_revisions_orphaning_and_no_image_payload(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'jobs.sqlite'
            store = JobStore(path)
            item = store.create({'job_id': 'a' * 32, 'session': 's', 'state': 'submitting',
                                 'lane': 'gpu', 'request': {'source': 'data:image/png;base64,SECRET'}})
            self.assertEqual(item['revision'], 1)
            store.close()
            store = JobStore(path)
            store.acquire_owner()
            self.assertEqual(store.mark_orphaned(), ['a' * 32])
            self.assertEqual(store.get('a' * 32)['state'], 'orphaned')
            self.assertEqual(store.create({'job_id': 'b' * 32, 'session': 's'})['revision'], 2)
            self.assertNotIn('SECRET', json.dumps(store.get('a' * 32)))
            self.assertFalse(store.transition('a' * 32, ['running'], {'state': 'succeeded'}))
            store.close()

    def test_submission_and_success_are_durable(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = JobStore(Path(tmp) / 'jobs.sqlite')
            store.create({'job_id': 'c' * 32, 'session': 's'})
            self.assertTrue(store.transition('c' * 32, ['queued'], {'state': 'submitting', 'client_id': 'client', 'workflow_sha256': 'd' * 64}))
            self.assertTrue(store.transition('c' * 32, ['submitting'], {'state': 'succeeded', 'result': {'result_sha256': 'e' * 64, 'run_ref': 'runs/' + 'c' * 32}}))
            store.acquire_owner()
            self.assertEqual(store.mark_orphaned(), [])
            self.assertEqual(store.get('c' * 32)['client_id'], 'client')
            store.close()

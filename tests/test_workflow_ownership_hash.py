"""Recorded real history shapes; no live Comfy calls or historical record edits."""
import copy
import json
from pathlib import Path
import unittest
import uuid
from unittest.mock import patch

from pankeki.comfy_adapter import ComfyClient, SubmissionUncertain, workflow_sha256


class WorkflowOwnershipHashTests(unittest.TestCase):
    def recorded_cases(self):
        return json.loads((Path(__file__).parent/'fixtures/owned-comfy-numeric-history.json').read_text())['cases']

    def test_recorded_actual_history_normalization_matches_submitted_ownership(self):
        client = ComfyClient()
        for case in self.recorded_cases():
            with self.subTest(job_id=case['job_id']):
                graph, row = case['submitted_workflow'], case['history_prompt']
                self.assertEqual(graph,row[2])
                self.assertNotEqual(case['legacy_raw_workflow_sha256'],case['legacy_raw_history_sha256'])
                digest = workflow_sha256(graph)
                self.assertEqual(digest,workflow_sha256(row[2]))
                self.assertTrue(client._owned(row,case['client_id'],digest,case['prompt_id']))
                with patch.object(client,'get',side_effect=[{'queue_running':[],'queue_pending':[]},
                    {case['prompt_id']:{'prompt':row}}]):
                    found = client.reconcile_submission(case['client_id'],digest)
                self.assertEqual(found,{'state':'found','prompt_id':case['prompt_id'],'location':'history'})

    def test_lost_response_persists_same_canonical_digest_before_post(self):
        for case in self.recorded_cases():
            client=ComfyClient(); persisted=[]
            graph=case['submitted_workflow']; digest=workflow_sha256(graph)
            def lost(workflow,client_id):
                self.assertEqual(persisted,[(case['client_id'],digest)])
                raise SubmissionUncertain('controlled lost response')
            completed={'outputs':{'7':{'images':[{'type':'output','filename':'controlled.png'}]}}}
            with self.subTest(job_id=case['job_id']), patch('pankeki.comfy_adapter.uuid.uuid4',return_value=uuid.UUID(case['client_id'])), \
                    patch.object(client,'_connect_ws',return_value=None), patch.object(client,'submit',side_effect=lost) as post, \
                    patch.object(client,'get',side_effect=[{'queue_running':[],'queue_pending':[]},
                        {case['prompt_id']:{'prompt':case['history_prompt']}}]), \
                    patch.object(client,'wait',return_value=(completed,{})), patch.object(client,'_request',return_value=b'controlled-png'):
                data,result=client.execute(graph,on_submitting=lambda *args:persisted.append(args))
            self.assertEqual(data,b'controlled-png'); self.assertEqual(post.call_count,1)
            self.assertEqual(result['workflow_sha256'],digest)
            self.assertEqual(result['prompt_id'],case['prompt_id'])

    def test_owned_dequeue_uses_recorded_normalized_graph_and_exact_prompt_id(self):
        for case in self.recorded_cases():
            client=ComfyClient(); digest=workflow_sha256(case['submitted_workflow'])
            with self.subTest(job_id=case['job_id']), patch.object(client,'get',side_effect=[
                {'queue_running':[],'queue_pending':[case['history_prompt']]},
                {'queue_running':[],'queue_pending':[]},{}]), patch.object(client,'_request',return_value=b'{}') as post:
                result=client.cancel_owned(case['prompt_id'],case['client_id'],digest)
            self.assertEqual(result['state'],'confirmed')
            self.assertEqual(post.call_args.args[0],'/queue')
            self.assertEqual(json.loads(post.call_args.args[1]),{'delete':[case['prompt_id']]})

    def test_equal_numeric_values_only_not_bool_string_or_graph_mutations(self):
        graph={'5':{'class_type':'KSampler','inputs':{'cfg':5,'denoise':1,'flag':True,'text':'5','seed':2**53+1,'link':['4',0]}}}
        normalized=copy.deepcopy(graph)
        normalized['5']['inputs'].update(cfg=5.0,denoise=1.0)
        self.assertEqual(workflow_sha256(graph),workflow_sha256(normalized))
        for key,value in (('cfg',6),('cfg',5.0001),('cfg','5'),('cfg',True),('flag',1),('text',5),
                          ('seed',float(2**53+1)),('link',[0,'4'])):
            changed=copy.deepcopy(graph); changed['5']['inputs'][key]=value
            with self.subTest(key=key,value=value): self.assertNotEqual(workflow_sha256(graph),workflow_sha256(changed))
        changed=copy.deepcopy(graph); changed['5']['class_type']='DifferentNode'
        self.assertNotEqual(workflow_sha256(graph),workflow_sha256(changed))

    def test_non_finite_numbers_reject_before_submission_persistence_or_post(self):
        client=ComfyClient()
        for value in (float('nan'),float('inf'),float('-inf')):
            with self.subTest(value=value):
                graph={'5':{'inputs':{'cfg':value}}}
                with self.assertRaises(ValueError): workflow_sha256(graph)
                persisted=[]
                with patch.object(client,'_connect_ws') as ws, patch.object(client,'submit') as submit:
                    with self.assertRaises(ValueError): client.execute(graph,on_submitting=lambda *args:persisted.append(args))
                self.assertEqual(persisted,[]); submit.assert_not_called(); ws.assert_not_called()

import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import asyncio
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('capability_mcp', Path(__file__).parents[1] / 'pankeki_mcp.py')
api = importlib.util.module_from_spec(spec); spec.loader.exec_module(api)


def snapshot():
    value = {'schema':1,'models':[
        {'id':'sdxl-base','operations':['generate','regenerate','recompose'],'installed':True},
        {'id':'sd-turbo','operations':['generate','regenerate'],'installed':False}],
        'operations':[{'id':name,'ready':True,'reason':None,'lane':'cpu' if name=='recolor' else 'gpu','model_ids':[],'experimental':False}
                      for name in ('generate','regenerate','recolor','recompose')]}
    value['revision'] = hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
    return value


class CapabilityConsumerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.adapter = api.Adapter(self.root)

    def test_schema_and_execution_derive_from_validated_server_matrix(self):
        with patch.object(self.adapter,'_http',return_value=snapshot()):
            schema = self.adapter.schema_options()
            self.assertEqual(schema['generate_models'], ['sdxl-base','sd-turbo'])
            self.assertEqual(schema['edit_models'], ['sdxl-base','sd-turbo'])
            with self.assertRaisesRegex(api.AdapterError,'installed'):
                self.adapter.generate_image('test',model_id='sd-turbo')
        invalid = snapshot(); invalid['revision']='0'*64
        with patch.object(self.adapter,'_http',return_value=invalid):
            with self.assertRaisesRegex(api.AdapterError,'revision'): self.adapter.schema_options()

    def test_model_ids_with_dots_are_accepted(self):
        value = snapshot()
        value['models'].append({'id':'animagine-xl-4.0-opt','operations':['generate','recompose'],'installed':True})
        del value['revision']
        value['revision'] = hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
        with patch.object(self.adapter,'_http',return_value=value):
            self.assertIn('animagine-xl-4.0-opt', self.adapter.schema_options()['generate_models'])

    def test_only_explicit_404_allows_legacy_contract(self):
        error = api.AdapterError('503'); error.status_code=503
        with patch.object(self.adapter,'_http',side_effect=error):
            with self.assertRaises(api.AdapterError): self.adapter.schema_options()
        error = api.AdapterError('404'); error.status_code=404
        with patch.object(self.adapter,'_http',side_effect=error):
            self.assertIn('animagine-xl-4.0-opt', self.adapter.schema_options()['generate_models'])

    def test_orphaned_is_terminal_and_execution_link_stays_private(self):
        job_id = 'a'*32
        job = {'job_id':job_id,'session':'s','revision':1,'state':'orphaned',
            'trace_id':'secret-trace','run_ref':'runs/'+job_id,'result':None}
        with patch.object(self.adapter,'_record',return_value={'session':'s','revision':1}), patch.object(self.adapter,'_http',return_value=job):
            public = self.adapter.get_job(job_id)
            self.assertEqual(public['state'],'orphaned')
            self.assertNotIn('secret-trace',json.dumps(public))
            self.assertNotIn('runs/',json.dumps(public))

    def test_private_bridge_trace_is_forwarded_without_entering_public_result(self):
        def http(path,body=None,**kwargs):
            if path == '/api/capabilities': return snapshot()
            self.assertEqual(body['request']['trace_id'],'bridge-request')
            return {'job_id':'b'*32,'session':body['session'],'revision':1,'state':'queued',
                    'trace_id':'bridge-request','run_ref':None,'result':None}
        with patch.object(self.adapter,'_http',side_effect=http):
            result = self.adapter.generate_image('test',trace_id='bridge-request')
        self.assertNotIn('bridge-request',json.dumps(result))

    @unittest.skipUnless(importlib.util.find_spec('mcp'), 'official SDK runtime owned by Mac release')
    def test_official_sdk_schema_uses_the_validated_server_capability_matrix(self):
        with patch.object(self.adapter,'_http',return_value=snapshot()):
            server = api.create_server(self.adapter)
        tools = {tool.name:tool for tool in asyncio.run(server.list_tools())}
        generate = tools['pankeki_generate_image'].input_schema['properties']['model_id']['enum']
        self.assertEqual(generate,['sdxl-base','sd-turbo'])
        self.assertNotIn('animagine-xl-4.0-opt',generate)

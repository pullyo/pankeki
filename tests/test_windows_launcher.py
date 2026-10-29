"""Windows launcher logic, checked on any OS by injecting the platform-specific calls.

These are logic tests. They do not show that ComfyUI, CUDA or the app run on a real Windows PC.
"""
import importlib.util
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('run_windows', ROOT / 'scripts' / 'run_windows.py')
run_windows = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run_windows)


class FakeProcess:
    def __init__(self, pid=4321, exits_after_polite=True):
        self.pid = pid
        self.returncode = None
        self.exits_after_polite = exits_after_polite
        self.waits = 0

    def poll(self):
        return self.returncode

    def wait(self, timeout=None):
        self.waits += 1
        if self.returncode is None:
            raise subprocess.TimeoutExpired('python', timeout)
        return self.returncode


class WindowsLauncherTests(unittest.TestCase):
    def test_comfy_command_uses_absolute_main_and_the_desktop_identity_flags(self):
        directories = {name: Path('D:/내 작업/runtime/windows') / ('comfy-' + name) for name in ('user', 'input', 'output', 'temp')}
        command = run_windows.comfy_command('python.exe', Path('D:/내 작업/runtime/windows/model-paths.yaml'), directories, 8188)
        self.assertEqual(command[2], str(ROOT / 'vendor' / 'ComfyUI' / 'main.py'))
        for flag, value in (('--listen', '127.0.0.1'), ('--port', '8188'),
                            ('--extra-model-paths-config', str(Path('D:/내 작업/runtime/windows/model-paths.yaml')))):
            self.assertEqual(command[command.index(flag) + 1], value)
        self.assertNotIn('--cpu', command)
        self.assertEqual(run_windows.comfy_command('python.exe', Path('m.yaml'), directories, 8188, cpu=True)[-1], '--cpu')

    def test_child_environment_drops_the_mps_switch_and_forces_utf8(self):
        with mock.patch.dict(os.environ, {'PYTORCH_ENABLE_MPS_FALLBACK': '1'}):
            environment = run_windows.child_environment()
        self.assertNotIn('PYTORCH_ENABLE_MPS_FALLBACK', environment)
        self.assertEqual(environment['PYTHONUTF8'], '1')
        self.assertEqual(environment['HF_HUB_OFFLINE'], '1')

    def test_stop_tree_uses_taskkill_tree_then_force_on_windows(self):
        process = FakeProcess()
        calls = []

        def fake_run(command, **_kwargs):
            calls.append(command)
            if '/F' in command:
                process.returncode = 1
            return subprocess.CompletedProcess(command, 0)

        with mock.patch.object(run_windows, 'is_windows', return_value=True), mock.patch.object(run_windows.subprocess, 'run', fake_run), \
                mock.patch.dict(os.environ, {'SystemRoot': 'C:/Windows'}):
            run_windows.stop_tree(process, timeout=0)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][0], 'C:/Windows\\System32\\taskkill.exe')
        self.assertEqual(calls[0][1:], ['/PID', '4321', '/T'])
        self.assertEqual(calls[1][1:], ['/PID', '4321', '/T', '/F'])

    def test_cuda_probe_reports_failure_instead_of_claiming_a_gpu(self):
        failed = subprocess.CompletedProcess([], 1, stdout='', stderr='ModuleNotFoundError: torch')
        with mock.patch.object(run_windows.subprocess, 'run', return_value=failed):
            self.assertEqual(run_windows.cuda_status('python.exe')['cuda'], False)
        ok = subprocess.CompletedProcess([], 0, stdout=json.dumps({'cuda': True, 'device': 'RTX'}) + '\n', stderr='')
        with mock.patch.object(run_windows.subprocess, 'run', return_value=ok):
            self.assertEqual(run_windows.cuda_status('python.exe')['device'], 'RTX')

    def test_windows_launcher_file_keeps_crlf_and_selects_runtimes(self):
        data = (ROOT / 'Pankeki.cmd').read_bytes()
        self.assertNotIn(b'\n', data.replace(b'\r\n', b''))
        text = data.decode('utf-8')
        self.assertIn(r'.venv-windows\Scripts\python.exe', text)
        self.assertIn(r'.venv-windows-editor\Scripts\python.exe', text)
        self.assertIn(r'scripts\run_windows.py %*', text)

    def test_setup_script_has_a_bom_for_windows_powershell(self):
        data = (ROOT / 'scripts' / 'setup-windows.ps1').read_bytes()
        self.assertTrue(data.startswith(b'\xef\xbb\xbf'))
        text = data.decode('utf-8-sig')
        self.assertIn("$TorchVersion = '2.14.1'", text)
        self.assertIn('8f04fd6ecf4a548937971e840af2a985529fab76', text)


class McpLauncherWindowsTests(unittest.TestCase):
    def test_windows_branch_runs_the_server_as_a_child_instead_of_exec(self):
        spec = importlib.util.spec_from_file_location('launch', ROOT / 'plugins' / 'pankeki-local' / 'scripts' / 'launch.py')
        launch = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(launch)
        with tempfile.TemporaryDirectory(prefix='pankeki 한글 ') as temp:
            app = Path(temp) / 'app'
            (app / 'pankeki').mkdir(parents=True)
            (app / 'pankeki' / 'server.py').write_text('')
            calls = []
            with mock.patch.dict(os.environ, {'PANKEKI_APP_ROOT': str(app), 'PANKEKI_PYTHON': sys.executable}), \
                    mock.patch.object(launch, '_is_windows', return_value=True), mock.patch.object(launch.os, 'execv', side_effect=AssertionError('execv on Windows')), \
                    mock.patch('subprocess.call', side_effect=lambda command: calls.append(command) or 7), \
                    mock.patch.object(sys, 'argv', ['launch.py', '--state-dir', 'x']):
                self.assertEqual(launch.main(), 7)
        self.assertEqual(calls[0][0], sys.executable)
        self.assertEqual(calls[0][-2:], ['--state-dir', 'x'])


class PrepareRuntimeTests(unittest.TestCase):
    """Review finding 4: setup must leave the files the desktop app requires, without starting servers."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pankeki 한글 fresh ')
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_fresh_folder_gets_both_files_and_a_second_run_writes_nothing(self):
        first = run_windows.prepare_runtime(self.root)
        config = json.loads((self.root / 'runtime/windows/config.json').read_text(encoding='utf-8'))
        self.assertEqual(config['models']['sdxl-base']['model_path'], str(self.root / 'models' / 'checkpoints' / 'sd_xl_base_1.0.safetensors'))
        self.assertIn(json.dumps(str(self.root / 'models')), (self.root / 'runtime/windows/model-paths.yaml').read_text(encoding='utf-8'))
        self.assertEqual(len(first['written']), 2)
        self.assertEqual(run_windows.prepare_runtime(self.root)['written'], [])

    def test_matching_config_keeps_extra_keys_and_a_moved_folder_is_regenerated(self):
        run_windows.prepare_runtime(self.root)
        path = self.root / 'runtime/windows/config.json'
        config = json.loads(path.read_text(encoding='utf-8'))
        config['comfy_atomic_cancel'] = {'schema': 1, 'state': 'unknown'}
        path.write_text(json.dumps(config), encoding='utf-8')
        run_windows.prepare_runtime(self.root)
        self.assertIn('comfy_atomic_cancel', json.loads(path.read_text(encoding='utf-8')))
        config['models']['sdxl-base']['model_path'] = 'D:\\old drive\\Pankeki\\models\\checkpoints\\sd_xl_base_1.0.safetensors'
        path.write_text(json.dumps(config), encoding='utf-8')
        self.assertIn(str(path), run_windows.prepare_runtime(self.root)['written'])
        self.assertNotIn('old drive', path.read_text(encoding='utf-8'))

    @unittest.skipUnless(shutil.which('node'), 'node is needed to load desktop/runtime-paths.cjs')
    def test_prepared_folder_is_accepted_by_the_desktop_resolver_for_windows(self):
        for relative in ('.venv-windows/Scripts/python.exe', 'vendor/ComfyUI/main.py', 'pankeki/__main__.py', 'web/index.html'):
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('')
        script = ("const {resolveRuntime}=require(process.argv[1]);"
                  "try{const r=resolveRuntime({projectRoot:process.argv[2],platform:'win32',codexPath:null});console.log(JSON.stringify({ok:true,config:r.config}));}"
                  "catch(e){console.log(JSON.stringify({ok:false,error:e.message}));}")
        resolver = str(ROOT / 'desktop' / 'runtime-paths.cjs')
        before = json.loads(subprocess.run(['node', '-e', script, resolver, str(self.root)], capture_output=True, text=True, check=True).stdout)
        self.assertEqual(before, {'ok': False, 'error': 'runtime-missing'})
        run_windows.prepare_runtime(self.root)
        after = json.loads(subprocess.run(['node', '-e', script, resolver, str(self.root)], capture_output=True, text=True, check=True).stdout)
        self.assertTrue(after['ok'], after)

    def test_setup_script_runs_the_prepare_step(self):
        text = (ROOT / 'scripts' / 'setup-windows.ps1').read_text(encoding='utf-8-sig')
        self.assertIn("'--prepare-only'", text)


if __name__ == '__main__':
    unittest.main()

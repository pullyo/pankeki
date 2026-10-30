"""Launcher behavior only; fixtures never contact HTTP or use a GPU."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "launch.py"

class LauncherTests(unittest.TestCase):
    def fixture(self, directory):
        app = Path(directory) / "SSD app with spaces"
        (app / "pankeki").mkdir(parents=True)
        (app / "pankeki/server.py").write_text("# fixture")
        plugin = Path(directory) / "plugin path with spaces"
        (plugin / "scripts").mkdir(parents=True)
        (plugin / "server").mkdir()
        self.assertTrue(SOURCE.is_file(), "launcher implementation is required")
        shutil.copy2(SOURCE, plugin / "scripts/launch.py")
        (plugin / "server/pankeki_mcp.py").write_text(
            "import json,sys; print(json.dumps({'argv':sys.argv[1:],'input':sys.stdin.readline().rstrip()}))"
        )
        env = dict(os.environ, PANKEKI_APP_ROOT=str(app), PANKEKI_PYTHON=sys.executable,
                   PANKEKI_API_URL="http://127.0.0.1:8190")
        return app, plugin, env

    def run_launcher(self, plugin, env, *args):
        return subprocess.run([sys.executable, str(plugin / "scripts/launch.py"), *args],
                              env=env, input='{"jsonrpc":"2.0"}\n', text=True,
                              capture_output=True, timeout=10)

    def test_space_paths_preserve_argv_and_protocol_stdout(self):
        with tempfile.TemporaryDirectory() as d:
            app, plugin, env = self.fixture(d)
            result = self.run_launcher(plugin, env, "--help")
            self.assertEqual(result.returncode, 0, result.stderr)
            value = json.loads(result.stdout)
            self.assertEqual(value["argv"], ["--app-root", str(app), "--api-url",
                                             "http://127.0.0.1:8190", "--help"])
            self.assertEqual(value["input"], '{"jsonrpc":"2.0"}')
            self.assertEqual(result.stderr, "")

    def test_missing_app_fails_on_stderr_without_stdout(self):
        with tempfile.TemporaryDirectory() as d:
            app, plugin, env = self.fixture(d)
            env["PANKEKI_APP_ROOT"] = str(app / "not mounted")
            result = self.run_launcher(plugin, env)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(result.stdout, "")
            self.assertIn("Pankeki app root", result.stderr)

    def test_missing_python_fails_on_stderr_without_stdout(self):
        with tempfile.TemporaryDirectory() as d:
            app, plugin, env = self.fixture(d)
            env["PANKEKI_PYTHON"] = str(app / "missing python")
            result = self.run_launcher(plugin, env)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(result.stdout, "")
            self.assertIn("Python runtime", result.stderr)

if __name__ == "__main__":
    unittest.main()

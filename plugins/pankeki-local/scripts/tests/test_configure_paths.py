import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "configure_paths.py"


def load(plugin_root):
    spec = importlib.util.spec_from_file_location("configure_paths_under_test", plugin_root / "scripts" / "configure_paths.py")
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


class ConfigurePathsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        # A relocated checkout whose folder name contains spaces.
        self.app = Path(self.temp.name) / "Moved Drive" / "Pankeki"
        (self.app / "pankeki").mkdir(parents=True); (self.app / "pankeki" / "server.py").write_text("")
        self.plugin = self.app / "plugins" / "pankeki-local"
        (self.plugin / "scripts").mkdir(parents=True)
        shutil.copyfile(SCRIPT, self.plugin / "scripts" / "configure_paths.py")
        self.module = load(self.plugin)

    def test_writes_both_declarations_for_the_new_location_without_system_python(self):
        self.assertEqual(self.module.main([]), 0)
        python = self.app.resolve() / "runtime/macos/pankeki-mcp-20261023/release/venv/bin/python"
        for name in ["mcp.json", ".mcp.json"]:
            server = json.loads((self.plugin / name).read_text())["mcpServers"]["pankeki-local"]
            self.assertEqual(server["command"], str(python))
            self.assertNotIn("/usr/bin/python3", json.dumps(server))
            self.assertEqual(server["args"], [str(self.plugin.resolve() / "scripts" / "launch.py")])
            self.assertEqual(server["env"]["PANKEKI_APP_ROOT"], str(self.app.resolve()))
            self.assertEqual(server["env"]["PANKEKI_PYTHON"], str(python))
        self.assertIn("$schema", json.loads((self.plugin / "mcp.json").read_text()))
        self.assertNotIn("$schema", json.loads((self.plugin / ".mcp.json").read_text()))

    def test_check_reports_drift_without_writing_then_passes_after_update(self):
        self.assertEqual(self.module.main(["--check"]), 1)
        self.assertFalse((self.plugin / "mcp.json").exists())
        self.module.main([])
        self.assertEqual(self.module.main(["--check"]), 0)

    def test_rejects_a_folder_that_is_not_the_app(self):
        self.assertEqual(self.module.main(["--app-root", str(Path(self.temp.name))]), 2)


if __name__ == "__main__":
    unittest.main()

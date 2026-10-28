"""Restoration must only remove resources created by this installation."""
import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "install_local.py"

class InstallationTests(unittest.TestCase):
    def module(self):
        self.assertTrue(SCRIPT.is_file(), "installation implementation is required")
        spec = importlib.util.spec_from_file_location("pankeki_local_install", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_partial_install_restores_only_registered_marketplace(self):
        m = self.module()
        record = {"plugin_id":"pankeki-local@pankeki-local-dev",
                  "marketplace":"pankeki-local-dev",
                  "applied":{"marketplace_added":True,"plugin_installed":False}}
        self.assertEqual(m.restore_commands(record, "codex"),
                         [["codex","plugin","marketplace","remove","pankeki-local-dev","--json"]])

    def test_record_for_another_plugin_is_rejected(self):
        m = self.module()
        with self.assertRaisesRegex(ValueError, "ownership"):
            m.restore_commands({"plugin_id":"other@market","marketplace":"market",
                                "applied":{"marketplace_added":True,"plugin_installed":True}}, "codex")

    def test_unrelated_registry_entry_change_is_detected(self):
        m = self.module()
        before = {"installed":[{"pluginId":"existing@catalog","enabled":True}]}
        after = {"installed":[{"pluginId":"existing@catalog","enabled":False},
                              {"pluginId":"pankeki-local@pankeki-local-dev","enabled":True}]}
        self.assertFalse(m.existing_plugins_preserved(before, after))
        after["installed"][0]["enabled"] = True
        self.assertTrue(m.existing_plugins_preserved(before, after))

if __name__ == "__main__":
    unittest.main()

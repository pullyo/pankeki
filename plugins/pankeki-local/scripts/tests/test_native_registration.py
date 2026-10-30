"""Native registration must distinguish CLI default normalization from setting loss."""
import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "register_native.py"

class NativePreservationTests(unittest.TestCase):
    def module(self):
        self.assertTrue(SCRIPT.is_file(), "native registration helper is required")
        spec=importlib.util.spec_from_file_location("pankeki_native", SCRIPT)
        m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
        return m

    def test_empty_argv_and_integral_timeout_are_equivalent(self):
        m=self.module()
        old={"model":"fixed","mcp_servers":{"node_repl":{"command":"node","args":[],"startup_timeout_sec":120}}}
        new={"model":"fixed","mcp_servers":{"node_repl":{"command":"node","startup_timeout_sec":120.0},
                                          "pankeki-local":{"command":"python"}}}
        self.assertEqual(m.config_semantics_without_ours(old),m.config_semantics_without_ours(new))

    def test_unrelated_command_change_is_not_normalized_away(self):
        m=self.module()
        old={"mcp_servers":{"node_repl":{"command":"old"}}}
        new={"mcp_servers":{"node_repl":{"command":"different"}}}
        self.assertNotEqual(m.config_semantics_without_ours(old),m.config_semantics_without_ours(new))

if __name__=="__main__":
    unittest.main()

"""The Finder launcher must select the installed generation runtime."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


@unittest.skipUnless(sys.platform == 'darwin', 'macOS Finder launcher')
class MacLauncherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pankeki launch with spaces-')
        self.root = Path(self.temp.name)
        shutil.copy2(Path(__file__).resolve().parents[1] / 'Pankeki.command', self.root)
        self.runtime('.venv-macos-editor', 'editor')

    def tearDown(self):
        self.temp.cleanup()

    def runtime(self, directory, label):
        executable = self.root / directory / 'bin' / 'python'
        executable.parent.mkdir(parents=True, exist_ok=True)
        executable.write_text('#!/bin/sh\nprintf "%s\\n" "' + label + '"\nprintf "<%s>\\n" "$@"\n')
        executable.chmod(0o755)

    def launch(self, *arguments):
        result = subprocess.run(['bash', str(self.root / 'Pankeki.command'), *arguments],
                                cwd='/', text=True, capture_output=True, check=True)
        return result.stdout.splitlines()

    def test_default_launch_uses_generation_runtime_without_forcing_editor_mode(self):
        self.runtime('.venv-macos', 'generation')
        output = self.launch('--no-browser')
        self.assertEqual(output[0], 'generation')
        self.assertIn('<scripts/run_macos.py>', output)
        self.assertIn('<--no-browser>', output)
        self.assertNotIn('<--editor-only>', output)

    def test_explicit_editor_mode_keeps_the_independent_editor_runtime(self):
        self.runtime('.venv-macos', 'generation')
        output = self.launch('--editor-only', '--no-browser')
        self.assertEqual(output[0], 'editor')
        self.assertEqual(output.count('<--editor-only>'), 1)

    def test_missing_generation_runtime_still_opens_the_editor(self):
        self.assertEqual(self.launch('--no-browser')[0], 'editor')


if __name__ == '__main__':
    unittest.main()

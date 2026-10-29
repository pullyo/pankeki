"""scripts/comfyui-vendor.sh against local fake archives; no network, git disabled."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / 'scripts' / 'comfyui-vendor.sh'
COMMIT = '8f04fd6ecf4a548937971e840af2a985529fab76'
PINNED = ['server.py', 'execution.py', 'comfy_execution/jobs.py']


class ComfyVendorSetupTests(unittest.TestCase):
    def setUp(self):
        if not all((ROOT / 'vendor/ComfyUI' / name).is_file() for name in PINNED):
            self.skipTest('reference vendor/ComfyUI files are not installed')
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.project = self.base / 'project'; self.project.mkdir()
        (self.project / 'pankeki').symlink_to(ROOT / 'pankeki')
        bin_dir = self.base / 'bin'; bin_dir.mkdir()
        fake_git = bin_dir / 'git'; fake_git.write_text('#!/bin/sh\nexit 1\n'); fake_git.chmod(0o755)
        self.env = {'PATH': f'{bin_dir}:/usr/bin:/bin', 'HOME': str(self.base), 'LANG': 'en_US.UTF-8'}

    def archive(self, tamper=False):
        source = self.base / 'archive-src' / f'ComfyUI-{COMMIT}'
        for name in PINNED:
            target = source / name; target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / 'vendor/ComfyUI' / name, target)
        (source / 'main.py').write_text('# fake entry point\n')
        if tamper:
            with (source / 'server.py').open('ab') as stream:
                stream.write(b'\n# tampered\n')
        path = self.base / 'comfy.tar.gz'
        with tarfile.open(path, 'w:gz') as tar:
            tar.add(source, arcname=source.name)
        return path.as_uri()

    def ensure(self, cwd=None, archive_url=None):
        env = dict(self.env, PANKEKI_SETUP_PYTHON=sys.executable)
        if archive_url:
            env['PANKEKI_COMFY_ARCHIVE_URL'] = archive_url
        script = f'set -euo pipefail; source "{HELPER}"; ensure_comfyui'
        return subprocess.run(['/bin/bash', '-c', script], cwd=cwd or self.project, env=env,
                              capture_output=True, text=True, timeout=60)

    def leftovers(self):
        return [p.name for p in (self.project / 'vendor').glob('.comfyui-download.*')]

    def test_fresh_install_from_pinned_archive_then_rerun_is_a_no_op(self):
        result = self.ensure(archive_url=self.archive())
        self.assertEqual(result.returncode, 0, result.stderr)
        vendor = self.project / 'vendor/ComfyUI'
        self.assertTrue((vendor / 'main.py').is_file())
        self.assertEqual((vendor / '.pankeki-comfy-commit').read_text().strip(), COMMIT)
        self.assertEqual(self.leftovers(), [])
        again = self.ensure(archive_url='file:///nonexistent/should-not-be-fetched.tar.gz')
        self.assertEqual(again.returncode, 0, again.stderr)

    def test_tampered_archive_is_rejected_and_nothing_is_installed(self):
        result = self.ensure(archive_url=self.archive(tamper=True))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('일치하지 않습니다', result.stderr)
        self.assertFalse((self.project / 'vendor/ComfyUI').exists())
        self.assertEqual(self.leftovers(), [])

    def test_existing_checkout_on_another_commit_is_left_untouched(self):
        vendor = self.project / 'vendor/ComfyUI'; vendor.mkdir(parents=True)
        (vendor / 'main.py').write_text('mine\n'); (vendor / '.pankeki-comfy-commit').write_text('b' * 40)
        result = self.ensure(archive_url=self.archive())
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('다른 commit', result.stderr)
        self.assertEqual((vendor / 'main.py').read_text(), 'mine\n')

    def test_incomplete_existing_folder_is_not_overwritten(self):
        vendor = self.project / 'vendor/ComfyUI'; vendor.mkdir(parents=True)
        (vendor / 'notes.txt').write_text('keep')
        result = self.ensure(archive_url=self.archive())
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(sorted(p.name for p in vendor.iterdir()), ['notes.txt'])

    def test_this_project_checkout_is_accepted(self):
        result = subprocess.run(['/bin/bash', '-c', f'set -euo pipefail; source "{HELPER}"; ensure_comfyui'],
                                cwd=ROOT, env=dict(self.env, PANKEKI_SETUP_PYTHON=sys.executable),
                                capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()

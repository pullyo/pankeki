"""Windows ordinary-filesystem sharing tests against independent processes."""
import hashlib
import json
import mmap
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pankeki.model_lease import ReadOnlyModelLease


CHILD = r'''
import hashlib, json, mmap, os, sys
from pathlib import Path
path, operation = Path(sys.argv[1]), sys.argv[2]
try:
    if operation == 'read':
        value = hashlib.sha256(path.read_bytes()).hexdigest()
    elif operation == 'mmap-read':
        with path.open('rb') as stream:
            with mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_READ) as mapped:
                value = hashlib.sha256(mapped).hexdigest()
    elif operation == 'write':
        path.write_bytes(b'replaced content')
        value = True
    elif operation == 'rename':
        path.rename(path.with_name('renamed.safetensors'))
        value = True
    elif operation == 'replace':
        replacement = path.with_name('replacement.safetensors')
        replacement.write_bytes(b'replacement')
        os.replace(replacement, path)
        value = True
    elif operation == 'unlink':
        path.unlink()
        value = True
    elif operation == 'parent-rename':
        path.parent.rename(path.parent.with_name('renamed-parent'))
        value = True
    elif operation == 'sibling-write':
        sibling = path.with_name('unrelated.txt')
        sibling.write_bytes(b'unrelated')
        value = sibling.read_bytes() == b'unrelated'
        sibling.unlink()
    else:
        raise AssertionError(operation)
    print(json.dumps({'ok': True, 'value': value}))
except OSError as exc:
    print(json.dumps({'ok': False, 'winerror': getattr(exc, 'winerror', None), 'errno': exc.errno, 'error': str(exc)}))
'''


@unittest.skipUnless(os.name == "nt", "Windows CreateFile sharing semantics")
class ModelLeaseTests(unittest.TestCase):
    def setUp(self):
        # Ancestor directory handles require read access; the workspace has it,
        # whereas sandboxed C:\Users\Administrator may permit traversal only.
        self.temp = tempfile.TemporaryDirectory(prefix="lease-test-", dir=Path(__file__).resolve().parents[1])
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        directory = self.root / "models"
        directory.mkdir()
        self.path = directory / "모델 공백 ' & $().safetensors"
        self.data = bytes(range(256)) * 20000 + b"final-short-block"
        self.path.write_bytes(self.data)
        self.expected = hashlib.sha256(self.data).hexdigest()

    def child(self, operation):
        result = subprocess.run([sys.executable, "-c", CHILD, str(self.path), operation],
                                capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", "replace"))
        return json.loads(result.stdout)

    def test_hashes_same_read_handle_without_python_reopen_or_path_mutation(self):
        previous = self.path.stat()
        with patch.object(Path, "open", side_effect=AssertionError("path must not be reopened to hash")):
            lease = ReadOnlyModelLease(self.path, self.expected)
        try:
            self.assertEqual(lease.sha256, self.expected)
            self.assertGreaterEqual(lease.verification_s, 0)
            self.assertEqual(self.path.read_bytes(), self.data)
            self.assertEqual(self.path.stat().st_mtime_ns, previous.st_mtime_ns)
            self.assertEqual(self.path.stat().st_size, previous.st_size)
        finally:
            lease.close()

    def test_subprocess_writes_rename_replace_delete_and_parent_rename_are_blocked(self):
        with ReadOnlyModelLease(self.path, self.expected) as lease:
            for operation in ("write", "rename", "replace", "unlink", "parent-rename"):
                with self.subTest(operation=operation):
                    result = self.child(operation)
                    self.assertFalse(result["ok"], result)
                    self.assertTrue(result["winerror"] in (5, 32, 33) or result["errno"] == 13, result)
                    self.assertEqual(self.path.read_bytes(), self.data)
                    self.assertEqual(lease.sha256, self.expected)

    def test_independent_readers_and_readonly_mmap_succeed_while_leased(self):
        with ReadOnlyModelLease(self.path, self.expected):
            for operation in ("read", "mmap-read"):
                with self.subTest(operation=operation):
                    result = self.child(operation)
                    self.assertTrue(result["ok"], result)
                    self.assertEqual(result["value"], self.expected)

    def test_unrelated_sibling_files_remain_writable(self):
        with ReadOnlyModelLease(self.path, self.expected):
            self.assertTrue(self.child("sibling-write")["ok"])
            self.assertEqual(self.path.read_bytes(), self.data)

    def test_close_releases_locks_and_hides_verified_hash(self):
        lease = ReadOnlyModelLease(self.path, self.expected)
        lease.close()
        lease.close()
        with self.assertRaises(RuntimeError):
            _ = lease.sha256
        self.assertTrue(self.child("write")["ok"])
        self.assertTrue(self.child("replace")["ok"])
        self.assertTrue(self.child("rename")["ok"])

    def test_context_exception_releases_locks(self):
        with self.assertRaisesRegex(RuntimeError, "caller failure"):
            with ReadOnlyModelLease(self.path, self.expected):
                raise RuntimeError("caller failure")
        self.assertTrue(self.child("write")["ok"])

    def test_wrong_hash_closes_handle_and_leaves_original_untouched(self):
        with self.assertRaises(ValueError):
            ReadOnlyModelLease(self.path, "0" * 64)
        self.assertEqual(self.path.read_bytes(), self.data)
        self.assertTrue(self.child("write")["ok"])

    def test_existing_writer_prevents_acquisition_and_no_input_changes(self):
        with self.path.open("r+b"):
            with self.assertRaises(OSError):
                ReadOnlyModelLease(self.path, self.expected)
        self.assertEqual(self.path.read_bytes(), self.data)
        with ReadOnlyModelLease(self.path, self.expected) as lease:
            self.assertEqual(lease.sha256, self.expected)

    def test_existing_writable_mapping_prevents_acquisition_after_file_handle_closes(self):
        with self.path.open("r+b") as stream:
            mapped = mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_WRITE)
        try:
            with self.assertRaises(OSError):
                ReadOnlyModelLease(self.path, self.expected)
        finally:
            mapped.close()
        self.assertEqual(self.path.read_bytes(), self.data)
        with ReadOnlyModelLease(self.path, self.expected) as lease:
            self.assertEqual(lease.sha256, self.expected)

    def test_hardlink_alias_cannot_write_locked_object(self):
        alias = self.path.with_name("model-alias.safetensors")
        os.link(self.path, alias)
        with ReadOnlyModelLease(self.path, self.expected):
            with self.assertRaises(OSError):
                alias.write_bytes(b"changed via alias")
            self.assertEqual(alias.read_bytes(), self.data)
        alias.write_bytes(b"unlocked")
        self.assertEqual(self.path.read_bytes(), b"unlocked")

    def test_file_symlink_is_rejected_without_modifying_target(self):
        alias = self.path.with_name("model-link.safetensors")
        try:
            os.symlink(self.path, alias)
        except OSError as exc:
            if getattr(exc, "winerror", None) == 1314:
                self.skipTest("test host does not allow symlink creation")
            raise
        with self.assertRaises(OSError):
            ReadOnlyModelLease(alias, self.expected)
        self.assertEqual(self.path.read_bytes(), self.data)
        alias.unlink()
        self.assertTrue(self.child("write")["ok"])

    def test_invalid_hash_and_unsafe_windows_paths_fail_closed(self):
        for expected in (None, "", "a" * 63, "A" * 64, "not a hash"):
            with self.subTest(expected=expected):
                with self.assertRaises((TypeError, ValueError)):
                    ReadOnlyModelLease(self.path, expected)
        for path in ("", "relative.safetensors", "C:relative.safetensors", "\\\\.\\PhysicalDrive0",
                     "\\\\?\\C:\\file", "\\\\server\\share\\model", str(self.path) + ":stream", str(self.path) + "\0ignored"):
            with self.subTest(path=path):
                with self.assertRaises((TypeError, ValueError, OSError)):
                    ReadOnlyModelLease(path, self.expected)
        self.assertEqual(self.path.read_bytes(), self.data)

    def test_missing_path_is_never_created(self):
        missing = self.path.with_name("missing.safetensors")
        with self.assertRaises(OSError):
            ReadOnlyModelLease(missing, self.expected)
        self.assertFalse(missing.exists())


if __name__ == "__main__":
    unittest.main()

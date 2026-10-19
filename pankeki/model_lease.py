"""Optional Windows immutable model read lease for ordinary file operations.

The file is opened with GENERIC_READ / FILE_SHARE_READ / OPEN_EXISTING and
hashed through that same retained handle. Existing writers prevent acquisition;
new writers, rename/delete and replacement are denied until close(). Read-only
readers and mappings remain possible. Non-reparse ancestor directory handles
also pin the pathname against ordinary directory replacement.

This is not a raw-volume, privileged-kernel or hostile-filesystem guarantee.
Keep the lease alive for every request relying on its digest. Do not close it
concurrently with such requests. On OSError, callers may use full hashing.
The constructor never creates, replaces, writes or changes file permissions.
"""
from __future__ import annotations

import ctypes
import hashlib
import ntpath
import os
import re
import threading
import time
from pathlib import PureWindowsPath


_SHA256 = re.compile(r"[0-9a-f]{64}\Z")
_GENERIC_READ = 0x80000000
_FILE_SHARE_READ = 1
_OPEN_EXISTING = 3
_FILE_ATTRIBUTE_DIRECTORY = 0x10
_FILE_ATTRIBUTE_REPARSE_POINT = 0x400
_FILE_FLAG_BACKUP_SEMANTICS = 0x02000000
_FILE_FLAG_SEQUENTIAL_SCAN = 0x08000000
_FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000
_INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value


def _local_path(path) -> PureWindowsPath:
    value = os.fspath(path)
    if not isinstance(value, str):
        raise TypeError("model lease path must be a Unicode string or Path")
    if not value or "\0" in value or value.startswith(("\\\\", "//")):
        raise ValueError("model lease requires a local absolute drive path")
    value = value.replace("/", "\\")
    drive, tail = ntpath.splitdrive(value)
    if not re.fullmatch(r"[A-Za-z]:", drive) or not tail.startswith("\\") or ":" in tail:
        raise ValueError("device, network, drive-relative and alternate-stream paths are unsupported")
    parsed = PureWindowsPath(ntpath.normpath(value))
    if any(part.endswith((" ", ".")) for part in parsed.parts[1:]):
        raise ValueError("trailing spaces or dots in model paths are unsupported")
    if parsed == PureWindowsPath(parsed.anchor):
        raise ValueError("model lease requires a file, not a drive")
    return parsed


class ReadOnlyModelLease:
    """Hash once under an OS-enforced read-only share, then retain the handle.

    `sha256` raises RuntimeError after close. `verification_s` includes path
    locking and the one full hash. Context-manager use closes on exceptions;
    close is idempotent. Non-Windows platforms and unsupported paths fail closed.
    """

    def __init__(self, path, expected_sha256: str):
        self._lock = threading.RLock()
        self._handles = []
        self._sha256 = None
        self._open = False
        self.verification_s = 0.0
        if not isinstance(expected_sha256, str) or _SHA256.fullmatch(expected_sha256) is None:
            raise ValueError("expected_sha256 must be 64 lowercase hexadecimal characters")
        parsed = _local_path(path)
        if os.name != "nt":
            raise OSError("ReadOnlyModelLease requires Windows CreateFile sharing semantics")
        from ctypes import wintypes

        class FileInformation(ctypes.Structure):
            _fields_ = [("attributes", wintypes.DWORD),
                        ("created", wintypes.FILETIME), ("accessed", wintypes.FILETIME),
                        ("written", wintypes.FILETIME), ("volume", wintypes.DWORD),
                        ("size_high", wintypes.DWORD), ("size_low", wintypes.DWORD),
                        ("links", wintypes.DWORD), ("index_high", wintypes.DWORD),
                        ("index_low", wintypes.DWORD)]

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                      ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        kernel.CreateFileW.restype = wintypes.HANDLE
        kernel.ReadFile.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD,
                                    ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
        kernel.ReadFile.restype = wintypes.BOOL
        kernel.GetFileInformationByHandle.argtypes = [wintypes.HANDLE, ctypes.POINTER(FileInformation)]
        kernel.GetFileInformationByHandle.restype = wintypes.BOOL
        kernel.GetFileType.argtypes = [wintypes.HANDLE]
        kernel.GetFileType.restype = wintypes.DWORD
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel.CloseHandle.restype = wintypes.BOOL
        self._kernel = kernel
        started = time.perf_counter()

        def open_checked(item, directory):
            flags = _FILE_FLAG_OPEN_REPARSE_POINT | (_FILE_FLAG_BACKUP_SEMANTICS if directory else _FILE_FLAG_SEQUENTIAL_SCAN)
            # Build the extended prefix ourselves only after strict local-path validation.
            handle = kernel.CreateFileW("\\\\?\\" + str(item), _GENERIC_READ, _FILE_SHARE_READ,
                                        None, _OPEN_EXISTING, flags, None)
            if handle == _INVALID_HANDLE_VALUE:
                raise ctypes.WinError(ctypes.get_last_error())
            self._handles.append(handle)
            information = FileInformation()
            if not kernel.GetFileInformationByHandle(handle, ctypes.byref(information)):
                raise ctypes.WinError(ctypes.get_last_error())
            if information.attributes & _FILE_ATTRIBUTE_REPARSE_POINT:
                raise OSError("reparse points are unsupported by the immutable model lease")
            if bool(information.attributes & _FILE_ATTRIBUTE_DIRECTORY) != directory:
                raise OSError("model lease path has an unexpected file/directory type")
            if not directory and kernel.GetFileType(handle) != 1:  # FILE_TYPE_DISK
                raise OSError("model lease requires an ordinary disk file")
            return handle

        try:
            # Top-down acquisition pins each traversed component before opening
            # its child. The volume root cannot be ordinarily renamed/replaced.
            for parent in reversed(parsed.parents):
                if parent != PureWindowsPath(parsed.anchor):
                    open_checked(parent, directory=True)
            handle = open_checked(parsed, directory=False)
            digest = hashlib.sha256()
            buffer = ctypes.create_string_buffer(4 * 1024 * 1024)
            count = wintypes.DWORD()
            while True:
                if not kernel.ReadFile(handle, buffer, len(buffer), ctypes.byref(count), None):
                    raise ctypes.WinError(ctypes.get_last_error())
                if not count.value:
                    break
                digest.update(memoryview(buffer)[:count.value])
            observed = digest.hexdigest()
            if observed != expected_sha256:
                raise ValueError("Model SHA256 mismatch while holding immutable read lease")
            self._sha256 = observed
            self._open = True
            self.verification_s = time.perf_counter() - started
        except BaseException:
            self.close()
            raise

    @property
    def sha256(self) -> str:
        with self._lock:
            if not self._open:
                raise RuntimeError("model read lease is closed")
            return self._sha256

    def close(self) -> None:
        with self._lock:
            self._open = False
            self._sha256 = None
            first_error = None
            while self._handles:
                handle = self._handles.pop()
                if not self._kernel.CloseHandle(handle) and first_error is None:
                    first_error = ctypes.WinError(ctypes.get_last_error())
            if first_error is not None:
                raise first_error

    def __enter__(self):
        # Re-entering a closed lease must not silently give a stale digest.
        _ = self.sha256
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.close()
        return False

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass

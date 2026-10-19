"""Content and owned-process guards for the explicitly managed local server."""
import ctypes
import hashlib
import json
import os
from pathlib import Path


def source_fingerprint(root):
    root = Path(root)
    digest = hashlib.sha256()
    extensions = {'.py', '.pyi', '.json', '.txt', '.gz', '.model', '.tiktoken', '.yaml', '.yml', '.pyd'}
    for path in sorted(root.rglob('*')):
        if not path.is_file() or path.suffix.lower() not in extensions:
            continue
        parts = path.relative_to(root).parts
        if any(part in ('.git', '__pycache__', '.venv', '.pytest_cache') for part in parts):
            continue
        if root.name == 'ComfyUI' and parts[0] in ('models', 'input', 'output', 'user'):
            continue
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(b'\0')
        digest.update(path.read_bytes())
    return digest.hexdigest()


def process_start_token(pid):
    if os.name != 'nt':
        raise ValueError('Owned process guard currently requires Windows')
    from ctypes import wintypes
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x1000, False, int(pid))
    if not handle:
        raise ValueError('Managed ComfyUI process is unavailable; restart and prepare its manifest')
    try:
        fields = [wintypes.FILETIME() for _ in range(4)]
        if not kernel.GetProcessTimes(handle, *(ctypes.byref(field) for field in fields)):
            raise ValueError('Cannot verify managed process creation time')
        return str((fields[0].dwHighDateTime << 32) | fields[0].dwLowDateTime)
    finally:
        kernel.CloseHandle(handle)


def server_signature(system):
    selected = {name: system.get(name) for name in ('python_version', 'pytorch_version', 'comfyui_version', 'argv')}
    return hashlib.sha256(json.dumps(selected, sort_keys=True).encode()).hexdigest()

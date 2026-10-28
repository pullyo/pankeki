"""Owned relative run references and an atomic, last-write completion marker."""
import hashlib
import json
import os
import re
import time
import uuid
from pathlib import Path

OWNER = 'pankeki-run-v1'
REF = re.compile(r'runs/[0-9a-f]{32}')
SHA = re.compile(r'[0-9a-f]{64}')


def atomic_json(path, value):
    temp = path.with_name('.' + path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temp.open('x', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False, sort_keys=True, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


class RunStore:
    def __init__(self, root):
        self.root = Path(root).absolute()

    def resolve(self, run_ref):
        if not isinstance(run_ref, str) or not REF.fullmatch(run_ref):
            raise ValueError('Invalid run reference')
        current = self.root
        if current.is_symlink():
            raise ValueError('Symlink run root rejected')
        for part in Path(run_ref).parts:
            current = current / part
            if current.is_symlink():
                raise ValueError('Symlink run reference rejected')
        if not current.resolve().is_relative_to(self.root.resolve()):
            raise ValueError('Run reference escaped root')
        return current

    def begin(self, job_id, trace_id):
        directory = self.resolve('runs/' + job_id)
        directory.mkdir(parents=True, exist_ok=False)
        atomic_json(directory / 'owner.json', {'owner': OWNER, 'job_id': job_id, 'trace_id': trace_id})
        return directory

    def _read(self, directory, name):
        path = directory / name
        if path.is_symlink() or not path.is_file():
            raise ValueError('Missing or unsafe run file')
        return path.read_bytes()

    def complete(self, run_ref, result_sha256):
        directory = self.resolve(run_ref)
        owner = json.loads(self._read(directory, 'owner.json'))
        if owner.get('owner') != OWNER or owner.get('job_id') != directory.name:
            raise ValueError('Unowned run')
        if not isinstance(result_sha256, str) or not SHA.fullmatch(result_sha256):
            raise ValueError('Invalid result SHA256')
        files = {}
        for path in sorted(directory.iterdir()):
            if path.name == 'complete.json' or path.name.startswith('.'):
                continue
            if path.is_symlink() or not path.is_file():
                raise ValueError('Unsafe run contents')
            files[path.name] = hashlib.sha256(self._read(directory, path.name)).hexdigest()
        if not {'owner.json', 'result.png', 'recipe.json', 'metrics.json'}.issubset(files) or files['result.png'] != result_sha256:
            raise ValueError('Incomplete or mismatched run result')
        # This is deliberately the last run write. Existence of metrics is not success.
        atomic_json(directory / 'complete.json', {'owner': OWNER, 'job_id': directory.name,
            'result_sha256': result_sha256, 'files': files, 'completed_at': time.time()})

    def read_result(self, run_ref, result_sha256):
        directory = self.resolve(run_ref)
        marker = json.loads(self._read(directory, 'complete.json'))
        if marker.get('owner') != OWNER or marker.get('job_id') != directory.name or marker.get('result_sha256') != result_sha256:
            raise ValueError('Invalid completion marker')
        owner = json.loads(self._read(directory, 'owner.json'))
        if owner.get('owner') != OWNER or owner.get('job_id') != directory.name:
            raise ValueError('Unowned run')
        files = marker.get('files')
        if not isinstance(files, dict) or not {'owner.json', 'result.png', 'recipe.json', 'metrics.json'}.issubset(files):
            raise ValueError('Incomplete run marker')
        for name, digest in files.items():
            if not isinstance(name, str) or Path(name).name != name or not isinstance(digest, str) or not SHA.fullmatch(digest):
                raise ValueError('Invalid run manifest')
            if hashlib.sha256(self._read(directory, name)).hexdigest() != digest:
                raise ValueError('Run file SHA256 mismatch')
        data = self._read(directory, 'result.png')
        if hashlib.sha256(data).hexdigest() != result_sha256:
            raise ValueError('Result SHA256 mismatch')
        return data


def plan_retention(root, policy=None, protected_refs=()):
    """Report only: there is intentionally no deletion/apply implementation."""
    store = RunStore(root)
    protected = set(protected_refs)
    keep = (policy or {}).get('keep_latest', 100)
    if type(keep) is not int or keep < 0:
        raise ValueError('Invalid retention policy')
    candidates, retained, reasons, eligible = [], [], {}, []
    base = store.root / 'runs'
    if base.is_symlink():
        return {'dry_run': True, 'candidates': [], 'retained': [], 'reasons': {'runs': 'symlink rejected'}}
    for directory in sorted(base.iterdir()) if base.is_dir() else []:
        ref = 'runs/' + directory.name
        try:
            resolved = store.resolve(ref)
            marker = json.loads(store._read(resolved, 'complete.json'))
            store.read_result(ref, marker.get('result_sha256'))
            if ref in protected:
                retained.append(ref)
                reasons[ref] = 'protected reference'
            else:
                eligible.append((marker.get('completed_at', 0), ref))
        except (ValueError, OSError, TypeError):
            retained.append(ref)
            reasons[ref] = 'unowned, incomplete, unsafe or invalid run'
    for index, (_, ref) in enumerate(sorted(eligible, reverse=True)):
        (retained if index < keep else candidates).append(ref)
        reasons[ref] = 'latest retained run' if index < keep else 'eligible completed owned run; dry run only'
    return {'dry_run': True, 'candidates': candidates, 'retained': retained, 'reasons': reasons}

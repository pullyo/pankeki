"""Durable job metadata, separate from the exact image cache. Never replays work."""
import hashlib
import base64
import json
import os
import re
import sqlite3
import threading
import time
from pathlib import Path

ACTIVE_STATES = ('queued', 'running', 'canceling', 'submitting')
STATES = (*ACTIVE_STATES, 'succeeded', 'failed', 'uncertain', 'canceled', 'orphaned')


_IMAGE_FIELDS = {'source','mask','image','images','png','jpeg','jpg','webp','raw',
                 'imagedata','imagebytes','imagepayload','sourceimage','maskimage','base64'}
_HASH_FIELDS = {'sha256','encodedsha256','resultsha256'}


def _reference(value):
    if isinstance(value, str):
        encoded = value.split(',', 1)[1] if value.startswith('data:') and ';base64,' in value and ',' in value else value
        try:
            raw = base64.b64decode(encoded, validate=True)
        except (ValueError, UnicodeError):
            raw = value.encode('utf-8', 'replace')
    elif isinstance(value, bytes):
        raw = value
    else:
        try:
            raw = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
        except (ValueError, TypeError, RecursionError):
            raw = ('invalid-payload-type:' + type(value).__name__).encode()
    return {'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}


def metadata(value, *, _image=False, _depth=0):
    """Payload role, not text appearance, selects image redaction.

    MCP sends plain base64; browser calls may send data URLs. Both store only
    decoded-byte references. Base64-looking user prompts remain ordinary text.
    """
    if _depth >= 20:
        return _reference(value)
    if isinstance(value, bytes):
        return _reference(value)
    if isinstance(value, str):
        return _reference(value) if _image else value[:4000]
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            key = str(key)
            if key == 'image_path':
                continue
            role = key.lower().replace('_','').replace('-','')
            if _image and role in _HASH_FIELDS and isinstance(item,str) and re.fullmatch('[0-9a-f]{64}',item):
                result[key] = item
                continue
            if _image and not re.fullmatch('[A-Za-z0-9_-]{1,80}',key):
                key = 'field_' + hashlib.sha256(key.encode()).hexdigest()
            result[key] = metadata(item, _image=_image or role in _IMAGE_FIELDS, _depth=_depth+1)
        return result
    if isinstance(value, (list, tuple)):
        if _image and all(type(item) is int for item in value):
            return _reference(bytes(value) if all(0 <= item <= 255 for item in value) else value)
        return [metadata(item,_image=_image,_depth=_depth+1) for item in value]
    return value


class JobStore:
    def __init__(self, db_path):
        path = Path(db_path).resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.path = path
        self._owner_fd = None
        self.connection = sqlite3.connect(path, timeout=10, check_same_thread=False)
        self.connection.execute('PRAGMA journal_mode=WAL')
        self.connection.execute('PRAGMA synchronous=FULL')
        self.connection.executescript('''
            CREATE TABLE IF NOT EXISTS jobs (job_id TEXT PRIMARY KEY, session TEXT NOT NULL,
                revision INTEGER NOT NULL, state TEXT NOT NULL, record TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS revisions (session TEXT PRIMARY KEY, revision INTEGER NOT NULL);
        ''')
        self.connection.commit()
        self.closed = False

    def create(self, record):
        item = metadata(record)
        if item.get('state', 'queued') not in STATES:
            raise ValueError('Invalid job state')
        with self.lock, self.connection:
            self.connection.execute('BEGIN IMMEDIATE')
            previous = self.connection.execute('SELECT revision FROM revisions WHERE session=?', (item['session'],)).fetchone()
            revision = (previous[0] if previous else 0) + 1
            item.update(revision=revision, state=item.get('state', 'queued'), lane=item.get('lane', 'gpu'),
                        created_at=item.get('created_at', time.time()), updated_at=time.time())
            self.connection.execute('INSERT INTO jobs VALUES (?,?,?,?,?)',
                (item['job_id'], item['session'], revision, item['state'], json.dumps(item)))
            self.connection.execute('INSERT INTO revisions VALUES (?,?) ON CONFLICT(session) DO UPDATE SET revision=excluded.revision',
                                    (item['session'], revision))
        return item

    def get(self, job_id):
        with self.lock:
            row = self.connection.execute('SELECT record FROM jobs WHERE job_id=?', (job_id,)).fetchone()
        return metadata(json.loads(row[0])) if row else None

    def revisions(self):
        with self.lock:
            return dict(self.connection.execute('SELECT session,revision FROM revisions'))

    def acquire_owner(self):
        """Kernel lifetime lock: no timeout, PID guesses or orphaning a live owner."""
        with self.lock:
            if self._owner_fd is not None:
                raise RuntimeError('Job store already has an active owner')
            fd = os.open(str(self.path) + '.owner.lock', os.O_RDWR | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
            os.set_inheritable(fd, False)
            try:
                if os.name == 'nt':
                    import msvcrt
                    if os.fstat(fd).st_size == 0:
                        os.write(fd, b'0')
                    os.lseek(fd, 0, os.SEEK_SET)
                    msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except (OSError, ImportError) as exc:
                os.close(fd)
                raise RuntimeError('Job store has an active owner or OS owner locking is unavailable') from exc
            self._owner_fd = fd

    def release_owner(self):
        with self.lock:
            if self._owner_fd is not None:
                # Closing releases flock/byte-range ownership, including on crash.
                os.close(self._owner_fd)
                self._owner_fd = None

    def transition(self, job_id, expected_states, changes):
        if changes.get('state', 'queued') not in STATES:
            raise ValueError('Invalid job state')
        with self.lock, self.connection:
            self.connection.execute('BEGIN IMMEDIATE')
            row = self.connection.execute('SELECT state,record FROM jobs WHERE job_id=?', (job_id,)).fetchone()
            if row is None or row[0] not in expected_states:
                return False
            item = metadata(json.loads(row[1]))
            if changes.get('state') == 'succeeded':
                current = self.connection.execute('SELECT revision FROM revisions WHERE session=?', (item['session'],)).fetchone()
                if current is None or current[0] != item['revision']:
                    return False
            if any(k in changes and changes[k] != item[k] for k in ('job_id', 'session', 'revision')):
                raise ValueError('Immutable job identity')
            item.update(metadata(changes), updated_at=time.time())
            self.connection.execute('UPDATE jobs SET state=?,record=? WHERE job_id=?',
                                    (item['state'], json.dumps(item), job_id))
            return True

    def mark_orphaned(self):
        with self.lock, self.connection:
            if self._owner_fd is None:
                raise RuntimeError('Orphan recovery requires the active job store owner lease')
            self.connection.execute('BEGIN IMMEDIATE')
            rows = self.connection.execute('SELECT job_id,record FROM jobs WHERE state IN (?,?,?,?)', ACTIVE_STATES).fetchall()
            for job_id, raw in rows:
                item = metadata(json.loads(raw))
                item.update(state='orphaned', updated_at=time.time(),
                            error='Service restarted while active; no automatic resubmission')
                self.connection.execute('UPDATE jobs SET state=?,record=? WHERE job_id=?',
                                        ('orphaned', json.dumps(item), job_id))
            return [row[0] for row in rows]

    def close(self):
        with self.lock:
            if not self.closed:
                self.connection.close()
                self.closed = True
                self.release_owner()

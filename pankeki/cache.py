"""Conservative exact-result cache for a managed, builtin-only ComfyUI graph.

Only the adapter may insert an output after a job has succeeded and decoded.
This module checks PNG framing/CRC; it cannot prove that a GPU job completed.
The quota counts PNG plus UTF-8 metadata bytes. SQLite pages/journals are extra.
Instances sharing a directory should use the same quota. SQLite transactions
coordinate independent threads/processes; no persistent connections are held.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import sqlite3
import struct
import threading
import zlib
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


_HEX64 = re.compile(r"[0-9a-f]{64}\Z")
_NODES = frozenset({
    "CheckpointLoaderSimple", "CLIPTextEncode", "EmptyLatentImage", "KSampler",
    "VAEDecode", "SaveImage", "LoadImage", "VAEEncodeForInpaint", "VAEEncode",
    "SetLatentNoiseMask",
})
_MANIFEST_FIELDS = frozenset({
    "schema", "comfy_commit", "model_name", "model_sha256", "software", "input_hashes",
})
_SOFTWARE_FIELDS = frozenset({"torch", "cuda", "dtype", "attention", "adapter_revision"})
_APPLICATION_ID = 1346457163  # PANK


def content_hash(data: bytes) -> str:
    """Hash immutable content, never a path, timestamp, or mutable object."""
    if type(data) is not bytes:
        raise TypeError("content must be bytes")
    return hashlib.sha256(data).hexdigest()


def _json_bytes(value: dict) -> bytes:
    def validate(item):
        if item is None or type(item) in (str, bool, int):
            return
        if type(item) is float and math.isfinite(item):
            return
        if type(item) is list:
            for child in item:
                validate(child)
            return
        if type(item) is dict and all(type(key) is str for key in item):
            for child in item.values():
                validate(child)
            return
        raise ValueError("canonical values must be finite JSON with string object keys")
    if type(value) is not dict:
        raise TypeError("canonical root must be a dict")
    validate(value)
    return json.dumps(value, sort_keys=True, ensure_ascii=False,
                      allow_nan=False, separators=(",", ":")).encode("utf-8")


def canonical_hash(value: dict) -> str:
    """SHA256 of deterministic UTF-8 JSON; reject lossy/nonfinite values."""
    return content_hash(_json_bytes(value))


def _fingerprint(value) -> bool:
    return isinstance(value, str) and _HEX64.fullmatch(value) is not None


def _known_string(value) -> bool:
    return (type(value) is str and bool(value.strip())
            and value.strip().lower() not in {"unknown", "unverified", "none", "null", "n/a"})


def make_cache_key(workflow: dict, dependencies: dict) -> str | None:
    """Return None unless a complete explicit dependency manifest is supplied.

    `request_recipe` is the optional pixel-composite/ROI recipe. The caller
    must hash every input file per request and run ComfyUI with custom nodes
    disabled: a builtin name alone cannot detect a custom-node override.
    CheckpointLoaderSimple binds all embedded model/CLIP/VAE weights to the
    checkpoint hash. Additional loaders and text embeddings are unsupported.
    """
    try:
        # Canonicalization first excludes custom objects, NaN and ambiguous keys.
        _json_bytes(workflow)
        _json_bytes(dependencies)
        fields = set(dependencies)
        if not (_MANIFEST_FIELDS <= fields <= _MANIFEST_FIELDS | {"request_recipe"}):
            return None
        if type(dependencies["schema"]) is not int or dependencies["schema"] != 1:
            return None
        if not all(_known_string(dependencies[field]) for field in ("comfy_commit", "model_name")):
            return None
        if not _fingerprint(dependencies["model_sha256"]):
            return None
        software = dependencies["software"]
        if type(software) is not dict or set(software) != _SOFTWARE_FIELDS:
            return None
        if not all(_known_string(value) for value in software.values()):
            return None
        inputs = dependencies["input_hashes"]
        if type(inputs) is not dict or not all(name and _fingerprint(value) for name, value in inputs.items()):
            return None
        if "request_recipe" in dependencies and type(dependencies["request_recipe"]) is not dict:
            return None
        if not workflow:
            return None
        checkpoints = 0
        outputs = 0
        for node in workflow.values():
            if type(node) is not dict or not {"class_type", "inputs"} <= set(node) <= {"class_type", "inputs", "_meta"}:
                return None
            kind = node["class_type"]
            if type(kind) is not str or kind not in _NODES or type(node["inputs"]) is not dict:
                return None
            params = node["inputs"]
            for value in params.values():
                if type(value) is list:
                    if not (len(value) == 2 and type(value[0]) is str and value[0] in workflow
                            and type(value[1]) is int and value[1] >= 0):
                        return None
                elif type(value) not in (str, int, float, bool) and value is not None:
                    return None
            if kind == "CheckpointLoaderSimple":
                if params.get("ckpt_name") != dependencies["model_name"]:
                    return None
                checkpoints += 1
            elif kind == "LoadImage":
                if type(params.get("image")) is not str or params["image"] not in inputs:
                    return None
            elif kind == "CLIPTextEncode":
                if type(params.get("text")) is not str or "embedding:" in params["text"].lower():
                    return None
            elif kind == "KSampler":
                if type(params.get("seed")) is not int or not 0 <= params["seed"] <= 2**64 - 1:
                    return None
            elif kind == "SaveImage":
                outputs += 1
        if not checkpoints or not outputs:
            return None
        return canonical_hash({"cache_key_schema": 1, "workflow": workflow, "dependencies": dependencies})
    except (TypeError, ValueError, KeyError, RecursionError, UnicodeError):
        return None


def _complete_png(data: bytes) -> bool:
    """Check full PNG framing and all chunk CRCs without decoding pixels."""
    if type(data) is not bytes or not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return False
    offset, saw_header, saw_data = 8, False, False
    while offset + 12 <= len(data):
        length = struct.unpack_from(">I", data, offset)[0]
        end = offset + 12 + length
        if end > len(data):
            return False
        kind = data[offset + 4:offset + 8]
        body = data[offset + 8:end - 4]
        crc = struct.unpack_from(">I", data, end - 4)[0]
        if zlib.crc32(kind + body) != crc:
            return False
        if not saw_header:
            if kind != b"IHDR" or length != 13:
                return False
            width, height = struct.unpack_from(">II", body)
            if not width or not height:
                return False
            saw_header = True
        elif kind == b"IHDR":
            return False
        if kind == b"IDAT":
            saw_data = True
        if kind == b"IEND":
            return length == 0 and saw_data and end == len(data)
        offset = end
    return False


class ExactCache:
    """Durable, bounded completed-result store with atomic LRU updates.

    A corrupt row is evicted on access. A corrupt/unrecognized database is
    left untouched and disables the cache for this instance (baseline works).
    Operation counters are per instance; entries/bytes are shared on disk.
    """

    def __init__(self, root: Path, max_bytes: int = 256 * 1024 * 1024):
        if type(max_bytes) is not int or max_bytes < 0:
            raise ValueError("max_bytes must be a nonnegative integer")
        self.root = Path(root)
        self.max_bytes = max_bytes
        self._path = self.root / "exact-cache.sqlite3"
        self._lock = threading.RLock()
        self._counters = dict(hits=0, misses=0, puts=0, evictions=0, corruptions=0, errors=0)
        self._available = True
        try:
            self.root.mkdir(parents=True, exist_ok=True)
            with self._transaction() as conn:
                app_id = conn.execute("PRAGMA application_id").fetchone()[0]
                tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
                if app_id not in (0, _APPLICATION_ID) or (app_id == 0 and tables):
                    raise sqlite3.DatabaseError("unrecognized database; preserving existing data")
                conn.execute(f"PRAGMA application_id = {_APPLICATION_ID}")
                conn.execute("CREATE TABLE IF NOT EXISTS clock (id INTEGER PRIMARY KEY CHECK(id=1), tick INTEGER NOT NULL)")
                conn.execute("INSERT OR IGNORE INTO clock VALUES (1, 0)")
                conn.execute("""CREATE TABLE IF NOT EXISTS entries (
                    key TEXT PRIMARY KEY, payload BLOB NOT NULL, payload_sha256 TEXT NOT NULL,
                    metadata TEXT NOT NULL, metadata_sha256 TEXT NOT NULL,
                    stored_bytes INTEGER NOT NULL, accessed INTEGER NOT NULL)""")
                conn.execute("CREATE INDEX IF NOT EXISTS lru ON entries(accessed)")
                self._evict(conn)
        except (OSError, sqlite3.Error):
            self._available = False
            self._counters["errors"] += 1

    @contextmanager
    def _transaction(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self._path, timeout=30, isolation_level=None)
        try:
            conn.execute("BEGIN IMMEDIATE")
            yield conn
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()

    @staticmethod
    def _validate_key(key):
        if not _fingerprint(key):
            raise ValueError("cache key must be 64 lowercase hexadecimal characters")

    @staticmethod
    def _tick(conn):
        conn.execute("UPDATE clock SET tick = tick + 1 WHERE id = 1")
        return conn.execute("SELECT tick FROM clock WHERE id = 1").fetchone()[0]

    def _evict(self, conn):
        total = conn.execute("SELECT COALESCE(SUM(stored_bytes), 0) FROM entries").fetchone()[0]
        if total <= self.max_bytes:
            return
        for key, size in conn.execute("SELECT key, stored_bytes FROM entries ORDER BY accessed, key").fetchall():
            conn.execute("DELETE FROM entries WHERE key = ?", (key,))
            total -= size
            self._counters["evictions"] += 1
            if total <= self.max_bytes:
                break

    def get(self, key: str) -> bytes | None:
        self._validate_key(key)
        with self._lock:
            if self._available:
                try:
                    with self._transaction() as conn:
                        row = conn.execute("SELECT payload, payload_sha256, metadata, metadata_sha256, stored_bytes FROM entries WHERE key = ?", (key,)).fetchone()
                        if row is not None:
                            data, digest, metadata, metadata_digest, size = row
                            valid = (type(data) is bytes and type(metadata) is str
                                     and content_hash(data) == digest
                                     and content_hash(metadata.encode("utf-8")) == metadata_digest
                                     and len(data) + len(metadata.encode("utf-8")) == size
                                     and _complete_png(data))
                            if valid:
                                conn.execute("UPDATE entries SET accessed = ? WHERE key = ?", (self._tick(conn), key))
                                self._counters["hits"] += 1
                                return data
                            conn.execute("DELETE FROM entries WHERE key = ?", (key,))
                            self._counters["corruptions"] += 1
                except (sqlite3.Error, OSError, UnicodeError):
                    self._counters["errors"] += 1
            self._counters["misses"] += 1
            return None

    def put(self, key: str, data: bytes, metadata: dict | None = None) -> bool:
        """Install a successful, decoded PNG only; false means baseline needed."""
        self._validate_key(key)
        if not _complete_png(data):
            return False
        try:
            metadata_bytes = _json_bytes({} if metadata is None else metadata)
        except (ValueError, TypeError, RecursionError, UnicodeError):
            return False
        size = len(data) + len(metadata_bytes)
        if size > self.max_bytes:
            return False
        with self._lock:
            if not self._available:
                return False
            try:
                with self._transaction() as conn:
                    conn.execute("INSERT OR REPLACE INTO entries VALUES (?, ?, ?, ?, ?, ?, ?)",
                                 (key, data, content_hash(data), metadata_bytes.decode("utf-8"),
                                  content_hash(metadata_bytes), size, self._tick(conn)))
                    self._evict(conn)
                self._counters["puts"] += 1
                return True
            except (sqlite3.Error, OSError):
                self._counters["errors"] += 1
                return False

    def clear(self) -> None:
        """Remove cache rows only; never walk, unlink or delete caller files."""
        with self._lock:
            if self._available:
                try:
                    with self._transaction() as conn:
                        conn.execute("DELETE FROM entries")
                except (sqlite3.Error, OSError):
                    self._counters["errors"] += 1

    def stats(self) -> dict:
        with self._lock:
            count, size = 0, 0
            if self._available:
                try:
                    with self._transaction() as conn:
                        count, size = conn.execute("SELECT COUNT(*), COALESCE(SUM(stored_bytes), 0) FROM entries").fetchone()
                except (sqlite3.Error, OSError):
                    self._counters["errors"] += 1
            return {**self._counters, "entries": count, "bytes": size,
                    "max_bytes": self.max_bytes, "available": self._available}

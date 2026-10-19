"""Single GPU queue, immutable snapshots, per-session revisions and logical cancellation."""
import copy
import queue
import threading
import time
import uuid
from dataclasses import dataclass, field

from .comfy_adapter import Canceled, SubmissionUncertain


class PreviewGate:
    def __init__(self, interval=.2):
        self.interval = interval
        self.last = float('-inf')
        self.revision = None

    def allow(self, revision, current_revision, now=None):
        now = time.monotonic() if now is None else now
        if revision != current_revision:
            return False
        if self.revision != revision:
            self.last = float('-inf')
            self.revision = revision
        if now - self.last < self.interval:
            return False
        self.last = now
        return True


@dataclass
class Job:
    job_id: str
    session: str
    revision: int
    request: dict
    state: str = 'queued'
    cancel: threading.Event = field(default_factory=threading.Event)
    done: threading.Event = field(default_factory=threading.Event)
    created: float = field(default_factory=time.perf_counter)
    preview: bytes | None = None
    preview_version: int = 0
    preview_dropped: int = 0
    result: dict | None = None
    error: str | None = None
    prompt_id: str | None = None
    queue_s: float | None = None
    commit: object = None
    finalize: object = None


class JobManager:
    def __init__(self, runner, max_jobs=100):
        self.runner = runner
        self.max_jobs = max_jobs
        self.jobs = {}
        self.revisions = {}
        self.lock = threading.RLock()
        self.queue = queue.Queue()
        self.worker = threading.Thread(target=self._worker, daemon=True)
        self.worker.start()

    def submit(self, session, request):
        if not isinstance(session, str) or not 1 <= len(session) <= 100:
            raise ValueError('Invalid session')
        snapshot = copy.deepcopy(request)
        with self.lock:
            for job_id, job in list(self.jobs.items()):
                if len(self.jobs) < self.max_jobs:
                    break
                if job.done.is_set():
                    del self.jobs[job_id]
            if len(self.jobs) >= self.max_jobs:
                raise ValueError('Job queue is full')
            revision = self.revisions.get(session, 0) + 1
            self.revisions[session] = revision
            for job in self.jobs.values():
                if job.session == session and not job.done.is_set():
                    self._cancel(job)
            job = Job(uuid.uuid4().hex, session, revision, snapshot)
            self.jobs[job.job_id] = job
            self.queue.put(job)
            return self._public(job)

    def _cancel(self, job):
        if not job.done.is_set() and job.state not in ('succeeded', 'failed', 'uncertain', 'canceled'):
            job.cancel.set()
            job.state = 'canceling' if job.state == 'running' else 'canceled'
            job.preview = None

    def cancel(self, job_id):
        with self.lock:
            self._cancel(self.jobs[job_id])
            return self._public(self.jobs[job_id])

    def _public(self, job):
        return {'job_id': job.job_id, 'session': job.session, 'revision': job.revision, 'state': job.state,
                'is_current': self.revisions.get(job.session) == job.revision,
                'preview': job.preview_version if job.preview is not None else None,
                'preview_dropped': job.preview_dropped, 'result': copy.deepcopy(job.result),
                'error': job.error, 'prompt_id': job.prompt_id, 'queue_s': job.queue_s,
                'cancel_semantics': 'local discard only; GPU work may continue'}

    def get(self, job_id):
        with self.lock:
            return self._public(self.jobs[job_id])

    def get_preview(self, job_id):
        with self.lock:
            job = self.jobs[job_id]
            return job.preview if not job.cancel.is_set() and self.revisions.get(job.session) == job.revision else None

    def wait(self, job_id, timeout=600):
        with self.lock:
            job = self.jobs[job_id]
        if not job.done.wait(timeout):
            raise TimeoutError(job_id)
        return self.get(job_id)

    def _worker(self):
        while True:
            job = self.queue.get()
            if job is None:
                return
            def preview(data):
                with self.lock:
                    if not job.cancel.is_set() and gate.allow(job.revision, self.revisions.get(job.session)):
                        job.preview = bytes(data)
                        job.preview_version += 1
                    else:
                        job.preview_dropped += 1
            try:
                gate = PreviewGate(interval=float(job.request.get('preview_interval', .2)))
                with self.lock:
                    if job.cancel.is_set():
                        raise Canceled('Canceled before execution')
                    job.state = 'running'
                    job.queue_s = time.perf_counter() - job.created
                result = self.runner(job, preview)
                with self.lock:
                    if job.cancel.is_set() or self.revisions.get(job.session) != job.revision:
                        raise Canceled('Superseded result discarded')
                    if job.finalize is not None:
                        job.finalize('succeeded', None)
                        job.finalize = None
                    if job.commit is not None:
                        job.commit()
                    job.result = result
                    job.state = 'succeeded'
            except Canceled as exc:
                with self.lock:
                    job.state = 'canceled'
                    job.error = str(exc)
                    job.preview = None
            except Exception as exc:
                with self.lock:
                    job.state = 'uncertain' if isinstance(exc, SubmissionUncertain) else 'failed'
                    job.error = str(exc)
            finally:
                try:
                    if job.finalize is not None:
                        job.finalize(job.state, job.error)
                except Exception as exc:
                    with self.lock:
                        job.state = 'failed'
                        job.error = f'Could not finalize run record: {exc}'
                finally:
                    job.done.set()

    def close(self):
        with self.lock:
            for job in self.jobs.values():
                self._cancel(job)
        self.queue.put(None)
        self.worker.join(timeout=3)

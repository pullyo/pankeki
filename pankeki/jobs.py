"""Independent bounded CPU/GPU lanes, durable metadata and shared revision commits."""
import copy
import queue
import re
import threading
import time
import uuid
from dataclasses import dataclass, field

from .comfy_adapter import Canceled, SubmissionUncertain
from .job_store import ACTIVE_STATES


def classify_lane(request):
    return 'cpu' if request.get('edit_operation') == 'recolor' or request.get('_image_operation') else 'gpu'


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
    lane: str = 'gpu'
    trace_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    cancel: threading.Event = field(default_factory=threading.Event)
    done: threading.Event = field(default_factory=threading.Event)
    created: float = field(default_factory=time.perf_counter)
    preview: bytes | None = None
    preview_version: int = 0
    preview_dropped: int = 0
    result: dict | None = None
    error: str | None = None
    exception: object = None
    client_id: str | None = None
    workflow_sha256: str | None = None
    prompt_id: str | None = None
    cancel_outcome: dict | None = None
    queue_s: float | None = None
    commit: object = None
    finalize: object = None
    seal: object = None
    handler: object = None
    persist_submission: object = None
    on_submitted: object = None
    on_cancelled: object = None


class JobManager:
    def __init__(self, runner, max_jobs=100, *, store=None, cpu_runner=None, max_pending=None):
        if type(max_jobs) is not int or max_jobs < 1 or (max_pending is not None and (type(max_pending) is not int or max_pending < 1)):
            raise ValueError('Lane capacity must be a positive integer')
        self.runner = runner
        self.cpu_runner = cpu_runner
        self.max_jobs = max_jobs
        self.store = store
        self.jobs = {}
        self.lock = threading.RLock()
        self.closed = False
        if store is not None:
            store.acquire_owner()
            try:
                store.mark_orphaned()
            except BaseException:
                store.release_owner()
                raise
        self.revisions = store.revisions() if store is not None else {}
        self.queues = {lane: queue.Queue(maxsize=max_jobs if max_pending is None else max_pending) for lane in ('cpu', 'gpu')}
        self.workers = {lane: threading.Thread(target=self._worker, args=(lane,), daemon=True, name='pankeki-' + lane) for lane in self.queues}
        self.live_lanes = set(self.workers)
        self.queue = self.queues['gpu']  # compatibility for observers of the original worker
        self.worker = self.workers['gpu']
        for worker in self.workers.values():
            worker.start()

    def _persist(self, job):
        if self.store is not None:
            item = self._public(job)
            if not self.store.transition(job.job_id, (*ACTIVE_STATES, job.state), item):
                if job.state == 'succeeded' and self.store.revisions().get(job.session) != job.revision:
                    raise Canceled('Durable session revision advanced; stale result discarded')
                raise RuntimeError('Durable job transition rejected')

    def submit(self, session, request, *, handler=None):
        if not isinstance(session, str) or not 1 <= len(session) <= 100:
            raise ValueError('Invalid session')
        snapshot = copy.deepcopy(request)
        lane = classify_lane(snapshot)
        with self.lock:
            if self.closed:
                raise ValueError('Job manager is closed')
            for job_id, job in list(self.jobs.items()):
                if sum(j.lane == lane for j in self.jobs.values()) < self.max_jobs:
                    break
                if job.lane == lane and job.done.is_set():
                    del self.jobs[job_id]
                    if sum(j.lane == lane for j in self.jobs.values()) < self.max_jobs:
                        break
            if self.queues[lane].full() or sum(j.lane == lane for j in self.jobs.values()) >= self.max_jobs:
                raise ValueError(f'{lane.upper()} job queue is full')
            job_id = uuid.uuid4().hex
            trace_id = snapshot.get('trace_id')
            if not isinstance(trace_id, str) or re.fullmatch('[A-Za-z0-9_-]{1,128}', trace_id) is None:
                trace_id = uuid.uuid4().hex
            revision = self.revisions.get(session, 0) + 1
            if self.store is not None:
                record = self.store.create({'job_id': job_id, 'session': session, 'state': 'queued',
                    'lane': lane, 'trace_id': trace_id, 'request': snapshot})
                revision = record['revision']
            self.revisions[session] = revision
            for old in self.jobs.values():
                if old.session == session and not old.done.is_set():
                    self._cancel(old)
            job = Job(job_id, session, revision, snapshot, lane=lane, trace_id=trace_id, handler=handler)
            def submitting(client_id, digest):
                with self.lock:
                    job.client_id, job.workflow_sha256 = client_id, digest
                    if job.cancel.is_set():
                        raise Canceled('Canceled before submission')
                    job.state = 'submitting'
                    self._persist(job)
            def submitted(prompt_id):
                with self.lock:
                    job.prompt_id = prompt_id
                    if not job.cancel.is_set():
                        job.state = 'running'
                    self._persist(job)
            def cancelled(outcome):
                with self.lock:
                    job.cancel_outcome = copy.deepcopy(outcome)
                    self._persist(job)
            job.persist_submission, job.on_submitted, job.on_cancelled = submitting, submitted, cancelled
            self.jobs[job.job_id] = job
            self.queues[lane].put_nowait(job)
            return self._public(job)

    def _cancel(self, job):
        if not job.done.is_set() and job.state not in ('succeeded', 'failed', 'uncertain', 'canceled', 'orphaned'):
            job.cancel.set()
            job.state = 'canceling' if job.state in ('running', 'submitting') else 'canceled'
            job.preview = None
            self._persist(job)

    def cancel(self, job_id):
        with self.lock:
            if job_id not in self.jobs:
                item = self.get(job_id)
                return item
            self._cancel(self.jobs[job_id])
            return self._public(self.jobs[job_id])

    def _public(self, job):
        result = copy.deepcopy(job.result)
        return {'job_id': job.job_id, 'session': job.session, 'revision': job.revision, 'state': job.state,
                'is_current': self.revisions.get(job.session) == job.revision, 'lane': job.lane, 'trace_id': job.trace_id,
                'preview': job.preview_version if job.preview is not None else None,
                'preview_dropped': job.preview_dropped, 'result': result,
                'error': job.error, 'prompt_id': job.prompt_id, 'client_id': job.client_id,
                'workflow_sha256': job.workflow_sha256, 'queue_s': job.queue_s,
                'result_sha256': result.get('result_sha256') if isinstance(result, dict) else None,
                'run_ref': result.get('run_ref') if isinstance(result, dict) else None,
                'cancel_outcome': copy.deepcopy(job.cancel_outcome),
                'cancel_semantics': 'local discard; cancel_outcome confirmed means ComfyUI dequeued or interrupted the owned prompt; otherwise running GPU may continue'}

    def get(self, job_id):
        with self.lock:
            if job_id in self.jobs:
                return self._public(self.jobs[job_id])
            item = self.store.get(job_id) if self.store is not None else None
            if item is None:
                raise KeyError(job_id)
            item.update(is_current=self.revisions.get(item['session']) == item['revision'], preview=None,
                        historical=True, preview_dropped=item.get('preview_dropped', 0))
            return item

    def get_preview(self, job_id):
        with self.lock:
            if job_id not in self.jobs:
                self.get(job_id)
                return None
            job = self.jobs[job_id]
            return job.preview if not job.cancel.is_set() and self.revisions.get(job.session) == job.revision else None

    def wait(self, job_id, timeout=600):
        with self.lock:
            job = self.jobs.get(job_id)
            if job is None:
                return self.get(job_id)
        if not job.done.wait(timeout):
            raise TimeoutError(job_id)
        return self.get(job_id)

    def _worker(self, lane):
        while True:
            try:
                job = self.queues[lane].get(timeout=.1)
            except queue.Empty:
                if self.closed:
                    with self.lock:
                        self.live_lanes.discard(lane)
                        if not self.live_lanes and self.store is not None:
                            self.store.close()
                    return
                continue
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
                    self._persist(job)
                runner = job.handler or (self.cpu_runner if lane == 'cpu' and self.cpu_runner is not None else self.runner)
                result = runner(job, preview)
                with self.lock:
                    if self.store is not None:
                        current = self.store.revisions().get(job.session, 0)
                        self.revisions[job.session] = max(self.revisions.get(job.session, 0), current)
                    if job.cancel.is_set() or self.revisions.get(job.session) != job.revision:
                        raise Canceled('Superseded result discarded')
                    if job.finalize is not None:
                        job.finalize('succeeded', None)
                    if job.commit is not None:
                        job.commit()
                    if job.seal is not None:
                        job.seal()
                    job.finalize = None
                    job.result = result
                    job.state = 'succeeded'
                    self._persist(job)
            except Exception as exc:
                with self.lock:
                    job.exception = exc
                    job.state = 'canceled' if isinstance(exc, Canceled) else ('uncertain' if isinstance(exc, SubmissionUncertain) else 'failed')
                    job.error = str(exc)[:4000]
                    job.result = None
                    job.preview = None
            finally:
                try:
                    with self.lock:
                        if job.finalize is not None:
                            job.finalize(job.state, job.error)
                            job.finalize = None
                except Exception as exc:
                    with self.lock:
                        job.state, job.error, job.result = 'failed', f'Could not finalize run record: {exc}'[:4000], None
                finally:
                    with self.lock:
                        try:
                            self._persist(job)
                        except Exception as exc:
                            # Fail closed without killing a lane on an unavailable DB.
                            # The durable prior active record becomes orphaned on restart.
                            job.state, job.result, job.exception = 'failed', None, exc
                            job.error = f'Durable job metadata could not be written: {exc}'[:4000]
                        finally:
                            job.done.set()
                    self.queues[lane].task_done()

    def close(self):
        with self.lock:
            self.closed = True
            for job in self.jobs.values():
                try:
                    self._cancel(job)
                except Exception as exc:
                    job.error = f'Shutdown persistence unavailable: {exc}'[:4000]
        for worker in self.workers.values():
            worker.join(timeout=3)
        # A noncooperative runner may still persist its final discard after close.
        if self.store is not None and not any(worker.is_alive() for worker in self.workers.values()):
            self.store.close()

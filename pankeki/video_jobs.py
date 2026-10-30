"""Separate atomic video journal; no image job database or automatic replay."""
import copy
import fcntl
import hashlib
import json
import os
import queue
import re
import threading
import time
import uuid

from .video_runtime import DEFAULTS, VideoCanceled, VideoError, atomic_json, regular_path
from .blender_video import sha256

ACTIVE = {'queued','running','canceling'}


class VideoJobManager:
    def __init__(self, runtime):
        self.runtime = runtime
        self.directory = runtime.directory
        self.journal = self.directory/'jobs'
        self.runs = self.directory/'runs'
        self.journal.mkdir(parents=True,exist_ok=True)
        self.runs.mkdir(parents=True,exist_ok=True)
        self.owner = (self.directory/'journal.lock').open('a+b')
        try:
            fcntl.flock(self.owner.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError as exc:
            self.owner.close()
            raise VideoError('다른 서버가 영상 작업 저장소를 사용 중입니다.') from exc
        self.lock = threading.RLock()
        self.jobs, self.cancels, self.done = {}, {}, {}
        self.closed = False
        self.queue = queue.Queue(maxsize=2)
        try:
            for path in sorted(self.journal.glob('*.json')):
                if not re.fullmatch('[0-9a-f]{32}',path.stem):
                    continue
                regular_path(path)
                if path.stat().st_size > 1024*1024:
                    raise VideoError('영상 작업 기록 크기를 확인할 수 없습니다.')
                item = json.loads(path.read_text())
                if item.get('id') != path.stem:
                    raise VideoError('영상 작업 기록 식별자가 올바르지 않습니다.')
                if item.get('status') in ACTIVE:
                    item.update(status='orphaned',phase='orphaned',result_url=None,progress=None,
                                error='서버가 다시 시작되어 이전 작업을 중단 상태로 보존했습니다. 자동으로 다시 생성하지 않습니다.')
                    atomic_json(path,item)
                self.jobs[path.stem] = item
        except BaseException:
            self.owner.close()
            raise
        self.worker = threading.Thread(target=self._worker,name='pankeki-video',daemon=True)
        self.worker.start()

    def _save(self, item):
        atomic_json(self.journal/(item['id']+'.json'),item)

    def _public(self, item):
        value = {key:copy.deepcopy(item.get(key)) for key in ('id','status','phase','progress','guide_url','result_url','error',
                 'width','height','frames','fps','project_id','epoch')}
        if item.get('started_at') and item.get('status') in ACTIVE:
            value['elapsed_seconds'] = round(max(0,time.time()-item['started_at']),3)
        else:
            value['elapsed_seconds'] = item.get('elapsed_seconds',0)
        return value

    def submit(self, body):
        submission = self.runtime.normalize_request(body)
        fingerprint = hashlib.sha256(json.dumps(submission,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        with self.lock:
            if self.closed:
                raise VideoError('영상 작업 관리자가 종료되었습니다.')
            related = [item for item in self.jobs.values() if item.get('project_id') == submission['project_id']]
            for item in related:
                if item.get('epoch') == submission['epoch']:
                    recorded_digest = item.get('durable_request_sha256')
                    if recorded_digest is None and isinstance(item.get('request'),dict):
                        # Upgrade the comparison from the immutable accepted snapshot,
                        # never from the current filesystem or expired grant.
                        previous = {key:item['request'][key] for key in ('scene_id','project_id','epoch','prompt','seed') if key in item['request']}
                        previous = self.runtime.normalize_request(previous)
                        recorded_digest = hashlib.sha256(json.dumps(previous,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
                    if recorded_digest == fingerprint:
                        return self._public(item)
                    raise VideoError('같은 프로젝트 버전의 다른 요청이 있습니다. 새 버전으로 생성해 주세요.')
            if related and submission['epoch'] < max(item['epoch'] for item in related):
                raise VideoError('오래된 프로젝트 버전의 영상 요청을 거부했습니다.')
            if self.queue.full():
                raise VideoError('영상 작업 대기열이 가득 찼습니다.')
            request = self.runtime.validate_request(submission)
            for item in related:
                if item['status'] in ACTIVE:
                    self._cancel(item)
            job_id = uuid.uuid4().hex
            item = {'id':job_id,'status':'queued','phase':'queued','progress':None,'guide_url':None,'result_url':None,'error':None,
                    'created_at':time.time(),'started_at':None,'elapsed_seconds':0,'request':request,
                    'durable_request_sha256':fingerprint,'source_sha256':request['scene_sha256'],
                    'project_id':request['project_id'],'epoch':request['epoch'],**DEFAULTS}
            self._save(item)
            self.jobs[job_id] = item
            self.cancels[job_id], self.done[job_id] = threading.Event(), threading.Event()
            self.queue.put_nowait(job_id)
            return self._public(item)

    def get(self, job_id):
        with self.lock:
            return self._public(self.jobs[job_id])

    def _cancel(self, item):
        if item['status'] not in ACTIVE:
            return
        cancel = self.cancels.get(item['id'])
        if cancel:
            cancel.set()
        item.update(status='canceling',progress=None,result_url=None)
        self._save(item)

    def cancel(self, job_id):
        with self.lock:
            item = self.jobs[job_id]
            self._cancel(item)
        self.runtime.cancel(job_id)
        return self.get(job_id)

    def wait(self, job_id, timeout=600):
        with self.lock:
            event = self.done.get(job_id)
        if event is not None and not event.wait(timeout):
            raise TimeoutError(job_id)
        return self.get(job_id)

    def _worker(self):
        try:
            while True:
                try:
                    job_id = self.queue.get(timeout=.1)
                except queue.Empty:
                    if self.closed:
                        return
                    continue
                item = self.jobs[job_id]
                cancel = self.cancels[job_id]
                try:
                    with self.lock:
                        if cancel.is_set():
                            raise VideoCanceled('대기 중 영상 작업을 취소했습니다.')
                        item.update(status='running',started_at=time.time())
                        self._save(item)
                    directory = self.runs/job_id
                    directory.mkdir(exist_ok=False)
                    atomic_json(directory/'request.json',item['request'])
                    def update(**changes):
                        with self.lock:
                            if cancel.is_set():
                                raise VideoCanceled('영상 생성을 취소했습니다.')
                            item.update(changes)
                            self._save(item)
                    result = self.runtime.run(item['request'],directory,cancel,update)
                    with self.lock:
                        if cancel.is_set() or any(other['project_id']==item['project_id'] and other['epoch']>item['epoch'] for other in self.jobs.values()):
                            raise VideoCanceled('새 프로젝트 버전이 있어 이전 결과를 확정하지 않았습니다.')
                        if result.get('ai_generated') is not True or not result.get('full_decode_verified'):
                            raise VideoError('실제 AI 영상 결과 검증이 완료되지 않았습니다.')
                        verification = directory/'verification.json'
                        if not verification.is_file() or sha256(directory/'result.pending.mp4') != result['sha256']:
                            raise VideoError('AI 영상 결과의 무결성을 확인할 수 없습니다.')
                        os.replace(directory/'result.pending.mp4',directory/'result.mp4')
                        atomic_json(directory/'complete.json',{'schema':'pankeki.video-result.v1','job_id':job_id,
                                    'verification_sha256':sha256(verification),'result_sha256':result['sha256']})
                        item.update(status='succeeded',phase='completed',result_url=result['url'],progress=1.0)
                except Exception as exc:
                    with self.lock:
                        item.update(status='canceled' if cancel.is_set() or isinstance(exc,VideoCanceled) else 'failed',
                                    phase='canceled' if cancel.is_set() or isinstance(exc,VideoCanceled) else 'failed',progress=None,
                                    result_url=None,error=str(exc)[:2000])
                finally:
                    with self.lock:
                        if item.get('started_at'):
                            item['elapsed_seconds'] = round(max(0,time.time()-item['started_at']),3)
                        try:
                            self._save(item)
                        finally:
                            self.done[job_id].set()
                            self.queue.task_done()
        finally:
            self.owner.close()

    def result(self, job_id):
        with self.lock:
            item = self.jobs[job_id]
            if item['status'] != 'succeeded':
                raise VideoError('아직 확정된 AI 영상 결과가 없습니다.')
            directory = self.runs/job_id
            for name in ('complete.json','verification.json','result.mp4'):
                regular_path(directory/name)
            marker = json.loads((directory/'complete.json').read_text())
            if marker.get('job_id') != job_id or marker.get('verification_sha256') != sha256(directory/'verification.json'):
                raise VideoError('영상 완료 기록의 무결성을 확인할 수 없습니다.')
            result = json.loads((directory/'verification.json').read_text())
            if (result.get('ai_generated') is not True or not result.get('full_decode_verified')
                    or result.get('sha256') != marker.get('result_sha256') or sha256(directory/'result.mp4') != result.get('sha256')
                    or result.get('url') != f'/api/video/assets/{job_id}/result.mp4'):
                raise VideoError('영상 결과 파일의 무결성을 확인할 수 없습니다.')
            return result

    def asset(self, job_id, name):
        with self.lock:
            item = self.jobs[job_id]
            if name == 'result.mp4':
                if item['status'] != 'succeeded':
                    raise KeyError(job_id)
                self.result(job_id)
            elif name == 'guide.mp4' and item.get('guide_url'):
                path = self.runs/job_id/'guide-verification.json'
                regular_path(path)
                verification = json.loads(path.read_text())
                target = self.runs/job_id/name
                regular_path(target)
                if sha256(target) != verification['guide']['sha256']:
                    raise VideoError('구도 영상 파일의 무결성을 확인할 수 없습니다.')
            else:
                raise KeyError(name)
            return self.runs/job_id/name

    def close(self):
        with self.lock:
            self.closed = True
            ids = [item['id'] for item in self.jobs.values() if item['status'] in ACTIVE]
        for job_id in ids:
            self.cancel(job_id)
        self.worker.join(timeout=5)

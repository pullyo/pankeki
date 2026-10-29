"""Loopback-only local UI with bounded JSON input and same-origin mutations."""
import json
import hashlib
import inspect
import base64
import math
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from .engine import Engine
from .jobs import JobManager
from .job_store import JobStore
from .run_store import RunStore
from .foreground import _image as decode_photo_png, foreground_mask

VIDEO_SUPPORTED = sys.platform == 'darwin'

class ImageOperationError(ValueError):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.status = code, status


def validate_image_op(body):
    def fields(value, allowed):
        if not isinstance(value, dict) or set(value) != set(allowed):
            raise ValueError('Unexpected or missing image-operation fields')
    fields(body, ['version','operationId','operation','source','options'] + (['trace_id'] if 'trace_id' in body else []))
    if 'trace_id' in body and (not isinstance(body['trace_id'],str) or re.fullmatch('[A-Za-z0-9_-]{1,128}',body['trace_id']) is None):
        raise ValueError('Invalid image-operation trace identity')
    if type(body['version']) is not int or body['version'] != 1 or not isinstance(body['operationId'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',body['operationId']):
        raise ValueError('Invalid image-operation identity')
    operation, source, options = body['operation'], body['source'], body['options']
    if operation not in ('markup','background-remove','resize'):
        raise ValueError('Unsupported image operation')
    fields(source,['png','sha256','width','height'])
    encoded = source['png']
    if isinstance(encoded,str) and len(encoded)>16*1024*1024:
        raise ImageOperationError('size-limit','원본 이미지 저장 크기는 16MiB 이하여야 합니다.',413)
    if not isinstance(encoded,str) or not encoded.startswith('data:image/png;base64,'):
        raise ValueError('A bounded PNG data URL is required')
    raw = base64.b64decode(encoded[22:],validate=True)
    if not isinstance(source['sha256'],str) or not re.fullmatch('[a-f0-9]{64}',source['sha256']) or hashlib.sha256(raw).hexdigest()!=source['sha256']:
        raise ValueError('Source SHA256 does not match PNG bytes')
    image = decode_photo_png(raw)
    if any(type(source[key]) is not int for key in ('width','height')) or (source['width'],source['height'])!=image.size:
        raise ValueError('Source dimensions do not match PNG bytes')
    if operation=='resize':
        fields(options,['width','height','keepAspect'])
        if any(type(options[key]) is not int or not 1<=options[key]<=8192 for key in ('width','height')) or options['width']*options['height']>16777216 or type(options['keepAspect']) is not bool:
            raise ValueError('Invalid output image dimensions or aspect lock')
        if (options['keepAspect']
                and options['height'] != max(1,math.floor(image.height*options['width']/image.width+.5))
                and options['width'] != max(1,math.floor(image.width*options['height']/image.height+.5))):
            raise ValueError('Locked aspect dimensions must match the source ratio')
    elif operation=='background-remove':
        fields(options,[])
    else:
        fields(options,['strokes'])
        strokes=options['strokes']; points=0
        if not isinstance(strokes,list) or not 1<=len(strokes)<=128:
            raise ValueError('Markup needs 1..128 strokes')
        for stroke in strokes:
            fields(stroke,['points','color','width','opacity'])
            if not isinstance(stroke['color'],str) or not re.fullmatch('#[A-Fa-f0-9]{6}',stroke['color']):
                raise ValueError('Invalid markup color')
            for name,low,high in [('width',1,256),('opacity',0,1)]:
                value=stroke[name]
                if type(value) not in (int,float) or not math.isfinite(value) or not low<=value<=high:
                    raise ValueError('Invalid markup width or opacity')
            if not isinstance(stroke['points'],list) or not 1<=len(stroke['points'])<=4096:
                raise ValueError('Markup stroke is empty')
            points+=len(stroke['points'])
            if points>16384:raise ValueError('Too many markup points')
            for point in stroke['points']:
                fields(point,['x','y'])
                if any(type(point[key]) not in (int,float) or not math.isfinite(point[key]) or not 0<=point[key]<=limit for key,limit in [('x',image.width),('y',image.height)]):
                    raise ValueError('Invalid natural-image markup coordinates')
    return operation, raw, options


def perform_image_op(operation, raw, options, *, cancel_check=None):
    try:
        from . import imageops
    except ImportError as exc:
        raise ImageOperationError('operation-unavailable','이미지 도구 모듈이 준비되지 않았습니다.',422) from exc
    limits=imageops.Limits(max_png_bytes=20*1024*1024,max_pixels=16777216,max_aggregate_pixels=67108864)
    deadline=time.monotonic()+60
    def call(function,*args,**kwargs):
        try:return function(*args,limits=limits,cancel_check=lambda:time.monotonic()>deadline or bool(cancel_check and cancel_check()),**kwargs)
        except imageops.ResourceLimitError as exc:raise ImageOperationError('size-limit','이미지 처리 자원 제한을 넘었습니다.',413) from exc
        except imageops.OperationCancelled as exc:raise ImageOperationError('operation-failed','이미지 처리 제한 시간을 넘었습니다. 원본은 유지됩니다.',422) from exc
        except imageops.ImageOpsError as exc:raise ImageOperationError('invalid-input','이미지 또는 도구 입력을 처리할 수 없습니다.',400) from exc
    if operation=='background-remove':
        try:matte=foreground_mask(raw)
        except ValueError as exc:
            raise ImageOperationError('operation-unavailable','로컬 배경 분리를 완료하지 못했습니다. 원본은 유지됩니다.',422) from exc
        result=call(imageops.remove_background,raw,provided_alpha_mask_png=matte)
        algorithm='apple-vision-foreground-mask+alpha'; parameters={'matteSha256':hashlib.sha256(matte).hexdigest()}
    elif operation=='resize':
        # The UI aspect lock has already resolved/validated exact integer pixels.
        # Do not silently turn that exact pair into a smaller bounding-box fit.
        result=call(imageops.resize_png,raw,options['width'],options['height'],False)
        algorithm='pillow-lanczos';parameters=dict(options)
    else:
        markup=getattr(imageops,'markup_png',None)
        if not callable(markup):raise ImageOperationError('operation-unavailable','마크업 렌더러가 준비되지 않았습니다.',422)
        # Canvas uses pixel-corner coordinates; the pure renderer uses pixel centers.
        strokes=[{**stroke,'points':[{'x':point['x']-.5,'y':point['y']-.5} for point in stroke['points']]} for stroke in options['strokes']]
        result=call(markup,raw,strokes)
        algorithm='pillow-markup';parameters={'strokeCount':len(options['strokes']),'strokesSha256':hashlib.sha256(json.dumps(options['strokes'],sort_keys=True,separators=(',',':')).encode()).hexdigest(),'coordinateOffset':-.5}
    return result.png, {'algorithm':algorithm,'algorithmVersion':str(imageops.SCHEMA_VERSION),'parameters':parameters}


# Delivery integrity only. No SDK is acquired or approved by this route.
def cubism_asset(root, url_path):
    prefix = '/vendor/cubism/'
    if not url_path.startswith(prefix):
        return None
    name = url_path[len(prefix):]
    fixed = {'live2dcubismcore.js', 'pankeki-cubism-framework.js'}
    def allowed(value):
        return value in fixed or (isinstance(value, str) and re.fullmatch(r'Shaders/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+\.(?:frag|vert|glsl)', value) is not None)
    if name != 'runtime-manifest.json' and not allowed(name):
        return None
    base = root / 'web' / 'vendor' / 'cubism'
    def read(relative, limit=32 * 1024 * 1024):
        path = base / relative
        cursor = root
        for part in path.relative_to(root).parts:
            cursor = cursor / part
            if cursor.is_symlink():
                raise ValueError('Symlink delivery rejected')
        if not path.is_file() or path.stat().st_size > limit:
            raise ValueError('Missing or oversized runtime file')
        return path.read_bytes()
    try:
        raw = read('runtime-manifest.json', 1024 * 1024)
        manifest = json.loads(raw)
        if not isinstance(manifest, dict) or manifest.get('format') != 'pankeki-cubism-runtime' or type(manifest.get('version')) is not int or manifest['version'] != 1:
            return None
        files, sdk = manifest.get('files'), manifest.get('sdk')
        if not isinstance(files, dict) or not isinstance(sdk, dict) or not fixed.issubset(files) or len(files) > 256:
            return None
        if any(not allowed(key) or not isinstance(value, str) or not re.fullmatch('[0-9a-f]{64}', value) for key, value in files.items()):
            return None
        if not isinstance(sdk.get('coreVersion'), str) or not sdk['coreVersion'].strip() or not isinstance(sdk.get('frameworkCommit'), str) or not re.fullmatch('[0-9a-f]{40}', sdk['frameworkCommit']):
            return None
        if sdk.get('coreHash') != files['live2dcubismcore.js'] or sdk.get('bundleHash') != files['pankeki-cubism-framework.js']:
            return None
        # A manifest or shader is unavailable when the required pair is missing/tampered.
        for required in fixed:
            if hashlib.sha256(read(required)).hexdigest() != files[required]:
                return None
        if name == 'runtime-manifest.json':
            return raw, 'application/json; charset=utf-8'
        if name not in files:
            return None
        data = read(name, 1024 * 1024 if name.startswith('Shaders/') else 32 * 1024 * 1024)
        if hashlib.sha256(data).hexdigest() != files[name]:
            return None
        return data, 'application/javascript; charset=utf-8' if name.endswith('.js') else 'text/plain; charset=utf-8'
    except (OSError, ValueError, TypeError, UnicodeError, RecursionError):
        return None


def font_asset(root, url_path):
    """Serve only the current UI font under its exact content-hash name."""
    from .build_identity import FONT_ROUTE, FONT_SOURCE, font_asset_path
    if FONT_ROUTE.fullmatch(url_path) is None:
        return None
    try:
        path = root / FONT_SOURCE
        cursor = root
        for part in path.relative_to(root).parts:
            cursor = cursor / part
            if cursor.is_symlink():
                return None
        if not path.is_file() or path.stat().st_size > 16 * 1024 * 1024:
            return None
        data = path.read_bytes()
        return data if font_asset_path(data) == url_path else None
    except (OSError, ValueError):
        return None


def make_server(root, port=8190, comfy_url='http://127.0.0.1:8188', config=None):
    root = Path(root)
    from .build_identity import source_content_id
    # Observes source file bytes once at startup, not loaded code object identity.
    process_source_id = source_content_id(root)
    engine = None
    manager = None
    video_manager = None
    photo_lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            pass

        def send(self, status, data, content_type='application/json', cache='no-store'):
            if isinstance(data, (dict, list)):
                data = json.dumps(data, ensure_ascii=False).encode()
            elif isinstance(data, str):
                data = data.encode()
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', cache)
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(data)

        def guard(self, mutation=False):
            hosts = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
            if self.headers.get('Host') not in hosts:
                raise ValueError('Invalid Host')
            origin = self.headers.get('Origin')
            if origin and origin not in {'http://' + host for host in hosts}:
                raise ValueError('Cross-origin request rejected')
            if mutation and self.headers.get_content_type() != 'application/json':
                raise ValueError('JSON content type required')

        def send_video_asset(self, path, *, head=False):
            size = path.stat().st_size
            start, end, status = 0, size-1, 200
            requested = self.headers.get('Range')
            if requested:
                match = re.fullmatch(r'bytes=(\d*)-(\d*)', requested)
                if match and any(match.groups()):
                    left, right = match.groups()
                    if left:
                        start = int(left)
                        end = min(size-1,int(right)) if right else size-1
                    else:
                        start = max(0,size-int(right))
                    status = 206
                if not match or not any(match.groups()) or start >= size or start > end or (not match[1] and int(match[2] or 0)==0):
                    self.send_response(416)
                    self.send_header('Content-Range',f'bytes */{size}')
                    self.send_header('Content-Length','0')
                    self.end_headers()
                    return
            self.send_response(status)
            self.send_header('Content-Type','video/mp4')
            self.send_header('Content-Length',str(end-start+1))
            self.send_header('Accept-Ranges','bytes')
            self.send_header('Cache-Control','no-store')
            self.send_header('X-Content-Type-Options','nosniff')
            if status==206:
                self.send_header('Content-Range',f'bytes {start}-{end}/{size}')
            self.end_headers()
            if not head:
                with path.open('rb') as stream:
                    stream.seek(start)
                    remaining = end-start+1
                    while remaining:
                        block = stream.read(min(1024*1024,remaining))
                        if not block:
                            break
                        self.wfile.write(block)
                        remaining -= len(block)

        def do_HEAD(self):
            try:
                self.guard()
                match = re.fullmatch(r'/api/video/assets/([0-9a-f]{32})/(guide|result)\.mp4',urlsplit(self.path).path)
                if match and video_manager is not None:
                    return self.send_video_asset(video_manager.asset(match[1],match[2]+'.mp4'),head=True)
                return self.send(404,{'error':'Not found'})
            except KeyError:
                self.send(404,{'error':'Unknown video job'})
            except (ValueError,OSError) as exc:
                self.send(400,{'error':str(exc)})

        def do_GET(self):
            try:
                self.guard()
                path = urlsplit(self.path).path
                if path == '/':
                    return self.send(200, (root / 'web' / 'index.html').read_bytes(), 'text/html; charset=utf-8')
                if path.startswith('/assets/fonts/'):
                    font = font_asset(root, path)
                    if font is None:
                        return self.send(404, {'error': 'Font unavailable'})
                    return self.send(200, font, 'font/woff2', 'public, max-age=31536000, immutable')
                if path.startswith('/vendor/cubism/'):
                    asset = cubism_asset(root, path)
                    return self.send(200, *asset) if asset else self.send(404, {'error': 'Runtime file unavailable'})
                if path == '/api/video/status':
                    return self.send(200,video_manager.runtime.status() if video_manager else {
                        'ready':False,'reason':'로컬 영상 생성은 Apple Silicon Mac에서 지원합니다.',
                        'model':None,'defaults':{'width':384,'height':256,'frames':49,'fps':24,'steps':8},'blender_available':False})
                match = re.fullmatch(r'/api/video/(jobs|results)/([0-9a-f]{32})',path)
                if match and video_manager is not None:
                    return self.send(200,video_manager.get(match[2]) if match[1]=='jobs' else video_manager.result(match[2]))
                match = re.fullmatch(r'/api/video/assets/([0-9a-f]{32})/(guide|result)\.mp4',path)
                if match and video_manager is not None:
                    return self.send_video_asset(video_manager.asset(match[1],match[2]+'.mp4'))
                if path == '/api/models':
                    return self.send(200, engine.models_info())
                if path == '/api/capabilities':
                    from .build_identity import get_build_identity
                    from .capabilities import capability_snapshot
                    build = get_build_identity(root, process_source_id=process_source_id)
                    return self.send(200, capability_snapshot(engine, build=build))
                if path == '/api/health':
                    from .build_identity import get_build_identity
                    from .capabilities import targeted_cancel_status
                    build = get_build_identity(root, process_source_id=process_source_id)
                    try:
                        health_check = getattr(engine.client, 'health', None)
                        status = health_check() if health_check else engine.client.get('/system_stats')
                        default_id = engine.models_info()['default_model_id']
                        default_model = engine.models.get(default_id, engine.config)
                        return self.send(200, {'comfy': True, 'system': status, 'cache': engine.cache.stats(), 'managed': engine.config.get('managed_builtin_only', False), 'transport': engine.config.get('transport', 'direct'), 'model_name': default_model.get('model_name'), 'default_model_id': default_id, 'build': build, 'targeted_cancel': targeted_cancel_status(engine)})
                    except Exception as exc:
                        return self.send(200, {'comfy': False, 'error': str(exc), 'cache': engine.cache.stats(), 'build': build})
                match = re.fullmatch(r'/api/(jobs|previews|results)/([0-9a-f]{32})', path)
                if match:
                    kind, job_id = match.groups()
                    if kind == 'jobs':
                        return self.send(200, manager.get(job_id))
                    if kind == 'previews':
                        data = manager.get_preview(job_id)
                        if data:
                            return self.send(200, data, 'image/png' if data.startswith(b'\x89PNG') else 'image/jpeg')
                    if kind == 'results':
                        item = manager.get(job_id)
                        if item['state'] == 'succeeded':
                            result = item.get('result') or {}
                            if result.get('run_ref') != 'runs/' + job_id:
                                raise ValueError('Result run does not match job')
                            return self.send(200, engine.run_store.read_result(result['run_ref'], result.get('result_sha256')), 'image/png')
                return self.send(404, {'error': 'Not found'})
            except KeyError:
                self.send(404, {'error': 'Unknown job'})
            except (ValueError, OSError) as exc:
                self.send(400, {'error': str(exc)})

        def do_POST(self):
            try:
                length = int(self.headers.get('Content-Length', 0))
                if not 0 < length <= 32 * 1024 * 1024:
                    if self.path=='/api/image-ops' and length>32*1024*1024:
                        raise ImageOperationError('size-limit','이미지 작업 요청은 32MiB 이하여야 합니다.',413)
                    raise ValueError('Request body must be <= 32 MiB')
                # Drain only a valid bounded body before rejecting Host/Origin/
                # Content-Type. Closing with unread incoming bytes can reset the
                # connection on Windows and discard our JSON error response.
                previous_timeout = self.connection.gettimeout()
                self.connection.settimeout(15)
                try:
                    raw_body = self.rfile.read(length)
                finally:
                    self.connection.settimeout(previous_timeout)
                if len(raw_body) != length:
                    raise ValueError('Request body ended before Content-Length')
                self.guard(mutation=True)
                body = json.loads(raw_body)
                if not isinstance(body, dict):
                    raise ValueError('Expected JSON object')
                if self.path == '/api/video/jobs':
                    if video_manager is None:
                        return self.send(503,{'error':'로컬 영상 생성은 Apple Silicon Mac에서 지원합니다.'})
                    status = video_manager.runtime.status()
                    if not status['ready']:
                        return self.send(503,{'error':status['reason']})
                    submitted = video_manager.submit(body)
                    return self.send(202,{'id':submitted['id'],'status':submitted['status']})
                match = re.fullmatch(r'/api/video/jobs/([0-9a-f]{32})/cancel',self.path)
                if match and video_manager is not None:
                    return self.send(200,video_manager.cancel(match[1]))
                if self.path == '/api/image-ops':
                    operation, raw, options = validate_image_op(body)
                    if not photo_lock.acquire(blocking=False):
                        raise ImageOperationError('busy','다른 이미지 도구 작업이 진행 중입니다.',409)
                    try:
                        def run_photo(job, on_preview):
                            started = time.perf_counter()
                            kwargs = {'cancel_check': job.cancel.is_set} if 'cancel_check' in inspect.signature(perform_image_op).parameters else {}
                            output, metadata = perform_image_op(operation,raw,options,**kwargs)
                            image=decode_photo_png(output)
                            encoded='data:image/png;base64,'+base64.b64encode(output).decode('ascii')
                            if len(encoded)>16*1024*1024:raise ImageOperationError('size-limit','결과 이미지가 저장 크기 제한을 넘습니다.',413)
                            if operation=='resize' and image.size!=(options['width'],options['height']):raise ImageOperationError('operation-failed','요청한 픽셀 크기와 결과가 다릅니다.',500)
                            if operation!='resize' and image.size!=decode_photo_png(raw).size:raise ImageOperationError('operation-failed','결과 이미지 크기가 원본과 다릅니다.',500)
                            original=decode_photo_png(raw).convert('RGBA')
                            if image.size==original.size and image.convert('RGBA').tobytes()==original.tobytes():raise ImageOperationError('no-change','이미지에 적용된 변경이 없습니다. 원본은 유지됩니다.',422)
                            directory = engine.run_store.begin(job.job_id, job.trace_id)
                            (directory / 'original.png').write_bytes(raw)
                            observations = {'kind': 'local_image_operation', 'lane': 'cpu', 'model_calls': 0,
                                'job_id': job.job_id, 'trace_id': job.trace_id, 'revision': job.revision,
                                'run_ref': 'runs/' + job.job_id, 'queue_s': job.queue_s}
                            result = engine._save(directory, job, output, {'operation': operation, 'parameters': options,
                                'original_sha256': hashlib.sha256(raw).hexdigest()}, observations, started)
                            result = {key:result[key] for key in ('trace_id','job_id','result_sha256','run_ref','image_url')}
                            result.update(ok=True, operationId=body['operationId'], operation=operation,
                                image={'png':encoded,'sha256':hashlib.sha256(output).hexdigest(),'width':image.width,'height':image.height}, metadata=metadata)
                            return result
                        submitted = manager.submit('image-op-' + body['operationId'],
                            {'_image_operation': operation, 'raw': raw, 'options': options,
                             'trace_id': body.get('trace_id')}, handler=run_photo)
                        try:
                            completed = manager.wait(submitted['job_id'], min(60, max(.01, float(engine.config.get('image_ops_wait_s', 60)))))
                        except TimeoutError:
                            return self.send(202, {'ok':False,'code':'in-progress','operationId':body['operationId'],
                                'job_id':submitted['job_id'],'state':manager.get(submitted['job_id'])['state']})
                        if completed['state'] != 'succeeded':
                            job = manager.jobs.get(submitted['job_id'])
                            if job is not None and isinstance(job.exception, ImageOperationError):
                                raise job.exception
                            raise ImageOperationError('operation-failed','이미지 처리를 완료하지 못했습니다. 원본은 유지됩니다.',500)
                        return self.send(200,completed['result'])
                    except ImageOperationError:raise
                    except Exception as exc:
                        raise ImageOperationError('operation-failed','이미지 처리를 완료하지 못했습니다. 원본은 유지됩니다.',500) from exc
                    finally:photo_lock.release()
                if self.path == '/api/jobs':
                    recipe = engine.validate_request(body['request'])
                    return self.send(202, manager.submit(body['session'], recipe))
                match = re.fullmatch(r'/api/jobs/([0-9a-f]{32})/cancel', self.path)
                if match:
                    return self.send(200, manager.cancel(match[1]))
                if self.path == '/api/cache/clear':
                    engine.cache.clear()
                    return self.send(200, engine.cache.stats())
                self.send(404, {'error': 'Not found'})
            except ImageOperationError as exc:
                self.send(exc.status,{'ok':False,'code':exc.code,'error':str(exc)})
            except (KeyError, ValueError, TypeError, OSError) as exc:
                if self.path=='/api/image-ops':self.send(400,{'ok':False,'code':'invalid-input','error':str(exc)})
                else:self.send(400, {'error': str(exc)})

    server = None
    job_store = None
    try:
        server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
        original_server_close = server.server_close
        def close_with_video():
            if video_manager is not None:
                video_manager.close()
            original_server_close()
        server.server_close = close_with_video
        # Binding must succeed before any orphan recovery. An OS-lifetime owner
        # lease also prevents a second port from sharing and orphaning this DB.
        engine = Engine(root, comfy_url, config)
        job_store = JobStore(engine.runtime / 'jobs.sqlite')
        if VIDEO_SUPPORTED:
            from .video_runtime import ResourceGate, VideoCanceled, VideoRuntime
            from .video_jobs import VideoJobManager
            from .comfy_adapter import Canceled
            gpu_gate = ResourceGate(root/'runtime/video/shared-gpu.lock')
            def image_runner(job,on_preview):
                if job.lane != 'gpu':
                    return engine(job,on_preview)
                try:
                    with gpu_gate.hold(job.cancel):
                        return engine(job,on_preview)
                except VideoCanceled as exc:
                    raise Canceled(str(exc)) from exc
            manager = JobManager(image_runner, store=job_store)
            video_manager = VideoJobManager(VideoRuntime(root,comfy_url=comfy_url,gate=gpu_gate))
        else:
            manager = JobManager(engine, store=job_store)
    except BaseException:
        if manager is not None:
            manager.close()
        elif job_store is not None:
            job_store.close()
        if server is not None:
            server.server_close()
        if engine is not None:
            engine.close()
        raise
    server.manager = manager
    server.engine = engine
    server.video_manager = video_manager
    server.process_source_id = process_source_id
    return server

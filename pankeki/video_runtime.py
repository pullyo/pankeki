"""Owned Blender-to-LTX execution. Guide renders are never AI results."""
from contextlib import contextmanager
import base64
import hashlib
import io
from datetime import datetime
import errno
import fcntl
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import struct
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid
import zlib

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from .blender_video import BlenderGuideJob, GuideRequest, sha256, LOADED_SOURCE_SHA256 as BLENDER_LOADED_SHA

from .video_profiles import DEFAULTS, PROFILES, DEPTH_NORMALIZATION_VERSION, video_profile, LOADED_SOURCE_SHA256 as PROFILES_LOADED_SHA
MODEL_ID = 'ltx-2.3-q8-union-mlx'
GRANT_TTL = 24 * 3600
LOADED_SOURCE_SHA256 = sha256(Path(__file__))
REFERENCE_LIMIT_COUNT = 64
REFERENCE_LIMIT_BYTES = 256*1024**2
GUIDE_CACHE_LIMIT_COUNT = 8
GUIDE_CACHE_LIMIT_BYTES = 512*1024**2
GUIDE_CACHE_TTL = 7*24*3600
TOOL_DIGESTS = {}
TOOL_DIGEST_LOCK = threading.Lock()


class VideoError(ValueError):
    pass


class VideoCanceled(VideoError):
    pass


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name('.' + path.name + '.' + uuid.uuid4().hex + '.tmp')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def regular_path(path):
    """Reject symlinks in the file and every existing ancestor before reading."""
    path = Path(path)
    if not path.is_absolute():
        raise VideoError('파일 경로가 올바르지 않습니다.')
    for component in (path, *path.parents):
        if component.is_symlink():
            raise VideoError('심볼릭 링크 파일은 사용할 수 없습니다.')
    try:
        info = path.stat()
    except OSError as exc:
        raise VideoError('선택한 파일을 찾을 수 없습니다. 다시 선택해 주세요.') from exc
    if not stat.S_ISREG(info.st_mode):
        raise VideoError('일반 파일만 사용할 수 있습니다.')
    return info


class ResourceGate:
    """Shared image/video lease, with thread and cross-process exclusion."""
    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.Lock()
        self.orphan_check = None

    @contextmanager
    def hold(self, cancel):
        while not self.lock.acquire(timeout=.1):
            if cancel.is_set():
                raise VideoCanceled('GPU 대기를 취소했습니다.')
        stream = None
        try:
            if cancel.is_set():
                raise VideoCanceled('GPU 대기를 취소했습니다.')
            self.path.parent.mkdir(parents=True, exist_ok=True)
            stream = self.path.open('a+b')
            while True:
                try:
                    fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if cancel.wait(.1):
                        raise VideoCanceled('GPU 대기를 취소했습니다.')
            if self.orphan_check is not None:
                self.orphan_check()
            yield stream.fileno()
        finally:
            if stream is not None:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
                stream.close()
            self.lock.release()


def read_depth(path, expected_size):
    """Decode the hardened runner's bounded single-FLOAT Z / ZIP16 EXR part."""
    if Path(path).stat().st_size > 128 * 1024 * 1024:
        raise VideoError('깊이 프레임 크기 제한을 넘었습니다.')
    data = Path(path).read_bytes()
    try:
        if data[:4] != b'v/1\x01':
            raise ValueError('EXR signature')
        multipart = bool(struct.unpack_from('<I', data, 4)[0] & 0x1000)
        pos, parts = 8, []
        while True:
            attributes = {}
            while data[pos]:
                end = data.index(b'\0', pos, min(len(data), pos + 256))
                name = data[pos:end].decode()
                pos = end + 1
                end = data.index(b'\0', pos, min(len(data), pos + 256))
                pos = end + 1
                size = struct.unpack_from('<I', data, pos)[0]
                pos += 4
                if size > 1024 * 1024 or pos + size > len(data):
                    raise ValueError('attribute size')
                attributes[name] = data[pos:pos + size]
                pos += size
            pos += 1
            parts.append(attributes)
            if len(parts) > 16:
                raise ValueError('part count')
            if not multipart:
                break
            if not data[pos]:
                pos += 1
                break
        matches = []
        for index, part in enumerate(parts):
            value, cursor, channels = part['channels'], 0, []
            while value[cursor]:
                end = value.index(b'\0', cursor)
                channels.append((value[cursor:end].decode(), struct.unpack_from('<iB3xii', value, end + 1)))
                cursor = end + 17
            if len(channels) == 1 and channels[0][0].endswith('.Depth.Z'):
                if channels[0][1][0] != 2 or channels[0][1][2:] != (1, 1):
                    raise ValueError('Z channel type')
                matches.append(index)
        if len(matches) != 1:
            raise ValueError('unique Z channel')
        index = matches[0]
        part = parts[index]
        width, height = expected_size
        if struct.unpack('<iiii', part['dataWindow']) != (0, 0, width - 1, height - 1):
            raise ValueError('depth dimensions')
        if part['compression'] != b'\x03':
            raise ValueError('ZIP16 compression')
        counts = [struct.unpack('<I', item['chunkCount'])[0] if multipart else (height + 15)//16 for item in parts]
        if counts[index] != (height + 15)//16 or sum(counts) > 65536:
            raise ValueError('chunk count')
        offsets = struct.unpack_from('<' + 'Q'*counts[index], data, pos + 8*sum(counts[:index]))
        output = np.full((height, width), np.nan, dtype=np.float32)
        seen = set()
        for offset in offsets:
            if multipart:
                part_index, y, size = struct.unpack_from('<iii', data, offset)
                if part_index != index:
                    raise ValueError('part index')
                offset += 12
            else:
                y, size = struct.unpack_from('<ii', data, offset)
                offset += 8
            if y < 0 or y >= height or y % 16 or y in seen:
                raise ValueError('scanline position')
            seen.add(y)
            expected = min(16, height-y)*width*4
            if size < 0 or offset+size > len(data):
                raise ValueError('chunk size')
            payload = data[offset:offset+size]
            if len(payload) == expected:
                raw = payload
            else:
                decoder = zlib.decompressobj()
                shuffled = decoder.decompress(payload, expected+1)
                if len(shuffled) != expected or not decoder.eof or decoder.unused_data:
                    raise ValueError('ZIP payload length')
                delta = np.frombuffer(shuffled, dtype=np.uint8).astype(np.int64)
                delta[1:] -= 128
                decoded = (np.cumsum(delta) & 255).astype(np.uint8)
                raw_array = np.empty_like(decoded)
                half = (len(decoded)+1)//2
                raw_array[::2], raw_array[1::2] = decoded[:half], decoded[half:]
                raw = raw_array.tobytes()
            output[y:y+min(16,height-y)] = np.frombuffer(raw,dtype='<f4').reshape(-1,width)
        if not np.isfinite(output).all() or (output < 0).any():
            raise ValueError('invalid Z values')
        return output
    except (IndexError, KeyError, UnicodeError, struct.error, zlib.error, ValueError) as exc:
        raise VideoError('지원하지 않거나 손상된 깊이 EXR 프레임입니다.') from exc


def depth_range(arrays):
    """One padded visible range for the whole sequence; Blender infinity is black."""
    visible = [array[(array > 0) & (array < 1e9)] for array in arrays]
    visible = [array for array in visible if array.size]
    if not visible:
        raise VideoError('카메라에 보이는 깊이 정보가 없습니다.')
    low = min(float(array.min()) for array in visible)
    high = max(float(array.max()) for array in visible)
    padding = max((high-low)*.02, .01)
    return max(0.0,low-padding), high+padding


class VideoRuntime:
    def __init__(self, root, *, comfy_url='http://127.0.0.1:8188', gate=None):
        self.root = Path(root).absolute()
        self.directory = self.root / 'runtime/video'
        self.install = self.root / 'runtime/macos/ltx-video-mlx'
        self.wrapper = self.install / 'bin/ltx-2-mlx'
        self.python = self.install / 'venv/bin/python'
        self.ffmpeg = self.install / 'bin/ffmpeg'
        self.ffprobe = self.install / 'bin/ffprobe'
        self.model = self.root / 'models/video/ltx23-q8'
        self.gemma = self.root / 'models/video/gemma3-12b-4bit'
        self.lora = self.root / 'models/video/union/ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors'
        self.blender = Path('/Applications/Blender.app/Contents/MacOS/Blender')
        self.runner = self.root / 'scripts/pankeki_video_runner.py'
        self.comfy_url = comfy_url.rstrip('/')
        self.gate = gate or ResourceGate(self.directory / 'shared-gpu.lock')
        self.gate.orphan_check = self.check_live_orphans
        self.owned = {}
        self.owned_lock = threading.RLock()
        self.process_stop_lock = threading.Lock()
        self.storage_lock = threading.RLock()
        self.loaded_source_sha256 = {'pankeki/video_runtime.py':LOADED_SOURCE_SHA256,
            'pankeki/blender_video.py':BLENDER_LOADED_SHA,'pankeki/video_profiles.py':PROFILES_LOADED_SHA}

    def status(self):
        required = (self.wrapper,self.python,self.ffmpeg,self.ffprobe,self.runner,
                    self.model/'transformer-distilled.safetensors',self.gemma/'config.json',self.lora)
        missing = [path.name for path in required if not path.is_file()]
        blender = self.blender.is_file()
        ready = not missing and blender
        return {'ready':ready,'reason':None if ready else ('Blender를 설치해 주세요.' if not blender else '영상 런타임 또는 모델 파일을 찾을 수 없습니다.'),
                'model':{'id':MODEL_ID,'label':'LTX-2.3 q8 · 로컬 영상 미리보기'},
                'defaults':dict(DEFAULTS),'profiles':{name:dict(value) for name,value in PROFILES.items()},'blender_available':blender}

    def read_grant(self, scene_id):
        try:
            if not isinstance(scene_id,str) or str(uuid.UUID(scene_id)) != scene_id:
                raise ValueError('UUID')
        except (ValueError,AttributeError) as exc:
            raise VideoError('Blender 파일을 다시 선택해 주세요.') from exc
        path = self.directory / 'scene-grants' / (scene_id+'.json')
        info = regular_path(path)
        if stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 16384:
            raise VideoError('파일 선택 기록의 권한이나 크기가 올바르지 않습니다.')
        try:
            descriptor = os.open(path,os.O_RDONLY | getattr(os,'O_NOFOLLOW',0))
            with os.fdopen(descriptor,'r',encoding='utf-8') as stream:
                grant = json.load(stream)
            created = grant['created_at']
            if isinstance(created,str):
                parsed = datetime.fromisoformat(created.replace('Z','+00:00'))
                if parsed.tzinfo is None:
                    raise ValueError('UTC timestamp required')
                created = parsed.timestamp()
            if type(created) not in (int,float) or not math.isfinite(created) or not 0 <= time.time()-created <= GRANT_TTL:
                raise VideoError('파일 선택 기록이 만료되었습니다. 다시 선택해 주세요.')
            if type(grant['version']) is not int or grant['version'] != 1:
                raise ValueError('grant version')
            scene = Path(grant['scene_path'])
            scene_info = regular_path(scene)
            if scene.suffix.lower() != '.blend' or scene_info.st_size > 128*1024*1024:
                raise ValueError('scene type or size')
            if scene_info.st_size != grant['size'] or scene_info.st_mtime_ns != int(grant['mtime_ns']):
                raise VideoError('선택한 Blender 파일이 변경되었습니다. 다시 선택해 주세요.')
            digest = sha256(scene)
            if digest != grant['sha256']:
                raise VideoError('선택한 Blender 파일의 내용이 변경되었습니다. 다시 선택해 주세요.')
            return {'scene_path':str(scene),'scene_sha256':digest,'scene_id':scene_id,'scene_name':scene.name}
        except (KeyError,TypeError,ValueError,OSError,json.JSONDecodeError) as exc:
            if isinstance(exc,VideoError):
                raise
            raise VideoError('파일 선택 기록을 확인할 수 없습니다. Blender 파일을 다시 선택해 주세요.') from exc

    def storage_usage(self, namespace):
        """Prune only expired, flat, explicitly server-owned new artifacts."""
        base = self.directory/namespace
        if base.is_symlink():
            raise VideoError('영상 보관 경로를 확인하지 못했습니다.')
        if not base.exists():
            return 0,0
        count,total = 0,0
        allowed = {'manifest.json','source.png'} if namespace=='references' else {'manifest.json','guide.mp4','control-depth.mp4'}
        schema = 'pankeki.video-reference.v1' if namespace=='references' else 'pankeki.completed-guide.v1'
        ttl = GRANT_TTL if namespace=='references' else GUIDE_CACHE_TTL
        for directory in base.iterdir():
            owned_name = bool(re.fullmatch(r'[0-9a-f-]{36}',directory.name)) if namespace=='references' else bool(re.fullmatch(r'[0-9a-f]{64}|\.[0-9a-f]{32}\.pending',directory.name))
            if not owned_name or directory.is_symlink() or not directory.is_dir():
                continue
            files = list(directory.iterdir())
            safe = all(path.name in allowed and not path.is_symlink() and path.is_file() for path in files)
            expired = False
            if safe and (directory/'manifest.json').is_file():
                try:
                    manifest_path = directory/'manifest.json'
                    if manifest_path.stat().st_size <= 1024**2:
                        value = json.loads(manifest_path.read_text())
                        age = time.time()-value['created_at']
                        identity_ok = value.get('reference_id')==directory.name if namespace=='references' else value.get('cache_key')==directory.name or directory.name.startswith('.')
                        expired = value.get('owner')=='pankeki-video-runtime-v1' and value.get('schema')==schema and identity_ok and age>ttl
                except (OSError,KeyError,TypeError,ValueError):
                    pass
            if expired:
                # Never follows links or visits source scenes, runs, models or user files.
                for path in files:
                    path.unlink()
                directory.rmdir()
                continue
            count += 1
            total += sum(path.stat().st_size for path in files if path.is_file() and not path.is_symlink())
        return count,total

    def admit_storage(self, namespace, incoming_bytes):
        count,total = self.storage_usage(namespace)
        limit_count,limit_bytes = (REFERENCE_LIMIT_COUNT,REFERENCE_LIMIT_BYTES) if namespace=='references' else (GUIDE_CACHE_LIMIT_COUNT,GUIDE_CACHE_LIMIT_BYTES)
        if count>=limit_count or total+incoming_bytes>limit_bytes:
            raise VideoError('영상 참조 또는 구도 보관 한도에 도달했습니다. 만료된 임시 보관 항목이 정리된 뒤 다시 시도해 주세요.')

    @staticmethod
    def reference_uuid(value):
        try:
            if not isinstance(value,str) or str(uuid.UUID(value)) != value:
                raise ValueError('UUID')
        except (ValueError,AttributeError) as exc:
            raise VideoError('참조 이미지 식별자가 올바르지 않습니다.') from exc
        return value

    def create_reference(self, value):
        """Explicit upload only. Paths/URLs never cross this same-origin API."""
        allowed = {'image','project_id','epoch','candidate_id','source_revision'}
        if not isinstance(value,dict) or set(value) != allowed:
            raise VideoError('선택한 참조 이미지 요청이 올바르지 않습니다.')
        for key in ('project_id','candidate_id','source_revision'):
            if not isinstance(value[key],str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',value[key]):
                raise VideoError('참조 이미지의 프로젝트·후보·버전을 확인하지 못했습니다.')
        if type(value['epoch']) is not int or not 0 <= value['epoch'] <= 2**53-1:
            raise VideoError('참조 이미지 버전이 올바르지 않습니다.')
        encoded = value['image']
        prefix = 'data:image/png;base64,'
        if not isinstance(encoded,str) or not encoded.startswith(prefix) or len(encoded)-len(prefix) > 4*((12*1024**2+2)//3):
            raise VideoError('참조는 12MiB 이하 PNG 이미지여야 합니다.')
        try:
            raw = base64.b64decode(encoded[len(prefix):],validate=True)
            if not raw or len(raw) > 12*1024**2:
                raise ValueError('image size')
            with Image.open(io.BytesIO(raw)) as image:
                if image.format != 'PNG' or getattr(image,'n_frames',1) != 1:
                    raise ValueError('single PNG required')
                width,height = image.size
                if not 1 <= width <= 4096 or not 1 <= height <= 4096 or width*height > 4096**2:
                    raise ValueError('dimensions')
                image.verify()
            with Image.open(io.BytesIO(raw)) as image:
                image.load()
        except (ValueError,OSError,UnidentifiedImageError,Image.DecompressionBombError) as exc:
            raise VideoError('손상되었거나 너무 큰 PNG 참조 이미지입니다.') from exc
        with self.storage_lock:
            self.admit_storage('references',len(raw)+16384)
            reference_id = str(uuid.uuid4())
            directory = self.directory/'references'/reference_id
            for component in (directory.parent,*directory.parent.parents):
                if component.is_symlink():
                    raise VideoError('참조 이미지 저장 경로를 확인하지 못했습니다.')
            directory.mkdir(parents=True,exist_ok=False)
            manifest = {key:value[key] for key in ('project_id','epoch','candidate_id','source_revision')}
            manifest.update(schema='pankeki.video-reference.v1',owner='pankeki-video-runtime-v1',state='preparing',
                            reference_id=reference_id,created_at=time.time(),sha256=hashlib.sha256(raw).hexdigest(),
                            bytes=len(raw),width=width,height=height,source_binding='server_received_png_sha256',
                            candidate_binding='client_claim',source_revision_kind='client_page_counter')
            atomic_json(directory/'manifest.json',manifest)
            source = directory/'source.png'
            with source.open('xb') as stream:
                stream.write(raw)
            source.chmod(0o600)
            manifest['state'] = 'complete'
            atomic_json(directory/'manifest.json',manifest)
            return {key:manifest[key] for key in ('reference_id','sha256','width','height','candidate_id','source_revision')}

    def read_reference(self, reference_id, request=None):
        self.reference_uuid(reference_id)
        directory = self.directory/'references'/reference_id
        manifest_path,source = directory/'manifest.json',directory/'source.png'
        try:
            regular_path(manifest_path)
            regular_path(source)
            if manifest_path.stat().st_size > 16384 or source.stat().st_size > 12*1024**2:
                raise ValueError('size')
            value = json.loads(manifest_path.read_text())
            if (value.get('schema') != 'pankeki.video-reference.v1' or value.get('state') != 'complete' or value.get('reference_id') != reference_id
                    or request is not None and (value.get('project_id') != request['project_id'] or value.get('epoch') != request['epoch'])
                    or type(value.get('created_at')) not in (int,float)
                    or not 0 <= time.time()-value['created_at'] <= GRANT_TTL
                    or value.get('sha256') != sha256(source) or value.get('bytes') != source.stat().st_size):
                raise ValueError('reference changed or expired')
            with Image.open(source) as image:
                if image.format != 'PNG' or image.size != (value['width'],value['height']):
                    raise ValueError('reference PNG changed')
                image.verify()
            return value
        except (KeyError,TypeError,ValueError,OSError,UnidentifiedImageError) as exc:
            raise VideoError('참조 이미지가 변경되었거나 만료되었습니다. 현재 후보를 다시 선택해 주세요.') from exc

    def prepare_reference(self, request, directory):
        if 'reference_id' not in request:
            return None
        value = self.read_reference(request['reference_id'],request)
        frozen = request.get('reference')
        if not frozen or value != frozen:
            raise VideoError('대기 중 참조 이미지 기록이 변경되었습니다.')
        source = self.directory/'references'/request['reference_id']/'source.png'
        raw = source.read_bytes()
        if hashlib.sha256(raw).hexdigest() != value['sha256']:
            raise VideoError('참조 이미지 복사 중 내용이 변경되었습니다.')
        original = directory/'reference-original.png'
        with original.open('xb') as stream:
            stream.write(raw)
        width,height = request['width'],request['height']
        with Image.open(io.BytesIO(raw)) as image:
            rgba = image.convert('RGBA')
            # Neutral edge-derived canvas; contain retains every original pixel region.
            background = Image.new('RGB',rgba.size,(240,240,240))
            background.paste(rgba,mask=rgba.getchannel('A'))
            fitted = ImageOps.contain(background,(width,height),method=Image.Resampling.LANCZOS)
            color = background.getpixel((0,0))
            prepared = Image.new('RGB',(width,height),color)
            left,top = (width-fitted.width)//2,(height-fitted.height)//2
            prepared.paste(fitted,(left,top))
            prepared.save(directory/'reference.png',format='PNG')
        result = {'reference_id':request['reference_id'],'candidate_id':value['candidate_id'],
                  'source_revision':value['source_revision'],'source_revision_kind':'client_page_counter',
                  'candidate_binding':'client_claim','source_binding':'server_received_png_sha256','original_sha256':value['sha256'],
                  'prepared_sha256':sha256(directory/'reference.png'),'fit':'contain',
                  'original_size':[value['width'],value['height']],'prepared_size':[width,height],
                  'content_bounds':[left,top,left+fitted.width,top+fitted.height],
                  'frame':0,'strength':1.0,'binding':'replace','crf':0}
        atomic_json(directory/'reference-verification.json',result)
        return result

    def binary_identity(self, configured):
        """Configured tool symlinks are allowed; identify their actual executable bytes."""
        try:
            path = Path(configured).resolve(strict=True)
            regular_path(path)
            info = path.stat()
            metadata = (str(path),info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns,info.st_ctime_ns)
            with TOOL_DIGEST_LOCK:
                digest = TOOL_DIGESTS.get(metadata)
                if digest is None:
                    digest = sha256(path)
                    after = path.stat()
                    if (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns) != metadata[1:]:
                        return None
                    TOOL_DIGESTS[metadata] = digest
            return {'path':str(path),'device':info.st_dev,'inode':info.st_ino,'bytes':info.st_size,
                    'mtime_ns':info.st_mtime_ns,'ctime_ns':info.st_ctime_ns,'sha256':digest}
        except (OSError,ValueError):
            return None

    def guide_identity(self, request):
        try:
            helper = self.root/'scripts/blender_video_runner.py'
            regular_path(helper)
            helper_sha = sha256(helper)
            tools = {name:self.binary_identity(getattr(self,name)) for name in ('blender','ffmpeg','ffprobe')}
            if not all(tools.values()):
                return None
            profile = request.get('profile','preview')
            settings = video_profile(profile)
            return {'scene_sha256':request['scene_sha256'],'profile':profile,**settings,'start':1,'end':settings['frames'],
                    'loaded_source_sha256':dict(self.loaded_source_sha256),'renderer_helper_sha256':helper_sha,
                    'tools':tools,'depth_version':DEPTH_NORMALIZATION_VERSION}
        except (OSError,ValueError):
            return None

    def guide_cache_key(self, request, *, identity=None):
        identity = self.guide_identity(request) if identity is None else identity
        settings = video_profile(request.get('profile','preview'))
        if (not isinstance(identity,dict) or identity.get('scene_sha256') != request['scene_sha256']
                or identity.get('profile') != request.get('profile','preview')
                or identity.get('loaded_source_sha256') != self.loaded_source_sha256
                or any(identity.get(key) != value for key,value in settings.items())):
            return None
        return hashlib.sha256(json.dumps(identity,sort_keys=True,separators=(',',':')).encode()).hexdigest()

    def _cache_canceled(self, cancel):
        if cancel.is_set():
            raise VideoCanceled('구도 준비를 취소했습니다.')

    def publish_guide_cache(self, directory, cancel, *, commit=None):
        """Only a successfully committed owning job may publish its guide."""
        self._cache_canceled(cancel)
        try:
            if directory.parent != self.directory/'runs' or not re.fullmatch('[0-9a-f]{32}',directory.name):
                return False
            for path in (directory/'complete.json',directory/'request.json',directory/'guide-verification.json',
                         self.directory/'jobs'/(directory.name+'.json')):
                regular_path(path)
                if path.stat().st_size > 1024**2:
                    return False
            complete = json.loads((directory/'complete.json').read_text())
            journal = json.loads((self.directory/'jobs'/(directory.name+'.json')).read_text())
            request = json.loads((directory/'request.json').read_text())
            verification = json.loads((directory/'guide-verification.json').read_text())
            identity = verification.get('cache_identity')
            key = self.guide_cache_key(request,identity=identity) if identity else None
            if (not key or complete.get('job_id') != directory.name or journal.get('id') != directory.name
                    or journal.get('status') != 'succeeded' or verification.get('cache_key') != key
                    or verification.get('scene_sha256') != request['scene_sha256']):
                return False
            profile = request.get('profile','preview')
            for name,part in (('guide.mp4','guide'),('control-depth.mp4','control')):
                regular_path(directory/name)
                if self.verify_mp4(directory/name,silent=True,profile=profile)['sha256'] != verification[part]['sha256']:
                    return False
            cache = self.directory/'guide-cache'
            if cache.is_symlink():
                return False
            cache.mkdir(exist_ok=True)
            target = cache/key
            if target.exists() or target.is_symlink():
                return False
            self.admit_storage('guide-cache',sum((directory/name).stat().st_size for name in ('guide.mp4','control-depth.mp4'))+16384)
            temporary = cache/('.'+uuid.uuid4().hex+'.pending')
            temporary.mkdir()
            try:
                manifest = {'schema':'pankeki.completed-guide.v1','cache_key':key,'source_job_id':directory.name,
                            'profile':profile,'scene_sha256':request['scene_sha256'],'cache_identity':identity,'verification':verification,'ai_generated':False,
                            'owner':'pankeki-video-runtime-v1','created_at':time.time(),'state':'preparing'}
                atomic_json(temporary/'manifest.json',manifest)
                for name,part in (('guide.mp4','guide'),('control-depth.mp4','control')):
                    self._cache_canceled(cancel)
                    shutil.copyfile(directory/name,temporary/name)
                    if sha256(temporary/name) != verification[part]['sha256']:
                        return False
                manifest['state'] = 'complete'
                atomic_json(temporary/'manifest.json',manifest)
                self._cache_canceled(cancel)
                def publish():
                    os.replace(temporary,target)
                if commit is not None:
                    if not commit(publish):
                        return False
                else:
                    current = json.loads((self.directory/'jobs'/(directory.name+'.json')).read_text())
                    if current.get('status') != 'succeeded':
                        return False
                    publish()
            finally:
                if temporary.exists():
                    shutil.rmtree(temporary)
            return True
        except VideoCanceled:
            raise
        except (OSError,ValueError,KeyError,TypeError,subprocess.SubprocessError):
            return False

    def restore_guide_cache(self, request, directory, cancel, *, identity=None):
        self._cache_canceled(cancel)
        key = self.guide_cache_key(request,identity=identity)
        if not key:
            return False
        cache = self.directory/'guide-cache'/key
        try:
            manifest_path = cache/'manifest.json'
            regular_path(manifest_path)
            if manifest_path.stat().st_size > 1024**2:
                return False
            manifest = json.loads(manifest_path.read_text())
            source_id = manifest.get('source_job_id')
            if (manifest.get('schema') != 'pankeki.completed-guide.v1' or manifest.get('state') != 'complete' or manifest.get('cache_key') != key
                    or type(manifest.get('created_at')) not in (int,float) or not 0<=time.time()-manifest['created_at']<=GUIDE_CACHE_TTL
                    or manifest.get('scene_sha256') != request['scene_sha256'] or manifest.get('profile') != request.get('profile','preview') or manifest.get('ai_generated') is not False
                    or not isinstance(source_id,str) or not re.fullmatch('[0-9a-f]{32}',source_id)):
                return False
            journal_path = self.directory/'jobs'/(source_id+'.json')
            complete_path = self.directory/'runs'/source_id/'complete.json'
            regular_path(journal_path); regular_path(complete_path)
            source_request_path = self.directory/'runs'/source_id/'request.json'
            regular_path(source_request_path)
            if any(path.stat().st_size > 1024**2 for path in (journal_path,complete_path,source_request_path)):
                return False
            complete = json.loads(complete_path.read_text())
            source_request = json.loads(source_request_path.read_text())
            journal = json.loads(journal_path.read_text())
            if journal.get('id') != source_id or journal.get('status') != 'succeeded' or complete.get('job_id') != source_id or self.guide_cache_key(source_request,identity=manifest.get('cache_identity')) != key:
                return False
            verification = manifest['verification']
            if not manifest.get('cache_identity') or self.guide_cache_key(request,identity=manifest['cache_identity']) != key:
                return False
            if verification.get('scene_sha256') != request['scene_sha256'] or verification.get('cache_key') != key or verification.get('profile') != request.get('profile','preview'):
                return False
            profile = request.get('profile','preview')
            for name,part in (('guide.mp4','guide'),('control-depth.mp4','control')):
                self._cache_canceled(cancel)
                path = cache/name
                regular_path(path)
                if path.stat().st_size > 128*1024**2 or sha256(path) != verification[part]['sha256']:
                    return False
                metadata = self.verify_mp4(path,silent=True,profile=profile)
                if metadata['sha256'] != verification[part]['sha256']:
                    return False
            self._cache_canceled(cancel)
            for name,part in (('guide.mp4','guide'),('control-depth.mp4','control')):
                shutil.copyfile(cache/name,directory/name)
                if sha256(directory/name) != verification[part]['sha256']:
                    raise VideoError('재사용한 구도 파일의 무결성을 확인하지 못했습니다.')
            atomic_json(directory/'guide-verification.json',verification)
            return {'hit':True,'cache_key':key,'source_job_id':source_id,'ai_generated':False}
        except VideoCanceled:
            raise
        except (OSError,ValueError,KeyError,TypeError,subprocess.SubprocessError):
            return False

    def normalize_request(self, value):
        """Validate transport fields without consulting a mutable scene grant."""
        allowed = {'scene_id','project_id','epoch','prompt','seed','profile','reference_id'}
        if not isinstance(value,dict) or set(value)-allowed:
            raise VideoError('지원하지 않는 영상 요청입니다.')
        project = value.get('project_id')
        epoch = value.get('epoch')
        prompt = value.get('prompt')
        seed = value.get('seed',42)
        if not isinstance(project,str) or not 1 <= len(project) <= 128 or not project.strip():
            raise VideoError('프로젝트 식별자가 필요합니다.')
        if type(epoch) is not int or not 0 <= epoch <= 2**53-1:
            raise VideoError('프로젝트 버전이 올바르지 않습니다.')
        if not isinstance(prompt,str) or not prompt.strip() or len(prompt) > 2000:
            raise VideoError('촬영 의도를 1~2000자로 적어 주세요.')
        if type(seed) is not int or not 0 <= seed <= 2**32-1:
            raise VideoError('영상 seed가 올바르지 않습니다.')
        scene_id = value.get('scene_id')
        try:
            if not isinstance(scene_id,str) or str(uuid.UUID(scene_id)) != scene_id:
                raise ValueError('UUID')
        except (ValueError,AttributeError) as exc:
            raise VideoError('Blender 파일을 다시 선택해 주세요.') from exc
        try:
            profile = value.get('profile','preview')
            video_profile(profile)
        except ValueError as exc:
            raise VideoError(str(exc)) from exc
        normalized = {'scene_id':scene_id,'project_id':project,'epoch':epoch,'prompt':prompt.strip(),'seed':seed}
        # Preserve pre-profile request digests, including explicit preview.
        if profile != 'preview':
            normalized['profile'] = profile
        if 'reference_id' in value:
            self.reference_uuid(value['reference_id'])
            normalized['reference_id'] = value['reference_id']
        return normalized

    def validate_request(self, value):
        request = self.normalize_request(value)
        frozen = {**self.read_grant(request['scene_id']),**request,**video_profile(request.get('profile','preview'))}
        if 'reference_id' in request:
            reference = self.read_reference(request['reference_id'],request)
            frozen['reference'] = reference
        return frozen

    def cancel(self, job_id):
        with self.owned_lock:
            owned = self.owned.get(job_id)
        if isinstance(owned,BlenderGuideJob):
            owned.cancel()
        elif owned is not None:
            self.stop_process(owned)

    def stop_process(self, process):
        # UI cancellation and the worker's finally can arrive together.
        with self.process_stop_lock:
            if process.poll() is not None:
                return
            try:
                os.killpg(process.pid,signal.SIGTERM)
            except PermissionError:
                # Some managed hosts disallow killpg even for an owned group.
                process.terminate()
            except ProcessLookupError:
                return
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid,signal.SIGKILL)
                except PermissionError:
                    process.kill()
                except ProcessLookupError:
                    return
                process.wait(timeout=3)

    def comfy_queue(self):
        try:
            with urllib.request.urlopen(self.comfy_url+'/queue',timeout=2) as response:
                value = json.loads(response.read(1024*1024))
            if not isinstance(value.get('queue_running'),list) or not isinstance(value.get('queue_pending'),list):
                raise VideoError('이미지 작업 대기열을 확인할 수 없습니다.')
            return len(value['queue_running']) + len(value['queue_pending'])
        except urllib.error.URLError as exc:
            if isinstance(exc.reason,ConnectionRefusedError) or getattr(exc.reason,'errno',None) == errno.ECONNREFUSED:
                return 0
            raise VideoError('이미지 서버 상태를 확인할 수 없습니다.') from exc
        except (ValueError,KeyError) as exc:
            raise VideoError('이미지 작업 대기열을 확인할 수 없습니다.') from exc

    def run_process(self, command, directory, logfile, cancel, *, update=None, watch_comfy=False, watch_memory=False, timeout=1800, inherited_fds=()):
        if cancel.is_set():
            raise VideoCanceled('영상 생성을 취소했습니다.')
        logpath = directory/logfile
        began = time.monotonic()
        with logpath.open('wb') as log:
            process = subprocess.Popen(command,stdout=log,stderr=subprocess.STDOUT,shell=False,start_new_session=True,pass_fds=inherited_fds)
            with self.owned_lock:
                self.owned[directory.name] = process
            last_watch, last_progress = 0, None
            last_memory, bad_memory_samples = began, 0
            try:
                if watch_comfy:
                    start_token = self.process_start_token(process.pid)
                    atomic_json(directory/'process.json',{'pid':process.pid,'start_token':start_token,
                                'created_at':time.time(),'state':'running','inherited_gpu_lease':bool(inherited_fds)})
                    if update:
                        update(process_pid=process.pid,process_start_token=start_token)
                while process.poll() is None:
                    if cancel.wait(.1):
                        raise VideoCanceled('영상 생성을 취소했습니다.')
                    if time.monotonic()-began > timeout:
                        raise VideoError('영상 작업 제한 시간을 넘었습니다. 결과를 확정하지 않았습니다.')
                    if watch_comfy and time.monotonic()-last_watch >= 2:
                        last_watch = time.monotonic()
                        if self.comfy_queue():
                            raise VideoError('외부 이미지 작업이 시작되어 영상 생성을 중단했습니다. 이미지 작업 후 다시 시도해 주세요.')
                    if watch_memory and time.monotonic()-last_memory >= 10:
                        sample = self.memory_sample(directory,pressure=True,cancel=cancel)
                        bad_memory_samples = self.check_memory_guard(sample,bad_memory_samples)
                        last_memory = time.monotonic()
                    if update:
                        content = logpath.read_bytes()[-256*1024:].decode('utf-8',errors='replace')
                        steps = re.findall(r'Denoising:\s+\d+%[^\r\n]*?\|\s*(\d+)/(\d+)',content)
                        if steps:
                            done,total = map(int,steps[-1])
                            if (done,total) != last_progress:
                                last_progress = done,total
                                update(phase='denoising',progress=done/total if total else None)
                        if '[Decoding video + audio + muxing]' in content:
                            update(phase='encoding',progress=None)
                if cancel.is_set():
                    raise VideoCanceled('영상 생성을 취소했습니다.')
                if process.returncode:
                    raise VideoError(f'영상 엔진이 종료되었습니다 (exit {process.returncode}). 작업 로그를 보존했습니다.')
            finally:
                self.stop_process(process)
                if watch_comfy:
                    atomic_json(directory/'process.json',{'pid':process.pid,'state':'exited','exit_code':process.returncode,
                                'exited_at':time.time()})
                with self.owned_lock:
                    self.owned.pop(directory.name,None)

    @staticmethod
    def process_start_token(pid):
        try:
            result = subprocess.run(['/bin/ps','-p',str(pid),'-o','lstart='],capture_output=True,text=True,timeout=5)
            return result.stdout.strip() if result.returncode==0 else None
        except (OSError,subprocess.TimeoutExpired):
            return None

    def check_live_orphans(self):
        for path in (self.directory/'runs').glob('*/process.json'):
            if not re.fullmatch('[0-9a-f]{32}',path.parent.name):
                continue
            regular_path(path)
            value = json.loads(path.read_text())
            if value.get('state') != 'running':
                continue
            pid = value.get('pid')
            if type(pid) is not int or pid <= 1:
                raise VideoError('이전 영상 프로세스 기록을 확인할 수 없습니다.')
            try:
                os.kill(pid,0)
            except ProcessLookupError:
                continue
            except PermissionError:
                raise VideoError('이전 영상 프로세스의 종료를 확인할 수 없습니다.')
            token = self.process_start_token(pid)
            if token and value.get('start_token') and token != value['start_token']:
                continue  # PID has been reused; it is not our recorded process.
            raise VideoError('이전 서버의 영상 프로세스가 아직 실행 중입니다. 종료를 기다린 뒤 다시 시도해 주세요.')

    def probe_command(self, command, *, cancel=None, timeout=10):
        """A short owned diagnostic child; cancel remains observable every 100ms."""
        cancel = cancel if cancel is not None else threading.Event()
        if cancel.is_set():
            raise VideoCanceled('메모리 확인을 취소했습니다.')
        began = time.monotonic()
        process = subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
        try:
            while True:
                if cancel.is_set():
                    raise VideoCanceled('메모리 확인을 취소했습니다.')
                remaining = timeout-(time.monotonic()-began)
                if remaining <= 0:
                    raise VideoError('메모리 상태 확인 시간이 초과되어 영상 작업을 중단했습니다.')
                try:
                    stdout,stderr = process.communicate(timeout=min(.1,remaining))
                    return subprocess.CompletedProcess(command,process.returncode,stdout,stderr)
                except subprocess.TimeoutExpired:
                    continue
        finally:
            self.stop_process(process)
            if process.stdout:
                process.stdout.close()
            if process.stderr:
                process.stderr.close()

    def memory_sample(self, directory, *, pressure=False, cancel=None):
        result = self.probe_command(['/usr/bin/memory_pressure','-Q'],cancel=cancel,timeout=10)
        total = re.search(r'The system has (\d+)',result.stdout)
        percent = re.search(r'System-wide memory free percentage:\s*(\d+)%',result.stdout)
        if result.returncode or not total or not percent or not 0 <= int(percent[1]) <= 100:
            raise VideoError('사용 가능한 메모리를 확인하지 못했습니다. 다른 작업을 마친 뒤 다시 시도해 주세요.')
        record = {'source':'/usr/bin/memory_pressure -Q','checked_at':time.time(),'total_memory_bytes':int(total[1]),
                  'reported_free_percent':int(percent[1]),'available_estimate_bytes':int(total[1])*int(percent[1])//100,'raw':result.stdout}
        if pressure:
            observed = self.probe_command(['/usr/sbin/sysctl','-n','kern.memorystatus_vm_pressure_level'],cancel=cancel,timeout=5)
            if observed.returncode or observed.stdout.strip() not in ('1','2','4'):
                raise VideoError('메모리 압력을 확인하지 못해 전신 영상 생성을 중단했습니다.')
            record['pressure_level'] = int(observed.stdout.strip())
            with (directory/'memory-monitor.jsonl').open('a',encoding='utf-8') as stream:
                stream.write(json.dumps(record,ensure_ascii=False)+'\n')
        return record

    @staticmethod
    def check_memory_guard(record, bad_samples):
        if record['pressure_level'] >= 4:
            raise VideoError('메모리 압력이 높아 이 영상 작업을 중단했습니다.')
        bad = record['reported_free_percent'] < 25 or record['pressure_level'] != 1
        bad_samples = bad_samples+1 if bad else 0
        if bad_samples >= 3:
            raise VideoError('여유 메모리가 지속해서 부족해 이 영상 작업을 중단했습니다.')
        return bad_samples

    def memory_preflight(self, directory, *, profile='preview', cancel=None):
        record = self.memory_sample(directory,pressure=profile=='fullbody',cancel=cancel)
        record['minimum_available_bytes'] = (24 if profile=='fullbody' else 10)*1024**3
        atomic_json(directory/'memory-preflight.json',record)
        if record['available_estimate_bytes'] < record['minimum_available_bytes'] or profile=='fullbody' and record['pressure_level'] != 1:
            raise VideoError(f'영상 생성에 필요한 여유 메모리 {record["minimum_available_bytes"]//1024**3}GiB와 정상 압력을 확인해 주세요.')
        return record

    def verify_mp4(self, path, *, silent=False, profile='preview'):
        expected = video_profile(profile)
        regular_path(path)
        command = [str(self.ffprobe),'-v','error','-count_frames','-show_streams','-show_format','-of','json',str(path)]
        result = subprocess.run(command,capture_output=True,timeout=60,check=True)
        probe = json.loads(result.stdout)
        videos = [stream for stream in probe['streams'] if stream['codec_type']=='video']
        audios = [stream for stream in probe['streams'] if stream['codec_type']=='audio']
        if len(videos) != 1 or (silent and audios):
            raise VideoError('영상 트랙을 확인하지 못했습니다.')
        video = videos[0]
        fps = video.get('avg_frame_rate',video.get('r_frame_rate','0/1'))
        numerator,denominator = map(int,fps.split('/'))
        if (video.get('codec_name') != 'h264' or video.get('width') != expected['width'] or video.get('height') != expected['height']
                or int(video.get('nb_read_frames',0)) != expected['frames'] or numerator/denominator != expected['fps']):
            raise VideoError('결과 영상의 크기·프레임 수·속도가 요청과 다릅니다.')
        duration = float(probe['format']['duration'])
        if abs(duration-expected['frames']/expected['fps']) > .05:
            raise VideoError('결과 영상의 길이가 요청과 다릅니다.')
        decoded = subprocess.run([str(self.ffmpeg),'-nostdin','-v','error','-i',str(path),'-map','0:v:0','-f','null','-'],capture_output=True,timeout=60)
        if decoded.returncode:
            raise VideoError('결과 영상 전체를 읽지 못했습니다.')
        return {'width':video['width'],'height':video['height'],'frames':int(video['nb_read_frames']),
                'fps':numerator/denominator,'duration_seconds':duration,'video_codec':'h264','audio_streams':len(audios),
                'sha256':sha256(path),'bytes':path.stat().st_size,'full_decode_verified':True}

    def prepare_guide(self, request, directory, cancel, update):
        """A verified guide is preparation data, never a generated AI result."""
        name = request.get('profile','preview')
        settings = video_profile(name)
        current = self.read_grant(request['scene_id'])
        if current['scene_sha256'] != request['scene_sha256']:
            raise VideoError('대기 중 Blender 파일이 변경되었습니다. 다시 선택해 주세요.')
        update(phase='preparing_guide',progress=None)
        identity = self.guide_identity(request)
        frozen_key = self.guide_cache_key(request,identity=identity) if identity else None
        cached = self.restore_guide_cache(request,directory,cancel,identity=identity)
        if cached:
            verification = json.loads((directory/'guide-verification.json').read_text())
            return verification,cached
        guide = BlenderGuideJob(GuideRequest(Path(request['scene_path']),request['project_id'],request['epoch'],
                                start=1,end=settings['frames'],fps=settings['fps'],width=settings['width'],height=settings['height']),
                                directory/'guide',blender=self.blender,ffmpeg=self.ffmpeg,timeout=600)
        guide.prepare()
        if identity:
            helper_bytes = (self.root/'scripts/blender_video_runner.py').read_bytes()
            if hashlib.sha256(helper_bytes).hexdigest() != identity['renderer_helper_sha256']:
                raise VideoError('렌더 준비 중 helper 소스가 변경되었습니다.')
            snapshot = directory/'guide/renderer-snapshot.py'
            snapshot.write_bytes(helper_bytes)
            guide.runner = snapshot
        if sha256(directory/'guide/scene.blend') != request['scene_sha256']:
            raise VideoError('Blender 장면 복사본의 무결성을 확인하지 못했습니다.')
        with self.owned_lock:
            self.owned[directory.name] = guide
        try:
            if cancel.is_set():
                guide.cancel()
            guide_manifest = guide.run()
        except Exception as exc:
            if cancel.is_set():
                raise VideoCanceled('구도 렌더링을 취소했습니다.') from exc
            raise VideoError(str(exc)) from exc
        finally:
            with self.owned_lock:
                self.owned.pop(directory.name,None)
        self._cache_canceled(cancel)
        shutil.copyfile(directory/'guide/guide.mp4',directory/'guide.mp4')
        guide_metadata = self.verify_mp4(directory/'guide.mp4',silent=True,profile=name)
        size = (settings['width'],settings['height'])
        # Scan range without retaining 241 full float EXRs in memory.
        near,far = math.inf,-math.inf
        for frame in range(1,settings['frames']+1):
            self._cache_canceled(cancel)
            array = read_depth(directory/'guide/depth'/f'{frame:06d}.exr',size)
            visible = array[(array>0)&(array<1e9)]
            if visible.size:
                near,far = min(near,float(visible.min())),max(far,float(visible.max()))
        if not math.isfinite(near) or not math.isfinite(far):
            raise VideoError('카메라에 보이는 깊이 정보가 없습니다.')
        padding = max((far-near)*.02,.01)
        near,far = max(0.0,near-padding),far+padding
        depth = directory/'depth-png'
        depth.mkdir()
        for frame in range(1,settings['frames']+1):
            self._cache_canceled(cancel)
            array = read_depth(directory/'guide/depth'/f'{frame:06d}.exr',size)
            pixels = np.rint(np.clip((far-array)/(far-near),0,1)*255).astype(np.uint8)
            Image.fromarray(np.repeat(pixels[:,:,None],3,axis=2)).save(depth/f'{frame:06d}.png')
        normalization = {'near':near,'far':far,'units':'Blender scene units','formula':'clip((far-Z)/(far-near),0,1)',
                         'version':DEPTH_NORMALIZATION_VERSION,'policy':'sequence visible min/max with 2 percent or 0.01 padding; Z>=1e9 excluded',
                         'per_frame_auto_normalization':False,'background_threshold':1e9,
                         'camera_clip_start':guide_manifest.get('camera_clip_start'),'camera_clip_end':guide_manifest.get('camera_clip_end')}
        atomic_json(directory/'depth-normalization.json',normalization)
        self.run_process([str(self.ffmpeg),'-nostdin','-v','error','-n','-framerate',str(settings['fps']),'-start_number','1','-i',str(depth/'%06d.png'),
                          '-frames:v',str(settings['frames']),'-c:v','libx264','-crf','0','-pix_fmt','yuv420p',str(directory/'control-depth.mp4')],
                          directory,'depth-encode.log',cancel,timeout=60)
        control = self.verify_mp4(directory/'control-depth.mp4',silent=True,profile=name)
        if identity and sha256(guide.runner) != identity['renderer_helper_sha256']:
            raise VideoError('실행한 렌더 helper snapshot이 변경되었습니다.')
        if identity and any(self.binary_identity(getattr(self,name)) != value for name,value in identity['tools'].items()):
            raise VideoError('구도 렌더 중 실행 도구가 변경되었습니다. 결과를 재사용하지 않습니다.')
        key = frozen_key
        verification = {'guide':guide_metadata,'control':control,'normalization':normalization,'profile':name,'cache_key':key,'cache_identity':identity,
                        'scene_sha256':request['scene_sha256'],'ai_generated':False}
        atomic_json(directory/'guide-verification.json',verification)
        return verification,{'hit':False,'cache_key':key,'ai_generated':False}

    def run(self, request, directory, cancel, update):
        status = self.status()
        if not status['ready']:
            raise VideoError(status['reason'])
        profile = request.get('profile','preview')
        settings = video_profile(profile)
        if any(request.get(key) != value for key,value in settings.items()):
            raise VideoError('영상 프로필의 실행 값이 변경되었습니다.')
        began = phase_started = time.monotonic()
        timings = {}
        def finish_phase(name):
            nonlocal phase_started
            now = time.monotonic()
            timings[name] = round(now-phase_started,6)
            phase_started = now
            atomic_json(directory/'phase-timings.json',{'clock':'monotonic wall','phase_timings_s':timings,'elapsed_s':round(now-began,6)})
            update(phase_timings_s=dict(timings))
        reference = self.prepare_reference(request,directory)
        finish_phase('reference_prepare')
        guide,cache = self.prepare_guide(request,directory,cancel,update)
        finish_phase('guide_prepare')
        update(phase='waiting_gpu',progress=None,guide_url=f'/api/video/assets/{directory.name}/guide.mp4',guide_cache=cache)
        with self.gate.hold(cancel) as lease_fd:
            while self.comfy_queue():
                if cancel.wait(1):
                    raise VideoCanceled('GPU 대기를 취소했습니다.')
            finish_phase('gpu_lease_and_queue_wait')
            update(phase='checking_memory',progress=None)
            self.memory_preflight(directory,profile=profile,cancel=cancel)
            finish_phase('memory_preflight')
            execution = {'schema':'pankeki.video-execution.v1','root':str(self.root),'prompt':request['prompt'],'seed':request['seed'],
                         'control_sha256':guide['control']['sha256'],'scene_sha256':request['scene_sha256'],**settings}
            if profile != 'preview':
                execution['profile'] = profile
            if reference:
                execution['reference'] = reference
            atomic_json(directory/'ltx-request.json',execution)
            command = [str(self.python),str(self.runner),str(directory/'ltx-request.json')]
            atomic_json(directory/'execution.json',{'command':command,'model_id':MODEL_ID,'profile':profile,'reference':reference,
                                                 'auto_retry':False,'ai_generated':False})
            update(phase='loading',progress=None)
            self.run_process(command,directory,'inference.log',cancel,update=update,watch_comfy=True,watch_memory=profile=='fullbody',inherited_fds=(lease_fd,))
            finish_phase('engine_load_denoise_decode_mux')
            update(phase='verifying',progress=None)
            self.run_process([str(self.ffmpeg),'-nostdin','-v','error','-n','-i',str(directory/'raw.mp4'),'-map','0:v:0','-c:v','copy','-an',
                              '-movflags','+faststart',str(directory/'result.pending.mp4')],directory,'silent-remux.log',cancel,timeout=60)
            raw = self.verify_mp4(directory/'raw.mp4',profile=profile)
            metadata = self.verify_mp4(directory/'result.pending.mp4',silent=True,profile=profile)
            finish_phase('result_verify')
        log = (directory/'inference.log').read_text(errors='replace')
        if not re.search(r'Denoising:\s+100%[^\r\n]*\|\s*8/8',log) or '[Loading transformer' not in log:
            raise VideoError('실제 모델 로드와 8단계 추론 완료 기록을 확인하지 못했습니다.')
        metadata.update(ai_generated=True,model_id=MODEL_ID,profile=profile,seed=request['seed'],steps=settings['steps'],denoising_steps_completed=settings['steps'],
                        scene_sha256=request['scene_sha256'],control_sha256=guide['control']['sha256'],guide_sha256=guide['guide']['sha256'],
                        generated_audio_jointly=True,raw_sha256=raw['sha256'],normalization=guide['normalization'],reference=reference,
                        guide_cache=cache,phase_timings_s=timings,
                        filename='Pankeki-video-'+directory.name[:8]+'.mp4',url=f'/api/video/assets/{directory.name}/result.mp4')
        atomic_json(directory/'verification.json',metadata)
        return metadata

"""Owned Blender-to-LTX execution. Guide renders are never AI results."""
from contextlib import contextmanager
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
from PIL import Image

from .blender_video import BlenderGuideJob, GuideRequest, sha256

DEFAULTS = {'width': 384, 'height': 256, 'frames': 49, 'fps': 24, 'steps': 8}
MODEL_ID = 'ltx-2.3-q8-union-mlx'
GRANT_TTL = 24 * 3600


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

    def status(self):
        required = (self.wrapper,self.python,self.ffmpeg,self.ffprobe,self.runner,
                    self.model/'transformer-distilled.safetensors',self.gemma/'config.json',self.lora)
        missing = [path.name for path in required if not path.is_file()]
        blender = self.blender.is_file()
        ready = not missing and blender
        return {'ready':ready,'reason':None if ready else ('Blender를 설치해 주세요.' if not blender else '영상 런타임 또는 모델 파일을 찾을 수 없습니다.'),
                'model':{'id':MODEL_ID,'label':'LTX-2.3 q8 · 로컬 영상 미리보기'},
                'defaults':dict(DEFAULTS),'blender_available':blender}

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

    def normalize_request(self, value):
        """Validate transport fields without consulting a mutable scene grant."""
        allowed = {'scene_id','project_id','epoch','prompt','seed'}
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
        return {'scene_id':scene_id,'project_id':project,'epoch':epoch,'prompt':prompt.strip(),'seed':seed}

    def validate_request(self, value):
        request = self.normalize_request(value)
        return {**self.read_grant(request['scene_id']),**request,**DEFAULTS}

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

    def run_process(self, command, directory, logfile, cancel, *, update=None, watch_comfy=False, timeout=1800, inherited_fds=()):
        if cancel.is_set():
            raise VideoCanceled('영상 생성을 취소했습니다.')
        logpath = directory/logfile
        began = time.monotonic()
        with logpath.open('wb') as log:
            process = subprocess.Popen(command,stdout=log,stderr=subprocess.STDOUT,shell=False,start_new_session=True,pass_fds=inherited_fds)
            with self.owned_lock:
                self.owned[directory.name] = process
            last_watch, last_progress = 0, None
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

    def memory_preflight(self, directory):
        result = subprocess.run(['/usr/bin/memory_pressure','-Q'],capture_output=True,text=True,timeout=10)
        total = re.search(r'The system has (\d+)',result.stdout)
        percent = re.search(r'System-wide memory free percentage:\s*(\d+)%',result.stdout)
        if result.returncode or not total or not percent:
            raise VideoError('사용 가능한 메모리를 확인하지 못했습니다. 다른 작업을 마친 뒤 다시 시도해 주세요.')
        available = int(total[1])*int(percent[1])//100
        record = {'source':'/usr/bin/memory_pressure -Q','checked_at':time.time(),
                  'total_memory_bytes':int(total[1]),'reported_free_percent':int(percent[1]),
                  'available_estimate_bytes':available,'minimum_available_bytes':10*1024**3,'raw':result.stdout}
        atomic_json(directory/'memory-preflight.json',record)
        if available < record['minimum_available_bytes']:
            raise VideoError('영상 생성에 필요한 여유 메모리 10GiB가 부족합니다. 다른 작업을 마친 뒤 다시 시도해 주세요.')
        return record

    def verify_mp4(self, path, *, silent=False):
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
        if (video.get('codec_name') != 'h264' or video.get('width') != DEFAULTS['width'] or video.get('height') != DEFAULTS['height']
                or int(video.get('nb_read_frames',0)) != DEFAULTS['frames'] or numerator/denominator != DEFAULTS['fps']):
            raise VideoError('결과 영상의 크기·프레임 수·속도가 요청과 다릅니다.')
        duration = float(probe['format']['duration'])
        if abs(duration-DEFAULTS['frames']/DEFAULTS['fps']) > .05:
            raise VideoError('결과 영상의 길이가 요청과 다릅니다.')
        decoded = subprocess.run([str(self.ffmpeg),'-nostdin','-v','error','-i',str(path),'-map','0:v:0','-f','null','-'],capture_output=True,timeout=60)
        if decoded.returncode:
            raise VideoError('결과 영상 전체를 읽지 못했습니다.')
        return {'width':video['width'],'height':video['height'],'frames':int(video['nb_read_frames']),
                'fps':numerator/denominator,'duration_seconds':duration,'video_codec':'h264','audio_streams':len(audios),
                'sha256':sha256(path),'bytes':path.stat().st_size,'full_decode_verified':True}

    def run(self, request, directory, cancel, update):
        status = self.status()
        if not status['ready']:
            raise VideoError(status['reason'])
        # Recheck the desktop grant after queue waiting, then verify the copy.
        current = self.read_grant(request['scene_id'])
        if current['scene_sha256'] != request['scene_sha256']:
            raise VideoError('대기 중 Blender 파일이 변경되었습니다. 다시 선택해 주세요.')
        update(phase='preparing_guide',progress=None)
        guide = BlenderGuideJob(GuideRequest(Path(request['scene_path']),request['project_id'],request['epoch'],
                                start=1,end=49,fps=24,width=384,height=256),directory/'guide',blender=self.blender,ffmpeg=self.ffmpeg,timeout=600)
        guide.prepare()
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
        shutil.copyfile(directory/'guide/guide.mp4',directory/'guide.mp4')
        guide_metadata = self.verify_mp4(directory/'guide.mp4',silent=True)
        arrays = [read_depth(directory/'guide/depth'/f'{frame:06d}.exr',(384,256)) for frame in range(1,50)]
        near,far = depth_range(arrays)
        depth = directory/'depth-png'
        depth.mkdir()
        for frame,array in enumerate(arrays,1):
            if cancel.is_set():
                raise VideoCanceled('구도 준비를 취소했습니다.')
            pixels = np.rint(np.clip((far-array)/(far-near),0,1)*255).astype(np.uint8)
            Image.fromarray(np.repeat(pixels[:,:,None],3,axis=2)).save(depth/f'{frame:06d}.png')
        normalization = {'near':near,'far':far,'units':'Blender scene units','formula':'clip((far-Z)/(far-near),0,1)',
                         'policy':'sequence visible min/max with 2 percent or 0.01 padding; Z>=1e9 excluded',
                         'per_frame_auto_normalization':False,'background_threshold':1e9,
                         'camera_clip_start':guide_manifest.get('camera_clip_start'),'camera_clip_end':guide_manifest.get('camera_clip_end')}
        atomic_json(directory/'depth-normalization.json',normalization)
        self.run_process([str(self.ffmpeg),'-nostdin','-v','error','-n','-framerate','24','-start_number','1','-i',str(depth/'%06d.png'),
                          '-frames:v','49','-c:v','libx264','-crf','0','-pix_fmt','yuv420p',str(directory/'control-depth.mp4')],directory,'depth-encode.log',cancel,timeout=60)
        control = self.verify_mp4(directory/'control-depth.mp4',silent=True)
        atomic_json(directory/'guide-verification.json',{'guide':guide_metadata,'control':control,'normalization':normalization,
                                                       'scene_sha256':request['scene_sha256'],'ai_generated':False})
        update(phase='waiting_gpu',progress=None,guide_url=f'/api/video/assets/{directory.name}/guide.mp4')
        with self.gate.hold(cancel) as lease_fd:
            while self.comfy_queue():
                if cancel.wait(1):
                    raise VideoCanceled('GPU 대기를 취소했습니다.')
            self.memory_preflight(directory)
            # No other Pankeki image job can submit until this lease is released.
            execution = {'schema':'pankeki.video-execution.v1','root':str(self.root),'prompt':request['prompt'],'seed':request['seed'],
                         'control_sha256':control['sha256'],'scene_sha256':request['scene_sha256'],**DEFAULTS}
            atomic_json(directory/'ltx-request.json',execution)
            command = [str(self.python),str(self.runner),str(directory/'ltx-request.json')]
            atomic_json(directory/'execution.json',{'command':command,'model_id':MODEL_ID,'auto_retry':False,'ai_generated':False})
            update(phase='loading',progress=None)
            self.run_process(command,directory,'inference.log',cancel,update=update,watch_comfy=True,inherited_fds=(lease_fd,))
            update(phase='verifying',progress=None)
            self.run_process([str(self.ffmpeg),'-nostdin','-v','error','-n','-i',str(directory/'raw.mp4'),'-map','0:v:0','-c:v','copy','-an',
                              '-movflags','+faststart',str(directory/'result.pending.mp4')],directory,'silent-remux.log',cancel,timeout=60)
            raw = self.verify_mp4(directory/'raw.mp4')
            metadata = self.verify_mp4(directory/'result.pending.mp4',silent=True)
        log = (directory/'inference.log').read_text(errors='replace')
        if not re.search(r'Denoising:\s+100%[^\r\n]*\|\s*8/8',log) or '[Loading transformer' not in log:
            raise VideoError('실제 모델 로드와 8단계 추론 완료 기록을 확인하지 못했습니다.')
        metadata.update(ai_generated=True,model_id=MODEL_ID,seed=request['seed'],steps=8,denoising_steps_completed=8,
                        scene_sha256=request['scene_sha256'],control_sha256=control['sha256'],guide_sha256=guide_metadata['sha256'],
                        generated_audio_jointly=True,raw_sha256=raw['sha256'],normalization=normalization,
                        filename='Pankeki-video-'+directory.name[:8]+'.mp4',url=f'/api/video/assets/{directory.name}/result.mp4')
        atomic_json(directory/'verification.json',metadata)
        return metadata

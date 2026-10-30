"""Independent Blender guide jobs. No image-job schema or AI inference is involved."""
from dataclasses import asdict, dataclass
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import struct
import threading
import time
import uuid
from PIL import Image


LOADED_SOURCE_SHA256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


class GuideError(RuntimeError):
    pass


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def exr_headers(path):
    """Read bounded per-part channels and pixel windows, without decoding pixels."""
    with Path(path).open('rb') as stream:
        data = stream.read(1024 * 1024)
    if len(data) < 8 or data[:4] != b'v/1\x01':
        raise GuideError('invalid EXR header')
    multipart = bool(struct.unpack_from('<I', data, 4)[0] & 0x1000)
    pos = 8
    parts = []
    try:
        while True:
            part = {'channels': []}
            while data[pos]:
                end = data.index(b'\0', pos)
                name = data[pos:end]
                pos = end + 1
                end = data.index(b'\0', pos)
                attribute_type = data[pos:end]
                pos = end + 1
                size = struct.unpack_from('<I', data, pos)[0]
                pos += 4
                end = pos + size
                if end > len(data):
                    raise GuideError('EXR header exceeds verification bound')
                if name == b'channels' and attribute_type == b'chlist':
                    cursor = pos
                    while cursor < end and data[cursor]:
                        stop = data.index(b'\0', cursor, end)
                        part['channels'].append(data[cursor:stop].decode('utf-8'))
                        cursor = stop + 17
                elif name in (b'dataWindow', b'displayWindow') and attribute_type == b'box2i':
                    if size != 16:
                        raise GuideError('invalid EXR pixel window')
                    part[name.decode()] = struct.unpack_from('<iiii', data, pos)
                pos = end
            pos += 1
            parts.append(part)
            if not multipart or not data[pos]:
                return parts
    except (IndexError, ValueError, struct.error, UnicodeDecodeError) as exc:
        raise GuideError('truncated or invalid EXR header') from exc


def exr_channels(path):
    return [channel for part in exr_headers(path) for channel in part['channels']]


@dataclass(frozen=True)
class GuideRequest:
    scene_path: Path
    project_id: str
    epoch: int
    start: int = 1
    end: int = 12
    fps: int = 12
    width: int = 512
    height: int = 288
    camera: str | None = None

    def validate(self):
        for name in ('epoch', 'start', 'end', 'fps', 'width', 'height'):
            if type(getattr(self, name)) is not int:
                raise GuideError(f'{name} must be an integer')
        if self.epoch < 0 or not self.project_id or len(self.project_id) > 128:
            raise GuideError('project_id and nonnegative epoch are required')
        if not 1 <= self.start <= self.end or self.end - self.start + 1 > 241:
            raise GuideError('frame range must contain 1..241 positive frames')
        if not 1 <= self.fps <= 30:
            raise GuideError('fps must be 1..30')
        if not (16 <= self.width <= 1280 and 16 <= self.height <= 720):
            raise GuideError('dimensions must be within 16..1280 × 16..720')
        if self.width % 2 or self.height % 2:
            raise GuideError('dimensions must be even for MP4')
        scene = Path(self.scene_path)
        if scene.suffix.lower() != '.blend' or not scene.is_file():
            raise GuideError('scene_path must be an existing .blend file')
        if self.camera is not None and (not isinstance(self.camera, str) or not self.camera):
            raise GuideError('camera must be a nonempty object name')


class BlenderGuideJob:
    """Synchronous bounded guide producer; caller owns orchestration and project epoch."""
    def __init__(self, request, output_dir, *, blender, ffmpeg=None, timeout=600):
        self.request = request
        self.output_dir = Path(output_dir).resolve()
        self.blender = Path(blender).resolve()
        self.ffmpeg = Path(ffmpeg).resolve() if ffmpeg else None
        self.timeout = timeout
        self.job_id = uuid.uuid4().hex
        self._cancel = threading.Event()
        self._lock = threading.Lock()
        self._process = None
        self._prepared = False
        self._completed = False
        self.runner = Path(__file__).resolve().parents[1] / 'scripts' / 'blender_video_runner.py'

    @property
    def active_pid(self):
        with self._lock:
            return self._process.pid if self._process else None

    def prepare(self):
        self.request.validate()
        if not self.blender.is_file():
            raise GuideError(f'Blender executable missing: {self.blender}')
        try:
            self.output_dir.mkdir(parents=True, exist_ok=False)
        except FileExistsError as exc:
            raise GuideError('output directory must be new; existing files are preserved') from exc
        shutil.copyfile(self.request.scene_path, self.output_dir / 'scene.blend')
        values = asdict(self.request)
        values.update(scene_path=str(self.output_dir / 'scene.blend'), output_dir=str(self.output_dir),
                      builtin_encode=self.ffmpeg is None)
        self._atomic_json('request.json', values)
        self._prepared = True

    def blender_command(self):
        # The fixed runner opens only our snapshot with use_scripts=False.
        return [str(self.blender), '--background', '--factory-startup', '--disable-autoexec',
                '--python-exit-code', '1', '--python', str(self.runner), '--',
                str(self.output_dir / 'request.json')]

    def _atomic_json(self, name, value):
        target = self.output_dir / name
        temporary = target.with_suffix(target.suffix + '.tmp')
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
        temporary.replace(target)

    def cancel(self):
        # Publication and accepted cancellation are linearized by this lock.
        with self._lock:
            if self._completed:
                return False
            self._cancel.set()
            if self._process is not None:
                self._stop(self._process)
            return True

    @staticmethod
    def _stop(process):
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()

    def _run_process(self, argv, logfile):
        if self._cancel.is_set():
            raise GuideError('job canceled')
        with (self.output_dir / logfile).open('wb') as log:
            with self._lock:
                if self._cancel.is_set():
                    raise GuideError('job canceled')
                process = subprocess.Popen(argv, stdout=log, stderr=subprocess.STDOUT, shell=False)
                self._process = process
            try:
                deadline = time.monotonic() + self.timeout
                while process.poll() is None:
                    if self._cancel.wait(.05) or time.monotonic() > deadline:
                        self._stop(process)
                        if self._cancel.is_set():
                            raise GuideError('job canceled')
                        raise GuideError(f'process timeout after {self.timeout}s; see {logfile}')
                if self._cancel.is_set():
                    raise GuideError('job canceled')
                if process.returncode:
                    raise GuideError(f'process exited {process.returncode}; see {logfile}')
                return process.returncode
            finally:
                self._stop(process)
                with self._lock:
                    self._process = None

    def verify_frames(self):
        frames = []
        for frame in range(self.request.start, self.request.end + 1):
            record = {'frame': frame}
            for kind, extension in (('rgb', 'png'), ('depth', 'exr')):
                path = self.output_dir / kind / f'{frame:06d}.{extension}'
                magic = b'\x89PNG\r\n\x1a\n' if kind == 'rgb' else b'\x76\x2f\x31\x01'
                if not path.is_file() or path.stat().st_size < 16:
                    raise GuideError(f'missing or empty {kind} frame {frame}')
                with path.open('rb') as stream:
                    if stream.read(len(magic)) != magic:
                        raise GuideError(f'invalid {kind} frame {frame}')
                if kind == 'rgb':
                    with Image.open(path) as image:
                        if image.size != (self.request.width, self.request.height):
                            raise GuideError(f'RGB dimensions mismatch in frame {frame}')
                        image.verify()
                else:
                    parts = exr_headers(path)
                    window = (0, 0, self.request.width - 1, self.request.height - 1)
                    if any(part.get(key) != window for part in parts for key in ('dataWindow', 'displayWindow')):
                        raise GuideError(f'EXR pixel window dimensions mismatch in frame {frame}')
                    if not any(channel.endswith('.Depth.Z') for part in parts for channel in part['channels']):
                        raise GuideError(f'depth Z pass missing in frame {frame}')
                record[kind] = {'path': str(path.relative_to(self.output_dir)), 'sha256': sha256(path)}
            frames.append(record)
        return frames

    def run(self):
        began = time.monotonic()
        if not self._prepared:
            self.prepare()
        manifest = {'schema': 'pankeki.video-guide.v1', 'job_id': self.job_id,
                    'project_id': self.request.project_id, 'epoch': self.request.epoch,
                    'kind': 'blender_guide_not_ai', 'ai_generated': False,
                    'scene_sha256': sha256(self.output_dir / 'scene.blend'),
                    'runner_sha256': sha256(self.runner), 'state': 'running'}
        self._atomic_json('status.json', manifest)
        try:
            self._run_process(self.blender_command(), 'blender.log')
            metadata = json.loads((self.output_dir / 'render-info.json').read_text())
            manifest.update(metadata)
            manifest['frames'] = self.verify_frames()
            if self.ffmpeg is not None and not self.ffmpeg.is_file():
                raise GuideError('ffmpeg executable missing; RGB/depth guides retained, MP4 not complete')
            if self.ffmpeg is not None:
                self._run_process([str(self.ffmpeg), '-nostdin', '-v', 'error', '-n',
                               '-framerate', str(self.request.fps), '-start_number', str(self.request.start),
                               '-i', str(self.output_dir / 'rgb' / '%06d.png'), '-frames:v',
                               str(len(manifest['frames'])), '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                               '-movflags', '+faststart', str(self.output_dir / 'guide.mp4')], 'encode.log')
            mp4 = self.output_dir / 'guide.mp4'
            if not mp4.is_file() or mp4.stat().st_size < 32:
                raise GuideError('encoder did not produce a valid-size guide.mp4')
            mp4_hash = sha256(mp4)
            manifest.update(state='completed', exit_code=0, duration_seconds=len(manifest['frames']) / self.request.fps,
                            elapsed_seconds=round(time.monotonic() - began, 3),
                            guide_mp4={'path': 'guide.mp4', 'sha256': mp4_hash, 'codec': 'h264', 'pixel_format': 'yuv420p'})
            with self._lock:
                if self._cancel.is_set():
                    raise GuideError('job canceled')
                self._atomic_json('manifest.json', manifest)
                self._completed = True
        except (GuideError, OSError, ValueError) as exc:
            manifest.update(state='canceled' if self._cancel.is_set() else 'failed', error=str(exc),
                            elapsed_seconds=round(time.monotonic() - began, 3))
            self._atomic_json('status.json', manifest)
            raise GuideError(str(exc)) from exc
        self._atomic_json('status.json', manifest)
        return manifest

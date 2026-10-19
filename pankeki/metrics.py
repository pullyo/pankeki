"""Client event observations; never substitutes wall timings for CUDA timings."""
import json
import threading
import time
from pathlib import Path


class EventMetrics:
    def __init__(self, prompt_id):
        self.prompt_id = prompt_id
        self.events = []
        self.nodes = {}
        self.cached = []
        self.current = None
        self.started = None

    def feed(self, message, now=None):
        now = time.perf_counter() if now is None else now
        data = message.get('data', {})
        if data.get('prompt_id') != self.prompt_id:
            return False
        kind = message.get('type')
        self.events.append({'type': kind, 'data': data, 'client_monotonic': now})
        if kind == 'execution_start':
            self.started = now
        if kind == 'execution_cached':
            self.cached = list(data.get('nodes', []))
        if kind in ('executing', 'execution_success', 'execution_error', 'execution_interrupted'):
            if self.current is not None:
                node, start = self.current
                self.nodes[node] = self.nodes.get(node, 0) + max(0, now - start)
                self.current = None
            if kind == 'executing' and data.get('node') is not None:
                self.current = (str(data['node']), now)
        return True

    def result(self):
        return {'comfy_cached_nodes': self.cached, 'node_wall_s': self.nodes or None,
                'cuda_denoiser_s': None, 'cuda_vae_s': None,
                'peak_vram_allocated_bytes': None, 'peak_vram_reserved_bytes': None,
                'timing_method': 'client WebSocket arrival wall time; not CUDA events',
                'events': self.events}


class JsonlMetrics:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()

    def write(self, record):
        with self.lock, self.path.open('a', encoding='utf-8') as stream:
            stream.write(json.dumps(record, ensure_ascii=False, allow_nan=False) + '\n')

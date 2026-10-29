import argparse
import json
from pathlib import Path
import signal

from .server import make_server


def main():
    parser = argparse.ArgumentParser(description='Pankeki local ComfyUI editor')
    parser.add_argument('command', choices=['serve'], nargs='?', default='serve')
    parser.add_argument('--port', type=int, default=8190)
    parser.add_argument('--comfy-url', default='http://127.0.0.1:8188')
    parser.add_argument('--config', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    config_path = args.config or root / 'runtime' / 'config.json'
    config = json.loads(config_path.read_text(encoding='utf-8-sig')) if config_path.exists() else {}
    server = make_server(root, args.port, args.comfy_url, config)
    def terminate(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, terminate)
    print(f'Pankeki: http://127.0.0.1:{server.server_port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.manager.close()
        if not server.manager.worker.is_alive():
            server.engine.close()
        server.server_close()


if __name__ == '__main__':
    main()

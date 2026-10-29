"""Replace this owned process with the fixed offline LTX CLI. Never accepts paths from HTTP."""
import hashlib
import json
import os
from pathlib import Path
import sys


def main():
    path = Path(sys.argv[1]).resolve(strict=True)
    request = json.loads(path.read_text())
    root = Path(__file__).resolve().parents[1]
    directory = path.parent
    if (path.name != 'ltx-request.json' or request['root'] != str(root)
            or directory.parent != root/'runtime/video/runs'
            or {key:request[key] for key in ('width','height','frames','fps','steps')} != {'width':384,'height':256,'frames':49,'fps':24,'steps':8}):
        raise ValueError('Invalid owned video execution request')
    control = directory/'control-depth.mp4'
    if hashlib.sha256(control.read_bytes()).hexdigest() != request['control_sha256']:
        raise ValueError('Control snapshot changed')
    install = root/'runtime/macos/ltx-video-mlx'
    command = [str(install/'bin/ltx-2-mlx'),'ic-lora','--model',str(root/'models/video/ltx23-q8'),
               '--gemma',str(root/'models/video/gemma3-12b-4bit'),'--lora',
               str(root/'models/video/union/ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors'),'1.0',
               '--video-conditioning',str(control),'1.0','--single-stage','--low-ram','-W','384','-H','256','-f','49',
               '--frame-rate','24','--seed',str(request['seed']),'--stage1-steps','8','-p',request['prompt'],'-o',str(directory/'raw.mp4')]
    print('Pankeki offline video command: '+json.dumps(command,ensure_ascii=False),flush=True)
    os.execv(command[0],command)


if __name__ == '__main__':
    main()

"""Fixed offline LTX CLI. Only exact named profiles and owned snapshots are accepted."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from pankeki.video_profiles import video_profile


def digest(path):
    path = Path(path)
    for component in (path,*path.parents):
        if component.is_symlink():
            raise ValueError('Symlink in owned video request')
    if not path.is_file():
        raise ValueError('Missing owned video file')
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_command(path, root):
    path,root = Path(path).absolute(),Path(root).absolute()
    digest(path)  # Verify the un-resolved path before any file read.
    request = json.loads(path.read_text())
    directory = path.parent
    allowed = {'schema','root','prompt','seed','profile','control_sha256','scene_sha256','width','height','frames','fps','steps','reference'}
    if not isinstance(request,dict) or set(request)-allowed:
        raise ValueError('Unsupported owned execution fields')
    profile = request.get('profile','preview')
    settings = video_profile(profile)
    if (path.name != 'ltx-request.json' or request['root'] != str(root)
            or directory.parent != root/'runtime/video/runs' or not re.fullmatch('[0-9a-f]{32}',directory.name)
            or {key:request[key] for key in settings} != settings
            or type(request.get('seed')) is not int or not 0 <= request['seed'] <= 2**32-1
            or not isinstance(request.get('prompt'),str) or not 1 <= len(request['prompt']) <= 2000):
        raise ValueError('Invalid owned video execution request')
    control = directory/'control-depth.mp4'
    if digest(control) != request['control_sha256']:
        raise ValueError('Control snapshot changed')
    install = root/'runtime/macos/ltx-video-mlx'
    command = [str(install/'bin/ltx-2-mlx'),'ic-lora','--model',str(root/'models/video/ltx23-q8'),
               '--gemma',str(root/'models/video/gemma3-12b-4bit'),'--lora',
               str(root/'models/video/union/ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors'),'1.0',
               '--video-conditioning',str(control),'1.0']
    reference = request.get('reference')
    if reference is not None:
        if (not isinstance(reference,dict) or reference.get('frame') != 0 or reference.get('strength') != 1.0
                or reference.get('binding') != 'replace' or reference.get('crf') != 0 or reference.get('fit') != 'contain'
                or reference.get('prepared_size') != [settings['width'],settings['height']]
                or digest(directory/'reference.png') != reference.get('prepared_sha256')
                or digest(directory/'reference-original.png') != reference.get('original_sha256')):
            raise ValueError('Reference snapshot changed')
        command += ['--image',str(directory/'reference.png'),'0','1.0','replace','0']
    command += ['--single-stage','--low-ram','-W',str(settings['width']),'-H',str(settings['height']),'-f',str(settings['frames']),
                '--frame-rate',str(settings['fps']),'--seed',str(request['seed']),'--stage1-steps',str(settings['steps']),
                '-p',request['prompt'],'-o',str(directory/'raw.mp4')]
    return command,profile


def main():
    root = Path(__file__).resolve().parents[1]
    command,profile = build_command(Path(sys.argv[1]),root)
    if profile == 'fullbody':
        # These match the reviewed local 384x512/241f execution, only in this child.
        os.environ['LTX2_VAE_DECODE_BUDGET_GB'] = '6'
        os.environ.pop('LTX2_LORA_MODE',None)
        os.environ.pop('LTX2_COMPUTE_DTYPE',None)
    print('Pankeki video environment: '+json.dumps({key:os.environ.get(key) for key in ('LTX2_VAE_DECODE_BUDGET_GB','LTX2_LORA_MODE','LTX2_COMPUTE_DTYPE')}),flush=True)
    print('Pankeki offline video command: '+json.dumps(command,ensure_ascii=False),flush=True)
    os.execv(command[0],command)


if __name__ == '__main__':
    main()

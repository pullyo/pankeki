# 실행 환경과 설치 기록

확인일: 2026-10-19 (Asia/Seoul). 설치와 실제 생성 검증의 상태는 아래 기록 및 `evidence/environment.json`에 남긴다.

## 격리와 발견 범위

- 작업 폴더: `D:\Pankeki`; 기존 `D:\character-foundry`는 수정하지 않았다.
- D: 최상위 및 C:의 흔한 AI/Projects 폴더, 사용자 Desktop/Documents/Downloads/Local Programs를 확인했다. 조사한 범위에서 기존 ComfyUI나 모델 설치를 발견하지 못했다. 사용자 홈 최상위와 CIM 조회는 샌드박스에서 접근이 거부되었으므로 전체 PC에 설치가 없다고 단정하지 않는다.
- 시작 시 포트 8188/7860에서 수신 서버를 찾지 못했다. 기존 사용자 프로세스는 종료하지 않았다.
- GPU: NVIDIA GeForce RTX 5060, 8151 MiB, 드라이버 595.79. `nvidia-smi`의 CUDA 13.2는 드라이버가 지원하는 버전이며 설치된 PyTorch CUDA runtime 버전과 구별한다.
- 실제 Python: `C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe` (3.12.14). PATH의 WindowsApps python 별칭을 사용하지 않는다.
- Python의 OS 식별 결과: Windows 10 build 19045, AMD64, 논리 CPU 10개. CIM 대신 읽기 가능한 `platform`/`os` 결과를 기록했다.
- ComfyUI는 `vendor/ComfyUI`, GPU 의존성은 `.venv-comfy`, 앱 의존성은 별도 `.venv`에 둔다. 시스템 Python·드라이버·CUDA Toolkit은 교체하지 않는다.

## 선택과 재현

[ComfyUI 공식 설치 안내](https://github.com/Comfy-Org/ComfyUI#manual-install-windows-linux)는 NVIDIA 20 계열 이상에서 cu130 이상 PyTorch를 요구한다. 공식 [CUDA 13.0 wheel index](https://download.pytorch.org/whl/cu130/torch/)를 사용하고 실제 설치 버전은 잠금 파일로 보존한다. NVIDIA 드라이버와 별도로 CUDA Toolkit 설치는 하지 않았다.

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m venv D:\Pankeki\.venv-comfy
& D:\Pankeki\.venv-comfy\Scripts\python.exe -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu130
& D:\Pankeki\.venv-comfy\Scripts\python.exe -m pip install -r D:\Pankeki\vendor\ComfyUI\requirements.txt
& D:\Pankeki\.venv-comfy\Scripts\python.exe D:\Pankeki\evidence\environment-inspect.py
```

ComfyUI의 원본 저장소는 수정하지 않으며, 외부 모델 및 추가 노드 경로는 `vendor/pankeki-model-paths.yaml`로 연결한다. 별도 저장된 CropAndStitch만 선택적으로 whitelist하고 WaveSpeed는 실행하지 않는다.

고정한 ComfyUI commit은 `8f04fd6ecf4a548937971e840af2a985529fab76`이며, 소스의 버전 문자열은 `0.42.0`이다. 현재 master clone을 이 SHA로 고정한 것이며 최신 안정 태그라고 부르지 않는다. 설치 스크립트는 다른 기존 commit을 발견하면 덮어쓰지 않고 중단한다.

```powershell
& D:\Pankeki\scripts\setup-comfy.ps1 -Start -EnableCropAndStitch
$comfyServer = Get-Content D:\Pankeki\evidence\environment-comfy-process.json -Raw | ConvertFrom-Json
& D:\Pankeki\.venv\Scripts\python.exe D:\Pankeki\scripts\prepare_manifest.py --pid $comfyServer.listener_pid
```

이미 이 작업이 시작한 서버가 있으면 `-Start` 대신 `-Inspect`를 사용한 후 같은 `listener_pid` 명령을 실행한다. `-Inspect`는 프로세스를 시작하거나 종료하지 않는다. Windows venv의 launcher PID와 실제 수신 서버 PID가 다를 수 있으므로 manifest에는 **listener_pid**를 사용한다. 기존 `pid` 필드는 launcher PID로 보존하고, `launcher_pid`와 `listener_pid`를 별도로 기록한다.

시작 스크립트는 저장된 launcher의 생성 시각을 확인하고, 실제 127.0.0.1 socket 소유자가 launcher 또는 그 자식인지 확인한 뒤 `/system_stats` 성공을 기다린다. 기본 대기 한도는 45초(`-ReadyTimeoutSeconds`, 최대 50초)다. 확인 실패 시 프로세스를 종료하지 않고 로그 경로를 남기며 오류로 끝난다. 실행 PID·생성 시각·전체 인수·로그 경로는 `evidence/environment-comfy-process.json`, 수신 프로세스 확인 결과는 `evidence/environment-listener.json`에 기록한다.

시작 옵션은 `--listen 127.0.0.1 --port 8188 --offline --disable-all-custom-nodes --use-pytorch-cross-attention --fp16-unet --fp16-text-enc --fp32-vae --preview-method latent2rgb`다. 경로 설정을 별도 전달하며 선택 시 `--whitelist-custom-nodes ComfyUI-Inpaint-CropAndStitch`를 더한다. 기존 포트가 사용 중이면 새 서버를 시작하지 않고 기존 프로세스를 보존한다.

이 commit의 기본 ComfyUI 캐시는 RAM pressure cache다. 앱 실험의 baseline에서 이를 그대로 유지한다. `execution.py`는 V1 `IS_CHANGED`와 V3 `fingerprint_inputs`를 모두 지원하며, 노드 입력과 선행 노드 signature를 비교한다. `LoadImage`는 파일 내용 hash를 반환하지만 `CheckpointLoaderSimple`은 checkpoint 파일명 입력만으로 내부 캐시가 재사용될 수 있으므로 앱의 모델 SHA-256 확인을 별도로 유지한다. ComfyUI 자체 노드 재사용과 앱 완성 결과 재사용은 실험에서 구별한다.

## 초기 모델

[Stability AI SD-Turbo](https://huggingface.co/stabilityai/sd-turbo)는 SD2.1 계열 증류 모델이다. 공식 단일 checkpoint `sd_turbo.safetensors` 원본을 보존한다. UNet·text encoder FP16, VAE FP32, PyTorch SDPA를 시작 설정으로 고정하며 실제 로그로 확인한다. LoRA, 별도 VAE, ControlNet은 사용하지 않는다.

재설치 스크립트는 모델 저장소 revision `b261bac6fd2cf515557d5d0707481eafa0485ec2`를 사용한다. [발행자 파일 정보](https://huggingface.co/stabilityai/sd-turbo/blob/main/sd_turbo.safetensors)의 SHA-256은 `3f067a1b943cf162f2b8f8588f6cf5824bd5b4c7d1d88d87164b9ca123616549`, 크기는 5,214,561,328 bytes다. 다운로드 후 hash가 일치해야 checkpoint 파일로 활성화한다.

처음 비교는 512×512, Euler, normal, CFG 1, seed 고정, **1 step**이다. 1-step denoise=1 경로는 최대 sigma에서 0으로 가며 `SDTurboScheduler`의 1-step 경로와 일치한다. 공식 SD-Turbo diffusers 설정은 EulerDiscreteScheduler의 trailing timestep이다. 여러 step으로 확장할 때 plain normal scheduler와는 스케줄이 다르므로 동일한 baseline이라고 부르지 않는다. ComfyUI의 SDTurboScheduler 예제는 SDXL-Turbo용이라는 차이도 기록한다. 공식 모델은 512×512 및 적은 step을 중심으로 학습되었으므로 작은 crop이나 고해상도 실행의 품질을 같은 품질의 가속으로 단정하지 않는다. 전용 inpaint 모델이 아니므로 ROI 경계/문맥 품질은 별도 검증이 필요하다.

## 검증 상태

- 환경 탐색, 격리 venv, 의존성 설치 완료. 최종 `pip check` 통과(`evidence/environment-pip-check.txt`). 패키지 잠금 목록과 라이선스 파일 인벤토리를 저장했다.
- CUDA tensor/attention 실제 검증 통과: PyTorch `2.14.1+cu130`, CUDA runtime `13.0`, GPU capability `12.0`, wheel에 `sm_120` 포함. FP16 CUDA 행렬곱 256×256과 SDPA 1×4×64×32를 실행하고 synchronize 후 유한한 결과를 확인했다. `evidence/environment-cuda-smoke.json`이 원자료다. 이는 이미지 생성 검증과 별개다.
- torchvision `0.29.1+cu130`, torchaudio `2.11.0+cu130` 실제 import 성공. 전체 ComfyUI 설치 후에도 `pip check`가 통과했고 최종 의존성 목록을 동결했다.
- 실제 서버 `/system_stats`와 `/object_info` 확인 완료(`evidence/environment-server-health.json`). 681개 노드 유형, checkpoint `sd_turbo.safetensors`, 추가 노드는 CropAndStitch 2개만 등록됨. WaveSpeed·기본 custom example은 whitelist 밖이라 비활성이다.
- 서버는 2026-10-19 20:32 KST 시작. launcher PID 3132와 실제 127.0.0.1:8188 listener PID 10772를 구별하고, launcher의 자식 프로세스인지 확인했다(`evidence/environment-listener.json`). PID는 재시작 시 달라지므로 현재 PID와 생성 시각을 함께 확인한다.
- 서버 로그에서 PyTorch attention, cudaMallocAsync, NORMAL_VRAM, async weight offloading 2 streams, DynamicVRAM, 기본 RAM pressure cache를 확인했다. frontend 1.55.18, workflow templates 0.11.89, embedded docs 0.5.14, comfy-kitchen 0.2.39, comfy-aimdo 0.5.6이다.
- 실제 GPU 이미지 생성 완료: 첫 서버 로그에서 UNet FP16, EPS, SD2ClipModel FP16, AutoencoderKL FP32, 정상 1-step 실행과 저장 완료를 확인했다. 최초 요청의 서버 보고 실행 시간은 5.94초였으며 모델 초기화를 포함한다. 이어진 warm 요청의 서버 보고 0.44초는 별도 요청의 값이므로 이 둘을 최적화 배수로 비교하지 않는다. 앱 실험 evidence의 실제 ComfyUI prompt ID, PNG 및 hash로 제출·회수 결과를 연결한다.
- denoiser/VAE 개별 GPU 이벤트 시간, 최대 allocated/reserved VRAM은 해당 instrumentation 없이 `미측정`으로 둔다. 서버 전체 실행 시간이나 프로세스 VRAM을 세부 단계 측정값으로 바꾸어 부르지 않는다.

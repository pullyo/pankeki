# Windows에서 Pankeki 실행

대상은 Windows 10/11 64비트(x64)다. 이미지 생성은 NVIDIA GPU(CUDA)를 우선 사용한다. NVIDIA GPU가 없으면 편집·움직임·프로젝트 저장만 쓰는 **편집 전용 모드**로 실행한다. CPU 생성은 명시적으로 켤 때만 쓰며 매우 느리다.

> 상태 (2026-10-29): 이 경로는 Mac에서 코드·단위 테스트·교차 빌드로만 검증했다. 실제 Windows PC에서 설치·생성·부분 수정·저장·재열기를 확인한 기록은 아직 없다. 확인 절차는 `docs/windows-qa.ko.md`에 있다.

## 1. 준비물

- Python 3.12(권장) 또는 3.13, 64비트. python.org 설치본 또는 `py` 런처. Microsoft Store 별칭(`WindowsApps\python.exe`)은 쓰지 않는다.
- NVIDIA 드라이버(생성할 때). `nvidia-smi`가 실행되면 된다. torch는 CUDA 13.0 빌드(`cu130`)를 설치한다.
- Windows 10 1803 이상에 기본 포함된 `curl.exe`. git은 필요 없다.
- 채팅 연결(선택): Codex CLI(ChatGPT 로그인) 또는 Claude Code CLI(claude.ai 로그인). npm 설치본(`%APPDATA%\npm\*.cmd`)과 단독 설치본(`%USERPROFILE%\.local\bin\*.exe`) 모두 찾는다.

## 2. 설치

프로젝트 폴더에서 PowerShell을 연다. 경로에 공백이나 한글이 있어도 된다.

```powershell
# 편집 전용 환경만 (.venv-windows-editor)
powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1

# + ComfyUI(고정 commit) + 생성 환경(.venv-windows, torch 2.14.1 CUDA 13.0, 약 2.5 GB)
powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1 -Generation

# + SDXL Base (약 6.9 GB) 또는 제품 모델 3종 (약 19 GB), 모두 SHA256 검증
powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1 -Sdxl
powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1 -Models

# 채팅에서 이미지 도구를 쓰기 위한 MCP 전용 환경 (runtime\windows\pankeki-mcp)
powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1 -Mcp

# NVIDIA GPU 없이 CPU 생성 (매우 느림)
powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1 -Generation -Cpu
```

이미 받아 둔 모델이 있으면 `models\checkpoints\`(SDXL Base, Animagine) 와 `models\diffusion_models\sdxl-inpainting-0.1\unet\`(인페인트 UNet)에 복사한 뒤 `-Models`를 실행한다. SHA256이 맞는 파일은 다시 받지 않는다.

기존 `vendor\ComfyUI`가 다른 commit이거나 핵심 파일이 다르면 덮어쓰지 않고 멈춘다. 기존 venv와 모델도 덮어쓰지 않는다.

## 3. 실행

```bat
Pankeki.cmd                 :: ComfyUI(8188) + 앱(8190), 브라우저 열기
Pankeki.cmd --no-browser
Pankeki.cmd --editor-only   :: 생성 서버 없이 편집·움직임만
Pankeki.cmd --cpu           :: NVIDIA GPU가 없을 때 CPU로 생성 (매우 느림)
```

종료는 실행 창에서 **Ctrl+C**. 앱과 ComfyUI는 프로세스 트리째(`taskkill /T`) 정리한다. venv의 `python.exe`는 실제 인터프리터를 자식으로 띄우는 실행기라서, 실행기만 끝내면 포트를 잡은 인터프리터가 남기 때문이다.

설정은 실행할 때마다 `runtime\windows\config.json`, `runtime\windows\model-paths.yaml`로 다시 만든다. 직접 고치지 않는다. 로그는 `runtime\windows\app.log`, `runtime\windows\comfy.log`.

## 4. 데스크톱 앱 (Electron)

소스에서 실행:

```powershell
cd desktop
npm ci
npm start
```

앱은 위의 프로젝트 폴더(`.venv-windows`, `runtime\windows\config.json`, `vendor\ComfyUI`)를 찾아 ComfyUI와 앱 서버를 직접 띄운다. `Pankeki.cmd`로 이미 띄운 서버가 있으면 같은 프로젝트의 서버인지 명령줄로 확인한 뒤 재사용한다. 다른 폴더나 다른 프로그램이 포트를 쓰고 있으면 시작하지 않는다.

프로젝트 폴더를 못 찾으면 폴더 선택 창이 뜬다. 선택은 `%APPDATA%\Pankeki\project-root.json`에 저장된다. `PANKEKI_PROJECT_ROOT` 환경 변수로도 지정할 수 있다.

실행 파일 패키징 (Windows 또는 Mac에서 교차 빌드):

```powershell
cd desktop
$env:PANKEKI_RELEASE_TARGET = 'windows'
node scripts\freeze-release.cjs
node scripts\package-win.cjs
```

결과는 `output\desktop-release\windows\artifacts\<시각>\Pankeki-win32-x64\Pankeki.exe`와 같은 폴더의 zip이다. Python·ComfyUI·모델·CLI는 들어 있지 않다. 코드 서명이 없어서 처음 실행할 때 SmartScreen의 "알 수 없는 게시자" 경고가 뜬다. Mac에서 교차 빌드하면 wine이 없을 때 exe 아이콘을 넣지 못하고, 그 사실이 `release-manifest.json`의 `iconEmbedded`에 남는다.

## 5. Windows에서 다르게 동작하는 것

- **GPU 작업 취소**: 실행 중인 GPU 작업의 원자적 대상 취소는 macOS의 `ps`/`lsof` 증명에 의존한다. Windows에서는 증명이 `unknown`으로 남아 기존 규칙대로 대기 중 작업만 지우고, 실행 중 작업은 로컬 결과 폐기로 처리한다. GPU 계산이 끝까지 돌 수 있다.
- **영상(Blender)·배경 분리(Apple Vision)**: macOS 전용이라 Windows에서는 꺼진다. 기능 목록(`/api/capabilities`)에 사용 불가로 표시된다.
- **채팅 CLI**: npm의 `.cmd` 실행 파일은 셸 없이 실행할 수 없어서, `.cmd`가 가리키는 `node <script.js>`로 바꿔 실행한다. 형식을 알 수 없는 `.cmd`는 실행하지 않는다.
- **예전 스크립트**: `scripts\setup-app.ps1`, `scripts\start-pankeki.ps1`은 새 스크립트로 넘겨 주는 호환용이다. `scripts\setup-comfy.ps1` + `prepare_manifest.py`(SDK 경로·manifest 증거)는 예전 실험 기록용으로 그대로 두었고 이 실행 경로와 섞지 않는다.

기존 로컬 API는 127.0.0.1에만 열린다. 로그인·재부팅 시 자동 시작은 등록하지 않는다.

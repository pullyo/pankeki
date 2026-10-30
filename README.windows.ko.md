<img src="docs/images/pankeki-icon.png" alt="Pankeki pancake logo" width="64" height="64">

# Pankeki Windows 시험 포팅

> 2026-10-30 기준: Windows 포팅은 macOS 앱과 함께 `main` 한 코드베이스에 있습니다. Mac에서 자동 검사 313개와 Windows 교차 빌드로 확인했을 뿐, 실제 Windows PC에서 설치·GPU 생성·앱 UI·저장·재열기를 검증한 기록은 없습니다.

Pankeki는 AI 대화, 로컬 캐릭터 이미지 생성·부분 수정, 생성 기록과 명시적 프로젝트 관리, 자체 2D 동작 도구를 연결합니다. 공유 기능 소개는 [최신 개요](README.md)를 참고하세요. Windows에서 Blender 영상과 Apple Vision 배경 분리는 비활성이고, 공식 SDK가 없는 `.moc3`/Cubism 재생도 비활성입니다.

## 준비와 설치

Windows 10/11 x64, Python 3.12(권장) 또는 3.13 64비트, 시스템 `curl.exe`와 `tar.exe`가 필요합니다. Microsoft Store의 WindowsApps Python 별칭은 사용하지 않습니다. NVIDIA 이미지 생성에는 드라이버가 필요하고, 설치기는 torch 2.14.1/torchvision 0.29.1의 CUDA 13.0 빌드를 사용합니다. 다운로드 용량과 모델·드라이버 호환성을 먼저 확인하세요.

```powershell
git clone https://github.com/pullyo/pankeki.git
cd pankeki
# 편집 전용 환경: 브라우저에서 사용
powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
# 생성 환경 + SDXL Base (약 6.9 GB)
powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1 -Sdxl
# 또는 제품 모델 3종 (약 19 GB)
powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1 -Models
# CLI의 이미지 도구 연결용 별도 MCP 환경
powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1 -Mcp
```

Git 없이 브랜치 소스 ZIP을 풀어 사용할 수도 있습니다. Python 경로를 직접 지정하려면 `-Python 'C:\경로\python.exe'`를 붙입니다. 설치기는 `.venv-windows-editor`, 생성 옵션일 때 `.venv-windows`와 고정 ComfyUI를 준비하며 모델 SHA256을 확인합니다. 기존 모델 불일치·다른 ComfyUI 소스는 덮어쓰지 않고 중단합니다.

설치 마지막의 `--prepare-only`는 서버를 띄우지 않고 desktop 필수 `runtime/windows/config.json`과 `model-paths.yaml`을 만듭니다. 폴더를 옮겼다면 다음을 다시 실행합니다.

```powershell
.venv-windows-editor\Scripts\python.exe scripts\run_windows.py --prepare-only
```

## 실행

```bat
Pankeki.cmd
Pankeki.cmd --no-browser
Pankeki.cmd --editor-only
Pankeki.cmd --cpu
```

기본 실행기는 CUDA가 없으면 편집 전용으로 돌아갑니다. CPU 생성은 `setup-windows.ps1 -Generation -Cpu`로 환경을 준비하고 `Pankeki.cmd --cpu`로 명시할 때만 사용하며 매우 느릴 수 있습니다. 편집 전용 환경은 이미지 생성에 사용할 수 없습니다.

로컬 Pankeki는 `127.0.0.1:8190`, ComfyUI는 `127.0.0.1:8188`을 사용합니다. 종료는 실행 창에서 Ctrl+C입니다. 실행기가 소유한 프로세스 트리만 정리하도록 구현했지만 실제 Windows의 종료 동작은 미검증입니다. 로그·생성 설정은 `runtime/windows/`에 있습니다. 설정 파일을 직접 고치는 대신 준비 명령을 사용하세요.

## 데스크톱 앱과 대화

**데스크톱 앱에는 `-Generation`, `-Sdxl` 또는 `-Models`로 준비한 생성 환경과 ComfyUI가 필요합니다.** 편집 환경만 준비했다면 브라우저 경로를 사용하세요. 외부 실행 환경이 준비되면 CMD를 먼저 켜지 않아도 앱이 서버를 시작하도록 구현돼 있습니다.

```powershell
cd desktop
npm ci
npm start
```

패키지 EXE도 Python·ComfyUI·모델·CLI를 포함하지 않습니다. 처음에는 준비한 프로젝트 폴더를 선택하거나 `PANKEKI_PROJECT_ROOT`로 지정합니다. 같은 프로젝트의 기존 서버만 신원을 확인해 재사용하며, 앱이 시작하지 않은 서버는 종료하지 않는 정책입니다.

대화는 별도로 설치·로그인한 Codex CLI 또는 Claude Code CLI를 사용합니다. 표준 npm `.cmd`와 지원하는 native `.exe` 경로를 찾습니다. 이미지 추론은 로컬이지만 **대화 텍스트·선택 이미지 문맥·결과 미리보기·도구 요청/결과는 AI 공급자로 전송될 수 있습니다.** 대화까지 완전한 오프라인은 아닙니다.

## 패키징·검증 한계

```powershell
cd desktop
$env:PANKEKI_RELEASE_TARGET = 'windows'
node scripts\freeze-release.cjs
node scripts\package-win.cjs
```

출력은 `output/desktop-release/windows/artifacts/` 아래 EXE 폴더와 ZIP입니다. 무서명 패키지이므로 SmartScreen의 알 수 없는 게시자 경고가 나올 수 있습니다. Mac에서 wine 없이 교차 빌드하면 EXE 아이콘 삽입도 생략될 수 있으며 manifest에 남습니다.

- 실행 중 GPU 작업의 원자적 대상 취소는 Windows에서 신원 증명이 `unknown`입니다. 대기 작업 삭제 또는 로컬 결과 폐기로 처리하므로 GPU 계산이 계속될 수 있습니다. 전역 interrupt로 우회하지 않습니다.
- Blender 로컬 영상·Apple Vision 배경 분리는 Windows에서 비활성입니다. 자체 2D 동작 편집과는 별개입니다.
- `.moc3` 재생은 공식 Cubism SDK 미포함으로 비활성입니다.
- Mac의 313 자동 검사와 교차 빌드는 Windows 실기 성공이나 이미지 품질 보장이 아닙니다. 실제 확인은 [Windows QA 절차](docs/windows-qa.ko.md)를 따릅니다.
- 과거 `setup-comfy.ps1`/`prepare_manifest.py`의 SDK 실험 안내를 이 새 실행 경로와 섞지 마세요. 로그인·재부팅 자동 시작은 등록하지 않습니다.

코드는 [MIT](LICENSE), 외부 구성요소 조건은 [THIRD_PARTY.md](THIRD_PARTY.md)를 따릅니다.

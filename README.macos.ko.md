<img src="docs/images/pankeki-icon.png" alt="Pankeki pancake logo" width="64" height="64">

# Pankeki macOS 데스크톱 시작 안내

macOS와 Windows는 `main` 한 코드베이스에 있습니다(2026-10-30 통합). [전체 기능·제한](README.ko.md)과 [실기 미검증 Windows 안내](README.windows.ko.md)를 함께 보세요.

## 1. 실행 환경 준비

Apple Silicon Mac, Python 3.12 또는 3.13, curl이 필요하며 데스크톱 앱에는 Node.js 24/npm과 별도 Codex CLI 또는 Claude Code CLI가 필요합니다. 대화 CLI에는 본인 공급자 계정으로 먼저 로그인합니다. 이미지 모델은 앱에 포함하지 않습니다. SDXL 1024² 작업은 메모리 32 GB와 여유 디스크 약 30 GB를 시작 기준으로 권장합니다.

```bash
git clone https://github.com/pullyo/pankeki.git
cd pankeki
bash scripts/setup-macos.sh --models
.venv-macos/bin/python plugins/pankeki-local/scripts/configure_paths.py
.venv-macos/bin/python plugins/pankeki-local/scripts/setup_runtime.py
```

`--models`는 고정 ComfyUI와 SDXL Base·Animagine XL 4.0 Opt·SDXL Inpainting 0.1 UNet(합계 약 19 GB)을 준비하고 모델 SHA256을 검사합니다. 불일치한 기존 모델이나 다른 ComfyUI 소스는 덮어쓰지 않고 중단합니다. 옵션 없는 setup은 편집 환경, `--generation`은 모델 없는 생성 환경, `--sdxl`은 Base만 준비합니다. 최초 준비에는 다운로드가 필요합니다. 기존 가상환경을 옮겼다면 다시 구성해야 할 수 있습니다.

MCP 준비 명령은 현재 폴더의 `mcp.json`/`.mcp.json` 경로 선언을 만들고, `.venv-macos`에서 별도 `runtime/macos/pankeki-mcp-20261023/release/venv`를 생성합니다. 서버 의존성은 그 전용 환경에 설치하고 `pip check`로 확인합니다. 데스크톱 bridge는 이 Python으로 도구를 직접 실행하므로 글로벌 플러그인 등록은 필요하지 않습니다. [MCP 사용자 안내](plugins/pankeki-local/README.ko.md)를 참고하세요.

## 2. 첫 준비와 데스크톱 열기

새 clone에서는 Mac 설치 스크립트가 desktop 필수 config/model-paths를 아직 생성하지 않습니다. **첫 번째 터미널**의 프로젝트 루트에서 다음을 실행하고 켜 둡니다.

```bash
./Pankeki.command --no-browser
```

브라우저를 열지 않고 `runtime/macos/config.json`, `model-paths.yaml`과 로컬 서버를 준비합니다. **두 번째 터미널**에서 같은 프로젝트의 desktop 폴더를 엽니다.

```bash
cd /실제/프로젝트/경로/pankeki/desktop
npm ci
npm start
```

데스크톱은 같은 프로젝트의 서버를 확인한 뒤 재사용합니다. 앱을 닫아도 이 별도 터미널에서 시작한 서버는 남으므로, 작업을 마치면 첫 번째 터미널에서 Control+C로 종료합니다. 이후 생성 설정과 실행 환경이 준비된 상태에서는 desktop의 `npm start`로 앱이 서버를 직접 시작할 수 있습니다.

패키지 앱도 외부 프로젝트 폴더·Python·ComfyUI·모델·대화 CLI가 필요합니다. 폴더를 찾지 못하면 준비한 폴더를 고르거나 `PANKEKI_PROJECT_ROOT`로 지정합니다. 이동한 폴더의 생성 설정은 정상 실행기를 통해 갱신하세요.

## 3. 기본 작업

대화·이미지 생성·수정은 한 입력창에 요청합니다. 결과 이미지를 누르면 오른쪽 편집기가 열리며 브러시 또는 업로드한 마스크로 수정할 영역을 고를 수 있습니다. SDXL Base와 Animagine은 생성에, 전용 SDXL Inpainting은 마스크 재생성에 사용합니다. 색상만 바꾸려면 CPU recolor 경로를 사용합니다. 마스크 밖 RGB·원본 alpha 보존과 마스크 안의 의미적 수정 성공은 별개입니다.

일반 생성 기록은 프로젝트 등록 없이 보관합니다. 새 프로젝트 또는 프로젝트로 저장할 때 등록하고, 프로젝트 화면에서 여러 프로젝트를 전환합니다. 파일 저장만으로 일반 기록이 프로젝트가 되지는 않습니다. 자체 2D 리그는 PNG 부위·메시·표정·동작과 PNG/48프레임 ZIP 출력을 다룹니다.

**대화는 완전한 오프라인이 아닙니다.** 이미지 추론·CPU recolor는 로컬에서 처리하지만, 텍스트·선택 이미지 문맥·결과 미리보기·도구 요청/결과는 선택한 Codex/Claude 공급자로 전송될 수 있습니다. 모델·프로젝트 파일은 로컬에 유지합니다.

## 브라우저 선택 경로와 제한

`./Pankeki.command`는 공유 이미지·편집 UI를 브라우저에 엽니다. `--editor-only`는 이미지 생성 서버 없이 편집·프로젝트·자체 2D 작업에 사용합니다. 네이티브 CLI 대화 bridge는 데스크톱 앱 기능이므로 브라우저 화면이 이를 대신하지 않습니다. 서비스는 Pankeki 127.0.0.1:8190, ComfyUI 127.0.0.1:8188을 사용하며 인터넷 공개용 배포 안내가 아닙니다.

Blender 가이드·로컬 영상은 별도 도구·가중치가 필요한 macOS 실험 기능입니다. Apple Vision 배경 분리는 선택 helper와 Apple 도구가 필요합니다. 공식 Cubism SDK는 포함하지 않아 `.moc3` 재생은 비활성입니다. Windows의 해당 두 macOS 기능은 비활성입니다. 이미지 품질·원화 일관성·속도·다른 Mac 호환성을 보장하지 않습니다.

로그는 `runtime/macos/app.log`, `comfy.log`, Comfy 데이터는 `runtime/macos/comfy-*`에 있습니다. 모델·외부 구성요소의 이용 조건은 [THIRD_PARTY.md](THIRD_PARTY.md)를 확인하세요. 과거 복원·속도 측정 기록은 [2026-10-29 갱신 전 안내](https://github.com/pullyo/pankeki/blob/4f46797e3beb14d5cfb95feb2b21d5d675c02c09/README.macos.ko.md)의 날짜가 붙은 이력이며 현재 일반 성능 보장이 아닙니다.

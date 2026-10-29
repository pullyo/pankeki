# Pankeki Local MCP 사용자 안내

Pankeki의 기존 로컬 API를 MCP 도구로 연결합니다. 새 이미지 생성, 원본·마스크 부분 수정, CPU 색상 변경, 작업 조회·검증된 결과 가져오기·취소를 제공합니다. 별도 이미지 생성 서비스나 다른 ComfyUI 큐를 만들지 않습니다.

현재 앱은 [macOS 브랜치](https://github.com/pullyo/pankeki/tree/mac-release-20261028), Windows는 [실기 미검증 시험 브랜치](https://github.com/pullyo/pankeki/tree/windows-port-20261029)입니다. 도구가 실행되려면 Pankeki 서버와 필요한 로컬 모델 환경이 먼저 준비돼 있어야 합니다. MCP 실행기는 서버를 대신 시작·종료하지 않습니다.

## 데스크톱 앱의 이미지 도구 준비

Mac에서 앱 루트의 `setup-macos.sh --models`를 마친 다음 실행합니다.

```bash
.venv-macos/bin/python plugins/pankeki-local/scripts/configure_paths.py
.venv-macos/bin/python plugins/pankeki-local/scripts/setup_runtime.py
```

첫 명령은 이 폴더의 절대경로로 `mcp.json`/`.mcp.json`을 생성합니다. 두 번째는 이를 읽어 `.venv-macos`로 전용 `runtime/macos/pankeki-mcp-20261023/release/venv`를 만들고 `server/requirements.txt` 설치와 `pip check`를 수행합니다. 기본 이미지 환경에 MCP 의존성을 섞지 않습니다. `--offline-wheelhouse`는 준비된 wheel 디렉터리가 있을 때만 사용할 수 있습니다. 경로 갱신만 읽기로 확인하려면 configure 명령에 `--check`를 붙입니다.

Windows 브랜치에서는 아래 설치 옵션이 Windows 경로 선언과 전용 환경을 준비합니다.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1 -Mcp
```

Windows 전용 Python 위치는 `runtime/windows/pankeki-mcp/venv/Scripts/python.exe`입니다. 이 옵션만으로 ComfyUI나 모델을 설치하지 않으므로 생성에는 `-Generation`/`-Sdxl`/`-Models` 준비가 별도로 필요합니다. Mac 날짜 경로를 Windows에 복사하지 않습니다.

**데스크톱 자체 연결에는 글로벌 플러그인 설치나 native MCP 등록이 필요하지 않습니다.** 앱 bridge가 전용 Python과 launch.py를 직접 사용합니다. Codex/Claude CLI와 본인 계정 로그인은 별도로 준비합니다. 외부 MCP 호스트에서 이 도구를 직접 쓰려는 경우에만 그 호스트의 정식 등록 절차와 생성한 선언을 사용하세요. 다른 설정·등록을 덮어쓰거나 같은 서버를 중복 활성화하지 않습니다.

## 도구와 사용 순서

| 도구 | 역할 |
| --- | --- |
| `pankeki_get_status` | 앱·ComfyUI 연결 및 실제 모델 가용성 확인 |
| `pankeki_generate_image` | 새 이미지 작업 접수, job_id 반환 |
| `pankeki_edit_image` | 허용된 원본·마스크 PNG를 사용한 regenerate 또는 CPU recolor |
| `pankeki_get_job` | 접수한 job_id의 실제 상태 조회 |
| `pankeki_get_result` | 성공 작업의 PNG·입력·요청·recipe·metrics 연결 검사 후 반환 |
| `pankeki_cancel_job` | 소유 작업 취소 요청; 실제 GPU 중단이 확정되지 않을 수 있음 |

먼저 status로 현재 환경을 확인합니다. 생성 모델에는 SDXL Base와 Animagine XL 4.0 Opt가 포함되며 과거 SD Turbo 구성도 코드에 남아 있지만, enum에 있다는 사실이 모델 설치·사용 가능성을 뜻하지 않습니다. 전용 `sdxl-inpaint-v01`은 regenerate용이며 SDXL Base 조건부 정보가 함께 필요합니다. 단순 색상 변경에는 CPU recolor를 사용합니다. 상세 인자·범위는 [API 계약](https://github.com/pullyo/pankeki/blob/mac-release-20261028/plugins/pankeki-local/server/CONTRACT.md)과 현재 호스트가 노출하는 schema를 대조하세요.

작업을 접수하면 반환한 job_id를 조회하고, succeeded 뒤 get_result로 결과를 가져옵니다. 기본 session은 독립적이며 같은 session을 명시적으로 재사용하면 앞선 작업이 supersede될 수 있습니다. 제출 응답을 잃었을 때 자동 재제출하지 마세요. 이 adapter의 소유 기록에 없는 임의 job_id를 취소할 수 없습니다.

원본·마스크 기본 허용 루트는 앱의 output/와 runtime/입니다. 흑백 마스크의 0은 보존, 양수는 수정 대상이며 두 PNG의 크기가 맞아야 합니다. 비어 있는 마스크의 원본 복사와 CPU recolor는 모델 추론 성공이 아닙니다. 마스크 밖 보존은 마스크 안 수정 지시 준수나 미술 품질을 보장하지 않습니다.

## 범위·문제 확인

도구에는 프로젝트·부위·리그·표정·동작 편집이나 글로벌 cache 정리 기능이 없습니다. UI의 전체 기능이 MCP에 자동 노출되지는 않습니다. 실행 중 작업 취소는 로컬 결과 폐기로 끝나 GPU 계산이 계속될 수 있습니다. Windows 원자적 GPU 중단은 미검증 신원 때문에 제한됩니다.

연결 오류가 나면 앱의 정상 실행 상태, 모델 가용성, 현재 폴더의 선언, 전용 Python 존재를 먼저 확인합니다. 폴더 이동 후에는 경로 선언을 다시 생성하고 이동한 가상환경은 필요시 재구성합니다. 도구 노출 실패를 이유로 사용자 설정·설치 캐시를 직접 편집하거나 글로벌 등록을 반복하지 않습니다.

MCP 서버 자체는 로컬 loopback API를 호출합니다. 데스크톱이나 외부 AI 호스트와 함께 쓰면 대화 텍스트·선택 이미지·결과와 도구 요청/응답이 공급자로 전송될 수 있습니다. MCP가 로컬이라는 사실만으로 전체 대화가 오프라인인 것은 아닙니다.

## 날짜가 붙은 개발 이력

2026-10-23의 v0.1.2 설치·hot reload·특정 Codex 도구 발견 결과 및 10월 24일 v0.1.3 전용 인페인트 인계는 [갱신 전 문서](https://github.com/pullyo/pankeki/blob/4f46797e3beb14d5cfb95feb2b21d5d675c02c09/plugins/pankeki-local/README.ko.md)에 보존합니다. 이는 해당 날짜·호스트의 기록이며 현재 사용자의 설치 상태나 이미지 품질을 판정하는 안내가 아닙니다. 원본 소재·가중치·SDK 라이선스와 과거 검증 자료를 바꾸지 않습니다.

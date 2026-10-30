# Pankeki 환경 및 회귀검증 재개 인계

2026-10-20 한국시간 10:41 기준 1차 점검을 완료했다. **기존 검사 198개 중 192개 통과, SDK 의존성 누락 오류 5개, Windows 권한에 따른 skip 1개**다. 이번 범위에서 실제 제품 결함으로 확인된 실패는 없다. 프로젝트 모델 가중치와 세 가상환경이 없어 실제 GPU·SDK 생성 경로는 아직 재개할 수 없다. 총괄 검토를 기다린다.

## 현재 환경

| 항목 | 직접 확인한 상태 |
| --- | --- |
| GPU | NVIDIA GeForce RTX 5060, VRAM 8,151 MiB, 드라이버 595.79 |
| 점검 당시 VRAM | 사용 1,153 MiB / 가용 6,743 MiB. 다른 프로세스 사용량을 포함한 순간값 |
| RAM | 34,048,671,744 bytes, 약 31.71 GiB(32 GB급). 점검 당시 OS 보고 가용 약 19.68 GiB |
| OS | Windows 10 Pro 10.0.19045 |
| 실제 Python | `C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe`, 3.12.14 AMD64 |
| PATH python/python3 | `C:/Users/Administrator/AppData/Local/Microsoft/WindowsApps/` 별칭. 사용하지 않음 |
| 실제 Node | `C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`, v24.19.0 x64 |
| 앱 `.venv` | 디렉터리와 `Scripts/python.exe` 모두 없음 |
| `.venv-comfy` | 디렉터리와 `Scripts/python.exe` 모두 없음 |
| `integrations/comfy-sdk` | 브리지 소스·lock·기존 증거는 있음. `.venv`와 Python 실행기는 없음 |
| ComfyUI 소스 | `vendor/ComfyUI/main.py` 있음. 로컬 HEAD `8f04fd6ecf4a548937971e840af2a985529fab76` |
| 모델 | config가 가리키는 SD Turbo·SDXL 두 파일과 SDXL `.part` 모두 없음. `models/`에는 문서·출처 기록 3개만 있음 |
| 8188 / 8189 / 8190 | 10:41:20 및 검사 후 10:43:20에 모두 LISTEN 없음. 현재 listener PID 없음 |

이 확인은 프로젝트의 실제 지정 경로에 대한 것이다. 다른 디스크 위치의 모델 보존본 존재 여부까지 단정하지 않는다. 예전 PID10772·20796이나 기존 runtime guard를 현재 실행 상태로 사용하지 않았다. CIM/네트워크 조회는 일반 샌드박스에서 접근이 거부되어 허용된 추가 권한으로 읽기 전용 재실행했다. `Win32_VideoController.AdapterRAM`은 약 4 GB로 표시됐지만 VRAM 용량에는 `nvidia-smi`의 8,151 MiB를 사용했다.

원자료: `work/team-resume/qa/environment-windows.json`, `work/team-resume/qa/ports-final.json`, `work/team-resume/qa/20261020T104118+0900/environment-runtime.json`.

## 회귀검증 결과

| 기존 검사 대상 | 실행 시각 KST | 결과 | 개별 프로세스 종료 코드 |
| --- | --- | --- | --- |
| `tests/` Python 전체 | 10:41:21–10:41:27 | 111개 실행, 110 통과·1 skip, 실패/오류 0 | 0 |
| `integrations/github/test_workflow_bridge.py` | 10:41:27 | 17/17 통과 | 0 |
| `integrations/comfy-sdk/test_bridge.py` | 10:41:27 | 12개 실행, 7 통과·5 의존성 오류 | 1 |
| `web/tests/profiles.test.cjs` + `scripts/test_ui_state.cjs` | 10:41:27–10:41:29 | 58/58 통과 | 0 |

Python 본체에는 엔진 33개, HTTP 14개, SDK 어댑터의 실제 subprocess 경계 검사 15개 등이 포함된다. 어댑터 검사는 가짜 브리지 프로세스를 사용하므로 공식 SDK 설치나 실제 GPU 성공을 뜻하지 않는다. HTTP 회귀는 테스트 자체의 loopback 포트0 임시 fixture를 사용했다. 실제 ComfyUI·proxy·앱 서버는 시작하거나 재시작하지 않았다.

심볼릭 링크 검사 `test_file_symlink_is_rejected_without_modifying_target`는 호스트의 symlink 생성 권한 부족(검사 코드가 Windows error1314를 skip 처리)으로 실행되지 않았다. 나머지 독립 프로세스 읽기 잠금·write/rename/replace/delete 차단 검사는 통과했다.

SDK 오류 5개는 모두 `unittest.mock.patch('comfy_sdk.Comfy', ...)`에서 발생한 `ModuleNotFoundError: No module named 'comfy_sdk'`다. 취소 전/후, expired job, 키 상속 차단, 불확실 제출 실패의 assertion까지 도달하지 못했다. SDK나 proxy를 흉내 낸 패키지로 대체하지 않았고 의존성도 설치하지 않았다.

## 테스트 기준과 재현

각 검사 **직전** 소스·테스트·웹 원본·생성 HTML·config 등 50개 파일의 SHA256/크기/mtime와 시각을 JSON으로 저장하고 직후 다시 비교했다. 4개 검사 모두 내용 변경 0개였다. 이 기준은 동시 작업 후 최종 통합본의 승인과 구분해야 한다.

후속 10:45:08 점검에서는 디자인 담당 범위인 `web/src/index.template.html`과 `web/src/style.css` 두 파일이 검사 기준 이후 변경된 것을 확인했다. 검사 도중의 변경은 아니며 이 QA 담당은 해당 파일을 수정하지 않았다. 나머지 기준 파일 48개와 `runtime/config.json`의 hash는 유지됐다. 최종 화면·빌드 판정은 이 두 파일 변경을 포함한 통합본에서 수행해야 한다. 파일별 검사 당시/현재 hash는 `work/team-resume/qa/final-review.json`에 있다.

공통 aggregate SHA256: `ab43d96f530870c852553972bbca1a7087908f456f14cbae5545bb86ffd9f0bc`.

`work/team-resume/qa/20261020T104118+0900/`에 `source-initial.json`, `source-final.json`, 검사별 `*.before.json`, `*.after.json`, `*.log`, Python `*.result.json`, 전체 `summary.json`을 보존했다. `summary.json`에는 각 실행 파일·인수·cwd·시작/종료 시각·종료 코드가 모두 있다. 수집기 자체의 exit0은 증거 저장 성공을 뜻하며 SDK suite의 exit1을 덮어쓰지 않는다.

실제로 실행한 수집 명령:

```powershell
& 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' -B -X utf8 D:/Pankeki/work/team-resume/qa/run_regressions.py
& 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' -B -X utf8 D:/Pankeki/work/team-resume/qa/audit_dependencies.py
& 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' -B -X utf8 D:/Pankeki/work/team-resume/qa/finalize_evidence.py
& D:/Pankeki/work/team-resume/qa/capture_environment.ps1
```

첫 명령은 기존 unittest discover 대상 3개와 Node `--test web/tests/profiles.test.cjs scripts/test_ui_state.cjs`를 실행한다. 기존 테스트 파일은 수정하지 않았다. 소유 범위를 지키기 위해 QA wrapper가 `TemporaryDirectory` 위치만 `work/team-resume/qa/<실행시각>/tmp/`로 옮겼고 bytecode 생성을 비활성화했다. 실제 assertion, 파일 잠금, PNG/SQLite, subprocess 동작은 기존 검사 그대로다.

## 누락 의존성과 다음 작업

번들에는 Pillow 12.3.0과 NumPy 2.3.5가 실제 import된다. 앱 lock의 NumPy는 2.5.4이므로 이번 결과는 원래 환경과 버전까지 같은 재현이 아니다. websocket-client·comfy-sdk·comfy-api-proxy·torch·aiohttp·pytest는 번들에 없다. 오프라인 unittest와 Node 검사는 pytest나 GPU 패키지를 요구하지 않아 실행할 수 있었다.

`work/team-resume/qa/dependency-audit.json`에 세 lock의 항목별 비교를 남겼다. 앱 3개 중 번들 동일1/다른 버전1/누락1, SDK 23개 중 동일3/다른 버전2/누락18, Comfy 86개 중 동일6/다른 버전4/누락76이다. 세 전용 venv는 모두 없으므로 이 숫자는 번들 재사용 가능성의 비교다.

`work/team-resume/qa/dependency-resume.md`에 **실행하지 않은** 복원 명령, 패키지 전체 목록 위치, 다운로드 예산을 정리했다. 모델 원본은 두 파일 합계 약11.32 GiB, 새 앱 환경 약15–50 MiB, SDK 약5–30 MiB, Comfy/CUDA 패키지 약3–10 GiB(모델 제외)를 예상한다. 패키지 범위는 로컬 lock 기반의 예산이며 현재 네트워크에서 확인한 실측 크기가 아니다.

총괄의 다음 순서:

1. 기능·디자인 변경을 통합한 뒤 최신 소스로 같은 회귀를 다시 확인하고 최종 웹 빌드/화면 검증을 수행한다.
2. 환경 복원 범위를 정하면 세 격리 venv와 모델 보존본 또는 다운로드를 복원한다. SDK 브리지의 남은 5개를 우선 재검증한다.
3. 실제 서버 재개 때 새 listener PID와 파일 기준 manifest를 만든다. 현재 `runtime/config.json`은 수정하지 않았으며 예전 guard를 재사용하면 안 된다.
4. 실제 GPU·SDK 전체 경로 및 이미지 품질은 별도 검증한다. 저장된 비교 9개를 자동 재실행하지 않는다.

## 실제 변경 범위와 한계

추가한 파일은 이 인계와 `work/team-resume/qa/` 안의 환경 수집·기존 테스트 실행·의존성 비교 도구, 로그/해시/결과 JSON, 복원 계획뿐이다. QA 도구는 `capture_environment.ps1`, `run_regressions.py`, `run_python_suite.py`, `audit_dependencies.py`, `finalize_evidence.py`다. 최종 증거 일관성 점검은 `work/team-resume/qa/final-review.json`에 남긴다.

생산 코드·다른 담당 테스트·`runtime/config.json`·이전 실험 증거·복구 기준 백업은 수정하지 않았다. 설치/다운로드/원격 게시/실제 서버 실행/실제 GPU 생성은 수행하지 않았다. 이번 결과는 오프라인 기능 회귀의 1차 기준이며 브라우저 렌더링, 복원 후 공식 SDK 라이브러리, 현재 모델 추론과 이미지 품질의 통과 판정은 포함하지 않는다.

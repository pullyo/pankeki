# Pankeki 앱과 SDK 환경 복원 및 사용 검증

2026-10-20 KST 10:53 기준, 새 사용자 요청에 따라 앱·SDK 전용 가상환경 두 개를 기존 lock으로 복원했다. **SDK 브리지 12개가 모두 통과해 이전 `comfy_sdk` 누락 오류 5개가 해결됐다.** 앱·워크플로·Node 회귀를 합쳐 기존 검사 198개 중 197개 통과, Windows symlink 권한 부족 skip 1개, 실패·오류 0개다. 실제 SDK로 오프라인 그래프를 생성·수정했고 proxy CLI도 실행 확인했다. 총괄 검토를 기다린다.

## 설치한 환경과 범위

| 대상 | 실제 실행기 및 설치 결과 |
| --- | --- |
| 앱 | `D:/Pankeki/.venv/Scripts/python.exe`, Python 3.12.14. numpy 2.5.4, pillow 12.3.0, websocket-client 1.9.2 설치 |
| SDK | `D:/Pankeki/integrations/comfy-sdk/.venv/Scripts/python.exe`, Python 3.12.14. 기존 SDK lock 23개 항목 모두 같은 버전으로 설치 |
| SDK 핵심 | comfy-sdk 0.5.0, comfy-api-proxy 0.1.6, aiohttp 3.14.5, httpx 0.28.1, pydantic 2.14.1 등. 전체 목록은 SDK freeze 및 설치 report에 보존 |
| 격리 | 두 `pyvenv.cfg` 모두 `include-system-site-packages = false`. `sys.prefix`는 각 프로젝트 venv, `sys.base_prefix`는 기존 번들 Python |
| 전역/번들 Python | 전역 pip install 없음. 설치 전후 번들 배포판 이름·버전 목록 동일 |
| 제외 범위 | `.venv-comfy`, CUDA/PyTorch, 모델 가중치, MoE, REA, Codex 설정은 설치·변경하지 않음 |

설치 전 명령을 검토하고 앱 3개·SDK 23개 lock에 torch/CUDA/모델 의존성이 없는 것을 확인했다. 공식 PyPI 인덱스와 binary wheel만 사용했다. SDK와 proxy의 두 항목에는 기존 provenance의 직접 wheel URL과 SHA256을 적용하고 원본 lock을 constraints로 함께 전달해 버전 변경을 막았다. 원본 lock·provenance 파일은 수정하지 않았다.

26개 wheel의 QA 캐시 원본 크기 합은 **24,635,646 bytes, 약23.49 MiB**다. 이는 SHA256으로 설치 report와 매칭한 wheel archive 크기이며 HTTP 메타데이터 등 전체 네트워크 전송량은 아니다. 캐시와 로그도 `work/team-resume/qa-tooling/` 안에만 저장했다.

## GitHub 출처와 wheel 검증

공식 GitHub에서 필요한 두 프로젝트와 고정 릴리스를 찾아 현재 출처를 확인했다. 저장소 main으로 임의 업그레이드하거나 출처가 다른 대체 패키지를 설치하지 않았다.

| 도구 | 공식 고정 릴리스 | 릴리스 target commit |
| --- | --- | --- |
| Comfy Python SDK | [Comfy-Org/comfy-python-sdk v0.5.0](https://github.com/Comfy-Org/comfy-python-sdk/releases/tag/v0.5.0), 2026-10-10 UTC 게시 | `6d2dd7233dfa0a1abdf199beada55b2282e26b44` |
| Comfy API proxy | [Comfy-Org/comfy-api-proxy v0.1.6](https://github.com/Comfy-Org/comfy-api-proxy/releases/tag/v0.1.6), 2026-08-19 UTC 게시 | `c2219275e1ec7938069c52d063c3365e6d870c8c` |

설치된 배포판의 `Project-URL: Repository`가 기존 provenance 및 공식 GitHub와 일치한다. 두 wheel의 실제 archive SHA256도 기존 기록과 같다.

- comfy-sdk 0.5.0: `dfcd3ab026cfc42e83681148766fe8b3d619fdc476ec995e793c1efcab2fd1c5`
- comfy-api-proxy 0.1.6: `1ea405f1a4dc5886d06d630bc1de57fd8754062776ace797e66969636ca941c6`

추가로 실제 설치된 두 패키지의 `__init__.py`를 공식 릴리스 태그의 `src/comfy_sdk/__init__.py`, `src/comfy_api_proxy/__init__.py`와 비교해 바이트 단위 일치를 확인했다. wheel 전체는 보존된 provenance hash로 검증했고 GitHub 원문 대조는 위 두 파일에 대한 것이다. GitHub 응답은 `github-*.json`, pip 원본은 `app-install-report.json`, `sdk-install-report.json`에 보존했다.

## 실제 사용과 회귀검증 결과

검증 실행은 KST 10:52:32–10:52:41이다. 모든 개별 명령과 수집기의 종료 코드는 0이었다.

| 검사 | 실행 환경 | 결과 |
| --- | --- | --- |
| SDK 브리지 기존 12개 | 새 SDK venv | 12/12 통과. 이전 누락 오류 5개 모두 해결 |
| 앱 Python 전체 | 새 앱 venv | 111개 실행, 110 통과·1 skip, 오류/실패 0 |
| GitHub 워크플로 브리지 | 새 앱 venv | 17/17 통과 |
| 프로젝트·UI 상태 Node 회귀 | 기존 Node v24.19.0 | 58/58 통과 |
| 앱 `pip check` | 새 앱 venv | `No broken requirements found.` |
| SDK `pip check` | 새 SDK venv | `No broken requirements found.` |
| 실제 SDK 오프라인 사용 | 새 SDK venv | 실제 `Comfy`와 `Workflow`로 `from_json`·`set_input` 실행, seed 변경·출력 연결 보존 확인 |
| proxy CLI 사용 | 새 SDK venv | `python -m comfy_api_proxy.cli --help` 정상 종료, run/start/stop/status 명령 확인 |

SDK 브리지의 기존 12개는 실제 라이브러리를 import한 상태에서 제출·작업 응답을 mock하는 계약 검사다. 이를 보완한 별도 smoke에서는 실제 설치된 SDK의 클라이언트·워크플로 객체를 직접 사용했다. smoke는 Python audit hook으로 DNS/연결 시도를 거부한 상태에서 통과했으며 제출·추론은 0회다. 따라서 이번 결과는 실제 GPU나 서버 연결 성공을 뜻하지 않는다.

skip 1개는 `test_file_symlink_is_rejected_without_modifying_target`의 Windows symlink 생성 권한 부족이다. 기존 독립 프로세스 파일 잠금, PNG/SQLite, SDK subprocess 경계 검사 등은 통과했다. 기존 테스트 소스와 assertion은 수정하지 않았고, 임시 fixture 디렉터리만 새 QA 경로로 옮겼다. 검사 종료 후 남은 fixture 파일은 없다. 실제 ComfyUI·proxy·앱 서버는 시작하거나 재시작하지 않았다.

## 실행 명령과 로그

프로젝트 루트 `D:/Pankeki`에서 다음 명령을 실행했다. 가상환경 생성 도구는 이미 존재하는 환경을 덮어쓰지 않는다.

```powershell
$qaPython = 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
& $qaPython -B -X utf8 D:/Pankeki/work/team-resume/qa-tooling/prepare_restore.py
& D:/Pankeki/work/team-resume/qa-tooling/install_locked.ps1 -Target app
& D:/Pankeki/work/team-resume/qa-tooling/install_locked.ps1 -Target sdk
& $qaPython -B -X utf8 D:/Pankeki/work/team-resume/qa-tooling/verify_restored.py
& $qaPython -B -X utf8 D:/Pankeki/work/team-resume/qa-tooling/finalize_tooling.py
```

앱 최초 설치 시도는 샌드박스의 PyPI 연결이 WinError10013으로 차단돼 종료1이었다. 실제 escalation 절차로 재실행한 앱 설치와 SDK 설치는 모두 성공했다. 실패 로그를 덮어쓰지 않고 `app-install-01.log`, 성공한 `app-install-02.log`, `sdk-install-01.log`와 대상별 `*-install-attempts.json`에 각각 보존했다. 해당 제한을 패키지 버전 부재로 분류하지 않았다.

핵심 결과 파일:

- `work/team-resume/qa-tooling/restore-inputs.json`: 원본 lock hash·버전·기존 provenance·설치 검토
- `work/team-resume/qa-tooling/verification-20261020T105232+0900/`: 검사별 전체 stdout/stderr, Python 결과 JSON, freeze, runtime inventory, 명령별 전후 소스 snapshot
- `work/team-resume/qa-tooling/verification-summary.json`: 13개 개별 명령의 실제 인수·시각·종료 코드, lock 일치·환경 격리 확인
- `work/team-resume/qa-tooling/tooling-final-review.json`: 최종 197통과/1skip, 출처/hash 및 캐시 용량 대조

## 소스 기준과 실제 변경 파일

설치 직전 KST 10:50:24에 생산 소스·테스트·웹 원본/생성 HTML·lock·config·SDK provenance 등 **51개 파일**의 SHA256, 크기, mtime를 저장했다. 각 검증 명령 직전/직후에도 저장했고 KST 10:53:47 최종 대조까지 내용 변경 0개였다.

공통 aggregate SHA256: `a680b7275ca8042e5c060ff43cd45510babc64d0247d5ac2c1a22f6f38428821`.

실제 생성 범위는 다음과 같다.

- `D:/Pankeki/.venv/`: 앱 전용 Python 환경
- `D:/Pankeki/integrations/comfy-sdk/.venv/`: SDK 전용 Python 환경
- `D:/Pankeki/work/team-resume/qa-tooling/`: 설치/검증 도구 8개, hash가 포함된 SDK 설치 입력, 출처·설치·검증 JSON과 로그, 작은 pip 캐시
- `D:/Pankeki/docs/handoffs/resume-qa-tooling.md`: 이 인계

QA 도구는 `prepare_restore.py`, `install_locked.ps1`, `source_snapshot.py`, `run_python_suite.py`, `probe_runtime.py`, `sdk_offline_smoke.py`, `verify_restored.py`, `finalize_tooling.py`다. 기존 `work/team-resume/qa/` 및 이전 인계/실험 증거는 그대로 보존했다. 생산 코드, 다른 담당 소스/테스트, `runtime/config.json`, 원본 lock, 모델, 복구 기준 백업은 수정하지 않았다.

## 남은 한계와 다음 작업

앱과 SDK의 작은 패키지 복원은 완료됐다. `.venv-comfy`와 두 이미지 모델은 여전히 없으므로 실제 proxy↔ComfyUI↔GPU 생성 전 구간은 아직 미검증이다. 대규모 환경과 모델 복원은 이번 범위에서 수행하지 않았다.

총괄은 이후 변경 통합 시 같은 회귀를 최신 기준으로 확인하고, 별도로 Comfy/CUDA·모델 복원 범위를 정하면 된다. 실제 서버를 재개할 때에는 저장된 옛 PID/guard 대신 새 listener PID·파일 기준 manifest를 사용해야 한다. 저장된 비교 9개는 자동 재실행하지 않았다. REA 설치·Codex 설정 작업도 중복하지 않았다.

# Pankeki 출시 재현 및 통합 절차

2026-10-20 KST, 총괄 검토용 절차다. 지금 실행 가능한 읽기 전용/로컬 증거 검사를 먼저 적고, 환경 복구 뒤 실행할 앱 검증은 구분했다. 이 문서 작성 중 새 설치·서비스 시작·GPU 추론은 하지 않았다.

## 이번 검토 재현

프로젝트 루트에서 PowerShell로 실행한다. 세 스크립트는 `work/team-resume/release/`에만 결과를 쓴다. 첫 명령은 파일 hash/텍스트 검사이며 세 번째 명령도 저장된 결과만 읽는다.

```powershell
Set-Location -LiteralPath 'D:/Pankeki'
& './work/team-resume/release/audit-local.ps1'
$releasePython = 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
& $releasePython -B './work/team-resume/release/check-config-compatibility.py'
& $releasePython -B './work/team-resume/release/check-existing-evidence.py'
```

현재 로컬 번들 실행기 경로이며 공개 README에 고정해서 넣지 않는다. 다른 PC는 사용 가능한 Python 3.12를 지정한다. 스크립트는 표준 라이브러리만 사용하며 bytecode 생성을 끈다.

| 명령 | 이번 결과 | 저장 근거 |
| --- | --- | --- |
| `audit-local.ps1` | exit 0. 게시 manifest 53/53 일치, 전체 54개 비교 34동일/13변경/7스냅샷 전용. 공개 스캔 0건, 최신 대응 후보의 개인 경로 1건 | `local-comparison.json`, `publication-static-scan.json`, `current-candidate-static-scan.json`, `audit-summary.json` |
| `check-config-compatibility.py` | exit 0. 기존 공개 설정 2개 모두 최신 UI에 쓸 기본 모델 없음 | `config-compatibility.json` |
| `check-existing-evidence.py` | exit 0. 저장 PNG 9/9 hash 일치, SDK 9/native sampler 9. 공개 이미지 2개에 잠재 text/EXIF chunk 없음 | `existing-evidence-check.json`, `public-image-metadata.json`, `runtime-config-shape.json` |

차이의 원문은 필요한 파일만 다음처럼 읽는다. `git diff --no-index`의 exit 1은 차이가 있다는 뜻이다. 파일을 변경하지 않으며 `.git` 없이도 실행된다. 향후 민감값 가능성이 있는 파일은 diff 원문을 로그로 저장하지 말고 경로/조치만 남긴다.

```powershell
git -c core.autocrlf=false diff --no-index -- work/publication/repo/pankeki/engine.py pankeki/engine.py
git -c core.autocrlf=false diff --no-index -- work/publication/repo/pankeki/server.py pankeki/server.py
```

QA 결과는 최신 인계와 `latest-run.json`을 읽는다. 테스트를 이 담당이 중복 실행하지 않는다.

```powershell
Get-Content -LiteralPath 'docs/handoffs/resume-qa.md'
$releaseQaRun = Get-Content -LiteralPath 'work/team-resume/qa/latest-run.json' -Raw | ConvertFrom-Json
Get-Content -LiteralPath (Join-Path $releaseQaRun.output 'summary.json')
```

민감값 검사는 매칭 값과 줄 내용을 저장하지 않고 경로·행·규칙만 기록한다. 다른 파일을 공개 후보에 추가하면 그 파일도 새로 스캔해야 한다. 현재 스캔 결과를 범위 밖 내부 자료까지 확장하지 않는다.

## 환경 복구 뒤의 실행 검증

이 구간은 **현재 실행하지 않은 후속 절차**다. 모델/대규모 패키지 다운로드와 GPU 비교 자동 재실행은 첫 작업 범위 밖이다. 필요한 환경 조달 범위는 총괄이 기존 사용자 지시와 환경팀 결과를 바탕으로 정한다.

1. 환경 담당의 최신 결과로 앱/Comfy/SDK venv, 실제 checkpoint, 드라이버, 여유 메모리와 포트 상태를 확인한다. 과거 PID와 environment process JSON을 현재 프로세스 증거로 재사용하지 않는다.
2. 관리형 개발 환경을 복구하는 경우 `shutdown-checkpoint.md`의 Comfy 실행 옵션을 따른다. 새 Comfy listener를 확인하고 새 PID로 manifest를 만든다. 원본 `prepare_manifest.py`는 단일 Turbo 구성을 만들며 `work/quality-improvement/configure-models.py`를 이어 실행해야 두 모델이 구성된다. 이 유틸리티는 SDK transport를 자동 설정하지 않는다.
3. 새 로컬 config에 `transport=sdk`를 명시하고 proxy→앱 순서로 시작한다. `work/quality-improvement/activate-sdk.ps1`는 기존 앱 재시작용이므로 재부팅 후 빈 상태의 시작 명령으로 쓰지 않는다. 백그라운드 프로세스는 숨김 창으로 시작한다.
4. 신규 공개 사용자에게는 이 개발용 관리형 절차를 통째 요구하지 않는다. R02의 일반화한 설정/해시 절차가 먼저 필요하다. 실제 파일을 검증하지 않고 manifest 값을 복사하거나 `managed_builtin_only=true`로 만들지 않는다.

개발 관리형 환경이 이미 복구돼 실행기를 갖춘 뒤에만 다음 형태로 진행한다. `$releaseComfyPid`는 확인한 새 listener ID다. 이 문서에는 과거 PID를 넣지 않는다.

```powershell
Set-Location -LiteralPath 'D:/Pankeki'
$releaseComfyPid = (Get-NetTCPConnection -State Listen -LocalPort 8188 -ErrorAction Stop |
    Select-Object -First 1).OwningProcess
# 해당 listener의 소유 프로세스/실행 옵션이 이 프로젝트의 새 Comfy인지 먼저 확인한다.
& './.venv/Scripts/python.exe' './scripts/prepare_manifest.py' --pid $releaseComfyPid --fingerprint-policy windows_read_lock
& './.venv/Scripts/python.exe' './work/quality-improvement/configure-models.py'
$releaseConfigPath = Join-Path (Get-Location).Path 'runtime/config.json'
$releaseConfig = Get-Content -LiteralPath $releaseConfigPath -Raw | ConvertFrom-Json
$releaseConfig | Add-Member -MemberType NoteProperty -Name transport -Value sdk -Force
$releaseConfig | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $releaseConfigPath -Encoding utf8
& './integrations/comfy-sdk/start-proxy.ps1'
& './scripts/start-pankeki.ps1'
```

앱 실행 명령은 foreground이므로 아래 읽기 전용 확인은 다른 터미널에서 한다.

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:8188/queue' -TimeoutSec 5
Invoke-RestMethod -Uri 'http://127.0.0.1:8189/api/v2/health' -TimeoutSec 5
Invoke-RestMethod -Uri 'http://127.0.0.1:8190/api/health' -TimeoutSec 5
Invoke-RestMethod -Uri 'http://127.0.0.1:8190/api/models' -TimeoutSec 5
```

기대값은 proxy `status=healthy`, 실제 upstream 일치, 앱 `comfy=true/transport=sdk`, 구성한 기본 모델 일치, 두 모델을 모두 준비한 경우 각 `available=true`다. `/api/health`의 HTTP 200만 보고 통과로 표시하지 않는다. queue가 비어 있다는 사실도 이미지 생성 성공을 뜻하지 않는다.

새 실생성이 필요한 경우 한 번의 목적을 정한 SDK smoke에서 job→SDK receipt→native sampler→PNG를 연결한다. 9개 비교는 이미 완료됐으므로 재실행하지 않는다. `compare-app-models.py --run`을 일반 smoke 명령에 넣지 않는다. 코드/모델을 수정한 뒤에는 앱을 재시작하고 변경 대상에 맞는 검증을 수행한다.

## 총괄 통합 순서와 중단 기준

1. 기능·디자인·환경·기획 인계를 읽고 현재 수정 파일과 미해결 항목을 확정한다. 이 자료의 비교 해시는 1차 검사 시점이므로 최종 소스 확정 후 다시 만든다.
2. 기능 담당의 모델/엔진/JS와 디자인 담당의 템플릿/CSS 계약을 확인한다. 선택된 로고, 후보 비교, 마스크 밖 보존, 프로젝트 저장 기능을 유지한다.
3. 총괄이 디자인 담당에게 최종 `web/build.py` 실행을 요청한다. 이 출시 담당은 `web/index.html`을 만들거나 덮어쓰지 않는다. 소스 변경과 빌드 산출물의 시점을 맞춘다.
4. QA가 변경 범위에 맞는 회귀를 검증한다. 현재 SDK bridge 환경 부족 5 error와 symlink skip을 해소/분리한다. 결과가 최종 소스와 다르면 관련 검사만 다시 한다.
5. 실제 브라우저에서 1440/390px 모델 선택·설정 복원·오프라인 안내, 후보 비교·JSON 재열기·보드 PNG, 취소/오류를 확인한다. 서비스/모델 복구 후 SDK smoke는 별도 기록한다.
6. 총괄이 기존 공개 문서 7개를 보존한 새 선별 후보를 준비한다. 신규 preset을 포함하고 R01–R12를 반영한다. 전체 개발 폴더나 `work/`를 공개본으로 복사하지 않는다.
7. 후보의 파일 allowlist, 실제 hash, 비밀값/개인경로 검사, 이미지/문서 내용과 모델·라이선스 고지를 검토한다. 생산 코드와 다른 공개 문서 경로를 수정했는지 기록한다. 패키지/weight/cache와 내부 대화 자료가 들어가면 중단한다.
8. 기획팀의 최신 공식 대회 요건 결과를 반영한다. 기존 문서의 시간·길이·태그·적격 기준은 재확인 전 확정하지 않는다. 영상은 기능 성공과 이미지 품질 실패, LLM 미연결을 정확하게 설명하는 구성으로 준비한다.
9. 총괄이 검증 가능한 공개 후보와 릴리스 설명을 최종 검토한다. 이 담당의 종료 상태는 여기까지의 준비 자료 제출이다. 원격 게시/push/대회 제출/타인 메시지는 실행하지 않는다.

필수 중단 조건은 최신 소스 누락, 기존 예제로 GUI 생성 불가, SDK 실제 경로 미확인, 개인 데이터 포함, 모델/자체 코드의 조건 혼동이다. 품질 한계가 남은 개발 스냅샷은 그 한계를 명확하게 설명해야 하며 수상 수준/완성 원화 품질로 소개하지 않는다.

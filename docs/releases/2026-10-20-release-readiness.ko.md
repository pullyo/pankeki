# Pankeki 공개 갱신 준비 검토

2026-10-20 KST, 출시 준비 담당의 첫 검토다. **기존 개발 스냅샷의 다음 공개 갱신은 설정 예제와 실행 안내를 함께 고친 뒤 검토한다.** 최신 소스에는 SDXL 선택이 구현돼 있지만 기존 공개 예제 설정을 그대로 붙이면 새 화면에서 사용할 모델이 없다. 현재 PC에는 모델 가중치와 프로젝트 가상환경도 복구되지 않았다. 저장된 이미지와 과거 실행 증거는 확인할 수 있다.

이 검토는 로컬 파일 기준이다. 원격 main 조회, 설치, 다운로드, 서비스 시작, GPU 생성, push, 제출은 수행하지 않았다. 생산 코드와 기존 README, 공개 스냅샷, QA 자료를 수정하지 않았다. 복구 기준 백업도 건드리지 않았다.

## 비교 기준과 파일 상태

현재 소스는 `D:/Pankeki`, 비교 대상은 `work/publication/repo`다. 두 폴더 모두 `.git`이 없어 복원본 자체의 커밋을 확정할 수 없다. [게시 기록](../../work/publication/PUBLISHED.md)은 2026-10-19 main 커밋 `869a6f852f2d13595d5af503261080de99dc6d7f`, 업로드 53개를 기록한다. **이 기록을 현재 원격 main 상태로 해석하지 않는다.**

검사 시각은 `work/team-resume/release/local-comparison.json`에 UTC로 기록했다. 원본 해시는 동시 작업 이후 다시 확인해야 한다.

| 확인 항목 | 로컬 결과 |
| --- | --- |
| 게시 검토 manifest의 53개 파일 | 전부 존재하고 기록된 SHA256과 일치 |
| 공개 스냅샷의 실제 파일 | 54개. 추가 1개는 게시 목록에 없는 생성 산출물 `web/index.html` |
| 스냅샷 전체와 같은 상대 경로의 최신 소스 | 동일 34개, 변경 13개, 공개 스냅샷에만 존재 7개 |
| 게시 목록 53개만의 비교 | 동일 34개, 변경 12개, 공개 스냅샷에만 존재 7개 |
| 핵심 소스 범위의 최신본 전용 파일 | 27개. `pankeki`, `web`, `tests`, `examples`, `scripts` 범위이며 내부 work 전체의 차이 수가 아님 |
| 해시 검사 도중 비교 대상 변경 | 0개. 검사 이후의 편집까지 동결했다는 뜻은 아님 |

공개본 전용 7개는 `README.md`, `LICENSE`, `THIRD_PARTY.md`, `docs/VALIDATION.md`, `docs/images/studio-preview.png`, `examples/direct-config.json`, `examples/sdk-config.json`이다. 공개 준비 과정에서 만든 문서/예제이므로 최신본으로 통째 덮어쓰면 없어질 수 있다.

## 공개 뒤 추가되거나 달라진 핵심 내용

| 경로 | 최신 소스의 차이 | 다음 공개본 반영 시 주의 |
| --- | --- | --- |
| `pankeki/model_presets.py` | 공개본에 없는 신규 모듈. 두 모델 ID, checkpoint 일치 검사, 개별 manifest와 SHA256 형식, available catalog, 프리셋 정의 | engine/server만 복사하면 import가 깨짐. 반드시 같이 반영 |
| `pankeki/engine.py` | 선택 모델 검증, 누락한 값에만 모델 기본값 적용, 모델별 lease와 캐시 의존성, metrics의 모델 기록 | 기존 단일 모델 요청 호환과 명시적 설정 보존. 모델 설치와 catalog 구성을 별도 설명 |
| `pankeki/server.py` | GET `/api/models`, health의 기본 모델, 큐 제출 전 모델 검증, bind 실패 정리 | 최신 UI와 서버를 함께 반영 |
| `web/src/app.js` | 모델 선택과 기본값 복원, sampler/scheduler 제출, 후보 모델 기록, catalog 실패 시 생성 차단 | 옛 예제 설정에는 catalog에 필요한 정보가 없어 GUI가 막힘 |
| `web/src/profiles.js` | 선택적 `model_id`를 프로젝트 request에 보존 | 예전 후보의 모델을 추정해 덧붙이지 않음 |
| `web/src/index.template.html` | 모델 선택, 모델 안내, 기본값 버튼과 sampler/scheduler 필드 | 디자인 담당 변경과 통합 후 최종 빌드 |
| `web/src/style.css` | 10월 20일 재개 작업 중 디자인 담당 변경이 추가됨 | QA 이후 템플릿/CSS가 바뀌었으므로 디자인 인계와 최종 빌드 기준으로 확인 |
| `tests/test_engine.py`, `tests/test_server.py`, `web/tests/profiles.test.cjs`, `scripts/test_ui_state.cjs` | 모델 선택/설정/저장/오류 회귀 추가 | 공개 검증 수와 실행 기준도 갱신 |
| `tests/test_model_lease.py` | 실행 동작이 아닌 환경 설명 주석 차이 | 61행의 개인 경로 표기를 다음 공개 복사본에서 일반화. 매칭 값은 이 보고서에 복사하지 않음 |
| `web/index.html` | 최신 소스로 빌드된 로컬 산출물 차이 | 게시 목록에서 계속 제외하고 최종 소스로 다시 빌드 |
| `runtime/config.json` | `transport=sdk`, `default_model_id=sdxl-base`, 두 모델 manifest와 과거 runtime guard를 포함 | 비공개 로컬 상태. 현재 두 가중치 경로는 파일이 없음. 그대로 공개하거나 guard를 재사용하지 않음 |
| `work/quality-improvement/configure-models.py` | 단일 Turbo manifest 뒤 두 모델 catalog를 구성하는 로컬 유틸리티 | `work/`는 공개 제외. 출시에 필요하면 일반화한 도구/설명으로 별도 준비 |

SDK 자체가 공개 뒤 새로 생긴 것으로 표현하면 안 된다. `pankeki/sdk_adapter.py`, `integrations/comfy-sdk/{bridge.py,start-proxy.ps1,requirements.lock.txt,test_bridge.py}`는 공개본과 최신본의 해시가 같다. 공개본에도 SDK 선택 경로가 있었다. 이후 달라진 핵심은 **모델 선택을 SDK 앱 경로와 함께 운용하는 catalog 및 설정**이다.

### 모델 설정과 SDK 경로

| 항목 | 최신 기록과 정적 코드 |
| --- | --- |
| SDXL Base 1.0 | `sdxl-base` / `sd_xl_base_1.0.safetensors`, 1024×1024, 25 steps, CFG 6, `dpmpp_2m/karras`, 편집 denoise 0.55 |
| SD Turbo | `sd-turbo` / `sd_turbo.safetensors`, 512×512, 1 step, CFG 1, `euler/normal`, denoise 1.0. 빠른 시안용 |
| 기본 모델 | 이전 실행의 로컬 config는 SDXL. 앱이 모든 설치에서 무조건 SDXL을 선택하는 것은 아님. catalog는 구성과 파일 존재 여부에 따라 기본 모델/available을 반환 |
| SDK 제출 | 앱 8190 → `pankeki/sdk_adapter.py` → `integrations/comfy-sdk/.venv/Scripts/python.exe` subprocess → 공식 SDK → proxy 8189 → ComfyUI 8188 |
| 부가 호출 | SDK adapter도 상태/manifest/native history 확인에는 native API를 사용. 모든 HTTP 호출이 SDK만 통과한다고 설명하지 않음 |
| SDK upstream | `127.0.0.1:8188` 또는 `localhost:8188`만 허용. proxy는 `127.0.0.1:8189`, 실제 upstream 검증 |
| 성공 기준 | SDK receipt와 native sampler 실행, 결과 PNG를 연결. 제출 오류 후 자동 재시도하지 않음. UI 취소는 전역 GPU interrupt가 아님 |

[설정 호환 검사 결과](../../work/team-resume/release/config-compatibility.json)는 공개본의 `examples/direct-config.json`, `examples/sdk-config.json` 모두 최신 catalog의 기본 모델이 `null`, 두 모델이 unavailable임을 재현한다. 두 예제에는 `model_name`만 있고 `model_path`와 manifest가 없다. ComfyUI에 해당 이름의 checkpoint가 있다는 설명만으로 새 GUI의 준비가 끝나지 않는다. 이는 옛 스냅샷 자체가 당시 실패했다는 판정과 구분한다.

## 공개 준비에 필요한 수정 목록

아래는 적용할 변경 제안이다. 이 담당은 원본/공개 복사본에 적용하지 않았다. 총괄이 담당별 소스를 통합한 뒤 공개 후보에서 반영한다.

| 우선순위와 ID | 대상과 구체적 수정 | 완료 판정 |
| --- | --- | --- |
| P0 R01 | 최신 engine/server/UI/테스트와 신규 `model_presets.py`를 한 묶음으로 선별 반영 | 새 catalog 및 이전 프로젝트 호환 회귀 통과 |
| P0 R02 | 공개 설정 예제를 두 모델 catalog 방식으로 갱신. 실제 설치 경로를 사용자가 채우고 실제 파일 hash를 만드는 절차 제공. managed guard가 없는 새 설치는 unmanaged로 취급 | 깨끗한 후보 폴더에서 `/api/models`에 설치한 모델이 available, UI와 request 모델 일치. 가짜 PID/hash/managed 표시 금지 |
| P0 R03 | README의 “기본 SD Turbo, 모델 선택 미완료” 설명을 새 구현에 맞게 갱신. SDXL/빠른 Turbo 표와 구성 조건, GPU/모델 미포함, 부분 수정 한계 명시 | README 명령으로 빌드/실행/모델 선택까지 재현 |
| P0 R04 | SDK 실행 안내에 고정 loopback 포트와 격리 interpreter 위치, 별도 SDK venv 설치 및 proxy health, `transport=sdk` 설정 순서 추가 | 올바른 config로 실제 앱 SDK 생성 1건과 native sampler/PNG 연결. 과거 9건은 재실행하지 않음 |
| P0 R05 | 공개 후보에서 `tests/test_model_lease.py:61`의 개인 경로 주석 일반화. 내부 문서/상태/산출물은 allowlist로 제외 | 값이 출력되지 않는 경로/비밀 패턴 재검사와 파일별 diff 검토 |
| P0 R06 | `THIRD_PARTY.md`에 SDXL Base 1.0 출처·파일명·검증 hash·CreativeML Open RAIL++-M 링크 추가. 작은 출처 기록을 `docs/models/` 같은 공개 허용 경로에 정리 | 두 모델의 출처와 조건이 구분되고 가중치는 없음. 원문/재배포 고지는 적용 범위 확인 후 보강 |
| P0 R07 | 새 PC 설치와 SDK 의존성/`pip check` 확인. 현재 누락 환경을 제품 결함 또는 통과로 바꾸지 않음 | QA 환경 기록 및 실제 설치 결과에 실행기·버전·경로·실패 원인 보존 |
| P1 R08 | README에 데이터 저장 안내 추가: 브리프/프롬프트/원본/마스크/결과는 로컬 runtime 및 브라우저 저장소, JSON에는 후보·브리프·메모·설정이 들어감. 공유 전 검토 및 로컬 삭제 위치 설명 | 사용자가 JSON/보드가 어떤 내용을 포함하는지 알 수 있음 |
| P1 R09 | 공개 `.gitignore`에 `*.pankeki.json`, 추가 weight 확장자/`.part`/개인 DB 등 보완하고 allowlist 정책 병기. 개발 루트 `.gitignore`를 공개 정책으로 그대로 교체하지 않음 | 제외 패턴 확인과 실제 후보 파일 목록 검토. 이미 추적된 파일은 ignore만으로 제거되지 않음 |
| P1 R10 | `docs/VALIDATION.md`를 새 후보의 실제 결과로 갱신. 과거/현재·unit/browser/GPU·skip/환경 오류를 분리 | 현재 QA와 최종 빌드 기준 해시가 연결됨 |
| P1 R11 | README 화면을 최종 빌드에서 다시 캡처하고 모델 설정이 보이는 예시 추가. 기존 선택 로고 유지 | 브리프/파일경로/대화/개인정보와 PNG 메타데이터 확인. 현재 생성 품질 한계를 함께 설명 |
| P1 R12 | 개발 루트 `README.ko.md`, `START-HERE.ko.md`, `docs/contest-context.ko.md`, SDK README의 과거 미구현/미공개 서술에 시점과 최신 문서 링크를 붙임 | 신규 담당이 옛 직접 연결/단일 Turbo 안내를 최신 실행법으로 오인하지 않음 |

R02는 모델 파일 이름만 바꾸는 수정으로 끝나지 않는다. catalog의 `model_name`, 실제 `model_path`, 모델별 manifest의 동일 이름과 실제 SHA256이 필요하다. 관리형 캐시를 쓰면 현재 Comfy 프로세스·소스·설정에 대한 새 guard도 필요하다. `prepare_manifest.py`는 로컬 Comfy checkout 및 환경 evidence에 의존하므로 현재 형태를 신규 사용자의 일반 설치 도구로 그대로 소개하지 않는다.

README 교체 문구의 기준은 다음과 같다.

> SDXL Base 1.0과 SD Turbo를 선택할 수 있습니다. 검증 당시 로컬 구성의 기본값은 SDXL Base 1.0이었으며, 새 설치에서는 실제 checkpoint와 모델 catalog 설정이 필요합니다. 모델 가중치와 실행 환경은 포함하지 않습니다. 저장된 SDK 생성 9건에서 실제 추론을 확인했지만, 색상·소품·재질을 포함한 전체 품질 기준을 만족한 이미지는 없었습니다. 로컬 대화 모델은 아직 연결되지 않았습니다.

## 라이선스 출처와 공개 제외 정책

이는 보존된 소스/고지의 정적 점검이다. 모델과 대회 조건의 최신 외부 확인은 이 작업에서 수행하지 않았다.

| 항목 | 현재 자료 | 보완 |
| --- | --- | --- |
| 자체 코드 MIT | 공개본 `LICENSE` 있음. 개발 루트에는 없음 | 선별 공개 후보에서 공개본 LICENSE를 유지. 루트 전체를 공개본으로 덮어쓰지 않음 |
| ComfyUI | 공개 `THIRD_PARTY.md`에 upstream GPL-3.0 및 별도 설치 표기 | 새 의존성 설치 재현 시 ref/설정 기록. upstream 소스·wheel을 새로 묶으면 해당 배포 고지 점검 |
| SDK/proxy | 0.5.0/0.1.6 lock과 MIT 원문 2개가 공개본에 있음 | 선택 설치/격리 경로와 실제 사용 버전을 맞춤 |
| SD Turbo | 공개 고지와 Powered by Stability AI 문구, 개발 `models/`에 원문·카드 있음 | MIT 코드와 모델 조건을 구분. 현재 공개 대상의 사용/배포 방식에 맞춰 고지 확인 |
| SDXL | 개발 `docs/licenses.ko.md`, `models/sdxl-base-provenance.json`에 출처·hash·조건 링크 있음. 공개 고지에는 없음 | R06. 가중치 미포함을 유지하고 작은 출처 문서만 선별 |
| CropAndStitch / WaveSpeed | 공개본에 pinned ref/라이선스 기록과 bridge만 있고 외부 소스는 없음 | lock의 과거 설치 상태를 현재 활성화 상태로 표시하지 않음 |
| Python 의존성 | 앱/SDK lock 존재. 원본 metadata는 내부 evidence에 있음 | wheel/패키지를 묶는 배포를 하면 배포물별 라이선스/NOTICE 점검. 설치 참조와 패키지 재배포를 구분 |
| 로고/화면 | 선택 로고와 실제 화면의 AI 생성 출처가 공개 THIRD_PARTY에 설명됨 | 선택하지 않은 시안, 원본 생성 대화, 개인 작업을 추가로 업로드하지 않음 |

공개본 54개 전체의 텍스트/경로 패턴 검사에서 비밀값·개인 경로·내부 채팅 ID 패턴은 0건이었다. 최신 대응 파일과 신규 preset 총 48개를 같은 규칙으로 검사하면 개인 경로 주석 1건이다. 매칭 값은 저장하지 않았으며 경로·행·조치만 `current-candidate-static-scan.json`에 기록했다. heuristic 검사는 비밀값 부재나 전체 개인정보 검토를 보장하지 않는다.

공개 화면 PNG는 육안상 계정·메일·개인 파일 경로가 보이지 않으며 샘플 캐릭터 작업과 대화 모델 미연결 상태가 표시된다. 공개 이미지 2개에는 tEXt/zTXt/iTXt/eXIf chunk가 없었다. 앞으로 추가할 이미지/동영상은 별도로 확인한다.

다음 공개 후보는 명시적 파일 목록으로 만든다. `runtime/`, `.venv*`, `models/` 가중치, `vendor/`, `evidence/`, `work/`, 내부 `docs/handoffs/` 및 팀 문서, 키/환경파일, 사용자 JSON/대화/업로드/마스크/캐시/로그/DB를 통째 복사하지 않는다. 이 출시 준비 자료 자체도 내부 작업 기록이다. 공개 문서는 필요한 내용만 경로와 개인 식별 정보를 정리하여 다시 작성한다. `.part`는 이름과 무관하게 weight일 수 있다.

프로젝트 JSON의 exported request에서 원본과 마스크를 제외하더라도 후보 이미지는 내장되고 브리프와 메모는 남는다. 보드 PNG도 선택 이미지와 메모를 포함할 수 있으므로 “개인정보가 없는 파일”이라고 안내하지 않는다. 로컬 운용이라는 설명을 인터넷 공개 서비스 보안 검토로 확대하지 않는다.

## 출시 준비표

| 항목 | 지금 가능한 시연 또는 확인 | 아직 필요한 검증 | 판정 |
| --- | --- | --- | --- |
| 저장된 이미지 9개 | 원본 PNG 9개 존재, 모두 기록 hash 일치. SDK transport 9건/native sampler 실행 9건 연결 | 사용자와 품질 확인. 엄격한 전체 요구 통과는 0건 | 기록 시연 가능 |
| 모델 UI | 저장된 1440/390px 화면 검사 report 통과, SDXL/Turbo 프리셋 기록 | 현재 디자인/기능 수정 통합 후 실제 브라우저 재확인 | 과거 증거 있음 |
| 프로젝트/비교/보드/오프라인 표시 | 구현과 자동 회귀가 있음 | 새 최종 빌드에서 import→비교→편집 준비→보드/JSON export→다시 열기 시연 | 현재 GUI 시연 미검증 |
| Python 핵심 | QA 1차 실행 111개 중 110 통과/1 skip | 최종 소스와 QA 최종 인계 확인 | 자동 회귀 근거 있음 |
| 외부 workflow bridge | QA 1차 17개 통과 | 실제 노드 설치/생성은 별도 | 자동 회귀 근거 있음 |
| UI 상태/프로필 | QA 1차 Node 58개 통과 | 실제 렌더링/키보드/390px 검증은 별도 | 자동 회귀 근거 있음 |
| SDK bridge | QA 1차 12개 중 7 통과/5 error, `comfy_sdk` 누락 | 격리 환경 복구 후 전체 통과와 `pip check`, 실제 SDK smoke | 환경 부족 |
| 새 GPU 생성/부분 수정 | 현재 가중치/세 venv 없음, QA 조사에서 8188/8189/8190 listener 없음 | 환경 복구, 새 guard, health/catalog, 목적을 정한 최소 smoke | 현재 재현 불가 |
| 세부 지시/재질/손 품질 | 과거 비교에서 구도 개선과 잔여 실패 설명 가능 | 색·소품 위치·재질의 가설별 품질 실험 | 품질 승인 보류 |
| 로컬 LLM/MoE | 미연결 안내만 가능 | 실행기/메모리/언어/구조화 요청/이미지 연결 검증 | 미완료 |
| 신규 PC 설치 | 문서와 코드 정적 점검 | 깨끗한 환경에서 두 모델/SDK 경로 재현 | 미검증 |
| 공개 후보 갱신 | 기존 53개 manifest와 차이 확인 가능 | R01–R07, 최종 build/회귀/개인정보 확인 | 총괄 검토 대기 |
| 대회 적격/마감/제출물 | 기존 contest 문서에 기록 있음 | 기획팀의 공식 요건 재확인 및 총괄 판단 | 재확인 대기 |

QA 수치는 `work/team-resume/qa/20261020T104118+0900/summary.json`과 [QA 최종 인계](../handoffs/resume-qa.md)에서 확인했다. 합계 198개 중 192통과/SDK 의존성 오류 5/권한 skip 1이다. `final-review.json`은 검사 이후 `web/src/index.template.html`, `web/src/style.css` 두 파일 변경을 기록한다. 10:48 KST 출시 비교를 갱신해 위 수치에 반영했으나, QA 회귀가 이 새 디자인 소스를 검증한 것은 아니다. 최종 빌드와 화면 확인이 필요하다. 번들 NumPy 2.3.5는 앱 lock의 2.5.4와도 다르다. QA 파일은 읽기만 했다. 과거 SDK 성공은 현재 누락 환경을 통과시켜 주지 않으며, 현재 누락은 과거 9건의 성공을 부정하지 않는다.

기존 대회 문서의 Router/SDK, 공개 코드/workflow/OSS 라이선스/로컬 설치 안내, 2분 이하 영상·해시태그, 마감과 참가 자격은 모두 **공식 재확인 대기**다. 기획팀이 확인하므로 같은 외부 조사는 하지 않았다. 제출 또는 타인에게 게시할 문구는 총괄이 공식 요건과 실제 검증 결과를 합쳐 확정한다.

재현 명령과 총괄 통합 순서는 [출시 재현 및 통합 절차](2026-10-20-release-runbook.ko.md)를 따른다.

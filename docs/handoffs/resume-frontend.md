# 프론트엔드 구현 담당 1차 인계 — 2026-10-20 KST

**1차 조사·검증 완료, 총괄 검토 대기. 재현된 제품 결함이 없어 생산 코드와 기존 테스트를 수정하지 않았다.** 기존 상태·프로젝트 58개, 기존 보드 11개, 추가 상태 8개, 보드 본문 일치 1개를 합쳐 **78개 통과, 실패·취소·건너뜀 0개, exit0**다. 이번 실행은 실제 브라우저 렌더링·현재 SDK/서버·GPU 추론의 성공 증거가 아니다.

## 인계 및 소유권 확인

`TEAM-OPERATIONS.ko.md` → `shutdown-checkpoint.md` → `TEAM-CONTEXT.ko.md` 순으로 읽었으며 최신 체크포인트를 우선했다. 기능 담당의 `resume-function.md`에서 네 파일의 생산 코드·테스트 변경 없음, 진행 중 수정/검증 없음, 즉시 인계 가능을 확인한 후 작업했다.

수정 소유 범위는 `web/src/app.js`, `web/src/profiles.js`, `web/tests/profiles.test.cjs`, `scripts/test_ui_state.cjs`다. 실제로 네 파일을 변경하지 않았고, 기능 담당이 남긴 `saved-evidence-audit.json`의 SHA256과 네 파일 모두 일치한다. HTML/CSS, 빌드, `web/index.html`, 백엔드, 다른 담당 문서와 복구 기준 백업을 수정하지 않았다. 새 채팅·하위 에이전트·외부 메시지·다운로드·서버 시작·GPU 생성·원격 게시도 수행하지 않았다.

## 검사 결과와 근거

| 영역 | 코드 경로 및 실제 검사 결과 |
| --- | --- |
| 생성·취소·늦은 응답 | `generate`가 검증 후 배치 `serial`을 만들고, POST 응답·poll·결과 파일 읽기·이미지 decode 뒤마다 같은 serial인지 확인한다. POST 대기 중 취소된 요청도 나중에 수락된 job id를 취소한다. 기존 테스트에 더해 결과 읽기/디코딩 중 취소와 새 성공 뒤 도착한 이전 POST 실패를 확인했다. 늦은 결과·오류가 새 후보/상태를 덮지 않았으며 후속 후보 POST도 없었다. |
| 모델 전환과 스냅샷 | `requestSnapshot` + `makeRequests`가 모델·설정·컴파일 프롬프트·원본·마스크를 캡처한다. SDXL 배치 첫 작업 대기 중 Turbo/steps/negative/brief/마스크를 바꿔도 둘째 요청은 seed만 +1인 원래 SDXL 요청이었다. 두 후보의 모델/설정/brief/parent 기록이 일치하고 다음 새 요청은 Turbo와 새 steps를 사용했다. |
| 후보 비교 | 두 후보 선택과 비교 이미지 원본 유지, 최대 두 개, 선택 기록과 export, 키보드 초점 보존은 기존 테스트로 확인했다. 모델 catalog가 없을 때도 내장 프로젝트 이미지를 복원·비교·내보낼 수 있고 생성은 차단됨을 추가 확인했다. |
| 원본·마스크 재편집 | 원본·마스크의 비동기 역전과 stale 오류 무시, 로딩 중 생성 차단, 두 후보의 동일 원본/마스크 사용은 기존 테스트로 확인했다. 실패한 새 업로드 뒤 기존 원본과 칠한 마스크가 다음 요청에 남는 것도 추가 확인했다. 후보 재편집은 기존 마스크를 검정으로 초기화하고 정확한 내장 원본과 parentId를 유지했다. |
| 프로젝트 export/import | version1 allowlist, 20후보/1000기록/UTF-8 64MiB, 내장 PNG/JPEG/WebP, 모델 optional 보존, source/mask 제외, 계보/기록, 최신 import 및 사용자 편집 우선은 기존 테스트로 확인했다. 재편집 후 export/import에서 원본 바이트·계보를 보존하고 마스크는 복원하지 않음을 추가 확인했다. |
| 실제 성공 표시 | 실패 뒤 미리보기 제거, 후보 미생성, 둘째 요청 중단을 추가 확인했다. 기존 테스트는 빈 마스크 복사를 AI 생성으로 표시하지 않고 cache 재사용도 구분하는지 확인한다. 대화 응답 또는 생성 성공을 새로 만들지 않았다. |
| 보드 | 기존 독립 렌더러 11개 통과. 추가 1개는 현재 `app.js` 내장 렌더러와 독립 렌더러의 본문이 일치함을 확인한다. 차이는 app의 맨 앞 `'use strict';`와 줄바꿈뿐이다. 현재 앱 보드 핸들러의 업로드 원본 fallback, 비동기 내보내기 중 brief/name snapshot은 기존 UI 테스트가 실행한다. |

추가 검증 파일은 기존 `scripts/test_ui_state.cjs`의 첫 테스트 이전 harness를 메모리에서 재사용하고 현재 `app.js`/`profiles.js`를 실행한다. DOM/Image/HTTP/IndexedDB는 제어된 대체 I/O다. 기존 테스트 파일에 export나 다른 변경을 넣지 않았다. harness의 경계가 바뀌면 추가 파일도 검토해야 한다.

## 실제 생성·변경 파일

이번 작성 파일은 이 인계와 다음 `work/team-resume/frontend/` 산출물뿐이다.

- `audit-ui-state.cjs`: 추가 상태 8개 + 렌더러 본문 일치 1개. 제품 코드 변경 없음.
- `verify-sources.cjs`: 네 파일의 인계 SHA256, 렌더러 본문, 최종 로그의 78/78을 다시 확인하고 JSON 작성.
- `verification.json`: 최종 검증 요약 및 SHA256.
- `current-board-renderer.js`: 본문 비교를 위해 추출한 현 소스 스냅샷. 앱이 참조하는 파일이 아니다.
- `node-baseline.log`: 기존 상태/프로젝트 58개 통과.
- `node-audit-initial.log`: 추가 상태 첫 실행 7통과/1실패. 아래 검증 대기 문제 기록.
- `node-audit.log`: 대기 수정 뒤 추가 상태 8개 통과한 중간 로그. 이후 본문 일치 1개가 추가됐다.
- `node-final.log`: 최종 78개 통과. 완료 판정은 이 로그를 따른다.

## 검증 명령과 결과

작업 위치 `D:/Pankeki`, Node `v24.19.0` (`C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`). 설치 작업은 없었다.

| 명령 | 결과 / 로그 |
| --- | --- |
| `node --test web/tests/profiles.test.cjs scripts/test_ui_state.cjs` | 58/58, exit0 / `node-baseline.log` |
| `node --test work/team-resume/frontend/audit-ui-state.cjs` | 중간 실행 8/8, exit0 / `node-audit.log`. 현 파일은 본문 일치 포함 9개이며 아래 최종 실행에 포함됐다. |
| `node --test web/tests/profiles.test.cjs scripts/test_ui_state.cjs work/character-studio/board-renderer.test.cjs work/team-resume/frontend/audit-ui-state.cjs` | **78/78, exit0** / `node-final.log` |
| `node work/team-resume/frontend/verify-sources.cjs` | 네 소유 파일 SHA256 일치, 렌더러 본문 일치, 최종 로그 78/78 확인 / `verification.json` |

추가 상태 첫 실행의 실패는 테스트의 `until`이 `setImmediate` 100회만 기다려 앱의 정상 250ms poll 간격 전에 다음 GET을 찾지 못한 것이다. `systematic-debugging`으로 해당 대기를 추적한 뒤 추가 검증 파일에서만 짧은 타이머로 실제 다음 poll을 기다리도록 바꿨다. 앱 수정은 없었다. 최초 렌더러 전체문자열 비교 불일치도 맨 앞 strict 지시문/줄바꿈 차이였으며, 본문 일치 테스트로 확인했다. 제품 결함이나 현재 이미지 생성 실패로 분류하지 않는다.

## 향후 로컬 대화 연결에 필요한 실제 계약

현재 `web/src/index.template.html`에는 `chatInput`, `chatSend`(disabled), `chatMessages`, `chatModelStatus`, `chatNotice`가 있고 예시 버튼은 입력 초안만 채운다. `app.js`와 `server.py`에는 대화 전송/응답 API가 없다. 현재의 `status`는 실제 이미지 작업 상태 영역이다. 아래는 구현 완료 사항이 아니라 총괄·백엔드·프론트엔드·디자인이 먼저 합의할 계약이다.

1. **실행 가능 상태와 API:** 실제 선택된 대화 모델/실행기의 준비·로딩·오류·미연결 상태를 서버가 어떻게 제공할지, 전송/취소/타임아웃/오류/선택적 streaming 응답 형식을 정해야 한다. 이미지용 `/api/models`를 대화 capability로 재해석하지 않는다. 실제 연결 확인 전 `chatSend`를 활성화하지 않는다.
2. **사용자 초안과 늦은 응답:** 대화 요청에는 현재 프로젝트/편집 세대를 식별할 token과 제출 당시 brief snapshot이 필요하다. 대기 중 새 프로젝트·import·사용자 편집·후속 전송 후 도착한 응답이 현재 brief/원본/대화를 덮지 않도록 해야 한다. 모델의 제안과 실제 적용/생성 의도를 구분하고, 변경은 기존 sanitize/검증 및 `touch`/import 세대 관리와 연결해야 한다.
3. **이미지 요청 연결:** 실제 이미지 생성은 기존 `generate` → `/api/jobs {session,request}`를 재사용한다. 서버 job의 `job_id`, `revision`, `is_current`, `state`, `result`, `error`와 연결해 queued/running/canceling/succeeded/failed/canceled/uncertain을 표현해야 한다. `succeeded` 뒤 최신 세대 확인·파일 읽기·decode·프로젝트 저장까지 성공한 후보만 결과로 연결한다. 취소는 현재의 논리적 결과 폐기이며 GPU 연산 즉시 중단을 보장하지 않는다. cache hit/빈 마스크 복사도 별도로 표시한다.
4. **첨부·부분 수정:** 지금 첨부는 이미지 모델의 수정 원본이며 대화 모델이 이미지를 이해한다는 뜻이 아니다. 실제 vision 지원과 입력 형식이 확인돼야 시각 이해 기능을 표시할 수 있다. 재편집은 기존 원본 바이트·마스크·parentId를 전달하고 두 후보가 동일 기준을 사용하게 해야 한다. 대화 텍스트로 후보/원본 바이트를 대체하지 않는다.
5. **저장 형식:** 현재 version1 프로젝트는 brief/후보/선택 기록 allowlist다. 대화 내역·진행 중 job·상위 생성 설정·편집 마스크는 저장하지 않는다. 후보에는 생성 당시 request/model 설정이 남지만 import가 그 설정을 현재 폼으로 복원하는 계약은 없다. 새 필드를 version1에 임의로 붙이면 현재 parser가 거부하므로 대화 저장 여부·크기 제한·호환 정책을 먼저 정해야 한다.
6. **DOM 및 자원 조율:** 대화 상태/전송 로직은 프론트엔드, markup/layout은 디자인, 대화 실행·이미지 모델과 메모리/큐 조율은 백엔드 소유다. 공통 DOM/API 변경은 총괄 조정 뒤 진행하며 미연결 상태에서 가짜 응답/성공/자동 모델 다운로드를 넣지 않는다.

## 한계와 다음 작업

실제 브라우저의 모바일 레이아웃·canvas 픽셀/브러시·파일 선택기·IndexedDB 권한 오류, 현재 서버/SDK·모델 실행·GPU 이미지 품질은 이번에 검증하지 않았다. 제어된 I/O 테스트 통과를 해당 항목의 통과로 확대할 수 없다. 보드 렌더러도 실제 PNG를 브라우저로 열어 육안 검사한 결과가 아니다.

제품 소스 변경과 빌드 요청은 없다. 총괄은 추가 검사와 대화 계약을 검토하고, 실제 로컬 대화 백엔드 범위가 정해지면 API/상태/저장 스키마 합의 및 새 경쟁 조건 검증을 다음 작업으로 배정하면 된다. 현재 담당은 1차 작업을 마치고 총괄 검토를 기다린다.

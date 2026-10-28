# 따뜻한 화면 프론트엔드 구현 인계

2026-10-20 KST · 프론트엔드 기능 JS 구현 및 디자인 소스와의 정적 계약 대조 완료. 최종 Node 92개 통과. ID/data 속성과 build.py의 studio.js 포함 순서도 통과했다. 최신 따뜻한 화면 7개 PNG와 README, `character-workflow-live2d-plan.ko.md`를 기준으로 현 JS/프로젝트 version1을 유지했다. 다음 조치는 총괄 요청 후 디자인 담당의 최종 빌드·실제 화면 검증이다.

## 디자인 담당에게 제안하는 최소 DOM 계약

- JS 순서: 기존 `profiles.js` → `app.js` → 신규 `studio.js`. 디자인 담당이 build.py에 studio.js를 추가한다. chat.js는 계약 합의 뒤 별도 연결한다.
- 본문 `data-studio-screen="home|design|compare|inpaint|parts|motion|export"`를 JS가 관리한다. 단계 버튼은 `data-studio-go`에 같은 값을 사용한다. 새 컨테이너는 `data-studio-screen` 속성을 사용하지 않는다(본문과 충돌 방지).
- 신규 영역은 `data-studio-page="home|parts|motion|export"`. 기존 `.app-shell`은 design/compare/inpaint에서 공유한다. 기존 `workspace`, `chatPanel`, `detailPanel`, `briefDrawer`, `comparePanel`, `compareGrid`, 캔버스/마스크/후보/폼 ID를 각각 한 개만 유지한다. JS는 기존 DOM을 복사하거나 재부착하지 않는다. CSS가 본문 screen에 따라 같은 작업 영역의 표현을 바꾼다.
- 홈/단계 보조 버튼은 `data-studio-action="new|upload|import|save|board|download|continue|help"`. JS는 기존 버튼/파일입력/실제 다운로드를 호출한다. `new`는 기존 reset 확인을 존중하며 거절하면 이동하지 않는다. `continue`는 현재 문서로 design 복귀다. 단순 단계 전환은 reset·생성·저장·원본 선택을 실행하지 않는다.
- 요약 표시용 선택 요소: `studioTitle`, `studioStatus`, `studioCandidateCount`, `studioCurrentImage`(img, 현재 프로젝트 실제 후보만), `studioCurrentSummary`. 여러 화면에 표시해야 할 요약은 `data-studio-summary="name|candidates|source|status"`를 사용한다. 홈에 가짜 최근 프로젝트/시안 결과를 넣지 않는다. 브라우저가 복원한 현재 프로젝트만 이어 연다.
- 디자인 담당의 추가 `[data-studio-image]` img도 현재 실제 이미지로 갱신하고 빈 프로젝트에서 hidden 처리한다. source 보기를 선택한 동안은 다른 최신 결과보다 실제 수정 원본을 표시한다. 개발 예정 control에는 `[data-studio-planned]`도 사용할 수 있으며 JS가 disabled를 유지한다.
- 기존 구현 버튼은 기존 ID 그대로 사용. 비교 단계는 2개 선택 시 실제 comparePanel을 열고, 미선택이면 기존 gallery로 안내한다. inpaint 단계는 현재 원본을 유지하며 mode만 전환한다. 후보 `이어서 수정`은 기존 loadSource 성공 후 inpaint 표시로 맞춘다.
- parts/motion은 읽기용 ‘개발 예정’ 설명만 제공. 표정·리깅·레이어 분리·프레임 생성 버튼은 disabled. export는 기존 PNG/보드/프로젝트만 활성화하고 확장 출력은 개발 예정으로 표시한다.
- 화면 제목은 `data-studio-heading`으로 표시(선택). 값이 없는 boolean marker도 해당 page 내부 제목으로 찾는다. workspace는 기존 canvasHeading을 사용한다. 단계의 `aria-current="step"`와 페이지 hidden 상태는 studio.js가 갱신한다. studioCandidateCount는 숫자만 채운다(디자인 markup에 ‘개 보관’ suffix 있음). 기존 skip-link는 작업실을 먼저 표시한 뒤 템플릿의 초점 이동을 유지한다. 기존 접근성·모바일 화면 제어는 디자인 담당이 유지한다.

디자인 담당이 `warm-design-implementation.md`에서 위 계약을 채택했음을 확인했다. studio.js가 탐색·action·요약을 소유하고, 디자인 담당은 `[data-settings-tab=brief|chat]` 및 기존 모바일/마스크 표시 보조만 소유한다. 실제 markup과 빌드 순서는 소스 반영 후 점검한다.

## Codex 대화 연결 최소 계약과 아직 미확정인 부분

현재는 미연결이다. 임의 HTTP 경로 또는 Codex 인증 상태를 만들지 않는다. 기능 담당의 App Server 설치/인증 조사 후 아래 의미 계약을 먼저 합의해야 한다.

1. capability: 실제 연결·인증·모델 준비 상태, 실행 가능한 작업(텍스트 대화/선택적 이미지 입력), 오류 사유. 연결 확인 전 chatSend disabled 유지.
2. send: 메시지와 request id, 현재 프로젝트/원본 세대 token, 제출 당시 brief·선택 후보 snapshot. 통신 방식·URL·App Server thread 매핑은 기능 담당 조사 후 결정.
3. result: assistant 텍스트와 별도의 구조화된 변경 제안, 상관 request id/token. 텍스트는 textContent로 표시. 응답만으로 이미지 생성/후보 저장/원본 변경을 실행하지 않는다. 사용자가 제안을 확인한 후 기존 sanitize/요청 검증을 거쳐 적용하고, 생성은 기존 generate를 명시 호출한다.
4. lifecycle: sending → succeeded/failed/canceled/timed_out; 취소 핸들·시간 제한·오류를 구분한다. 프로젝트 reset/import·원본 교체 시 이전 전송을 무효화한다. 실패·취소·늦은 응답은 현재 메시지/brief/캔버스를 덮지 않는다. 이미지 job serial과 대화 token은 별도이며 실제 이미지 성공만 이미지 활동에 표시한다.
5. persistence: 대화/제안을 version1 프로젝트에 추가하지 않는다. 현재 brief/versions/selectionHistory만 저장한다. 대화의 저장 정책과 schema 확장은 별도 결정이다.

기능 담당의 `codex-chat-proposal.md`를 읽었다. 공식 App Server 실행은 `Could not find home directory`로 초기화 전에 종료됐으며 인증 재사용/도구 제한은 미검증이다. 제안된 `/api/chat/*`는 초안이고 현재 구현/합의 완료로 취급하지 않는다. 프로젝트 소유 nonce 발급/전달, source 세대 회신, timeout/uncertain 표현, reply/briefPatch의 허용 필드 및 사용자의 제안 확인 UI를 확정한 뒤 전송 구현에 들어간다. 이번 JS 변경에는 chat HTTP 호출·chatSend 활성화·가짜 응답이 없다.

## 구현 계획

Goal: 새 홈/단계 전환에서 실제 기존 이미지 작업과 저장 기능을 그대로 사용한다.
Architecture: studio.js가 보기와 보조 action만 관리한다. app.js는 공개 상태 경계/변경 알림을 제공하며 원본/마스크/생성 요청의 단일 소유자로 유지된다.
Spec: `docs/product/design-walkthrough-warm-20261020/README.ko.md`, `docs/product/character-workflow-live2d-plan.ko.md` 및 이 계약.
Tech stack: 기존 vanilla JS, Node 상태 테스트. 설치/다운로드 없음.

- [x] 기존 상태 harness를 재사용해 화면 전환·reset 거절·복원·비교/부분 수정·개발 예정·실제 저장 forwarding 테스트를 먼저 실패시킨다.
- [x] app.js 상태 알림과 studio.js 보기/action 연결을 최소 구현한다. 미연결 대화는 건드리지 않는다.
- [x] 디자인 담당 markup의 ID/data 속성을 대조하고 소유 범위에서 제목·counter·skip-link 연결을 맞췄다. 디자인 담당이 build.py의 studio.js 포함을 반영한 뒤 최종 정적 점검도 통과했다. 타인 파일은 수정하지 않았다.
- [x] 변경에 맞는 Node 회귀와 정적 DOM 계약 점검을 수행했다. 최종 HTML 빌드는 총괄 요청 후 디자인 담당이 수행한다.

## 현재 변경과 검증

이번 담당 변경 파일은 `web/src/app.js`, 신규 `web/src/studio.js`, 신규 `scripts/test_studio_state.cjs`, 이 인계다. 검증 산출물은 `work/team-resume/frontend/check-warm-contract.cjs`, `warm-contract.json`, `warm-{red,green,image-red,image-green,markup-red,markup-green,regression,final}.log`다. `profiles.js`와 기존 테스트, HTML/CSS/build, 백엔드, 백업, GitHub 공개 파일은 수정하지 않았다.

app.js는 `PankekiStudio.getSummary()/subscribe(listener)`와 검증된 `setMode(mode)`를 추가했다. summary는 이름·후보 수·선택 수·source/latest id·현재 실제 image URL·mode·busy·저장 상태·editEpoch/sourceRevision/importing만 담는 얕은 불변 객체다. 후보 배열이나 이미지 바이트를 JSON 복제하지 않는다. view/brief/gallery/projectStatus 변경이 구독자를 갱신한다. 성공한 reset/명시적 import는 callback 두 번째 인자 `reset|import`로 design에 복귀하며 자동 복원(`restore`)은 홈을 강제로 떠나지 않는다. studio.js는 같은 DOM과 기존 핸들러를 사용하며 단계 이동에서 프로젝트를 새로 만들지 않는다.

TDD: 최초 9개 실패(미구현 subscribe/studio.js, warm-red.log) → 9개 통과(warm-green.log). 실제 이미지 슬롯과 최신 결과/수정 원본 구분 2개 실패 → 11개 통과(warm-image-*.log). 디자인 markup의 boolean 제목, skip-link, 상단 reset 3개 실패 → **14개 통과, exit0**(warm-markup-*.log). 최초 markup 실패 로그가 큰 것은 가짜 DOM 객체 전체의 assertion diff이며, 이후 초점 assertion을 identity boolean으로 바꿔 출력만 줄였다.

최종 명령: `node --test web/tests/profiles.test.cjs scripts/test_ui_state.cjs work/character-studio/board-renderer.test.cjs work/team-resume/frontend/audit-ui-state.cjs scripts/test_studio_state.cjs` → **92/92 통과, 실패·취소·건너뜀 0, exit0**, `warm-final.log`. 기존 78개 + 신규 14개다. `node --check web/src/app.js`와 `node --check web/src/studio.js`도 exit0.

정적 조합 점검: `node work/team-resume/frontend/check-warm-contract.cjs` → **passed, exit0**, `warm-contract.json`에 기록했다. 현재 template의 총 ID 135개에 중복 0, 앱 필수 ID 누락 0, 기존 ID 117개 삭제 0이다. 7개 경로·8개 action·4개 page·실제 이미지 슬롯 5개, chatSend disabled 및 `profiles.js → app.js → studio.js` 순서가 일치한다. 중간 점검에서는 build.py가 studio.js를 아직 포함하지 않았지만 디자인 담당이 반영한 뒤 최종 조회에서 해결됨을 확인했다. 이 담당은 build.py나 최종 `web/index.html`을 수정/빌드하지 않았다.

실제 브라우저·서버·SDK/GPU 검증은 이번 범위에 없다. 제어된 DOM/HTTP I/O 상태 테스트와 정적 계약 확인을 실제 화면·이미지 품질 통과로 확대하지 않는다. Codex 초기화/account-read/도구 제한 및 HTTP 계약 합의가 끝나기 전까지 전송 구현·가짜 연결을 추가하지 않는다. 최종 빌드 후 실제 화면 검증은 총괄이 조율한다. 이 인계 후 담당은 대기하며 중복 확장 작업을 하지 않는다.

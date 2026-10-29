# Chat Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. 기존 B/A 구현·독립 QA·root native 검토를 유지하며 새 직원이나 디자인 질문을 추가하지 않는다.

**Goal:** 넓은 기존 작업공간에서 입력·모델 확인·답변 복사·실패 요청 복원을 명확하게 한다.
**Architecture:** 기존 단일 textarea와 workspace.render(state), desktop controller 상태를 재사용한다. B 배치/액션과 A 실제 모델 표시를 분리한다.
**Tech Stack:** 기존 vanilla JS/CSS·Node CPU 테스트·단일 HTML build, dependency 추가 0.
**Spec:** `docs/superpowers/specs/2026-10-29-chat-cleanup-design.md`

## Global Constraints

- 로고·cream/brown/orange·Pretendard·11메뉴·일반/project 분리·단일 자동 composer 유지.
- 전체 작업공간 960px 축소 0, 이미지 안 편집/저장 overlay와 클릭 후 38:62 편집기 유지.
- 원본/mask/source/draft/selection·IME/Enter·정확 취소/저장 guard·후보 제한 불변.
- B: web/src/redesign.js와 redesign.css만, A: desktop-chat.js만, QA: 테스트만 편집.
- template 문구 변경은 근거를 root에 먼저 보고한다. Git init/commit·새 파일 분할은 하지 않는다.
- 실제 앱 제어는 root만, profile/DB/서버 설정/모델/CSP/다른 권한/다운로드/GPU 변경 0. UI build 1회 후 현장 복사 결함의 아래 출시 보완만 예외다.

## Review Focus

- 긴 한글 입력/IME/연속 Enter: draft와 selection을 보존하며 기존 submit이 1회만 실행된다.
- 긴 모델명/1024 창/오른쪽 pane: 실제 값·tooltip·줄바꿈과 보내기/취소/오류 접근을 유지한다.
- 새 draft/프로젝트 전환 뒤 옛 failure: “다시 입력”이 다른 원문을 덮거나 자동 전송하지 않는다.
- 긴 답변/clipboard 거절: plain text만 복사하고 실제 성공/실패를 구분한다.
- 이미지 결과/수동 scrollback: overlay·click-only editor·원본/mask/후보를 보존한다.

## Task 1: Composer와 대화 배치

**Files:** Modify `web/src/redesign.js`, `web/src/redesign.css`; A는 `web/src/desktop-chat.js` 병행.
**Interfaces:** 기존 `#pcPrompt/#pkPromptForm`, `workspace.render(state)`와 모델/해상도 버튼 ID를 유지한다.
- [x] root 문서 검토와 QA 핵심 RED를 받고 before 파일·hash를 frontend/에 고정한다.
- [x] QA가 실제 `scripts/test_central_composer.cjs` fixture로 도구 접근/IME/원문 보존 RED를 확인했다. CSS 높이 수치 미러 테스트는 만들지 않는다.
- [x] B가 fitPrompt와 현재 CSS 범위만 수정해 본체 기본 72–104px, 정상 최대 약160px, 좁은 pane wrap을 구현한다.
- [x] B가 요청/답변/결과 간격·metadata·focus를 통일하고 full-width/overlay/38:62/scrollback을 보존한다.
- [x] A가 실제 모델/해상도 title/접근성 이름과 문맥 표시를 동결하면 기존 DOM 그대로 통합한다.
- [ ] QA가 위 행동 GREEN을 확인하고 root 시각 검토로 높이/긴 명칭/작은 pane를 확인한다. B는 node --check만 수행한다.

## Task 2: 답변 복사와 실패 요청 복원

**Files:** Modify `web/src/redesign.js`, `web/src/redesign.css`; controller metadata 변경은 A/root와 협의한다.
**Interfaces:** 기존 messages/lastFailure/projectId와 A의 runtime contextEpoch 및 messages[].contextEpoch를 소비한다. 실제 conversationReset===true에만 epoch 증가, provider/noop/실패는 증가 0이며 원문 대화는 보존한다.
- [x] QA가 `scripts/test_desktop_chat.cjs` 및 `scripts/test_central_composer.cjs`에 metadata/copy/다시 입력의 실제 실패 RED를 최소 추가한다.
- [x] B가 실제 답변 plain text 복사 버튼과 성공/실패 피드백을 추가한다. HTML·가짜 답변은 복사하지 않는다.
- [x] B가 message epoch 변화와 마지막 message 뒤 현재 epoch 경계를 표시한다. A가 finish(error|limited)의 lastFailure 누락을 보완하고 취소/needs-input은 제외한다.
- [x] B가 현재 failure 원문 복원+focus만 구현한다. 새 입력/IME/busy/문맥 불일치에서는 덮어쓰기·submit 0을 지킨다.
- [x] QA가 새 draft·IME/busy·old owner/epoch 보존·clipboard pending/성공/실패를 focused 4/4 GREEN으로 확인했다.
- [x] QA가 변경 영향 7파일을 한 번 모아 실행해 208/208 PASS를 확인했다(qa/final-focused.tap).

## Task 3: 동결과 출시 근거

- [x] B/A 최종 SHA·QA 실패 0을 확인하고 before 대비 patch/manifest를 frontend/에 저장했다. 이후 native copy 실패는 별도 미수용으로 기록한다.
- [x] root 최종 통합 승인 후 `.venv-macos/bin/python web/build.py`를 정확히 1회 실행해 exit0을 확인했다.
- [x] source ID/HTML SHA를 먼저 root에 전달했다. 별도 root 지시로 격리 PNG8장/높이·bounds manifest를 만들었고 native 수용은 대체하지 않는다.
- [ ] root가 실제 네이티브 앱의 열린/닫힌 편집기·일반/project·모델·오류 동선을 수용한다.
- [ ] B는 실제 검증 범위와 한계를 짧게 기록하고 승인된 식별자 build/패키징 이후 자동 개선 없이 동결한다.

## Task 4: 실제 native 복사 결함의 좁은 출시 보완

- [x] root 현장 실패와 A의 정책 추적을 근거로 main/security 및 security 테스트만 소유 확장했다. 현재 trusted 앱 mainframe의 clipboard-sanitized-write만 허용하며 CSP·다른 권한과 읽기 거절은 유지한다.
- [x] A의 정확 RED2→집중 security5 PASS·syntax3 PASS와 최종 SHA를 확인한다. 웹3파일·preload/IPC/DB/profile/partition은 불변이다.
- [x] B가 동결 SHA를 확인해 식별자 HTML build를 추가 1회 수행했고 source meta 외 전체 byte 동일성을 검증했다(release/identity-build-once.json).
- [x] 기존 freeze-release.cjs→package-mac.cjs와 explicit local ZIP으로 새 app+DMG를 만들었다. codesign exit0·ASAR 17/17·freeze stale0·동일 profile, 기존 앱/ZIP SHA 보존을 확인했다(release/package-validation.json). 다운로드·수동 패치·앱 실행은 0이다.
- [ ] root가 정상 Quit→새 exact appPath 실행 후 실제 복사와 기존 general/project·profile 재개를 확인한다. CPU/격리 PASS로 native 수용을 대신하지 않는다.

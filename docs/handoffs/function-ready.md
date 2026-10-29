# 캐릭터 스튜디오 기능 인계

2026-10-19. **기능 소스 통합 및 범위 내 회귀 검증 완료. 최종 HTML 빌드는 디자인 담당이 수행해주세요.** 기능 담당은 template/CSS/build.py/assets/index.html을 수정하지 않았습니다.

## 22시대 실제 브라우저 검증 중 수정 — 재빌드 및 최종 검증 완료

**최종 상태: index.html22:12:55 KST 빌드에 마지막포커스수정까지 내장됨을 확인했습니다. 22:13 실제 Chrome의 Enter3경로/Tab연속성/오프라인복원/자동복원/390px 전부 통과, pageerror0. 더 필요한 기능 재빌드는 없습니다.** 아래 재빌드 요청 문단은 경과 기록입니다. 최종 근거: `docs/handoffs/function-live-validation.md`, `work/function-live-validation/run-2026-10-19T13-03-34-543Z/restore-final-keyboard.json`.
실제 Chrome에서 생성2개/부분수정2개/비교/JSON+PNG 다운로드 성공. 빈 새 프로젝트에 JSON을 처음 불러올 때 파일선택 자체가 editEpoch를 올려 불필요한 ‘작업 폐기’ 확인창이 뜨는 문제를 발견했습니다. app.js hasWork를 실제 브리프/후보/원본/진행중 작업 비교로 수정했습니다. 색상 또는 용도만 변경한 경우의 폐기 확인은 유지합니다. UI 회귀2개 추가 후 총65개 통과. **이 app.js 변경을 다시 내장 빌드해주세요.** 자세한 실제파일/품질/오프라인 복원 기록은 function-live-validation.md에 정리합니다.

추가 P2 수정: design-keyboard-issue.md의 Enter 후 BODY 포커스 소실을 수정했습니다. renderGallery 전 현재 candidateId/조작(view/edit/compare)을 보관하고 새 카드의 대응 버튼으로 preventScroll 포커스를 복원합니다. 비교선택/해제/크게보기 회귀 RED→GREEN 확인, 전체66개 통과. **이 마지막 포커스 수정(app.js)을 다시 내장 빌드해주세요.** 실제 Enter 재검증은 다운로드된 프로젝트를 사용하므로 추가 GPU 생성은 없습니다.

## 준비된 소스
- `web/src/profiles.js`: 5개 프로필/영어 예시, 실제 프롬프트 합성, 1–2후보 seed 분리, 엄격한 프로젝트 검증.
- `web/src/app.js`: 후보 순차 생성, 비교/재편집/선택 기록, 업로드 원본 구분, 프로젝트 파일 저장·복원, IndexedDB 자동 저장·복원, 보드 PNG. 보드 렌더러를 app.js에 내장했으므로 추가 script 파일은 필요 없습니다.
- `web/tests/profiles.test.cjs`, `scripts/test_ui_state.cjs`: 모듈/실제 JS 상태 회귀 테스트.
- `work/character-studio/board-renderer.js`, `board-renderer.test.cjs`: 내장 렌더러 원본/레이아웃 테스트.

## 빌드/DOM 계약
`profiles.js` → `app.js` 순으로 inline하십시오. `TEAM-CONTEXT.ko.md`의 모든 기존/신규 ID를 그대로 사용합니다.

**추가 요청:** 빈 화면의 h3에 `emptyHeading`, p에 `emptyDescription` ID를 붙여주세요. JS는 이 ID가 있으면 부분 수정 모드의 빈 상태를 ‘수정할 원본을 먼저 불러오세요 / 이미지 업로드 또는 후보의 이어서 수정’으로 갱신합니다. 기존 template에는 아직 ID가 없어 기본 문구가 남을 수 있습니다. 총괄의 빈 상태 감사 사항 대응입니다.

JS가 만드는 카드: article.candidate-card (`data-candidate-id`, .selected/.active), img, div.candidate-info(strong/span/small), div.candidate-actions(button 3개). 선택 기록은 gallery의 마지막에 details.selection-history > summary + ol로 추가됩니다. 이 블록은 이미지 카드 전체 너비를 쓰도록 스타일을 부탁드립니다. 비교 grid에는 figure > img/figcaption/button이 들어갑니다. 이미지에 contain/aspect 유지가 필요합니다. 비교 열기 시 패널로 포커스를 옮기고 닫기/Escape는 비교 버튼으로 돌려보냅니다.

용도 표시명도 HTML과 같은 자유 창작 / 웹툰·웹소설 / 버튜버 / 마스코트 / 게임으로 맞췄습니다. 웹툰·웹소설 지시는 선화를 강제하지 않는 이야기 중심 콘셉트입니다. 2026-10-19 템플릿/JS 정적 ID 대조에서 누락 없음 확인(추가 빈 상태 ID도 포함).

## 데이터 계약 확장 (하위 호환)
- 프로젝트는 version:1 유지. optional `selectionHistory`를 추가했습니다. 누락 파일은 []로 복원합니다. 최대1,000개, `{candidateId,action:'view'|'edit'|'compare',at:ISO UTC}`. createProject(brief,versions,selectionHistory=[])로 사용합니다.
- 후보 optional kind는 upload/generated. 누락된 예전 파일은 ‘불러온 이미지’로 표시합니다. parentId는 같은 프로젝트의 후보를 가리켜야 하며 순환은 금지합니다.
- 최대20후보/프로젝트64MiB UTF-8/이미지16MiB Base64 문자열. 초과 시 명시적으로 실패하며 오래된 후보를 자동 삭제하지 않습니다. 원본도 후보 수에 포함합니다.
- 모든 이미지를 decode하고 16MP 이하임을 확인한 뒤 프로젝트를 교체합니다. 이미지 바이트 자체가 내장되어 서버 없이 복원됩니다. 수정 마스크는 저장하지 않으며 복원 시 안내합니다.
- 자동 저장 위치: IndexedDB pankeki-character-studio/projects/current. 저장소 오류 시 안내하며 파일 내보내기/불러오기는 독립적으로 사용할 수 있습니다.
- 생성 중 입력 수정은 다음 생성에 적용됩니다. 이미 제출한 후보의 brief/prompt/parentId는 바뀌지 않습니다. 2개 후보는 같은 원본·마스크에서 seed만 +1 합니다. 취소 시 남은 제출을 중단하고 늦게 도착한 POST 수락 결과에도 해당 job cancel을 보냅니다.
- 빈 마스크의 backend `empty-mask-skip` 결과는 ‘원본 복사 · 수정 영역 없음’으로 표시하고 추론 미실행을 안내합니다. 캐시 hit도 새 추론 완료와 구분합니다. 보드 역시 원본으로 표시합니다.
- 보드는 비교 선택1–2개를 우선 사용하고, 선택이 없으면 현재 화면의 수정 원본/최신 후보를 사용합니다. 업로드 원본만 있어도 내보낼 수 있습니다. 보드 시작 후 이름/브리프가 바뀌어도 생성 당시 내용과 파일명을 유지합니다.

## 검증 현황
최초 실제 소스 회귀 18개 중17개 실패를 확인한 뒤 구현했습니다. 최종 실제 소스 UI33 + 프로필19 + 보드11 = **63개 전부 통과**. 기존 Python81개 통과/Windows symlink 권한1개 생략, bridge17개 통과. Node app.js 문법 검사도 통과했습니다.

UI33개에는 실제 app.js의 보드 호출·다운로드 경로(업로드 원본만 있는 경우, 디코딩 중 이름/설정 변경), 모드별 빈 상태, 빈 마스크 원본 복사 표시도 포함합니다. Canvas/Blob 더블을 사용하는 상태 테스트이므로 실제 브라우저에서 만들어진 PNG 픽셀 검증은 아닙니다.

별도 검토로 찾은 경합3개(겹친 업로드 실패 시 기존 원본 복원, 불러오기 디코딩 중 예전 job 완료, 불러오기 디코딩 중 예전 upload 완료)를 수정하고 회귀로 고정했습니다. 메모리에서 수정만 되돌렸을 때3개 모두 실패하는 것도 확인했습니다. 불러오기 검증은 선택 이미지 한 장만 유지해 최대20장의 디코딩 이미지가 동시에 보관되지 않게 했습니다.

Node: `C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`

명령: `node --test scripts/test_ui_state.cjs web/tests/profiles.test.cjs work/character-studio/board-renderer.test.cjs`

## 통합에서 남은 확인
- 실제 8190 최종 HTML에서 2개 생성 → 비교 → 후보 재편집 → 저장/복원 → PNG 보드 다운로드/열기.
- 모바일390px, 키보드 접근, 실제 폰트의 보드 장문/비율/색, 다운로드 파일.
- UI 상태 테스트는 제어된 HTTP/이미지/브라우저 I/O입니다. 실제 GPU·브라우저 검증과 구분합니다.
- backend/모델/SDK/환경/벤치마크/서버는 이번 작업에서 변경하거나 재시작하지 않았습니다. 기존 마스크밖 보존/캐시 유지, ROI 기본OFF.
- SD Turbo의 캐릭터 결과 품질과 대회 SDK 생성 경로는 별도 미완료 항목이며 이 기능 구현으로 완료되었다고 주장하지 않습니다.

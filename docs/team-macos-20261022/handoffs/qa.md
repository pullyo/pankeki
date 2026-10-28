# Pankeki 독립 품질·회귀 인수인계

**역할·기준:** 2026-10-22 KST, 독립 QA 담당. [Mac 팀 기준](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/docs/TEAM-MACOS-20261022.ko.md>)과 [DESIGN.md](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/DESIGN.md>)를 따른다. 기존 로고·11개 메뉴·실제 생성/업로드/마스크/후보/프로젝트/모션/출력 보존을 회귀 기준으로 삼고, 결함은 근거와 재현 절차를 작성해 총괄의 수정 배정에 넘긴다.

**이번에 직접 확인한 범위:** 지정 JSON·보고서·기존 로그와 관련 소스를 읽었다. [redesign.js](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/web/src/redesign.js:29>)의 설명/스타일 제출 경계, Enter·Shift+Enter·IME 조합 중 제출 방어·복원 연결, [app.js](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/web/src/app.js:308>)의 취소 요청/늦은 결과 무효화 연결을 정적으로 확인했다. 앱 실행 상태·현재 제공 빌드·실제 동작은 이번에 확인하지 않았다. 아래 통과 결과는 모두 **기존 검증 기록**이다.

| 이미 남아 있는 검증 | 근거와 해석 범위 |
| --- | --- |
| 관련 JS 144건: 142통과·1skip·1TODO·0실패 | [최종 로그](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/pc-chat-ui/javascript-tests.log>). 이전 [복원 TAP](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/javascript-tests.tap>)은 139/137통과, [이전 UI 로그](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/ui-redesign/javascript-tests.log>)는 142/140통과이며 각각 skip·TODO 1건씩이다. 서로 다른 시점이므로 합산하지 않는다. |
| Python 114건: 94통과·20skip·0실패; 모션 재생/정지·v2 저장/복원·PNG/48프레임 ZIP 완료 UI | [restore-status.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/restore-status.json>)의 이전 복원 단계 요약. 최종 UI 단계에서 Python은 재실행하지 않았으며, 원시 Python 테스트 로그는 이번 검토 범위에서 확인하지 못했다. 완료 UI와 macOS 파일 도착은 별도다. |
| 로고/11개 메뉴 보존, 빌드/서버 해시 일치; 데스크톱 3종·375px에서 가로 넘침 0 | [verification.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/pc-chat-ui/verification.json>), [review.md](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/pc-chat-ui/review.md>). 원본 37개 표본 중 35개 불변 기록이며 전체 파일 감사는 아니다. |
| 모델/너비 직접 포커스·설정 탭·Escape 복귀·본문 바로가기; 원본 없는 수정 오류와 새로고침 복원 | [interaction-checks.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/pc-chat-ui/interaction-checks.json>), [empty-error.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/pc-chat-ui/empty-error.json>), [reload-restore.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/pc-chat-ui/reload-restore.json>). 오류는 role=alert·입력 보존·새 후보 없음·비busy; 복원은 후보 4개·가시 설명·일러스트 선택·원래 스타일 suffix 유지. |
| 최종 UI에서 실제 SDXL 생성; 확대/부분수정 진입; 이전 실제 마스크 수정 | [real-generation-final.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/pc-chat-ui/real-generation-final.json>): job `6f9a2bb8ba71493d80c262f3e38dd141`, 1024²·denoiser 실행·26.25초·4번째 후보 추가. [viewer-and-edit.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/pc-chat-ui/viewer-and-edit.json>): 확대 decode/다운로드 링크/포커스/기존 inpaint 진입. [이전 마스크 검증](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/sdxl-verification/edit-verification.json>): 마스크 밖·alpha 오차 0, 내부 78,401픽셀 변경. 최종 UI 변경 후 실제 마스크 추론은 반복하지 않았다. |

**미확인·남은 문제:** 실제 실행 중 취소, macOS 다운로드 파일 도착, VoiceOver 음성·고배율 전체 흐름, 기존 홈/편집/다른 화면의 작은 글자·대비가 남는다. 취소 경계는 기존 JS 로그에서 통과했으나 실모델 취소 증거가 아니며, 현재 코드는 이미 시작한 GPU 연산이 계속될 수 있다고 안내한다. 정밀 색상만 바꾸는 모델 품질도 보장되지 않는다.

렌더러의 실제 RGBA·중간 포즈·공유 삼각형 경계는 [test_character_renderer.cjs](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/scripts/test_character_renderer.cjs:149>)에 TODO/조건부 skip으로 남는다. skip 테스트는 Windows Playwright/Chrome 경로와 D: 기본 경로를 사용하므로 환경 변수만 켜서 Mac 재현이 준비됐다고 볼 수 없다. 비평 26/40은 초기 점수이고 최종 재채점은 없다. detector 86건 역시 현재 화면 결함 86개나 전부 해결의 근거가 아니다. 독립 검토자의 최종 브라우저 재연결 실패로 일부 후속 동작은 당시 총괄의 live 기록에 의존한다.

**다음 작업 우선 3개 — 아래는 미실행 재현 체크리스트이며, 후속 배정 때 수행한다.**

1. **생성·오류·취소·복원 경계:** 빈 프로젝트의 빈 설명 제출과 원본 없는 수정 → 기존 프로젝트에서 스타일 선택/Shift+Enter/Enter 생성 → 새로고침 → 선택 후보의 마스크 수정 → 실행 중 취소 순서로 확인한다. **완료 기준:** 잘못된 입력은 작업/후보를 만들지 않고 입력과 alert를 보존; 정상 생성은 설명+스타일·기존 후보를 유지; 복원 전후 설명/스타일/이미지/후보 수 일치; 마스크 밖·alpha 오차 0; 취소 후 남은 배치·늦은 성공이 후보에 반영되지 않음. job/요청/화면 근거를 각각 남기며 GPU 즉시 중단을 합격 조건으로 삼지 않는다.
2. **프로젝트·모션·실제 파일 회귀:** 보존용 프로젝트에서 v1/v2 저장·가져오기·재로드, 화면 이동 후 원본/마스크/선택 후보, 모션 재생/정지, 이미지 저장·정지 PNG·48프레임 ZIP을 확인한다. **완료 기준:** 작업/선택/포즈가 의도대로 유지되고 다운로드 파일의 실제 도착·열기·크기·ZIP 48프레임을 확인; 로고와 11개 메뉴를 보존(홈의 갤러리 숨김은 기존 규칙); 1440×900·1920×1080·1280×800 및 375×812에서 이미지/동작 접근과 가로 넘침을 기록한다.
3. **접근성·렌더러 잔여 증거:** 키보드만으로 생성/설정/확대/닫기/편집을 순회하고 VoiceOver와 200%/400% 확대를 확인한다. 실제 픽셀 검증은 Mac 실행 경로와 기준 이미지/허용 오차를 담당자와 정한 뒤 TODO/skip 범위에 한해 재현한다. **완료 기준:** 이름·상태·오류가 실제 음성으로 전달되고 포커스 복귀/미가림·전체 흐름 접근을 기록; 실제 RGBA/중간 포즈/공유 경계/원본 바이트 결과를 확보하며 미충족 항목은 재현 보고서로 남긴다.

**변경 파일:** 이 인수인계 `docs/team-macos-20261022/handoffs/qa.md` 한 개. 제품 코드·공통 문서·다른 담당 파일 변경, 테스트·빌드·브라우저·추론·다운로드·서버 재시작·외부 게시·다른 채팅 메시지·추가 채팅/하위 에이전트 생성은 수행하지 않았다. 읽기 전용 검토와 문서 작성까지 완료한 상태로 다음 배정을 기다린다.

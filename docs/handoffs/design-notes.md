# 디자인 통합 메모

## 2026-10-19 초기 점검
- 모든 기존 생성/원본/마스크/상태 ID와 TEAM-CONTEXT의 추가 ID를 보존합니다.
- 최종 빌드에서 profiles.js를 app.js 앞에 내장하고 로고도 data URI로 포함합니다.
- 기능 담당 요청: setMode/renderView에서 덮어쓰는 modeTitle, modeDescription, workspaceMode, canvasHeading, generateLabel, canvasHint를 캐릭터 디자인 작업실 문구로 맞춰주세요.
- 비교 패널은 이름을 갖도록 하고 열기/닫기 시 포커스를 옮겨주세요. 기능 파일은 디자인에서 수정하지 않습니다.
- 일반 키보드 조작과 마스크 업로드 접근성을 점검합니다. 포인터용 마스크 브러시 자체를 키보드로 그릴 수 있다고 보고하지 않습니다.
- helpDialog는 aria-labelledby로 연결하고 select 포커스, 한국어 긴 문구 줄바꿈, 390px 폭, 작은 텍스트 대비를 디자인에서 보강합니다.
- 로고 첫 생성물의 투명 알파 확인 완료(RGBA, 1254×1254, alpha 0–255). 가장자리 검토 후 imagegen 편집 버전도 비교합니다. 원본 유지.
- 초기 점검 시 인계용 character-design-ui 폴더는 아직 없었습니다. 전달 파일이 준비되면 검토해 소유 파일에 통합합니다.
- 인계 HTML/CSS 적용 후 보강: native details `briefDrawer`로 설정 전체 접기, 780px 이하는 첫 표시 시 접기. 모든 기존 ID 유지. 상태·보조설명 최소 12px 수준, 주요 조작 12–13px 이상, 390px 후보 1열 및 비교 1열, 선명한 textarea 포커스 추가.
- 기능 담당 요청: profiles.js 표시 이름을 자유 창작/웹툰·웹소설/버튜버/마스코트/게임으로 맞추고 comic 지시가 웹소설 콘셉트도 다루도록 넓혀주세요. HTML 선택지는 이 이름으로 수정했습니다.
- 발견/수정: build.py 폰트 대체 정규식이 {{FONT_URL}} 중괄호에서 끊기던 오류를 먼저 토큰 치환 후 전체 font-face 제거하도록 고쳤습니다. 최종 computed font/CSS 변수 검증 예정.
- 사용자 피드백으로 기존 팬케이크+큰반짝임 로고는 거절됨. 원본·편집본·final이라는 이름의 옛파일 모두 보존용이며 승인된 최종 로고가 아닙니다. 얇은 3–4장 + 작은 사각 버터를 기준으로 세 후보 재설계 중. 로고 선택 전 최종 브랜드 승인으로 간주하지 않습니다.
- 실제 첫 통합8190 확인:1440px/390px 모두 가로 넘침0, 모바일 설정 기본 접힘·canvasTop445px(기존981px), helpDialog 이름+Escape포커스복귀 정상, 설정 Enter열기 정상, 긴한국어 입력과 오류 문구 줄바꿈 정상. computed root font에 Segoe UI/Malgun Gothic/sans-serif와 --ink #2d352c 적용 확인. pageerror0. 증거 work/character-studio/visual-check/initial-check.json.
- emptyHeading/emptyDescription ID 추가 완료. gallery selection-history 전체열 스타일과 compareGrid 버튼 스타일 추가. 비교패널 포커스이동/ESC는 최신app.js에서 기능담당이 구현한 것을 확인했습니다.
- 로고 최신방향: 사용자제공 일러스트형 Pankeki 워드마크 참조. 이전단순아이콘방향은추천중단. 새메인 PNG와검수는 logo-options.md/wordmark-visual-review.md 참조.
- 최신 function-ready(63개 Node 통과) 확인 후 app.js/profiles.js를 다시 내장 빌드했습니다. 2026-10-19 22시대 한국시간. 정확한 파일시각은 다음 최종검수 기록에 남깁니다. 이전 통합본은 현재 최신 빌드로 교체했습니다.
- 최신소스 내장 재빌드 정확시각: 2026-10-19 22:00:36 KST (app.js21:55:38/profiles.js21:53:30 반영).
- 모바일 1245px 재현 원인: 데스크톱로드→390px리사이즈 시 최초로드전용 접기처리가 재실행되지 않았습니다. matchMedia change에도 접기상태를 적용하도록 템플릿 UI전용 스크립트를 보완했습니다. fresh390px와desktop→390px 둘다 재검증합니다.
- 지시에 따라 추가 이미지 생성은 중단했습니다. 진행 중이던 참조 기반 메인 로고 생성물만 시각검수합니다. 내장 도구의 모델/버전을 GPT Image 특정 버전 또는 ChatGPT와 동일하다고 주장하지 않습니다. Higgsfield/API/키생성 미사용.
- 22:12:55 KST 최신 기능 포커스 수정본을 최종 HTML에 내장했습니다. 실제 브라우저 최종검증 결과는 design-ready.md와 final-ui-check.json에서 갱신합니다.
- 22:14 KST 명시적인 사용자 이미지 수정 요청 인계로 시럽 흐름 편집을 디자인 담당이 한 번 수행했습니다. 결과는 logo-syrup-revision.md의 승인 대기 검토본이며 앱 로고는 기존 선택 원본을 유지합니다.

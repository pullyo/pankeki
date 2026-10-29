# 디자인 통합 검증 완료 — 시럽 로고 수정본 승인 대기

> **이전 디자인의 기능 검증 기록입니다.** 사용자가 시각 디자인을 반려한 뒤 채팅 중심으로 재구성했습니다. 현재 UI의 실제 화면·제약·검수 상태는 `design-revision-ready.md`가 우선합니다. 아래의 기능검증 통과는 시각적 최종 승인이나 대화 모델 연결 완료를 의미하지 않습니다.

## 현재 상태
- 실제 대상 `http://127.0.0.1:8190/`에 캐릭터 작업실 UI를 자체완결 HTML로 빌드했습니다. 8191 이전시연은 변경하지 않았습니다.
- 최신 app.js/profiles.js 내장 재빌드: **2026-10-19 22:12:55 KST**, 파일크기1,943,660 bytes. 22:15 실제8190 응답과 디스크HTML의 SHA-256이 모두 `cc2001e9bff0dd9b318324d135b735983cf2df284112ba8d6c75fdffca3ac022`로 일치합니다. 22:10:51 기능 담당의 후보카드 포커스 수정도 포함합니다.
- **현재 앱 로고는 선택된 원본의 변경 없는 복사 `web/assets/pankeki-selected-base.png`입니다.** 총괄의 두 시럽 수정안은 거절되어 사용하지 않았습니다. 이후 사용자의 명시적인 수정 요청으로 디자인 담당이 내장 이미지 편집을 한 번 실행했습니다. 결과 `pankeki-syrup-flow-revision-v1.png`는 승인 대기 검토본으로 보관하며 앱에 적용하지 않았습니다. `logo-syrup-revision.md` 참조. 기존 가로워드마크와 단순아이콘은 보존용입니다.

## 소유 파일 변경
- `D:\Pankeki\web\src\index.template.html`: 캐릭터 브리프/용도/팔레트/노트/프로젝트/후보/비교 UI, 모든 계약ID 유지, 도움말 이름, 모드별빈상태ID, 접이식설정.
- `D:\Pankeki\web\src\style.css`: 밝은 큰캔버스, 입력/주요버튼 글자 확대, 보조설명12px, 키보드포커스, 데스크톱접힘시 작업영역확대, 모바일후보1열, 긴한국어줄바꿈.
- `D:\Pankeki\web\build.py`: profiles.js 선행내장, CSS/JS/PNG data URI 내장, 폰트fallback 중괄호오류수정, JS중첩객체를 미해결토큰으로오인하던검사수정.
- `D:\Pankeki\web\assets\`: 생성원본·거절시안·참조기반로고·프롬프트/출처 보존.
- `D:\Pankeki\web\index.html`: 자체완결빌드. 설치되지않은Pretendard/Lucide를 적용했다고 주장하지않습니다. 시스템글꼴+기존fallback아이콘.

## 실제 UI 검증
- 디자인 검증 에이전트의 최종 실행에서 Node UI/프로필/보드 총**66개 전부 통과**(2026-10-19 22:15 KST). 엔진 파일은 변경하지 않아 별도 Python 회귀를 반복하지 않았습니다.
- 격리된 설치 Chrome headless, 1440×1000 및390×844, 실제8190. 기존 프로젝트의 Chrome 검증 방식을 사용했고 새 브라우저/패키지를 설치하지 않았습니다. CUA는 sandbox path 오류가 있었으며 Aside의 제한 환경 계정조회 오류는 총괄이 승인 실행 경로에서 정상 연결을 재확인했으므로 브라우저 자체 고장으로 보고하지 않습니다.
- HTTP200, Comfy연결, pageerror0. computed rootfont에 Segoe UI/Malgun Gothic/sans-serif, CSS변수 --ink #2d352c 정상.
- fresh390px 및desktop→390px리사이즈 모두 설정기본접힘, 가로넘침0. 최신캔버스시작Y450px(높이844). 원본업로드/생성버튼은접힘상태에도접근가능. 데스크톱 설정접기 후 캔버스폭970→1092px로 확장됨.
- 80자제목/긴한국어브리프/외형/오류상태 줄바꿈. textarea포커스 rgb(97,127,67). Enter설정열기, 이름있는도움말, Escape닫기+포커스복귀 확인.
- 예시적용 후5개용도전환이기존브리프를덮어쓰지않음. 라벨/설명갱신 확인.
- 실제cache:false 후보2개(seed913701/913702),각model_calls1. 2개비교/비교패널포커스/닫기복귀,모바일390px,프로젝트JSON저장·이미지내장·오프라인복원 통과.
- 보드PNG열어 장문한국어줄바꿈과이미지비율 확인.
- 부분수정 실제추론:3862마스크픽셀, cache:miss, model_calls1, gpu_completed true. 마스크밖258282픽셀 최대RGBA오차0, 안쪽3860픽셀변경. 세번째후보parentId정상.
- 최초브러시QA의offscreen좌표실수로빈마스크skip이한번발생했지만 이를GPU검증으로계산하지않고, 스크롤/마스크픽셀확인후 실제추론으로재검증했습니다.
- 최종 빌드에서 저장된3후보를 오프라인으로 복원하여 모두512×512 이미지가 표시되는 것을 확인했습니다. 빈 프로젝트 첫 불러오기에 불필요한 폐기확인창 없음. 비교2개 표시/패널포커스/Esc복귀 정상, 모바일비교1열, pageerror0. 이 마지막 UI 검증은 추가 GPU 생성 없이 수행했으며 job POST0입니다.
- 후보카드 `비교 선택`·`비교 선택 해제`·`크게 보기` Enter 후 같은 후보/조작버튼에 포커스가 유지되고 Tab도 순서대로 이어집니다. 기존 P2는 실제8190에서 해결 확인했습니다. `design-keyboard-issue.md`에 이전 재현과 해결 증거를 함께 보존했습니다.
- 최종 DOM 검토: 템플릿94개ID 중복0, 앱68개리터럴ID참조 모두존재, 정적사용자조작61개 이름누락없음, ARIA연결과입력상한 정상. 보조기기 전체호환성 인증을 의미하지는 않습니다.

## 증거
- `D:\Pankeki\work\character-studio\visual-check\initial-check.json`
- `D:\Pankeki\work\character-studio\visual-check\live-flow.json`
- `D:\Pankeki\work\character-studio\visual-check\mask-edit-flow.json`
- `D:\Pankeki\work\character-studio\visual-check\final-ui-check.json`
- `D:\Pankeki\work\character-studio\visual-check\candidate-keyboard.json`
- 최신앱헤더/후보캔버스/비교: `17-final-desktop-canvas.png`, `18-final-desktop-compare.png`, `19-final-mobile-canvas.png`, `20-final-mobile-compare.png` (22:15 최종빌드검증)
- 최신빈화면: `01-desktop-empty.png`, `02-mobile-empty.png` (위 visual-check폴더)
- 실제후보/비교: `06b-desktop-two-candidates-top.png`, `07b-desktop-compare-top.png`, `08b-mobile-candidates-compare.png`
- 마스크/결과: `10b-desktop-visible-mask.png`, `11b-desktop-actual-edited.png`
- 결과파일: `verified-project.json`, `verified-project-with-edit.json`, `verified-board.png` (모두 같은폴더)

## 남은 한계/승인 대기
- 시럽 흐름 수정 PNG는 사용자가 검토할 수 있게 생성원본·결과·전체프롬프트를 보존하고 이 채팅에 표시했습니다. 오른쪽 연속흐름과 강한 반사광이 아직 남아 있으므로 완전히 자연스럽다고 단정하지 않았습니다. 승인 전 앱에는 적용하지 않습니다.
- app.js 소유권은 기능 담당에 유지했고 디자인에서 우회패치하지 않았습니다. 필수 DOM 및 확인한 키보드 경로에 남은 차단 이슈는 없습니다. 동적 카드 버튼의 스크린리더목록 이름에 후보명을 더하는 것은 낮은 우선순위 개선 여지입니다.
- 브러시그리기 자체는포인터용; 마스크파일업로드는키보드대안입니다.
- SD Turbo 결과는캐릭터상용품질검증이아닙니다. 실제두번째후보에원치않은두번째인물이보였습니다. 같은인물/색/세부특징정확성이나대회SDK요건충족을주장하지않습니다.
- 공개배포/게시/출품/유료API/키생성/새모델다운로드는수행하지않았습니다.

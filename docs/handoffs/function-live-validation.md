# 실제 브라우저·로컬 GPU 통합 검증

2026-10-19 한국시간 22:13 최종 검증 완료. 대상은 실제 `http://127.0.0.1:8190/`, 최신 캐릭터 스튜디오 빌드입니다. **생성/수정/비교/JSON 및 PNG 다운로드/오프라인 파일 복원/자동 복원/후보 카드 Enter 포커스 유지까지 실제 검증했습니다. 그림 품질은 통과로 평가하지 않습니다.**

## 실행 방법과 환경
- Aside CLI guide는 읽혔지만 sandbox의 skills list/repl은 `uv_os_get_passwd ENOMEM`. 총괄이 허용한 대안으로 번들 Playwright와 설치된 Chrome을 사용했습니다.
- `C:/Program Files/Google/Chrome/Application/chrome.exe` headless 새 임시 프로필/새 context. 기존 사용자 프로필·쿠키·작업 데이터를 사용하지 않았습니다. 외부 유료 서비스, 패키지 설치, 모델 교체, 서버 재시작 없음.
- local ComfyUI health 정상, RTX5060/8GB, 기존 SD Turbo 설정. ROI OFF.
- `work/function-live-validation/run.cjs`: DOM 읽기/화면 캡처 → 실제 UI 버튼으로 생성·비교·부분수정·다운로드. 네트워크 POST를 관측하여 원본·마스크·seed를 확인합니다.
- `restore.cjs`: 기존 다운로드 파일만 사용하여 오프라인 복원·재저장·IndexedDB 복원·모바일·키보드 패널을 확인합니다. 추가 GPU 호출 없음.
- 원본 실행 자료는 `work/function-live-validation/run-2026-10-19T13-03-34-543Z/`에 보존합니다.

## 실제 결과
|검증|결과|
|---|---|
|텍스트에서 후보2개|성공. seed601019/601020, 모두 cache miss, model_calls1|
|첫 두 후보 비교|실제 카드 선택/비교 패널2이미지 표시 성공|
|후보1을 원본으로 마스크 수정2개|성공. seed601100/601101, 동일한 원본 DataURL·동일한 마스크 DataURL, parentId 모두 후보1|
|마스크 밖 보존|두 결과 모두225,280픽셀 RGB 차이0, alpha 차이0|
|실제 수정 발생|흰 마스크 내부36,864픽셀 모두 RGB 변경|
|마스크 업로드|제출된 Canvas PNG와 준비한 마스크의 L 픽셀 완전 일치. 직사각형[160,224,352,416]|
|프로젝트 다운로드|실제 브라우저 다운로드. 2,162,492바이트, 내장PNG4개·선택기록4개·원본 관계 포함|
|보드 다운로드/열기|실제 브라우저 PNG 다운로드. 1,496,572바이트,1600×2408. Pillow verify+전체디코딩 및 실제이미지 열어 확인|
|오프라인 파일 복원|새 context에 앱을 먼저 로드한 뒤 browser network offline 상태에서 JSON 불러오기 성공. 이미지4개 디코딩, 원본 JSON과 데이터 완전 일치|
|오프라인 재저장|다운로드 JSON과 원본 프로젝트 데이터 완전 일치|
|IndexedDB 복원|네트워크 복귀 후 새로고침. 후보/설정/기록 완전 일치|
|비교 패널 키보드|열기 시 panel focus, Escape 닫기, 비교 버튼으로 focus복귀 통과|
|후보 카드 Enter|비교 선택/비교 해제/크게 보기 후 동일한 후보의 해당 BUTTON 포커스 유지. 크게 보기 후 Tab은 같은 후보의 이어서 수정으로 이동|
|390px|데스크톱→390px 전환 및390px 새로고침 모두 문서너비390px, 설정접힘|
|브라우저 오류|성공한 최신 복원 실행 pageerror0|

주의: 원본/수정본은 RGB 파일이므로 alpha 검증은 불투명255의 동등성입니다. 가변 투명도를 가진 실제 GPU 입력을 이번 시나리오에서 추가 검증했다고 주장하지 않습니다. 오프라인 검증은 이미 로드된 앱에서의 파일복원이며 PWA 오프라인 최초 실행 검증이 아닙니다.

## 발견한 앱 문제와 수정
빈 새 프로젝트에 JSON 파일을 처음 불러올 때 파일선택의 editEpoch 증가를 실제 사용자작업으로 오인하여 ‘작업 폐기’ 확인창을 띄웠습니다. 자동 브라우저의 기본 dialog dismiss로 최초 흐름은 복원에서 중단됐습니다.

`app.js` hasWork를 실제 브리프/팔레트/용도·후보·원본·진행중 작업으로 판단하도록 수정했습니다. 빈 파일불러오기는 확인창0회, 색상/용도만 변경한 새 프로젝트는 확인창을 유지합니다. 회귀2개 RED→수정→GREEN, 전체65개 통과.

추가 키보드 P2도 수정했습니다(app.js2026-10-19 22:10:51 KST). renderGallery 전에 초점을 가진 후보 ID/조작 종류를 저장하고 카드 재생성 후 동일한 버튼에 preventScroll로 초점을 돌립니다. 비교선택→해제→크게보기 테스트의 BODY 소실 RED를 먼저 확인했고, 현재 UI36+프로필19+보드11=66개 통과.

**마지막 재빌드22:12:55 KST 이후 실제 Chrome Enter 재검증 완료(22:13:13~22:13:17 KST).** `restore-final-keyboard.json`에서 servedCurrentApp=true, passed=true, pageerror0, dialog0. 비교 선택/해제/크게 보기 모두 같은 candidateId의 대응 BUTTON에 포커스가 남습니다. 이어 Tab은 해당 후보의 이어서 수정으로 이동합니다. 같은 실행에서 오프라인 복원·재저장·IndexedDB 새로고침·패널Escape·390px리사이즈/재로딩도 다시 통과했습니다. 최종 정규화 HTML SHA256: `3a84181e155003be44524af60bac6863bbfbf19ecd78598a8628e2cf80550129`.

이전 디자인 재빌드(index.html22:06:28 KST, app.js22:06:09 반영)에서도 `restore-after-fix.json`으로 확인창0회 및 전체복원검증 passed=true를 확인했습니다. 이 중간 기록의 정규화 HTML SHA256은 `9daf3255810e1821ec6142d6b82304d75a875025fbd3af7409f80faa3c155af4`입니다. 최종 최신판 증거는 위의 `restore-final-keyboard.json`입니다.

초기 스크립트의 전체문자열 빌드 비교는 Windows CRLF/LF 차이를 정규화하도록 보정했습니다. 복원 재검사 스크립트의 자동저장 상태문구 대기 위치도 ‘수동 저장 후’에서 ‘수동 저장 전’으로 옮겼습니다. 이 두 사항은 테스트 스크립트 보정이며 앱 결함으로 계산하지 않습니다. 과거 실패 report를 삭제하지 않았고 최종판은 `restore-final-keyboard.json`입니다.

## 그림 품질 — 미통과
실제 출력 자체를 확인했습니다. 단일 캐릭터 지시에도 첫 후보에 두 인물이 나오며, 다른 후보에는 분리된 의상 같은 원치 않는 요소가 보입니다. 부분 수정은 지정 영역 안의 픽셀만 바꾸는 기능은 성공했지만, 네모난 경계·의상/신체 불연속이 두드러지고 요청한 붉은 가방이 자연스럽게 구현되지 않았습니다. 후보4는 내부에 어울리지 않는 다리/손 형태가 생깁니다.

따라서 **마스크밖0오차는 확인됐지만, 자연스러운 캐릭터 편집이나 최우수상 수준의 결과 품질은 입증되지 않았습니다.** 새 모델/워크플로 선택과 품질 개선은 별도 결정이 필요합니다. 이 검증에서는 품질을 좋아 보이게 만들기 위한 반복 재생성이나 결과 교체를 하지 않았습니다.

보드 파일 자체의 제목/한글메모/영문설정/3색 팔레트는 읽히고, 선택한 두 이미지의 비율·텍스트 잘림 문제는 보이지 않았습니다. 보드 안 그림의 품질 문제와 문서 출력의 정상 동작을 구분합니다.

## 주요 증거 파일
- `work/function-live-validation/run-2026-10-19T13-03-34-543Z/report.json`: 실제4요청·다운로드·첫 복원 실패 기록.
- 같은 폴더 `restore-after-fix.json`: 수정 후 실제 복원/키보드패널/390px 성공.
- 같은 폴더 `restore-final-keyboard.json`: 마지막66개회귀 소스 내장 빌드의 실제 Enter3경로·다음Tab·복원·모바일 모두성공. `restore-final-keyboard-focused-view.png` 및 offline/mobile 캡처 동반.
- `pixel-verification.json`, `pixel-verification-alternative.json`, `mask-fixture-verification.json`: 원본·수정본·마스크 해시와 독립 픽셀 검증.
- `original.png`, `alternative.png`, `edited.png`, `edited-alternative.png`, `submitted-mask.png`.
- `사막의 연금술사 · 로컬 검증.pankeki.json`, `offline-export.pankeki.json`, `사막의 연금술사 · 로컬 검증-board.png`.
- `03-compare.png`, `04-source-and-mask.png`, `06-original-edited-compare.png`, `restore-after-fix-offline.png`, `restore-after-fix-mobile-reload.png` 및 각 DOM snapshot.

대회 SDK 실제 생성 경로, 생성품질 개선, 완성 시연/출품은 이 검증의 완료 항목에 포함하지 않습니다.

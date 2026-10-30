# 따뜻한 Pankeki 화면 구현 — 디자인·사용성

2026-10-20 KST. 승인된 `docs/product/design-walkthrough-warm-20261020/`의 7개 PNG·README·theme-tokens를 기준으로 기존 Python+HTML 앱에 구현한다. 로고·작품·마스크 색은 바꾸지 않는다. 최종 공유 빌드는 총괄 요청 전 대기한다.

## 구현 전 DOM·탐색 계약 — 프론트 계약 채택

기존 ID 117개와 type/accept/maxlength 및 API 경로를 유지한다. 디자인 담당은 template/CSS/assets/build만 수정한다. `app.js`, `profiles.js`, 백엔드는 다른 담당 소유다.

- `warm-frontend-implementation.md`를 읽고 프론트 담당의 계약을 채택했다. **studio.js가 탐색/action/요약 상태를 소유**하며 디자인 템플릿은 이 기능을 중복 구현하지 않는다. 빌드 순서는 profiles.js → app.js → studio.js → 기존 템플릿의 모바일·마스크 표시 보조 코드다.
- JS가 `body[data-studio-screen]`을 관리한다. 값은 `home`, `design`, `compare`, `inpaint`, `parts`, `motion`, `export`다. 단계 버튼은 `[data-studio-go]` 네이티브 버튼이며 기본 home이다. 단순 이동은 현재 후보·브리프를 초기화하지 않는다.
- `[data-studio-page]`는 신규 home/parts/motion/export 패널이다. design/compare/inpaint는 기존 `.app-shell`/`#workspace`/`#gallery`/`#comparePanel`/원본·마스크를 재사용한다. 기존 ID를 복제하지 않는다.
- `[data-studio-action]` 값은 `new|upload|import|save|board|download|continue|help`다. studio.js가 기존 클릭/상태 검사를 전달한다. 파일 처리·저장·생성 요청을 템플릿에 구현하지 않는다. 생성은 기존 `generate` 한 개를 유지한다.
- `[data-settings-tab=brief|chat]`은 기존 왼쪽 설정/미연결 대화 전환이다. 기존 mobile showChat/showResult도 유지한다. 상세 설정의 실제 모델·옵션·후보 수·생성 버튼은 오른쪽 패널로 이동하며 ID와 핸들러를 유지한다.
- 요약은 `studioTitle`, `studioStatus`, `studioCandidateCount`, `studioCurrentImage`, `studioCurrentSummary` 및 `[data-studio-summary="name|candidates|source|status"]`를 제공한다. 각 예정/출력 화면의 실제 기준 이미지 슬롯은 추가 `[data-studio-image]` img이며, 바깥 `.studio-image-frame` 안에 빈 상태 문구가 함께 있다. 프론트 담당은 실제 src가 있을 때 img.hidden=false, 없을 때 true로 유지하면 CSS가 빈 문구를 제어한다. 빈 프로젝트에는 가상의 최근 프로젝트·부위·표정·AI 응답을 넣지 않는다.
- parts/motion은 **개발 예정** 패널이다. 색·좌표·메시·표정·동작·확장 출력 control은 disabled이며 저장 성공을 만들지 않는다. 현재 할 수 있는 원본 불러오기·수동 마스크 수정·기존 JSON/PNG/보드 저장으로 연결한다. 이름 붙인 부위나 리그 준비 상태는 이 구현이 생성하지 않는다.

디자인 담당은 설정/대화 탭과 기존 모바일 화면·마스크 표시 보조 코드만 유지한다. 기존 `label[for=upload]` 진입점은 앞선 인계에서 이미 네이티브 버튼으로 바뀌었다. `data-upload-trigger`도 계속 지원한다. 기존 동작에 필요한 계약 변경이 생기면 이 문서에 명시한다.

## 완료·검증

구현과 통합 빌드 완료. 총괄의 최종 빌드 요청을 받아 공유 HTML까지 반영했고 검토로 넘긴다. 프리뷰는 `http://127.0.0.1:8192/final/`이며 `web/index.html`을 그대로 읽는다. 생성 API는 의도적으로 503인 **검증 프리뷰**다. 8190의 Python/SDK 서비스 실행이나 실제 생성 성공으로 표현하지 않는다.

### 실제 변경 파일

- `web/src/index.template.html`: 7개 탐색용 markup, 프로젝트 홈, 생성/비교/마스크의 공통 DOM, 부위·표정/동작 준비 상태, 실제 저장/출력 패널. 모델 설정·후보 수·기존 generate 한 개를 오른쪽으로 이동했다. 설정/대화와 모바일 표시 보조만 템플릿이 소유한다.
- `web/src/style.css`: 승인된 warm 토큰과 7개 화면의 desktop/390px 배치, 오류/선택/disabled/초점 표시, 가독성과 썸네일 처리.
- `web/build.py`: profiles.js → app.js → studio.js 순서로 포함하도록 변경.
- `web/index.html`: 총괄 요청 뒤 위 소스와 프론트 담당의 최종 JS를 통합한 자체완결 산출물.
- 이 인계와 `work/team-resume/design/warm/`의 빌드 스냅샷·검증 스크립트·JSON·화면·시각 QA 기록.

`app.js`, `profiles.js`, `studio.js`, 백엔드는 이 담당이 수정하지 않았다. 프론트 담당이 제공한 실제 탐색/상태 계약을 사용했다. `web/assets`에도 새 파일을 추가하지 않았고 선택된 로고는 그대로다. 모델/폰트/패키지를 다운로드하지 않았으며 GitHub/README/원격은 변경하지 않았다.

### 최종 화면과 동작

홈의 새 작업/이미지 불러오기/프로젝트 불러오기와 실제 현재 프로젝트 재개, 생성의 설정/미연결 대화/캔버스, 비교의 기존 후보 2개와 수정 복귀, 부분 수정의 원본·마스크·브러시·마스크 PNG, 출력의 기존 JSON/이미지/보드 경로를 연결했다. 네 기존 핵심 DOM을 복제하거나 이미지로 대체하지 않았다. 부위·표정/동작은 실제 기준 이미지와 ‘부위 없음/리그 없음/개발 예정’ 안내를 표시하고 해당 엔진/저장 control은 disabled다. 투명 부위·변형·표정 시트·연속 프레임·Codex 성공을 꾸며내지 않는다.

모바일은 상단 전체 단계와 디자인 3개 하위 단계, 설정/결과 전환을 유지한다. 설정 끝에 `warmShowCanvas` 버튼을 두고 부분 수정 경로는 결과 캔버스를 연다. 데스크톱 후보 strip은 가로로 배치하고 비교 화면에서는 기존 목록을 세로로 사용한다. 작품·마스크에는 warm 필터를 적용하지 않았다.

### 검증 명령과 결과

작업 위치 `D:/Pankeki`. 설치된 Python/Node/Chrome만 사용했다.

```powershell
& 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' work/team-resume/design/warm/build-preview.py
& 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' web/build.py
node work/team-resume/design/warm/serve-preview.cjs
node work/team-resume/design/warm/verify-browser.cjs --final
node work/team-resume/design/warm/verify-home-fix.cjs
node work/team-resume/design/warm/compare-and-verify.cjs
```

현재 검증 서버는 켜 둔 상태다. 다시 실행할 때 8192 listener가 있으면 중복 기동하지 않는다. `web/build.py`는 최종 통합 때만 실행한다. 최초 통합 빌드 뒤 시각 대조에서 홈 카드의 얼굴 잘림을 발견하여 `object-position` 한 곳을 수정하고 산출물을 갱신했다. 최종 빌드는 총 2회이며 마지막 변경은 그 CSS 표시 위치뿐이다.

- 실제 Chrome 1536×1024·390×844: **94/94 통과**, 페이지 오류 0, API 쓰기/생성 요청 0. 7개 탐색·빈 상태, 설정/대화, 미연결 send, 3후보 복원, 실제 비교 DOM, 비교→부분 수정, 원본/마스크 정렬, 개발 예정 disabled, JSON 다운로드, 건너뛰기, 가로 넘침·가로 control 잘림을 확인했다.
- 마지막 홈 썸네일 표시 위치 변경은 같은 실제 최종 HTML에서 **2/2 브라우저 검사**와 캡처로 확인했다. 다른 화면은 앞선 검증을 재사용하며 전수 테스트를 반복하지 않았다.
- DOM 검사 **5/5 통과**: 기존 117 ID 보존, 최종 136 ID 중복 0, label 대상 누락 0, 새 page 4개, 7개 탐색 경로 일치. 프론트 담당의 Node 92개 결과는 별도 인계를 따르며 이 담당은 전체 기능 테스트를 재실행하지 않았다.
- 시각 검증 당시 파일은 격리 프리뷰와 바이트 동일했다. 아래 후속 문구 정리 후 현재 `web/index.html`은 그 파일에서 상태 문구만 바뀌었다. 현재 디스크 2,033,288 bytes(빌더 보고의 줄바꿈 변환 전 UTF-8 길이는 2,031,702 bytes), SHA256 `e06ffe137d08e7f3aa6add11b63124e8c1682fc3604ab4884eb482572a0beefe`.

기계 증거: `warm/dom-contract.json`, `browser-report.json`, `home-thumbnail-fix.json`, `preview-manifest.json`, `final-integration.json`. 시각 QA: `warm/preview/design-qa.md`, **final result: passed**. source/실제 화면을 함께 담은 대조 보드 7장과 native 크기의 설정 대조 `screens/comparison-controls.png`를 열어 확인했다.

### 화면 증거와 의미

`work/team-resume/design/warm/screens/`에 다음을 남겼다.

- `1536-01-home-empty.png`, `390-01-home-empty.png`: 가상의 최근 프로젝트가 없는 빈 홈.
- `1536-01-home-sample.png`, `390-01-home-sample.png`: 실제 가져온 검증용 현재 프로젝트와 최종 썸네일 수정.
- `1536-02-design-sample.png`, `390-02-design-sample.png`: 생성 화면의 기존 후보, 설정과 생성 서버 미연결.
- `1536-03-compare-sample.png`, `390-03-compare-sample.png`: 실제 2후보 비교.
- `1536-04-inpaint-sample.png`, `390-04-inpaint-sample.png`: 기존 원본과 밝은 마스크 정렬.
- `1536-05-parts-sample.png`, `390-05-parts-sample.png`, `1536-06-motion-sample.png`, `390-06-motion-sample.png`: 실제 원본과 부위/리그 준비 전 표시.
- `1536-07-export-sample.png`, `390-07-export-sample.png`: 기존 출력과 예정 출력을 구분한 화면.
- `1536-chat-disconnected.png`, `390-chat-disconnected.png`: 미연결 대화와 비활성 전송.
- `comparison-01-project-home.png`부터 `comparison-07-project-export.png`: 승인 시안과 실제 캡처를 나란히 배치. `initial/`은 썸네일 방향/글씨/얼굴 잘림 수정 전 증거다.

샘플은 이전 실험 결과를 가져온 `[검증용] 사막의 연금술사`이며 새 추론이나 사용자 최근 결과가 아니다. 브라우저 격리 context만 사용해 실제 사용자 저장소를 채우지 않았다. 원본 512px 샘플을 확대하는 품질 한계가 있으며 새로운 SDXL 결과처럼 표현하지 않는다.

### 한계와 총괄에게 넘길 다음 단계

시안의 준비된 부위/메시/표정/9칸 출력 결과를 그대로 만들면 미구현 기능을 성공처럼 보이게 되므로 준비 전 상태로 구현했다. 현 version1 brief/실제 수치 옵션을 유지했고 새 외형 dropdown 의미나 종횡비 프리셋은 임의로 추가하지 않았다. 화면 구조/색상 적용과 기존 경로 연결 완료이며 부위·리깅·동작·Codex 연결 완료가 아니다.

앱 내 CUA는 초기화 단계의 `permission path cannot be represented losslessly` 오류로 사용할 수 없었다. Aside의 실제 접근성 트리 조회는 성공했고 설치된 독립 Chrome으로 실제 화면/동작을 검증했다. 실제 휴대폰 키보드·터치, Safari/Firefox, 스크린리더, 종합 대비 인증, 정상 모델 catalog/SDK/GPU 추론은 범위 밖이다. 반복 이미지 생성·GPU 실험·모델 설치·원격 게시를 하지 않았다.

총괄은 최종 프리뷰와 위 공유 HTML을 검토하면 된다. 정상 모델/SDK 환경과 Codex 연결의 실제 통합은 해당 담당의 검증 조건이 갖춰진 뒤 별도로 진행한다. 디자인 담당의 이번 구현은 여기서 종료하고 추가 확장 없이 검토를 기다린다.

### 후속 상태 문구 정리 — 2026-10-20 KST

총괄의 좁은 후속 요청에 따라 `web/src/index.template.html`의 `chatModelStatus` 한 곳을 ‘로컬 대화 모델 미연결’에서 **‘Codex 대화 미연결’**로 바꾸고 `web/build.py`를 1회 실행해 공유 HTML을 갱신했다. CSS·빌드 로직·기능 JS·백엔드·동작은 변경하지 않았다. `chatSend`의 disabled를 유지했고 연결·인증 완료를 표시하지 않는다.

`check-codex-copy.py`의 최소 검사 **4/4, exit0**: 소스/빌드 상태 문구 일치, 이전 시각 검증 프리뷰와의 차이가 이 문구뿐임, 소스/빌드 전송 disabled 유지, app.js/profiles.js/studio.js의 기존 해시 일치. 전체 테스트·브라우저 재촬영·GPU 실험은 하지 않았다. 이전 화면 증거는 문구 변경 전 증거로 재사용한다.

검증 명령: 설치된 Python으로 `work/team-resume/design/warm/check-codex-copy.py`. 결과는 `codex-copy-check.json`, 최신 인계 해시는 `final-integration.json`에 갱신했다. 이전 시각 검증 빌드 해시는 `previous_visual_sha256`으로 보존했다. 디자인과 기본 화면은 완료됐으며 **실제 Codex 채팅과 부위/메시 엔진은 미구현**이라는 상태가 유지된다.

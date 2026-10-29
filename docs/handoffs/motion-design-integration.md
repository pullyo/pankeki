# 움직임 디자인 구현 — T5 UI / T8

## 시각 개편 인계 — 사용자 시안 선택 대기

총괄의 `work/team-resume/motion-active-coordination.json` / `visual_refresh`를 확인했다. Apple 디자인 원칙과 Liquid Glass를 반영한 새 시각 개편은 **가장 최근에 표시한 수정 시안3개의 배치 선택 대기**다. 기존 기본 시안3개와 표시 순서를 혼동하지 않는다. 선택한 정확한 이미지가 전달된 뒤 구현 기준으로 사용한다. 이 상태 기록으로 제품 template/CSS/build/HTML 또는 예제 소재를 변경하지 않았다.

후속 구현 재질 원칙은 따뜻한 브랜드와 선명한 캐릭터/콘텐츠 유지, 기능 조작층에만 glass 적용, 글이 많은 패널의 높은 가독성과 낮은 투명도/regular 재질, glass 중첩·과한 발광 방지다. 현재는 추가 이미지 생성·테마 코드·넓은 리디자인의 착수 지시가 없다. 이미 승인된 M01–M09 구현/QA는 시안 선택과 별도로 계속하며 재승인 대상으로 바꾸지 않는다. 디자인의 기존 빌드·실제 시연·해시 인계는 아래 기록대로 유지하고, 남은 전체 수용 판정은 기존 QA 담당이 이어간다.

## 최신 상태 — 실제 시연·후속 영향 검사·공유 최종 빌드

**2026-10-20 16:00 KST 공유 `web/index.html` 빌드 완료**, 2,419,928bytes / SHA256 `435515fb7e4b436f1496622eac99f599bdd9bc04b3b17f47f1580aee9b4adc32`. 승인된 원래 명령 `D:/Pankeki/.venv/Scripts/python.exe web/build.py` exit0이며 실제 브라우저 영향16개를 통과한 **8197 고정 후보와 바이트가 같다**. `work/team-resume/design/motion/shared-build-manifest.json`에 원본/최종 SHA·입력 일치·빌드 명령/시간을 남겼다.

사용자용 실제 origin은 **http://127.0.0.1:8197/** 이다. 정적 localhost HTTP 서버 PID16884 / exec session53637이며 재시작은 `node work/team-resume/design/motion/serve-first-motion.cjs followup`이다. 서버는 `motion-followup-preview/index.html`의 고정 바이트를 사용한다. source controller `269bc88e4872d4e42846574af26d772eebae612530d068d72705ef14e6041062`, renderer `70891975dd9ee245296b7a373203f117cdb3aa65869f5e4299c039bf72c426ae`. 최초8196시연과 비교해 입력 파일은 controller 하나만 바뀌었다. 입력 전체 SHA는 `motion-followup-inputs.json`이다. renderer 이음새 초기 FAIL은 아래 역사 기록이며 최신 기본 UI의 source 대조는 다른 RGBA 채널0이다.

프론트 최신 `live-followup-manifest.json`의 controller22+app8=30GREEN와 동일 source를 소비했다. 최초 지시의253f20… 중간본은 복사 가드에서 거절했고, 그 뒤 전달된269bc88e… 최종본으로 한 번 빌드했다. 실제 HTTP/Chrome의 **PLAY001·INIT001·가져온 메뉴 cache 영향16/16**, pageerror0, backend 생성/쓰기0이다. 빈 시작 ready=false/오류 없음, 예제→실제blink-breath선택→play/pause/play/pause의 선택 유지·시간별 눈/호흡/캔버스 변화·정지값 유지, 실제 JSON 파일 가져오기 후 `saved-cycle` 메뉴 교체와 같은 재시작 경로를 확인했다. `motion-followup-browser.json`, `motion-followup-*-playing.png`, `motion-followup-final-paused.png` 참조. 첫 영상은 다시 녹화하지 않았고 전체 suite/T9를 반복하지 않았다.

사용자 실제 foreground 브라우저는 OS 기본 URL 열기 후 Aside의 실제 활성 탭 `2CB2055C062562F847D58AC6BE5C3C47`에 attach했다. **부위→팬케이크 예제→표정·동작→재생**의 실제 버튼을 눌렀고, snapshot의 재생중 status/정지 버튼 활성·document.hidden=false·ready/playing=true·revision0·error=''를 확인했다. 눈0.868/호흡0.8632의 관찰값과2초 시간 진행이 표시됐다. 이후 화면을 전환하거나 정지하지 않고 남겼다. 사용자가 다른 탭/앱으로 가면 의도된 숨김 정지 정책이 적용되므로 영구 재생을 보장한다고 해석하지 않는다. 실제 foreground 제어는 디자인 단독 소유이며 프론트/root/QA는 중복 탭 조작을 하지 않기로 조율했다.

즉시 표시 가능한 최초 영상은 `D:/Pankeki/work/team-resume/design/motion/pankeki-first-motion.webm`이며 **9/9 실제 play/pause/픽셀·영상 디코드 검사**와 함께 `docs/handoffs/motion-first-demo.md`에 인계했다. 최초8196 HTML SHA6d3170… 및 영상 SHA6d6dc6…는 최종 공유 빌드 전후 불변을 검사했다. **T5 디자인·T8 소재/따뜻한 UI 최종 공유 빌드는 준비 완료**, 전체 사용자 PNG·저장 재개·PNG/48ZIP·취소/한도·성능/전체 alpha 수용은 QA T9가 계속 맡는다. 아래의 미빌드·초기 이음새·입력 변경 기록은 당시 상태로 보존한다.

## 초기 작업과 동결 후보 기록

2026-10-20 KST. 승인 계획/spec을 읽고 실제 구현에 착수했다. 첫 산출물은 `motion-ui-contract.md`이며 ID/data/action을 고정했다. 프론트/렌더러/출력 모듈은 다른 담당 소유다.

진행 기록·기준/최종 SHA·테스트 증거는 `work/team-resume/design/motion/`에 보관한다. 이 인계에 실제 변경, 소재 검증, 모듈 대기와 최종 빌드 여부를 이어 기록한다. 이번 착수는 UI와 자체 제작 RGBA 예제이며 실제 전체 엔진 완료 주장이 아니다.

## 실제 첫 변경과 모듈 연결 대기

- `motion-ui-contract.md`를 먼저 고정하고 template에 부위/원본·PNG·배경 수동 확인, 메시/정점 숫자·key 등록, 프리셋·0..1 슬라이더/숫자 3쌍, 곡선/재생/정지/seek, undo·v2 저장·48출력/취소/progress를 구현했다. 컨트롤은 아직 실제 controller가 연결하기 전 disabled다.
- `style.css`는 기존 warm 토큰을 유지한 편집 패널과 실제 Canvas/overlay, 좁은 화면용 보기·간단 조절/접이식 정밀 도구를 추가했다. 기존 ID 136개를 보존했다.
- `web/assets/motion-demo/`에 직접 작성한 SVG 4부위/배경과 제작 master, 브라우저로 렌더한 실제 RGBA PNG 5개, v2 project와 provenance를 만들었다. 원본은 실제 PNG 기본 합성이고 몸에 눈·입이 중복 그려져 있지 않다. 사각형 fixture·영상·이미지 생성·다운로드를 쓰지 않았다.
- `build.py`에 계획의 7개 script 순서와 `MOTION_DEMO_JSON`의 자기완결 내장을 준비했다. 초기에는 controller 전달을 기다렸으며, 현재는 7개 모듈과 app/studio 연결이 모두 도착해 아래 격리 통합 후보까지 검증했다. 공유 최종 HTML 교체는 아직 하지 않았다.

UI/소재 검사는 미구현 RED 9개를 확인한 뒤 **29/29 GREEN**이다. 실제 Chrome decode·문서 공개 API·렌더러 검사는 **9/9**다. source PNG는 준비 PNG를 기본 pose로 합성한 것과 모든 RGBA 채널이 같다. 실제 renderer의 공개 evaluate/draw로 각 파라미터 0/.5/1을 렌더한 9개 PNG를 `work/team-resume/design/motion/poses/`에 보존했으며 각 파라미터의 최소/중간/최대 파일·정점 hash가 다르다. 이 직접 모듈 검증은 아직 사용자 UI 전체 완료 증거가 아니다.

## 총괄이 기술 담당에게 전달할 재현 사항

실제 캐릭터를 `PankekiRenderer.drawPose`로 그린 PNG에서 메시의 공유 대각선·세로 경계에 가는 밝은 이음새가 눈에 보인다. 제작 PNG 원본/native 기본 합성에는 없다. `poses/eyeOpen-1.png`가 기본 pose이며 `web/assets/motion-demo/source.png`와 대조할 수 있다. 같은 선이 `eyeOpen-0.png`, `mouthOpen-1.png`, `breath-1.png`에도 보인다. 눈/입/호흡의 실제 정점 변화는 있지만 이 현상 때문에 alpha/시각 품질 완료로 판정하지 않는다. 재현은 `node work/team-resume/design/motion/verify-assets.cjs`다. 디자인 담당은 렌더러 파일을 수정하지 않았다. 원인 조사/최소 수정과 최종 RGBA 수용 판정은 기술 담당·QA에 남긴다.

## 통합 후보와 최종 기록

전달된 실제 7개 모듈·template/CSS/build·예제·선택 로고·vendor를 `work/team-resume/design/motion/integration-input-web/`에 바이트 그대로 복사한 뒤 그 폴더의 **동일한 build.py**를 실행했다. 이것은 테스트 입력의 동결 복사본이며 새 저장소/worktree가 아니다. 공유 `web/index.html`은 이 과정에서 쓰지 않는다. 입력별 SHA는 `integration-inputs.json`, 실행 결과는 `integration-build.log`에 있다.

- 후보 HTML: `work/team-resume/design/motion/integration-input-web/index.html` · 2,411,156 bytes · SHA256 `84b8d9bacd0a374d3bcda3e82795ddad27f4e44732590377c45a27f82ba39184`. 자체 검토 중 프론트 담당의 controller 갱신을 발견해 복사본을 갱신하고 연결14개를 다시 통과했다. 당시 controller SHA256은 `0422f9d0e5d1cff2629c0828148393b263b39e6cd9bf1859b54fa6433e32b378`이다. 이후 변경은 이 후보 검사에 포함되지 않으며 최종 manifest의 입력 일치 여부를 확인한다.
- 정적 origin `http://127.0.0.1:8195/`는 검사 브라우저의 route fulfillment만 사용한다. 실제 backend 서버가 아니며 API는 503으로 격리했다. 앱/controller는 실제 코드 그대로 실행했다.
- 1536×1024와 390×844에서 실제 예제 버튼→3부위 준비→빈 화면 해제→눈 숫자0.5 입력→슬라이더/실제 문서값 동기화→640² canvas→출력 준비 상태→가로 넘침 없음 **14/14**. page error0, backend 쓰기/생성 요청0. `integration-browser.json`, `1536-motion-integrated.png`, `390-motion-integrated.png` 참조. 모바일 스크린샷은 숫자 조절부에 초점이 이동한 상태다.
- 비활성 UI layout specimen은 별도 `layout-preview.html`이며 1536/390의 parts/motion/export와 메시 overlay 정렬 **17/17**. 이것을 동작 UI 증거로 혼동하지 않는다.
- 최종 예제 `project.json`: 262,904 bytes · SHA256 `f66cb7462833a7414f156b818be9c67bafca0d9373a6e0f9bf943a24ed707b70`. 5 PNG·3부위·3리그·2프리셋·2동작이며, 프리셋/동작은 문서 모듈이 허용한 label로 한국어 이름을 표시한다. geometry/PNG 바이트는 label 추가로 바뀌지 않았다.
- 공유 `web/index.html`은 기준 SHA256 `e06ffe137d08e7f3aa6add11b63124e8c1682fc3604ab4884eb482572a0beefe` 그대로다. 소유 제품/소재 19개 파일의 기준/최종 SHA, 도착 모듈, 후보 입력의 현재 일치 여부는 `final-manifest.json`에 있다.

마지막 기록에서 `sourceSnapshotStillMatches=false`다. 프론트 작업이 계속되어 실제 `character-motion.js`가 다시 SHA256 `585979ece0cd3f3d3fe1cf386cf250ceac26db0837e06ae9af69adccd9250f80`으로 갱신되었다. 위14개 통과는 명시한 동결 후보 버전에만 적용된다. 동시 작업의 매 저장을 따라 반복 빌드하지 않고 후보·원본 hash를 남겼으며, 프론트/렌더러 수정본 확정 후 통합 검사를 갱신해야 한다.

재현 순서(프로젝트 루트): 설치된 Python으로 `verify-design.py green`, `node work/team-resume/design/motion/verify-assets.cjs`, 설치된 Python으로 `build-integration-preview.py`, `node work/team-resume/design/motion/verify-integration.cjs`를 실행한다. Python 스크립트 경로의 접두사는 모두 `work/team-resume/design/motion/`이다. 새 설치나 실제 backend는 필요 없다. 정적 배치만 확인할 때는 `build-layout-preview.py` 뒤 `verify-layout.cjs`다.

자체 검토에서 기존136개 ID 보존·모든 신규 ID 유일성·0..1 입력쌍·Canvas/overlay 표시 경계·모바일 정밀도구 안내·v1/v2 저장 구분·Codex 비활성 문구·소재 출처/알파/중복 눈·입 없음·공개 parser/renderer 사용·소유 파일 경계를 대조했다. 앱/문서/렌더러/출력/controller JS는 수정하지 않았다. 새 채팅/에이전트/패키지/모델/추론/GPU 사용도 없다.

**현재 완료 범위는 T5 디자인 계약·마크업/CSS와 T8 원본 소재·격리 통합 후보다.** 렌더러 이음새 수정 뒤 총괄 통합 시점에 `D:/Pankeki/.venv/Scripts/python.exe web/build.py`로 공유 HTML을 만들고 새 입력/출력 SHA를 기록해야 한다. 소스가 바뀌면 바뀐 경로의 검사만 갱신한다. 전체 사용자 PNG 준비·메시/key 편집·재생/정지/seek·undo·저장 재개·PNG/48프레임 ZIP·취소/상한·실장비 성능·RGBA 품질 수용 판정은 T9 담당이 수행한다. 현재 수치·연결 검사만으로 이 항목을 완료 처리하지 않는다.

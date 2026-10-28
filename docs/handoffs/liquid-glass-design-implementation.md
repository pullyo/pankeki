# Liquid Glass 시각 개편 — 실제 구현 진행

2026-10-20 KST. 사용자 요청과 총괄의 착수 지시를 반영했다. 정확한 기준은 최신 수정2번 편집 `exec-c66994f9-f527-4143-bd66-160ae9c19c6b.png`와3번 움직임 `exec-917da3d3-8df3-48cf-b910-02608a090254.png`이며 실제 이미지를 열어 확인했다. 새 선택/재승인을 기다리지 않는다. 기존 앱의 한정된 시각 변경으로 분류하고, 기존 승인·선택을 새 brainstorming gate로 되돌리지 않는다.

작업 복사본: `D:/Pankeki/work/design/liquid-glass-20261020/`. QA8197의435515fb…adc32 snapshot28파일을 그대로 복사하고 전체 baseline SHA를 `evidence/baseline.json`에 남겼다. 기존제품 D:/Pankeki/web, QA8197/source/evidence, 첫8196영상은 수정하지 않는다. 새 Git/worktree/프로젝트 starter/채팅/subagent/의존성/모델/이미지 생성은 없다. 선택 로고·기존 실제 RGBA 예제를 재사용한다. product-design image-to-code/design-qa를 적용하되 사용자 지시와 기존 프로젝트 구조를 우선한다.

시간 분리: 원래19:30–20:30예측은 두 화면의 구조 재배치까지 포함했으며, 사용자 피드백에 따라 **현재 배치/ID/조작 유지 → 재질·서체·간격·버튼 우선순위의 실행 중간본**을 먼저 만든다. 첫 중간본 목표17:15–17:30 KST. 오른쪽 편집 도구 통합·캐릭터 중심 움직임 재배치와 다른 화면 스타일 통일은 이어 진행한다. 중간본을 전체 리디자인 완료로 부르지 않는다.

실제 첫 변경: 복사본 `web/src/liquid-glass.css`와 이를 붙이는 `web/build.py`를 작성하고 같은 원래 Python build를 exit0으로 실행했다. template/IDs/조작/business JS는 첫 단계에서 그대로다. 선명한 콘텐츠, 기능 chrome의 한 겹 glass, 글 많은 패널91% regular표면, 전역 산세리프, 40–44px주요버튼, 선명한 focus, 불투명/고대비 fallback을 적용했다. 기존 원본/마스크/렌더 픽셀에 filter/tint를 적용하지 않는다. 미지원 Codex/색조절은 기존 disabled 상태를 유지한다.

실제 preview origin은 `http://127.0.0.1:8198/`로 준비하며 `node serve-preview.cjs`로 실행한다. 이 시점은 CSS 최초 build만 완료됐고 실제 브라우저 캡처/주요 버튼·스크롤·overlay/fallback 및 source대조 design-QA 전이므로 아직 검증 완료 handoff가 아니다. 증거를 확인한 뒤 아래 최신 결과를 이어 기록한다.

## Phase1 실행 확인 — 최초 중간본 보존

8198 실제 빌드 SHA256 `9775d085d1f4efb82c57f11e1ccb64f8768967a2b5827183d05b59f9d23487a8`, 2,483,603bytes다. `evidence/phase1-build-manifest.json`은 template와7개 business JS가 모두 baseline과 같고 QA8197 snapshot도435515fb…로 보존됐음을 확인한다. 현재 배치/ID를 그대로 유지한 재질·서체 중간본이며 기준2/3의 새 배치 완료가 아니다.

앱 내 브라우저는 두 번 모두 Windows sandbox `permission path cannot be represented losslessly`로 시작 실패했다. 기존 승인 Aside의 지속 REPL에서 실제8198을 열고 PNG 파일입력으로 기존 원본을 불러온 뒤 `evidence/phase1-editor.png`1440×900/dpr1을 캡처해 직접 확인했다. Aside의viewport변경API는 없으므로 실제 viewport를 기록했다. 스크린샷은 세션 artifacts에서 D:로 복사했다. 최초 motion screenshot은 CDP timeout으로 실패했으며 완료 캡처라고 주장하지 않는다. root가 이미 최초 편집 캡처와URL을 사용자에게 중간본으로 표시했으므로 같은 첫 알림/녹화를 반복하지 않는다.

동일 실제 브라우저의 `evidence/phase1-browser.json` **9/9**: 수평 넘침 없음, 실제3부위 준비, 재생/정지 버튼, 마스크와 원본의289×289표시경계 정확히 일치, 설정 내부스크롤0→120(내용초과948px), 불투명fallback 배경rgb(255,252,247)/blur없음, 원본/마스크 filter없음, Codex·색 disabled유지, pageerror0이다. 이는 원래 T9 전체경로/성능/저장·출력 검수를 반복한 결과가 아니다.

source2와현재캡처를 같은1440px폭으로 정규화해 함께 놓은 `evidence/phase1-editor-comparison.png`도 직접 열어 비교했다. 서체·우선순위·regular표면은 적용됐으나 큰 캐릭터 중심배치/오른쪽도구통합/왼쪽레일은 다음 단계에 남는다. reference의anime캐릭터를 위조하거나 새로 생성하지 않고 실제기존pancake원본을 사용했다. 현재8198소스와증거를 보존하고 **`D:/Pankeki/work/design/liquid-glass-20261020/reflow/`**를 새시각배치의별도작업복사본으로 사용한다.

프론트 최소표시연결은 `docs/handoffs/liquid-glass-frontend-contract.md`에 고정했다. 공통part목록의 실제materialPNG썸네일과optional motionTimeline의 실제curve표시만 요청하며, 기존source/rig/hash/명령/저장 의미는 유지한다. 총괄이 기존프론트담당에게 전달하면 해당모듈을소유자가수정하고 디자인은그동안template/CSS재배치를계속한다.

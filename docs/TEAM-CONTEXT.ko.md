# Pankeki 공통 개발 기준 — 2026-10-19

> 2026-10-22 현재 Mac 팀/경로/역할은 [Pankeki Mac 제작팀](TEAM-MACOS-20261022.ko.md)을 따른다. 이 파일의 이전 Windows 상태·팀 식별자·모델 미설치 설명은 해당 시점의 기록이며 현재 상태를 대체하지 않는다. 현재 사용자 지시와 최신 Mac 검증 자료가 우선한다.

## 최신 사용자 결정 — 이전 설명보다 우선
- 공개 시점 추가 정정: 사용자가 현재 화면을 확인한 뒤 "깃 허브에 올려줄 수 있어?"라고 요청했다. 완성본으로 포장하지 않고 **현재 개발 중 스냅샷을 지금 공개**한다. `https://github.com/pullyo/pankeki`를 2026-10-19 KST에 공개 생성했으며 총괄이 선별 소스/실제 화면/README를 업로드 중이다. 중복 저장소를 만들지 않는다. 원본 작업은 계속할 수 있고 공개 복사본은 `work/publication/repo`로 분리한다.
- MoE 조사 및 사용 요청: 사용자가 변환 모델 조사 후 "그걸 사용해줘"라고 승인했다. 직접 변환 yamura4 모델은 제작자 품질 붕괴 보고/현재 원본401, MoEMe는 희소 품질 실패로 실사용 후보에서 제외. 실제 공개 가중치를 확인한 실험 후보 `logic65/Whittle-Next-27B-A3B-GGUF` v4.4 Q4_K_M(16.8GB), revision `e7f75c39a765928015aa47728621c122793aa658`를 기능 담당에게 전달했다. Qwen3.8-27B를 교사로 증류한 커뮤니티 MoE 재학습본이며 공식 Qwen3.8-27B의 단순 양자화/공식 MoE판과 구분한다. 연구 프리뷰로 실제 한국어·구조화 요청·생성 연결 검증을 통과해야 기본 활성화한다. 이미지 이해 지원을 확인하기 전에는 지원한다고 말하지 않는다.
- 모델 추가 정정: 사용자가 이후 "flash 말고 27B 있잖아"라고 지목했다. Qwen3.8-27B를 우선 검토 대상으로 삼는다. 공식 모델카드는 27B **Dense** 구조이며 MoE가 아니므로 이전 MoE 희망과 혼동하지 않는다. 아직 최종 설치 결정이나 실제 실행 검증은 아니다. 8GB GPU/32GB RAM에서 양자화·CPU/GPU 분산·이미지 모델과의 교대 운용 가능성을 확인한다. 출처: https://huggingface.co/Qwen/Qwen3.8-27B
- UI: ComfyUI의 작업공간 구성은 참고하되 노드 중심으로 만들지 않는다. 채팅을 주기능으로 하고, 옆 큰 캔버스에서 생성 결과 확인·후보 비교·부분 수정을 이어 간다. 긴 설정 폼은 보조 패널로 이동한다. 밝고 정돈된 디자인 선호는 유지한다.
- 모델: 사용자는 이미지 생성 모델과 로컬 Qwen3.8 계열을 연결하고 싶다고 했으며, 대화 모델은 MoE 방식으로 요청했다. 정확한 모델/양자화/실행기는 아직 선정 전이다. 활성 파라미터가 작아도 전체 가중치 메모리는 필요하다. Qwen3.8-Flash-Next의 공식 공개 사양은 125B/활성6B + 51B n-gram + 4B MTP로, 8GB GPU에 가볍게 상주할 수 있다고 주장하지 않는다. 하드웨어 확인 후 현실적인 MoE 후보와 CPU/GPU 분산 또는 교대 실행을 검증한다. 모델명을 임의로 다른 버전으로 확정하거나 미연결 대화를 가짜 응답으로 채우지 않는다.
- 역할: Qwen은 대화·캐릭터 설정 정리·생성/수정 요청 해석을 맡고 별도 이미지 모델이 Comfy SDK 경로로 실제 이미지를 만든다. 기존 후보/마스크/저장/복원 기능은 유지한다. 이미지가 실제 생성되기 전에는 생성 성공으로 표시하지 않는다.
- 공개: 사용자가 작업 완료 후 GitHub에 **새 공개 저장소**를 만들고 설명도 작성하여 게시하도록 명시적으로 승인했다. 총괄이 최종 통합 검증 후 진행한다. 저장소 소개, 한국어 README(프로젝트 목적·기능·실제 화면·설치/실행·모델 사양·검증된 한계), 필요한 라이선스/제3자 고지를 포함한다. API 키·비밀값·개인 프로젝트/대화·모델 가중치·개인 캐시/실험 산출물은 공개에 포함하지 않는다. 공개 성공 전에는 게시 완료라고 말하지 않는다. 사용자가 추가 승인하도록 다시 묻지 않는다. 단, 실제 계정 접근/도구의 권한 제한이 생기면 그 구체적 제한을 알린다.

아래의 초기 상태 설명은 작성 당시 기록이며 최신 완료 상태는 담당 채팅의 검증 인계 기록을 따른다.

## 사용자가 결정한 방향
Pankeki는 자유 창작, 웹툰/웹소설, 버튜버, 마스코트, 게임에서 사용할 오리지널 캐릭터 콘셉트 디자인 작업실이다. 사용자는 특정 산업으로 제한하지 않고 용도에 맞게 조정하여 만들도록 요청했다.
핵심 흐름: 설정/원본 입력 → 후보 생성 → 비교/선택 → 같은 이미지의 부분 수정 → 캐릭터 보드와 프로젝트 저장.
첫 범위는 2D 이미지에서의 디자인 탐색과 전달 자료 제작이다. 여러 시점/새 포즈의 동일 인물 보장, 3D, 리깅, 완성 게임 에셋, 자동 세분화는 이번 구현 범위가 아니다.
사용자가 선택한 UI: 밝고 정돈된 디자인, 큰 중앙 캔버스, 간결한 패널. 복잡한 기술 설정은 접어서 제공한다.
추가 요청: 이미지 생성 도구로 팬케이크 모양의 Pankeki 로고를 제작한다. 아직 생성하지 않았다.

## 역할과 파일 소유권
총괄(이 채팅): 요구사항/대회 기준/우선순위, 공통 문서, 두 채팅 인계, 통합 검토. 직접 제품 코드 작업은 두 담당 채팅으로 넘긴다.
기능 채팅(Pankeki ComfyUI 최적화 구현): web/src/app.js, web/src/profiles.js, web/tests/profiles.test.cjs, scripts/test_ui_state.cjs, 필요한 기능 검증. pankeki/ 엔진은 기존 동작 보존이 기본이다.
디자인 채팅(Pankeki 웹 디자인·로고): web/src/index.template.html, web/src/style.css, web/build.py, web/assets/, 빌드 결과 web/index.html. 이미지 생성 로고, 반응형, 접근성, 실제 화면 확인.
타인 소유 파일을 동시에 수정하지 않는다. 계약 변경 필요 시 docs/handoffs/ 에 남기고 총괄을 통해 조정한다. 상대 파일의 삭제/초기화/통째 교체를 하지 않는다.
기능 완료는 docs/handoffs/function-ready.md에 계약/테스트/제약을, 디자인 완료는 docs/handoffs/design-ready.md에 로고경로/빌드/화면검증/제약을 기록한다. 최종 빌드는 두 소스 준비 후 디자인 담당이 수행한다.

## 현재 상태와 보존 대상
D:/Pankeki에 실제 앱 존재. 앱 http://127.0.0.1:8190, ComfyUI http://127.0.0.1:8188. SD Turbo 로컬 8GB GPU 환경이며 캐릭터 품질을 검증한 모델은 아니다. 기본512제곱,1step,CFG1,euler/normal. 용도 선택은 모델을 교체하지 않는다.
기존 생성/업로드/마스크/원본 밖 RGB와 alpha 보존/PNG/캐시/요청revision 보존. ROI는 기본 off, 캐시 재사용은 새 추론 가속과 구분. backend 수정 시 source guard 때문에 재시작/manifest 확인이 필요하다.
GET /api/health, /api/jobs/{id}, /api/previews/{id}?v=, /api/results/{id}; POST /api/jobs {session,request}, /api/jobs/{id}/cancel {}, /api/cache/clear {}.
서버는 / 에서 web/index.html만 서빙하므로 최종 배포 파일은 CSS/JS/로고를 포함한 자체완결 HTML로 빌드하거나 명시적으로 자산 경로를 지원해야 한다. 이번에는 자체완결을 권장한다.
원본 web/index.html은 work/character-studio/index.before-character.html에 보존했다. 기존의 새 밝은 UI 베이스를 web/src/{index.template.html,style.css,app.js}, web/build.py에 복사했다. 아직 새 캐릭터 UI로 빌드하지 않았다.
이전 시연 UI8191은 다른 C경로 버전이므로 최종대상은8190이다. 실제 앱 화면과 생성 목업은 명확히 구분한다.
기존 GitHub CropAndStitch/WaveSpeed, benchmark, 모델/환경/증거 문서 보존. Lucide/Pretendard 다운로드는 이전 네트워크/승인 정책으로 실패했으며 적용된 것으로 말하지 않는다. 현재 fallback SVG와 시스템 폰트를 사용한다.

## DOM 계약 (기존 ID는 그대로 보존)
profile select: original/comic/avatar/mascot/game; profileHelp; projectName(max80); brief(max1200); appearance(max1200); designDetail(max800); profileDetailLabel; profileDetailHint; palette1/palette2/palette3 type=color; notes(max1200, 생성prompt에 미포함); useBrief checked; candidateCount=1/2(default2); presetExample; prompt는 기존 textarea를 추가지시로 사용; compiledPrompt pre.
saveProject, loadProject(JSON file), newProject, exportBoard, projectStatus; gallery, galleryEmpty, selectionCount; compareSelected, comparePanel(hidden), compareGrid, closeCompare.
후보 card 클래스 candidate-card, candidate-info, candidate-actions. 상태는 앱JS가 관리한다. 프로필 전환은 사용자가 작성한 텍스트와 원본을 조용히 덮어쓰지 않는다. 예시 적용은 별도명시버튼.
브리프/선택색은 모델 입력 가이드이며 정확한 의미/색 재현을 보장하지 않는다. 한국어 UI지만 현재모델 입력의 언어 한계를 숨기지 않고 영어 예시와 실제 전달 프롬프트를 보여준다.

## 기능 계약
CharacterDesign 전역 및 CommonJS: profiles, sanitizeBrief, buildPrompt, makeRequests, createProject, parseProject.
프로필정보 {label,description,detailLabel,detailHint,boardLabel,example:{name,brief,appearance,detail,palette,notes,prompt}}.
브리프 {profile,name,brief,appearance,detail,palette,notes,prompt,useBrief}.
프로젝트 {version:1,brief,versions:[candidate]}.
candidate {id,createdAt,label,image:localBase64DataURL,brief:생성시snapshot,request:설정allowlist,parentId,metrics:얕은요약}.
원본/source와mask 큰데이터는 exported request에서 제외. PNG/JPEG/WEBP 내장 이미지 저장으로 서버재시작 후 프로젝트복원 가능. 원격이미지 URL/임의HTML 실행 금지. 업로드원본 후보는 실제AI생성으로 표시하지 않는다.
후보2개는 동일 기준이미지와 마스크에서 seed를 바꿔 순서대로 생성한다. 1번결과를 자동으로2번원본에 적용하지 않는다. seed overflow, 취소, 오래된upload/job결과, 부분실패, 서버오프라인을 처리한다. UI가 바뀌어도 진행중 생성의 브리프/metadata는 제출당시snapshot 사용.
최대20후보/프로젝트64MiB 등 명시적상한. 오래된후보를 몰래삭제하지 않는다. 저장 실패와 복원 실패를 표시하고 export/import 유지. IndexedDB 자동복원은 추가 가능하지만 초기복원이 새사용자입력을 덮어쓰지 않게 한다.
비교는2개선택 원본이미지 보존. 보드PNG에 선택이미지/캐릭터명/용도/브리프/팔레트/메모 포함. 텍스트잘림과 이미지비율왜곡 검사. 프로젝트파일도 내보내기/불러오기.

## 대회 기준 (공식 공고 확인 기록)
https://comfy.org/open-source-higgsfield/
Comfy Developer Platform의 Comfy Router 및/또는 Comfy SDK 활용 요구. 현재 로컬 /prompt 연결만으로 충족한다고 주장하지 않는다. SDK는 실제 생성 경로로 검증해야 하며 현재 미구현 상태다.
공개 코드/워크플로/OSS라이선스/실행안내, 2분이하데모, 해시태그게시물 등 제출요건. 게시/출품/외부공유는 아직 실행하지 않는다.
마감 2026-10-30 09:00 PT = 한국시간 2026-10-31 01:00. 공식 세부사항은 변경 가능하며 제출 전 재확인.

## 검증 완료 기준
프로필 전환에 따른 라벨/안내/입력prompt 차이; 실제2후보 생성과 비교; 후보 재편집 및 마스크밖보존; 프로젝트 export/import와 오프라인에서 재표시; 보드PNG 실제열기; 모바일390px 오버플로/접근성; 오류/취소/늦은응답 회귀. 기계적테스트와 실제브라우저/GPU증거 구분.
모델 결과가 원화용 품질에 못 미치면 그대로 보고하고 기능 성공과 분리. 승인되지 않은 모델/패키지 다운로드나 차단 우회 금지.

## 담당 채팅 식별자
- 총괄: Pankeki 총괄·기획 — 01a153c8-644d-72f2-91c5-342bbbc38fa8
- 기능: Pankeki ComfyUI 최적화 구현 — 01a153d5-8c27-7172-a662-63ac6ef188f5 (local, D:/)
- 디자인: Pankeki 웹 디자인·로고 — 01a1542a-1b43-7ae3-8691-7706589f9fb6 (local, D:/)
2026-10-19 사용자가 이 채팅 총괄/두 작업 채팅 분담 및 새 로컬 디자인 채팅 생성을 명시적으로 요청했다.

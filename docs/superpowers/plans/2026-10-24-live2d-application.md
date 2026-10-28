# Pankeki Live2D Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 필수 기존 `.moc3` 패키지의 공식 재생 경로를 추가하고 자체 제작기에 범용 파라미터·가림·조합 키폼·부모 워프를 독립 확장한다.

**Architecture:** 기존 v1/v2 authoring, 새 자체 v3 authoring, Cubism session을 서로 다른 문서와 저장소로 유지한다. Cubism은 브라우저 로컬 패키지 검사와 공식 Core/Framework 전용 WebGL player를 사용한다. 자체 v3는 검증된 v2 원본을 포함한 명시적 복사본과 작은 확장 데이터를 사용하며 기존 렌더러를 수정하지 않고 확장 평가/합성을 분리한다.

**Tech Stack:** 기존 UMD/CommonJS JavaScript, Canvas2D, WebGL2, Python HTTP server/build, node:test, unittest; Cubism 공식 대응 Core/Framework 세트는 확보 및 사용 조건 gate 이후.

**Spec:** `output/live2d-analysis-20261024/analysis-team/README.ko.md`; 상세 계약은 같은 폴더 `runtime/report.md`, `rigging/report.md`, `rigging/parts-contract.json`, `editor/report.md`. 실행 선행조건 보완 근거는 `output/live2d-application-20261024/runtime-prerequisites.md`와 `prerequisites.json`이다. Spec은 분석과 실제 구현/시각 합격을 구분한다. 사용자 실행 요청과 기존 직원 실행 방식에 따라 총괄은 배정/증거검토/보고, 직원이 구현한다. 계획 재승인을 일반 작업의 전제조건으로 추가하지 않는다.

## Global Constraints

- “기존 로고·핵심 기능·사이드 메뉴는 보존한다.”
- “새 기능 때문에 기존 원화나 프로젝트를 자동 재해석·덮어쓰지 않는다.”
- “반입 단위는 `.model3.json`과 참조 `.moc3`·텍스처 및 제공된 motion/표정/물리/pose 등의 **전체 묶음**이다.”
- `.moc3` 실제 재생은 필수 최종 gate다. parser/mock/UI 통과로 재생 성공을 대체하지 않는다.
- 현재 캐릭터의 3 PNG·원화·리그를 보존한다. 새 생성/추론, Editor Core 추출, 역공학, 자동 SDK 다운로드는 작업에 포함하지 않는다.
- SDK 결합/실재생은 적용 사용조건·공식 대응 파일 확보·모델 사용 범위가 확인된 범위에서 진행한다. 이 조건은 독립 parser/session/자체 엔진 작업을 막지 않는다.
- `.cmo3` 편집, 자체 메시의 `.moc3` 출력, 얼굴 XY·모발 물리·범용 타임라인은 첫 적용 밖이다. 없는 눈꺼풀/입술/숨은 면을 기술 구현 완료로 표시하지 않는다.
- 2026-10-24 읽기 시점 Git 저장소 없음. Git 생성/워크트리는 강제하지 않는다. 작업 전 파일별 snapshot+SHA-256, 작업 후 unified diff+SHA-256으로 복구/검토한다.
- 테스트용 PNG/리그는 작고 독립적인 합성 fixture만 만든다. 사용자 캐릭터 자산은 read-only fixture로 이용한다.

## Review Focus

1. 외부 URL·경로 탈출·Unicode/대소문자 충돌·여러 manifest: 선택된 패키지 내부에서만 결정적으로 읽어야 한다 → Task 1.
2. A→B 빠른 교체·decode 중 취소·GPU context loss: 이전 정상 세션을 손상하지 않고 자원을 회수해야 한다 → Tasks 2–3.
3. 모델에 없는 parameter·repeat/min/max·motion+expression+physics 충돌: 실제 모델 정의와 단일 시간 소유자를 따라야 한다 → Task 3.
4. 소수 입력 중 refresh·취소·같은 preset 재적용·저장 시 미확정 값: preview와 commit이 구분돼야 한다 → Tasks 6, 9.
5. 부모 warp+target mask+조합 중간값·불완전 grid: 좌표/가림이 함께 움직이고 실패 결과가 이전 정상 프레임을 덮지 않아야 한다 → Tasks 7–9.

---

## 읽은 소스와 책임 경계

모든 경로는 `/Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki` 기준이다. 줄 번호 대신 함수명을 기준으로 수정 위치를 찾는다.

| 현재 파일/인터페이스 | 유지할 책임 / 신규 연결 |
|---|---|
| `web/src/character-document.js`: `parseDocument`, `serializeDocument`, `fromV1`, `computeRigHash`, `createEditor` | 엄격 v1/v2 검증과 undo. v3/Cubism 필드를 이 parser에 섞지 않는다. |
| `character-renderer.js`: `evaluatePose(scene,values)`, `drawPose(canvas,pose,decodedAssets)`, `sampleMotion`, `createGrid` | 16파트/1024px, 단축 delta 합산·부모 affine, 자체 triangle clip. v3는 final draw list와 layer 합성 adapter로 확장한다. |
| `character-motion.js`: `mount(root,options)` → `loadDocument`, `previewParameters`, `commitParameters`, `saveProject`, `suspend`, `destroy` | 기존 v2 편집/재생 소유자. 3축/2초/24fps 경로 보존. |
| `character-export.js`: `exportFrames(options)`, `exportPosePng(options)` | 3축 고정 검증 포함. v3 export는 별도 adapter/모듈이며 v2 exporter로 무리하게 전달하지 않는다. |
| `app.js`: `mountMotionWorkspace`, `scheduleMotionSave`; `studio.js`: `rootMotion`, 화면 전환 | 기존 `pankeki-motion-studio-v2` DB와 전역 controller 보존. 새 controller는 별도 mount/suspend/destroy 경로. |
| `web/build.py`: `build()`; `index.template.html` | 현재 JS를 순서대로 HTML에 합친다. 새 모듈 순서와 선택적 공식 bundle 경로를 명시한다. |
| `pankeki/server.py`: `make_server` / `Handler.do_GET`, `guard` | 현재 `/`와 지정 API만 존재. 임의 static server로 바꾸지 않고 승인된 SDK 파일 allowlist만 추가한다. |

### 공통 실행 기록

각 Task 첫 편집 전 `output/live2d-application-20261024/baseline/<task>/`에 담당 파일·원본 SHA/mtime와 입력 자산 해시를 저장한다. `evidence/<task>/`에 red/green 로그·after hashes·diff·판정을 기록한다. 신규 파일은 `created`로 표시하고 복구 시 해당 파일만 제거한다. 타 담당 변경이 발견되면 그 파일의 소유자와 충돌을 정리하며 다른 사람의 작업을 덮어쓰지 않는다. 체크 하나는 검증 가능한 한 행동이다. 아래 “기록” 단계는 이 환경에서 commit을 대신한다.

## Task 1: SDK와 무관한 로컬 Cubism 패키지 검사 — 첫 실행 Task

**Files:** Create `web/src/cubism-package.js`, `scripts/test_cubism_package.cjs`, `docs/handoffs/cubism-package-contract.md`.
**Interfaces:** `readPackage(files: Array<{path:string,bytes:Uint8Array}>, {entryPath?:string,signal?:AbortSignal}={}): Promise<Package>`; `Package={entryPath,manifest,files:Map,hashes:Record,resources,capabilities,warnings}`. `resources`는 manifest 기준 정규화 경로와 slot/group/index를 보존하며 bytes를 복제해 외부 변경을 막는다. 여러 진입점이면 `ENTRY_REQUIRED`와 `entries:string[]`; 단일 moc만이면 `MANIFEST_REQUIRED`. SDK 검증/PNG 실제 decode는 아직 수행하지 않았다는 capability 상태를 반환한다.

- [ ] **Write failing tests:** `relative_unicode_paths_and_texture_slots`, `all_declared_resources_required`, `ambiguous_entry_requires_selection`, `reject_external_escape_collision_and_limits`, `abort_preserves_inputs`. texture slot 순서·motion group/index·expression name·physics/pose/displayinfo/userdata·Sound 참조 보존, 원본 bytes 불변, 모든 선언 참조 누락 오류를 assert한다.
- [ ] **Run red:** `node --test scripts/test_cubism_package.cjs`; 새 module 부재/계약 미충족 실패를 기록한다.
- [ ] **Implement reader:** `Version===3`, Moc와 하나 이상 PNG Textures 필수. JSON 타입/유한수/깊이 24 검사. 첫 제품 예산은 256파일·총256MiB·파일64MiB·JSON8MiB·텍스처32개·총decoded256MiB·최대변8192, 초과는 명시 오류(공식 한계 아님). 실제 GL 한계는 Task 3에서 추가한다. URI/scheme·absolute/drive/UNC·NUL·`..` 탈출·encoded separator 및 정규화 충돌 거절, NFC+casefold 충돌 거절. 파일명 공백/한글/정상 하위폴더 허용. archive 해제·원격 fetch 없음.
- [ ] **Run green:** 동일 명령 PASS; 알려지지 않은 기능은 원본 보존+제한 표시, 참조한 알려진 기능 누락은 성공 처리 금지.
- [ ] **Record:** baseline/diff/테스트와 계약 문서에 `package-read:verified`, `actual-playback:not-run` 기록.

## Task 2: 별도 Cubism 세션과 원자적 교체

**Files:** Create `web/src/cubism-session.js`, `web/src/cubism-controller.js`, `scripts/test_cubism_session.cjs`, `scripts/test_cubism_controller.cjs`.
**Interfaces:** `parseSession(raw):Session`, `serializeSession(session):string`; `createController({runtimeFactory,clock,onState})` → `load(pkg,{signal}={}):Promise<boolean>`, `restore(session,pkg):Promise<boolean>`, `snapshot():Session|null`, `getState():ControllerState`, `getCanvas():HTMLCanvasElement|null`, `pause():void`, `resume():void`, `dispose():void`. `ControllerState={ready:boolean,running:boolean,loading:boolean,generation:number,error:null|{code:string,message:string}}`; `onState(state:ControllerState):void`는 상태/설정 변경 후 호출한다. `parameters`, `setParameter`, `setMode`, `playMotion`, `setExpression`, `setEffects`, `reset`은 Task 3와 같은 인자/반환으로 활성 runtime에 위임하며 성공한 설정을 snapshot에 반영한 뒤 onState를 알린다. 제어 대상 runtime이 없으면 `RUNTIME_NOT_READY`; pause/resume/dispose는 멱등이고 준비 전/종료 후 resume는 no-op이다.

**B1 factory/clock:** UI가 바인딩한 `runtimeFactory({signal:AbortSignal}):Runtime|Promise<Runtime>`가 호출마다 새 detached candidate canvas와 검토된 sdk를 넣어 `createRuntime({canvas,sdk,signal})`를 호출한다. controller는 canvas/SDK를 생성하지 않는다. Runtime.getCanvas를 첫 유효 draw 후에만 active로 채택하며 Controller.getCanvas는 그 active canvas만 반환한다(초기/종료 후 null, 교체 준비 중 이전 canvas). UI는 성공 후 active canvas로 DOM을 교체한다. clock은 `{now():number,request(callback:(nowMs:number)=>void):number,cancel(handle:number):void,setTimeout(callback:()=>void,delayMs:number):number,clearTimeout(handle:number):void}`; now/callback은 같은 단조 증가 밀리초 기준. UI는 performance.now/requestAnimationFrame/cancelAnimationFrame/window.setTimeout/window.clearTimeout을 바인딩하고 시험은 같은 signature의 fake clock을 주입한다. RAF/clock의 유일 소유자는 controller, runtime 자체 RAF는 0이다.

**Task 2 동결 소스 인계 계약:** 근거는 `output/live2d-application-20261024/reports/task-2-report.md`이며 source/fake 시험 완료·독립 검토 대기, 실제 SDK/UI 통합 미실행이다. controller는 `const files=pkg.files`를 한 번 capture하고 그 map의 경로/bytes를 Task 1 `readPackage(filesArray,{entryPath,signal})` 입력으로 전달해 새로 검증/재hash한다. 최초 private hash record와 일치하지 않으면 `PACKAGE_MISMATCH`; runtime.load에는 새 검증 Package를 전달한다. getter 전체복사를 반복하지 않고 소비자는 Package를 read-only로 취급한다. Runtime.diagnostics().sdk는 정확히 `{coreVersion,coreHash,frameworkCommit,bundleHash}`이며 비어 있지 않은 coreVersion, lowercase SHA-256 64hex 두 hash, 40hex frameworkCommit을 요구한다. 누락/잘못된 provenance는 `SDK_UNAVAILABLE`; 실제 공식 source 신뢰 판단은 Task 3 gate이며 가짜 기본값 금지.

**총괄 reset/preview 결정:** runtime.reset은 parameter 기본값 복원, 선택 motion/expression 해제, physics/motion clock 재시작이며 mode/effects는 유지한다. controller는 override 비움·motion/expression null·mode/effects 보존 및 다음 frame dt0으로 반영한다. 모든 성공 setter/reset은 동기 `update(0)→draw()` 1회 후 snapshot을 갱신하고 onState를 알린다. 이 호출은 RAF를 시작하지 않으므로 paused preview도 즉시 보이고 RAF0을 유지한다. setter/update/draw 실패는 pause+오류+기존 snapshot 보존이다. 내부 GPU/physics rollback은 보장하지 않으며 오류 UI에서 명시적 reload/restore로 복구한다. 동기 draw 비용과 오류 뒤 runtime 복구 필요가 이 결정의 비용이다.

**취소 책임:** controller가 generation/AbortController/30초 timeout을 소유하고 UI는 `load(pkg,{signal})`에 외부 AbortController.signal을 전달해 반입을 취소한다. pause는 RAF만 중지하며 staging 취소가 아니다. 공개 controller.cancel 메서드나 restore의 signal 인자는 없다. restore 중 후보 교체/종료는 새 load 또는 dispose의 기존 계약을 따른다. factory/load/decode/first draw는 signal을 관찰하고, 취소 후 늦게 반환한 runtime은 controller가 dispose한다. adapter는 decode 후 늦은 GPU 자원 생성/콜백을 차단하고 dispose를 멱등으로 구현해야 한다.

- [ ] **Write failing tests:** format/schema 불일치·hash 바뀐 파일·서로 다른 package 세션 거절; 늦은 A callback이 B를 덮지 않음; B 첫 draw 실패 시 A 유지; 취소/timeout/dispose 중복 안전; v2 문서와 DB에 쓰기 0.
- [ ] **Run red:** `node --test scripts/test_cubism_session.cjs scripts/test_cubism_controller.cjs`.
- [ ] **Implement session:** `{format:'pankeki-cubism-session',version:1,runtimeType:'cubism',entryPath,fileHashes,sdk:{coreVersion,coreHash,frameworkCommit,bundleHash},mode,parameterOverrides,motion:{group,index,loop}|null,expression:string|null,effects:{blink,physics,pose},resumePolicy:'restart'}`. 자산 자체/절대경로는 저장하지 않고 재열기 때 패키지를 다시 선택해 해시 대조한다. 물리 순간 상태/seek 복원을 약속하지 않고 restart만 제공한다. inspection/play 모드를 명시한다.
- [ ] **Implement controller:** generation token+abort+clock의 30초 staging timeout; 첫 유효 draw 전까지 이전 runtime 유지, 성공 후 원자 교체. 모든 실패 경로에서 후보만 dispose하고 생성 중 cancel도 finally 정리한다. 초기 paused 상태이며 첫 draw는 RAF 없이 수행한다. pause는 RAF만 취소하고 active runtime/설정/모션/물리를 보존한다. resume는 예약 RAF가 없을 때만 하나를 만들고 timestamp를 비워 첫 callback dt=0, 이후 dt=max(0,nowMs-lastMs)/1000으로 update(dt)→draw를 호출한다. 위임 API는 RAF를 시작하지 않으며 play/UI 복귀는 별도 resume를 호출한다. reset은 명시 요청 또는 session restore에서만 수행하고 시간 기준도 다시 잡는다. 위임 실패는 설정 snapshot을 바꾸지 않고 onState 오류를 알린다. runtime/update 오류와 context loss에서는 pause 후 오류 상태를 전달한다.
- [ ] **B1 focused tests:** play→pause→resume→resume에서 예약 RAF=1, hidden=0, dispose=0; 재개 첫 update dt=0, 다음 frame은 초 단위 dt. 단순 pause/resume에 reset 호출 0. 후보 첫 draw 전 canvas 공개/DOM 교체 0, 실패 시 이전 canvas 유지. session의 resumePolicy restart는 파일 재열기에만 적용하고 화면 복귀와 구분한다. reset의 defaults/motion/expression/physics 및 mode/effects 보존, paused setter/reset의 동기 update(0)→draw1→snapshot/onState 순서·RAF0, draw 실패의 pause/기존 snapshot, Package.files capture1회/fresh reader 검증, diagnostics().sdk 누락, 취소 후 늦은 자원 회수를 포함한다.
- [ ] **Run green:** 동일 명령 PASS; fake runtime의 소유 자원 counters가 교체/취소 후 0으로 복귀함을 assert한다.
- [ ] **Record:** fake 검증과 실제 GPU 검증을 분리해 기록한다.

## Task 3: 공식 Core/Framework player adapter — 조건부 실행 Task

**Files:** Create `web/src/cubism-runtime.js`, `scripts/test_cubism_runtime.cjs`, `web/vendor/cubism/README.ko.md`, `web/vendor/cubism/runtime-manifest.json`, `web/src/cubism-sdk-entry.ts`, `scripts/build_cubism_runtime.mjs`; 승인된 세트 확보 후에만 `web/vendor/cubism/live2dcubismcore.js`, `web/vendor/cubism/pankeki-cubism-framework.js`, `web/vendor/cubism/Shaders/`의 승인된 공식 shader 파일, 공식 고지 파일 추가.
**Interfaces:** `createRuntime({canvas,sdk,signal}):Runtime`; Runtime=`load(pkg):Promise<void>`, `drawFirstFrame():Promise<void>`, `getCanvas():HTMLCanvasElement`, `parameters():Array<{id,min,max,default,type,repeat,value}>`, `setParameter(id:string,value:number):void`, `setMode(mode:'inspection'|'play'):void`, `playMotion(group:string,index:number,{loop:boolean}):void`, `setExpression(name:string|null):void`, `setEffects({blink:boolean,physics:boolean,pose:boolean}):void`, `update(dtSeconds:number):void`, `draw():void`, `reset():void`, `dispose():void`, `diagnostics():object`. `sdk`는 검토된 공식 bundle의 facade이며 버전 대응을 manifest로 고정한다. UI-bound factory가 매번 새 detached canvas를 공급하고 runtime.getCanvas는 그 canvas를 반환한다. runtime은 자체 RAF/clock/timer loop를 만들지 않는다. 첫 draw는 controller staging 요청, 이후 update/draw는 Task 2의 controller clock만 사용한다. pause/resume는 controller 책임이고 runtime.reset과 구분한다.

**Task 2 consumer 호환:** `diagnostics().sdk={coreVersion,coreHash,frameworkCommit,bundleHash}`는 실제 공급 세트에서 얻은 비어 있지 않은 문자열/64hex SHA-256/40hex commit/64hex SHA-256이며 누락 시 SDK_UNAVAILABLE이다. reset은 parameter defaults+motion/expression 해제+physics/motion clock 재시작, mode/effects 유지다. controller가 각 성공 setter/reset 뒤 동기 update(0)→draw1을 호출하므로 이 메서드는 Promise/자체 RAF 없이 동기 완료해야 한다. 실패하면 controller가 pause하고 기존 snapshot을 보존하지만 GPU/physics 내부 rollback을 보장하지 않는다. adapter/UI는 명시 reload/restore 복구를 제공한다. runtime.load는 Task 2가 Package.files를 한 번 capture해 fresh readPackage로 재검증한 Package를 받는다. signal abort를 load/decode/first draw 및 늦은 자원 생성 직전에 확인하고, 취소 후 반환/부분 생성 상태에서도 dispose가 멱등이어야 한다.

- [ ] **Read/record gate:** 공식 대응 Core와 Framework 버전/해시, source/tag/commit, 고지, Pankeki 사용범위 및 모델 사용허용 증거를 runtime manifest에 기록한다. 없으면 이 Task의 실제 bundle 결합과 재생만 `blocked:SDK_OR_USAGE_EVIDENCE_MISSING`; Tasks 1–2, 4의 unavailable 경로, 6–9 진행. Editor 추출/약관 자동수락/무단 샘플 확보 금지.
- [ ] **Write failing adapter tests:** missing Core 오류·미지원 MOC version·consistency failure·없는 param ID·range/repeat 경계·선언 texture decode/GL 한도 실패·release 중복·부분 load 실패·context loss. fake SDK 테스트는 API wiring 증거로만 분류한다.
- [ ] **Run red:** `node --test scripts/test_cubism_runtime.cjs`.
- [ ] **Build the real official facade when gate clears:** `cubism-sdk-entry.ts`는 대응 Framework의 `live2dcubismframework`, `model/cubismusermodel`, `cubismmodelsettingjson`, `motion/cubismupdatescheduler`, `rendering/cubismrenderer_webgl` 등 실제 모듈을 import한다. source/tag는 정식 `5-r.5`, Framework commit `198a3769c26ca3d7b600e932590433badd392edd`를 확보본과 대조한다. `build_cubism_runtime.mjs`는 확보된 공식 build 도구로 bundle을 생성하고 import/source/shader/결과 hash 목록을 manifest에 기록한다(일반 build 의존성은 기존 승인된 가역 개발 범위에서 설치·버전 기록 가능; SDK 취득/약관 적용과 구분). Framework TS를 기존 HTML 문자열로 연결하지 않는다. R5의 실제 shader loader가 요청하는 `Shaders` 경로를 고정 base URL로 설정하고 파일별 hash allowlist를 제공한다. 단순 `registerApi`나 사용자 주입 stub은 SDK 연결 완료가 아니다. readiness는 Core→실제 Framework module→모든 필요 shader→WebGL2→공식 모델 첫 draw까지 단계별로 판단한다.
- [ ] **Implement official adapter when gate clears:** MOC consistency를 명시적으로 켜고 내부 버전·Core 모델 생성 모두 검사한다. 전용 WebGL2에서 공식 renderer로 mask/draw order/alpha/blend/offscreen을 처리한다. PNG 실제 decode와 MAX_TEXTURE_SIZE를 확인하며 사용자 model URL fetch는 0.
- [ ] **Implement model effects:** 실제 parameter 정의만 UI에 전달한다. inspection은 motion/자동효과 정지 후 수동값, play는 공식 정식 세트의 update 순서로 motion→effect scheduler→model.update; 제공 motion/exp/physics/pose 모두 읽고 실행한다. loop·fade·add/multiply/overwrite, Groups의 EyeBlink/LipSync ID와 motion effect를 유지한다. 첫 범위에서 Sound 파일은 보존/검사하되 음성 재생·실시간 lipsync 미지원이라고 표시한다. reset은 parameter defaults·motion/expression 해제·physics/motion clock 초기화이며 mode/effects는 유지한다. controller의 동기 update(0)→draw1 뒤 preview가 반영되는지 검증한다.
- [ ] **Implement cleanup/recovery:** controller RAF 중단 후 runtime scheduler/listener와 늦은 callback 중단, 모델/renderer/MOC 해제, 소유 texture 삭제, decode image 닫기/URL revoke; 앱 공통 Framework는 마지막 소유자가 정리. context loss는 controller pause+명시 상태 후 원본 bytes로 재생성하며 실패 시 v2로 복귀 가능. load/drawFirstFrame/setMode/playMotion/update/dispose 모두 runtime 자체 RAF 예약 0, getCanvas===주입 canvas를 검증한다.
- [ ] **Run green and actual probe:** node 테스트 PASS 및 허용 모델의 실제 첫 draw/params/제공 motion·exp·physics·pose를 Task 5 방법으로 검증한다. 실표본 없으면 adapter 구현 상태까지만 기록한다.
- [ ] **Record:** 코드 구현, fake 검증, 실제 재생, 배포 사용조건을 별도 열에 기록한다.

## Task 4: 기존 화면 안에 Cubism 반입/재생 UI와 빌드·route 연결

**Files:** Create `web/src/cubism-workspace.js`, `scripts/test_cubism_workspace.cjs`, `tests/test_cubism_delivery.py`; Modify `web/src/app.js`의 mount/저장·종료 연결, `web/src/studio.js` 화면 lifecycle, `web/src/index.template.html`의 motion 내부 패널, `web/src/redesign.css`, `web/build.py:build`, `pankeki/server.py:Handler.do_GET`, `README.ko.md`; Rebuild `web/index.html`.
**Interfaces:** `PankekiCubismWorkspace.mount(document,{controller,readPackage,storage,onError})` → `show(screen)`, `suspend()`, `destroy()`. 별도 DB `pankeki-cubism-studio-v1`/store `sessions`/key `current`; 기존 두 DB 키 수정 금지.

**B1 UI 배선:** mount 이전 UI composition이 Task 2와 동일한 clock 및 runtimeFactory({signal})를 바인딩해 controller를 만든다. factory는 매번 detached canvas+검토 sdk로 createRuntime을 호출한다. UI는 runtime 직접 제어/RAF 생성을 하지 않는다. 첫 draw 후 controller.getCanvas의 active canvas만 DOM에 붙이고 실패 시 이전 DOM 유지. play는 controller.setMode/playMotion 후 resume, show(Cubism)/visibility 복귀는 해당 화면일 때 resume, hidden/suspend는 pause, destroy는 dispose. session restore의 restart와 단순 화면 복귀를 구분한다. 위임 API 후 snapshot/onState/getState로 표시와 저장을 갱신한다. UI 테스트에서도 play→pause→resume2회 RAF1, hidden0, dispose0, 화면 복귀 reset0을 assert한다.

**Task 2 UI 인계:** 성공 setter/reset의 update(0)→draw1→snapshot/onState는 controller가 수행한다. UI는 중복 draw/RAF를 추가하지 않고 paused preview를 그대로 표시한다. reset 후 parameters 기본값·motion/expression 해제·mode/effects 보존을 표시한다. 실패는 paused 오류+기존 snapshot이며 내부 GPU/physics rollback을 약속하지 않는다. 오류에서는 명시적 package reload/session restore 복구를 제공하고 context loss 뒤 자동 resume를 시도하지 않는다. 반입 취소는 UI 소유 AbortController를 load(pkg,{signal})에 전달한다; pause는 반입 취소가 아니며 controller.cancel/restore signal API를 가정하지 않는다. restore는 새 load/dispose의 기존 종료 계약을 따르고 별도 restore 취소 버튼을 허위로 제공하지 않는다. Package.files 전체 getter를 반복 조회하지 않고 새 reader 검증은 controller에 맡긴다. diagnostics().sdk 출처 누락은 unavailable이며 UI에서 값/해시를 만들어 ready로 표시하지 않는다. 동기 preview 추가 비용 및 실패 후 reload/restore 필요를 실제 UI 시험에 포함한다.

**화면 문구:** 일반 화면에는 모델 준비/누락/재생 가능 상태와 필요한 행동만 짧게 표시하고 SDK·해시·runtime 내부 단계는 필요한 호환 설명으로 제한하며 기존 로고·사이드메뉴·기능/labels 전면개편은 하지 않는다.

- [ ] **Write failing tests:** 폴더/다중 파일 선택→entry 선택→지원표→ready, Core 없음 안내→자체 제작 복귀; UI parameter 이름은 textContent, 실제 범위 표시. 저장 후 재선택/hash mismatch 오류, 빠른 switch에서 RAF 하나만 유지. 로고·navigation IDs 보존 assert.
- [ ] **Run red:** `node --test scripts/test_cubism_workspace.cjs`; `.venv-macos/bin/python -m unittest tests.test_cubism_delivery tests.test_server`.
- [ ] **Implement UI:** 기존 motion 내부 `자체 제작 / Live2D 재생` 선택과 분리 canvas. 브라우저 folder 선택 미지원이면 상대경로 포함 multi-file 입력을 안내하고 구조를 보존할 수 없으면 명시 실패. moc 단독에는 manifest/texture 묶음 안내. 실제 capabilities에 따라 parameter/motion/expression/physics/pose/reset만 활성화. mesh 편집·기존 PNG exporter를 Cubism에 연결하지 않는다.
- [ ] **Implement delivery:** build에 Task 1→session→controller→runtime→workspace 순서를 app 앞에 포함. 서버는 `/vendor/cubism/live2dcubismcore.js`, `/vendor/cubism/pankeki-cubism-framework.js`, `/vendor/cubism/runtime-manifest.json`및 runtime manifest에 파일별 hash가 등록된 `/vendor/cubism/Shaders/` 하위 파일만 allowlist로 제공; JS MIME/nosniff/기존 Host·Origin guard 유지, symlink escape/unknown 파일/encoded traversal 404. 파일이 없으면 404와 UI unavailable. 실제 manifest에 등록된 SHA와 응답 bytes 대조. SDK 파일은 lazy-load로만 요청하고 모델 파일 서버 업로드 없음.
- [ ] **Run green/build:** 위 테스트 PASS, `.venv-macos/bin/python web/build.py`, `node --test scripts/test_motion_app.cjs scripts/test_motion_ui_contract.cjs scripts/test_redesign.cjs scripts/test_ui_unification.cjs`; HTML 모듈 순서/중복 script/미해결 template 없음 검사. shader 응답 MIME/누락/변조도 검사하고 fake route bytes를 실제 SDK 공급 증거로 기록하지 않는다. README에 두 실행 방식·Core 준비 여부·지원 제한·별도 저장/재선택을 적는다.
- [ ] **Record:** source/build/served HTML hashes·route 응답·README diff 기록. 이 Task가 실제 player gate를 대신하지 않는다.

## Task 5: Cubism 실제 브라우저 수용 검증

**Files:** Create `scripts/verify_cubism_browser.cjs`, `output/live2d-application-20261024/evidence/cubism-browser/`에 검증 결과만 추가. 설치된 브라우저 automation이 없으면 정상 UI 도구로 같은 절차를 수행하거나 일반 개발 의존성을 가역적으로 준비한다. 사용자에게 일반 개발/로컬 UI 기동 승인을 반복 요청하지 않는다.
**Interfaces:** Task 1 package hashes, Task 2 session, Task 3 diagnostics와 screenshot/상태 캡처를 사용한다.

- [ ] **Prepare actual fixture record:** 사용 허용 full package와 공식 같은 버전 기준 player·대상 브라우저/GPU/화면 크기·Core/MOC/Framework hashes를 고정한다. 기존 PNG 인식 증거는 fixture playback 증거가 아니다.
- [ ] **Compare real output:** 같은 parameter min/default/max/중간값, motion time/loop/fade, expression 해제/전환, physics reset+고정 dt, pose 파츠 전환을 비교한다. 랜덤 blink 끄고 같은 clock으로 mask 경계/alpha/draw order를 캡처; 허용 픽셀오차는 비교 전에 기록한다.
- [ ] **Exercise failure/lifecycle:** 누락/손상/미지원 파일, 다른 폴더 재열기, hash mismatch, load 중 취소/교체, 화면 이동, context loss/복구; 30회 교체의 소유 counters·GPU/heap 추세를 기록한다. heap만으로 GPU leak 없음 판정 금지.
- [ ] **Verify preservation:** v2 저장/undo/재생/48프레임 export를 실제 연결 화면에서 재확인하고 입력 원화/리그 hashes 불변 확인.
- [ ] **Record verdict:** source implemented / fixture tests / browser actual / visual accepted / usage scope 각각 PASS·FAIL·BLOCKED. Core/모델 부재면 실제 재생을 BLOCKED로 남기고 전체 `.moc3` 완료 주장 금지.

## Task 6: 자체 v3 복사본·범용 파라미터·편집 입력 계약

**Files:** Create `web/src/character-document-v3.js`, `web/src/character-renderer-v3.js`, `scripts/test_character_v3.cjs`, `docs/handoffs/character-document-v3.md`.
**Interfaces:** `upgradeV2(doc):Promise<V3>`, `parseDocumentV3(raw,{decodeAsset}):Promise<V3>`, `serializeDocumentV3(doc):Promise<string>`, `createEditorV3(doc)` → snapshot/dispatchBatch/undo/redo; `evaluatePoseV3(doc,values):Pose`. V3=`{format:'pankeki-authoring',version:3,baseDocument,parameterDefinitions,values,bindings,clipRelations,deformers,partDeformerIds,rigHash,presets,motions}`. `baseDocument`는 기존 parser로 검증한 v2 복사본이다.

- [ ] **Write failing tests:** v1/v2 bytes 보존·명시 upgrade만 v3 생성·unknown fields/중복 ID/범위·기본값·finite 검사; 새 좌우축 독립, v2와 v3 기본 pose 동일, 단일 command atomic undo, 정의 변경→rig/preset/motion stale.
- [ ] **Run red:** `node --test scripts/test_character_v3.cjs`.
- [ ] **Implement schema:** 최대32 parameter `{id,label,min,max,default,unit}`; 기본 3축 정의와 기존 값을 그대로 복사한다. 좌우 eye/form은 사용자 명시 추가이며 자동 원화 분리는 하지 않는다. `bindings`는 `{id,partId,mode:'axis',parameterIds:[id],keys:[{at,deltas}]}`부터; 해당 part에 확장 binding이 존재하면 그 part의 v2 bindings 전체를 대체하고, 없으면 v2 평가 유지. upgrade 시 기존 binding을 그대로 옮겨 중복 delta를 금지한다. 기존 16파트/1024px/자산/UV/triangle 한계 유지. 자체 새 정의에만 범위 밖 error 정책을 사용한다.
- [ ] **Implement evaluation/history:** baseDocument는 legacy parser로 검증, v3 확장은 별도 검증 후 base geometry를 평가한다. hash는 base asset/topology/parent와 모든 확장 정의·binding·clip·deformer를 포함한다. command `{type:'setParameterDefinitions'|'setValues'|'setBindings'|'setClipRelations'|'setDeformers'|'savePreset'|'saveMotion',value}`를 batch 후 재검증하고 변경없음은 history no-op. `setDeformers.value={deformers,partDeformerIds}`, `savePreset/saveMotion.value`는 Task 9의 preset/motion 한 객체이며 다른 set command의 value는 해당 필드 전체 값이다. definitions 변경은 관련 binding 재작성 없으면 실패, preset/motion stale 표시.
- [ ] **Run green:** 위 테스트와 `node --test scripts/test_character_document.cjs scripts/test_character_renderer.cjs` PASS. 테스트값은 새 축 `eyeLOpen=0`, `eyeROpen=1`, `mouthForm=-1..1`이며 그림 품질 성공으로 해석하지 않는다.
- [ ] **Record:** v3 schema/함수와 baseline/diff 기록.

## Task 7: 자체 다른 파츠 alpha 가림

**Files:** Modify `character-document-v3.js`, `character-renderer-v3.js`; Create `scripts/test_character_v3_masks.cjs`.
**Interfaces:** `clipRelations:Array<{sourcePartId,targetPartId,inverted:boolean}>`; `drawPoseV3(canvas,pose,decodedAssets,{canvasFactory}={}):DrawResult`. Pose에는 최종 변형 draw 및 mask-only source를 포함한다.

- [ ] **Write failing tests:** source alpha 바깥 target 픽셀 0, inverted 가림, hidden source도 mask 활성, 같은 target 여러 mask의 union, 누락/self/cycle 거절, 두 부모 변형 이후 source/target 좌표 일치, 실패 시 destination 이전 픽셀 불변.
- [ ] **Run red:** `node --test scripts/test_character_v3_masks.cjs`.
- [ ] **Implement:** v3 관계 최대32, 하나의 target에는 같은 inverted 값만 허용. 최종 변형한 source의 texture alpha×상속 opacity를 별도 canvas에 그려 union 후 destination-in/out; draw visibility와 mask 활성 분리. legacy `drawPose`로 한 part의 layer를 그릴 수 있으나 전체 합성/가림은 새 모듈 소유. 완성 staging canvas만 target에 복사, scratch 총128MiB 제한 및 task 종료 회수.
- [ ] **Run green:** 위 테스트 PASS; 작은 합성 색 도형을 실제 Canvas2D에서 읽은 alpha로 확인한다. stub 호출수만으로 픽셀 가림 성공 판정 금지.
- [ ] **Record:** synthetic 증거와 실제 캐릭터 원화 준비 필요를 분리한다.

## Task 8: 자체 2축 조합 키폼과 부모 워프 최소 확장

**Files:** Modify `character-document-v3.js`, `character-renderer-v3.js`; Create `scripts/test_character_v3_combinations.cjs`, `scripts/test_character_v3_warp.cjs`.
**Interfaces:** binding 추가 mode `'grid2d'`, `parameterIds:[xId,yId]`, `axes:[number[],number[]]`, `deltas:number[][]`(x-fast row-major); `deformers:Array<{id,parentId,kind:'warp',rect:[x,y,w,h],columns,rows,deltas:number[]}>`, `partDeformerIds:Record<partId,deformerId|null>`. v3 draw final 좌표는 기존 pose와 같은 문서 좌표.

- [ ] **Write failing grid tests:** mouthOpen `{0,.5,1}`×mouthForm `{-1,0,1}`의 9개 full grid와 center 보간; 누락/중복/축순서/NaN 거절; 기본 조합 delta 0; 한 part 같은 parameter를 axis와 grid에 중복 적용 거절; corner·center·27 legacy 조합의 뒤집힘 차단.
- [ ] **Run red/grid:** `node --test scripts/test_character_v3_combinations.cjs`.
- [ ] **Implement grid2d:** 한 binding 두 축만, 축당2..8 key/총64 cell, bilinear interpolation, 여러 binding은 disjoint parameter일 때만 합산. shape 변경은 `setBindings` batch, neutral 키 잠금. 더 높은 차원의 조합/자동 Editor 보간 복제 없음.
- [ ] **Run green/grid:** 동일 명령 PASS, invalid current pose가 이전 정상 canvas를 덮지 않음 확인 후 diff 기록.
- [ ] **Write failing warp tests:** affine 이동 `(12,-8)` 및 pivot `5°` 후 부모 lattice 모서리 `(4,-3)` 변위가 자식/마스크에 한 번만 전달, neutral identity, cycle/영역밖/뒤집힘 거절, 저장/undo 동일.
- [ ] **Run red/warp:** `node --test scripts/test_character_v3_warp.cjs`.
- [ ] **Implement warp:** 격자2..8행/열, 최대8개; part affine chain→연결된 inner warp→ancestor warp 순서로 문서 좌표에 bilinear 변위. 각 warp의 rect/lattice는 문서 좌표로 고정하고 입력점이 밖이면 clamp하지 않고 차단. child parent affine와 warp를 이중 적용하지 않는다. mask source도 동일 pipeline. 기존 part affine을 회전/배치 노드로 유지하며 이번에 별도 rotation 노드 UI까지 늘리지 않는다.
- [ ] **Run green/warp:** 동일 명령과 Task 7 가림 테스트 PASS; 저장된 warp 수정/undo로 전체 관련 형상이 함께 복원.
- [ ] **Record:** 서로 독립인 grid/warp diff와 수치/시각 증거를 별도 항목으로 남긴다.

## Task 9: 자체 v3 편집·저장·출력과 실제 UI 회귀

**Files:** Create `web/src/character-workspace-v3.js`, `web/src/character-export-v3.js`, `scripts/test_character_v3_workspace.cjs`, `scripts/test_character_v3_export.cjs`; Modify `app.js`, `studio.js`, `index.template.html`, `redesign.css`, `web/build.py`, `README.ko.md`, 기존 v2 `web/src/character-motion.js`의 parameter draft/commit 관련 경로와 `scripts/test_character_motion.cjs` 해당 회귀만; Rebuild `web/index.html`.
**B2 기존 v2 경계:** 기존 PankekiMotion.mount 공개 API와 document schema/renderer/export 포맷 유지. previewParameters/commitParameters, input/refresh, applyPreset, saveProject/snapshotProject/runExport에 필요한 입력 처리만 수정한다. 원화/로고/메뉴와 무관한 편집 동작은 범위 밖. 이 파일은 Task 9 UI 통합 담당이 순차 소유한다.
**화면 문구:** 아래 `v3 복사본 만들기/불러오기`는 구현 작업명이며 실제 표시는 `정밀 리깅으로 복사 / 리깅 작업 열기`처럼 목적 중심으로 한다; version3은 저장/호환 설명에서 필요한 만큼만 표시하고 기존 로고·사이드메뉴·기능/labels 전면개편은 하지 않는다.
**Interfaces:** `PankekiAuthoringV3.mount(document,{editor,renderer,exporter,onError,onChange})` → `show`, `suspend`, `destroy`, `loadDocument`, `snapshotProject`; v3 exporter `exportPosePng({document,values,decodedAssets,signal,canvasFactory})`, `exportFrames({document,motion,decodedAssets,signal,canvasFactory,onProgress})`. v3 motions=`{id,label,duration:2,fps:24,rigHash,curves:[{parameterId,keys:[{t,value}]}]}`; 최대32곡선/32key, linear/loop endpoints 동일. v3 presets=`{id,label,rigHash,values}`.

- [ ] **Write failing tests:** 기존 v2 `scripts/test_character_motion.cjs`와 새 v3 workspace 각각에서 `0`→`0.`→`0.5` 입력 중 UI refresh가 문자열/커서를 덮지 않음, Enter/blur commit·Esc cancel, 같은 preset no-op 뒤 화면값 복원, invalid draft save/snapshot/export 차단을 검증한다. v3 undo/redo 값/형상/가림 동시 복원과 v2 DB/schema 불변도 확인한다. invalid draft를 이전 확정값으로 조용히 저장/출력하지 않아야 한다.
- [ ] **Run red:** `node --test scripts/test_character_motion.cjs scripts/test_character_v3_workspace.cjs scripts/test_character_v3_export.cjs`; 기존 v2 새 입력 사례가 실제 실패하는지 별도 기록한다.
- [ ] **Implement v2 draft/commit only:** 숫자 입력 문자열·편집중 상태·마지막 확정값을 분리해 `0.` 같은 중간 문자열을 refresh가 덮지 않게 한다. Enter/blur에서 유한수/기존 0..1 범위 검증 후 commit, Esc는 확정값 복원, 같은 preset no-op도 입력 UI 복원. invalid draft는 save/snapshot/export 차단, 유효 draft는 저장 전 commit. range 입력의 기존 preview/commit 의미와 한 번의 undo 단위를 유지한다. schema/renderer/export 형식은 변경하지 않는다.
- [ ] **Implement UI:** 기존 motion 내부 명시 `v3 복사본 만들기`/`v3 불러오기`; 새 패널은 parameter 정의/값, part 선택·키/9cell 선택·neutral 잠금, clip source/target, warp 격자 점 조절을 제공한다. 작업량에 따라 folding 사용, 기존 사이드 navigation 추가/삭제하지 않는다. preview 문자열은 document와 분리, 저장 전 유효 draft 명시 commit 또는 오류 표시. 별도 DB `pankeki-authoring-v3`에만 저장하며 기본 v2를 자동 upgrade하지 않는다.
- [ ] **Implement output:** 새 evaluator/drawer와 같은 값/clock으로 PNG 및 48 PNG ZIP 생성, frame index 0..47, time=index/24, alpha/취소·stale 보호. 기존 exporter의 검증을 느슨하게 하지 않고 필요한 공통 PNG/ZIP helper만 추출할 경우 기존 export 테스트도 같은 Task에서 실행한다. schema와 실제 frames에 모든 새 parameter를 보존한다.
- [ ] **Run green/build:** 기존 v2 입력 집중 회귀와 두 새 테스트, Tasks 6–8 테스트 PASS; `.venv-macos/bin/python web/build.py`; `node --test scripts/test_character_document.cjs scripts/test_character_renderer.cjs scripts/test_character_motion.cjs scripts/test_character_export.cjs scripts/test_motion_app.cjs scripts/test_motion_ui_contract.cjs scripts/test_redesign.cjs scripts/test_ui_unification.cjs`; `.venv-macos/bin/python -m unittest tests.test_server tests.test_cubism_delivery`.
- [ ] **Actual browser acceptance:** 연결 앱에서 v2 fullbody/bust 열기→재생→키보드 `0→0.→0.5`·refresh draft 유지·Enter/blur·Esc·같은 preset 복원·invalid draft 저장/출력 차단→undo/redo→저장/재열기→각48프레임 출력, synthetic v3에서 좌우축/가림/grid/warp UI 조작→save/reopen→같은 pose PNG·프레임 equality/투명도/ZIP완료를 확인한다. preview vs decoded PNG equality를 기록. 이전 QA 결과는 이번 PASS로 복사하지 않는다.
- [ ] **Record final limitation:** 현재 body/eyes/mouth PNG 불변 hash를 확인한다. 기술 fixture 통과와 자연스러운 폐안/폐구·숨은 면·아트 시각 승인 gate를 분리해 기록한다. 실제 캐릭터 아트 gate는 원화/미술 담당의 별도 후속이며 첫 기술 적용에서 완료 처리하지 않는다.

## 의존 순서·완료 정의·자체검토

기술 실행 우선순위는 1 → 2 → 6 → 7 → 8 → 3(조건부) → 4·9(통합 담당 순차) → 5 및 Task 9 실제 QA다. Cubism 내부 의존은 1 → 2 → 3 → 4 → 5이며, Task 3 gate가 남아도 Task 4의 package/session/capability·unavailable 경로와 Task 9의 실제 자체 v3 UI를 끝까지 구현한다. 각 Task의 UI 통합은 기존 baseline QA 후 새 통합 직원에게 순차 소유권을 배정한다. 공유 `app.js`/template/build/README 변경은 한 통합 담당이 순서대로 적용한다. 각 작업 담당은 본인 파일만 수정한다.

계획 자체검토 완료: Spec의 패키지·공식 player·동적 param·제공 motion/exp/physics/pose·별도 저장·수명·사용조건을 Tasks 1–5로 연결했다. 범용 축/가림/부모 warp/작은 조합 keyform 및 preview/commit·undo·출력은 Tasks 6–9로 연결했다. 모든 공유 함수/형식은 위 Interfaces에서 정의했고, 5개 Review Focus에 각각 실패 시험이 있다. SDK API 버전 세부는 실제 확보 세트로 고정해야 하므로 실제 재생 gate에 속하며 임의 재현하지 않는다.

첫 배포 완료는 실제 `.moc3` 재생 및 기존/새 자체 경로의 실제 browser 검증을 요구한다. SDK가 없으면 “기술 일부 구현, Cubism 실재생 미완료”로 보고한다. Editor PNG 배치 후 ArtMesh와 아트 품질은 별도 관찰/제작 과제이며 본 계획으로 자동 해결되었다고 주장하지 않는다.

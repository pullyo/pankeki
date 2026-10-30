# Pankeki 2D Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 준비된 PNG 부위를 실제 메시로 변형해 눈·입·호흡을 조절하고 재생·정지·프로젝트 재개·48프레임 출력까지 잇는다.

**Architecture:** 별도 v2 문서·순수 pose/Canvas 렌더러·동작 컨트롤러·출력 모듈을 기존 vanilla JS 앱에 연결한다. 기존 v1·이미지 SDK 경로는 보존한다. 아지는 코드 대신 파일 소유권·통합·독립 검증을 맡고 기존 네 담당이 아래 경계에서 작업한다.

**Tech Stack:** 기존 Python HTTP 서버, vanilla JS/CommonJS 테스트, Canvas2D/Web Crypto/Blob, 기존 Node test runner. 새 패키지·GPU 추론 없음.

**Spec:** [승인된 움직임 설계](../specs/2026-10-20-motion-first-design.md), [v2 세부 계약](../../handoffs/character-document-contract.md). 사용자는 설계에 이어 이 실행계획을 직접 “계획 확인, 작업팀 구현 시작”으로 승인했고 기존 작업팀 방식을 선택했다. 총괄이 프론트·기술·기능·디자인 네 담당에게 T1~8의 실제 코드 구현을 지시했다. 추가 설계/계획 재승인을 기다리지 않는다.

## Global Constraints

- 한 변1024px 이내 캔버스·최대16부위, 부위당 정점≤256/삼각형≤512. 더 큰 기존 v1 원본은 보존하되 변형을 비활성화한다.
- `eyeOpen` 기본1, `mouthOpen/breath` 기본0, 모두0..1. 같은 정점 수·연결·UV, 모든 binding은 같은 base에 displacement 합산. 기본값의 delta는0.
- 합성 pose의 삼각형 방향이 base와 다르거나 면적 절댓값이0.0001px² 미만이면 거절한다. 원본·소재 바이트 불변, RGBA 보존, 준비되지 않은 배경/소재와 stale 리그는 차단한다.
- 동작2초·24fps·48프레임, `t=k/24, k=0..47`. 곡선은0/2초 포함·최대32키·루프 양끝값 같음. 매 프레임 undo/문서 revision 증가 없음.
- ZIP 내 `frame-0000.png`…`frame-0047.png`와 manifest, PNG 합계128MiB 상한, 전체 성공 후 다운로드. 취소/실패 시 부분 파일을 완료로 제공하지 않음.
- v2 JSON64MiB, 자산 data URL16MiB/디코드16MP, 유일 자산64개/디코드 RGBA 합128MiB. undo 실행 중50단계/patch32MiB, 재개 시 undo 스택 없음을 표시한다.
- 새 채팅·하위 에이전트·의존성·모델·유료 서비스 없음. 기존 팀 방식이 스킬의 기본 새 에이전트 방식보다 우선한다. 각 구현 담당은 executing-plans와 필요한 검증 절차를 적용한다.
- D:/Pankeki는 Git 저장소가 아니다. 임의 git init/원격 push 대신 작업별 변경 파일·해시·검증 기록을 남긴다. 총괄은 제품 코드를 작성하지 않는다.

## Review Focus

- 깨진 PNG/속인 크기·해시·과대한 파일: 가져오기는 현재 문서를 보존하고 명확히 실패해야 한다(T1).
- 부위/키폼 각각은 유효하나 복합 pose에서 뒤집히는 메시: 마지막 유효 화면을 보존하고 재생/출력을 중단해야 한다(T2/T4).
- import/reset/화면전환/숨김 중 남은 애니메이션·디코드·출력 응답: 이전 문서가 현재 작업을 변경하지 않아야 한다(T5/T6).
- 투명 경계·겹치는 부위·부모 opacity: 검은 테두리나 원래 눈의 중복 없이 정지/움직임 모두 같은 합성을 써야 한다(T4/T8).
- 루프 끝점·재생 중 저장·출력 중 취소/상한: 보이는 pose를 재개하고 완성되지 않은 ZIP을 내놓지 않아야 한다(T6/T7).

## 파일과 담당

| 담당 | 소유 파일 / 외부 인터페이스 |
| --- | --- |
| 프론트엔드 | 신규 `web/src/character-document.js`, `character-motion.js`; 기존 `app.js`, `studio.js`; 관련 Node 테스트. `profiles.js`의 v1 공개 API는 유지 |
| 기술·모델 리서치 | 신규 `web/src/character-renderer.js`; `scripts/test_character_renderer.cjs`. 모델 harness/runtime는 고정 유지 |
| 기능·이미지 품질 | 신규 `web/src/character-export.js`; `scripts/test_character_export.cjs`. 이번에 서버/Codex/기존 SDK를 함께 바꾸지 않음 |
| 디자인·사용성 | `index.template.html`, `style.css`, `web/build.py`, `web/assets/motion-demo/`, 최종 `web/index.html`; UI 계약·자체 제작 예제·최종 빌드 |
| QA | 독립 브라우저/산출물 검증과 `work/team-resume/motion-qa/`. 모델 비교가 끝나기 전 새 GPU 실험 없음 |

모듈은 기존 UMD 패턴으로 CommonJS와 브라우저 전역 `PankekiDocument`, `PankekiRenderer`, `PankekiMotion`, `PankekiExport`를 노출한다. 순서는 `profiles.js → character-document.js → character-renderer.js → character-export.js → character-motion.js → app.js → studio.js`. 컨트롤러는 app 초기화 후 명시적으로 mount하며 모듈 로드만으로 DOM/작업을 변경하지 않는다.

세부 계약과 설계의 배경 조건은 다음으로 정합화한다. **원본 위에 덧그리는 미분리 장면은 차단**하고, 모든 부위가 실제 분리된 RGBA이며 사용자가 backgroundReady를 확인한 장면은 backgroundAssetId=null일 때 투명 배경으로 렌더할 수 있다. v1 원본만 있거나 준비 확인이 없는 상태는 허용하지 않는다. 기존 계약의 ‘배경 asset 없음’ 일괄 차단보다 승인 설계의 투명 분리 장면 출력을 우선하며 T2/T4가 이를 검증한다. key의 기본값이 끝점과 같으면 중복 key를 만들지 않고0.5 중간 key를 추가할 수 있다.

담당의 D 쓰기가 제한된 경우 본인 허용 작업 폴더에 소유 파일의 수정본과 기준/최종 SHA를 남기고 총괄이 일치 여부를 확인해 그대로 수집한다. 다른 담당 파일·기존 산출물을 덮지 않으며 실제 구현 코드의 작성자는 담당으로 유지한다.

---

### T1: v2 자산 검증·v1 가져오기 — 프론트엔드

**Files:** Create `web/src/character-document.js`, `scripts/test_character_document.cjs`. 기존 fixture `docs/handoffs/fixtures/character-document-v2.fixture.json`은 읽기 전용으로 재사용.

**Interfaces:** `parseDocument(raw,{decodeAsset}={}) → Promise<DocumentV2>`; `serializeDocument(doc) → Promise<string>`; `fromV1(raw,options) → Promise<DocumentV2>`; `computeRigHash(part,rig,assets) → Promise<string>`. 기본 decodeAsset은 실제 브라우저 디코드이며 Node 검증은 주입한 decoder 사용. 실제 바이트·SHA256·signature 검증은 항상 수행.

- [ ] RED: `v2_round_trip_and_v1_bytes_preserved`에서 `assert.equal(loaded.version,2)`, 원본 asset bytes/후보 계보/선택 기록 일치, v1 원본 JSON 불변을 검사한다. `reject_hash_dimensions_and_limits_without_replacing_current`에서 해시 불일치·실제 크기 불일치·64MiB 초과·17부위·부모 순환·위험 키를 거절하고 이전 문서가 유지됨을 검사한다.
- [ ] Run `node --test scripts/test_character_document.cjs`: 새 모듈/API 부재로 실패 확인.
- [ ] 구현: v2 strict allowlist와 fixture hash tuple을 적용한다. v1은 기존 `CharacterDesign.parseProject` 성공 후 변환한다. 미완성/이전 hash 리그는 stale로 읽되 준비 완료로 승격하지 않는다. 파싱은 임시 객체에서 끝내고 성공 후에만 교체한다.
- [ ] GREEN: 같은 명령 통과. handoff `docs/handoffs/motion-document-implementation.md`에 API·수용 범위·변경 SHA 기록.

### T2: 격자·키폼·순수 pose — 기술 담당 / T1과 병렬

**Files:** Create `web/src/character-renderer.js`, `scripts/test_character_renderer.cjs`.

**Interfaces:** `createGrid(width,height,{columns=4,rows=4}={}) → {vertices,uv,triangles}`(columns/rows는 정점 개수); `evaluatePose({canvas,sourceAssetId,backgroundAssetId,parts,rigs,parameters},values) → {backgroundAssetId,draws,blockedParts}`; `sampleMotion(motion,t,{loop=false}={}) → Record<parameterId,number>`. draw 항목은 기존 계약의 `partId,assetId,verticesDocument,uv,triangles,opacity,order`.

- [ ] RED: `grid_and_intermediate_keyform_are_real_geometry`: `assert.equal(grid.vertices.length/2,16)`, `assert.equal(grid.triangles.length/3,18)`; UV0..1, fixture 중간 key 기대값 일치와 UV/삼각형 불변. `combined_pose_parent_and_invalid_geometry`: 부모 affine·숨김/opacity 전파, 복합 delta 합산, source mismatch/stale와 뒤집힘·0.0001px² 미만 면적 차단을 검사한다. `prepared_transparent_scene_is_allowed_but_original_overlay_is_blocked`: 모든 분리 부위 backgroundReady=true·배경null이면 draw 허용, 미준비 원본은 차단. `curves_are_deterministic`: `assert.equal(sampleMotion(blink,.95).eyeOpen,0)`, `assert.ok(Math.abs(sampleMotion(blink,.9).eyeOpen-.5)<1e-9)`, 루프2초=0초, NaN/잘못된 키 거절.
- [ ] Run `node --test scripts/test_character_renderer.cjs`: 새 API 부재 실패 확인.
- [ ] 구현: 순수 계산과 구간 선형 보간, 0~1 범위 검사. loop는 유한 비음수 경과시간을 duration으로 나누고, 비반복 sample은 유효 구간으로 제한한다. 곡선이 없는 mouth 값은 이 함수에서 만들지 않고 호출자가 문서값을 유지한다. DOM/네트워크/문서 변경 없음.
- [ ] GREEN: 같은 명령 통과. `docs/handoffs/motion-renderer-implementation.md`에 실제 중간 정점과 실패 경로 기록.

### T3: 부위 명령·원자적 undo·무효화 — 프론트엔드 / T1 이후

**Files:** Modify `character-document.js`, `scripts/test_character_document.cjs`.

**Interfaces:** `createEditor(doc,{historyLimit=50,maxHistoryBytes=33554432}={}) → Editor`; Editor의 `snapshot() → {document,revision,canUndo,canRedo}`, `dispatch(command) → Promise<Snapshot>`, `undo()/redo() → Promise<Snapshot>`. command `{type,args,expectedRevision}`.

- [ ] RED: `commands_are_atomic_and_undo_keeps_revision_monotonic`: 한 drag의 최종 명령이 undo1개, undo/redo 후 revision 증가, 새 명령은 redo 삭제, 실패 명령은 문서 불변. `material_and_keyform_replacement_invalidate_dependents`: 소재/원본/메시 변경과 stale 처리를 한 undo로 복원, 현재값만 바꾸면 rigHash 불변, 잠금·소스 불일치·한도 거절.
- [ ] Run `node --test scripts/test_character_document.cjs`: 새 editor 동작의 실패 확인.
- [ ] 구현 allowlist: `addAsset{asset}`, `addPart{part}`, `removePart{partId}`, `setPart{partId,patch}`, `replaceMaterial{partId,assetId}`, `setRig{rig}`, `setParameters{values}`, `savePreset{preset}`, `saveMotion{motion}`, `setSelection{selection}`, `setBackground{assetId,confirmed}`. patch는 name/parentId/order/transform/visible/opacity/lockMaterial/lockTransform만 허용. setBackground는 현재 원본에 대해 사용자가 실제 확인한 배경과 해당 부위들의 backgroundReady를 한 명령으로 갱신하고 undo도 함께 복원한다. 자식이나 preset/motion 참조가 있는 removePart는 첫 버전에서 거절해 데이터를 조용히 삭제하지 않는다. 자산 검증·hash 계산 후 원자 commit, 소재/키폼 변경 시 관련 hash 재검증, 마지막 유효 상태와 불변 asset 참조를 보존한다.
- [ ] GREEN: 같은 명령 통과. 50단계/patch32MiB 초과는 오래된 undo만 정리하며 현재 자산/문서를 버리지 않는다. serialize는 undo 스택을 제외한다.

### T4: 실제 RGBA 삼각형 렌더 — 기술 담당 / T2 이후

**Files:** Modify `character-renderer.js`, `scripts/test_character_renderer.cjs`; browser fixture 검증은 QA에 전달.

**Interfaces:** `drawPose(canvas,pose,decodedAssets) → {width,height,drawnPartIds}`. decodedAssets는 assetId→실제 decode 이미지 Map. renderer는 전달된 canvas만 변경.

- [ ] RED: `draw_order_hidden_parent_and_missing_asset`: 배경→order 순, 숨김/부모 opacity 적용, 누락 asset 실패. `rgba_edges_and_three_parameter_positions`: 실제 Canvas에서 반투명 가장자리/정점 중간값 렌더, 원본 bytes 불변, 최소/중간/최대 이미지가 실제로 다름을 확인하는 browser 수용 사례를 작성한다.
- [ ] Run `node --test scripts/test_character_renderer.cjs`: 새 draw 경로 실패 확인. 실제 픽셀 검증은 T9 브라우저에서 실행할 항목으로 기록한다.
- [ ] 구현: 삼각형 clip과 UV→화면 affine, 브라우저의 alpha 합성 사용. 검증되지 않은 pose/asset을 중간까지 그린 뒤 성공으로 보고하지 않는다. 가림 배경이 없으면 원본 위 덧그림을 차단하고 준비된 분리 장면만 렌더한다.
- [ ] GREEN: 같은 Node 명령 통과, 실제 RGBA 검증은 T9 증거를 완료 조건으로 유지한다.

### T5: 사용자 부위·메시/기준 형태 UI — 프론트·디자인 / T1~4 인터페이스 고정 후

**Files:** Front creates `character-motion.js`, `scripts/test_character_motion.cjs`, modifies `app.js/studio.js`; design modifies template/CSS and `docs/handoffs/motion-ui-contract.md`. 서로 소유 파일 공동 편집 없음.

**Interfaces:** `PankekiMotion.mount(root,{editor,renderer,exporter,decodeAsset,onError}) → Controller`; `Controller.loadDocument(doc)`, `show(screen)`, `destroy()`, `getSummary()`. loadDocument는 이전 decode/render 작업을 먼저 무효화. UI 이름/요소는 위 UI 계약에 한 번 정의해 공유한다.

- [ ] RED: `user_parts_grid_and_keyform_commit`: 사용자 PNG를 asset/part로 등록, 부모/순서/배치, 격자 조절점과 파라미터 key 선택·저장까지 같은 editor 사용. `failed_import_and_stale_decode_keep_current_document`: 실패/역전 응답이 현재 문서를 덮지 않음, 준비 전 슬라이더 차단. 실제 픽셀 검증은 T9.
- [ ] Run `node --test scripts/test_character_motion.cjs`: 모듈/연결 부재 실패 확인.
- [ ] 구현: 원본 기준 후보와 준비된 배경 확인, PNG 다중 가져오기·기준 배치·메시 point drag와 숫자 조절·최소/기본/최대 key 저장. 현재값을 savePreset으로 저장하고 목록에서 선택할 때 rigHashes를 대조한 뒤 setParameters로 적용한다. 일반 원본 한 장에는 자동 분리 성공을 표시하지 않는다. 드래그 preview는 로컬, pointerup에 한 명령. 선택된 부위의 유효 binding만 활성화한다. 원본 후보 교체는 현 motion 장면을 다른 원본으로 자동 이식하지 않고 기존 v2를 보존하며 새 준비 상태로 전환한다.
- [ ] GREEN: Node 명령 통과. existing chatNotice의 로컬 모델 문구를 Codex 상태로 통일. 구형 생성/마스크/후보 경로를 유지하며 보이는 후보·수정 기준을 구분한다.

### T6: 재생·정지·시간 이동·저장 재개 — 프론트엔드 / T3~5 이후

**Files:** Modify `character-motion.js`, `app.js/studio.js`, `scripts/test_character_motion.cjs`; extend existing 관련 상태 테스트만 필요에 따라 수정.

**Interfaces:** Controller `play(motionId)`, `pause({commit=true}={})`, `seek(t)`, `saveProject() → Promise<string>`, `importProject(raw) → Promise<boolean>`. 사용자가 slider를 움직이면 pause 후 한 명령으로 적용.

- [ ] RED: `play_pause_seek_visibility_and_project_switch`: fake clock으로2초 루프, RAF 해제, 숨김/화면전환/문서교체 후 이전 callback 폐기. `save_visible_pose_once_and_restore_without_undo`: 프레임100회 동안 revision 불변, pause/save의 보이는 값 commit1회, 새 앱에서 동일값 복원·undo0회. `invalid_combined_pose_stops_playback`: 마지막 유효 화면과 명확한 오류 유지.
- [ ] Run `node --test scripts/test_character_motion.cjs`: 재생/저장 미구현 실패 확인.
- [ ] 구현: spec의 눈/호흡 기본 곡선과 선택 입 곡선, ≤32키 숫자 편집, 실제 경과시간 평가. 저장 시 pause(commit), v2 download/자동복원 namespace 분리. 저장 시각·재생 중 플래그는 제외한다. 기존 v1 저장과 v2 작업을 혼동하거나 자동 v1 축소 저장하지 않는다.
- [ ] GREEN: 같은 명령 통과. v1은 원본 바이트 보존하고 새 형식으로 저장, 현재 v2 미저장 작업은 프로젝트 변경 전 기존 확인 흐름으로 보호한다.

### T7: 48 PNG·manifest·단일 ZIP — 기능 담당 / T2·4 인터페이스 고정 후 병렬

**Files:** Create `character-export.js`, `scripts/test_character_export.cjs`. 프론트/디자인 소유 파일은 직접 변경하지 않고 연결 명세 인계.

**Interfaces:** `exportFrames({document,motion,renderer,decodedAssets,signal,onProgress,canvasFactory}) → Promise<Blob>`; `exportPosePng({document,values,renderer,decodedAssets,canvasFactory}) → Promise<Blob>`. canvasFactory는 browser canvas/QA 제어 canvas 주입용. 원문서/현재 재생값 변경 없음.

- [ ] RED: `archive_has_48_frames_and_exact_sample_times`: 파일48개 이름0000..0047, 시각0..47/24, manifest의 duration2/fps24/크기/rigHash, ZIP CRC/중앙목록 유효. `cancel_failure_or_limit_returns_no_completed_archive`: 취소/3번째 frame 실패/128MiB 초과 시 reject·진행 중단·다운로드 없음·문서 불변.
- [ ] Run `node --test scripts/test_character_export.cjs`: 새 API 부재 실패 확인.
- [ ] 구현: 같은 evaluate/draw, 프레임 단위 PNG Blob, 외부 라이브러리 없는 ZIP STORE 패키징과 manifest. 모든 프레임 크기·PNG signature 검증 후 Blob을 반환한다. 임시 canvas/Blob 참조 해제와 외부 AbortSignal을 처리한다. 브라우저 Blob URL의 생성·다운로드·revoke는 프론트 연결부 소유.
- [ ] GREEN: 같은 명령 통과. 테스트에서 ZIP을 독립적으로 읽어 frame 수/이름/CRC를 검증하며 writer 내부 결과를 그대로 신뢰하지 않는다.

### T8: 자체 제작 캐릭터·따뜻한 UI 통합 빌드 — 디자인 담당 / 계약 확정 후

**Files:** Create `web/assets/motion-demo/{source.png,background.png,body.png,eyes.png,mouth.png,project.json,provenance.json}` 및 제작 원본; modify template/CSS/build.py, build index.html. frontend의 공개 API만 호출.

**Interfaces:** 예제 버튼은 검증된 v2 project를 T5와 같은 loadDocument로 가져온다. assets는 별도 외부 URL 없이 최종 HTML에 포함할 수 있도록 build.py에서 지정 토큰 치환. 사용자 PNG와 다른 비밀 경로/미리 만든 영상 없음.

- [ ] 준비/검증: 자체 팬케이크 캐릭터를 분리된 RGBA 눈·입·몸과 깨끗한 배경으로 직접 제작한다. 단순 색 사각형 fixture는 수치 테스트로만 사용. source는 기본값의 실제 합성, 감은 눈은 면적이 있는 line형 key, 입은 준비한 내부 소재의 유효 key, 호흡은 제한된 몸 변형. 사용 출처·수동 준비를 provenance에 기록한다. 모델 생성/다운로드 추가 없음.
- [ ] UI 검증: 부위 가져오기·메시/key 편집·3슬라이더/숫자·곡선·재생·정지·seek·undo/redo·정지/프레임 출력·저장 상태가 준비 여부와 일치. 색·Codex·외형 조합 등 아직 안 된 별도 기능을 함께 활성화하지 않는다. 모바일은 보기·간단 조절, 정밀 메시 작업은 데스크톱으로 안내한다.
- [ ] Build `D:/Pankeki/.venv/Scripts/python.exe web/build.py`는 모든 모듈 전달 후 실행한다. 새 script 순서/중복 ID/참조를 확인하고 index.html hash를 기록한다. 소스가 바뀌면 그 변경에 해당하는 검증만 갱신한다.
- [ ] `docs/handoffs/motion-design-integration.md`에 실제 assets/DOM 계약·최종 빌드·미지원 상태를 기록한다.

### T9: 실제 사용자 경로와 완료 판정 — QA·아지 / 코드·빌드 인계 후

**Files:** QA creates `work/team-resume/motion-qa/`의 report JSON/스크린샷·프레임/ZIP 검증, `docs/handoffs/motion-qa-results.md`. 총괄은 산출물 읽기/영상·이미지 확인과 tracker 갱신만 수행.

- [ ] 해당 신규 Node suite를 한 번 통합 실행: `node --test scripts/test_character_document.cjs scripts/test_character_renderer.cjs scripts/test_character_motion.cjs scripts/test_character_export.cjs scripts/test_studio_state.cjs web/tests/profiles.test.cjs scripts/test_ui_state.cjs`. 실패하면 해당 담당에게 재현/기대값을 전달해 최소 수정 후 영향 범위만 재검증한다.
- [ ] 새 실제 브라우저 세션에서 예제 및 별도 사용자 준비 PNG를 UI로 가져와 메시/key 편집→눈/입/호흡0/.5/1→재생/정지/seek→undo→저장→닫고 재개→PNG·ZIP을 끝까지 수행한다. 제품의 실제 built HTML hash·실행 origin을 남긴다. SDK 서버 미복원 시 격리 정적 preview와 실제 backend 통합 증거를 구분한다.
- [ ] 원본 bytes/alpha·부모/z순·픽셀 중간형태·투명 경계·마스크/리그 source 무효화·invalid geometry 정지·문서 교체·숨김·한도/취소를 실제 산출물과 대조한다. 이미지 생성 요청0회·실제 decoded frame48개·frame시각·저장 왕복의 같은 정지 렌더를 확인한다.
- [ ] 모델 GPU 비교 종료 후 장비/viewport/부위/정점 수를 기록하고30fps·입력100ms 목표를 측정한다. 미달·미측정은 실제값/이유와 함께 남긴다. 수치용 fixture만으로 캐릭터 움직임 완료로 판정하지 않는다.
- [ ] 아지는 최소·중간·최대와 재생 증거·프로젝트·ZIP/CSV·QA 보고서를 직접 확인한 뒤 해당 항목만 완료로 바꾼다. 다음 누락 기능은 [전체 추적표](../../product/feature-delivery-tracker-20261020.ko.md)에서 이어 배정한다.

## 순서와 실행 인계

검토 후 T1+T2+T7의 인터페이스 준비와 디자인 UI/소재를 기존 담당에게 배정한다. T1→T3, T2→T4, T1~4→T5→T6, T4/T7/T8→T9의 의존성을 유지한다. QA의 승인된 모델 비교를 중복하거나 중단시키지 않는다. 각 담당의 task 상태·실제 착수·변경 경로·검증 결과를 기존 handoff와 추적표로 모은다.

자체 검토: 설계의 사용자 소재·3파라미터·중간 정점·RGBA/가림·key 편집·곡선·재생 생명주기·v1/v2·undo·48 ZIP·실패/상한·실장비 검증을 T1~9로 연결했다. 5가지 Review Focus의 소유 테스트를 지정했고 module/API·script 순서·파일 소유권을 대조했다. 예전 기능과 후속 누락은 추적표에 보존한다. 현재는 **설계·실행계획 승인 / 담당 네 명에 실제 구현 지시 전달 / 첫 코드 변경 확인 대기**다. 실제 착수·완료는 산출물과 별도로 확인한다.

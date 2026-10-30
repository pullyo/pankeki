# 움직임 프론트엔드 T5/T6 구현 인계

2026-10-20 KST. **T1/T3/T5/T6 코드와 Node 통합 검증 완료. 실제 controller/app/studio 연결 코드가 D:/Pankeki에 준비됐으며 디자인은 이 파일들을 포함해 최종 빌드/QA를 진행할 수 있다.** 실제 브라우저 픽셀/전체 캐릭터 완료 판정은 T9이며 여기서 대신 주장하지 않는다.

## 전달 파일과 연결

프론트 소유 `web/src/character-document.js`, 신규 `character-motion.js`, 기존 `app.js`, `studio.js`와 관련 Node 검사만 수정했다. renderer/exporter/template/CSS/build/예제는 다른 담당 소유 그대로 사용한다. `PankekiMotion`은 CommonJS/브라우저 전역이며 모듈 로드 부작용이 없다. app 초기화 끝에서 `mountMotionWorkspace()`가 명시적으로 mount하고 `PankekiMotionController`를 노출한다. studio 화면 이동은 `.show(screen)`을 호출한다. script 순서는 승인 계획대로 유지한다.

`mount(document,{editor,renderer,exporter,decodeAsset,onError})`는 `.ready` Promise와 계획의 `loadDocument/show/destroy/getSummary/play/pause/seek/saveProject/importProject`를 반환한다. 실제 renderer의 `evaluatePose`, `drawPose`, `createGrid`, `sampleMotion` 및 실제 exporter API를 그대로 사용한다. sourceCandidateId는 assetId로 변환하고 decodedAssets는 Map으로 넘긴다. 두 실제 canvas는 문서 크기로 준비한다.

테스트/앱 연결을 위해 선택적으로 clock `{now,request,cancel}`, download, confirmReplace, onChange, canvasFactory, getSourceCandidates/getSourceDocument를 주입할 수 있다. DOM 이벤트와 공개 편집 메서드가 같은 코드 경로를 쓴다. 추가 API `dispatch/undo/redo/previewParameters/commitParameters/selectPart/createGrid/beginKey/setKeyPoint/saveKey/savePreset/applyPreset/saveMotion/importParts/importBackground/exportFrames/exportPosePng/cancelExport/suspend/refreshSources/snapshotProject`는 실제 사용자 도구의 직접 진입점이다. snapshotProject는 재생을 멈추지 않고 마지막 commit 문서만 직렬화하며 앱 자동 저장 전용이다.

UI는 `motion-ui-contract.md`의 ID/data/action을 따른다. 다중 PNG 가져오기는 모든 파일을 먼저 검증하고 asset/part/selection을 한 원자 batch로 commit한다. 원본 한 장 자동 분리를 주장하지 않는다. 새 part는 배경 미확인/리그 없음으로 시작한다. 배경 또는 완전히 분리된 투명 장면은 사람이 확인한 뒤 setBackground로 적용한다. grid와 조절점·최소/중간/기본 key, 부모/순서/배치/잠금, 프리셋 hash, 곡선 숫자 편집을 연결했다.

key drag는 로컬 preview, pointerup에 한 setRig다. neutral 편집은 base를 바꾸고 모든 neutral delta0을 유지하며 나머지 key를 다시 계산한다. 원본 UV/연결은 유지된다. 합성 geometry 오류는 commit 전 renderer에서 차단한다. 원본 전환은 이전 v2를 세션 cache에 보관하고 새 원본은 준비 전 장면으로 만든다. 기존 리그를 다른 원본으로 이식하지 않는다. 현재 수정 원본과 보고 있는 최신 후보는 별개다.

재생은 runtime 값만 바꾸고 pause/save에서 보이는 pose를 한 번 commit한다. 화면/숨김/문서 교체는 RAF를 취소하고 숨김 복귀 시 자동 재생하지 않는다. epoch는 늦은 decode/교체 응답을 폐기한다. 출력은 AbortController와 완료 token을 사용하며 완성 Blob 이후만 다운로드하고 URL을 revoke한다. 중단된 ZIP은 제공하지 않는다.

상단 저장은 활성 v2를 v2로 저장한다. 상단 가져오기는 v1/v2를 판별하며 새 작업/명시적 v1 교체는 기존 확인 후 motion 장면도 교체한다. 기존 v1 exportProject 공개 API는 그대로 v1이다. v2 자동 저장은 별도 IndexedDB `pankeki-motion-studio-v2`/projects/current를 쓰며 v1 저장소를 덮지 않는다. 재개 시 undo 미복원 안내가 UI에 표시된다.

## 현재 검증 증거와 한계

- document suite 14/14, controller suite 11/11: `work/team-resume/frontend/motion/t5-t6-expanded-green.log` (exit0).
- app integration probe 4/4와 기존 app/studio를 합친 64/64: `t6-regression.log` (exit0, controller 확장 전8개 포함).
- RED/GREEN 원본: `t5-t6-red.log`, `t5-t6-green.log`, `t6-app-red.log`, `t6-app-green.log`. PNG 배치 검사에서 동일 asset 속성 순서 비교 결함을 재현한 `t5-t6-expanded.log` 뒤 필드별 동일성 검사로 수정했다.
- Node는 실제 pose 엔진을 사용하지만 decode/clock/DOM/Canvas 일부는 제어 경계다. 이 결과는 실제 browser PNG alpha/이음새/사용자 UI 다운로드/30fps·100ms 성능 통과 증거가 아니다. 디자인의 실제 캐릭터 예제와 별도 PNG를 T9에서 끝까지 확인해야 한다.

최종 전체 검사/해시/검토 결론은 후속 절에 기록한다. 새 에이전트/채팅/패키지/모델/GPU/서버 변경은 없으며 Git 없는 작업 지시대로 ledger/기준 백업/SHA를 보존한다.

## 독립 리뷰 P1 후속 수정

기능 담당의 `motion-controller-contract-review.md` 첫 절을 실제 코드와 대조해 원인을 확인했다. `task()`가 실행 시작 때 새 epoch/editor를 읽어 이전 숨김 pause의 파생 setParameters를 새 문서에 적용하던 문제다. 자체 회귀에서 validation gate → eyeOpen=.5 preview → 숨김 commit 대기 → replacement-v2 로드 → gate 해제 → queue drain을 실행했고 **새 문서 값 .5 / 기대1로 RED**를 확인했다(`t6-queue-epoch-red.log`).

수정은 task enqueue 시 epoch와 editor identity를 고정하고 실행 전 불일치 시 false로 폐기하는 것이다. 이미 시작한 dispatch 및 undo/redo도 await 후 같은 identity를 검사한다. 그 결과 같은 재현의 replacement-v2는 eyeOpen1/revision0을 유지한다. 이전 grid hash 계산이 나중에 끝나 새 문서에 메시를 넣는 파생 경로도 별도 RED→GREEN으로 보호했다(`t6-grid-epoch-red.log`, `t6-grid-epoch-green.log`). controller **16/16 GREEN**, 실제 문서/renderer 사용, PNG decode/비동기 validation gate는 제어 대역이다. 타 담당 리뷰/테스트 코드는 수정하지 않았다.

미준비 장면은 UI에 각 부위 이름과 ‘격자 없음/배경 미확인/리그 재등록 필요’를 표시하고 **모든 부위의 격자와 배경을 먼저 준비한 뒤 조절점 편집**을 안내한다. grid 생성은 계속 가능하며 준비 전 point 숫자/드래그/저장은 비활성이다. 전 부위 준비 후 key 편집이 가능하다. 기존 팀 독립 리뷰를 사용했으며 새 reviewer subagent/Git helper는 사용자의 기존 팀·Git 없음 지시로 실행하지 않았다.

## 최종 검토·검증·동결 기록

검토 후 추가 회귀로 늦은 PNG batch 완료의 decodedAssets/dirty 오염, 새 프로젝트가 이전 source cache를 불러오는 문제, 잠근 부위의 잠금 해제가 동일 parentId 재전송 때문에 거절되던 문제를 각각 RED→GREEN으로 수정했다. 관련 로그는 `t6-batch-epoch-{red,green}.log`, `t5-final-review-{red,green}.log`다. 곡선의 전 행 삭제 후 다시 추가/저장/선택, 오래된 RAF 재실행, 100프레임 동안 revision0·seek1회 commit·재개 undo0도 검사했다.

최종 명령:

```text
node --test scripts/test_character_document.cjs scripts/test_character_renderer.cjs scripts/test_character_motion.cjs scripts/test_character_export.cjs scripts/test_motion_app.cjs scripts/test_studio_state.cjs web/tests/profiles.test.cjs scripts/test_ui_state.cjs
```

**135 tests / 134 pass / 0 fail / 1 TODO, exit0**. TODO는 renderer 담당이 명시한 실제 browser pixel 수용 사례이며 통과 수에 포함하지 않았다. 소유 suite는 document14/controller19/app8이다. 기존 app/studio/profile 및 다른 소유 renderer/export suite도 위 통합 명령에서 함께 검사했다. `final-tests.log`와 소유 생산/검사 파일 7개의 `node --check` exit0 기록 `final-syntax.json`을 보존했다. 원본/최종 SHA 및 외부 renderer/exporter 소비 SHA는 `final-manifest.json`, app/studio 원본은 before/와 baseline-sha.json에 있다.

자동 저장은 명시적 v2/실제 움직임 작업만 v2로 저장한다. 단순 v1 변환 초기 장면은 활성 v2로 오인해 남기지 않으며, 확인한 reset/v1 교체는 오래된 motion 저장본을 지운다. 별도 저장소의 늦은 read는 controller generation을 대조해 새 empty v2 가져오기조차 덮지 않는다. 상단 import의 version 판별도 accessor를 실행하지 않는다. 이 accessor 회귀의 초기 실패 로그는 harness가 JSON.stringify를 먼저 하던 테스트 경계 오류였고, raw API 직접 호출로 바로잡은 `t6-accessor-green.log`가 현재 증거다.

기본 재생은 눈 깜빡임과 호흡이다. 입은 곡선 편집에서 선택해 수동/예제 키를 저장할 때 추가된다. 미지원 음성 립싱크를 주장하지 않는다. 재생 중 DOM 목록/option은 revision·source 목록이 바뀔 때만 재구성하며, source 보관은 불변 문서 참조로 asset 문자열을 공유한다. 새 프로젝트 가져오기는 이 cache를 지운다.

T9에 남은 것은 실제 built HTML/origin의 사용자 PNG·pointer/숫자 조작·모바일·PNG/ZIP 다운로드 및 실제 alpha/중간형태·30fps/입력100ms 측정이다. renderer 이음새는 독립 기술 담당의 수정/QA 경계다. 이번 검증에 사용한 renderer SHA는 `F9AEE578144A62094140BF404061F9DC9D5E021201E51E521491B5B843FE5B26`, exporter는 `62BCC6B74AEE1D5769F51DCA0F59429F930904B288E9FBD663EA16F6767CD9CE`다. 다른 소유 파일은 직접 수정하지 않았다. 후속 재현 배정 전까지 프론트 소유 코드는 이 manifest 기준으로 동결한다.

## 즉시 시연 인계 / renderer 교체 후 상태

사용자의 실제 연속 재생 시연 요청에 따라 **`work/team-resume/frontend/motion/preview-snapshot/`**에 document/controller/app/studio의 동일 바이트 스냅샷과 파일별 SHA manifest를 준비했다. README의 실제 버튼 경로와 공개 API 진입점으로 디자인 담당이 최종 HTML을 빌드하고 바로 연속 재생할 수 있다. 코드 snapshot hash는 motion `6C9F25041EFE41BD5A70811B16EFC92F146C65B46227EB1AFF6617C0154B632A`, app `B0C69AE04F02BD9F2503C19940E39D08997DA77033339D7B7AA9A52A4E6A0E57`, studio `3C64DF5B59B2617552FD946DC34821B8F8505CF4FB89C6117FA3E646064DE620`다. document 및 나머지 해시는 snapshot manifest를 따른다. 이 기록은 실제 브라우저 시연 성공을 대신하지 않는다.

root가 수집한 새 renderer `70891975DD9EE245296B7A373203F117CDB3AA65869F5E4299C039BF72C426AE`와 controller/renderer/export를 재검사했다. **controller19 pass**, 세 suite 합계39pass/1fail/1skip/1TODO, exit1(`preview-renderer-tests.log`). 실패는 **`scripts/test_character_export.cjs:295`의 매 프레임 drawImage 7회 가정**이다. 새 renderer가 그리기 단위를 바꾸므로 기능 담당이 해당 호출 probe를 재평가해야 한다. 프론트가 타 담당 테스트를 고치지 않았다. 앞의 전체134pass는 교체 전 renderer에 대한 역사적 결과이며 새 renderer 전체 통과로 해석하면 안 된다. final-manifest에 검증 renderer SHA와 교체 후 상태를 분리 기록했다.

STATE001은 독립 재현 확인 전까지 열린다. 기능 담당의 좁은 검토를 위한 enqueue target/epoch guard, 세 회귀 이름과 RED/GREEN 경로는 preview README에 고정했다. 프론트 파일은 위 snapshot으로 동결하며 추가 확인/설계/새 채팅 없이 디자인 빌드와 실제 시연을 먼저 진행할 수 있다.

## 실제 화면 시연 후 추가 수정

사용자가 이 채팅에서 실제 화면 즉시 연속 재생과 작업팀 검수 계속을 직접 요청했다. 기존 디자인/기능/QA/root 채팅에 해당 소유 작업을 이어 전달했으며 새 Codex 채팅·subagent·패키지·추론은 만들지 않았다. CUA/Node UI kernel 시작이 실패해 설치된 Aside의 정식 guide/repl 지침을 읽고 브라우저를 직접 제어했다. 8196의 실제 예제 버튼→motion→재생을 실행했고, OS의 기본 브라우저에 해당 localhost URL을 표시한 뒤 그 **실제로 활성인 사용자 탭**을 attach해 재생했다. 첫 녹화는 디자인의 `pankeki-first-motion.webm`, 현재 실제 화면은 프론트의 live-play.png 및 visible 후속 evidence다. 재생 상태 ready/playing=true, hidden=false, revision0을 실제 UI에서 확인했다. 창/탭 숨김 시 정지는 의도된 수명주기다.

실사용에서 두 프론트 원인을 추가 확인했다. 첫째, transient `default-motion`이 활성인 상태에서 pause commit이 option을 재구성하면 저장 동작 목록에 없는 ID를 select.value에 써 빈 선택이 됐다. 리그/해시는 모두 정상인데 이후 play가 잘못된 stale를 표시했다. 둘째, 빈 v1 초기 문서는 원본이 없는데 renderer에 전달해 `Explicit sourceAssetId required`가 표시됐다.

두 회귀를 먼저 RED로 확인했다(`live-followup-red.log`:2fail). 수정은 실제 option에 존재하는 현재/활성/첫 저장 ID만 선택하고, 선택이 비어 있으면 유효한 첫 저장 동작을 사용하는 것이다. 성공한 play에서만 이전 오류를 지운다. 명시적 missing ID 및 rig/hash 검증은 유지한다. 빈 초기 문서는 renderer 호출 전 준비 상태로 표시하며 ready=false다. **controller21+app8 = 29pass/fail0, exit0**(`live-followup-green.log`), 두 변경 JS 구문 exit0. 전체 suite는 요청대로 반복하지 않았다.

새 controller SHA는 **253F20F8682132AB7117F216DEA0B0225F7F37ED1013A00542DFB55B5CA10A4D**, 기준은 첫시연의6C9F2504…다. 정확한 test SHA/RED/GREEN/수명주기는 `live-followup-manifest.json`에 기록했다. 기존8196 frozen HTML6D3170… 및 preview-snapshot은 변경하지 않았다. 실제 시연 성공을 이 새 두 수정의 browser 검증으로 넓히지 않는다. root/QA/design에 별도 다음 빌드에서 두 실제 경로만 확인하도록 전달했다.

기능 담당의 최신 `state001-fixed-results.json`과 `motion-controller-contract-review.md`에서 기존6C9F2504…에 대한 **STATE001 fixed_verified**(eyeOpen1/revision0/dirtyfalse/canUndofalse)를 직접 읽었다. exporter의7회 내부 호출 가정도 소유 probe에서 위치/영역/순서/투명도를 검사하도록 수정됐고 좁은 영향2개GREEN(`affine-contract-green.log`)이다. 그 기록은 소유 담당의 독립 검증이며 프론트가 타 담당 소스/테스트를 변경하거나 전 범위 통과로 확장하지 않았다. 저장/출력 전체 T9는 QA가 계속 진행한다.

### 선택 소실의 선행 cache 원인까지 확정

추가 최소 회귀에서 loading refresh가 **이전 문서**의 default-motion 목록을 새 epoch/revision0로 cache하고, 실제 가져온 문서도 같은 epoch/revision0이어서 메뉴를 재구성하지 않는 것을 확인했다. `live-structure-red.log`는 imported-cycle을 기대한 목록에 default-motion이 남는 RED다. UI cache 비교에 불변 document identity를 추가해 새 문서 설치 때 재구성하며 RAF 중에는 여전히 재구성하지 않는다. **controller22+app8=30GREEN**, exit0(`live-followup-green.log`), controller 구문 exit0. 현재 최종 SHA는 **269BC88E4872D4E42846574AF26D772EEBAE612530D068D72705EF14E6041062**다. 앞의253F20…는 이 추가 원인 검토 전 중간 수정이다. frozen8196은 그대로이며 새 source/test SHA는 live-followup-manifest를 따른다.

QA의 독립 첫 play 유지 실패는 해당 frozen build의 실패 증거로 그대로 남기도록 전달했다. 아직 원인이 확정되지 않은 그 실패를 위 cache 원인이나 browser focus 때문이라고 단정하지 않았다. 실제 사용자 탭 표시/재생 소유는 디자인 한 담당에 모아 여러 담당의 탭 전환이 서로 시연을 끊지 않도록 요청했다. 프론트의 visible-live-play.png는 실제 active 사용자 탭에서 시작한 순간의 증거이며, 후속 visible-later-state.json은 다른 탭이 활성일 때 정지 상태를 그대로 기록한다. ‘항상 연속 재생 유지’ 통과로 확대하지 않는다.

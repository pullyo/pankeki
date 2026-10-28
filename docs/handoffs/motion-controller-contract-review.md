# v2 컨트롤러 경계 독립 검토 — 2026-10-20 KST

작성 중인 T5/T6 전체의 완료/실패 판정이 아니다. `character-motion.js`, `app.js`, `studio.js`의 요청된 네 경계만 검토했다. 생산 코드·T7 소스는 수정하지 않았으며 전체 suite/브라우저 검증은 실행하지 않았다.

검토 코드와 최소 재현은 `D:/Pankeki/work/team-resume/function/motion-controller-review/`에 보존했다. 최초 스냅샷과 `live-update/`는 과거 재현 증거다. **15:38 KST 후속 검증에서 STATE001은 프론트 최종 인계와 일치하는 최신 D 소스에서 수정 확인했다.** 현재 상태와 정확한 소비 SHA는 아래 후속 절 및 `state001-fixed-results.json`을 따른다. 기존 다른 경계의 검토는 이번 후속에서 반복하지 않았다.

## STATE001: 이전 숨김 commit이 새 문서에 적용됨 — 수정 검증 완료 (이전 P1)

위치: `web/src/character-motion.js:23`, `:73-75`, `:79`, `:101`, `:142`.

수정 전 `task()`는 호출 시 문서 세대를 고정하지 않았고 `dispatch()`의 `token=epoch`와 대상 editor/revision도 **대기열에서 실행을 시작할 때** 가져왔다. 이전 문서의 `pause → commitParameters → dispatch(setParameters)`가 기다리는 동안 `loadDocument()`가 새 editor를 설치하면, 이 commit이 새 문서의 세대를 정상 세대로 받아들인 것이 원인이었다. 최신 task는 enqueue 시 epoch/editor identity를 고정한다.

최소 재현: 이전 `setSelection`의 임시 검증을 지연 → 이전 문서 `eyeOpen=.5` 미리보기 → `visibilitychange(hidden)`로 commit을 대기열에 넣음 → 기본 eyeOpen=1인 `replacement-v2` 로드 완료 → 이전 검증 해제. 먼저 대기하던 selection은 세대 불일치로 폐기되지만 뒤의 commit은 새 문서에 적용된다. 결과는 **같은 replacement-v2의 eyeOpen 1→.5, revision 0→1, dirty false→true**다. 오류 보고는 없다.

재현은 실제 문서/렌더러/컨트롤러를 사용하고, 임시 editor의 비동기 검증 한 지점만 주입 대역으로 지연한다. 실제 UI/픽셀이나 모든 지연 조합의 성공을 주장하지 않는다. RAF 자체와 이미 시작된 export의 세대 가드가 이 편집 대기열까지 보호하지는 않는다.

## 나머지 요청 경계

- **늦은 자동 복원:** 최초 코드의 `app.js:806`은 dirty/partCount만 검사해 처음 사용자 v2를 디코드 중일 때 저장된 이전 v2가 그 가져오기를 취소했다. 수정본은 `controllerGeneration`을 비교한다(`app.js:804-808`, controller summary의 generation). 같은 재현에서 이제 사용자 가져오기가 true를 반환하고 `user-chosen-v2`를 유지한다. **최신 검토본의 미해결 문제로 전달하지 않는다.** v1 자동 복원의 비동기 import도 importRevision/editEpoch를 확인하며, restore 경로는 `replaceMotionWithLegacy()`를 호출하지 않는다.
- **상단 저장/새 작업:** `app.js:612-621`은 isMotionProject/dirty/partCount에 따라 controller.saveProject()의 v2를 다운로드한다. `hasWork()`와 `resetProject()`(`:602-604`, `:678-686`)는 dirty/부위가 있는 작업의 교체 확인 후 suspend한다. `studio.js:79-87`도 이 기존 핸들러를 호출한다. 이 경계에서 v2를 v1로 조용히 낮추거나 dirty 작업을 확인 없이 버리는 구체 반례는 확인하지 못했다. 화면·파일 대화상자의 실제 동작 검증은 미실행이다.
- **직접 RAF/export 취소:** 수정본 RAF는 playSerial을 확인하며 stop에서 증가한다. export 진행/완료는 exportSerial·문서 epoch·AbortSignal을 확인한다(`character-motion.js:68`, `:99-100`, `:115`). 이 직접 콜백 경로에서 옛 문서 결과가 다운로드되는 추가 모순은 확인하지 못했다. 위 P1은 숨김 시 파생되는 편집 commit의 별도 재현이다.
- **여러 사용자 PNG의 단계적 준비:** 두 PNG 가져오기 → 투명 배경 확인 → 선택한 두 번째 부위 createGrid는 성공한다. 그러나 `setKeyPoint()`는 선택한 부위만 편집해도 `requirePose()`로 장면 전체를 검사하므로 첫 부위의 `rig_missing` 때문에 거절된다(`character-motion.js:91-93`). 첫 부위의 grid까지 만든 뒤 같은 점 편집·saveKey는 성공한다. **grid 등록의 영구 교착은 재현되지 않았다. 모든 grid를 먼저 준비해야 key 점 편집이 가능한 순서 제약은 확인했다.** 배경 확인 전에는 같은 전체 pose 가드가 background_not_ready로 차단한다.

## 최소 재현 결과

작업 위치 `D:/Pankeki`:

```text
node work/team-resume/function/motion-controller-review/reproduce-contract.cjs
node work/team-resume/function/motion-controller-review/reproduce-contract.cjs --latest
```

두 명령 exit0. 이는 위 관찰값을 assert한 좁은 재현의 성공이며 제품 전체 통과를 뜻하지 않는다. 결과/로그는 각각 `reproduction-results.json`, `reproduction.log` 및 `live-update/`의 같은 이름이다. DOM·디코드·저장소는 제어 대역이며 새 전체 테스트나 브라우저는 실행하지 않았다. T7 파일 해시는 기존 인계의 `62bcc6…cd9ce` / `c73bd8…7af1c`와 동일하다.

## STATE001 수정 후 독립 확인 — 15:38 KST

프론트 `motion-frontend-implementation.md`의 수정 인계와 `work/team-resume/frontend/motion/final-manifest.json`을 확인했다. controller/document의 현재 D 파일이 인계 SHA와 일치한 뒤 **기존 STATE001 한 건만** 실행했다. 늦은 grid hash 수정이나 다른 완료 suite는 이번에 재검증하지 않았다.

```text
node work/team-resume/function/motion-controller-review/reproduce-contract.cjs --state001-fixed
```

**exit0, STATE001 fixed_verified.** 이번 판정은 오류를 기대하는 과거 재현의 exit0가 아니다. 지연된 이전 검증을 해제하고 숨김 commit이 있던 대기열을 끝까지 비운 다음, 새 `replacement-v2`의 **eyeOpen=1, revision=0, dirty=false, canUndo=false** 보존을 assert했다. 직렬화된 문서의 eyeOpen도1이다. 옛 명령은 false로 폐기됐으며 오류 보고는 없다. 대기열 비우기는 `play()`가 queue를 기다린 뒤 hidden 상태로 거절되는 경로를 사용해, 저장 함수로 dirty를 초기화하거나 새 자세를 변경하지 않았다.

검증 소스 SHA256:

| 파일 | SHA256 |
| --- | --- |
| `web/src/character-motion.js` | `6c9f25041efe41bd5a70811b16efc92f146c65b46227eb1aff6617c0154b632a` |
| `web/src/character-document.js` | `07c101beacf5842c11350f7276610bd6a37a7af5a314717c9a1d7b4c7ceec6ec` |
| `web/src/character-renderer.js` | `70891975dd9ee245296b7a373203f117cdb3aa65869f5e4299c039bf72c426ae` |

검증 전후 SHA는 동일하다. 증거는 리뷰 work 폴더의 `state001-fixed-results.json` / `state001-fixed.log`다. 생산 코드·T7는 변경하지 않았고 새 전체 suite/브라우저/픽셀 QA는 실행하지 않았다. 이 결과로 STATE001만 수정 확인하며 T9 전체 완료를 주장하지 않는다.

15:43 KST 추가 요청으로 **동일 STATE001 명령만** 다시 실행해 같은 소비 SHA와 보존값을 확인했다. 최신 JSON/log의 시각은15:43이며 판정은 그대로 fixed_verified다. 별도 exporter 호출 probe의 7회 고정 가정 수정은 `motion-export-implementation.md`에 인계했다. 이때 T7 생산 코드는 동일하고 소유 테스트 파일만 갱신했으며 다른 controller/app/grid suite는 실행하지 않았다.

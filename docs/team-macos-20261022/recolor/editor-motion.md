# 정밀 색상 변경 — 편집·모션 계약 검토

2026-10-23 KST · 프로젝트 `/Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki` · 근거 경로는 프로젝트 루트 기준.

## 현재 판정과 범위

정밀 색상 변경은 `mode=inpaint`의 새 후보를 만드는 CPU 작업이다. 원본/분리 소재/기존 리그를 제자리에서 덮어쓰는 기능으로 해석하면 안 된다. `recolor-sprint.md`의 API와 기존 모션 계약을 대조했으며 app/profiles/character-* 제품 파일은 수정하지 않았다.

**초기 독립 검사:** `runtime/macos/recolor-quality/editor/runs/synthetic-baseline/`에서 기존 문서·소재 경계2건 통과, 새 메타데이터 왕복4건 실패. 실패는 모두 `Unsupported request field: edit_operation`이다. 이는 프론트 통합 전 스키마를 실제 읽고 실행한 기록이며 변경 후보의 최종 실패 판정이 아니다. 합성8×8 투명 PNG의 밖 RGB/전체 alpha 오차는0이지만 실제 recolor 알고리즘 결과로 세지 않는다. 실제 산출물 검수와 통합 후 결과는 아래 후속 절에 기록한다.

**최신 판정(실 UI 저장 후):** UI job `422683208182457693da00d28936a767`의 네이티브 프로젝트 다운로드 수신 사본을 독립 검수해 **문서9/9 통과, 후보 PNG 왕복8/8 바이트·RGBA 일치**를 확인했다. **이전 P2 metrics.kind 누락은 해결 확인**했다. 프로젝트 내 색상 결과 PNG=DOM 링크 PNG=서버 PNG이며 밖 RGB/전체 alpha 오차0이다. PNG 자체의 네이티브 다운로드 도착과 색감/형태 품질 전체 수용은 이 검사에 포함하지 않는다. 아래의 이전 통합6/6·연결11/11·CPU 직접 실행3건과 실 UI 파일 증거를 구분한다.

## 깨지기 쉬운 경계와 수용 조건

| 경계 | 소스 근거와 필요한 조건 |
|---|---|
| 새 작업 메타데이터 | `web/src/profiles.js`의 `validateRequest`는 allowlist와 정규화 결과를 별도로 만든다. `edit_operation/recolor`, target HEX, nullable source HEX, tolerance0..90이 **createProject→parseProject→v1 JSON→Document.fromV1→v2 serialize/parse 모두** 유지돼야 한다. 누락된 기존 요청은 regenerate로 호환하되 새 요청이 복원 후 AI 재생성으로 바뀌면 실패다. source=null은 자동 추정 의도이며 tolerance0/90은 유효값이므로 truthy 기본값 처리로35가 되면 안 된다. |
| CPU 표시·실행 이력 | 현재 candidate.kind enum은 upload/generated이며 작업 종류는 별개다. 여기에 local_recolor를 넣으면 기존 문서 파서가 거절할 수 있다. `app.js`의 summaryMetrics allowlist와 표시 경계에서 `kind=local_recolor`, `model_calls=0`, cache off를 보존/구별해야 한다. scalar metrics에 RGB 배열 등 중첩 값을 그대로 넣지 않는다. request에는 사용자가 지정한 source_color/null을, 실제 자동 추정색·알고리즘·job 대응은 recipe/실행 증거에 남긴다. 모델/Comfy/프롬프트 유효성 가드가 CPU 요청을 막거나 이를 AI 추론으로 표시하면 실패다. |
| 원본·후보 계보 | `app.js` generate는 요청 snapshot과 sourceId를 고정한 뒤 완료 result를 새 ID/parentId 후보로 append한다. 원본 후보의 image 바이트와 기존 후보 순서/ID를 보존한다. 표시 latestId와 수정 sourceId는 다르며 보기만으로 기준이 바뀌면 안 된다. source/마스크 교체·취소 뒤 옛 완료 결과는 최신 상태에 들어오지 않아야 한다. 두 후보가 같은 CPU 픽셀이더라도 후보 ID는 별개이며 동일 PNG 자산 공유는 허용된다. |
| 선택 이력·v2 기준 | `app.js` getSourceDocument(candidateId)는 지정 후보를 마지막 edit 이력으로 전달하고 `character-document.js` fromV1은 마지막 선택을 sourceCandidateId로 사용한다. 결과 보기 뒤 원본을 다시 edit하면 v2 기준은 원본이어야 한다. 결과를 명시적으로 edit/모션 기준으로 선택하면 그 결과가 기준이어야 하며 parentId는 원본을 가리킨다. 후보 비교/view/edit 이력은 복원 후에도 유효한 후보만 참조한다. |
| RGBA·PNG 바이트 | recolor 최종 PNG 크기/좌표는 source와 동일, mask=0 RGB 오차0, **원본 전체 alpha 오차0**이 기준이다. fractional mask·투명/반투명/불투명 픽셀을 포함해 독립 디코드로 확인한다. v1 image와 v2 assets는 원본·결과 각각의 PNG 압축 바이트/asset SHA를 그대로 보존한다. CPU 색 처리로 새 결과 바이트가 바뀌는 것과 원본 자산 변조는 다르다. 같은 assetId 아래 새 PNG를 넣으면 안 된다. |
| undo·원자성 | 기존 v1 후보 생성에는 모션 editor의 undo 명령이 적용되지 않는다. 원본 후보를 다시 선택해 비교/복귀하는 동작을 ‘색상 변경 undo’ 구현으로 보고하지 않는다. v2 부위 소재를 별도 교체할 때는 addAsset+replaceMaterial을 같은 expectedRevision의 원자 batch로 처리하고 잠금을 지킨다. 성공1 revision/1 undo, 실패·stale revision 시 원문서 불변, undo 후 옛 RGBA 자산·리그 복구가 기준이다. |
| 색상 변경과 리그 stale | `character-document.js` computeRigHash는 소재 assetId·source/mask·sourceRect·메시·bindings 등을 포함한다. **형태가 같은 색상 변경도 materialAssetId가 달라지면 기존 rig는 stale**이다. 옛 preset/motion rigHashes는 보존하고 적용/재생/출력을 차단해야 한다. status/hash를 억지 갱신해 재사용하지 않는다. `character-motion.js` useSource는 새 후보 장면을 부위/리그 없이 열고 기존 후보 장면은 메모리에서 복귀시킨다. 자동 부위분할/리깅/동일성 보장으로 확대하지 않는다. |
| 저장·출력 구분 | 활성 모션의 상단 저장은 현재 v2를 저장하며 새 v1 갤러리 후보를 자동 병합하지 않는다. 실제 저장 파일의 버전·sourceCandidateId·포함 result asset을 확인한다. 후보 원본 PNG 다운로드는 result 바이트, 모션 pose PNG/48프레임 ZIP은 renderer의 결과이므로 압축 SHA 동일성을 요구할 대상이 다르다. 모션 출력은1024px/16부위와 ready pose,2초/24fps/48 PNG+manifest 계약을 유지한다. 문서 교체/취소 후 옛 다운로드0개가 기준이다. |

## 독립 회귀 도구와 실행

이 담당 전용 파일:

- `runtime/macos/recolor-quality/editor/verify-roundtrip.py`: Pillow로 실제 PNG 디코드, source/result/mask 크기, 밖 RGB/전체 alpha, 원본 불변, 저장된 PNG(v1/v2×원본/결과, legacy/recolor 두 메타데이터 그룹)의 압축 바이트·RGBA 일치를 판정한다.
- `runtime/macos/recolor-quality/editor/verify-document.cjs`: 실제 profiles/Document 모듈을 사용해 계보·명시적 기준 선택, 새 API 메타데이터4변형(null/HEX, tolerance0/35/90, red/green/black/white), 소재 교체의 stale/undo를 검사한다. PNG 크기 adapter는 Pillow의 별도 디코드 검증과 함께 사용하며 Canvas/브라우저 렌더를 대신하지 않는다.
- `runtime/macos/recolor-quality/editor/probe-candidate-metrics.cjs`: 기존 VM 입출력 대역으로 실제 app.js의 job 응답→후보→저장 metrics를 확인한다. 네트워크를 호출하지 않는다.
- `runtime/macos/recolor-quality/editor/run-component.py`: QA가 미리 만든 두 RGBA fixture와 실제 마스코트에서 제품 recolor 함수를 CPU로 직접 실행하고 위 PNG/문서 checker에 연결한다. 제품/QA 입력은 읽기 전용이며 이 담당의 components/·runs/ 아래에만 결과를 쓴다.

초기 실행(실제 실행, exit1):

```sh
.venv-macos/bin/python -B runtime/macos/recolor-quality/editor/verify-roundtrip.py --fixture --label synthetic-baseline
```

PNG 확인을 기존 스키마와 새 스키마로 분리한 후 `--fixture --label synthetic-png-baseline`으로 실행했다. **exit1 /문서2통과·4실패**, 새 필드 거절은 동일하며 legacy v1/v2의 원본·결과4개 PNG는 압축 바이트와 전체 RGBA가 각각 일치했다. 실제 투명 픽셀 alpha0/32/64/128/191/224/254/255를 가진 합성 입력이다. 실제 알고리즘의 색상·형태 보존 판정은 아니다.

기존 source 선택/저장/모션 stale/지연 출력 회귀는 다음 명령을 이번에 실행해 **7 tests /7 pass /0 fail /0 skip /0 TODO, exit0**를 확인했다. 기존 검사에 Canvas·DOM·디코더 대역이 포함되므로 실제 파일 도착·픽셀 출력 성공으로 확대하지 않는다.

```sh
/Users/plant313/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --test-reporter=spec \
  --test-name-pattern='^(motion_source_provider_uses_current_edit_source_not_latest_view|top_save_uses_v2_without_downgrading_legacy_export|source_swap_starts_unrigged_scene_and_can_restore_prior_preparation|queued_hidden_pose_commit_is_discarded_when_document_is_replaced|export_uses_same_renderer_and_late_cancel_never_downloads|blocked geometry and a stale motion rig hash cannot be exported|production renderer blocked reasons and missing assets stop output before draw or encoding)$' \
  scripts/test_motion_app.cjs scripts/test_character_motion.cjs scripts/test_character_export.cjs
```

실제 결과가 준비되면 같은 checker에 `--source ORIGINAL.png --result RESULT.png --mask MASK.png --target-color '#RRGGBB' --source-color '#RRGGBB' --color-tolerance 35 --label 고유이름`을 전달한다. 자동 원래색이면 source-color를 생략한다. source/result/mask는 읽기 전용이며 JSON/로그/문서 왕복 파일은 이 담당의 runs/ 아래에만 쓴다. 합성 fixture 경로와 실제 결과 경로를 섞어 성공으로 세지 않는다.

## 초기 프론트 통합 검사와 P2 이력

- **통합 후 문서6/6 통과, exit0:** `--fixture --label synthetic-integrated` 결과는 `runs/synthetic-integrated/{document-checks,verification}.json`에 있다. 신규4변형의 CPU 요청 메타데이터가 v1/v2에서 유지됐고, legacy/recolor 두 그룹의 원본·결과 PNG8건은 압축 바이트/전체 RGBA가 일치했다. `character-*` 네 파일은 초기 기준과 같은 SHA다. 이 검사는 합성 투명 PNG를 통한 저장 경계 수용이며 실제 색상 알고리즘 수용이 아니다.
- **동일 최소 CPU 요청의 고정 이전본 대조:** 초기 fixture의 AI prompt 필드를 제거해 현재 CPU 요청 형식에 맞춘 뒤, 같은 checker를 `--fixture --label synthetic-frozen-before --product-root runtime/macos/recolor-quality/integration/before`로 실행했다. 이전본은 다시2통과/4실패(edit_operation 거절), 기존 PNG4건 보존이다. 현재본과 비교할 수 있는 동일 필드/동일 PNG 바이트의 RED 근거이며 이전본은 수정하지 않았다.
- **현재 앱과 모션 연결11/11 통과, exit0:** 위7개 기존 경계에 `scripts/test_recolor_ui.cjs`의 `recolor roundtrip keeps metadata and image download and restores color controls`, `recolor metadata survives conversion to a v2 document without an inferred model`, `recolor defaults nullable source and tolerance in saved metadata while explicit regenerate remains valid`, `cancel before CPU POST acceptance drops the late result and uses color-specific feedback` 네 이름을 더해 선택 실행했다. source/parent·정규화/복원·다운로드 href·취소를 VM 대역에서 확인했다. 실제 API/파일 도착 성공은 아니다.
- 프론트의 추가 변경 이후 같은11건을 최종 소스에서 다시 실행해11/11 통과했다. 정확한 명령·선택 이름·소비 SHA는 `runtime/macos/recolor-quality/editor/existing-boundaries-final.json`, 원문 출력은 `.log`에 있다. 제품6파일+테스트4파일의 실행 전후 SHA는 모두 동일했다. 이전 통과를 수정 후 결과로 재사용하지 않았다.
- **당시 P2 관찰: CPU kind의 프로젝트 metrics 누락.** `probe-candidate-metrics.cjs ui-metadata-before`는 실제 app.js를 기존 VM 대역으로 실행하고 job 응답에 `kind=local_recolor,model_calls=0,cache=off`를 전달했다. 생성·원본 보존·parent/operation·색상 변경 레이블·model_calls0/cache off는 정상이나 저장 후보의 metrics.kind는 누락됐다(**exit1**, `runs/ui-metadata-before/candidate-metadata-probe.json`). 원인은 당시 `app.js` summaryMetrics allowlist에 kind가 없던 경계였다. request.edit_operation으로 CPU 작업은 식별돼 화면의 AI 오표시로 판정하지 않았다. 이 담당은 제품 수정 없이 인계했다.
- 당시 추가 앱 스냅샷의 `probe-candidate-metrics.cjs ui-metadata-final`도 같은 실패(**exit1**)였다. `runs/ui-metadata-final/candidate-metadata-probe.json`은 역사 증거이며11건 통과로 이 실패를 상쇄하지 않았다. **현재 해결 판정은 아래의 새로운 실 UI 파일과 fixed probe 근거를 따른다.**

## 실제 CPU 결과의 PNG·문서 검수

제품 모듈이 초기 copy-only stub에서 실제 구현으로 교체된 뒤, 다음 명령을 실행했다. 이는 **함수 직접 호출**이며 엔진/jobs API나 브라우저를 실행한 것이 아니다.

```sh
.venv-macos/bin/python -B runtime/macos/recolor-quality/editor/run-component.py --label direct-cpu-v1
```

알고리즘 `oklab-recolor-v1`, `pankeki/recolor.py` SHA-256 `ba8f7874fbfef670c40b1f55b49df3e2ceab47b65715c91eaafbe85209631c9a`를 소비했다. 실행 전후 모듈과 입력 원본/마스크 해시는 동일했다. target `#E3342F`, tolerance35, feather4이며 source는 앞2건 `#2864C8`, 마스코트는 자동(null)이다.

| 실제 함수 출력 / 입력 종류 | 크기 / 원본 alpha | 밖 RGB / 전체 alpha 최대오차 | v1/v2 PNG 왕복 / 문서 검사 |
|---|---|---|---|
| red-rgba / QA 합성 RGBA | 96×64 /0,64,128,255 | 0 /0 | 8/8 바이트·RGBA 일치 /6/6 통과 |
| fractional-red-rgba / 같은 입력+중간값 마스크 | 96×64 /0,64,128,255 | 0 /0 | 8/8 일치 /6/6 통과 |
| mascot-red / 실제 마스코트 PNG | 1024×1024 /255 | 0 /0 | 8/8 일치 /6/6 통과 |

세 결과 모두 원본과 다른 RGB 픽셀이 존재함을 확인했으며, 그 수만으로 색상 품질 합격을 표시하지 않는다. source/result의8회 비교는 legacy/recolor 메타데이터2그룹×v1/v2×원본/결과의 저장 PNG 검사 수다. 마스코트는 불투명 입력이므로 비균일 투명도 수용 근거는 앞2건이다.

출력·알고리즘 매개변수/통계·입력 불변·재현 명령의 근거는 `runtime/macos/recolor-quality/editor/components/direct-cpu-v1/verification.json`과 PNG, 각 `runs/direct-cpu-v1-{red-rgba,fractional-red-rgba,mascot-red}/{document-checks,verification}.json`이다. 예제이거나 합성 입력인 사실과 실제 CPU 알고리즘을 실행한 사실을 구분한다. 실제 HTTP job ID·recipe·Comfy 연결·브라우저 파일 도착은 이 실행에 없다.

## 실 UI job·네이티브 저장 프로젝트의 독립 검수

새 근거는 총괄이 실제 브라우저에서 수신 후 복사한 `runtime/macos/recolor-quality/integration/ui-saved-project.json`(v1,6,679,192bytes, SHA-256 `8bdca99db8acf173158bb06d926f057d5a044a11564b8e6fc261632c27f6ff19`), `ui-dom-link-result.png`, `ui-api-run.json`, `ui-pixel-proof.json`이다. 이 담당은 네이티브 저장 동작을 재실행하지 않고 **실제 수신 사본의 내용**을 독립 검사했다. 기존 job 디렉터리의 original/mask/result PNG와 recipe/metrics도 읽기만 했다.

```sh
.venv-macos/bin/python -B runtime/macos/recolor-quality/editor/verify-ui-project.py
/Users/plant313/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node runtime/macos/recolor-quality/editor/probe-candidate-metrics.cjs ui-metadata-native-fixed
```

두 명령 모두 **exit0**. Node 문서 검사 **9/9**, Pillow 후보 PNG 왕복 검사 **8/8**을 통과했다. 새 파일 `verify-ui-project.{py,cjs}`는 실제 수신 프로젝트를 그대로 파싱하며 이전의 합성2후보 생성기를 사용하지 않는다.

| 실 UI 파일의 계약 | 독립 확인 |
|---|---|
| 후보·parent | 실제 후보4개, recolor1개, 원본 업로드2개. recolor ID `36c36a47-5ec8-4362-a8cb-9a1525b2b2a9`의 parent는 두 번째 업로드 `7b010a56-eb50-4a41-b005-4194d4833867`이며 해당 PNG가 job original과 바이트 동일하다. 이전 AI 후보와 두 원본을 모두 보존했다. |
| request·CPU metrics | mode=inpaint, edit_operation=recolor, target=#E3342F, source=null, tolerance35, feather4를 v1→v2→직렬화/재가져오기에서 그대로 유지. **kind=local_recolor, model_calls=0, cache=off**, total_s=`0.25464891600131523`, skipped=null도 보존됐다. CPU 후보에 모델/프롬프트/seed를 새로 추정해 넣지 않았다. |
| 실제 이력·v2 기본 선택 | 수신 파일의 selectionHistory는 **빈 배열**이며 그대로 보존됐다. 따라서 v1→v2의 기존 마지막 후보 fallback에 따라 sourceCandidateId는 recolor ID다. 이 사실을 실제 UI에서 edit 이력을 기록했다는 증거로 해석하지 않는다. 별도 제어 사본에 original/recolor edit 이력을 각각 추가한 소스 선택 계약 검사도 통과했지만 실제 UI 이력과 구분한다. |
| 중복 자산 | 후보4개를 보존하면서 v2 자산은3개다. 두 원본 업로드의 PNG 바이트가 같아 assetId를 공유하며 후보 ID·parent 계보는 유지한다. v2 canvas는 실제 PNG 크기1024×1024, parts/rigs는 비어 있어 자동 리깅/부위 이전을 만들지 않았다. |
| PNG 삼자 동등성 | recolor 후보의 저장 image 바이트=완전한 DOM 링크 PNG=job result.png. 공통 SHA-256 `7847ebc19802f5fabb298f7964670c09fc0f16cacbcc0e6a1f97243ac4551854`. original SHA `604aa7ebad79be9f27d6d8bd47c8e98362a53f6bf376c9e1e84c00842d0c1819`, mask SHA `7d105beccbe26749dab199cd50b85b89c4ba073e2a6cecadc535713689662481`도 recipe/API 요약과 독립 일치한다. |
| 픽셀·파일 불변 | 독립 재디코드 결과 밖 RGB 최대오차0/전체 alpha 최대오차0, 변경 내부63,761픽셀. 이 마스코트 원본은 alpha255이므로 비균일 알파 증거는 이전 직접 CPU RGBA2건을 따른다. 후보4개×v1/v2 총8 PNG 모두 압축 바이트·전체 RGBA 일치. 원본 증거/제품 파서 모듈의 실행 전후 SHA 변동0이다. |
| P2 해결 | 실제 저장 파일과 새 VM probe 모두 metrics.kind를 보존한다. 현재 summaryMetrics allowlist에도 kind가 있다. `runs/ui-metadata-native-fixed/candidate-metadata-probe.json`은 이전 실패 조건을 통과한 새로운 근거다. |

전체 근거는 `runtime/macos/recolor-quality/editor/runs/native-ui-422683208182457693da00d28936a767/`의 `verification.json`, `document-checks.json`, `document.log`, 왕복 v1/v2 JSON이다. **프로젝트 네이티브 다운로드 수신 성공**(총괄 제공 사본)과 **PNG 링크 payload 동등성**을 별도 수용한다. PNG 자체의 네이티브 다운로드 도착은 제공 근거에서 아직 확정하지 않으며 Blob 호환 보정의 실제 수신 검증은 총괄 범위다. 이 담당은 추가 API·브라우저·서버 동작을 실행하지 않았다.

## 최종 인계와 변경 파일

이 담당 범위의 계약 검토·문서/투명 PNG 및 실제 UI 저장 사본 검수는 완료했다. P2는 해결 확인했다. 총괄은 PNG 네이티브 수신·실제 취소·색감/선/주름·주변 색 보존을 QA/UX 근거와 합쳐 수용한다. 후보 원본 PNG와 모션 pose 출력의 의미, 활성 v2 저장의 갤러리 자동 병합 부재도 함께 확인한다.

변경 범위는 `docs/team-macos-20261022/recolor/editor-motion.md`, `runtime/macos/recolor-quality/editor/`의 독립 검사6개와 자기 증거뿐이다. app.js/profiles.js 및 제품 코드를 수정하지 않았다. GPU/API/브라우저/서버 재시작·다른 팀 파일·다른 채팅 메시지·추가 채팅/하위 에이전트는 사용하지 않았다.

# 부분 수정 변경 수용 — 편집·모션 경계

2026-10-22 KST · 편집·모션 담당 · 범위: `quality-sprint.md`의 inpaint 기능 보존 계약. 아래 경로·행은 `/Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki` 기준이다.

**판정:** 현재 경계에 직접 해당하는 기존 단위 테스트15건은 이번 실행에서 통과했다. 부분 수정 개선 후보의 실제 픽셀·이미지 품질 수용은 아직 수행하지 않았다. 이 담당은 이 인계 파일만 작성하며 제품 코드·공유 브라우저·GPU·앱 프로세스를 변경하지 않는다.

## 현재 연결과 적용 방식

1. `web/src/app.js:417`의 요청 snapshot은 현재 `sourceDataURL`과 마스크 PNG를 고정한다. `generate():467`은 당시 `sourceId`를 parentId로 고정하고, 성공한 실제 result의 이미지를 읽고 디코드한 뒤 **새 후보 ID로 추가**한다. 원본 후보의 image를 교체하지 않는다. 여러 후보도 같은 원본·마스크에서 출발한다.
2. 결과 보기(`app.js:513`)는 latestId/latestUrl 등 표시 상태를 바꾸며 source를 교체하지 않는다. **보기와 수정 원본 선택은 별도다.** ‘이어서 수정’(`app.js:523`)이 해당 후보를 source로 로드하고 edit 선택 이력을 남긴다. 모션의 `getSourceDocument(candidateId)`(`app.js:798`)도 지정 후보를 마지막 edit 이력으로 넣어 전달한다.
3. `web/src/character-document.js:158`의 v1→v2 변환은 후보 이미지의 실제 인코딩 바이트 SHA-256을 assetId로 삼고 원래 data URL·후보 ID·parentId·선택 이력을 보존한다. 마지막 선택 후보가 sourceCandidateId가 된다. 바이트가 같은 후보들은 자산을 공유할 수 있으므로 **새 후보 ID와 새 assetId를 같은 의미로 취급하지 않는다.**
4. `web/src/character-motion.js:116`의 명시적 `useSource`는 새 후보에 대해 기존 장면을 메모리 보관하고, 새 장면의 parts/rigs/presets/motions를 비워 준비 전 상태로 연다. 이전 후보로 돌아가면 보관 장면을 되찾는다. 완성 inpaint PNG를 자동 분할하거나 기존 리그의 새 소재로 자동 반영하는 경로가 아니다.
5. 준비된 문서는 동일 renderer를 통해 pose PNG/48프레임 ZIP으로 출력한다. `character-export.js:47`은 문서 snapshot, `:64`는 동작 snapshot을 사용하고, `:103`에서 blocked pose를 거절한다. 컨트롤러 `runExport():125`는 문서 세대·출력 serial·취소 상태를 확인한 뒤에만 다운로드한다.

**저장 경계:** 활성 모션이 있으면 상단 저장(`app.js:612`)은 그 v2 문서를 저장한다. 별도 v1 갤러리에 새로 생성된 후보가 활성 v2에 자동 병합되는 계약은 없다. ‘수정 결과를 저장했다/모션에 적용했다’는 검수는 파일 버전·sourceCandidateId·포함 자산을 직접 대조해야 한다. 신규 갤러리 결과와 기존 모션 양쪽이 한 파일에 담겼다고 가정하지 않는다.

## 개선 후보 통합 시 필수 체크리스트

| 경계 | 깨지면 안 되는 조건 / 수용 증거 |
|---|---|
| 원본과 결과 | 원본 후보 ID·image 바이트/기존 v2 자산은 불변. 결과는 올바른 parentId를 가진 새 후보이고 완료된 result만 추가한다. 화면용 canvas 재인코딩·리사이즈를 저장 이미지로 대신 사용하지 않는다. 실패·취소·옛 요청 완료는 최신 source/후보를 덮어쓰지 않아야 한다. 근거: `app.js:322,344,475,485` 및 이번 UI 경계 테스트. |
| RGB·알파·크기 | 원본과 최종 결과의 크기가 같고, **원래 마스크가0인 모든 픽셀의 RGB 최대오차0, RGBA 원본의 알파는 마스크 안팎 모두 최대오차0**이어야 한다. feather/halo는 허용 영역을 넓혀 원본 밖을 바꿀 근거가 아니다. 실제 결과 PNG를 독립 디코드해 비교하고 metadata의0만으로 판정하지 않는다. `pankeki/engine.py:252,323`은 원본 알파를 복구하고 `:333`은 밖 RGB를 검사하지만 이 RGB 검사 자체는 알파 검증이 아니다. |
| 자산 바이트·식별 | v1 저장→v2 변환→직렬화/재가져오기에서 원본·결과 각각의 data/바이너리 SHA·크기를 보존한다. 새 이미지 바이트를 기존 `sha256:...` ID 아래 덮어쓰지 않는다. backend `original.png`는 엔진이 정규화해 재인코딩하므로 업로드 파일과 압축 바이트 동일성을 요구하는 대상이 아니다. 픽셀 보존과 문서의 원본 바이트 보존을 따로 검사한다. |
| 요청·재현 이력 | 후보의 request는 source/mask 바이트를 저장하지 않는 정규화된 메타데이터다(`profiles.js:167`). 재현용 original/mask·실제 prompt/seed·recipe/workflow/job ID는 실행 산출물과 대응시킨다(`engine.py:260`). 문서에 미지원 필드를 넣거나 추론/캐시/빈 마스크 복사를 같은 성공으로 표시하지 않는다. |
| 문서 revision·원자성 | 수정 결과 도착만으로 활성 v2의 source/parts/rigs를 조용히 교체하지 않는다. 실제 편집은 `expectedRevision`을 검사하는 원자 명령으로 적용하며 거절 시 문서·revision이 그대로여야 한다. 성공 편집/undo/redo의 revision은 해당 editor 내에서 증가한다. 새 editor 로드 후 revision0은 정상이다. 옛 문서의 지연 commit·디코드·출력이 새 문서에 유입되면 실패다(`character-document.js:229`, `character-motion.js:23,80`). |
| 소재 교체·stale 리그 | 기존 부위 소재를 바꾸는 별도 작업이 있다면 새 PNG 자산을 추가하고 잠금·소스를 검사하는 `replaceMaterial`을 사용한다. materialAssetId/source/키폼 등 해시 입력이 달라지면 리그는 stale이며 옛 preset/motion의 rigHashes를 그대로 보존해 적용을 차단한다. hash/status를 강제로 ready로 바꿔 통과시키지 않는다. 리그 재등록 후에만 새 계약을 사용한다(`character-document.js:114,147,207`). |
| 모션·출력 | 새 후보는 분리 소재/배경/리그 준비 전 재생·출력 차단, 이전 후보의 준비 장면은 명시적 복귀 시 보존. stale·source mismatch·배경 미확인 결과를 출력하지 않는다. 준비된 장면의 PNG 및2초/24fps ZIP 계약(48 PNG+manifest, k/24)은 유지한다. Canvas 출력 PNG의 압축 SHA를 자산 SHA와 같다고 요구하지 말고 동일 pose의 디코드 RGBA로 판정한다. 출력 중 문서 교체/취소 후 옛 완성 파일0개가 기준이다. |

## 이번에 실행한 좁은 회귀 검사

설치·다운로드 없이 Codex 번들 Node를 사용했다. 다음 명령은 기존5개 테스트 파일 중 아래15개 이름만 선택한다. 출력 fixture 파일을 쓰는 `archive_has_48_frames_and_exact_sample_times`와 실제 브라우저 픽셀 suite는 실행하지 않았다.

```sh
/Users/plant313/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --test-reporter=spec \
  --test-name-pattern='^(two candidates run sequentially from the same original image and mask|generation captures immutable brief and parent metadata before asynchronous work|gallery comparison and editing retain original images and persist selection history|v2_round_trip_and_v1_bytes_preserved|v1_conversion_keeps_candidate_lineage_and_unknown_provenance|material_and_keyform_replacement_invalidate_dependents_in_one_undo|locked_or_referenced_parts_and_stale_revisions_cannot_mutate|preset_hashes_fail_after_material_change_and_source_switch_preserves_old_scene|source_swap_starts_unrigged_scene_and_can_restore_prior_preparation|queued_hidden_pose_commit_is_discarded_when_document_is_replaced|top_save_uses_v2_without_downgrading_legacy_export|motion_source_provider_uses_current_edit_source_not_latest_view|caller edits during progress cannot change the captured document or motion|blocked geometry and a stale motion rig hash cannot be exported|production renderer blocked reasons and missing assets stop output before draw or encoding)$' \
  scripts/test_ui_state.cjs scripts/test_character_document.cjs scripts/test_character_motion.cjs scripts/test_motion_app.cjs scripts/test_character_export.cjs
```

결과: **exit0 /15 tests /15 pass /0 fail /0 skipped /0 TODO**. 후보 요청 snapshot·parent/원본/선택 이력, v1/v2 바이트·계보, revision/잠금·stale 무효화/undo, source 전환, 옛 숨김 commit 폐기, 상단 v2 저장, 출력 snapshot·차단 사유 전파가 통과했다. DOM·디코더·시계·Canvas/인코딩 대역을 포함한 계약 검사이며 실제 추론·품질·브라우저 알파/다운로드 증거는 아니다.

검사 전후 app.js/profiles.js/studio.js/character-* 7개 제품 JS와 위5개 테스트 파일, 총12개 SHA-256은 모두 동일했다. 코어 기준 SHA:

| 파일 | SHA-256 |
|---|---|
| character-document.js | `07c101beacf5842c11350f7276610bd6a37a7af5a314717c9a1d7b4c7ceec6ec` |
| character-renderer.js | `70891975dd9ee245296b7a373203f117cdb3aa65869f5e4299c039bf72c426ae` |
| character-motion.js | `269bc88e4872d4e42846574af26d772eebae612530d068d72705ef14e6041062` |
| character-export.js | `62bcc6b74aee1d5769f51dca0f59429f930904b288e9fbd663ea16f6767cd9ce` |

## 총괄·QA 인계

실제 baseline/개선 결과가 준비되면 같은 source/mask/seed의 최종 PNG에서 RGB·알파를 독립 비교하고, 원본→수정 후보의 ID/parent/bytes→명시적 모션 source 선택→v2 저장 자산을 추적한다. 현재15건 통과를 개선 후보 적용 후의 픽셀 품질이나 사용자 PNG 모션 전체 수용으로 확대하지 않는다. 활성 v2와 신규 갤러리 결과의 저장 구분, 변경 소재의 stale 차단이 통합 시 우선 확인점이다.

이 담당의 변경 파일: `docs/team-macos-20261022/quality/editor-motion.md`만. 다른 팀 파일·제품 코드·빌드·서버·공유 브라우저·GPU·외부 게시·다른 채팅 메시지·추가 채팅/하위 에이전트 생성은 수행하지 않았다.

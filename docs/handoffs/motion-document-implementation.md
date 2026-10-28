# Motion document implementation

2026-10-20 KST · **T1/T3 및 T5/T6 코드·Node 검증 완료.** 문서 모듈 실제 Node 테스트 14/14, exit0이며 browser 픽셀/GPU 결과가 아니다. T5/T6 통합 인계는 `motion-frontend-implementation.md`를 따른다.

## 전달 API

`web/src/character-document.js`는 브라우저 `PankekiDocument`와 CommonJS를 제공한다. `parseDocument(raw,{decodeAsset}={}) → Promise<DocumentV2>`, `fromV1(raw,options) → Promise<DocumentV2>`, `serializeDocument(doc) → Promise<string>`, `computeRigHash(part,rig,assets) → Promise<string>`가 구현됐다. decodeAsset은 asset 객체를 받아 Image 또는 실제 `{width,height}`를 반환한다. browser 기본은 실제 Image.decode이며 Node에서는 주입 decoder를 쓴다. 파일 바이트 signature·SHA·PNG 헤더 크기·모든 상한 검사는 decoder와 별도로 항상 수행한다. serialize는 해당 hash의 검증된 크기 metadata를 재사용하며 새 미검증 바이트는 기본 decoder를 요구한다.

v2 strict schema, 64MiB JSON/asset16MiB/16MP/64assets/RGBA128MiB/16parts, 계보·참조·UV/삼각형·neutral key·2초24fps/최대32곡선키를 검사한다. 이전 hash 또는 source 불일치 rig는 stale로 읽고 이전 hash/소재/프리셋을 보존한다. v1은 기존 profiles.js 공개 parseProject로 검증하고 바이트·후보 계보·선택 기록을 유지하며 변환한다. 기존 profiles.js는 변경하지 않았다.

## 변경 및 검증

- 신규 `web/src/character-document.js`, `scripts/test_character_document.cjs`. 기준 SHA는 absent, T1 최종 SHA는 `work/team-resume/frontend/motion/t1-final-sha.json`에 보존했다.
- `node --test scripts/test_character_document.cjs`: 최초 API 부재 6실패 → 6통과, PNG 헤더/decoder 거짓 크기 경계 추가 1실패 → **7/7 통과**. `t1-red.log`, `t1-header-red.log`, `t1-final.log`.
- fixture/기존 테스트/HTML/CSS/build/backend 수정 없음. 앱 연결·실제 renderer/프레임 출력은 아직 완료 결과가 아니다.

다음 T3는 이 API 위에 원자 명령/실행 중 undo 50단계·patch32MiB를 추가한다. 기술 담당은 기존 fixture와 이 모듈의 normalize된 rig.status/parts를 소비하며 렌더러 수학은 별도 소유한다. 이후 T5/T6 연결과 최종 해시·검증은 같은 문서에 추가한다.

## T3 통과 API

`createEditor(parsedDoc,{historyLimit=50,maxHistoryBytes=33554432,decodeAsset}={})`를 추가했다. 초기 문서는 parseDocument/fromV1의 반환값이어야 한다. `snapshot()`은 불변 document/revision/canUndo/canRedo/undoCount/redoCount/historyBytes, `dispatch({type,args,expectedRevision})`, `undo()/redo()`는 Promise snapshot이다. 승인된 11개 명령 allowlist를 구현했고 위험 필드·잠금·부모/프리셋 참조 제거·stale revision/소스는 거절한다. 소재/키폼 변경과 관련 rig stale는 한 undo로 복원한다. 프리셋/동작은 이전 hash를 보존해 현재 ready hash와 다르면 적용 불가다.

스냅샷은 불변 자산 문자열/이전 문서 참조를 공유한다. inverse 변경 metadata의 UTF-8 크기로 patch budget을 계산하고 asset bytes는 hash 참조로 계상하며 문서 자산 상한도 검사한다. 새 commit은 redo를 비우고 50개/32MiB 초과 시 오래된 undo만 정리한다. 이력은 serialize에 포함되지 않는다. dispatch와 undo/redo를 직렬화해 대기 중 이전 redo 배열을 캡처하는 경쟁도 차단했다.

`node --test scripts/test_character_document.cjs`: T3 5개 RED→12 GREEN, queued undo 경쟁 RED→**13 GREEN**. 명령 원자성·단조 revision·복구·이력 상한·background 확인·투명 분리 장면 포함. `t3-final.log`, `t3-final-sha.json`. 현재 파라미터의 복합 pose 검사는 별도 렌더러의 evaluatePose를 T5 controller가 commit 전에 호출한다. 프로젝트/기준 원본 교체는 T5 loadDocument 경계이며 승인 목록 밖 source 명령을 임의 추가하지 않았다.

## T5 연결 후 문서 경계 보완

다중 PNG의 asset/part/selection을 한 번에 확정하기 위해 `dispatchBatch(commands)`를 추가했다. 기존 승인 명령 종류만 사용하며 전체 검증 후 revision1/undo1이다. 배치 중 하나가 실패하면 전체가 바뀌지 않는다. UI에서 입력한 프리셋/동작 이름을 보존하도록 선택적 `label`(최대80자)을 v2 preset/motion에 허용했다. ID와 rigHash tuple은 그대로다. 동일 asset 재등록은 객체 속성 순서와 관계없이 id/mime/data/width/height가 모두 같으면 중복 저장하지 않는다. 서로 다른 바이트나 메타데이터는 거절한다.

batch 원자성/이름 보존 RED→GREEN 포함 **14/14**. 초기 T1/T3 해시는 당시 단계 기록이며 현재 최종 해시는 `work/team-resume/frontend/motion/final-manifest.json`이다. 최종 전체 Node 검사는 **134 pass / 0 fail / 1 browser pixel TODO**, exit0(`final-tests.log`). profiles.js는 기준 SHA와 같으며 v1 공개 API와 원본 바이트 보존 회귀를 유지했다.

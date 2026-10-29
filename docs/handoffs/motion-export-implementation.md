# T7 움직임 출력 모듈 구현 인계 — 2026-10-20 KST

**T7 코드 구현 완료. 최신 renderer70891975 교체 후 영향받는 연결 검사 2개가 통과했다. exporter 생산 소스는 유지하고 호출 probe만 수정했다.** 아래 최초 11/13개·통합21개 결과는 당시 소비 SHA에 대한 기록이다. 최신 renderer로 전체 suite를 반복 실행하지 않았다. 실제 브라우저/캐릭터 픽셀·UI 통합은 T9 QA 대상이다. 승인된 `2026-10-20-motion-first-implementation.md`와 설계를 따라 진행했다. 새 하위 에이전트·worktree·저장소·패키지·모델·GPU 추론은 만들지 않았다. 서버·SDK·Codex·다른 담당 파일·백업은 수정하지 않았다.

## 실제 변경과 SHA256

두 생산/테스트 파일 모두 착수 시 **없던 신규 파일**로 기준 SHA는 null이다. Git 없는 작업 지시에 따라 git helper/commit 대신 이 해시와 `work/team-resume/function/motion-export/change-record.json`을 기록했다.

| 파일 | 최종 SHA256 |
| --- | --- |
| `web/src/character-export.js` | `62bcc6b74aee1d5769f51dca0f59429f930904b288e9fbd663ea16f6767cd9ce` |
| `scripts/test_character_export.cjs` | `1e62d5f23f50fd05f6b1c1a79c0f9878c7e5900f254f80b2c1ae13600a94989d` |

추가 산출물은 이 인계서와 위 work 폴더의 RED/GREEN 로그·변경 기록·`numeric-fixture.zip`·독립 검사 JSON/로그다. fixture 원본은 읽기 전용으로 사용했다.

## 연결 I/O

UMD/CommonJS의 `PankekiExport`는 로드만으로 DOM·렌더·다운로드 작업을 하지 않는다. 공개 API는 다음 두 개다.

```js
await PankekiExport.exportFrames({
  document, motion, renderer, decodedAssets,
  signal, onProgress, canvasFactory
}); // Blob: application/zip
await PankekiExport.exportPosePng({
  document, values, renderer, decodedAssets, canvasFactory
}); // Blob: image/png
```

- document는 파싱/검증된 v2, motion은 duration2/fps24/curves/rigHashes를 가진 동작이다. 시작 시 문서·동작을 JSON snapshot으로 고정하고 원문서·현재 파라미터·재생값을 수정하지 않는다. sourceCandidateId로 현재 sourceAssetId를 찾아 renderer 입력에 넣는다.
- renderer는 계획의 `sampleMotion(motion,t,{loop:true})`, `evaluatePose(scene,values)`, `drawPose(canvas,pose,decodedAssets)`를 제공한다. scene은 `{canvas,sourceAssetId,backgroundAssetId,parts,rigs,parameters}`다. 곡선 없는 파라미터는 문서의 현재값을 유지한다. blockedParts가 있으면 code=`blocked_pose`, blockedParts 목록을 가진 오류로 출력에 실패한다. drawPose는 `{width,height,drawnPartIds}`를 반환해야 한다.
- decodedAssets는 assetId→디코드 이미지 Map이다. renderer의 실제 픽셀 렌더·소재/UV 검증은 renderer 담당 경계이며 exporter가 대체하지 않는다. motion rigHash가 현재 ready 리그에 없으면 거절한다.
- `canvasFactory(width,height)`는 **새 임시 캔버스**를 반환한다. 기본은 browser canvas, 없는 경우 OffscreenCanvas다. toBlob 또는 convertToBlob의 PNG 인코딩을 사용하고 종료 시 임시 캔버스를 0×0으로 정리한다.
- `onProgress({completed,total:48,time,file,bytes})`의 bytes는 검증된 누적 PNG 바이트다. 프레임 진행률이며 아카이브 완료 신호가 아니다. Blob 반환 성공 후에만 프론트가 URL 생성·다운로드·revoke를 담당한다.

## 파일 형식·취소·상한

ZIP STORE에는 `frame-0000.png`…`frame-0047.png`와 `manifest.json` 총49개가 들어간다. 시간은 **k/24, k=0..47**이다. manifest는 `{version:1,width,height,duration:2,fps:24,frameCount:48,rigHashes,frames:[{file,time}]}`다. rigHashes는 실제 draw에 대응하는 ready 리그 해시의 중복 없는 정렬 목록이다. ZIP 중앙 목록·로컬 헤더·CRC32를 기록하며 재현 가능한 고정 DOS 날짜를 쓴다.

PNG signature/IHDR 크기·chunk 경계/CRC·IDAT/IEND 존재를 검증한 뒤 저장한다. PNG 바이트 합계 **128MiB 이하**만 허용하며 Blob 크기를 먼저 확인해 초과 프레임의 arrayBuffer를 읽지 않는다. 이 상한은 ZIP 헤더/manifest 및 브라우저 전체 메모리 상한과 다르다.

AbortSignal을 시작·프레임·인코딩 대기·패키징 경계에서 확인한다. 취소는 AbortError, 인코딩 null·잘못된 PNG/크기·stale/blocked pose·렌더러 오류·상한 초과는 rejection이다. 실패/취소 시 완성 ZIP을 반환하거나 다운로드하지 않으며 임시 참조를 정리한다. 네이티브 PNG 인코더 자체가 즉시 멈춘다고 보장하지 않고, 늦은 콜백은 결과로 채택하지 않는다.

프론트는 프로젝트/reset/import/소재 전환 시 해당 AbortController를 중단하고, 완료 Blob을 사용할 때 현재 문서 token/revision도 대조해야 한다. snapshot 출력이 새 프로젝트에 자동으로 연결되는 기능은 없다.

## RED/GREEN 및 검증 결과

작업 위치 `D:/Pankeki`. 로그 위치는 `work/team-resume/function/motion-export/`다.

| 명령/검사 | 실제 결과 |
| --- | --- |
| `node --test scripts/test_character_export.cjs` 최초 | API 부재로 **11개 실패**, exit1 (`red.log`) |
| 같은 명령, 최초 구현 후 | **11개 통과**, exit0 (`green-initial.log`) |
| `node --test --test-name-pattern="invalid PNG signature" scripts/test_character_export.cjs` | 헤더만 있는 PNG를 받아들이는 문제로 **1개 실패**, exit1 (`png-review-red.log`) |
| 같은 전체 T7 명령, PNG chunk 검증 보완 후 | **11개 통과**, exit0 (`green-png-review.log`) |
| `node --check web/src/character-export.js` 및 테스트 파일 | 두 파일 구문 검사 통과 |
| 별도 bundled Python의 zipfile+Pillow | ZIP CRC·STORE·파일명/순서·manifest 시각·48개 PNG 디코드/32²/RGBA·알파128 확인, exit0 (`independent-zip-report.json`, `independent-zip.log`) |

Node 테스트의 ZIP 판독기는 writer 내부 함수/결과를 가져오지 않고 중앙 목록·로컬 헤더·크기·독립 bitwise CRC를 읽는다. 데이터 손상 시 판독기가 CRC 오류를 검출하는 것도 확인했다. 취소 전/도중·인코딩 콜백 대기·3번째 프레임 실패·누적128MiB 초과·원문서 불변·진행 중 caller 편집의 snapshot 분리·단일 PNG·blocked/stale 경로를 검사했다.

실행 계획의 `cancel_failure_or_limit_returns_no_completed_archive` 묶음은 실패 원인을 분리하기 위해 취소·3번째 프레임 실패·용량 초과 테스트로 나눴다. 코드 검토에서 발견한 잘린 PNG 수용 문제는 추가 RED→GREEN으로 보완했다. 수치용 출력 ZIP SHA256은 `3018946712e349afccd47fc6f9f77e792c5a383972e07363b9a9fa4dc65012a0`이다.

## 남은 통합·한계

초기 독립 검증은 renderer 및 PNG 인코딩 경계의 주입 double을 사용했다. 후속 검사에서는 전달된 실제 renderer의 sampleMotion/evaluatePose/drawPose를 사용했고 Canvas 호출과 PNG 인코딩은 기록용 대역을 유지했다. 독립 PNG 디코드도 **숫자 fixture**이며 실제 Canvas 삼각형·캐릭터 움직임·브라우저 알파 가장자리·성능·화면 취소의 성공 증거가 아니다. 배정된 출력 계약을 먼저 구현한 뒤 총괄이 수집한 실제 renderer와의 API 연결을 추가 검증했다.

프론트는 위 API/manifest/progress 형식과 AbortController를 연결하고, 디자인 담당이 계획의 script 순서에 exporter를 포함해 빌드한다. T9 QA는 실제 renderer와 사용자 소재에서 중간 pose/48프레임 픽셀 변화·투명 배경·출력 중 문서 교체/취소·저장 재개를 검증한다. 기존 SDK/Codex나 타 담당 진행 중 suite는 이번 독립 모듈의 완료로 표시하지 않았다. T7 산출물을 총괄 통합 검토에 넘긴다.

## 실제 렌더러 수집 후 추가 계약 검증

총괄 요청으로 전달된 renderer를 수정 없이 사용했다. `sourceCandidateId → assetId`, scene.canvas 크기, decodedAssets Map, 실제 sampling/pose/삼각형 draw 호출을 48회 연결했다. fixture의 눈 첫 정점 y는 프레임0/12/24에서 7/8.95/10.9이며 곡선 없는 mouthOpen=.37의 현재값도 유지된다. ZIP 독립 판독과 manifest 리그 해시를 다시 검사했다.

차단 경로는 처음에 exporter 오류에서 `code`/`blockedParts`가 빠져 RED 1건을 확인했다. exporter가 `blocked_pose`와 사유 목록을 보존하도록 최소 수정했고 stale/source mismatch/background not ready 및 누락 asset 모두 화면 draw·PNG 인코딩 전에 중단됨을 확인했다. renderer 자체 오류의 `missing_asset` code도 그대로 전달된다.

- RED: `node --test --test-name-pattern="production renderer" scripts/test_character_export.cjs` → 1 pass / 1 fail, exit1.
- GREEN: `node --test scripts/test_character_export.cjs scripts/test_character_renderer.cjs` → exporter 13 pass + renderer 8 pass, fail0, 실제 browser pixel TODO1, exit0. 로그는 `renderer-contract-red.log` / `renderer-contract-green.log`.
- 변경된 exporter/테스트 모두 `node --check` 통과. 기존 수치 ZIP SHA가 같아 독립 zipfile/Pillow 증거도 동일 산출물에 유효하다.

검사한 renderer SHA256: `f9aee578144a62094140bf404061f9dc9d5e021201e51e521491b5b843fe5b26`. 실제 Canvas 래스터화·PNG 인코딩·캐릭터 픽셀·UI 경로는 이 호출 기록 검사의 범위 밖이며 T9에서 검증한다.

## renderer70891975의 affine 최적화 후 좁은 영향 검사

프론트가 보고한 `test_character_export.cjs:295` 실패를 같은 production renderer export 사례만 실행해 RED로 재현했다. fixture의 각 부위는 전체 UV가 하나의 affine 변환으로 표현된다. 이전 renderer는 배경1+부위3×삼각형2의 7회 drawImage를 사용했고, 최신 renderer는 같은 부위를 전체 텍스처로 한 번씩 그린다. **해당 실패는 7회라는 내부 호출 횟수 가정 때문이며, 이 사례의 출력 누락은 재현되지 않았다.** exporter 생산 코드는 바꾸지 않았다. 픽셀/알파의 실제 무결성은 이 Node probe의 판정 범위 밖이다.

probe는 이제 Canvas transform/save/restore/clip/alpha/composite를 기록한다. 48개 프레임 각각의 배경→몸→눈→입 순서·소재·독립 기대 좌표·투명도·그려진 영역을 확인한다. 다각형 면적/교차로 빈 영역과 중복 영역을 거절하며 전체 텍스처 1회와 같은 영역을 나눈 삼각형 그리기 모두 허용한다. 새 호출 횟수로 숫자만 교체하지 않았다. 누락·중복·잘못된 alpha·절반 영역을 의도적으로 주입하면 검사가 실패한다. ZIP 독립 CRC 판독, 49개 항목, 48개 PNG 디코드/크기, manifest duration/fps/시각/리그 해시와 원문서 불변·임시 canvas 해제를 유지했다. 동반 오류 검사는 stale/source mismatch/background not ready/누락 asset 전파와 draw·encode 전 중단을 유지한다.

```text
node --test --test-name-pattern="production renderer exports" scripts/test_character_export.cjs
  수정 전 1 fail / exit1 → affine-contract-red.log
node --test --test-name-pattern="production renderer" scripts/test_character_export.cjs
  수정 후 2 pass / fail0 / exit0 → affine-contract-green.log
node --check scripts/test_character_export.cjs
  exit0
node work/team-resume/function/motion-controller-review/reproduce-contract.cjs --state001-fixed
  fixed_verified / exit0 → 별도 리뷰 state001-fixed.log
```

로그는 별도 표기가 없으면 `work/team-resume/function/motion-export/`에 있다. 최신 소비 renderer SHA는 `70891975dd9ee245296b7a373203f117cdb3aa65869f5e4299c039bf72c426ae`, exporter 생산 SHA는 표의 `62bcc6…cd9ce`와 동일하다. 테스트의 변경 전 SHA는 `c73bd81d922be3fd6cb64574988882b0f26bf6d02a834809d71a22b448f7af1c`, 변경 후 SHA는 위 최종 파일 표와 change-record.json에 기록했다. 다른 완료 suite·모델·브라우저는 반복하지 않았다. STATE001은 이전 대기열을 비운 뒤 새 문서 eyeOpen1/revision0/dirtyfalse와 직렬화된 값1을 보존하며, 이는 오류를 기대하는 과거 재현의 exit0와 구별한다. 자세한 증거는 `motion-controller-contract-review.md`의 최신 후속 절을 따른다.

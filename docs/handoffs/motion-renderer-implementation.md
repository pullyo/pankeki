# 움직임 렌더러 구현 인계

2026-10-20 KST · 기술 담당 · 공유 경계 알파 결함 수정본 / C: 수집 대기 / 전체 T9 사용자 흐름 미완료

## 최신 수정: 메시 공유 경계 이음새

기준 renderer SHA는 `f9aee578144a62094140bf404061f9dc9d5e021201e51e521491b5b843fe5b26`이며 D: 원본은 그대로 보존했다. 최종 C: renderer SHA는 **`70891975dd9ee245296b7a373203f117cdb3aa65869f5e4299c039bf72c426ae`**다. 수집 대상은 이 staging의 renderer/test/본 인계뿐이며 파일별 기준/최종 SHA는 `manifest.json`에 있다.

원인: 각 삼각형의 antialiased clip을 원본/배경에 따로 source-over 하면서 공유 경계의 coverage/alpha가 중복 적용됐다. 기존 합성 fixture/정점27조합은 이 픽셀 손실을 검출하지 못했다. Chrome 실제 재현에서 기본 캐릭터가 원본과7395 RGBA 채널 차이(최대49), QA의 회전/기울임8건 모두 실패(내부 alpha 최대17)였다. 원본 PNG·리그 기하는 정상이며 renderer의 합성 경계 결함이다.

수정은 공개4API·입출력·blocked reason·evaluatePose/sampleMotion을 유지한다. 같은 affine에 놓인 메시를 부위당 한 번 그려 내부 clip을 없애고 opacity도 한 번 적용한다. 네 자리 소수 격자의 저장 반올림은 최대0.0001px 일치 범위에서 공통 affine을 찾으며 pose/정점 배열 자체는 변경하지 않는다. UV 전체 사각형을 덮는 topology를 확인한 경우 원래 drawImage의 외부 가장자리 합성을 그대로 쓴다.

실제 비선형 메시는 임시 Canvas2D에서 삼각형의 premultiplied 색/알파와 coverage를 경계별로 구하고 정수 누적한다. 한 번에 채운 전체 실루엣 coverage로 정규화한 뒤 부위 opacity를 한 번 합성한다. 8bit lighter 누적은 정점에서255로 포화되어 잔여 오차가 있어 최종본에서 사용하지 않는다. 작은 삼각형 bounds만 읽고 `willReadFrequently`를 사용한다. 추가 패키지/셰이더/모델 추론은 없다. 임시 표면은 native OffscreenCanvas 또는 detached canvas이며 외부 DOM 트리를 변경하지 않는다.

검증: 실제 Chrome153 PNG/getImageData 회귀를 RED→GREEN으로 확인했다. Node 전체 결과는 **9 pass / 0 fail / 1 TODO**(8개 기존 수치·호출 검사 + 새 실제 브라우저 검사1개 안의15조건)다. affine 분수 이동/회전/기울임·opacity1/.4의8조건 및 실제 캐릭터 기본 합성은 전체 RGBA 차이0이다. 실제 비선형 interior 변형6조건도 alpha와 premultiplied RGB 최대 오차0이었다. 비선형 수용 기준은 alpha≤1 및 premultiplied RGB≤1이며 이번 실측은 모두0이다.

QA가 작성한 독립 oracle의 최신 소스를 읽기 전용 재사용하여 **일반 raster17/17, affine8/8, 화면 보존13/13, 상태/상속4/4** 통과했다. 실제 캐릭터 기본·몸 단독과 native/source 합성은 mismatch pixel0이다. character report의 `providedDesignVsNative`/`actualVsProvidedDesign`은 결함이 남은 구형 디자인 PNG를 비교하므로 false가 예상된다. 수정본의 수용 지표는 `defaultVsNative`와 `minimal`이다. eyeOpen0/mouthOpen1/breath1 PNG도 확인했으며 공유 대각선/세로 줄이 사라졌다. 움직인 pose는 기본 source와 같음을 기대하지 않고 시각 증거로만 남겼다. QA 원본 파일·서버·결과 폴더는 덮어쓰지 않았다.

실제 브라우저 검사 명령(staging 루트):

```powershell
$env:PANKEKI_RENDERER_PIXELS='1'
$env:PANKEKI_PIXEL_ARTIFACTS='C:/Users/Administrator/Documents/Codex/2026-10-20/pankeki-technical-research/work/motion-renderer/seam-green'
node --test scripts/test_character_renderer.cjs
```

실행 환경의 이미 설치된 Playwright와 Chrome을 사용한다. 환경변수를 빼면 수치 suite만 실행하고 실제 픽셀 검사는 명시적으로 skip한다. `renderer-test.tap`, `verification.json`, `work/motion-renderer/seam-green/browser-regression.json`, `work/motion-renderer/qa-oracle-green/reproduction-provenance.json`과 같은 폴더의 PNG/RGBA·browser report가 증거다. browser report의 renderer SHA가 위 최종 SHA와 같다.

독립 oracle 재현 명령:

```powershell
node 'C:/Users/Administrator/Documents/Codex/2026-10-20/pankeki-technical-research/work/motion-renderer/reproduce_pixels.cjs' 'C:/Users/Administrator/Documents/Codex/2026-10-20/pankeki-technical-research/outputs/motion-renderer/web/src/character-renderer.js' 'C:/Users/Administrator/Documents/Codex/2026-10-20/pankeki-technical-research/work/motion-renderer/qa-oracle-green'
```

이전 새 예제27/27 결과는 `motion-demo-renderer-contract-check.md/json`의 당시 SHA 수치 계약 결과로 보존한다. 이번에27조합을 반복하지 않았으며 그 결과를 픽셀 무결성 증거로 확대하지 않는다. 아래 최초 인계의 실제 픽셀 대기 문구는 당시 기록이다. 이번 수정에서 위 정적 렌더러 픽셀 하위 범위는 검증했지만 전체 UI·사용자 소재·재생/저장·48프레임·성능은 여전히 독립 T9 완료 조건이다. 성능30fps/입력100ms 통과를 주장하지 않는다.

## 최초 T2/T4 인계 기록

승인된 계획의 T2/T4 담당 파일만 작성했다. D: 쓰기는 현재 허용 루트 밖이므로 다음 허용 폴더에 실제 수정본을 준비했다. 총괄이 최종 SHA를 확인하여 동일 파일을 수집한다. 제품 D: 소스·다른 담당 파일·문서·SDK는 수정하지 않았다.

- `C:/Users/Administrator/Documents/Codex/2026-10-20/pankeki-technical-research/outputs/motion-renderer/web/src/character-renderer.js` → `D:/Pankeki/web/src/character-renderer.js`
- 같은 staging의 `scripts/test_character_renderer.cjs` → `D:/Pankeki/scripts/test_character_renderer.cjs`
- 두 대상은 착수 기준으로 없었으므로 원본 SHA는 null이다. fixture는 기존 파일의 동일 바이트 읽기용 복사이며 수집/수정 대상이 아니다.

T2 첫 검증: staging 루트에서 `node --test scripts/test_character_renderer.cjs`, RED 모듈 부재 → GREEN 5/5。T4는 drawPose 부재로 RED 3건을 확인한 뒤 구현했다. 최종 공개 API는 `createGrid(width,height,{columns=4,rows=4})`, `evaluatePose(scene,values)`, `sampleMotion(motion,t,{loop=false})`, `drawPose(canvas,pose,decodedAssets)`다. UMD 브라우저 전역은 `PankekiRenderer`, CommonJS도 같은 API다. 모듈 로드로 DOM/네트워크/작업을 시작하지 않는다.

최종 Node 결과는 **8 pass / 0 fail / 1 TODO**다. TODO는 실제 browser RGBA 픽셀 수용 사례이며 성공 검사 수에 포함하지 않았다. `renderer-test.tap`, `verification.json`, `manifest.json`을 같은 staging 루트에 보존한다. 새 모듈의 수치/호출 경로는 통과했으며 앱 통합·실제 캐릭터 움직임 전체 완료를 뜻하지 않는다.

scene은 `{canvas,sourceAssetId,backgroundAssetId,parts,rigs,parameters}`이며 sourceCandidateId→sourceAssetId 변환은 문서/컨트롤러가 맡는다. 반환 pose는 `{backgroundAssetId,draws,blockedParts}`. draw는 `{partId,assetId,verticesDocument,uv,triangles,opacity,order}`, blockedParts는 `{partId,reason,message}`다. source/material 해시 계산과 rigHash 일치 검증은 문서 모듈 경계이며 렌더러가 매 프레임 재해시하지 않는다. 문서가 rig.status=ready/stale를 정확히 전달해야 한다.

독립 수치: fixture 기본 transform 기준 세 값 .5일 때 body 첫 정점(11.9,19.9), eye(12,8.95), mouth y=13.5. eyeOpen=.75는 eye y=7.975다. 부모 affine·opacity가 자식에게만 전파되고 부모 메시 displacement는 자식에 재적용하지 않는다. 여러 binding은 같은 base에 displacement를 합산한다. base/합성 local 및 document 좌표의 면적·방향을 검사해 복합 뒤집힘과 0.0001px² 미만 면적을 차단한다. 기본 key delta는 전 좌표0이어야 한다.

모든 부위가 분리 소재와 backgroundReady 확인을 갖춘 경우 배경null의 투명 장면을 허용한다. 준비되지 않은 원본 장면은 draw를 내놓지 않는다. `backgroundReady`는 수동 확인 상태이며 렌더러가 가려진 픽셀의 실제 복원이나 PNG 바이트의 RGBA 분리를 추정하지 않는다. 그 준비는 문서/소재 경계와 QA가 확인한다. 누락/다른 source/stale/material mismatch는 blockedParts로 전달한다. 값 범위·잘못된 장면/시간 곡선은 code가 있는 예외다. drawPose는 blockedParts가 있으면 이전 화면을 지우기 전에 code=`blocked_pose`, blockedParts를 포함한 예외로 거절한다. 컨트롤러/출력은 이 실패를 중단으로 처리해야 한다.

drawPose의 `decodedAssets`는 assetId→실제 디코드 이미지의 `Map`이다. 타깃 canvas 크기는 호출자가 scene.canvas와 맞춰 준비한다. 배경은 canvas와 실제 디코드 크기가 같아야 한다. 모든 draw의 geometry/UV/인덱스/opacity/order와 누락·미디코드 이미지를 먼저 검사하고 UV→document affine을 미리 계산한다. 그 뒤에만 전달받은 canvas를 지우고 배경→order 오름차순으로 그린다. 숨김은 evaluatePose에서 제외하고 부모 opacity를 곱한다. 삼각형 clip과 affine drawImage를 사용하며 RGBA 합성은 Canvas2D에 맡긴다. 반환은 `{width,height,drawnPartIds}`다. 기존 transform/alpha/filter/shadow/composite 상태는 save/restore하고 렌더링 중 filter/shadow를 제거한다. 사전 검증 오류는 화면을 보존하지만 예기치 않은 브라우저 context/drawImage 장애의 픽셀 롤백까지 입증한 것은 아니다.

Node의 Canvas probe는 순서·클립 좌표·독립 기대 affine·투명도 전달·draw 전 전체 검증을 관찰하는 호출 경계 대역이다. PNG 디코딩/알파 픽셀 합성을 수행하지 않으므로 실제 RGBA 통과 증거로 쓰지 않는다. fixture의 원본/data URL·문서 JSON 불변은 수치/호출 테스트에서 확인했다.

주요 blocked reason: `source_mismatch`, `background_not_ready`, `material_missing`, `rig_missing`, `rig_stale`, `material_mismatch`, `invalid_rig`, `invalid_geometry`, `ancestor_blocked`, `parts_missing`. 값 범위는 `parameter_out_of_range`, 곡선은 `invalid_motion`/`invalid_motion_loop`, draw 입력은 `invalid_pose`/`missing_asset`/`render_unavailable`/`unsupported_canvas`다. source mismatch가 있는 모든 부위는 자기 source 사유를 유지한다. 부모가 무효이면 자식도 임의 재배치하지 않고 차단한다.

sampleMotion은 duration2/fps24, 최대32키·0/2초 끝점·값0..1을 검사하며 구간 선형 보간한다. loop=true는 유한 비음수 경과시간과 같은 루프 끝점 값이 필요하다. 비반복 시간은0..2로 clamp한다. 곡선 없는 mouth 값은 반환하지 않는다. 문서/undo/revision/DOM/네트워크를 변경하지 않는다.

실제 캐릭터·반투명 경계·PNG 프레임/성능의 browser pixel 검증은 후속 T9 QA 완료 조건이다. 수치/합성 색 fixture와 Math 함수 통과를 캐릭터 움직임 전체 완료로 보고하지 않는다. 모델 harness/runtime·SDK·GPU 사용은 변경0이다.

## T9 브라우저 수용 항목

1. 자체 제작 실제 캐릭터와 별도 사용자가 준비한 PNG를 같은 UI로 가져온다. 눈/입/호흡을 각각0/.5/1로 바꾸고 실제 이미지의 정점·픽셀 변화와 중간 형태, 원본 asset 바이트 SHA 불변을 기록한다. 단색 fixture 이동은 수용 근거가 아니다.
2. 투명 분리 장면·깨끗한 배경 장면 모두에서 alpha0/반투명 가장자리·메시 공유 대각선·겹치는 부위를 검사한다. 검은 테두리/삼각형 이음새·원래 눈/입 중복이 없어야 한다. 부모 opacity .5·자식 .4는 .2로 합성되고, 숨긴 부모의 자식은 보이지 않아야 한다. 실제 Canvas PNG/getImageData로 검증한다.
3. 마지막 유효 화면의 pixel hash를 기록하고 stale/source 교체·미준비 배경·복합 뒤집힘·작은 면적·누락 decode를 넣는다. evaluate/draw 차단 후 화면 hash가 유지되고 재생/출력이 중단되는지 확인한다.
4. 실제 앱 저장/재개·48프레임 출력이 동일 evaluate/draw를 쓰는지 확인하고 모든 프레임의 크기·알파·시간을 검수한다. GPU 모델 비교가 끝난 뒤 실제 장비의30fps·입력100ms 목표를 측정한다. 여기서는 미측정이다.

## 검토와 수집

계획의 기본 Git 작업공간·새 검토 에이전트는 이번 명시 지시대로 사용하지 않았다. 로컬 ledger에 대체 경계를 기록하고 작성자가 별도 최종 검토를 했다. 독립 검토·실제 픽셀 판정은 총괄/QA가 맡는다. 자체 검토에서 발견한 caller filter/shadow의 이미지 오염은 회귀 RED→GREEN으로 수정했다. 수치 검증으로 UI/SDK/실제 캐릭터 완료를 대신하지 않는다. 변경은 이제 동결하고 후속 오류 배정까지 대기한다.

최종 파일별 기준/최종 SHA와 수집 목적지는 `manifest.json`을 따른다. 총괄은 두 코드 파일과 이 인계를 동일 바이트로 수집한 뒤 D: 루트에서 `node --test scripts/test_character_renderer.cjs`를 실행할 수 있다. fixture는 기존 D: 파일을 그대로 사용하며 staging 복사본과 SHA가 같다.

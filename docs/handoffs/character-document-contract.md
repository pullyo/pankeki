# 캐릭터 문서 v2와 렌더러 및 Codex 상관 계약

2026-10-20 KST · **병렬 구현용 제안 v0.1, 미구현.** [압축 일정](../product/submission-plan-20261030.ko.md), [공통 제작 기획](../product/character-workflow-live2d-plan.ko.md), [warm 인계](warm-frontend-implementation.md), 최신 [Codex 초안](codex-chat-proposal.md)을 재사용했다. 오늘 산출물은 이 계약과 [합성 fixture](fixtures/character-document-v2.fixture.json)뿐이다. 기술 담당은 아래 순수 pose/별도 draw 경계를 검토하고, 총괄이 고정한 뒤 각 소유 모듈을 구현한다.

## 1 기존 v1 호환 경계

실제 [profiles.js](D:/Pankeki/web/src/profiles.js:151)의 `safeKeys/validateBrief/validateRequest/candidate/project` 기준이다.

| 대상 | 현재 허용 필드 또는 공개 API |
| --- | --- |
| v1 root | `version:1, brief, versions, selectionHistory`만 허용. selectionHistory 생략은 `[]` |
| brief | `profile,name,brief,appearance,detail,palette,notes,prompt,useBrief`. 텍스트 상한 순서대로 name80/brief1200/appearance1200/detail800/notes1200/prompt4000. profile은 original/comic/avatar/mascot/game, palette는 hex3개, useBrief boolean |
| candidate | `id,createdAt,label,image,brief,request,parentId,metrics,kind`. parentId 누락/null은 null, metrics 누락/null은 `{}`, kind는 생략 또는 upload/generated. 생략 kind/model_id를 추정하지 않음 |
| request | `mode,prompt,negative,seed,steps,width,height,cfg,denoise,halo,feather,cache,roi,preview,preview_interval,sampler,scheduler,model_id`. 누락 기본값/범위는 기존 parser 그대로. 현 model_id는 생략 또는 sdxl-base/sd-turbo. `createProject`만 입력 source/mask를 받아 출력에서 제외하며 `parseProject`는 저장 request의 source/mask를 거절 |
| 선택 기록 | `{candidateId,action:view|edit|compare,at}`. 존재하는 후보 참조, ISO UTC 시각. 후보≤20/기록≤1000, id 중복·부모 순환·위험 키/접근자·성긴 배열 거절 |
| CharacterDesign | 공개는 `profiles,sanitizeBrief,buildPrompt,makeRequests,createProject,parseProject` 6개. validateRequest 등은 비공개 |
| PankekiStudio | [app.js](D:/Pankeki/web/src/app.js:752)의 `generate,cancel,loadSource,importProject,exportProject,resetProject,getSummary,subscribe,setMode,getState`. getSummary의 sourceRevision/editEpoch는 런타임 값이며 v1 저장 필드가 아님 |

v2 가져오기는 version을 먼저 분기한다. v1이면 **기존 parseProject 성공 후** 각 image를 해시 자산으로 중복 제거하고 image→assetId만 바꾼 후보·brief·request·계보·선택 기록을 옮긴다. parts/rigs/presets/motions는 빈 배열, 3파라미터는 준비 전이다. active/source 후보는 기존 import처럼 마지막 선택 기록의 후보 또는 마지막 후보, 비교 선택은 빈 배열이다. canvas 크기는 그 후보의 실제 디코드 크기(빈 문서는 1024²), backgroundAssetId는 null이다. 요청의 width/height로 원본을 재조정하지 않는다. 원본 파일을 덮어쓰지 않고 새 v2로 저장한다. v2를 기존 parseProject/createProject에 전달하거나 version1에 parts를 붙이지 않는다. v2→v1 자동 축소 저장도 하지 않는다.

## 2 저장 문서와 상한

root allowlist는 fixture.document와 같은 `version:2,id,canvas,brief,assets,candidates,selectionHistory,sourceCandidateId,backgroundAssetId,parts,rigs,parameters,presets,motions,selection`이다. 모든 ID/참조는 유일·유효하고 부모 계층은 비순환이며 JSON plain data만 허용한다. backgroundAssetId는 같은 canvas 크기의 실제 준비한 배경 자산 또는 null이며, 원본과 별도로 보관한다.

| 데이터 | 고정 의미 |
| --- | --- |
| canvas / asset | 문서 좌표는 좌상단 원점, +x 오른쪽/+y 아래, 단위 px. asset `{id,mime,width,height,data}`의 id는 **PNG/JPEG/WebP 파일 바이트** SHA256(`sha256:hex`), data는 내장 data URL. 원격 URL/경로 없음. 기존 원본의 바이트·해상도 보존, 새 투명 소재는 8bit RGBA PNG, 마스크는 gray8 PNG(255=편집/0=보존). 해시·파일 signature·실제 디코딩 크기를 대조 |
| candidate / selection | candidate는 v1의 image만 assetId로 치환한 형태. sourceCandidateId는 수정 기준, selection.activeCandidateId는 보는 후보로 분리. selection.compareCandidateIds≤2, partId는 null 또는 현 부위 |
| part≤16 | `{id,name,parentId,order,sourceAssetId,maskAssetId,materialAssetId,sourceRect,transform,visible,opacity,lockMaterial,lockTransform,backgroundReady}`. sourceRect=[x,y,w,h]는 원본 좌표, mask는 원본과 같은 크기. materialAssetId=null은 마스크만 준비됨이며 변형 불가. transform=[a,b,c,d,tx,ty]는 소재 로컬→부모 로컬, x'=a*x+c*y+tx. 부모 affine은 자식에게 전파, 픽셀 메시 변형은 해당 부위에만 적용. 배경 미준비 부위의 직접 위치/크기 이동은 차단하고 보완 안내 |
| rig / 준비 상태 | `{id,partId,materialAssetId,rigHash,status,vertices,uv,triangles,bindings}`. vertices/uv는 평탄한 xy/uv 배열, 같은 정점 수. triangles는 0기반 인덱스 3개씩. 부위당 정점≤256/삼각형≤512, UV 0..1, 유한값·유효 면적·인덱스 검증. material 없는 rig는 ready 불가 |
| parameters / 조합 | eyeOpen 기본1, mouthOpen 기본0, breath 기본0, 모두 0..1. 각 `{id,min,max,default,value}`; 활성 여부는 ready binding 존재로 계산. preset `{id,values,rigHashes}`와 motion `{id,duration,fps,curves,rigHashes}`는 연결 hash가 모두 맞을 때만 사용. curves는 `[{parameterId,keys:[{t,value}]}]`, t 증가순·0/duration 포함·선형 보간. 첫 출력 duration2/fps24, t=k/24(k=0..47), 프레임 이미지 대신 곡선 저장 |

**저장 상한 제안:** 최종 UTF-8 JSON≤64MiB(Base64 포함), asset data URL≤16MiB, 각 디코드≤16MP, 유일 자산≤64, 유일 자산의 RGBA 환산 합계 `Σ(width*height*4)`≤128MiB. 이 상한들은 동시에 만족해야 한다. v1의 한도를 새 상한으로 바꾸지 않으며, v2 변환이 자원 상한을 넘으면 기존 v1을 유지한 채 변환을 중단한다. rig 검증은 한 변≤1024인 작업 캔버스부터 지원하고 더 큰 v1 원본은 보존하되 변형 준비 전으로 둔다. base64 팽창·마스크·undo가 붙잡는 자산까지 사전 계산하며 초과 시 조용히 후보/부위를 삭제하지 않는다. 실제 메모리 성능을 측정한 수치는 아니다.

## 3 별도 렌더러 모듈 계약과 무효화

제안 API **`evaluatePose({canvas,sourceAssetId,backgroundAssetId,parts,rigs,parameters}, values)` → `{backgroundAssetId,draws,blockedParts}`**, **`drawPose(canvas,pose,decodedAssets)` → `{width,height,drawnPartIds}`**. 후자는 인자로 받은 canvas를 지우고 준비된 배경→order 오름차순 부위를 그린다. DOM·네트워크·모델 호출·문서 수정 없음. decodedAssets는 assetId→디코딩 이미지 Map이며 파일 디코딩은 문서 어댑터 소유다. draw는 `{partId,assetId,verticesDocument,uv,triangles,opacity,order}`. 부모 숨김/opacity도 전파한다. straight RGBA를 합성 시 premultiply하고 PNG 출력은 straight alpha로 돌린다. 원본 asset 바이트는 변경하지 않는다.

bindings는 `{parameterId,keys:[{at,deltas}]}`. key는 증가순·범위 양끝 포함, deltas 길이는 vertices와 같다. 구간 선형 보간한 displacement를 base vertices에 더한다. 같은 정점의 여러 파라미터는 **동일 base에 각 displacement를 합산**한다. 다른 PNG를 섞지 않는다. 현재값 범위 밖/NaN은 거절한다. `part.sourceAssetId≠현재 sourceAssetId`인 부위의 마스크/rig는 source_mismatch로 차단하며 새 원본으로 자동 이식하지 않는다. 배경 자산/해당 부위의 backgroundReady가 없으면 새 영역을 드러내는 이동·변형도 차단한다. 무효 부위는 blockedParts에 사유를 넣고 준비된 정지 소재만 표시한다. 배경 미준비 상태의 UI는 원본 보기만 제공하며 이전 눈·입 위에 새 소재를 겹쳐 변형 성공으로 보이지 않는다.

rigHash는 SHA256(UTF-8 JSON.stringify(tuple)). tuple은 `[part.id,parentId,sourceAssetId,maskAssetId,materialAssetId,sourceRect,[material.width,material.height],vertices,uv,triangles,bindingsTuple]`; bindingsTuple은 parameterId 정렬의 `[parameterId,[[at,deltas],...]]` 배열이다. **소재/원본/마스크 해시·크기·자르기·부모·메시/UV/키폼 변경은 hash를 바꾼다.** 참조 rigHash 불일치 시 rig 및 관련 preset/motion은 stale이며 적용/변형 출력 불가. 전 상태/소재는 남긴다. 색상만 바뀌어도 자동 호환으로 보지 않고 사람이 호환 재바인딩을 확인한다. 단순 현재 파라미터 값·표시 순서·로컬 affine 변경은 위 tuple을 바꾸지 않는다.

## 4 실행 취소와 Codex 상관

문서 명령 초안은 `{id,project_token,source_revision,expected_document_revision,type,args}`. 사람이 확인한 명령만 같은 검증 경로로 원자적 commit, 한 drag/마스크 획=한 undo 단위다. undo/redo는 이전 asset 참조/부위/rig/값/선택을 함께 복원하고 새 commit은 redo를 비운다. 이력은 런타임 전용(제안≤50단계/patch≤32MiB), 이미지 바이트 복사 대신 불변 asset 참조를 쓴다. 이력 한도 시 오래된 undo만 정리하고 현재 문서/후보는 보존한다. 이미지 job 진행 중 undo는 기존 cancel/serial로 결과를 무효화하며 GPU 계산을 되돌린다고 표시하지 않는다.

| 값 | 수명과 검사 |
| --- | --- |
| document.id / document_revision | id는 저장되는 문서 정체성. revision은 런타임 단조 증가 commit/undo/redo 번호이며 저장하지 않음. undo도 감소시키지 않음 |
| project_token | reset/프로젝트 열기/승인한 import **시작**마다 새 임의 token. import decode 실패 시에도 이전 token을 재사용하지 않음. reset 거절/파싱 전에 거절된 파일/단순 단계 이동은 유지. 동일 document.id를 다시 열어도 다름 |
| source_revision | wire 값은 현재 app의 sourceRevision. 원본 교체를 시작할 때 증가(실패해도 롤백 안 함). v2에서 원본·선택 소재·마스크·rig 대상이 바뀌거나 이를 undo/redo하면 증가하도록 어댑터를 확장. 원본 asset hash/후보 id가 같아져도 이전 번호를 재사용하지 않음 |
| session / request | 서버 session_id+nonce가 권한, project_token/source_revision은 상관값뿐. nonce/threadId/대화/제안/진행 job은 v1/v2에 저장하지 않음 |

Codex 초안의 응답 `{client_request_id,project_token,source_revision,revision,is_current,...}`를 **활성 요청 id·제출 token·현재 token·제출/현재 source revision·수락한 job revision**과 모두 대조한다. POST 수락 전 HTTP 실패도 캡처한 요청 상관값으로만 표시한다. reset/import/원본 전환·cancel/timeout은 로컬 요청을 먼저 무효화하고 원격 취소를 요청한다. 늦은 본문·제안·오류가 현재 UI를 변경하지 못하며 uncertain은 자동 재전송하지 않는다. 제안 확인 시에는 로컬에 캡처한 document_revision/editEpoch/maskRevision도 대조한다(HTTP 필드 추가를 전제하지 않음). 제스처/소재 로딩 중에는 전송·적용을 막는다. 인증 성공과 ready는 별개이며 최신 초안의 blocked 경계를 유지한다. 제안 수신≠적용≠이미지 생성, 사용자의 적용 확인 후 생성도 기존 generate를 별도로 실행한다.

## 5 fixture와 다음 구현 검증

fixture는 합성 색 PNG만 포함한 wrapper이며 `document`가 v2 예시, `legacyV1`은 실제 기존 parser에 넣을 v1 예시다. 합성 바탕 자체가 준비된 배경이므로 source/background가 같은 자산을 참조한다. 일반 v1 변환의 background는 null이다. `cases` 9개는 구현 후의 기대값이며 현재 렌더러/변환기 통과 결과가 아니다. wrapper 전체를 프로젝트로 import하지 않는다. 수용 항목은 v1 미지 필드 거절/원본 보존, alpha·저장 상한, 중간 정점, hash/원본 변경 시 차단, undo 뒤 늦은 응답 폐기다.

완료 검증: Node로 기존 공개 API 6개·legacyV1 round-trip·미지 root 필드 거절을 확인했다. Python/Pillow로 fixture JSON/자산 6개의 SHA256·PNG 디코드 크기·투명 알파·리그 hash/참조·중간 key 기대값을 점검했다. 새 v2 파서·렌더러·Codex 실행의 검증은 아니다. 변경은 이 문서와 fixture 두 개뿐이며 생산 코드·기존 테스트·빌드·GPU·의존성 설치는 없다. 다음 단계는 총괄의 hash/렌더러 I/O·자산 상한 검토 후 문서 모듈과 별도 렌더러의 병렬 구현 배정이다.

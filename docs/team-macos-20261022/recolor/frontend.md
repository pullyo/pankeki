# 색상 변경 프런트 연결 인계

2026-10-23 KST · 프런트 담당 · 상태: **소스와 JS 요청·문서 검증 완료 / 총괄 통합 대기**.

프로젝트 루트는 `/Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki`이며 아래 경로는 루트 기준이다. 실제 CPU 색상 알고리즘·이미지 품질·새 UI 화면을 검증한 결과는 아니다.

## 구현한 흐름

- 기존 디자인/부분 수정 화면에 **AI 부분 수정 / 색상 변경** 선택을 추가했다. 기본값은 AI 부분 수정이다. 색상 변경은 **바꿀 색** picker와 HEX 값, **기준 색 자동 / 직접 지정**, 직접 picker, **색 범위 0~90(기본35)**만 표시한다. 안내는 UX 기준의 짧은 문구를 사용한다. 생성 모드에서는 새 영역을 숨긴다.
- 색상 변경은 프롬프트 입력과 모델·크기·생성 옵션 바로가기를 숨기고 버튼을 **색상 적용**으로 표시한다. 선택 영역과 기존 마스크 도구를 사용한다. 생성/AI 부분 수정으로 돌아오면 기존 입력·스타일·요청 경로를 유지한다. 오른쪽 상시 패널·새 메뉴·로고 변경은 없다.
- 모델 카탈로그 준비나 프롬프트·seed·sampler 검사를 색상 요청의 선행 조건으로 삼지 않는다. 기존 후보 수 선택이 2개여도 색상 요청은 항상 1개, 완료 후보도 1개다. 원본 로드·마스크 준비 상태와 기존 feather 범위는 검사한다. 실제 처리와 모델 사용 여부는 AI팀의 엔진 경로가 소유한다.
- 생성·취소·원본·후보·저장은 계속 app.js가 소유한다. serial 방어로 취소 후 늦은 POST/결과가 후보를 덮지 못한다. 색상 작업의 진행·취소·실패 안내는 AI/GPU 실행으로 표현하지 않는다. 기존 모델 준비 오류가 남아 있어도 색상 선택 시 관련 안내로 바꾸며 modelsReady 자체를 참으로 속이지 않는다.

구현 위치는 `web/src/index.template.html`의 `inpaintOperations`, `web/src/app.js`의 `isRecolor/applyEditRequest/renderView/requestSnapshot/generate/importProject`, `web/src/redesign.js`의 `submitPrompt/conversationEntries/mount/refresh`, `web/src/redesign.css`의 `pc-inpaint-controls/pc-recolor` 규칙이다. 실제 템플릿은 배정문에서 축약한 web/index.template.html이 아니라 **web/src/index.template.html**이다.

## 고정 요청과 문서 계약

자동 기준 색의 실제 JS POST 캡처 형식은 다음과 같다. source/mask는 기존 캔버스 PNG이며 아래에서만 생략했다.

```json
{
  "mode": "inpaint",
  "edit_operation": "recolor",
  "target_color": "#FF6600",
  "source_color": null,
  "color_tolerance": 35,
  "feather": 4,
  "source": "기존 source PNG data URL",
  "mask": "기존 paint PNG data URL"
}
```

직접 지정은 source_color에 #RRGGBB를 보낸다. 색은 6자리 HEX를 검사해 대문자로 정규화하며 color_tolerance는 유한한 0~90, feather는 기존 0~64 정수다. prompt/model_id/negative/seed/steps/width/height/cfg/denoise/sampler/scheduler는 이 요청에 넣지 않는다. AI 요청의 누락 edit_operation은 기존 동작이고, 명시적 regenerate도 문서에서 허용한다. txt2img 요청에는 색상 필드를 끼워 넣지 않는다.

`web/src/profiles.js`의 validateRequest에 색상용 allowlist·값 검사를 추가했다. 저장된 후보 request는 edit_operation/목표색/기준색/색 범위/feather를 보존하고 source/mask는 기존처럼 제외한다. CPU 후보에 AI 기본값이나 모델을 추측해 넣지 않는다. 누락된 source_color와 color_tolerance는 문서 파서에서 null과35로 정규화한다. 잘못된 작업·색·범위가 있는 파일은 기존 프로젝트를 바꾸지 않고 거부한다.

**문서 버전과 candidate.kind는 추가하지 않았다.** kind는 기존 generated를 유지하고 request.edit_operation으로 구별한다. 기존 부모 후보·브리프·선택 이력·이미지와 저장 request를 유지한다. character-document.js는 기존 Design.parseProject 위임으로 v2 변환/직렬화에서도 이 메타데이터를 보존하며 별도 수정하지 않았다.

파일 가져오기/자동 복원 시 선택된 후보의 색상 설정을 복원한다. 기존처럼 최초 화면/모드는 txt2img이고, 디자인으로 돌아가면 저장된 색상 선택을 사용한다. 후보의 이어서 수정도 해당 request의 색 설정을 불러온다. 새 프로젝트·AI 후보는 AI 부분 수정 선택으로 돌아간다. 마스크는 기존 계약대로 재작성해야 한다. 아직 후보를 만들지 않은 색상 도구의 임시 설정을 새 문서 필드로 자동 저장하지는 않는다.

## 정직한 결과 표시와 no-op

후보명·이미지 alt·배지·갤러리·대화 기록·비교·보드 출력은 색상 변경으로 구별한다. 색상 후보에 가짜 사용자 프롬프트·모델·seed를 표시하지 않는다. 다운로드 링크는 실제 저장된 후보 이미지를 가리킨다.

backend metrics.skipped가 true 또는 비어 있지 않은 문자열이면 **변경 없음**으로 표시하고 **선택 영역과 기준 색을 확인해 주세요**라고 안내한다. 실제 사유는 empty-mask/no-matching-color/same-color/no-visible-change이며 문자열을 그대로 저장한다. false/null/누락/빈 문자열은 미skip이다. 기존 cache=empty-mask-skip의 변경 없음 호환도 유지한다. 변경 없는 결과는 확인 가능한 후보로 보관하되 색상을 적용한 성공으로 안내하지 않는다. 문자열 사유·true·미skip 대조값을 대역 응답에 넣어 표시/비교/보드/저장복원을 검사했으며 실제 엔진 실행과 실물 결과 판정은 총괄 통합에 남긴다.

## 실행 검증과 증거

`scripts/test_recolor_ui.cjs`는 기존 test_ui_state.cjs의 VM harness를 재사용한다. 실제 app.js/profiles.js/redesign helper·문서 코드를 실행하고 fetch/이미지/Canvas/IndexedDB는 제어된 대역으로 둔다. v2 변환도 실제 문서 모듈을 사용하되 이미지 decoder는 fixture다. redesign DOM은 mount하지 않는다.

| 단계 | 실제 결과 | 근거 |
| --- | --- | --- |
| 최초 RED, 제품 변경 전 | 13건 중4통과·9실패, exit1 | runtime/macos/recolor-quality/frontend/red.log |
| 후속 RED | no-op 성공 오표시 1실패, 모델 준비 오류 잔류 1실패를 각각 확인 | verification.json의 additional_red_observed와 현재 채팅 실행 기록 |
| 최종 색상 GREEN | **15/15 통과**, 실패·skip·TODO0 | runtime/macos/recolor-quality/frontend/green.log |
| 전체 JS 회귀11파일 | **168건 /166통과 /1skip /1TODO /0실패**, exit0 | runtime/macos/recolor-quality/frontend/javascript-tests.log |

색상 GREEN은 모델 미준비/빈 prompt/잘못된 AI 설정에서 최소 요청1개, 자동/직접 기준색과0/90, 잘못된 값·원본·마스크 거부, 후보 부모·다운로드 연결, v1 저장/복원·v2 roundtrip, AI/생성 복귀, 늦은 취소, no-op와 보드 문구를 검사한다. 전체 skip/TODO는 기존 실제 RGBA/알파 경계 브라우저 검증 항목이다. 중간에 새 VM의 고정 UUID가 가져온 후보와 겹친 fixture 문제는 새 후보 ID를 고유하게 제공해 수정했다. 제품의 UUID 로직은 바꾸지 않았다.

자동/직접 두 요청의 **실제 대역 POST와 저장 request**는 `runtime/macos/recolor-quality/frontend/request-and-roundtrip.json`에 기록했다. 해당 파일의 model_catalog_ready=false와 request_count=1을 확인했다. source/mask는 1px 제어 fixture이며 실제 캐릭터 이미지나 실제 색상 처리 결과가 아니다. 새 템플릿 ID11개의 유일성, 테스트 수·실행 범위·소스 SHA-256은 같은 폴더의 verification.json에 기록했다.

```sh
/Users/plant313/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --test-reporter=spec scripts/test_recolor_ui.cjs
PANKEKI_RENDERER_PIXELS=0 /Users/plant313/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --test-reporter=spec scripts/test_character_document.cjs scripts/test_character_export.cjs scripts/test_character_motion.cjs scripts/test_character_renderer.cjs scripts/test_motion_app.cjs scripts/test_studio_state.cjs scripts/test_ui_state.cjs scripts/test_redesign.cjs scripts/test_inpaint_prompt_boundary.cjs scripts/test_recolor_ui.cjs web/tests/profiles.test.cjs
```

## 총괄 통합에서 남은 확인

빌드·브라우저·서버·GPU를 사용하거나 재시작하지 않았다. 총괄의 한 번의 빌드 후 새 UI의 크기·포커스·자동/직접 전환·생성 복귀·모델 없는 실제 색상 요청과 후보1개를 확인해야 한다. 실제 source/mask/feather·CPU 처리·픽셀 RGB/알파·형태/광택/경계·native 다운로드 도착은 AI/QA/총괄의 실물 증거로 판정한다. 테스트 통과를 실제 색 품질 합격으로 표현하지 않는다. web/index.html은 이번 담당자가 수정하지 않았다.

## 변경 파일

- 제품: web/src/app.js, web/src/redesign.js, web/src/redesign.css, web/src/index.template.html, web/src/profiles.js.
- 관련 테스트: scripts/test_recolor_ui.cjs.
- 자기 인계: docs/team-macos-20261022/recolor/frontend.md.
- 자기 증거: runtime/macos/recolor-quality/frontend/red.log, green.log, javascript-tests.log, request-and-roundtrip.json, verification.json.

studio.js·character-*·엔진/색상 코드·다른 담당 문서는 수정하지 않았다. 템플릿의 기존 CRLF 줄바꿈을 보존해 필요한 영역만 삽입했다. 추가 채팅·하위 에이전트·다른 채팅 메시지는 사용하지 않았다.

## 2026-10-23 HEX 직접 입력과 metrics.kind 보존 — 소스 freeze

총괄의 추가 요청에 따라 바꿀 색과 직접 지정 기준 색을 **swatch + 짧은 HEX 입력 한 줄**로 바꿨다. 새 패널은 없다. 기존 targetColorValue/sourceColorValue ID를 output에서 type=text 입력으로 바꾸고 각각 바꿀 색 HEX/기준 색 HEX로 이름 붙였다. 가시 label도 해당 입력에 for로 연결하며 native picker에는 별도 색 선택 aria-label을 제공한다. 실제 템플릿 파서로 두 입력의 type·label 연결·접근성 이름을 확인했다.

- app.js의 syncColorInput은 선택기→HEX와 HEX→선택기를 양방향으로 연결한다. 입력 중에는 문자열을 덮지 않고, 올바른 #RRGGBB를 확정하면 대문자로 정리한다. 불완전하거나 잘못된 입력은 남겨 aria-invalid=true로 표시한다. 요청은 HEX 입력을 검사하므로 이전 swatch 색으로 조용히 대체하지 않는다. 잘못된 목표색 또는 직접 지정 기준색은 POST 전에 기존 오류 안내로 거부한다. 자동 기준 색은 계속 null이며 숨은 직접 입력의 값은 요청에 사용하지 않는다.
- 파일 복원/후보 편집/새 프로젝트에서 HEX와 swatch를 함께 맞춘다. 처리 중에는 둘 다 비활성화한다. CPU 최소 요청·색 범위·마스크·feather·기존 AI/생성 경로는 유지한다.
- 편집·모션팀의 P2에 따라 summaryMetrics allowlist에 kind 한 항목을 추가했다. backend의 metrics.kind=local_recolor와 model_calls=0이 후보 저장·복원 뒤에도 남는다. 후보 kind는 기존 generated 그대로이며 문서 버전·스키마 enum은 추가하지 않았다.

이번 후속 변경은 **web/src/app.js, web/src/index.template.html, web/src/redesign.css, scripts/test_recolor_ui.cjs와 이 인계 및 자기 증거 파일**이다. redesign.js/profiles.js·엔진·다른 담당 문서는 이번 보정에서 수정하지 않았다.

| 후속 실행 | 실제 결과 | 증거 |
| --- | --- | --- |
| HEX RED, 수정 전 | 18건 /14통과 /4실패 | runtime/macos/recolor-quality/frontend/hex-red.log |
| metrics.kind RED, allowlist 수정 전 | 1건 /0통과 /1실패, 실제 값 undefined | runtime/macos/recolor-quality/frontend/kind-red.log |
| 최종 색상/HEX/metrics GREEN | **19/19 통과**, 실패·skip·TODO0 | runtime/macos/recolor-quality/frontend/hex-green.log |
| 최종 전체 JS 회귀11파일 | **172건 /170통과 /1skip /1TODO /0실패**, exit0 | runtime/macos/recolor-quality/frontend/hex-javascript-tests.log |

추가 검사는 목표/기준 HEX 직접 입력, 소문자 정규화, picker 변경, 실제 request 반영, 자동 기준 null, 잘못된 초안 보존·요청 차단, 복원된 HEX, CPU metrics 저장·복원을 확인한다. 위 본문의 168건은 최초 색상 연결 단계이며 최종 결과와 합산하지 않는다. 동일 회귀 명령을 사용했고 브라우저 픽셀 검사는 계속 비활성화했다.

최종 소스 SHA-256과 입력 필드 검증은 runtime/macos/recolor-quality/frontend/hex-verification.json에 기록했다. **이 담당자의 제품 소스는 freeze 상태**이며 이후 수정하지 않는다. 총괄이 빌드·브라우저 검수를 진행할 수 있다. 이번에도 빌드·서버·브라우저·GPU와 네이티브 picker 팝업은 조작하지 않았다. 키보드로 HEX 입력 후 실제 화면/요청이 맞는지와 실물 색 품질 판정은 총괄 통합 검수에 남긴다.

## 2026-10-23 실제 skipped 문자열 계약 보정 — 최종 재freeze

총괄 통합 리뷰 뒤 backend recolor.py/engine.py를 정적으로 대조했다. skipped는 성공 시 null, no-op 시 empty-mask/no-matching-color/same-color/no-visible-change 문자열이다. 앞선 true-only 검사는 이 실제 계약을 놓쳤다. 실제 문자열을 넣은 실패 검사를 먼저 작성해 empty-mask 결과가 색상 적용 완료로 표시되는 것을 확인한 뒤 보정했다.

app.js의 순수 resultWasSkipped(metrics) 함수를 완료 배지·안내, kindLabel을 쓰는 이미지 alt/갤러리/비교/복원, 보드 출력에서 재사용한다. redesign.js의 conversationEntries도 같은 명시적 타입 규칙을 적용한다. true 또는 길이가 0보다 큰 문자열은 skip, false/null/누락/빈 문자열은 미skip이며 기존 empty-mask-skip 캐시 호환은 유지한다. 일반 truthiness로 판정하지 않는다. 저장 metrics.skipped의 원래 사유 문자열과 metrics.kind/model_calls는 바꾸지 않는다.

새 검사 두 개는 실제 사유 네 개, 임의의 비어 있지 않은 사유, 공백 한 글자, true와 false/null/누락/빈 문자열을 대조한다. 결과·갤러리·비교·보드·대화 항목, v1 저장/가져오기, v2 변환/직렬화와 복원 후 결과/보드까지 확인한다. 표시만 변경하며 API·색상 요청·이미지·문서 버전·candidate.kind는 바꾸지 않는다.

| 최종 실행 | 실제 결과 | 증거 |
| --- | --- | --- |
| 실제 문자열 RED | 21건 /20통과 /1실패, empty-mask 배지가 잘못된 성공 문구 | runtime/macos/recolor-quality/frontend/skip-string-red.log |
| 문자열 계약 GREEN | **21/21 통과**, 실패·skip·TODO0 | runtime/macos/recolor-quality/frontend/skip-string-green.log |
| 최종 전체 JS11파일 | **174건 /172통과 /1skip /1TODO /0실패**, exit0 | runtime/macos/recolor-quality/frontend/skip-string-javascript-tests.log |

이번 수정 파일은 **web/src/app.js, web/src/redesign.js, scripts/test_recolor_ui.cjs, 이 인계 및 자기 skip-string 증거 4개**다. profiles.js·템플릿·CSS·엔진·다른 담당 파일은 수정하지 않았다. 최신 검증과 소스 SHA-256은 runtime/macos/recolor-quality/frontend/skip-string-verification.json에 있다. 앞선 HEX 단계의 freeze/172건 기록을 이번 승인된 보정과 최종174건 기록이 갱신한다. **제품 소스를 다시 freeze했으며 추가 수정 없이 총괄의 한 번의 빌드/브라우저 통합을 기다린다.** 이번에도 빌드·브라우저·서버·GPU는 조작하지 않았다. VM 대역 검사를 실제 UI 렌더링·CPU 픽셀 품질 검증으로 주장하지 않는다.

## 2026-10-23 PNG 저장 Blob 경로와 비교 스타일 보정 — 최종 freeze

총괄은 실제 IAB에서 PNG data URL 저장이 두 방식 모두15초 timeout이고, 같은 탭의 프로젝트 Blob 다운로드는 실제 파일 경로를 즉시 반환했다고 보고했다. server PNG 바이트 일치와 ui-dom-link-result.png도 총괄이 확인한 근거다. 이번 담당자의 새 네이티브 다운로드 증거가 아니며 PNG 파일 도착 완료로 표현하지 않는다.

기존 downloadBlob(blob,name)은 바꾸지 않고 app.js에 downloadImage 클릭 핸들러만 추가했다. canonical data:image/png;base64 링크의 정상 클릭을 preventDefault하고, atob→Uint8Array로 디코드한 동일 바이트를 MIME=image/png Blob으로 감싸 기존 downloadBlob에 원래 filename을 전달한다. 앵커의 href/download 값은 그대로 두므로 data URL 읽기와 컨텍스트 메뉴 참조를 유지한다. PNG 재인코딩·Canvas·결과 fetch·이미지/프로젝트 변경은 없다. JPEG/WEBP 및 기존 blob: 링크는 가로채지 않는다.

원래 결과 저장 링크에 직접 연결하고, PankekiStudio.downloadImage를 통해 redesign의 기록 저장 링크와 확대창 저장 링크가 같은 핸들러를 사용한다. 프로젝트·보드·모션의 Blob 저장 핸들러, 다른 출력·엔진 코드는 수정하지 않았다. 테스트 sandbox에는 실제 표준 atob만 제공해 decoder를 가짜로 대체하지 않았다.

실제 Blob.arrayBuffer()를 읽어 원본 PNG base64의 디코드 바이트 전체와 비교했고 MIME·원래 파일명·한글 파일명·원래 data URL 유지·Canvas 재인코드0을 확인했다. 원래 저장 클릭은 app의 실제 링크 핸들러로 검사했고, 기록/확대용 공유 핸들러도 같은 이벤트와 Blob 검사를 통과했다. redesign 전체 DOM mount와 실제 파일 도착은 이 검사 범위가 아니다.

추가 UI 검수 요청도 반영했다. refresh(summary)에서 categoryRow.hidden=editing을 설정하므로 body 화면이 compare로 바뀌어도 summary.mode=inpaint인 색상 변경/AI 부분 수정에서는 생성 스타일 행이 숨겨진다. txt2img는 기존 스타일 행을 유지하고 선택값은 바꾸지 않는다. 이 한 줄은 소스 확인이며 실제 비교 화면은 총괄의 재빌드 후 확인한다. 이미지531px 공간 보존은 총괄의 앞선 실제 화면 보고다.

| 최신 실행 | 실제 결과 | 증거 |
| --- | --- | --- |
| PNG Blob RED, 제품 수정 전 | 24건 /22통과 /2실패 | runtime/macos/recolor-quality/frontend/png-blob-red.log |
| PNG Blob GREEN | **24/24 통과**, 실패·skip·TODO0 | runtime/macos/recolor-quality/frontend/png-blob-green.log |
| 최종 전체 JS11파일 | **177건 /175통과 /1skip /1TODO /0실패**, exit0 | runtime/macos/recolor-quality/frontend/png-blob-javascript-tests.log |

원본/Blob SHA-256·바이트 수·MIME·filename·링크 유지와 최신 소스 해시는 runtime/macos/recolor-quality/frontend/png-blob-verification.json에 기록했다. 기존 RED/GREEN·전체 회귀 명령을 사용했으며 브라우저 픽셀 검사는 계속 끈 상태다. 앞선174건 기록과 합산하지 않는다.

이번 변경 파일은 **web/src/app.js, web/src/redesign.js, scripts/test_ui_state.cjs, scripts/test_recolor_ui.cjs, 이 인계와 자기 png-blob 증거4개**다. 템플릿·CSS·profiles.js·엔진·프로젝트/다른 출력 로직은 수정하지 않았다. **소스를 다시 freeze했다.** 총괄이 한 번 빌드한 뒤 같은 PNG 저장 클릭으로 네이티브 파일 도착과 server/파일 바이트 일치를 최종 확인해야 한다. 이번에도 빌드·브라우저·서버·GPU는 조작하지 않았고 native PNG 저장 완료는 주장하지 않는다.

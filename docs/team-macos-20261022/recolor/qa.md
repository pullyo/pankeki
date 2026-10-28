# CPU 정밀 색 변경 — 독립 QA 결과

2026-10-23 KST. **최신 판정: 실제 UI 색상 job `422683208182457693da00d28936a767`의 요청·결과 표시, 실제 네이티브 PNG 다운로드, 프로젝트 네이티브 저장·파일 가져오기, empty-mask 변경 없음 처리, 대기 후 자동 복원·후보 비교를 기록된 흐름 범위에서 수용한다. 네이티브 원본 파일·복사본·전체 DOM PNG·서버 PNG·프로젝트 내 PNG의 전체 바이트가 같다.** 추가로 직접 지정한 미세 기준색의 샘플 누락 보정도 함수/Engine 회귀에서 수용한다. 직전 OKLab 함수 15/15·Engine/JobManager 15/15·총괄 HTTP job 6/6 통과와 해당 표본의 범위 한정 품질 수용을 유지한다. QA는 허용된 CPU 함수·Engine 호출 외에 API/GPU/서버/브라우저를 사용하지 않았고 UI 판독은 파일만 읽었다. 제품 소스·기존 판독기·사전 기준은 QA가 변경하지 않았다. 아래 fixture는 QA가 만든 입력이며 자동 물체 분할의 일반 성능을 입증하지 않는다. 단계별 미완료 기록은 당시 상태이며 최종 상태는 후속 4·5를 따른다.

**총괄에게 인계하는 실제 앱/API용 fixture**

| 자료 | 경로와 의미 |
| --- | --- |
| RGBA 원본 | [integration-rgba.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/fixtures/integration-rgba.png>) · QA가 직접 만든 1024×1024 합성 원본. alpha 0/64/128/255가 섞이며 픽셀을 불투명하게 합성하지 않았다. |
| 마스크 | [integration-mask.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/fixtures/integration-mask.png>) · 1024×1024 L, 선택 204,800픽셀. 파란 명암 패치 외에 다른 색·선·중립 하이라이트도 선택 안에 있어 기준색 제한을 검수한다. |
| 보존 검사 영역 | [integration-protected.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/fixtures/integration-protected.png>) · 선택 안 107,348픽셀. 녹색/빨강/갈색 패치, 중립 선·하이라이트의 RGB 보존 표본이다. |
| 기준색·좌표·해시 | [fixtures/manifest.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/fixtures/manifest.json>)의 `integration-red-rgba`. 1픽셀 선은 x=400, y=340..679. 명암 표본은 x=420, y=372/468/564/660이며 모두 불투명한 파란 면이다. |

초기 통합 요청 설정은 아래와 같다. source/mask는 위 파일을 정상 경로로 전달하며, 이 JSON 자체에 이미지 바이트를 넣은 것은 아니다.

```json
{
  "mode": "inpaint",
  "edit_operation": "recolor",
  "target_color": "#E3342F",
  "source_color": "#2864C8",
  "color_tolerance": 35
}
```

이 fixture는 **명시적 파랑 기준색 선택**을 검수한다. 다른 색 패치가 같은 마스크 안에 있다는 이유만으로 함께 바뀌면 실패다. 숨은 RGB도 mask 밖에서는 그대로여야 하며, 모든 alpha는 정확히 유지해야 한다. 개별 물체/의상의 의미를 자동 분할한다고 주장하지 않는다.

**독립 수용 기준** — [acceptance-criteria.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/acceptance-criteria.json>)

- **좌표·원본 크기:** 크기/위치/선의 좌표를 유지하고 crop·확대/축소·회전·이동하지 않는다. 모든 mask==0 RGB 최대 오차 0, 전체 alpha 최대 오차 0, 주석으로 지정한 다른 색·중립 선의 RGB 최대 오차 0을 확인한다.
- **선·명암·색:** 빨강/초록/검정/흰색을 구분해 확인한다. 합성 파란 면의 4개 명암 단계가 순서와 구분을 유지해야 한다. 검정/흰색은 모든 픽셀을 0/255로 채워 명암을 없애는 결과를 합격시키지 않는다. 실제 마스코트에서는 원래 천의 폭·주름·술과 몸통 겹침을 실물로 비교한다.
- **fractional mask·RGBA:** 별도 [fractional-mask.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/fixtures/fractional-mask.png>)는 0/64/128/192/255를 포함한다. 동일 원본색의 표본에서 full-mask 결과를 기준으로 중간 혼합값을 확인하며 허용 오차는 RGB 1코드다. mask를 이진화해 중간값을 모두 full 색으로 바꾸면 실패다. 비균일 alpha는 독립적으로 전 픽셀 대조한다.
- **CPU 실행:** `model_calls` 정수 0이 필요하다. 이것만으로 Comfy 미접근을 확정하지 않는다. 실제 완료된 CPU 경로를 fail-on-access Comfy sentinel 또는 동등한 독립 추적으로 확인해야 한다. 준비 단계에는 제품 호출·미접근 증거를 만들지 않았다.
- **API/후보 경계:** `mode=inpaint`, `edit_operation=recolor`, target/source HEX 및 tolerance를 대조한다. null 자동 선택, tolerance 0/35/90, 생략 시 default35와 명시35의 동일 조건 결과, 범위 밖/잘못된 HEX 거부를 실제 구현에서 확인해야 한다. HEX 대소문자 차이는 동일 색으로 본다. 원본 후보/마스크/부모 관계를 보존하고 결과를 정직한 CPU 색 변경 후보로 기록하는지 UI job 인계 후 검수한다.

원본/마스크가 같은 결과를 대상으로 **목표색 반영 / 형태·선 보존 / 명암·재질·경계 / 다른 색·캐릭터 특징 보존** 4축을 모두 평가한다. 변경 픽셀 수나 단일 hue 통과만으로 시각 품질을 합격시키지 않는다. 과도한 tolerance에서 다른 hue까지 의도적으로 선택한 경우는 default35의 다른 색 보존 사례와 섞지 않는다.

**준비한 검사 묶음과 도구**

[prepare_fixtures.py](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/prepare_fixtures.py>)로 PNG 13개·검사 case 15개를 만들었다. red/green/black/white의 명시 기준색 RGBA·자동 기준색 RGB, default35 대조, fractional RGBA, 실제 마스코트 4색 및 통합용 RGBA가 포함된다. 검증 시점의 해시·크기·alpha 분포는 [preparation-verification.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/preparation-verification.json>)에 있다.

[qa_recolor_quality.py](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/qa_recolor_quality.py>)는 제품 모듈을 가져오거나 색을 바꾸지 않는다. 받은 결과/기록을 오프라인 판독하고, 자료가 없는 Comfy 미접근·후보 복원은 미확인으로 남긴다. 예를 들어 총괄이 결과를 제공하면 프로젝트 루트에서 다음 형태로 실행한다.

```text
.venv-macos/bin/python -B runtime/macos/recolor-quality/qa/qa_recolor_quality.py
  --manifest runtime/macos/recolor-quality/qa/fixtures/manifest.json
  --case integration-red-rgba --result <실제 결과 PNG>
  --metrics <실제 metrics JSON> --recipe <실제 recipe JSON>
  --output runtime/macos/recolor-quality/qa/integration-result.json
```

위 줄들은 하나의 명령 인수다. `--trace`는 실제 완료된 sentinel 기록이 있을 때만 추가한다. CLI exit 0은 사전에 정한 이미지 표본과 제공된 기록 조건이 통과했다는 뜻이며, 출력의 `quality_verdict`는 항상 `requires_visual_review`다. 명암/target 표본의 hue·tone 한계값은 합성 불투명 표본용 진단 조건이며 일반 이미지의 지각 품질 정의가 아니다.

[판독기 집중 테스트](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/test_qa_recolor_quality.py>) **14건 통과**를 [auditor-tests-green.log](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/auditor-tests-green.log>)에 기록했다. 밖 1픽셀·알파·다른 색·가는 선 훼손, 크기 변경, 잘못된 목표색, 명암 평탄화, fractional 이진화, model_calls>0, 요청 mode 변경과 HEX 대소문자·잘못된 bool trace를 확인한다. 테스트의 손으로 만든 색 표본은 **판독 도구 검증용**이며 제품 recolor 결과가 아니다. 전체 제품 테스트와 API 경계값 실행은 아직 하지 않았다.

**실제 마스코트 비교와 남은 검증**

`ai/baseline`의 원본/마스크를 byte 그대로 [mascot-original.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/fixtures/mascot-original.png>)·[mascot-mask.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/fixtures/mascot-mask.png>)에 복사했다. 선택 안 갈색 몸통의 수동 표본 `(525,660)`·`(710,770)`도 보호 주석에 넣었다. 이는 해당 두 표본의 보존 확인이며 전체 몸통/물체 분할을 대신하지 않는다.

사전 계획은 원본·기존 SDXL 실패·새 CPU 결과의 같은 좌표 비교와 독립 지표/4축 판정이었다. 아래 후속에서 실제 함수·Engine·HTTP 및 UI 색상 job을 검수했다. 이전 실패의 실행 성공·보존 조건을 새로운 색 변경 품질의 합격 근거로 가져오지 않았다. 프로젝트 저장·복원·후보 내용 비교의 최종 검수는 후속 4에 있다.

**변경 파일:** 이 보고서와 `runtime/macos/recolor-quality/qa/`만. 기존 제품 소스·inpaint QA 도구·다른 담당 파일 변경이나 다른 채팅 메시지는 수행하지 않았다.

**후속 1 — 선택 OKLab의 실제 함수·Engine 실행**

[execute_offline_matrix.py](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/execute_offline_matrix.py>)로 실제 `pankeki.recolor.recolor`와 `Engine`+`JobManager`를 호출했다. 수정하지 않은 기존 독립 판독기와 fixture 15개를 사용했고, 결과는 [execution/summary.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/execution/summary.json>)·[offline-matrix.log](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/offline-matrix.log>)에 기록했다. 모두 `oklab-recolor-v1`이며, 15개 함수 결과와 별도 Engine 결과의 전 RGBA 최대 차이는 각각 0이다.

| 실행/검사 | 결과 | 해석 범위 |
| --- | --- | --- |
| 실제 함수 15건 | 15/15 이미지/색/명암 표본 통과 | 알고리즘 호출이며 API/job 성공을 대신하지 않음 |
| 실제 Engine+JobManager 15건 | 15/15 succeeded·고정 판독 통과 | 개인 QA root, `models={}`. 실제 Comfy에 연결할 수 없는 fail-on-access sentinel 사용 |
| Comfy sentinel | 자기 방어 동작 확인 후 실제 Engine 접근 **0회** | 접근 시 즉시 예외를 내므로 fingerprint·discovery·upload·execute를 수행할 수 없음 |
| 실행 metadata | 전부 `local_recolor`, `model_calls=0`, model_used/denoiser/GPU false | CPU 경로의 실제 저장 recipe·metrics와 대조 |
| 검증 경계 | 잘못된 HEX/source/tolerance 11건 거부, 0/35/90 허용 | 실제 Engine validator 호출. HTTP 오류 응답까지 재실행한 것은 아님 |
| default35 | 생략/명시35의 함수 및 Engine 결과 RGBA 차이 0 | 같은 입력에서 실제 출력 비교 |

작은 합성 표본과 fractional case는 **feather 0**으로 색/마스크 혼합을 분리했다. 1024 RGBA 통합용 fixture와 마스코트 4색은 기존 기본 **feather 4**로 실행했다. 설정을 사후에 바꾸거나 실패를 통과시키도록 판독 기준을 수정하지 않았다. 자체 실행은 개인 QA 폴더 안의 Engine 파일 기록이며 HTTP/앱 서버나 브라우저 실행이 아니다.

합성 RGBA red/green/black/white에서 밖 RGB·전체 alpha·다른 색 보호 패치·중립 ink/highlight 오차는 모두 0이다. 검정 tone 표본은 `12/22/46/70`, 흰색은 `166/235/237/240`으로 네 단계의 순서와 구분이 남는다. fractional 혼합 최대 오차는 **0.4471 RGB 코드**로 사전 한계 1 이하이며 이진 mask 결과가 아니다. 1024×1024 통합 fixture에서도 alpha 768,000개 비불투명 픽셀을 포함한 전체 alpha, 1픽셀 선, 보호 영역의 오차가 0이다.

**AI가 제공한 실제 선택 후보의 독립 판독**

[ai-observed/summary.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/ai-observed/summary.json>)에 AI의 과거 Engine 결과를 별도로 대조했다. 실제 [candidate-oklab.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/ai/candidate-oklab.png>)는 AI red Engine job `55f04a7cf0c44842a90e247180d16433`와 SHA가 일치한다. red/green/black/white/작성된 RGBA-red 5건 모두 같은 고정 판독을 통과했고, empty-mask/no-match/same-color 3건은 RGBA 차이 0·정확한 skipped 사유·model_calls 0을 확인했다. 과거 AI의 sentinel 설명과 QA가 직접 센 새 Engine 접근 0회는 구분했다.

AI red/green 요청은 `#FF0000`/`#00FF00`, QA 기본 fixture는 `#E3342F`/`#249E55`이므로 실제 요청값을 별도 observed manifest에 선언해 대조했다. 원래 fixture·보호 표본·판독 한계값을 바꾼 것은 아니다. AI method-comparison의 색/밝기 수치는 생산자 분석 자료이며 QA의 독립 수치나 공정한 속도 benchmark로 다시 표현하지 않았다.

**후속 2 — 총괄이 실행한 실제 HTTP job 6건**

총괄이 `8191`에서 실행한 receipt/job/model-catalog/입력·결과 복사본과 연결된 `runtime/runs/<job_id>`를 오프라인으로 독립 판독했다. [http-independent/summary.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/http-independent/summary.json>)에 원본/마스크 fixture 해시, 서버 원본의 RGBA, 결과 복사본/서버 해시, recipe canonical hash, 실제 request 필드와 CPU metadata의 대응을 기록했다. QA가 HTTP/API를 호출한 것은 아니다.

| HTTP 대상 | job ID | 원본 크기 | 내부 변경 픽셀 | 독립 판독 |
| --- | --- | --- | --- | --- |
| RGBA red | `a95e513709d344faae1b1ee552adf9b3` | 96×64 | 1,264 | 통과 |
| RGBA green | `0edd7f6d38404f32988517a4542d90d3` | 96×64 | 1,264 | 통과 |
| RGBA black | `d5259f6d99244a66ac0bbdc6d7bf2cc6` | 96×64 | 1,264 | 통과 |
| RGBA white | `fcd4d0d3ebb548d1b66be9febb40a491` | 96×64 | 1,264 | 통과 |
| fractional RGBA red | `ef1c307810b847c3b58479d9f73b6ec5` | 96×64 | 1,142 | 통과 |
| 실제 mascot red | `38da827514004e64a4cad765dd7de10a` | 1024×1024 | 63,761 | 통과 |

6건 모두 밖 RGB/전체 alpha/보호 표본 최대 오차 **0**, model_calls **0**이다. RGBA 5건은 QA가 만든 소형 원본이며 비불투명 픽셀은 각 4,320개다. 4색 tone 순서와 fractional 0.4471 오차도 사전 조건을 통과했다. 앞 5건은 동일 feather0 QA Engine 결과와 RGBA 차이 0이다. mascot HTTP는 feather0, QA 기본 mascot 행렬은 feather4이므로 두 프로필의 byte 동일성을 주장하지 않는다.

HTTP catalog에는 사용 가능한 모델과 기본 모델이 없고, 저장된 offline-config는 `models={}`다. Comfy URL `127.0.0.1:1`은 총괄이 전달한 시작 조건이며 해당 config JSON에는 URL이 없다. 실제 HTTP process의 모든 network syscall을 직접 계수한 것은 아니다. HTTP의 CPU 지표/모델 없는 성공과, 별도 실제 Engine에서 QA가 얻은 fail-on-access 접근 0회 증거를 구분해 CPU 경로를 수용한다.

이 HTTP RGBA 대조군은 **96×64**다. 1024 RGBA fixture의 함수/Engine 통과를 1024 RGBA HTTP 또는 UI 통과로 확대하지 않는다. 첫 UI 색상 job은 후속 3, 후보 내용/부모 관계·저장·복원·비교는 후속 4에서 별도 판독했다.

**4축 실물 비교와 수용 범위**

원본, 기존 SDXL `.99`의 형태 손상 결과, 실제 CPU/HTTP red 및 함수 green/black/white를 직접 열람했고 [actual-visual-review.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/actual-visual-review.json>)에 이미지 SHA와 관찰을 남겼다. 기존 SDXL 실패는 실패 양상의 참고이며 다른 방법/설정 사이의 동등 조건 benchmark가 아니다.

| 품질 축 | 해당 fixture/마스코트 판정 |
| --- | --- |
| 목표색 반영 | **충족:** 선택한 스카프가 빨강·초록·검정·흰색으로 읽힌다. 색 표본만으로 판정하지 않고 전체 실물을 함께 봤다. |
| 형태·가는 선 | **충족:** 목 감김·늘어진 천의 폭과 외곽·주름·술 위치가 유지된다. 합성 1픽셀 선/ink도 정확히 보존됐다. |
| 명암·재질·경계 | **충족, 해당 표본:** 기존 하이라이트와 짙은 주름이 남고 검정/흰색에서도 면이 단색으로 평탄화되지 않았다. fractional 중간값은 수치로 대조했다. |
| 다른 색·캐릭터 특징 | **충족, 선언한 표본 범위:** 얼굴·표정·몸통·파란 장갑/신발·배경 유지. mask 밖 전 RGB, 합성 보호 영역과 마스코트의 두 수동 갈색 표본 오차 0. |

**범위 한정 수용:** 고정 fixture와 한 마스코트에서 형태를 유지하는 CPU 색 변경을 수용한다. 자연 RGBA 사용자 그림, 자동 물체 분할, 동일 hue의 여러 물체 구분 또는 모든 캐릭터/재질의 일반 품질을 주장하지 않는다. UI 수용 범위는 후속 3·4를 따른다. RGB 마스코트 자체는 투명 그림의 증거가 아니며 RGBA 검증은 QA/AI가 명시적으로 작성한 입력을 사용했다.

제품 소스·기존 판독기·수용 기준·fixture의 실행 전후 SHA는 [execution-input-integrity.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/execution-input-integrity.json>)에 기록했다. 이 단계의 변경은 이 보고서와 QA 전용 수집 코드/CPU 결과/독립 판독 증거뿐이다. 기존 생성·프로젝트·모션·출력 전체 회귀를 재실행하지 않았다. UI 관련 후속 수용은 다음 절과 별도 저장/복원 증거를 따른다.

**후속 3 — 실제 UI 색상 job과 전체 DOM PNG**

총괄의 [ui-api-run.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/integration/ui-api-run.json>)·[ui-checks.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/integration/ui-checks.json>)·[ui-pixel-proof.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/integration/ui-pixel-proof.json>)·[1440px 화면](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/integration/ui-result-1440.jpg>)을 서버 run `422683208182457693da00d28936a767`과 오프라인으로 대조했다. 화면 조작은 총괄이 수행했고 QA는 API/브라우저를 사용하지 않았다.

| 확인 항목 | 독립 판독 결과 |
| --- | --- |
| 잘못된 HEX | 총괄 UI 기록에 `#GG0000` 입력 시 한국어 오류와 후보 3개 유지가 있다. 서버가 invalid 요청을 받은 것으로 확대하지 않고 UI 차단 기록으로 수용했다. |
| 대소문자 정규화 | UI picker/입력 `#e3342f` → 실제 recipe `#E3342F`. 고정 판독기의 HEX 동등 규칙과 일치한다. |
| 실제 요청 경계 | mode=inpaint, edit_operation=recolor, source_color=null(auto), tolerance35, feather4. source/mask 파일 SHA는 이전 원본/마스크 및 API 기록과 모두 같다. |
| CPU 실행 | succeeded·kind=local_recolor·model_calls0·model_used/denoiser/GPU false. recipe canonical SHA도 metrics와 맞는다. |
| 후보/표시 기록 | 후보 3→4, `색상 변경 1 · 색상 변경` label, operation=recolor, 적용 버튼 활성, 이미지 1024×1024, 사이드 메뉴 11개를 확인했다. 이 단계에서 남긴 후보 내용/부모 ID·저장 지속성 항목은 후속 4에서 별도로 검수했다. |

현재 [ui-dom-link-result.png](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/integration/ui-dom-link-result.png>)는 총괄이 65,536자 청크로 전체 data URL을 회수한 PNG다. QA가 파일을 정상 PNG/CRC로 검증하고 직접 디코딩했다. 결과 파일 **1,254,567바이트 전체가 서버 `result.png`와 동일**하며 SHA는 `7847ebc19802f5fabb298f7964670c09fc0f16cacbcc0e6a1f97243ac4551854`다. 재계산한 data URL 길이 **1,672,778**도 UI 기록과 맞는다.

DOM/서버의 RGBA 변환 후 전 픽셀 최대 차이는 **0**이며, 독립 고정 판독 결과는 **밖 RGB 0·전체 alpha 0·수동 보호 표본 0·내부 변경 63,761픽셀**이다. 서버/UI 모두 1024×1024이고 이전 동일 프로필 QA 함수 결과와도 RGBA 차이 0이다. recipe에 남은 생성 width/height 기본값 512를 CPU 출력 크기로 오인하지 않았다. CPU는 실제 원본 1024 좌표를 유지했다. 이 job의 원본은 RGB/불투명이므로 UI 경로에서 비균일 RGBA까지 검증했다고 표현하지 않는다.

숫자는 [ui-independent-audit.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/ui-independent-audit.json>), byte/입력/상태 대응과 제한은 [ui-independent-evidence.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/ui-independent-evidence.json>)에 기록했다. 총괄의 pixel-proof 수치와 독립 재계산이 일치했다. 새 UI 화면과 전체 DOM PNG도 직접 열람했으며, 기존 표본 수용의 색/형태/명암/캐릭터 특징이 유지되는 결과임을 확인했다.

**당시 저장 검증의 구분:** Blob 보정 전 embedded browser의 네이티브 PNG 다운로드 event는 **두 차례 timeout**이었다. 당시 DOM 링크 PNG 확보만으로 native filesystem 저장 완료로 판정하지 않았다. 프로젝트 저장·재로드·비교도 이 첫 인계 시점에는 미완료였다. 이 이력은 보존하며, Blob 보정 후 실제 네이티브 파일과 후속 저장·복원 자료를 확인한 최종 판정은 후속 4에 있다.

**첫 단계의 범위 한정 UI 수용:** 실제 색상 요청과 결과 표시, 후보 수/정직한 색상 변경 label, 완전한 DOM PNG와 서버 결과의 정합성을 수용했다. 후속 4에서 저장·복원 수용을 추가했으며, 전체 기존 생성/모션/출력 회귀 완료를 뜻하지 않는다.

이 단계의 변경은 이 보고서와 `qa/ui-*` 독립 증거뿐이다. [ui-input-integrity.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/ui-input-integrity.json>)에 최종 입력 증거와 고정 판독기/기준/fixture 보존을 기록했다. 초기 증거 JSON의 미완료 값은 당시 상태로 남기고 최종 수용은 아래 증거로 구분했다.

**후속 4 — 실제 네이티브 저장·프로젝트 내용·변경 없음·자동 복원**

[ui-final-evidence.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/ui-final-evidence.json>)이 현재 UI 수용 요약이다. 총괄이 네이티브 다운로드·프로젝트 파일 가져오기·복원·비교 화면을 조작했고 QA는 전달된 파일과 명시된 실제 다운로드 파일만 읽었다.

| 단계 | 확인 결과 |
| --- | --- |
| 네이티브 PNG | Blob 보정 후 완료 event를 총괄이 관측했다. QA가 실제 Downloads 원본 `pankeki-36c36a47-5ec8-4362-a8cb-9a1525b2b2a9.png`와 [수집 복사본](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/integration/ui-native-downloaded.png>)을 읽었다. 원본·복사본·DOM PNG·서버 PNG·프로젝트 내 색상 PNG 모두 1,254,567바이트, SHA `7847ebc19802f5fabb298f7964670c09fc0f16cacbcc0e6a1f97243ac4551854`로 같다. 앞의 두 timeout은 보정 전 이력이다. |
| 프로젝트 네이티브 저장 | [project-save-proof.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/integration/project-save-proof.json>)의 네이티브 완료 기록과 [ui-saved-project.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/integration/ui-saved-project.json>)의 실제 내용을 대조했다. v1 후보 4개의 PNG를 모두 완전 디코딩/검증했고 전부 1024×1024다. ID는 유일하며 모든 부모 ID가 존재한다. 색상 후보의 부모는 업로드 원본이고 원본 PNG와 바이트가 같다. 기존 SDXL 후보의 model_calls1 기록과 새 local_recolor 후보의 model_calls0 기록도 구분해 보존됐다. |
| 파일 가져오기 | 저장 파일을 UI로 가져온 뒤 후보 4개·operation=recolor·목표색 `#E3342F`·기준색 auto·tolerance35 복원 기록을 확인했다. 저장된 색상 후보에는 mode=inpaint, edit_operation=recolor, source_color=null, feather4와 CPU metrics가 유지된다. |
| 빈 마스크 | 실제 UI job `a008810514db47059d89f195906169c3`는 이전 빨강 결과를 원본으로 사용했다. mask 전부 0, 원본/결과 PNG 바이트 동일, 전 RGBA 오차0, selected/changed0, skipped=empty-mask, model_calls0이다. UI는 `색상 변경 2 · 변경 없음`으로 표시하고 후보 5개가 됐다. 양성 색상 변경 표본의 기준을 낮춘 것이 아니라 예상된 복사 동작을 별도 검사했다. |
| 자동 복원 | 이른 탐색/입력 없이 자동 복원이 끝날 때까지 대기한 흐름에서 후보 5개·operation=recolor·목표색 `#E3342F`가 복원됐다. 먼저 탐색하면 기존 restore epoch 보호가 복원을 취소하는 이력과 구분했다. 보호 장치를 약화하거나 수정했다고 주장하지 않는다. 상태 문구에 따라 편집 마스크는 다시 칠해야 하며 마스크 지속성을 주장하지 않는다. |
| 후보 비교 | [최종 1440×900 비교 화면](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/integration/ui-compare-final-1440.jpg>)을 직접 열람했다. DOM 기록은 업로드 원본/색상 변경1 두 이미지의 실제 크기를 각각 1024×1024로 보존하고, 메뉴 11개와 recolor에서 생성 스타일 숨김을 확인한다. |

프로젝트/빈 마스크의 독립 체크와 후보 4개의 개별 SHA·부모 관계는 [ui-project-noop-evidence.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/ui-project-noop-evidence.json>)에 있다. 시점은 **프로젝트 저장 4개 → 파일 가져오기 4개 → 빈 마스크 동작 5개 → 대기 후 자동 복원 5개**다. 저장 파일이 빈 마스크 후보보다 앞서므로 저장 파일에 다섯 번째 후보가 없다는 이유로 실패 처리하지 않는다. 자동 복원 후 다섯 후보의 개별 PNG 바이트를 모두 재추출한 것은 아니다.

**최종 UI 수용 범위:** 기록된 한 RGB 마스코트에서 색상 요청/표시·네이티브 PNG·v1 프로젝트 저장/가져오기·빈 마스크·대기 후 복원·두 후보 비교를 수용한다. PNG/프로젝트 네이티브 event 자체는 총괄의 관측이고 QA는 산출 파일과 기록을 독립 검증했다. 자연 RGBA UI, 모든 작품의 품질, 전체 생성/모션/출력, v2 프로젝트 회귀로 확대하지 않는다.

**후속 5 — 직접 지정한 한 픽셀 기준색의 샘플 누락 회귀**

총괄이 발견한 257×257 파랑 전체 + `(1,0)` 빨강 한 픽셀, full mask255, source=`#FF0000`, target=`#00FF00`, tolerance35, feather0 사례를 추가했다. 선택된 가시 픽셀 66,049개에서 context stride2가 flat index1을 건너뛰는 경계다. 기존 fixture·판독기·기준을 바꾸지 않고 별도의 [추가 수용 기준](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/manual-reference-regression/acceptance-criteria.json>)을 실행 전에 저장했다.

[execute_manual_reference_regression.py](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/execute_manual_reference_regression.py>)는 직접 기준색 fallback 블록만 제거한 코드를 메모리에서 구성했다. 그 전체 SHA가 과거 동결 원본 `ba8f7874fbfef670c40b1f55b49df3e2ceab47b65715c91eaafbe85209631c9a`와 정확히 같아야만 비교를 진행했다. 제품 파일을 되돌리거나 수정하지 않았다. 보정 후 제품 SHA는 `e909e99287944a08285b8f88a76dcbb9e86dcff4732da45998a40ecb005c74f4`다.

| 회귀 대상 | 보정 전 재현 | 보정 후 실제 함수·Engine |
| --- | --- | --- |
| 미세 기준색 RGB | no-matching-color·변경0, 양성 기준 실패 | 목표 픽셀 `(0,255,0,255)`, selected1·변경1·skip 없음 |
| 미세 기준색 RGBA | no-matching-color·변경0, 양성 기준 실패 | 목표 픽셀 `(0,255,0,128)`, selected1·변경1·skip 없음 |
| 기준색 없음, 파랑만 존재 | no-matching-color·정확한 원본 복사 | 같은 no-matching-color·전 RGBA 정확한 복사 |

현재 함수/Engine 3건씩은 모두 추가 기준을 통과했다. 양성 두 건의 나머지 **66,048픽셀 RGB 오차0**, 전체 alpha 오차0이며 비균일 alpha64/128/255를 보존했다. full mask이므로 mask 밖 표본이 있다고 주장하지 않는다. 실제 Engine은 모델 없는 QA 개인 root와 fail-on-access Comfy sentinel을 사용해 model_calls0·접근0을 확인했고 함수/Engine 전 RGBA 차이0이다.

직접 기준색을 쓰지 않는 자동 선택 대조도 두 건 확인했다. 같은 미세색 입력과 기존 마스코트 자동 선택 모두 보정 전후 RGBA 차이0이며, 마스코트는 기존 동결 QA 결과와도 차이0이다. 이 결과는 기존 자동 기준색 UI/PNG 증거를 새 실행 결과로 바꾸지 않는다.

[manual-reference-regression/summary.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/manual-reference-regression/summary.json>)에 소스/입력 해시·실제 결과·회귀 판정을 기록했다. 최초 QA 수집기는 생성용 width/height에 257을 넣어 기존 8배수 validator에서 실행 전에 거부됐다. 그 [시도 기록](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/recolor-quality/qa/manual-reference-regression-attempt1/attempt-error.json>)을 보존하고, 유효한 생성 필드512와 실제 원본/결과257을 분리한 뒤 다시 실행했다. 제품 validator나 크기 보존 기준을 변경하지 않았다. 새 HTTP/UI/GPU 시험은 수행하지 않았고 최종 runtime 반영은 총괄 범위다.

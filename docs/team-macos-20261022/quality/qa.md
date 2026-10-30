# 부분 수정 품질 스프린트 — 독립 QA

**최신 추가 — 2026-10-23 KST 전용 SDXL inpaint 2차:** 새 직접 실험 3건을 완료된 아티팩트로 독립 판독했다. 픽셀 보존·실제 sampler 실행·SaveLatent 유한성·두 가중치 provenance·9채널 그래프 구성은 확인했지만, **전용 방식 .65/.99 모두 빨강 지시 미충족으로 품질 미수용**이다. Base .99도 일부 빨강과 큰 형태 손상으로 미수용이다. 이는 고정 샘플의 **모델+필수 9채널 conditioning 방식 비교**이며 UNet 단독 효과나 앱 통합 완료로 표현하지 않는다. 상세는 마지막 2차 절과 전용 증거에 있다.

**통합 UI 판정 — 2026-10-23 KST:** 앱 job `ef48762b02b2449eb486138a3d46234e`가 기존 독립 판독기를 통과했다. 편집 설명 단독 제출·서버 결과의 밖 RGB/알파 보존을 확인했고, UI 전환·후보 수는 총괄의 브라우저 기록과 대조했다. DOM source의 비암호학적 지문 4항목은 일치하지만 **독립 RGBA 픽셀 동일성은 확인하지 않았다.** 아래 통합 UI 후속 절을 기준으로 읽는다. 이 수용은 요청 연결과 보존성 범위이며 모델 품질 개선 판정이 아니다.

**새 4건 실험 판정 — 2026-10-23 KST:** 새 4건의 독립 수용 판독을 완료했다. 모두 밖 RGB/알파 오차 0과 실제 sampler 실행 기록을 확인했으나 **시각 품질 4건 모두 미수용**이다. 앱 job 2건은 기존 도구의 엄격한 검증을 통과했고, Comfy 직접 실험 2건은 별도 수동 대조로 판독했으며 앱 통합 성공으로 인정하지 않았다. 상세 후속 결과는 문서 아래에 기록했다. GPU·API·브라우저·서버·제품 소스·기존 QA 스크립트는 조작하지 않았다.

**2026-10-22 준비 기록:** [실행 배정](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/docs/team-macos-20261022/quality-sprint.md>)에 따라 오프라인 검증 도구를 준비하고 **기존 실제 결과 3건**에 사용했다. 당시 판정은 기술적 보존 증거 확인 / 시각 품질 수용 보류 / 새 후보 수용 대기였다.

**검증 도구와 독립 판독 기준**

[scripts/qa_inpaint_quality.py](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/scripts/qa_inpaint_quality.py>)는 제품 모듈을 가져오지 않고 각 job 디렉터리의 `original.png`, `mask.png`, `result.png`, `recipe.json`, `workflow.json`, `metrics.json`만 읽는다. 기존 [verify_sdxl_macos.py](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/scripts/verify_sdxl_macos.py>)는 API/추론을 실행하므로 읽기만 했다. 설치된 `.venv-macos`의 Pillow 12.3.0·NumPy 2.3.5를 사용했다.

- 원본/마스크/결과 크기가 다르면 실패하며 자동 크기 보정은 하지 않는다. 마스크는 `L > 0`을 내부로 삼고 signed 정수 차이로 **밖 RGB 최대 오차 0, 전체 알파 최대 오차 0, 내부 RGB 변경 픽셀 > 0**을 다시 계산한다. 빈 마스크와 밖 영역 없는 전면 마스크는 보존 검증을 통과시키지 않는다.
- 파일 SHA-256과 저장된 recipe/workflow의 canonical SHA-256을 대조한다. job ID, 모델 ID/체크포인트 이름, 실제 KSampler에 연결된 positive/negative 텍스트와 seed/steps/cfg/sampler/scheduler/denoise를 recipe와 비교한다. 전체 정규화 recipe·크기·SHA·시간은 결과 JSON에 남긴다. 이는 저장된 실행 요청 근거이며, 당시 원본 HTTP POST를 새로 캡처한 것은 아니다.
- `model_calls=1`이나 `denoiser_executed=true`만으로 새 추론을 인정하지 않는다. 같은 prompt ID의 sampler `executing`, 성공 event/history, 완료 상태를 확인하고 exact cache hit·sampler 캐시 노드를 배제한다. 기록이 모자라면 `not_proven`, 캐시이면 `cache_hit`다. 실제 하드웨어를 이번에 관찰한 결과와 과거 실행 기록 판독을 구분한다.
- baseline/후보의 원본·마스크 SHA, seed, 모델 ID/이름과 기술 검증을 맞춘 뒤 변경 request 필드를 센다. 두 변수 이상이면 `comparable=false`다. 코드/환경 provenance 차이는 별도 표시하며, 모델 가중치 파일 자체를 다시 해시하지는 않는다.

**기존 결과에 실제 적용한 결과** — [전체 판독 JSON](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/qa/existing-runs.json>)

| job / 기존 설정 | 밖 RGB / 알파 최대 오차 | 내부 변경 픽셀 | 실행 기록 | 실물 육안 판독 |
| --- | --- | --- | --- | --- |
| [f172dcb…](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/runs/f172dcbfe7284f25b4db6a8b6c530081/result.png>), denoise 0.65 | 0 / 0 | 78,395 | 새 sampler 실행 기록, cache off | 빨간 목도리 지시에도 파란 목도리가 남음. |
| [0525a0d…](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/runs/0525a0d4c9b9489fabfc80f6b5d8f704/result.png>), denoise 0.90 | 0 / 0 | 78,407 | 새 sampler 실행 기록, cache off | 파랑/회색이 넓게 남고 빨강이 일부만 반영됨. |
| [3a9a661…](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/runs/3a9a661a82a84622ab6ef61cc13986d0/result.png>), denoise 1.00 | 0 / 0 | 78,401 | 새 sampler 실행 기록, cache off | 빨강은 생겼으나 파란 고리형 요소·아래 빨간 띠 등 요청하지 않은 형태 변화가 보임. |

세 건 모두 원본/마스크/결과 1024×1024, 내부 78,410픽셀·밖 970,166픽셀, 밖 변경 0이다. 기존 검증 요약의 숫자와 독립 재계산이 일치한다. 그러나 원본은 모두 RGB이고 비불투명 픽셀은 0이므로, **반투명 원본의 제품 알파 보존을 입증한 자료는 아니다.**

세 건의 원본/마스크/seed/모델은 같지만 prompt·negative·denoise **3개 필드가 함께 달라** 두 비교 모두 `comparable=false`다. 따라서 새 스프린트의 한 변수 baseline/개선 증거나 품질 개선 수치로 사용하지 않는다. 기존 summary의 `file`은 공용 `edited.png`를 가리켜 덮어써졌으므로 위 job별 원본 아티팩트를 사용했다. 판독 전후 18개 입력 파일의 해시 불변은 [input-integrity.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/qa/input-integrity.json>)에 남겼다.

**도구 검증과 한계**

[오프라인 집중 테스트](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/qa/test_qa_inpaint_quality.py>) **15건 통과**: 밖 1픽셀 훼손(255 차이), 알파 훼손, 무변경 결과, 크기 불일치, 빈/전면/미세 마스크, exact/sampler 캐시, 실행 event 누락/다른 prompt, 해시/recipe 불일치, 다른 체크포인트와 다변수 비교를 검출한다. 구현 전 실패와 비교 판정 결함 재현 로그를 보존했고 최종 통과는 [tests-green.log](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/qa/tests-green.log>)에 있다. 전체 제품 테스트는 재실행하지 않았다. 합성 RGBA 사례는 **QA 도구**의 알파 판독 검증이며 제품의 실제 투명 이미지 추론 검증과 다르다.

CLI exit 0은 기술 검증 통과만 뜻한다. JSON의 시각 품질은 항상 `not_evaluated`이며 이미지의 지시 준수·의도하지 않은 형태 변화·경계/재질·캐릭터 특징 유지는 실물로 따로 판정한다. 현재 built-in KSampler/CLIPTextEncode/CheckpointLoaderSimple 이외 그래프는 수동 검토가 필요하다. 저장·후보·프로젝트·모션·출력 UI의 실행 회귀도 이번 오프라인 판독으로 대체하지 않는다.

**준비 단계에서 정한 수용 순서** — 1~2번은 아래 새 4건에 적용했고, 3번 실행 회귀는 여전히 미실행이다.

1. 총괄이 지정한 baseline/후보 경로에 위 6개 아티팩트와 고정한 원본/마스크/seed/모델·한 변수 가설이 있는지 확인한다. 후보 도착 전에는 GPU/API에 접근하지 않는다.
2. 같은 판독기에 두 경로를 넣어 `--output runtime/macos/inpaint-quality/qa/candidate-comparison.json`으로 저장한다. 모든 기술 조건, `comparable`, provenance 차이를 확인한 뒤 4개 시각 축을 판정한다. 색 반영만으로 형태 손상을 덮지 않는다.
3. 총괄이 순서를 배정한 뒤 기존 프로젝트의 원본/마스크/후보 유지, v1/v2 저장·복원, 모션/PNG/48프레임 출력을 관련 범위만 재현한다. 미실행 항목·불합격·한계를 별도 기록한 다음 최종 수용을 보고한다.

**준비 단계 변경 파일:** `scripts/qa_inpaint_quality.py`, 이 보고서, `runtime/macos/inpaint-quality/qa/` 안의 집중 테스트·red/green 로그·판독 JSON·입력 해시 기록. 기존 onboarding 인계와 제품 소스·다른 담당 문서는 변경하지 않았다.

**2026-10-23 후속 — 새 4건의 독립 수용**

baseline/prompt-only는 `edit-job.json`에서 연결된 실제 `runtime/runs`를 기존 판독기에 넣었고, AI 폴더 복사본과 연결된 run의 원본/마스크/결과/recipe/workflow/metrics 6개씩의 해시도 모두 일치했다. neutral/preserve-normal은 코드 변경 전 Comfy 직접 그래프 실험이다. [new-four-strict-audit.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/qa/new-four-strict-audit.json>)의 **CLI exit 1을 그대로 보존**했다. 도구를 약화하거나 없는 앱 상태/해시/job 필드를 채워 통과시키지 않았다.

| 대상 / 실행 경로 | 연결 ID | 밖 RGB / 알파 최대 오차 | 내부 변경 픽셀 | 기존 앱 검증 도구 |
| --- | --- | --- | --- | --- |
| [baseline](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/baseline/result.png>) · 앱 job | `f81c5ae1a15348578eaa418f38d978c9` | 0 / 0 | 78,395 | 통과 |
| [prompt-only](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/prompt-only/result.png>) · 앱 job | `4ea0fc286c9b481aa48c1a8a3f33d045` | 0 / 0 | 78,399 | 통과 |
| [neutral-065](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/neutral-065/result.png>) · 직접 실험 | `experiment-14bd526ff3354385b1dd63e1c9384517` | 0 / 0 | 78,410 | 앱 계약 범위 밖·미통과, 수동 대조 |
| [preserve-normal-065](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/preserve-normal-065/result.png>) · 직접 실험 | `experiment-7200682948bb4310b622631df22e5203` | 0 / 0 | 78,400 | 앱 계약 범위 밖·미통과, 수동 대조 |

숫자는 이번에 다시 계산했으며 각 summary/verification과 일치했다. 공통 원본 SHA는 `604aa7eb…1819`, 마스크 SHA는 `7d105bec…2481`, 크기는 원본/마스크/결과 모두 1024×1024다. 선택 안 78,410픽셀, 밖 970,166픽셀이고 밖 변경 픽셀은 모두 0이다. seed `20261023`, SDXL Base/`sd_xl_base_1.0.safetensors`, 25 steps, CFG 6, `dpmpp_2m`, denoise 0.65, negative 빈 문자열, ROI false, feather 4, 기록된 backend source fingerprint도 같다. **원본 4건 모두 RGB·비불투명 픽셀 0**으로 투명 원본의 알파 보존은 계속 미검증이다. 모델 가중치 바이트는 이번에 재해시하지 않았다.

**직접 실험의 수동 대조 근거** — [new-four-manual-evidence.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/qa/new-four-manual-evidence.json>)

- 앱 도구의 두 직접 실험 미통과 항목은 결과/recipe/workflow 해시 계약, job ID, 모델 메타데이터를 포함한 recipe 대조, 앱 완료·실행 필드다. 직접 metrics에는 해당 앱 필드가 없으므로 이것을 픽셀 훼손이나 sampler 미실행으로 해석하지 않는다. 동시에 앱 job 성공으로 승격하지도 않는다.
- `recipe`/`summary`/`submitted`/`attempt-started`의 experiment ID가 일치하고, summary/submitted/metrics의 Comfy prompt ID도 각각 일치한다. neutral은 `f7a931cd-1d67-47a9-821a-3c99001840e1`, preserve-normal은 `34095f7a-c611-46aa-974b-7159efe55cd3`이다. 두 건 모두 같은 prompt의 node 5 `executing`과 history `execution_success`, sampler가 제외된 캐시 목록을 확인했다. 앱 2건에서도 같은 증거와 `cache=off`를 확인했다. 다른 prompt나 오류/중단 event는 없었다. 이는 **저장된 실제 실행 기록 판독**이며 QA가 새 GPU 작업을 한 것은 아니다.
- 원본 RGB+반전 마스크 알파로 업로드 PNG를 독립 재구성한 해시가 4개 workflow의 LoadImage 파일명과 같다. 연결된 positive/negative 텍스트와 sampler 설정도 recipe와 일치한다. 직접 실험 summary의 원본/마스크/결과 SHA도 실제 파일과 맞는다.
- 직접 실험의 `raw.png`에 원본과 `min(mask, GaussianBlur(mask, radius=4))`를 적용해 정수 RGB 합성을 별도로 계산했다. 두 결과 모두 저장된 `result.png`와 RGB 최대 차이 0이다. 제품 composite 함수를 호출하지 않았다. 따라서 새 결과와 기록의 대응·픽셀 보존은 확인했지만, 앱 저장/후보/취소/모션 경로를 통과했다는 증거는 아니다.

**실제 변수 차이**

| baseline 대비 | workflow의 실제 차이 | 비교 해석 |
| --- | --- | --- |
| prompt-only | node 2의 positive `text`만 짧은 빨간 스카프 지시로 변경 | 동일 앱 경로의 prompt 한 변수 비교. negative·강도·scheduler 유지. |
| neutral-065 | node 8 `VAEEncode` → `VAEEncodeForInpaint`, mask 입력 추가, `grow_mask_by=0` 추가 | encoder 서브그래프 하나의 변경이며 leaf 차이는 3개다. prompt/sampler 설정은 baseline과 같다. |
| preserve-normal-065 | node 5 scheduler `karras` → `normal`만 변경 | scheduler 한 변수 그래프 비교. encoder는 기존 `VAEEncode`다. |

직접 실험의 recipe에는 experiment/route/cache/comparison 등 실행 추적 메타데이터가 추가된다. 이를 생성 조건 여러 개가 바뀐 것으로 오인하지 않고 실제 graph 차이와 구분했다. 다만 앱↔직접 Comfy라는 실행 경로 차이는 유지하며, 이 결과를 backend가 통합·채택된 증거로 사용하지 않는다.

**4개 품질 축의 실물 판정** — 원본 1장·마스크 1장·결과 4장을 직접 열람했고 [new-four-visual-review.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/qa/new-four-visual-review.json>)에 파일 해시와 관찰을 기록했다. `(390,560)`, `(590,675)`, `(645,580)`이 선택 내부임도 확인해, 선택 밖에 보존된 파랑을 지시 실패로 세지 않았다.

| 대상 | 지시 반영 | 의도치 않은 형태 변화 억제 | 경계·재질 | 캐릭터 특징 유지 |
| --- | --- | --- | --- | --- |
| baseline | **미충족:** 선택 내부의 스카프가 파랑으로 남음. | **일부 충족:** 목 감김·늘어진 방향은 유지하나 주름·술 배치가 바뀜. | **일부 충족:** 기존 굵은 선·명암은 남지만 술 끝 선이 얽히고 밝은 조각이 남음. | **충족:** 이 샘플의 얼굴·미소·큰 몸 실루엣·팔·신발·배경 유지. |
| prompt-only | **미충족:** 직접적인 빨강 지시에도 주색이 파랑. | **미충족:** 늘어진 천·술이 여러 갈래로 갈라지고 끝 길이·겹침이 달라짐. | **미충족:** 하단 천·술·어두운 띠의 접합이 복잡해지고 연속성이 깨짐. | **일부 충족:** 얼굴·팔다리·포즈는 남지만 의상 끝 구조가 바뀜. |
| neutral-065 | **미충족:** 빨강 대신 회색 면이 선택 영역을 덮음. | **미충족:** 주름·술이 사라지고 마스크 다각형 같은 면으로 바뀜. | **미충족:** 평평한 회색 패치가 기존 천의 선·광택과 어울리지 않음. | **일부 충족:** 선택 밖 특징은 유지되나 스카프 특징이 훼손됨. |
| preserve-normal-065 | **미충족:** 스카프가 여전히 파랑. | **일부 충족:** 큰 방향은 유지하나 주름·술 배치가 달라 색만 바꾼 결과가 아님. | **일부 충족:** baseline과 비슷한 선·광택, 술 끝의 어두운 선·밝은 조각이 남음. | **충족:** 이 샘플의 얼굴·몸 큰 실루엣·팔·신발·포즈·배경 유지. |

**수용 결론:** 네 건 모두 핵심 빨강 지시를 충족하지 못해 **품질 미수용**이다. prompt-only는 입력 문구를 직접적으로 만들어도 이 샘플에서 색 변경에 성공하지 않았고, neutral은 천의 형태·재질이 더 훼손되며, scheduler normal도 baseline 대비 수용할 개선을 보여주지 못했다. 밖 RGB 보존·내부 변경·sampler 실행만으로 품질 합격을 표시하지 않는다. 이번 결과는 backend 변경 채택 근거가 되지 않는다.

프론트의 요청 충돌 제거와 최신 빌드는 총괄의 별도 브라우저 검수 범위다. 위 4건은 최신 프론트 통합 이후 UI 요청/생성/후보 저장 검증을 대신하지 않는다. v1/v2·모션·출력·실행 중 취소도 이번에 재현하지 않았다. 단일 불투명 마스코트·한 seed의 평가이므로 다양한 캐릭터나 투명 경계의 일반 성능을 주장하지 않는다.

**이번 변경:** 이 보고서와 `runtime/macos/inpaint-quality/qa/new-four-*` 증거만 추가/수정했다. 입력 46개 파일과 기존 QA 스크립트의 해시 불변은 [new-four-input-integrity.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/qa/new-four-input-integrity.json>)에 기록했다. 전체 제품 테스트·새 추론·API·브라우저·서버 재시작·제품 소스 변경·다른 채팅 메시지는 수행하지 않았다. 총괄의 다음 배정을 기다린다.

**2026-10-23 통합 UI 후속 — 실제 앱 job 독립 판독**

대상은 [서버 run](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/runs/ef48762b02b2449eb486138a3d46234e/recipe.json>)이다. 원본/마스크 파일 선택 → 편집 입력 → 제출이라는 화면 조작은 총괄이 수행했고, QA는 [ui-checks.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/integration/ui-checks.json>)·[ui-api-run.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/integration/ui-api-run.json>)과 [화면 캡처](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/integration/ui-result.png>)를 오프라인 대조했다. 브라우저를 다시 조작하거나 새 추론/API를 실행하지 않았다.

| 독립 확인 항목 | 결과와 범위 |
| --- | --- |
| 기존 앱 판독기 | [ui-integration-strict-audit.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/qa/ui-integration-strict-audit.json>), **exit 0·모든 기술 조건 통과**. 기존 검증 스크립트는 변경하지 않았다. |
| 실제 제출 prompt | 화면 입력/원래 prompt/완료 후 prompt/API 기록/recipe/연결된 workflow positive의 7개 값이 모두 `Change only the scarf to red. Preserve its shape and all other colors.`와 정확히 일치한다. 생성 스타일·기존 브리프 문구가 추가되지 않았다. |
| 원본·마스크 | API 기록의 두 SHA가 recipe 및 실제 원본/마스크 파일 SHA와 각각 일치한다. 기존 마스코트 원본 `604aa7eb…1819`와 마스크 `7d105bec…2481`이 서버 요청에 유지됐다. |
| 서버 결과 보존 | 원본/마스크/결과 **1024×1024**, 밖 RGB 최대 오차 **0**, 전체 알파 최대 오차 **0**, 내부 변경 **78,403픽셀**, 밖 변경 **0픽셀**. 선택 안 78,410·밖 970,166픽셀이다. 원본 RGB/비불투명 픽셀 0이므로 투명 원본 검증은 아니다. |
| 실제 실행 근거 | job succeeded, `cache=off`, model_calls 1, 같은 prompt `cc5d7b50-58f6-4314-969a-04896634e9af`의 sampler node 5 실행·성공 기록, sampler가 제외된 캐시 목록 확인. 실제 실행 기록을 읽은 것이며 QA의 새 추론이 아니다. |
| UI 모드·후보 기록 | 편집 시 `inpaint`/`수정할 내용`/style hidden, 완료 후 busy false·`후보 2개`, 생성 화면 복귀 시 `이미지 설명`·style visible. 원본 후보 보존은 총괄의 브라우저 관찰이며, QA는 후보 2개 표기와 화면 캡처를 대조했다. 개별 후보 ID/DB 목록을 독립 재열람한 것으로 표현하지 않는다. |

실제 계산과 값의 대응은 [ui-integration-independent-evidence.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/qa/ui-integration-independent-evidence.json>)에 남겼다. 서버 PNG SHA `5c3737f0712ff08054d0719aca76ce27ede27a2e2d315bea544a60224f7d731d`는 metrics와 일치했다. 총괄의 `ui-result.png`는 실제 형식이 **1440×900 JPEG 화면 캡처**이므로 서버의 1024×1024 PNG와 직접 픽셀 비교하는 자료가 아니다.

**DOM 이미지 증거 정정 반영**

최초 인계의 `ui-pixel-proof.json` 생성·RGBA 일치 완료 주장은 총괄이 철회했다. QA도 당시 `ui-visible-result.png`에서 `image file is truncated`를 확인했으며, 이후 총괄이 해당 잘린 파일과 잘린 URL에 근거한 `resultSha256` 필드를 삭제했다. 불완전한 PNG를 허용해 디코딩하거나 픽셀 동일성을 통과시키지 않았다. 최종 판정은 정정된 [ui-image-source-proof.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/integration/ui-image-source-proof.json>)을 사용한다.

QA가 서버 PNG를 data URL로 만들어 독립 재계산한 값은 길이 **1,666,934**, FNV1a32 **3,653,652,096**, 96자 prefix, 96자 suffix이며, `ui-checks.domSourceProof`와 **4항목 모두 일치**했다. 이는 전체 DOM URL에서 총괄이 기록한 **문자열 지문의 일관성**이다. 암호학적 동등성·전체 문자열 동일성 보증·독립 RGBA 픽셀 일치로 확대하지 않는다. RGBA 동일성은 정정 후 수용 범위에서 제외됐다.

**범위 한정 수용:** UI 연결 기록·편집 설명 단독인 실제 API recipe·서버 결과의 독립 보존 판독을 수용한다. 모델의 빨강 지시 준수나 전체 이미지 품질이 개선됐다는 결론으로 대체하지 않는다. 앞선 4건의 품질 미수용 판정도 그대로다. 취소·재로드·프로젝트·모션·출력 회귀와 전용 UNet 추가 시험은 이번 판독에 포함하지 않았다.

**이번 변경:** 이 보고서와 `qa/ui-integration-*` 기록만 추가/수정했다. 최초 입력 스냅샷은 총괄 정정 전 상태를 보존하며, 최종 불변 확인은 정정된 입력 11개 파일을 기준으로 [ui-integration-input-integrity.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/qa/ui-integration-input-integrity.json>)에 남겼다. 제품 소스·기존 QA 도구·다른 담당 파일·GPU·API·브라우저·서버를 변경/조작하지 않았다.

**2026-10-23 2차 — 전용 SDXL inpaint 0.1 직접 실험**

[plan.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/plan.json>)과 새 3건의 원본/마스크/raw/결과/recipe/workflow/metrics/history/SaveLatent/weights/download 보고서를 오프라인으로 읽었다. 계획의 `prepared-not-run`은 남아 있는 준비 상태 문구이며, 실제 완료 여부는 각 submitted ID·성공 history·결과 아티팩트로 판독했다. 준비 문구를 고치거나 추가 실행하지 않았다.

기존 앱 판독기를 baseline과 새 3건에 그대로 적용한 [inpaint-v01-strict-audit.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/qa/inpaint-v01-strict-audit.json>)은 **exit 1**이다. 재사용 baseline만 통과하고 새 3건은 앱 job 계약 범위 밖으로 미통과다. 새 9채널 conditioning·직접 실험을 통과시키려고 기존 도구를 약화하지 않았다. 아래는 [inpaint-v01-independent-evidence.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/qa/inpaint-v01-independent-evidence.json>)의 독립 수동 근거다.

| 대상 | 역할 / denoise | 밖 RGB / 알파 최대 오차 | 내부 변경 픽셀 | 저장된 sampler float |
| --- | --- | --- | --- | --- |
| 기존 `ai/baseline` | 재사용 Base / .65 | 0 / 0 | 78,395 | 기존 실행에 SaveLatent 자료 없음 |
| [compare-inpaint-065](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/compare-inpaint-065/result.png>) | 전용 방식 / .65 | 0 / 0 | 78,402 | F32·65,536개 모두 유한 |
| [compare-base-099](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/compare-base-099/result.png>) | 새 Base 대조군 / .99 | 0 / 0 | 78,404 | F32·65,536개 모두 유한 |
| [smoke](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/smoke/result.png>) | 전용 방식 / .99 | 0 / 0 | 78,401 | F32·65,536개 모두 유한 |

모두 같은 원본 SHA `604aa7eb…1819`, 마스크 SHA `7d105bec…2481`, 1024×1024다. 선택 안 78,410·밖 970,166픽셀이고 밖 변경 픽셀은 0이다. 새 3건의 raw를 원본/마스크·feather 4로 독립 정수 재합성한 값도 저장 결과와 RGB 최대 차이 0이다. AI summary의 픽셀 수·결과 SHA와 일치했다. **원본은 모두 RGB이며 비불투명 픽셀 0이므로 투명 원본의 추론 보존 증명이 아니다.**

**실제 실행·latent 근거**

smoke의 Comfy prompt는 `8ef468b5-7371-4fac-92bc-ed0c4af05ae2`, 전용 .65는 `c357de7a-ef59-4baa-b88e-f6680c92ddcc`, Base .99는 `034d14e5-077f-4d98-bf55-3016d51c0188`다. 각 submitted/summary/metrics/history ID와 graph가 일치하고, 같은 prompt의 sampler 5 및 SaveLatent 10 실행·성공 완료를 확인했다. sampler 5는 캐시 목록에 없으며 다른 prompt·오류·중단 event도 없다. Pankeki exact cache를 사용한 앱 요청이 아니라 직접 Comfy 실행이다.

서버의 저장된 `--output-directory` 설정을 따라가 history의 원본 raw PNG·latent와 실험 폴더 복사본을 비교했으며 **6개 모두 SHA가 일치**했다. `.latent`의 safetensors header·실제 F32 바이트를 직접 읽어 `[1,4,128,128]` 출력 tensor 각각의 NaN/Inf가 0임을 재계산했다. 그래프에 연결된 SaveLatent의 sampler 출력과 내장 prompt metadata도 확인했다.

| latent 범위 | 최소 / 최대 유한값 |
| --- | --- |
| 전용 .65 | -25.333776 / 28.672142 |
| Base .99 | -24.589081 / 28.672142 |
| 전용 .99 | -24.632105 / 28.672142 |

이것은 **sampler 출력 float의 유한성**이며 VAE decode 후 float tensor를 관찰한 결과가 아니다. PNG가 정상으로 열리거나 NaN 경고가 없다는 사실로 VAE float 전체의 유한성까지 확대하지 않는다. AI가 기록한 실행 시간은 smoke 33.932초·전용 .65 26.722초·Base .99 31.225초이며 업로드/로드/관찰을 포함한 client wall time이다. GPU 시간이나 성능 개선 비교로 사용하지 않는다.

**9채널 그래프와 두 가중치 provenance**

전용 두 그래프는 node 8 `UNETLoader`의 전용 UNet을 sampler model로 사용하고, node 9 `InpaintModelConditioning`이 동일 원본/마스크·positive/negative·Base VAE를 받아 sampler의 positive/negative/latent에 연결된다(`noise_mask=true`). CLIP와 VAE는 기존 Base checkpoint를 사용한다. 현재 UNet safetensors header의 `conv_in.weight`는 **F16 `[320,9,3,3]`**, Base의 입력 convolution은 `[320,4,3,3]`임을 읽기 전용으로 확인했다. 모델 입력의 9채널과 SaveLatent 출력의 4채널은 서로 다른 경계다. Base .99 대조군은 기존 `VAEEncode`/`SetLatentNoiseMask`와 Base model을 사용하며 전용 UNet을 로드하는 그래프가 아니다.

| 파일 | AI 전체 SHA 검증 기록과 현재 대조 |
| --- | --- |
| Base checkpoint | 6,938,078,334 bytes · `31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b` |
| 전용 FP16 UNet | 5,135,178,560 bytes · `6470840731e98cc16713ddf3ac7ee458c9fdbcb881a98c6727cd4a938f227d3f` |

AI의 `verify_file`은 실제 파일 전체를 `hashlib.file_digest`로 검증하며 각 `weights.json`에 두 파일의 검증 결과/식별 정보를 기록했다. QA는 그 기록을 plan·download 보고서의 크기/SHA와 대조하고 현재 device/inode/size/mtime 및 UNet header를 확인했다. **QA가 가중치 전체 SHA를 재계산한 것은 아니다.** UNet 출처는 `diffusers/stable-diffusion-xl-1.0-inpainting-0.1`, revision `115134f363124c53c7d878647567d04daf26e41e`, `unet/diffusion_pytorch_model.fp16.safetensors`다. core loader alias의 실제 연결 대상도 검증된 파일과 같다. 모든 phase의 weights/download 기록이 일치했다.

**동일 조건 비교 쌍**

- `.65`: 기존 앱 Base baseline ↔ 새 전용 `compare-inpaint-065`. 원본/마스크와 prompt·negative·seed·steps·CFG·denoise·sampler·scheduler·feather·ROI·크기가 모두 일치한다. 기존 baseline의 sampler latent는 새로 확보한 것이 아니며, 앱↔직접 그래프라는 경로 차이를 유지한다.
- `.99`: 새 직접 Base `compare-base-099` ↔ 전용 `smoke`. 위 입력·scalar 조건이 모두 일치한다. 따라서 `.65` baseline과 `.99` smoke를 직접 비교해 모델 효과로 주장하지 않는다.

공통 seed는 `20261023`, 25 steps, CFG 6, `dpmpp_2m`/`karras`, negative 빈 문자열, ROI false, feather 4다. 두 쌍 모두 **모델+필수 9채널 conditioning 방식 비교**이며 UNet만 바꾼 단일 변수 ablation이 아니다. 기록용 SaveLatent/파일 prefix 차이는 생성 방식 차이와 구분했다. Diffusers의 strength와 Comfy denoise가 동등하다고 가정하지 않는다.

**4축 실물 품질** — 새 결과 3장을 직접 열람하고, 동일 SHA인 기존 baseline의 앞선 실물 평가를 함께 대조했다. [inpaint-v01-visual-review.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/qa/inpaint-v01-visual-review.json>)에 해시·관찰·선택 내부 좌표 표본을 남겼다.

| 대상 | 지시 반영 | 형태 변화 억제 | 경계·재질 | 캐릭터 특징 유지 |
| --- | --- | --- | --- | --- |
| 기존 Base .65 | **미충족:** 선택 내부 스카프가 파랑. | **일부:** 목 감김·큰 방향은 남지만 주름·술 변경. | **일부:** 술 끝 선과 밝은 조각이 얽힘. | **충족:** 이 샘플의 가시 주요 얼굴·몸·팔다리·배경 유지. |
| 전용 .65 | **미충족:** 목 띠와 천이 여전히 파랑. | **일부:** 큰 방향은 남지만 천·술의 폭과 끝 간격이 바뀜. | **일부:** 굵은 선·광택은 남지만 술이 길고 복잡하게 갈라짐. | **충족:** 가시 주요 얼굴·몸·팔다리·배경 유지. |
| Base .99 | **일부:** 빨강이 생기지만 선택 안 넓은 파란 띠가 남음. | **미충족:** 늘어진 천이 사라지고 삼각 천·몸통 아래 띠/조각으로 재구성. | **미충족:** 색 띠와 하단 조각·술의 연결이 어색함. | **일부:** 얼굴·포즈는 남지만 스카프/몸통 겹침 구조 변경. |
| 전용 .99 | **미충족:** 목과 길게 늘어진 천이 파랑. | **미충족:** 천이 좁은 띠로 바뀌고 술이 긴 수직선으로 재구성. | **일부:** 2D 명암은 남지만 천 끝의 어두운 반복선·술이 부자연스러움. | **일부:** 얼굴·포즈는 남지만 주요 의상 실루엣·술 변경. |

**수용 결론:** 새 3건 모두 이 고정 샘플의 품질 수용 기준에 미달한다. 전용 방식은 두 강도 모두 핵심 빨강 지시를 충족하지 못했다. Base .99의 빨간 면적 증가도 큰 형태 손상을 상쇄하지 못한다. 기술 조건 충족과 sampler 유한성은 확인했지만, 이번 결과를 품질 개선·backend 채택·기본 모델 변경·앱 통합 완료의 근거로 사용하지 않는다. 모델 일반 성능을 부정하는 평가도 아니며, 원본 1개/마스크 1개/seed 1개의 관찰로 한정한다.

**이번 변경:** 이 보고서와 `qa/inpaint-v01-*` 증거만 추가/수정했다. [inpaint-v01-input-integrity.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/qa/inpaint-v01-input-integrity.json>)에 입력 아티팩트와 기존 QA 도구의 불변 확인을 남겼다. 전체 제품 테스트·가중치 전체 재해시·추론·API·브라우저·서버 재시작·제품 소스 변경·다른 채팅 메시지는 수행하지 않았다.

# 부분 수정 품질 — 이미지 AI 실행 기록

2026-10-23 KST. **1차 Base 4회·2차 전용 모델 포함 3회 모두 완료, 품질 수용 후보 0개. 백엔드 제품 코드·기본값 변경 없음.** 2차는 다운로드 검증과 총괄의 실제 UI 검수/GPU 이관 후 고정한 3회만 실행했다. 기술적 실행·픽셀 보존은 통과했지만 빨강 지시와 형태 보존을 함께 만족하지 못했다. 추가 추론·제품 통합은 진행하지 않는다. 서버를 재시작하거나 source guard를 변경·우회하지 않았다. 결과와 0.99 스케줄의 중요한 해석 한계는 맨 아래 2차 실제 결과에 기록했다.

## 기존 증거와 가설

- 기준 원본·마스크: `runtime/runs/f172dcbfe7284f25b4db6a8b6c530081/{original,mask}.png`, seed `20261023`, SDXL Base, 1024×1024, 25 steps, CFG6, dpmpp_2m/karras, feather4, ROI false. 원본 RGB이며 기존 알파 오차 0은 전부 opaque인 입력에 대한 결과다.
- 기존 0.65 결과는 빨간 스카프 지시에 파란색이 남는다. 0.9와 1.0은 prompt/negative/denoise를 동시에 바꿨고 형태가 달라져 강도 하나의 효과를 판정할 수 없다. 이번에 원본·마스크·3개 결과를 육안 확인했다.
- 현재 `workflows.inpaint`는 마스크 내부의 기존 파란 RGB까지 `VAEEncode`에 넣고, 노이즈만 `SetLatentNoiseMask`로 제한한다. 낮은 강도의 색상 고착 가설과 prompt 영향 가설을 분리할 예정이다. 가설은 아직 확정 원인이 아니다.
- 입력·마스크 해시, 실제 prompt/negative, workflow, job/prompt ID, cache/denoiser, 시간, 바깥 RGB·전체 alpha 오차, 내부 색상·경계·형태를 대응한다. 제품 기능 보존과 시각적 품질을 따로 판정한다.

## 이번에 완료한 한 변수 비교

실행 직전 실제 `/api/health`에서 ComfyUI 0.42.0, MPS, SDXL Base, direct/unmanaged를 확인했다. baseline은 기존 최초 결과와 **PNG bytes/SHA-256까지 일치**했다. 원본 SHA `604aa7ebad79be9f27d6d8bd47c8e98362a53f6bf376c9e1e84c00842d0c1819`, 마스크 SHA `7d105beccbe26749dab199cd50b85b89c4ba073e2a6cecadc535713689662481`와 seed/model/25 steps/CFG6/denoise0.65/feather4는 네 건에서 같다.

| 비교 | baseline에서 바꾼 변수 | 시간 / 내부 변경 pixels | 밖 RGB / 전체 alpha 오차 | 직접 본 결과·판정 |
| --- | --- | --- | --- | --- |
| [baseline](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/baseline/result.png>) | 없음 | 32.15초 / 78,395 | 0 / 0 | 기존 파란 스카프 유지, 빨강 지시 실패. 술의 형태도 일부 변한다. |
| [prompt-only](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/prompt-only/result.png>) | 전체 장면 설명 → 편집 부위 중심 prompt 하나 | 28.16초 / 78,399 | 0 / 0 | 여전히 파랑. 하단 술/접합부가 더 뭉개져 기각. |
| [neutral-065](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/neutral-065/result.png>) | encoder만 `VAEEncode` → `VAEEncodeForInpaint`, grow=0 | 27.514초 / 78,410 | 0 / 0 | 대부분 회색 면, 천·술 구조 손실과 밝은 경계 발생. 악화로 기각. |
| [preserve-normal-065](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/preserve-normal-065/result.png>) | scheduler만 karras → normal | 27.582초 / 78,400 | 0 / 0 | 파란색 잔류, 빨강 지시 실패. 채택하지 않음. |

첫 두 건은 실제 Pankeki HTTP 작업이다: baseline job `f81c5ae1a15348578eaa418f38d978c9` / Comfy prompt `5312f97a-1bac-4726-aea1-54c3a374958f`, prompt-only job `4ea0fc286c9b481aa48c1a8a3f33d045` / prompt `aa456300-e270-4277-b3c0-1ed822fe649b`.

나머지 두 건은 **제품 변경 전 기존 Comfy 서버에 제출한 명시적 실험 그래프**다. 앱의 실행 성공으로 보고하지 않는다. neutral 실험 ID `experiment-14bd526ff3354385b1dd63e1c9384517` / Comfy prompt `f7a931cd-1d67-47a9-821a-3c99001840e1`, normal 실험 ID `experiment-7200682948bb4310b622631df22e5203` / prompt `34095f7a-c611-46aa-974b-7159efe55cd3`. 각각 baseline과 source fingerprint가 같을 때만 실행하는 스크립트를 사용했다. 원본 픽셀·마스크 해시를 대조한 뒤 업로드 filename 차이를 제외하면 workflow의 변경 노드는 각각 2(prompt), 8(encoder), 5(scheduler) 하나다.

네 건 모두 같은 prompt ID의 sampler 5 `executing`, 성공 history, `denoiser_executed=true`, sampler cache 미적중 및 preview 25개를 확인했다. 앱 요청은 exact cache off, 직접 그래프는 Pankeki exact cache를 사용하지 않는다. 전체 아티팩트 대응과 재계산 수치는 [comparisons.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/comparisons.json>)에 있다. 각 디렉터리에 `original.png`, `mask.png`, `result.png`, `recipe.json`, `workflow.json`, `metrics.json`을 보존했다. 첫 두 건의 원본 서버 기록은 해당 `runtime/runs/<job_id>/`에도 그대로 있다.

시간은 API polling과 직접 WebSocket 관측 방식이 달라 속도 개선 수치로 비교하지 않는다. 알파 0 오차는 RGB/opaque 샘플 범위이며 실제 반투명 원본 추론의 증거가 아니다. 마스크 내부 RGB 기준 빨강 비율은 6.962 / 8.368 / 3.177 / 6.962%, 파랑 비율은 78.642 / 77.431 / 1.649 / 78.106%였다. 계산식은 comparisons.json을 만든 실행 기록에 사용한 `R>1.25G, R>1.25B, R>80` 및 `B>1.15R, B>1.05G, B>60`이다. 이는 단순 색상 coverage이며 천/형태의 품질 점수나 의미적 지시 준수율이 아니다. 회색 후보가 파랑만 줄였다고 개선으로 채택하지 않는다.

## 원인 범위와 최소 수정안 판단

실제 저장된 positive에는 빨강 지시가 들어 있고, 동일 마스크가 workflow·sampler·최종 합성에 전달되며 내부 픽셀은 바뀐다. 따라서 이 재현은 HTTP 전달 누락·마스크 밖 합성 실패와 구별되는 **마스크 내부 생성의 지시/원본 조건 균형 문제**다. 원본의 파란색을 유지하는 latent 조건이 강하게 남는 가설과 일치하지만 신경망 내부의 단일 원인을 확정하지는 않는다. 짧은 prompt와 normal scheduler만으로 해결된다는 가설은 이 조건에서 지지되지 않았다. 마스크 내부를 지우면 회색이 남아 `VAEEncodeForInpaint` 단순 치환도 해법이 아니다.

총괄이 별도로 확인한 profiles.js의 전체 외형·팔레트/스타일 충돌은 UI 요청 경계의 문제다. 이번 직접 HTTP prompt에는 기존 파랑 지시가 없는데도 실패했다. 프론트의 충돌 수정과 이번 모델 품질 미달을 서로 대체하는 성공으로 보고하지 않는다.

**검토한 최소 제품 수정안은 encoder 치환 또는 scheduler 기본값 변경이었고 모두 기각했다.** 품질 근거 없는 `workflows.py`, `engine.py`, `model_presets.py` 변경을 만들지 않았다. 수정할 제품 코드가 없어 새 제품 실패 테스트·패치를 추가하지 않았으며, 실제 baseline 실패와 후보 실패를 보존했다. 1차에서는 새 모델·커스텀 노드 설치 및 추가 추론을 하지 않았다. 2차의 별도 배정·준비 상태는 아래에 분리한다.

## 관련 검증과 변경 파일

- 기존 관련 Python 회귀: engine 33건(27통과/6skip), composite 4건, cache 13건. **합계 50건 중 44통과/6skip, 실패 0.** 전체 suite·브라우저·프로젝트/모션/출력 UI 회귀를 다시 실행한 것은 아니다. 이는 모델 품질 합격을 뜻하지 않는다. 로그는 전용 증거 디렉터리의 `test_engine.log`, `test_composite.log`, `test_cache.log`다.
- 전용 실험 스크립트 AST 구문 확인 및 5번째 제출이 네트워크 요청 전에 차단됨을 확인했다. [harness-check.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/harness-check.json>), `budget-refusal.log`. 이 거부 확인은 추가 추론이 아니다.
- 변경: 이 문서, [scripts/experiment_inpaint_encoding_macos.py](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/scripts/experiment_inpaint_encoding_macos.py>), `runtime/macos/inpaint-quality/ai/`의 입력 복사본·요청/그래프/metrics·출력·비교 JSON·검증 로그만. 온보딩 인계·공유 문서·다른 담당 파일·프론트·실행기·제품 Python 소스는 바꾸지 않았다. **현재 source fingerprint는 baseline과 같고 재시작 요청은 없다.**

## 다음 검토 대안 1개 — 읽기 전용 조사, 미다운로드·미시험

**후보: `diffusers/stable-diffusion-xl-1.0-inpainting-0.1`.** 공식 Diffusers 모델 카드상 Base 1.0에서 초기화해 1024×1024 마스크 작업으로 40k steps 학습했다. 일반 Base의 4 latent 채널에 masked-image 4채널과 mask 1채널을 추가한 9채널 UNet이다. 현재처럼 일반 Base에 noise mask만 제한하는 경로와 학습 목적이 다르다. 새 후보의 그림체·정밀 색 변경·형태 보존을 보장하는 자료는 아니며 이 샘플에서 시험하지 않았다. [공식 모델 카드](https://huggingface.co/diffusers/stable-diffusion-xl-1.0-inpainting-0.1), [공식 UNet config](https://huggingface.co/diffusers/stable-diffusion-xl-1.0-inpainting-0.1/blob/main/unet/config.json).

- **최소 다운로드 비용:** Base의 CLIP/VAE 재사용을 시험하는 경로라면 추가 `unet/diffusion_pytorch_model.fp16.safetensors` **약 5.14 GB**. 공식 파일 페이지의 SHA-256은 `6470840731e98cc16713ddf3ac7ee458c9fdbcb881a98c6727cd4a938f227d3f`다. 캐시·복사본과 실행 메모리는 별도이며 전체 저장소/FP32 10.3 GB UNet을 모두 받을 필요가 없는 최소 경로 제안이다. [공식 파일·무결성](https://huggingface.co/diffusers/stable-diffusion-xl-1.0-inpainting-0.1/blob/main/unet/diffusion_pytorch_model.fp16.safetensors).
- **공식 ComfyUI 지원 근거:** core의 `SDXL_diffusers_inpaint` 9채널 탐지, `UNETLoader`, `InpaintModelConditioning`이 있다. 현재 로컬 vendor에서도 각각 `comfy/model_detection.py:1519`, `nodes.py:992`, `nodes.py:458`, `comfy/supported_models.py:239`를 확인했다. 커스텀 노드 없이 별도 UNet MODEL을 읽고 기존 Base의 CLIP/VAE와 결합하는 그래프를 구성할 수 있다는 **소스 기반 판단**이다. [공식 모델 탐지](https://raw.githubusercontent.com/Comfy-Org/ComfyUI/master/comfy/model_detection.py), [공식 노드](https://raw.githubusercontent.com/Comfy-Org/ComfyUI/master/nodes.py).
- **현재 그래프와 필요한 변경:** CheckpointLoaderSimple만 새 UNet 파일로 바꾸면 안 된다. Base loader는 CLIP/VAE용으로 유지하고 `UNETLoader`의 MODEL을 sampler에, `InpaintModelConditioning`의 positive/negative/latent를 sampler에 연결해야 한다. 현재 두 preset만 허용하는 모델 식별·설정과 Base+UNet의 두 가중치 provenance도 별도 지원이 필요하다. 원본/마스크/알파 최종 합성 경계는 유지한다. 현재 exact cache allowlist는 `UNETLoader`/`InpaintModelConditioning`을 지원하지 않으므로 초기 후보는 명시적으로 cache 우회하고, 다중 가중치 manifest 검증 전 캐시를 켜지 않는다.
- **MPS와 자원:** 현재 Base가 MPS에서 실제 실행된 것과 후보의 실행 가능성은 구분한다. 공식 Diffusers는 Apple Silicon MPS 경로를 문서화하지만 이것이 해당 UNet+현재 Comfy 조합의 메모리·연산 호환성 보증은 아니다. FP16 UNet/FP32 VAE를 유지하는 core 경로는 시험 후보이며 실측 전 성능·성공을 확정하지 않는다. Base와 추가 UNet이 동시에 메모리에 남을 가능성, CPU offload·로드 전환 및 최대 RSS/MPS 메모리를 우선 확인해야 한다. [공식 MPS 안내](https://huggingface.co/docs/diffusers/optimization/mps).
- **승인 후 시험 계획:** 총괄이 새 가중치·범위를 별도 배정하면 고정 revision·파일 SHA를 먼저 검증한다. 격리된 공식 core 그래프로 1024px MPS smoke 1회를 수행해 로드·NaN/회색 결과·메모리·시간을 확인한다. 이후 같은 원본/마스크/seed/prompt와 고정한 steps/CFG/sampler/strength에서 Base와 전용 모델 경로를 비교한다(모델+필수 conditioning을 하나의 방법 비교로 명시, UNet 하나만의 효과로 주장하지 않음). 한 샘플을 통과하면 추가 seed/다른 편집 사례와 실제 RGBA 원본으로 확대한다. 네 시각 축과 밖 RGB/alpha 0을 모두 만족한 뒤 제품 실패 테스트→최소 모델/그래프 분기→총괄 재시작→QA 실제 앱 수용 순서로 진행한다. 이번 배정에서는 실행하지 않았다.

## 2차 준비 인계 — 아래 실제 결과와 구분하는 사전 계획

총괄의 최신 3회 고정 구성을 [plan.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/plan.json>)에 작성했다. [실험 스크립트](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/scripts/experiment_sdxl_inpaint_macos.py>)는 인자 없이 실행하거나 `prepare`를 선택하면 **API 접근·가중치 읽기·GPU 사용 없이** 원본/마스크 복사본과 검토용 그래프만 저장한다. 제품 소스·기존 모델 preset·venv·실행기·서버는 바꾸지 않는다.

| 예정 phase | 방법 / Comfy denoise | 같은 강도의 비교 대상 |
| --- | --- | --- |
| `smoke` | 전용 inpaint 0.1 / 0.99 | 아래 새 Base 0.99 |
| `compare-inpaint-065` | 전용 inpaint 0.1 / 0.65 | 이미 실제 재현한 `ai/baseline`의 Base 0.65 재사용 |
| `compare-base-099` | Base / 0.99 | 위 전용 0.99 smoke 재사용 |

두 강도 쌍 모두 기존 원본·마스크·seed20261023·실제 prompt/negative·25 steps·CFG6·dpmpp_2m/karras·feather4·ROI false를 유지한다. Base 0.65는 반복하지 않는다. 총괄의 UI job `ef48762b02b2449eb486138a3d46234e`는 다른 편집 문구를 사용했으므로 비교 baseline으로 섞지 않는다. 전용 모델과 필수 9채널 conditioning을 묶은 **방법 비교**이며 UNet 하나만의 효과로 해석하지 않는다.

**공식 조건과 차이:** 고정 [모델 카드](https://huggingface.co/diffusers/stable-diffusion-xl-1.0-inpainting-0.1/blob/115134f363124c53c7d878647567d04daf26e41e/README.md)의 예시는 Diffusers strength0.99, 20 steps, CFG8이다. 이번 smoke/상대 Base는 Comfy denoise0.99로 맞추지만 두 API의 실행 스케줄이 완전히 같다고 주장하지 않는다. baseline과의 비교를 위해 25 steps·CFG6 등은 고정했으며 0.65 결과만으로 모델의 최적 품질을 판정하지 않는다. 0.99 smoke가 실행·NaN·회색/검정·픽셀 보존 기준에서 실패하면 후속 실행을 막고 보고한다. 무작위 파라미터나 추가 모델로 넘어가지 않는다.

**실행 전 조건과 실제 전달 경로:** 총괄이 작성한 [GPU 이관 기록](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/integration/gpu-handoff.json>)의 root/UI 완료·3회 한도·phase 목록·smoke 중단 조건을 검사한다. 이어 Mac 출시의 [download-result.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/model/download-result.json>)이 `state=verified`, `size_verified=true`, `full_sha256_verified=true`이고 고정 revision·실제 크기/해시가 맞아야 한다. 이 조건 전에는 읽기 전용 HTTP도 하지 않는다. 준비 중에는 `downloading`이었으나 최종 확인(2026-10-22T23:58:23Z)에서 `verified`로 바뀐 것을 확인하고 smoke 명령을 실행했다. 결과/추론 횟수는 완료 후 별도 기록한다.

- 고정 UNet revision `115134f363124c53c7d878647567d04daf26e41e`, 파일 5,135,178,560 bytes, SHA `6470840731e98cc16713ddf3ac7ee458c9fdbcb881a98c6727cd4a938f227d3f`를 plan에 보존했다. 기존 Base 6,938,078,334 bytes와 SHA도 별도로 기록한다. 실행 때 **두 실제 파일의 전체 SHA-256**을 확인하고, UNet safetensors header의 FP16·입력 9채널도 검사한다.
- Mac 출시의 모델 저장소는 `models/diffusion_models/sdxl-inpainting-0.1/unet/diffusion_pytorch_model.fp16.safetensors`이며, core alias는 `vendor/ComfyUI/models/diffusion_models/sdxl-inpainting-0.1-unet-fp16.safetensors` 심볼릭 링크다. 스크립트는 마지막 링크를 따라 alias를 잃지 않고, 실제 해시 검증에는 대상 파일을 사용한다. 전달 report의 대상 경로·alias와도 대조하며 중복 다운로드하지 않는다. 임시 fixture에서 이 경로 계약을 재현해 테스트했다.
- 실제 실행 시 큐가 비어 있고 MPS/core-only 서버이며 해당 alias가 `UNETLoader`에 노출되는지도 확인한다. 폴더 설정이나 서버를 고쳐 통과시키지 않는다. 조건이 맞지 않으면 명령과 오류를 보존하고 총괄에게 보고한다. 각 phase는 1회만 예약되며 불확실한 제출·실패를 자동 재시도하지 않는다.

**실행 명령(다운로드 검증 완료 후에만):** 아래 smoke를 먼저 수행하고 결과를 직접 확인한 뒤 나머지 phase 이름을 각각 사용한다. 준비 단계에는 실행하지 않았고 위 검증 완료 확인 뒤 최초 실행에 착수했다.

```bash
.venv-macos/bin/python scripts/experiment_sdxl_inpaint_macos.py run --phase smoke --unet vendor/ComfyUI/models/diffusion_models/sdxl-inpainting-0.1-unet-fp16.safetensors --download-report runtime/macos/inpaint-quality/model/download-result.json --handoff runtime/macos/inpaint-quality/integration/gpu-handoff.json
```

**저장할 증거와 해석 한계:** phase별 원본·마스크·recipe·실제 workflow·두 가중치 근거·Comfy prompt ID·events/history·preview·raw/result·cache/denoiser·시간·밖 RGB/전체 alpha·4축 품질 상태를 대응한다. `SaveLatent` core 출력의 실제 sampler float를 저장해 NaN/Inf를 검사한다. VAE의 디코딩 직후 float tensor는 API에 노출되지 않으므로 sampler 유한성과 PNG 정수만으로 VAE float까지 NaN이 없었다고 주장하지 않는다. 서버 로그의 NaN/cast 경고와 선택 안 회색/검정 비율도 함께 확인한다.

MPS 메모리는 실제 Comfy PID의 RSS와 `/system_stats`가 반환한 MPS/unified-memory 수치를 실행 전·중·후 샘플링한다. 샘플링한 RSS 최대치와 관측 오차를 남기며 **계측한 GPU allocator 최대치로 부르지 않는다.** 자기 실험 프로세스의 `torch.mps` 메모리를 서버 사용량으로 보고하지 않는다. 시각 품질 4축은 자동 합격시키지 않고 직접 이미지 검토와 QA/UX 판정을 기다린다. 실제 RGB 샘플의 alpha0과 합성 RGBA 단위 테스트의 증거도 구분한다.

**준비 검증:** [집중 테스트](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/tests/test_sdxl_inpaint_experiment.py>) 14건 통과. 그래프 MODEL/positive/negative/latent 연결, 원본·마스크 해시, 같은 크기 가중치 변조, 미검증 다운로드·미이관 실행 차단, phase 중복/한도, 심볼릭 링크 alias, float NaN/Inf, 밖 RGB·비균일 alpha 보존을 확인했다. 최초 8개 실패와 추가 guard 실패→수정→통과 로그를 `ai/inpaint-v01/`에 보존했다. 제한 Ruff(`E9,F63,F7,F82`)도 통과했다. 이 절은 사전 오프라인 검증이며 실제 모델 실행 결과는 다음 절로 분리한다.

**2차 변경 파일:** `scripts/experiment_sdxl_inpaint_macos.py`, `tests/test_sdxl_inpaint_experiment.py`, 이 문서 및 `runtime/macos/inpaint-quality/ai/inpaint-v01/`의 계획·검토용 그래프·입력 복사본·검증 로그. backend 제품 분기는 품질 수용 근거가 생긴 뒤에만 제안한다.

## 2차 실제 결과 — 3회 완료, 품질 미수용

두 실제 파일의 전체 SHA·크기와 UNet FP16 9채널 header를 각 실행 전 검증했다. core alias가 실제 검증 대상 파일을 가리키고 live UNETLoader에 표시됨을 확인한 뒤, 빈 큐·MPS·core-only 서버에서만 제출했다. 고정 revision은 `115134f363124c53c7d878647567d04daf26e41e`다. Base/UNet의 실제 경로·해시·stat, 전달 report와 이관 기록은 각 phase의 `weights.json`, `download-report.json`, `handoff.json`에 있다. 이미지 AI가 모델을 추가 다운로드하거나 앱 모델 목록/기본값을 바꾸지 않았다.

| 실제 실행·이미지 | Comfy prompt ID | 시간 / 내부 변경 pixels | 밖 RGB / alpha | sampler float NaN·Inf | 직접 본 품질 |
| --- | --- | --- | --- | --- | --- |
| [전용 0.99 smoke](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/smoke/result.png>) | `8ef468b5-7371-4fac-92bc-ed0c4af05ae2` | 33.932초 / 78,401 | 0 / 0 | 0 | 파랑 유지. 세로 천이 좁아지고 술이 길게 재구성됨. 미수용. |
| [전용 0.65](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/compare-inpaint-065/result.png>) | `c357de7a-ef59-4baa-b88e-f6680c92ddcc` | 26.722초 / 78,402 | 0 / 0 | 0 | 파랑 유지. 술 끝·얽힌 선·밝은 잔여 조각이 생김. 미수용. |
| [Base 0.99](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/compare-base-099/result.png>) | `034d14e5-077f-4d98-bf55-3016d51c0188` | 31.225초 / 78,404 | 0 / 0 | 0 | 빨강 일부 반영, 큰 파란 띠 잔류. 늘어진 천이 사라지고 몸통의 띠·겹침으로 변함. 미수용. |

세 건 모두 같은 prompt ID의 실제 sampler 실행·성공 history, sampler cache 미적중, preview25개를 보존했다. sampler latent는 실제 저장된 float32 `[1,4,128,128]`이며 모든 값이 유한했다. NaN/cast 경고는 관찰하지 않았고 기술 smoke는 통과했다. 이는 VAE 디코딩 직후 float의 유한성을 직접 계측한 증거와는 다르다. 실제 RGB 샘플의 alpha 오차0 역시 반투명 원본 추론을 대표하지 않는다.

**조건이 맞는 두 쌍:** 기존 실제 Base0.65 job `f81c5ae1a15348578eaa418f38d978c9`를 재사용한 0.65 쌍과, 위 새 Base0.99/전용0.99 쌍 모두 source/mask SHA와 prompt·negative·seed·steps·CFG·denoise·sampler·scheduler·feather·ROI·크기가 일치한다. [comparisons.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/comparisons.json>)의 `different_request_fields`는 두 쌍 모두 빈 목록이다. 모델+필수 conditioning은 함께 다르며, 2차에는 sampler 뒤에 진단용 SaveLatent 출력만 더했다. 총괄의 별도 UI 추론은 이 쌍에 포함하지 않았다.

**4축 판정:** 전용 두 결과는 지시 반영 미충족, 형태/경계·재질/의상 특징 보존도 일부만 충족했다. Base0.99는 빨강 일부 반영과 별개로 형태와 접합 구조가 미충족이다. 얼굴·표정·팔다리·배경의 가시 특징은 밖 픽셀 보존으로 유지되지만 의상/몸통 겹침의 변화까지 합격으로 세지 않았다. 세부 직접 판독은 [visual-review.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/visual-review.json>)이며 독립 QA/UX 수용 판정과 구분한다. 총괄도 smoke 실물을 보고 지시·형태 미수용을 확인했다.

**자원:** 관측한 Comfy 프로세스 RSS 최대치는 smoke/전용0.65/Base0.99 각각 1.8455 / 0.4987 / 0.4790 GiB였다. `/system_stats`가 반환한 전체 시스템/MPS unified-memory 사용량의 샘플 최대치는 30.2656 / 25.9292 / 27.6158 GiB다. 전자는 RSS, 후자는 시스템/통합 메모리 보고값으로 서로 다른 지표이며 **실제 GPU allocator peak나 모델 단독 메모리 사용량이 아니다.** 샘플은 36/29/33개, 관측 오류0, OOM은 없었다. 모델 로드·offload·캐시 상태가 달라 위 시간을 속도 비교로 해석하지 않는다. 각 `memory.json`, `server-before.json`, `comfy-log.txt`에 원자료가 있다.

### 지시 실패 원인 후보와 배제할 오해

[conditioning-audit.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/conditioning-audit.json>)은 추가 모델/API/GPU 추론 없이 실제 업로드 파일과 현재 core 소스를 대조한 기록이다.

1. **mask 전달 범위는 확인됨.** 실제 업로드 RGBA를 core와 같은 PyAV RGBA 경로로 CPU 디코딩했고 RGB가 원본과 같고 `1-alpha`가 저장된 mask/255와 정확히 같았다. 선택은 78,410 pixels, bbox `(300,496)–(732,859)`, 범위0..1이며 파란 잔류 지점 `(390,560)`도 mask1이다. 단순히 선택 밖 파랑을 보존한 현상으로 전체 실패를 설명할 수 없다. core `LoadImage`는 1-alpha를 반환하고, node9는 이를 `noise_mask`와 `concat_mask`에 전달하며 masked-image의 선택 내부를0.5로 만든다. 동일 비율 CPU bilinear/round 재현에서 128×128 concat mask는 활성1,213 cells, bbox `(38,62)–(91,107)`이다. 이는 **현재 소스의 계산을 재현한 범위이며 live 내부 tensor를 캡처한 것은 아니다.** 8픽셀 latent 단위가 가는 술/경계의 오차를 만들 수 있지만 큰 내부 파란 면적 전체를 그것만으로 설명하지 않는다.
2. **9채널 core 경로와 positive 연결 근거가 있음.** 실제 weight header는 `conv_in.weight=[320,9,3,3]`, FP16이다. core `model_detection.py:1519`에 SDXL diffusers inpaint9가 있고 `supported_models.py:239`와 `model_base.py:405`가 inpaint concat을 설정한다. 실제 workflow는 node8 `UNETLoader`→sampler MODEL, node2의 `bright red fabric scarf` positive→node9 input→node9 output0→sampler positive, node3 빈 negative→node9 output1, node9 output2→sampler latent다. `concat_cond`는 mask와 masked-image 5채널을 원래 latent4채널과 결합하는 경로다. 실제 sampler가 새로 실행돼 완료됐으며 단순 4채널 Base fallback이나 positive 연결 누락의 증거는 없다. live attention/embedding 활성은 계측하지 않아 문구가 어느 정도 작용했는지는 확정하지 않는다.
3. **로더 warning을 실제 weight 누락과 구분함.** smoke에 선택적 shortcut/단계 매핑과 `class_embedding` 이름 warning이 있었다. 현재 `utils.py:354-361`은 같은 `label_emb` 대상에 class_embedding/add_embedding 양쪽 이름을 매핑하며 실제 파일에는 add_embedding 가중치가 있다. core `load_model_weights`가 실제 누락 때 남기는 `unet missing:` 및 `unet unexpected:` 경고는 없었다. warning이0이었다고 보고하지 않지만 이 로그만으로 손상 가중치나 잘못된 모델 로드로 판정하지도 않는다.
4. **중요한 스케줄 차이: 이번 Comfy0.99는 25steps에서 사실상 full schedule이다.** 현재 `samplers.py:1431-1441`은 `new_steps=int(steps/denoise)`를 사용한다.25/0.99의 정수값은25이고 마지막26개 sigma를 모두 사용하므로 동일 모델의 denoise1.0과 같은 `calculate_sigmas(25)` 요청이 된다. 실제 `set_steps` 소스를 CPU index recorder로 실행해 이 제어 흐름을 확인했고 소스 SHA를 저장했다. 숫자 sigma나 live 모델 schedule tensor를 직접 덤프한 결과는 아니다. **따라서 이번 smoke를 Diffusers 모델 카드의 '1.0 미만 strength0.99'와 동등한 권장 조건 검증으로 해석하지 않는다.** 두0.99 방법의 공정한 비교 자체는 남지만, 전용 모델이 권장 스케줄에서도 실패한다고 일반화할 수 없다. 정수화 차이는 원인 후보이며 색 실패의 단일 원인으로 실증한 것은 아니다. 이를 확인하겠다며 추가 추론하거나 기본값을 바꾸지 않는다.
5. **남는 가설과 대표성 한계.** 전체 장면 prompt/주변 파란 문맥/원본 latent의 조건 우세, 비교를 위해 고정한 CFG6·25steps·Karras와 공식 예시의 차이, Base CLIP/VAE 재사용 경로는 분리 검증하지 않은 요소다. Base의 이전 prompt-only 실패를 전용 모델에도 그대로 일반화하지 않는다. 현재 선택한 방법·단일 원본/마스크/seed의 실패이며 모델 전체의 일반 품질이나 다른 사용자 그림의 성능을 대표하지 않는다.

**최종 조치:** 수용 가능한 지시·구조 개선 근거가 없어 최소 제품 분기안도 제안하지 않는다. 추가 추론·모델 확대·제품 기본값/그래프 변경·서버 재시작을 중단했다. 현재 backend source fingerprint는 최초 baseline과 같다. [completion.json](</Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki/runtime/macos/inpaint-quality/ai/inpaint-v01/completion.json>)에 2차3회 완료·추가 슬롯0·이미지 AI GPU 작업 종료·제품 미통합 상태를 기록했다. 총괄이 위 결과와 원인 후보를 검토할 수 있다.

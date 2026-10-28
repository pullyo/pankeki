# 모델 비교 실행 환경과 QA 인계

2026-10-20 KST. 비교용 실험 코드이며 생산 앱과 기본 모델은 변경하지 않는다. **가중치 전송은 총괄, 실행·품질 판정은 QA가 담당한다. 이 담당은 GPU를 사용하지 않았다.**

## 현재 준비 상태

- 총괄이 7개 가중치 전송과 공식 SHA256 검증을 완료했다. 합계27,827,319,993bytes(약25.92GiB). 최종 전송 증거는 `D:/Pankeki/work/model-comparison-20261020/transfer/verified-manifest.json`이다. 이 담당은 가중치를 중복 다운로드하지 않았으며 `.part`는 사용할 수 없다.
- D: 전용 Hub 환경과 HF CLI2.2.0 설치 및 공식 메타데이터 조회를 완료했다. 7파일의 safetensors header만 읽어 NVFP4·INT8 convrot·W4A8 표기와 실제 저장 형식도 확인했다. 증거는 `weights-layout-audit.json`이며 모델 tensor는 적재하지 않았다.
- **14:15:50 KST CUDA13 전용 환경 설치와 CPU probe 완료.** 대상은 `D:/Pankeki/work/model-comparison-20261020/envs/comfy-cu130`, PyTorch2.14.1+cu130·torchvision0.29.1+cu130·comfy-kitchen0.2.39·comfy-aimdo0.5.6·transformers5.20.2·safetensors0.8.0이다. `runtime/setup-status.json`은 `installed_cpu_checked_gpu_unverified`, `runtime/cpu-probe.json`은 `cpu_imports_and_required_nodes_passed`다. `logs/pip-check.log`는 `No broken requirements found.`이며 추가 설치는 필요 없다. probe의 model_loads와 gpu_jobs는 모두0이다.
- 기존 `vendor/ComfyUI`를 `runtime/ComfyUI`로 분리 복사했다. 기존 환경/소스/모델/앱 설정을 덮어쓰지 않는다. 모델별 profile과 새 프로세스를 사용하며 대형 CUDA 패키지는 비교 전용 환경 하나를 공유한다.
- 오프라인 검사11개 통과. 기존7개에 실행 진입의 runtime 강제 검사, 예외 단계·시간·가용 allocator peak 기록, 파일 종류별 오류 분류, 출력 폴더 생성 실패 분류4개를 추가했다. 실제 alpha 합성 및 lock 검사도 유지했다. 실제 torch import·GPU 제출0이며 OOM allocator 표본 검사는 GPU 대신 제한된 테스트 대역을 사용했다. 증거는 `offline-verification.json`.

## QA 필수 수정과 최종 수집본

- `--run`이 GPU lock 획득·torch import보다 먼저 setup 상태, CPU probe 상태, 복사 소스 hash, 별도 Python 실행 경로를 검사한다. `--check` 없이 호출해도 우회할 수 없다. 가중치·QA 원본과 mask hash는 기존처럼 실제 실행에서 다시 검사한다.
- 예외 발생 시 `exception_stage`, `failure_stage_elapsed_s`, 가능한 `first_load_elapsed_s`·`pipeline_elapsed_s`, CUDA allocated/reserved peak를 남긴다. 미완료 단계의 `phase_s`, 완료되지 않은 `inference_s`, 확보하지 못한 메모리 표본은 `null`이다. OOM 표본은 CUDA 정리 전에 수집하며 정리도 실패하면 원래 OOM과 `gpu_release_error`를 함께 남기고 lock을 유지한다.
- 준비 누락은 `unavailable_runtime`, `unavailable_input`, `unavailable_weights`로 구분한다. 출력 저장 실패는 `output_error`, 크기·보존 조건 실패는 `invalid_output`, 명시적 CUDA/정밀도/메모리 정책 지원 검사 실패는 `unsupported_runtime`이다. 그 밖의 실행 예외는 `runtime_error`, 동시 사용은 `gpu_busy`, 정리 실패는 `gpu_cleanup_error`다. 미확인 실행 오류를 모델 기능 미지원으로 해석하지 않는다.
- 성공 시 기존 측정·출력 계약을 유지한다. `inference_s`는 cold first-call pipeline 시간, `warm_latency_s=null`이며 `total_wall_s`는 harness 실행 영역 시간이다. QA가 외부 프로세스 wall time을 따로 측정한다. 바깥 RGBA 결합 지표의 RGB/alpha 분리와 CSV 이름 변환, `qa/runs` 집계도 QA가 담당한다.
- 최종 `compare_harness.py` SHA256: `89889ee96b78298f070c70f7ecfce3516e23d09a010808fbd4d23b5eaaccc700`. 총괄이 전에 수집한 `6863c895…`는 필수 수정 이전 파일이므로 아래 C: 산출물을 `D:/Pankeki/work/model-comparison-20261020/technical/compare_harness.py`로 다시 수집하고 이 hash를 대조해야 한다. 이 담당은 총괄 소유 수집본을 덮어쓰지 않았다.
- 설치 script 최종 SHA256: `runtime_setup.py=adb4e9aeba6895d56cc4ade1cd6cd4032a7a593a21cfa1eb4828c0658f382eb2`, `runtime_probe.py=4108bd6d0699da4c4dcdfa596ba0b8bdeb0f9728dc6bbca436692265addd2807`. 초기 복사에서 빠졌던 중첩 source4개를 복구했고 기존 파일 덮어쓰기0이다. 근거는 `runtime/source-copy-repair.json`이며 이 복구 뒤 CPU probe가 통과했다.

## 코드와 정확한 명령

실제 산출물 기본 폴더는
`C:/Users/Administrator/Documents/Codex/2026-10-20/pankeki-technical-research/outputs/model-comparison/`다.

- `runtime_setup.py`와 `runtime_probe.py`: D: 분리 환경 설치/CPU import 검사. 이번 설치는 완료됐으므로 다시 설치하지 않는다.
- `compare_harness.py`: 기본 동작은 계획 출력. **`--run`을 명시해야 GPU를 쓴다.** 한 명령에서 한 모델·한 사례만 실행하므로 T01의180초 지연 기준과 OOM 중단을 QA가 지킬 수 있다.

모델별 준비 확인(가중치 최종파일 크기·SHA와 CPU probe를 확인하며 GPU를 쓰지 않음):

```powershell
& 'D:/Pankeki/work/model-comparison-20261020/envs/comfy-cu130/Scripts/python.exe' -B -X utf8 'C:/Users/Administrator/Documents/Codex/2026-10-20/pankeki-technical-research/outputs/model-comparison/compare_harness.py' --model flux2-klein-4b --check
```

출력이 `state=ready_for_qa_gpu_trial`일 때만 QA의 실행 검토 대상이다. 모델 선택은 `sdxl-baseline`, `flux2-klein-4b`, `qwen-image-2-1` 중 하나다. 아직 실제 GPU 호환·메모리 적재를 입증했다는 뜻은 아니다.

총괄의 실행 지시 후 T01 한 건:

```powershell
& 'D:/Pankeki/work/model-comparison-20261020/envs/comfy-cu130/Scripts/python.exe' -B -X utf8 'C:/Users/Administrator/Documents/Codex/2026-10-20/pankeki-technical-research/outputs/model-comparison/compare_harness.py' --model flux2-klein-4b --case T01-character --run
```

총괄이 D: 수집본의 최종 hash를 확인한 뒤 그 수집본으로 실행할 때의 동일 명령:

```powershell
& 'D:/Pankeki/work/model-comparison-20261020/envs/comfy-cu130/Scripts/python.exe' -B -X utf8 'D:/Pankeki/work/model-comparison-20261020/technical/compare_harness.py' --model flux2-klein-4b --check
& 'D:/Pankeki/work/model-comparison-20261020/envs/comfy-cu130/Scripts/python.exe' -B -X utf8 'D:/Pankeki/work/model-comparison-20261020/technical/compare_harness.py' --model flux2-klein-4b --case T01-character --run
```

편집은 별도 명령에서 `--case E01-gloves`, `E02-material`, `E03-expression`을 선택한다. 계획만 확인할 때는 `--run`을 빼면 된다. 모델/사례/해상도/정밀도를 자동으로 바꾸거나 실패 재시도하지 않는다.

## 기능과 샘플링 설정

| profile | 생성과 편집 경로 | 고정 설정 |
| --- | --- | --- |
| SDXL baseline | 단일 checkpoint. txt2img 또는 원본VAE+latent noise mask. instruction-edit 전용 모델로 표기하지 않음 | 1024²,25steps,CFG6,dpmpp_2m/karras, 편집denoise.55,feather4,UNet/text fp16·CPU VAE fp32 |
| FLUX.2 Klein4B | NVFP4 DiT+FP4 encoder+VAE. 텍스트조건과 원본 reference latent. native mask는 사용하지 않으며 마지막 공통 mask 합성 | 1024²,4steps,CFG1,euler,Flux2Scheduler, 원본 기준독립편집 |
| Qwen-Image2.1 Turbo | INT8 convrot DiT+W4A8 Qwen3VL+VAE. TextEncodeQwenImage21로 이미지/문장/latent 연결. native mask 미사용, 마지막 공통 합성 | 1024²,8steps,CFG1,euler,공식 Turbo sigma목록, KV cache CPU. prompt enhancer 추가모델 없음 |

Qwen sigma는 `[1,.978453,.95418,.926626,.89508,.845148,.704534,.414568,0]`다. 단순 normal/simple8-step으로 바꾸지 않았다. 원래 공식 템플릿의 encoder INT8 대신 총괄이 선정한 W4A8 encoder를 쓰므로 그 차이와 quantization을 기록한다. FLUX 공식 템플릿의 FP8 DiT/일반encoder 대신 NVFP4/FP4를 쓰는 차이도 기록한다.

출처: [FLUX 공식 카드](https://huggingface.co/black-forest-labs/FLUX.2-klein-4b-nvfp4), [Comfy FLUX 지원파일](https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-4b), [Qwen 원본 카드](https://huggingface.co/Qwen/Qwen-Image-2.1), [Comfy Qwen 배포](https://huggingface.co/Comfy-Org/Qwen-Image-2.1), [공식 workflow 템플릿](https://github.com/Comfy-Org/workflow_templates/tree/46e060ea88eb07adecf07197ec384c54a70e030c/templates). 확인2026-10-20 KST. 템플릿 JSON과 API메타데이터는 실험 루트 `metadata/`에 저장했다. Qwen은 Qwen Research의 비상업적 연구·평가 범위이며 제품 기본 배포 채택으로 확대하지 않는다. gate/auth/추가 약관 클릭은 수행하지 않았다.

## 호환성과 측정 경계

현재 vendor에는 NVFP4, INT8+convrot, asym_w4a8_int8 로딩/연산 코드와 QwenImage21·Klein tokenizer/latent 지원이 있다. `quant_ops.py`는 cu130미만에서 최적 CUDA backend를 끈다. comfy-kitchen 공식 문서도 CUDA13 및 r580이상 드라이버, Blackwell용 NVFP4 경로를 명시한다. 현재 드라이버595.79는 이 최소조건보다 새롭지만 actual kernel/SM120/8GB 적재 성공은 QA가 확인해야 한다. [comfy-kitchen](https://github.com/Comfy-Org/comfy-kitchen), 확인2026-10-20.

PyTorch공식 cu130 index에서 Windows cp312용2.14.1과 torchvision0.29.1을 확인해 고정했다. PyPI의 작은 CPU wheel을 CUDA wheel로 착각하지 않았다. [torch index](https://download.pytorch.org/whl/cu130/torch/), [vision index](https://download.pytorch.org/whl/cu130/torchvision/), 확인2026-10-20. 실제 의존성·파일hash는 설치report와 freeze를 따른다.

Harness는 별도 HTTP서버를 열지 않고 **복사한 Comfy의 실제 노드·sampler를 같은 프로세스에서 호출**한다. loopback서버/생산SDK경로를 건드리지 않으며 이번 결과를 공식SDK 앱 통합 성공으로 보고하지 않는다. DynamicVRAM을 명시적으로 초기화하고 실패 시 메모리정책을 조용히 바꾸지 않는다. reserve1.5GB+headroom.5GB,CPU VAE,async offload비활성으로 시작한다. 이는 검증할8GB 실험 설정이며 적재 보증이 아니다.

GPU lock은 `D:/Pankeki/work/model-comparison-20261020/gpu.lock`이다. 원자적 배타생성, owner/PID/Windows시작token/runID/획득시각을 기록한다. 기존lock은 자동삭제하지 않는다. 자신의 CUDA정리/동기화 뒤 자기lock만 해제한다. CUDA정리 실패시lock과release_error를 남겨 다음 모델 실행을 막는다. 이 담당은 실험GPU lock을 획득하지 않았다.

출력은 QA 소유 `qa/runs/<model>/<case>/<시각과고유ID>/`로만 저장한다. `request.json`, `runtime-model-attestation.json`, `raw.png`, 편집의 `final.png`, `metrics.json`, `stdout.log`, `stderr.log`를 남긴다. final의 바깥보존과 native raw의 바깥변화를 따로 기록한다. first_load는 CPU모델구축까지, inference는 동기화한 conditioning+sampler+decode로 정의하며 최초 lazy load/offload 비용을 포함한다. **warm latency는null이고 순수warm추론시간을 주장하지 않는다.** CUDA allocated/reserved peak와 pipeline중RSS표본peak를 별도 기록한다. QA의 aggregate JSON/CSV/판정 보드는 QA가 생성한다.

## 남은 검증

설치·CPU probe와 가중치 전송은 완료됐다. 이 담당의 별도 최종 hash·준비 검사는 `manifest.json`을 따른다. 다음은 총괄의 최신 harness 재수집·hash 확인 → 지정 모델의 T01 → 지연/OOM기준 확인 → 허용된편집 순서다. 실제 GPU 시작은 QA가 맡으며 이 담당은 GPU lock을 획득하지 않는다. CUDA kernel/SM120/8GB 적재·출력 품질은 아직 검증하지 않았다. 생산 앱과 기본 모델은 변경하지 않았다.

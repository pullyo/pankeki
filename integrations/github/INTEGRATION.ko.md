# GitHub 구성 요소 적용 안내

사용자는 도움이 되는 GitHub 도구를 찾아 다운로드·적용하라고 요청했고, 진행 중인 ‘Pankeki ComfyUI 최적화 구현’ 대화에 통합 지시를 전달하도록 승인했다. 이 안내는 기존 CODEX-TASK의 목표·보존 조건을 유지하는 추가 작업이다.

## 확보한 소스

`sources.lock.json`의 저장소·commit·버전·라이선스 hash를 사용한다. 소스는 `sources/`에 실제 clone되어 있으며 각 저장소의 LICENSE를 그대로 보존했다. 이 폴더에 소스가 있다는 사실은 ComfyUI에 등록되거나 이미지 생성이 검증됐다는 의미가 아니다.

### CropAndStitch: 우선 통합

[저장소](https://github.com/lquesada/ComfyUI-Inpaint-CropAndStitch) / GPL-3.0 / commit `348a8bbaad1a9000523e42dd3eaf6ab34a8fe62f` / 선언 버전 3.0.18.

- 역할: 실제 선택 영역 crop → 기존 모델의 inpaint → stitch. 모델 내부의 연산을 패치하지 않는다.
- `InpaintCropImproved` 출력 슬롯은 0=STITCHER, 1=IMAGE, 2=MASK다. `InpaintStitchImproved`는 stitcher와 inpainted_image를 받는다.
- 실제 runtime의 custom_nodes에 **이 revision**을 설치하고 해당 Python에서 import와 `/object_info` 등록을 확인한다. 기존 폴더가 있으면 버전·사용 여부를 확인하고 덮어쓰지 않는다.
- 설치 위치는 기존 개발 계획의 `D:\Pankeki\vendor\ComfyUI`를 우선 확인하되 실제 설치 결과가 우선이다. 중복 ComfyUI·PyTorch·모델 다운로드를 하지 않는다.
- 초기 설정: CPU crop/stitch, preresize/outpaint 없음, mask 확장·fill_holes·blur 없음, crop 크기 강제 확대 없음, padding 32, 문맥 factor 1.2. 이는 비교 실험 출발값이며 모델 공간 규격에 맞춰 검증한다.
- 원래 마스크를 마지막 `ImageCompositeMasked`에 다시 적용해 선택 제외 영역을 원본에서 유지한다. 저장 PNG에서 실제 차이 0을 확인해야 원본 보존이 검증된다.
- app-side ROI 구현이 이미 있으면 무조건 교체하지 않는다. 외부 노드를 사용하는 선택 backend/워크플로를 추가해 대조한다. 기능이 중복되면 비교 결과와 유지보수 비용으로 기본값을 정한다.

`workflow_bridge.py`는 기존 API graph를 복제하고 crop/stitch 및 원본 보존 합성을 삽입하는 보조 도구다. 표준 `VAEEncodeForInpaint`와 `SaveImage` 경로를 대상으로 하며, 모든 모델이나 임의 custom sampler를 자동 지원하지 않는다. 워크플로 변환 단위 테스트가 통과해도 실제 ComfyUI·GPU 검증은 별도로 필요하다.

## WaveSpeed: 기본 비활성 선택 실험

[저장소](https://github.com/chengzeyi/Comfy-WaveSpeed) / MIT / commit `ee5ffd4c66ce9a618fa95621110fa68b1f26e58f` / 선언 버전 1.1.8.

- 지원되는 모델이 선택된 경우에만 `ApplyFBCacheOnModel`을 선택 기능으로 연결한다. README의 SDXL/FLUX 등 지원표와 설치된 ComfyUI model wrapper가 모두 맞아야 한다.
- SD1.5용 지원 근거가 없으면 활성화하지 않고 보류 이유를 남긴다.
- `residual_diff_threshold=0.0`은 원본 모델 반환 경로다. 먼저 비활성 대조군을 검증한 뒤 작은 threshold로 단독 실험한다.
- `Compile Model+`, Velocator, GPU-only 강제, 자동 정밀도 변환은 기본 적용하지 않는다. 8GB VRAM에서 offload와 compile 조합은 따로 검증해야 한다.
- 모델·LoRA·scheduler를 바꾸면 다시 품질을 검사한다. DeepCache/TeaCache 등 다른 근사 캐시와 동시에 켜지 않는다.
- 컴파일 시간·cold/warm·실제 skip·최대 VRAM·품질을 구분하고, 이득이 없거나 호환되지 않으면 다운로드 상태로 남기고 원래 경로로 돌아간다.

## 연결·계측 라이브러리

현재 개발 계획은 urllib + websocket-client + unittest다. websocket-client는 공식 ComfyUI 예제에서도 사용하며 Apache-2.0이다. aiohttp와 중복으로 넣을 필요가 없다. 프로세스 RAM 측정에 psutil(BSD-3-Clause)이 필요하면 기존 ComfyUI 환경 설치 여부부터 확인한다. RAM 수치를 VRAM으로 표시하지 않는다. 별도 SDK/proxy는 지금 이 로컬 native API 경로에 필수적이지 않다.

근거: [ComfyUI 공식 예제](https://github.com/Comfy-Org/ComfyUI/blob/master/script_examples/websockets_api_example.py), [websocket-client](https://github.com/websocket-client/websocket-client), [psutil](https://github.com/giampaolo/psutil).

## 통합 검증 기록

1. 설치한 source commit와 LICENSE hash, ComfyUI commit 및 interpreter 경로를 기록한다.
2. CropAndStitch import 및 `/object_info` 스키마, 이미지·마스크 크기 및 반환 슬롯을 확인한다.
3. 작은·가장자리·빈·전체 마스크와 줌/팬 좌표 변환을 검증한다. 선택 제외 영역의 저장 픽셀 보존을 확인한다.
4. 같은 checkpoint/seed/steps/원본/mask로 baseline, app ROI, CropAndStitch ROI를 비교한다. 강제 resize나 처리 범위 차이를 성능 개선으로 숨기지 않는다.
5. WaveSpeed는 지원 모델에서만 off/단독 on을 비교하고 품질 기준 미달 시 비활성으로 둔다.
6. 원자료와 실행 로그를 이 폴더의 `validation/`에 보존한다. 다운로드 완료 / 노드 등록 / graph 변환 단위 테스트 / 실제 GPU 생성 / 성능 검증을 각각 구분한다.

기존 앱 파일과 새로운 integration 파일은 담당을 나눠 변경한다. 이 통합으로 baseline, exact 캐시 무효화, 원본 보존, revision 검증이 약해지면 안 된다.

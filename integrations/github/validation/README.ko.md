# 외부 노드 검증 원자료

실제 GPU 36건의 결과와 제한은 `GPU-RESULTS.ko.md`, 원자료는 `gpu-final-20261019/`, 파생 통계는 그 안의 `analysis.json`에 있다. 브라우저 초기화 실패에 따른 UI 검증 범위는 `UI-REVIEW.ko.md`에 별도로 기록했다.

`scripts/benchmark_external.py`는 이미 설치된 프로젝트 Python과 ComfyUI만 사용한다. 패키지/모델 설치나 서버 재시작은 수행하지 않는다. 기본값은 실제 CropAndStitch Python 코드를 직접 호출하는 CPU geometry 시험이며 합성용 생성 crop은 빨간색 fixture다. CPU 성공을 diffusion 성공으로 기록하지 않는다.

```powershell
.\.venv-comfy\Scripts\python.exe scripts/benchmark_external.py --phase cpu --output integrations/github/validation/cpu-new
.\.venv-comfy\Scripts\python.exe scripts/benchmark_external.py --phase all --model sd_turbo.safetensors --output integrations/github/validation/gpu-new
```

각 출력 폴더는 새 경로여야 한다. `summary.json`에 소스 hash·lock·interpreter·인자·성공/실패를 남긴다. CPU의 8개 입력은 빈/1픽셀/가장자리/중심/분리/전체/상한 초과이며 crop·mask·stitch 이미지를 저장한다. 작은 crop은 최소 256, 큰 crop은 최대 2048, 공간 배수는 8이라는 보수적 정책으로 판정한다. 노드가 resize를 수행하지 않아도 출력이 모델 범위를 벗어날 수 있으므로 정책 미충족 입력은 GPU로 제출하지 않는다. 빈 mask도 제출하지 않는다.

GPU 모드는 등록된 `/object_info`와 슬롯을 확인하고, baseline 전체 입력·app ROI·CropAndStitch를 같은 원본/mask/prompt/seed/steps/CFG/denoise로 비교한다. CropAndStitch의 실제 모델 입력 PNG를 별도 PreviewImage 출력으로 받아 CPU 예상 크기와 비교한다. 최종 저장 결과에서 원본 해상도 및 마스크 밖 RGB 최대 오차 0을 검사한다. 원본 비교의 기준은 저장된 `original.png`다.

기본 1회 warmup·3회 측정은 통합 smoke 검증용으로 작게 잡았다. 정식 비교는 `--warmup 3 --repeats 10`으로 실행한다. 반복마다 seed를 변경하되 같은 반복의 세 모드는 seed가 같고, 모드 순서는 고정 난수로 섞는다. ComfyUI 상위 노드 캐시와 실제 denoiser cached-node 이벤트는 원자료에 남는다. GPU CUDA stage 시간·VRAM·사용자 지각 품질은 이 스크립트에서 측정하지 않아 null로 남긴다. 서로 다른 crop의 문맥/처리 범위 때문에 벽시계 시간 차이를 동일 품질 가속이라고 표시하지 않는다.

파일 종류:

- `cpu/cpu-validation.json`: 실제 외부 노드 CPU import/실행 결과와 모델 크기 정책.
- `gpu/object-info-selected.json`: 실행 서버의 실제 등록 스키마.
- `gpu/*/*/workflow.json`, `measurement.json`, `raw-output.png`, `result.png`: 실행별 원자료.
- `gpu/*/*/actual-model-input.png`: CropAndStitch가 생성에 사용한 실제 crop 크기 증거.
- `gpu/gpu-comparison.json`: 완료 실행 목록 및 비교 조건/제한.
- `WAVESPEED-REVIEW.ko.md`: 선택 SD Turbo 환경에서 근사 캐시를 비활성으로 유지한 근거.

`cpu-preflight-20261019`는 초기 실행에서 앱 환경 `.venv`에 torch가 없어 중단된 기록이다. 외부 노드 검증에는 GPU 전용 `.venv-comfy` interpreter를 사용한다. 이후 성공 기록이 생겨도 실패를 지우거나 실제 GPU 실행으로 바꾸지 않는다.

## 현재 확인된 실제 실행

`cpu-final-20261019/cpu/cpu-validation.json`에서 pinned node의 8개 CPU crop/stitch 사례가 통과했다. 모든 최종 합성의 마스크 밖 RGB 최대 오차는 0이다. 1px/가장자리1px crop은32×32여서 최소256 정책에 미달했고, 중심224px mask는288×288, 가장자리224px mask는256×256이었다. 분리된 두 영역은768×512로 확대되며, 전체512²는512²를 유지했다. 2049×256 입력은2080×256 crop으로 정렬되어 최대2048 정책에서 제외됐다. 이는 synthetic 빨간 crop을 합성한 CPU 검증이며 GPU diffusion의 품질/속도를 뜻하지 않는다.

실행 서버 `/object_info`도 두 노드 등록 및 crop의 `STITCHER,IMAGE,MASK`, stitch의 `IMAGE` 슬롯을 확인했다. 원본 응답은 `cpu-actual-20261019/object-info-selected.json`이다. `sd_turbo.safetensors`가 실제 목록에 등록된 것을 확인했고 GPU 비교는1step·Euler·normal·CFG1을 기준으로 한다.

# 실제 외부 ROI GPU 비교 결과

2026-10-19, `gpu-final-20261019`에서 **실제 ComfyUI 작업 36건**이 완료됐다. 중심/가장자리/전체 mask × 3경로 × (warmup1 + 측정3)이며 측정 표본은27건이다. warmup의 전체 app ROI 1건과 측정의 전체 baseline 1건은 sampler cache hit가 확인됐으므로 36건 전부를 새 GPU 추론이라고 세지 않는다. SD Turbo, seed42/43/44, Euler, normal, CFG1, denoise1, 1step을 같은 반복의 세 경로에 동일하게 적용했다. 생성 결과·원본·mask·사용 graph·prompt ID·hash·노드 캐시 이벤트는 실행별 파일에 남아 있다.

| 조건 | 전체 baseline 입력 | app ROI 입력 | 외부 ROI 입력 | baseline p50 | app p50 | 외부 p50 |
| --- | --- | --- | --- | ---: | ---: | ---: |
| 중심 | 768×512 | 288×288 | 288×288 | 0.770s | 0.516s | 0.515s |
| 가장자리 | 768×512 | 256×256 | 256×256 | 0.785s | 0.593s | 0.563s |
| 전체 | 512×512 | 512×512 | 512×512 | 0.737s (n=2) | 0.823s | 0.852s |

시간은 adapter의 제출부터 결과 다운로드까지 벽시계 시간이며 CUDA kernel 시간이나 UI 표시 시간은 아니다. 각 모드 n=3의 작은 통합 비교이므로 정밀한 성능 순위나 속도 배수를 주장하지 않는다. crop의 문맥과 출력 구도가 baseline과 달라 동일 품질 가속이라고 부를 수 없다. upload는 계측 전에 이루어지고 상위 ComfyUI 캐시는 켜져 있으며 재사용 내역을 그대로 기록했다.

전체 mask baseline의 마지막 반복에서는 같은 seed의 app ROI와 계산이 동일하여 ComfyUI가 sampler node5와 VAE node6를 재사용했다. 해당 표본의 약0.32s를 새 추론의 시간으로 취급하지 않고 표의 baseline 통계에서 제외했다. 제외 전 p50은0.662s다. 원자료는 변경하지 않았고 `gpu-final-20261019/analysis.json`에 전체/제외 통계와 캐시 횟수를 함께 기록했다. 새 seed가 동일 반복 안의 동일 graph 경로까지 재사용을 막는 것은 아니다.

모든36건은 저장된 PNG의 크기가 원본과 같고 마스크 밖 RGB 최대 오차가0이었다. 외부 노드의 실제 crop PNG도 PreviewImage에서 회수해 CPU preflight와 크기가 같은지 확인했다. 이 실험의 app ROI와 CropAndStitch는 측정된9쌍에서 출력 픽셀이 완전히 같았지만, 이것을 다른 mask/context/soft mask/해상도에서도 동등하다고 일반화하지 않는다.

중심 seed42 결과 세 장과 전체 mask 외부 결과를 직접 열어 확인했다. 실제 모델은 찻주전자 이미지를 생성했다. 중심의 전체 baseline과 ROI는 색·물체 크기·구도가 다르며, feather0와 synthetic gradient 원본 때문에 사진 patch의 사각 경계와 물체 잘림이 보인다. 이 fixture는 입출력·부분계산·원본 보존 기능 검증용이고 자연스러운 실제 이미지 편집 품질 합격 사례가 아니다. 얼굴·손·문자·조명·얇은 선·soft mask의 지각 품질 검증은 남아 있다.

판정: **CropAndStitch 다운로드·런타임 등록·CPU 경계 검증·실제 GPU 생성·원본 밖 보존 확인 완료.** 선택 예제 workflow와 재현 스크립트로 제공한다. 기존 app ROI와 이 표본에서 기능이 겹치고 작은 표본의 시간 차이가 있어 기본 backend를 자동 교체하지 않는다. WaveSpeed와 compile은 비활성 상태로 유지한다.

재현/파생 통계:

```powershell
.\.venv-comfy\Scripts\python.exe scripts/benchmark_external.py --phase all --steps 1 --warmup 1 --repeats 3 --output integrations/github/validation/new-run
.\.venv-comfy\Scripts\python.exe integrations/github/validation/analyze_external.py integrations/github/validation/new-run
```

정식 성능/품질 검증에는 더 많은 반복과 실제 편집 입력, warm/cold 분리, CUDA 세부 계측, 사람의 품질 판정이 필요하다. GPU 최대 allocated/reserved memory와 denoiser/VAE CUDA 시간은 미측정 null이다.

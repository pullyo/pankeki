# 실행 결과와 판정

2026-10-19 (Asia/Seoul). 아래 결과는 이 PC의 RTX 5060에서 수행한 기록이다. 연구 논문의 속도를 가져오지 않았다.

## 실제 생성 경로

`evidence/smoke-20261019T113257Z`에서 SD Turbo, 512×512, seed42, Euler/normal, 1 step, CFG1로 실제 생성했다. prompt_id `e90af2e5-6938-4512-aa52-3cd3d63ef257`. 제출부터 PNG 회수까지 6.239초이며 첫 모델 초기화를 포함한다. 잘못된 노드 요청의 HTTP 오류도 실제 확인했다. UNet/CLIP FP16, VAE FP32, EPS, PyTorch attention, Comfy RAM pressure cache를 사용했다.

## 엄격한 매 요청 hash 경로

원자료: `evidence/gpu-20261019T113355Z/raw.jsonl`, `summary.json`, `summary.csv`. 76회 앱 작업(준비3회 포함), exact hit10회를 수행했다. 모델 전체 SHA256·관리 프로세스·소스 검사를 **cache off에도 동일하게 적용**했다.

| 조건 | 표본 | 전체 ready 지연 p50 |
|---|---:|---:|
| 동일 workflow 재요청, 앱 cache off | 10 | 4.056초 |
| 앱 exact hit | 10 | 3.356초 |
| 새 seed, 앱 cache miss | 10 | 4.042초 |
| preview off / on | 각3 | 4.034 / 4.046초 |

이 표는 순수 GPU 추론 속도가 아니다. 전체 fingerprint 비용 p50이 3.350초로 지배적이었다. ComfyUI 직접 warm 실행 자체는 훨씬 짧으므로, 강한 무결성 검사를 매 요청 반복하는 정책은 앱 비용을 크게 늘린다. baseline 반복과 새 seed가 섞인 trace이며 Comfy 내부 cache hit도 원자료에 기록했다. 작은 표본의 p95는 설명용 통계다.

## 모델 검사 정책 비교

후속 원자료는 `evidence/cache-policy-20261019T114704Z`다. 정책별 warmup3회 후 3조건×10회씩 교차 실행했다. 두 정책의 exact hit20건은 같은 완료 PNG hash이며 모두 ComfyUI 제출0회다. Windows 읽기 잠금은 시작 시 동일 파일 핸들로 SHA256 검증1.889초를 지불하고 이후 일반 쓰기·교체를 막는다. 매 요청 소스·프로세스 검사는 유지한다.

| 조건 | 매 요청 전체 hash p50 | 읽기 잠금 p50 |
|---|---:|---:|
| 같은 요청, 앱 cache off | 4.366초 | 1.480초 |
| 정확한 완료 결과 재사용 | 3.701초 | 0.589초 |
| 새로운 seed | 4.851초 | 1.726초 |

모든 값은 앱 ready까지의 시간이며 시작 검사 비용은 별도다. 앱 cache off의 Comfy sampler 실제 실행은 각각5/10과8/10으로 달랐으므로 두 열을 동일 GPU 작업량의 속도 비교로 해석하지 않는다. 새 seed는 정책 간 Comfy reuse를 피하려고 서로 다르게 주었고 각10/10에서 sampler를 실행했다. 모델 내부 계산을 가속한 것이 아니라 반복 무결성 검사 비용을 줄인 것이다. 표본 변동이 크고 n10의 p95는 안정적인 지연 보장이 아니다. 해당 요약의 p95는 원자료에서 nearest-rank로 계산했다.

파일·부모 폴더 rename, hardlink 쓰기, 기존 writable mmap, 일반 reader 및 lock 해제를 별도 프로세스로 검사했다. symlink 생성 검사는 호스트 권한 때문에1건 생략했다. 이 PC에서 선택 정책을 검증했고 최종 앱 config에 적용했다. 재설정 도구의 기본값은 보수적인 strict이며 옵션으로 선택할 수 있다.

## ROI 결과

각 1/5/10/25/50/100% 중심 마스크에 full inpaint와 app ROI를 같은 원본·seed·1step으로 3회씩 비교했다. 36개 부분 수정 결과 모두 최종 마스크 밖 최대 RGB 오차 **0**이었다. 최소 입력256, halo32, multiple8, 내부 feather4. 실제 모델 입력은 작은 ROI256², 25%320², 50%432², 전체512²였다. 100%는 full fallback이다.

`roi-contact-sheet.jpg`를 직접 검토했다. **작은 마스크에서 네모난 패치, 내용·스케일 변경, 경계 불연속이 보인다.** 전체 경로도 SD Turbo 일반 checkpoint의 1step inpaint 품질 한계를 보인다. ROI의 문맥 변화가 품질 동등성을 충족했다고 판단하지 않았다. ROI 기본 off를 유지한다. 외부 픽셀 보존 성공과 편집 안쪽의 지각 품질 성공은 다른 판정이다.

미리보기는 실제 binary62개를 관측했지만 1step 작업에서는 throttle 포화 상황이 거의 없다. 실제 생성 속도 개선으로 판정하지 않았다. 여러 이벤트를 제한하고 stale 이벤트를 폐기하는 동작은 별도 경쟁상태 테스트로 확인했다.

## CPU 계획과 외부 노드

`evidence/planning-2026-10-19.json`은 14가지 mask × 5가지 계획 × 10회, warmup3의 CPU 계획 실험이다. 모델 추론은 실행하지 않았다. 떨어진 작은 mask에서 tile 면적 이점이 있는 반면 overlap과 분할 관리 비용이 있다. 실제 타일 diffusion/LOD는 활성화하지 않았다.

CropAndStitch 고정 소스를 실제 import하고 8개 CPU 경계 사례를 검사했다. 마스크 밖 오차는 모두0. 1px mask는32² crop이라 최소256 정책에서 GPU 제출하지 않는다. width2049 사례의2080×256 crop은 상한2048 정책에서 제외했다. 등록 스키마와 상세 자료는 `integrations/github/validation`에 있다. GPU 비교 기록은 해당 디렉터리의 최종 실행 결과와 구분해 확인한다.

외부 노드 GPU 비교도 `integrations/github/validation/gpu-final-20261019`에 완료했다. 36회 제출 중 Comfy sampler 재사용2회를 구분했으며, 모두 원본 해상도와 마스크 밖 오차0을 확인했다. 측정9쌍에서 app ROI와 CropAndStitch의 출력 픽셀이 같았다. 중심768×512 baseline의 adapter p50 0.770초, app288² ROI 0.516초, 외부288² ROI 0.515초(n3)였다. 구도와 품질이 같지 않으므로 속도 배수 성과로 쓰지 않는다. 상세는 `integrations/github/validation/GPU-RESULTS.ko.md`에 있다.

## 최종 확인과 남은 검증

최종 앱 재시작 후 `evidence/live-http-20261019T115616Z`에서 실제 HTTP로 새 생성, byte-identical exact 재사용, 빈 mask 무호출, 256² ROI 생성·512² 합성·외부 오차0, 잘못된 크기의 HTTP400을 확인했다. 이 실행은 UI가 사용하는 동일 API다.

최종 자동 검사: Python82건 중81통과/권한상1생략, 외부 workflow bridge17통과, 실제 페이지 JS 상태 회귀10통과. HTTP 오류 응답은 별도로220회 연속 통과했다. JSONL과 저장 metrics의 cache commit 결과·시간이 일치하도록 수정했고, 이미지·mask 업로드 완료 순서가 뒤바뀌어도 최신 입력만 채택한다.

얼굴·손·글자·LoRA를 포함한 고정 품질 평가, CUDA event별 denoiser/VAE 시간, inference peak allocated/reserved VRAM, 브라우저 paint 시간은 이번 결과에 포함하지 않았다. 미측정치는 null이다. 브라우저 자동화 런타임은 초기화 오류가 있어 렌더링 screenshot 검증을 완료했다고 표시하지 않는다. 로컬 HTTP API와 HTML/JS 구문 및 입력 경로는 테스트했다.

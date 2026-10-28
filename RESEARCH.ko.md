# 기술적 비유, 적용 가능성, 검증 자료

확인일: 2026-10-19. 아래 장치 원리와 선행기술은 공개 1차 자료에 근거한다. Pankeki 적용안은 설계 제안이며 이 PC에서 검증된 성능이 아니다. 저장소의 현재 코드·API·라이선스는 사용 전에 다시 확인한다.

## 모니터 기술을 소프트웨어로 옮기는 범위

| 비유 | 실제 원리 | 구현 후보 | 동일시하면 안 되는 점 |
| --- | --- | --- | --- |
| 로컬 디밍 | LCD 백라이트를 구역별로 제어 | ROI·타일별 계산 예산과 우선순위 | 밝기가 중요도를 뜻하지 않으며 구역 분할만으로 연산은 줄지 않는다 |
| OLED 픽셀 제어 | 자발광 픽셀의 빛을 개별 제어 | mask 선택, crop 생성, 제외 영역 원본 합성 | 0 mask·검은 픽셀이 dense 모델 연산 생략을 뜻하지 않는다 |
| 주사율·VRR | 지원 범위에서 화면 갱신을 출력 타이밍에 맞춤 | 완료 이벤트 기반 preview, debounce, backpressure | Hz는 생성 이미지/초가 아니며 VRR로 diffusion step이 줄지 않는다 |
| Foveated rendering | 시선 중심에 shading 자원을 집중 | 수동 ROI 우선 정제, 전체 초안 뒤 상세화 | 마우스 위치는 시선이 아니며 최종 이미지의 주변 품질을 숨길 수 없다 |
| Framebuffer·dirty region | 저장된 표시 이미지와 변경 영역을 관리 | 타일 결과 보관, 변경 입력 의존성 추적, 필요한 화면만 갱신 | 표시 범위와 모델의 계산 의존 범위는 다르다 |
| Double buffering | 표시 중인 버퍼와 다음 프레임 준비 버퍼 분리 | 같은 revision만 조립한 뒤 일관된 이미지 교체 | 버퍼 2개가 추론 병렬화·속도 향상을 보장하지 않으며 메모리가 추가된다 |

모니터 드라이버 제어는 범위 밖이다. 실제 최적화는 ComfyUI 그래프·텐서 크기·실행 block·crop/mask/composite·캐시·스케줄러·미리보기에서 일어난다.

## 수학·캐시·공간 분할

- 행렬곱은 곱셈·덧셈을 효율적으로 묶은 연산이다. 스칼라 반복으로 풀어 가속한다고 가정하지 않는다. 상수 접기·중복 계산 제거·융합·메모리 이동 감소를 먼저 측정한다.
- `x/c`와 `x*(1/c)`는 실수에서 조건부로 동등하지만 부동소수점 오차, 0, NaN, Inf, overflow/underflow, 누산 순서를 검사해야 한다. 정밀도 축소는 별도 근사 최적화다.
- exact cache는 동일 계산의 저장본 재사용이다. DeepCache(U-Net 특징), TeaCache(timestep 관련 변화 추정), First Block Cache(첫 block residual 기준)는 다른 step의 정보를 재사용하므로 근사다.
- 마스크를 곱해도 일반 dense forward는 계산된다. ComfyUI inpaint sampler 구현과 실제 tensor shape를 확인한다. 계산을 줄이려면 실제 crop 또는 지원되는 sparse 실행이 필요하다.
- 전역 attention에서는 일부 K/V 변경이 다른 위치 출력에 영향을 줄 수 있다. convolution도 receptive field와 halo가 필요하다. 따라서 변경 픽셀만 다시 계산해 항상 동일하다고 주장할 수 없다.
- VAE tiling은 우선 peak memory 절약 기술이다. denoiser 타일링과 다르며 overlap 중복 연산, 색조 변화, 속도 저하가 가능하다.
- 쿼드트리는 분할·우선순위 자료구조다. LOD는 상세 수준의 순서와 예산 정책이다. 서로 다른 크기의 latent를 근거 없이 이어 붙이지 않는다.
- MultiDiffusion은 공간 제약을 가진 여러 생성 경로의 결합 선행기술이다. SIGE는 실제 sparse 실행과 특징 재사용이 필요한 연구 경로다. 일반 mask 노드와 같은 기능으로 설명하지 않는다.

## 공개 자료

### ComfyUI·PyTorch

1. Custom node 및 캐시 계약: https://docs.comfy.org/custom-nodes/backend/server_overview
2. 로컬 서버 HTTP/WebSocket: https://docs.comfy.org/development/comfyui-server/comms_routes
3. 실제 sampler/inpaint 코드: https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/samplers.py
4. 수치 정확성과 연산 순서: https://github.com/pytorch/pytorch/blob/main/docs/source/notes/numerical_accuracy.md
5. attention 수식과 구현: https://docs.pytorch.org/docs/stable/generated/torch.nn.functional.scaled_dot_product_attention
6. 측정·warmup·GPU 동기화: https://docs.pytorch.org/tutorials/recipes/recipes/benchmark
7. compile 도입과 제한: https://docs.pytorch.org/tutorials/intermediate/torch_compile_tutorial.html
8. diffusion compile의 shape 변경·준비 비용: https://pytorch.org/blog/torch-compile-and-diffusers-a-hands-on-guide-to-peak-performance/

### 최적화 선행기술

9. DeepCache 저자 저장소: https://github.com/horseee/DeepCache
10. TeaCache 저자 저장소: https://github.com/ali-vilab/TeaCache
11. First Block Cache / ParaAttention: https://github.com/chengzeyi/ParaAttention
12. VAE tiling 및 메모리 절약: https://huggingface.co/docs/diffusers/optimization/memory
13. MultiDiffusion 저자 저장소: https://github.com/omerbt/MultiDiffusion
14. SIGE 연구 페이지: https://hanlab.mit.edu/projects/sige

Diffusers 예제가 있다는 사실은 ComfyUI wrapper에서 바로 호환된다는 증거가 아니다. 논문의 성능을 그대로 인용해 Pankeki 실측으로 제시하지 않는다.

### 모니터·렌더링 원리

15. Sony 로컬 디밍 자료(구형 제품의 원리 설명용): https://www.sony.com.hk/press/pdf/20190503_e.pdf
16. LG Display OLED 자발광: https://m.lgdisplay.com/eng/product/tv-display/transparent-oled
17. AMD FreeSync: https://www.amd.com/en/products/graphics/technologies/freesync.html
18. NVIDIA VRS와 foveated rendering: https://developer.nvidia.com/vrworks/graphics/variablerateshading
19. Microsoft dirty rectangles: https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/dxgi-1-2-presentation-improvements
20. Microsoft swap chains: https://learn.microsoft.com/en-us/windows/uwp/graphics-concepts/swap-chains

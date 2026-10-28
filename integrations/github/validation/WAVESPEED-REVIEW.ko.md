# WaveSpeed 적용 판정: 현재 비활성

검토 대상은 `sources.lock.json`의 `ee5ffd4c66ce9a618fa95621110fa68b1f26e58f` 소스다. README에는 FLUX, LTXV, HunyuanVideo, SD3.5, SDXL의 workflow와 예시 설정이 있고, 선택한 SD Turbo/SD2.1의 검증 예시는 없다. 논문의 수치나 다른 모델의 threshold는 이 PC에 적용하지 않는다.

`fbcache_nodes.py`의 `ApplyFBCacheOnModel.patch`는 threshold <= 0 또는 max_consecutive_cache_hits == 0에서 원본 MODEL을 그대로 반환한다. 양수 threshold는 클래스 이름 `UNetModel` 또는 `Flux`를 분기하므로 SD2.1이 코드 구조상 무조건 배제된다고 단정할 수는 없다. `first_block_cache.py:create_patch_unet_model__forward`는 UNet의 앞 input block 둘과 나머지 block의 residual을 기준으로 캐시하고 `model._forward`를 패치한다. 이 구현은 설치된 ComfyUI의 wrapper·forward 인자·control/patch 계약에 의존한다.

현재 SD Turbo의 짧은 1~4 step 경로에서 이 패치의 실제 실행·skip·출력 품질·메모리를 검증하지 않았다. 따라서 **다운로드 및 소스 검토 완료, 활성화와 GPU 가속 실험 보류**다. threshold 0 비활성 대조군을 포함한 실제 wrapper 호환성 검증과 품질 평가 전까지 기본 설정과 workflow에 넣지 않는다. torch.compile·Velocator·GPU-only 강제는 적용하지 않는다.

이 결정은 라이브러리 전체가 지원 불가하다는 뜻이 아니라 이번 모델/환경에서 검증된 이득이 아직 없다는 의미다. 외부 유료 WaveSpeed API는 사용하지 않았다.

# 선택형 CropAndStitch 예제 workflow

두 JSON은 ComfyUI `/prompt`에 보내는 **API graph**다. UI 편집기 canvas workflow 포맷이 아니다. 기본 Pankeki backend를 바꾸지 않고 외부 노드를 선택적으로 시험하는 경로다.

- `inpaint-baseline-api.json`: 원본 전체 크기에서 inpaint한 뒤 원래 mask로 최종 합성.
- `inpaint-cropandstitch-api.json`: pinned CropAndStitch의 crop → 같은 sampler/VAE → stitch → 원래 mask로 최종 합성.

실행 전 node 1의 `ckpt_name`을 실제 설치된 모델명으로 확인하고, node 4의 `image` 값 `REPLACE_WITH_UPLOADED_RGBA_MASK.png`를 `/upload/image`가 반환한 실제 파일명으로 바꿔야 한다. 입력 PNG는 RGB 원본에 `alpha = 255 - grayscale_mask`를 넣은 RGBA다. ComfyUI LoadImage는 alpha를 반전하여 수정 mask로 읽는다. 일반 투명 원본 파일을 그대로 mask 입력으로 사용하면 안 된다.

CropAndStitch는 CPU crop/stitch, preresize=False, output_resize_to_target_size=False, mask_fill_holes/expand/blur=False, context factor=1.2, output padding=32다. **최소/최대 모델 해상도 보호는 static graph 자체에는 없다.** 실제 crop이 최소256·최대2048·배수8 정책을 충족하는지 `benchmark_external.py`의 CPU preflight에서 확인한다. 빈/1px mask를 이 JSON에 직접 제출하지 않는다. Pankeki의 빈 mask skip과 전체 fallback 정책을 보존하려면 보호 로직이 있는 script 경로를 사용한다.

권장 실행은 `scripts/benchmark_external.py --phase all`이다. 이 도구가 입력 업로드·모델명/노드 등록 검증·크기 preflight·실제 workflow 기록·GPU 생성·마스크 밖 원본 비교를 수행한다. 기본 원본은 스크립트가 만든 gradient fixture이며 실제 촬영 사진이 아니다. 저장된 결과는 실행이 성공했을 때만 실제 diffusion output으로 기록한다.

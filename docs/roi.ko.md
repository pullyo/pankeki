# ROI·원본 보존·공간 계획

## 현재 구현 범위

`pankeki/planning.py`는 실제 작은 모델 입력을 만드는 ROI 계획·crop·padding 도구이며, `pankeki/composite.py`는 원본 해상도 합성이다. 모델 실행은 호출자가 ComfyUI adapter로 수행한다. 타일·쿼드트리·LOD는 기본 비활성(`enabled=False`)인 **계획 실험**이고 모델 실행 기능이 아니다. 이 문서의 CPU 시험은 GPU 가속·동일 품질의 증거가 아니다. 실제 GPU 통합 결과는 별도 실행 원자료를 따른다.

## 좌표·마스크 계약

- 이미지·마스크: 원본 pixel-space. 마스크는 `convert('L')`로 만든 0~255 luminance alpha이며 0은 원본 보존, 255는 생성 결과다. RGB 색 마스크는 명시적으로 흑백으로 변환해 사용하는 것이 권장된다. 알파 채널을 자동 마스크로 해석하지 않는다.
- 사각형: `(x0, y0, x1, y1)`, 오른쪽/아래 끝 제외. crop은 resize하지 않는다.
- `canvas_to_image`: `canvas = pan + original × display_size / image_size × zoom`의 역변환. pan에는 letterbox와 이미지 좌상단 위치도 포함한다. `clamp=True`는 연속 좌표를 `[0,width]×[0,height]`로 제한한다. 픽셀 선택 시 정수화/브러시 rasterization은 UI가 정의해야 한다.
- `multiple=8`, `min_size=64`는 기본 geometry 설정이다. 모델별 최소 해상도·위치 인코딩 제한은 adapter가 확인해서 변경해야 하며 모든 모델의 품질 보장을 뜻하지 않는다.
- `halo=32`는 원본 픽셀 단위 문맥 여백이다. 경계 밖 문맥을 발명하지 않는다. 배수 정렬을 위한 부족한 픽셀은 오른쪽/아래에 edge padding, 마스크는 0 padding한다. 원본 픽셀의 유효 해상도는 변하지 않는다.

## API 사용

```python
from pankeki.planning import plan_roi, crop_for_plan, unpad_generated
from pankeki.composite import composite

plan = plan_roi(mask, halo=32, multiple=8, min_size=64)
if plan.mode == 'empty':
    final = original.convert('RGB').copy()  # GPU 호출 없음
else:
    model_image = crop_for_plan(original, plan)
    model_mask = crop_for_plan(mask, plan, is_mask=True)
    # generated = ComfyUI에서 model_image/model_mask를 입력으로 실제 inpaint한 결과
    crop = unpad_generated(generated, plan)
    final = composite(original, crop, mask, plan.bbox, feather=4)
```

`ROIPlan`은 `bbox`, `original_size`, `mode`, `mask_area`, `processed_area`, `reason`, `padded_size`, `padding`, `halo`, `multiple`을 가진 불변 dataclass다. 빈 mask는 bbox가 `None`, 처리 면적은 0이다. `mode='baseline'`은 전체 이미지 bbox를 갖는다. `mask_area`는 alpha 값이 0보다 큰 픽셀 수, `processed_area`는 padding까지 포함한 실제 모델 입력 픽셀 수다.

ROI의 배수 정렬 후 면적이 정렬된 전체 이미지 면적의 `max_area_ratio=.75` 이상이면 전체 경로를 사용한다. 이 임계값은 보수적인 초기 정책이며 실측 손익분기점이 아니다. 여러 불연속 영역은 모두 포함한 bbox로 처리하므로 멀리 떨어진 작은 편집은 전체 fallback이 될 수 있다. 빈 mask만 생성을 건너뛰며 검은색 이미지 자체를 계산 생략으로 해석하지 않는다.

합성은 먼저 원본을 RGB로 복사한다. 마스크 내부에서만 정수 alpha blend를 계산하고 alpha 0인 픽셀은 정확히 원본 RGB bytes가 된다. `feather`는 원본 픽셀 단위 Gaussian radius다. 흐림 alpha를 원래 alpha 이하로 제한하므로 편집 범위가 밖으로 확장되지 않는다. 이는 일반적인 양방향 blur와 다르다. 마스크에 0보다 큰 부분이 bbox 밖에 있으면 조용히 누락하지 않고 오류를 낸다. 생성 crop 크기·마스크 해상도 mismatch, 범위 밖 bbox, 음수 feather도 거부한다. 원본 객체는 변경하지 않는다. RGB 변환 이전의 RGBA alpha·palette metadata 보존은 이 API 범위에 없다.

## 고정 타일·쿼드트리·LOD의 실험 범위

`plan_tiles(..., enabled=True, strategy='fixed'|'adaptive')`를 사용한다. 고정 grid는 mask가 닿는 cell만 선택한다. 쿼드트리는 mask support를 기준으로 일부만 선택된 cell을 4분할하며 밝기를 중요도로 사용하지 않는다. 전체가 mask인 dense cell은 큰 covering parent로 유지한다. `tile_size`는 부분 선택 cell의 목표 크기이며 부모 크기의 상한이 아니다. `max_depth=4`, `min_tile=64`, `max_tiles=64`가 한계를 둔다. 타일 수가 부족하면 covering parent를 유지해 mask 일부를 버리지 않는다. 고정 타일 수가 상한을 넘으면 전체 이미지 한 장으로 fallback한다.

각 tile의 `core_bbox`는 원래 cell, `bbox`는 문맥 overlap을 포함한 실제 crop, `padded_size`는 배수 정렬 및 최소 크기를 반영한 입력 크기다. `processed_area`의 합계는 overlap 중복을 포함하므로 전체 이미지 면적보다 커질 수 있다. 서로 다른 shape의 batching/compile 비용을 아직 측정하지 않았으므로 크기 bucket 도입은 보류했다. 타일 합성·seam 해결·노이즈 결합·전역 prompt 변경 캐시 재사용은 구현하지 않았다.

`plan_lod(..., enabled=True)`는 전체 축소 draft와 원본 ROI refinement 계획을 구분하고 `draft_is_final=False`를 명시한다. 낮은 해상도 draft를 최종 결과로 전달하지 않는다. 일반 crop의 품질도 원본 전체 생성과 동일하다고 가정할 수 없으며, 얼굴·문자·전역 조명·얇은 선 등 실물 품질 평가가 필요하다.

## 재현

프로젝트 Python 환경에서:

```powershell
python -m unittest discover -s tests -p 'test_planning.py'
python -m unittest discover -s tests -p 'test_composite.py'
python scripts/benchmark_planning.py --output evidence/planning-new-run.json
```

벤치마크는 1024² 입력에서 중심/가장자리의 1/5/10/25/50/100% mask, 멀리 떨어진 두 영역, 빈 mask를 사용한다. 각 조건 3회 warmup 후 10회 측정하며 모드 실행 순서는 고정 난수 seed로 교차한다. JSON에 모든 개별 CPU 시간, mask SHA-256, 설정, Python/NumPy/Pillow 버전, 계획 크기, overlap 포함 처리 면적을 기록한다. 기존 evidence 파일을 덮어쓰지 않는다. GPU 시간·VRAM·품질은 미측정(null)이다.

테스트는 빈 mask·1픽셀·경계·홀수/작은 해상도·불연속 영역·전체 mask, padding 왕복, 줌/팬 변환, crop 누락 거부, 원본 불변성, 마스크 밖 모든 픽셀의 byte equality, soft-mask/feather 범위를 검증한다.

## 2026-10-19 CPU 결과와 채택 판단

현재 소스 SHA-256을 포함한 원자료는 `evidence/planning-2026-10-19.json`이다. 앞서 생성한 `planning-benchmark*.json`은 개발 중 기록이며 이 결과의 기준 파일이 아니다. 최초 파일은 JSON 저장 후 Windows 콘솔의 em dash 문자 출력에서 실패했고, 출력 문자를 ASCII로 수정한 뒤 재실행했다.

1024² 원본, 32 pixel halo/overlap 조건의 일부 결과:

| mask 조건 | 실제 mask 픽셀 | ROI 처리 픽셀 | 고정 tile 처리 픽셀 | adaptive 처리 픽셀 |
| --- | ---: | ---: | ---: | ---: |
| 중심 약 1% | 10,404 | 28,224 | 409,600 | 409,600 |
| 중심 약 10% | 104,976 | 153,664 | 409,600 | 409,600 |
| 중심 약 50% | 524,176 | 627,264 | 1,478,656 | 1,478,656 |
| 전체 100% | 1,048,576 | 1,048,576 (fallback) | 1,478,656 | 1,048,576 |
| 멀리 떨어진 두 모서리 | 2,048 | 1,048,576 (fallback) | 165,888 | 165,888 |

이 표의 단위는 중복을 포함한 **계획된 입력 픽셀 수**이며 GPU 연산량·속도가 아니다. 중심 약 1% 조건의 계획 CPU p50은 ROI 2.886 ms, 고정 tile 17.748 ms, adaptive 17.715 ms였다. 10회 표본 p95는 불확실성이 크며 다른 프로세스와 CPU 부하를 통제한 전문 benchmark가 아니다.

단일 ROI crop과 엄격한 원본 합성은 실제 생성 통합용으로 구현했다. 타일과 adaptive는 먼 영역 편집의 입력 면적을 줄일 후보지만, 연결된 영역에서 고정 tile보다 면적 이점이 없고 overlap으로 전체 면적을 넘는 사례도 있어 기본 기능으로 채택하지 않았다. 특히 full mask adaptive의 이점은 전체 프레임 한 장을 유지한 결과이며 새로운 모델 가속이 아니다. 타일/LOD의 모델 호출·seam·문맥 품질·VRAM·형상별 compile 비용을 검증하기 전까지 계획 실험으로 유지한다.

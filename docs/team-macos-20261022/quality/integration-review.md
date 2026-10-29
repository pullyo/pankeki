# 총괄 통합 검토 — 부분 수정 품질

검토일: 2026-10-23. 부분 수정의 요청 충돌·안내 수정은 수용했다. 실제 이미지 비교 후보 7건은 품질 미수용이며, 정밀한 색 변경 문제는 해결되지 않았다. GitHub 도구 설치·검증·사용은 완료했다.

## 수용한 변경과 검증

- 편집 요청에 생성용 스타일·기존 캐릭터 브리프가 자동 합쳐지는 충돌을 제거했다. 생성 모드의 스타일/브리프와 저장된 메타데이터는 유지한다. `profiles.js`, `redesign.js`, `redesign.css`와 관련 회귀 검사만 수정했다.
- 편집 모드의 입력 라벨·placeholder·키보드 안내를 수정 작업에 맞추고, 생성용 스타일 선택을 숨겼다. 생성 화면으로 돌아가면 기존 라벨·스타일·Enter 생성 안내가 복원된다.
- 총괄은 실제 1440×900 브라우저에서 원본/마스크를 선택하고 `ef48762b02b2449eb486138a3d46234e`를 실행했다. recipe/workflow에는 입력한 편집 지시만 전달됐다. 원본과 새 후보 2개가 유지되고 작업 메뉴 11개·기존 로고가 표시됨을 확인했다.
- QA가 서버 결과를 독립 재계산했다. 1024×1024, 마스크 밖 RGB 최대 오차 0, 전체 알파 오차 0, 내부 변경 78,403픽셀이다. 원본은 불투명 RGB이므로 투명 원본 추론의 검증으로 확대하지 않는다.
- 전체 JavaScript 검사 153건 중 151건 통과, skip 1, TODO 1, 실패 0. 최종 키보드 안내 보정 후 관련 13건을 총괄이 다시 실행해 모두 통과했고, 재빌드 후 브라우저에서도 두 모드의 안내를 다시 확인했다. UI 테스트를 이미지 품질 수용으로 해석하지 않는다.

## GitHub 도구 설치와 실제 사용

공식 GitHub 안정 릴리스의 ARM64 바이너리를 `.tools/codex-quality-tools/`에 설치했다. 게시 SHA256 대조와 라이선스 보존을 확인했다.

| 도구 | 버전 / 공식 저장소 | 사용 결과 |
|---|---|---|
| Ruff | 0.17.1 / https://github.com/astral-sh/ruff | 제품 Python 및 이번 실험/QA 스크립트에 E9,F63,F7,F82 오류 검사 적용, 0건. 기존 전체 기본 검사에서 나온 39건을 전체 lint 통과로 표시하지 않는다. |
| ast-grep | 0.51.0 / https://github.com/ast-grep/ast-grep | prompt 조립·마스크·source·합성 경계 구조 검색에 사용. 총괄도 mode가 preparePrompt에 전달되는 호출을 직접 확인했다. |

재사용 명령과 출처/무결성 기록은 [개발 도구 안내](../../DEV-TOOLS.ko.md) 및 [출시팀 도구 인계](mac-tooling.md)에 있다. 도구의 정적 검사로 실제 생성 품질을 대체하지 않는다.

## 미수용 결과

SDXL Base의 고정 입력 실험 4건은 모두 빨간 스카프 지시를 충족하지 못했다. prompt-only와 scheduler normal은 파랑이 남고, 중립 마스크 인코딩은 회색 면과 형태 손상을 만들었다. 원본 밖 보존·sampler 실행은 확인했지만 backend 수정 채택 근거가 되지 않아 제품 backend는 유지했다.

실행 경로는 앱 job 2건과 직접 Comfy 실험 2건으로 구분한다. 직접 실험은 기존 앱 계약 QA 도구를 통과한 앱 실행이 아니다. QA는 엄격 판독의 미통과를 보존하고 수동으로 요청·그래프·픽셀·실행 근거를 대조했다. 세부 결과는 [이미지 AI](image-ai.md), [QA](qa.md), [UX](ux.md)에 있다.

## 전용 모델 비교와 검증 한계

전용 `diffusers/stable-diffusion-xl-1.0-inpainting-0.1`의 pinned FP16 UNet 한 파일을 다운로드하고 전체 SHA256을 검증했다. 기존 Base CLIP/VAE와 core UNETLoader/InpaintModelConditioning을 쓰는 격리 시험 3회를 실제 MPS에서 완료했다. 기존 검증된 Base 0.65는 재사용했다. 방법 비교는 모델과 필수 conditioning의 결합이며 UNet만의 단독 효과로 주장하지 않는다.

| 실행 | 총괄의 실물 판정 | 실행·보존 근거 |
|---|---|---|
| 전용 0.99 smoke | 파란 목도리가 남고 천·술이 바뀜, 미수용 | 33.932초, sampler 실행·latent 유한성·밖 RGB/알파 오차 0 |
| 전용 0.65 | 파란 목도리가 남고 술·접힘이 바뀜, 미수용 | 26.722초, sampler 실행·latent 유한성·밖 RGB/알파 오차 0 |
| Base 0.99 | 빨강 일부 반영, 늘어진 천·몸통 구조 손상, 미수용 | 31.225초, sampler 실행·latent 유한성·밖 RGB/알파 오차 0 |

세 건은 직접 Comfy 실험으로 앱에 연결한 성공 사례가 아니다. 같은 source/mask/seed/prompt/negative/steps/CFG/sampler/scheduler를 유지해 0.65·0.99 쌍으로 비교했다. 시간은 클라이언트 wall time이며 GPU 계측 시간이 아니다. 메모리는 서버 RSS와 system_stats 샘플이며 GPU allocator 최대치로 해석하지 않는다. sampler float의 NaN/Inf는 없었지만 VAE 디코딩 직후 float까지 직접 계측한 것은 아니다. core 가중치 매핑 경고는 기록에 보존했다.

현재 core의 `set_steps`는 `int(steps/denoise)`로 스케줄을 정한다. 25 steps에서 0.99는 25로 내려가 1.0과 같은 스케줄 요청이 된다. 총괄이 해당 소스를 확인했고 AI의 오프라인 추적도 일치했다. 공식 Diffusers의 strength 0.99를 그대로 재현한 시험으로 볼 수 없으며, 전용 모델의 최적 품질이나 내부 실패 원인을 확정하지 않는다. 이를 찾았다는 사실만으로 제품 기본 denoise를 바꾸지 않았다.

총괄도 새 3건의 PNG를 독립 디코딩해 밖 RGB 오차·밖 변경 픽셀·전체 alpha 오차 0과 내부 변경을 재계산했다. `integration/phase2-independent-pixels.json`에 결과 SHA와 함께 보존했다. UX는 후속 7절에서 세 건을 모두 미수용했다. QA의 별도 수동 판독과 엄격 도구의 범위 제한은 QA 인계에 분리한다.

추가 가중치는 검증된 격리 시험 자산으로 보관했다. 품질 수용 근거가 없어 앱 모델 목록·backend 그래프·기본값에 연결하지 않았다. 기존 Base 가중치·런처·설정·모션·출력 코드를 유지했다. 원인 후보와 재현 조건은 AI 인계에 남기며, 다음 비교는 영역 해상도/컨텍스트와 prompt 전달 이후 모델 반응을 분리하는 새 가설부터 수립해야 한다. 현재 결과로 특정 내부 원인을 확정하거나 무작위 파라미터 탐색을 정당화하지 않는다.

단일 마스코트·한 마스크·한 seed 평가다. 투명 원본, 다양한 캐릭터, 취소·프로젝트·모션·출력의 새 실행 회귀는 이번 실제 UI job으로 입증하지 않는다. 기존 제품 기능의 관련 JS 회귀와 편집·모션 담당의 계약 검토는 별도 근거다.

DOM 이미지의 긴 data URL이 도구 출력에서 잘려 최초 픽셀 동일성 주장을 철회했다. 최종 기록은 길이/FNV/prefix/suffix의 문자열 지문 일관성만 확인한다. 독립 RGBA 동등성은 주장하지 않는다. 잘린 임시 PNG는 폐기했고 QA 인계에도 정정했다.

## 증거 위치

- `runtime/macos/inpaint-quality/integration/`: 소스 baseline·변경 해시, 전체 JS 로그, 실제 UI 요청·화면·모드 확인.
- `runtime/macos/inpaint-quality/qa/`: 독립 서버 픽셀/요청 판독과 미수용 품질 기록.
- `runtime/macos/inpaint-quality/ai/`: 실제 baseline/후보와 격리 실험 근거.
- `runtime/macos/inpaint-quality/model/provenance.json`: 공식 모델 revision·가중치 SHA·라이선스·Comfy 경로.
- `.tools/codex-quality-tools/evidence/`: 공식 도구 릴리스 선택·해시·버전·실제 사용 결과.

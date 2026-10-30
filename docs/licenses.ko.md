# 코드·모델 라이선스 기록

확인일: 2026-10-19. 이 작업은 로컬 평가·시험이며 계정 생성, 유료 API, 외부 공개나 배포를 수행하지 않았다.

| 구성 요소 | 출처·조건 | 보존 위치 |
| --- | --- | --- |
| ComfyUI | [공식 저장소](https://github.com/Comfy-Org/ComfyUI), GPL-3.0 | `vendor/ComfyUI/LICENSE`; commit은 환경 JSON |
| PyTorch | [공식 저장소](https://github.com/pytorch/pytorch), BSD-style 및 제3자 고지 | `.venv-comfy/Lib/site-packages/torch-*.dist-info/licenses/` |
| CUDA runtime | NVIDIA 배포 구성 요소, PyTorch CUDA wheel에 포함되는 라이선스 적용 | 설치 wheel 패키지의 license files |
| SD-Turbo | [공식 모델](https://huggingface.co/stabilityai/sd-turbo), [Stability AI Community License](https://huggingface.co/stabilityai/sd-turbo/blob/main/LICENSE.md) | `models/sd-turbo-LICENSE.md`, `models/sd-turbo-README.md` |
| SDXL Base 1.0 | [공식 모델](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0), [CreativeML Open RAIL++-M](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/blob/main/LICENSE.md) | `models/sdxl-base-provenance.json`에 원본 URL·해시·라이선스 링크 보존; 라이선스 전문은 로컬에 별도 저장하지 않음 |
| comfy-sdk 0.5.0 / comfy-api-proxy 0.1.6 | 공식 Comfy Python 패키지, MIT | `integrations/comfy-sdk/licenses/`, `provenance.json`, `requirements.lock.txt` |
| CropAndStitch | 사용자가 지정한 별도 pinned source | `integrations/github/sources/ComfyUI-Inpaint-CropAndStitch/LICENSE` 및 해당 통합 문서 |

SD-Turbo의 현재 LICENSE.md는 2024-07-05판이다. 로컬 평가·시험은 Research/Non-Commercial 범주에 명시되어 있다. 상업 사용에는 등록 및 연 매출 조건 등이 있으므로 이번 로컬 시험이 상업 배포 권한 확인을 대신하지 않는다. 모델 파일과 라이선스 문서는 원본을 보존하며, 파일별 SHA-256 및 다운로드 URL을 환경 evidence에 기록한다.

Powered by Stability AI

This Stability AI Model is licensed under the Stability AI Community License, Copyright © Stability AI Ltd. All Rights Reserved.

설치된 모든 Python 패키지 버전은 `evidence/environment-pip-freeze.txt`로, 패키지별 라이선스 메타데이터와 고지 파일 경로는 `evidence/environment-package-licenses.json`로 보존한다. 버전 메타데이터가 없는 패키지를 임의로 자유 라이선스라고 단정하지 않는다.

## 2026-10-28 갱신 (Mac 제품 구성)

현재 앱이 실제로 쓰는 모델·구성 요소와 영문 고지는 루트 `THIRD_PARTY.md`가 기준이다. 위 표는 2026-10-19 Windows 평가 당시 기록이다.

| 구성 요소 | 라이선스 | 비고 |
| --- | --- | --- |
| Animagine XL 4.0 Opt | CreativeML Open RAIL++-M (발행처 카드: SDXL 라이선스를 수정 없이 채택) | `cagliostrolab/animagine-xl-4.0` @ `2b7c1b397761`, SHA256 `6327eca9…` 발행처 값과 일치 확인 |
| SDXL Inpainting 0.1 UNet | CreativeML Open RAIL++-M | `diffusers/stable-diffusion-xl-1.0-inpainting-0.1` @ `115134f36312`, SHA256 `64708407…` 일치 확인 |
| ComfyUI | GPL-3.0 | 저장소에 포함하지 않고 설치 스크립트가 고정 commit `8f04fd6e…`을 `vendor/`에 내려받아 별도 프로세스로 실행 |
| Electron 45 / @electron/packager 20.3 | MIT / BSD-2-Clause | 데스크톱 셸 |
| MCP Python SDK 2.3.0 | MIT | 도구 서버 전용 환경 |
| Pretendard / Lucide | OFL-1.1 / ISC | UI 글꼴·아이콘 |
| FLUX.2 Klein·Qwen-Image-Edit-2511 | Apache-2.0 | 실험용, 앱 미사용·미배포 |
| Qwen-Image 2.1 | qwen-research (연구용 제한) | 실험용, 제품 사용 전 검토 필요 |
| LTX-2.3 / Gemma 3 | LTX-2 Community License / Gemma Terms | 영상 실험용, 앱 미사용·미배포 |

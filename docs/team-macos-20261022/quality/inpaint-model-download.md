# 전용 SDXL inpaint UNet 다운로드 인계

작성일: 2026-10-23 KST · 담당: Pankeki Mac 출시 엔지니어
프로젝트 루트: `/Volumes/Samsung 970 EVO Plus/V/restored-20261020/Pankeki` (이하 로컬 경로는 루트 기준).
배정: `quality-sprint.md`의 2차 제한 시험. **지정 UNet 한 파일의 다운로드·전체 무결성 검증·Comfy core의 오프라인 파일 검색 확인까지 완료했다. 실제 모델 로드·추론·품질 판정은 후속 단계다.**

## 공식 출처와 고정 revision

| 항목 | 확인값 |
|---|---|
| 공식 저장소 | [diffusers/stable-diffusion-xl-1.0-inpainting-0.1](https://huggingface.co/diffusers/stable-diffusion-xl-1.0-inpainting-0.1) |
| 고정 commit | `115134f363124c53c7d878647567d04daf26e41e` |
| 공식 메타데이터 | [고정 revision API](https://huggingface.co/api/models/diffusers/stable-diffusion-xl-1.0-inpainting-0.1/revision/115134f363124c53c7d878647567d04daf26e41e?blobs=true), public / gated=false |
| 받은 단일 가중치 | `unet/diffusion_pytorch_model.fp16.safetensors` |
| 고정 다운로드 URL | [UNet FP16](https://huggingface.co/diffusers/stable-diffusion-xl-1.0-inpainting-0.1/resolve/115134f363124c53c7d878647567d04daf26e41e/unet/diffusion_pytorch_model.fp16.safetensors) |
| 공개 LFS 크기와 실제 크기 | **5,135,178,560바이트 — 일치** (약 5.14GB / 4.78GiB) |
| 공개 LFS SHA256와 전체 파일 계산값 | **`6470840731e98cc16713ddf3ac7ee458c9fdbcb881a98c6727cd4a938f227d3f` — 일치** |

Hugging Face 연결로 저장소를 확인하고, 추가 REST 조회로 main의 commit과 고정 revision의 파일별 LFS 크기·SHA를 교차 확인했다. main 응답과 고정 응답은 `runtime/macos/inpaint-quality/model/hf-main-metadata.json`, `hf-pinned-metadata.json`에 보존했다.

## 실제 모델 경로와 UNETLoader filename

- 프로젝트 보관 위치: `models/diffusion_models/sdxl-inpainting-0.1/unet/diffusion_pytorch_model.fp16.safetensors`
- Comfy 기본 경로의 링크: `vendor/ComfyUI/models/diffusion_models/sdxl-inpainting-0.1-unet-fp16.safetensors`
- 상대 링크 대상: `../../../../models/diffusion_models/sdxl-inpainting-0.1/unet/diffusion_pytorch_model.fp16.safetensors`
- **core `UNETLoader`의 `unet_name`: `sdxl-inpainting-0.1-unet-fp16.safetensors`**

크기와 전체 SHA256 검증이 끝난 뒤 링크를 만들었다. 링크는 프로젝트 내부의 검증된 파일 한 개를 가리키며 가중치 복사본을 만들지 않는다.

기존 `folder_paths.py:31`은 기본 `models/unet`와 `models/diffusion_models`를 검색하고, `nodes.py:992`의 UNETLoader는 그 목록을 사용한다. 별도 프로세스에서 기존 core `folder_paths.get_filename_list('diffusion_models')`와 `get_full_path_or_raise(...)`를 실행해 위 filename의 노출과 실제 대상 경로를 확인했다. 검사 전 목록은 비어 있었고 검사 후에는 위 항목이 있었다. 이 프로세스에서 torch·nodes·서버를 import하거나 모델을 로드하지 않았다. 실행 중인 서버의 UI 목록 갱신 여부는 확인하지 않았다.

정적 safetensors 헤더도 읽었다: tensor 1,680개, dtype은 모두 `F16`, `conv_in.weight`는 `[320, 9, 3, 3]`이다. 모델 카드는 기존 SDXL Base에 추가 입력 채널 5개를 사용하는 inpaint UNet이라고 설명한다. 이 확인은 GPU 로드·conditioning 호환성 검증을 대신하지 않는다.

## 라이선스·모델 카드 보존

모델 카드의 `license: openrail++`와 직접 연결된 **CreativeML Open RAIL++-M License, 2023-07-26**를 확인했다. UNet 저장소의 모델 카드는 공식 SDXL Base의 LICENSE.md를 가리킨다. 해당 전문은 Base 고정 commit `462165984030d82259a11f4367a4eed129e94a7b`에서 보존했다.

| 함께 보존한 소형 파일 | 공식 출처·원본 Git blob 일치 |
|---|---|
| `models/diffusion_models/sdxl-inpainting-0.1/README.md` — 4,861바이트 | [고정 모델 카드](https://huggingface.co/diffusers/stable-diffusion-xl-1.0-inpainting-0.1/raw/115134f363124c53c7d878647567d04daf26e41e/README.md), blob `50a076318d56fcc0f53aadef808cc640c2eeee5e` |
| `models/diffusion_models/sdxl-inpainting-0.1/LICENSE.md` — 14,109바이트 | [고정 공식 라이선스 전문](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/raw/462165984030d82259a11f4367a4eed129e94a7b/LICENSE.md), blob `af7e355e31c0d976933aa0d06759611151ad8c39` |

두 소형 파일은 원본 Git blob SHA와 대조했고 SHA256도 provenance에 기록했다. 라이선스 출처 API는 `runtime/macos/inpaint-quality/model/license-source-metadata.json`에 있다. 모델 카드의 예제 이미지·전체 repository·FP32 variant·다른 모델은 받지 않았다.

## 다운로드·디스크·캐시

다운로드 전 외장 SSD 여유 공간은 **1,880,064,000,000바이트**, 완료 후 확인값은 **1,875,968,000,000바이트**였다. 가중치 최종본의 논리 크기는 위의 5,135,178,560바이트다. 여유 공간 변화에는 같은 볼륨의 다른 작업도 포함될 수 있다.

기존 생성 venv에 설치된 `huggingface_hub 2.2.0 / hf-xet 1.7.0`을 사용하고 `hf_hub_download`에 **repository·고정 revision·위 filename 한 개**만 전달했다. `token=False`인 공개 요청이며 패키지를 추가 설치하지 않았다. 샌드박스의 DNS 접근 실패 후 네트워크 작업은 `require_escalated` 절차로 수행했다. 전송·전체 해시·링크 생성까지 약 **574.27초**가 걸렸다. 추론 시간 수치가 아니다.

프로세스 한정 설정:

- `HF_HOME`: `runtime/macos/inpaint-quality/model/hf-home`
- `HF_HUB_CACHE`: 위 경로의 `hub/`, `HF_XET_CACHE`: 위 경로의 `xet/`
- local download metadata/임시 파일: `models/diffusion_models/sdxl-inpainting-0.1/.cache/huggingface/`
- Xet chunk cache 크기는 0으로 지정하고 telemetry·implicit token 사용을 끄며, Python bytecode 쓰기도 비활성으로 실행했다. 셸 설정과 전역 환경을 바꾸지 않았다.

완료 시 HF 전용 작업 경로의 논리 크기는 1,311바이트, local download metadata는 315바이트였고 `.incomplete` 파일은 남지 않았다. 큰 임시 가중치 복사본은 보존하지 않았으며 실제 safetensors 파일은 한 개다. 다운로드 보조 스크립트와 과정·검증 기록은 `runtime/macos/inpaint-quality/model/`에 있다.

## 보존 확인과 다음 인계

실행기·Mac 런처·runtime 설정/모델 경로·Comfy nodes/folder_paths·두 venv의 pyvenv.cfg 총 8개 파일은 다운로드 전후 SHA256이 같았다. 기존 Base의 파일 크기 6,938,078,334바이트와 mtime_ns도 같았으며 Base 전체 해시는 이번에 다시 계산하지 않았다. 기존 Base 가중치·Comfy 코드·venv·런처·runtime config와 프로세스는 이 작업에서 변경하지 않았다. vendor 아래 추가물은 위 상대 링크 한 개다.

GPU 사용·모델 로드·실제 추론·서버 재시작·앱 그래프/기본 모델 변경은 수행하지 않았다. 다음 단계는 이미지 AI 담당의 core UNETLoader + InpaintModelConditioning, 기존 Base CLIP/VAE 연결, MPS 자원/NaN 확인, 제한 smoke 및 품질·픽셀 비교다. 이 문서의 완료 범위는 다운로드 무결성과 오프라인 파일 검색이다.

기계 판독용 최종 인계: **`runtime/macos/inpaint-quality/model/provenance.json`**, 상태 `verified_download_and_core_discovery`, `download_verified=true`.

변경 범위: 전용 모델 폴더의 UNet·README·LICENSE와 HF local metadata, Comfy 기본 모델 폴더의 상대 링크 한 개, `runtime/macos/inpaint-quality/model/`의 출처·다운로드·검증·전용 캐시 자료, 이 인계 문서다. 다른 담당 파일·공통 실행 기준은 수정하지 않았고 다른 채팅으로 메시지를 보내지 않았다. 다음 배정을 기다린다.

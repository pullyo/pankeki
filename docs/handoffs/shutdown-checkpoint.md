# 종료 전 기능 체크포인트 — 2026-10-19 KST

**파일 동결. 추가 생성·다운로드·생산 코드 변경을 중단했다.** 총괄의 PC 종료/모델 제외 백업 요청에 따라 이 인계만 마지막으로 작성했다. 아래 내용이 이전 `function-quality-sdk.md`의 SDXL 미적용 설명보다 최신이다.

## 현재 실행/저장 상태

- 비교 9개 모두 완료. `work/quality-improvement/app-model-comparison-first/report.json`: `state=succeeded`, cases9. 9개 모두 공식 SDK 제출 후 실제 native sampler 실행을 확인했다.
- 종료 준비 시 Comfy `/queue` 조회: running0, pending0. 진행 중 생성/다운로드 없음. 작업 재시도나 예약 없음.
- 앱 `http://127.0.0.1:8190`, 현재 listener PID20796. Comfy8188/SDK proxy8189는 유지했고 앱만 재시작했다. **앱 기본 모델은 이제 SDXL Base 1.0**이다. 브라우저 새로고침 후 상세 설정에서 SDXL/SD Turbo 선택 가능하다.
- `runtime/config.json`에 두 모델의 경로·개별 manifest와 `default_model_id: sdxl-base`, `transport: sdk`가 저장됐다. SDK/native 프로세스와 캐시의 메모리 상태는 PC 종료 시 사라지며, 디스크 결과는 저장됐다.
- 모델 파일은 제외할 백업 대상: `models/checkpoints/sd_turbo.safetensors`, `sd_xl_base_1.0.safetensors`, 그리고 중복된 `sd_xl_base_1.0.safetensors.part`. SDXL 최종본 SHA256은 `31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b`. `.part`는 복사 후 남은 동일 파일이며 추가 다운로드 중이 아니다. `models/sdxl-base-provenance.json` 같은 작은 출처 기록은 모델 가중치와 구분해 보존하면 된다.

## GitHub 공개 이후 로컬 변경

총괄이 게시한 `pullyo/pankeki` main `869a6f852f2d13595d5af503261080de99dc6d7f` 이후의 변경이다. 이 채팅은 원격에 추가 push하지 않았다. `work/publication/repo`는 별도 스냅샷이며 아래 최신 소스는 `D:/Pankeki`에 있다.

- `pankeki/model_presets.py` 신규: SDXL 1024²/25steps/CFG6/dpmpp_2m/karras, 편집강도.55; Turbo512²/1step/CFG1/euler/normal. SD Turbo는 빠른 시안용으로 표시.
- `pankeki/engine.py`: 허용된 `model_id`로 선택, 누락 설정에만 기본값 적용. 모델별 manifest/SHA256/read lease/cache identity 보존. 잘못된 id·미설치·id와 checkpoint 이름 불일치 거부. 기존 explicit 설정과 legacy 요청 유지.
- `pankeki/server.py`: GET `/api/models` 및 default model health, 요청을 큐에 넣기 전에 모델 검증. bind 실패 때 worker/lease 정리.
- `web/src/app.js`: 모델 선택/기본 설정 적용, 샘플러·스케줄러 제출, 후보에 모델 기록, catalog 실패 시 생성 차단.
- `web/src/profiles.js`: 프로젝트 request에 optional `model_id` 보존. 옛 이미지에 모델을 임의로 붙이지 않음.
- `web/src/index.template.html`: 모델 선택·기본값 버튼·sampler/scheduler 필드·모델 안내만 최소 변경. 디자인 채팅 idle 확인 후 수정. 기존 채팅 중심 레이아웃/CSS/로고 유지.
- `web/index.html`: 위 소스로 다시 빌드함. 생성 산출물이며 공개 저장소에서는 제외하는 정책 유지.
- 관련 회귀: `tests/test_engine.py`, `tests/test_server.py`, `web/tests/profiles.test.cjs`, `scripts/test_ui_state.cjs`.

## 실제 검증 범위

- 엔진33개 + HTTP14개 통과. 새 테스트를 수정 전 실패/수정 후 통과로 확인했다. 모델별 파일 잠금과 해제, 선택 모델 캐시 분리, 모델명 오표시 거부, SDXL 편집 기본강도의 실제 graph 전달 포함.
- UI 상태/프로젝트 검증58개 통과. 모델 전환 시 프리셋과 request/저장 후보 일치, 목록 오류 시 생성 차단, 기존 취소·후보·복원 동작 포함.
- 실제 headless Chrome 1440px/390px에서 기본 SDXL, Turbo 전환, 수동 steps 변경/기본값 복원, 가로 넘침/페이지 오류 없음 확인. GPU 생성과 별도 검사다. `work/quality-improvement/model-ui/{report.json,1440.png,390.png}`, 재현 `verify-model-ui.cjs`.
- 실제 앱 `/api/jobs` → official SDK → proxy → Comfy 경로 9회 모두 성공. 정확한 model/checkpoint·seed·steps·CFG·prompt·해상도·native sampler 실행을 각각 저장했다. 이는 이미지 품질 통과를 뜻하지 않는다.

## 이미지 원인/품질 판정

첨부 이미지와 `prompt-only/compact-601020.png`는 RGBA 픽셀이 완전히 같다. **SD Turbo /512×512/1step/CFG1/euler/normal/seed601020**였고 SDXL 결과가 아니다. 증거 `work/quality-improvement/input-image-audit.json`.

실험은 고정 seed601019/601020/601021 세 개씩 다음9개다. 모든 원본 PNG·요청·native history·소요시간은 `app-model-comparison-first/<case_id>/`에 저장했다. 모델과 해상도/샘플링 설정을 함께 바꿨으므로 A↔B는 순수 가중치만의 효과가 아니고, B↔C는 긍정/부정 프롬프트 묶음의 효과다. 속도 벤치마크도 아니다.

| 군 | 결과 |
| --- | --- |
| A-turbo-compact | 기존 간결 문장, Turbo 적정 속도용 설정. 중복 손/유령 인물/불필요 스케치, 장갑·망토 색 오류. |
| B-sdxl-compact | 같은 문장, SDXL 적정 설정. 얼굴·의상·팔 구조는 개선. 601019는 여러 인물 뷰, 601021은 주변 옷/흉상 도해를 추가. 601020만 단일 인물+단순 배경 구도 충족. 세 장 모두 청록 장갑 실패. |
| C-sdxl-refined-bundle | SDXL 설정 동일, 단일 인물/깨끗한 배경을 강화한 문장+negative. **단일 전신 인물은3/3**. 그러나 세 장 모두 청록 장갑과 벨트 황동 플라스크 실패. 601019는 사막 배경/맨손/손에 든 병, 601020은 요청하지 않은 청록 칼/손에 든 큰 가방, 601021은 청록 망토/갈색 장갑/손에 든 랜턴 형태. |

**엄격한 전체 요구를 만족한 이미지는 없음.** 모델·적정 설정 변경은 형태 품질을 개선했고 프롬프트 수정은 구도 오류를 줄였으나 세부 지시 준수까지 해결하지 못했다. 손 해부학도 완전 통과라고 하지 않는다. C 문장을 제품 기본 프롬프트로 자동 적용하지 않았다. 이전 SDXL 가방 부분 편집의 재질 실패 역시 미해결이다. 최우수상 품질 완료로 보고하면 안 된다.

## 재개 순서

1. 총괄 백업 완료 후 PC를 종료해도 진행 중 추론은 없다. 본 파일 작성 뒤 이 채팅은 더 이상 파일을 수정하지 않는다.
2. 같은 PC 재개 시 모델 두 파일과 venv/Comfy/SDK 설치 존재부터 확인한다. 모델을 포함하지 않은 백업만으로는 가중치가 복구되지 않는다. 임의로 추가 다운로드하지 않는다.
3. Comfy를 기존 조건으로 실행: working directory `D:/Pankeki/vendor/ComfyUI`, Python `D:/Pankeki/.venv-comfy/Scripts/python.exe`, args `main.py --listen 127.0.0.1 --port 8188 --offline --disable-all-custom-nodes --use-pytorch-cross-attention --fp16-unet --fp16-text-enc --fp32-vae --preview-method latent2rgb --extra-model-paths-config D:/Pankeki/vendor/pankeki-model-paths.yaml --whitelist-custom-nodes ComfyUI-Inpaint-CropAndStitch`. background 실행은 Start-Process -WindowStyle Hidden을 사용하고 새 포트 listener PID를 확인한다.
4. **이전 PID/프로세스 guard를 재사용하지 말 것.** 새 실제8188 PID로 `.venv/Scripts/python.exe scripts/prepare_manifest.py --pid <새 PID> --fingerprint-policy windows_read_lock`를 실행한다. 이 스크립트는 기존 single-Turbo config를 만들므로 이어서 `.venv/Scripts/python.exe work/quality-improvement/configure-models.py`로 두 모델 catalog/default SDXL을 복원하고 `runtime/config.json`의 `transport`를 `sdk`로 명시 설정한다. manifest는 새 프로세스와 실제 파일을 기준으로 만들어야 한다.
5. `integrations/comfy-sdk/start-proxy.ps1`로8189 실행 후 `scripts/start-pankeki.ps1`로8190 실행. 필요 시 숨김 background로 실행. `activate-sdk.ps1`은 실행 중 앱 재시작용이므로 재부팅 뒤 앱이 없는 상태에서 그대로 쓰지 않는다.
6. GET `/api/health`의 comfy=true/transport=sdk/default_model_id=sdxl-base 및 `/api/models`의 두 모델 available=true 확인. source를 더 수정하면 앱을 재시작해야 한다.
7. 재개할 품질 작업: 저장된9개를 사용자와 확인하고 전체 요구 실패를 명확히 설명한다. 현재 가장 큰 잔여 문제는 색/소품 위치/불필요 소품과 부분 편집의 재질 준수다. 추가 모델 다운로드나 MoE 작업을 먼저 시작하지 않는다. 반복 생성 대신 모델·프롬프트·부분 편집 workflow 중 검증할 가설과 기준을 정한 뒤 진행한다.

비교 재실행이 실제 필요한 경우에만 `compare-app-models.py --run --output-name <새 폴더명>`을 사용한다. 현재9개는 이미 완료했으므로 자동 재실행하지 않는다. 이 명령은9회 GPU생성을 한다. `--plan`은 오프라인 계획, `--check`는 읽기 전용 사전 확인이다.

## 백업에 보존할 작은 증거

최신 소스/테스트/문서 외에 `work/quality-improvement/`의 `input-image-audit.json`, `app-model-comparison-first/`, `model-ui/`, `compare-app-models.py`, `configure-models.py`, `verify-model-ui.cjs`를 보존하면 재개와 비교 재현이 쉽다. 개인 프로젝트/키가 아닌 이 실험 원본 이미지는 품질 증거지만 공개 업로드와 백업은 별개다. 모델 가중치·venv·캐시는 백업 요청의 제외 정책을 따른다. 로컬 Qwen/Whittle는 이 기능 작업에서 설치하거나 실행하지 않았다.

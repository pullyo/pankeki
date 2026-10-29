# 기능 인계 — SDK 실제 앱 경로 / 품질 비교

2026-10-19. 기존 UI 검증은 반복하지 않았다. 공식 SDK 설치·브리지와 앱 연결 완료. 사용자 승인 범위의 SDXL 다운로드와 RTX 5060 8GB 실제 생성·편집 비교도 완료했다. 앱 기본 모델은 아직 SD Turbo다.

- 실제 앱: `127.0.0.1:8190` → 공식 comfy-sdk 0.5.0 → comfy-api-proxy 0.1.6 `127.0.0.1:8189` → 기존 ComfyUI `127.0.0.1:8188`. 계정·API 키·유료 서비스 없음. runtime/config.json의 `transport: sdk` 활성화. 앱만 재시작했고 ComfyUI는 유지.
- SDK 설치/재현: `integrations/comfy-sdk/README.ko.md`, `requirements.lock.txt`, `start-proxy.ps1`. SDK/proxy MIT 라이선스와 출처·설치 해시 보존. 가중치/venv/runtime/outputs는 공개 소스에서 제외할 항목.
- 실제 앱 새 생성 job `934d5102b069400e850e42434f232ca9`, SDK/native job `2ad16676-701c-4cb5-ac83-df5b6f8e58be`. 실제 업로드+편집 app job `e0464ff6b7cc4351bae9a255666e7ee6`, SDK/native `06a8edbd-7682-4271-b643-40f0f2186c9e`. 둘 다 native history에서 sampler 실행 확인. 원본 밖 RGBA 최대 오차0.
- 결과/영수증/원본 history: `work/quality-improvement/sdk-app-live/`. 재현: `.venv/Scripts/python.exe work/quality-improvement/verify-sdk-app.py` (기존 출력 덮어쓰기 방지; 재실행 시 새 output 경로 필요).
- backend: engine의 SDK transport 선택 및 캐시 키에 bridge/lock 해시 포함, SDK 죽었을 때 health 실패. client는 취소·deadline·불확실 제출 자동 재시도 금지·입력 파일 보존·PNG 결과 검증을 유지. 새 SDK adapter 15개, bridge 12개 검사 통과. 전체 Python suite는 최종 제출오류분류 보완 직전97개 통과/Windows 권한1개 skip, 보완 뒤 관련15개 통과.

## 품질 판정

현재 SD Turbo만으로 최우수상 수준이라고 판단하지 않는다. 같은 seed601019/601020에서 프롬프트만 줄여도 추가 손·분리 소품·유령 인물이 남았다. `work/quality-improvement/prompt-only/` 참조.

부분 수정의 원인 두 가지를 확인했다. 기존 VAEEncodeForInpaint는 선택 RGB를 회색으로 지웠고, normal/1step/denoise.75는 사실상 최대 노이즈였다. production workflow를 원본 VAEEncode + SetLatentNoiseMask로 수정했다. 설치된 실제 Comfy 노드의 입력을 실행하는 CPU 회귀를 RED→GREEN 확인(`test_production_inpaint.py`).

동일 원본·마스크·seed601100의 simple/1step/denoise.5에서는 몸과 배경 붕괴를 줄였지만 **요청한 빨간 가방 생성은 실패**했다. `preserving-live-20261019/` 및 `sdk-app-live/edit.png`. 원본 밖 보존과 편집 지시 성공은 별개다. 현재 UI 기본 강도1/normal은 아직 이 낮은 강도 프리셋으로 바꾸지 않았다. SDXL 비교 후 모델별 적절한 기본값과 표시를 함께 맞춰야 한다.

## SDXL 비교 완료

- 공식 SDXL Base 1.0 단일 체크포인트 6,938,078,334 bytes를 받았고 SHA-256 `31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b`가 공식 파일 메타데이터와 일치함을 확인했다. 출처·라이선스 링크·검증 기록은 `models/sdxl-base-provenance.json`. refiner는 받지 않았다. Windows 파일 공유 잠금 때문에 rename 대신 복사 후 최종 파일을 재검증했으며, 같은 크기의 `.safetensors.part`도 남아 있다. 모델과 이 중간 파일 모두 공개 소스 제외 대상이다.
- 공식 SDK 경로에서 1024×1024, 25 steps, CFG 6, dpmpp_2m/karras로 실제 실행했다. 모든 결과는 native history에서 sampler 실행까지 확인했다. 8GB GPU에서 OOM 없이 완료했다. 시험 후 Comfy 모델/노드 캐시 메모리를 해제했으며 서버와 앱 디스크 캐시는 유지했다.
- 동일한 간결한 프롬프트, seed601019/601020으로 비교했다. SD Turbo와 모델·해상도·샘플링 설정이 다르므로 단일 변수 비교나 속도 벤치마크가 아니다.

| 사례 | SDK 전체 소요 | 관찰 |
| --- | --- | --- |
| 생성 seed601019 | 22.99초 | 얼굴·의상은 좋아졌으나 한 인물 요청에 여러 시점/인물을 그려 구성 지시 실패 |
| 생성 seed601020 | 13.64초 | 중앙 단일 인물, 얼굴·의상·장비 개선. 장갑 색과 손의 정확성은 여전히 한계 |
| 빨간 가죽 가방 편집 첫 시도 | 14.07초 | 빨간색은 반영됐지만 유리 용기처럼 보여 재질/형태 실패 |
| 같은 조건에서 편집 프롬프트만 변경 | 12.99초 | 더 납작한 가방 형태이나 광택이 강해 무광 가죽 지시 성공으로 인정하지 않음 |

두 편집은 같은 원본·마스크·seed601100, denoise0.55, feather4다. 마스크 밖 1,041,405픽셀의 RGB 최대 오차는 모두0이다. 원본 보존은 확인했지만 편집 의미의 정확성은 아직 해결하지 못했다.

결과: `work/quality-improvement/sdxl-base-first/`, `sdxl-edit-first/`, `sdxl-edit-prompt-only/`. 요약 및 실제 실행 job ID: `work/quality-improvement/sdxl-summary.json`. 재현 스크립트: `sdxl_experiment.py`, `sdxl_edit_experiment.py`. 같은 경로의 `comparison.ko.md`에서 비교 이미지를 볼 수 있다.

현재 앱의 SD Turbo 기본값(512, 1step, CFG1)을 SDXL에 그대로 쓰면 안 된다. 다음 구현은 모델별 프리셋과 UI 설정을 함께 연결하고, 단일 인물 구성 및 정확한 부분 편집을 다시 검증하는 것이다. 이번 변경에 SDXL 앱 기본값 전환은 포함하지 않았다. 수상 가능성이나 모든 출품 요건 충족을 확정하지 않는다.

채팅 중심 UI 연결의 최소 계약은 `docs/handoffs/chat-generation-contract.md`. 이 기능 작업에서는 LLM을 연결하거나 추가 다운로드하지 않았다. `qwen27b-readiness.md`는 앞서 조사한 dense Qwen3.8-27B의 참고 기록이며, 총괄이 이후 선정한 Whittle MoE 후보의 검증 결과가 아니다. 공개 저장소 게시와 최종 README는 총괄이 진행한다.

공개 스냅샷에 필요한 기능 패치: `pankeki/sdk_adapter.py`, `engine.py`, `server.py`, `workflows.py`, 관련 `tests/`, `integrations/comfy-sdk/`의 소스·고정 버전·라이선스. 현재 미완성 범위는 SDXL UI 프리셋 연결, 편집 정확성, 채팅 LLM 연결이다. `work/`, `models/`, `runtime/`, venv, 개인 프로젝트 JSON은 제외한다.

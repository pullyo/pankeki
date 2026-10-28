# 기능 및 이미지 품질 담당 1차 인계 — 2026-10-20 KST

**1차 검토 완료, 총괄 검토 대기. 생산 코드·기존 테스트는 변경하지 않았다.** 새 이미지 생성, 모델/패키지 다운로드, 서버 시작, 원격 게시는 하지 않았다. 복구 기준 백업도 수정하지 않았다.

## 총괄 역할 조정 반영

2026-10-20 KST 총괄의 후속 지시에 따라 이후 코드 소유 범위는 `pankeki/`와 백엔드 관련 기존 테스트다. `web/src/app.js`, `web/src/profiles.js`, `web/tests/profiles.test.cjs`, `scripts/test_ui_state.cjs`는 새 프론트엔드 담당에게 넘긴다. **네 파일 모두 이번 담당의 생산 코드·테스트 변경이 없고, 진행 중인 수정이나 검증도 없어 즉시 인계 가능하다.** 해당 파일에 추가 수정하지 않는다.

프론트엔드 담당이 참고할 기존 읽기 전용 검증 결과는 `work/team-resume/function/ui-baseline.log`의 58개 통과 기록이다. 새 담당이 코드를 변경하면 그 이후 검증은 별도로 수행해야 한다. 이번 품질 검토와 미실행 실험안은 아래 기록 그대로 총괄 검토 대상으로 유지한다.

## 완료 사항과 판단

`TEAM-OPERATIONS.ko.md` → `shutdown-checkpoint.md` → `TEAM-CONTEXT.ko.md` 순으로 읽고 최신 체크포인트를 기준으로 조사했다. 소유 범위의 엔진·워크플로·모델 프리셋·UI 요청·프로젝트 보존 경로를 검토했다.

- 비교 9개 `result.png`를 각각 직접 열었다. SDXL의 인물 형태 개선과 C군 단일 전신 3/3은 확인되지만, 엄격한 전체 요구 성공은 **0/9**다. 청록 장갑, 망토 색, 허리 황동 플라스크/소품 위치가 남아 있다. 최신 체크포인트의 설명과 일치한다.
- 9개의 PNG SHA256·해상도, 저장 요청·recipe·앱 graph·native graph를 대조했다. 모델·긍정/부정 프롬프트·seed·steps·CFG·sampler·scheduler·denoise가 일치한다. 저장된 native 성공 기록에서 sampler node5가 cache 제외인 것도 다시 확인했다. 이번 새 GPU 실행 증거는 아니다.
- SDXL 부분 수정 2개와 Turbo preserving 부분 수정 2개를 현재 합성 함수로 다시 계산해 저장 결과와 일치함을 확인했다. 마스크 밖 RGBA 및 전체 알파 최대 오차는 모두 0이다. SDXL 두 원본은 RGB, preserving 두 원본은 RGBA다. 실제 비불투명 알파는 엔진/HTTP 회귀에서 별도 확인했다.
- 두 SDXL 편집은 빨간색은 반영되지만 유리·금속 같은 광택이 남아 무광 가죽 지시 실패다. Turbo preserving 두 결과와 `sdk-app-live/edit.png`도 육안 검토했으며 빨간 가방 요구를 통과하지 못한다.
- 현재 조사와 검증에서 **재현되는 기능 결함은 없었다.** 이미지 지시 실패를 프롬프트 유실·모델 오선택·마스크 밖 손상으로 설명할 근거는 없다. 모델의 의미 결합/편집 강도/작은 선택 영역의 표현력은 가설이며, 근본 원인으로 확정하지 않았다.

경로 추적: `app.js`의 `requestSnapshot`이 현재 모델과 설정·컴파일 프롬프트·원본 바이트·마스크를 고정하고, `makeRequests`는 seed만 순차 변경한다. `Engine.validate_request`는 선택 모델의 누락 설정에만 기본값을 적용한다. workflow의 CLIP 텍스트·KSampler 설정은 요청을 전달하고, VAEEncode + SetLatentNoiseMask가 원본 구조와 선택 마스크를 분리한다. 최종 합성 후 원본 알파를 복원한다. `profiles.js`는 후보의 명시적 모델/설정을 보존하고 원본·마스크를 내보낸 request에서 제외하며, 과거 후보에 모델을 임의로 붙이지 않는다.

## 실제 생성·변경 파일

생산 코드, `scripts/test_ui_state.cjs`, `web/tests/profiles.test.cjs`, HTML/CSS/빌드 파일 변경 없음. 이 인계 파일과 다음 신규 검토 자료만 작성했다.

- `work/team-resume/function/audit_saved_evidence.py` — 저장 증거의 읽기 전용 검사. HTTP·모델 로드·추론 없음.
- `work/team-resume/function/saved-evidence-audit.json` — 9개 생성, 4개 부분 수정 검사 및 검토 시점 생산 소스 SHA256.
- `work/team-resume/function/visual-review.ko.md` — 이미지별 관찰과 기능/품질 구분.
- `work/team-resume/function/next-experiment.json` — 실행하지 않은 우선 실험 1개.
- 로그: `engine-baseline.log`, `ui-baseline.log`, `composite.log`, `sdk-adapter.log`, `server.log`, `saved-evidence-audit.log`, `saved-evidence-audit-final.log`, `production-inpaint-environment.log`.

`saved-evidence-audit.log`는 검사용 임시 스크립트가 native history의 두 저장 형태(단일 객체/ID별 응답)를 동일하게 가정해 중단된 최초 실행이다. 파서를 두 형태에 맞춘 뒤 `saved-evidence-audit-final.log`에서 통과했다. 제품 결함이나 저장 이미지 손상은 아니었다. 기존 원본 보고서는 수정하지 않았다.

## 검증 명령과 결과

작업 위치 `D:/Pankeki`. 이번에 사용한 Python은 `C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe`이며 아래 표의 `PY`는 그 절대 경로다. Python 3.12.14 / Pillow 12.3.0 / numpy 2.3.5. 과거 생성 기록의 numpy 2.5.4와 다르므로 과거 GPU 환경 재현 완료라고 주장하지 않는다.

| 명령 | 실제 결과 | 증거 |
| --- | --- | --- |
| `PY -m unittest discover -s tests -p test_engine.py -v` | 33개 통과, exit0 | `engine-baseline.log` |
| `node --test web/tests/profiles.test.cjs scripts/test_ui_state.cjs` | 58개 통과, exit0 | `ui-baseline.log` |
| `PY -m unittest discover -s tests -p test_composite.py -v` | 4개 통과, exit0 | `composite.log` |
| `PY -m unittest discover -s tests -p test_sdk_adapter.py -v` | 15개 통과, exit0 | `sdk-adapter.log` |
| `PY -m unittest discover -s tests -p test_server.py -v` | 14개 통과, exit0 | `server.log` |
| `PY work/team-resume/function/audit_saved_evidence.py` | 생성9/부분수정4 통과, exit0 | `saved-evidence-audit-final.log`, JSON |
| `PY work/quality-improvement/test_production_inpaint.py` | 수집 전 `ModuleNotFoundError: No module named 'av'`, exit1 | `production-inpaint-environment.log` |

기존 회귀 **124개 통과**, 실제 Comfy 노드 CPU 검증 **환경 부족 1건**이다. 엔진 검증은 실제 PNG·파일·큐·캐시와 가짜 Comfy 응답, UI 검증은 소스 실행과 제어된 브라우저 I/O, 서버 검증은 로컬 HTTP, SDK adapter 검증은 가짜 브리지의 실제 subprocess다. 실제 브라우저 렌더링·현재 SDK 서비스·GPU 추론을 검증한 결과로 확대하지 않는다. 미설치 `av`를 추가 설치하지 않았다.

## 다음 우선 실험 1개와 총괄 결정

`next-experiment.json`에 **SDXL 주머니 편집 denoise 0.55 대 0.80 비교**를 구체화했다. 원본·마스크·문장·모델·해상도·25steps/CFG6/dpmpp_2m/karras/feather4를 고정하고, seed601100/601101/601102를 짝지어 조건별 최대 3개, 총 6회만 비교한다. 현재 source VAE 구조가 남아 색만 바뀌는 가설을 검사한다. 실행하지 않았다.

처리군이 최소 2/3에서 알아볼 수 있는 빨간 가죽 주머니·봉제선 또는 덮개·황동 버클을 만들고 대조군의 통과 개수보다 많아야 후속 사용자 검토 후보로 올린다. 유리/금속 같은 반사, 소품 융합, 마스크 경계·인물 구조 악화는 실패다. 모든 결과의 마스크 밖 RGBA와 전체 알파 오차 0 및 실제 요청/graph 일치가 선행 조건이다. 성공해도 전체 캐릭터 품질 승인이나 기본값 자동 변경으로 이어지지 않는다.

필요 환경은 환경 담당이 확인한 SDXL 가중치와 ComfyUI/공식 SDK/proxy다. 모델 제외 복원 상태에 가중치/venv가 없으면 보류한다. 실제 파일·새 PID 기준 manifest/guard 갱신과 transport=sdk, SDXL available=true 확인이 필요하다. 이번 계획은 다운로드·환경 설치 승인이 아니다.

총괄은 환경 담당 인계와 함께 이 단일 변수 실험을 다음 단계로 실행할지 검토하면 된다. 이번 담당은 소스 변경·웹 재빌드 요청 없이 1차 작업을 마치고 대기한다.

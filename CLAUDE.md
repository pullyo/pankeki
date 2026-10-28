# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

Pankeki는 로컬 ComfyUI에 이미지 생성·마스크 부분 수정을 요청하는 캐릭터 제작 앱이다(생성 → 후보 비교 → 부분 수정 → 저장·재개, 2D 움직임 편집, Live2D 재생). 공식 대회(https://comfy.org/open-source-higgsfield/) 출품 준비 중이며 공통 맥락은 `docs/contest-context.ko.md`, `docs/TEAM-CONTEXT.ko.md`에 있다. 원래 Windows(`D:\Pankeki`, CUDA)에서 개발됐고, 현재는 Apple Silicon Mac 외장 드라이브의 복원본이다. git 저장소가 아니다.

문서 대부분이 한국어이며 사용자와도 한국어로 소통한다.

## 명령어 (Mac, 프로젝트 루트에서)

```bash
./Pankeki.command                 # ComfyUI(8188) + 앱(8190) 실행, 브라우저 열기
./Pankeki.command --no-browser
./Pankeki.command --editor-only   # 생성 서버 없이 편집·움직임만
bash scripts/setup-macos.sh [--generation|--sdxl|--models]   # 편집 환경 / +ComfyUI(고정 commit) / +SDXL Base / +제품 모델 3종

# Python 테스트 (가짜 Comfy 응답 사용, GPU 검증 아님)
.venv-macos/bin/python -m unittest discover -s tests -v
.venv-macos/bin/python -m unittest tests.test_cache                        # 파일 하나
.venv-macos/bin/python -m unittest tests.test_engine.EngineTests.<test_name>   # 테스트 하나

# JS 테스트 (Node 24, ~/.local/bin에 설치됨)
node --test scripts/test_ui_state.cjs
node --test web/tests/profiles.test.cjs
(cd desktop && npm test)            # 데스크톱 테스트 전체 (tests/*.test.cjs)
(cd desktop && npm run test:renderer)  # 데스크톱 채팅 렌더러 테스트

# web/src 수정 후 반드시 재빌드 (web/index.html 생성)
.venv-macos/bin/python web/build.py

# 린트·구조 검색 (프로젝트 로컬 설치)
.tools/codex-quality-tools/bin/ruff check --isolated --no-cache --no-fix --target-version py312 --select E9,F63,F7,F82 pankeki
.tools/codex-quality-tools/bin/ast-grep run --lang python --pattern '<pattern>' --json=compact pankeki/engine.py
```

Ruff 기본 규칙 전체에는 기존 위반 39건이 있다. 자동 수정(`--fix`)으로 기존 코드를 일괄 변경하지 않는다.

가상환경: `.venv-macos`(생성, torch 포함), `.venv-macos-editor`(편집 전용), `.venv`는 Windows용 보존본이라 Mac에서 실행되지 않는다.

## 아키텍처

**프로세스 구성.** `scripts/run_macos.py`가 `vendor/ComfyUI/main.py`를 MPS 옵션(`--fp16-unet --fp32-vae --disable-all-custom-nodes --offline`)으로 띄운 뒤 `python -m pankeki serve`를 실행한다. 실행 시 `runtime/macos/config.json`(모델 등록·SHA256)과 `model-paths.yaml`을 현재 경로로 다시 생성하므로 이 파일들은 직접 고치지 않는다. 로그는 `runtime/macos/app.log`, `comfy.log`. Windows 경로는 `scripts/*.ps1` + `prepare_manifest.py`(서버 PID·소스·모델 hash manifest)이다.

**백엔드 (`pankeki/`, 표준 라이브러리 HTTP 서버).**
- `server.py`: 127.0.0.1 전용. Host/Origin 검사, POST는 JSON만 허용, 32MiB 제한. 라우트: `/`(빌드된 `web/index.html`), `/api/health`, `/api/capabilities`(모델·작업·준비 상태), `/api/models`, `/api/jobs`(POST 제출, GET 상태), `/api/image-ops`(CPU 제출 후 제한 시간 대기), `/api/previews/<id>`, `/api/results/<id>`, `/api/jobs/<id>/cancel`, `/api/cache/clear`, `/vendor/cubism/*`(manifest hash가 맞을 때만 전달). HTTP bind 성공 뒤 runtime 쓰기를 초기화한다.
- `jobs.py` / `job_store.py`: CPU·GPU 레인별 worker 1개와 공통 session revision 확정 경계. `runtime/jobs.sqlite`와 OS 수명 배타 잠금으로 작업·revision을 영속화하며 재시작 시 미완료 작업은 `orphaned`로 남기고 GPU에 자동 재제출하지 않는다. 취소는 소유 queued ID만 삭제하거나, source·프로세스·정확 origin/port·실제 route가 검증된 원자적 대상 취소를 사용한다. 검증이 없으면 로컬 결과 폐기이며 GPU 중단을 확정하지 않는다. 전역 `/interrupt`는 사용하지 않고 미리보기는 초당 최대 5회다.
- `engine.py` / `run_store.py`: 요청 검증 → recipe → 정확 캐시 조회 → 워크플로 실행 → 최종 합성. 빈 마스크는 모델 호출 없이 픽셀 복사, `recolor` 연산은 모델 없이 CPU(`recolor.py`)로 처리한다. 결과는 `runtime/runs/<job_id>/`(원본·마스크·workflow·recipe·result.png·metrics)와 `runtime/metrics.jsonl`에 기록하고 완료 마커를 마지막 원자 쓰기로 확정한다. 과거 결과 GET는 succeeded 상태·상대 run 참조·완료 마커와 파일 SHA를 검증하며 metrics 파일 존재만으로 성공 처리하지 않는다. 보존 정리는 dry-run 보고만 제공하고 삭제하지 않는다.
- `composite.py`: 마스크 밖 RGB와 원본 alpha를 그대로 보존하는 것이 핵심 불변식이다. 테스트가 오차 0을 검증한다.
- `planning.py`: ROI crop(문맥 여백 포함, 처리 면적 75% 이상이면 전체 경로로 전환). 작은 crop은 모델 기본 면적(SDXL 1024², Turbo 512², 최대 4배)으로 키워 생성한 뒤 원래 크기로 줄여 합성한다(`model_scale_size`, metrics의 `roi_scale`). 원래 크기 그대로 넣으면 SDXL 결과가 깨진다. 타일·LOD 계획은 실험용이고 실행 경로에 연결되지 않았다.
- `cache.py`: SQLite 정확 결과 캐시(256MiB 논리 제한). workflow·입력·모델 hash로 키를 만들며 hash할 수 없으면 캐시하지 않는다. Mac의 direct 연결에서는 캐시를 우회한다.
- `comfy_adapter.py`(HTTP+WebSocket 직접 연결) / `sdk_adapter.py`(공식 Comfy SDK 하위 프로세스, Windows) — `config['transport']`로 선택. 직접 연결은 POST 전에 client_id·숫자 정규화 workflow SHA를 영속화하고 응답 유실 시 실제 queue/history의 소유 tuple을 조회한다. 자동 POST 재시도나 과거 raw digest의 자동 변환은 없으며 기존 SDK가 이 직접 연결 증거를 제공한다고 가정하지 않는다.
- `workflows.py`: ComfyUI API 그래프(`txt2img`, `inpaint`, `inpaint_sdxl`). `model_presets.py`: 모델 ID(`sdxl-base` 기본, `sd-turbo`, 수정 전용 `sdxl-inpaint-v01`은 `sdxl-base`의 CLIP/VAE를 함께 사용).
- `model_lease.py`: Windows 읽기 잠금 fingerprint 정책(`windows_read_lock`). Mac은 `stat_cache`(`run_macos.py`가 설정): 프로세스당 처음 한 번 모델 전체 SHA256을 읽고, 이후 장치·inode·크기·mtime·ctime이 같으면 그 값을 재사용한다(`engine.ModelDigestCache`, metrics의 `fingerprint_reused`). `strict`는 매 요청 전체를 다시 읽는다.

**프론트엔드 (`web/`).** 번들러가 없다. `web/build.py`가 `web/src/*.js`를 **고정 순서**로 이어 붙이고 CSS·폰트·로고·`assets/redesign/*.png`(WebP 변환)·Lucide 아이콘·움직임 데모를 모두 인라인해 단일 `web/index.html`을 만든다. 새 JS 파일은 `build.py`의 목록에 추가해야 포함되고, 해결되지 않은 `{{TOKEN}}`이 있으면 빌드가 실패한다. 브라우저 저장소 키는 버전별로 분리돼 있다(`pankeki-cubism-studio-v1`, `pankeki-authoring-v3` 등). 기존 v2 프로젝트·저장소를 바꾸지 않도록 주의한다. `character-*-v3.js`는 정밀 리깅, `cubism-*.js`는 Live2D 재생(공식 SDK 미준비로 비활성)이다.

**MCP 플러그인 (`plugins/pankeki-local/`).** 앱의 HTTP API를 MCP 도구(`pankeki_generate_image`, `pankeki_edit_image` 등)로 노출한다. 계약은 `server/CONTRACT.md`. 전용 venv `runtime/macos/pankeki-mcp-20261023/release/venv`를 쓰며 `.venv-macos`에 의존성을 추가하지 않는다. `mcp.json`/`.mcp.json`은 `scripts/configure_paths.py`가 현재 체크아웃 위치로 생성한다(`--check`로 차이만 확인). 실행기는 `/usr/bin/python3`(Xcode 라이선스 동의 전에는 실패) 대신 전용 venv Python으로 띄운다.

**데스크톱 (`desktop/`).** Electron 셸. 프로젝트 위치는 인자 → `PANKEKI_PROJECT_ROOT` → 사용자가 고른 폴더(`~/Library/Application Support/Pankeki/project-root.json`) → 패키지의 `runtime.json` → 소스 체크아웃 순으로 찾고, 없으면 폴더 선택 창을 띄운다. 패키징은 `node scripts/freeze-release.cjs` 후 `node scripts/package-mac.cjs`; 동결은 번들 파일 전부를 비교한다. `PANKEKI_SIGN_IDENTITY`/`PANKEKI_NOTARY_PROFILE`이 있으면 Developer ID 서명·공증, 없으면 ad-hoc.

## 작업 규칙 (프로젝트 문서에서 정한 것)

- 테스트 통과·mock 성공·도구 실행 성공을 실제 GPU 추론 성공이나 이미지 품질 승인으로 보고하지 않는다. 측정하지 않은 값은 null로 둔다.
- 원본 이미지·모델·사용자 작업을 덮어쓰지 않는다. 새 모델이나 대규모 패키지 다운로드는 사용자 승인 후에만 진행한다.
- 미구현 기능에 가짜 응답을 넣지 않는다(예: 로컬 대화 모델 연결은 미완료).
- 최신 진행 상태는 `docs/handoffs/`, 결정 기록은 `docs/decisions.ko.md`, 실험 결과는 `docs/results.ko.md`. 날짜가 다르면 최신 인계를 우선한다. `D:/` 경로와 저장된 PID는 과거 기록이다.
- `vendor/`, `models/`, `runtime/`, `work/`, `output/`, `evidence/`는 `.gitignore` 대상이며 `vendor/ComfyUI`는 고정 commit `8f04fd6e…`의 외부 소스다. 수정하지 않는다. `comfy_adapter.ATOMIC_CANCEL_SOURCE_PINS`는 CRLF→LF 정규화 후 upstream 해시라 Windows 체크아웃과 새 clone이 같은 값을 낸다.
- 이 Mac의 `/usr/bin/git`·`/usr/bin/python3`는 Xcode 라이선스 미동의로 실행되지 않는다. 스크립트에서 시스템 Python을 하드코딩하지 않는다.

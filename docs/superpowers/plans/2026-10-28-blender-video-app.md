# Blender 영상 앱 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development with the user's existing employee implementation / coordinator review arrangement. This restored checkout is not a Git repository: preserve source copies, diffs and SHA manifests instead of inventing commits/worktrees.

**Goal:** 설치형 Pankeki에서 Blender 구도 기반 로컬 AI 영상의 생성·재생·저장 흐름을 완료한다.

**Architecture:** 별도 영상 worker/journal과 기존 LTX MLX subprocess를 연결하고, 같은 서버의 이미지 실행과 GPU gate를 공유한다. 네이티브 파일 선택은 opaque grant를 발급하며 앱은 같은 origin의 검증된 MP4만 재생·저장한다.

**Tech Stack:** Python stdlib HTTP/worker, Blender Python, 설치된 LTX MLX CLI, 기존 JS/CSS 빌드, Electron IPC/download.

**Spec:** `docs/superpowers/specs/2026-10-28-blender-video-app-design.md`

## Global Constraints

- 기존 로고·메뉴·이미지 기능·사용자 후보/마스크/원본/모델을 보존한다.
- 신규 대형 다운로드·클라우드 실행·전역 Comfy interrupt/restart를 하지 않는다.
- 첫 실제 설정:384×256/49frames/24fps/8steps/single-stage/low-ram. 가이드를 AI 성공으로 표시하지 않는다.
- 직원은 구현, 총괄은 계약·검토·통합·보고. 변경 전 baseline 사본/SHA, 완료 시 diff/SHA를 남긴다.
- 실제 설치형 앱 acceptance는 Computer Use로만 확인한다. API/mock/unit PASS로 대체하지 않는다.

## Review Focus

- 취소/완료 경쟁과 서버 재시작: 취소된 결과의 완료 발행 및 GPU 자동 재실행 차단.
- scene grant 위조/만료/변경/심볼릭 링크: 사용자 선택 증거·복사 snapshot SHA 확인.
- 프로젝트 변경 중 늦은 poll: 다른 프로젝트/epoch 화면에 결과를 끼워 넣지 않는다.
- 영상 전달과 저장: Range/Content-Length/파일 무결성/네이티브 download 결과 확인.
- 이미지와 영상 동시 요청: 공유 GPU gate와 다른 소유자의 Comfy 작업 충돌 방지.

## Task 1 — 엔진·백엔드 (video_engine_backend)

Files: `pankeki/video_jobs.py`, `pankeki/video_runtime.py`, `pankeki/server.py`, `scripts/pankeki_video_runner.py`, focused Python tests.

Interfaces: spec의 고정 grant/HTTP 계약을 소비하며 실제 상태와 MP4 asset을 제공한다.

- [ ] 현재 CLI 실제 생성 기록과 모델/실행 경로를 검토한다.
- [ ] grant·journal·취소·완료·Range·GPU gate의 실패 경계를 테스트한다.
- [ ] 영상 실행기와 서버 라우트를 구현하고 focused 검사를 통과한다.
- [ ] 새 경로 실제 GPU 작업은 native QA 직원의 1회와 조율하며 중복 실행하지 않는다.

## Task 2 — 영상 작업 화면 (video_app_frontend)

Files: `web/src/video-workspace.js`, `video-workspace.css`, `index.template.html`, `studio.js`, `redesign.js`, `web/build.py`, focused JS tests.

Interfaces: `pickVideoScene()`과 spec의 영상 API를 사용한다. 기존 sidebar의 motion 문맥을 유지한다.

- [ ] import/취소/stale/succeeded playback/download 상태 검사를 작성한다.
- [ ] 단일 영상 공간·진행·재시도·재생·저장을 구현한다.
- [ ] UI focused 검사와 빌드를 수행하고 소스 baseline/diff를 제출한다.

## Task 3 — 네이티브 선택·릴리스·QA (video_qa_release)

Files: desktop picker/helper/preload/main/release-list 및 focused tests. 출력 증거는 `output/finalization-20261028/blender-video-app/desktop-release/`.

Interfaces: opaque grant를 발급하고 기존 download handler로 MP4 native save를 제공한다.

- [ ] 실제 앱·서버·GPU 작업·외장 SSD·네이티브 제어 preflight를 확인한다.
- [ ] picker grant·취소·파일변경 경계를 검증하고 구현한다.
- [ ] source 준비 뒤 새 timestamp 앱/DMG를 빌드한다.
- [ ] 사용자 작업 보존 후 새 앱을 적용하고 native 실제 생성1회·재생·저장·재열기를 확인한다.

## 총괄 검토

- [ ] 직원 결과의 spec/품질 검토 및 필요한 수정 후 재검토.
- [ ] 실제 앱/저장 MP4/대표 프레임 직접 검토.
- [ ] 완료 범위와 속도·해상도·잔여 제약을 구분한 최종 보고.

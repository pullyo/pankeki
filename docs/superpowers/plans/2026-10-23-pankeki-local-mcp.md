# Pankeki Local MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 사용자가 현재 직원의 직접 실행을 승인했으며 새 채팅/하위 에이전트/직원 메시지는 금지했다.

**Goal:** 기존 Mac Pankeki HTTP API를 사용하는 로컬 MCP 플러그인의 패키지·stdio 실행기·지원되는 설치/복원·호스트 연결 증거를 완성한다.

**Architecture:** 이미지 AI 담당이 소유하는 `server/pankeki_mcp.py`와 CONTRACT를 그대로 연결한다. Mac 담당은 portable/호환 manifest와 공백 경로를 보존하는 실행기, 플러그인 사용 지침 및 설치·검증 기록을 맡는다. 앱과 ComfyUI는 기존 실행 경로를 유지하고 GPU 호출은 QA만 한다.

**Tech Stack:** 기존 Python 계열 및 필요 시 플러그인 전용 가상환경, stdio MCP, Codex 로컬 marketplace/authoring helpers.

**Spec:** `docs/team-macos-20261022/pankeki-tool-plugin-feasibility.md` 및 2026-10-23 총괄의 명시적 구현 배정. 실제 도구명/실행 인자는 서버 CONTRACT를 우선한다.

## Global Constraints

- 소유: `plugins/pankeki-local/`의 server/ 제외, 이 계획·타당성 문서, `runtime/macos/pankeki-mcp-20261023/release/`.
- server/ 구현·계약·의존성명세는 이미지 AI 담당 소유다. Mac만 서버 의존성 설치·앱/Comfy 실행·로컬 플러그인 설치를 수행한다.
- 기존 로고·11메뉴·기능·제품 소스·모델·원화/QA 이력을 보존한다. 공식 mcp==2.3.0 및 Pillow의 플러그인 전용 설치는 명시 승인된 의존성이다. 외부 image_gen·클라우드·직접 Comfy 우회 생성·새 이미지 모델·Cubism/추적 등 관련 없는 SDK·공개 게시 없음.
- GPU 추론은 QA만 수행한다. 총괄은 지시/검토/보고만 한다.
- 기존 명시 승인을 다시 재승인 대기로 돌리지 않는다. sandbox 밖 설치는 소스/검증을 완성한 다음 정확한 설치 변경만 OS 승인 도구로 요청한다.
- Git 저장소가 아니므로 commit/worktree는 만들지 않고 파일 해시와 실행 증거로 추적한다.

## Review Focus

1. SSD 경로 공백/미마운트: 인자 배열·절대 경로, 실패는 stderr와 비정상 종료.
2. stdout 오염: launcher는 exec만 하며 stdout에 안내문을 쓰지 않는다.
3. 설치/복원: 기존 marketplace/설정 항목을 보존하고 이번 변경만 되돌린다.
4. 앱 실행 충돌/중단: 기존 건강한 앱을 재사용하며 종료/재시작/작업 취소를 자동으로 하지 않는다.
5. 성공 범위: 별도 MCP client, Codex 설치/도구 노출, QA 실제 SDXL 추론을 각각 증거로 구분한다.

### Task 1: 로컬 호스트/서버 계약 확인

**Files:** 읽기 전용 helper·CLI help·server/CONTRACT.md, 이 계획.
**Interfaces:** server 실제 진입점·지원 인자·도구 목록 → launcher/manifests/probe.

- [x] 현재 CLI mcp/plugin help와 앱 health/models를 읽기 전용 확인.
- [ ] bundled plugin-creator authoring helper·호환 규칙과 server CONTRACT를 읽는다.
- [ ] 패키지 이름/버전·stdio command·의존성 환경/로고 참조를 확정한다.

### Task 2: 패키지·실행기·설치/복원 구성

**Files:** `plugins/pankeki-local/plugin.json`, `mcp.json`, 호환 manifest, `scripts/`, `skills/pankeki/SKILL.md`, `README.ko.md`.
**Interfaces:** Task 1 실제 stdio command와 portable/호환 선언 → host 설치.

- [ ] manifest JSON/YAML·참조 파일을 검증하고 기존 로고를 재사용한다.
- [ ] 공백 경로 launcher 정상 실행, 없는 경로/의존성 실패 및 stderr 처리를 검증한다.
- [ ] helper 기반 설치·상태 확인·변경분 복원 스크립트와 사용 안내를 작성한다.
- [ ] 필요 의존성은 전용 환경에만 설치한다. 제품 venv는 보존한다.

### Task 3: 구체적인 소스 검증 후 로컬 설치·호스트 확인

**Files:** `runtime/macos/pankeki-mcp-20261023/release/`.
**Interfaces:** 완성 source/helper → 설치 기록·백업·stdout probe·host 발견 증거.

- [ ] 앱 현재 상태를 확인하고 건강한 기존 서버를 재사용한다.
- [ ] stdio initialize/tools discovery/status 및 잘못된 입력/실행기 실패를 실제 검증한다. GPU 호출 없음.
- [ ] 정확한 외부 설치 변경만 승인 도구로 수행하고 기존 설정·marketplace를 보존한다.
- [ ] Codex의 설치/등록/노출을 별도로 확인한다. hot reload 제약은 그대로 기록하고 새 채팅은 만들지 않는다.

### Task 4: QA 수령·출시 인계

**Files:** release 보고서/해시/설치 기록, README·타당성 문서·계획 상태.
**Interfaces:** QA 담당 자기 증거와 보고서 → 실제 SDXL/부분수정 수용 범위.

- [ ] QA의 최종 보고서·실제 Pankeki 실행/출력 증거를 읽어 수용/남은 항목을 구분한다.
- [ ] 패키지 파일/해시·의존성·설치/복원·호스트 노출·QA 범위를 최종 기록한다.
- [ ] 관련 파일/기존 증거 보존을 새로 대조하고 자기 채팅 최종 답변으로 총괄에게 인계한다.

계획 자체 검토: 네 작업이 패키지/실행/설치/실제 QA 인계를 모두 포함하며, 서버 구현 소유를 침범하지 않는다. 다섯 Review Focus는 Task 2/3/4의 실제 실행·설정 차이·증거 검사로 확인한다. 실행 방법은 사용자 배정대로 현재 직원이 직접 수행한다.

# Generation / Project Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. 기존 담당 직원 구현·독립 QA·총괄 native 검토를 유지하며 새 직원 생성이나 배치 승인 반복은 하지 않는다.

**Goal:** 일반 이미지 기록을 보존하면서 명시적으로 생성·저장한 프로젝트만 프로젝트 목록에 표시한다.
**Architecture:** 동일 catalog의 optional kind로 분리한다. 기존 원문 validator·직렬 실행·CAS·legacy current 저장·guard를 재사용한다.
**Tech Stack:** 기존 vanilla JS/IndexedDB와 Node CPU 테스트. dependency 추가 없음.
**Spec:** `docs/superpowers/specs/2026-10-29-generation-project-separation-design.md`

## Global Constraints

- missing kind = project; 기존 9/14 row/raw/id/times/favorite 무변환, 일괄 migration·DB 직접 수정 0.
- 후보 bytes/lineage/metadata·v1 파일 포맷·후보 20개 제한·외부 v2/v3/Live2D 경계 유지.
- `studio.js/profiles.js/character-document.js`·backend·모델·서버·설치 앱 수정 0.
- root 추가 배정으로 B만 `app.js` v1 reset/import 확인·완료 문자열을 copy-only 수정한다. 일반 전환을 프로젝트 생성으로 오인시키는 문구를 고치며 기능/조건/인자/guard·외부 v2/v3는 불변이다.
- core는 A의 `project-library.js`만, UI는 B의 `redesign.js/index.template.html/redesign.css`, 테스트는 QA만 편집한다.
- before/patch/hash/보고는 `output/finalization-20261029/generation-project-separation/core/`에 보관한다.
- Git 저장소가 아니므로 init/commit하지 않는다. GPU/다운로드·새 dependency·앱 조작 0.

## Review Focus

- 동일 raw의 project/general: persisted active ID와 kind를 지켜 잘못 연결하지 않는다.
- general→project→general: 이미지와 일반 기록 및 각 draft/selection을 보존한다.
- legacy current/catalog 부분 완료·재시작: 어느 원문도 덮어 버리거나 자동 project 승격하지 않는다.
- quota/CAS/identity/busy/IME: 실패 시 기존 guard와 원래 종류를 지키고 화면을 유지한다.
- UI 진입/파일 저장: sidebar general 진입과 project 카드 열기를 구분하고 export로 승격하지 않는다.

## Task 1: core 저장 종류와 전환 계약

**Files:** Modify `web/src/project-library.js`; QA owns `scripts/test_project_library.cjs`.
**Consumes:** 기존 capture/load/reset/persistCurrent/getIdentity/getDraft/setDraft host 계약을 그대로 사용한다.
**Produces:** `openGeneration(): Promise<boolean>`, `saveAsProject(): Promise<boolean>`, project-only `getState().items`, `activeKind`.

- [x] QA가 missing kind/동일 raw/일반 자동저장·restart/명시 copy 저장/빈 일반 거절·project idempotence의 의미 있는 RED를 먼저 확인한다.
- [x] 문서 root 검토·구현 허가 후 before 파일과 보호 원문 hash를 기록한다.
- [x] strict row validator에 optional enum kind를 추가하고 기존 rows를 재작성하지 않는다.
- [x] init·saveCurrent·saveBeforeTransition·recovery를 종류 유지로 구현하고 project items만 노출한다.
- [x] openGeneration에서 현재 general no-op, project 저장 후 마지막 general 복원/빈 작업 시작을 구현한다.
- [x] saveAsProject에서 general 원문을 남기고 별도 project 생성·bind, 빈 general 거절·중복 생성 방지를 구현한다.
- [x] QA가 partial commit/새 입력/foreign-format/경합·원래 draft/selection guard를 검증한다.
- [x] Run `node --test scripts/test_project_library.cjs`; 기대는 신규 및 보존 계약 PASS. A가 코드/증거를 root에 전달한다.

## Task 2: UI 연결과 독립 행동 검증

**Files:** B modifies `web/src/redesign.js`, `index.template.html`, `redesign.css`, `app.js`의 승인 문자열만; QA owns UI/저장 경계 테스트.
**Consumes:** Task 1의 두 async API와 state. 기존 file-save handler는 종류 유지 saveCurrent를 호출한다.
**Produces:** 일반 생성 진입과 명시 project 저장을 구분하는 실제 UI, 기존 전용 projects 화면 유지.

- [ ] QA가 실제 sidebar→general, 카드→project, 파일 저장 시 승격 0의 UI RED를 확인한다.
- [ ] B가 sidebar·홈 composer·템플릿을 guarded 일반 진입에 연결한다. 홈 입력 text/selection 보존 후 기존 submit은 한 번만 실행하며 프로젝트 편집기 내부 대화는 그 프로젝트에 남는다.
- [ ] B가 “프로젝트로 저장”만 copy 등록에 연결하고 현재 문맥을 표시한다. 내부 go(design)와 파일 export는 작업 종류를 바꾸지 않는다.
- [ ] B가 자동저장/foreign import 전 보존/retry를 종류 유지 API로 연결하고 기존 busy 잠금을 유지한다.
- [ ] Run `node --test scripts/test_ui_unification.cjs scripts/test_project_save_barrier.cjs`; 기대는 행동·export 계약 PASS.
- [ ] Run `node --test --test-name-pattern '^project catalog' scripts/test_central_composer.cjs`; 기대는 기존 집중 회귀 PASS.
- [ ] QA가 실제 9/14 읽기 전용 roundtrip/hash 보존과 일반 기록 재시작 복구를 관측한다. 사용자 DB 원문은 직접 수정하지 않는다.

## Task 3: 통합 마감

- [ ] B가 syntax/원문 보존·집중 QA 완료 후 `.venv-macos/bin/python web/build.py`를 한 번 실행한다.
- [ ] B가 source ID·generated 포함 확인·최종 hash/patch를 root에 전달하고 QA가 독립 읽기로 확인한다.
- [ ] root가 같은 앱의 정상 재실행 뒤 일반 생성/기존 9·14/분리 저장 UI를 native 검토한다. CPU PASS를 native 수용으로 대신하지 않는다.

현재 상태: core rev2 P1 소유권 경계까지 RED→GREEN·전체33 PASS·patch 재동결 완료. UI 통합/build는 B, 최종 native 수용은 root 담당이며 아직 완료로 주장하지 않는다.

# Project Library Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. 사용자 지정 방식은 기존 담당 직원 구현·독립 QA·root 네이티브 검토이며 추가 승인/새 직원 생성 없이 유지한다.

**Goal:** 프로젝트 메뉴가 팝업 대신 실제 저장 항목의 중앙 전용 화면을 연다.
**Architecture:** 정적 projects section/heading과 정식 workflow route를 추가한다. 기존 projectState, renderProjectRows/lockProjectRows/projectAction 및 원래 저장·열기를 재사용한다.
**Tech Stack:** 기존 vanilla JS/CSS, native controls, 단일 HTML build. 새 dependency 없음.
**Spec:** `docs/superpowers/specs/2026-10-29-project-library-page-design.md`

## Global Constraints

5제품파일은 `web/src/studio.js`, `index.template.html`, `redesign.js`, `redesign.css`, 생성 `web/index.html`이다. 로고/11메뉴/색·Pretendard/기존 홈 목록과 photo·motion metadata 경계는 유지한다. 사용자 DB/원문/모델/서버/앱은 수정하지 않는다. Git 저장소가 아니므로 init/commit하지 않는다.

## Review Focus

- 홈 검색 잔존: 프로젝트 검색의 독립 값과 한 visible input을 확인한다.
- 화면 왕복: 같은 composer·초안/selection·mode·이미지 원문을 유지한다.
- 실제 프로젝트 선택: 기존 saveBeforeTransition·확인·switch/remove guard를 따른다.
- 실제0개/검색0개/loading/error·긴 이름: 정확한 표시와 실제 데이터만 사용한다.
- 2개 카드/작은 viewport: 폭260–360px 범위·complete preview·visible focus·한 스크롤을 확인한다.

## Task: 승인 배치 구현과 검증

- [x] QA가 `scripts/test_ui_unification.cjs`의 실제 sidebar 클릭→projects route/heading/page visible/no dialog·검색독립·왕복보존·실제 전환 행동 RED를 확인한다. QA만 테스트 파일을 편집한다.
- [x] `studio.js`에 projects label, template에 정적 section/heading을 추가하고 `redesign.js`가 이를 기존 `.pk-pages`로 옮긴다. modal은 제거하고 기존 row/상태/행 동작을 page에 연결한다. 전용 화면20개/페이지와 홈2개/페이지를 분리하며21번째 이후도 접근 가능해야 한다(QA 경계 assert).
- [x] `redesign.js`의 한 검색 입력에 home/projects별 값을 보관하고 route에 맞는 label/placeholder/filter를 적용한다. 입력 초안과 현재 mode를 건드리지 않는다.
- [x] `redesign.css`에서 projects 범위의 bounded grid·contain preview·상태/포커스·responsive를 구현한다. 기존 warm 토큰을 쓴다.
- [x] QA 행동 GREEN/집중 UI·catalog 회귀, syntax·보존 SHA를 확인한다. 마지막 `.venv-macos/bin/python web/build.py` 후 source ID와 before/최종 patch를 root에 전달한다. 실제 native 수용은 root가 담당한다.

CPU구현/행동검증·build완료. Source ID `b92251d9a6d3c3084a733cfc2e4042aade48834a7fc0536cc7340fe786cb855a`. rootnative/Bisolated시각수용은별도대기이며완료로승격하지않는다.

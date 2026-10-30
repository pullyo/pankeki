# Expanded Home Reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement the plan task-by-task. Root coordinates/reviews; the implementation employee owns product edits and QA owns screenshots/runtime.

**Goal:** Apply the user's newest supplied home image to the installed Pankeki app while retaining existing editing, automatic requests, project data and the previous five fixes.

**Architecture:** Refine existing home DOM/CSS, reuse the canonical composer/settings/project-library handlers, and add only small front-end presets and tip/keyword interactions. No backend, inference, model, authentication or file-format changes.

**Tech Stack:** Current JavaScript/CSS, existing assets and SVG icons, generated HTML and Electron desktop.

**Spec:** User-provided `/var/folders/mr/p6nxppgs1nld79dtrhl4_zjw0000gn/T/codex-clipboard-73ca0885-e6ef-440c-af59-9fde503cd311.png`, requested in this active chat. The picture selects the design; do not add another concept/approval round. Prior native-verified source `7fa8953a809510f0c17686885a5ebc72e4b1d063c7f01f62939050b9c75950fd` is the preservation baseline.

## Global Constraints

- Preserve logo/art bytes, actual projects/images, engines, automatic intent, general/project separation, IME and one canonical draft/form.
- New sidebar reference explicitly changes grouping/order. Use: 홈, 프로젝트, 이미지 생성, 갤러리, 템플릿; 부위 편집, 표정 · 동작, 내보내기; 모델 관리, 설정. `내보내기` is the existing export route. Keep Design absent, editing functions accessible through images, edit/compare highlighting Image Generation.
- Preserve readable 12px minimum secondary text, visible request destination/actual model context, recent updatedAt ordering, current-project resume, guarded delete/open/save/import and paging.
- Normal empty/four-project/paged states must fit 1280×800, 1440×900 and 1920×1080 without wheel scrolling. Long text/expanded drafts must remain reachable through real scrolling, without overlaps or hidden actions.
- Existing user permission for temporary mask/unsent draft reset and new app application persists within this active task. Do not ask again. Check no active inference before a normal restart. Never force-stop unrelated processes or reset/copy authentication/profile contents.
- Reuse existing art. Missing expression/sketch-specific example art uses honest existing SVG icon tiles rather than fabricated generated examples. No downloads, inference, external image generation, commits or pushes.

## Review Focus

- Keyword insertion preserves an existing Korean draft and selection/composition state; never sends automatically.
- Every visible toolbar button opens a real existing function; no decorative or disconnected dropdowns.
- Four recent rows, active resume and pagination remain operable in small desktop heights without hiding project operations.
- All eight recommended cards load a real template/style prompt; original six library presets remain available.
- New UI must preserve actual chat/image model values and the corrected plain-web edit-model summary.

## Task 1: Home composition and existing controls

**Files:** web/src/redesign.js, web/src/redesign.css, relevant existing tests.

- [ ] Capture the current 7fa source hashes and baseline before editing; preserve all prior fixes.
- [ ] Match the picture's grouped sidebar, warm banner, two-row composer and orange labeled submit action. Keep automatic desktop submission meaningful; plain-web image generation may retain generation wording.
- [ ] Reuse existing image/reference upload, category/style selection, actual width/height settings, AI settings and submit handlers. Ratio control can open the existing real width/height settings with current size context; do not invent unsupported presets.
- [ ] Keep destination/model context compact and truthful, integrate current-project resume into the rail instead of wasting space on duplicated summaries.
- [ ] Update exact sidebar order/label expectations only where the new reference intentionally supersedes them; preserve edit access assertions.

## Task 2: Keywords, template cards and tips

**Files:** same source pair; scripts/test_home_expanded_reference.cjs or suitable existing suite.

- [ ] Add Korean keyword chips that append a useful phrase through the canonical input flow, preserving an existing draft and never sending.
- [ ] Render four large cards matching the reference's topics and four compact cards: SD character, maid, expression sheet, simple sketch. Reuse existing maid/SD art; use clear icon tiles for the two missing examples.
- [ ] Keep the original six library presets and add lightweight SD/expression/sketch prompt presets only as needed, with no claim of a new rigging/sheet engine. Template selection pre-fills an editable prompt and never generates automatically.
- [ ] Add a real previous/next/dot tip carousel with truthful product help, keyboard names and no auto-advance/motion requirement.
- [ ] Write meaningful behavior regressions for keyword/draft/no-send, each new preset, tip navigation and preserved settings. Confirm pre-change failures for new behavior, then pass.

## Task 3: Four recent projects and responsive budgets

**Files:** same source pair and existing project/composer tests.

- [ ] Show up to four real projects per page in updatedAt order, with real previews/names/dates/counts/current state. Empty/fewer states must show actual data, never sample project rows.
- [ ] Latest layout decision: home is a fixed latest-four preview with no home pager, matching the reference. Older projects remain accessible through `전체 보기` and the existing complete catalog/pagination. Keep a current older project and resume accessible even outside the latest four.
- [ ] Use a smaller active/resume presentation and concise small-height metadata. Preserve catalog, import/save/delete/favorite and paging through explicit existing controls or accessible real action menus.
- [ ] Keep storage usage/quota/percent based only on measured values. Hide unknown quota/percent rather than copy the mockup's numbers.
- [ ] Review normal 0/2/4/5 project states, long Korean names and multi-line drafts at the three desktop sizes. Reduce hero/spacing before text size; prevent the prior sidebar and rail-overlap regressions.

## Task 4: Freeze, independent review and installed app

**Files:** generated web/index.html and evidence under output/finalization-20261030/home-expanded-reference/.

- [ ] Run appropriate existing related suites plus new focused behaviors once with suitable file concurrency; no increased timeouts/skips to conceal failures.
- [ ] Build normally, freeze source/SHA and stop edits; QA renders the exact frozen HTML in an isolated origin without initializing another Engine or posting inference.
- [ ] Root and actual Claude read-only review inspect source and first rendered screenshots. Batch discovered issues, fix them, then re-render only affected states and any critical small desktop state.
- [ ] Build a fresh app package, verify unaffected core/brand hashes, use a normal app restart and same profile/origin, and verify all source IDs match. Keep a previous-bundle backup and preserve the 7fa checkpoint evidence.
- [ ] Verify the installed app through Computer use: new home layout, ten grouped menu items, real models, keyword/template/tools/tip interactions and the stored 9/14 projects. No real generation/edit inference.
- [ ] Leave app running, clean up QA servers/tabs, report actual native/browser/test evidence and remaining limits separately.

## Active scope extensions

The live baseline additionally contained only two `min-height:auto` CSS declarations for widths up to 1150px, identified as source `3a4e96…`; their writer is unverified. They were preserved, not reverted, and source copies/diff are archived in this phase's implementation evidence.

The user's later quality/speed and full-app design request is tracked in `docs/superpowers/plans/2026-10-30-quality-speed-pass.md`. Finish this home, apply targeted shared visual fixes from QA, and coordinate GPU benchmarks through root rather than starting them concurrently with tests.

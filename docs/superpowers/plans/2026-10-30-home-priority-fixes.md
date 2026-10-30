# Home Priority Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Apply the five accepted home-review priorities in order, preserving the user's projects, original brand, remaining navigation entries, and automatic conversation/generation/edit flow.

**Architecture:** Refine the existing home presentation in redesign.js/redesign.css. Reuse project-library and composer handlers; no document-format, inference-engine, provider, model, or authentication changes. Root coordinates and reviews; an implementation employee makes product changes and an independent employee verifies them.

**Tech Stack:** Existing JavaScript/CSS, generated HTML, node:test, Electron desktop.

**Spec:** User-approved review in this chat, 2026-10-30: request destination, recent modification order, input/model context, hero proportions, readable secondary text; incumbent reference documented in docs/product/home-reference-20261029/implementation.md.

## Global Constraints

- Keep existing logo bytes, templates and features. Latest user steering during execution removes the redundant sidebar `디자인` entry only; preserve the other ten labels/order and all editing functions/routes.
- Preserve general-generation/project separation; home submission remains general generation.
- Preserve user projects, images, masks, drafts, settings and original launcher paths. No reset, server kill, new inference, download, commit or push.
- Keep the existing single composer and automatic intent; no manual conversation/generation/edit selector.
- Scope: web/src/redesign.js, web/src/redesign.css, generated web/index.html, meaningful relevant regression tests, and review evidence/docs.
- Desktop review sizes: 1280×800, 1440×900, 1920×1080; normal content fits without wheel scrolling. Long errors and expanded drafts must remain reachable rather than clipped.
- Installed-app visual acceptance uses Computer use. Browser, process, build and native evidence must be reported separately.

## Review Focus

- A home request while a saved project is active must retain the project's candidates/draft and visibly identify the general-generation destination.
- Current project resume must enter the active saved project, while the separate all-projects action still opens the catalog.
- A project created earlier but modified later must appear first; missing/invalid timestamps must have deterministic fallback.
- Long Korean project/model names, selected-image context, offline state and multiline Korean IME drafts must stay readable and operable.
- Empty, two-project and paginated home states must keep controls reachable at 1280×800 with secondary text at least 12px.

## Task 1: Destination and resume

**Files:** redesign.js and relevant existing composer/separation tests.

- [ ] Verify the existing home-submit and project action handlers before changing copy.
- [ ] Add a regression proving visible home destination, true active-project resume and preserved project/general drafts; run and confirm the relevant pre-change failure.
- [ ] Display the current project name, a concise `일반 생성으로 시작` cue and a real `이어서 작업` action using existing transitions. Correct the misleading ellipsis without changing all-projects navigation.
- [ ] Run the focused tests and report the result before Task 2.

## Task 2: Recent modification order

**Files:** redesign.js and existing project/composer tests.

- [ ] Add a created-order versus modified-order regression, including missing/invalid dates and stable ties; confirm failure.
- [ ] Sort both home and catalog by valid updatedAt descending, then valid createdAt and stable id.
- [ ] Verify both views and that paging/current-project identity remain intact.

## Task 3: Unified input and actual model summary

**Files:** redesign.js/redesign.css and existing composer tests.

- [ ] Reuse actual provider/model/size state, not illustrative or hardcoded values.
- [ ] Widen home placeholder language to making/modifying/asking; show a compact accessible actual model/size summary through existing settings handlers.
- [ ] Preserve selected image semantics, automatic intent and IME/Enter behavior. Verify live model changes, long labels and offline error access.

## Task 4: Home proportions

**Files:** existing scoped home block in redesign.css.

- [ ] Bound hero and empty-project expansion while preserving the pinned hero/art and home columns.
- [ ] Retain readable content and reachable project actions in normal small desktop states; allow exceptional long content to scroll.
- [ ] Review rendered 1280×800, 1440×900 and 1920×1080 layouts together before correction.

## Task 5: Typography and final delivery

**Files:** same scoped CSS block, generated HTML, verification records.

- [ ] Keep project dates and useful descriptions at 12px minimum, preferably 13px; reduce spacing and duplicate prose before shrinking text.
- [ ] Unify duplicate project-start wording while preserving all existing handlers and menu items.
- [ ] Run relevant existing suites once, followed by only justified targeted reruns; build using the established command.
- [ ] Independently review final diff and compare baseline hashes for unaffected core/logo files.
- [ ] Inspect installed app without clearing state. Use live served-HTML update if supported; restart/install only with evidence that drafts and masks are preserved. If restart would discard unverified state, leave that final step pending and explain precisely.
- [ ] Deliver actual screenshots where a supported tool provides a local artifact, verification results and remaining limitations.

## Accepted steering: redundant Design navigation

The user asked whether the sidebar Design entry is needed when image cards already open editing. Both enter the existing inpaint editor. Remove only the sidebar entry, preserve image-card edit and other editing entry points, and highlight Image Generation during editing/comparison. Add a meaningful regression for image-card edit access and the exact ten-entry navigation order. This follows the five priority tasks and does not replace them.

No speculative tests for low-impact styling, unrelated refactor, broad dependency updates, or automatic publication.

## Execution checkpoint

- [x] Priorities 1–5 implemented in order and independently reviewed.
- [x] Latest user steering: remove Design navigation only; retain the other ten entries and editing functions.
- [x] Full related 197 tests passed before the final narrow model/text batch; final focused 12 passed after it. Subsequent CSS-only fixes were checked with fresh rendered evidence.
- [x] Empty/two-project states at all three sizes, normal 1280 paging, long-name scrolling, actual web model settings, unchanged core/logo/art and final package verified.
- [x] Root reviewed raw logs, frozen hashes, source changes, final screenshots, Claude findings and QA report.
- [x] Apply the new package and validate the installed native UI after explicit approval for volatile masks/drafts to be cleared by restart. Subsequent two-declaration CSS change/runtime mismatch is separately recorded and preserved for the next user reference phase.

Final source: `7fa8953a809510f0c17686885a5ebc72e4b1d063c7f01f62939050b9c75950fd`. Evidence: `output/finalization-20261030/home-priority-fixes/`. The apply question was presented in this chat after the package and concrete preview were ready.

The user's later expanded home reference is an additional active request tracked in `docs/superpowers/plans/2026-10-30-home-expanded-reference.md`; the old checkpoint must not be reported as completion of that new layout.

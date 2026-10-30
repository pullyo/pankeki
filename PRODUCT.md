# Pankeki

<!-- impeccable:product-schema 1 -->

## Platform

web

The application UI is web content running in an Electron desktop wrapper. Native OS dialogs remain native. This record describes the restored checkout; it does not establish native Windows or other platform acceptance.

## Stack

The existing frontend uses plain JavaScript, CSS and bundled assets. `web/build.py` assembles the source into the single `web/index.html`. The Python application serves the local API and connects image work to ComfyUI; `desktop/` supplies the Electron shell and existing desktop integrations. Sources: `web/build.py`, `pankeki/`, `desktop/package.json`, and `CLAUDE.md`. This is the incumbent stack, not a new technology decision.

## Product Purpose

Pankeki is a desktop image-making workspace: describe an image, inspect actual candidates, edit a selected image or masked region, and save or resume work. It also exposes parts/rigging, expression/motion, video and output workflows through their existing preparation and readiness controls. The primary job is to continue real image and character work without losing its source, mask, candidates or document context.

## Operating Context

Image generation and saved projects are separate contexts. A Home request starts or resumes ordinary generation through the existing safe transition. Visiting Home or reading recent images does not switch projects or change the current source/mask. An explicit recent-image click may open its owning document through the existing guarded transition. Ordinary and project drafts remain separate.

The current ten sidebar actions are **홈, 프로젝트, 이미지 생성, 부위 편집, 표정 · 동작, 출력, 갤러리, 템플릿, 모델 관리, 설정** (`web/src/redesign.js`, navigation definition). The internal image-generation route is named `design`; it does not imply an additional Design menu. Video remains within the existing workflow rather than a newly invented sidebar action.

## Capabilities and Constraints

- The original single textarea/form supports automatic intent, Korean natural-language requests and contextual follow-up, Korean IME, Shift+Enter, model settings, progress, cancellation and error recovery. Presentation changes must preserve its original handlers and safe transition guards.
- Recent images read validated stored candidates marked `generated` across project and ordinary records, sorted by candidate time and deduplicated by validated result SHA/exact image. These records include generation/edit results; the label does not prove that every result involved new inference. Upload, derived and provenance-unknown legacy entries are excluded. All results reuses the existing read-only dialog, up to 100 with its actual total/cap. New results appear after existing autosave. The sidebar/current-candidate gallery remains scoped to the current document and includes uploads. Templates are presets rather than saved results. Sources: `web/src/redesign.js` and the existing candidate/project storage APIs it calls.
- Motion requires prepared parts and the existing rig/mesh/readiness prerequisites. An unprepared state and disabled playback must remain truthful. A visible screen does not establish a usable rig, ready/playing motion or a completed video pipeline.
- Generation quality, identity preservation and video fidelity depend on actual model results. This visual update does not improve or approve models, image quality, motion quality, inference or exports. Local model availability and provider readiness remain runtime facts to verify, not capabilities inferred from a styled control.
- Notifications and the local display profile reflect actual local presentation state. They are not evidence of an online account. Browser storage estimates are estimates, not device capacity or reserved application space.
- Preserve original image/video bytes, masks, projects, model settings, inference/backend behavior, document formats and existing stored data. A visual update must not migrate or replace those records.

## Brand Commitments

The user confirmed the existing **Pankeki** name, approved logo bytes and existing imagery, and selected the 2026-10-30 dark reference for the whole app while retaining its functions and all ten current sidebar actions. Detailed colors, typography and layout belong in `DESIGN.md`. Dark is the default presentation; this change introduces no new persisted theme preference or OS-detection workflow.

## Evidence on Hand

Current implementation and review evidence is under `output/finalization-20261030/dark-redesign-20261030/`:

- `implementation/final-freeze.json` and immutable `implementation/correction-5-review-snapshot/` identify the frozen frontend. The freeze's document hashes predate this documentation refresh; its source/HTML/desktop identities are not a new native acceptance result.
- `qa/final-render-index.json` records 33 browser/MockIPC PNGs, each with its captured source identity and limited equivalence lineage. The independent `review/dark-finish-review-48f9.ko.md` records **ship, material findings 0** for that frontend visual scope. Its 33-image and 13-file hash review is reviewer-reported evidence, not a new visual inspection by this documenter.
- The freeze records 116/116 related tests, including the initial five. Tests, build, browser fixture rendering, native application acceptance and actual inference are separate claims.
- **Native UI acceptance: scoped pass (2026-10-30).** The root reviewer directly accepted the dark Home in the installed `/Users/plant313/Applications/Pankeki.app` at 2720×1840. QA separately observed the existing settings/focus return, project summary, current-document gallery, templates/models, and representative empty/preparation image/parts/motion/video/output screens, returning to Home without generation, saving, importing or project switching. Sources: [QA report](output/finalization-20261030/dark-redesign-20261030/qa/QA-report.ko.md), [native observation](output/finalization-20261030/dark-redesign-20261030/qa/native-observation.json), and [root's direct observation](output/finalization-20261030/dark-redesign-20261030/review/native-manager-observation.ko.md). Loaded-image overlay/compare remains browser fixture evidence. Native screenshots were inspected inline; no supported local screenshot path was supplied.
- The [release record](output/finalization-20261030/dark-redesign-20261030/release/FINAL-RELEASE.json) records matching installed/source/HTML/process identities, actual ASAR contents, strict codesign and DMG verification. The [final preservation check](output/finalization-20261030/dark-redesign-20261030/qa/final-preservation.json) records the same 24 image-job rows, three video journals, checked protected code/icon/font and owned-media hashes, and the same profile/partition directory identities. Profile/authentication contents were not read, copied or reset. These are the checked preservation boundaries, not an audit of every stored document. The [cleanup record](output/finalization-20261030/dark-redesign-20261030/qa/cleanup.json) records the owned QA server/tabs closed and the production app/services left running.
- Provider round trips, new inference, actual project switching/saving/importing, ready/playing motion and output/media quality remain outside this task's acceptance. No image/video inference was performed by the dark-theme task. Current model/default values in the QA observation are runtime state and are not fixed product commitments.

No new pricing, licensing, deployment, customer, benchmark or quality claims are established by this record.

## Product Principles

- Keep ordinary generation and saved projects distinct and preserve their separate drafts.
- Show real candidates, local state and readiness; do not fabricate results or successful operations.
- Preserve original media, existing work and guarded transitions while changing presentation.
- Evaluate the delivered artifact at the level claimed: visual evidence establishes visual behavior; real inference, saves and native operation need their own evidence.

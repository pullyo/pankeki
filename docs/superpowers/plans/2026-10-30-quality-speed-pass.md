# Image / Video Quality, Speed and App Design Plan

> **For agentic workers:** Use superpowers:executing-plans for the assigned implementation. Root coordinates, reviews concrete evidence and integrates; employees implement/test. No new approval round for routine authorized work.

**Goal:** Continue the selected home reference and polish the major app screens, verify real image generation/editing, and connect higher-usefulness local video profiles/reference conditioning with measured preparation savings.

**Architecture:** UI improvements remain in the existing presentation layer. Video contract changes are developed in a source-only isolated staging folder, reviewed, and merged only when no owned image job is running. Real generation uses the installed app and existing local SSD models; do not bypass missing/rejected MCP schema with direct Comfy/cloud calls.

**Tech Stack:** Existing Electron/JavaScript/CSS, Python video runtime and jobs, Blender guides, installed offline LTX MLX CLI, existing SDXL/Animagine models, current tests.

**Spec:** Latest user instruction to test and improve image/video quality and speed and the overall app design; expanded home image/plan is an ongoing part of this same task.

## Boundaries

- Preserve existing user projects (observed saved candidate counts 9 and 14), images, model files, profile/auth settings and completed jobs. New explicitly named QA results/projects are allowed for the requested actual tests.
- Keep automatic intent and normal-generation/project separation; preserve ROI native-area scaling, stat-cache validation, outside-mask composition and provenance distinctions.
- No new model downloads, paid/cloud GPU, external image generation, global cache clearing, arbitrary process kills, publication or unrelated code changes.
- No simultaneous heavy GPU tasks. Before any real run verify source/HTML/process identity, queue idle, local model readiness and current selected values. Do not run GPU benchmarks during CPU-heavy test suites.
- Existing user approval to clear volatile masks/unsent drafts for app updates persists through this active task. Restart only normally, with no active generation, same profile/origin and previous-bundle backup. Avoid CUA reads after Quit until bundle replacement, because an earlier observation was followed by unexpected app reappearance.
- Report actual art/motion quality separately from technical validity. Guide renders, repeated frames, interpolation, cached results and imported art are not fresh AI inference or app-made original art.

## Task 1: UI reference and shared design

- [ ] Finish the expanded home plan, including a real style chooser and valid icon fallback in the complete template library.
- [ ] Show the latest four home projects and use the complete catalog for older entries; preserve catalog pagination and all project operations.
- [ ] Apply the QA-confirmed global typography fixes (meaningful help/meta at least 12px) and comfortable main actions, using existing tokens and targeted selectors instead of making every icon huge.
- [ ] Inspect generation, image editing, projects, gallery/templates, parts/motion/export, settings/profile/notifications and video pages. Preserve component scrolling, canvas fit, keyboard access and actual handlers.
- [ ] Verify the exact frozen render at the three desktop sizes, then package/apply and validate through Computer use. Original user data must remain.

## Task 2: Real image baseline before tuning

- [ ] In the stable UI-only build create one clearly named QA full-body character generation with a natural Korean request, known seed/model/size/steps/CFG/sampler and no other GPU task.
- [ ] Collect actual request, recipe/workflow, model components, timings, model fingerprint cache reuse, denoiser evidence and PNG. Review whole image, face/hands, costume, background, instruction compliance and consistency.
- [ ] Separate planner/queue/hash/load/inference/decode/save times. Historical strict-hash timings are not a current matched benchmark.
- [ ] Make only evidence-supported image tuning changes, if a concrete defect is established. Preserve the model defaults when documentation alone or a lucky seed is the only evidence.
- [ ] Verify a bounded requested edit of an owned QA image and outside-mask preservation when the task reaches its real edit test. Do not use a no-op/cache copy as inference proof.

## Task 3: Staged video contract, reference and speed work

Staging: `output/finalization-20261030/quality-speed-pass/staged-project/` contains source/tests only, never runtime DB, weights, venvs, profiles or credentials. No second real Engine/server is started there.

- [ ] Keep the compatible preview profile (384×256,49 frames,24fps,8 steps) and add one bounded full-body profile (384×512,241 frames,24fps,8 steps) matching the already exercised installed CLI path.
- [ ] Use one shared allowlisted profile contract through request normalization, jobs journal/public state, guide/depth generation, runner and full-decode verification. No arbitrary CLI parameters. Preserve old pending/recovery/idempotency behavior when profile is omitted.
- [ ] Allow exactly 241 frames in the existing guide request boundary for the full-body profile; do not loosen other validation.
- [ ] Add an explicit selected-image reference action. Upload a bounded validated PNG snapshot to an owned UUID reference grant; jobs and localStorage carry a thin reference ID and verified metadata, not image bytes or caller-chosen filesystem paths.
- [ ] Bind at the user's explicit action, show what is selected, and preserve that immutable snapshot through submission. Reject late assignment after reset/project/epoch changes. Verify owned path, hash and image limits again before execution; preserve originals.
- [ ] Map the installed CLI's actual frame-zero reference conditioning and fit the complete source without clipping head/feet. Record original and prepared reference hashes separately.
- [ ] Add monotonic phase timings and a completed-guide cache with exact scene/profile/range/dimensions/FPS/renderer/normalization keys. Reuse only verified complete compatible files; corrupt/partial/canceled artifacts must not be treated as valid completed data.
- [ ] Preserve shared GPU lease, memory admission, queue monitoring, targeted cancellation, process/orphan ownership, stale-result rejection and meaningful progress.
- [ ] Run meaningful backward-compatibility, request tamper, reference ownership, lifecycle, cache and cancellation regressions. Review the staged diff with root before touching live source.

## Task 4: Integrate and measure actual results

- [ ] After the image baseline is complete and queue is idle, merge the reviewed staged files and test the combined source. UI and engine workers must not overwrite each other's files.
- [ ] Build/package/apply normally so source/HTML/process all match. A fresh own Comfy process avoids carrying an image model into a memory-constrained video test; do not clear unrelated caches or jobs.
- [ ] Use the real QA-generated full-body image and a verified motion scene through the installed app, explicitly selecting the full-body profile/reference.
- [ ] Produce one fresh approximately 10-second AI video, record stage times and provenance, verify dimensions/frames/FPS/full decode, play it, save/reopen it and review full-body movement, face/hands, feet, flicker and framing.
- [ ] Measure an exact real guide-only cache reuse probe after a completed guide to quantify preparation savings without claiming an extra AI generation. Run another GPU video only if a concrete quality decision requires it.
- [ ] Compare evidence fairly. Do not claim a universal speedup, GPT-level quality, perfect identity or release-wide completion from one sample.
- [ ] Leave the installed app running, clean up only owned QA servers/tabs, show actual image/video artifacts and report implemented improvements, measured results and unresolved limits separately.

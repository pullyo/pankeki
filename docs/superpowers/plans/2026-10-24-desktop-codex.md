# Pankeki desktop implementation plan

Spec: `docs/superpowers/specs/2026-10-24-desktop-codex-design.md`. Execution: Mac employee inline; Claude bridge and frontend are separate existing staff. No Git repository/init/commits. User authorization covers implementation and workspace dependency installation; final web build waits for frontend freeze.

## Global constraints

Only Mac-owned desktop files/helpers/docs/output. Do not edit `desktop/codex-bridge.cjs`, bridge tests or web sources. Preserve servers/config/models/auth. External runtime dependency must be stated. Exact IPC contract is `output/desktop-codex-20261024/mac/ipc-contract.md`. Record commands and results in `output/desktop-codex-20261024/mac/progress.md`.

## Task 1 — Baseline and secure IPC

- Snapshot small launcher/build/UI/config files and hashes; generated HTML hash only, no model/auth copies.
- Add focused failing Node tests for sender identity, invalid payload/path injection, IDs/revisions, stale cancel and safe event forwarding.
- Implement `desktop/ipc.cjs`, `preload.cjs`, `security.cjs`; keep exact Claude status/event names. Real bridge injection happens in main, mock fixture lives under tests only.
- Verify: `node --test desktop/tests/ipc.test.cjs desktop/tests/security.test.cjs`. Expected: passing, hostile sender rejected and Electron event never exposed.

## Task 2 — Runtime and backend ownership

- Add failing tests for absolute paths with spaces, missing dependencies, verified external reuse, unknown occupant block, owned-only shutdown and partial-start cleanup.
- Implement `runtime-paths.cjs` and `backend-manager.cjs`. Use existing config and Python; no launcher main/config rewriting, no shell interpolation. Verify listener process identity before privileged renderer access.
- Verify: `node --test desktop/tests/backend-manager.test.cjs desktop/tests/runtime-paths.test.cjs`. Use fake process/health boundary for failures; no live server restart.

## Task 3 — Staged PNG context

- Add tests for PNG signature/base64/byte/pixel limits, unequal dimensions/no-alpha mask, unknown/cross-project/stale IDs and owned-file cleanup.
- Implement `edit-context.cjs` with injected PNG decoder (Electron nativeImage in main), app-owned input paths and ID registry. Resolver adapter remains Mac-owned; accept Claude's option when finalized.
- Verify: `node --test desktop/tests/edit-context.test.cjs`. No external files/settings touched.

## Task 4 — Electron window and mock smoke

- Pin official Electron/packager in `desktop/package.json` + lockfile after registry check; install in desktop only.
- Implement `main.cjs`, startup shell, icon/packaging scripts. Single instance, dedicated session, hardened window, local hashed CSP, safe navigation/permissions/downloads, graceful app-owned children cleanup.
- Mock smoke: real Electron sandbox/preload + fixture bridge; save evidence to Mac output. Inspect actual logo/11 entries and API; verify quit/relaunch/path spaces/download/save. No actual image generation.
- Verify: `npm test` in desktop (all Mac unit tests), `npm run smoke` (GUI permission needed). Distinguish unit/mock GUI evidence.

## Task 5 — Bridge/frontend integration and release

- Inspect current Claude bridge contract without edits; attach main-only staged context; verify explicit connect/cancel/error routing. Actual authenticated turn/inference is a separate acceptance step, coordinated with manager/QA.
- Wait for frontend freeze notice, then run `.venv-macos/bin/python web/build.py` once. Hash generated HTML/logo and record menu preservation.
- Run `npm run package:mac`; create arm64 `.app` under Mac output, local DMG via hdiutil if possible. No Applications install, model/venv copy or notarization.
- Record exact command/exit code/artifact size/SHA256/dependency paths and all unverified items; hand artifacts to independent QA.

## Review Focus

1. Foreign localhost listener gaining preload privilege: identity mismatch test and real listener inspection.
2. Cancel/quit terminating external work: stale request and external-process shutdown tests; real reuse smoke.
3. Source changed before result arrives: revision-scoped IDs/events plus frontend stale-result QA.
4. Existing inline UI/CSP/download compatibility: frozen HTML script hashes + real Electron save/download smoke.
5. App mistaken for self-contained signed release: artifact dependency manifest, unsigned/notarization state and moved/missing-root startup test.

## Self-review

Interfaces align with manager-confirmed bridge (8000 text, 80-char IDs, cancel object, exact status/events). ID-only context resolver requires Claude's revised bridge; no path compatibility adapter. Generated web build and final packaging remain gated on frontend freeze. Independent product/inference QA remains separate from mock tests.

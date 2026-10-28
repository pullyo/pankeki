# Pankeki macOS desktop + Codex design

Status: implementation authorized by the user; manager's 2026-10-24 bridge contract supersedes earlier draft names. ID resolver extension remains under Claude/manager review. No additional design approval is required.

## Deliverable and boundaries

An arm64 Electron `.app`, then a local DMG if packaging succeeds, opens the existing Pankeki editor and provides a Codex conversation through an app-owned official `codex app-server` child. The first release depends on the external Pankeki checkout, `.venv-macos`, existing ComfyUI/models, MCP Python, and installed Codex CLI/ChatGPT sign-in. These GB-sized dependencies are not bundled. Missing dependencies produce a recoverable startup screen. No Applications installation, model download, global auth/config changes, paid signing or notarization.

Preserve the logo (`web/assets/pankeki-selected-base.png`) and all 11 existing sidebar entries: home/홈, projects/프로젝트, design/이미지 생성, inpaint/디자인, parts/부위 편집, motion/표정·동작, export/출력, gallery/갤러리, templates/템플릿, models/모델 관리, settings/설정. Frontend owns `web/src/app.js` and other web UI edits; Mac owns the final `web/build.py` invocation only after frontend freeze.

## Architecture and ownership

| Files | Owner and responsibility |
| --- | --- |
| `desktop/main.cjs`, `preload.cjs`, `ipc.cjs` | Mac: window/lifecycle, narrow contextBridge, sender and payload validation |
| `desktop/backend-manager.cjs`, `runtime-paths.cjs` | Mac: external dependency resolution, verified service reuse, owned child lifecycle |
| `desktop/edit-context.cjs` | Mac: selected PNG validation/staging, opaque ID registry and revision checks |
| `desktop/security.cjs`, `shell.html` | Mac: CSP/navigation/network/permissions, startup failure view |
| `desktop/package.json`, lockfile, packaging helpers, Mac tests | Mac: pinned official dependencies, mock integration, artifact build |
| `desktop/codex-bridge.cjs`, bridge tests | Claude: official app-server stdio, child-only isolation, sign-in/tool checks, turns/cancel |
| `output/desktop-codex-20261024/mac/` | Mac: baseline, IPC contract, progress, logs, artifacts, hashes |

The existing `scripts/run_macos.py` writes runtime config and rejects occupied ports. Desktop must not invoke its main entry point. Start Python commands directly with the existing config; reuse healthy Pankeki/ComfyUI processes after identity checks. Unknown port occupants block startup. No kill-by-port or automatic restart of external processes. Track actual ChildProcess handles for app-owned processes. On quit close bridge, then app-owned Pankeki, then app-owned ComfyUI. Active work requires a visible cancel/quit decision; external processes remain running.

## IPC v1

Canonical handoff: `output/desktop-codex-20261024/mac/ipc-contract.md`. Renderer receives `window.pankekiDesktop` with getStatus/connectCodex/sendMessage/cancelMessage/onCodexEvent plus the explicitly approved prepareEditContext extension. No arbitrary path, command, filesystem, shell, token or raw IPC surface.

Claude bridge factory: `createCodexBridge({projectRoot,codexPath,onEvent,pankekiBaseUrl,log?,timeouts?,dataDir?,mcpPython?})`. Calls: `status()`, `connect()`, `send({text,projectId,requestId,context?})`, `cancel({requestId})`, `close()`.

`getStatus()` returns `{codex: bridge.status(), app: {...}}`. Preserve states **missing, signed-out, idle, starting, ready, busy, error** and fields codexVersion/authMode/toolsReady/activeRequestId/lastError. Do not translate to earlier unavailable/login_required/working names. Preserve official bridge event types: status, turn-started, message-delta, message, tool-started, tool-completed, needs-input, turn-completed, error. Main associates each turn with its original projectId/requestId/sourceRevision. UI must reject stale results rather than silently applying to a changed source.

PNG context staging accepts only explicit user-selected/generated `data:image/png;base64,...` contents; no remote URLs or renderer paths. Validate byte/pixel/dimension limits, PNG signature/decoded dimensions, RGBA mask alpha and equal source/mask size. Return opaque sourceId/maskId scoped to projectId + sourceRevision. Store app-owned files below the same dataDir/inputs/<projectId> used by the bridge. Resolve IDs only inside the local tool handler; do not put local paths in renderer events or model messages. Actual send stays disabled until Claude's ID-only resolver revision is reviewed. Resolver option details await Claude; adapt in Mac module without modifying Claude's bridge.

## Window security and compatibility

`nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, `webSecurity:true`. Dedicated session; deny permissions/new windows/nonlocal navigation. IPC requires this window's main frame and the exact verified `http://127.0.0.1:8190/` document. Use restrictive CSP with hashes of the frozen inline scripts and data/blob images/fonts needed by the existing build; no unsafe-eval. Keep existing blob download/file-input/project-save flows, with native save dialogs. Do not expose secrets in status/errors/logs. HTTP identity alone is insufficient: validate listener PID/cwd/argv against the configured checkout before enabling privileged IPC.

## Verification and release gates

1. Node tests: exact API/event validation; hostile/stale sender; IDs/text/context limits; cancel mismatch; safe status; mock bridge event routing; PNG bounds/revision isolation; reuse vs owned-process shutdown.
2. Electron smoke with injected test bridge: real sandboxed preload, window load, 11 menus/logo, context API, navigation/permission denial, save/download, path spaces, relaunch and quit. No real image generation.
3. Real Claude bridge contract inspection/integration, separate from model/tool runtime success. Never claim mock success proves ChatGPT login or inference.
4. Wait for frontend freeze; build web once; package app; record dependencies, exact commands/exit codes/SHA256. Independent QA and actual Codex turn acceptance remain separate evidence.

References: [official Codex App Server](https://learn.chatgpt.com/docs/app-server), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge), [official releases](https://releases.electronjs.org/). Electron stable observed 45.0.0 on 2026-10-24; resolve/pin exact registry versions and lock integrity before installation.

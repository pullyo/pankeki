# Pankeki

**A macOS character-creation studio built around an AI conversation.** Generate character images,
edit selected regions, manage projects and continue into self-built 2D rigging and motion in one workspace.

Codex CLI or Claude Code CLI, signed in with your own account, handles conversation, request
interpretation and tool connections. Image generation and inpainting run through local ComfyUI;
pure recoloring runs on the CPU. Prompts and image context may be sent to the selected AI provider,
so the conversation workflow is not fully offline.

Built for the Comfy.org *Open Source Higgsfield* challenge. Korean is the primary UI language.

Current macOS development: [mac-release-20261028](https://github.com/pullyo/pankeki/tree/mac-release-20261028).
The repository's default branch is `main`; use the branch-specific clone command below for this version.

## What works today

| Area | Status |
| --- | --- |
| Conversation workspace | One automatic composer for conversation, generation and editing requests; visible AI/image models and image dimensions, progress/cancel/error feedback, reply copying and manual restoration of failed prompts. |
| Generate | SDXL 1.0 Base and Animagine XL 4.0 Opt through ComfyUI on Apple Silicon (MPS). |
| Masked edit | Brush or uploaded mask. *Regenerate* uses the dedicated SDXL Inpainting 0.1 UNet; *recolor* runs on the CPU with no model. Pixels outside the mask and the original alpha are preserved exactly (tested to zero error). |
| Image workspace | Click an image to open the editor on the right. Edit/save actions stay over the image; the editor stays closed until you open an image. |
| Generations and projects | Ordinary image-generation records are saved without registering a project. Explicit **New project** or **Save as project** registers one in the project list. Browse multiple projects, save/open project files and export board PNGs; exporting a file keeps the current generation/project kind. |
| Motion editor | Self-built 2D rig: parts, meshes, expressions and motions with PNG / 48-frame ZIP export. |
| Blender/local video (experimental) | Select a Blender scene, render a guide and pass it to a local video runtime. This is separate from the self-built 2D motion editor. |
| Agent tools (optional) | `plugins/pankeki-local` exposes the same HTTP API as MCP tools for Codex or Claude. |

Known limits, stated plainly:

- **Live2D (Cubism) playback is disabled.** The UI can read and validate a model folder, but the official
  Cubism SDK is not bundled, so `.moc3` models do not play.
- **Conversation needs a separate CLI and provider account.** Codex/Claude supply the conversational
  AI; the app connects their requests to local image tools. Provider requests can include prompts and image context.
- **Blender/local video is experimental.** Compatible local tools and video weights are required
  separately. General output quality, character consistency, long dance sequences and processing speed are not guaranteed.
- **Prompt-following in masked edits is weak.** In our tests SDXL inpainting often keeps the original
  color (for example a blue scarf asked to turn red). Use *recolor* for pure color changes.
- Local validation has used a single Apple Silicon Mac. Broad hardware compatibility is not verified.
  Windows/CUDA code paths remain from earlier development but are not the supported setup.

## Requirements

- Apple Silicon Mac, 32 GB memory recommended for SDXL at 1024×1024
- Python 3.12 or 3.13 (Homebrew or python.org), `curl`
- About 30 GB free disk: ~19 GB for the three model files, ~2 GB for Python environments, plus ComfyUI
- Node.js 24 and npm to run the desktop app from source
- Codex CLI or Claude Code CLI and your own provider account for conversation

## Install

```bash
git clone --branch mac-release-20261028 https://github.com/pullyo/pankeki.git
cd pankeki
bash scripts/setup-macos.sh --models
```

`--models` creates the Python environments, downloads ComfyUI at a pinned commit into `vendor/`, and
downloads the three product models from their publishers at pinned revisions. Every model file is
SHA256-checked before it is used, and an existing file or ComfyUI checkout is never overwritten.
Other options:

| Command | What it installs |
| --- | --- |
| `bash scripts/setup-macos.sh` | Editor only (no ComfyUI, no models): projects and the motion editor |
| `bash scripts/setup-macos.sh --generation` | Adds ComfyUI and its Python environment, no models |
| `bash scripts/setup-macos.sh --sdxl` | ComfyUI + SDXL 1.0 Base only (~7 GB) |
| `bash scripts/setup-macos.sh --models` | ComfyUI + SDXL Base, Animagine XL 4.0 Opt, SDXL Inpainting UNet (~19 GB) |

If macOS says *"You have not agreed to the Xcode license agreements"*, the system `git`/`python3`
shims are blocked. Setup falls back to `curl` for ComfyUI; otherwise run `sudo xcodebuild -license`.

## Run

```bash
./Pankeki.command                # starts ComfyUI (8188) and the app (8190), opens the browser
./Pankeki.command --editor-only  # no ComfyUI: editing and motion only
```

Open <http://127.0.0.1:8190>. Stop with Control+C in that terminal. Both servers listen on
`127.0.0.1` only and check `Host`/`Origin` on every request.

Measured on the test Mac at 1024×1024 (median of recent real runs before the model-hash cache was
added, so they include a full model hash per request; your numbers will differ): SDXL Base 25 steps
about 45 s, Animagine 28 steps about 60 s, inpaint regenerate about 80 s.

### macOS desktop app

```bash
cd desktop
npm install
npm start
```

The desktop app reuses the same project folder and servers. If you move the project, it asks for the
folder on start (or set `PANKEKI_PROJECT_ROOT`). Packaging: `node scripts/freeze-release.cjs` then
`node scripts/package-mac.cjs`; set `PANKEKI_SIGN_IDENTITY` and `PANKEKI_NOTARY_PROFILE` for a
Developer ID signed and notarized build, otherwise the build is ad-hoc signed and only runs locally.

### Agent tools (optional)

```bash
.venv-macos-editor/bin/python plugins/pankeki-local/scripts/configure_paths.py   # write tool declarations for this folder
```

See `plugins/pankeki-local/README.ko.md` and `server/CONTRACT.md` for the six tools and their limits.

## How it works

```
macOS desktop / shared web UI ──HTTP──▶ local Pankeki server ──HTTP+WS──▶ local ComfyUI
             │                            │ validated jobs, compositing and saved results
             └── Codex CLI / Claude Code CLI ──▶ AI provider conversation and tool requests
```

- `pankeki/`: standard-library HTTP server and engine (`engine.py`, `jobs.py`, `comfy_adapter.py`,
  `composite.py`, `recolor.py`).
- `web/`: the shared composer, image editor, project library and motion workspace;
  `web/build.py` builds a single `web/index.html` from `web/src` without a bundler.
- `desktop/`: Electron app with CLI bridges, context isolation, sandbox and a hash-locked CSP.
- The experimental video path connects Blender guide rendering to a local video worker.
- Every run records its workflow, inputs, model hashes and timings so a result can be traced and
  checked; a result is only served after its files re-verify.

## Tests

```bash
.venv-macos/bin/python -m unittest discover -s tests   # Python (fake ComfyUI, no GPU)
node --test scripts/test_ui_state.cjs web/tests/*.cjs  # frontend logic
(cd desktop && npm test)                               # desktop shell and chat bridges
```

These tests use fake ComfyUI responses. Passing them does not mean image quality or GPU inference was
verified.

## License

Pankeki's code is [MIT](LICENSE). Model weights, ComfyUI (GPL-3.0), fonts and icons keep their own
licenses; see [THIRD_PARTY.md](THIRD_PARTY.md). The models are licensed under CreativeML Open RAIL++-M,
whose use restrictions also apply to generated images.

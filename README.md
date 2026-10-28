# Pankeki

**A local character design studio on top of ComfyUI.** Describe a character, compare candidates,
paint a mask to regenerate or recolor just that part, then save, reopen and export. Everything runs on
your own Mac: the app talks to a local ComfyUI process over `127.0.0.1`, and no image or prompt leaves
the machine unless you use the optional chat panel.

Built for the Comfy.org *Open Source Higgsfield* challenge. Korean is the primary UI language.

## What works today

| Area | Status |
| --- | --- |
| Generate (txt2img / img2img) | SDXL 1.0 Base and Animagine XL 4.0 Opt through ComfyUI on Apple Silicon (MPS). |
| Masked edit | Brush or uploaded mask. *Regenerate* uses the dedicated SDXL Inpainting 0.1 UNet; *recolor* runs on the CPU with no model. Pixels outside the mask and the original alpha are preserved exactly (tested to zero error). |
| Projects | Candidates, edits and settings are saved in the browser (IndexedDB) and as project files you can reopen. Board PNG and project export. |
| Motion editor | Self-built 2D rig: parts, meshes, expressions and motions with PNG / 48-frame ZIP export. |
| Desktop app (optional) | Electron shell in `desktop/` with a chat panel that can call Pankeki's generate/edit tools. |
| Agent tools (optional) | `plugins/pankeki-local` exposes the same HTTP API as MCP tools for Codex or Claude. |

Known limits, stated plainly:

- **Live2D (Cubism) playback is disabled.** The UI can read and validate a model folder, but the official
  Cubism SDK is not bundled, so `.moc3` models do not play.
- **The chat panel is not a local model.** It drives the separately installed Codex CLI or Claude Code
  CLI under your own account. Generation itself is always local.
- **Prompt-following in masked edits is weak.** In our tests SDXL inpainting often keeps the original
  color (for example a blue scarf asked to turn red). Use *recolor* for pure color changes.
- Tested on one machine only: Apple M6, 32 GB, macOS 27.0.1. Windows/CUDA code paths remain from earlier
  development but are not the supported setup.

## Requirements

- Apple Silicon Mac, 32 GB memory recommended for SDXL at 1024×1024
- Python 3.12 or 3.13 (Homebrew or python.org), `curl`
- About 30 GB free disk: ~19 GB for the three model files, ~2 GB for Python environments, plus ComfyUI
- Node.js 24 and npm only if you want the desktop app

## Install

```bash
git clone https://github.com/pullyo/pankeki.git
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

### Desktop app (optional)

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
browser / desktop shell ──HTTP──▶ pankeki serve (127.0.0.1:8190) ──HTTP+WS──▶ ComfyUI (127.0.0.1:8188)
                                   │ request validation, job lanes, SQLite job store
                                   │ ROI planning, exact result cache, final compositing
                                   └ runtime/runs/<job>/  original, mask, workflow, recipe, result, metrics
```

- `pankeki/`: standard-library HTTP server and engine (`engine.py`, `jobs.py`, `comfy_adapter.py`,
  `composite.py`, `recolor.py`).
- `web/`: no bundler; `web/build.py` builds a single `web/index.html` from `web/src`.
- `desktop/`: Electron shell with context isolation, sandbox and a hash-locked CSP.
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

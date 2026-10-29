<img src="docs/images/pankeki-icon.png" alt="Pankeki pancake logo" width="64" height="64">

# Pankeki

**A character-creation studio connecting an AI conversation to local image tools.** Describe an idea, compare candidates, click an image to edit it, and keep selected work in projects. Continue into self-built 2D rigging and motion, or experiment with Blender-guided local video.

[한국어](README.ko.md) · [Current macOS app](https://github.com/pullyo/pankeki/tree/mac-release-20261028) · [Experimental Windows port](https://github.com/pullyo/pankeki/tree/windows-port-20261029)

Korean is the primary UI language. Built for the Comfy.org Open Source Higgsfield challenge.

![Pankeki home screen](docs/images/pankeki-home-20261029.jpg)

*Pankeki home screen — user-provided image received on October 29, 2026.*

## Choose the right branch

| Branch | What it contains |
| --- | --- |
| [mac-release-20261028](https://github.com/pullyo/pankeki/tree/mac-release-20261028) | Current macOS desktop app and local engine integration. Local validation has used one Apple Silicon Mac; broad hardware compatibility is unverified. |
| [windows-port-20261029](https://github.com/pullyo/pankeki/tree/windows-port-20261029) | Windows/CUDA port. 313 automated checks on a Mac host and a Windows cross-build have been recorded. Installation, GPU inference and native app behavior on an actual Windows PC remain unverified. |
| `main` | Historical application code from the October 20 checkpoint. Updating this README does not update that code; clone one of the branches above for the current app. |

## The workspace

- **One composer:** conversation, generation and editing requests share an automatic input flow. The selected AI/image models, image dimensions, progress, cancellation and errors stay visible. Completed text replies can be copied; failed prompts can be restored to the input for manual review and resubmission.
- **Images:** click a result to open the editor on the right. Image actions stay with the image. Use a brush or uploaded mask for local changes; the editor stays closed until you open an image.
- **Generations and projects:** ordinary generation records are saved separately. **New project** and **Save as project** explicitly register projects. Browse multiple projects in the dedicated Projects screen, switch between them, reopen project files and export image boards. Downloading a project file keeps the current generation/project kind; it does not turn a generation into a project.
- **2D motion:** prepare PNG parts, meshes, expressions and motion in the self-built rigging tools. Export a pose PNG or a 48-frame ZIP. This is separate from Cubism playback and Blender video.

| Image operation | Local engine |
| --- | --- |
| Character generation / source-conditioned generation | SDXL 1.0 Base or Animagine XL 4.0 Opt through ComfyUI |
| Masked regeneration | Dedicated SDXL Inpainting 0.1 UNet, using SDXL Base conditioning |
| Pure recoloring | CPU operation, without an image model |

Masked compositing preserves RGB outside the mask and the source alpha; this invariant is covered by tests. It does **not** guarantee that the model follows the requested change inside the mask. Faces, hands, clothing details and character consistency still need visual review.

## Local processing and AI providers

ComfyUI image inference and CPU recoloring run locally. The desktop conversation uses a separately installed **Codex CLI** or **Claude Code CLI**, signed in with your own provider account. Chat text, selected image context, generated-result previews and tool requests/results can be sent to that provider. The conversation workflow is therefore **not fully offline**. Project storage and model weights remain local; the application does not require a separate API key for its supported CLI sign-in flow.

Local services use loopback addresses: Pankeki at `127.0.0.1:8190`, ComfyUI at `127.0.0.1:8188`. These are not instructions for public internet hosting. Optional MCP tools expose the local image API to compatible agents; see the [tool guide](https://github.com/pullyo/pankeki/blob/mac-release-20261028/plugins/pankeki-local/README.ko.md).

## Start on macOS

Use an Apple Silicon Mac, Python 3.12 or 3.13, `curl`, and Node.js 24/npm for the desktop app. For SDXL at 1024×1024, 32 GB memory and roughly 30 GB free disk are a practical starting point; video needs additional tools, weights, memory and time.

```bash
git clone --branch mac-release-20261028 https://github.com/pullyo/pankeki.git
cd pankeki
bash scripts/setup-macos.sh --models
# Prepare the dedicated MCP runtime for desktop image tools
.venv-macos/bin/python plugins/pankeki-local/scripts/configure_paths.py
.venv-macos/bin/python plugins/pankeki-local/scripts/setup_runtime.py
```

Setup downloads pinned ComfyUI and the three product model files (about 19 GB total), checking model SHA256 values. Existing mismatched model files are preserved and reported. Options: no flag for the editor environment, `--generation` for ComfyUI without models, or `--sdxl` for SDXL Base only. Initial setup needs network access.

For an already prepared runtime, open the desktop app:

```bash
cd desktop
npm ci
npm start
```

**First launch from a fresh clone:** the Mac setup script does not yet create the two generated runtime configuration files. In a separate terminal at the project root, run `./Pankeki.command --no-browser` and keep it open, then use the desktop commands above. This initializes the configuration and starts the local servers without opening a browser; the desktop app reuses those servers. Stop that terminal with Control+C when finished. Once the runtime configuration exists, the desktop app can start its own servers.

`configure_paths.py` writes this checkout's absolute MCP paths; `setup_runtime.py` reads that binding, creates the dedicated Python environment using `.venv-macos`, installs `server/requirements.txt` and runs `pip check`. It does not register a global plugin or change your CLI account configuration. The desktop bridges use this runtime directly. Run path configuration again after moving the checkout; moved Python environments may need to be recreated.

The desktop app needs the external project folder, Python/ComfyUI/models and a separately installed Codex or Claude CLI. For detailed setup and packaging, see the [macOS guide](https://github.com/pullyo/pankeki/blob/mac-release-20261028/README.macos.ko.md).

**Optional browser route:** `./Pankeki.command` opens the shared image/editor UI in a browser; `./Pankeki.command --editor-only` runs without image generation. The native Codex/Claude conversation bridge belongs to the desktop app. This browser path does not replace the desktop conversation workflow.

## Windows

Use the [Windows branch and installation guide](https://github.com/pullyo/pankeki/blob/windows-port-20261029/README.windows.ko.md), not the historical `main` commands. The port targets Windows 10/11 x64, Python 3.12/3.13 and NVIDIA CUDA. A browser editor-only path and explicit CPU generation option also exist. The desktop client requires the generation runtime; Python/ComfyUI/models/CLIs remain external. Cross-built packages are unsigned, so SmartScreen may warn. **No actual Windows validation has been recorded.**

## Experimental and unavailable features

- **Blender/local video is experimental on macOS.** It renders a scene guide and sends that guide to a separately prepared local video runtime. Compatible Blender, video tools and model weights are not included in the ordinary image setup. Output quality, long dances, identity retention and speed are not guaranteed. This path is disabled on Windows.
- **Apple Vision background separation is macOS-only.** Its optional helper requires Apple tools; it is disabled on Windows.
- **Live2D/Cubism playback is disabled.** Folder/path/reference checks can inspect a model bundle, but the official Core/Framework SDK is not included. A `.moc3` file cannot be played or exported through the self-built rigging tools.
- Automatic tests use controlled fixtures and fake service responses. Passing them or producing an app package is not proof of GPU inference, image quality or native compatibility. There is no general performance guarantee.

## Development and licenses

The current branches contain `pankeki/` (local server/engine), `web/` (shared UI), and `desktop/` (Electron and CLI bridges). Build frontend changes with the branch's project Python and `web/build.py`. Keep historical checkpoint/design documents as historical references, not current feature status.

Pankeki code is [MIT](LICENSE). ComfyUI, model weights, fonts and icons retain their own terms; see [THIRD_PARTY.md](THIRD_PARTY.md). Model use conditions are separate from the software license; consult the referenced component terms.

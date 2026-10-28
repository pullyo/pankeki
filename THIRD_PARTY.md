# Third-party components and models

Pankeki's own source code is MIT-licensed (see `LICENSE`). That license does not change the terms of
the separate software, model weights, fonts and icons listed here. **No model weights, ComfyUI source,
Python environments or Electron binaries are included in this repository**; setup downloads them from
their publishers at pinned revisions and checks each file's SHA256.

Checked 2026-10-28 against the publishers' model cards and installed package metadata.

## Models the app uses

| Model (app ID) | Publisher / pinned file | License | Notes |
| --- | --- | --- | --- |
| SDXL 1.0 Base (`sdxl-base`) | [stabilityai/stable-diffusion-xl-base-1.0](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0) @ `462165984030`, `sd_xl_base_1.0.safetensors` | [CreativeML Open RAIL++-M](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/blob/main/LICENSE.md) | Default generation model; also supplies CLIP/VAE for the inpaint UNet. Use restrictions in Attachment A of the license apply. |
| Animagine XL 4.0 Opt (`animagine-xl-4.0-opt`) | [cagliostrolab/animagine-xl-4.0](https://huggingface.co/cagliostrolab/animagine-xl-4.0) @ `2b7c1b397761`, `animagine-xl-4.0-opt.safetensors` | CreativeML Open RAIL++-M (the card states it adopts the SDXL license without modification) | Anime-style generation (txt2img/img2img only). |
| SDXL Inpainting 0.1 UNet (`sdxl-inpaint-v01`) | [diffusers/stable-diffusion-xl-1.0-inpainting-0.1](https://huggingface.co/diffusers/stable-diffusion-xl-1.0-inpainting-0.1) @ `115134f36312`, `unet/diffusion_pytorch_model.fp16.safetensors` | CreativeML Open RAIL++-M | Masked regenerate edits only. |
| SD Turbo (`sd-turbo`, optional) | [stabilityai/sd-turbo](https://huggingface.co/stabilityai/sd-turbo) @ `b261bac6fd2c` | [Stability AI Community License](https://huggingface.co/stabilityai/sd-turbo/blob/main/LICENSE.md) | Not registered by the Mac launcher. Commercial use has registration and revenue conditions. Powered by Stability AI. |

Outputs of these models remain subject to the model licenses' use restrictions. The MIT license of
this code is not a grant of rights in model outputs.

## Models that are not part of the app

Some local evaluation copies (FLUX.2 Klein 4B and Qwen-Image-Edit-2511, Apache-2.0; Qwen-Image 2.1,
`qwen-research` license; LTX-2.3, LTX-2 Community License; Gemma 3, Gemma Terms of Use) were used for
experiments only. The app does not load them, setup does not download them, and they are not
distributed. Qwen-Image 2.1's research license and the LTX-2/Gemma terms would need review before any
product use.

## Software

| Component | License | How it is used |
| --- | --- | --- |
| [ComfyUI](https://github.com/Comfy-Org/ComfyUI) @ `8f04fd6ecf4a` | GPL-3.0 | Downloaded by `scripts/setup-macos.sh` into `vendor/ComfyUI` and run as a separate local process over its HTTP API. Not included in this repository. |
| PyTorch 2.14 | BSD-3-Clause / Apache-2.0 components | Installed into the ComfyUI virtual environment by setup. |
| NumPy | BSD-3-Clause | App dependency (`requirements.txt`). |
| Pillow | MIT-CMU | App dependency. |
| websocket-client | Apache-2.0 | App dependency (ComfyUI previews). |
| [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk) 2.3.0 | MIT | Dedicated runtime of the `plugins/pankeki-local` tool server. |
| Electron 45.0.0 | MIT | Desktop shell (`desktop/`), installed by npm. |
| @electron/packager 20.3.0 | BSD-2-Clause | Desktop packaging only. |
| comfy-sdk 0.5.0 / comfy-api-proxy 0.1.6 | MIT | Optional Windows transport; texts in `integrations/comfy-sdk/licenses/`. |
| [Pretendard](https://github.com/orioncactus/pretendard) Variable | SIL Open Font License 1.1 | UI font; license in `web/vendor/pretendard/LICENSE`. |
| [Lucide](https://lucide.dev) icons | ISC | UI icons; license in `web/vendor/lucide/LICENSE`. |

The desktop chat panel talks to the separately installed **Codex CLI** (OpenAI) or **Claude Code CLI**
(Anthropic) under the user's own sign-in. Neither CLI nor any account is bundled, and their own terms apply.

## Images

App logo and illustration assets in `web/assets/` were created for this project with AI image
generation and selected by the author; provenance notes sit next to them (`*provenance*`). This is not a
trademark clearance.

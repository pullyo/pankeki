---
name: pankeki
description: "Use when the user asks to generate images, edit a masked region, check jobs, or inspect results with their local Pankeki app."
---

Use this plugin's Pankeki tools for local Pankeki work. Read status first. Use the actual available model IDs and report backend errors.

The source schema supports `sdxl-inpaint-v01` only for edit `operation=regenerate`, with `cache=false`. Generation supports `sdxl-base`/`sd-turbo` and the distinct optional `animagine-xl-4.0-opt` txt2img-only model. Animagine is never an edit or recolor model; CPU recolor does not use a model. Use any new ID only after the loaded native schema accepts it and the app's corresponding model availability and release health/identity handoff are confirmed. Never substitute Base or bypass a rejected schema with SDK/direct HTTP/Comfy calls.

For explicitly selected Animagine generation, use meaning-preserving English comma tags with requested count, attributes, colors and style; put quality tags at the end. Do not invent artists, series, extra subjects or props. Recommended CFG5/28 steps/Euler Ancestral are opt-in values, not permission to overwrite the user's existing numbers or negative. Preserve direct-call explicit values. Source support, installed weight integrity, actual inference, image quality and precise masked editing are separate claims.

Dedicated results identify two components: the primary inpainting UNet and the `sdxl-base` CLIP/VAE conditioning checkpoint. Report both names/manifest SHA256 values and the evidence scope returned by get_result. Its top-level `model_components` matches the frozen submission config and both app recipe/metrics; `component_verification` is the app-reported file-check level. Empty-mask pixel_copy returns not_run and no workflow; it is not model execution.

Choose the edit operation from the user's intent. For color-only changes that must preserve the existing shape, use the existing CPU recolor operation. For changes that redraw shape/content, or when the user explicitly requests SDXL, use regenerate. Recolor is a CPU color transform and must never be described as SDXL generation. Do not automatically retry a failed SDXL color instruction with a different method; record the result and follow the assigned scope.

Tools:
- pankeki_get_status: existing app/Comfy status and model availability.
- pankeki_generate_image: submit local generation; defaults select SDXL Base.
- pankeki_edit_image: explicit source PNG and same-size mask PNG; regenerate uses the model, recolor uses the existing CPU color transform.
- pankeki_get_job: observe the submitted job without submitting again.
- pankeki_get_result: retrieve and verify a succeeded owned job's image and provenance.
- pankeki_cancel_job: logical cancellation; GPU work may continue.

Use absolute source/mask paths inside the configured output/runtime input roots. Mask black preserves pixels; positive values select the edit. Do not overwrite existing evidence. Default sessions are independent; explicitly reusing a session can supersede unfinished work.

After submission, poll the returned job_id and keep failed/canceled/uncertain distinct. Do not automatically repeat a POST after a lost response. Only report success after get_result validates the actual PNG and receipt. Show the returned absolute image path and summarize the actual model, seed, source/mask and evidence.

Local CPU recolor, empty-mask copying and cache reuse are distinct from a fresh SDXL denoiser run. model_calls counts submissions, not proven denoiser execution. Technical success does not certify art or rig quality.

Existing human VTuber front/sheet/body/eyes/mouth assets are external Codex image_gen drafts made by the manager before role correction. Preserve imported-external-art technical validation classification, the unresolved knee-quality objection and the stop on promoting/packaging those assets as complete app-made art. A local edit of imported art remains imported art plus a Pankeki edit.

Never use external image_gen, cloud generation or direct ComfyUI calls as a fallback for Pankeki. Default staff scope does not permit adding models, changing product code/logo/navigation, clearing global cache, starting/restarting servers or creating chats. A direct user instruction to connect a named local model or assign implementation permits only that explicitly named model/code/files and the assigned owner's scope. It does not implicitly authorize installation, deployment, server restart or inference; those remain separate assignments. During source-only implementation, preserve the requested snapshots/SHA and run only authorized isolated tests, without probing the live app. Keep other owners' source, runtime config, installed cache and user settings unchanged. Hand results back in your own report/chat; the manager reviews rather than executing.

Local package instructions: see ../../README.ko.md. The plugin must be installed/loaded in this host before tool availability is claimed.

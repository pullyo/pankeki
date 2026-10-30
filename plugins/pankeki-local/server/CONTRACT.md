# Pankeki Local MCP server contract — v0.1.3 / 2026-10-24

Entry point: `plugins/pankeki-local/server/pankeki_mcp.py`. Python>=3.11 (app Python currently3.12.14). Official `mcp==2.3.0` SDK (`MCPServer`, stdio); Pillow>=12,<13 for image validation. Neither SDK nor a venv is installed/modified by the server owner. Mac owner installs `server/requirements.txt` in its dedicated runtime and owns launcher/manifest. App `.venv-macos` currently has Pillow12.3.0 but no MCP SDK.

```sh
<dedicated-python> /absolute/Pankeki/plugins/pankeki-local/server/pankeki_mcp.py --app-root /absolute/Pankeki --api-url http://127.0.0.1:8190
```

Optional `--state-dir` (default `<app-root>/runtime/macos/pankeki-mcp-20261023/implementation/state`), repeatable `--input-root` (default `<app-root>/output` and `<app-root>/runtime`), `--timeout` (default10s, maximum30s). Absolute paths required. The server never starts/restarts Pankeki/Comfy, calls Comfy directly, downloads models, or invokes external generators. Input symlinks resolving outside approved roots are rejected. Inputs are PNG<=20MiB/16MP; source/mask dimensions must match. HTTP body<=32MiB. Submissions and snapshots are stored in unique state directories; inputs are never overwritten. Only loopback HTTP is allowed; proxies/redirects are disabled.

`--state-dir` must remain under the resolved `<app-root>/runtime` directory; it is never an arbitrary output/source overwrite destination. All returned artifact paths are resolved canonical paths (macOS may canonicalize `/var` to `/private/var`).

stdin/stdout are official MCP JSON-RPC stdio only; diagnostics use stderr. No custom protocol implementation. Adapter/network/validation/result errors raise MCP tool errors, never fallback images. SDK2.3.0 retains legacy-client compatibility according to official release docs. Fail-fast stderr/exit if SDK unavailable. `--help` and core unit tests do not require SDK import.

Expected `AdapterError` failures alone are converted to official SDK `ToolError`, preserving the input/state/connection reason and uncertain-POST **do not automatically retry** instruction in the client's `isError` result. Unexpected internal exceptions retain the SDK's default masking; error masking is not globally disabled.

## Tool schemas (exact Python signatures generate the MCP schemas)

- `pankeki_get_status()` → `{app_reachable, models, health}`. Uses existing GET /api/models and /api/health. Health failure does not classify CPU recolor as unavailable; app connection failure is an error.
- `pankeki_generate_image(prompt, negative='', model_id='sdxl-base', seed=1, width=1024, height=1024, steps=25, cfg=6, sampler='dpmpp_2m', scheduler='karras', cache=false, preview=false, session=null)` → asynchronous submitted job metadata, request/snapshot provenance paths. Uses POST /api/jobs; never waits for inference.
- `pankeki_edit_image(source_path, mask_path, prompt='', operation='regenerate', target_color=null, source_color=null, color_tolerance=35, feather=4, model_id='sdxl-base', seed=1, steps=25, cfg=6, denoise=.55, sampler='dpmpp_2m', scheduler='karras', roi=false, halo=32, cache=false, preview=false, session=null)` → same asynchronous job handle. `operation` enum regenerate/recolor; recolor requires #RRGGBB target, optional #RRGGBB source, finite tolerance0..90. Regenerate uses existing model inpaint; recolor uses existing local CPU branch.
- `pankeki_get_job(job_id)` → actual GET /api/jobs state. ID exactly32 lower hex. queued/running/canceling/canceled/succeeded/failed/uncertain remain distinct.
- `pankeki_get_result(job_id)` → only succeeded result: actual PNG path, content SHA256, dimensions, original request record, actual engine recipe/metrics and model/seed/source/mask provenance. Verifies HTTP bytes against `<app-root>/runtime/runs/<id>/result.png`, engine hashes/job/revision/request, and submitted image pixels against engine original/mask. For edits, mask0 RGB and full alpha must be unchanged. Requires this adapter's persisted submission record; does not guess another client's request. No API route exists for recipe, so limited local run-directory reads are required.
- `pankeki_cancel_job(job_id)` → actual cancel response. Logical discard only; GPU work may continue. No auto-retry of uncertain POST.

Numeric fields reject bool/nonfinite/out-of-range; seed0..2^53−1, dimensions64..2048 multiples8, steps1..100, cfg0..30, denoise.01..1, halo0..512, feather0..64. Generate model enum is sdxl-base/sd-turbo/animagine-xl-4.0-opt. Edit model enum remains sdxl-base/sd-turbo/sdxl-inpaint-v01; the dedicated model is permitted only with operation=regenerate and cache=false. Animagine is rejected for every edit operation, including direct-adapter recolor calls, before image paths are read or a POST occurs. Sampler euler/euler_ancestral/dpmpp_2m; scheduler normal/simple/karras. Strings<=10000. `session` null creates a unique `mcp-` session; supplied session is scoped with the same prefix (1..90 characters). Same session revision supersedes previous unfinished work, matching Pankeki. Per-request source/mask snapshots and exact submitted JSON bytes/hash preserve request provenance even if original files later change.

## Animagine source capability update — 2026-10-25

`animagine-xl-4.0-opt` is a distinct, optional txt2img checkpoint identity. Its filename is `animagine-xl-4.0-opt.safetensors`, official revision `4688bebb86806957f6f83c39f2573161630e22db`, SHA256 `6327eca98bfb6538dd7a4edce22484a1bbc57a8cff6b11d075d40da1afb847ac`. Existing Base/Turbo defaults and dedicated edit behavior are unchanged. Source support does not establish installation, loaded host schema, Comfy execution or visual quality; installed-cache replacement/restart is a separate handoff.

The [current model card](https://huggingface.co/cagliostrolab/animagine-xl-4.0) and [2025-02-13 Opt guidance](https://cagliostrolab.net/posts/optimizing-animagine-xl-40-in-depth-guideline-and-update) recommend tag-based English prompts with quality tags at the end and CFG5/28 steps/Euler Ancestral. The fixed weight revision's older README recommends CFG6/25; keep the document dates distinct. `normal` scheduler is the app's compatible choice, not an official recommendation. Direct MCP calls preserve all explicit prompt, negative and numeric values and never silently apply a preset or invent tags. Existing default arguments remain backward compatible; callers can explicitly send steps28/cfg5/sampler=euler_ancestral/scheduler=normal. This generation-only addition makes no precise-edit or art-quality guarantee.

All job/result/cancel tools require this adapter's persisted submission ledger. Arbitrary browser job IDs cannot be canceled through these tools. Concurrent default submissions get independent sessions and unique snapshot directories, then use Pankeki's existing single queue; the adapter does not launch a second inference queue.

No tools for browser projects/parts/rigs/expressions/motions/exports, no external image_gen, no cache-clear tool. Result `model_calls` is a submission count, not sufficient evidence of denoiser execution. Actual recipe/metrics and configured model identity at submission are returned with their evidence scope; no new weight hashing/attestation claim.

## Dedicated inpainting identities

For `sdxl-inpaint-v01`, the selected runtime config entry must contain `conditioning_model_id: "sdxl-base"`. Its `model_name` is the primary UNet alias and its `manifest.model_sha256` is the UNet identity. The separate `models["sdxl-base"]` entry supplies the CLIP/VAE checkpoint name and manifest. Missing/invalid names, manifests or conditioning selection fail before POST. Names must be nonblank; manifest SHA256 values are 64 lowercase hex characters. No replacement with Base is performed.

The adapter freezes both entries as `provenance.model_components_at_submission` in the submission ledger:

```json
{
  "primary": {"model_id": "sdxl-inpaint-v01", "model_name": "<UNet alias>", "model_sha256": "<UNet manifest SHA256>"},
  "conditioning": {"model_id": "sdxl-base", "model_name": "<CLIP/VAE checkpoint>", "model_sha256": "<Base manifest SHA256>"}
}
```

`get_result` requires exact equality of both components in **recipe and metrics** against that frozen dictionary, even if runtime config later changes. It retains the existing model ID/name, request, PNG/hash, receipt, source/mask and pixel-preservation checks. A valid dedicated result additionally returns top-level `model_components` and `component_verification`.

`cache=true` is rejected for this model. Real model results must report cache=off and app `component_verification=configured_files_sha256`. This is the app's report of configured-file SHA checks, not a new weight read by the adapter or full attestation of a remote Comfy process. The adapter's provenance scope remains explicit.

An empty mask remains a distinct original copy: cache=empty-mask-skip, kind=pixel_copy, model_calls=0, component_verification=not_run, workflow_path=null. After verifying the frozen submission against the engine input, the adapter requires the actual L mask to contain no selected pixels before accepting this empty-copy classification. The app may omit denoiser_executed on this early return; if present it must be false. The adapter preserves that absence rather than inventing an execution flag. The declared component dictionary is still checked but must not be presented as executed inference. CPU recolor keeps its independent policy and never selects the dedicated model. Status forwards the app's generation `models` and separate `edit_models` availability; source/schema support alone is not live availability.

Imported character art remains externally generated source plus a Pankeki edit. Model connection, manifest/file checks, job success and art acceptance are separate. Keep actual result path/hash and a same-crop source/result comparison; do not promote the existing unaccepted knee candidates as finished art.

## Verification / handoff

Core: `<app-python> -m unittest discover -s plugins/pankeki-local/server/tests -v` (temporary fake HTTP fixtures, no GPU). SDK stdio integration uses the Mac owner's installed SDK runtime once available; integration tests must identify skips honestly. Actual SDXL QA belongs to QA, not server owner.

Official sources: [Python SDK v2.3.0 release](https://github.com/modelcontextprotocol/python-sdk/releases/tag/v2.3.0), [SDK overview](https://github.com/modelcontextprotocol/python-sdk), [SDK migration](https://github.com/modelcontextprotocol/python-sdk/blob/main/docs/migration.md). SDK was checked live; legacy v1 FastMCP imports must not be assumed for the pinned v2 runtime.

## Historical v0.1.2 implementer handoff

Core implementation is frozen after the reviewed P2 error-detail fix at SHA256 `6b662b1ee8a385c0b09036473361f89f06d15701da2ae27fdb34b88649e0c4a6`. With the Mac owner's dedicated SDK2.3.0/Pillow12.3.0 Python, all19 server tests pass, including real official-SDK stdio initialize/tools/list/tools/call/errors/EOF shutdown over a temporary fake HTTP fixture. The stdio regression additionally verifies pending/bad-ID/negative-seed/connection/uncertain-submit reasons and unexpected-error masking. Details: `runtime/macos/pankeki-mcp-20261023/implementation/ready.json`, `implementation/report.md`, and `implementation/tool-error-stdio-proof.json`. This is not actual SDXL generation, Codex native host tool exposure, or UI/project integration acceptance. Existing QA processes/jobs were not restarted or called by the implementer.

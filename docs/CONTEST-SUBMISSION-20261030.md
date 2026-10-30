# Pankeki — submission review sheet / 출품 최종 확인표

Status: **DRAFT FOR REVIEW; NOT SUBMITTED.** Prepared October 30, 2026 (KST). This document records source-backed answers, not a new runtime, GPU or Windows verification.

## Source reviewed

- Official competition: https://comfy.org/open-source-higgsfield/ — deadline October 30, 9:00 a.m. Pacific = **October 31, 01:00 KST**. Best Overall automatically considers every eligible submission.
- Public repository: https://github.com/pullyo/pankeki — `main` is October 20 application code, not the reviewed macOS source.
- Current macOS candidate: https://github.com/pullyo/pankeki/tree/mac-release-20261028 — PR #1 remains open, and the pinned source is https://github.com/pullyo/pankeki/tree/016eb5e11672aef22d410fac33d6e248d13535bc.
- Installation/limitations: https://github.com/pullyo/pankeki/blob/mac-release-20261028/README.macos.ko.md ; product-specific notices: https://github.com/pullyo/pankeki/blob/mac-release-20261028/THIRD_PARTY.md .
- Original form discovery and demo plan: https://github.com/pullyo/pankeki/blob/mac-release-20261028/docs/releases/submission-form-20261028.ko.md .
- Windows port is **not** evidence of real Windows GPU/native-app operation: https://github.com/pullyo/pankeki/tree/windows-port-20261029 .

The **October 30 home-screen illustration on main** has user-supplied provenance; it should not be described as a dated live capture or as validation of the Windows branch. The macOS branch contains historical internal team documents with personal/local paths. **Review public content before merging all of PR #1.** A public PR is already accessible; this note does not claim a privacy audit.

## Official Typeform answers — ready to paste (subject to owner confirmation)

Form: https://form.typeform.com/to/V1dSQrkS

| Field | Current answer / disposition |
| --- | --- |
| Name | **OWNER INPUT REQUIRED** — submitter's public name, not recorded here |
| Comfy app Email | **OWNER INPUT REQUIRED** — Comfy account email, not recorded here |
| Country | **OWNER INPUT REQUIRED** |
| Social handles / Discord / Reddit | Optional; owner decision |
| Familiarity with ComfyUI | **OWNER CHOICE** — cannot infer experience category |
| Project name | `Pankeki` |
| One-line description (max 100 chars) | `Local ComfyUI character studio: generate, compare, mask-edit and animate original characters` |
| GitHub URL | `https://github.com/pullyo/pankeki` — landing README must clearly direct judges to macOS candidate; alternatively use the candidate branch URL if the field allows |
| Demo video URL (max 2 minutes) | **BLOCKED: verified public URL not supplied or discovered**; user must record/upload the real app |
| Live link | Leave blank; local Mac app, no public hosted service verified |
| Social post URL containing `#OpenSourceHiggsfield` | **BLOCKED: verified public URL not supplied or discovered**; social post must include the real demo link |
| Which parts of ComfyUI used? | **Comfy API** — current Mac path uses ComfyUI HTTP/WebSocket API; do not substitute the older Windows SDK experiment |
| List all generative models used | `Image: SDXL 1.0 Base (Stability AI); Animagine XL 4.0 Opt (Cagliostro Research Lab); SDXL Inpainting 0.1 UNet (diffusers). These run locally through ComfyUI. Optional desktop conversation: user-installed OpenAI Codex CLI or Anthropic Claude Code CLI, whose proprietary model depends on user configuration; not bundled or required for local image inference.` |
| Other tools or techniques | Use the English text below |
| Category | **Recommended: Most Innovative** (requires the demo to explain the design). Best Overall is automatic. Do **not** claim Open Weights Only or FLUX 3/LTX/MiniMax bonuses without category-specific proof; closed-model optional chat means this is not an unqualified all-open stack. |
| Is your stack fully open? | **Recommended: No** for the *whole app*: Codex/Claude optional conversation may use proprietary hosted models. Image inference itself uses locally downloadable weights and no hosted image API. If the official question explicitly excludes optional chat, have owner evaluate its narrower definition. |
| Four agreements | **OWNER MUST READ AND ACCEPT EACH**: public OSS source and install instructions; lawful/SFW/original materials; creator-feature publicity terms; one submission per person |
| Anything else | Use the English text below |

These items reproduce the form mapping recorded on October 28; the actual third-party form cannot be submitted through this document. Do not invent personal fields, URL values or prior participation. The application code is MIT, **not all dependencies/models**: ComfyUI GPL-3.0 and SDXL-derived models CreativeML Open RAIL++-M; see THIRD_PARTY.md.

### Other tools or techniques (English)

Pankeki uses a small local Python server to construct and submit text-to-image, image-to-image and SDXL inpainting graphs through ComfyUI's HTTP/WebSocket API. A brush or uploaded mask selects the edit area; region-of-interest planning can reduce the processing area, and the compositing path preserves the source alpha and pixels outside the mask (a tested invariant, not a guarantee of prompt-following quality inside the mask). Color-only edits run as CPU recoloring without image-model inference. Local project records can be reopened, and prepared PNG parts can be edited in a self-built 2D rig/motion workspace and exported as PNG or a 48-frame ZIP. An optional Electron desktop shell connects separately installed Codex/Claude CLIs; that conversation can contact an external provider. App code and model files are separate, with model checksums and third-party terms documented.

### Anything else (English)

The macOS candidate has a recorded development and local validation history on one Apple Silicon Mac, but reproducibility on another machine and new GPU execution at the pinned Git commit have not been independently re-tested for this submission. Image inference runs locally through ComfyUI; optional conversational AI uses the user's own Codex/Claude CLI account and is not fully offline. Live2D/Cubism playback is not included, and Blender-guided local video is experimental. The project code is MIT; ComfyUI and model weights have their own licenses. The Windows port is not the validated submission build.

## Reuse the existing two-minute demo plan / 기존 대본 재사용

**All visuals must be actual screen recording from the candidate build**. Capture the active Git commit and `/api/health` build status privately before recording. Verify the model path and candidate results on the machine; this review document does not perform those tests. If GPU waiting time is cut, caption **"Generation waiting time shortened in editing"**; never say it is real-time. Use original, safe-for-work characters; hide accounts, mail, full paths and private content.

| Segment | Actual capture | Suggested English narration |
| --- | --- | --- |
| 0:00–0:08 | Candidate home screen and Pankeki logo | “This is Pankeki, a character-creation studio powered by local ComfyUI.” |
| 0:08–0:28 | Choose SDXL or Animagine, enter original-character prompt, show actual input and result; compress only waiting time | “Generate character candidates locally using downloadable model weights.” |
| 0:28–0:40 | Compare generated candidates; choose one | “Compare candidates and keep the design you want to develop.” |
| 0:40–1:00 | Paint/upload a mask and run inpainting; show input and actual result | “Regenerate a selected region. Our compositor keeps the pixels outside the mask intact.” |
| 1:00–1:12 | Perform a real CPU recolor | “Color-only edits use CPU processing without another image model call.” |
| 1:12–1:25 | Save, reopen a real project, export a board image | “Save your process and pick up where you left off.” |
| 1:25–1:40 | Prepared rig/motion playback and 48-frame export **only if freshly verified**; otherwise show another verified image/project workflow | “Prepared parts can also be arranged for simple 2D motion.” |
| 1:40–1:57 | Diagram plus source files / local launcher | “A Python backend drives ComfyUI through its API. The app is MIT licensed, with separate model licenses.” |
| 1:57–2:00 | Project name, real GitHub URL | “Pankeki — open source.” |

The optional Codex/Claude chat is **not completely local**; avoid earlier script wording claiming “Everything runs on this Mac.” Don't show a motion, GPU inference, or Windows demo if the actual candidate wasn't demonstrated. The original 2026-10-28 script is preserved at the link above.

## Public social post — proposed text, NOT PUBLISHED

> Introducing **Pankeki** — an open-source character studio built around local ComfyUI. Generate and compare characters, use masks for targeted editing, recolor, save projects, and experiment with 2D motion. Code (MIT): https://github.com/pullyo/pankeki — current macOS candidate is linked at the top of the README. Watch the real 2-minute demo: **[INSERT VERIFIED PUBLIC DEMO URL]** #OpenSourceHiggsfield

The author must approve the content, replace the placeholder with the real accessible video URL, publish from an account they control, and copy the **direct public post URL** into the Typeform.

## Release and submission checklist

- [x] Official deadline/categories verified from the Comfy site.
- [x] Repo and MIT LICENSE publicly accessible.
- [x] Pinned macOS candidate source/PR identified; Windows experiment kept separate.
- [x] Original 2-minute script reused; draft English form answers prepared.
- [ ] Review and merge the README routing PR; do not merge PR #1 wholesale without private-path/content review.
- [ ] Locally launch the intended macOS commit and visually validate each screen/feature in the final footage; record truthful runtime outcome and duration.
- [ ] Capture/export a **real 2:00-or-less** video; upload it and check it from an incognito/logged-out browser.
- [ ] Post an approved `#OpenSourceHiggsfield` message including demo link; check the direct public permalink logged out.
- [ ] Submit owner-only personal fields/category/agreements in Typeform and confirm all required fields.
- [ ] Click final Submit **only after user authorization**; retain the actual completion page or confirmation email. **No submission is confirmed as of preparing this document.**

No external video upload, social post, Typeform submission, hardware test or GPU run was executed in preparing this review sheet.

# Pankeki desktop design system

## Scope and visual authority

This pass improves the existing image-generation workspace for desktop use. Preserve the selected pancake logo, every sidebar item, actual SDXL generation, saved candidates, reference upload, masked editing, motion, and export. Existing cream/brown/orange identity and the incumbent home screen are visual authority. No new backend, document format, model behavior, or third-party frontend dependency.

Surface mode: **Operate**. Center the task: prompt → real generated image → continue editing. Use a single conversation column and a bottom composer. Keep settings behind the existing settings dialog; no persistent right panel. Image history reflects actual saved candidates, including truthful upload labels. Never invent assistant prose, requests, projects, timestamps, or model success.

## Analysis and design evidence

UI UX Pro Max was installed from `nextlevelbuilder/ui-ux-pro-max-skill`, revision `623a9a9037d006ea727f8213f084d02a6b6f11b5`. Searches for `image generation desktop workspace` and the narrower `creative desktop productivity tool` returned minimal/flat product guidance, but marketing page compositions. Those compositions and automatic purple/teal palette/font suggestions do not fit the fixed product identity and Korean desktop workspace, so they are not persisted as canonical recommendations. Applicable database matches for `keyboard focus modal` and `error feedback generation` inform focus, unobscured controls, clear inline errors and announcements.

Impeccable 4.7.0 from `pbakaus/impeccable`, revision `8644175285360c166e57b1e35ecadfbc85ff5209`, supplies Operate-mode restraint, the craft floor, rendered-screen critique, and final polish. The context loader ran once against `web/src/redesign.js`; scoped improvement proceeds from existing code and screenshots without a greenfield identity exercise.

## Color tokens

| Token | Value | Role |
| --- | --- | --- |
| `--pc-background` | `#f3f0ea` | Outer frame |
| `--pc-surface` | `#fcfaf7` | Working surface |
| `--pc-sidebar` | `#f7f4ee` | Quiet navigation |
| `--pc-paper` | `#ffffff` | Composer and image-view dialog |
| `--pc-ink` | `#30271f` | Main text |
| `--pc-muted` | `#756b60` | Secondary text |
| `--pc-line` | `#e3dcd2` | Separators and control borders |
| `--pc-selected` | `#f9e9de` | Selected controls |
| `--pc-action` | `#b34422` | Primary action and focus |
| `--pc-action-hover` | `#9d3b1c` | Primary hover |
| `--pc-error` | `#a73227` | Visible error state |

Measure text/placeholder contrast against actual surfaces; target 4.5:1 for normal text. Use the accent on selection, focus, and the primary action. The logo asset is unchanged.

## Typography and spacing

- Retain bundled Pretendard. Existing handwritten logo lettering stays confined to the brand.
- Fixed desktop scale: 12px metadata, 13px compact labels, 14px navigation/actions, 15px prompt/message text, 20px page title, 24px empty-state title. Text line-height 1.5–1.6. Wrap real user text with `overflow-wrap:anywhere`; no prose-breaking forced line breaks.
- Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 / 48px. Tight related controls, larger gaps between turns.
- Desktop sidebar around 216px, header 64px, conversation maximum 960px. Readable prompt measure around 72ch. Image gets the main visual weight; large style thumbnails become compact choices.
- Message/image/composer radius 12–16px; pills only for small controls. Border or shadow per surface, no decorative glow/gradient.

## Component and interaction rules

- One dominant send action. Native buttons, anchors, dialogs, and the original prompt/input IDs and handlers remain in use.
- The visible `pcPrompt` contains only the editable description and forwards input through the original hidden `prompt` field. For generation, the selected style and enabled character brief still compose the request. For masked editing, submit only the entered edit instruction; preserve the stored style and brief metadata for later generation. Editing uses the label `수정할 내용` and hides generation style choices. Restore strips only the known, separately appended style suffix from the visible description.
- Visible composer label; attach/model/resolution/options controls beneath the prompt. Enter submits, Shift+Enter adds a line; composition input remains safe.
- Real saved turns show user prompt and actual image. Uploads are labeled as references. View/edit/save actions stay next to the image.
- Loading reflects the actual job; cancel remains available. Errors remain after generation stops and wrap near the composer. Empty state is short and useful.
- Focus is visible and unobscured. Icon-only buttons have accessible labels. Dialog supports Escape and focus restoration. Reduced motion disables optional transitions.
- Model and resolution summaries focus the original model/width field. Keep technical inputs inside a collapsed native details group. Settings use a named native dialog with keyboard-operated ARIA tabs.
- Fit the latest image against the measured conversation height, leaving room for author and image actions. Follow new results when at the bottom; retain manual scrolling through older work.
- Primary desktop checks: 1440×900, 1920×1080, 1280×800. Check narrower layouts for overflow without adding mobile product features.

## Change boundary and proof

Product changes are confined to `web/src/redesign.js` and `web/src/redesign.css`, plus generated `web/index.html` and design/verification documents. Record hashes of existing core files before/after. Run the existing relevant JavaScript suites and verify actual browser interaction, not only build output. Save before, first implementation, critique, correction, and final screenshots under `runtime/macos/pc-chat-ui/`. Separate verified results from residual gaps in the report.

Final evidence: `runtime/macos/pc-chat-ui/review.md` and `verification.json`. The initial independent review scored 26/40; its five priority issues were corrected and checked again. This is not a new final score. Current sampled text pairs pass 4.5:1, including selected action text at 4.709:1.

2026-10-23 partial-edit follow-up: the bounded request fix also changes `web/src/profiles.js` and its regression tests. The actual browser run `ef48762b02b2449eb486138a3d46234e` confirms that the entered edit instruction alone reached the recipe and workflow, with the original source/mask hashes retained. Generation mode restores its label and style controls. The full JavaScript run has 153 cases: 151 pass, one skip, one TODO, zero failures. Evidence is under `runtime/macos/inpaint-quality/integration/`; independent server-pixel and request checks are under `runtime/macos/inpaint-quality/qa/`. This verifies request behavior and preservation, not better image quality. Dedicated-model trials remain isolated until reviewed.

2026-10-23 precise-color follow-up: the user authorized a color-only operation within the existing masked-edit workspace. `AI 부분 수정` retains generative editing; `색상 변경` uses target HEX/swatch, automatic or explicit source color, and a compact range control. It bypasses prompt/model requirements and creates one honest local-color candidate. A no-op is `변경 없음`, including persisted string reasons. Keep generation styles hidden in edit/comparison views while preserving their generation state. No permanent side panel, new menu, logo change, or document version. Native PNG download uses the existing Blob helper without re-encoding image bytes. Final proof and limits: `docs/team-macos-20261022/recolor/integration-review.md`, `runtime/macos/recolor-quality/integration/`. The real 1024px red-scarf UI result preserves the original folds/fringe coordinates and outside-mask RGB/alpha. Black/white tone limits and automatic color-selection ambiguity remain explicit. Explicit source colors missed by the representative sample still receive full-resolution selection; a one-pixel request was verified through the final server. Final suite: JS 177 cases (175 pass, one skip, one TODO), Python 147 (127 pass, 20 Windows skips), zero failures.

## 2026-10-23 desktop unification: U1–U8

This scoped follow-up also owns `web/src/character-motion.js` and `web/src/index.template.html`. It supersedes the earlier two-source-file change boundary for this sprint only. Preserve the existing logo bytes, eleven sidebar labels/order, document formats, generation/edit requests, and document/render/export engines.

- Keep all eleven navigation entries at the same coordinates across routes; comparison activates Design. Settings completes configuration and closes the dialog. Generation, inpainting, and recolor run only from the workspace action.
- Apply the existing PC color/type/spacing tokens to legacy home, output, editor, and settings controls. Resolve actual computed foreground/background contrast, including active tabs and availability labels, instead of relying on the declared token alone.
- Use one chat-style generation column. Comparison replaces the composer with two complete images at the same scale and fits the available height; preserve the original form and its values for return to editing.
- In an actual-project home hero, place information/actions and the complete image in separate columns. Keep the project menu next to its title. Static recommendations stay in their named template area; they must not appear to be actual saved candidates.
- Show image PNG, character board, and project-file output first. Fit the complete preview within available height. Place motion output in native details below; open it when a rig is ready and keep real progress/cancel reachable.
- Use compact editor panels: 220px left / 240px right at 1280–1440, 240px / 280px at 1920. At 1280 retain a 516px center column (492px after horizontal padding). Unprepared editors use two columns and collapsed inactive details. Prepared editors expose their original controls. Allow one scroll container per branch; sibling panels may scroll independently.
- A source selector shows a real candidate or an explicit placeholder. Empty/stale IDs cannot prepare; selecting a different option alone does not replace the source. Explicit preparation uses the selected candidate and honors busy/availability state.

Final evidence: `runtime/macos/ui-unification-20261023/integration-review.md`, `verification.json`, and the frozen QA criteria/reader. The final 48 screenshots cover 1280×800, 1440×900, and 1920×1080, seven routes, unprepared/prepared rigs, and settings. UX independently reviewed every final image. The fixed reader passed 2,159 checks with no failure/pending; 1,558 sampled enabled normal-text pairs meet 4.5:1. Actual native project/PNG, v1 import preservation, part undo, motion playback, 48-frame ZIP, and local recolor were exercised. This is scoped desktop UI acceptance, not mobile, 200% zoom, screen-reader, all hover/focus states, general RGBA, or a new SDXL inference/quality certification.

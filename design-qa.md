# Current desktop conversation UI verification

The current pass uses UI UX Pro Max and Impeccable and supersedes the image-generation layout assessed below. See [the current review](runtime/macos/pc-chat-ui/review.md), [verification data](runtime/macos/pc-chat-ui/verification.json), and [design standards](DESIGN.md).

Verified current scope: warm identity/logo and all sidebar items retained; real candidate history in a single conversation column; compact bottom composer; original generation and masked-edit entry points retained. Desktop screenshots cover 1440×900, 1920×1080 and 1280×800. Actual SDXL generation from the final composer succeeded at 1024×1024 in 26.25 seconds. JavaScript: 144 cases, 142 passed, 1 skipped, 1 TODO, 0 failures. Core-file hashes are unchanged for the 35 tracked non-presentation files.

Limits: native download arrival and actual VoiceOver speech were not verified. The static detector's 86 findings cover embedded legacy/other-view markup and are not a clean bill of health or 86 verified current chat defects. Independent initial critique and final screenshot review are separated from root's final live interaction checks in the current report.

---

# Earlier reference design QA (archived evidence)

final result: passed

## Visual truth and normalization

- Source home: `runtime/macos/ui-redesign/reference-home.png`; source generation: `reference-generation.png` in the same directory. Both are user-supplied 1672 × 941 images.
- Rendered app: `http://127.0.0.1:8190`, in-app browser, CSS viewport/capture 1672 × 917 at 1 capture pixel per CSS pixel. Also checked 1280 × 800 and 390 × 844.
- Source crop `(12,32,1660,925)` and app crop `(12,12,1660,905)` yield the same 1648 × 893 app-content area. Mock macOS caption and outer gutters are excluded. Full-page browser captures are used because viewport-only capture clips horizontally in this environment.
- Home final capture: `runtime/macos/ui-redesign/home-final.png`. The current project is a real SDXL-generated bedroom rather than the source's example character.
- Empty generation capture: `runtime/macos/ui-redesign/generation-v2.png`, captured after correcting missing illustration. Later changes preserve its desktop appearance and address errors, restoration, and home layout.
- Actual result: `generation-final.png` and original `generation-result-v2.png`; responsive states: `mobile-home-final.png`, `mobile-edit-v3.png`, `mobile-error-final.png`, `laptop-generation-final.png` in the same folder.

## Combined comparison evidence

The source and browser rendering were combined into each image and inspected together.

- Full views: `comparison-home-full-final.png`, `comparison-generation-full-final.png`.
- Readable focused regions: `comparison-home-hero-detail-final.png`, `comparison-home-feature-detail-final.png`, `comparison-generation-typography-final.png`.
- Additional category/composer evidence: `comparison-generation-controls-final.png`.

All these files are in `runtime/macos/ui-redesign/`.

## Findings and iteration history

No actionable P0/P1/P2 findings remain for the requested home and generation redesign.

| Earlier finding | Fix | Post-fix evidence |
| --- | --- | --- |
| P1: illustration absent; wrong `emptyState` target | Mount real artwork in existing `empty` node | Empty generation capture and full comparison |
| P2: hero inherited small section-heading typography | Explicit title size and responsive scale | Focused home hero comparison |
| P2: old footer extended beyond frame | Hide legacy footer | Both full comparisons |
| P2: gallery obscured selected view/edit/compare | Close gallery on those actions, preserve compare selection | Browser interaction and `compare-final.png` |
| P2: icon-only mobile menus lost accessible names | Explicit sidebar/toolbar labels | Zero unnamed sidebar buttons at 390 px |
| P2: mobile current-project picture overlapped metadata | Place actual picture below metadata and actions | `mobile-home-final.png` |
| P1: generation errors disappeared when idle | Observe original status mutations, retain error alert and mobile wrapping | Invalid-width validation; `mobile-error-final.png` |
| P2: category restore changed persisted brief setting | Restore visual category without user-action side effects | Reload retained background + useBrief=true + project name + 1024 width |
| P2: feature cards partly below fold | Adjust desktop section rhythm/card density | Buttons end y=891.75, section y=903.75, within home ending y=905 |

## Required fidelity surfaces

- **Fonts and typography:** bundled Pretendard supplies Korean UI text. Title/section/body weights, sizes and wrapping inspected in native-size crops. The existing pancake mark is retained with a brown handwritten system-font wordmark. Exact lettering differs from the reference; no accidental Korean fallback or broken wrapping observed.
- **Spacing and layout:** sidebar, cream main surface, hero, quick-start/template column, recent work, feature cards, large generation illustration, seven style cards and rounded composer preserve the reference hierarchy. All four desktop feature actions are visible. Narrow layout keeps a scrollable sidebar/style strip and visible composer, without document-level horizontal overflow.
- **Colors and tokens:** warm cream/white surfaces, brown ink, peach borders, orange selection/action/focus states. Dark red error text remains readable. Minor tonal differences do not change hierarchy.
- **Image quality and asset fidelity:** real generated PNG artwork matches the reference subjects and warm anime/illustration direction. Transparent pancake-cat art has no rectangular background or visible halo; WebP display encodings remain sharp. Licensed Lucide supplies icons. The user's existing selected pancake logo is retained. New artwork does not reproduce the exact source characters. Feature tiles use library icons rather than miniature drawings; closer illustrations remain P3 polish.
- **Copy and content:** Korean actions/categories follow the selected screens. Project, canvas dimensions, candidate count, and storage are real. No invented saved projects, paths, dates, disk capacity, or installation success is displayed. Templates fill actual prompts. A consistent sidebar order is used across both pages rather than reproducing the references' differing order.

## Interaction and regression evidence

- Actual new-composer SDXL Base job `b772ff8b133f41b499b3620520ba109f`: succeeded, 1024 × 1024, 25 steps, 45.75 s, denoiser executed, 25 previews accepted, result displayed.
- Checked model/options dialog, file chooser and actual decoded reference PNG, gallery view/edit, two-candidate comparison, recommended templates without candidate reset, home search/favorite, automatic candidate restore, and explicit saved brief/category retention.
- Invalid width validation stays visible after failure: role alert, 18 px desktop / 36 px mobile feedback height. No model job was needed for this check.
- Existing motion page opens; example play advances the real timeline and stop works.
- Console after final reload: no errors or warnings.
- JS: 142 total, 140 passed, 1 skipped, 1 TODO, zero failed. `runtime/macos/ui-redesign/javascript-tests.log`.
- Python: 114 total, 94 passed, 20 Windows-only skips, zero failed in `.venv-macos`. Backend/inference logic was not changed by this redesign.
- Focused independent read-only code review found the feedback and restore issues above; fixes were re-reviewed with no remaining Important findings.
- Residual automation gap: the native download bridge timed out on the preserved data-URL PNG link. The rendered link matches the displayed decoded 1024px result and has a valid download filename. File arrival through this bridge is not verified; no claim of successful download testing is made.

## Follow-up polish (P3)

- Optional closer crops/illustration variants for character thumbnails and feature tiles.
- Exact handwritten wordmark shapes and small sidebar spacing details differ slightly from the reference.

## Implementation checklist

- [x] Both requested pages integrated into the existing app.
- [x] Full and focused source/render comparisons inspected together.
- [x] Earlier P0/P1/P2 findings fixed and relevant states recaptured.
- [x] Real generation, settings, gallery, edit transition, responsive layout and restore checked.
- [x] Build and relevant regression suites pass; original HTML and verification evidence retained.
- [x] No blocking design findings; residual download-automation gap recorded.

---
name: Pankeki
description: Existing Pankeki warm-charcoal desktop interface
colors:
  pc-background: "#171615"
  pc-surface: "#1e1c1a"
  pc-sidebar: "#191817"
  pc-paper: "#26231f"
  pc-ink: "#f5f0e9"
  pc-muted: "#b9b0a6"
  pc-line: "#51473e"
  pc-control-line: "#81715f"
  pc-selected: "#3b2b20"
  pc-action: "#e5753e"
  pc-action-hover: "#f18b4c"
  pc-on-action: "#21150f"
  pc-error: "#f0a08f"
  pc-error-bg: "#3a2421"
  pc-warning: "#ecc18a"
  pc-warning-bg: "#392c1c"
  pc-success: "#a4cf95"
  pc-success-bg: "#253422"
  pc-disabled: "#a3978a"
  pc-disabled-bg: "#302b26"
typography:
  home-title:
    fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "27px"
    fontWeight: 750
    lineHeight: 1.4
    letterSpacing: "-.035em"
  page-title:
    fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    letterSpacing: "-.4px"
  message:
    fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "15px"
    lineHeight: 1.6
  home-input:
    fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "14px"
    lineHeight: 1.6
  metadata:
    fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "12px"
    lineHeight: 1.5
rounded:
  badge: "5px"
  field: "6px"
  compact: "8px"
  thumbnail: "9px"
  navigation: "10px"
  container: "12px"
  home-composer: "36px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.pc-action}"
    textColor: "{colors.pc-on-action}"
    rounded: "{rounded.compact}"
    padding: "9px 14px"
  button-primary-hover:
    backgroundColor: "{colors.pc-action-hover}"
    textColor: "{colors.pc-on-action}"
  button-primary-disabled:
    backgroundColor: "{colors.pc-disabled-bg}"
    textColor: "{colors.pc-disabled}"
  navigation-item:
    backgroundColor: "transparent"
    textColor: "{colors.pc-ink}"
    rounded: "{rounded.navigation}"
    padding: "10px 12px"
  navigation-item-selected:
    backgroundColor: "{colors.pc-selected}"
    textColor: "{colors.pc-ink}"
  input-recolor:
    backgroundColor: "{colors.pc-paper}"
    textColor: "{colors.pc-ink}"
    rounded: "{rounded.field}"
    padding: "4px 6px"
    height: "32px"
    width: "88px"
  composer-home:
    backgroundColor: "#26231feb"
    textColor: "{colors.pc-ink}"
    typography: "{typography.home-input}"
    rounded: "{rounded.home-composer}"
    padding: "8px 10px"
  template-card:
    backgroundColor: "{colors.pc-paper}"
    textColor: "{colors.pc-ink}"
    rounded: "{rounded.container}"
    padding: "0"
  availability-tag:
    backgroundColor: "{colors.pc-selected}"
    rounded: "{rounded.badge}"
    padding: "5px 8px"
---

# Design System: Pankeki

## Overview

**Creative North Star: "The user's warm-charcoal Pankeki reference"**

The user's 2026-10-30 pinned reference supersedes the earlier cream theme and expanded Home layouts. The implemented world uses warm charcoal, subdued amber window light and the existing room artwork. It carries the approved logo and existing pancake/cat art into a compact welcome while keeping working surfaces restrained and readable. This documents the accepted reference and implemented system; it introduces no new aesthetic direction.

The theme anchor is `body.pankeki-pc[data-theme="dark"]`. `web/src/dark-theme.css` owns shared shell, Home, chat, projects, gallery, templates, notifications and profile. `web/src/dark-editors.css` owns editor, parts, motion, video, output, settings, style and ppe UI. `web/build.py` loads both after existing CSS, in that order. Original canvas/media code remains authoritative. Product behavior and preservation boundaries are recorded in `PRODUCT.md`.

**Key Characteristics:**

- Warm charcoal UI with amber actions, visible focus and readable state colors.
- Existing brand assets and media preserved; decorative room treatment stays behind the UI.
- Compact centered Home, persistent working controls and component-owned scrolling.

### Evidence and acceptance

Evidence root: `output/finalization-20261030/dark-redesign-20261030/`. `implementation/final-freeze.json` identifies source `48f9d7e99b610e390c915b359f8a603de1796fafe62885b813143a00ae8d5f23`, HTML `801789df34d918cbc31d8071fe5d1cf2dd4f2cf446b5df7a95e303f1194894a9` and desktop fingerprint `428c6dcb4e54f679d9c7f924958dafe78ca16d2af7be73a874940360a5d09a5c`. Its immutable `implementation/correction-5-review-snapshot/` preserves the pre-documentation files. This refresh changes the three design/product documents, not those frontend inputs.

`review/dark-finish-review-48f9.ko.md` records **ship, material findings 0** within the supplied browser fixture UI. That reviewer directly opened all 33 PNGs in `qa/final-render-index.json` and matched the 13 freeze hashes. The index preserves each capture's source and equivalence lineage: 54ffc (18), 26e466 (9), 6647 (4), 48f9 (2). These are not 33 newly captured final-build/native screens. The review covers the reference size (1672×941) and Home at 1280×800, 1360×888, 1440×900 and 1920×1080, plus representative projects, gallery, templates, generation/compare, editing, parts, unready motion/video, output preview, settings, notifications and profile.

**Native UI acceptance: scoped pass (2026-10-30).** The [root's direct observation](output/finalization-20261030/dark-redesign-20261030/review/native-manager-observation.ko.md) records the exact installed `/Users/plant313/Applications/Pankeki.app` selected through Computer Use and its 2720×1840 Home screenshot inspected: dark room, existing logo, ten menus, actual recent four, single pill composer, blank input/disabled send, notification/profile and storage presentation all fit without scrolling. Root performed no GUI actions. QA's separate [native observation](output/finalization-20261030/dark-redesign-20261030/qa/native-observation.json) and [final report](output/finalization-20261030/dark-redesign-20261030/qa/QA-report.ko.md) record settings/focus return, one listed project with 14 candidates, the current ordinary document's empty gallery, nine templates, model settings and representative empty/preparation image/parts/motion/video/output screens, then return to Home. These dated counts describe that observation rather than a fixed catalog or model default. Root did not repeat every QA route, and this documenter read the reports without manipulating UI. Native captures were inline only; no supported local screenshot path was provided.

The [release record](output/finalization-20261030/dark-redesign-20261030/release/FINAL-RELEASE.json) records actual ASAR 17-file equality, strict codesign, DMG verification, normal quit/launch, bundle backup and atomic application. It identifies an ad-hoc signed, non-notarized package; bundle backup does not prove rollback of the external checkout. The [final preservation check](output/finalization-20261030/dark-redesign-20261030/qa/final-preservation.json) records source/HTML/process and desktop match, 24 image-job rows, three video journals, checked protected code/icon/font and owned-media SHA equality, and the same profile/partition directory identities. Profile contents were not read/copied/reset. The [cleanup record](output/finalization-20261030/dark-redesign-20261030/qa/cleanup.json) records the owned QA server/tabs closed, production app/services left running and final Comfy running/pending queues zero.

Loaded-image overlay/compare remains browser fixture evidence because the current native ordinary document had no selected source. Provider/local inference, new saves/imports/project switching, ready/playing motion and media quality were not tested; task inference count is zero. A hidden preview-tag color sample is not a visible loading/error pass; invalid HEX was not reached. The recorded 116/116 related tests include the initial five and do not establish GPU inference or quality. Earlier light theme, eleven-menu and expanded-template Home records remain historical evidence rather than current design authority.

## Colors

The normative frontmatter maps one-to-one to the twenty `--pc-*` color declarations in `dark-theme.css` (remove the CSS `--` prefix for the frontmatter key). Existing accent/focus/ink/muted/line/surface/selected and pk aliases resolve to these values. No synthetic ramp or new color is introduced.

### Primary

- **Amber action** (`pc-action`): primary actions, focus and restrained highlights; `pc-action-hover` supplies hover.
- **Dark on-action** (`pc-on-action`): labeled text/icons over the bright action surface.

### Neutral

- **Outer charcoal** (`pc-background`), **working charcoal** (`pc-surface`), **navigation charcoal** (`pc-sidebar`) and **raised paper** (`pc-paper`) separate the shell, work area and controls by tone.
- **Warm ink** (`pc-ink`) and **muted warm text** (`pc-muted`) distinguish primary text from help, metadata and placeholders.
- **Quiet separator** (`pc-line`) is decorative; **control boundary** (`pc-control-line`) identifies interactive fields and necessary controls.
- **Selected brown** (`pc-selected`) marks selection. Error, warning, success and disabled pairs retain their semantic roles without implying that an operation succeeded.

**The On-Action Rule.** Use dark on-action text/icons for amber primary controls. Do not inherit a white label from the earlier light theme.

Normal text and placeholders target at least 4.5:1; large text and necessary control/focus graphics target at least 3:1. Static token pairs are ink/background (15.94:1), muted/paper (7.32:1), on-action/action (5.89:1). These calculations do not replace rendered measurement against real ancestor surfaces or the room. The independent review reports no active text samples below 4.5:1 in the supplied contrast JSON. The corrected opaque image-overlay buttons measured text (13.80:1) and boundary (3.32:1), recorded in `qa/final-26e466-overlay-contrast-1280.json`.

## Typography

Retain the bundled Pretendard with its existing platform fallbacks. The original brand lettering is preserved as an incumbent identity detail, not a new display family for application headings.

The frontmatter records observed roles: Home title, page title, message, Home input and metadata. Home title is reduced to 25px in the existing desktop short-height query (minimum width 960px and maximum height 850px). Controls retain their actual per-component type, including 14px navigation and 13px compact primary buttons. Meaningful help/metadata uses a 12px minimum. The QA font evidence is `qa/final-26e466-font-proof.json`; the review reports the existing font loaded rather than substituting a new face.

**The Existing Type Rule.** Preserve Korean text, IME and the established type hierarchy; do not turn brand lettering into a general UI font or shrink meaningful metadata to fit a layout.

## Layout

The desktop shell uses a full-height work area (`100dvh`) with a 208px sidebar and a flexible work column. At widths up to 800px the dark override uses a 64px icon rail. Existing narrower component rules still apply; the desktop review does not establish mobile acceptance.

Home-specific composition: center the actual content at a 760px maximum width with the existing small transparent pancake/cat illustration, recent four thumbnails, and original pill composer. Keep real notification/profile actions upper right. Home search remains reachable through Projects and command-K. This is a Home layout, not a template for editor pages. The approved opaque cream logo tile remains a small warm badge with unchanged image bytes.

Default Home padding is 76px 32px 42px and the main vertical gap is 24px. The short-height desktop query reduces padding to 66px 28px 24px and gap to 20px; the art also reduces in size. The implementation uses an existing 4/8/12/16/24/32 spacing rhythm rather than a new scale. Ordinary Home content fits the five reviewed desktop sizes; exceptional content and dialogs must scroll instead of clipping.

The settings disclosure stays within 12px viewport margins and scrolls internally. In the existing split editor at widths from 1025px, the header uses a two-row grid and bounded horizontal actions. The 6647 captures show all four initial project actions at 1280/1360 widths, retaining title/aria names and fullwidth labels. For the unready motion preview at widths from 801px, the guidance overlay is centered in the existing size-container card with internal scrolling; this does not change source-canvas geometry or make motion ready.

## Elevation & Depth

Depth comes mainly from tonal layering and limited soft shadows. The Home composer uses a low shadow; settings/profile popovers and modal libraries use stronger diffuse shadows. Shared toolbar buttons and editor frames remain flat. Exact shadow values and the existing 0.15s control transitions are in the sidecar. The reduced-motion query removes animation/transitions and restores automatic scrolling; the supplied reduced-motion sample reports 0s animation/transition.

The existing room is darkened only on decorative pseudo-layers. Its brightness/saturation/blur treatment must not be copied onto images, canvases, masks or videos. Transparent-image checkerboards describe transparency through the surrounding frame and preserve the underlying media.

**The Original Media Rule.** A dark frame may change CSS around media, including contain-padding backgrounds, but must preserve image/video bytes, mask pixels, fit/zoom, canvas geometry, transparency meaning and export/download handlers.

## Shapes

The shell and sidebar meet at square edges. Navigation has gentle corners, library cards and contained controls retain their existing rounded shapes, and the Home composer has a pill silhouette. Use the frontmatter's observed radii for their named roles rather than applying one global radius. Existing circular header/send actions keep their actual sizes. Borders are 1px where present; keyboard focus uses a 2px amber outline, normally offset 3px, with bounded control-specific exceptions.

## Components

### Buttons

Compact primary buttons retain their existing padding and radius from the frontmatter and a minimum height of 40px. Home send is a separate circular 44×44 control. Primary hover changes to action-hover; disabled controls retain disabled text/background at full opacity. State styling must not enable an unavailable control. The sidecar records primary, hover, disabled and focus snippets from the existing code.

### Chips

Availability tags retain their existing small rounded form and selected surface. In editor/readiness contexts their text may use muted rather than ink; preserve that context-specific override. A styled availability tag does not certify readiness.

### Cards / Containers

Template/library cards retain the existing container radius, zero outer padding, clipped contents and a decorative separator border. Hover uses selected tone and amber border. Dialogs keep internal scrolling. Current project selection and image comparison retain their actual state controls; templates remain presets rather than fabricated saved images.

### Inputs / Fields

Fields use paper, ink, muted placeholders and identifiable control boundaries. Recolor's compact text field retains its observed dimensions from the frontmatter. Error styling uses the error pair and the existing invalid state; the browser QA did not reach invalid HEX. Do not recolor native color-swatches or alter field values.

### Navigation

The ten existing actions retain labels, handlers and order. Default navigation is transparent with ink text, hover uses paper, and selected navigation uses selected tone plus an amber border. Do not restore a separate Design item. Keep keyboard focus visible and preserve the native OS dialogs outside web styling.

### Canonical composer

Keep the original textarea/form and selection across route changes. Home uses the same composer with plus, settings sliders, input, sparkle and send actions. The bounded growing textarea retains the 4000-character limit, IME and Shift+Enter. The settings disclosure closes without stealing outside/Tab focus; Escape returns to its visible trigger. Busy/progress/cancel/error feedback stays reachable outside the disclosure. Preserve the existing task-boundary submit and guards; the design layer does not add a new controller or automatic retries.

## Do's and Don'ts

### Do:

- **Do** use the source-defined warm-charcoal tokens and dark on-action labels across the existing application UI.
- **Do** preserve the approved logo, existing art, all ten navigation actions and the canonical Korean-IME composer.
- **Do** keep readable help, identifiable control boundaries, visible keyboard focus and truthful selected/disabled/error/readiness states.
- **Do** preserve media pixels and component scrolling, and honor reduced-motion preferences.
- **Do** retain capture lineage and separate browser visual review, scoped native UI acceptance, inference and media-quality evidence.

### Don't:

- **Don't** apply whole-app inversion, neon/glow decoration or filters/opacity/blending to working media.
- **Don't** create saved gallery results, online account claims or completed operations from presentation-only state.
- **Don't** replace the original composer, handlers, guarded transitions, document formats, model settings or existing stored data for styling.
- **Don't** expand browser fixture ship or scoped native UI acceptance into provider/save/inference, loaded native compare or ready-motion acceptance.

No additional defect or stylistic exception is canonized by this documentation pass. Reported visual material findings are zero within the independent review's scope; untested runtime operations remain unverified rather than design rules.

# Native v3 authoring workspace

Task9 adds explicit native authoring without changing the v2 schema, renderer, exporter, assets, or Cubism workspace. The existing app mode selector offers 기본 제작 / 정밀 리깅 / Cubism. 정밀 리깅으로 복사 snapshots the current v2 workspace and explicitly upgrades that copy. 리깅 작업 열기 accepts v3 documents. It never upgrades or overwrites v2 storage automatically.

## Integration contract

`PankekiAuthoringV3.mount(document, {editor, renderer, exporter, onError, onChange})` returns a controller. `editor` is a `PankekiDocumentV3.createEditorV3()` instance or null; `renderer` and `exporter` are the `PankekiRendererV3` and `PankekiExportV3` namespaces. There is no import-time mount. `editor.snapshot()` is synchronous; mutations and workspace persistence are Promise based.

The controller exposes `ready`, `show(screen)`, `suspend()`, `destroy()`, `loadDocument(raw, options)`, `snapshotProject()`, `saveProject()`, `getSummary()`, `dispatchBatch()`, `previewParameters()`, `commitParameters()`, `undo()`, `redo()`, `savePreset()`, `applyPreset()`, `saveMotion()`, `play()`, `pause()`, `seek()`, `exportPosePng()`, `exportFrames()`, `cancelExport()`, and `cancelLoad()`. Optional test/browser adapters are `decodeAsset`, `canvasFactory`, `clock`, and `download`. `onChange` reports committed document changes, not every animation frame. `snapshotProject()` resolves serialized v3 JSON only after committing valid drafts; it rejects invalid drafts or a concurrently changed document/input. Failed evaluation leaves the previous frame visible.

App instance: `PankekiAuthoringV3Controller`. Persistence uses IndexedDB `pankeki-authoring-v3`, store `projects`, key `current`. It is isolated from `pankeki-motion-studio-v2` and the existing Cubism database. Top save, project snapshot and autosave route by active authoring mode. Saved v3 content is restored only on explicit v3 entry. Mode leave, document visibility and destroy stop playback and abort pending export; generation checks suppress late load/save/export results.

## Authoring controls

The central canvas uses the document aspect ratio and available preview height; a compact inspector has native collapsible sections. Parameter definitions expose ID, label, min/max/default/unit, and values have range plus string numeric inputs. Text such as `0.` remains editable; Enter/blur commits, Escape cancels, and slider gestures form one undo entry. Invalid numeric drafts block save/snapshot/autosave/PNG/ZIP. Same-preset application restores displayed values even when the canonical document does not change.

A prepared part has axis or two-parameter grid bindings. Select a key/cell and vertex, then edit delta X/Y. Neutral is locked. The grid uses each parameter's min/default/max; if the default equals an endpoint the duplicate is removed. Any v3 binding replaces that part's legacy deformation; removing the last binding resumes legacy behavior. Keep a zero-delta binding to suppress legacy deformation intentionally.

Clip forms choose source, target and inversion. Warp forms create/edit a 2–8 point grid per axis, rectangle, parent, point deltas, and explicit mappings for every part including hidden mask sources. Changing dimensions of an existing grid requires creating a new grid. Parameter ID renaming similarly uses a new definition. Structural validation rejects incompatible dependent data rather than silently rewriting it.

Presets capture all current values and the current rig hash. Motions have named 2-second/24-fps loops, per-parameter key rows, and identical endpoint values enforced by the engine. New motions initialize every parameter with constant endpoints; edit each curve and save before changing its parameter selector. Geometry/configuration changes retain old preset/motion hashes and mark those items unavailable until explicitly authored again. No automatic hash approval occurs.

## Export contract

`PankekiExportV3.exportPosePng({document, values, decodedAssets, signal, canvasFactory})` and `exportFrames({document, motion, decodedAssets, signal, canvasFactory, onProgress})` use the same v3 evaluator/renderer as preview. `document` must be branded/frozen; `decodedAssets` is a Map keyed by asset ID. `motion` is the current document motion ID or its exact frozen member, never a foreign mutable object. A canvas factory returns a fresh Canvas2D canvas with `convertToBlob()` or `toBlob()`.

The transparent PNG ZIP has 48 frames indexed 0–47 at `i/24`, plus a manifest with rig hash, motion ID, complete parameter definitions and complete evaluated frame values. Abort, stale motion, invalid PNG and byte-budget errors reject output. Canvas ownership is local; borrowed decoded images remain usable. Legacy export code and schema remain unchanged.

## Evidence and boundaries

See `output/live2d-application-20261024/reports/task-9-report.md`. Source/DOM mocks and real CPU Canvas2D exports are separate evidence. Independent Safari interaction/visual acceptance belongs to the assigned QA employee and is not established by CPU tests. No real SDK, GPU inference, newly invented artwork, hidden facial surfaces, or production v2 rig alteration is part of this task.

## Final integration fix round 1

Form groups now keep draft identity plus document generation/editor identity across asynchronous commits. Only the captured draft may be cleared or refill its controls. Newer valid/invalid input remains pending; a save/export that observed older input rejects. Cancelling during an already accepted command restores the fields from the committed state visible at cancellation and retains that restoration until the pending command settles and the next flush commits it. Different document loads invalidate the old completion. Point application batches its shape and current cell pose atomically, so autosave does not insert a later pose-only undo step.

Generic v2 import validates and snapshots active v3 drafts, stores that v3 snapshot in its own database when available, and switches native/v2 mode only after successful v2 loading. Failure/cancellation keeps the previous active mode. Browser page-cache suspension retains controllers and drafts, cancels output and stops playback; persisted pageshow resynchronizes the current route once without automatically starting animation. Full unload still destroys the controllers.

Known inherited parameter labels equal to eyeOpen/mouthOpen/breath display as 눈/입/호흡 and their inherited normalized unit displays as 비율. Custom label/unit and schema IDs are untouched. Unfocused numeric fields display six significant digits; focus exposes the exact runtime number. Display text is never committed unless the user actually edits it, preserving serialized precision. Numeric controls use a100px value column.

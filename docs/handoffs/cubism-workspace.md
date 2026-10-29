# Cubism workspace / Task 4 → Task 9 handoff

Task 4 source: package/session/capability UI + unavailable composition. Actual adapter/SDK/playback: not implemented, zero real-model runs. Read this together with `cubism-package-contract.md` and Task 2 fix1 report. Task 9 must snapshot shared app/studio/template/CSS/build/README/generated HTML again before changing them.

## Mount and availability

`PankekiCubismWorkspace.mount(document,{controller,readPackage,storage,onError,availability?,onModeChange?})` returns `show(screen),suspend(),destroy(),setMode('native'|'cubism'),refresh(),openFiles(files,{entryPath}?),loadPackage(),restoreSession(raw),snapshotProject(),saveProject(),ready,getSummary(),play()`.

`availability={ready:false}` is the default. This optional composition contract is an explicit permission to attempt a reviewed runtime; it is never inferred from file presence, packageRead or injected SDK-shaped data. The actual app pins `{ready:false,reason:'SDK_OR_USAGE_EVIDENCE_MISSING'}` and binds a factory which rejects `SDK_UNAVAILABLE`. It supplies the exact five-method clock (`now/request/cancel/setTimeout/clearTimeout`). No runtime file exists or was fabricated. Tests inject `ready:true` plus synthetic controllers/runtimes solely to test UI contracts.

When Task 3 clears its independent gate, its owner must replace the rejecting factory with a reviewed official facade using a **new detached canvas per call** and `createRuntime({canvas,sdk,signal})`, preserve the controller's provenance validation, and enable availability only after that integration is verified. Core/Framework/Shaders must load lazily at that future boundary. Current app requests SDK files zero times. Conditional build inclusion of an existing `cubism-runtime.js` is not runtime integration or approval.

## Lifecycle and DOM

`PankekiCubismWorkspaceController` is mounted once by app.js before studio.js. `motionNativePanel` wraps the old three native columns with display:contents; `cubismWorkspace` is a separate preview/inspector inside the existing motion route. Existing sidebar IDs and labels are unchanged. No Cubism mesh edit or native export wiring exists.

Studio's routing key is `screen + native/cubism`; it suspends only on actual routing changes. Studio.refresh also calls show, so repeated same-screen show is idempotent. Workspace.show does not reload/reset. Hidden or inactive screens pause; visible return resumes only a previously requested play without errors. Context loss/error clears that request; reload/restore is explicit. destroy aborts owned selection/load, removes listeners and disposes controller once. UI draws/RAF zero. Controller setters/reset own one synchronous update(0)/draw preview before snapshot/onState; this can cost synchronous work on the UI thread. GPU/physics rollback is not promised after failures.

`load(pkg,{signal})` alone gets a UI AbortController. There is no controller.cancel or restore-signal API. Restore has no cancellation button; new load/dispose follows controller termination contract. Canvas attaches only after successful controller load/restore and getCanvas; failed staging preserves the active DOM. Selected package and active package are separate so failed selection/load does not relabel old runtime controls with a new manifest. Parameter labels and imported names use textContent; actual min/max/default and declared resources gate controls.

## Storage and active mode

Storage injection: `{read():Promise<string|null>,write(serializedSession):Promise<void>}`. `ready` reads a validated reference session without auto restoring or starting a runtime. Reopen requires explicit selection and restore. Snapshot serializes only a non-null, controller-ready session through the Task 2 schema; package read alone cannot write.

App DB=`pankeki-cubism-studio-v1`, store=`sessions`, key=`current`; legacy `pankeki-character-studio/projects/current` and `pankeki-motion-studio-v2/projects/current` remain unchanged. `activeCubismWorkspace()` selects Cubism only while its mode is selected on the motion screen. Top save/snapshot route explicitly; image/native autosave callbacks skip while Cubism is active. Legacy exportProject retains its public v1 contract. Export route remains native/image output. Task 9 must extend this explicit routing for its own v3 mode/DB and draft commit guards without silently storing one format in another DB.

## Minimum runtime delivery manifest (future owner supplies real files)

Server accepts only `/vendor/cubism/live2dcubismcore.js`, `pankeki-cubism-framework.js`, `runtime-manifest.json`, and hash-registered `Shaders/` files ending `.frag/.vert/.glsl` with ASCII alphanumeric/underscore/hyphen path components. No other static route is added. Manifest is at most1MiB UTF-8 JSON with:

| Field | Minimum delivery contract |
| --- | --- |
| format / version | `pankeki-cubism-runtime` / integer1 |
| sdk.coreVersion | nonempty string from actual Core |
| sdk.coreHash / bundleHash | lowercase SHA256 matching the fixed Core/Framework entries |
| sdk.frameworkCommit | lowercase40hex actual Framework commit |
| files | object of <=256 allowed relative names to lowercase64hex SHA256; fixed Core+bundle required |

Task 3 may add source/version/notice/usage evidence fields; this technical delivery schema alone does not approve usage or official provenance. A real manifest is **not** created by Task 4. Missing/tampered pair, wrong schema/hash, unknown files, percent/relative traversal and symlinked vendor paths return404. Shaders are at most1MiB; JS32MiB. Responses retain Host/Origin guard, no-store and nosniff; JS=application/javascript, shaders=text/plain. Synthetic temporary server fixtures test the route only.

The existing8190 process was not restarted. Its served HTML reflects rebuilt disk bytes and was hash-verified; its new Python route activation is not proven. SDK/Core/manifest404 on that process is absence evidence only. Future owner must restart through the correct existing backend workflow only when needed, preserving its actual mode/config.

## Verification boundaries and next priorities

1. Current source tests/build/delivery fixture and preservation hashes: Task4 evidence. Real SDK, MOC/GL, latency/resource measurements and actual new session roundtrip remain gated.
2. Final UI polish source is newer than `unavailable-1280.jpg`; home/native screenshots reflect the intermediate13:10 build. Filechooser `setFiles` ignored a10s option and was interrupted after319.5s. Actual synthetic upload completion is unknown. Afterwards getAXState reported Browser2 unavailable, public listBrowsers returned[] (Chrome0), and one createBrowserTab('iab',...) attempt reported unavailable. No upload retry/private API was used. Final polished screen has no screenshot yet.
3. Task9/independent QA should first use a functioning browser to inspect final unavailable panel at1280×720, verify native return, final status visibility and styled folder action, then validate its own v3 UI/draft/save/export. Original browser project backup remains preserved; no original restoration claim is made. No native48-export or original-art acceptance was added by Task4.

## Final integration fix round 1

The empty center heading now reflects no selection, package reading, confirmed structure with runtime unavailable, loading, and failure. Structure confirmation never claims model playback. Existing package/controller/session contracts remain unchanged.

`suspend({resetPlayback:true})` is an additive app lifecycle option for browser page-cache suspension: it pauses the controller and clears playback intent while retaining the loaded session and listeners. Existing `suspend()` behavior remains. App persisted pagehide uses this option; pageshow resynchronizes the route without automatic playback. Nonpersisted pagehide still destroys the workspace.

# SDK-independent Cubism package contract

Task 1 only. `package-read:verified`; `actual-playback:not-run`.

CommonJS: `require('./web/src/cubism-package.js')`; browser global: `PankekiCubismPackage`. The module exports `readPackage` and a frozen `LIMITS` object. No Core, SDK, network, archive extraction, image decode, browser document, or installed dependency is needed.

```js
const pkg = await PankekiCubismPackage.readPackage(
  [{path: 'folder/model.model3.json', bytes: new Uint8Array(/* local bytes */)}],
  {entryPath: 'folder/model.model3.json', signal}
);
```

`readPackage(files, {entryPath?, signal?} = {})` returns a Promise. The entire input byte snapshot is copied synchronously before the first asynchronous hash operation. Caller-owned buffers remain unchanged. Aborted reads reject with `code: 'ABORTED'`; no partial Package escapes. SHA-256 covers every selected file, including unreferenced files.

| Package field | Contract |
|---|---|
| `entryPath` | NFC-normalized selected `.model3.json` path |
| `manifest` | Deep-frozen JSON object, including unknown fields, Layout, Groups, HitAreas and all motion/expression definitions |
| `files` | Getter returning a **new Map and copied Uint8Array values on every access**. Keys are normalized paths. The Map is a detached consumer snapshot, not trusted mutable package storage. |
| `hashes` | Frozen null-prototype record of normalized path → lowercase SHA-256 hex, tied to the private byte snapshot |
| `resources` | Frozen object described below; every resource `bytes` getter returns a fresh copy |
| `capabilities` | Frozen status object; reading bytes never claims decoding or playback |
| `warnings` | Frozen array of objects with `code`, optional `field`/`message` |

The returned Package, manifest, resource metadata, hashes, capabilities and warnings are frozen. Typed-array backing buffers cannot be made immutable by freezing an object; the implementation therefore keeps private buffers and returns copies. Mutating `pkg.files.get(path)`, calling `set`/`clear` on a returned Map, or changing `resource.bytes` changes only that detached copy. Subsequent reads still return bytes matching `pkg.hashes`. Consumers should capture `const files = pkg.files` once per operation to avoid repeatedly copying the whole package, and treat that snapshot as their own mutable data. Never assume a consumer-modified snapshot, serialized object or arbitrary Package-shaped object is validated: pass edited/reselected bytes back through `readPackage` before trusting their hashes. Retain the original Package for runtime/context recovery.

`resources` has this shape:

```js
{
  moc: {path, get bytes()},
  textures: [{path, slot, width, height, get bytes()}],
  motions: [{path, group, index, definition, sound: null | {path, get bytes()}, get bytes()}],
  expressions: [{path, name, index, definition, get bytes()}],
  physics: null | {path, get bytes()},
  pose: null | {path, get bytes()},
  displayInfo: null | {path, get bytes()},
  userData: null | {path, get bytes()}
}
```

Texture slot order, motion group/index, expression name/index and complete declaration metadata are preserved without sorting or guessing replacements. All known declared resources, including Sound, must exist. An absent optional declaration produces `null` or an empty array. Motion/expression/physics/pose/display-info/user-data bytes must be UTF-8 JSON objects even when filenames lack a `.json` suffix; their detailed SDK schemas/effects are not validated here. Other selected `.json` files also undergo generic JSON validation. Unknown top-level manifest and FileReferences fields are preserved with `UNKNOWN_FEATURE` warnings; their semantics and unknown references are unsupported. Sound produces `SOUND_NOT_SUPPORTED` because audio playback and real-time lipsync are outside this task.

`capabilities` includes `packageRead: 'verified'`, `actualPlayback: 'not-run'`, `sdkValidation: 'not-run'`, `pngDecode: 'not-run'`, `mocValidation: 'not-run'`, `audioPlayback: 'unsupported'`, `unknownFeatures: 'none' | 'unsupported'`, and `motions`/`expressions`/`physics`/`pose: 'provided' | 'not-provided'`. Provided describes declarations, not playable functionality.

The manifest requires `Version === 3`, a Moc path ending in `.moc3`, and at least one PNG texture. Layout values must be finite numbers; Groups/HitAreas and known reference fields have explicit type checks. JSON must have an object root, finite numbers and at most 24 nested levels; unsafe prototype keys are rejected. PNG validation checks only its signature, IHDR length and positive dimensions. CRC, pixel data, decompression, actual image decode, actual GL limits and MOC format/version/consistency require the later runtime gate. Tests intentionally change IHDR dimensions without repairing CRC to exercise this distinction; those synthetic header probes are not renderable-model evidence.

All paths resolve relative to the manifest directory into the selected package's logical root. `../shared.moc3` is allowed if it remains within that root and the exact normalized file is present. No filesystem lookup, URL interpretation or case-insensitive fallback occurs. Schemes/colon, absolute/drive/UNC paths, backslashes, control/NUL characters, escaping `..`, encoded separators/traversal (including nested percent encodings) and normalized path collisions are rejected. Spaces, Korean names, ordinary subfolders and `./` normalization are supported. NFC and conservative Unicode caseless normalization reject collisions, including sharp-s expansions and decomposed accents. Caseless normalization deliberately may reject additional Unicode spelling pairs; it never selects between colliding files.

These are **initial product budgets, not official Cubism limits**:

| Budget | Inclusive maximum |
|---|---:|
| Selected files | 256 |
| Selected bytes in total | 256 MiB |
| One file | 64 MiB |
| One JSON file/resource | 8 MiB |
| Texture slots | 32 |
| Estimated decoded texture bytes, summed per slot as width × height × 4 | 256 MiB |
| Texture width or height | 8192 |
| JSON nesting depth | 24 |

Failures are Error objects with stable `code`, optional normalized `path`, and a human-readable message. Multiple manifests without explicit selection produce `ENTRY_REQUIRED` and sorted `entries: string[]`; no manifest (including a lone MOC) produces `MANIFEST_REQUIRED`. Other codes: `ENTRY_NOT_FOUND`, `INVALID_INPUT`, `INVALID_PATH`, `PATH_COLLISION`, `INVALID_JSON`, `INVALID_MANIFEST`, `MISSING_RESOURCE`, `INVALID_PNG`, `FILE_COUNT_LIMIT`, `FILE_SIZE_LIMIT`, `TOTAL_SIZE_LIMIT`, `JSON_SIZE_LIMIT`, `JSON_DEPTH_LIMIT`, `TEXTURE_COUNT_LIMIT`, `TEXTURE_DIMENSION_LIMIT`, `DECODED_SIZE_LIMIT`, `HASH_UNAVAILABLE`, `ABORTED`. Consumers should branch on `code`, not message text.

Verification command: `node --test scripts/test_cubism_package.cjs`. Execution evidence, exact runtime path, RED/GREEN results, source hashes and unified diff are under `output/live2d-application-20261024/evidence/task-1/`. Task 1 is source-only: it does not connect this reader to visible UI, save/reopen, official SDK, real model playback, GPU, or the app build. Those remain later assigned tasks and final gates.

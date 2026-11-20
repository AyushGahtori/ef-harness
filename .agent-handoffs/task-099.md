---
task_id: "Task-099"
branch: "task/099-brand-asset-sanitizer-registry"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/intake/src/assets/**"
  - "packages/intake/tests/assets/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 099 handoff

Brand asset sanitizer, font license gate, CAS registry, typed `src/brand/assets.ts` emitter, and deterministic placeholders. Commit stays on `task/099-brand-asset-sanitizer-registry`.

## Exports Provided

Import from `packages/intake/src/assets/index.ts`. The package barrel `packages/intake/src/index.ts` does not re-export these yet.

- `BrandAssetSanitizer` — `sanitizeSvg` applies the DOMPurify 3.4.18 SVG + svgFilters tag profile (`DOMPURIFY_SVG_PROFILE`) and then the task strips: `<script>`, `<foreignObject>`, `on*` handlers other than the SVG attribute `orientation`, `javascript:` / `vbscript:` URIs, external `http(s)://` and protocol-relative `<image>`, `<use>`, and `@import` / CSS `url()`, and malformed entities / DOCTYPE. `viewBox`, path data, `<title>`, and the two W3C `xmlns` values are kept. `removedElementsLog` is `SanitizedSvgRemovedElements: ['script', 'external-image']` in document order. Fragment-only `<use href="#id">` is kept; DOMPurify's own profile drops every `<use>`.
- `FontLicenseInspector` — `inspect(bytes, filename)` opens the font with `fontkit.create` and reads family, subfamily, postscript name, OS/2 weight and fsType, glyph count, Unicode coverage, and the OpenType `name` license (name ID 13) and copyright records. `withAttestation(report, phrase)` accepts only the exact phrase `I hold a web embedding license for this font`. Classifications: `open`, `proprietary`, `desktop-only`, `unknown`. Anything except `open` has `bundleAllowed: false` until that phrase is recorded. `preferWoff2` is true unless the container is already `.woff2`.
- `BrandAssetRegistry` — `registerSvg`, `registerRaster`, `registerFont`, `registerPrepared`, `acceptInvertedLogoLight`, `list`, `get`, `readBytes`. Sanitized bytes go to the CAS port. The node is written to `state.db` as `kind = 'asset'` with `fields.recordType = 'brand_asset'` and `{ assetId, role, casSha256, mimeType, width, height, altText, dominantColorsHex, licenseAttestation, placeholder, byteLength }`. Roles are `logo_light`, `logo_dark`, `favicon`, `hero`, `avatar_fallback`, `font`. A dark logo with no light logo sets `alerts` to the missing-light message and `offers` an inverted monochrome PNG plus a placeholder. Dominant colors are pushed to `colorSuggestions` and, when injected, to `DesignSystemScaffoldBuilderPort.suggestBrandColors`.
- `Phase0BrandAssetsGenerator` — `emit({ appRoot, projectName, destination, tokens })` fills any missing visual role from `DeterministicPlaceholderGenerator`, writes `public/brand/` (or `src/assets/brand/` when `destination` is `src-assets`) and `src/brand/assets.ts`. The module exports `BRAND_ASSETS.logoLight`, `favicon`, and the other roles, plus `PLACEHOLDER_SHIP_CHECKLIST`. Every referenced file is on disk. The module is scanned with the hotlink rule before it is returned.
- `DeterministicPlaceholderGenerator` — `generate(projectName, tokens)` builds a token-colored monogram SVG, dark-surface monogram, 32-unit favicon SVG, geometric hero, and avatar. `projectInitials` is stable. Default tokens are `NEUTRAL_BRAND_TOKENS`. Every generated asset has `placeholder: true`.
- `ExternalHotlinkScanner` / `scanUnapprovedHotlinks` — rule id `no-external-hotlink`. Flags unapproved `http(s)` and protocol-relative image URLs (`img`/`image`/`source`/`video`/`use`, `srcset`, CSS `url()`, markdown images) and any mention of the stock hosts (`unsplash.com`, `imgur.com`, `picsum.photos`, and the other hosts in `STOCK_IMAGE_HOSTS`). With `projectRoot`, missing relative and `/public` image paths are `broken-relative-path`. Messages point at `BRAND_ASSETS`.
- `MemoryCasBlobStore`, `SqliteBrandAssetState`, `RasterSafetyError`, `CasIntegrityMismatchError`, `CasBlobMissingError`, `FONT_ATTESTATION_PHRASE`, `DERIVATIVE_SIZES`, `MAX_RASTER_PIXELS` (`64000000`), `MAX_RASTER_BYTES` (25 MB), `MAX_ANIMATION_FRAMES` (256).

Raster derivatives from `sharp` after `rotate()` and a metadata-free PNG re-encode: favicon 32×32, logo @1x 256×256, logo @2x 512×512, og-image 1200×630. Animated containers over 256 frames, or whose frames × width × height exceed 64 MP, are rejected before `sharp` allocates a buffer. A single-frame pixel bomb is rejected by `sharp(input, { limitInputPixels: 64000000, animated: false })`.

## Shared Wiring Needs (Root / Index Barrels)

Add these re-exports to `packages/intake/src/index.ts` (frozen in this task):

`BrandAssetSanitizer`, `FontLicenseInspector`, `BrandAssetRegistry`, `Phase0BrandAssetsGenerator`, `DeterministicPlaceholderGenerator`, `ExternalHotlinkScanner`, `scanUnapprovedHotlinks`, `MemoryCasBlobStore`, `SqliteBrandAssetState`, `DOMPURIFY_SVG_PROFILE`, `FONT_ATTESTATION_PHRASE`, `DERIVATIVE_SIZES`, `MAX_RASTER_PIXELS`.

Do not deep-import `packages/intake/src/assets/**` from another package. Callers should use the intake barrel after that re-export lands.

`SqliteBrandAssetState.open` reads `schema/state.sql` and registers `ef_search_text`. It does not modify the schema file.

## Dependency Intents (New Packages Requested)

`@ef-harness/intake` should depend on these packages. They are already root devDependencies, so this task loads them with `createRequire` from the repository root `package.json` and does not edit any `package.json`:

- `sharp` — raster decode, EXIF orientation, metadata-free re-encode, derivative resize, pixel-limit rejection. Already listed.
- `fontkit` — OpenType `name` / OS/2 / cmap inspection. Already listed.
- `dompurify` — already listed. `loadDomPurifyFactory()` in `engines.ts` returns it. Sanitizing still needs a DOM window.
- `jsdom` (or `isomorphic-dompurify`) — not installed. Add it so `BrandAssetSanitizer.sanitizeSvg` can call `DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })` in addition to the in-process profile. Until that package exists, the in-process allowlist is the sanitizer.

No woff2 encoder is requested as a hard dependency. `preferWoff2` is a delivery flag. Transcoding TTF/OTF to woff2 can be a later intake dependency if a pure encoder is approved.

## Contract Change Requests

- **Task 007.** `packages/intake/src/assets/canonical-hash.ts` is `local-port:task-007`. `digestSha256` returns `sha256:` + hex. `computeNodeContentHash` hashes NFC canonical `{ kind, title, text, fields }`. Swap the import to `@ef-harness/shared-contracts` when that barrel exports `computeNodeContentHash` and `digestSha256`. Do not deep-import the sibling package.
- **Task 028.** `MemoryCasBlobStore.source` is `local-port:task-028`. `putBlob`, `getBlob`, `verifyBlobIntegrity`, `pinBlob`, and `unpinHolder` match the methods this task calls. The hash is the lowercase SHA-256 of the uncompressed bytes. `CasWriteResult` is `{ hash, bytes, deduplicated }`. `CasIntegrityMismatchError` and `CasBlobMissingError` are the local error types. This port does not compress, retry Windows renames, or run GC. Inject the real `CasBlobStore` from the db barrel when it is exported.
- **Task 094.** `DesignSystemScaffoldBuilderPort.source` is `local-port:task-094`. `suggestBrandColors({ assetId, role, dominantColorsHex })` is the Look-and-Feel color hook. `BrandAssetRegistry.colorSuggestions` keeps the same records when no builder is injected. Swap the port for `DesignSystemScaffoldBuilder` / `LookAndFeelInterviewFlow` from Task 094.
- **`state.db` node kind.** `node_kinds` contains `asset` and does not contain `brand_asset`. This task cannot edit `schema/`. Nodes are `kind = 'asset'` with `fields.recordType = 'brand_asset'` and `fields.basis` of `observed` (uploads) or `defaulted` (placeholders). An `artifacts` row uses `retention = 'asset'` and `artifact_refs.owner_kind = 'brand_asset'`. If integrators want `kind = 'brand_asset'` itself, add that value to `node_kinds` in a schema change. Until then readers should select `fields.recordType = 'brand_asset'`.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-099-brand-asset-sanitizer-registry`.

- `pnpm --filter @ef-harness/intake typecheck` — exit 0 (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/intake lint` — exit 0 (`eslint .`).
- `pnpm --filter @ef-harness/intake test -- assets` — exit 0. Vitest: 4 files, 14 tests passed (SVG script/foreignObject/onload/javascript/external href, EXIF/GPS/XMP strip, 50000×50000 pixel bomb, animated frame budget, fontkit desktop-only and OFL licenses, CAS + `state.db` node, dark-logo offer, Phase 0 `src/brand/assets.ts`, hotlink rule).
- `node scripts/verify-harmony.mjs --task 099` — exit 0. Printed `harmony ok for Task-099`.

## Known Limitations / Follow-Ups

- **DOM window.** `dompurify` is loaded only as a factory. Without `jsdom`, SVG sanitizing is the in-process DOMPurify SVG profile plus the extra external-reference strips, not a call to `DOMPurify.sanitize`.
- **`<use>`.** Local fragment references stay. External `use` is removed. DOMPurify drops all `use` elements; this difference is intentional for in-document sprites.
- **WOFF2 bytes.** A TTF/OTF/WOFF upload is stored as the original bytes after the license gate. `preferWoff2` tells Phase 0 and later optimizers to prefer a woff2 when one is uploaded. This task does not recompress the font.
- **CAS.** `MemoryCasBlobStore` is an in-memory stand-in. It verifies SHA-256 on read and pins by holder. It is not the on-disk sharded Task 028 store.
- **Node kind name.** See the contract request. `assetId` values are `BA-<role>` (`BA-logo-light`, `BA-font`, and so on).
- **Raster container.** Sanitized rasters are re-encoded as PNG. WebP, AVIF, JPEG, and GIF inputs are accepted. GIF/APNG animation within the frame budget is flattened to the first frame. Outputs are checked for `eXIf`, `tEXt`, `iTXt`, `zTXt`, and `tIME` chunks and for sharp metadata `exif` / `xmp` / `iptc`.
- **Task 054 / Task 174.** `scanUnapprovedHotlinks` is the deterministic rule those tasks should call. It is not wired into their runners from this branch.
- **Task 093.** `Phase0BrandAssetsGenerator.emit` is the P0.5 writer. Phase 0's controller is not on this base and is not called here.

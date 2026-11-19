---
task_id: "Task-029"
branch: "task/029-seekable-logs-retention-archive"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/db/src/artifacts/**"
  - "packages/db/tests/artifacts/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 029 handoff

Seekable zstd logs, 1,000-line sidecar indexes, retention and storage-cap eviction, weekly integrity scrub, and closed-attempt `turn_log` archival. Commit stays on `task/029-seekable-logs-retention-archive`.

## Exports Provided

Wire these from `packages/db/src/artifacts/index.ts` (this branch does not edit `packages/db/src/index.ts`):

- `ArtifactManager` — `storeArtifact`, `readLogRange`, `queryLogStream`, `enforceRetentionAndStorageCap`, `runWeeklyIntegrityScrub`, `archiveClosedAttemptTurnLog`, `promoteAttemptEvidence`, `removeDeveloperAsset`, `storeResearchDocument`
- `SeekableLogReader` — `readRange`, `query`, `frameDecompressionCount` (zstd frame-decode counter)
- `TurnLogArchiver` — `archiveClosedAttemptTurnLog`
- `encodeSeekableLog`, `decodeSeekableFrames`, `parseSeekable`, `parseLineIndex`
- `loadCanonicalQueries` — verbatim `archive_turn_log` and `purge_archived_turn_log` from `schema/queries.sql`
- Errors: `InvalidLineRangeError`, `UnsafeLogPatternError`, `AttemptNotArchivableError`, `AttemptNotFoundError`, `CasIntegrityMismatchError`, `CasBlobMissingError`, `AssetRemovalError`
- `CasBlobStore` port consumed from Task 028, including `readCompressed` for seekable payloads

`readLogRange` returns `{ lines, totalLines, truncated, framesDecompressed, indexSource }`. Line numbers are 1-based and inclusive. Past-EOF returns `{ lines: [], totalLines, truncated: false }`. Negative or inverted bounds throw `InvalidLineRangeError`.

`queryLogStream(artifactId, pattern, maxMatches, options?)` assembles lines across frame boundaries, stops at `maxMatches`, and stops with `truncated: true` when the byte or time budget is hit. Nested quantifiers such as `(a+)+$` throw `UnsafeLogPatternError` before any frame is decoded.

## Shared Wiring Needs (Root / Index Barrels)

Re-export the artifact barrel from `packages/db/src/index.ts` when integration is allowed to touch that file:

```ts
export {
  ArtifactManager,
  SeekableLogReader,
  TurnLogArchiver,
  CasBlobMissingError,
  CasIntegrityMismatchError,
} from "./artifacts/index.js";
```

No root manifest, schema, or `packages/shared-contracts` edit. Canonical SQL stays in `schema/queries.sql` and is loaded through `canonicalAssetAbsolute("queriesSql")`.

## Dependency Intents (New Packages Requested)

None. Compression uses Node's built-in `node:zlib` zstd (`zstdCompressSync` / `zstdDecompressSync`). Databases use `node:sqlite`. No new package was added.

## Contract Change Requests

Task 028's `CasBlobStore` needs to accept an already-framed payload so Task 029 does not double-compress seekable logs:

- `putBlob({ uncompressed, storedPayload, format, holder, createdAt })` where `format` is `'zstd' | 'zstd-seekable' | 'raw'`
- The CAS key remains SHA-256 of `uncompressed`
- `readCompressed(hash)` returns the stored bytes without inflating every frame
- `verifyBlobIntegrity`, `pinBlob`, `unpinHolder`, `quarantineBlob`, `markVerified`, `totalPinnedStoredBytes`, and `listVerificationCandidates` match the port in `packages/db/src/artifacts/cas-port.ts`

`CasIntegrityMismatchError` and `CasBlobMissingError` are declared on this branch so the package typechecks without Task 028. When that branch lands, the db barrel should re-export Task 028's classes if they are the same types.

`ArtifactManager` takes `node:sqlite` `DatabaseSync` handles for the project state database (Task 013) and the global broker database (Task 014). Pass those connections through when `ProjectStateDb` and `GlobalBrokerDb` exist. `state.db` and `global.db` are never written in one transaction.

`artifacts.retention` has no `'research'` value. Research documents are pinned with `holder_kind = 'research'` and tracked in `global.db.research_cache` until `expires_at` or the package `major.minor` changes.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-029-seekable-logs-retention-archive`:

- `pnpm --filter @ef-harness/db test -- artifacts` — pass, 2 files, 10 tests (5 MB / 80,000-line window decompresses at most 2 frames; 10 MB lines 95,000–95,100 decompress at most 2 frames; cross-frame UTF-8 and regex; ReDoS rejection; retention order; storage-cap warning; scrub quarantine; `turn_log` archive totals and protected states).
- `pnpm --filter @ef-harness/db typecheck` — pass (`tsc -b`, and again as part of harmony).
- `pnpm --filter @ef-harness/db lint` — pass (`eslint .`, and again as part of harmony).
- `node scripts/verify-harmony.mjs --task 029` — pass, exit 0, `harmony ok for Task-029`.

## Known Limitations / Follow-Ups

- The production CAS implementation is Task 028. Tests use `SqliteCasBlobStore` in `packages/db/tests/artifacts/`, which writes `cas_blobs` and `cas_pins` in the test `global.db` and keeps framed bytes in memory. It is not a second on-disk CAS layout.
- Weekly scrub samples non-evidence blobs. Evidence is left to Task 028's verify-on-read. A range read quarantines a blob when a touched frame fails to decode, and it does not hash the rest of the object, so a viewport stays within the covering frames.
- Storage-cap accounting uses pinned `stored_bytes`. Unpinning a diagnostic does not delete the file; Task 028's 7-day GC does that. Eviction deletes the `artifacts` row (and `artifact_refs`, `module_cards`, and `turn_log_archives` rows that point at it) before the pin is removed, so a later pin sync cannot treat the expired row as live.
- `removeDeveloperAsset` is the developer removal path for `'asset'`. Evidence and asset pins are never selected by time expiry or by the cap evictor.
- A crash between pinning a blob and inserting its `artifacts` row can leave an unreferenced project pin. The next successful `storeArtifact` does not sweep unrelated pins; Task 028 `syncProjectPins` remains the full reconciliation.
- Log search rejects nested quantifiers and quantified alternations before `RegExp` execution, and also enforces a byte budget (default 16 MB) and a time budget (default 2 seconds). A single pathological line still cannot be preempted mid-execution, which is why unsafe patterns never reach the engine.

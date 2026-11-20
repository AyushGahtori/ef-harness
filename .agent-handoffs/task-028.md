---
task_id: "Task-028"
branch: "task/028-cas-artifact-store-gc"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/db/src/cas/**"
  - "packages/db/tests/cas/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 028 handoff

Content-addressed blob store on `task/028-cas-artifact-store-gc`. Commit stays on this branch.

## Exports Provided

Import from `packages/db/src/cas/index.ts` until the db barrel is wired:

- `CasBlobStore` — `putBlob`, `getBlob`, `verifyBlobIntegrity`, `pinBlob`, `unpinHolder`, `syncProjectPins`, `runGarbageCollection`, `quarantineBlob`, `forceDeletePurgedBlob`, `sweepOrphanTempFiles`, `open`
- `CasWriteResult`
- `CasIntegrityMismatchError`
- `CasBlobMissingError`

Also exported for callers and tests: `CasHolderKind`, `CasRetention`, `CasStoredFormat`, `CasWriteFormat`, `CasPutPin`, `CasBlobStoreOptions`, `CasIntegrityVerification`, `CasDependentReceiptMark`, `CasCorruptionEvent`, `CasScrubRecoveryAlert`, `CasStoreEvent`, `CasGcResult`, `CasPinSyncResult`, `blobFilePath`, `defaultCasRoot`, `globalCasGcCandidatesSql`, `loadNamedQuery`, `casRenameBackoffMs`, `CAS_GRACE_MS`, `CAS_TMP_MAX_AGE_MS`, `CAS_RENAME_ATTEMPTS`.

`CasBlobStore` takes the writer `DatabaseSync` for `global.db` (`GlobalBrokerDb`, Task 014) and, when pin sync or receipt marking is required, the writer `DatabaseSync` for `state.db` (`ProjectStateDb`, Task 013). Those classes are not on this branch. Do not `ATTACH` the two files.

`putBlob` commits `cas_blobs` and `cas_pins` before it returns the hash. The caller then inserts `state.db.artifacts`. The hash is SHA-256 of the uncompressed bytes. Files live at `%LOCALAPPDATA%\EFHarness\cas\sha256\<h[0..2]>\<h[2..4]>\<hash>.zst` (or `.raw`), with `h[0..2]` and `h[2..4]` as two-character slices (`ab\cd`).

`runGarbageCollection` executes named query `global_cas_gc_candidates` loaded from `schema/queries.sql`. `forceDeletePurgedBlob` is only for Task 030 and requires `{ caller: "task-030-secret-purge" }`. It refuses while any pin remains, then deletes immediately.

Pending holder ids reconciled by `syncProjectPins` are `projectId` or `projectId:<token>`.

## Shared Wiring Needs (Root / Index Barrels)

Please re-export from `packages/db/src/index.ts` (that file is outside this task's write scope):

```ts
export {
  CasBlobStore,
  CasBlobMissingError,
  CasIntegrityMismatchError,
} from "./cas/index.js";
export type { CasWriteResult } from "./cas/index.js";
```

No root manifest or `packages/shared-contracts/src/index.ts` change.

Root `.gitignore` pattern `cas/` also ignores `packages/db/src/cas/**` and `packages/db/tests/cas/**`. Please narrow it to `/cas/` or add negations for those two trees so later `git add` of this package does not need `-f`.

## Dependency Intents (New Packages Requested)

None. Compression uses Node's `node:zlib` zstd, hashing uses `node:crypto`, and catalogs use `node:sqlite`.

## Contract Change Requests

None. `schema/global.sql`, `schema/state.sql`, and `schema/queries.sql` are unchanged. `global_cas_gc_candidates` is executed as loaded from `schema/queries.sql`.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-028-cas-artifact-store-gc`:

- `pnpm --filter @ef-harness/db test -- cas` — pass, 22 tests, 1 file.
- `pnpm --filter @ef-harness/db typecheck` — pass (`tsc -b`).
- `pnpm --filter @ef-harness/db lint` — pass.
- `node scripts/verify-harmony.mjs --task 028` — pass (`harmony ok for Task-028`), including workspace typecheck, lint, and test.

## Known Limitations / Follow-Ups

- Seekable zstd frames and the weekly sample scrub belong to Task 029. This store writes `zstd` or `raw` only. A row already marked `zstd-seekable` is decoded with a single zstd frame; a decode failure quarantines it.
- `getBlob` checks the uncompressed SHA-256 for every retention class. Evidence and asset are never exempt. Task 029 range reads of diagnostic logs still need an explicit full-hash path for evidence and asset.
- `syncProjectPins` drops pending pins once the hash is in `state.db.artifacts`, and drops crash-orphaned pending pins older than one hour. A pending pin younger than one hour whose hash is not in `artifacts` is kept so an in-flight `putBlob` is not unpinned. Sync never deletes blob bytes.
- `forceDeletePurgedBlob` does not bypass a live pin. Task 030 must replace references and remove pins first. Age is not consulted.
- On Node 24, libuv's unlink clears the Windows read-only attribute and retries, so `fs.unlink` of a mode `0444` file can succeed. The store still `chmod(0o666)` immediately before unlink. The Windows test shows write-open returns `EPERM`, `cmd /c del` reports `Access is denied`, and the unlink hook observes a writable file.
- Node's Windows `fs.rename` replaces an existing destination. Publishers take an exclusive `cas/tmp/<file>.publish.lock` so one rename wins and the others verify the bytes already stored.
- `GlobalBrokerDb` and `ProjectStateDb` are not implemented on this branch. Pass their writer connections when Tasks 013 and 014 land.

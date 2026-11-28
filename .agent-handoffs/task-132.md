---
task_id: "Task-132"
branch: "task/132-component-downloader-park-updater"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "apps/desktop/src/updater/**"
  - "apps/desktop/tests/updater/**"
  - "apps/daemon/src/components/**"
  - "apps/daemon/tests/components/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 132 handoff

Signed on-demand component downloads and park-first app updates. Commit stays on `task/132-component-downloader-park-updater`.

## Exports Provided

Daemon (`apps/daemon/src/components/index.ts`):

- `SignedComponentDownloader` — Ed25519-verified manifest, HTTP `Range` resume, pause/cancel, SHA-256 before unpack, mirror fallback, strict TLS.
- `AvQuarantineIntegrityChecker` plus `AV_QUARANTINE_CARD` — missing, unreadable, or altered binaries become a repair card. Whisper findings set `suggestedFallback` to `os-dictation`. `repair()` re-downloads through `SignedComponentDownloader`.
- `ComponentDiskUsageManager` and `formatComponentDiskUsage` — on-disk rows such as `Whisper Medium: 480 MB`. `uninstall()` throws `ComponentLeaseActiveError` while `ComponentLeaseSource.holder()` is set.
- `assertComponentExecutableAllowed` — refuses a component whose `verified` flag is not true. This package does not spawn component binaries.
- `DiskHeadroomGuardPort`, `nodeDiskHeadroomGuard`, `componentDownloadFits`, `COMPONENT_DOWNLOAD_RESERVE_BYTES` (`5_000_000_000` bytes). Downloads require `freeBytes - 2 * size >= 5 GB`.
- `signComponentManifest`, `verifyAndReadManifest`, `BUNDLED_COMPONENT_MANIFEST_KEY_ID`, `bundledComponentManifestPublicKey`.
- `atomicDirectorySwap`, `recoverInterruptedInstall`, `packZip`, `extractZip`.
- Errors: `InvalidManifestSignatureError`, `UnpinnedLatestUrlError`, `MissingComponentDigestError`, `HttpDowngradeError`, `StrictTlsDisabledError`, `InsufficientDiskHeadroomError`, `ChecksumMismatchError`, `DownloadInterruptedError`, `DownloadPausedError`, `DownloadCancelledError`, `DownloadTimeoutError`.

Desktop (`apps/desktop/src/updater/index.ts`):

- `ParkFirstAutoUpdater` — quiet download only when network and disk are `GREEN` and `manualUpdatesOnly` is false. Pill text is `Update vX.Y.Z ready — Restart when convenient`. `requestUpdateAndRestart()` is the `Update & Restart` action (`UPDATE_AND_RESTART_LABEL`). It never calls `quitAndInstall()` until active workers are checkpointed, the SQLite WAL is flushed, job objects are torn down, and the `state.db` snapshot is verified.
- `CheckpointSchemaUpcasterRegistry` — pure `v1 → v2 → v3` upcasters for `attempt_checkpoint`, `ship_run`, and `verification_state`. `upcastStored()` writes only inside a verified backup-protected transaction. Obsolete checkpoints return `fresh_retry` with `preserveIntegration: true` and the same `integrationRef` (`refs/heads/harness/integration` when that was the stored ref).
- `DowngradeProtectionGuard`, `CURRENT_SUPPORTED_SCHEMA_VERSION` (`3`), `newerSchemaMessage`. Newer `state.db` / `global.db` stamps throw `NewerSchemaVersionError` with `This project was opened by EF Harness vX.Y — please update this machine`.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit the frozen barrels in this task. Integrators should re-export:

- `apps/daemon/src/index.ts` from `./components/index.ts`: `SignedComponentDownloader`, `AvQuarantineIntegrityChecker`, `ComponentDiskUsageManager`, `formatComponentDiskUsage`, `AV_QUARANTINE_CARD`, `nodeDiskHeadroomGuard`, `componentDownloadFits`, `COMPONENT_DOWNLOAD_RESERVE_BYTES`, and the manifest verify helpers.
- `apps/desktop/src/index.ts` from `./updater/index.ts`: `ParkFirstAutoUpdater`, `CheckpointSchemaUpcasterRegistry`, `DowngradeProtectionGuard`, `CURRENT_SUPPORTED_SCHEMA_VERSION`, `UPDATE_AND_RESTART_LABEL`, `updateReadyPillText`.

UI wiring outside this subtree:

- Top Bar reads `ParkFirstAutoUpdater.pill()` and calls `requestUpdateAndRestart()` for `Update & Restart`.
- Settings → Components reads `ComponentDiskUsageManager.list()` / `uninstall()` and `AvQuarantineIntegrityChecker.inspect()`.
- Component bytes live under `%LOCALAPPDATA%\EFHarness\components\` via `defaultComponentsDirectory()`.

Sibling ports to swap when those branches integrate (not merged into this base):

- `DiskHeadroomGuardPort` and `nodeDiskHeadroomGuard` → Task 118 `DiskHeadroomGuard`. The download rule stays `freeBytes - 2 * componentSize >= 5 GB`.
- `UpdateResourceHeadroomPort` → Task 118 network/disk level (`GREEN` required for quiet update download).
- `MigrationAndRebuildEnginePort` → Task 015 `MigrationAndRebuildEngine` (`createVerifiedBackup`, `runBackupProtectedTransaction`).
- `PreUpgradeBackupPort` → Task 016 verified `state.db` snapshot.
- `WorkerParkPort` → Task 114 / Task 128 pause-and-checkpoint.
- `DaemonShutdownCoordinatorPort` → Task 131 `DaemonShutdownCoordinator` (`flushSqliteWal`, `teardownJobObjects`).
- `ElectronUpdaterPort` → `electron-updater` `downloadUpdate` / `quitAndInstall` once Task 196 supplies the signed NSIS feed. `quitAndInstall` must stay behind `ParkFirstAutoUpdater.requestUpdateAndRestart()`.

## Dependency Intents (New Packages Requested)

- Add `electron-updater` to `@ef-harness/desktop` when the NSIS `latest.yml` feed exists. This task does not edit `package.json`. Verification uses `ElectronUpdaterPort` so no unsigned install path is imported.
- No other package is required. Ed25519 and SHA-256 use `node:crypto`. HTTP resume uses global `fetch`. Zip extract uses `node:zlib`.

## Contract Change Requests

None for `packages/shared-contracts`. Keep the ports above local until the sibling tasks export the real types. Do not add component-manifest fields to frozen SQL schemas in this task.

Manifest contract the signer (Task 196) must produce:

- Envelope `{ manifest, signature }` where `signature` is standard base64 Ed25519 over `canonicalJson(manifest)`.
- `manifest.keyId` must equal `ef-harness-components-2026`.
- The pinned public key is `bundledComponentManifestPublicKey()` (raw 32 bytes). The private key is not in this repository.
- Each component has a lowercase SHA-256, a pinned `version` (not `latest`), `primaryUrl`, optional `mirrorUrls`, and `packaging` of `file` or `zip`.
- A URL path or `version`/`tag`/`channel` query of `latest` is fetched only when that signed SHA-256 is present. `version: "latest"` is always refused.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-132-component-downloader-park-updater`:

- `pnpm --filter @ef-harness/daemon typecheck` — pass.
- `pnpm --filter @ef-harness/desktop typecheck` — pass.
- `pnpm --filter @ef-harness/daemon lint` — pass.
- `pnpm --filter @ef-harness/desktop lint` — pass.
- `pnpm --filter @ef-harness/daemon test -- components` — pass, 5 files, 26 tests. Covers tampered Ed25519 manifests (zero payload requests), bundled-key rejection, unpinned `latest`, TLS disable and HTTP downgrade, `Range` resume after 50% and 72% disconnect, pause/cancel, bad SHA-256 deleting `.part` with no unpack (`MAX_CHECKSUM_RETRIES + 1` attempts), zip inner-hash failure leaving the previous install, AV `ENOENT` / `EACCES` / hash mismatch plus whisper `os-dictation` fallback and repair, the `5.2 GB - 2 * 1.6 GB < 5 GB` refusal, mirror timeout fallback, and lease-blocked uninstall.
- `pnpm --filter @ef-harness/desktop test -- updater` — pass, 2 files, 11 tests. Covers quiet download with 4 active workers and zero `quitAndInstall`, park → WAL flush → job teardown → verified backup → `quitAndInstall`, unverified backup and partial checkpoint refusal, manual-only and non-green headroom, `v1 → v2` backup-protected upcast of task `T-5`, `v1 → v3`, ship/verification upcasts, obsolete fresh retry with the integration ref unchanged, and newer `state.db` / `global.db` refusal before any write.
- `node scripts/verify-harmony.mjs --task 132` — pass (`harmony ok for Task-132`).

## Known Limitations / Follow-Ups

- ZIP64 archives are refused. Each zip entry is inflated in memory after the archive SHA-256 matches. `packaging: "file"` (GGUF and other single binaries) is hashed and copied with streams.
- Loopback `http://127.0.0.1`, `localhost`, and `::1` are allowed so tests can run without a certificate. Every other URL must be HTTPS. `NODE_TLS_REJECT_UNAUTHORIZED=0` aborts before any request. An HTTPS URL never falls back to HTTP.
- Component leases are explicit via `ComponentLeaseSource`. The manager does not infer a Windows file lock.
- The bundled Ed25519 key can only verify. Task 196 holds the signing key and must publish `components-manifest.json`.
- Checkpoint rows are upcast in memory through the migration port. This task does not open SQLite and does not rewrite `harness/integration`.
- Renderer Settings and Top Bar mounts are outside the owned subtree.

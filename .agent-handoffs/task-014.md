---
task_id: "Task-014"
branch: "task/014-global-telemetry-codeindex-dbs"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/db/src/auxiliary-dbs/**"
  - "packages/db/tests/auxiliary-dbs/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 014 handoff

Commit stays on `task/014-global-telemetry-codeindex-dbs`. Do not merge.

## Exports Provided

Public entry: `packages/db/src/auxiliary-dbs/index.ts`.

- `ensureHarnessDataLayout(options?)`, `defaultHarnessDataRoot()`, `assessDataRootPrivacy(root)` — create and describe `%LOCALAPPDATA%\EFHarness\` (`global.db`, `projects/<id>/`, `projects/<id>/backups/`, `projects/<id>/envs/`, `cas/sha256/`, `cas/tmp/`, `wt/`, `components/`, `logs/`). `options.root` relocates the tree for tests and Settings → Storage. `HarnessDataLayout` also exposes `projectStatePath`, `projectTelemetryPath`, and `projectCodeIndexPath`.
- `GlobalBrokerDb.open({ root?, logger?, identity?, now? })` — single-writer `global.db` from `schema/global.sql` (`user_version = 1`, WAL, synchronous FULL, `foreign_keys = ON`, `secure_delete = ON`). Permanent 128-bit hex `deviceId` in `meta`, OS lock on `global.db.lock`, and `meta.owner` (`pid`, `processStartTime`, `epoch`, `hostname`, `acquiredAt`, `role: "broker"`).
- Project registry: `registerProject`, `getProject`, `findProjectByPath`, `listProjects`, `updateProjectPath`, `markProjectOpened`, `markProjectSeen`, `setProjectStatus`, `markProjectOffline`. Status is `ok | needs_migration | needs_repair | offline | removed`. Windows paths are canonicalized before lookup. Offline updates do not delete `cas_pins` or `grants`.
- Settings and machine data: `getSetting`, `setSetting`, `deleteSetting` (JSON values, `json_valid`), `getMachineProfile`, `setMachineProfile`, `getFootprint`, `setFootprint`.
- Ports: `leasePort`, `releasePort`, `expirePortLeases`, `listPortLeases`, `PORT_MIN` (41000), `PORT_MAX` (48999). One transaction deletes expired rows and inserts against `PRIMARY KEY (port)`.
- Research cache: `putResearchCache`, `lookupResearchCache`, `invalidateResearchCache`, `RESEARCH_CACHE_TTL_MS` (90 days). Keyed by package, version range, and doc URL.
- Connections, pins, and grants used by later tasks: `upsertConnection` (rejects `vault_ref` values that start with an API-key prefix; see `assertVaultRef` and `vaultSecretPrefixes`), `getConnection`, `pinBlob`, `listPins`, `insertGrant`, `listGrants`.
- `TelemetryDb.open({ filePath, logger?, now?, queueCap?, flushIntervalMs? })` — per-project `telemetry.db` from `schema/telemetry.sql`, WAL, synchronous NORMAL. `enqueue`, `flush`, `pruneRetention`, `count`, `countByKind`, `readPage`, `stats`, `connectionSettings`. Queue cap `TELEMETRY_QUEUE_CAP` (2000). Flush every `TELEMETRY_FLUSH_INTERVAL_MS` (250) or `TELEMETRY_FLUSH_ROWS` (200) per transaction. Oldest `progress` and `heartbeat` rows are shed under saturation. Retention `TELEMETRY_RETENTION_MS` (14 days). Corrupt files are quarantined beside the project and recreated empty.
- `CodeIndexDb.open({ filePath, logger? })` — per-project `code-index.db` from `schema/code-index.sql`. `upsertCommit`, `linkFile`, `putSymbols`, `putRefs`, `putFileRank`, `symbolsForFile`, `symbolsForCommit`, `refsForName`, `rankingForCommit`, `filesForCommit`, `symbolCount`. Symbols and refs are keyed by file content hash and shared across commits. Corrupt files are quarantined and recreated empty.
- Isolation helpers on each manager: `attachedDatabaseNames`, `verifyIsolatedConnection`. `assertConnectionIsolated` rejects `ATTACH` and any database other than `main` (SQLite's built-in `temp` schema is not an attached file).
- `normalizeProjectPath`, `assertVaultRef`, `vaultSecretPrefixes`, `loadCanonicalSchema`, `schemaTableNames`, `createCollectingLogger`, `createStderrAuxiliaryLogger`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/db/src/index.ts` is outside this task. Integration should re-export the public API above from `packages/db/src/auxiliary-dbs/index.ts` through `@ef-harness/db`.

`packages/db/src/auxiliary-dbs/sqlite-connection.ts` is a local `node:sqlite` stand-in for Task 012. After Task 012 lands, point this package at that `SqliteConnection` / `openDatabase` export instead of the local adapter. Keep ATTACH denied and the global / telemetry / code-index pragma profiles.

Task 013 owns `ProjectStateDb`. Open it on `HarnessDataLayout.projectStatePath`. Do not ATTACH it to `global.db`, `telemetry.db`, or `code-index.db`.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None. Canonical DDL is loaded from `schema/global.sql`, `schema/telemetry.sql`, and `schema/code-index.sql` through `@ef-harness/shared-contracts`.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-014-global-telemetry-codeindex-dbs` on branch `task/014-global-telemetry-codeindex-dbs`.

- `pnpm --filter @ef-harness/db test -- auxiliary-dbs` — pass. Vitest 5.1.1: 5 files, 20 tests passed. Covers canonical SQL bootstrap, `device_id` stability, broker lock, port range and exclusive lease/release, Windows path identity, offline pin/grant preservation, vault-ref rejection, 90-day research cache, 10,000-event telemetry shed, 200-row and 250 ms flushes, 14-day retention, and header-corruption quarantine of `telemetry.db` and `code-index.db` with `state.db` left intact.
- `pnpm --filter @ef-harness/db typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/db lint` — pass (`eslint .`, exit 0).
- `node scripts/verify-harmony.mjs --task 014` — pass. Printed `harmony ok for Task-014` (schema 67/67, diagrams, owned-path scope, workspace typecheck, lint, and tests).

## Known Limitations / Follow-Ups

- Corrupt `global.db` throws `GlobalDatabaseCorruptError` and is left in place. Only `telemetry.db` and `code-index.db` are quarantined and recreated. Rebuilding code-index contents from source files is Task 167.
- The broker lock is a SQLite `BEGIN EXCLUSIVE` on `global.db.lock` (an OS byte-range lock released when the process dies) plus the `meta.owner` row. A second opener gets `BrokerLockHeldError`.
- The local SQLite adapter does not implement Task 012's UDF registration, savepoints, busy-retry helper, or `better-sqlite3` fallback.
- `connection_windows`, `cas_blobs`, and `vocabulary` exist because the canonical schema is applied verbatim. This task does not add repositories for those tables.

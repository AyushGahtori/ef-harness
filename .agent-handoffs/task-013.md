---
task_id: "Task-013"
branch: "task/013-state-db-bootstrap-safemode"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/db/src/state-db/**"
  - "packages/db/tests/state-db/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 013 handoff

`ProjectStateDb` initializes `state.db` from `schema/state.sql`, holds the single writer lock, detects foreign commits with `PRAGMA data_version`, and isolates write failures in safe mode. Commit stays on `task/013-state-db-bootstrap-safemode`.

## Exports Provided

Import from `packages/db/src/state-db/index.ts` until the package barrel is wired:

- `openProjectStateDb(options) -> ProjectStateDb`
- `ProjectStateDb`: `close`, `mode` (`"readwrite" | "readonly"`), `databasePath`, `backupDirectory`, `acquireWriterLock`, `getMeta`, `setMeta`, `checkDataVersion`, `enterSafeMode`, `isSafeMode`, `getSafeModeStatus`, `onSafeMode`, `assertCanDispatch`, `getStreamEpoch`, `bumpStreamEpoch`, `onResyncRequired`, `isIntegrityCheckDue`, `runIntegrityCheckIfDue`, `getUserVersion`, `getProjectRuntime`, `listSchemaMigrations`, `getOwner`
- `SafeModeController`: arms safe mode, publishes the high-priority UI payload, and refuses dispatch and writes with `ProjectSafeModeError`
- Errors: `ProjectSafeModeError(reason, diagnostics)`, `ReadOnlyDatabaseError`, `DatabaseVersionTooNewError` (`dbVersion`, `supportedVersion`, `backupDirectory`), `DatabaseSchemaVersionError`, `ClosedDatabaseError`, `WalModeRequiredError`, `WorldReadableProjectPathError`
- `APP_SUPPORTED_SCHEMA_VERSION` (1), `META_KEYS`

`OpenProjectStateDbOptions`: `projectId`, `rootDir?`, `logger?`, `now?`, `appVersion?`, `supportedSchemaVersion?`, `beforePublish?`, `onSafeMode?`, `onResyncRequired?`.

Lifecycle:

1. `openProjectStateDb` resolves `%LOCALAPPDATA%\EFHarness\projects\<project-id>\` (`rootDir` overrides the harness root in tests). The same `projectId` in one process returns the existing handle.
2. A missing `state.db` is built in `state.db.init.tmp` (schema, seeds, `PRAGMA user_version = 1`, `COMMIT`, close) and renamed into place. A crash before the rename never leaves a partial file at `state.db`.
3. The writer keeps `state.db.lock` open under `BEGIN IMMEDIATE` (the OS exclusive lock) and writes `meta.owner` as `{ pid, processStartTime, epoch, hostname, acquiredAt }` inside `BEGIN IMMEDIATE` on `state.db`.
4. A second process whose lock acquire is busy opens `state.db` with `query_only = ON` and `mode: "readonly"`. Writes throw `ReadOnlyDatabaseError` before SQLite is called.
5. A stale owner (dead PID, or a live PID whose creation time differs) is reclaimed, `owner.epoch` increments, and `state_db.writer_lock.reclaimed` is logged. A live owner with a matching creation time is not stolen.
6. After every coordinator commit the connection caches `PRAGMA data_version`. The next mutating call re-reads it. A change runs `PRAGMA quick_check` and enters safe mode.
7. `SafeModeController` enters safe mode on a foreign `data_version` change, `SQLITE_FULL` / `SQLITE_IOERR` (`disk_io_error`), or `SQLITE_CORRUPT` / a failed `quick_check` or `integrity_check` (`corrupt`). Dispatch and writes throw `ProjectSafeModeError`. Worktrees and checkpoints are not modified. `onSafeMode` receives `{ priority: "high", dispatchBlocked: true, writesBlocked: true, reason, diagnostics }`.
8. Every open runs `PRAGMA quick_check`. `last_integrity_check_at` is stored so the daemon can call `runIntegrityCheckIfDue` weekly at idle.
9. `bumpStreamEpoch("rehydrated" | "restored")` increments `meta.stream_epoch` and emits `resync_required`.

`meta` keys: `project_id`, `stream_epoch` (initial 1), `last_rev` (initial 0), `writer_epoch` (initial 1), `created_at`, `owner`, `last_integrity_check_at`, `safe_mode`, `safe_mode_reason`, `safe_mode_diagnostics`.

Bootstrap also inserts `project_runtime(id=1, state='DISCOVERY', paused=0, updated_rev=0)` and `schema_migrations` version 1 (`state-schema-v1`, `additive`). `user_version` above `APP_SUPPORTED_SCHEMA_VERSION` throws `DatabaseVersionTooNewError` and points at `<project>/backups` before any application query.

## Shared Wiring Needs (Root / Index Barrels)

`packages/db/src/index.ts` is frozen by Task 001. Please re-export the symbols listed above from that barrel:

```ts
export {
  APP_SUPPORTED_SCHEMA_VERSION,
  DatabaseVersionTooNewError,
  META_KEYS,
  ProjectSafeModeError,
  ProjectStateDb,
  ReadOnlyDatabaseError,
  SafeModeController,
  openProjectStateDb,
} from "./state-db/index.js";
```

`apps/daemon` should pass Task 011 `StructuredLogger` as `options.logger` and subscribe with `onSafeMode` for the UI status payload. No root manifest or `packages/shared-contracts/src/index.ts` edit is required.

## Dependency Intents (New Packages Requested)

None. Runtime dependencies stay `@ef-harness/shared-contracts` plus Node built-ins (`node:sqlite`, `node:fs`, `node:child_process`).

## Contract Change Requests

None. `schema/state.sql` is loaded verbatim and was not edited. `ef_search_text` is registered on the connection before that SQL runs, using the same camelCase / separator split as Task 007 until `SqliteConnection` from Task 012 is on this branch.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-013-state-db-bootstrap-safemode`.

```text
pnpm --filter @ef-harness/db test -- state-db
```

Result: 1 file passed, 20 tests passed. Covered atomic bootstrap from `schema/state.sql`, meta seeds, `project_runtime` id 1, `user_version === 1`, partial-init discard, read-only external inspection (no safe mode), external commit detected via `PRAGMA data_version` then `quick_check` and safe mode, disk-full rollback (`SQLITE_FULL`) into `disk_io_error`, dual-process read-only fallback, stale-lock reclaim with incremented `owner.epoch` after the holder was killed, live-owner refusal, corrupt page safe mode, `stream_epoch` `resync_required`, and weekly `integrity_check`.

```text
pnpm --filter @ef-harness/db typecheck
```

Result: exit 0.

```text
pnpm --filter @ef-harness/db lint
```

Result: exit 0.

```text
node scripts/verify-harmony.mjs --task 013
```

Result: exit 0, `harmony ok for Task-013`. The commit command runs the same check with `--require-ready`.

## Known Limitations / Follow-Ups

- Task 012 `SqliteConnection` is not on this branch. `state-db` opens `node:sqlite` directly, applies the writer pragmas (`WAL`, `synchronous=FULL`, `foreign_keys`, `busy_timeout=5000`, `secure_delete`, `journal_size_limit=67108864`, `temp_store=MEMORY`), registers `ef_search_text` before schema SQL, and rejects `ATTACH DATABASE`. When Task 012 lands, route these opens through `openDatabase({ role: "state" })` without changing `ProjectStateDb`'s public methods.
- Task 011 `StructuredLogger` is not on this branch. The injected logger is structural (`info` / `warn` / `error`). The default logger writes one JSON line to stderr and does not rotate files. The daemon should inject the real logger.
- If `state.db` is malformed, the `safe_mode` meta row may not persist (`state_db.safe_mode.persist_failed`). The open handle still refuses writes with `ProjectSafeModeError(reason: "corrupt")`. The next open detects the corruption again.
- The exclusive lock is the SQLite reserved lock on `state.db.lock`, held by a connection that stays open for the life of the writer. Windows releases that OS lock when the process is killed.
- Full `PRAGMA integrity_check` is exposed as `runIntegrityCheckIfDue` for the daemon's idle loop. Opening a project runs `quick_check` only.

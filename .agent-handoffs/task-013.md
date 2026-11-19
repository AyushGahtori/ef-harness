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

`ProjectStateDb` initializes `state.db`, holds the single writer lock, detects foreign commits with `PRAGMA data_version`, and refuses dispatch and writes in Safe Mode. Commit stays on `task/013-state-db-bootstrap-safemode`.

## Exports Provided

Import from `packages/db/src/state-db/index.ts` until the package barrel is wired:

- `SafeModeController` arms Safe Mode, refuses dispatch and writes, and emits the high-priority status payload
- `openProjectStateDb(options) -> ProjectStateDb`
- `ProjectStateDb` with `mode` (`"readwrite"` | `"readonly"`), `acquireWriterLock`, `checkDataVersion`, `enterSafeMode`, `isSafeMode`, `getSafeModeStatus`, `assertCanDispatch`, `getMeta`, `setMeta`, `getOwner`, `getStreamEpoch`, `bumpStreamEpoch` (returns `resync_required`), `isIntegrityCheckDue`, `runIntegrityCheckIfDue`, `getUserVersion`, `getProjectRuntime`, `listSchemaMigrations`, `evaluateSearchText`, `close`
- Errors: `ProjectSafeModeError`, `ReadOnlyDatabaseError`, `DatabaseVersionTooNewError`, `DatabaseSchemaVersionError`, `WalModeRequiredError`, `ClosedDatabaseError`, `WorldReadableProjectPathError`, `AttachedDatabaseForbiddenError`, `NestedWriteTransactionError`
- `APP_SUPPORTED_SCHEMA_VERSION` is `1`
- `StateDbLogger` is the structural logger (`info` / `warn` / `error`) accepted at open

Safe Mode reasons are `foreign_write`, `disk_io_error`, and `corrupt`. The status payload is `{ priority: "high", dispatchBlocked: true, writesBlocked: true, worktreesPreserved: true, checkpointsPreserved: true }`. Subscribe with `onSafeMode` or the `onSafeMode` open option. `bumpStreamEpoch("rehydrated" | "restored")` notifies `onResyncRequired`.

### Meta key registry

| Key | Seed | Writer |
| --- | --- | --- |
| `project_id` | project id | bootstrap |
| `stream_epoch` | `1` | `bumpStreamEpoch` |
| `last_rev` | `0` | later knowledge commits |
| `writer_epoch` | `1` | owner reclaim increments it with `owner.epoch` |
| `created_at` | epoch ms | bootstrap |
| `owner` | JSON `{ pid, processStartTime, epoch, hostname, acquiredAt }` | lock acquisition |
| `last_integrity_check_at` | absent until the first weekly run | `runIntegrityCheckIfDue` |
| `safe_mode` | `1` while Safe Mode is persisted | `enterSafeMode` |
| `safe_mode_reason` | reason string | `enterSafeMode` |
| `safe_mode_diagnostics` | JSON diagnostics | `enterSafeMode` |

### Lifecycle

1. Resolve `%LOCALAPPDATA%\EFHarness\projects\<project-id>\` (`rootDir` overrides the EFHarness root in tests). Public and ProgramData paths are rejected.
2. Take an exclusive lock by holding `BEGIN IMMEDIATE` on `state.db.lock` until `close`. A busy lock opens `state.db` with `query_only = ON` and `mode: "readonly"` and does not steal the lock.
3. A missing `state.db` is built in `state.db.init.tmp` from `schema/state.sql` inside one `BEGIN IMMEDIATE`, seeded, checkpointed, closed, then renamed with `EPERM` / `EBUSY` / `EACCES` retries. A crash before rename never leaves a partial file at `state.db`.
4. `PRAGMA user_version` is read before any query. A newer version throws `DatabaseVersionTooNewError` with `projects/<id>/backups`.
5. The owner row is reclaimed when the recorded PID is dead, or alive with a different process creation time. Reclaim increments `owner.epoch` and logs `state_db.writer_lock.reclaimed`.
6. `PRAGMA quick_check` runs on every open. `last_integrity_check_at` makes `runIntegrityCheckIfDue` run `PRAGMA integrity_check` once a week.
7. Before each later write, `PRAGMA data_version` is compared with the value cached after the last coordinator commit. A foreign commit runs `quick_check` and enters Safe Mode. `SQLITE_FULL`, `SQLITE_IOERR`, and `SQLITE_CORRUPT` roll back and enter Safe Mode. No write method returns success after those failures.

The same `projectId` opened twice in one process returns the existing handle.

## Shared Wiring Needs (Root / Index Barrels)

`packages/db/src/index.ts` is outside this task's write scope. Re-export `openProjectStateDb`, `ProjectStateDb`, the error classes, `APP_SUPPORTED_SCHEMA_VERSION`, `META_KEYS`, and `StateDbLogger` from that barrel when integrating.

`openProjectStateDb` should receive Task 011 `StructuredLogger` as `options.logger`. The structural `StateDbLogger` methods match `info` / `warn` / `error`.

## Dependency Intents (New Packages Requested)

None. No package manifest changes.

Task 012 `SqliteConnection` and Task 011 `StructuredLogger` are not on `harness/integration` (base `649773097c387ae534b686ea5825f449f843aa7c`). This task opens `node:sqlite` inside `packages/db/src/state-db/` with the writer PRAGMAs (`WAL`, `synchronous = FULL`, `foreign_keys = ON`, `busy_timeout = 5000`, `secure_delete = ON`, `journal_size_limit = 67108864`, `temp_store = MEMORY`), read-only `query_only`, deterministic `ef_search_text`, `BEGIN IMMEDIATE`, and `ATTACH DATABASE` rejection. When Task 012 lands, replace `openStateConnection` with `openDatabase` / `SqliteConnection` and register Task 007 `splitSearchText` through that driver. The local `ef_search_text` matches `schema/schema-test.js` until that wiring exists.

## Contract Change Requests

None.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-013-state-db-bootstrap-safemode`.

- `pnpm --filter @ef-harness/db typecheck` — passed (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/db lint` — passed (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/db test -- state-db` — passed, 17 tests, 1 file, exit 0. Covers atomic bootstrap, meta seed, `project_runtime` singleton, `user_version === 1`, partial-init discard, interrupted rename, newer and zero `user_version`, dead-PID and PID-reuse epoch reclaim, read-only inspection not entering Safe Mode, foreign commit entering Safe Mode after `quick_check`, disk-full rollback into `disk_io_error`, `stream_epoch` resync, weekly `integrity_check`, read-only and closed guards, private-path rejection, rename retry, `ATTACH` rejection, nested `BEGIN IMMEDIATE`, and the dual-process lock fallback plus stale reclaim.
- `node scripts/verify-harmony.mjs --task 013` — passed (`harmony ok for Task-013`, exit 0). This also runs the schema suite, diagram check, `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Known Limitations / Follow-Ups

- Safe Mode is sticky. This task does not clear it; corruption recovery and migration restore belong to later tasks.
- `applyStorageCeiling` exists so tests can raise real `SQLITE_FULL` without filling the disk.
- The writer lock is SQLite's reserved lock on `state.db.lock` (`BEGIN IMMEDIATE`, `busy_timeout = 0`), held until `close` or process death. That is the OS lock SQLite takes for the file.
- A second open of the same `projectId` in-process returns the first handle even if `rootDir` differs. Use one id per open database.
- If Safe Mode cannot persist because the disk is full, the in-memory flag still rejects writes, but a later process will not see `safe_mode` until a durable flag can be written.

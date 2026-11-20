---
task_id: "Task-016"
branch: "task/016-backups-corruption-recovery"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/db/src/recovery/**"
  - "packages/db/tests/recovery/**"
  - ".agent-handoffs/task-016.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 016 handoff

Automated `VACUUM INTO` backups and the 4-step corruption recovery engine. Commit stays on `task/016-backups-corruption-recovery`.

Import from `packages/db/src/recovery/index.ts`. `packages/db/src/index.ts` is frozen by Task 001 and is not modified here.

## Exports Provided

Runtime values:

- `BackupScheduler` — `backupHourly()`, `backupDaily()`, `backupPreMigration(tag)`
- `CorruptionRecoveryEngine` — `onProjectOpen()`, `onDailyIdle()`, `onWeekly()`, `onRuntimeError(error)`, `recover(schedule, detectedCode)`
- `ReplaySourceAdapter` — `loadKnowledgeChangeSets`, `findAcceptedCommitsSince`, `parkInFlightAtCheckpoints`
- `FilesystemReplaySourceAdapter` — file-backed adapter for `history/*.jsonl`, Git trailers, and `refs/harness/checkpoints/*`
- `salvageCorruptDatabase(sourcePath, outputPath)`
- `restoreNewestGoodBackup(...)`
- `replayPostBackupState(...)`
- `recreateRebuildableDatabase(...)` — clean rebuild of `telemetry.db` or `code-index.db` only
- `evaluateSchemaInvariants(db)`
- `ManualClock`, `SystemClock`, `immediateSleeper`, `HOUR_MS`, `DAY_MS`
- `withRotationLock`, `renameWithRetry`
- `parseHarnessTrailers`, `findAcceptedCommitsSince`, `selectNewestCheckpointParks`, `readHistoryChangeSets`
- `RecoveryError`

Types: `RecoveryReport`, `ReplaySourceAdapter`, `BackupCadence`, `BackupWriteResult`, `WrittenBackup`, `SkippedBackup`, `Clock`, `Sleeper`, `ProjectStateDb`, `GlobalBrokerDb`, `ReplayedChangeSet`, `ReverificationTask`, `ParkedAttempt`, `UnrecoveredGap`, `SpendGapWindow`, `InvariantReport`, `SalvageResult`, `RestoreResult`.

`RecoveryReport` always has `safeMode: true` once recovery runs. Fields consumers should rely on:

| Field | Meaning |
| --- | --- |
| `outcome` | `salvaged`, `restored`, `rehydrated`, or `manual_salvage` |
| `recoveredRevision` | `meta.last_rev` after salvage, restore, and history replay |
| `backupId` / `backupAt` | Newest healthy backup used, or null when none was |
| `streamEpoch` | `meta.stream_epoch` after it is incremented |
| `replayedChangeSets` | History segments applied or rejected after `backup.last_rev` |
| `tasksQueuedForReverification` | Commits carrying `Harness-Task` / `Harness-Checks` since the backup |
| `parkedAttempts` | Newest `refs/harness/checkpoints/<task>/<attempt>` per task |
| `spendGapEstimated` | `true` unless salvage kept the live database |
| `spendGapWindow` | `{ backupAt, crashDetectedAt }` when the gap is estimated. No dollar total is invented |
| `unrecoveredGaps` | Explicit knowledge, turn, git, and spend gaps |
| `skippedCorruptBackups` | Backup filenames that failed `quick_check` or `foreign_key_check` |
| `quarantinedPath` | `backups/corrupt-<ts>/` holding the original `state.db`, `-wal`, and `-shm` |
| `telemetryRebuilt` / `codeIndexRebuilt` | Those files were recreated from schema, not restored from a backup |

Backup files live in `projects/<id>/backups/`:

- `hourly-<16-digit-ms>-<seq>.db` — newest 24
- `daily-<16-digit-ms>-<seq>.db` — newest 7
- `pre-migration-<tag>-<16-digit-ms>-<seq>.db` — kept, not rotated

Each backup is written to `<name>.tmp.db`, checked with `PRAGMA quick_check` and `PRAGMA foreign_key_check`, then renamed into place. `cas_pins(hash, holder_kind='backup', holder_id='<projectId>-backup-<backupId>', pinned_at)` are inserted in `global.db` before that rename and before an older file is deleted. Rotation deletes the file and then its pin rows. Hashes come from `artifacts.hash` in the backup. `telemetry.db` and `code-index.db` throw `backup_not_applicable` if a scheduler is pointed at them.

Hourly backups run only when an hour has elapsed and `meta.last_rev` or a runtime table changed since the previous hourly backup. A project that has never had work (`last_rev` empty or `0`, runtime tables empty) skips with `{ status: 'skipped', reason: 'idle' }` and does not create a file. Pass `ManualClock` and `immediateSleeper` so retention tests do not sleep.

Recovery holds the same in-process rotation lock as the scheduler for that backups directory, so a scan cannot delete the file it is validating. Renames retry 10 times on `EPERM` / `EBUSY` / `EACCES`, waiting 50 ms, 100 ms, 200 ms, 400 ms, 800 ms, then 1 s.

Salvage copies readable tables into a fresh `state.sql` database. It is accepted only when lookup seeds, `quick_check`, `foreign_key_check`, `rollup_drift`, requirement rollup recount, `outbox_without_deliveries`, `relations_in_fields`, and `nodes_version_guard` all pass. A `quick_check` pass with a foreign-key or domain failure is rejected and Step 2 runs. `state.db-wal` and `state.db-shm` are quarantined before the restored file becomes `state.db`. The corrupt database is moved, not deleted.

Detection: `PRAGMA quick_check` on project open and daily idle, `PRAGMA integrity_check` weekly, and `SQLITE_CORRUPT` / `SQLITE_NOTADB` (`errcode` 11 or 26, or the usual messages) enter safe mode and run recovery. Safe mode writes `<project>/safe-mode.json` and sets `projects.status` to `needs_repair` in `global.db`. A healthy database returns `null` from the detect methods and does not write that file.

When no healthy backup exists, recovery quarantines the corrupt file, creates a fresh `state.db`, and replays `history/*.jsonl`. If there is no history either, `outcome` is `manual_salvage` and `summary` is `Manual salvage / fresh re-init`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/db/src/index.ts` is frozen. Integration should re-export the recovery barrel:

```ts
export {
  BackupScheduler,
  CorruptionRecoveryEngine,
  FilesystemReplaySourceAdapter,
  ManualClock,
  RecoveryError,
  evaluateSchemaInvariants,
  findAcceptedCommitsSince,
  parseHarnessTrailers,
  recreateRebuildableDatabase,
  replayPostBackupState,
  restoreNewestGoodBackup,
  salvageCorruptDatabase,
} from "./recovery/index.js";
export type {
  Clock,
  GlobalBrokerDb,
  ProjectStateDb,
  RecoveryReport,
  ReplaySourceAdapter,
  Sleeper,
} from "./recovery/index.js";
```

Task 013 and Task 014 own the concrete database classes. This task only needs `{ projectId, filePath }` and `{ filePath }`. Task 039 should supply Git commits and checkpoint refs through `ReplaySourceAdapter` (or `FilesystemReplaySourceAdapter`'s `commits` / `checkpoints` / `git` hooks). Task 187 should pass the `harness-state` `history/` directory. Task 133 can export `quarantinedPath`. Task 192 can read `RecoveryReport` and `projects.status = 'needs_repair'`.

## Dependency Intents (New Packages Requested)

None. Recovery uses `node:sqlite`, `node:fs`, `node:crypto`, and `node:child_process`. No package was added.

## Contract Change Requests

None. `cas_pins`, `projects.status`, and `meta.stream_epoch` / `meta.last_rev` are used as already defined in `schema/global.sql` and `schema/state.sql`.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-016-backups-corruption-recovery`:

- `pnpm --filter @ef-harness/db test -- recovery` — passed, 4 files, 15 tests (rotation of 24 hourly and 7 daily backups, CAS pin before expose and unpin on rotation, idle hourly skip, corrupt-backup skip, WAL quarantine, `stream_epoch` bump, replay report, telemetry and code-index rebuild). `sqlite3` is not on PATH; salvage uses the table-by-table fallback and does not spawn a missing CLI.
- `pnpm --filter @ef-harness/db typecheck` — passed (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/db lint` — passed (`eslint .`).
- `node scripts/verify-harmony.mjs --task 016` — passed (`harmony ok for Task-016`). That command also re-ran repository `typecheck`, `lint`, and `test`.

## Known Limitations / Follow-Ups

- The sqlite3 `.recover` dump runs only when PATH contains a real, non-empty `sqlite3` executable outside `WindowsApps`. A missing CLI is not spawned. Salvage then uses deterministic table-by-table copy and still rejects the file unless every schema invariant passes.
- The rotation lock is in-process for one backups directory. Two OS processes are not coordinated.
- History replay applies each change set in its own transaction. A change set that violates a trigger is reported in `unrecoveredGaps` and does not abort the rest of the report.
- Spend and turns between the backup and the crash are flagged with a time window only. Exact currency totals are not reconstructed.
- Pre-migration backups are not deleted by retention. Hourly and daily retention does not remove them.
- Cadence memory is `backups/.scheduler-state.json` (`lastHourlyAt`, `lastDailyAt`, `lastHourlyFingerprint`). Deleting that file makes the next due hourly backup write once, then idle detection resumes.
- `telemetry.db` and `code-index.db` are recreated from `schema/telemetry.sql` and `schema/code-index.sql` when corrupt. Their previous rows are not restored.

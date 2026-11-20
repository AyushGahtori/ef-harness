---
task_id: "Task-015"
branch: "task/015-db-migration-engine"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/db/src/migrations/**"
  - "packages/db/tests/migrations/**"
  - ".agent-handoffs/task-015.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 015 handoff

Commit stays on `task/015-db-migration-engine`. Do not merge.

## Exports Provided

Import from `packages/db/src/migrations/index.ts`.

- `MigrationRunner` — daemon startup migrates `global.db` only (`migrateOnStartup` / `migrateGlobalDatabase`); each project `state.db` migrates lazily on `openProject` / `migrateProject`.
- `migrateDatabase` — strict 6-step forward-only sequence: parked work, `WorkerReaderPool.drainAndClose`, exclusive lock, timestamped `VACUUM INTO` backup (quick-checked before any DDL, CAS pins registered for a project database), one transaction per pending migration, then `PRAGMA quick_check`, `PRAGMA foreign_key_check`, and `nodes.nid INTEGER PRIMARY KEY`. `PRAGMA user_version` and the `schema_migrations` audit row (`version`, `name`, `kind`, `app_version`, `applied_at`) commit with that migration.
- `MigrationDefinition` — `kind` (`'additive' | 'rebuild' | 'data'`), sequential integer `version`, `name`, `targetDb` (`'global' | 'state'`), `apply(conn)`, optional `check(conn)`.
- `runTwelveStepRebuild` — `PRAGMA foreign_keys = OFF` outside the transaction, `BEGIN IMMEDIATE`, create/copy/drop/rename, recreate snapshotted indexes, triggers, views, and dependent virtual tables, `PRAGMA foreign_key_check` (rollback on any row), commit, `PRAGMA foreign_keys = ON` in `finally`. Rebuilding `nodes` runs `INSERT INTO kb_ident(kb_ident) VALUES('rebuild')` and repopulates `kb_words` from `nodes` through `ef_search_text`, then checks both index counts and camelCase / trigram hits.
- `rehearseMigration(dbPath, migrations, options)` — `VACUUM INTO` a temporary clone, migrates the clone, and leaves the source database, its WAL, and its journal unchanged.
- needs_repair helpers: `markProjectNeedsRepair`, `listNeedsRepairProjects`, `readProjectStatus`, `connectGlobalBrokerDb`. A failed project migration restores the `VACUUM INTO` backup (Windows `EPERM` / `EBUSY` / `EACCES` rename retries, 50 ms to 1 s, 10 tries, after deleting `-wal` / `-shm` / `-journal`) and sets `projects.status = 'needs_repair'` with options `Retry`, `Export`, `Report` (`REPAIR_OPTIONS`). Other projects and `global.db` stay up.
- `DatabaseNewerThanAppError` — `PRAGMA user_version` above the app's max known version refuses the open, lists `backups/pre-migration-*.db`, and does not modify the file.
- `productionMigrations` is empty and `PRODUCTION_SCHEMA_VERSION` is `1`. Synthetic v2/v3 migrations exist only under `packages/db/tests/migrations/`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/db/src/index.ts` is outside this task's owned subtree and still exports only the package identity. When an integrator can edit that barrel, re-export the migration engine:

```ts
export {
  MigrationRunner,
  migrateDatabase,
  rehearseMigration,
  runTwelveStepRebuild,
  markProjectNeedsRepair,
  listNeedsRepairProjects,
  readProjectStatus,
  connectGlobalBrokerDb,
  PRODUCTION_SCHEMA_VERSION,
  productionMigrations,
  REPAIR_OPTIONS,
} from "./migrations/index.js";
export type {
  MigrationDefinition,
  MigrationOutcome,
  MigrationSuccess,
  NeedsRepairResult,
  TwelveStepRebuildPlan,
} from "./migrations/index.js";
```

No root `package.json` or workspace wiring changes.

## Dependency Intents (New Packages Requested)

None. The engine uses `node:sqlite` (`DatabaseSync`) already available in the Node 22 runtime.

## Contract Change Requests

None. `MigrationDefinition`, `SqliteConnection`, and `GlobalBrokerDb` live in `packages/db/src/migrations/types.ts` so Task 012 / Task 013 / Task 014 can adapt to them without a `packages/shared-contracts` edit.

## Exact Verification Commands & Results

```
pnpm --filter @ef-harness/db test -- migrations
```

`vitest run --config vitest.config.ts migrations` — 3 files, 21 tests passed (forward additive v1→v2 and 12-step rebuild v2→v3 with FTS5 repopulation and `schema_migrations` rows; injected failure restores the `VACUUM INTO` backup bit-for-bit, marks project A `needs_repair`, leaves project B `ok`; v99 `DatabaseNewerThanAppError` lists backup paths and does not modify the file; `foreign_key_check` failure restores; plus disk-space, reader, downgrade, registry, rehearsal, and rename-retry coverage).

```
pnpm --filter @ef-harness/db typecheck
```

`tsc -b --pretty false` — passed.

```
pnpm --filter @ef-harness/db lint
```

`eslint .` — passed.

```
node scripts/verify-harmony.mjs --task 015
```

`harmony ok for Task-015` (exit 0). The script also ran repo `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Known Limitations / Follow-Ups

- Package barrel re-export is listed under Shared Wiring Needs; this task cannot edit `packages/db/src/index.ts`.
- Production schema stays at version 1. Real v2 DDL belongs to a later task; this engine only ships the runner plus test-only synthetic migrations.
- Byte-level page corruption and backup rotation remain Task 016. This task restores the pre-migration `VACUUM INTO` snapshot when a migration throws or `quick_check` / `foreign_key_check` fails.

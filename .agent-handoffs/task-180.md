---
task_id: "Task-180"
branch: "task/180-expand-contract-migrations"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/ship-deploy/src/live-migrations/**"
  - "packages/ship-deploy/tests/live-migrations/**"
  - ".agent-handoffs/task-180.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 180 handoff

Six-phase expand-then-contract production migration engine. Commit stays on `task/180-expand-contract-migrations`. Never merge.

## Exports Provided

Import from `packages/ship-deploy/src/live-migrations/index.ts`:

- `ExpandContractMigrationOrchestrator` — durable `REHEARSE → BACKUP → EXPAND → APP_DEPLOY → BACKFILL → CONTRACT` state machine. Phases 5 and 6 become `not_applicable` when the deploy is additive-only.
- `DdlSafetyClassifier` — classifies every statement as `SAFE_ADDITIVE`, `LOCK_HAZARD`, or `DESTRUCTIVE_CONTRACT` and rejects destructive SQL in Phase 3.
- `PausableBatchedBackfillRunner` — keyset batches of 500–1,000 rows, durable `{ lastProcessedPk, rowsProcessed, rowsRemainingEst, batchErrors }`, idempotent `WHERE target IS NULL`.
- `ContractPhaseExportGuard` — blocks contract until remaining rows are 0, no deprecated-object readers remain, a verified CSV/JSONL/SQL archive exists, and a payload-bound destructive approval card lists the `DROP` statements and archive path.

Errors callers should catch: `BackupRequiredBeforeLiveMigrationError`, `BackfillIncompleteError`, `DestructiveDdlInExpandError`, `LockHazardBlockedError`, `RehearsalCompatibilityError`, `ApprovalRequiredError`, `ExportRequiredBeforeContractError`, `ActiveDeprecatedReferenceError`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/ship-deploy/src/index.ts` is outside this task's owned paths. When the barrel is free to edit, re-export:

```ts
export {
  ContractPhaseExportGuard,
  DdlSafetyClassifier,
  ExpandContractMigrationOrchestrator,
  PausableBatchedBackfillRunner,
} from "./live-migrations/index.js";
```

Sibling tasks 052, 110, 120, 176, 179, and 181 are not on this base. The engine binds them through local ports in `packages/ship-deploy/src/live-migrations/ports.ts`. No TCP port is opened. Tests use temp SQLite files only.

| Sibling contract | Local port | Wiring |
| --- | --- | --- |
| `TemplateDbSeeder` (Task 052) | `LocalTemplateDbSeeder` | Deterministic primary-key seed for the rehearsal clone |
| `MigrationIntentAndConflictLinter` (Task 110) | `PermissiveMigrationLinter` | Inject `conflicts` to block before Phase 1 |
| `WindowsDpapiSecretsVault` (Task 120) | `MapDatabaseVault` | Returns a non-secret locator (`secretId`, `env`, `locator`). No secret bytes are written to state, effects, or logs |
| `ExternalEffectLedger` (Task 176) | `MigrationStateStore.record/update` | Writes the frozen `effects` table before expand, deploy, rollback, and contract |
| `EnvApprovalPolicyEngine` (Task 176) | `PayloadBoundApprovalPolicy` | SHA-256 of the canonical approval payload. Production and staging require a matching approval. Preview auto-approves non-destructive steps. Contract always requires an explicit card |
| `DeployAdapter` (Task 179) | caller-supplied `deploy(env, commitSha, effectId)` and `rollback(env, targetDeploymentId, effectId)` | Phase 4 |
| Post-deploy health (Task 181) | caller-supplied `PostDeployHealthCheck.verify` | Unhealthy Phase 4 rolls the app back and re-proves App N-1 against the additive schema |
| Backup | SQLite online backup API, or `pgDumpArgs` (`pg_dump --format=custom`) | Inject `BackupProvider` for host snapshots. A clean written PITR attestation is the only override when backup fails |

`schema/state.sql` is frozen, so the store reads it from the repo path (the `shared-contracts` barrel points at `dist/`, which is not built on this base) and creates two additive tables in that same `state.db`: `live_migration_runs` and `live_migration_backfill_cursors`. It also writes `ship_runs.kind = 'migration'`.

## Dependency Intents (New Packages Requested)

None. Runtime dependencies already on the base are `node:sqlite`, `node:crypto`, and `node:fs`.

## Contract Change Requests

When `schema/state.sql` is unfrozen, adopt `live_migration_runs` and `live_migration_backfill_cursors` so the phase machine and keyset cursor are not created beside the frozen schema. `ship_runs.status` cannot store `paused` or `not_applicable`; those values live in `phase_json`, and `ship_runs.status` stays `running`, `passed`, `failed`, or `rolled_back`.

## Exact Verification Commands & Results

- `pnpm --filter @ef-harness/ship-deploy test -- live-migrations` — 2 files, 15 tests passed (classifier split; 5,000-row six-phase run with pause/resume at pk 2500 and zero duplicate updates; backup failure hard-block; PITR override; Postgres `lock_timeout` retry; N-1 rehearsal failure; Phase 4 rollback; Phase 6 blocks on 420 remaining rows, active readers, and a failed export).
- `pnpm --filter @ef-harness/ship-deploy typecheck` — passed.
- `pnpm --filter @ef-harness/ship-deploy lint` — passed.
- `node scripts/verify-harmony.mjs --task 180` — passed (`harmony ok for Task-180`). Schema 67/67, diagram check, workspace typecheck, lint, and package tests were included.

## Known Limitations / Follow-Ups

- Postgres `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block, so that one statement uses session `SET lock_timeout = '3000ms'`. Every other Postgres DDL statement is wrapped in `BEGIN` / `SET LOCAL lock_timeout = '3000ms'` / `SET LOCAL statement_timeout = '30000ms'` with up to 3 jittered retries. SQLite live DDL sets `PRAGMA busy_timeout = 3000`.
- Phase 1 proves App N-1 and App N against the expanded schema on a local SQLite clone. Destructive statements are quarantined out of that clone. Pass `rehearsalSession` to rehearse on another engine.
- Lock-hazard statements are blocked with a rewrite plan (`CONCURRENTLY`, nullable add plus `NOT VALID` check). They are not silently rewritten on the production connection.
- This branch is not merged.

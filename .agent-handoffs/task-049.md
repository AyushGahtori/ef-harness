---
task_id: "Task-049"
branch: "task/049-test-env-orchestrator-core"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/test-env/src/orchestrator/**"
  - "packages/test-env/tests/orchestrator/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 049 handoff

Test environment orchestrator core: manifests, machine-wide port leases, `*.localhost` isolation, readiness probes, admission, and idempotent Job teardown. Commit stays on `task/049-test-env-orchestrator-core`.

## Exports Provided

Import from `packages/test-env/src/orchestrator/index.ts` until the package barrel is wired:

- `TestEnvOrchestrator` — `create(kind, manifest, baseCommit, worktreePath)`, `reconcileOnStartup({ liveEnvironmentIds, workspaceRoots })`
- `EnvironmentHandle` — `vars()`, `start_app()`, `start_service(name)`, `reset_data()`, `destroy()`
- `EnvironmentManifest`, `EnvironmentManifestSchema.parse`, `AppSpec`, `ServiceSpec`
- `ServiceProvider`, `ServiceProvisionContext`, `ServiceProvisionResult`, `ServiceProviderRegistry`
- `selectProvisioningTier`, `selectProvisioning` — Tier 0 starts nothing, Tier 1 keeps in-process sqlite, Tier 2 shares servers with an isolated namespace, Tier 3 is the migration/private-schema tier. An explicit manifest `tier` is a ceiling.
- `WindowsJobManager`, `JobHandle`, `JobLimits`, `JobAccounting`, `CreateJobRequest`, `EnvProcessRecord`, `OrphanReconcileReport` — consumed from Task 040. `create` opens a nested `kind: "environment"` job with `killOnJobClose: true`.
- `PortLeaseStore`, `SqlitePortLeaseStore`, `openGlobalDatabase`, `ensureBrokerProject` — leases `global.db.port_leases` in `41000–48999`, skipping ports that fail a `127.0.0.1` bind.
- `EnvProcessStore`, `SqliteEnvProcessStore`, `openStateDatabase` — writes `state.db.env_processes`.
- `HardwareAdmissionGate`, `admitAllEnvironments` — queried before every stateful create. Task 118 supplies the real governor.
- `SecretVault`, `MapSecretVault` — `{secret.<name>}` resolves in memory. Raw vault entries are added to the child environment only for `verifier` and `preview`.
- `AppIgnoresPortError`, `MissingEnvironmentSecretError`, `ChildExitedBeforeReadyError`, `ReadinessTimeoutError`, `EnvironmentAdmissionDeniedError`
- `parseReadinessProbe`, `waitForReady` — `http GET <path> == <status>`, `tcp`, and `stdout /pattern/`, default timeout 30s, immediate fail on child exit.
- `removeDirectoryWithBusyRetry` — waits for `ActiveProcesses === 0`, then retries Windows `EBUSY` / `EPERM` / `ENOTEMPTY`.

Each environment gets `env-<shortId>.localhost`, its own ports, `env_<shortId>` database name, and `temp` / `upload` / `build-output` under `<worktree>/.ef-harness-env/<envId>/`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/test-env/src/index.ts` is outside this task's write scope. Please re-export `./orchestrator/index.ts` from that barrel so Tasks 048, 050, 051, 052, 060, and 160 can import `@ef-harness/test-env`.

No root manifest or workspace change.

## Dependency Intents (New Packages Requested)

None. Manifest YAML is a small parser. Ports and process rows use `node:sqlite` against `schema/global.sql` and `schema/state.sql`.

## Contract Change Requests

None. `port_leases` and `env_processes` are used as already defined. No edit to `packages/shared-contracts`.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-049-test-env-orchestrator-core`:

- `pnpm --filter @ef-harness/test-env test -- orchestrator` — 3 files, 21 tests passed. Covers two concurrent environments (disjoint ports, hosts, and database names; stopping one leaves the other healthy and releases only its `port_leases`), early crash in under 500ms with stderr, `AppIgnoresPortError` when the app binds port 3000, partial create rollback with zero leaked leases, idempotent destroy, Tier 0 allocating zero ports, admission denial, preview memory restart, secret redaction, and startup reconciliation.
- `pnpm --filter @ef-harness/test-env test` — 4 files, 22 tests passed.
- `pnpm --filter @ef-harness/test-env typecheck` — passed.
- `pnpm --filter @ef-harness/test-env lint` — passed.
- `node scripts/verify-harmony.mjs --task 049` — passed (`harmony ok for Task-049`).

## Known Limitations / Follow-Ups

- Win32 Job Objects stay in Task 040. Callers inject `WindowsJobManager`; this package does not call `CreateJobObject`.
- Postgres, Redis, Mailpit, S3, and HTTP replay binaries stay in Task 050. `reset_data()` delegates to the registered `ServiceProvider`.
- The exclusive port-3000 lease and OAuth/Stripe mocks stay in Task 051. Binding port 3000 inside the environment job fails the start with `AppIgnoresPortError`.
- Template database clones stay in Task 052.
- `global.db` and `state.db` are separate connections, so port release and `env_processes` deletion are ordered steps rather than one cross-file transaction. `destroy()` is a single promise and deletes leases with `WHERE port = ? AND environment = ?`.
- `reconcileOnStartup` treats every environment id outside `liveEnvironmentIds` (plus this process's still-running environments) as dead and releases those leases, including rows whose `expires_at` is null. Leases for a live id are kept.
- Child startup logs are redacted before they are attached to errors. The orchestrator does not write resolved `env.vars()` to disk, `.env`, logs, or either database.

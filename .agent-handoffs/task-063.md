---
task_id: "Task-063"
branch: "task/063-multi-surface-verifiers"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/verifier/src/surfaces/**"
  - "packages/verifier/tests/surfaces/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 063 handoff

Multi-surface verifiers for OpenAPI HTTP, auth callbacks, injectable-clock and DST boundaries, background jobs, CLIs, concurrency and performance, and migration data preservation. X-09 webhook and X-14 rate-limit burst verifiers ship on the same adapter contract.

## Exports Provided

Import from `packages/verifier/src/surfaces/index.ts` until the frozen package barrel is wired.

Core verifiers (the seven registered by `registerCoreSurfaceVerifiers`):

- `ApiContractVerifier` — OpenAPI status, headers, JSON schema, `additionalProperties` sensitive leaks, X-11 `{ code, message, banner }`, X-01 role matrix (`401`/`403`), X-02 declared plus schema-derived boundary inputs. Schema: `ApiContractCheckSchema`.
- `AuthCallbackVerifier` — five scenarios against the local OAuth port: valid login (redirect, `HttpOnly`, appropriate `SameSite`, verified role claim), tampered `state`, expired code, invalid signature, wrong-role denial. Schema: `AuthCallbackCheckSchema`.
- `TimeBoundaryVerifier` — injectable `X-Test-Clock` at 1 second before, at, and after the cutoff, plus summer display and spring-forward gap / fall-back overlap via `Intl` IANA rules. Schema: `TimeBoundaryCheckSchema`.
- `BackgroundJobVerifier` — fake-clock enqueue; asserts one DB row, one Mailpit-shaped message, and one event, then X-12 double-run idempotency. Schema: `BackgroundJobCheckSchema`.
- `CliSurfaceVerifier` — `HarnessRunEngine.executeSandboxedCommand`; exact exit code, strict JSON stdout, stderr line format. Schema: `CliSurfaceCheckSchema`.
- `ConcurrencyPerfVerifier` — manifest dialect probe, `Promise.all` barrier for `optimistic_version` (one `409`) or `last_write_wins` (no torn row), then seeded p95. Receipt always includes `datasetRowCount`, `iterationCount`, `seed`, `p95ThresholdMs`, `p95Ms`, `hostCpuPercent`, `engineDialect`. Host CPU above `maxHostCpuPercent` sets `status: "error"`, `attribution: "environment"`, `receipt.flag: "environment_noisy"`, `receipt.deferred: true` (not a performance fail). Schema: `ConcurrencyPerfCheckSchema`.
- `MigrationPreservationVerifier` — six steps: predecessor fixture, pre checksums, Tier 3 migration with statement timeout, post assertions (counts, unchanged-column checksums, transforms, integrity, indexes, read SQL), re-run idempotence, optional down round-trip. `DROP TABLE`, `DROP COLUMN`, and `ALTER COLUMN TYPE` set `destructive: true`. Renames set `requiresExpandThenContract: true`. Schema: `MigrationPreservationCheckSchema`.

Additional verifiers (registered by `registerCrossCuttingSurfaceVerifiers`, included in `createDefaultSurfaceRegistry`):

- `InboundWebhookVerifier` — X-09 forged signature (`400`/`401`) and duplicate event-id idempotency. GitHub `X-Hub-Signature-256` and Stripe `Stripe-Signature`. Schema: `InboundWebhookCheckSchema`.
- `RateLimitBurstVerifier` — X-14 sequential burst; `429` starts on request `limit + 1`. Schema: `RateLimitBurstCheckSchema`.

Registry and result shape:

- `createSurfaceVerifierRegistry`, `registerCoreSurfaceVerifiers`, `registerCrossCuttingSurfaceVerifiers`, `createDefaultSurfaceRegistry`, `CORE_SURFACE_VERIFIER_IDS`
- `SurfaceVerifierAdapter`, `SurfaceCheckResult`, `SurfaceVerifierContext`, `toCheckResultRow` — row matches `state.db.check_results` (`check_id`, `attempt`, `check_version`, `artifact_digest`, `status`, `receipt`, `recorded_at`)

Also exported: `analyzeMigrationSql`, `computeTableChecksums`, `generateMigrationPredecessorFixture`, `resolveCivilInstants`, `formatZoneParts`, `createAsyncBarrier`, `InProcessOAuthMockProvider`, `GenericWebhookDeliverer`, `signWebhook`, `LocalHarnessRunEngine`, `createDefaultDatabaseEngine`, `openTier3Database`, `createOsCpuSampler`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/verifier/src/index.ts` is frozen. Add these re-exports when the barrel is opened:

```ts
export {
  ApiContractVerifier,
  AuthCallbackVerifier,
  TimeBoundaryVerifier,
  BackgroundJobVerifier,
  CliSurfaceVerifier,
  ConcurrencyPerfVerifier,
  MigrationPreservationVerifier,
  InboundWebhookVerifier,
  RateLimitBurstVerifier,
  ApiContractCheckSchema,
  AuthCallbackCheckSchema,
  TimeBoundaryCheckSchema,
  BackgroundJobCheckSchema,
  CliSurfaceCheckSchema,
  ConcurrencyPerfCheckSchema,
  MigrationPreservationCheckSchema,
  InboundWebhookCheckSchema,
  RateLimitBurstCheckSchema,
  createDefaultSurfaceRegistry,
  registerCoreSurfaceVerifiers,
  registerCrossCuttingSurfaceVerifiers,
  CORE_SURFACE_VERIFIER_IDS,
  toCheckResultRow,
} from "./surfaces/index.js";
export type {
  ApiContractCheck,
  AuthCallbackCheck,
  TimeBoundaryCheck,
  BackgroundJobCheck,
  CliSurfaceCheck,
  ConcurrencyPerfCheck,
  MigrationPreservationCheck,
  InboundWebhookCheck,
  RateLimitBurstCheck,
  SurfaceVerifierAdapter,
  SurfaceCheckResult,
  SurfaceVerifierContext,
  SurfaceVerifierRegistry,
} from "./surfaces/index.js";
```

Task 060 `CleanVerifierRunner` should call `registerCoreSurfaceVerifiers` plus `registerCrossCuttingSurfaceVerifiers` and persist every `SurfaceCheckResult` through `toCheckResultRow`. Do not edit `packages/verifier/src/runner/**` from this branch.

`packages/verifier/package.json` is frozen. Declare the dependency below so the `zod` import is a direct package dependency rather than a walk up to the root install.

## Dependency Intents (New Packages Requested)

No new package. `zod` is already a root devDependency (`^3.25.0`) and is imported by the check-spec schemas.

Add to `packages/verifier/package.json` `dependencies` when that file is unlocked:

```json
"zod": "^3.25.0"
```

## Contract Change Requests

None. Sibling contracts are consumed through local ports. No schema, barrel, or package manifest edit is required for this branch to verify.

## Local ports to swap

| This branch | Replace with | Notes |
|---|---|---|
| `SurfaceVerifierAdapter`, `SurfaceCheckResult`, `toCheckResultRow` in `src/surfaces/types.ts` and `result.ts` | Task 060 runner types | Same `check_id` list and `check_results` columns. |
| `InProcessOAuthMockProvider` | Task 051 `LocalOAuthMockProvider` | Scenarios: `valid`, `tampered_state`, `expired_code`, `invalid_signature`, `wrong_role`. `verifyIdToken` checks the role claim. |
| `GenericWebhookDeliverer` / `signWebhook` | Task 051 `GenericWebhookDeliverer` and Stripe signer | Real HMAC-SHA256. Styles `github` and `stripe`. Forged deliveries flip the digest. |
| `LocalHarnessRunEngine` | Task 047 `HarnessRunEngine.executeSandboxedCommand` | Same `{ command, cwd?, env?, timeoutMs }` in and `{ exitCode, stdout, stderr, timedOut }` out. This stand-in does not apply the sandbox allowlist or Job Object. |
| `generateMigrationPredecessorFixture`, `computeTableChecksums` | Task 052 exports of the same names | Fixture rows include nulls, `🍜 Ümlaut مرحبا`, max lengths, duplicate notes, boundary timestamps, and orphan id `999999`. Checksum is SHA-256 of canonical cells in primary-key order. |
| `createDefaultDatabaseEngine` postgres opener | Task 050 `EmbeddedPostgresProvider` | SQLite path is real `node:sqlite` on a fresh Tier 3 temp file. Postgres path records `SET statement_timeout = '<ms>ms'`, refuses `PRAGMA` and `AUTOINCREMENT`, and stores the subset in an isolated file until embedded Postgres is wired. |
| Mailpit observation | Task 050 Mailpit | Verifier GETs `observations.mailpitPath` and counts `messages`. |
| `createOsCpuSampler` | none | `os.cpus()` delta. Tests inject `HostCpuSampler`. |

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-063-multi-surface-verifiers`:

- `pnpm --filter @ef-harness/verifier typecheck` — pass (exit 0).
- `pnpm --filter @ef-harness/verifier lint` — pass (exit 0).
- `pnpm --filter @ef-harness/verifier test -- surfaces` — pass. Vitest v5.1.1: 9 files, 37 tests passed.
- `node scripts/verify-harmony.mjs --task 063` — pass (`harmony ok for Task-063`, exit 0). The script also re-ran repository typecheck, lint, and tests.

Covered by those tests:

- API pass path plus failures for `passwordHash` leak, X-01 wrong-role accept, X-11 missing banner, X-02 accepted invalid input.
- Auth pass path plus failures for missing `HttpOnly`, tampered state, expired code, invalid signature, and allowed wrong role.
- Time: `2026-01-15T09:45:00.000Z` and `2026-07-15T08:45:00.000Z` for `10:45:00 Europe/Berlin`, empty spring gap `2026-03-29 02:30`, both fall instants `2026-10-25T00:30:00.000Z` and `2026-10-25T01:30:00.000Z`. Off-by-one `<` fails `:at`. Fixed UTC+1 fails `:summer`. Broken DST fails `:dst-spring` and `:dst-fall`. Run finishes in under 2 seconds (no clock sleep).
- Jobs: one row, one Mailpit message, one event at the injected clock; duplicate side effects fail X-12.
- CLI: JSON stdout with stderr `level=warn msg=...` passes; a stdout warning fails strict JSON; exit `2` fails the exit check.
- Concurrency: sqlite optimistic `409`, postgres last-write-wins, dialect mismatch, torn row, slow p95 fail, noisy host defers with `environment_noisy`.
- Migration: clean additive copy passes preservation, idempotent re-run, and down round-trip; postgres receipt starts with `SET statement_timeout`; dropped row and `REPLACE` of `🍜` fail checksums; `DROP COLUMN` is `destructive: true` and the second run fails idempotence; `SELECT ef_sleep_ms(5000)` aborts at `statement_timeout`.

## Known Limitations / Follow-Ups

- Postgres migrations on this branch use the local subset engine described above, not a Postgres server. Locking behavior of a real Postgres session is not executed here. The dialect switch is real: sqlite sessions do not emit `SET statement_timeout`, and the postgres session refuses sqlite-only SQL.
- `LocalHarnessRunEngine` is a process spawn with separate stdout and stderr. Task 047 still has to supply allowlists, nested Job Objects, and redaction.
- `check_results.status` has no `deferred` value. A noisy performance host is stored as `error` with `attribution: "environment"`, `affectsWorkerQualityScore: false`, and `receipt.deferred: true` so it is not a performance fail.
- X-09 and X-14 are extra adapters beside the seven named verifiers. `createDefaultSurfaceRegistry` registers all nine. Task 060 can register the core seven alone via `registerCoreSurfaceVerifiers`.
- Time and job verifiers do not call `setTimeout` to reach a cutoff. Migration statement timeout uses a worker deadline, which is the sqlite stand-in for `statement_timeout` plus the postgres `SET` statement.
- The package barrel and `package.json` were not edited.

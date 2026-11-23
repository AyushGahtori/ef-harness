---
task_id: "Task-140"
branch: "task/140-broker-allowance-pacing-aimd"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/providers/src/pacing/**"
  - "packages/providers/tests/pacing/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 140 handoff

Global broker allowance pacing for one shared provider account. AIMD starts at `cwnd = 2`, adds at most `+1` after 6 clean completions or 60s with zero 429s, and halves to `max(1, floor(cwnd / 2))` on a transient 429. A hard usage limit sets `cwnd = 0` and does not retry. A 20% personal reserve is an `800_000` ppm harness ceiling with wind-down at `720_000` ppm. Learned `k[model]` is ppm per 1k effective tokens.

Commit stays on `task/140-broker-allowance-pacing-aimd`.

## Exports Provided

Import from `packages/providers/src/pacing/index.ts` until the package barrel is wired:

- `AllowancePacingController` — register a connection, `requestSlot`, `completeTurn`, provider signals, quota deltas, SIWC headers, Copilot quota, OpenRouter credit, auto-resume opt-in, and `tick`.
- `AimdConcurrencyRegulator` — per-connection AIMD. `noteCleanCompletion`, `pulse`, `noteTransient429`, `exhaust`, `restartAtStart`.
- `BurnRateWindowTracker` — short (`5h`) and long (`weekly` / `monthly`) ppm windows, in-flight holds, burn-rate step-down, 90% wind-down.
- `ModelAllowanceWeightLearner` — `k[model]` seeded from priors, bounded RLS blended with EMA on quota deltas, coarse reset estimate for opaque windows. `predictWindowShare` returns labels such as `~12% of 5h window`. Reservation is `tokens × k × 1.3`.
- `RateLimitVsUsageLimitClassifier` — `transient_429` versus `usage_limit_exhausted` (`five_hour_window`, `weekly_cap`, `monthly_cap`, `copilot_remaining_zero`, `openrouter_credit_zero`).
- `AutoResumeScheduler` — default off. Wake is `reset_at + 15_000` ms. Resume only after health, holds, conflicts, and disk preflight, then `cwnd = 2`.
- `InteractivePrioritySlot` — one interactive slot (`ask-owner-responder@1`, discovery, canvas Q&A, steering) that background workers cannot occupy.
- `simulateFiveHourChatGptPlusWindow` — 30-task discrete-event 5-hour simulator.
- `InMemoryGlobalConnectionWindowRepo` plus `GlobalConnectionWindowRepo` and `ConnectionWindowTx` — serialized stand-in for the global window row.
- `PacingTelemetry` — `{ connectionId, cwnd, maxCwnd, windowUsedPpm, reserveCeilingPpm, resetAt, pacingState }` with `pacingState` in `normal | burn_paced | backoff_429 | window_exhausted`.
- `SubscriptionWeightFeed` — `{ connectionId, modelId, ppmPer1k, allowancePpmPer1M, precision, safetyMargin }` for Task 106 and Task 108.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/providers/src/index.ts` on this branch. It is outside the owned subtree and today only exports `packageName` and `layer`. On integration, re-export the pacing barrel:

```ts
export {
  AllowancePacingController,
  AimdConcurrencyRegulator,
  AutoResumeScheduler,
  BurnRateWindowTracker,
  InMemoryGlobalConnectionWindowRepo,
  InteractivePrioritySlot,
  ModelAllowanceWeightLearner,
  RateLimitVsUsageLimitClassifier,
  simulateFiveHourChatGptPlusWindow,
} from "./pacing/index.js";
export type {
  ConnectionWindowTx,
  GlobalConnectionWindowRepo,
  PacingTelemetry,
  SubscriptionWeightFeed,
} from "./pacing/index.js";
```

No root `package.json` change. No `packages/shared-contracts/src/index.ts` change. `schema/global.sql` stays frozen.

`connection_windows` column mapping from `ConnectionWindowRow` (units are integer ppm, `1_000_000` is the full window):

| Column | Field |
|---|---|
| `connection` | `connectionId` |
| `window_kind` | `5h` / `weekly` / `monthly` / `rpm` |
| `window_start` | `windowStartMs` |
| `window_end` | `windowEndMs`, also the persisted `reset_at` |
| `limit_units` | `1_000_000` |
| `observed_units` | `observedPpm` |
| `estimated_units` | `usedPpm` |
| `source` | provider or `harness_estimate` / `usage_limit_exhausted` |
| `observed_at` | `observedAtMs` |

AIMD `cwnd`, burn samples, `k[model]`, the interactive slot, and auto-resume are not columns on `connection_windows`. They live in the same global connection record (`PersistedConnection`), never in a project `state.db`.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None for `packages/shared-contracts` or `schema/`. Do not add cwnd or `k[model]` columns in this task. A later migration can promote those companion fields if the broker wants them as SQL columns. Until then the global record beside `connection_windows` is the store.

## Sibling swaps (branches not on this base)

Local ports in `packages/providers/src/pacing/local-ports.ts` and `global-connection-window-repo.ts`. Replace the adapter, not the pacing math.

| Local port | Missing sibling | Swap |
|---|---|---|
| `GlobalConnectionWindowRepo` / `InMemoryGlobalConnectionWindowRepo` | Task 014 `GlobalBrokerDb.connection_windows` and Task 024 single-writer lock | Implement `withTransaction` around one `BEGIN IMMEDIATE` on `global.db`. Two projects sharing an account must take the same row. |
| `BudgetLedgerPort.reserve` / `settle` / `release` | Task 023 `BudgetLedgerRepo.reserveAcrossScopes` / `settleReservation` / `releaseReservation` | Currency `allowance:<connectionId>`, integer ppm. Do not mix with micro-USD. |
| `BudgetWindDownPort.observe` | Task 128 `BudgetWindDownController` 90% step | Fired once when settled ppm reaches 90% of the harness ceiling (`720_000` when reserve is 20%). |
| `BudgetWindDownPort.openCheckpointStopCard` | Task 128 `CheckpointStopCardView` | Actions `wait_for_reset`, `switch_connection`, `keep_parked`. `retryAllowed` is false. Reasons: `usage_limit_exhausted` or `reserve_ceiling`. |
| `BudgetWindDownPort.openDiskHeadroomCard` | Task 118 `DiskHeadroomGuard` | Auto-resume stays parked when free bytes are below 5 GiB. |
| `BoardHealthPort.showCountdown` | Task 125 throttled health line | Exact text `Rate-limited · retrying in m:ss`. |
| `AllowanceWeightSink.publish` | Task 106 `ExpectedCostLevelSelector` and Task 108 `PlanPreviewBuilder` | `ppmPer1k` is `k[model]`. `allowancePpmPer1M` is that weight times `1_000`. Precision is `prior`, `calibrated` (3 or more quota samples), or `coarse_reset_estimate`. |
| `SignedPolicyPriorPort.priorPpmPer1k` | Task 135 `SignedProviderPolicyEngine` | Optional controller option. Registration `priors` win when already seeded. A null prior falls back to `CONSERVATIVE_PRIOR_PPM_PER_1K` (`20_000`). |
| `observeSiwcHeaders` | Task 137 `SiwcDirectRequestAdapter` | Caller passes remaining-percent snapshots. This branch does not read headers itself. Delta ppm is `(previousPercent - nextPercent) * 10_000`. |
| `observeCopilotQuota` | Task 139 `CopilotQuotaReader` (`account.getQuota`) | `remaining === 0` sets `cwnd = 0` and opens the stop card. Percentage drops calibrate `k[model]` on the weekly window. |
| `observeOpenRouterCredit` | No credit reader on this base | `credit === 0` is `openrouter_credit_zero` and sets `cwnd = 0`. |
| `ResumePreflightPort.connectionHealthy` | Tasks 136–139 connection health | False keeps the build parked. |
| `ResumePreflightPort.pendingHolds` | Task 021 holds | Any hold keeps the build parked. |
| `ResumePreflightPort.pendingConflicts` | Conflict check, not on this base | Any pending conflict keeps the build parked. |
| `tick` | OS daemon wakeup | Caller drives time. The scheduler stores `wakeAtMs` and does not register a system timer. |

Task 107 should read `telemetry().cwnd` (and burn-paced slot count via a denied `requestSlot`) as the provider pacing cap. Task 188 should share one `GlobalConnectionWindowRepo` across projects. Task 152 can call `simulateFiveHourChatGptPlusWindow` for the allowance-paced kitchen profile shape (`reserveFraction = 0.2`, start `cwnd = 2`).

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-140-broker-allowance-pacing-aimd` on `task/140-broker-allowance-pacing-aimd`:

- `pnpm --filter @ef-harness/providers typecheck` — exit 0 (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/providers lint` — exit 0 (`eslint .`).
- `pnpm --filter @ef-harness/providers test -- pacing` — exit 0. 9 files, 38 tests passed (Vitest 5.1.1).
- `node scripts/verify-harmony.mjs --task 140` — exit 0. Output: `harmony ok for Task-140`. That run also executed workspace `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Known Limitations / Follow-Ups

- The window store is in-memory. Durability waits on the Task 014 / Task 024 adapter described above.
- `tick` is pull-based. The integrator arms the `reset_at + 15s` wake.
- A transient 429 backoff and `cwnd = 0` block the interactive slot too. The slot only skips a full background cwnd and a burn-paced background stop while ceiling room remains.
- Copilot premium requests are paced through remaining percentage mapped to ppm, not a separate request counter.
- Opaque windows never divide by zero. Zero tokens since the last reset leave the policy prior in place and keep precision `prior`.

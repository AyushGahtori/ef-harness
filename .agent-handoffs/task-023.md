---
task_id: "Task-023"
branch: "task/023-budget-reservation-ledger"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/db/src/ledger/**"
  - "packages/db/tests/ledger/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 023 handoff

Multi-currency integer budget ledger: atomic multi-scope reservations, always-succeeding overrun settlement, unknown-outcome retention, and per-wave paperwork envelopes. Commit stays on `task/023-budget-reservation-ledger`.

## Exports Provided

Import from `packages/db/src/ledger/index.ts` until the package barrel is wired:

- `BudgetLedgerRepo`
  - `registerCurrency(code)` for `usd` (`micro-USD`, scale `1000000`), `allowance:<connection>` (`ppm of window share`, scale `1000000`), and `slots:local` (`slot`, scale `1`)
  - `createBudgetScope` for `project`, `feature`, `task`, `wave_paperwork`, and `grant`, with explicit `parentKind` / `parentId`
  - `reserveAcrossScopes` — `BEGIN IMMEDIATE` + `SAVEPOINT`, inserts `reservations.state = 'held'` and every ancestor plus any `additionalScopes`, runs canonical `reserve`, commits only when `changes === scopes.length`, otherwise `ROLLBACK TO` the savepoint and returns `{ ok: false, blockingScopes }` with no partial debit
  - `settleReservation` — canonical `settle` + `settle_mark` in one transaction; actual spend is recorded even when it exceeds `amount_units` and `limit_units`; `overrun_units = max(0, actual - amount)`
  - `releaseReservation` — canonical `release` for `held` only, then marks `released`
  - `markReservationUnknown` — keeps `reserved_units` and sets `state = 'unknown'`
  - `reconcileUnknownReservation` — `settle` or `release` (release reopens to `held` inside the same transaction so canonical `release` can run; a failure rolls the reopen back)
  - `getBudgetRemaining` — canonical `budget_remaining`
  - `evaluateSpendThresholds` — crossings of 50% and 80% (`alert`), 90% (`wind_down`: stop new dispatches, keep a checkpoint/verification reserve), and 100% (`stopped` / park)
  - `reserveP95StreamCutoff` — nearest-rank 95th percentile of observed output units for routes that cannot set `max_output_tokens`, then the same settle path records streamed actuals
  - `createWavePaperworkEnvelopes`, `rollForwardUnusedPaperwork`, `raiseBudgetLimit`, `getReservation`, `auditConservation`
- `ReservationHandle` — id, purpose, currency, amount, scopes, `state: "held"`, optional `taskClass` and `estimateKind: "p95_stream_cutoff"`
- `ThresholdCrossedEvent` — scope, currency, `thresholdPercent` 50 | 80 | 90 | 100, level, dispatch/park flags, and the `budget_remaining` figures
- `openLedgerDatabase` loads `schema/state.sql` on `node:sqlite`
- `estimateP95OutputUnits`
- `NonIntegerCurrencyUnitsError` for any amount that is not a non-negative safe integer
- Paperwork split: `PAPERWORK_PHASES`, `PAPERWORK_PHASE_PERCENT` (3/5/6/4/2), `PAPERWORK_CAP_PERCENT` (20)

`model_call` and `effect` throw `ScopeBindingError` if any scope is `wave_paperwork`. `paperwork` must name exactly one wave envelope. A later wave than `activeWaveId` throws `CrossWaveBorrowError` unless `crossWaveBorrowApproved` is true. Unused envelope limit rolls forward with integer arithmetic and does not move `reserved_units` or `spent_units`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/db/src/index.ts` is frozen by Task 001. Please re-export:

```ts
export {
  BudgetLedgerRepo,
  CrossWaveBorrowError,
  NonIntegerCurrencyUnitsError,
  ScopeBindingError,
  estimateP95OutputUnits,
  openLedgerDatabase,
} from "./ledger/index.js";
export type { ReservationHandle, ThresholdCrossedEvent } from "./ledger/index.js";
```

No root manifest edit and no `packages/shared-contracts/src/index.ts` edit.

## Dependency Intents (New Packages Requested)

None. The ledger uses `node:sqlite` and the canonical SQL files. `fast-check` is already a root devDependency and the property test imports it from the workspace root; `packages/db/package.json` is frozen, so it was not added there.

## Contract Change Requests

None. `schema/state.sql` and `schema/queries.sql` were not edited. `reserve`, `settle`, `settle_mark`, `release`, and `budget_remaining` run verbatim from `schema/queries.sql`.

Task 010 integer converters and Task 013 `ProjectStateDb` are not on `harness/integration`. This package therefore checks integer units itself and accepts a `node:sqlite` `DatabaseSync` that already has `state.sql` applied. When those branches are integrated, pass converter output straight into `amountUnits` / `actualUnits`, and construct `BudgetLedgerRepo` on the project connection.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-023-budget-reservation-ledger`.

```text
pnpm --filter @ef-harness/db exec tsc -b --pretty false
```

Result: exit 0.

```text
pnpm --filter @ef-harness/db lint
```

Result: exit 0.

```text
pnpm --filter @ef-harness/db test -- ledger
```

Result: 4 files passed, 15 tests passed (52.02s). Covered the schema-test budget scenario (multi-scope reserve, single-scope overflow rollback, $0.10 reserved then $0.34 settled with overrun 240000 blocking the next 1-unit reserve, and `100000 + 100000 + 100000 === 300000`), the last $0.20 of a $1.00 budget (`blockingScopes: ['project']`), closed grant rollback, double settlement, release-after-settle, non-integer rejection, zero-actual settlement, unknown retention and reconcile, paperwork phase split and roll-forward, coding isolation, cross-wave borrow approval, 50/80/90/100 threshold signals, p95 stream cutoff, and 1000 fast-check command sequences (seed 23) with zero conservation drift.

```text
node scripts/verify-harmony.mjs --task 023
```

Result: `harmony ok for Task-023` (exit 0).

## Known Limitations / Follow-Ups

- `DatabaseSync` is synchronous, so the two-worker case is tested as two serialized `reserveAcrossScopes` calls on one connection. `BEGIN IMMEDIATE` is what makes a second connection wait and then observe the first commit; that wait was not driven from a second OS thread.
- Releasing an `unknown` reservation flips it to `held` only inside the open transaction so the canonical `release` statement (which requires `held`) can run. The flip is rolled back if `release` does not update every scope.
- `raiseBudgetLimit` refuses to lower a limit. Lowering is not part of this task.
- 90% wind-down is reported on `ThresholdCrossedEvent` (`stopNewDispatches`, `keepCheckpointReserve`). The ledger still accepts a reservation that fits integer headroom, so a checkpoint can spend the remainder. The coordinator decides which purposes may start.

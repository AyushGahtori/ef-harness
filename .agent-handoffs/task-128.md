---
task_id: "Task-128"
branch: "task/128-budget-winddown-stop-card-wip"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/steering/src/budget-stops/**"
  - "packages/steering/tests/budget-stops/**"
  - "apps/renderer/src/cockpit/stop-card/**"
  - "apps/renderer/tests/stop-card/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 128 handoff

Budget wind-down at 50/80/90/100 percent for micro-USD and subscription ppm, the six-action checkpoint stop card, and a `wip/<slug>-<date>` exporter that writes `HANDOFF.md` without moving `main` or `harness/integration`. Commit stays on `task/128-budget-winddown-stop-card-wip`.

## Exports Provided

Steering imports from `packages/steering/src/budget-stops/index.ts`. The package barrel is intentionally unchanged.

- `BudgetWindDownController` — `observe`, `tryClaim`, `finishActive`, `stopForUser`, `stopForDiskRed`, `addBudget`, `switchConnection`, `armAutoResume`, `resumeFromReset`, `applyCheaper`, `keepParked`, `finishByHand`, `snapshot`.
- `createBudgetWindDownController(options)` — wires the local ports.
- `WipBranchHandoffExporter.exportBundle` — creates `wip/<project-slug>-<YYYY-MM-DD>` (or `-2`, `-3`, …) from `refs/heads/harness/integration`, cherry-picks verified-unmerged SHAs, commits each partial task as `[WIP - UNVERIFIED: <taskId>]`, and writes `HANDOFF.md` as `commit`, `untracked`, or `excluded`.
- `AtomicBudgetReservationLedger` — local stand-in for Task 023. `reserve` holds the worst-case ceiling under the cap; `settle` refuses an actual above that ceiling.
- `StopEventStore` — writes `stop_events` (`budget_100`, `window_exhausted`, `user_stop`, `disk_red`, checkpoint SHAs, recovery option).
- `InMemoryCheckpointStore` and `GitCheckpointStore` — local stand-ins for Task 053 checkpoints. `discard` requires `{ explicit: true }` and only deletes `refs/harness/checkpoints/...`.
- `InMemoryIntegration` — append-only stand-in for the green `harness/integration` history.
- `LocalKernelStop` — local stand-in for Task 114 `ImmediateKernelStopController.stop`.
- Ladder helpers: `stepFor`, `subscriptionWindDown` (`ppm >= 900_000`), `usageLine`, `paidSwitchConfirmation`, `formatMicroUsd`, `OPTIONAL_ADVISORY_ROLE_ID` (`taste-reviewer@1`), `METER_TONE_50` (`soft-blue-neutral`).

Renderer imports from `apps/renderer/src/cockpit/stop-card/index.ts`. The package barrel is intentionally unchanged.

- `CheckpointStopCardView` — `render`, `withAutoResume`, `withSwitch`, `withCheaperConfirmed`, `addBudgetIntent` (`+$5` / `+$10` / custom).
- `deriveRecoveryActions` — hides Add Budget when there is no dollar cap, shows `Wait for Reset (<countdown>)` for a subscription window, and requires the paid-switch sentence before a subscription-to-API resume.
- `defaultInteraction` starts with `autoResumeAtReset: false`.

`Keep Parked` sets CPU to `0`, spend per hour to `0`, and `welcomeBackReady: true` for Task 130. The handoff file includes the line `I Fixed It Myself` plus `ef-fixed-it-myself:` for Task 173. `openInVsCodeCommand` is `code <worktree>`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/steering/src/index.ts` is outside this task. Re-export the budget-stops module from it:

```ts
export {
  AtomicBudgetReservationLedger,
  BudgetStopError,
  BudgetWindDownController,
  CheckpointDiscardError,
  GitCheckpointStore,
  InMemoryCheckpointStore,
  InMemoryIntegration,
  LocalKernelStop,
  METER_TONE_50,
  OPTIONAL_ADVISORY_ROLE_ID,
  ProtectedBranchExportError,
  SUBSCRIPTION_WIND_DOWN_PPM,
  StopEventStore,
  WipBranchHandoffExporter,
  createBudgetWindDownController,
  paidSwitchConfirmation,
  stepFor,
} from "./budget-stops/index.js";
export type {
  AddBudgetChoice,
  ClaimResult,
  RecoveryActionId,
  StopCardModel,
  StopEventRecord,
  StopTrigger,
  WindDownSnapshot,
  WipExportInput,
  WipExportResult,
} from "./budget-stops/index.js";
```

`apps/renderer/src/index.ts` is outside this task. Re-export the stop card from it:

```ts
export {
  CheckpointStopCardView,
  deriveRecoveryActions,
  defaultInteraction,
} from "./cockpit/stop-card/index.js";
export type {
  RenderedStopCard,
  StopCardFacts,
  StopCardInteraction,
} from "./cockpit/stop-card/index.js";
```

No root `package.json`, workspace, tsconfig, eslint, schema, or package `package.json` change. Renderer must not deep-import `@ef-harness/steering`. After the steering barrel exists, Task 122 can map `BudgetWindDownController.snapshot().stopCard` into `StopCardFacts` (`dollarCap`, `subscription`, `connections`, `remainingTasks`, `cheaperProjectedMicroUsd`) and mount `CheckpointStopCardView`. Until that adapter lands, the view is fed `StopCardFacts` directly. Task 130 should read `keepParked().welcomeBackReady`. Task 140 should call `observe` when `ppm >= 900_000` and pass `window.resetAtMs`. Task 141 should keep using `switchConnection(targetId, confirmed)` and block when `confirmationText` is set.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None for frozen root manifests. `schema/state.sql` is frozen, so `StopEventStore` applies this DDL itself on the connection it is given. Please add the same table to `state.db` on a later schema task:

```sql
CREATE TABLE IF NOT EXISTS stop_events (
  id TEXT PRIMARY KEY NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('budget_100', 'window_exhausted', 'user_stop', 'disk_red')),
  timestamp_ms INTEGER NOT NULL,
  checkpoint_shas_json TEXT NOT NULL,
  recovery_option TEXT
);
```

`checkpoint_shas_json` is a JSON array of strings. `recovery_option` is one of `add_budget`, `cheaper_models`, `switch_connection`, `wait_for_reset`, `finish_by_hand`, `keep_parked`, or null until the developer chooses.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-128-budget-winddown-stop-card-wip`.

- `pnpm --filter @ef-harness/steering typecheck` — exit 0 (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/renderer typecheck` — exit 0 (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/steering lint` — exit 0 (`eslint .`).
- `pnpm --filter @ef-harness/renderer lint` — exit 0 (`eslint .`).
- `pnpm --filter @ef-harness/steering test -- budget-stops` — exit 0. Vitest 5.1.1: 4 files, 18 tests passed. Covers 50% digest and soft-blue meter with 0 interruptions for micro-USD and ppm, 80% inbox text `80% of budget used — $8.00 / $10.00` (and the ppm twin) with `taste-reviewer@1` skipped and `verifier@1` kept, 90% blocking 5 queued tasks while 2 active workers merge to `$9.75` without deleting a prior checkpoint, `ppm >= 900_000` finishing the active task without a kernel stop, 100% checkpoint of `T-7` with all 6 recovery actions and a `budget_100` row in `stop_events`, ppm `window_exhausted`, 4-way reservation granting only 2 of 4 `$0.50` holds when `$1.10` remains (settled spend `$9.90` of `$10.00`), user/disk receipts, unhealthy-connection refusal, `+$5` and custom resume, paid-switch confirmation, reset countdown `1h 22m` with auto-resume default off, cheaper preset floors, ChatGPT Plus 95% highlighting, real `wip/kitchen-app-2026-11-19-2` collision, `[WIP - UNVERIFIED: T-7]`, `HANDOFF.md` commit/untracked/excluded, and a git checkpoint halt that leaves `main` and `harness/integration` unmoved.
- `pnpm --filter @ef-harness/renderer test -- stop-card` — exit 0. Vitest 5.1.1: 1 file, 2 tests passed. The dollar card renders all 6 actions, `+$5` / `+$10` / Custom, the senior floor, and the auto-resume checkbox defaulting off. The ChatGPT Plus card hides Add Budget and `+$5`, highlights Wait for Reset `(1h 22m)`, Switch Connection, and Keep Parked, and shows `Anthropic Console API is pay-per-use (~$0.65 est. for remaining 4 tasks) — Confirm?` until the switch is confirmed.
- `node scripts/verify-harmony.mjs --task 128` — exit 0, `harmony ok for Task-128` (schema 67/67, diagram check, owned-path scope, then workspace typecheck, lint, and test).

## Known Limitations / Follow-Ups

Sibling branches are not on this base. These local ports must be swapped at integration. Do not import the unpublished packages as if they were already on `harness/integration`.

- **Task 023 `BudgetLedgerRepo`:** `AtomicBudgetReservationLedger.reserve`, `settle`, `release`, and `postHistoricalSpend` are the port. `reserve` serializes concurrent callers and refuses a ceiling that would push `spent + reserved` past the limit. Swap those methods to `reserveAcrossScopes` / `settleReservation` / `releaseReservation`. This task does not open `schema/state.sql` and does not call the canonical `reserve` SQL.
- **Task 039 `RefLeaseAndCasManager`:** the exporter reads `refs/heads/harness/integration` with `git rev-parse` and creates the `wip/*` branch with `git worktree add -b`. It never force-updates, never pushes, and never checks out `main`. Swap the integration SHA read to `RefLeaseManager` when that barrel is wired. Branch creation of `wip/*` can stay a direct git call; it is not a shared harness ref advance.
- **Task 053 `NativeWorkerLoop`:** `GitCheckpointStore.write` and `InMemoryCheckpointStore.write` save the partial files and failing test output. Swap `write` to the worker loop's attempt checkpoint (`refs/harness/checkpoints/<task>/<n>`). `discard` stays explicit.
- **Task 106 crew floors:** `floorForSafetyClass` keeps `auth`, `payments`, `migrations`, `destructive`, `expand-contract`, `cross-feature-conflict`, and `oracle-author@1` at `senior`. Cheapest assigns that floor, not a level below it. Sticker estimates are junior `20_000`, mid `80_000`, senior `200_000`, principal `500_000` micro-USD. Swap the projection to `ExpectedCostLevelSelector` and keep the floor check.
- **Task 114 `ImmediateKernelStopController`:** `LocalKernelStop.stop` records the trigger. `BudgetWindDownController` calls it on `budget_100`, `window_exhausted`, `user_stop`, and `disk_red`. Swap the class. Hard stop still checkpoints before the kernel call and does not pop integration history.
- **Task 122 shell:** the stop card is not mounted in `apps/renderer/src/shell/**` (outside this task). Mount `CheckpointStopCardView` from the cockpit route when `snapshot().stopCard` is set. Map the controller model onto `StopCardFacts`.
- **Task 140 allowance windows:** ppm lives on the local ledger (`limit` `1_000_000`, wind-down at `900_000`). `resumeFromReset` zeros ppm spend only when `now >= resetAtMs`, the connection is healthy, and the caller is the user or the opt-in auto-resume flag. Swap the ppm reading and the reset timestamp to `global.db.connection_windows`. The 5-hour versus weekly kind is carried on `ConnectionAccount.window.kind` and is not paced here.
- **Task 141 paid switch:** `switchConnection` returns the confirmation sentence and does not change the active connection until `confirmed` is true and the target is healthy with remaining headroom. Swap the predicate to the no-silent-fallback guard; keep the sentence.
- **Task 173:** `WipExportResult.fixedItMyself` and the `ef-fixed-it-myself:` line in `HANDOFF.md` are the bridge. This task does not verify the developer's later commit.
- **Package barrel re-exports above are not applied in this commit.**

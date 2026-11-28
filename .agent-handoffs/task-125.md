---
task_id: "Task-125"
branch: "task/125-board-health-signals-explainer"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "apps/renderer/src/cockpit/health/**"
  - "apps/renderer/tests/cockpit-health/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 125 handoff

Board health signals and the on-demand cockpit explainer live under `apps/renderer/src/cockpit/health/`. Detection is deterministic and never calls a model. `cockpit-explainer@1` runs only from `OnDemandCockpitExplainer.explain({ click: true, ... })`.

## Exports Provided

Public entry: `apps/renderer/src/cockpit/health/index.ts`.

- `BoardHealthSignalEngine` — evaluates a `HealthBoardSnapshot`, suppresses false stuck alarms, ticks backoff countdowns at 1 Hz without a daemon pull, and writes trigger/resolution rows.
- `HealthSignalBadgeStrip` — inline badges, fixed 24px slot (`layoutShift: 0`), remediation buttons, and the "Explain what's happening" control on flagged or inspected tasks.
- `OnDemandCockpitExplainer` — explicit-click `cockpit-explainer@1`, `(taskId, lastEventSeq)` cache, cited-event check, deterministic offline/402 fallback.
- `BoardHealthSummaryPill` — `All N workers healthy` / `All N healthy`, or a rollup such as `1 looping · 1 waiting on reset`, with `filterCards` limited to affected tasks.
- `attachHealthSlots` — local port of the Task 124 card badge slot.
- `detectWorkerHealth` — pure detector Task 163 can reuse for desk icons.
- `CockpitExplainerV1Schema` — local port of the Task 009 schema.
- `FakeModelAdapter` — test double. Not a production provider.
- `InMemoryTelemetryLog` plus `TELEMETRY_HEALTH_TARGET` — `telemetry` rows (`kind: "metric"`) for Task 133.
- `normalizePoolState` — accepts Task 119 `waiting_for_run_slot` and Task 125 `waiting_run_slot`.

Signal kinds: `stuck_no_progress`, `loop_detected`, `rate_limited_backoff`, `allowance_window_wait`, `escalated_or_retrying`, plus calm `waiting_run_slot` (not an alarm).

Remediation ids, all non-destructive and non-modal: `inspect`, `nudge`, `restart`, `restart_fresh_attempt`, `inspect_raw_stream`, `escalate_tier`, `give_hint`, `fix_it_myself`, `lower_concurrency`, `switch_connection`, `keep_parked`, `open_checkpoint_stop_card`, `open_dispute_decision_card`.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `apps/renderer/src/index.ts` on this branch. Integration should add:

```ts
export {
  BoardHealthSignalEngine,
  HealthSignalBadgeStrip,
  OnDemandCockpitExplainer,
  BoardHealthSummaryPill,
  attachHealthSlots,
  detectWorkerHealth,
  CockpitExplainerV1Schema,
  normalizePoolState,
} from "./cockpit/health/index.js";
export type {
  HealthBoardSnapshot,
  HealthSignal,
  WorkerHealthTelemetry,
  CockpitExplanation,
  BoardCardHealthSlot,
} from "./cockpit/health/index.js";
```

Task 124 `BoardCockpitView` should call `attachHealthSlots` for every card. The strip is already 24px tall when empty, so the reserved slot does not move layout. Task 163 should color desk icons from `detectWorkerHealth` tones (`amber` backoff, `violet` waiting/reset, `red` stuck/loop/escalated). Task 133 should read `telemetry` rows whose JSON `data.event` is `health_signal_triggered` or `health_signal_resolved`.

No root `package.json`, lockfile, workspace, tsconfig, eslint, or package barrel edit.

## Dependency Intents (New Packages Requested)

None. The renderer package has no React dependency, and `package.json` is frozen, so the strip is a view model plus an escaped HTML string. No Zod dependency was added; the explainer schema is a local parser.

## Contract Change Requests

Sibling branches are not in this base. Local ports stand in for them:

| Sibling | Port on this branch | Swap when it lands |
|---|---|---|
| Task 009 `CockpitExplainerV1Schema` | `CockpitExplainerV1Schema` in `explainer-schema.ts` | Call the shared Zod schema, then keep the 3-bullet UI. A 2-sentence payload is already accepted; the third bullet is the deterministic next click. Prose over 2 sentences is rejected. |
| Task 053 `NativeWorkerLoop` loop telemetry | `LoopDetectorReading` and `WorkerStep` | Copy the loop snapshot onto `WorkerHealthTelemetry.loop` and `.steps`. |
| Task 059 `VerificationHintLadder` | `HintLadderReading` | Map ladder step, dispute, and exhaustion onto `.hint`. Hint 2/3, dispute, and exhausted retries are separate badges. |
| Task 124 `BoardCockpitView` | `attachHealthSlots` | Mount `HealthSignalBadgeStrip` in the reserved card slot. |
| Task 119 pool phase | `normalizePoolState` | Pass `waiting_for_run_slot` through the normalizer before detection. |
| Task 116 inbox / Task 115 holds | `inbox` and `hold` on the snapshot | Set `active: true` while the wait is legitimate. Stuck stays off. |
| Task 140 pacing | `PacingState` and `BackoffReading` | `backoff_429` or an open `retryAtMs` suppresses stuck and shows the countdown. `window_exhausted` pairs with `AllowanceReading`. |
| Task 128 stop card | action `open_checkpoint_stop_card` | Task 128 owns the card. This branch only names the action. |

Task 009's published contract is the last 50 events and two sentences. This task's spec bounds the model input to the last 5 timeline events plus the failing snippet, hint level, holds, pacing state, and requirement snippet, and it requires three bullets with real event ids. The local schema accepts either shape and always returns three bullets. Please extend `cockpit-explainer@1` with `citedEventIds` and the three bullet fields rather than collapsing the UI back to two sentences.

`telemetry.db` has no health table. Rows use the existing `telemetry` columns (`attempt`, `ts`, `kind`, `data`) with `kind = "metric"`. No schema change.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-125-board-health-signals-explainer`.

- `pnpm --filter @ef-harness/renderer typecheck` — pass (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/renderer lint` — pass (`eslint .`).
- `pnpm --filter @ef-harness/renderer test -- cockpit-health` — pass, 6 files, 15 tests.
- `node scripts/verify-harmony.mjs --task 125` — pass (`harmony ok for Task-125`).

Covered by those tests: 299s quiet / 300s `No progress · 5m`, 6m and 5m10s clocks, progress resets the clock, Pool 2 `Waiting for run slot · 7m` with no stuck alarm, inbox / hold / 429 / allowance suppression, all 5 signals and their actions, ChatGPT / Copilot / Cursor reset labels, calm `All 12 healthy` plus verbose `All 12 workers healthy`, `1 looping · 1 waiting on reset` filter, 0:45→0:00 ticks with one daemon pull, explainer click-only (0 background calls), `(taskId, lastEventSeq)` cache at 0 extra tokens, cited-id checks, essay rejection, 402 and offline fallbacks, telemetry trigger and resolution duration.

## Known Limitations / Follow-Ups

- The badge strip is not a React component. Task 124 mounts `render()` or the badge view model.
- The 1 Hz clock steps once per second. It does not repaint between ticks.
- The explainer cache is in memory on the explainer instance. A reload misses.
- `tokensUsed` on a model hit is `ExplainerModel.tokensPerCall` (the fake adapter uses 17). A live adapter must report the real bill. Failed provider calls add 0 tokens.
- Fallback text quotes the failing snippet, hint level, and next action. It does not invent a cause when those fields are empty.
- Office icons, inspector wiring, and the checkpoint stop card are not implemented here. Only the descriptors and detectors are.

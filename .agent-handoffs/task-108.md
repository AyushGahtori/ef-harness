---
task_id: "Task-108"
branch: "task/108-plan-preview-autostart-gate"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - packages/planner/src/plan-preview/**
  - packages/planner/tests/plan-preview/**
  - .agent-handoffs/task-108.md
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 108 handoff

Plan Preview engine: exact Phase 0 + Wave 1 versus projected Wave 2+ ranges, the 20% paperwork envelope, Chosen for you and deferrals, the interactive pre-build editor, the first-build Start gate, and the revision auto-start policy. Commit stays on `task/108-plan-preview-autostart-gate`.

## Exports Provided

Import from `packages/planner/src/plan-preview/index.ts`. The package barrel is intentionally unchanged.

- `PlanPreviewBuilder` — `build(request)` returns the pre-build summary. Phase 0 is grouped on `P0.1`–`P0.8` and Wave 1 tasks carry exact crew level, write scope, cost, and duration (`precision: "exact"`). Waves `2..K` and the Completion Wave are ranges labeled `Projected` (for example `Wave 2: Admin & Catering Email — ~6–9 tasks, ~$0.60–$1.10 (planned in detail after Wave 1 finishes)`). `llmCalls` is `0`. `startBuild.autoStart` is always `false`.
- `InteractivePlanEditor` — `switchPreset`, `overrideTaskTier`, `overrideFeatureTier`, `reorderOptionalWave`, `deferFeature`, `deferFeatures`, `setBudgetCap`, `setSpendGuard`, `overrideDelegatedChoice`. Preset and edit recomputes are synchronous. Outcomes report `llmCalls: 0` and `elapsedMs`. Deferring a prerequisite returns `Required by Orders — defer both or keep Auth`. Tier overrides below `safetyFloor` are rejected with the Task 106 floor message.
- `FirstBuildApprovalGate` — `assess`. A first build never auto-starts. `mayProceed` is true only after an explicit Start build click. Estimated cost and task count do not change that.
- `RevisionAutoStartPolicy` — `evaluate`, `record`, `configure`. Owner ceilings are `deltaTasks <= 5`, `deltaCost <= 1_000_000` micro-USD, `deltaPlanWindow <= 20_000` ppm, rolling 24h API spend `<= 5_000_000` micro-USD, rolling 24h subscription spend `<= 10%` of `planWindowPpm`. `configure` clamps anything looser. Hard stops: `must_ask`, `conflict`, `breaking_contract`, `destructive_migration` (`drop` / `alter_narrowing` / `data_delete` / `rename_column`), `new_dependency` (`Needs approval: adds new package 'chart.js'`), `external_effect` (`push`, `pull_request`, `deploy`, `live_webhook`, `live_email`, `secret_mutation`). A first build is blocked here too.
- `AutoStartGraceWindow` / `createAutoStartToast` — banner `Auto-starting 2-task fix (~$0.22) — Pause / Review`, pause affordance `5_000` ms, undo window `10_000` ms, and a `build-cockpit` timeline entry. `pause`, `undo`, `review`, `settle`.
- `PlanSnapshotDiffer` — `Before → After Plan Delta` with `+3 tasks`, `1 task re-verified`, `+$0.85`, and `Adds new dependency: date-fns`. Subscription deltas use the 5-hour allowance and do not print a dollar estimate.
- Local ports, to be swapped at integration: `LocalHeftCriticalPathScheduler`, `LocalCrewPresetProfileEngine`, `LocalPaperworkEnvelopeAllocator`, `LocalRevisionImpactPreviewer`, `defaultPlanPreviewSources`.
- Honesty helpers: `honestPointLabel`, `honestRangeLabel`, `PAPERWORK_LINE` (`Research 3% · Arch 5% · Plan/Oracles 6% · Integration/Review 4% · Audit 2%`), `PAPERWORK_CAP_PPM` (`200_000`).

`createPlanRequest` fills the null control fields (`widthCap`, `budgetCap`, `spendGuard`, `readiness`).

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/planner/src/index.ts` on this branch. Integration should add:

```ts
export {
  AutoStartGraceWindow,
  FirstBuildApprovalGate,
  InteractivePlanEditor,
  PlanPreviewBuilder,
  PlanSnapshotDiffer,
  RevisionAutoStartPolicy,
  createAutoStartToast,
  createPlanRequest,
  defaultPlanPreviewSources,
} from "./plan-preview/index.js";
export type {
  AutoStartDecision,
  AutoStartSettings,
  AutoStartToast,
  BudgetCap,
  ChosenForYouEntry,
  ConnectionKind,
  CrewLevel,
  CrewPreset,
  DeferredItem,
  EditOutcome,
  FirstBuildDecision,
  HeftSchedule,
  PlanDelta,
  PlanPreview,
  PlanPreviewRequest,
  PlanPreviewSources,
  PlanSnapshot,
  ReadinessView,
  RevisionCandidate,
  SpendGuard,
} from "./plan-preview/index.js";
```

No root `package.json`, workspace, tsconfig, eslint, or `packages/planner/package.json` change.

Wire `PlanPreviewBuilder` and `InteractivePlanEditor` with `PlanPreviewSources` once the sibling barrels below are on `harness/integration`. Until then the constructors use `defaultPlanPreviewSources()`.

## Dependency Intents (New Packages Requested)

None. The module uses plain TypeScript only. No new runtime dependency.

## Contract Change Requests

None for frozen root manifests, schema, or package barrels.

Upstream bindings, used because sibling branches are not on `harness/integration`:

- `ChosenForYouLedgerPort.forPlanPreview()` matches Task 073 `ChosenForYouLedger.forPlanPreview()`. Pass that instance as `sources.chosenForYou`. The preview copies every `delegated` and `defaulted` row into a clickable Change / Override route (`task: "Task-087"`) and never drops a returned row except ids the editor has already overridden. If the port is omitted, `request.chosenForYou` is the ledger.
- `BoundedDeferralPort.listDeferred(workItemId)` matches Task 074 `BoundedDeferralPolicy.listDeferred`. Pass that instance as `sources.deferrals`. If omitted, `request.deferred` is shown in full.
- `ReadinessCalculatorPort.project(workItemId)` matches Task 074 `ReadinessCalculator.project` (`isReadyToPlan`, `headline`, and `counts` of `chosenForYou`, `deferred`, `conflict`, `openMustAsk`, `settledTotal`). Pass it as `sources.readiness`. If omitted, `request.readiness` is used, or a view derived from the ledger and deferral counts.
- `RevisionImpactPreviewPort.format` matches Task 087 `RevisionImpactPreviewer.format`, including `llmCalls: 0`. `LocalRevisionImpactPreviewer` is the stand-in. `overrideDelegatedChoice` calls it once and returns a Task 087 route. Swap the class for `RevisionImpactPreviewer` without changing the method shape.
- `PaperworkBudgetPort.allocate(totalUnits, connection)` is the preview shape of Task 090 `PaperworkBudgetEnvelopeAllocator`. Shares are the same ppm table: research `30_000`, architecture `50_000`, planning `60_000`, integration/review `40_000`, audit `20_000` (`PAPERWORK_CAP_PPM` `200_000`). `LocalPaperworkEnvelopeAllocator` does that integer split. When Task 090 lands, adapt `allocate(AllocationWeightInput)` / `ENVELOPE_PPM` onto `PaperworkBudgetPort` and keep the preview line.
- `HeftCriticalPathSchedulerPort.schedule({ tasks, preset, widthCap })` returns `{ criticalPathMinutes, parallelSpeedupFactor, activeSlotsByTime }` plus `sequentialMinutes` and `peakWorkers`. `LocalHeftCriticalPathScheduler` is a deterministic list scheduler (critical-path first, preset widths Fastest 7 / Balanced 5 / Cheapest 3). Swap for Task 107 `HeftCriticalPathScheduler` when that branch lands.
- `CrewPresetProfileEnginePort.apply(preset, tasks)` assigns `Junior` / `Mid` / `Senior`. Cheapest uses `safetyFloor`. Balanced uses the balanced level clamped up to the floor. Fastest raises critical-path tasks one level, still clamped to the floor. Costs are `junior * { Junior: 100, Mid: 180, Senior: 320 } / 100`. Durations treat the stored minutes as the Mid duration (Junior `1.5×`, Senior `0.7×`). Swap for Task 107 `CrewPresetProfileEngine`. The `safetyFloor` field is the Task 106 floor from `ExpectedCostLevelSelector`; this branch does not import `src/crew-levels/**`. Fill `safetyFloor` from that selector at integration.
- Task 092 graph compilation is not on this base. Callers pass the already compiled Phase 0 and Wave 1 leaves plus projected feature ranges. This module does not compile the graph.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-108-plan-preview-autostart-gate`. Worktree base is `649773097c387ae534b686ea5825f449f843aa7c` (`foundation/task-001-complete`). `harness/integration` had moved past that commit and its lockfile did not match `packages/shared-contracts/package.json`, so the worktree was created with `--base 649773097c387ae534b686ea5825f449f843aa7c`.

- `pnpm --filter @ef-harness/planner test -- plan-preview` — pass. Vitest 5.1.1: 3 files, 29 tests passed. Covers exact Phase 0 (`P0.1`–`P0.8`) + Wave 1 versus Projected Wave 2 and Completion ranges, the paperwork line and 20% integer split, Chosen for you completeness and Task 087 routes, deferred-item visibility, API token-rate labels versus subscription 5-hour allowance labels (no `$` on subscription views), the tiny first build (`$0.15`, 2 tasks) and a large first build both waiting for Start, inclusive boundaries (`5` vs `6` tasks, `$1.00` vs `$1.01`, `2.0%` vs `2.1%`, `$5.00` vs one micro-USD over, `10%` window vs one ppm over), the six `$0.90` daily-cap sequence, a spend exactly 24h old dropping out of the cap, all hard stops including `chart.js` and a renamed column, external effects, settings ceilings, the `~$0.22` toast with a 5s pause and 10s undo plus a cockpit entry, the date-fns plan delta, Balanced → Cheapest tier/cost/time recompute under 30 ms with zero LLM calls, Fastest raising a critical-path task, an 80-task recompute under 30 ms, the safety floor, the Auth/Orders deferral sentence, wave reorder, budget cap and spend guard, and the Magic Link override refreshing the preview.
- `pnpm --filter @ef-harness/planner typecheck` — pass (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/planner lint` — pass (`eslint .`).
- `node scripts/verify-harmony.mjs --task 108` — pass (`harmony ok for Task-108`). Schema 67/67, diagram check, and workspace typecheck, lint, and test.

## Known Limitations / Follow-Ups

Sibling branches are not merged. The local ports above must be swapped at integration. Do not import unpublished packages as if they were already on `harness/integration`.

- Preset cost and duration use the integer tables in this module until Task 107's scheduler and preset engine replace `LocalHeftCriticalPathScheduler` and `LocalCrewPresetProfileEngine`. The editor stays synchronous and makes no model call either way.
- `safetyFloor` is an input. Task 106 `ExpectedCostLevelSelector` should set it. This task does not read `src/crew-levels/**`.
- API auto-start spend uses micro-USD. Subscription auto-start spend uses ppm of the plan window (`planWindowPpm`, default `1_000_000`). The per-revision `$1` ceiling still applies to both connections; a subscription failure does not render the revision as a dollar estimate.
- Display rounding is to the cent or to a trimmed percent, always with `~` or the published-rate / 5-hour sentence. That is an estimate label, not a promise of exact billing.
- The pause control is accepted through `openedAt + 5_000` ms. Undo and Review are accepted through `openedAt + 10_000` ms. `settle` starts the revision only after the undo window and only while the toast is still `pending`.
- Overriding a Chosen for you row hides that criterion and marks the supplied task ids `pendingRevision`. It does not run Task 087. The returned route is what Task 087, Task 114, and Task 156 should execute.
- Projected waves are honest ranges supplied by the caller. This module will not collapse a range into one number. A reversed range throws `PlanPreviewError`.

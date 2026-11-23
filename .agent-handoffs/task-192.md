---
task_id: "Task-192"
branch: "task/192-metalab-fault-injection"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/meta-lab/src/fault-sim/**"
  - "packages/meta-lab/tests/fault-sim/**"
  - ".agent-handoffs/task-192.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 192 handoff

Deterministic full-daemon fault-injection simulator for Meta-Lab M6 chaos engineering. Ephemeral temp directories with real `node:sqlite` WAL databases, virtual `FakeDualClock`, `xoshiro256**` RNG, seeded fault schedules across seven failure classes, TX-boundary `SIGKILL` injection, ten-invariant oracle, fault-coverage matrix, chaos trend receipts, and minimal Vitest reproducer export. Commit stays on `task/192-metalab-fault-injection`.

## Exports Provided

Public module: `packages/meta-lab/src/fault-sim/index.ts` (wire from `packages/meta-lab/src/index.ts` at integration).

Required by Task 200 (M6 release chaos sign-off):

- `FullDaemonFaultSimulator` — `runSingle({ seed })`, `runSweep(seedCount)` with `CI_CHAOS_SEED_COUNT` (50) and `NIGHTLY_CHAOS_SEED_COUNT` (1,000)
- `TxBoundaryCrashInjector` — arm one TX/IO hook, fire `CrashSignal` once
- `ChaosInvariantOracle` — ten global post-chaos invariants (`PRAGMA integrity_check`, path leases, duplicate effects, budgets, PIDs, watchers, secrets, stashes, forward progress)
- `MinimalFaultReproducerExporter` — delta-debug shrink + `chaos-repro-<seed>.test.ts` snippet
- `SeededChaosScenarioMatrix` — `schedule(seed)` for all seven fault classes + every `TX_BOUNDARY_HOOK`
- `Xoshiro256ssRng`, `FakeDualClock`, `faultTraceIdentical`, `writeChaosTrendReceipt`, `coverageReportJson`

## Shared Wiring Needs (Root / Index Barrels)

`packages/meta-lab/src/index.ts` and `packages/meta-lab/package.json` are frozen outside this task. During integration:

```ts
export {
  ChaosInvariantOracle,
  CI_CHAOS_SEED_COUNT,
  FullDaemonFaultSimulator,
  MinimalFaultReproducerExporter,
  NIGHTLY_CHAOS_SEED_COUNT,
  SeededChaosScenarioMatrix,
  TxBoundaryCrashInjector,
} from "./fault-sim/index.js";
```

No root manifest, schema, or workspace edits.

## Dependency Intents (New Packages Requested)

None. Uses built-in `node:sqlite` only inside ephemeral temp dirs.

## Contract Change Requests

None.

## Exact Verification Commands & Results

```text
pnpm --filter @ef-harness/meta-lab typecheck   # pass
pnpm --filter @ef-harness/meta-lab lint        # pass
pnpm --filter @ef-harness/meta-lab test -- fault-sim   # 5/5 pass (50-seed sweep < 45s wall)
node scripts/verify-harmony.mjs --task 192       # harmony ok for Task-192
```

## Known Limitations / Follow-Ups

- `SimulatedDaemonStack` models harnessd recovery contracts locally; swap for Task 034 `M0DeterministicSimHarness`, Task 130 `ColdOpenReconciler`, Task 118 `DiskHeadroomGuard`, Task 150 `ForeignRuntimeResumeCoordinator`, and Task 176 `UnknownOutcomeReconciler` at integration.
- Chaos receipts write to `<ephemeral-root>/meta-lab/reports/chaos-trend.json`, not the repo tree `meta-lab/reports/` until Task 200 wires a reports package path.
- Sibling branches are not on base `649773097c387ae534b686ea5825f449f843aa7c`; do not import unpublished `@ef-harness/sim` m0 exports until integration merges Task 034.
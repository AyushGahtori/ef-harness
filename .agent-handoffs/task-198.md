---
task_id: "Task-198"
branch: "task/198-performance-scale-cert"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "tests/e2e/perf-scale/**"
  - ".agent-handoffs/task-198.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 198 handoff

M6 performance & scale certification suite: six hard SLO gates, `PerformanceAndScaleCertifier`, and machine-readable `ScaleBenchmarkScorecard`. Commit stays on `task/198-performance-scale-cert`. Do not merge.

Sibling branches are not on base `649773097c387ae534b686ea5825f449f843aa7c`. Dependency contracts are wired through **local ports** under `tests/e2e/perf-scale/ports/` (see below). Replace ports with real package barrels on integration; do not keep duplicate implementations.

## Exports Provided

Import from `tests/e2e/perf-scale/index.ts` until the e2e barrel can re-export.

- `PerformanceAndScaleCertifier` — `runAll()` executes SLO 1–6, deletes synthetic temp DB/repos in `finally`, returns `CertificationResult` (`scorecard`, markdown table, exit code).
- `ScaleBenchmarkScorecard` — schema `scale-benchmark-scorecard@1`; per-SLO `{ p50, p95, p99, peakRamMb, threshold, passFail }` plus hardware metadata.
- CLI: `node --import tsx tests/e2e/perf-scale/run-perf-scale-suite.ts` (writes Markdown + JSON, exit 0 only when all SLOs pass).

Vitest (dedicated config because `tests/e2e/vitest.config.ts` is frozen):

`pnpm --filter @ef-harness/e2e exec vitest run --config perf-scale/perf-scale.vitest.ts`

Filter: `pnpm --filter @ef-harness/e2e exec vitest run --config perf-scale/perf-scale.vitest.ts -- perf-scale`

### Local ports (sibling worktree → integration target)

| Port class | File | Sibling task | Integration import |
| --- | --- | --- | --- |
| `SavepointGroupCommitWriter`, `BoardCockpitView`, `RuntimeTasksTableTab` | `ports/db-board.ts` | Task 025, 124, 159, 134 (`M3ScaleAndLatencyCertifier` reference) | `@ef-harness/kernel` writer + renderer board |
| `KnowledgeViewExporter`, `OrphanBranchPortabilityExporter` | `ports/export-graph.ts` | Task 085, 186, 087, 092 | `@ef-harness/views`, `@ef-harness/portability` |
| `MigrationAndRebuildEngine` | `ports/migration-200mb.ts` | Task 015, 016 | `@ef-harness/db` migrations |
| `UiLatencyHeartbeatMonitor`, `OfficeFrameBudgetMonitor`, `InteractiveArchitectureCanvas`, `WorkerInspectorPanel` | `ports/ui-laptop.ts` | Task 117, 118, 153, 164, 126 | renderer + governor packages |
| Loopback IPC harness | `ports/startup-ipc.ts` | daemon named-pipe transport (Task 001) | `apps/daemon` IPC layer |

Fail-closed probes: `certifyInjectedDb(95, 1)` and `certifyInjectedBoard(8, 24)` in `perf-scale-certification.test.ts`.

## Shared Wiring Needs (Root / Index Barrels)

`tests/e2e/vitest.config.ts` is frozen (`tests/**/*.test.ts` only). Extend includes during integration:

```ts
include: ["tests/**/*.test.ts", "perf-scale/**/*.test.ts"],
```

Until then, use `perf-scale/perf-scale.vitest.ts` (matches Task 197 `docs-parity/parity.vitest.ts` pattern).

Optional root script for Task 200:

```json
"test:perf-scale": "pnpm --filter @ef-harness/e2e exec vitest run --config perf-scale/perf-scale.vitest.ts"
```

When `tests/e2e/src/index.ts` may change, re-export `PerformanceAndScaleCertifier` and `ScaleBenchmarkScorecard` from `tests/e2e/perf-scale/index.ts`.

## Dependency Intents (New Packages Requested)

None. Uses Node `node:sqlite`, `node:net`, and `node:fs` only (no new workspace dependencies).

## Contract Change Requests

Request `tests/e2e/vitest.config.ts` include glob extension (above) so `pnpm --filter @ef-harness/e2e test -- perf-scale` matches Task 198 acceptance without a separate config path.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-198-performance-scale-cert`:

- `pnpm --filter @ef-harness/e2e exec vitest run --config perf-scale/perf-scale.vitest.ts -- perf-scale` — pass (Vitest v5.1.1, 7 files, 10 tests, ~18–58 s wall depending on cold 200 MB synthesis). All 6 SLOs green; `ScaleBenchmarkScorecard` records hardware (`win32`, 12 logical CPUs, 16 GB RAM). Observed highlights: SLO 1 DB write p99 ~1.4 ms; SLO 2 board p95 ~0.08 ms; SLO 3 full views export ~8 ms; SLO 4 migration ~3–4.6 s (peak RSS ~78 MB) on synthetic ~200 MB `state.db`; SLO 6 pipe p99 ~4.9 ms with keep-alive loopback + `TCP_NODELAY`.
- `pnpm --filter @ef-harness/e2e test -- perf-scale` — **expected fail until vitest include wiring** (`No test files found`; default config includes only `tests/**/*.test.ts`).
- `pnpm --filter @ef-harness/e2e typecheck` — pass (`tsc -b`, exit 0).
- `pnpm --filter @ef-harness/e2e lint` — pass (`eslint .`, exit 0).
- `node scripts/verify-harmony.mjs --task 198` — pending commit (handoff `ready_for_integration`).

## Known Limitations / Follow-Ups

- SLO 1 does not sleep a literal 60 s; `SavepointGroupCommitWriter` uses the same savepoint group-commit pattern as Task 134 (`50` workers × `8` rounds, warmup excluded). `scenarioWindowSec` metadata remains `60` for scorecard continuity.
- SLO 4 synthesizes ~200 MB `state.db` on the fly; first run can take tens of seconds on slower hosts. Set `EF_PERF_SKIP_200MB=1` only for debugging (skips SLO 4 metric in certifier); **do not** use for release gates.
- SLO 5 simulates 16 GB Governor constraints in-process; it does not launch Electron. Replace with live renderer heartbeat wiring after Tasks 117–119 and 164 integrate.
- SLO 6 uses TCP loopback as a named-pipe latency/throughput stand-in until daemon IPC is on this branch.
- If any SLO fails on CI hardware, the scorecard records measured values; thresholds are not weakened in code.
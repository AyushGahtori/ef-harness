---
task_id: "Task-034"
branch: "task/034-m0-deterministic-sim-exit-gate"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/sim/src/m0/**"
  - "packages/sim/tests/m0/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 034 handoff

M0 exit gate: seeded deterministic simulator, fake model adapter, eight-point crash injector, and the 10,000-run certification. Commit stays on `task/034-m0-deterministic-sim-exit-gate`.

## Exports Provided

Import from `packages/sim/src/m0/index.ts` (the package barrel is outside this task's write scope):

- `DeterministicSeededRng`
- `FakeDualClock`
- `SimEventLoop`
- `FakeModelAdapter`
- `CrashFaultInjector`
- `CrashSignal`
- `FAULT_POINTS`
- `M0KernelSimulator`
- `runSimulation`
- `replaySeed`
- `runSweep`
- `runM0ExitCertification`
- `minimizeFailingSeed`
- `ClientStateSyncer`
- `measureM0Performance`
- `writeM0ExitReport`

`Task 192` can reuse `DeterministicSeededRng`, `FakeDualClock`, `FakeModelAdapter`, and `CrashFaultInjector`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/sim/src/index.ts` is outside the owned subtree. Re-export the symbols above from that barrel when a later integration task is allowed to edit it.

These scripts could not be added because root `package.json` and `packages/sim/package.json` are frozen by Task 001:

- root `sim:replay`: `node --import tsx packages/sim/src/m0/replay-cli.ts`
- root `test:m0-exit`: `node --import tsx packages/sim/src/m0/certify-cli.ts`
- `@ef-harness/sim` `certify:m0`: `node --import tsx src/m0/certify-cli.ts`

`pnpm test` already runs the fast 500-memory + 10-disk sweep because it lives in `packages/sim/tests/m0/m0.test.ts`.

## Dependency Intents (New Packages Requested)

None. The simulator uses built-in `node:sqlite`, `node:crypto`, and `node:net`.

## Contract Change Requests

None. Canonical `schema/state.sql`, `schema/global.sql`, and `schema/queries.sql` are executed as they stand.

## Exact Verification Commands & Results

- `pnpm --filter @ef-harness/sim test -- m0` — 18/18 passed in 6.63s. Seed 42 and seed 1337 each repeat with an identical trace SHA-256. The fast sweep is 500 memory runs + 10 disk runs, 510/510 passed, under 15s.
- `node --import tsx packages/sim/src/m0/certify-cli.ts` — `M0 exit 10000/10000`, fault coverage yes (each of the 8 boundaries fired 1250 times), sweep write p99 `6.212 ms`. Report: `packages/sim/tests/m0/M0_EXIT_REPORT.md`.
- `node --import tsx -e` calling `measureM0Performance()` — 50-writer p99 `0.033 ms` (< 50 ms) and 500-task / 5,000-requirement board query `0.034 ms` (< 10 ms).
- `pnpm --filter @ef-harness/sim typecheck` — passed.
- `pnpm --filter @ef-harness/sim lint` — passed.
- `pnpm --filter @ef-harness/sim run certify:m0` — failed: `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`. The package script cannot be added inside this task. The equivalent `node --import tsx` command above is the certification that passed.
- `node --import tsx packages/sim/src/m0/replay-cli.ts --seed 42` — PASS, sha256 `060bdf40f91db93cf7e1e0c9786cf9efde398f56318bf66b9563be2f1fe1a8ea`.
- `node --import tsx packages/sim/src/m0/replay-cli.ts --seed 42 --minimize` — PASS, events=15, same sha256.

## Known Limitations / Follow-Ups

- `packages/db` and `packages/ipc` on this branch only export package identity. Same-layer imports are also forbidden, so the simulator drives canonical SQL itself rather than those packages. If a later integration exposes a kernel bug, record the seed here instead of editing those trees.
- `pnpm sim:replay`, `pnpm test:m0-exit`, and `pnpm --filter @ef-harness/sim run certify:m0` need the frozen-script wiring listed above.
- The fast sweep and the 10,000-run certification run out of process (`node --import tsx` chunk workers) so the wall clock stays inside the fast-gate budget. Results are aggregated; individual `SimRunResult` objects are not retained for those large sweeps.

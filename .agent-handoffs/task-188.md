---
task_id: "Task-188"
branch: "task/188-global-resource-broker"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/portability/src/broker/**"
  - "packages/portability/tests/broker/**"
  - ".agent-handoffs/task-188.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 188 handoff

Multi-project global resource broker on `global.db`: weighted fair queuing (`interactive:8`, `foreground:4`, `background:2`, `batch:1`), reserved interactive fast lane per connection, 10-minute cross-project grants, machine-wide Pool-2 / heavy-lane / port (`41000–48999`) coordination, and foreground focus re-weighting. All coordination is in-process via grant-store ports — zero cross-DB `ATTACH`.

Commit stays on `task/188-global-resource-broker`.

## Exports Provided

Wire from `packages/portability/src/broker/index.ts`:

- `GlobalMultiProjectBroker` — registers projects, `setForegroundProject`, provider enqueue/dispatch with reserved interactive lane, `requestBudgetGrant`, execution slots, global port leases, governor Orange shrink, `popoverSnapshot()`.
- `WeightedFairQueueArbiter` — deficit WFQ across four canonical classes; `tryDispatchInteractiveFastLane` for sub-50ms interactive latency.
- `CrossProjectGrantLeaseManager` — atomic `BEGIN IMMEDIATE`-style pooled grants (`micro_usd` | `ppm`), partial grants, `reclaimExpiredGrants`, `closeGrant` remainder return.
- `MachineWideSlotCoordinator` — global Pool-2 warm slots, heavy lane, verifier-first wait queue, `41000–48999` `port_leases`, Orange single-slot mode.
- `ReservedInteractiveLanePerConnection` — one reserved interactive slot per connection when `cwnd >= 2` (Task 140 port).
- `InMemoryGlobalGrantStore` — test/deterministic stand-in for `global.db.grants` until Task 014 `GlobalDbRepo` lands on this base.
- Types: `PRIORITY_CLASS_WEIGHTS`, `GRANT_TTL_MS`, `BrokerRequest`, `ExecutionSlotRequest`, `BrokerPopoverSnapshot`, `PacingCwndPort`, `GlobalDbGrantStore`, `BrokerGrantIssuerPort`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/portability/src/index.ts` is frozen for this branch. On integration:

```ts
export {
  CrossProjectGrantLeaseManager,
  GlobalMultiProjectBroker,
  InMemoryGlobalGrantStore,
  MachineWideSlotCoordinator,
  ReservedInteractiveLanePerConnection,
  WeightedFairQueueArbiter,
  wfqWeight,
} from "./broker/index.js";
export type {
  BrokerPopoverSnapshot,
  BrokerRequest,
  ExecutionSlotRequest,
  GrantIssueInput,
  GrantIssueResult,
  MachineCapacityLimits,
  PriorityClass,
  SlotToken,
} from "./broker/index.js";
```

No root `package.json` change.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

Sibling tasks are not on `6497730`. This branch uses local ports; swap adapters when the real modules land:

| Needed sibling | This branch | Swap |
| --- | --- | --- |
| Task 014 `GlobalDbRepo` | `GlobalDbGrantStore` + `InMemoryGlobalGrantStore` | Persist `grants`, `port_leases`, `connection_windows` via real SQLite repo; keep `CrossProjectGrantLeaseManager` API. |
| Task 024 `CrossDbGrantProtocol` | `BrokerGrantIssuerPort` type + in-memory grant rows | Route `requestBudgetGrant` through `BrokerGrantIssuer.issueGrant` and project `deposit_grant` messages; no `ATTACH`. |
| Task 118 `HeavyLaneSemaphore` | `MachineWideSlotCoordinator` heavy-lane counter | Inject semaphore acquire/release around heavy-class execution after Pool-2 lease (Task 119 ordering). |
| Task 119 `ThreePoolCapacityScheduler` | `MachineCapacityLimits.pool2WarmSlots` from constructor | Feed `hardwarePoolCap()` / `executionTarget()` instead of static limits; multi-project shares one coordinator instance in `harnessd`. |
| Task 140 `AllowancePacingController` | `PacingCwndPort.getCwnd` + `ReservedInteractiveLanePerConnection` | Wire live `cwnd` and `InteractivePrioritySlot`; shared `connection_windows` in `global.db` (not per-project `state.db`). |
| Task 133 Diagnostics / Top Bar | `popoverSnapshot()` | Render connection breakdown strings and `machineRunSlots`. |
| Task 195 E2E | full broker surface above | Multi-project journey should use reserved interactive slot `< 100 ms` and shared grants/ports. |

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-188-global-resource-broker`:

- `pnpm --filter @ef-harness/portability test -- broker` — pass, 4 files, 10 tests.
- `pnpm --filter @ef-harness/portability typecheck` — pass (`tsc -b`).
- `pnpm --filter @ef-harness/portability lint` — pass (`eslint .`).
- `node scripts/verify-harmony.mjs --task 188 --require-ready` — pass (`harmony ok for Task-188`).

## Known Limitations / Follow-Ups

- `packages/portability/src/index.ts` is untouched; integrator applies the barrel block above.
- Grant issuance uses an in-memory `global.db` stand-in; production should use Task 024 `BrokerGrantIssuer` + Task 014 persistence.
- `sessionProcessCap` is modeled on limits but not enforced in v1 of this branch (Pool-2 + heavy lane + ports are fully tested).
- GitHub shared rate queue (`Task 177`) is documented in the task spec but not wired here; add when that branch integrates.
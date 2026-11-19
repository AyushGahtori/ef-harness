---
task_id: "Task-025"
branch: "task/025-idempotency-group-commit"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/db/src/write-queue/**"
  - "packages/db/tests/write-queue/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 025 handoff

Idempotency operations store, savepoint group-commit batcher, and knowledge-barrier scheduler. Commit stays on `task/025-idempotency-group-commit`.

## Exports Provided

From `packages/db/src/write-queue/index.ts`:

- `CoordinatorWriteQueue` with `submitOperation`, `submitKnowledgeBarrier`, `flushRuntimeBatch`, `pruneOldOperations`, `getQueueMetrics`, and `drainAndClose`
- `OpIdReusedError` (`code: "op_id_reused"`, `opId`)
- `QueueBackpressureError`, `ProjectSafeModeError`, `MissingOpIdError`, `QueueClosedError`, `OperationResultError`
- `WritePriority` (`"interactive" | "runtime" | "knowledge_barrier"`) and `WRITE_PRIORITIES`
- `WriteQueueLatencyMetrics` (`samples`, `p50Ms`, `p95Ms`, `p99Ms`, `maxMs`, queue depths, commit and rejection counters)
- `ProjectStateDb`, `ProjectStateWriter`, `PreparedWrite`, `WriteTransaction`, `OperationReceipt`
- `KnowledgePropagationEvent`, `KnowledgePropagationHook`, `KnowledgePropagationNode`, `ChangeClass`
- `ComputeRequestHash`, `defaultComputeRequestHash` (fallback until Task 007 is injected)
- `canonicalQuery` / `loadQueryCatalog` (reads `op_lookup` and `prune_operations` from `schema/queries.sql`)
- `DEFAULT_MAX_BATCH_SIZE` (32), `DEFAULT_COALESCE_WINDOW_MS` (3), `OPERATIONS_RETENTION_MS` (30 days)

`submitOperation` defaults to `runtime`. Pass `priority: "interactive"` for chat, Stop, and inbox resolution. Knowledge change sets go through `submitKnowledgeBarrier` and never share a `BEGIN IMMEDIATE` transaction with runtime or interactive work. Caller promises settle only after `COMMIT` returns. A `SQLITE_FULL` / `SQLITE_IOERR` / `SQLITE_CORRUPT` failure on that commit rejects every operation in the batch and calls `ProjectStateDb.enterSafeMode`.

Post-commit knowledge propagation reads `read_sets` through the `read_sets_by_node` index after `COMMIT`. A throwing hook is logged (`knowledge_propagation_failed`) and retried without failing the already-committed receipt. `drainAndClose` stops new writes, finishes queued work, and resolves when those promises have settled.

## Shared Wiring Needs (Root / Index Barrels)

`packages/db/src/index.ts` is outside this task's write scope. Add:

```ts
export {
  CoordinatorWriteQueue,
  DEFAULT_COALESCE_WINDOW_MS,
  DEFAULT_MAX_BATCH_SIZE,
  OPERATIONS_RETENTION_MS,
  MissingOpIdError,
  OpIdReusedError,
  OperationResultError,
  ProjectSafeModeError,
  QueueBackpressureError,
  QueueClosedError,
  WRITE_PRIORITIES,
  canonicalQuery,
  defaultComputeRequestHash,
} from "./write-queue/index.js";
export type {
  ChangeClass,
  ComputeRequestHash,
  CoordinatorWriteQueueOptions,
  KnowledgePropagationEvent,
  KnowledgePropagationHook,
  KnowledgePropagationNode,
  OperationReceipt,
  PreparedWrite,
  ProjectStateDb,
  ProjectStateWriter,
  SqlRow,
  SqlValue,
  StatementChanges,
  SubmitKnowledgeBarrierInput,
  SubmitOperationInput,
  WritePriority,
  WriteQueueLatencyMetrics,
  WriteQueueLogger,
  WriteTransaction,
} from "./write-queue/index.js";
```

Task 032 (IPC), Task 034 (M0 sim), and `apps/daemon` should construct one `CoordinatorWriteQueue` per open project:

```ts
new CoordinatorWriteQueue({
  stateDb,
  computeRequestHash, // Task 007
  onKnowledgePropagated,
});
```

`stateDb.writer.prepare` must accept bare named parameters (`:op_id` binds from `{ op_id }`), matching `schema/schema-test.js` and the Task 012 statement contract. The writer connection is expected to already have `journal_mode = WAL` and `synchronous = FULL`.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None. Consumed contracts, satisfied on this branch by constructor injection because Tasks 007, 012, and 013 are not on `harness/integration` yet:

- `computeRequestHash(request: unknown): string` from Task 007. Pass it as `options.computeRequestHash`. Until that wiring lands, `defaultComputeRequestHash` is SHA-256 over NFC strings and RFC 8785 canonical JSON.
- `ProjectStateDb.isSafeMode()`, `ProjectStateDb.enterSafeMode(reason, diagnostics?)`, and `ProjectStateDb.writer` (`exec`, `prepare`) from Task 013 / Task 012.

No change to `schema/queries.sql`. The queue prepares `op_lookup` and `prune_operations` from that file. `operations` rows are inserted in the same savepoint as the mutation. `pruneOldOperations` deletes only `operations` rows with `created_at < now - 30 days`.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-025-idempotency-group-commit`:

- `pnpm --filter @ef-harness/db test -- write-queue` — pass, 4 files, 19 tests (vitest 5.1.1). Covered idempotent replay, `OpIdReusedError` on an altered request, synchronous missing `op_id`, 30-day `prune_operations` plus idle prune, savepoint isolation (10 ops with #3 failing and #7 replaying #2; 20 ops with one unexpected error), serial savepoint visibility, interactive-before-runtime priority, `SQLITE_FULL` rejecting all 10 callers and entering safe mode, backpressure, safe-mode dequeue halt, `flushRuntimeBatch`, `drainAndClose`, both R17-vs-T07 orders, propagation retry, and 50-worker p50/p95/p99 with `p99 < 50 ms`.
- `pnpm --filter @ef-harness/db typecheck` — pass (`tsc -b`).
- `pnpm --filter @ef-harness/db lint` — pass (`eslint .`).
- `node scripts/verify-harmony.mjs --task 025 --require-ready` — pass (`harmony ok for Task-025`), including repo `typecheck`, `lint`, `test`, schema 67/67, and diagram checks.

## Known Limitations / Follow-Ups

- `defaultComputeRequestHash` must be replaced by Task 007's `computeRequestHash` at the daemon wiring site. Do not keep two hashers in production.
- The queue does not embed claim, reserve, or check SQL. Callers pass `execute` and use canonical statements themselves (`stale_reads_for_acceptance` is what the R17/T07 tests run inside the savepoint).
- Propagation retries are process-local timers (up to 6 attempts) and are cleared by `drainAndClose`. They are not durable across a crash.
- A knowledge barrier records affected nodes only through `WriteTransaction.recordChangedNode`. Post-commit lookup is `read_sets INDEXED BY read_sets_by_node`.
- Default queue caps are interactive 128, runtime 512, and knowledge_barrier 64. Interactive operations are pulled ahead of queued runtime work and ahead of a barrier that has not started. Runtime operations do not cross a queued knowledge barrier.

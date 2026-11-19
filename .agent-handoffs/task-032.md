---
task_id: "Task-032"
branch: "task/032-ipc-event-stream-resync"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/ipc/src/protocol/**"
  - "packages/ipc/tests/protocol/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 032 handoff

Window ↔ daemon session protocol: JSON-RPC routing, gap-free outbox streaming, `stream_epoch` resync, and paginated `snapshot.get`. Commit stays on `task/032-ipc-event-stream-resync`.

## Exports Provided

Import from `packages/ipc/src/protocol/index.ts` (not yet re-exported by `packages/ipc/src/index.ts`).

- `RpcRouter` — JSON-RPC 2.0 router for `session.hello` / `session.ping` and the documented namespaces (`project`, `chat`, `question`, `batch`, `node`, `graph`, `impact`, `plan`, `build`, `task`, `inbox`, `artifact`, `diff`, `preview`, `settings`, `diag`) plus `events.subscribe` and `snapshot.get`. Zod validates params. Every mutating method requires a non-empty `op_id` and is submitted to `CoordinatorWriteQueue` (`batch.accept` via `submitKnowledgeBarrier`, other mutations via `submitOperation`). `session.hello` accepts protocol `1.0` and `1.1` only.
- `EventSubscriptionServer` — `events.subscribe { project, topics, since_seq, stream_epoch? }`. Returns `{ status: "resync_required", current_stream_epoch, latest_seq }` when `stream_epoch` differs or `getMinRetainedSeq() > since_seq + 1` (including `since_seq === 0` once retained history starts after seq 1). Otherwise arms the live buffer before `replayEventsSince`, emits `events.batch { from_seq, to_seq, events }` (topic misses stay inside the seq span), then tails live publishes. `publishTelemetry` sends unsequenced `telemetry` notices and sheds the oldest per slow socket without delaying domain batches. `getMetrics()` exposes replay duration, resync count, dropped telemetry, and subscription lag.
- `SnapshotAssembler` — `snapshot.get { project, views, cursor? }` returns `{ as_of_seq, stream_epoch, sections, nextCursor }` for `board`, `feature_progress`, `inbox`, `holds`, `runtime`, and `budget`. Pages stay within 2 MB per section and within the 1 MB channel-0 frame. A later page returns `resync_required` when `stream_epoch` changes or `latest_seq` moves past `as_of_seq + seqBuffer` (default 32). `snapshotSourceFromReadModels` adapts `ReadModelRepo` plus keyset readers.
- `ClientStateSyncer` — pure TypeScript, no React. Applies a domain batch only when it continues `lastApplied + 1`, ignores `seq <= lastApplied`, and on a gap resubscribes from `lastApplied`. On `resync_required`, pages `snapshot.get`, replaces local sections at that `as_of_seq`, and resubscribes from there. `reconnect()` resubscribes from `lastApplied` after a pipe drop. `ProjectSyncRegistry.getOrCreate` keeps one syncer per project so Board and Office share the stream.
- `createSessionProtocol` wires the router, subscription server, snapshot assembler, and metrics registry.

Consumed ports (local interfaces, satisfied by Tasks 025–027 and 031): `CoordinatorWriteQueue`, `OutboxRepo` (`replayEventsSince`, `getMinRetainedSeq`, `getLatestSeq`, `getStreamEpoch`), `ReadModelRepo`, `ProtocolConnection`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/ipc/src/index.ts` is outside this task's write scope. Integration should re-export the protocol surface:

```ts
export {
  RpcRouter,
  EventSubscriptionServer,
  SnapshotAssembler,
  ClientStateSyncer,
  ProjectSyncRegistry,
  createSessionProtocol,
} from "./protocol/index.js";
```

`ProtocolConnection` is the seam Task 031's named-pipe session should call: decode a channel-0 payload, `router.handle(connection, payload)`, and forward `publishDomain` / `publishTelemetry` into `EventSubscriptionServer`. `isWritable` must go false while the socket is backed up so telemetry can be shed ahead of `events.batch`.

## Dependency Intents (New Packages Requested)

`packages/ipc` imports `zod` (`^3.25.0`, already a root devDependency). `packages/ipc/package.json` is frozen by Task 001, so this task does not add the dependency. Please add `zod` to `@ef-harness/ipc` dependencies at integration. Resolution currently succeeds because Node walks up to the workspace root `node_modules/zod`.

## Contract Change Requests

None. Ports mirror Task 025 `CoordinatorWriteQueue` / `WritePriority` / `OpIdReusedError` (matched by `error.name`), Task 026 `replayEventsSince(sinceSeq, topics, limit)` plus `getMinRetainedSeq` / `getStreamEpoch` / `getLatestSeq`, and Task 027 `getBoardSummary` / `getFeatureProgress`. Replay is called with `topics === undefined` so the protocol, not SQL, can mark filtered seqs in `from_seq` / `to_seq`.

`getMinRetainedSeq()` for an empty project must be `1` (or any value `<= since_seq + 1`) so a fresh `since_seq: 0` subscribes live. After pruning, it must be the first retained `seq`.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-032-ipc-event-stream-resync` on `task/032-ipc-event-stream-resync`.

- `pnpm --filter @ef-harness/ipc test -- protocol` — pass. 4 files, 23 tests. Covers `events.subscribe` replay-to-live under concurrent publish, duplicate suppression, gap resubscribe, `stream_epoch` and pruned-`since_seq` `resync_required` (including `since_seq: 0`), `ClientStateSyncer` snapshot recovery, multi-page `snapshot.get` under 2 MB, telemetry shedding with every `events.batch` kept in seq order, multi-window fan-out, and `op_id` idempotency.
- `pnpm --filter @ef-harness/ipc typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/ipc lint` — pass (`eslint .`, exit 0).
- `node scripts/verify-harmony.mjs --task 032` — pass (`harmony ok for Task-032`).

## Known Limitations / Follow-Ups

- `ClientStateSyncer` does not interpret domain payloads into board lanes. After a snapshot, view state is `sections` at `as_of_seq` plus the contiguous `appliedEvents` with `seq > as_of_seq`. Callers reduce those events.
- The assembler reserves 80 characters for the JSON-RPC id when measuring a page. A longer id can push the on-wire frame over the 1 MB channel-0 cap.
- `snapshotSourceFromReadModels` reads every requested view when the pin opens and then keyset-pages that copy. A SQLite adapter should perform that read inside one read transaction.
- Named-pipe reconnect, framing, and auth stay in Task 031. `ClientStateSyncer.reconnect()` only resubscribes on the injected transport.
- `session.hello` rejects minor versions newer than `1.1`. Unknown additive fields on daemon notifications and results are accepted and ignored.

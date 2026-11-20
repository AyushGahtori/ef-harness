---
task_id: "Task-026"
branch: "task/026-transactional-outbox"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/db/src/outbox/**"
  - "packages/db/tests/outbox/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 026 handoff

Transactional outbox on `task/026-transactional-outbox`. Commit stays on this branch.

## Exports Provided

Import from `packages/db/src/outbox/index.ts` until the db barrel is wired:

- `OutboxRepo` — `appendEventInTx(conn, event, consumers)`, `fetchPendingForConsumer`, `acknowledgeDelivery`, `replayEventsSince(sinceSeq, topics?, limit?)`, `getMinRetainedSeq`, `getHighWaterSeq`, `getStreamEpoch`, `pruneAcknowledgedOutbox(conn, cutoff?)`, `auditOutboxDeliveries`, `listUnackedConsumers`, `isDeliveryAcknowledged`
- `OutboxDispatcher` — `registerConsumer`, `start`, `stop`, `replayPendingOnStartup`, `dispatchPending`, `runMaintenance`, `startPeriodicMaintenance`, `assertNewTurnsAllowed`
- `DEFAULT_EVENT_CONSUMERS` — routed types `TaskAccepted`, `TaskHoldPlaced`, `FeatureCompleted`, `RevisionPublished`, `BudgetThresholdCrossed`, `InboxItemCreated`, `ShipRunUpdated`, `ContractChanged`, `DependencyReady`. Each list includes `exporter` and `ui_projection`. `resolveEventConsumers(type, consumers)` keeps the caller order and appends any omitted mandatory consumer. An explicit `[]` is still rejected before that merge.
- `EmptyOutboxConsumersError`, `TelemetryNotAllowedInOutboxError`, `OutboxTransactionRequiredError`, `InvalidOutboxEventError`, `OutboxStartupReplayPendingError`, `PermanentOutboxDeliveryError`, `TransientOutboxDeliveryError`
- `deliveryKey(eventId, consumer)` → `eventId + ':' + consumer`
- `retainedHistoryRequiresResync`, `streamEpochRequiresResync`, `deliveryBackoffMs`
- `PENDING_FOR_CONSUMER_SQL` (inner scan matches partial index `outbox_pending`)
- `canonicalOutboxQueries()` — `register_delivery`, `prune_outbox`, and `outbox_without_deliveries` parsed from `schema/queries.sql` the same way as `schema/schema-test.js`
- Types: `OutboxConnection`, `OutboxEventDraft`, `StoredOutboxEvent`, `AppendedOutboxEvent`, `OutboxDeliveryRecord`, `OutboxReplayBatch`, `OutboxAuditAlert`, `OutboxPruneResult`, `OutboxConsumerLag`, `OutboxLagMetric`, `OutboxConsumerHandler`, `OutboxStartupResult`

`appendEventInTx` must run on a connection already inside `BEGIN IMMEDIATE` (`conn.isTransaction === true`). It rejects `telemetry.*`, `worker.heartbeat`, and `token.delta` with `TelemetryNotAllowedInOutboxError`, and `consumers: []` with `EmptyOutboxConsumersError`, both before any SQL. `seq` is SQLite `INTEGER PRIMARY KEY AUTOINCREMENT` and is never supplied by the repo. `pruneAcknowledgedOutbox` defaults the cutoff to `now - 7 days` (millisecond `created_at`). `replayEventsSince` sets `resyncRequired` when retained history does not connect to `sinceSeq` (`sinceSeq === 0` and `minRetainedSeq === 1` replays from seq 1; `minRetainedSeq === 500` with `sinceSeq === 0` resyncs). `streamEpoch` on the batch is `meta.stream_epoch`. Task 032 should treat `streamEpochRequiresResync(current, clientEpoch)` as `resync_required` as well.

`OutboxDispatcher` polls each consumer in `seq ASC` through `outbox_pending`. Handlers are `(event, seq, deliveryKey)`. Failures retry with exponential backoff (`50 ms`, doubling, cap `1_000 ms`, overridable). `PermanentOutboxDeliveryError` stops that consumer without blocking other consumers. After a successful handler, `delivered_at` is set in `BEGIN IMMEDIATE` unless the handler already acknowledged inside its own transaction. `replayPendingOnStartup` / `start` audits `outbox_without_deliveries` and drains pending rows before `assertNewTurnsAllowed()` succeeds. Delivery-less rows are logged at high severity and are not deleted. A pending backlog at or above 100 rows, or older than the 7-day retention, emits `outbox.consumer_lag` while `prune_outbox` still keeps the row.

## Shared Wiring Needs (Root / Index Barrels)

`packages/db/src/index.ts` is outside this task's owned subtree. Please re-export the outbox surface from that barrel so later tasks import `@ef-harness/db` and do not deep-import `src/outbox`:

```ts
export {
  DEFAULT_EVENT_CONSUMERS,
  EmptyOutboxConsumersError,
  OutboxDispatcher,
  OutboxRepo,
  OutboxStartupReplayPendingError,
  OutboxTransactionRequiredError,
  PermanentOutboxDeliveryError,
  TelemetryNotAllowedInOutboxError,
  TransientOutboxDeliveryError,
  deliveryKey,
  resolveEventConsumers,
  retainedHistoryRequiresResync,
  streamEpochRequiresResync,
} from "./outbox/index.js";
export type {
  AppendedOutboxEvent,
  OutboxConnection,
  OutboxConsumerHandler,
  OutboxEventDraft,
  OutboxReplayBatch,
  OutboxStartupResult,
  StoredOutboxEvent,
} from "./outbox/index.js";
```

No root `package.json` or workspace manifest edits.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None. `schema/state.sql` and `schema/queries.sql` are unchanged. `register_delivery`, `prune_outbox`, and `outbox_without_deliveries` are executed from the canonical file.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-026-transactional-outbox`:

- `pnpm --filter @ef-harness/db test -- outbox` — pass, 2 files, 19 tests (atomic append + rollback, `EmptyOutboxConsumersError` before SQL, `TelemetryNotAllowedInOutboxError` for `telemetry.*` / `worker.heartbeat` / `token.delta`, schema-test R1 and unacked prune, seq `1, 2` pruned then next is `3`, gap-free replay, `resyncRequired` when `sinceSeq` precedes retained history, `outbox_pending` query plan, crash retry, receipt dedupe, `ContractChanged` + `DependencyReady`, slow-consumer lag).
- `pnpm --filter @ef-harness/db typecheck` — pass (`tsc -b`).
- `pnpm --filter @ef-harness/db lint` — pass (`eslint .`).
- `node scripts/verify-harmony.mjs --task 026` — pass (`harmony ok for Task-026`, including workspace typecheck, lint, and test).

## Known Limitations / Follow-Ups

- Task 008 `EventV1Schema`, Task 012 `SqliteConnection` / `QueryCatalog`, and Task 013 `ProjectStateDb` are not on `harness/integration` yet. This task uses a structural `OutboxConnection` (`isTransaction`, `exec`, `prepare`) satisfied by `node:sqlite` `DatabaseSync`. Field checks cover the `event@1` columns that `outbox` stores (`id`, `type`, `subject`, `rev` / `revision`, `payload`, `created` / `createdAt`). When those tasks land, validate drafts with `EventV1Schema` before `appendEventInTx`, pass the project writer connection, and the named-query loader can delegate to `QueryCatalog` without changing the SQL text.
- `replayEventsSince` reports retention gaps. A `stream_epoch` change is returned on the batch and compared with `streamEpochRequiresResync` so Task 032 can answer `resync_required`. This repo does not store the client's previous epoch.
- `assertNewTurnsAllowed` becomes true after the startup replay pass finishes, including when a consumer such as a paused `exporter` is still pending. Pending rows stay unacknowledged and keep pruning blocked. The gate enforces "replay before new turns", and it does not freeze the scheduler on one offline consumer.
- Topic-filtered replay is strictly increasing by `seq` but may skip other event types. Unfiltered replay returns a consecutive gap-free prefix and sets `resyncRequired` when the next retained row is not `sinceSeq + 1`.
- The maintenance timer defaults to 60 seconds and is `unref`'d. Tests call `stop()`.

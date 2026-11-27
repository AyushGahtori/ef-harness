import {
  OPERATIONS_RETENTION_MS,
  bindCoordinatorWriteQueue,
  bindOutbox,
  bindReadModels,
  type CoordinatorWriteQueue as DbCoordinatorWriteQueue,
  type FeatureProgress as DbFeatureProgress,
  type OutboxRepo as DbOutboxRepo,
  type ProjectStateDb,
  type ReadModelRepo as DbReadModelRepo,
  type StoredOutboxEvent,
  type WriteTransaction,
} from "@ef-harness/db";
import { snapshotSourceFromReadModels } from "./snapshot-assembler.js";
import type {
  BoardLaneCount,
  BoardSummary,
  CoordinatorWriteQueue,
  DomainEvent,
  DriftReport,
  FeatureProgress,
  KeysetReader,
  OutboxRepo,
  ProjectOutboxDirectory,
  QueueLatencyMetrics,
  ReadModelRepo,
  SnapshotSource,
  TraceabilityGaps,
  WriteOperation,
} from "./ports.js";

export interface DbWriteQueuePortOptions {
  readonly retentionMs?: number;
}

export interface BindIpcProjectOptions {
  readonly coalesceWindowMs?: number;
  readonly retentionMs?: number;
}

export interface IpcProjectBinding {
  readonly writeQueue: CoordinatorWriteQueue;
  readonly outboxes: ProjectOutboxDirectory;
  readonly snapshots: SnapshotSource;
  readonly outbox: DbOutboxRepo;
  readonly readModels: DbReadModelRepo;
  readonly dbWriteQueue: DbCoordinatorWriteQueue;
}

const EMPTY_READER: KeysetReader = {
  async readAfter(): Promise<{ readonly items: readonly []; readonly done: true }> {
    return { items: [], done: true };
  },
};

export function bindIpcProject(
  stateDb: ProjectStateDb,
  projectId: string,
  options: BindIpcProjectOptions = {},
): IpcProjectBinding {
  const queueOptions: { coalesceWindowMs?: number; retentionMs?: number } = {};
  if (options.coalesceWindowMs !== undefined) queueOptions.coalesceWindowMs = options.coalesceWindowMs;
  if (options.retentionMs !== undefined) queueOptions.retentionMs = options.retentionMs;
  const dbWriteQueue = bindCoordinatorWriteQueue(stateDb, queueOptions);
  const outbox = bindOutbox(stateDb);
  const readModels = bindReadModels(stateDb);
  const outboxPort = createDbOutboxPort(outbox);
  const readModelPort = createDbReadModelPort(readModels);
  const portOptions: DbWriteQueuePortOptions =
    options.retentionMs === undefined ? {} : { retentionMs: options.retentionMs };
  return {
    writeQueue: createDbWriteQueuePort(dbWriteQueue, portOptions),
    outboxes: createDbOutboxDirectory(projectId, outboxPort),
    snapshots: createDbSnapshotSource(projectId, outboxPort, readModelPort),
    outbox,
    readModels,
    dbWriteQueue,
  };
}

export function createDbWriteQueuePort(
  queue: DbCoordinatorWriteQueue,
  options: DbWriteQueuePortOptions = {},
): CoordinatorWriteQueue {
  const retentionMs = options.retentionMs ?? OPERATIONS_RETENTION_MS;
  return {
    submitOperation(operation: WriteOperation): Promise<unknown> {
      if (operation.priority === "knowledge_barrier") return submitBarrier(queue, operation);
      const priority = operation.priority === "interactive" ? "interactive" : "runtime";
      return queue
        .submitOperation({
          opId: operation.opId,
          kind: operation.kind,
          request: operation.request,
          priority,
          execute: (tx) => runSync(tx, operation),
        })
        .then((receipt) => receipt.result);
    },
    submitKnowledgeBarrier(operation: WriteOperation): Promise<unknown> {
      return submitBarrier(queue, operation);
    },
    pruneOldOperations(cutoffMs: number): Promise<number> {
      return queue.pruneOldOperations(cutoffMs + retentionMs);
    },
    getQueueMetrics(): QueueLatencyMetrics {
      const metrics = queue.getQueueMetrics();
      return {
        p50Ms: metrics.p50Ms,
        p95Ms: metrics.p95Ms,
        p99Ms: metrics.p99Ms,
        depth: metrics.interactiveDepth + metrics.runtimeDepth + metrics.knowledgeBarrierDepth,
      };
    },
  };
}

export function createDbOutboxPort(outbox: DbOutboxRepo): OutboxRepo {
  return {
    async replayEventsSince(sinceSeq, _topics, limit): Promise<readonly DomainEvent[]> {
      const epoch = outbox.currentStreamEpoch();
      const batch = limit === undefined ? outbox.readSinceSeq(epoch, sinceSeq) : outbox.readSinceSeq(epoch, sinceSeq, limit);
      if (batch.resyncRequired) return [];
      return batch.events.map(toDomainEvent);
    },
    async getMinRetainedSeq(): Promise<number> {
      const batch = outbox.readSinceSeq(outbox.currentStreamEpoch(), 0, 1);
      if (batch.minRetainedSeq !== null) return batch.minRetainedSeq;
      if (batch.highWaterSeq === 0) return 1;
      return batch.highWaterSeq + 1;
    },
    async getLatestSeq(): Promise<number> {
      return outbox.readSinceSeq(outbox.currentStreamEpoch(), 0, 1).highWaterSeq;
    },
    async getStreamEpoch(): Promise<string> {
      return outbox.currentStreamEpoch();
    },
  };
}

export function createDbOutboxDirectory(projectId: string, outbox: OutboxRepo): ProjectOutboxDirectory {
  return {
    get(id: string): OutboxRepo | undefined {
      if (id !== projectId) return undefined;
      return outbox;
    },
  };
}

export function createDbReadModelPort(readModels: DbReadModelRepo): ReadModelRepo {
  return {
    async getBoardSummary(): Promise<BoardSummary> {
      return { lanes: lanesFrom(readModels.getFeatureRollups()) };
    },
    async getFeatureProgress(): Promise<readonly FeatureProgress[]> {
      return readModels.getFeatureRollups().map(toIpcFeature);
    },
    async syncRequirementStatusForChecks(checkIds: readonly string[]): Promise<void> {
      readModels.syncRequirementStatusForChecks({ checkIds });
    },
    async runDriftCheckAndHeal(): Promise<DriftReport> {
      const report = readModels.recomputeRollupsAndVerifyZeroDrift();
      return {
        drifted: report.drifted,
        rows: [...report.taskRollup, ...report.requirementRollup, ...report.requirementStatus],
      };
    },
    async getTraceabilityGaps(): Promise<TraceabilityGaps> {
      return readModels.getTraceabilityGaps();
    },
  };
}

export function createDbSnapshotSource(
  projectId: string,
  outbox: OutboxRepo,
  readModels: ReadModelRepo,
): SnapshotSource {
  return snapshotSourceFromReadModels((id) => {
    if (id !== projectId) return undefined;
    return {
      readModels,
      inbox: EMPTY_READER,
      holds: EMPTY_READER,
      runtime: EMPTY_READER,
      budget: EMPTY_READER,
      outbox,
    };
  });
}

function submitBarrier(queue: DbCoordinatorWriteQueue, operation: WriteOperation): Promise<unknown> {
  return queue
    .submitKnowledgeBarrier({
      opId: operation.opId,
      kind: operation.kind,
      request: operation.request,
      execute: (tx) => runSync(tx, operation),
    })
    .then((receipt) => receipt.result);
}

function runSync(tx: WriteTransaction, operation: WriteOperation): unknown {
  if (typeof tx.exec !== "function" || typeof tx.prepare !== "function") {
    throw new TypeError("write transaction is required");
  }
  const value: unknown = operation.execute();
  if (isPromise(value)) {
    throw new TypeError("write queue execute(tx) must return synchronously");
  }
  return value;
}

function isPromise(value: unknown): value is Promise<unknown> {
  if (typeof value !== "object" || value === null) return false;
  if (!("then" in value)) return false;
  return typeof value.then === "function";
}

function toDomainEvent(event: StoredOutboxEvent): DomainEvent {
  return {
    seq: event.seq,
    id: event.id,
    type: event.type,
    payload: event.payload,
    topic: event.type,
    subject: event.subject,
    rev: event.rev,
    createdAt: event.createdAt,
  };
}

function toIpcFeature(row: DbFeatureProgress): FeatureProgress {
  const requirements: { status: string; n: number }[] = [];
  for (const [status, n] of Object.entries(row.requirementCounts)) {
    if (typeof n !== "number") continue;
    requirements.push({ status, n });
  }
  return { feature: row.feature, requirements };
}

function lanesFrom(rows: readonly DbFeatureProgress[]): BoardLaneCount[] {
  const lanes: BoardLaneCount[] = [];
  for (const row of rows) {
    for (const [state, n] of Object.entries(row.taskCounts)) {
      if (typeof n !== "number") continue;
      lanes.push({ feature: row.feature, state, n });
    }
  }
  return lanes;
}

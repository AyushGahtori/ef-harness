import type { SnapshotViewName } from "./constants.js";

export type WritePriority = "interactive" | "runtime" | "knowledge_barrier";

export interface WriteOperation {
  readonly opId: string;
  readonly kind: string;
  readonly priority: WritePriority;
  readonly request: unknown;
  readonly execute: () => Promise<unknown>;
}

export interface QueueLatencyMetrics {
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly depth: number;
}

/**
 * Consumed from Task 025. The router submits every mutating method here so
 * repeated op_id values return the stored result instead of running twice.
 */
export interface CoordinatorWriteQueue {
  submitOperation(operation: WriteOperation): Promise<unknown>;
  submitKnowledgeBarrier(operation: WriteOperation): Promise<unknown>;
  pruneOldOperations(cutoffMs: number): Promise<number>;
  getQueueMetrics(): QueueLatencyMetrics;
}

export interface DomainEvent {
  readonly seq: number;
  readonly id: string;
  readonly type: string;
  readonly payload: unknown;
  readonly topic?: string;
  readonly subject?: string | null;
  readonly rev?: number | null;
  readonly createdAt?: number;
}

/**
 * Consumed from Task 026. One repo is bound to one project state.db.
 * replayEventsSince stays gap-free in seq order. The protocol layer filters
 * topics itself so batch envelopes can mark skipped sequence numbers.
 */
export interface OutboxRepo {
  replayEventsSince(
    sinceSeq: number,
    topics: readonly string[] | undefined,
    limit?: number,
  ): Promise<readonly DomainEvent[]>;
  getMinRetainedSeq(): Promise<number>;
  getLatestSeq(): Promise<number>;
  getStreamEpoch(): Promise<string>;
}

export interface ProjectOutboxDirectory {
  get(projectId: string): OutboxRepo | undefined;
}

export interface BoardLaneCount {
  readonly feature: string;
  readonly state: string;
  readonly n: number;
}

export interface BoardSummary {
  readonly lanes: readonly BoardLaneCount[];
}

export interface FeatureProgress {
  readonly feature: string;
  readonly requirements: readonly { readonly status: string; readonly n: number }[];
}

export interface DriftReport {
  readonly drifted: boolean;
  readonly rows: readonly unknown[];
}

export interface TraceabilityGaps {
  readonly requirementsWithoutTask: readonly string[];
  readonly requirementsWithoutCheck: readonly string[];
  readonly tasksWithoutRequirement: readonly string[];
}

/** Consumed from Task 027. One repo is bound to one project state.db. */
export interface ReadModelRepo {
  getBoardSummary(): Promise<BoardSummary>;
  getFeatureProgress(): Promise<readonly FeatureProgress[]>;
  syncRequirementStatusForChecks(checkIds: readonly string[]): Promise<void>;
  runDriftCheckAndHeal(): Promise<DriftReport>;
  getTraceabilityGaps(): Promise<TraceabilityGaps>;
}

export interface SnapshotRow {
  readonly id: string;
  readonly [key: string]: unknown;
}

export interface SnapshotReadBatch {
  readonly items: readonly SnapshotRow[];
  readonly done: boolean;
}

export interface KeysetReader {
  readAfter(afterKey: string | null, limit: number): Promise<SnapshotReadBatch>;
}

export interface PinnedSnapshot {
  readonly asOfSeq: number;
  readonly streamEpoch: string;
  read(
    view: SnapshotViewName,
    afterKey: string | null,
    limit: number,
  ): Promise<SnapshotReadBatch>;
}

export interface SnapshotSource {
  open(projectId: string, views: readonly SnapshotViewName[]): Promise<PinnedSnapshot>;
  currentEpoch(projectId: string): Promise<string>;
  currentLatestSeq(projectId: string): Promise<number>;
}

export interface ReadModelSnapshotBindings {
  readonly readModels: Pick<ReadModelRepo, "getBoardSummary" | "getFeatureProgress">;
  readonly inbox: KeysetReader;
  readonly holds: KeysetReader;
  readonly runtime: KeysetReader;
  readonly budget: KeysetReader;
  readonly outbox: Pick<OutboxRepo, "getStreamEpoch" | "getLatestSeq">;
}

export interface JsonRpcNotification {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcSuccess {
  readonly jsonrpc: "2.0";
  readonly id: string | number;
  readonly result: unknown;
}

export interface JsonRpcFailure {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly error: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

/**
 * Seam for Task 031. NamedPipeServer decodes an authenticated channel-0 frame
 * and passes the payload here. isWritable is false while the socket is backed up.
 */
export interface ProtocolConnection {
  readonly connectionId: string;
  send(message: JsonRpcNotification): void;
  onClose(listener: () => void): () => void;
  isClosed(): boolean;
  isWritable(): boolean;
  onWritable(listener: () => void): () => void;
}

export interface ClientSubscriptionMetrics {
  readonly connectionId: string;
  readonly projectId: string;
  readonly replayDurationMs: number;
  readonly resyncCount: number;
  readonly droppedTelemetryCount: number;
  readonly subscriptionLagEvents: number;
}

export interface TelemetryNote {
  readonly kind: string;
  readonly payload: unknown;
}

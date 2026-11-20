/**
 * Priority classes from the one-writer design.
 * `interactive` is drained before `runtime`. `knowledge_barrier` is never batched.
 */
export const WRITE_PRIORITIES = ["interactive", "runtime", "knowledge_barrier"] as const;

export type WritePriority = (typeof WRITE_PRIORITIES)[number];

export type ChangeClass =
  | "cosmetic"
  | "clarifying"
  | "compatible"
  | "breaking"
  | "created"
  | "retired";

export type SqlValue = string | number | bigint | null;

export interface SqlRow {
  readonly [column: string]: SqlValue | Uint8Array;
}

export interface StatementChanges {
  readonly changes: number | bigint;
  readonly lastInsertRowid?: number | bigint;
}

/**
 * Named parameters are bound without the SQL prefix (`:op_id` binds from `{ op_id }`),
 * matching `schema/schema-test.js` and the `SqliteStatement` contract from Task 012.
 */
export interface PreparedWrite {
  get(params?: Readonly<Record<string, SqlValue>>): SqlRow | undefined;
  all(params?: Readonly<Record<string, SqlValue>>): readonly SqlRow[];
  run(params?: Readonly<Record<string, SqlValue>>): StatementChanges;
}

export interface ProjectStateWriter {
  exec(sql: string): void;
  prepare(sql: string): PreparedWrite;
}

/**
 * Surface consumed from `ProjectStateDb` (Task 013). The queue is the only writer
 * and borrows `writer` for `BEGIN IMMEDIATE` / savepoint / `COMMIT`.
 */
export interface ProjectStateDb {
  isSafeMode(): boolean;
  enterSafeMode(reason: string, diagnostics?: Readonly<Record<string, string | number>>): void;
  readonly writer: ProjectStateWriter;
}

export interface WriteTransaction {
  exec(sql: string): void;
  prepare(sql: string): PreparedWrite;
  setCommittedRev(rev: number): void;
  recordChangedNode(nodeId: string, changeClass: ChangeClass): void;
}

export interface OperationReceipt<T> {
  readonly opId: string;
  readonly kind: string;
  readonly requestHash: string;
  readonly result: T;
  readonly replayed: boolean;
  readonly committedRev: number | null;
}

export interface SubmitOperationInput<T> {
  readonly opId: string;
  readonly kind: string;
  readonly request: unknown;
  readonly priority?: "interactive" | "runtime";
  execute(tx: WriteTransaction): T;
}

export interface SubmitKnowledgeBarrierInput<T> {
  readonly opId: string;
  readonly kind: string;
  readonly request: unknown;
  execute(tx: WriteTransaction): T;
}

export interface KnowledgePropagationNode {
  readonly nodeId: string;
  readonly changeClass: ChangeClass;
  readonly attempts: readonly string[];
}

export interface KnowledgePropagationEvent {
  readonly opId: string;
  readonly kind: string;
  readonly result: unknown;
  readonly changedNodes: readonly KnowledgePropagationNode[];
}

export type KnowledgePropagationHook = (event: KnowledgePropagationEvent) => void;

export interface WriteQueueLogger {
  error(entry: { readonly event: string; readonly opId: string; readonly message: string }): void;
}

/** Latency and depth snapshot from `CoordinatorWriteQueue.getQueueMetrics`. */
export interface WriteQueueLatencyMetrics {
  readonly samples: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  readonly interactiveDepth: number;
  readonly runtimeDepth: number;
  readonly knowledgeBarrierDepth: number;
  readonly batchesCommitted: number;
  readonly barriersCommitted: number;
  readonly operationsCommitted: number;
  readonly operationsReplayed: number;
  readonly operationsRejected: number;
  readonly backpressureRejections: number;
  readonly safeModeHalts: number;
  readonly propagationFailures: number;
}

export type ComputeRequestHash = (request: unknown) => string;

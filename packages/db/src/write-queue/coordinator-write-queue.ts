import { MissingOpIdError, OpIdReusedError, OperationResultError, ProjectSafeModeError, QueueBackpressureError, QueueBusyError, QueueClosedError } from "./errors.js";
import { canonicalQuery } from "./query-catalog.js";
import { defaultComputeRequestHash } from "./request-hash.js";
import type {
  ChangeClass,
  ComputeRequestHash,
  KnowledgePropagationEvent,
  KnowledgePropagationHook,
  OperationReceipt,
  PreparedWrite,
  ProjectStateDb,
  SqlValue,
  StatementChanges,
  SubmitKnowledgeBarrierInput,
  SubmitOperationInput,
  WritePriority,
  WriteQueueLatencyMetrics,
  WriteQueueLogger,
  WriteTransaction,
} from "./types.js";

export const DEFAULT_MAX_BATCH_SIZE = 32;
export const DEFAULT_COALESCE_WINDOW_MS = 3;
export const OPERATIONS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const DEFAULT_CAPS = {
  interactive: 128,
  runtime: 512,
  knowledge_barrier: 64,
} as const;

const INSERT_OPERATION = `INSERT INTO operations (op_id, kind, request_hash, result, committed_rev, created_at)
VALUES (:op_id, :kind, :request_hash, :result, :committed_rev, :created_at)`;

const READ_SETS_INDEXED =
  "SELECT DISTINCT attempt FROM read_sets INDEXED BY read_sets_by_node WHERE node = :node";
const READ_SETS_PLAIN = "SELECT DISTINCT attempt FROM read_sets WHERE node = :node";

const MAX_PROPAGATION_ATTEMPTS = 6;

interface QueuedOperation {
  readonly seq: number;
  readonly opId: string;
  readonly kind: string;
  readonly requestHash: string;
  readonly priority: WritePriority;
  readonly execute: (tx: WriteTransaction) => unknown;
  readonly enqueuedPerf: number;
  committedRev: number | null;
  readonly changedNodes: Array<{ nodeId: string; changeClass: ChangeClass }>;
  settled: boolean;
  resolve: (receipt: OperationReceipt<unknown>) => void;
  reject: (error: unknown) => void;
}

interface PruneControl {
  readonly nowMs: number;
  resolve: (removed: number) => void;
  reject: (error: unknown) => void;
}

interface FlushWaiter {
  resolve: () => void;
  reject: (error: unknown) => void;
}

type Settlement =
  | { readonly type: "resolve"; readonly receipt: OperationReceipt<unknown> }
  | { readonly type: "reject"; readonly error: unknown };

export interface CoordinatorWriteQueueOptions {
  readonly stateDb: ProjectStateDb;
  /** Task 007 `computeRequestHash` (`sha256:` + canonical JSON). */
  readonly computeRequestHash?: ComputeRequestHash;
  /** Maximum runtime/interactive operations in one `BEGIN IMMEDIATE` batch. */
  readonly maxBatchSize?: number;
  /** Coalesce window in milliseconds (2–5 in production). `0` flushes on the next turn. */
  readonly coalesceWindowMs?: number;
  readonly caps?: {
    readonly interactive?: number;
    readonly runtime?: number;
    readonly knowledge_barrier?: number;
  };
  readonly now?: () => number;
  readonly retentionMs?: number;
  /** Idle prune period. The first idle pass waits this long after construction. */
  readonly pruneIntervalMs?: number;
  readonly propagationRetryDelayMs?: number;
  readonly logger?: WriteQueueLogger;
  readonly onKnowledgePropagated?: KnowledgePropagationHook;
}

/**
 * Single-writer queue: interactive and runtime operations share a savepoint
 * group commit; knowledge change sets run alone and propagate after `COMMIT`.
 */
export class CoordinatorWriteQueue {
  private readonly stateDb: ProjectStateDb;
  private readonly computeRequestHash: ComputeRequestHash;
  private readonly maxBatchSize: number;
  private readonly coalesceWindowMs: number;
  private readonly caps: { interactive: number; runtime: number; knowledge_barrier: number };
  private readonly now: () => number;
  private readonly retentionMs: number;
  private readonly pruneIntervalMs: number;
  private readonly propagationRetryDelayMs: number;
  private readonly logger: WriteQueueLogger | undefined;
  private readonly onKnowledgePropagated: KnowledgePropagationHook | undefined;
  private readonly lookupSql: string;
  private readonly pruneSql: string;

  private readonly interactive: QueuedOperation[] = [];
  private readonly runtime: QueuedOperation[] = [];
  private readonly barriers: QueuedOperation[] = [];
  private readonly controls: PruneControl[] = [];
  private readonly flushWaiters: FlushWaiter[] = [];
  private readonly samples: number[] = [];
  private readonly statements = new Map<string, PreparedWrite>();
  private readonly retryTimers = new Set<ReturnType<typeof setTimeout>>();

  private nextSeq = 1;
  private lastPruneAt: number;
  private coalesceAnchor: number | null = null;
  private immediateFollowUp = false;
  private forceFlush = false;
  private closed = false;
  private stopped = false;
  private executing = false;
  private safeModeLatched = false;
  private readSetSql = READ_SETS_INDEXED;
  private waiting: (() => void) | null = null;
  private workSignaled = false;
  private cancelSleep: (() => void) | null = null;
  private readonly done: Promise<void>;
  private resolveDone: () => void = () => undefined;

  private batchesCommitted = 0;
  private barriersCommitted = 0;
  private operationsCommitted = 0;
  private operationsReplayed = 0;
  private operationsRejected = 0;
  private backpressureRejections = 0;
  private safeModeHalts = 0;
  private propagationFailures = 0;

  constructor(options: CoordinatorWriteQueueOptions) {
    this.stateDb = options.stateDb;
    this.computeRequestHash = options.computeRequestHash ?? defaultComputeRequestHash;
    this.maxBatchSize = positiveInteger(options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE, "maxBatchSize");
    this.coalesceWindowMs = nonNegativeFinite(
      options.coalesceWindowMs ?? DEFAULT_COALESCE_WINDOW_MS,
      "coalesceWindowMs",
    );
    this.caps = {
      interactive: positiveInteger(options.caps?.interactive ?? DEFAULT_CAPS.interactive, "interactive cap"),
      runtime: positiveInteger(options.caps?.runtime ?? DEFAULT_CAPS.runtime, "runtime cap"),
      knowledge_barrier: positiveInteger(
        options.caps?.knowledge_barrier ?? DEFAULT_CAPS.knowledge_barrier,
        "knowledge_barrier cap",
      ),
    };
    this.now = options.now ?? ((): number => Date.now());
    this.retentionMs = nonNegativeFinite(options.retentionMs ?? OPERATIONS_RETENTION_MS, "retentionMs");
    this.pruneIntervalMs = nonNegativeNumber(options.pruneIntervalMs ?? 60_000, "pruneIntervalMs");
    this.propagationRetryDelayMs = nonNegativeFinite(
      options.propagationRetryDelayMs ?? 20,
      "propagationRetryDelayMs",
    );
    this.logger = options.logger;
    this.onKnowledgePropagated = options.onKnowledgePropagated;
    this.lookupSql = canonicalQuery("op_lookup");
    this.pruneSql = canonicalQuery("prune_operations");
    this.lastPruneAt = this.now();
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
    void this.run();
  }

  /**
   * Queue a batchable mutation. Missing `op_id` throws before the operation is queued.
   * The promise settles only after the enclosing `COMMIT` returns.
   */
  submitOperation<T>(input: SubmitOperationInput<T>): Promise<OperationReceipt<T>> {
    return this.enqueue(input, input.priority ?? "runtime");
  }

  /**
   * Run one idempotent operation on the writer and return its receipt.
   * Refuses while a batch already holds the writer; use `submitOperation` then.
   */
  submitOperationSync<T>(input: SubmitOperationInput<T>): OperationReceipt<T> {
    if (this.executing) throw new QueueBusyError();
    const priority = input.priority ?? "runtime";
    const requestHash = this.assertAcceptable(input, priority);
    const op = this.makeOperation(input, priority, requestHash);
    this.executing = true;
    let began = false;
    try {
      this.writerExec("BEGIN IMMEDIATE");
      began = true;
      const settlement = this.runSavepoint(op, 0);
      this.writerExec("COMMIT");
      began = false;
      if (settlement.type === "resolve") {
        this.settleResolve(op, settlement.receipt);
        return settlement.receipt as OperationReceipt<T>;
      }
      this.settleReject(op, settlement.error);
      throw settlement.error;
    } catch (error) {
      if (began) this.rollbackOuter();
      if (isFatalStorageError(error)) this.activateSafeMode(error, 1);
      if (!op.settled) this.settleReject(op, error);
      throw error;
    } finally {
      this.executing = false;
    }
  }

  /** Queue a knowledge change set. It never shares a transaction with runtime work. */
  submitKnowledgeBarrier<T>(input: SubmitKnowledgeBarrierInput<T>): Promise<OperationReceipt<T>> {
    return this.enqueue(input, "knowledge_barrier");
  }

  /**
   * `DELETE FROM operations WHERE created_at < now - 30 days`.
   * Receipts in `candidates`, `check_results`, and `effects` are not touched.
   */
  pruneOldOperations(nowMs?: number): Promise<number> {
    if (this.closed || this.stopped) throw new QueueClosedError();
    if (this.safeHalted()) throw new ProjectSafeModeError("safe_mode");
    const clock = nowMs ?? this.now();
    if (!Number.isFinite(clock)) throw new TypeError("prune clock must be finite");
    return new Promise((resolve, reject) => {
      this.controls.push({ nowMs: clock, resolve, reject });
      this.signal();
    });
  }

  /** Skip the rest of the coalesce window and commit the current interactive/runtime batch. */
  flushRuntimeBatch(): Promise<void> {
    if (this.stopped || this.closed) return Promise.reject(new QueueClosedError());
    this.forceFlush = true;
    this.cancelSleep?.();
    this.signal();
    return new Promise((resolve, reject) => {
      this.flushWaiters.push({ resolve, reject });
    });
  }

  getQueueMetrics(): WriteQueueLatencyMetrics {
    const sorted = [...this.samples].sort((left, right) => left - right);
    const maxMs = sorted.length === 0 ? 0 : (sorted[sorted.length - 1] ?? 0);
    return {
      samples: sorted.length,
      p50Ms: percentile(sorted, 0.5),
      p95Ms: percentile(sorted, 0.95),
      p99Ms: percentile(sorted, 0.99),
      maxMs,
      interactiveDepth: this.interactive.length,
      runtimeDepth: this.runtime.length,
      knowledgeBarrierDepth: this.barriers.length,
      batchesCommitted: this.batchesCommitted,
      barriersCommitted: this.barriersCommitted,
      operationsCommitted: this.operationsCommitted,
      operationsReplayed: this.operationsReplayed,
      operationsRejected: this.operationsRejected,
      backpressureRejections: this.backpressureRejections,
      safeModeHalts: this.safeModeHalts,
      propagationFailures: this.propagationFailures,
    };
  }

  /** Stop accepting writes, finish queued work, and resolve when those promises have settled. */
  drainAndClose(): Promise<void> {
    if (this.closed) return this.done;
    this.closed = true;
    this.forceFlush = true;
    this.cancelSleep?.();
    this.signal();
    return this.done;
  }

  private assertAcceptable(
    input: { opId: string; kind: string; request: unknown; execute(tx: WriteTransaction): unknown },
    priority: WritePriority,
  ): string {
    if (typeof input.opId !== "string" || input.opId.trim() === "") {
      throw new MissingOpIdError();
    }
    if (this.closed || this.stopped) throw new QueueClosedError();
    if (this.safeHalted()) throw new ProjectSafeModeError("safe_mode");
    if (priority !== "interactive" && priority !== "runtime" && priority !== "knowledge_barrier") {
      throw new TypeError("unsupported write priority");
    }
    if (typeof input.kind !== "string" || input.kind.trim() === "") {
      throw new TypeError("operation kind is required");
    }
    if (typeof input.execute !== "function") {
      throw new TypeError("operation execute function is required");
    }
    return this.computeRequestHash(input.request);
  }

  private makeOperation(
    input: { opId: string; kind: string; execute(tx: WriteTransaction): unknown },
    priority: WritePriority,
    requestHash: string,
  ): QueuedOperation {
    const op: QueuedOperation = {
      seq: this.nextSeq,
      opId: input.opId,
      kind: input.kind,
      requestHash,
      priority,
      execute: input.execute,
      enqueuedPerf: performance.now(),
      committedRev: null,
      changedNodes: [],
      settled: false,
      resolve: () => undefined,
      reject: () => undefined,
    };
    this.nextSeq += 1;
    return op;
  }

  private enqueue<T>(
    input: { opId: string; kind: string; request: unknown; execute(tx: WriteTransaction): T },
    priority: WritePriority,
  ): Promise<OperationReceipt<T>> {
    const requestHash = this.assertAcceptable(input, priority);
    const queue = this.queueFor(priority);
    const cap = this.caps[priority];
    if (queue.length >= cap) {
      this.backpressureRejections += 1;
      throw new QueueBackpressureError(priority, queue.length, cap);
    }
    return new Promise((resolve, reject) => {
      const op = this.makeOperation(input, priority, requestHash);
      op.resolve = (receipt) => resolve(receipt as OperationReceipt<T>);
      op.reject = reject;
      queue.push(op);
      if (this.coalesceAnchor === null && this.countEligible() > 0) {
        this.coalesceAnchor = performance.now();
      }
      if (this.countEligible() >= this.maxBatchSize) this.cancelSleep?.();
      this.signal();
    });
  }

  private async run(): Promise<void> {
    try {
      while (!this.stopped) {
        if (this.safeHalted()) {
          const error = new ProjectSafeModeError("safe_mode");
          if (!this.safeModeLatched) {
            this.safeModeLatched = true;
            this.safeModeHalts += 1;
          }
          this.rejectQueued(error);
          this.rejectControls(error);
          this.finishForceFlush(error);
          if (this.closed) break;
          await this.waitForSignal();
          continue;
        }

        const control = this.controls.shift();
        if (control) {
          this.runPrune(control);
          continue;
        }

        if (!this.hasQueuedOperations()) {
          this.immediateFollowUp = false;
          this.coalesceAnchor = null;
          if (this.closed) break;
          this.maybePruneIdle();
          if (this.safeHalted()) continue;
          this.finishForceFlush();
          if (this.controls.length > 0) continue;
          await this.waitForSignal();
          continue;
        }

        const skipWait = this.closed || this.forceFlush || this.immediateFollowUp;
        if (!skipWait && this.shouldWaitForCoalesce()) {
          await this.sleep(this.coalesceRemainingMs());
          continue;
        }
        this.immediateFollowUp = false;

        const batch = this.takeInteractiveRuntimeBatch();
        if (batch.length > 0) {
          this.coalesceAnchor = null;
          this.commitBatch(batch);
          this.immediateFollowUp = this.hasQueuedOperations();
          this.finishForceFlush();
          await yieldToEventLoop();
          continue;
        }

        if (this.forceFlush) this.finishForceFlush();
        if (this.interactive.length > 0) {
          await yieldToEventLoop();
          continue;
        }

        const barrier = this.barriers.shift();
        if (barrier) {
          this.coalesceAnchor = null;
          this.commitBarrier(barrier);
          this.immediateFollowUp = this.hasQueuedOperations();
          await yieldToEventLoop();
          continue;
        }

        await this.waitForSignal();
      }
    } catch (error) {
      this.rejectQueued(error);
      this.rejectControls(error);
      this.finishForceFlush(error);
    } finally {
      this.clearRetryTimers();
      const closedError = new QueueClosedError();
      this.rejectQueued(closedError);
      this.rejectControls(closedError);
      this.finishForceFlush(closedError);
      if (!this.stopped) {
        this.stopped = true;
        this.resolveDone();
      }
    }
  }

  private commitBatch(batch: readonly QueuedOperation[]): void {
    this.executing = true;
    try {
      this.commitBatchHoldingWriter(batch);
    } finally {
      this.executing = false;
    }
  }

  private commitBatchHoldingWriter(batch: readonly QueuedOperation[]): void {
    const staged: Array<{ op: QueuedOperation; settlement: Settlement }> = [];
    let began = false;
    try {
      this.writerExec("BEGIN IMMEDIATE");
      began = true;
      for (let index = 0; index < batch.length; index += 1) {
        const op = batch[index];
        if (!op) continue;
        staged.push({ op, settlement: this.runSavepoint(op, index) });
      }
      this.writerExec("COMMIT");
      began = false;
    } catch (error) {
      if (began) this.rollbackOuter();
      if (isFatalStorageError(error)) this.activateSafeMode(error, batch.length);
      for (const op of batch) this.settleReject(op, error);
      return;
    }
    this.batchesCommitted += 1;
    for (const entry of staged) {
      if (entry.settlement.type === "resolve") this.settleResolve(entry.op, entry.settlement.receipt);
      else this.settleReject(entry.op, entry.settlement.error);
    }
  }

  private runSavepoint(op: QueuedOperation, index: number): Settlement {
    const name = savepointName(index);
    this.writerExec(`SAVEPOINT ${name}`);
    try {
      const receipt = this.applyOperation(op);
      this.writerExec(`RELEASE ${name}`);
      return { type: "resolve", receipt };
    } catch (error) {
      try {
        this.writerExec(`ROLLBACK TO ${name}`);
      } catch {
        // The savepoint is already gone; the outer COMMIT path rejects the batch.
      }
      try {
        this.writerExec(`RELEASE ${name}`);
      } catch {
        // RELEASE after a lost savepoint means the outer transaction must roll back.
      }
      return { type: "reject", error };
    }
  }

  private commitBarrier(op: QueuedOperation): void {
    this.executing = true;
    let receipt: OperationReceipt<unknown> | undefined;
    try {
      receipt = this.commitBarrierHoldingWriter(op);
    } finally {
      this.executing = false;
    }
    if (receipt && !receipt.replayed) this.propagateAfterCommit(op, receipt);
  }

  private commitBarrierHoldingWriter(op: QueuedOperation): OperationReceipt<unknown> | undefined {
    let began = false;
    let receipt: OperationReceipt<unknown> | undefined;
    try {
      this.writerExec("BEGIN IMMEDIATE");
      began = true;
      receipt = this.applyOperation(op);
      this.writerExec("COMMIT");
      began = false;
    } catch (error) {
      if (began) this.rollbackOuter();
      if (isFatalStorageError(error)) this.activateSafeMode(error, 1);
      this.settleReject(op, error);
      return undefined;
    }
    if (!receipt) throw new Error("knowledge barrier produced no receipt");
    this.barriersCommitted += 1;
    this.settleResolve(op, receipt);
    return receipt;
  }

  private applyOperation(op: QueuedOperation): OperationReceipt<unknown> {
    const existing = this.statement(this.lookupSql).get({
      op_id: op.opId,
      request_hash: op.requestHash,
    });
    if (existing) {
      if (!isSameRequest(existing.same_request)) throw new OpIdReusedError(op.opId);
      return {
        opId: op.opId,
        kind: op.kind,
        requestHash: op.requestHash,
        result: parseStoredResult(existing.result),
        replayed: true,
        committedRev: null,
      };
    }
    const raw = op.execute(this.createTransaction(op));
    const resultJson = serializeResult(op.opId, raw);
    this.statement(INSERT_OPERATION).run({
      op_id: op.opId,
      kind: op.kind,
      request_hash: op.requestHash,
      result: resultJson,
      committed_rev: op.committedRev,
      created_at: Math.trunc(this.now()),
    });
    return {
      opId: op.opId,
      kind: op.kind,
      requestHash: op.requestHash,
      result: JSON.parse(resultJson) as unknown,
      replayed: false,
      committedRev: op.committedRev,
    };
  }

  private createTransaction(op: QueuedOperation): WriteTransaction {
    return {
      exec: (sql: string) => {
        assertCallerSql(sql);
        this.writerExec(sql);
      },
      prepare: (sql: string) => {
        assertCallerSql(sql);
        const statement = this.stateDb.writer.prepare(sql);
        return {
          get: (params) => statement.get(params),
          all: (params) => statement.all(params),
          run: (params) => normalizeRun(statement.run(params)),
        };
      },
      setCommittedRev: (rev: number) => {
        if (!Number.isInteger(rev)) throw new TypeError("committed revision must be an integer");
        op.committedRev = rev;
      },
      recordChangedNode: (nodeId: string, changeClass: ChangeClass) => {
        if (typeof nodeId !== "string" || nodeId.trim() === "") {
          throw new TypeError("changed node id is required");
        }
        op.changedNodes.push({ nodeId, changeClass });
      },
    };
  }

  private propagateAfterCommit(op: QueuedOperation, receipt: OperationReceipt<unknown>): void {
    let event: KnowledgePropagationEvent;
    try {
      event = {
        opId: op.opId,
        kind: op.kind,
        result: receipt.result,
        changedNodes: op.changedNodes.map((node) => ({
          nodeId: node.nodeId,
          changeClass: node.changeClass,
          attempts: this.attemptsReading(node.nodeId),
        })),
      };
    } catch (error) {
      this.failPropagation(op.opId, error, {
        opId: op.opId,
        kind: op.kind,
        result: receipt.result,
        changedNodes: [],
      });
      return;
    }
    this.deliverPropagation(event);
  }

  private deliverPropagation(event: KnowledgePropagationEvent): void {
    if (!this.onKnowledgePropagated) return;
    try {
      this.onKnowledgePropagated(event);
    } catch (error) {
      this.failPropagation(event.opId, error, event);
    }
  }

  private attemptsReading(nodeId: string): string[] {
    try {
      return attemptIds(this.statement(this.readSetSql).all({ node: nodeId }));
    } catch (error) {
      if (this.readSetSql !== READ_SETS_INDEXED) throw error;
      this.statements.delete(READ_SETS_INDEXED);
      this.readSetSql = READ_SETS_PLAIN;
      return attemptIds(this.statement(this.readSetSql).all({ node: nodeId }));
    }
  }

  private failPropagation(
    opId: string,
    error: unknown,
    event: KnowledgePropagationEvent,
    attempt = 1,
  ): void {
    this.propagationFailures += 1;
    const message = error instanceof Error ? error.message : String(error);
    if (this.logger) {
      this.logger.error({ event: "knowledge_propagation_failed", opId, message });
    } else {
      console.error(`knowledge propagation failed for ${opId}: ${message}`);
    }
    if (this.stopped || attempt >= MAX_PROPAGATION_ATTEMPTS || !this.onKnowledgePropagated) return;
    const delay = Math.min(5_000, this.propagationRetryDelayMs * 2 ** (attempt - 1));
    const timer = setTimeout(() => {
      this.retryTimers.delete(timer);
      if (this.stopped || !this.onKnowledgePropagated) return;
      try {
        this.onKnowledgePropagated(event);
      } catch (retryError) {
        this.failPropagation(opId, retryError, event, attempt + 1);
      }
    }, delay);
    this.retryTimers.add(timer);
  }

  private runPrune(control: PruneControl): void {
    try {
      const removed = this.pruneNow(control.nowMs);
      this.lastPruneAt = this.now();
      control.resolve(removed);
    } catch (error) {
      if (isFatalStorageError(error)) this.activateSafeMode(error, 0);
      control.reject(error);
    }
  }

  private maybePruneIdle(): void {
    if (this.now() - this.lastPruneAt < this.pruneIntervalMs) return;
    try {
      this.pruneNow(this.now());
      this.lastPruneAt = this.now();
    } catch (error) {
      if (isFatalStorageError(error)) this.activateSafeMode(error, 0);
    }
  }

  private pruneNow(nowMs: number): number {
    this.executing = true;
    try {
      return this.pruneNowHoldingWriter(nowMs);
    } finally {
      this.executing = false;
    }
  }

  private pruneNowHoldingWriter(nowMs: number): number {
    const cutoff = nowMs - this.retentionMs;
    this.writerExec("BEGIN IMMEDIATE");
    try {
      const changes = normalizeChanges(this.statement(this.pruneSql).run({ cutoff }).changes);
      this.writerExec("COMMIT");
      return changes;
    } catch (error) {
      this.rollbackOuter();
      throw error;
    }
  }

  /**
   * Interactive operations jump ahead of runtime work, including a queued barrier,
   * so Stop and inbox resolution are not stuck behind worker retries.
   * Runtime operations stop at the next knowledge barrier so that barrier stays a fence.
   * Inside the batch, savepoints run in that chosen order and each sees the previous one.
   */
  private takeInteractiveRuntimeBatch(): QueuedOperation[] {
    const barrierSeq = this.barriers[0]?.seq ?? Number.POSITIVE_INFINITY;
    const chosen: QueuedOperation[] = [];
    const picked = new Set<QueuedOperation>();
    for (const op of this.interactive) {
      if (chosen.length >= this.maxBatchSize) break;
      chosen.push(op);
      picked.add(op);
    }
    for (const op of this.runtime) {
      if (chosen.length >= this.maxBatchSize) break;
      if (op.seq > barrierSeq) break;
      chosen.push(op);
      picked.add(op);
    }
    if (picked.size === 0) return [];
    this.retain(this.interactive, picked);
    this.retain(this.runtime, picked);
    return chosen;
  }

  private retain(queue: QueuedOperation[], picked: ReadonlySet<QueuedOperation>): void {
    let write = 0;
    for (const op of queue) {
      if (picked.has(op)) continue;
      queue[write] = op;
      write += 1;
    }
    queue.length = write;
  }

  private countEligible(): number {
    const barrierSeq = this.barriers[0]?.seq ?? Number.POSITIVE_INFINITY;
    let count = this.interactive.length;
    for (const op of this.runtime) {
      if (op.seq > barrierSeq) break;
      count += 1;
    }
    return count;
  }

  private shouldWaitForCoalesce(): boolean {
    if (this.coalesceWindowMs <= 0) return false;
    const eligible = this.countEligible();
    if (eligible === 0 || eligible >= this.maxBatchSize) return false;
    const now = performance.now();
    if (this.coalesceAnchor === null) this.coalesceAnchor = now;
    return now - this.coalesceAnchor < this.coalesceWindowMs;
  }

  private coalesceRemainingMs(): number {
    const anchor = this.coalesceAnchor ?? performance.now();
    return Math.max(0, this.coalesceWindowMs - (performance.now() - anchor));
  }

  private hasQueuedOperations(): boolean {
    return this.interactive.length > 0 || this.runtime.length > 0 || this.barriers.length > 0;
  }

  private queueFor(priority: WritePriority): QueuedOperation[] {
    if (priority === "interactive") return this.interactive;
    if (priority === "runtime") return this.runtime;
    return this.barriers;
  }

  private safeHalted(): boolean {
    return this.safeModeLatched || this.stateDb.isSafeMode();
  }

  private activateSafeMode(error: unknown, operationCount: number): void {
    const sqliteCode = readSqliteCode(error) || "SQLITE_FULL";
    const reason =
      sqliteCode === "SQLITE_CORRUPT"
        ? "corrupt"
        : sqliteCode === "SQLITE_IOERR"
          ? "disk_io_error"
          : "disk_full";
    this.safeModeLatched = true;
    this.safeModeHalts += 1;
    if (!this.stateDb.isSafeMode()) {
      this.stateDb.enterSafeMode(reason, { sqliteCode, operationCount });
    }
  }

  private settleResolve(op: QueuedOperation, receipt: OperationReceipt<unknown>): void {
    if (op.settled) return;
    op.settled = true;
    this.samples.push(performance.now() - op.enqueuedPerf);
    this.operationsCommitted += 1;
    if (receipt.replayed) this.operationsReplayed += 1;
    op.resolve(receipt);
  }

  private settleReject(op: QueuedOperation, error: unknown): void {
    if (op.settled) return;
    op.settled = true;
    this.samples.push(performance.now() - op.enqueuedPerf);
    this.operationsRejected += 1;
    op.reject(error);
  }

  private rejectQueued(error: unknown): void {
    const pending = [...this.interactive, ...this.runtime, ...this.barriers];
    this.interactive.length = 0;
    this.runtime.length = 0;
    this.barriers.length = 0;
    for (const op of pending) this.settleReject(op, error);
  }

  private rejectControls(error: unknown): void {
    const pending = this.controls.splice(0);
    for (const control of pending) control.reject(error);
  }

  private finishForceFlush(error?: unknown): void {
    this.forceFlush = false;
    const waiters = this.flushWaiters.splice(0);
    for (const waiter of waiters) {
      if (error === undefined) waiter.resolve();
      else waiter.reject(error);
    }
  }

  private rollbackOuter(): void {
    try {
      this.writerExec("ROLLBACK");
    } catch {
      // SQLite already rolled the transaction back.
    }
  }

  private writerExec(sql: string): void {
    this.stateDb.writer.exec(sql);
  }

  private statement(sql: string): PreparedWrite {
    const cached = this.statements.get(sql);
    if (cached) return cached;
    const prepared = this.stateDb.writer.prepare(sql);
    this.statements.set(sql, prepared);
    return prepared;
  }

  private signal(): void {
    this.workSignaled = true;
    const waiting = this.waiting;
    this.waiting = null;
    if (waiting) waiting();
  }

  private waitForSignal(): Promise<void> {
    if (this.workSignaled) {
      this.workSignaled = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiting = () => {
        this.workSignaled = false;
        resolve();
      };
    });
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.cancelSleep = null;
        resolve();
      }, ms);
      this.cancelSleep = () => {
        clearTimeout(timer);
        this.cancelSleep = null;
        resolve();
      };
    });
  }

  private clearRetryTimers(): void {
    for (const timer of this.retryTimers) clearTimeout(timer);
    this.retryTimers.clear();
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return value;
}

function nonNegativeFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a finite number >= 0`);
  }
  return value;
}

function nonNegativeNumber(value: number, label: string): number {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
    throw new TypeError(`${label} must be a number >= 0`);
  }
  return value;
}

function savepointName(index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new Error(`invalid savepoint index ${index}`);
  return `op_${index}`;
}

const TRANSACTION_CONTROL = /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|END)\b/i;

function assertCallerSql(sql: string): void {
  if (TRANSACTION_CONTROL.test(sql)) {
    throw new Error("operations cannot issue transaction control statements");
  }
}

function serializeResult(opId: string, value: unknown): string {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new OperationResultError(opId, message);
  }
  if (typeof encoded !== "string") {
    throw new OperationResultError(opId, "operation result must be JSON-serializable");
  }
  return encoded;
}

function parseStoredResult(value: SqlValue | Uint8Array | undefined): unknown {
  if (typeof value !== "string") throw new Error("stored operation result is not text");
  return JSON.parse(value) as unknown;
}

function isSameRequest(value: SqlValue | Uint8Array | undefined): boolean {
  return value === 1 || value === 1n;
}

function attemptIds(rows: readonly { readonly [column: string]: SqlValue | Uint8Array }[]): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    const attempt = row.attempt;
    if (typeof attempt === "string" && attempt.length > 0) ids.push(attempt);
  }
  return ids;
}

function normalizeRun(result: StatementChanges): { changes: number; lastInsertRowid: number | bigint } {
  return {
    changes: normalizeChanges(result.changes),
    lastInsertRowid: result.lastInsertRowid ?? 0,
  };
}

function normalizeChanges(changes: number | bigint): number {
  return typeof changes === "bigint" ? Number(changes) : changes;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(fraction * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] ?? 0;
}

function readSqliteCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const record = error as { code?: unknown; errcode?: unknown; message?: unknown };
  if (typeof record.code === "string") {
    const embedded = /SQLITE_[A-Z0-9]+/.exec(record.code);
    if (embedded?.[0]) return embedded[0];
  }
  if (typeof record.errcode === "number") {
    const primary = record.errcode & 0xff;
    if (primary === 13) return "SQLITE_FULL";
    if (primary === 10) return "SQLITE_IOERR";
    if (primary === 11) return "SQLITE_CORRUPT";
  }
  if (typeof record.message === "string") {
    const embedded = /SQLITE_[A-Z0-9]+/.exec(record.message);
    if (embedded?.[0]) return embedded[0];
  }
  return "";
}

function isFatalStorageError(error: unknown): boolean {
  const code = readSqliteCode(error);
  return code === "SQLITE_FULL" || code === "SQLITE_IOERR" || code === "SQLITE_CORRUPT";
}

import type { WritePriority } from "./types.js";

/** `op_id` already stored for a different canonical request. */
export class OpIdReusedError extends Error {
  readonly code = "op_id_reused" as const;
  readonly opId: string;

  constructor(opId: string) {
    super(`op_id ${opId} was reused with a different request`);
    this.name = "OpIdReusedError";
    this.opId = opId;
  }
}

/** A bounded priority queue refused another write. */
export class QueueBackpressureError extends Error {
  readonly code = "queue_backpressure" as const;
  readonly priority: WritePriority;
  readonly depth: number;
  readonly cap: number;

  constructor(priority: WritePriority, depth: number, cap: number) {
    super(`${priority} write queue is at capacity (${depth}/${cap})`);
    this.name = "QueueBackpressureError";
    this.priority = priority;
    this.depth = depth;
    this.cap = cap;
  }
}

/** Dequeue is halted because the project database entered safe mode. */
export class ProjectSafeModeError extends Error {
  readonly code = "project_safe_mode" as const;
  readonly reason: string;
  readonly diagnostics: Readonly<Record<string, string | number>>;

  constructor(
    reason: string,
    diagnostics: Readonly<Record<string, string | number>> = {},
  ) {
    super(`project safe mode: ${reason}`);
    this.name = "ProjectSafeModeError";
    this.reason = reason;
    this.diagnostics = diagnostics;
  }
}

/** `submitOperation` / `submitKnowledgeBarrier` was called without an `op_id`. */
export class MissingOpIdError extends Error {
  readonly code = "missing_op_id" as const;

  constructor() {
    super("mutating operation requires op_id");
    this.name = "MissingOpIdError";
  }
}

/** The queue has stopped accepting writes (`drainAndClose`). */
export class QueueClosedError extends Error {
  readonly code = "queue_closed" as const;

  constructor() {
    super("write queue is closed");
    this.name = "QueueClosedError";
  }
}

/** An operation result cannot be stored as JSON in `operations.result`. */
export class OperationResultError extends Error {
  readonly code = "operation_result" as const;
  readonly opId: string;

  constructor(opId: string, message: string) {
    super(message);
    this.name = "OperationResultError";
    this.opId = opId;
  }
}

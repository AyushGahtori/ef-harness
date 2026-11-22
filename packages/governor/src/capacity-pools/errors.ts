export class CapacityError extends Error {
  readonly code:
    | "invalid_request"
    | "duplicate_task"
    | "unknown_task"
    | "not_admitted"
    | "not_ready"
    | "unknown_lease"
    | "lease_setup"
    | "job"
    | "heavy_lane"
    | "parallelism"
    | "clock"
    | "tier_e"
    | "disk"
    | "session";

  constructor(code: CapacityError["code"], message: string) {
    super(message);
    this.name = "CapacityError";
    this.code = code;
  }
}

export class AbortError extends Error {
  constructor(message = "The operation was aborted.") {
    super(message);
    this.name = "AbortError";
  }
}

export class ExecutionTimeoutError extends Error {
  readonly leaseId: string;
  readonly taskId: string;
  readonly deadlineAt: number;

  constructor(lease: { leaseId: string; taskId: string; deadlineAt: number }) {
    super(
      `Execution timed out for ${lease.taskId} at ${lease.deadlineAt}. Time spent waiting for a run slot is not part of the timeout.`,
    );
    this.name = "ExecutionTimeoutError";
    this.leaseId = lease.leaseId;
    this.taskId = lease.taskId;
    this.deadlineAt = lease.deadlineAt;
  }
}

export class SandboxHoldError extends Error {
  readonly taskId: string;
  readonly reason: string;

  constructor(taskId: string, reason: string) {
    super(`Execution held for ${taskId}: ${reason}`);
    this.name = "SandboxHoldError";
    this.taskId = taskId;
    this.reason = reason;
  }
}

export class SessionCapExceededError extends Error {
  readonly cap: number;
  readonly active: number;

  constructor(cap: number, active: number) {
    super(
      `Session-process cap ${cap} is full (${active} resident) and no idle wrapped session can be parked.`,
    );
    this.name = "SessionCapExceededError";
    this.cap = cap;
    this.active = active;
  }
}

export class SecretTransferRefusedError extends Error {
  constructor() {
    super("Refused to sync secret material to a remote execution slot without explicit approval.");
    this.name = "SecretTransferRefusedError";
  }
}

export function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new CapacityError("invalid_request", `${label} is required`);
  }
}

export function assertPositiveInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new CapacityError("invalid_request", `${label} must be a positive integer`);
  }
}

export function assertNonNegativeInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new CapacityError("invalid_request", `${label} must be a non-negative integer`);
  }
}

export function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new CapacityError("invalid_request", `${label} must be a finite number`);
  }
}

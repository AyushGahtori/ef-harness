export class MergeQueueError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class GitCommandError extends MergeQueueError {
  readonly command: string;
  readonly exitCode: number;

  constructor(command: string, exitCode: number, detail: string) {
    super("git_command", `git ${command} failed (${exitCode}): ${detail.trim()}`);
    this.command = command;
    this.exitCode = exitCode;
  }
}

export class InvalidIntegratorOutputError extends MergeQueueError {
  constructor(detail: string) {
    super("invalid_integrator_output", detail);
  }
}

export class TestWeakeningError extends MergeQueueError {
  readonly path: string;
  readonly reason: "skip" | "only" | "deleted_assertion" | "deleted_test";

  constructor(path: string, reason: TestWeakeningError["reason"], detail: string) {
    super("test_weakening", `${path}: ${reason}: ${detail}`);
    this.path = path;
    this.reason = reason;
  }
}

export class DroppedSideError extends MergeQueueError {
  readonly path: string;
  readonly line: string;

  constructor(path: string, line: string) {
    super("dropped_side", `${path} dropped feature logic: ${line}`);
    this.path = path;
    this.line = line;
  }
}

export class RefLeaseHeldError extends MergeQueueError {
  readonly ref: string;
  readonly holder: string;

  constructor(ref: string, holder: string) {
    super("lease_held", `${ref} is leased by ${holder}`);
    this.ref = ref;
    this.holder = holder;
  }
}

export class FeatureDoneRefusedError extends MergeQueueError {
  readonly failedConditions: readonly string[];

  constructor(failedConditions: readonly string[]) {
    super("feature_done_refused", `feature DONE refused: ${failedConditions.join(",") || "unknown"}`);
    this.failedConditions = failedConditions;
  }
}

export class SimulatedCrash extends MergeQueueError {
  constructor(phase: string) {
    super("simulated_crash", `merge queue stopped during ${phase}`);
  }
}

export class CasDriftError extends MergeQueueError {
  constructor(ref: string) {
    super("cas_drift", `${ref} kept moving before compare-and-swap could land`);
  }
}

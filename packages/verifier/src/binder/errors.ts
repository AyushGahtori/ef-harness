export type BindingDefectCode =
  | "false_green"
  | "non_behavioral"
  | "syntax"
  | "module_not_found"
  | "typescript"
  | "binder_crash"
  | "product_mutation"
  | "expectation_import"
  | "undeclared_helper"
  | "entry_not_invoked"
  | "constant_adapter"
  | "schema_mismatch"
  | "blocked"
  | "preservation_failed"
  | "blindness_leak"
  | "invalid_signature"
  | "prompt_rejected";

export type RejectionClass = "false_green" | "non_behavioral" | "preservation_failed";

/**
 * A check or binder that cannot be locked.
 * Always routed to the task author. Never charged to the implementing worker.
 */
export class BindingDefectError extends Error {
  readonly attribution = "binding_defect" as const;
  readonly routedTo = "task_author" as const;
  readonly workerPenalized = false as const;
  readonly workerAttemptsCharged = 0 as const;
  readonly calibrationImpact = "none" as const;

  constructor(
    readonly code: BindingDefectCode,
    message: string,
    readonly classification: RejectionClass,
  ) {
    super(message);
    this.name = "BindingDefectError";
  }
}

export type CleanFailureClass = "syntax" | "module_not_found" | "typescript" | "binder_crash";

/** Compile, resolution, or runner failure inside the clean tree. Not a behavioral red. */
export class CleanRunError extends Error {
  readonly classification: CleanFailureClass;

  constructor(classification: CleanFailureClass, message: string) {
    super(message);
    this.name = "CleanRunError";
    this.classification = classification;
  }
}

/** Behavioral mismatch raised by the trusted kernel comparison. */
export class ObservationMismatchError extends Error {
  override readonly name = "AssertionError";

  constructor(message = "observation mismatch") {
    super(message);
  }
}

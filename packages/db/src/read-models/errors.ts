export class ReadModelError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class RollupWriteForbiddenError extends ReadModelError {
  constructor() {
    super(
      "rollup_write_forbidden",
      "rollup_feature_tasks and rollup_feature_requirements are read-only outside drift self-healing",
    );
  }
}

export class WaiverApprovalRequiredError extends ReadModelError {
  readonly requirementId: string;

  constructor(requirementId: string, detail: string) {
    super("waiver_approval_required", `requirement ${requirementId} cannot be waived: ${detail}`);
    this.requirementId = requirementId;
  }
}

export class ReadModelTransactionError extends ReadModelError {
  constructor(message: string) {
    super("read_model_transaction", message);
  }
}

export class ReadModelHealError extends ReadModelError {
  constructor(message: string) {
    super("read_model_heal_failed", message);
  }
}

export class ReadModelQueryError extends ReadModelError {
  constructor(message: string) {
    super("read_model_query", message);
  }
}

export class InvalidSyncRequestError extends ReadModelError {
  constructor(message: string) {
    super("invalid_sync_request", message);
  }
}

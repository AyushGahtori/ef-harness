export class FinalAuditError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FinalAuditError";
    this.code = code;
  }
}

export class CompletionWaveNotReadyError extends FinalAuditError {
  readonly featureId: string;

  constructor(featureId: string, message: string) {
    super("features_not_done", message);
    this.name = "CompletionWaveNotReadyError";
    this.featureId = featureId;
  }
}

export class InvalidAuditorOutputError extends FinalAuditError {
  constructor(message: string) {
    super("invalid_auditor_output", message);
    this.name = "InvalidAuditorOutputError";
  }
}

export class ShardContextError extends FinalAuditError {
  constructor(message: string) {
    super("shard_context", message);
    this.name = "ShardContextError";
  }
}

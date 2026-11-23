export class EffectLedgerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EffectLedgerError";
    this.code = code;
  }
}

export class PayloadHashMismatchError extends EffectLedgerError {
  constructor(
    readonly idempotencyKey: string,
    readonly existingHash: string,
    readonly requestedHash: string,
  ) {
    super(
      "payload_hash_mismatch",
      `Idempotency key ${idempotencyKey} is bound to payload hash ${existingHash}, not ${requestedHash}`,
    );
    this.name = "PayloadHashMismatchError";
  }
}

export class ProductionAlwaysRequiresExplicitApprovalError extends EffectLedgerError {
  constructor(readonly effectType: string, readonly targetEnv: string) {
    super(
      "production_requires_explicit_approval",
      `Production effect ${effectType} (${targetEnv}) cannot use autoApprove`,
    );
    this.name = "ProductionAlwaysRequiresExplicitApprovalError";
  }
}

export class ApprovalStalePayloadChangedError extends EffectLedgerError {
  constructor(readonly effectId: string) {
    super(
      "approval_stale_payload_changed",
      `Approval for effect ${effectId} no longer matches the current payload hash`,
    );
    this.name = "ApprovalStalePayloadChangedError";
  }
}

export class LeaseEpochFenceError extends EffectLedgerError {
  constructor(message: string) {
    super("lease_epoch_fence", message);
    this.name = "LeaseEpochFenceError";
  }
}

export class EffectNotApprovedError extends EffectLedgerError {
  constructor(readonly effectId: string) {
    super("not_approved", `Effect ${effectId} is not approved for dispatch`);
    this.name = "EffectNotApprovedError";
  }
}

export class BlindUnknownOutcomeRetryForbiddenError extends EffectLedgerError {
  constructor(readonly effectId: string) {
    super(
      "blind_unknown_outcome_retry_forbidden",
      `Effect ${effectId} is unknown_outcome; reconcile before retry`,
    );
    this.name = "BlindUnknownOutcomeRetryForbiddenError";
  }
}
import type { DoneConditionId, FeatureState } from "./constants.js";
import type { FeatureDoneCheckResult } from "./types.js";

export class GitCommandError extends Error {
  readonly code = "git_command" as const;

  constructor(
    readonly command: string,
    readonly exitCode: number,
    readonly detail: string,
  ) {
    super(`${command} failed (${exitCode}): ${detail.trim()}`);
    this.name = "GitCommandError";
  }
}

export class FeatureNotReadyError extends Error {
  readonly code = "feature_not_ready" as const;

  constructor(
    readonly featureId: string,
    readonly state: FeatureState,
  ) {
    super(`Feature ${featureId} is ${state}; the integrator claims only LEAVES_MERGED.`);
    this.name = "FeatureNotReadyError";
  }
}

export class StaleEpochError extends Error {
  readonly code = "stale_epoch" as const;

  constructor(
    readonly featureId: string,
    readonly expectedEpoch: number,
    readonly actualEpoch: number,
  ) {
    super(
      `Feature ${featureId} epoch ${actualEpoch} does not match expected epoch ${expectedEpoch}.`,
    );
    this.name = "StaleEpochError";
  }
}

export class IllegalFeatureTransitionError extends Error {
  readonly code = "illegal_feature_transition" as const;

  constructor(
    readonly from: FeatureState,
    readonly to: FeatureState,
  ) {
    super(`Feature cannot move from ${from} to ${to}.`);
    this.name = "IllegalFeatureTransitionError";
  }
}

export class FeatureDoneRefusedError extends Error {
  readonly code = "feature_done_refused" as const;

  constructor(readonly result: FeatureDoneCheckResult) {
    super(
      `Feature DONE refused; failed conditions: ${result.failedConditions.join(", ") || "none"}.`,
    );
    this.name = "FeatureDoneRefusedError";
  }
}

export class VacuousSealedCheckError extends Error {
  readonly code = "already_green_on_base" as const;

  constructor(readonly checkId: string) {
    super(`Sealed check ${checkId} passed on the pre-feature base (already_green_on_base).`);
    this.name = "VacuousSealedCheckError";
  }
}

export class DroppedSideError extends Error {
  readonly code = "dropped_side" as const;

  constructor(
    readonly path: string,
    readonly side: "ours" | "theirs",
    readonly symbol: string,
  ) {
    super(`Conflict resolution for ${path} dropped ${side} symbol ${symbol}.`);
    this.name = "DroppedSideError";
  }
}

export class UnrelatedEditError extends Error {
  readonly code = "unrelated_edit" as const;

  constructor(readonly path: string) {
    super(`Integrator diff edited ${path}, which is outside the conflict hunks and wiring scope.`);
    this.name = "UnrelatedEditError";
  }
}

export class TestWeakeningError extends Error {
  readonly code = "test_weakening" as const;

  constructor(
    readonly path: string,
    readonly reason: "skip" | "only" | "deleted_assertion" | "deleted_test",
    readonly detail: string,
  ) {
    super(`Integrator diff weakened ${path} (${reason}): ${detail}`);
    this.name = "TestWeakeningError";
  }
}

export class ConflictVerificationError extends Error {
  readonly code = "conflict_verification_failed" as const;

  constructor(readonly detail: string) {
    super(detail);
    this.name = "ConflictVerificationError";
  }
}

export class LeafSharedFileViolationError extends Error {
  readonly code = "leaf_shared_file" as const;

  constructor(
    readonly taskId: string,
    readonly path: string,
  ) {
    super(`Leaf ${taskId} write scope includes shared registration file ${path}.`);
    this.name = "LeafSharedFileViolationError";
  }
}

export class LeafScopeOverlapError extends Error {
  readonly code = "leaf_scope_overlap" as const;

  constructor(
    readonly leftTask: string,
    readonly rightTask: string,
    readonly path: string,
  ) {
    super(`Leaf scopes overlap: ${leftTask} and ${rightTask} both cover ${path}.`);
    this.name = "LeafScopeOverlapError";
  }
}

export class IntegrationBlockedError extends Error {
  readonly code = "integration_blocked" as const;

  constructor(readonly detail: string) {
    super(detail);
    this.name = "IntegrationBlockedError";
  }
}

export class CasDriftError extends Error {
  readonly code = "cas_mismatch" as const;

  constructor(readonly actualSha: string) {
    super(`harness/integration moved again during landing (actual ${actualSha}).`);
    this.name = "CasDriftError";
  }
}

export class InvalidIntegratorOutputError extends Error {
  readonly code = "invalid_integrator_output" as const;

  constructor(readonly detail: string) {
    super(detail);
    this.name = "InvalidIntegratorOutputError";
  }
}

export function isDoneConditionId(value: string): value is DoneConditionId {
  return value === "1" || value === "2" || value === "3" || value === "4" || value === "5" || value === "6" || value === "7";
}

import type { FeatureDoneCheckResult } from "./models.js";
import type { FeatureState, ProjectState } from "./states.js";

export interface StaleEpochDetails {
  readonly feature: string;
  readonly expectedEpoch: number;
  readonly actualEpoch: number | null;
}

export class StaleEpochError extends Error {
  readonly code = "stale_epoch" as const;

  constructor(readonly details: StaleEpochDetails) {
    super(
      `stale epoch for ${details.feature}: expected ${details.expectedEpoch}, actual ${details.actualEpoch ?? "none"}`,
    );
    this.name = "StaleEpochError";
  }
}

export interface IllegalFeatureTransitionDetails {
  readonly feature: string;
  readonly from: FeatureState | null;
  readonly to: string;
  readonly reason: string;
}

export class IllegalFeatureTransitionError extends Error {
  readonly code = "illegal_feature_transition" as const;

  constructor(readonly details: IllegalFeatureTransitionDetails) {
    const from = details.from ?? "none";
    super(`illegal feature transition ${from} -> ${details.to} on ${details.feature}: ${details.reason}`);
    this.name = "IllegalFeatureTransitionError";
  }
}

export interface IllegalProjectTransitionDetails {
  readonly from: ProjectState;
  readonly to: string;
  readonly reason: string;
}

export class IllegalProjectTransitionError extends Error {
  readonly code = "illegal_project_transition" as const;

  constructor(readonly details: IllegalProjectTransitionDetails) {
    super(`illegal project transition ${details.from} -> ${details.to}: ${details.reason}`);
    this.name = "IllegalProjectTransitionError";
  }
}

export class FeatureNotFoundError extends Error {
  readonly code = "feature_not_found" as const;

  constructor(readonly feature: string) {
    super(`feature ${feature} is not in the knowledge graph or has no runtime row`);
    this.name = "FeatureNotFoundError";
  }
}

export class FeatureAlreadyInitializedError extends Error {
  readonly code = "feature_already_initialized" as const;

  constructor(readonly feature: string) {
    super(`feature_runtime already exists for ${feature}`);
    this.name = "FeatureAlreadyInitializedError";
  }
}

export class ProjectRuntimeMissingError extends Error {
  readonly code = "project_runtime_missing" as const;

  constructor() {
    super("project_runtime singleton row id = 1 is missing");
    this.name = "ProjectRuntimeMissingError";
  }
}

export class FeatureDoneRefusedError extends Error {
  readonly code = "feature_done_refused" as const;

  constructor(readonly result: FeatureDoneCheckResult) {
    super(`feature DONE refused: condition ${result.failedConditions.join(",") || "unknown"}`);
    this.name = "FeatureDoneRefusedError";
  }
}

export class ChangeSetNotFoundError extends Error {
  readonly code = "change_set_not_found" as const;

  constructor(readonly changeSetId: string) {
    super(`change set ${changeSetId} does not exist`);
    this.name = "ChangeSetNotFoundError";
  }
}

export interface CoupledFeatureRef {
  readonly feature: string;
  readonly state: string;
}

export class FeatureCoupledError extends Error {
  readonly code = "feature_coupled" as const;

  constructor(
    readonly feature: string,
    readonly coupled: readonly CoupledFeatureRef[],
  ) {
    super(`feature ${feature} is still coupled to active features`);
    this.name = "FeatureCoupledError";
  }
}

export class ApprovalRequiredError extends Error {
  readonly code = "approval_required" as const;

  constructor(readonly feature: string, readonly to: FeatureState) {
    super(`transition of ${feature} to ${to} requires explicit approval`);
    this.name = "ApprovalRequiredError";
  }
}

export class SameIntegrationHolderError extends Error {
  readonly code = "same_integration_holder" as const;

  constructor(readonly feature: string, readonly holder: string) {
    super(`integration holder of ${feature} is already ${holder}`);
    this.name = "SameIntegrationHolderError";
  }
}

export class InvalidLifecycleInputError extends Error {
  readonly code = "invalid_lifecycle_input" as const;

  constructor(message: string) {
    super(message);
    this.name = "InvalidLifecycleInputError";
  }
}

export interface CompletionBlocker {
  readonly feature: string;
  readonly state: string;
  readonly reason: "active" | "not_approved" | "coupled";
}

export class ProjectCompletionBlockedError extends Error {
  readonly code = "project_completion_blocked" as const;

  constructor(readonly blockers: readonly CompletionBlocker[]) {
    const summary = blockers.map((item) => `${item.feature}:${item.state}:${item.reason}`).join(", ");
    super(`project cannot enter COMPLETION while features remain: ${summary}`);
    this.name = "ProjectCompletionBlockedError";
  }
}

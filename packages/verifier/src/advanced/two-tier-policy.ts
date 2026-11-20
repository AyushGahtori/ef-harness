export interface TaskVerificationMetadata {
  readonly tags?: readonly string[];
}

export interface TwoTierVerificationPlan {
  readonly baseline: readonly ["red_before_green", "held_back_examples"];
  readonly propertyChecks: boolean;
  readonly boundaryMutationProbes: boolean;
  readonly runners: readonly ("PropertyCheckRunner" | "TargetedBoundaryMutationProber")[];
}

const BASELINE = ["red_before_green", "held_back_examples"] as const;

export function planTwoTierVerification(metadata: TaskVerificationMetadata): TwoTierVerificationPlan {
  const tags = new Set(metadata.tags ?? []);
  const propertyChecks = tags.has("invariant_domain");
  const boundaryMutationProbes = tags.has("high_impact_boundary");
  const runners: ("PropertyCheckRunner" | "TargetedBoundaryMutationProber")[] = [];
  if (propertyChecks) runners.push("PropertyCheckRunner");
  if (boundaryMutationProbes) runners.push("TargetedBoundaryMutationProber");
  return {
    baseline: BASELINE,
    propertyChecks,
    boundaryMutationProbes,
    runners,
  };
}

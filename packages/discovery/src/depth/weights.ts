import type { DepthCatalogEntry, ProjectStage, RecommendationResolution, RiskTier, StageProfile } from "./types.js";
import { STAGE_LABEL } from "./types.js";

/**
 * Integer weights only. `ask_value = impact × uncertainty`.
 * impact = risk × rework × stage multiplier × (downstream tasks + 1)
 * uncertainty = 0 when evidence settles it, 1 for a strong stage convention,
 * 2 when a recommendation exists without that convention, 8 when options differ
 * materially or no safe recommendation exists.
 */
export const RISK_WEIGHT: Readonly<Record<RiskTier, number>> = {
  low: 1,
  medium: 3,
  high: 6,
  critical: 10,
};

export const REWORK_WEIGHT = {
  easy: 1,
  moderate: 2,
  hard: 3,
} as const;

export const STAGE_IMPACT_MULTIPLIER: Readonly<Record<ProjectStage, number>> = {
  prototype: 1,
  mvp: 2,
  production: 4,
};

/** Criteria with ask_value strictly below this number are not asked. */
export const ASK_THRESHOLD: Readonly<Record<ProjectStage, number>> = {
  prototype: 8,
  mvp: 12,
  production: 4,
};

/** Importance below this, without a material option split, is not asked. */
export const IMPORTANCE_THRESHOLD: Readonly<Record<ProjectStage, number>> = {
  prototype: 6,
  mvp: 3,
  production: 1,
};

/** Soft cap on non-must-ask questions still shown to the user. Overflow is chosen for you. */
export const VISIBLE_QUESTION_CAP: Readonly<Record<ProjectStage, number>> = {
  prototype: 10,
  mvp: 16,
  production: 25,
};

export const MATERIAL_UNCERTAINTY = 8;

const VERIFICATION: Readonly<Record<ProjectStage, StageProfile["verification"]>> = {
  prototype: {
    level: "relaxed",
    minEvidenceChars: 0,
    confirmDerived: false,
    evidenceFromRisk: null,
  },
  mvp: {
    level: "standard",
    minEvidenceChars: 12,
    confirmDerived: false,
    evidenceFromRisk: "high",
  },
  production: {
    level: "strict",
    minEvidenceChars: 24,
    confirmDerived: true,
    evidenceFromRisk: "medium",
  },
};

export function stageProfile(stage: ProjectStage): StageProfile {
  return {
    stage,
    label: STAGE_LABEL[stage],
    askThreshold: ASK_THRESHOLD[stage],
    importanceThreshold: IMPORTANCE_THRESHOLD[stage],
    impactMultiplier: STAGE_IMPACT_MULTIPLIER[stage],
    visibleQuestionCap: VISIBLE_QUESTION_CAP[stage],
    verification: VERIFICATION[stage],
  };
}

export function importanceOf(entry: DepthCatalogEntry): number {
  return RISK_WEIGHT[entry.riskTier] * REWORK_WEIGHT[entry.reworkCost];
}

export function uncertaintyOf(entry: DepthCatalogEntry, stage: ProjectStage, recommendation: RecommendationResolution): number {
  if (entry.evidenceSettled) return 0;
  if (recommendation.kind === "force_must_ask") return MATERIAL_UNCERTAINTY;
  if (entry.materialOptionDifference && !entry.strongConventionStages.includes(stage)) {
    return MATERIAL_UNCERTAINTY;
  }
  if (entry.strongConventionStages.includes(stage)) return 1;
  return 2;
}

export function assertInteger(name: string, value: number): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer, received ${String(value)}`);
  }
}

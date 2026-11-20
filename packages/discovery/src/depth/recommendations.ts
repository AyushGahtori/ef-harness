import type { DepthCatalogEntry, ProjectStage, RecommendationResolution } from "./types.js";

/**
 * Resolves the stage recommendation.
 * A missing prototype rule may use the MVP rule only when that rule is marked safe.
 * Otherwise the question is forced to must-ask. Option index 0 is never a fallback.
 */
export function resolveStageRecommendation(
  entry: DepthCatalogEntry,
  stage: ProjectStage,
): RecommendationResolution {
  const direct = entry.recommendations.find((item) => item.stage === stage);
  if (direct) {
    return namedOption(entry, direct.optionId, direct.rationale, direct.stage, false);
  }
  if (stage === "prototype") {
    const mvp = entry.recommendations.find((item) => item.stage === "mvp");
    if (mvp?.safeForLowerStage) {
      return namedOption(entry, mvp.optionId, mvp.rationale, "mvp", true);
    }
  }
  return {
    kind: "force_must_ask",
    reason: `no safe ${stage} recommendation`,
  };
}

function namedOption(
  entry: DepthCatalogEntry,
  optionId: string,
  rationale: string,
  sourceStage: ProjectStage,
  fellBack: boolean,
): RecommendationResolution {
  const option = entry.options.find((item) => item.id === optionId);
  if (!option || rationale.trim().length === 0) {
    return {
      kind: "force_must_ask",
      reason: "recommendation does not name a real option",
    };
  }
  return {
    kind: "option",
    optionId: option.id,
    label: option.label,
    rationale: rationale.trim(),
    sourceStage,
    fellBack,
  };
}

export function optionLabel(entry: DepthCatalogEntry, optionId: string): string {
  return entry.options.find((item) => item.id === optionId)?.label ?? optionId;
}

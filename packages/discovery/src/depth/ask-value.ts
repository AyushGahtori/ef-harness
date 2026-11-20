import { resolveStageRecommendation } from "./recommendations.js";
import type { AskScore, DepthCatalogEntry, ProjectStage } from "./types.js";
import {
  ASK_THRESHOLD,
  IMPORTANCE_THRESHOLD,
  MATERIAL_UNCERTAINTY,
  STAGE_IMPACT_MULTIPLIER,
  assertInteger,
  importanceOf,
  uncertaintyOf,
} from "./weights.js";

/** Pure integer `ask_value`. Repeated calls with the same inputs return the same score. */
export function computeAskScore(entry: DepthCatalogEntry, stage: ProjectStage): AskScore {
  const recommendation = resolveStageRecommendation(entry, stage);
  const importance = importanceOf(entry);
  const impact = importance * STAGE_IMPACT_MULTIPLIER[stage] * (entry.downstreamTaskCount + 1);
  const uncertainty = uncertaintyOf(entry, stage, recommendation);
  const askValue = impact * uncertainty;
  assertInteger("importance", importance);
  assertInteger("impact", impact);
  assertInteger("uncertainty", uncertainty);
  assertInteger("ask_value", askValue);
  return {
    impact,
    uncertainty,
    importance,
    askValue,
    askThreshold: ASK_THRESHOLD[stage],
    importanceThreshold: IMPORTANCE_THRESHOLD[stage],
  };
}

/**
 * True when a non-must-ask criterion should be recorded as a stage default
 * instead of being shown. Must-ask criteria never fall below the threshold.
 */
export function isBelowAskThreshold(score: AskScore, mustAsk: boolean): boolean {
  if (mustAsk) return false;
  if (score.uncertainty === 0) return true;
  if (score.importance < score.importanceThreshold && score.uncertainty < MATERIAL_UNCERTAINTY) {
    return true;
  }
  return score.askValue < score.askThreshold;
}

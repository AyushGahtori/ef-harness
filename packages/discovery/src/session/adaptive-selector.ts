import type { GreedyQuestionSelector as DepthBatchSelector } from "../depth/greedy-selector.js";
import type { GreedyQuestionCandidate } from "../depth/types.js";
import { GreedyQuestionSelector } from "../selector/greedy-selector.js";
import type { CatalogQuestion, CriterionState } from "../selector/types.js";

/**
 * Depth's accept-all port, backed by the selector package's greedy selector.
 */
export class AdaptiveBatchSelector implements DepthBatchSelector {
  private readonly selector = new GreedyQuestionSelector();

  selectBatch(candidates: readonly GreedyQuestionCandidate[], k = 3): readonly GreedyQuestionCandidate[] {
    if (candidates.length === 0) return [];
    const criteria: CriterionState[] = [];
    const catalog: CatalogQuestion[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      catalog.push(questionFor(candidate));
      for (const criterionId of candidate.criterionIds) {
        if (seen.has(criterionId)) continue;
        seen.add(criterionId);
        criteria.push(criterionFor(candidate, criterionId));
      }
    }
    const unblockers = new Set<string>();
    for (const candidate of candidates) {
      if (candidate.downstreamUnblocks <= 0) continue;
      for (const criterionId of candidate.criterionIds) unblockers.add(criterionId);
    }
    const picks = this.selector.select({
      candidates: catalog,
      downstreamCatalog: catalog,
      criteria,
      unblockers,
      targetSize: k,
      initialCovered: new Set<string>(),
      skipQuestionIds: new Set<string>(),
      usedPrimaries: new Set<string>(),
      allowComplex: true,
    });
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const selected: GreedyQuestionCandidate[] = [];
    for (const pick of picks) {
      const candidate = byId.get(pick.question.id);
      if (candidate) selected.push(candidate);
    }
    return selected;
  }
}

function questionFor(candidate: GreedyQuestionCandidate): CatalogQuestion {
  return {
    id: candidate.id,
    text: candidate.id,
    options: [],
    targetCriteria: [...candidate.criterionIds],
    requiresSettled: [],
    touches: [],
    catalogPriority: candidate.catalogPriority,
    complex: false,
    conflictResolution: candidate.conflict,
    mustAsk: candidate.mustAsk,
    bundleGroup: null,
    whyAsking: null,
    projectLocal: false,
  };
}

function criterionFor(candidate: GreedyQuestionCandidate, criterionId: string): CriterionState {
  return {
    id: criterionId,
    decisionId: criterionId,
    label: criterionId,
    status: "open",
    mustAsk: candidate.mustAsk,
    scope: "leaf",
    askCount: 0,
    lastAskedTurn: null,
    skipCount: 0,
    ambiguous: false,
    requiresSettled: [],
  };
}

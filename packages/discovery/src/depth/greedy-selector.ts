import type { GreedyQuestionCandidate } from "./types.js";

/**
 * Local port of Task 072 `GreedyQuestionSelector`.
 * Scores uncovered criteria, then picks at most `k` questions (clamped to 1..4).
 * Replace this class with the selector export when Task 072 is on the base.
 */
export interface GreedyQuestionSelector {
  selectBatch(candidates: readonly GreedyQuestionCandidate[], k?: number): readonly GreedyQuestionCandidate[];
}

export class LocalGreedyQuestionSelector implements GreedyQuestionSelector {
  selectBatch(candidates: readonly GreedyQuestionCandidate[], k = 3): readonly GreedyQuestionCandidate[] {
    const limit = Math.min(4, Math.max(1, Math.floor(k)));
    const pool = [...candidates];
    const covered = new Set<string>();
    const picked: GreedyQuestionCandidate[] = [];
    while (picked.length < limit && pool.length > 0) {
      let bestIndex = -1;
      let bestScore = 0;
      let bestKey = "";
      for (let index = 0; index < pool.length; index += 1) {
        const candidate = pool[index];
        if (!candidate) continue;
        const marginal = marginalGain(candidate, covered);
        if (marginal <= 0) continue;
        const key = tieKey(candidate);
        if (bestIndex < 0 || marginal > bestScore || (marginal === bestScore && key < bestKey)) {
          bestIndex = index;
          bestScore = marginal;
          bestKey = key;
        }
      }
      if (bestIndex < 0) break;
      const chosen = pool.splice(bestIndex, 1)[0];
      if (!chosen) break;
      picked.push(chosen);
      for (const criterionId of chosen.criterionIds) covered.add(criterionId);
    }
    return picked;
  }
}

function marginalGain(candidate: GreedyQuestionCandidate, covered: ReadonlySet<string>): number {
  let total = 0;
  for (const criterionId of candidate.criterionIds) {
    if (covered.has(criterionId)) continue;
    total += criterionWeight(candidate);
  }
  return total;
}

function criterionWeight(candidate: GreedyQuestionCandidate): number {
  if (candidate.conflict) return 1_000_000;
  if (candidate.mustAsk) return 100_000;
  return 1_000 + candidate.downstreamUnblocks;
}

function tieKey(candidate: GreedyQuestionCandidate): string {
  const conflict = candidate.conflict ? "0" : "1";
  const mustAsk = candidate.mustAsk ? "0" : "1";
  const unblocks = String(10_000 - candidate.downstreamUnblocks).padStart(5, "0");
  const priority = String(candidate.catalogPriority).padStart(6, "0");
  return `${conflict}|${mustAsk}|${unblocks}|${priority}|${candidate.id}`;
}

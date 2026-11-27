import { CorpusPackLoader } from "@ef-harness/corpus";
import { GreedyQuestionSelector as AdaptiveQuestionSelector } from "../selector/greedy-selector.js";
import type { CatalogQuestion, CriterionState } from "../selector/types.js";
import { isTouchesTag, type TouchesTag } from "../selector/touches.js";

export interface LoadedCorpusSelection {
  readonly questionCount: number;
  readonly selectedIds: readonly string[];
}

/**
 * Loads the bundled 87-question v1 catalog and asks AdaptiveQuestionSelector
 * for the next batch. Authored attachment questions stay out of the batch.
 */
export function selectLoadedCorpusBatch(targetSize = 3): LoadedCorpusSelection {
  const catalog = new CorpusPackLoader().loadAllBundledPacks();
  if (catalog.danglingOptionIds.length > 0) {
    const first = catalog.danglingOptionIds[0];
    throw new Error(
      `corpus catalog has ${catalog.danglingOptionIds.length} dangling option ids` +
        (first ? ` starting at ${first.ownerId}` : ""),
    );
  }
  const v1 = catalog.questions.filter((question) => question.sourceFile.endsWith(".yaml"));
  const questions: CatalogQuestion[] = v1.map((question) => ({
    id: question.id,
    text: question.title,
    options: question.options.map((option, index) => ({
      id: option.id,
      label: option.id,
      recommended: index === 0,
    })),
    targetCriteria: question.criteria,
    requiresSettled: [],
    touches: touchesFor(question.id, question.touches),
    catalogPriority: 0,
    complex: false,
    conflictResolution: false,
    mustAsk: question.mustAsk,
    bundleGroup: question.pack,
    whyAsking: question.title,
    projectLocal: false,
  }));
  const criteria: CriterionState[] = [];
  const seen = new Set<string>();
  for (const question of v1) {
    for (const criterionId of question.criteria) {
      if (seen.has(criterionId)) continue;
      seen.add(criterionId);
      criteria.push({
        id: criterionId,
        decisionId: criterionId,
        label: criterionId,
        status: "open",
        mustAsk: question.mustAsk,
        scope: "leaf",
        askCount: 0,
        lastAskedTurn: null,
        skipCount: 0,
        ambiguous: false,
        requiresSettled: [],
      });
    }
  }
  const picks = new AdaptiveQuestionSelector().select({
    candidates: questions,
    downstreamCatalog: questions,
    criteria,
    unblockers: new Set<string>(),
    targetSize,
    initialCovered: new Set<string>(),
    skipQuestionIds: new Set<string>(),
    usedPrimaries: new Set<string>(),
    allowComplex: true,
  });
  return {
    questionCount: questions.length,
    selectedIds: picks.map((pick) => pick.question.id),
  };
}

function touchesFor(questionId: string, tags: readonly string[]): TouchesTag[] {
  const touches: TouchesTag[] = [];
  for (const tag of tags) {
    if (!isTouchesTag(tag)) {
      throw new Error(`question ${questionId} has unknown touches tag ${tag}`);
    }
    touches.push(tag);
  }
  return touches;
}

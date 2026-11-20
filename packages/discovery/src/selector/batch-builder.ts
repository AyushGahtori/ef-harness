import type { CatalogPrereqCycleError } from "./errors.js";
import { SelectorInvariantError } from "./errors.js";
import { AntiNagGuard, type ClarifyPort } from "./anti-nag.js";
import { GreedyQuestionSelector } from "./greedy-selector.js";
import { cleanOptionLabel, isUserFacingClean, joinAnd, plainLabel, safeWhyAsking } from "./plain-english.js";
import {
  MAX_BATCH_SIZE,
  criterionById,
  type AskUpdate,
  type BatchDiagnostic,
  type BatchQuestionSnapshot,
  type CatalogQuestion,
  type CriterionState,
  type DiscoveryBatchRecord,
  type GreedyPick,
  type QuestionOption,
  type SplitWavesCard,
} from "./types.js";
import { discoveryBatchQuestionsJson } from "./store.js";

export interface BatchBuildInput {
  readonly candidates: readonly CatalogQuestion[];
  readonly downstreamCatalog: readonly CatalogQuestion[];
  readonly criteria: readonly CriterionState[];
  readonly unblockers: ReadonlySet<string>;
  readonly targetSize: number;
  readonly workItemId: string;
  readonly scopeRev: number;
  readonly batchId: string;
  readonly catalogVersion: string;
  readonly turn: number;
  readonly createdAt: number;
  readonly lastOptionsVersion: number;
  readonly clarifier: ClarifyPort;
  readonly splitCard: SplitWavesCard | null;
  readonly diagnostics: readonly CatalogPrereqCycleError[];
}

export interface BatchBuildResult {
  readonly batch: DiscoveryBatchRecord;
  readonly nextOptionsVersion: number;
}

export class DiscoveryBatchBuilder {
  private readonly selector = new GreedyQuestionSelector();
  private readonly emptyCovered = new Set<string>();
  private readonly emptySkip = new Set<string>();
  private readonly emptyPrimaries = new Set<string>();

  build(input: BatchBuildInput): BatchBuildResult {
    const picks = this.cap(input);
    const criteria = criterionById(input.criteria);
    const criterionIds = input.criteria.map((criterion) => criterion.id);
    const guard = new AntiNagGuard(input.clarifier);
    const snapshot: BatchQuestionSnapshot[] = [];
    const primaries = new Set<string>();
    let optionsVersion = input.lastOptionsVersion;

    for (const pick of picks) {
      if (primaries.has(pick.primaryCriterionId)) {
        throw new SelectorInvariantError(
          "two questions in one batch share a primary uncovered criterion",
        );
      }
      primaries.add(pick.primaryCriterionId);
      const covered = pick.coveredCriterionIds
        .map((id) => criteria.get(id))
        .filter((criterion): criterion is CriterionState => criterion !== undefined);
      const primary = criteria.get(pick.primaryCriterionId) ?? covered[0];
      const nag = guard.adjust(pick.question, covered, criterionIds);
      const why = resolveWhy(pick, covered, primary?.label ?? "this product choice", criterionIds);
      const options = nag.options.map((option, index) => ({
        id: option.id,
        label: cleanOptionLabel(option.label, index, criterionIds),
        recommended: option.recommended,
      }));
      const multipleChoice = options.length > 0;
      if (multipleChoice) optionsVersion += 1;
      const decisionId = primary?.decisionId ?? pick.question.id;
      snapshot.push({
        questionId: pick.question.id,
        decisionId,
        text: nag.text,
        options,
        optionsVersion: multipleChoice ? optionsVersion : null,
        targetCriteria: pick.coveredCriterionIds,
        primaryCriterionId: pick.primaryCriterionId,
        whyAsking: why,
        touches: pick.question.touches,
        rephrased: nag.rephrased,
        offerDefaultOrDefer: nag.offerDefaultOrDefer,
        complex: pick.question.complex,
        conflictResolution: pick.question.conflictResolution || pick.isConflict,
        projectLocal: pick.question.projectLocal,
      });
    }

    if (input.splitCard !== null && snapshot.length < MAX_BATCH_SIZE) {
      optionsVersion += 1;
      snapshot.push(splitSnapshot(input.splitCard, optionsVersion));
    }

    const decisionIds = new Set(input.criteria.map((criterion) => criterion.decisionId));
    const questionIds = snapshot
      .map((question) => question.decisionId)
      .filter((id) => decisionIds.has(id));
    const askUpdates = askTelemetry(picks, criteria, input.turn);
    const diagnostics = input.diagnostics.map(diagnosticRecord);
    const batchWithoutJson: Omit<DiscoveryBatchRecord, "questionsJson"> = {
      id: input.batchId,
      workItemId: input.workItemId,
      scopeRev: input.scopeRev,
      status: "open",
      questionIds,
      snapshot,
      splitCard: input.splitCard,
      diagnostics,
      cursor: 0,
      createdAt: input.createdAt,
      catalogVersion: input.catalogVersion,
      askUpdates,
    };
    const questionsJson = discoveryBatchQuestionsJson(batchWithoutJson);
    return {
      nextOptionsVersion: optionsVersion,
      batch: { ...batchWithoutJson, questionsJson },
    };
  }

  private cap(input: BatchBuildInput): GreedyPick[] {
    const first = this.selector.select({
      candidates: input.candidates,
      downstreamCatalog: input.downstreamCatalog,
      criteria: input.criteria,
      unblockers: input.unblockers,
      targetSize: input.targetSize,
      initialCovered: this.emptyCovered,
      skipQuestionIds: this.emptySkip,
      usedPrimaries: this.emptyPrimaries,
      allowComplex: true,
    });
    const conflictActive = first.some((pick) => pick.question.conflictResolution || pick.isConflict);
    if (!conflictActive) return first;

    const kept: GreedyPick[] = [];
    const dropped: string[] = [];
    let usedComplex = false;
    for (const pick of first) {
      if (pick.question.complex && usedComplex) {
        dropped.push(pick.question.id);
        continue;
      }
      if (pick.question.complex) usedComplex = true;
      kept.push(pick);
    }
    if (dropped.length === 0 || kept.length >= input.targetSize) return kept;

    const covered = new Set<string>();
    const primaries = new Set<string>();
    const skip = new Set<string>();
    for (const pick of kept) {
      for (const id of pick.coveredCriterionIds) covered.add(id);
      primaries.add(pick.primaryCriterionId);
      skip.add(pick.question.id);
    }
    for (const id of dropped) skip.add(id);
    const more = this.selector.select({
      candidates: input.candidates,
      downstreamCatalog: input.downstreamCatalog,
      criteria: input.criteria,
      unblockers: input.unblockers,
      targetSize: input.targetSize - kept.length,
      initialCovered: covered,
      skipQuestionIds: skip,
      usedPrimaries: primaries,
      allowComplex: !usedComplex,
    });
    return [...kept, ...more];
  }
}

export function serializeDiscoveryBatchQuestions(
  record: Pick<
    DiscoveryBatchRecord,
    | "id"
    | "workItemId"
    | "scopeRev"
    | "status"
    | "cursor"
    | "createdAt"
    | "questionIds"
    | "snapshot"
    | "splitCard"
    | "diagnostics"
    | "catalogVersion"
    | "askUpdates"
  >,
): string {
  return discoveryBatchQuestionsJson(record);
}

function resolveWhy(
  pick: GreedyPick,
  covered: readonly CriterionState[],
  fallbackLabel: string,
  criterionIds: readonly string[],
): string {
  const authored = pick.question.whyAsking;
  if (authored !== null && authored.trim().length > 0 && isUserFacingClean(authored, criterionIds)) {
    return authored;
  }
  const labels = covered.map((criterion) => plainLabel(criterion.label, criterionIds));
  const phrase = labels.length > 0 ? joinAnd(labels) : plainLabel(fallbackLabel, criterionIds);
  return safeWhyAsking(phrase, criterionIds);
}

function splitSnapshot(card: SplitWavesCard, optionsVersion: number): BatchQuestionSnapshot {
  const options: QuestionOption[] = [
    { id: "split_waves", label: "Split into smaller waves", recommended: true },
    { id: "confirm_remaining", label: "Confirm remaining items", recommended: false },
  ];
  return {
    questionId: "split-waves",
    decisionId: "split-waves",
    text: card.text,
    options,
    optionsVersion,
    targetCriteria: [],
    primaryCriterionId: "split-waves",
    whyAsking: "Several decisions are still open and this project has used its question budget.",
    touches: [],
    rephrased: false,
    offerDefaultOrDefer: false,
    complex: false,
    conflictResolution: false,
    projectLocal: true,
  };
}

function askTelemetry(
  picks: readonly GreedyPick[],
  criteria: ReadonlyMap<string, CriterionState>,
  turn: number,
): AskUpdate[] {
  const updates: AskUpdate[] = [];
  const seen = new Set<string>();
  for (const pick of picks) {
    for (const id of pick.coveredCriterionIds) {
      if (seen.has(id)) continue;
      const criterion = criteria.get(id);
      if (criterion === undefined) continue;
      seen.add(id);
      updates.push({
        criterionId: criterion.id,
        decisionId: criterion.decisionId,
        askCount: criterion.askCount + 1,
        lastAskedTurn: turn,
      });
    }
  }
  return updates;
}

function diagnosticRecord(error: CatalogPrereqCycleError): BatchDiagnostic {
  return {
    name: "CatalogPrereqCycleError",
    warning: error.warning,
    brokenOnId: error.brokenOnId,
    cycle: error.cycle,
  };
}

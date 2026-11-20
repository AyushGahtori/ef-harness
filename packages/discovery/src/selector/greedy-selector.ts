import type { CatalogQuestion, CriterionState, GreedyPick } from "./types.js";
import { criterionById, isUncoveredStatus } from "./types.js";

/**
 * One must-ask criterion outranks any mix of 1,000 conflict criteria.
 * One conflict outranks any mix of 1,000 unblockers.
 * One unblocker outranks any mix of 1,000 standard criteria.
 */
export const WEIGHT_MUST_ASK = 1_003_003_001_000;
export const WEIGHT_CONFLICT = 1_002_001_000;
export const WEIGHT_UNBLOCKER = 1_001_000;
export const WEIGHT_STANDARD = 1_000;

export interface GreedySelectInput {
  readonly candidates: readonly CatalogQuestion[];
  readonly downstreamCatalog: readonly CatalogQuestion[];
  readonly criteria: readonly CriterionState[];
  readonly unblockers: ReadonlySet<string>;
  readonly targetSize: number;
  readonly initialCovered: ReadonlySet<string>;
  readonly skipQuestionIds: ReadonlySet<string>;
  readonly usedPrimaries: ReadonlySet<string>;
  readonly allowComplex: boolean;
}

const EMPTY_CATALOG: readonly CatalogQuestion[] = [];

function catalogHasPrerequisites(catalog: readonly CatalogQuestion[]): boolean {
  for (const question of catalog) {
    if (question.requiresSettled.length > 0) return true;
  }
  return false;
}

interface IndexedCandidate {
  readonly question: CatalogQuestion;
  readonly targetIndexes: Int32Array;
  readonly conflictFlag: number;
  readonly mustFlag: number;
  readonly downstream: number;
  readonly priority: number;
  readonly id: string;
  readonly complex: boolean;
}

export class GreedyQuestionSelector {
  select(input: GreedySelectInput): GreedyPick[] {
    const uncovered = input.criteria
      .filter((criterion) => isUncoveredStatus(criterion.status))
      .sort((left, right) => compareId(left.id, right.id));
    const indexById = new Map<string, number>();
    const weights = new Array<number>(uncovered.length);
    const statusConflict = new Uint8Array(uncovered.length);
    const statusMust = new Uint8Array(uncovered.length);
    const ids = new Array<string>(uncovered.length);
    for (let index = 0; index < uncovered.length; index += 1) {
      const criterion = uncovered[index];
      if (criterion === undefined) continue;
      indexById.set(criterion.id, index);
      weights[index] = criterionWeight(criterion, input.unblockers);
      statusConflict[index] = criterion.status === "conflict" ? 1 : 0;
      statusMust[index] = criterion.mustAsk ? 1 : 0;
      ids[index] = criterion.id;
    }

    const covered = new Uint8Array(uncovered.length);
    for (let index = 0; index < uncovered.length; index += 1) covered[index] = 1;
    for (const id of input.initialCovered) {
      const index = indexById.get(id);
      if (index !== undefined) covered[index] = 0;
    }
    const primaryUsed = new Uint8Array(uncovered.length);
    for (const id of input.usedPrimaries) {
      const index = indexById.get(id);
      if (index !== undefined) primaryUsed[index] = 1;
    }

    const countDownstream = catalogHasPrerequisites(input.downstreamCatalog);
    const indexed = input.candidates.map((question) =>
      indexCandidate(question, indexById, countDownstream ? input.downstreamCatalog : EMPTY_CATALOG),
    );
    const used = new Uint8Array(indexed.length);
    const picks: GreedyPick[] = [];
    const rounds = Math.min(input.targetSize, indexed.length);
    const scratch: number[] = [];
    const skipping = input.skipQuestionIds.size > 0;

    for (let round = 0; round < rounds; round += 1) {
      let best = -1;
      let bestGain = 0;
      let bestConflict = 0;
      let bestMust = 0;
      let bestDownstream = -1;
      let bestPriority = Number.POSITIVE_INFINITY;
      let bestId = "";
      let bestPrimary = -1;
      let bestCovered: number[] = [];

      for (let cursor = 0; cursor < indexed.length; cursor += 1) {
        if (used[cursor] === 1) continue;
        const candidate = indexed[cursor];
        if (candidate === undefined) continue;
        if (skipping && input.skipQuestionIds.has(candidate.id)) continue;
        if (!input.allowComplex && candidate.complex) continue;

        let gain = 0;
        let primary = -1;
        let primaryWeight = -1;
        let isConflict = candidate.conflictFlag;
        let isMust = candidate.mustFlag;
        scratch.length = 0;
        const targets = candidate.targetIndexes;
        const targetCount = targets.length;
        for (let offset = 0; offset < targetCount; offset += 1) {
          const criterionIndex = targets[offset] ?? 0;
          if (covered[criterionIndex] !== 1) continue;
          const weight = weights[criterionIndex] ?? 0;
          gain += weight;
          scratch.push(criterionIndex);
          if (statusConflict[criterionIndex] === 1) isConflict = 1;
          if (statusMust[criterionIndex] === 1) isMust = 1;
          if (
            weight > primaryWeight ||
            (weight === primaryWeight && (primary < 0 || criterionIndex < primary))
          ) {
            primaryWeight = weight;
            primary = criterionIndex;
          }
        }
        if (gain <= 0 || primary < 0) continue;
        if (primaryUsed[primary] === 1) continue;

        const better =
          best < 0 ||
          gain > bestGain ||
          (gain === bestGain && isConflict > bestConflict) ||
          (gain === bestGain && isConflict === bestConflict && isMust > bestMust) ||
          (gain === bestGain &&
            isConflict === bestConflict &&
            isMust === bestMust &&
            candidate.downstream > bestDownstream) ||
          (gain === bestGain &&
            isConflict === bestConflict &&
            isMust === bestMust &&
            candidate.downstream === bestDownstream &&
            candidate.priority < bestPriority) ||
          (gain === bestGain &&
            isConflict === bestConflict &&
            isMust === bestMust &&
            candidate.downstream === bestDownstream &&
            candidate.priority === bestPriority &&
            candidate.id < bestId);

        if (!better) continue;
        best = cursor;
        bestGain = gain;
        bestConflict = isConflict;
        bestMust = isMust;
        bestDownstream = candidate.downstream;
        bestPriority = candidate.priority;
        bestId = candidate.id;
        bestPrimary = primary;
        bestCovered = scratch.slice();
      }

      if (best < 0 || bestPrimary < 0) break;
      const winner = indexed[best];
      if (winner === undefined) break;
      used[best] = 1;
      primaryUsed[bestPrimary] = 1;
      const coveredIds: string[] = [];
      for (const criterionIndex of bestCovered) {
        covered[criterionIndex] = 0;
        const id = ids[criterionIndex];
        if (id !== undefined) coveredIds.push(id);
      }
      coveredIds.sort(compareId);
      const primaryId = ids[bestPrimary] ?? winner.question.targetCriteria[0] ?? winner.id;
      picks.push({
        question: winner.question,
        gain: bestGain,
        coveredCriterionIds: coveredIds,
        primaryCriterionId: primaryId,
        isConflict: bestConflict === 1,
        isMustAsk: bestMust === 1,
        downstreamUnblockCount: winner.downstream,
      });
    }

    return picks;
  }
}

export function unblockerIds(
  catalog: readonly CatalogQuestion[],
  criteria: readonly CriterionState[],
): Set<string> {
  const known = new Set(criteria.map((criterion) => criterion.id));
  const ids = new Set<string>();
  const note = (token: string): void => {
    if (known.has(token)) ids.add(token);
  };
  for (const question of catalog) {
    for (const token of question.requiresSettled) note(token);
  }
  for (const criterion of criteria) {
    for (const token of criterion.requiresSettled) note(token);
  }
  return ids;
}

export function applyScopePriority(
  questions: readonly CatalogQuestion[],
  criteria: readonly CriterionState[],
): CatalogQuestion[] {
  let foundationalOpen = false;
  for (const criterion of criteria) {
    if (criterion.scope !== "leaf" && isUncoveredStatus(criterion.status)) {
      foundationalOpen = true;
      break;
    }
  }
  if (!foundationalOpen) return [...questions];
  const byId = criterionById(criteria);
  const foundational = questions.filter((question) =>
    question.targetCriteria.some((id) => {
      const criterion = byId.get(id);
      return criterion !== undefined && isUncoveredStatus(criterion.status) && criterion.scope !== "leaf";
    }),
  );
  if (foundational.length > 0) return foundational;
  return [...questions];
}

export function coalesceBundles(
  questions: readonly CatalogQuestion[],
  criteria: readonly CriterionState[],
): CatalogQuestion[] {
  const byId = criterionById(criteria);
  const groups = new Map<string, CatalogQuestion[]>();
  const singles: CatalogQuestion[] = [];
  for (const question of questions) {
    if (question.bundleGroup === null) {
      singles.push(question);
      continue;
    }
    const list = groups.get(question.bundleGroup);
    if (list === undefined) groups.set(question.bundleGroup, [question]);
    else list.push(question);
  }
  const merged: CatalogQuestion[] = [...singles];
  const names = [...groups.keys()].sort(compareId);
  for (const name of names) {
    const members = groups.get(name);
    if (members === undefined || members.length === 0) continue;
    members.sort((left, right) => compareId(left.id, right.id));
    const only = members[0];
    if (members.length === 1 && only !== undefined) {
      merged.push(only);
      continue;
    }
    merged.push(mergeBundle(members, byId));
  }
  return merged;
}

export function stripSettledFromDrafts(
  questions: readonly CatalogQuestion[],
  criteria: readonly CriterionState[],
): CatalogQuestion[] {
  let hidden = false;
  for (const criterion of criteria) {
    if (!isUncoveredStatus(criterion.status)) {
      hidden = true;
      break;
    }
  }
  if (!hidden) return [...questions];
  const byId = criterionById(criteria);
  const next: CatalogQuestion[] = [];
  for (const question of questions) {
    const targets = question.targetCriteria.filter((id) => {
      const criterion = byId.get(id);
      return criterion !== undefined && isUncoveredStatus(criterion.status);
    });
    if (targets.length === 0) continue;
    if (targets.length === question.targetCriteria.length) {
      next.push(question);
      continue;
    }
    next.push({ ...question, targetCriteria: targets });
  }
  return next;
}

function indexCandidate(
  question: CatalogQuestion,
  indexById: ReadonlyMap<string, number>,
  downstreamCatalog: readonly CatalogQuestion[],
): IndexedCandidate {
  const seen = new Set<number>();
  for (const id of question.targetCriteria) {
    const index = indexById.get(id);
    if (index === undefined || seen.has(index)) continue;
    seen.add(index);
  }
  const targetIndexes = new Int32Array(seen.size);
  let cursor = 0;
  for (const index of [...seen].sort((left, right) => left - right)) {
    targetIndexes[cursor] = index;
    cursor += 1;
  }
  return {
    question,
    targetIndexes,
    conflictFlag: question.conflictResolution ? 1 : 0,
    mustFlag: question.mustAsk ? 1 : 0,
    downstream: downstreamUnblockCount(question, downstreamCatalog),
    priority: question.catalogPriority,
    id: question.id,
    complex: question.complex,
  };
}

function downstreamUnblockCount(
  question: CatalogQuestion,
  catalog: readonly CatalogQuestion[],
): number {
  if (catalog.length === 0) return 0;
  const targets = new Set(question.targetCriteria);
  let count = 0;
  for (const other of catalog) {
    if (other.id === question.id) continue;
    const hits = other.requiresSettled.some((token) => token === question.id || targets.has(token));
    if (hits) count += 1;
  }
  return count;
}

function criterionWeight(criterion: CriterionState, unblockers: ReadonlySet<string>): number {
  if (criterion.mustAsk) return WEIGHT_MUST_ASK;
  if (criterion.status === "conflict") return WEIGHT_CONFLICT;
  if (unblockers.has(criterion.id)) return WEIGHT_UNBLOCKER;
  return WEIGHT_STANDARD;
}

function mergeBundle(
  members: readonly CatalogQuestion[],
  criteria: ReadonlyMap<string, CriterionState>,
): CatalogQuestion {
  const lead = members[0];
  if (lead === undefined) {
    throw new Error("bundle merge requires at least one question");
  }
  const targets: string[] = [];
  const seenTargets = new Set<string>();
  const requires: string[] = [];
  const seenRequires = new Set<string>();
  const touches = new Map<string, CatalogQuestion["touches"][number]>();
  let priority = lead.catalogPriority;
  let conflict = false;
  let mustAsk = false;
  let projectLocal = true;
  for (const member of members) {
    if (member.catalogPriority < priority) priority = member.catalogPriority;
    if (member.conflictResolution) conflict = true;
    if (member.mustAsk) mustAsk = true;
    if (!member.projectLocal) projectLocal = false;
    for (const target of member.targetCriteria) {
      if (seenTargets.has(target)) continue;
      seenTargets.add(target);
      targets.push(target);
    }
    for (const token of member.requiresSettled) {
      if (seenRequires.has(token)) continue;
      seenRequires.add(token);
      requires.push(token);
    }
    for (const tag of member.touches) touches.set(tag, tag);
  }
  targets.sort(compareId);
  const labels: string[] = [];
  for (const target of targets) {
    const label = criteria.get(target)?.label;
    if (label !== undefined && !labels.includes(label)) labels.push(label);
  }
  const text =
    labels.length <= 1
      ? lead.text
      : `These choices belong together: ${joinLabels(labels)}.`;
  return {
    id: lead.id,
    text,
    options: lead.options,
    targetCriteria: targets,
    requiresSettled: requires,
    touches: [...touches.values()],
    catalogPriority: priority,
    complex: true,
    conflictResolution: conflict,
    mustAsk,
    bundleGroup: lead.bundleGroup,
    whyAsking: null,
    projectLocal,
  };
}

function joinLabels(labels: readonly string[]): string {
  if (labels.length === 2) return `${labels[0] ?? ""} and ${labels[1] ?? ""}`;
  const head = labels.slice(0, -1).join(", ");
  const last = labels[labels.length - 1] ?? "";
  return `${head}, and ${last}`;
}

function compareId(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

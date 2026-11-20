import { CatalogPrereqCycleError } from "./errors.js";
import {
  isPrerequisiteSatisfied,
  isUncoveredStatus,
  type CatalogQuestion,
  type CriterionState,
  criterionById,
  questionById,
} from "./types.js";

export interface EligibilityInput {
  readonly questions: readonly CatalogQuestion[];
  readonly criteria: readonly CriterionState[];
  readonly askedQuestionIds: readonly string[];
  readonly deferredQuestionIds: readonly string[];
  readonly waived: ReadonlyMap<string, readonly string[]>;
}

export interface CycleBreak {
  readonly waived: ReadonlyMap<string, readonly string[]>;
  readonly error: CatalogPrereqCycleError;
  readonly added: number;
}

/**
 * Keeps a question only when every `requires_settled` prerequisite is already
 * settled or not applicable, at least one target is still open, partial,
 * missing, or in conflict, and the question is not currently asked or deferred.
 */
export class PrereqEligibilityFilter {
  filter(input: EligibilityInput): CatalogQuestion[] {
    if (
      input.askedQuestionIds.length === 0 &&
      input.deferredQuestionIds.length === 0 &&
      input.waived.size === 0 &&
      !hasPrerequisiteTokens(input) &&
      allCriteriaUncovered(input.criteria)
    ) {
      const ids = new Set<string>();
      for (const criterion of input.criteria) ids.add(criterion.id);
      const eligible: CatalogQuestion[] = [];
      for (const question of input.questions) {
        for (const target of question.targetCriteria) {
          if (ids.has(target)) {
            eligible.push(question);
            break;
          }
        }
      }
      return eligible;
    }
    const criteria = criterionById(input.criteria);
    const questions = questionById(input.questions);
    const asked = new Set(input.askedQuestionIds);
    const deferred = new Set(input.deferredQuestionIds);
    const eligible: CatalogQuestion[] = [];
    for (const question of input.questions) {
      if (asked.has(question.id) || deferred.has(question.id)) continue;
      const tokens = prerequisiteTokens(question, criteria);
      if (!prerequisitesMet(question.id, tokens, criteria, questions, input.waived)) continue;
      let uncovered = 0;
      for (const target of question.targetCriteria) {
        const criterion = criteria.get(target);
        if (criterion !== undefined && isUncoveredStatus(criterion.status)) uncovered += 1;
      }
      if (uncovered === 0) continue;
      eligible.push(question);
    }
    return eligible;
  }
}

export function breakNextPrerequisiteCycle(input: EligibilityInput): CycleBreak | null {
  const criteria = criterionById(input.criteria);
  const questions = questionById(input.questions);
  const edges = new Map<string, string[]>();
  const addEdge = (from: string, to: string): void => {
    if (from === to) return;
    const list = edges.get(from);
    if (list === undefined) {
      edges.set(from, [to]);
      return;
    }
    list.push(to);
  };

  for (const question of input.questions) {
    for (const token of prerequisiteTokens(question, criteria)) {
      if (tokenWaived(question.id, token, input.waived)) continue;
      if (tokenSatisfied(token, criteria, questions)) continue;
      addEdge(question.id, token);
      if (!questions.has(token)) {
        for (const other of input.questions) {
          if (other.id !== question.id && other.targetCriteria.includes(token)) {
            addEdge(question.id, other.id);
          }
        }
      }
    }
  }

  for (const criterion of input.criteria) {
    if (isPrerequisiteSatisfied(criterion.status)) continue;
    for (const token of criterion.requiresSettled) {
      if (tokenWaived(criterion.id, token, input.waived)) continue;
      if (tokenSatisfied(token, criteria, questions)) continue;
      addEdge(criterion.id, token);
    }
  }

  for (const [node, list] of edges) {
    list.sort(compareId);
    edges.set(node, dedupe(list));
  }

  const cycle = findCycle([...edges.keys()].sort(compareId), edges);
  if (cycle === null || cycle.length === 0) return null;

  const brokenOnId = cycle.reduce((lowest, id) => (compareId(id, lowest) < 0 ? id : lowest), cycle[0] ?? "");
  const members = new Set(cycle);
  const next = copyWaivers(input.waived);
  let added = 0;
  const owners = new Set<string>([brokenOnId]);
  for (const question of input.questions) {
    if (question.id === brokenOnId || question.targetCriteria.includes(brokenOnId)) {
      owners.add(question.id);
    }
  }

  for (const owner of owners) {
    const question = questions.get(owner);
    const criterion = criteria.get(owner);
    const tokens =
      question !== undefined
        ? prerequisiteTokens(question, criteria)
        : (criterion?.requiresSettled ?? []);
    for (const token of tokens) {
      if (tokenWaived(owner, token, next)) continue;
      const hitsCycle =
        members.has(token) ||
        input.questions.some(
          (candidate) => candidate.targetCriteria.includes(token) && members.has(candidate.id),
        );
      if (!hitsCycle) continue;
      added += addWaiver(next, owner, token);
    }
  }

  if (added === 0) return null;
  return {
    waived: next,
    added,
    error: new CatalogPrereqCycleError(cycle, brokenOnId),
  };
}

export function hasUncoveredCriteria(criteria: readonly CriterionState[]): boolean {
  return criteria.some((criterion) => isUncoveredStatus(criterion.status));
}

export function criterionPrereqsMet(
  criterion: CriterionState,
  criteria: readonly CriterionState[],
  questions: readonly CatalogQuestion[],
  waived: ReadonlyMap<string, readonly string[]>,
): boolean {
  const byCriterion = criterionById(criteria);
  const byQuestion = questionById(questions);
  for (const token of criterion.requiresSettled) {
    if (tokenWaived(criterion.id, token, waived)) continue;
    if (!tokenSatisfied(token, byCriterion, byQuestion)) return false;
  }
  return true;
}

export function prerequisiteTokens(
  question: CatalogQuestion,
  criteria: ReadonlyMap<string, CriterionState>,
): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  const push = (token: string): void => {
    if (token.length === 0 || seen.has(token)) return;
    seen.add(token);
    tokens.push(token);
  };
  for (const token of question.requiresSettled) push(token);
  for (const target of question.targetCriteria) {
    const criterion = criteria.get(target);
    if (criterion === undefined) continue;
    for (const token of criterion.requiresSettled) push(token);
  }
  return tokens;
}

function allCriteriaUncovered(criteria: readonly CriterionState[]): boolean {
  for (const criterion of criteria) {
    if (!isUncoveredStatus(criterion.status)) return false;
  }
  return criteria.length > 0;
}

function hasPrerequisiteTokens(input: EligibilityInput): boolean {
  for (const question of input.questions) {
    if (question.requiresSettled.length > 0) return true;
  }
  for (const criterion of input.criteria) {
    if (criterion.requiresSettled.length > 0) return true;
  }
  return false;
}

function prerequisitesMet(
  questionId: string,
  tokens: readonly string[],
  criteria: ReadonlyMap<string, CriterionState>,
  questions: ReadonlyMap<string, CatalogQuestion>,
  waived: ReadonlyMap<string, readonly string[]>,
): boolean {
  for (const token of tokens) {
    if (tokenWaived(questionId, token, waived)) continue;
    if (!tokenSatisfied(token, criteria, questions)) return false;
  }
  return true;
}

function tokenSatisfied(
  token: string,
  criteria: ReadonlyMap<string, CriterionState>,
  questions: ReadonlyMap<string, CatalogQuestion>,
): boolean {
  const criterion = criteria.get(token);
  if (criterion !== undefined) return isPrerequisiteSatisfied(criterion.status);
  const question = questions.get(token);
  if (question === undefined) return false;
  if (question.targetCriteria.length === 0) return false;
  return question.targetCriteria.every((id) => {
    const target = criteria.get(id);
    return target !== undefined && isPrerequisiteSatisfied(target.status);
  });
}

function tokenWaived(
  ownerId: string,
  token: string,
  waived: ReadonlyMap<string, readonly string[]>,
): boolean {
  const direct = waived.get(ownerId);
  if (direct !== undefined && direct.includes(token)) return true;
  return false;
}

function copyWaivers(
  waived: ReadonlyMap<string, readonly string[]>,
): Map<string, string[]> {
  const next = new Map<string, string[]>();
  for (const [owner, tokens] of waived) {
    next.set(owner, [...tokens]);
  }
  return next;
}

function addWaiver(waived: Map<string, string[]>, owner: string, token: string): number {
  const list = waived.get(owner);
  if (list === undefined) {
    waived.set(owner, [token]);
    return 1;
  }
  if (list.includes(token)) return 0;
  list.push(token);
  return 1;
}

function findCycle(nodes: readonly string[], edges: ReadonlyMap<string, readonly string[]>): string[] | null {
  const color = new Map<string, 0 | 1 | 2>();
  for (const node of nodes) color.set(node, 0);
  const stack: string[] = [];

  const visit = (node: string): string[] | null => {
    color.set(node, 1);
    stack.push(node);
    const nexts = edges.get(node) ?? [];
    for (const next of nexts) {
      if (!color.has(next)) color.set(next, 0);
      const state = color.get(next) ?? 0;
      if (state === 1) {
        const start = stack.indexOf(next);
        if (start < 0) return [next];
        return stack.slice(start);
      }
      if (state === 0) {
        const found = visit(next);
        if (found !== null) return found;
      }
    }
    stack.pop();
    color.set(node, 2);
    return null;
  };

  for (const node of nodes) {
    if ((color.get(node) ?? 0) !== 0) continue;
    const found = visit(node);
    if (found !== null) return found;
  }
  return null;
}

function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    next.push(value);
  }
  return next;
}

function compareId(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

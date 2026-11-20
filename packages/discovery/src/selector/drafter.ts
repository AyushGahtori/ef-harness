import { criterionPrereqsMet } from "./eligibility.js";
import { isUserFacingClean, plainLabel, safeWhyAsking } from "./plain-english.js";
import { isTouchesTag, TOUCHES_TAGS, type TouchesTag } from "./touches.js";
import {
  isUncoveredStatus,
  type CatalogQuestion,
  type CriterionState,
  type QuestionOption,
  type ScopeClass,
  type SplitWavesCard,
} from "./types.js";

export const SPLIT_WAVES_TEXT = "Split into smaller waves or confirm remaining items" as const;

export interface QuestionDrafterV1 {
  readonly question_id: string;
  readonly text: string;
  readonly options: readonly QuestionOption[];
  readonly touches: readonly TouchesTag[];
  readonly target_criteria: readonly string[];
  readonly why_asking: string;
}

export interface QuestionDrafterRequest {
  readonly criterionId: string;
  readonly criterionLabel: string;
  readonly knownCriterionIds: readonly string[];
  readonly validTouches: readonly TouchesTag[];
  readonly suggestedTouch: TouchesTag;
  readonly retry: boolean;
  readonly previousErrors: readonly string[];
}

/**
 * Local port for `question-drafter@1`.
 * Task 009 did not register this contract (it would break the 32-schema inventory).
 */
export interface QuestionDrafterPort {
  draft(request: QuestionDrafterRequest): unknown;
}

export interface DraftParseContext {
  readonly knownCriterionIds: ReadonlySet<string>;
  readonly requestedCriterionId: string;
}

export type DraftParseResult =
  | { readonly ok: true; readonly value: QuestionDrafterV1 }
  | { readonly ok: false; readonly errors: readonly string[] };

export class QuestionDrafterV1Schema {
  static parse(value: unknown, context: DraftParseContext): DraftParseResult {
    const errors: string[] = [];
    if (!isRecord(value)) {
      return { ok: false, errors: ["draft must be an object"] };
    }
    const questionId = readString(value, "question_id");
    const text = readString(value, "text");
    const why = readString(value, "why_asking");
    if (questionId === null || questionId.length === 0) errors.push("question_id is required");
    if (text === null || text.trim().length === 0) errors.push("text is required");
    if (why === null || why.trim().length === 0) errors.push("why_asking is required");
    const ids = [...context.knownCriterionIds];
    if (text !== null && text.length > 0 && !isUserFacing(text, ids)) {
      errors.push("text leaks an internal id");
    }
    if (why !== null && why.length > 0 && !isUserFacing(why, ids)) {
      errors.push("why_asking leaks an internal id");
    }

    const options = readOptions(value.options, ids, errors);
    const touches = readTouches(value.touches, errors);
    const targets = readTargets(value.target_criteria, context, errors);
    if (errors.length > 0 || questionId === null || text === null || why === null || options === null || touches === null || targets === null) {
      return { ok: false, errors };
    }
    return {
      ok: true,
      value: {
        question_id: questionId,
        text: text.trim(),
        options,
        touches,
        target_criteria: targets,
        why_asking: why.trim(),
      },
    };
  }
}

export class DeterministicQuestionDrafter implements QuestionDrafterPort {
  draft(request: QuestionDrafterRequest): QuestionDrafterV1 {
    return templateDraft(request, `local-${stableHash(request.criterionId)}`);
  }
}

export interface DraftInput {
  readonly criteria: readonly CriterionState[];
  readonly catalog: readonly CatalogQuestion[];
  readonly projectLocalCount: number;
  readonly budget: number;
  readonly drafter: QuestionDrafterPort;
  readonly waived: ReadonlyMap<string, readonly string[]>;
}

export interface DraftOutput {
  readonly questions: readonly CatalogQuestion[];
  readonly splitCard: SplitWavesCard | null;
}

export class ProjectLocalQuestionDrafter {
  draft(input: DraftInput): DraftOutput {
    const targeted = new Set<string>();
    for (const question of input.catalog) {
      for (const id of question.targetCriteria) targeted.add(id);
    }
    const gaps = input.criteria
      .filter((criterion) => needsLocalQuestion(criterion, input, targeted))
      .sort((left, right) => compareId(left.id, right.id));
    const room = Math.max(0, input.budget - input.projectLocalCount);
    const chosen = gaps.slice(0, room);
    const held = gaps.slice(room);
    const known = input.criteria.map((criterion) => criterion.id);
    const questions: CatalogQuestion[] = [];
    for (const criterion of chosen) {
      questions.push(draftOne(criterion, known, input));
    }
    if (held.length === 0) return { questions, splitCard: null };
    return {
      questions,
      splitCard: {
        kind: "split_waves",
        text: SPLIT_WAVES_TEXT,
        remainingLabels: held.map((criterion) => plainLabel(criterion.label, known)),
        remainingCriterionIds: held.map((criterion) => criterion.id),
      },
    };
  }
}

function draftOne(
  criterion: CriterionState,
  known: readonly string[],
  input: DraftInput,
): CatalogQuestion {
  const label = plainLabel(criterion.label, known);
  const requestBase = {
    criterionId: criterion.id,
    criterionLabel: label,
    knownCriterionIds: known,
    validTouches: TOUCHES_TAGS,
    suggestedTouch: touchForScope(criterion.scope),
  };
  const context: DraftParseContext = {
    knownCriterionIds: new Set(known),
    requestedCriterionId: criterion.id,
  };
  const first = invoke(input.drafter, { ...requestBase, retry: false, previousErrors: [] }, context);
  const second = first.ok
    ? first
    : invoke(
        input.drafter,
        { ...requestBase, retry: true, previousErrors: first.errors },
        context,
      );
  const parsed = second.ok ? second.value : templateDraft(
    { ...requestBase, retry: true, previousErrors: second.errors },
    `fallback-${stableHash(criterion.id)}`,
  );
  return toCatalogQuestion(parsed, criterion);
}

function invoke(
  drafter: QuestionDrafterPort,
  request: QuestionDrafterRequest,
  context: DraftParseContext,
): DraftParseResult {
  try {
    return QuestionDrafterV1Schema.parse(drafter.draft(request), context);
  } catch {
    return { ok: false, errors: ["question-drafter@1 failed validation"] };
  }
}

function templateDraft(request: QuestionDrafterRequest, questionId: string): QuestionDrafterV1 {
  const touch = request.validTouches.includes(request.suggestedTouch)
    ? request.suggestedTouch
    : (request.validTouches[0] ?? "interactive_ui");
  return {
    question_id: questionId,
    text: `What should we do about ${request.criterionLabel}?`,
    options: [
      { id: "recommended", label: "Use the recommended default", recommended: true },
      { id: "describe", label: "I will describe it in my own words", recommended: false },
    ],
    touches: [touch],
    target_criteria: [request.criterionId],
    why_asking: safeWhyAsking(request.criterionLabel, request.knownCriterionIds),
  };
}

function toCatalogQuestion(draft: QuestionDrafterV1, criterion: CriterionState): CatalogQuestion {
  return {
    id: draft.question_id,
    text: draft.text,
    options: draft.options,
    targetCriteria: draft.target_criteria,
    requiresSettled: criterion.requiresSettled,
    touches: draft.touches,
    catalogPriority: 1_000,
    complex: draft.target_criteria.length > 1,
    conflictResolution: criterion.status === "conflict",
    mustAsk: criterion.mustAsk,
    bundleGroup: null,
    whyAsking: draft.why_asking,
    projectLocal: true,
  };
}

function needsLocalQuestion(
  criterion: CriterionState,
  input: DraftInput,
  targeted: ReadonlySet<string>,
): boolean {
  if (!isUncoveredStatus(criterion.status)) return false;
  if (targeted.has(criterion.id)) return false;
  return criterionPrereqsMet(criterion, input.criteria, input.catalog, input.waived);
}

function touchForScope(scope: ScopeClass): TouchesTag {
  if (scope === "auth") return "authn";
  if (scope === "data") return "migration";
  if (scope === "deployment_target") return "config_env";
  return "interactive_ui";
}

function isUserFacing(text: string, ids: readonly string[]): boolean {
  return isUserFacingClean(text, ids);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function readOptions(
  value: unknown,
  criterionIds: readonly string[],
  errors: string[],
): QuestionOption[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push("options must be a non-empty array");
    return null;
  }
  const options: QuestionOption[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== "string" || entry.id.length === 0 || typeof entry.label !== "string") {
      errors.push("each option needs an id and a label");
      return null;
    }
    if (seen.has(entry.id)) {
      errors.push("option ids must be unique");
      return null;
    }
    seen.add(entry.id);
    if (!isUserFacing(entry.label, criterionIds)) {
      errors.push("option label leaks an internal id");
      return null;
    }
    options.push({
      id: entry.id,
      label: entry.label,
      recommended: entry.recommended === true,
    });
  }
  if (!options.some((option) => option.recommended)) {
    errors.push("one option must be recommended");
    return null;
  }
  return options;
}

function readTouches(value: unknown, errors: string[]): TouchesTag[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push("touches must be a non-empty array");
    return null;
  }
  const tags: TouchesTag[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !isTouchesTag(entry)) {
      errors.push("touches contains an unknown tag");
      return null;
    }
    tags.push(entry);
  }
  return tags;
}

function readTargets(
  value: unknown,
  context: DraftParseContext,
  errors: string[],
): string[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push("target_criteria must be a non-empty array");
    return null;
  }
  const targets: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !context.knownCriterionIds.has(entry)) {
      errors.push("target_criteria references a missing criterion");
      return null;
    }
    targets.push(entry);
  }
  if (!targets.includes(context.requestedCriterionId)) {
    errors.push("target_criteria must include the requested criterion");
    return null;
  }
  return targets;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareId(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

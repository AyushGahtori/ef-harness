import { isShortAnswer, plannedClause, wholeSpan } from "./clause.js";
import type { ExplicitUiAction, InputStartFocus, PlannedClause } from "./types.js";

export type FastPathResult =
  | { readonly kind: "clauses"; readonly clauses: readonly PlannedClause[]; readonly classifyMs: number }
  | { readonly kind: "confirm_focus"; readonly classifyMs: number }
  | { readonly kind: "miss"; readonly classifyMs: number };

const EMERGENCY: Readonly<Record<string, "stop" | "pause">> = {
  stop: "stop",
  "stop everything": "stop",
  abort: "stop",
  "pause build": "pause",
};

/**
 * Zero-LLM intercept. Exact emergency phrases and explicit UI actions never call router@1.
 */
export function classifyFastPath(input: {
  readonly text: string;
  readonly origin: string;
  readonly explicitAction: ExplicitUiAction | null;
  readonly focus: InputStartFocus | null;
  readonly confirmationRequired: boolean;
}): FastPathResult {
  const started = performance.now();
  const action = input.explicitAction;
  const span = wholeSpan(input.text);
  const clauses = (list: readonly PlannedClause[]): FastPathResult => ({
    kind: "clauses",
    clauses: list,
    classifyMs: performance.now() - started,
  });
  const confirm = (): FastPathResult => ({ kind: "confirm_focus", classifyMs: performance.now() - started });
  const miss = (): FastPathResult => ({ kind: "miss", classifyMs: performance.now() - started });

  if (input.origin === "stop_button" || action?.type === "stop_button") {
    return clauses([controlClause(input.text || "stop", span, "stop")]);
  }
  if (action?.type === "pause_button") {
    return clauses([controlClause(input.text || "pause", span, "pause")]);
  }
  const phrase = normalizePhrase(input.text);
  if (!hasQuotation(input.text) && Object.prototype.hasOwnProperty.call(EMERGENCY, phrase)) {
    const control = EMERGENCY[phrase] ?? "stop";
    return clauses([controlClause(input.text, span, control)]);
  }
  if (action?.type === "approve_card") {
    return clauses([
      plannedClause({
        clauseText: input.text || "approve",
        span,
        intentType: "answer_question",
        routerIntent: "question",
        targetCandidateIds: [action.targetId],
        cardDecision: "approve",
      }),
    ]);
  }
  if (action?.type === "reject_card") {
    return clauses([
      plannedClause({
        clauseText: input.text || "reject",
        span,
        intentType: "answer_question",
        routerIntent: "question",
        targetCandidateIds: [action.targetId],
        cardDecision: "reject",
      }),
    ]);
  }
  if (input.confirmationRequired && (isShortAnswer(input.text) || action?.type === "question_target")) {
    return confirm();
  }
  if (action?.type === "question_target") {
    const matches =
      input.focus?.openQuestionCardId === action.targetId &&
      input.focus.openQuestionOptionsVersion === action.optionsVersion;
    if (!matches) return confirm();
    return clauses([answerClause(input.text, span, action.targetId, action.optionsVersion)]);
  }
  if (action?.type === "box_target") {
    const query = isPureQuery(input.text);
    return clauses([
      plannedClause({
        clauseText: input.text,
        span,
        intentType: query ? "read_only_query" : "edit_existing",
        routerIntent: query ? "question" : "change",
        targetCandidateIds: [action.targetId],
      }),
    ]);
  }
  if (
    input.focus?.openQuestionCardId &&
    input.focus.openQuestionOptionsVersion !== null &&
    isShortAnswer(input.text) &&
    !input.confirmationRequired
  ) {
    return clauses([
      answerClause(input.text, span, input.focus.openQuestionCardId, input.focus.openQuestionOptionsVersion),
    ]);
  }
  return miss();
}

function controlClause(text: string, span: { start: number; end: number }, control: "stop" | "pause"): PlannedClause {
  return plannedClause({
    clauseText: text.trim() || control,
    span,
    intentType: "stop_control",
    routerIntent: "control",
    control,
  });
}

function answerClause(
  text: string,
  span: { start: number; end: number },
  targetId: string,
  optionsVersion: number,
): PlannedClause {
  return plannedClause({
    clauseText: text,
    span,
    intentType: "answer_question",
    routerIntent: "question",
    targetCandidateIds: [targetId],
    optionsVersion,
  });
}

function normalizePhrase(text: string): string {
  return text.trim().replace(/\s+/g, " ").replace(/[.!]+$/g, "").toLowerCase();
}

function hasQuotation(text: string): boolean {
  return /["“”']/.test(text);
}

function isPureQuery(text: string): boolean {
  if (/\b(change|make|set|add|stop|pause|edit|switch|export)\b/i.test(text)) return false;
  return /\?/.test(text) || /^(how|what|when|where|why|who|did)\b/i.test(text.trim());
}

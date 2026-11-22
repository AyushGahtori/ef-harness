import type {
  ExplicitUiAction,
  IntentType,
  PlannedClause,
  RouterIntent,
  TextSpan,
} from "./types.js";

export function plannedClause(input: {
  readonly clauseText: string;
  readonly span: TextSpan;
  readonly intentType: IntentType;
  readonly routerIntent: RouterIntent;
  readonly targetCandidateIds?: readonly string[];
  readonly confidence?: PlannedClause["confidence"];
  readonly alternateReadings?: readonly string[];
  readonly needsClarification?: boolean;
  readonly routerConfidence?: number;
  readonly optionsVersion?: number | null;
  readonly dependsOnClauseIds?: readonly string[];
  readonly control?: PlannedClause["control"];
  readonly cardDecision?: PlannedClause["cardDecision"];
}): PlannedClause {
  return {
    clauseText: input.clauseText,
    span: input.span,
    intentType: input.intentType,
    routerIntent: input.routerIntent,
    targetCandidateIds: input.targetCandidateIds ?? [],
    confidence: input.confidence ?? "high",
    alternateReadings: input.alternateReadings ?? [],
    needsClarification: input.needsClarification ?? false,
    routerConfidence: input.routerConfidence ?? (input.confidence === "ambiguous" ? 0.4 : 0.92),
    optionsVersion: input.optionsVersion ?? null,
    dependsOnClauseIds: input.dependsOnClauseIds ?? [],
    control: input.control ?? null,
    cardDecision: input.cardDecision ?? null,
  };
}

export function wholeSpan(text: string): TextSpan {
  const trimmed = text.trim();
  if (!trimmed) return { start: 0, end: text.length };
  const start = text.indexOf(trimmed);
  return { start, end: start + trimmed.length };
}

export function isShortAnswer(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /^(option\s+)?\d+$/.test(normalized) || normalized === "yes" || normalized === "no" || normalized === "both";
}

export function isQuestionAction(
  action: ExplicitUiAction | null,
): action is Extract<ExplicitUiAction, { type: "question_target" }> {
  return action?.type === "question_target";
}

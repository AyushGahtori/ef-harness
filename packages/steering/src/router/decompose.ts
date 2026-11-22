import { plannedClause, wholeSpan } from "./clause.js";
import { contentTokens } from "./shortlist.js";
import type { InputStartFocus, PlannedClause, RouterPrompt, RouterV1, ShortlistCard, TextSpan } from "./types.js";
import type { RouterModelPort as ModelPort } from "./ports.js";

export interface TargetMatch {
  readonly mode: "explicit" | "focused" | "unique" | "ambiguous" | "none";
  readonly ids: readonly string[];
}

export function splitClauseSpans(text: string): TextSpan[] {
  const sentences = splitBy(text, /(?<=[.?!])\s+/g);
  const parts: TextSpan[] = [];
  for (const sentence of sentences) {
    const relative = text.slice(sentence.start, sentence.end);
    const pieces = splitBy(relative, /\s*,\s*also\s+|\s*,\s*and\s+|\s+also\s+|\s+and\s+|;\s+/gi);
    for (const piece of pieces) {
      parts.push({ start: sentence.start + piece.start, end: sentence.start + piece.end });
    }
  }
  return parts;
}

export function matchTargets(
  clauseText: string,
  cards: readonly ShortlistCard[],
  focus: InputStartFocus | null,
): TargetMatch {
  const lowered = clauseText.toLowerCase();
  const explicit = cards.filter((card) => namesCard(lowered, card));
  const named = explicit[0];
  if (explicit.length === 1 && named) return { mode: "explicit", ids: [named.id] };
  if (explicit.length >= 2) return { mode: "ambiguous", ids: explicit.map((card) => card.id).sort() };

  const tokens = contentTokens(clauseText);
  const scored = cards
    .map((card) => ({
      id: card.id,
      score: tokens.reduce((sum, token) => sum + (cardHaystack(card).includes(token) ? 1 : 0), 0),
    }))
    .filter((row) => row.score > 0);
  if (scored.length === 0 || tokens.length === 0) return { mode: "none", ids: [] };
  const max = Math.max(...scored.map((row) => row.score));
  const top = scored
    .filter((row) => row.score === max)
    .map((row) => row.id)
    .sort();
  const focused = top.filter((id) => focusIds(focus).includes(id));
  if (top.length >= 2 && focused.length === 1) return { mode: "focused", ids: focused };
  if (top.length >= 2) return { mode: "ambiguous", ids: top };
  return { mode: "unique", ids: top };
}

export function planMessage(input: {
  readonly text: string;
  readonly cards: readonly ShortlistCard[];
  readonly focus: InputStartFocus | null;
  readonly previousTargets: readonly string[];
}): PlannedClause[] {
  const spans = splitClauseSpans(input.text);
  const usable = spans.filter((span) => kindOf(input.text.slice(span.start, span.end)) !== "drop");
  const planned: PlannedClause[] = [];
  for (const span of usable) {
    const clauseText = input.text.slice(span.start, span.end);
    const kind = kindOf(clauseText);
    const match = matchTargets(clauseText, input.cards, input.focus);
    planned.push(buildClause(clauseText, span, kind, match, input));
  }
  return inheritPronouns(planned);
}

export function toRouterV1(clauses: readonly PlannedClause[]): RouterV1 {
  return {
    clauses: clauses.map((clause) => ({
      span: clause.span,
      intent: clause.routerIntent,
      target_id: clause.confidence === "high" ? (clause.targetCandidateIds[0] ?? null) : null,
      confidence: clause.routerConfidence,
      needs_clarification: clause.needsClarification,
    })),
  };
}

export class DeterministicRouterModel implements ModelPort {
  readonly usesProvider = false;
  calls = 0;

  complete(prompt: RouterPrompt): RouterV1 {
    this.calls += 1;
    return toRouterV1(planMessage({
      text: prompt.messageText,
      cards: prompt.cards,
      focus: prompt.focus,
      previousTargets: prompt.previousTargets,
    }));
  }
}

function buildClause(
  clauseText: string,
  span: TextSpan,
  kind: ClauseKind,
  match: TargetMatch,
  input: { readonly previousTargets: readonly string[] },
): PlannedClause {
  if (kind === "control") {
    const control = /\bpause\b/i.test(withoutQuotes(clauseText)) && !/\b(stop|abort)\b/i.test(withoutQuotes(clauseText))
      ? "pause"
      : "stop";
    const global = isGlobalControl(clauseText);
    const ids = global || match.mode === "ambiguous" || match.mode === "none" ? [] : match.ids;
    return plannedClause({
      clauseText,
      span,
      intentType: "stop_control",
      routerIntent: "control",
      targetCandidateIds: ids,
      control,
      confidence: match.mode === "ambiguous" && !global ? "ambiguous" : "high",
      alternateReadings: match.mode === "ambiguous" && !global ? match.ids : [],
      needsClarification: match.mode === "ambiguous" && !global,
    });
  }
  if (kind === "query") {
    return plannedClause({
      clauseText,
      span,
      intentType: "read_only_query",
      routerIntent: "question",
      targetCandidateIds: match.mode === "explicit" || match.mode === "unique" || match.mode === "focused" ? match.ids : [],
      routerConfidence: 0.8,
    });
  }
  if (kind === "undo") {
    const neverMind = /never\s+mind/i.test(clauseText);
    const ids = match.mode === "none" && neverMind ? input.previousTargets : match.ids;
    const ambiguous = match.mode === "ambiguous" || (neverMind && ids.length >= 2);
    return plannedClause({
      clauseText,
      span,
      intentType: ids.length === 0 && !neverMind ? "stop_control" : "undo_feature",
      routerIntent: ids.length === 0 && !neverMind ? "control" : "remove",
      targetCandidateIds: ambiguous ? [] : ids,
      confidence: ambiguous || (ids.length === 0 && !neverMind) ? "ambiguous" : "high",
      alternateReadings: ambiguous ? ids : [],
      needsClarification: ambiguous || (match.mode === "none" && !neverMind && ids.length === 0),
      control: ids.length === 0 ? "stop" : null,
    });
  }
  if (kind === "add" && (match.mode === "none" || match.mode === "ambiguous")) {
    return plannedClause({
      clauseText,
      span,
      intentType: "add_new_feature",
      routerIntent: "new_feature",
      confidence: match.mode === "ambiguous" ? "ambiguous" : "high",
      alternateReadings: match.mode === "ambiguous" ? match.ids : [],
      needsClarification: match.mode === "ambiguous",
      targetCandidateIds: match.mode === "ambiguous" ? [] : [],
      dependsOnClauseIds: [],
    });
  }
  const editIntent = /misheard|transcription/i.test(clauseText) ? "correct_evidence" : "change";
  const unresolved = match.mode === "none";
  const ambiguous = match.mode === "ambiguous";
  return plannedClause({
    clauseText,
    span,
    intentType: "edit_existing",
    routerIntent: editIntent,
    targetCandidateIds: ambiguous || unresolved ? [] : match.ids,
    confidence: ambiguous || unresolved ? "ambiguous" : "high",
    alternateReadings: ambiguous ? match.ids : [],
    needsClarification: ambiguous || unresolved,
    dependsOnClauseIds: [],
    routerConfidence: ambiguous || unresolved ? 0.4 : 0.9,
  });
}

function inheritPronouns(clauses: PlannedClause[]): PlannedClause[] {
  return clauses.map((clause, index) => {
    const earlier = clauses.slice(0, index);
    const previous = earlier[earlier.length - 1];
    if (/\bit\b/i.test(clause.clauseText) && previous && previous.targetCandidateIds.length === 1 && clause.targetCandidateIds.length === 0) {
      return {
        ...clause,
        targetCandidateIds: previous.targetCandidateIds,
        confidence: "high",
        needsClarification: false,
        alternateReadings: [],
        routerConfidence: 0.9,
      };
    }
    if (/\bthem\b/i.test(clause.clauseText)) {
      const added = earlier.find((item) => item.intentType === "add_new_feature");
      if (added) {
        return { ...clause, dependsOnClauseIds: [`#${earlier.indexOf(added)}`] };
      }
    }
    return clause;
  });
}

type ClauseKind = "control" | "undo" | "query" | "add" | "edit" | "drop";

function kindOf(clauseText: string): ClauseKind {
  const bare = withoutQuotes(clauseText);
  if (/\bnever\s+mind\b|\bundo\b|\brevert\b|\bremove\b/i.test(bare)) return "undo";
  if (/\b(stop|abort|pause)\b/i.test(bare)) return "control";
  if (/\b(add|introduce)\b/i.test(bare)) return "add";
  if (/\b(change|make|set|move|update|edit|switch|include|export|let|show)\b/i.test(bare)) return "edit";
  if (/\b(misheard|transcription)\b/i.test(bare)) return "edit";
  if (/\?/.test(clauseText) || /^(how|what|when|where|why|who|show|did)\b/i.test(bare.trim())) return "query";
  return "drop";
}

function withoutQuotes(text: string): string {
  return text.replace(/["“”][^"“”]*["“”]/g, " ");
}

function isGlobalControl(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, " ").replace(/[.!?]+$/g, "").toLowerCase();
  return (
    normalized === "stop" ||
    normalized === "stop everything" ||
    normalized === "abort" ||
    normalized === "pause build" ||
    normalized === "stop the build" ||
    normalized === "pause the build"
  );
}

function namesCard(lowered: string, card: ShortlistCard): boolean {
  if (lowered.includes(card.id.toLowerCase())) return true;
  const title = card.title.trim().toLowerCase();
  if (title.length >= 3 && lowered.includes(title)) return true;
  return card.aliases.some((alias) => alias.trim().length >= 3 && lowered.includes(alias.trim().toLowerCase()));
}

function cardHaystack(card: ShortlistCard): string {
  return `${card.id} ${card.title} ${card.text} ${card.aliases.join(" ")}`.toLowerCase();
}

function focusIds(focus: InputStartFocus | null): string[] {
  if (!focus) return [];
  return [focus.focusedFeatureId, focus.inspectedTaskId, ...focus.selectedCanvasNodeIds].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
}

function splitBy(text: string, pattern: RegExp): TextSpan[] {
  const expression = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  const parts: TextSpan[] = [];
  let cursor = 0;
  for (const match of text.matchAll(expression)) {
    const at = match.index ?? 0;
    pushTrimmed(parts, text, cursor, at);
    cursor = at + match[0].length;
  }
  pushTrimmed(parts, text, cursor, text.length);
  if (parts.length === 0 && text.trim()) {
    return [wholeSpan(text)];
  }
  return parts;
}

function pushTrimmed(parts: TextSpan[], text: string, from: number, to: number): void {
  const raw = text.slice(from, to);
  if (!raw.trim()) return;
  const lead = raw.length - raw.trimStart().length;
  const trail = raw.length - raw.trimEnd().length;
  const start = from + lead;
  const end = to - trail;
  if (end > start) parts.push({ start, end });
}

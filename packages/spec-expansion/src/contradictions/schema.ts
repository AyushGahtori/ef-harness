/**
 * Local port of Task 009 `ContradictionCheckV1Schema`.
 * Success matches `{ verdict, explanation, minimal_change_suggestion }`.
 * Honest exit matches `{ blocked: true, reason, missing_ids? }`.
 * Grounding fields `cited_node_ids` and `counterexample` are accepted here because
 * Layer 5 must reject conflicts that do not cite the exact pair and a concrete
 * counterexample. The frozen Task 009 schema is strict and does not list them yet.
 */

export type ContradictionVerdict = "conflict" | "compatible" | "unclear";

export interface ContradictionCheckBlocked {
  readonly kind: "blocked";
  readonly reason: string;
  readonly missingIds: readonly string[];
}

export interface ContradictionCheckVerdict {
  readonly kind: "verdict";
  readonly verdict: ContradictionVerdict;
  readonly explanation: string;
  readonly minimalChangeSuggestion: string | null;
  readonly citedNodeIds: readonly string[] | null;
  readonly counterexample: string | null;
}

export type ParsedContradictionCheck = ContradictionCheckBlocked | ContradictionCheckVerdict;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

const VERDICTS = new Set<string>(["conflict", "compatible", "unclear"]);

export function parseContradictionCheckV1(value: unknown): ParsedContradictionCheck | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (value.blocked === true) {
    const allowed = new Set(["blocked", "reason", "missing_ids"]);
    if (keys.some((key) => !allowed.has(key))) return null;
    if (!isNonEmptyText(value.reason)) return null;
    if (value.missing_ids !== undefined && !isStringArray(value.missing_ids)) return null;
    return {
      kind: "blocked",
      reason: value.reason.trim(),
      missingIds: value.missing_ids === undefined ? [] : value.missing_ids.map((id) => id.trim()),
    };
  }
  const allowed = new Set([
    "verdict",
    "explanation",
    "minimal_change_suggestion",
    "cited_node_ids",
    "counterexample",
  ]);
  if (keys.some((key) => !allowed.has(key))) return null;
  if (typeof value.verdict !== "string" || !VERDICTS.has(value.verdict)) return null;
  if (!isNonEmptyText(value.explanation)) return null;
  const suggestion = value.minimal_change_suggestion;
  if (suggestion !== null && !isNonEmptyText(suggestion)) return null;
  if (value.cited_node_ids !== undefined && !isStringArray(value.cited_node_ids)) return null;
  if (value.counterexample !== undefined && value.counterexample !== null && !isNonEmptyText(value.counterexample)) {
    return null;
  }
  const verdict = value.verdict;
  if (verdict !== "conflict" && verdict !== "compatible" && verdict !== "unclear") return null;
  return {
    kind: "verdict",
    verdict,
    explanation: value.explanation.trim(),
    minimalChangeSuggestion: suggestion === null ? null : suggestion.trim(),
    citedNodeIds: value.cited_node_ids === undefined ? null : value.cited_node_ids.map((id) => id.trim()),
    counterexample:
      value.counterexample === undefined || value.counterexample === null ? null : value.counterexample.trim(),
  };
}

export function isConcreteCounterexample(text: string | null): text is string {
  if (text === null) return false;
  const trimmed = text.trim();
  if (trimmed.length < 20) return false;
  if (/^(a |some |mere )?tension\.?$/i.test(trimmed)) return false;
  return /\bwhen\b/i.test(trimmed) || /\d/.test(trimmed) || /"[^"]+"/.test(trimmed);
}

export function citesExactPair(cited: readonly string[] | null, leftId: string, rightId: string): boolean {
  if (cited === null || cited.length !== 2) return false;
  const ids = new Set(cited);
  return ids.size === 2 && ids.has(leftId) && ids.has(rightId);
}

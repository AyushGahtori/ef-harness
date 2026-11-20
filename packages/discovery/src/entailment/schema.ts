import { ENTAILMENT_VERDICTS, type EntailmentVerdict } from "./types.js";

/**
 * Local stand-in for Task 009 `EntailmentCheckerV1Schema`.
 * Zod is not on this foundation base. The accepted shapes match the sibling schema:
 * `{ verdict, reason }` or an honest `{ blocked: true, reason, missing_ids? }` exit.
 * Extra keys are rejected. Integration should swap this parser for the Zod schema.
 */
export type EntailmentCheckerSuccess = {
  readonly verdict: EntailmentVerdict;
  readonly reason: string;
};

export type EntailmentCheckerBlocked = {
  readonly blocked: true;
  readonly reason: string;
  readonly missing_ids?: readonly string[];
};

export type EntailmentCheckerV1 = EntailmentCheckerSuccess | EntailmentCheckerBlocked;

export function isBlockedEntailment(value: EntailmentCheckerV1): value is EntailmentCheckerBlocked {
  return "blocked" in value && value.blocked === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseEntailmentCheckerV1(value: unknown): EntailmentCheckerV1 | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (value.blocked === true) {
    const allowed = new Set(["blocked", "reason", "missing_ids"]);
    if (keys.some((key) => !allowed.has(key))) return null;
    if (!isNonEmptyText(value.reason)) return null;
    if (value.missing_ids === undefined) {
      return { blocked: true, reason: value.reason };
    }
    if (!Array.isArray(value.missing_ids) || value.missing_ids.some((item) => typeof item !== "string" || item.trim().length === 0)) {
      return null;
    }
    return { blocked: true, reason: value.reason, missing_ids: value.missing_ids };
  }
  if (keys.length !== 2 || !keys.includes("verdict") || !keys.includes("reason")) return null;
  if (!isNonEmptyText(value.reason)) return null;
  if (typeof value.verdict !== "string" || !(ENTAILMENT_VERDICTS as readonly string[]).includes(value.verdict)) {
    return null;
  }
  return { verdict: value.verdict as EntailmentVerdict, reason: value.reason };
}

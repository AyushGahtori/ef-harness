import type { CitedExcerpt, TurnSnapshot } from "./types.js";

/**
 * Local port for Task 070 `ExactQuoteEvidenceVerifier` and `QuoteValidationResult`.
 * Swap the class for the sibling export at integration. Behavior matches the
 * quote rules this gate depends on: developer author, in-span text, digits and
 * negations preserved, retracted and superseded spans excluded.
 */
export interface QuoteCheck {
  readonly turn: TurnSnapshot | null;
  readonly excerpt: CitedExcerpt;
}

export interface QuoteValidationResult {
  readonly ok: boolean;
  readonly reason: string;
}

export interface ExactQuoteEvidenceVerifier {
  verify(check: QuoteCheck): QuoteValidationResult;
}

export interface TurnDirectory {
  get(turnId: string): TurnSnapshot | null;
}

const NEGATION_TOKENS = new Set(["not", "never", "no", "without", "don't", "dont", "scrap"]);

export function normalizeQuote(value: string): string {
  const folded = value.normalize("NFC").toLowerCase().replace(/[’‘]/g, "'");
  return folded
    .replace(/[^\p{L}\p{N}':]+/gu, " ")
    .trim()
    .replace(/ +/g, " ");
}

function tokens(value: string): string[] {
  return normalizeQuote(value).split(" ").filter((token) => token.length > 0);
}

function digitRun(value: string): string {
  return (value.match(/\d+/g) ?? []).join(",");
}

export class LocalExactQuoteEvidenceVerifier implements ExactQuoteEvidenceVerifier {
  verify(check: QuoteCheck): QuoteValidationResult {
    const { turn, excerpt } = check;
    if (!turn) return { ok: false, reason: "turn is missing" };
    if (turn.author !== "developer" || excerpt.author !== "developer") {
      return { ok: false, reason: "assistant text is not user evidence" };
    }
    if (excerpt.retracted || excerpt.superseded) {
      return { ok: false, reason: "span is retracted or superseded" };
    }
    if (turn.id !== excerpt.turnId) return { ok: false, reason: "span is bound to a different turn" };
    if (!Number.isInteger(excerpt.start) || !Number.isInteger(excerpt.end) || excerpt.start < 0 || excerpt.end <= excerpt.start || excerpt.end > turn.text.length) {
      return { ok: false, reason: "span is outside the turn" };
    }
    const slice = turn.text.slice(excerpt.start, excerpt.end);
    const normalizedSlice = normalizeQuote(slice);
    const normalizedQuote = normalizeQuote(excerpt.quote);
    if (normalizedSlice !== normalizedQuote) {
      return { ok: false, reason: "quote does not match the span" };
    }
    if (digitRun(slice) !== digitRun(excerpt.quote)) {
      return { ok: false, reason: "quote changes a digit" };
    }
    const sliceNegations = tokens(slice).filter((token) => NEGATION_TOKENS.has(token));
    const quoteNegations = tokens(excerpt.quote).filter((token) => NEGATION_TOKENS.has(token));
    if (sliceNegations.join(" ") !== quoteNegations.join(" ")) {
      return { ok: false, reason: "quote drops or adds a negation" };
    }
    if (adjacentNegation(turn.text, excerpt.start, excerpt.end)) {
      return { ok: false, reason: "quote drops a negation" };
    }
    return { ok: true, reason: "quote matches the developer span" };
  }
}

function adjacentNegation(text: string, start: number, end: number): boolean {
  const prefix = text.slice(0, start).trimEnd();
  if (prefix.length > 0 && !/[.!;?]$/.test(prefix)) {
    const preceding = prefix.match(/[\p{L}\p{N}']+$/u)?.[0]?.toLowerCase() ?? null;
    if (preceding && NEGATION_TOKENS.has(preceding)) return true;
  }
  const suffix = text.slice(end).trimStart();
  if (suffix.length > 0 && !/^[.!;?]/.test(suffix)) {
    const following = suffix.match(/^[\p{L}\p{N}']+/u)?.[0]?.toLowerCase() ?? null;
    if (following && NEGATION_TOKENS.has(following)) return true;
  }
  return false;
}

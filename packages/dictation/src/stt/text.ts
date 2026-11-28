import { FILLER, MONTHS, NEGATIONS, QUANTIFIERS, UNITS, WEEKDAYS } from "./constants.js";
import type { CriticalSemanticClass, HypothesisToken, VocabularyLookup } from "./types.js";

export function asProbability(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return Math.min(1, Math.exp(value));
  if (value > 1) return 1;
  return value;
}

export function tokenKey(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function foldToken(text: string): string {
  return tokenKey(text).toLowerCase().replaceAll("’", "'");
}

export function renderTokens(tokens: readonly { text: string }[]): string {
  return tokens
    .map((token) => tokenKey(token.text))
    .filter((text) => text.length > 0)
    .join(" ");
}

export function isUnit(text: string): boolean {
  return UNITS.has(foldToken(text));
}

export function rmsOf(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) {
    const normalized = sample / 32_768;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / samples.length);
}

export function audioLevelFromRms(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  return Math.min(1, rms / 0.25);
}

const PRICE = /^\$\d+(?:[.,]\d+)?$/;
const TIME = /^\d{1,2}:\d{2}(?::\d{2})?$/;
const NUMBER = /^[+-]?\d+(?:[.,]\d+)?$/;

export function classifyToken(
  text: string,
  vocabulary: VocabularyLookup,
  hinted?: CriticalSemanticClass,
): CriticalSemanticClass | null {
  const display = tokenKey(text);
  if (display.length === 0) return null;
  const folded = foldToken(display);
  if (NEGATIONS.has(folded)) return "negation";
  if (QUANTIFIERS.has(folded)) return "quantifier";
  if (FILLER.has(folded) || isUnit(display)) return null;
  if (PRICE.test(display)) return "price";
  if (TIME.test(display)) return "time";
  if (WEEKDAYS.has(folded) || MONTHS.has(folded)) return "date";
  if (NUMBER.test(display)) return "number";
  if (hinted !== undefined) {
    if (hinted === "domain_identifier" && vocabularyKnows(vocabulary, display, folded)) return null;
    return hinted;
  }
  if (isDomainIdentifier(display, folded, vocabulary)) return "domain_identifier";
  return null;
}

function vocabularyKnows(vocabulary: VocabularyLookup, display: string, folded: string): boolean {
  return vocabulary.contains(display) || vocabulary.contains(folded);
}

function isDomainIdentifier(
  display: string,
  folded: string,
  vocabulary: VocabularyLookup,
): boolean {
  if (vocabularyKnows(vocabulary, display, folded) || FILLER.has(folded)) return false;
  if (/^[A-Z]{2,}[A-Za-z0-9]*$/.test(display)) return true;
  if (/^[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]+)+$/.test(display)) return true;
  if (/[A-Za-z]/.test(display) && /\d/.test(display)) return true;
  if (/^[A-Z][a-z]{2,}$/.test(display)) return true;
  return false;
}

export function normalizeHypothesis(token: HypothesisToken, index: number): HypothesisToken {
  const text = tokenKey(token.text);
  const base = {
    text,
    probability: asProbability(token.probability),
    startMs: token.startMs ?? index,
    endMs: token.endMs ?? index,
  };
  if (token.semanticClass === undefined) return base;
  return { ...base, semanticClass: token.semanticClass };
}

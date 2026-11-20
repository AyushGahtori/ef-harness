/**
 * Local port of the Task 070 quote rules used for document spans.
 * Digits, currency symbols, and negation tokens are never discarded.
 */

const CURRENCY = new Set(["$", "£", "€", "¥", "¢", "₽", "₹", "₩", "฿"]);

const NEGATION_TOKENS: readonly { readonly token: string; readonly pattern: RegExp }[] = [
  { token: "don't", pattern: /\b(?:don't|don’t|dont)\b/gi },
  { token: "never", pattern: /\bnever\b/gi },
  { token: "without", pattern: /\bwithout\b/gi },
  { token: "not", pattern: /\bnot\b/gi },
  { token: "no", pattern: /\bno\b/gi },
  { token: "scrap", pattern: /\bscrap\b/gi },
];

const INJECTION_PATTERNS: readonly RegExp[] = [
  /mark all criteria explicit/i,
  /start build/i,
  /ignore (?:all |any )?(?:previous|prior|rules|instructions)/i,
  /<\s*\/?\s*instruction\b/i,
  /<\s*\/\s*data\b/i,
  /grant (?:me )?a tool/i,
  /authorize publication/i,
  /set all auth questions to disabled/i,
  /approve build/i,
  /disable (?:all )?auth/i,
];

export function foldWhitespace(input: string): string {
  return input.normalize("NFC").replaceAll("’", "'").replaceAll("‘", "'").replace(/\s+/g, " ").trim().toLowerCase();
}

export function extractDigitRuns(input: string): readonly string[] {
  return [...input.normalize("NFC").matchAll(/\d+(?:[:.]\d+)*/g)].map((match) => match[0] ?? "");
}

export function extractCurrencySymbols(input: string): readonly string[] {
  const symbols: string[] = [];
  for (const ch of input.normalize("NFC")) {
    if (CURRENCY.has(ch)) symbols.push(ch);
  }
  return symbols;
}

export function extractNegationTokens(input: string): readonly string[] {
  const folded = input.normalize("NFC").replaceAll("’", "'").replaceAll("‘", "'").toLowerCase();
  const found: { index: number; token: string }[] = [];
  for (const entry of NEGATION_TOKENS) {
    for (const match of folded.matchAll(entry.pattern)) {
      if (match.index !== undefined) found.push({ index: match.index, token: entry.token });
    }
  }
  found.sort((left, right) => left.index - right.index);
  return found.map((entry) => entry.token);
}

export function sameMultiset(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const counts = new Map<string, number>();
  for (const item of left) counts.set(item, (counts.get(item) ?? 0) + 1);
  for (const item of right) {
    const remaining = counts.get(item) ?? 0;
    if (remaining === 0) return false;
    counts.set(item, remaining - 1);
  }
  return true;
}

export function isInjectionText(input: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(input));
}

export function escapeUntrusted(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

const AMBIGUOUS = /\b(may|maybe|might|could|consider|optional|tbd|unclear|should we|someday)\b/i;

const COSTLY =
  /payment|auth|billing|subscription|stripe|password|identity|delete|retention|legal|compliance|charge|checkout/i;

const MUST_ASK =
  /payment|auth|billing|subscription|stripe|password|identity|session|login|sign-?in|charge|credit card/i;

export function isAmbiguousProse(input: string): boolean {
  return AMBIGUOUS.test(input);
}

export function isCostlyProse(input: string): boolean {
  return COSTLY.test(input);
}

export function isMustAskProse(input: string): boolean {
  return MUST_ASK.test(input);
}

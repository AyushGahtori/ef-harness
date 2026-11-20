import type { MatchMode } from "./types.js";

const APOSTROPHES = new Set(["\u2018", "\u2019", "\u201A", "\u201B", "\u2032"]);
const QUOTES = new Set(["\u201C", "\u201D", "\u201E", "\u201F", "\u2033"]);
const SEPARATORS = new Set(["\u00B7", "-", "\u2013", "\u2014", "|"]);

/**
 * Exact, contains, and normalized text comparison.
 * Normalized mode folds whitespace, case, quotes, apostrophes, and separator punctuation.
 * Different words stay different: "Couldn't" is not "Could not".
 */
export class TextMatchNormalizer {
  normalize(value: string): string {
    let folded = "";
    for (const char of value) {
      if (APOSTROPHES.has(char)) {
        folded += "'";
        continue;
      }
      if (QUOTES.has(char)) {
        folded += '"';
        continue;
      }
      if (SEPARATORS.has(char)) {
        folded += "-";
        continue;
      }
      folded += char;
    }
    return folded.replace(/\s+/gu, " ").trim().toLowerCase();
  }

  matches(actual: string, expected: string, mode: MatchMode = "normalized"): boolean {
    if (mode === "exact") return actual === expected;
    const left = this.normalize(actual);
    const right = this.normalize(expected);
    if (mode === "contains") return left.includes(right);
    return left === right;
  }
}

export function redactVerbatim(message: string, secrets: readonly string[]): string {
  let next = message;
  const unique = [...new Set(secrets.filter((item) => item.trim().length > 0))].sort(
    (left, right) => right.length - left.length,
  );
  for (const secret of unique) {
    if (!next.includes(secret)) continue;
    next = next.split(secret).join("a hidden expectation");
  }
  return next;
}

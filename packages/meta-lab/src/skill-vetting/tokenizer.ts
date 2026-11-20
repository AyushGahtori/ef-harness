/**
 * Deterministic cl100k / o200k upper-bound estimate.
 *
 * The repo does not ship tiktoken. Counts are the max of the two public
 * pretoken patterns. ASCII pretokens cost ceil(bytes / 4) (at least 1).
 * Any non-ASCII pretoken costs its full UTF-8 byte length, so tag-block
 * scalars and bidi marks cannot hide inside a cheap ASCII merge.
 * The larger of the two pattern totals is the count the cap enforces.
 */

const CL100K_PATTERN =
  /'(?:[sSdDtT]|[lL][lL]|[vV][eE]|[rR][eE])|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;

const O200K_PATTERN =
  /[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]*[\p{Ll}\p{Lm}\p{Lo}\p{M}]+(?:'[sSdDtT]|'[lL][lL]|'[vV][eE]|'[rR][eE]|'[mM]|'[lL])?|[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]+[\p{Ll}\p{Lm}\p{Lo}\p{M}]*(?:'[sSdDtT]|'[lL][lL]|'[vV][eE]|'[rR][eE]|'[mM]|'[lL])?|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n/]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;

export const TOKENIZER_ID = "cl100k-o200k-upper-bound-v1" as const;

export const SKILL_TOKEN_CAP = 2000;
export const TASK_SKILL_COUNT_CAP = 2;
export const TASK_SKILL_TOKEN_CAP = 3500;

function pretokenCost(piece: string): number {
  if (piece.length === 0) return 0;
  let nonAscii = false;
  for (const char of piece) {
    const codePoint = char.codePointAt(0);
    if (codePoint !== undefined && codePoint > 0x7f) {
      nonAscii = true;
      break;
    }
  }
  const bytes = Buffer.byteLength(piece, "utf8");
  if (nonAscii) return bytes;
  return Math.max(1, Math.ceil(bytes / 4));
}

function splitPretokens(pattern: RegExp, text: string): readonly string[] {
  const expression = new RegExp(pattern.source, pattern.flags);
  const parts: string[] = [];
  let cursor = 0;
  for (const match of text.matchAll(expression)) {
    const index = match.index;
    const piece = match[0];
    if (index === undefined || piece.length === 0) break;
    if (index > cursor) parts.push(text.slice(cursor, index));
    parts.push(piece);
    cursor = index + piece.length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function estimate(pattern: RegExp, text: string): number {
  let total = 0;
  for (const piece of splitPretokens(pattern, text)) {
    total += pretokenCost(piece);
  }
  return total;
}

/** Upper bound across cl100k and o200k pretoken estimates. */
export function countSkillTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.max(estimate(CL100K_PATTERN, text), estimate(O200K_PATTERN, text));
}

/**
 * ASCII letter run whose upper-bound count is exactly `target`.
 * Used by the 2,001-token rejection fixture.
 */
export function asciiRunOfTokenCount(target: number): string {
  if (!Number.isInteger(target) || target < 1) {
    throw new Error(`token target must be a positive integer, received ${target}`);
  }
  const exact = target * 4;
  const candidate = "a".repeat(exact);
  const count = countSkillTokens(candidate);
  if (count === target) return candidate;
  for (let length = Math.max(1, exact - 8); length <= exact + 8; length += 1) {
    const text = "a".repeat(length);
    if (countSkillTokens(text) === target) return text;
  }
  throw new Error(`cannot materialize an ASCII run of ${target} tokens (nearest ${count})`);
}

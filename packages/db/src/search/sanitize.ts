const MAX_TOKENS = 32;
const MAX_TOKEN_CHARS = 64;
const MAX_NEEDLES = 8;

/**
 * Pull Unicode letter/number tokens out of arbitrary user text.
 * Quotes, operators, and punctuation never become FTS5 syntax.
 */
export function extractSearchTokens(input: string): string[] {
  const source = input.normalize("NFC");
  const tokens: string[] = [];
  for (const match of source.matchAll(/[\p{L}\p{N}]+/gu)) {
    const token = match[0];
    if (!token) continue;
    tokens.push(token.length > MAX_TOKEN_CHARS ? token.slice(0, MAX_TOKEN_CHARS) : token);
    if (tokens.length >= MAX_TOKENS) break;
  }
  return tokens;
}

/**
 * Convert arbitrary user or agent text into a safe FTS5 MATCH expression.
 * One- and two-character queries become a token prefix (`"a"*`), which trigram MATCH cannot serve.
 * Returns an empty string when the input has no searchable token; callers must not MATCH that.
 */
export function sanitizeFtsQuery(input: string): string {
  if (typeof input !== "string" || input.length === 0) return "";
  let tokens: string[];
  try {
    tokens = extractSearchTokens(input);
  } catch {
    return "";
  }
  if (tokens.length === 0) return "";
  const quoted = tokens.map((token) => `"${token.replaceAll('"', '""')}"`);
  const only = tokens[0];
  if (quoted.length === 1 && only && only.length <= 2) {
    return `${quoted[0]}*`;
  }
  return quoted.join(" AND ");
}

/**
 * Identifier fragments that should hit `kb_ident` (`C-01`, `C-014`, `SI-212`, `T07`).
 * Short fragments stay in the list; callers use bounded LIKE rather than trigram MATCH.
 */
export function extractIdentNeedles(input: string): string[] {
  if (typeof input !== "string") return [];
  const found: string[] = [];
  const push = (needle: string) => {
    const trimmed = needle.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_TOKEN_CHARS) return;
    if (found.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) return;
    if (found.length >= MAX_NEEDLES) return;
    found.push(trimmed);
  };
  for (const match of input.matchAll(/[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+/g)) {
    if (match[0]) push(match[0]);
  }
  for (const match of input.matchAll(/\b[A-Za-z]{1,8}\d{2,8}\b/g)) {
    if (match[0]) push(match[0]);
  }
  const trimmed = input.trim();
  if (
    trimmed.length >= 2 &&
    trimmed.length <= MAX_TOKEN_CHARS &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(trimmed) &&
    /[A-Za-z]/.test(trimmed) &&
    /\d/.test(trimmed)
  ) {
    push(trimmed);
  }
  return found;
}

/** Escape `%`, `_`, and `\` so a bound LIKE pattern stays literal. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

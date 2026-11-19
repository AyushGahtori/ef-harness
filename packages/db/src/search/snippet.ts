const ELLIPSIS = "…";

/** Compact highlighted window. The full node body is never returned. */
export function buildSnippet(
  title: string,
  body: string,
  tokens: readonly string[],
  maxChars: number,
): string {
  const cap = Math.max(16, maxChars);
  const usable = tokens.filter((token) => token.length > 0);
  const titleAt = findEarliest(title, usable);
  const bodyAt = titleAt >= 0 ? -1 : findEarliest(body, usable);
  const source = titleAt >= 0 ? title : bodyAt >= 0 ? body : title || body;
  const at = titleAt >= 0 ? titleAt : bodyAt >= 0 ? bodyAt : 0;
  const highlighted = highlight(windowAround(source, at, cap), usable);
  if (highlighted.length <= cap) return highlighted;
  return `${highlighted.slice(0, cap - 1)}${ELLIPSIS}`;
}

/** Rough token count so one search response cannot fill a worker context. */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function findEarliest(haystack: string, tokens: readonly string[]): number {
  if (haystack.length === 0) return -1;
  const lower = haystack.toLowerCase();
  let best = -1;
  for (const token of tokens) {
    if (token.length === 1 && tokens.some((other) => other.length > 2)) continue;
    const at = lower.indexOf(token.toLowerCase());
    if (at >= 0 && (best < 0 || at < best)) best = at;
  }
  return best;
}

function windowAround(source: string, at: number, maxChars: number): string {
  if (source.length <= maxChars) return source;
  const radius = Math.max(0, maxChars - 2);
  const start = Math.max(0, at - Math.floor(radius / 3));
  let slice = source.slice(start, start + radius);
  if (start > 0) slice = `${ELLIPSIS}${slice}`;
  if (start + radius < source.length) slice = `${slice}${ELLIPSIS}`;
  return slice;
}

function highlight(text: string, tokens: readonly string[]): string {
  const unique = [...new Set(tokens.map((token) => token.toLowerCase()))]
    .filter((token) => token.length > 1 || tokens.length === 1)
    .sort((left, right) => right.length - left.length);
  if (unique.length === 0) return text;
  const pattern = unique.map(escapeRegExp).join("|");
  return text.replace(new RegExp(pattern, "gi"), (match) => `«${match}»`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

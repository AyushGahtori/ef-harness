/** Whitespace token count. One word is one token, matching the planner's local budget port. */
export function countTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 0);
}

export function normalizeSearchConcept(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

export function snippetAround(prose: string, terms: readonly string[], maxChars = 180): string {
  const flat = prose.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const lower = flat.toLowerCase();
  let index = -1;
  for (const term of terms) {
    const found = lower.indexOf(term.toLowerCase());
    if (found >= 0 && (index < 0 || found < index)) index = found;
  }
  if (index < 0) return flat.slice(0, maxChars);
  const start = Math.max(0, index - 40);
  const slice = flat.slice(start, start + maxChars);
  return start > 0 ? slice : slice;
}

export function boundText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

export function uniqueSorted(tags: readonly string[]): string[] {
  const set = new Set<string>();
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (trimmed) set.add(trimmed);
  }
  return [...set].sort((left, right) => left.localeCompare(right));
}

export function tagSet(tags: readonly string[]): Set<string> {
  return new Set(uniqueSorted(tags));
}

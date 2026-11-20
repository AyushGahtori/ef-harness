export function globMatch(pattern: string, value: string): boolean {
  const placeholder = "\u0000";
  const body = pattern
    .replaceAll("*", placeholder)
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll(placeholder, ".*");
  return new RegExp(`^${body}$`).test(value);
}

export function matchesAnyPattern(patterns: readonly string[], value: string): boolean {
  return patterns.some((pattern) => globMatch(pattern, value));
}

export function scopeMatches(
  touches: readonly string[],
  scope: { readonly any: readonly string[]; readonly all: readonly string[] },
): boolean {
  if (scope.any.length === 0 && scope.all.length === 0) return false;
  const tags = new Set(touches);
  for (const tag of scope.all) {
    if (!tags.has(tag)) return false;
  }
  if (scope.any.length > 0 && !scope.any.some((tag) => tags.has(tag))) return false;
  return true;
}

export function cellMatches(
  subject: string,
  touches: readonly string[],
  patterns: readonly string[],
  scope: { readonly any: readonly string[]; readonly all: readonly string[] },
): boolean {
  return matchesAnyPattern(patterns, subject) && scopeMatches(touches, scope);
}

export function basisRank(basis: string): number {
  if (basis === "explicit") return 0;
  if (basis === "derived") return 1;
  if (basis === "delegated") return 2;
  return 3;
}

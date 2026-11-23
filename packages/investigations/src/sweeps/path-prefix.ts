import { REPO_WIDE_PREFIX } from "./types.js";

export function globToPathPrefix(glob: string): string {
  const normalized = glob.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized === "**" || normalized === "/**" || normalized === "repo_wide") {
    return REPO_WIDE_PREFIX;
  }
  const withoutStars = normalized.replace(/\*+$/u, "");
  return withoutStars.endsWith("/") ? withoutStars : `${withoutStars}/`;
}

export function normalizePrefixes(globs: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const glob of globs) {
    const prefix = globToPathPrefix(glob);
    if (seen.has(prefix)) continue;
    seen.add(prefix);
    out.push(prefix);
  }
  return Object.freeze(out.sort((a, b) => a.localeCompare(b)));
}

export function prefixesOverlap(a: string, b: string): boolean {
  if (a === REPO_WIDE_PREFIX || b === REPO_WIDE_PREFIX) return true;
  return a.startsWith(b) || b.startsWith(a);
}

export function pathOverlapsLease(pathPrefix: string, leasePrefixes: readonly string[]): boolean {
  return leasePrefixes.some((lease) => prefixesOverlap(pathPrefix, lease));
}

export function scopeToGlobs(scope: { readonly kind: "repo_wide" } | { readonly kind: "globs"; readonly globs: readonly string[] }): readonly string[] {
  if (scope.kind === "repo_wide") return ["**"];
  return scope.globs;
}
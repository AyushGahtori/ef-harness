import { POPULAR_PACKAGES } from "./popular-packages.js";
import type { TyposquatMatch } from "./types.js";

const DECORATIONS = new Set([
  "js",
  "ts",
  "jsx",
  "tsx",
  "node",
  "npm",
  "io",
  "lib",
  "api",
  "dev",
  "cli",
  "sdk",
  "core",
  "org",
  "app",
  "pkg",
]);

const HOMOGLYPHS: Readonly<Record<string, string>> = {
  "0": "o",
  "1": "l",
  "3": "e",
  "4": "a",
  "5": "s",
  "6": "g",
  "7": "t",
  "8": "b",
  "@": "a",
  $: "s",
  "|": "l",
  "!": "i",
  "\u0430": "a",
  "\u0435": "e",
  "\u043e": "o",
  "\u0440": "p",
  "\u0441": "c",
  "\u0443": "y",
  "\u0445": "x",
  "\u0456": "i",
  "\u03bf": "o",
  "\u03b1": "a",
};

interface PopularIndex {
  readonly exact: ReadonlySet<string>;
  readonly folded: ReadonlyMap<string, string>;
  readonly stripped: ReadonlyMap<string, string>;
}

const indexes = new WeakMap<readonly string[], PopularIndex>();

export function damerauLevenshtein(left: string, right: string): number {
  const m = left.length;
  const n = right.length;
  const gap = Math.abs(m - n);
  if (gap > 2) return gap;
  const width = n + 1;
  const dp = new Array<number>((m + 1) * width).fill(0);
  const at = (i: number, j: number): number => dp[i * width + j] ?? 0;
  const set = (i: number, j: number, value: number): void => {
    dp[i * width + j] = value;
  };
  for (let i = 0; i <= m; i += 1) set(i, 0, i);
  for (let j = 0; j <= n; j += 1) set(0, j, j);
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = left.charCodeAt(i - 1) === right.charCodeAt(j - 1) ? 0 : 1;
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (
        i > 1 &&
        j > 1 &&
        left.charCodeAt(i - 1) === right.charCodeAt(j - 2) &&
        left.charCodeAt(i - 2) === right.charCodeAt(j - 1)
      ) {
        best = Math.min(best, at(i - 2, j - 2) + 1);
      }
      set(i, j, best);
    }
  }
  return at(m, n);
}

function foldHomoglyphs(value: string): string {
  let folded = "";
  for (const char of value.normalize("NFKC").toLowerCase()) {
    folded += HOMOGLYPHS[char] ?? char;
  }
  return folded;
}

function stripDelimiters(value: string): string {
  return value.toLowerCase().replace(/[-_.]+/g, "");
}

function indexOf(packages: readonly string[]): PopularIndex {
  const cached = indexes.get(packages);
  if (cached) return cached;
  const exact = new Set<string>();
  const folded = new Map<string, string>();
  const stripped = new Map<string, string>();
  for (const name of packages) {
    exact.add(name);
    const foldedName = foldHomoglyphs(name);
    if (!folded.has(foldedName)) folded.set(foldedName, name);
    const strippedName = stripDelimiters(name);
    if (!stripped.has(strippedName)) stripped.set(strippedName, name);
  }
  const built = { exact, folded, stripped };
  indexes.set(packages, built);
  return built;
}

function maxDistance(length: number): number {
  if (length >= 6) return 2;
  if (length >= 4) return 1;
  return 0;
}

function commonPrefix(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let count = 0;
  while (count < limit && left.charCodeAt(count) === right.charCodeAt(count)) count += 1;
  return count;
}

function closerTyposquat(
  requested: string,
  candidate: { readonly name: string; readonly distance: number },
  current: { readonly name: string; readonly distance: number },
): boolean {
  if (candidate.distance !== current.distance) return candidate.distance < current.distance;
  const candidateGap = Math.abs(candidate.name.length - requested.length);
  const currentGap = Math.abs(current.name.length - requested.length);
  if (candidateGap !== currentGap) return candidateGap < currentGap;
  const candidatePrefix = commonPrefix(requested, candidate.name);
  const currentPrefix = commonPrefix(requested, current.name);
  if (candidatePrefix !== currentPrefix) return candidatePrefix > currentPrefix;
  const candidateIsPrefix = requested.startsWith(candidate.name);
  const currentIsPrefix = requested.startsWith(current.name);
  if (candidateIsPrefix !== currentIsPrefix) return candidateIsPrefix;
  return candidate.name.length > current.name.length;
}

function delimiterMatch(name: string, index: PopularIndex): string | null {
  const parts = name.toLowerCase().split(/[-_.]+/).filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1] ?? "";
    if (DECORATIONS.has(last)) {
      const prefix = parts.slice(0, -1).join("-");
      if (index.exact.has(prefix)) return prefix;
    }
  }
  const strippedName = stripDelimiters(name);
  const popular = index.stripped.get(strippedName);
  if (popular && popular.toLowerCase() !== name.toLowerCase() && strippedName !== name.toLowerCase()) {
    return popular;
  }
  return null;
}

/**
 * Flag lookalikes of the bundled popular npm/PyPI list.
 * Exact popular names are not typosquats. `@types/<popular>` is not scope confusion.
 */
export function checkTyposquat(
  packageName: string,
  popularPackages: readonly string[] = POPULAR_PACKAGES,
): TyposquatMatch | null {
  const requested = packageName.normalize("NFKC").trim();
  if (!requested) return null;
  const index = indexOf(popularPackages);
  if (index.exact.has(requested)) return null;

  const scoped = /^@([^/]+)\/(.+)$/.exec(requested);
  const scope = scoped?.[1] ?? null;
  const base = scoped?.[2] ?? requested;
  if (scope === "types" && index.exact.has(base)) return null;
  if (scope && scope !== "types" && index.exact.has(base) && !index.exact.has(requested)) {
    return { requested, similarTo: base, reason: "scope-confusion", distance: null };
  }

  const lower = base.toLowerCase();
  if (index.exact.has(lower) && lower !== base) {
    return { requested, similarTo: lower, reason: "homoglyph", distance: 0 };
  }

  const folded = foldHomoglyphs(base);
  const homoglyph = index.folded.get(folded);
  if (homoglyph && homoglyph.toLowerCase() !== base.toLowerCase()) {
    return { requested, similarTo: homoglyph, reason: "homoglyph", distance: null };
  }

  const delimiter = delimiterMatch(base, index);
  if (delimiter) {
    return { requested, similarTo: delimiter, reason: "delimiter", distance: null };
  }

  let best: { readonly name: string; readonly distance: number } | null = null;
  for (const popular of index.exact) {
    const popularName = popular.toLowerCase();
    const limit = maxDistance(popular.length);
    if (limit === 0) continue;
    if (Math.abs(popular.length - lower.length) > limit) continue;
    const distance = damerauLevenshtein(lower, popularName);
    if (distance === 0 || distance > limit) continue;
    if (!best || closerTyposquat(lower, { name: popular, distance }, best)) {
      best = { name: popular, distance };
    }
  }
  if (!best) return null;
  return { requested, similarTo: best.name, reason: "edit-distance", distance: best.distance };
}

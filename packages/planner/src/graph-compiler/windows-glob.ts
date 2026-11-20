import type { TargetPlatform } from "./types.js";

export interface NormalizedPattern {
  readonly original: string;
  readonly posix: string;
  readonly segments: readonly string[];
  readonly hasMeta: boolean;
  readonly broad: boolean;
}

export function foldAsciiCase(value: string): string {
  let folded = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    folded += code >= 65 && code <= 90 ? String.fromCodePoint(code + 32) : char;
  }
  return folded;
}

export function isBroadLeafWildcard(segments: readonly string[]): boolean {
  if (segments.length === 0) return false;
  const joined = segments.join("/");
  if (
    joined === "*" ||
    joined === "**" ||
    joined === "**/*" ||
    joined === "**/**" ||
    joined === "**/*/**"
  ) {
    return true;
  }
  const globstarAt = segments.indexOf("**");
  if (globstarAt === -1) return false;
  return globstarAt <= 1;
}

export function normalizeWritePattern(pattern: string, platform: TargetPlatform): NormalizedPattern {
  if (!pattern.includes("*") && !pattern.includes("\\") && !pattern.includes("..")) {
    const posix = platform === "windows" ? foldAsciiCase(pattern) : pattern;
    const segments = posix.split("/").filter((part) => part.length > 0 && part !== ".");
    return { original: pattern, posix: segments.join("/"), segments, hasMeta: false, broad: false };
  }
  const slashed = pattern.replaceAll("\\", "/").trim();
  const folded = platform === "windows" ? foldAsciiCase(slashed) : slashed;
  const segments: string[] = [];
  for (const part of folded.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return {
    original: pattern,
    posix: segments.join("/"),
    segments,
    hasMeta: segments.some((segment) => segment.includes("*")),
    broad: isBroadLeafWildcard(segments),
  };
}

function segmentOverlap(left: string, right: string): boolean {
  if (!left.includes("*") && !right.includes("*")) return left === right;
  const memo = new Map<string, boolean>();
  const walk = (i: number, j: number): boolean => {
    const key = `${i}:${j}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let result = false;
    if (i === left.length && j === right.length) {
      result = true;
    } else if (i < left.length && left[i] === "*") {
      result = walk(i + 1, j) || (j < right.length && walk(i, j + 1));
    } else if (j < right.length && right[j] === "*") {
      result = (i < left.length && walk(i + 1, j)) || walk(i, j + 1);
    } else if (i < left.length && j < right.length && left[i] === right[j]) {
      result = walk(i + 1, j + 1);
    }
    memo.set(key, result);
    return result;
  };
  return walk(0, 0);
}

export function patternsOverlap(left: readonly string[], right: readonly string[]): boolean {
  const memo = new Map<string, boolean>();
  const walk = (i: number, j: number): boolean => {
    const key = `${i}:${j}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let result = false;
    if (i === left.length && j === right.length) {
      result = true;
    } else if (i === left.length) {
      result = right.slice(j).every((segment) => segment === "**");
    } else if (j === right.length) {
      result = left.slice(i).every((segment) => segment === "**");
    } else {
      const a = left[i] ?? "";
      const b = right[j] ?? "";
      if (a === "**" && b === "**") {
        result = walk(i + 1, j) || walk(i, j + 1) || walk(i + 1, j + 1);
      } else if (a === "**") {
        result = walk(i + 1, j) || walk(i, j + 1);
      } else if (b === "**") {
        result = walk(i, j + 1) || walk(i + 1, j);
      } else if (segmentOverlap(a, b)) {
        result = walk(i + 1, j + 1);
      }
    }
    memo.set(key, result);
    return result;
  };
  return walk(0, 0);
}

export interface PatternHit {
  readonly left: NormalizedPattern;
  readonly right: NormalizedPattern;
}

export function firstPatternIntersection(
  left: readonly NormalizedPattern[],
  right: readonly NormalizedPattern[],
): PatternHit | null {
  for (const a of left) {
    for (const b of right) {
      if (!a.hasMeta && !b.hasMeta) {
        if (a.posix === b.posix && a.posix !== "") return { left: a, right: b };
        continue;
      }
      if (patternsOverlap(a.segments, b.segments)) return { left: a, right: b };
    }
  }
  return null;
}

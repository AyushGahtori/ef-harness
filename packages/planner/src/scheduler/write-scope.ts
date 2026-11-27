/**
 * Local stand-in for Task 092 `WriteScopeDisjointnessChecker` / `patternsOverlap`.
 * Windows ASCII case-folding and `**` / `*` containment, including
 * `src/api/**` ∩ `src/api/orders.ts` and `src/Order.ts` ∩ `src/order.ts`.
 */

function foldAsciiCase(value: string): string {
  let folded = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    folded += code >= 65 && code <= 90 ? String.fromCodePoint(code + 32) : char;
  }
  return folded;
}

export function normalizePattern(pattern: string): readonly string[] {
  const slashed = pattern.replaceAll("\\", "/").trim();
  const folded = foldAsciiCase(slashed);
  const segments: string[] = [];
  for (const part of folded.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments;
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

export function writeScopesOverlap(left: readonly string[], right: readonly string[]): boolean {
  if (left.length === 0 || right.length === 0) return true;
  const a = left.map((pattern) => normalizePattern(pattern));
  const b = right.map((pattern) => normalizePattern(pattern));
  for (const leftPattern of a) {
    for (const rightPattern of b) {
      if (leftPattern.length === 0 || rightPattern.length === 0) continue;
      const leftMeta = leftPattern.some((segment) => segment.includes("*"));
      const rightMeta = rightPattern.some((segment) => segment.includes("*"));
      if (!leftMeta && !rightMeta) {
        if (leftPattern.join("/") === rightPattern.join("/")) return true;
        continue;
      }
      if (patternsOverlap(leftPattern, rightPattern)) return true;
    }
  }
  return false;
}

export function scopeHitsLease(writeScope: readonly string[], prefixes: readonly string[]): boolean {
  for (const prefix of prefixes) {
    const normalized = prefix.replaceAll("\\", "/").trim();
    const asGlob = normalized.endsWith("/") ? `${normalized}**` : `${normalized}/**`;
    if (writeScopesOverlap(writeScope, [asGlob, normalized])) return true;
  }
  return false;
}

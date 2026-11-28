/**
 * Local range intersection. Swap for Task 046 `intersectRanges` when that package is on the branch.
 * Compatible ranges become one specifier. An empty intersection returns null.
 */

export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

type ComparatorOp = ">" | ">=" | "<" | "<=" | "=";

interface Comparator {
  readonly op: ComparatorOp;
  readonly version: SemVer;
}

interface Bounds {
  readonly lower: SemVer | null;
  readonly lowerInclusive: boolean;
  readonly upper: SemVer | null;
  readonly upperInclusive: boolean;
  readonly equal: SemVer | null;
}

const ANY: Bounds = {
  lower: null,
  lowerInclusive: false,
  upper: null,
  upperInclusive: false,
  equal: null,
};

export function compareVersions(left: SemVer, right: SemVer): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

export function formatVersion(version: SemVer): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function parseNumbers(token: string): { readonly version: SemVer; readonly count: 1 | 2 | 3 } | null {
  const cleaned = token.trim().replace(/^[vV]/, "");
  if (!/^\d+(?:\.\d+){0,2}$/.test(cleaned)) return null;
  const pieces = cleaned.split(".");
  const major = Number(pieces[0]);
  const minor = Number(pieces[1] ?? 0);
  const patch = Number(pieces[2] ?? 0);
  if (![major, minor, patch].every((value) => Number.isInteger(value))) return null;
  const count = pieces.length >= 3 ? 3 : pieces.length === 2 ? 2 : 1;
  return { version: { major, minor, patch }, count };
}

function caret(version: SemVer, count: 1 | 2 | 3): Comparator[] {
  const lower = { op: ">=" as const, version };
  if (version.major > 0) {
    return [lower, { op: "<", version: { major: version.major + 1, minor: 0, patch: 0 } }];
  }
  if (version.minor > 0) {
    return [lower, { op: "<", version: { major: 0, minor: version.minor + 1, patch: 0 } }];
  }
  if (count === 1) {
    return [lower, { op: "<", version: { major: 1, minor: 0, patch: 0 } }];
  }
  return [lower, { op: "<", version: { major: 0, minor: 0, patch: version.patch + 1 } }];
}

function tilde(version: SemVer, count: 1 | 2 | 3): Comparator[] {
  if (count === 1) {
    return [
      { op: ">=", version: { major: version.major, minor: 0, patch: 0 } },
      { op: "<", version: { major: version.major + 1, minor: 0, patch: 0 } },
    ];
  }
  return [
    { op: ">=", version },
    { op: "<", version: { major: version.major, minor: version.minor + 1, patch: 0 } },
  ];
}

function expandToken(token: string): Comparator[] | null {
  const raw = token.trim();
  if (raw === "*" || raw === "x" || raw === "X") return [];
  const op = /^(>=|<=|>|<|=)/.exec(raw);
  if (op?.[1]) {
    const parsed = parseNumbers(raw.slice(op[1].length));
    if (!parsed) return null;
    const operator = op[1];
    if (operator !== ">" && operator !== ">=" && operator !== "<" && operator !== "<=" && operator !== "=") {
      return null;
    }
    return [{ op: operator, version: parsed.version }];
  }
  if (raw.startsWith("^")) {
    const parsed = parseNumbers(raw.slice(1));
    if (!parsed) return null;
    return caret(parsed.version, parsed.count);
  }
  if (raw.startsWith("~>")) {
    const parsed = parseNumbers(raw.slice(2));
    if (!parsed) return null;
    return tilde(parsed.version, parsed.count);
  }
  if (raw.startsWith("~")) {
    const parsed = parseNumbers(raw.slice(1));
    if (!parsed) return null;
    return tilde(parsed.version, parsed.count);
  }
  const parsed = parseNumbers(raw);
  if (!parsed) return null;
  if (parsed.count < 3) return tilde(parsed.version, parsed.count);
  return [{ op: "=", version: parsed.version }];
}

function boundsFromComparators(comparators: readonly Comparator[]): Bounds | null {
  let lower: SemVer | null = null;
  let lowerInclusive = false;
  let upper: SemVer | null = null;
  let upperInclusive = false;
  let equal: SemVer | null = null;
  for (const comparator of comparators) {
    if (comparator.op === "=") {
      if (equal && compareVersions(equal, comparator.version) !== 0) return null;
      equal = comparator.version;
      continue;
    }
    if (comparator.op === ">" || comparator.op === ">=") {
      const inclusive = comparator.op === ">=";
      if (
        lower === null ||
        compareVersions(comparator.version, lower) > 0 ||
        (compareVersions(comparator.version, lower) === 0 && lowerInclusive && !inclusive)
      ) {
        lower = comparator.version;
        lowerInclusive = inclusive;
      }
      continue;
    }
    const inclusive = comparator.op === "<=";
    if (
      upper === null ||
      compareVersions(comparator.version, upper) < 0 ||
      (compareVersions(comparator.version, upper) === 0 && upperInclusive && !inclusive)
    ) {
      upper = comparator.version;
      upperInclusive = inclusive;
    }
  }
  if (equal) {
    if (lower && (compareVersions(equal, lower) < 0 || (compareVersions(equal, lower) === 0 && !lowerInclusive))) {
      return null;
    }
    if (upper && (compareVersions(equal, upper) > 0 || (compareVersions(equal, upper) === 0 && !upperInclusive))) {
      return null;
    }
    return { lower: equal, lowerInclusive: true, upper: equal, upperInclusive: true, equal };
  }
  if (lower && upper) {
    const cmp = compareVersions(lower, upper);
    if (cmp > 0 || (cmp === 0 && (!lowerInclusive || !upperInclusive))) return null;
  }
  return { lower, lowerInclusive, upper, upperInclusive, equal: null };
}

function clauseBounds(clause: string): Bounds | null {
  const expanded = clause.replace(/(\d+\.\d+\.\d+)\s+-\s+(\d+\.\d+\.\d+)/g, ">=$1 <=$2").trim();
  if (!expanded || expanded === "*") return ANY;
  const tokens = expanded.split(/\s+/).filter(Boolean);
  const comparators: Comparator[] = [];
  for (const token of tokens) {
    const expandedToken = expandToken(token);
    if (!expandedToken) return null;
    comparators.push(...expandedToken);
  }
  if (comparators.length === 0) return ANY;
  return boundsFromComparators(comparators);
}

export function parseRangeBounds(range: string): Bounds[] | null {
  const clauses = range
    .split("||")
    .map((part) => part.trim())
    .filter(Boolean);
  if (clauses.length === 0) return null;
  const bounds: Bounds[] = [];
  for (const clause of clauses) {
    const parsed = clauseBounds(clause);
    if (!parsed) return null;
    bounds.push(parsed);
  }
  return bounds;
}

function pickLower(left: Bounds, right: Bounds): { version: SemVer | null; inclusive: boolean } {
  if (!left.lower) return { version: right.lower, inclusive: right.lowerInclusive };
  if (!right.lower) return { version: left.lower, inclusive: left.lowerInclusive };
  const cmp = compareVersions(left.lower, right.lower);
  if (cmp > 0) return { version: left.lower, inclusive: left.lowerInclusive };
  if (cmp < 0) return { version: right.lower, inclusive: right.lowerInclusive };
  return { version: left.lower, inclusive: left.lowerInclusive && right.lowerInclusive };
}

function pickUpper(left: Bounds, right: Bounds): { version: SemVer | null; inclusive: boolean } {
  if (!left.upper) return { version: right.upper, inclusive: right.upperInclusive };
  if (!right.upper) return { version: left.upper, inclusive: left.upperInclusive };
  const cmp = compareVersions(left.upper, right.upper);
  if (cmp < 0) return { version: left.upper, inclusive: left.upperInclusive };
  if (cmp > 0) return { version: right.upper, inclusive: right.upperInclusive };
  return { version: left.upper, inclusive: left.upperInclusive && right.upperInclusive };
}

function intersectBounds(left: Bounds, right: Bounds): Bounds | null {
  if (left.equal && right.equal && compareVersions(left.equal, right.equal) !== 0) return null;
  const lower = pickLower(left, right);
  const upper = pickUpper(left, right);
  const equal = left.equal ?? right.equal;
  if (equal) {
    if (
      lower.version &&
      (compareVersions(equal, lower.version) < 0 || (compareVersions(equal, lower.version) === 0 && !lower.inclusive))
    ) {
      return null;
    }
    if (
      upper.version &&
      (compareVersions(equal, upper.version) > 0 || (compareVersions(equal, upper.version) === 0 && !upper.inclusive))
    ) {
      return null;
    }
    return { lower: equal, lowerInclusive: true, upper: equal, upperInclusive: true, equal };
  }
  if (lower.version && upper.version) {
    const cmp = compareVersions(lower.version, upper.version);
    if (cmp > 0 || (cmp === 0 && (!lower.inclusive || !upper.inclusive))) return null;
  }
  return {
    lower: lower.version,
    lowerInclusive: lower.inclusive,
    upper: upper.version,
    upperInclusive: upper.inclusive,
    equal: null,
  };
}

export function formatBounds(bounds: Bounds): string {
  if (bounds.equal) return formatVersion(bounds.equal);
  const { lower, upper } = bounds;
  if (lower && upper && bounds.lowerInclusive && !bounds.upperInclusive) {
    if (lower.major > 0 && upper.major === lower.major + 1 && upper.minor === 0 && upper.patch === 0) {
      return `^${formatVersion(lower)}`;
    }
    if (
      lower.major === 0 &&
      lower.minor > 0 &&
      upper.major === 0 &&
      upper.minor === lower.minor + 1 &&
      upper.patch === 0
    ) {
      return `^${formatVersion(lower)}`;
    }
    if (upper.major === lower.major && upper.minor === lower.minor + 1 && upper.patch === 0) {
      return `~${formatVersion(lower)}`;
    }
  }
  if (lower && upper && bounds.lowerInclusive && bounds.upperInclusive && compareVersions(lower, upper) === 0) {
    return formatVersion(lower);
  }
  const parts: string[] = [];
  if (lower) parts.push(`${bounds.lowerInclusive ? ">=" : ">"}${formatVersion(lower)}`);
  if (upper) parts.push(`${bounds.upperInclusive ? "<=" : "<"}${formatVersion(upper)}`);
  return parts.join(" ") || "*";
}

export function intersectRanges(left: string, right: string): string | null {
  if (left.trim() === right.trim()) return left.trim();
  if (/^(file:|link:|workspace:|catalog:)/.test(left) || /^(file:|link:|workspace:|catalog:)/.test(right)) {
    return null;
  }
  const a = parseRangeBounds(left);
  const b = parseRangeBounds(right);
  if (!a || !b) return null;
  const parts: string[] = [];
  for (const leftBounds of a) {
    for (const rightBounds of b) {
      const merged = intersectBounds(leftBounds, rightBounds);
      if (!merged) continue;
      const formatted = formatBounds(merged);
      if (!parts.includes(formatted)) parts.push(formatted);
    }
  }
  return parts.length > 0 ? parts.join(" || ") : null;
}

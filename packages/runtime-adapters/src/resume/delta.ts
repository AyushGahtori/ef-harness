import type { CompiledBrief, DeltaKind } from "./types.js";

/**
 * Local port of Task 115 `AdditiveVsContradictoryResumer.classifyDelta`.
 * Contradictory deltas never append onto a parked foreign session.
 */
export interface DeltaPinned {
  readonly sliceSha256: string;
  readonly briefText: string;
  readonly requirements: readonly string[];
}

export interface DeltaInspection {
  readonly kind: DeltaKind;
  readonly contradictedTokens: readonly string[];
}

const SWAP_PAIRS: readonly (readonly [string, string])[] = [
  ["rest", "graphql"],
  ["sqlite", "postgres"],
  ["11:00", "10:00"],
];

export class LocalAdditiveVsContradictoryResumer {
  inspect(pinned: DeltaPinned, next: CompiledBrief): DeltaInspection {
    const kind = classifyDelta(pinned, next);
    return {
      kind,
      contradictedTokens: kind === "contradictory" ? inferTokens(pinned.briefText, next) : [],
    };
  }
}

export function classifyDelta(pinned: DeltaPinned, next: CompiledBrief): DeltaKind {
  if (next.sliceSha256 === pinned.sliceSha256) return "none";
  if (next.changeKind === "contradictory") return "contradictory";
  if (removedRequirement(pinned.requirements, next.requirements)) return "contradictory";
  if (tokenSwap(pinned.briefText, next.text)) return "contradictory";
  if (next.changeKind === "additive") return "additive";
  if (isStrictExtension(pinned.briefText, pinned.requirements, next.text, next.requirements)) {
    return "additive";
  }
  return "contradictory";
}

function removedRequirement(before: readonly string[], after: readonly string[]): boolean {
  const next = new Set(after);
  return before.some((item) => !next.has(item));
}

function tokenSwap(before: string, after: string): boolean {
  const left = before.toLowerCase();
  const right = after.toLowerCase();
  return SWAP_PAIRS.some(([from, to]) => {
    const forward = left.includes(from) && right.includes(to) && !right.includes(from);
    const backward = left.includes(to) && right.includes(from) && !right.includes(to);
    return forward || backward;
  });
}

function isStrictExtension(
  beforeText: string,
  beforeRequirements: readonly string[],
  afterText: string,
  afterRequirements: readonly string[],
): boolean {
  if (!afterText.startsWith(beforeText)) return false;
  const next = new Set(afterRequirements);
  return beforeRequirements.every((item) => next.has(item));
}

function inferTokens(pinnedText: string, next: CompiledBrief): string[] {
  if (next.contradictedTokens.length > 0) return [...next.contradictedTokens];
  const left = pinnedText.toLowerCase();
  const right = next.text.toLowerCase();
  const found: string[] = [];
  for (const [from, to] of SWAP_PAIRS) {
    const forward = left.includes(from) && right.includes(to) && !right.includes(from);
    const backward = left.includes(to) && right.includes(from) && !right.includes(to);
    if (forward) found.push(from);
    if (backward) found.push(to);
  }
  return found;
}

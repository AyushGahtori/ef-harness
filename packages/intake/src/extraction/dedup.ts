import type { CanonicalClaim, InternalConflictCard } from "./types.js";

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "is", "are", "be", "every", "for"]);

export interface ClaimSignal {
  readonly topic: string;
  readonly value: string;
}

export function claimSignal(text: string): ClaimSignal | null {
  const time = /\b(\d{1,2}:\d{2})\s*(am|pm)?\b/i.exec(text);
  if (/cutoff|cut-off/i.test(text) && time?.[1]) {
    return { topic: "cutoff", value: `${time[1]}${(time[2] ?? "").toLowerCase()}` };
  }
  if (/guest checkout/i.test(text) && /allow/i.test(text)) return { topic: "checkout", value: "guest_allowed" };
  if (/account required/i.test(text)) return { topic: "checkout", value: "account_required" };
  return null;
}

function contentTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9:.\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0 && !STOP.has(token));
}

export function normalizeStatement(text: string): string {
  return contentTokens(text).join(" ");
}

function jaccard(left: readonly string[], right: readonly string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  if (union === 0) return 1;
  return intersection / union;
}

function sameStatement(left: CanonicalClaim, right: CanonicalClaim): boolean {
  if (left.kind !== right.kind) return false;
  const leftNorm = normalizeStatement(left.text);
  const rightNorm = normalizeStatement(right.text);
  if (leftNorm === rightNorm) return true;
  const leftSignal = claimSignal(left.text);
  const rightSignal = claimSignal(right.text);
  if (leftSignal && rightSignal && leftSignal.topic === rightSignal.topic && leftSignal.value !== rightSignal.value) {
    return false;
  }
  return jaccard(contentTokens(left.text), contentTokens(right.text)) >= 0.8;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values)];
}

/**
 * Merges restated claims onto one node and holds internal contradictions
 * so the later chunk cannot silently win.
 */
export function reconcileClaims(claims: readonly CanonicalClaim[]): {
  readonly canonical: readonly CanonicalClaim[];
  readonly conflicts: readonly InternalConflictCard[];
} {
  const conflictIds = new Set<string>();
  const conflicts: InternalConflictCard[] = [];
  const byTopic = new Map<string, CanonicalClaim[]>();
  for (const claim of claims) {
    const signal = claimSignal(claim.text);
    if (!signal) continue;
    const group = byTopic.get(signal.topic) ?? [];
    group.push(claim);
    byTopic.set(signal.topic, group);
  }
  let card = 0;
  for (const [topic, group] of byTopic) {
    const values = new Map<string, CanonicalClaim>();
    for (const claim of group) {
      const signal = claimSignal(claim.text);
      if (!signal) continue;
      if (!values.has(signal.value)) values.set(signal.value, claim);
    }
    if (values.size < 2) continue;
    const distinct = [...values.values()];
    const left = distinct[0];
    const right = distinct[1];
    if (!left || !right) continue;
    card += 1;
    for (const claim of group) conflictIds.add(claim.id);
    conflicts.push({
      id: `conflict-${card}`,
      topic,
      message: `${left.locatorLabel} says: ${left.quote} vs ${right.locatorLabel} says: ${right.quote}`,
      left: { quote: left.quote, locatorLabel: left.locatorLabel, page: left.pages[0] ?? null },
      right: { quote: right.quote, locatorLabel: right.locatorLabel, page: right.pages[0] ?? null },
      claimIds: group.map((claim) => claim.id),
      chunkIds: unique(group.flatMap((claim) => claim.chunkIds)),
    });
  }

  const remaining = claims.filter((claim) => !conflictIds.has(claim.id));
  const canonical: CanonicalClaim[] = [];
  for (const claim of remaining) {
    const match = canonical.find((existing) => sameStatement(existing, claim));
    if (!match) {
      canonical.push(claim);
      continue;
    }
    const index = canonical.indexOf(match);
    canonical[index] = {
      ...match,
      locatorLabels: unique([...match.locatorLabels, ...claim.locatorLabels]),
      pages: uniqueNumbers([...match.pages, ...claim.pages]),
      chunkIds: unique([...match.chunkIds, ...claim.chunkIds]),
    };
  }
  return { canonical, conflicts };
}

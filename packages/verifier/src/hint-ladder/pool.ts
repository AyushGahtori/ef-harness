import { HiddenPoolInvariantError } from "./errors.js";
import type { HiddenExample } from "./types.js";

export interface FreshExampleDraw {
  readonly example: HiddenExample;
  readonly synthesized: boolean;
  readonly sealedCheckIds: readonly string[];
}

export function drawFreshExample(input: {
  readonly pool: readonly HiddenExample[];
  readonly disclosedCheckIds: readonly string[];
  readonly failedCheckId: string;
  readonly synthesize: (sealedCheckIds: readonly string[]) => HiddenExample;
}): FreshExampleDraw {
  const disclosed = new Set(input.disclosedCheckIds);
  const seen = new Set<string>();
  const sealed: HiddenExample[] = [];
  for (const example of input.pool) {
    if (seen.has(example.checkId)) {
      throw new HiddenPoolInvariantError(`duplicate pool check ${example.checkId}`);
    }
    seen.add(example.checkId);
    if (!disclosed.has(example.checkId)) sealed.push(example);
  }
  if (sealed.length === 0) {
    throw new HiddenPoolInvariantError("no sealed hidden example remains to protect");
  }
  const sealedIds = sealed.map((example) => example.checkId);
  const spares = sealed.filter((example) => example.checkId !== input.failedCheckId);
  if (spares.length < 2) {
    const example = input.synthesize(sealedIds);
    if (disclosed.has(example.checkId) || sealedIds.includes(example.checkId)) {
      throw new HiddenPoolInvariantError("property generator returned a sealed check id");
    }
    return { example, synthesized: true, sealedCheckIds: sealedIds };
  }
  const chosen = spares[0];
  if (!chosen || chosen.checkId === input.failedCheckId) {
    throw new HiddenPoolInvariantError("refusing to disclose the failed hidden case");
  }
  const remaining = sealed.filter((example) => example.checkId !== chosen.checkId);
  const spareRemains = remaining.some((example) => example.checkId !== input.failedCheckId);
  const failedRemains =
    !sealedIds.includes(input.failedCheckId) ||
    remaining.some((example) => example.checkId === input.failedCheckId);
  if (!spareRemains || !failedRemains || remaining.length < 1) {
    throw new HiddenPoolInvariantError("disclosure would exhaust the hidden pool");
  }
  return {
    example: chosen,
    synthesized: false,
    sealedCheckIds: remaining.map((example) => example.checkId),
  };
}

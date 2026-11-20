import { citesExactPair, isConcreteCounterexample, parseContradictionCheckV1 } from "./schema.js";
import {
  MAX_SEMANTIC_PAIRS_PER_CALL,
  buildResolutionOptions,
  makeConflictId,
  type ConflictDraft,
  type MaterializedRequirement,
  type SemanticPair,
} from "./types.js";
import type { ContradictionCheckModel } from "./ports.js";

export interface SemanticSweepOptions {
  readonly onlyTouching?: string;
}

export interface SemanticSweepResult {
  readonly conflicts: readonly ConflictDraft[];
  readonly pairCount: number;
  readonly batchSizes: readonly number[];
  readonly rejectedUngrounded: number;
}

/**
 * Layer 5. Pairs requirements that share an entity or a touches tag, in batches of
 * at most 30, and keeps a conflict only when contradiction-check@1 cites that exact
 * pair and a concrete counterexample.
 */
export class SemanticPairConflictSweeper {
  constructor(private readonly model: ContradictionCheckModel) {}

  planPairs(requirements: readonly MaterializedRequirement[], options: SemanticSweepOptions = {}): SemanticPair[] {
    const active = requirements.filter((requirement) => requirement.status !== "superseded" && requirement.status !== "retired");
    const byId = new Map<string, MaterializedRequirement>();
    for (const requirement of active) byId.set(requirement.id, requirement);
    const buckets = new Map<string, string[]>();
    for (const requirement of active) {
      for (const entity of requirement.entities) addBucket(buckets, `entity:${entity}`, requirement.id);
      for (const tag of requirement.touches) addBucket(buckets, `tag:${tag}`, requirement.id);
    }
    const pairKeys = new Set<string>();
    for (const ids of buckets.values()) {
      const unique = [...new Set(ids)].sort();
      for (let i = 0; i < unique.length; i += 1) {
        for (let j = i + 1; j < unique.length; j += 1) {
          const left = unique[i];
          const right = unique[j];
          if (left === undefined || right === undefined) continue;
          pairKeys.add(`${left}|${right}`);
        }
      }
    }
    const touching = options.onlyTouching;
    const pairs: SemanticPair[] = [];
    for (const key of [...pairKeys].sort()) {
      const [leftId, rightId] = key.split("|");
      if (leftId === undefined || rightId === undefined) continue;
      if (touching !== undefined && !pairTouches(leftId, rightId, touching, byId)) continue;
      const left = byId.get(leftId);
      const right = byId.get(rightId);
      if (left === undefined || right === undefined) continue;
      pairs.push({
        leftId,
        rightId,
        leftText: left.text,
        rightText: right.text,
        leftBasis: left.basis,
        rightBasis: right.basis,
        leftQuote: left.quote ?? left.earsText,
        rightQuote: right.quote ?? right.earsText,
      });
    }
    return pairs;
  }

  sweep(requirements: readonly MaterializedRequirement[], options: SemanticSweepOptions = {}): SemanticSweepResult {
    const pairs = this.planPairs(requirements, options);
    const conflicts: ConflictDraft[] = [];
    const batchSizes: number[] = [];
    let rejectedUngrounded = 0;
    for (let offset = 0; offset < pairs.length; offset += MAX_SEMANTIC_PAIRS_PER_CALL) {
      const batch = pairs.slice(offset, offset + MAX_SEMANTIC_PAIRS_PER_CALL);
      batchSizes.push(batch.length);
      const raw = this.model.checkBatch(batch);
      for (let index = 0; index < batch.length; index += 1) {
        const pair = batch[index];
        if (pair === undefined) continue;
        const parsed = index < raw.length ? parseContradictionCheckV1(raw[index]) : null;
        const grounded = groundedConflict(parsed, pair);
        if (grounded === null) {
          if (parsed?.kind === "verdict" && parsed.verdict === "conflict") rejectedUngrounded += 1;
          else if (parsed === null && raw[index] !== undefined) rejectedUngrounded += 1;
          continue;
        }
        conflicts.push({
          id: makeConflictId(5, "contradiction-check@1", [pair.leftId, pair.rightId]),
          layer: 5,
          nodeIds: [pair.leftId, pair.rightId].sort(),
          ruleId: "contradiction-check@1",
          plainEnglishConflict: grounded.explanation,
          concreteCounterexample: grounded.counterexample,
          resolutionOptions:
            grounded.minimalChangeSuggestion === null
              ? buildResolutionOptions([pair.leftId, pair.rightId], [pair.leftBasis, pair.rightBasis])
              : [
                  grounded.minimalChangeSuggestion,
                  ...buildResolutionOptions([pair.leftId, pair.rightId], [pair.leftBasis, pair.rightBasis]),
                ],
        });
      }
    }
    return { conflicts, pairCount: pairs.length, batchSizes, rejectedUngrounded };
  }
}

function addBucket(buckets: Map<string, string[]>, key: string, id: string): void {
  const list = buckets.get(key);
  if (list === undefined) buckets.set(key, [id]);
  else list.push(id);
}

function pairTouches(
  leftId: string,
  rightId: string,
  touching: string,
  byId: ReadonlyMap<string, MaterializedRequirement>,
): boolean {
  if (leftId === touching || rightId === touching) return true;
  const left = byId.get(leftId);
  const right = byId.get(rightId);
  const leftSources = left?.sourceDecisionIds ?? [];
  const rightSources = right?.sourceDecisionIds ?? [];
  return leftSources.includes(touching) || rightSources.includes(touching);
}

function groundedConflict(
  parsed: ReturnType<typeof parseContradictionCheckV1>,
  pair: SemanticPair,
): { explanation: string; counterexample: string; minimalChangeSuggestion: string | null } | null {
  if (parsed === null || parsed.kind !== "verdict" || parsed.verdict !== "conflict") return null;
  if (!citesExactPair(parsed.citedNodeIds, pair.leftId, pair.rightId)) return null;
  if (!isConcreteCounterexample(parsed.counterexample)) return null;
  return {
    explanation: parsed.explanation,
    counterexample: parsed.counterexample,
    minimalChangeSuggestion: parsed.minimalChangeSuggestion,
  };
}

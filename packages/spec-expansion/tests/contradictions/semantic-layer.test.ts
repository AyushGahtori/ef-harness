import { describe, expect, it } from "vitest";
import {
  SemanticPairConflictSweeper,
  type ContradictionCheckModel,
  type MaterializedRequirement,
  type SemanticPair,
} from "../../src/contradictions/index.js";

function requirement(id: string, entity: string, tag?: string): MaterializedRequirement {
  return {
    id,
    text: `Requirement ${id} for ${entity}.`,
    earsText: `The system shall apply ${id}.`,
    entities: [entity],
    touches: tag === undefined ? [] : [tag],
    featureId: "feature",
    pass: 1,
    basis: "derived",
    status: "active",
    quote: `quote ${id}`,
  };
}

function compatibleModel(): ContradictionCheckModel {
  return {
    checkBatch(pairs) {
      return pairs.map(() => ({
        verdict: "compatible",
        explanation: "Both statements can hold for different records.",
        minimal_change_suggestion: null,
      }));
    },
  };
}

describe("semantic pair sweep", () => {
  it("buckets 400 requirements by entity instead of comparing every pair", () => {
    const requirements = Array.from({ length: 400 }, (_, index) => requirement(`R${String(index)}`, `e${String(index % 20)}`));
    const sweeper = new SemanticPairConflictSweeper(compatibleModel());
    const planned = sweeper.planPairs(requirements);
    const quadratic = (400 * 399) / 2;
    expect(planned).toHaveLength(3_800);
    expect(planned.length).toBeLessThan(quadratic);
    expect(planned.length).toBeLessThanOrEqual(400 * 20);
    const result = sweeper.sweep(requirements);
    expect(result.pairCount).toBe(3_800);
    expect(result.batchSizes.every((size) => size <= 30)).toBe(true);
    expect(result.batchSizes[0]).toBe(30);
    expect(result.batchSizes.at(-1)).toBe(20);
    expect(result.conflicts).toEqual([]);
  });

  it("limits an incremental sweep to pairs that touch the edited node", () => {
    const requirements = Array.from({ length: 20 }, (_, index) => requirement(`R${String(index)}`, "order"));
    const sweeper = new SemanticPairConflictSweeper(compatibleModel());
    expect(sweeper.planPairs(requirements)).toHaveLength(190);
    expect(sweeper.planPairs(requirements, { onlyTouching: "R0" })).toHaveLength(19);
  });

  it("rejects ungrounded tension, wrong ids, and extra keys", () => {
    const requirements = [requirement("left", "order"), requirement("right", "order")];
    const tension = new SemanticPairConflictSweeper({
      checkBatch: () => [{ verdict: "conflict", explanation: "tension", minimal_change_suggestion: null }],
    });
    const rejected = tension.sweep(requirements);
    expect(rejected.conflicts).toEqual([]);
    expect(rejected.rejectedUngrounded).toBe(1);

    const wrongIds = new SemanticPairConflictSweeper({
      checkBatch: () => [
        {
          verdict: "conflict",
          explanation: "These clauses disagree.",
          minimal_change_suggestion: "Drop one.",
          cited_node_ids: ["nope", "other"],
          counterexample: "When order 10 is submitted, both clauses fail.",
        },
      ],
    });
    expect(wrongIds.sweep(requirements).conflicts).toEqual([]);

    const extraKey = new SemanticPairConflictSweeper({
      checkBatch: () => [
        {
          verdict: "conflict",
          explanation: "These clauses disagree.",
          minimal_change_suggestion: null,
          cited_node_ids: ["left", "right"],
          counterexample: "When order 10 is submitted, both clauses fail.",
          bogus: true,
        },
      ],
    });
    expect(extraKey.sweep(requirements).conflicts).toEqual([]);
  });

  it("persists a grounded conflict and ignores compatible, unclear, and blocked replies", () => {
    const requirements = [requirement("left", "order", "printing"), requirement("right", "order", "printing")];
    const calls: SemanticPair[][] = [];
    const model: ContradictionCheckModel = {
      checkBatch(pairs) {
        calls.push([...pairs]);
        return pairs.map((pair) => ({
          verdict: "conflict",
          explanation: "Printing cannot be both required and forbidden for the same order.",
          minimal_change_suggestion: "Keep a single print rule.",
          cited_node_ids: [pair.leftId, pair.rightId],
          counterexample: 'When order "1001" is submitted, one rule prints a ticket and the other forbids it.',
        }));
      },
    };
    const grounded = new SemanticPairConflictSweeper(model).sweep(requirements);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(1);
    expect(grounded.conflicts).toHaveLength(1);
    expect(grounded.conflicts[0]?.nodeIds).toEqual(["left", "right"]);
    expect(grounded.conflicts[0]?.concreteCounterexample).toContain("1001");
    expect(grounded.conflicts[0]?.resolutionOptions[0]).toBe("Keep a single print rule.");

    const quiet = new SemanticPairConflictSweeper({
      checkBatch: () => [
        { verdict: "compatible", explanation: "Both can hold.", minimal_change_suggestion: null },
        { verdict: "unclear", explanation: "Only if the printer is optional.", minimal_change_suggestion: "Name the assumption." },
        { blocked: true, reason: "Need the order entity." },
      ],
    });
    const mixed = [requirement("a", "order"), requirement("b", "order"), requirement("c", "order")];
    expect(quiet.sweep(mixed).conflicts).toEqual([]);
  });
});

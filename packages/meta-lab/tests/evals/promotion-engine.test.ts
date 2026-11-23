import { describe, expect, it } from "vitest";
import { PairedStatisticalPromotionEngine } from "../../src/evals/index.js";
import type { PairedContinuousCase, PromotionDecisionInput } from "../../src/evals/index.js";

function paired(
  rows: Array<[string, boolean, boolean, number?, number?]>,
): PairedContinuousCase[] {
  return rows.map(([caseId, baselinePass, candidatePass, tokenBase = 1000, tokenCand = 1000]) => ({
    caseId,
    baselinePass,
    candidatePass,
    tokenCostBaseline: tokenBase,
    tokenCostCandidate: tokenCand,
    wallClockBaseline: tokenBase,
    wallClockCandidate: tokenCand,
  }));
}

function baseInput(
  cases: PairedContinuousCase[],
  overrides: Partial<PromotionDecisionInput> = {},
): PromotionDecisionInput {
  return {
    evalRunId: overrides.evalRunId ?? "eval-quality-7-0",
    baselineVersion: "active-v1",
    candidateVersion: "draft-v2",
    cases,
    vetoes: overrides.vetoes ?? {},
    ...overrides,
  };
}

describe("PairedStatisticalPromotionEngine", () => {
  const engine = new PairedStatisticalPromotionEngine();

  it("promotes quality win when b=7 and c=0", () => {
    const cases = paired(
      Array.from({ length: 7 }, (_, i) => [`w-${i}`, false, true, 1000, 1000]),
    );
    cases.push(...paired(Array.from({ length: 10 }, (_, i) => [`k-${i}`, true, true])));
    const decision = engine.decide(baseInput(cases));
    expect(decision.verdict).toBe("PROMOTE");
    expect(decision.mcnemar.b).toBe(7);
    expect(decision.mcnemar.c).toBe(0);
    expect(decision.mcnemar.exactPValue).toBeCloseTo(0.015625, 6);
  });

  it("returns NEED_MORE_SAMPLES for b=3,c=0", () => {
    const cases = paired([
      ["a", false, true],
      ["b", false, true],
      ["c", false, true],
      ["d", true, true],
    ]);
    const decision = engine.decide(baseInput(cases, { evalRunId: "eval-3-0" }));
    expect(decision.verdict).toBe("NEED_MORE_SAMPLES");
    expect(decision.mcnemar.exactPValue).toBe(0.25);
  });

  it("rejects symmetric discordant pairs b=2,c=2", () => {
    const cases = paired([
      ["a", false, true],
      ["b", false, true],
      ["c", true, false],
      ["d", true, false],
    ]);
    const decision = engine.decide(baseInput(cases, { evalRunId: "eval-2-2" }));
    expect(decision.verdict).toBe("REJECT");
    expect(decision.mcnemar.exactPValue).toBe(1);
  });

  it("promotes efficiency win at >=15% savings with zero regressions", () => {
    const cases = paired(
      Array.from({ length: 12 }, (_, i) => [`e-${i}`, true, true, 100, 78]),
    );
    const decision = engine.decide(baseInput(cases, { evalRunId: "efficiency-22pct" }));
    expect(decision.verdict).toBe("PROMOTE");
    expect(decision.mcnemar.b).toBe(0);
    expect(decision.mcnemar.c).toBe(0);
    expect(decision.bootstrap.tokenCostSavingsCi.lower).toBeGreaterThanOrEqual(0.15);
  });

  it("hard-vetoes red-team, contamination, schema, and paperwork", () => {
    const cases = paired([["a", false, true]]);
    for (const vetoes of [
      { redTeamFailures: 1 },
      { contaminationFlags: 1 },
      { schemaViolations: 1 },
      { paperworkPct: 0.21 },
    ]) {
      const decision = engine.decide(baseInput(cases, { vetoes }));
      expect(decision.verdict).toBe("REJECT");
      expect(decision.vetoesTriggered.length).toBeGreaterThan(0);
    }
  });
});
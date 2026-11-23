import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_RESAMPLES,
  exactMcNemarPValue,
  McNemarAndBootstrapCalculator,
} from "../../src/evals/index.js";
import type { PairedContinuousCase } from "../../src/evals/index.js";

function caseRow(
  id: string,
  base: boolean,
  cand: boolean,
  tokenBase = 100,
  tokenCand = 100,
): PairedContinuousCase {
  return {
    caseId: id,
    baselinePass: base,
    candidatePass: cand,
    tokenCostBaseline: tokenBase,
    tokenCostCandidate: tokenCand,
    wallClockBaseline: tokenBase * 10,
    wallClockCandidate: tokenCand * 10,
  };
}

describe("exact McNemar p-values", () => {
  it("matches known analytical tables", () => {
    expect(exactMcNemarPValue(7, 0).exactPValue).toBe(0.015625);
    expect(exactMcNemarPValue(3, 0).exactPValue).toBe(0.25);
    expect(exactMcNemarPValue(2, 2).exactPValue).toBe(1);
  });
});

describe("bootstrap CI reproducibility", () => {
  it(`reproduces identical bounds with B=${BOOTSTRAP_RESAMPLES}`, () => {
    const cases = Array.from({ length: 20 }, (_, i) =>
      caseRow(`c-${i}`, true, true, 100, 78),
    );
    const calc = new McNemarAndBootstrapCalculator();
    const first = calc.computeBootstrap(cases, "paired-run-abc");
    const second = calc.computeBootstrap(cases, "paired-run-abc");
    expect(first.tokenCostSavingsCi).toEqual(second.tokenCostSavingsCi);
    expect(first.wallClockSavingsCi).toEqual(second.wallClockSavingsCi);
    expect(first.resamples).toBe(10_000);
  });
});
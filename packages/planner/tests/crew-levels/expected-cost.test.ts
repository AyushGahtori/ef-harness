import { describe, expect, it } from "vitest";
import {
  CrewLevelsError,
  cascadeExpectedCost,
  compareExpectedCost,
  formatMicroUsd,
  levelExpectedCost,
  probabilityMicro,
  sameLevelRetryCost,
} from "../../src/crew-levels/index.js";

describe("expected cost", () => {
  it("evaluates the published Junior and Mid crossover in integer micro-USD", () => {
    const juniorPass = probabilityMicro(0.2);
    const midPass = probabilityMicro(0.88);
    const escalation = 150_000n;
    expect(cascadeExpectedCost(20_000n, juniorPass, escalation)).toBe(140_000n);
    expect(cascadeExpectedCost(80_000n, midPass, escalation)).toBe(98_000n);
    expect(sameLevelRetryCost(20_000n, juniorPass)).toBe(100_000n);
    expect(sameLevelRetryCost(80_000n, midPass)).toBe(90_909n);
    expect(140_000n).toBeGreaterThan(98_000n);
    expect(20_000n).toBeLessThan(80_000n);
    expect(formatMicroUsd(98_000n)).toBe("$0.098");
    expect(formatMicroUsd(180_000n)).toBe("$0.18");
  });

  it("adds the next level's unit price on top of cost divided by pass probability", () => {
    const pass = probabilityMicro(0.2);
    expect(levelExpectedCost(20_000n, pass, 80_000n)).toBe(164_000n);
    expect(levelExpectedCost(20_000n, pass, null)).toBe(100_000n);
  });

  it("refuses to compare micro-USD with ppm or to divide by a zero pass rate", () => {
    expect(() =>
      compareExpectedCost(
        { currency: "micro-usd", amount: 50_000n },
        { currency: "ppm", amount: 500n },
      ),
    ).toThrow(CrewLevelsError);
    expect(() => probabilityMicro(0)).toThrow(CrewLevelsError);
    expect(() => sameLevelRetryCost(1n, 0n)).toThrow(CrewLevelsError);
  });
});

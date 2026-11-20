import { describe, expect, it } from "vitest";
import {
  PropertyCheckRunner,
  roundHalfAwayFromZero,
  type PropertyCheckRequest,
  type QuantityLine,
} from "../../src/advanced/index.js";

describe("PropertyCheckRunner", () => {
  const runner = new PropertyCheckRunner();

  it("catches a broken X-04 money rounding function, shrinks it, and replays the saved seed", () => {
    const request: PropertyCheckRequest = {
      checkId: "money-x-04",
      seed: 11,
      numRuns: 40,
      bounds: { minValue: 0, maxValue: 400, minDenominator: 1, maxDenominator: 20 },
      examples: [[41, 2]],
      subject: {
        invariant: "integer_minor_unit_money_rounding",
        roundMinor: (numerator, denominator) => Math.trunc(numerator / denominator),
      },
    };
    const receipt = runner.run(request);
    expect(receipt.passed).toBe(false);
    expect(receipt.ruleId).toBe("X-04");
    expect(receipt.seed).toBe(11);
    expect(receipt.path).toEqual(expect.any(String));
    expect(receipt.numShrinks).toBeGreaterThan(0);
    expect(receipt.counterexample).toEqual(expect.any(Array));
    const pair = receipt.counterexample as [number, number];
    expect(Math.trunc(pair[0] / pair[1])).not.toBe(roundHalfAwayFromZero(pair[0], pair[1]));
    const replay = runner.reproduce(request, receipt);
    expect(replay.counterexample).toEqual(receipt.counterexample);
    expect(replay.seed).toBe(receipt.seed);
    expect(replay.path).toBe(receipt.path);
  });

  it("accepts the integer half-away-from-zero rounding rule", () => {
    const receipt = runner.run({
      checkId: "money-x-04-sound",
      seed: 3,
      numRuns: 30,
      subject: {
        invariant: "integer_minor_unit_money_rounding",
        roundMinor: roundHalfAwayFromZero,
      },
    });
    expect(receipt.passed).toBe(true);
    expect(receipt.seed).toBe(3);
    expect(receipt.path).toBeNull();
    expect(receipt.counterexample).toBeNull();
  });

  it("shrinks a 500-element conservation failure to the minimal two-line counterexample", () => {
    const big = Array.from({ length: 500 }, (_, index) => ({
      label: "A",
      quantity: index === 10 ? 0 : index === 11 ? 4 : 2,
    }));
    const request: PropertyCheckRequest = {
      checkId: "conservation",
      seed: 7,
      numRuns: 5,
      bounds: { minLength: 0, maxLength: 500, minQuantity: 0, maxQuantity: 12, labels: ["A"] },
      examples: [big],
      subject: {
        invariant: "conservation_of_totals",
        total: brokenTotal,
      },
    };
    const receipt = runner.run(request);
    expect(receipt.passed).toBe(false);
    expect(receipt.initialFailureSize).toBe(500);
    expect(receipt.numShrinks).toBeGreaterThan(0);
    expect(receipt.counterexample).toEqual([
      { label: "A", quantity: 0 },
      { label: "A", quantity: 1 },
    ]);
    expect(receipt.seed).toBe(7);
    expect(typeof receipt.path).toBe("string");
    const replay = runner.reproduce(request, receipt);
    expect(replay.counterexample).toEqual(receipt.counterexample);
    expect(replay.path).toBe(receipt.path);
  });

  it("passes conservation, idempotence, and stable sort when the subject honors them", () => {
    expect(
      runner.run({
        checkId: "conservation-sound",
        seed: 4,
        numRuns: 20,
        subject: {
          invariant: "conservation_of_totals",
          total: (lines) => lines.reduce((sum, line) => sum + line.quantity, 0),
        },
      }).passed,
    ).toBe(true);
    expect(
      runner.run({
        checkId: "idempotent-sound",
        seed: 4,
        numRuns: 20,
        subject: { invariant: "idempotence", apply: (value) => value },
      }).passed,
    ).toBe(true);
    expect(
      runner.run({
        checkId: "sort-sound",
        seed: 4,
        numRuns: 20,
        subject: { invariant: "sort_order_preservation", sort: orderedCopy },
      }).passed,
    ).toBe(true);
  });

  it("replays broken idempotence and sort-order failures from the saved seed", () => {
    const idempotent = runner.run({
      checkId: "idempotent-broken",
      seed: 9,
      numRuns: 15,
      subject: { invariant: "idempotence", apply: (value) => value + 1 },
    });
    expect(idempotent.passed).toBe(false);
    expect(runner.reproduce({
      checkId: "idempotent-broken",
      seed: 9,
      numRuns: 15,
      subject: { invariant: "idempotence", apply: (value) => value + 1 },
    }, idempotent).counterexample).toEqual(idempotent.counterexample);

    const sorted = runner.run({
      checkId: "sort-broken",
      seed: 6,
      numRuns: 20,
      subject: {
        invariant: "sort_order_preservation",
        sort: (items) => orderedCopy(items.filter((item) => item.quantity !== 0)),
      },
    });
    expect(sorted.passed).toBe(false);
    expect(sorted.path).toEqual(expect.any(String));
    expect(runner.reproduce({
      checkId: "sort-broken",
      seed: 6,
      numRuns: 20,
      subject: {
        invariant: "sort_order_preservation",
        sort: (items) => orderedCopy(items.filter((item) => item.quantity !== 0)),
      },
    }, sorted).counterexample).toEqual(sorted.counterexample);
  });
});

function brokenTotal(lines: readonly QuantityLine[]): number {
  let sum = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) break;
    if (line.quantity === 0) {
      index += 1;
      continue;
    }
    sum += line.quantity;
  }
  return sum;
}

function orderedCopy(items: readonly QuantityLine[]): QuantityLine[] {
  return [...items].sort((left, right) => left.label.localeCompare(right.label) || left.quantity - right.quantity);
}

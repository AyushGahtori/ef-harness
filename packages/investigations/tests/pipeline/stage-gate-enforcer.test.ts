import { describe, expect, it } from "vitest";
import {
  PermanentTestsIncompleteError,
  ProductionEditsForbiddenBeforeReproError,
  ReproMustFailOnBaseError,
  ScratchInstrumentationLeakError,
} from "../../src/pipeline/errors.js";
import { StageGateEnforcer } from "../../src/pipeline/stage-gate-enforcer.js";
import type { PermanentTestSpec, RedBeforeGreenResult } from "../../src/pipeline/types.js";
import { failRun, passRun } from "./helpers.js";

describe("StageGateEnforcer", () => {
  const gates = new StageGateEnforcer();

  it("hard-blocks production src writes during CLEAN_REPRO", () => {
    expect(() =>
      gates.assertWriteAllowed("CLEAN_REPRO", { path: "src/orders/cutoff.ts" }),
    ).toThrow(ProductionEditsForbiddenBeforeReproError);
    expect(() =>
      gates.assertWriteAllowed("CLEAN_REPRO", {
        path: "tests/repro/bug-182-timezone.test.ts",
      }),
    ).not.toThrow();
  });

  it("rejects passing-on-base bogus repros", () => {
    expect(() => gates.assertBaselineReproFailure(passRun(), "ERR-TZ")).toThrow(
      ReproMustFailOnBaseError,
    );
    expect(() =>
      gates.assertBaselineReproFailure(failRun("WRONG"), "ERR-TZ"),
    ).toThrow(ReproMustFailOnBaseError);
    expect(() =>
      gates.assertBaselineReproFailure(failRun("ERR-TZ"), "ERR-TZ"),
    ).not.toThrow();
  });

  it("guarantees zero Stage-3 debug logs survive into Stage 5", () => {
    expect(() =>
      gates.assertScratchDiscarded(
        ["console.log('[DEBUG-99]', payload)"],
        ["export const fixed = true;\nconsole.log('[DEBUG-99]', payload);"],
      ),
    ).toThrow(ScratchInstrumentationLeakError);
    expect(() =>
      gates.assertScratchDiscarded(
        ["console.log('[DEBUG-99]', payload)"],
        ["export const fixed = true;"],
      ),
    ).not.toThrow();
  });

  it("enforces permanent repro and mechanism red-before-green", () => {
    const tests: PermanentTestSpec = {
      reproTestPath: "tests/repro/tz.test.ts",
      mechanismTestPath: "tests/unit/cutoff-boundary.test.ts",
    };
    const bad: RedBeforeGreenResult = {
      reproFailsOnBase: false,
      mechanismFailsOnBase: true,
      reproPassesOnFix: true,
      mechanismPassesOnFix: true,
    };
    expect(() => gates.assertPermanentTestsComplete(tests, bad, [])).toThrow(
      PermanentTestsIncompleteError,
    );
    const good: RedBeforeGreenResult = {
      reproFailsOnBase: true,
      mechanismFailsOnBase: true,
      reproPassesOnFix: true,
      mechanismPassesOnFix: true,
    };
    expect(() => gates.assertPermanentTestsComplete(tests, good, [])).not.toThrow();
  });
});
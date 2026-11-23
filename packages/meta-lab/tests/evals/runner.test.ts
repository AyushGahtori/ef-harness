import { describe, expect, it } from "vitest";
import {
  createMockEvalDependencies,
  runMetaLabEvalCli,
  ThreeLevelEvalRunner,
} from "../../src/evals/index.js";

describe("ThreeLevelEvalRunner", () => {
  it("aborts level 1 on futility gate", () => {
    const deps = createMockEvalDependencies("batch-resolve@2-futility");
    const runner = new ThreeLevelEvalRunner(deps);
    const result = runner.run({
      candidateId: "batch-resolve@2-futility",
      level: 1,
      evalRunId: "futility-run",
      suiteDigest: deps.registry.suiteDigest,
      split: "dev",
    });
    expect(result.abortedEarly).toBe(true);
    expect(result.baselinePassRate).toBe(0.96);
    expect(result.candidatePassRate).toBe(0.78);
  });

  it("runs level 2 with mocked cache and sim-dev ports", () => {
    const deps = createMockEvalDependencies("candidate-v2");
    const runner = new ThreeLevelEvalRunner(deps);
    const result = runner.run({
      candidateId: "candidate-v2",
      level: 2,
      evalRunId: "level2-run",
      suiteDigest: deps.registry.suiteDigest,
      split: "dev",
    });
    expect(result.abortedEarly).toBe(false);
    expect(result.report.level).toBe(2);
    expect(deps.cache.get("component-discovery-1:candidate-v2")).toBeDefined();
  });
});

describe("runMetaLabEvalCli", () => {
  it("returns semantic exit codes", () => {
    const out = runMetaLabEvalCli({ candidateId: "candidate-v2", level: 2, evalRunId: "cli-1" });
    expect([0, 1, 2]).toContain(out.exitCode);
    expect(out.summary.length).toBeGreaterThan(0);
  });
});
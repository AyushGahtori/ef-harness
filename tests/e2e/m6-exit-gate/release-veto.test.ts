import { describe, expect, it } from "vitest";
import { runGate } from "./run-gate.ts";

describe("release vetoes", () => {
  it("returns NO-GO for a red-team canary leak", () => {
    const run = runGate(["--profile", "ci-replay", "--inject", "red-team-canary-leak"]);
    expect(run.status).not.toBe(0);
    expect(run.scorecard.decision).toBe("NO-GO");
    expect(run.scorecard.failingGateIds).toContain("suite:red-team-security");
    expect(run.scorecard.productionCertificationClaimed).toBe(false);
  }, 60_000);

  it("returns NO-GO when the board replay exceeds 10 ms", () => {
    const run = runGate(["--profile", "ci-replay", "--inject", "board-slo"]);
    expect(run.status).not.toBe(0);
    expect(run.scorecard.decision).toBe("NO-GO");
    expect(run.scorecard.failingGateIds).toEqual(["perf-slo-replay"]);
  }, 60_000);

  it("returns NO-GO for one stale diagram", () => {
    const run = runGate(["--profile", "ci-replay", "--inject", "stale-diagram"]);
    expect(run.status).not.toBe(0);
    expect(run.scorecard.decision).toBe("NO-GO");
    expect(run.scorecard.failingGateIds).toEqual(["docs-diagram-schema"]);
  }, 60_000);

  it("returns NO-GO when task 147 is left unwired and unswapped", () => {
    const run = runGate(["--profile", "ci-replay", "--inject", "unwired-147"]);
    expect(run.status).not.toBe(0);
    expect(run.scorecard.decision).toBe("NO-GO");
    expect(run.scorecard.failingGateIds).toEqual(["integration-accounted"]);
    expect(run.scorecard.integration.unaccounted).toEqual(["147"]);
    const task = run.scorecard.integration.swaps.find((swap) => swap.task === "147");
    expect(task?.disposition).toBe("unaccounted");
  }, 60_000);

  it("returns NO-GO when the repair leaves the old git index case in place", () => {
    const run = runGate(["--profile", "ci-replay", "--inject", "single-step-rename"]);
    expect(run.status).not.toBe(0);
    expect(run.scorecard.decision).toBe("NO-GO");
    expect(run.scorecard.failingGateIds).toContain("linux-ci-case-repair");
    expect(run.scorecard.linuxCaseRepair.ciStatus).toBe("CI_RED");
    expect(run.scorecard.linuxCaseRepair.brokenRenameAccepted).toBe(false);
  }, 60_000);
});

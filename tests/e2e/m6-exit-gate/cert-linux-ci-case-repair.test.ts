import { describe, expect, it } from "vitest";
import { runGate } from "./run-gate.ts";

describe("linux CI case-sensitivity auto-repair", () => {
  const run = runGate(["--profile", "ci-replay"]);

  it("turns TS2307 into one approved repair push and CI_GREEN", () => {
    const repair = run.scorecard.linuxCaseRepair;
    expect(repair.classification).toBe("class-2");
    expect(repair.localWindowsVerification).toBe("PASS");
    expect(repair.linuxBefore).toBe("TS2307");
    expect(repair.ciStatus).toBe("CI_GREEN");
    expect(repair.repairPushes).toBe(1);
    expect(repair.pushCap).toBe(3);
    expect(repair.fourthPushRejected).toBe(true);
    expect(repair.ledgerApproved).toBe(true);
    expect(repair.repairStrategy).toBe("two-step-git-mv");
    expect(repair.appliedRepairIndexCase).toBe("src/header.tsx");
    expect(repair.twoStepIndexCase).toBe("src/header.tsx");
  });

  it("rejects a case-only rename that leaves the git index unchanged", () => {
    const repair = run.scorecard.linuxCaseRepair;
    expect(repair.brokenIndexCase).toBe("src/Header.tsx");
    expect(repair.brokenRenameAccepted).toBe(false);
  });

  it("records whether a single git mv changed the index", () => {
    expect(run.scorecard.linuxCaseRepair.singleStepGitMvIndexCase.length).toBeGreaterThan(0);
    expect(typeof run.scorecard.linuxCaseRepair.gitMvSingleStepChangedIndex).toBe("boolean");
  });
});

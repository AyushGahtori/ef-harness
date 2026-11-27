import { describe, expect, it } from "vitest";
import { verifyFeatureDoneConditions } from "../../src/feature-integrator/index.js";
import type { FeatureDoneEvidenceInput } from "../../src/feature-integrator/index.js";

function ready(): FeatureDoneEvidenceInput {
  return {
    tasks: [
      {
        id: "T-Menu",
        state: "MERGED_TO_FEATURE",
        briefVersion: 1,
        currentBriefVersion: 1,
        contractVersion: 1,
        currentContractVersion: 1,
      },
    ],
    requirements: [{ id: "R-Menu", checkStatus: "pass", waiverApproved: false }],
    staticAuditClean: true,
    journeyPassedInCleanEnv: true,
    mergedOntoIntegration: true,
    earlierDoneRegressionsPassed: true,
    hasScreens: true,
    accessibilityClean: true,
    layoutClean: true,
    openContractChangeRequestIds: [],
  };
}

describe("7-condition feature DONE gate", () => {
  it("passes only when every condition holds", () => {
    expect(verifyFeatureDoneConditions(ready())).toEqual({ ok: true, failedConditions: [] });
  });

  it("refuses each condition on its own", () => {
    const cases: { id: "1" | "2" | "3" | "4" | "5" | "6" | "7"; evidence: FeatureDoneEvidenceInput }[] = [
      {
        id: "1",
        evidence: {
          ...ready(),
          tasks: [{ ...ready().tasks[0]!, state: "ACCEPTED" }],
        },
      },
      {
        id: "2",
        evidence: {
          ...ready(),
          requirements: [{ id: "R-Menu", checkStatus: "fail", waiverApproved: false }],
        },
      },
      { id: "3", evidence: { ...ready(), staticAuditClean: false } },
      { id: "4", evidence: { ...ready(), journeyPassedInCleanEnv: false } },
      { id: "5", evidence: { ...ready(), mergedOntoIntegration: false } },
      { id: "6", evidence: { ...ready(), accessibilityClean: false } },
      { id: "7", evidence: { ...ready(), openContractChangeRequestIds: ["CCR-1"] } },
    ];
    for (const item of cases) {
      const result = verifyFeatureDoneConditions(item.evidence);
      expect(result.ok).toBe(false);
      expect(result.failedConditions).toContain(item.id);
    }
  });

  it("treats skip and missing as requirement failures unless a waiver is approved", () => {
    expect(
      verifyFeatureDoneConditions({
        ...ready(),
        requirements: [{ id: "R-Menu", checkStatus: "skip", waiverApproved: false }],
      }).failedConditions,
    ).toContain("2");
    expect(
      verifyFeatureDoneConditions({
        ...ready(),
        requirements: [{ id: "R-Menu", checkStatus: "missing", waiverApproved: false }],
      }).failedConditions,
    ).toContain("2");
    expect(
      verifyFeatureDoneConditions({
        ...ready(),
        requirements: [{ id: "R-Menu", checkStatus: "fail", waiverApproved: true }],
      }).ok,
    ).toBe(true);
  });

  it("does not apply the screen accessibility condition to a backend feature", () => {
    expect(
      verifyFeatureDoneConditions({
        ...ready(),
        hasScreens: false,
        accessibilityClean: false,
        layoutClean: false,
      }).ok,
    ).toBe(true);
  });

  it("fails condition 1 when the brief or contract version is stale", () => {
    const stale = verifyFeatureDoneConditions({
      ...ready(),
      tasks: [{ ...ready().tasks[0]!, briefVersion: 1, currentBriefVersion: 2 }],
    });
    expect(stale.failedConditions).toEqual(["1"]);
  });
});

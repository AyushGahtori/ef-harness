import { describe, expect, it } from "vitest";

import { needsReviewVerdict } from "../../src/final-audit/constants.js";
import { LandingSummaryGenerator } from "../../src/final-audit/landing-summary.js";
import type { LayerAReport, LayerBReport, SuiteCase } from "../../src/final-audit/types.js";

function cases(): SuiteCase[] {
  const leaf: SuiteCase[] = Array.from({ length: 10 }, (_, index) => ({
    id: `leaf-${index + 1}`,
    kind: "leaf",
    passed: index < 8,
    featureId: "F-Orders",
  }));
  return [
    ...leaf,
    { id: "journey-1", kind: "feature_journey", passed: true, featureId: "F-Orders" },
    { id: "sealed-1", kind: "sealed_hidden", passed: false, featureId: "F-Orders" },
  ];
}

describe("landing summary", () => {
  it("reports exact pass counts, chosen and deferred items, and paperwork over 20% without inflating the verdict", () => {
    const suite = cases();
    const layerA: LayerAReport = {
      llmTokens: 0,
      passed: false,
      findings: [],
      suiteCases: suite,
      checks: [
        { id: "A:static_audit", passed: true, llmTokens: 0, findings: [] },
        { id: "A:secret_scan", passed: true, llmTokens: 0, findings: [] },
        { id: "A:combined_test_suite", passed: false, llmTokens: 0, findings: [], suiteCases: suite },
      ],
    };
    const layerB: LayerBReport = {
      llmTokens: 0,
      passed: true,
      kind: "web",
      findings: [],
      routes: [],
      commands: [],
      leakedPids: [],
      checks: [{ id: "B:route:/orders@375", passed: true, llmTokens: 0, findings: [] }],
    };
    const summary = new LandingSummaryGenerator().generate({
      features: [{ id: "F-Orders", state: "DONE", mergedTo: "harness/integration", journeys: ["order lunch"] }],
      routes: ["/orders", "/print"],
      commands: [],
      layerA,
      layerB,
      findings: [],
      regressions: [],
      waivedFingerprints: [],
      ledger: {
        chosenForYou: [{ id: "D-1", summary: "Email the catering totals" }],
        deferred: [{ id: "D-2", summary: "Native mobile app" }],
      },
      spend: {
        codingUnits: 750n,
        paperworkUnits: 250n,
        connections: [{ connectionId: "chatgpt-personal", costUnits: 40n, windowUnits: 100n, usedUnits: 55n }],
      },
      fixRounds: 0,
      budgetCapHit: false,
      roundCapHit: false,
      auditFixUnits: 0n,
      auditFixCapUnits: 100n,
      finalAuditUnits: 2n,
      finalAuditCapUnits: 20n,
    });
    expect(summary.receipts.leafTests).toEqual({ passed: 8, failed: 2, total: 10 });
    expect(summary.receipts.sealedHiddenChecks).toEqual({ passed: 0, failed: 1, total: 1 });
    expect(summary.plainEnglish).toContain("8 of 10 leaf tests passed (2 failed)");
    expect(summary.plainEnglish).not.toContain("10 of 10 leaf tests passed");
    expect(summary.spend.paperworkShare).toBe("25.0%");
    expect(summary.spend.paperworkWithinCap).toBe(false);
    expect(summary.plainEnglish).toContain("cap 20% exceeded");
    expect(summary.plainEnglish).toContain("Email the catering totals");
    expect(summary.plainEnglish).toContain("Native mobile app");
    expect(summary.plainEnglish).toContain("chatgpt-personal");
    expect(summary.readyToLand).toBe(false);
    expect(summary.verdict).toBe(needsReviewVerdict(summary.unresolvedFindings.length));
    expect(summary.unresolvedFindings.length).toBe(3);
  });
});

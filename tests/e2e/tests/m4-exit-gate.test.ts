import { expect, it } from "vitest";
import { UsageReceiptsCsvExporter, buildUsageView, csvIsSafe, currenciesSeparated, sampleReceipts } from "../m4-exit-gate/analytics.js";
import { certifyClaude, certifyGemini } from "../m4-exit-gate/compliance.js";
import { decideTrust } from "../m4-exit-gate/conformance.js";
import { runCrossAdapterHandoff, runIdlePark } from "../m4-exit-gate/handoff.js";
import { KitchenHiddenAcceptanceSuite, loadM4Fixtures } from "../m4-exit-gate/kitchen.js";
import { runReserveBoundary } from "../m4-exit-gate/pacing.js";
import { M4ExitGateReport, signReport } from "../m4-exit-gate/report.js";
import { runLiveCertification, runM4Certification } from "../m4-exit-gate/runner.js";
import type { GateFacts, ProbeResult } from "../m4-exit-gate/types.js";

function probes(failed: readonly string[]): ProbeResult[] {
  const ids = ["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10"] as const;
  return ids.map((probeId) => ({
    probeId,
    name: probeId,
    status: failed.includes(probeId) ? "fail" : "pass",
    diagnostic: probeId,
  }));
}

it("passes the allowance-paced M4 ci-replay exit gate", async () => {
  const report = await runM4Certification();
  expect(report.reasons.join(",")).toBe("");
  expect(report.exitCode).toBe(0);
  expect(report.claimedCertification).toBe(true);
  expect(report.facts.passRate).toBeGreaterThanOrEqual(0.9);
  expect(report.facts.hiddenPassed).toBe(29);
  expect(report.facts.prematureLockouts).toBe(0);
  expect(report.facts.personalReserveRemainingPpm).toBeGreaterThanOrEqual(200_000);
  expect(report.facts.ceilingPpm).toBe(800_000);
  expect(report.facts.windDownPpm).toBe(720_000);
  expect(report.facts.startCwnd).toBe(2);
  expect(report.facts.peakCwnd).toBeGreaterThanOrEqual(3);
  expect(report.facts.cwndAfter429).toBe(1);
  expect(report.facts.tokenRefreshOk).toBe(true);
  expect(report.facts.failedTurns).toBe(0);
  expect(report.facts.lostWip).toBe(0);
  expect(report.facts.paidSpendMicroUsd).toBe(0);
  expect(report.facts.unconsentedPaidRequests).toBe(0);
  expect(report.facts.openRouterRequestCount).toBe(0);
  expect(report.facts.copilotRequestsAfterQuotaZero).toBe(0);
  expect(report.facts.conformanceAllTen).toBe(true);
  expect(report.facts.adapters).toHaveLength(7);
  expect(report.facts.rogueDowngradeOk).toBe(true);
  expect(report.facts.productionTrapHits).toBe(0);
  expect(report.facts.rogueTrapHits).toBeGreaterThan(0);
  expect(report.facts.claudeOk).toBe(true);
  expect(report.facts.geminiDefaultOff).toBe(true);
  expect(report.facts.withdrawnHits).toBe(0);
  expect(report.facts.wireOk).toBe(true);
  expect(report.facts.handoffText).toContain("[PRIOR UNVERIFIED WIP]");
  expect(report.facts.ephemeralLeftovers).toBe(0);
  expect(report.facts.wipTreeSha).toBe(report.facts.restoredTreeSha);
  expect(report.facts.analyticsSeparated).toBe(true);
  expect(report.facts.csvSafe).toBe(true);
  expect(report.facts.idleTerminatedAtMs).toBe(90_000);
  expect(report.facts.idleCheckpointPreserved).toBe(true);
  expect(report.facts.queuedStartedAt89).toBe(0);
  expect(report.facts.oidcTokenPosts).toBeGreaterThanOrEqual(1);
  expect(report.facts.responsePosts).toBe(8);
  expect(report.hostElapsedMs).toBeLessThan(120_000);
  expect(report.signature.startsWith("sha256:")).toBe(true);
  expect(report.renderScorecard()).toContain("ChatGPT Plus");
  expect(report.renderScorecard()).toContain("Exit: 0");
  const again = signReport(report.payload());
  expect(again).toBe(report.signature);
}, 120_000);

it("fails closed when pacing, spend, conformance, wire, or cleanliness regresses", async () => {
  const passed = await runM4Certification({ simulateProcessProbes: true });
  expect(passed.exitCode).toBe(0);
  const withReason = (patch: Partial<GateFacts>, reason: string) => {
    const gated = M4ExitGateReport.evaluate({ ...passed.facts, ...patch }, 1);
    expect(gated.exitCode).toBe(1);
    expect(gated.reasons).toContain(reason);
  };
  withReason({ passRate: 0.88, hiddenPassed: 26 }, "passRate");
  withReason({ prematureLockouts: 1, usageLimitDuringPacedBuild: 1, withinFiveHours: false }, "prematureLockouts");
  withReason({ wireOk: false, wireProblems: ["temperature"] }, "wire");
  withReason({ ephemeralLeftovers: 2, handoffOk: false }, "handoffClean");
  withReason({ analyticsSeparated: false }, "analytics");
  withReason({ csvSafe: false }, "csv");
  withReason({ idleParkOk: false, idleTerminatedAtMs: null }, "idlePark");
  withReason({ claudeOk: false }, "termsClaude");
  withReason({ geminiDefaultOff: false, geminiOk: false }, "termsGemini");
  withReason({ rogueDowngradeOk: false }, "rogueDowngrade");
  withReason({ copilotRequestsAfterQuotaZero: 1, paidSpendMicroUsd: 250_000 }, "copilotOverage");
  withReason({ unconsentedPaidRequests: 1, anthropicPosts: 1, paidSpendMicroUsd: 250_000 }, "paidRequests");

  const leak = await runM4Certification({ faults: { openRouterLeak: true }, simulateProcessProbes: true });
  expect(leak.facts.openRouterRequestCount).toBe(1);
  expect(leak.reasons).toContain("openRouterLeak");
  expect(leak.facts.paidSpendMicroUsd).toBeGreaterThan(0);

  const trap = await runM4Certification({ faults: { p06AdapterId: "opencode" }, simulateProcessProbes: true });
  expect(trap.facts.productionTrapHits).toBeGreaterThan(0);
  expect(trap.reasons).toContain("p06");
  expect(trap.reasons).toContain("conformance");

  const reserve = await runM4Certification({ faults: { ignoreWindDown: true }, simulateProcessProbes: true });
  expect(reserve.facts.queuedStartedAt89).toBe(3);
  expect(reserve.facts.personalReserveRemainingPpm).toBeLessThan(200_000);
  expect(reserve.reasons).toContain("personalReserve");

  const fixtures = loadM4Fixtures();
  const hidden = new KitchenHiddenAcceptanceSuite(fixtures.suite);
  expect(hidden.score(["H-M2-01", "H-M2-02", "H-M2-03"]).rate).toBeLessThan(0.9);
  expect(hidden.promptsLeak([hidden.buildPrompt(fixtures.opening, "T-menu", true)])).toBe(true);
  expect(currenciesSeparated(buildUsageView(true))).toBe(false);
  const records = sampleReceipts();
  const unsafe = new UsageReceiptsCsvExporter().export(records, "2026-11-23", true);
  expect(csvIsSafe(unsafe.body, records)).toBe(false);
  expect(certifyClaude(true).ok).toBe(false);
  expect(certifyGemini({ geminiEnabledByDefault: true }).defaultOff).toBe(false);
  expect(runCrossAdapterHandoff(true).leftovers).toBeGreaterThan(0);
  expect(runIdlePark(true).terminatedAtMs).toBeNull();
}, 90_000);

it("keeps the 89% wind-down and the wrapped-to-disabled ladder", () => {
  const guarded = runReserveBoundary(false);
  expect(guarded.started).toBe(0);
  expect(guarded.windDownPpm).toBe(720_000);
  expect(guarded.ceilingPpm).toBe(800_000);
  expect(guarded.remainingPpm).toBeGreaterThanOrEqual(200_000);
  expect(guarded.ok).toBe(true);
  const blown = runReserveBoundary(true);
  expect(blown.started).toBe(3);
  expect(blown.remainingPpm).toBeLessThan(200_000);

  const pass = probes([]);
  const wrappedOnly = decideTrust(probes(["P02"]), pass);
  expect(wrappedOnly.trust).toBe("stripped");
  expect(wrappedOnly.ladder).toEqual(["wrapped", "stripped"]);
  const disabled = decideTrust(probes(["P06"]), probes(["P06"]));
  expect(disabled.trust).toBe("disabled");
  expect(disabled.ladder).toEqual(["wrapped", "stripped", "disabled"]);
  const canary = decideTrust(probes(["P05"]), probes(["P05"]));
  expect(canary.trust).toBe("disabled");
  const leaked = decideTrust(probes(["P07"]), probes(["P07"]));
  expect(leaked.trust).toBe("disabled");
});

it("does not claim live certification on this base", () => {
  const missing = runLiveCertification({});
  expect(missing.exitCode).toBe(2);
  expect(missing.claimedCertification).toBe(false);
  const configured = runLiveCertification({ EF_M4_LIVE_CONFIRM: "1", EF_M4_LIVE_API_KEY: "present" });
  expect(configured.exitCode).toBe(2);
  expect(configured.claimedCertification).toBe(false);
});

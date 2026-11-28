import { UsageReceiptsCsvExporter, buildUsageView, csvIsSafe, currenciesSeparated, sampleReceipts } from "./analytics.ts";
import { M4AllowancePacedBenchmark } from "./benchmark.ts";
import { M4ComplianceAndFallbackCertifier } from "./certifier.ts";
import { certifyTerms } from "./compliance.ts";
import { AdapterConformanceRunner } from "./conformance.ts";
import { runCrossAdapterHandoff, runIdlePark } from "./handoff.ts";
import { M4ExitGateReport } from "./report.ts";
import { startMockPlane } from "./servers.ts";
import type { GateFacts, RunOptions } from "./types.ts";
import { repoRoot } from "./paths.ts";

export async function runM4Certification(options: RunOptions = {}): Promise<M4ExitGateReport> {
  const started = performance.now();
  const faults = options.faults ?? {};
  const plane = await startMockPlane();
  try {
    const paced = await new M4AllowancePacedBenchmark().run(plane, faults);
    const fallback = await new M4ComplianceAndFallbackCertifier().certify(plane, faults);
    const conformance = await new AdapterConformanceRunner().run({
      origin: plane.origin,
      spawnProcesses: options.simulateProcessProbes !== true,
      ...(faults.p06AdapterId === undefined ? {} : { trapAdapter: faults.p06AdapterId }),
      ...(faults.skipRogueDowngrade === undefined ? {} : { skipRogueDowngrade: true }),
    });
    const terms = certifyTerms(repoRoot(), faults);
    const handoff = runCrossAdapterHandoff(faults.leaveCodexHome === true);
    const usage = buildUsageView(faults.blendCurrencies === true);
    const records = sampleReceipts();
    const csv = new UsageReceiptsCsvExporter().export(records, "2026-11-23", faults.csvUnsafe === true);
    const idle = runIdlePark(faults.skipIdlePark === true);
    const facts: GateFacts = {
      mode: "ci-replay",
      passRate: paced.passRate,
      hiddenPassed: paced.hiddenPassed,
      hiddenTotal: paced.hiddenTotal,
      hiddenLeak: paced.hiddenLeak,
      prematureLockouts: paced.prematureLockouts,
      personalReserveRemainingPpm: paced.personalReserveRemainingPpm,
      reserveFraction: paced.reserveFraction,
      ceilingPpm: paced.ceilingPpm,
      windDownPpm: paced.windDownPpm,
      startCwnd: paced.startCwnd,
      peakCwnd: paced.peakCwnd,
      cwndAfter429: paced.cwndAfter429,
      cwndCapHolds: paced.cwndCapHolds,
      usageLimitDuringPacedBuild: paced.usageLimitDuringPacedBuild,
      withinFiveHours: paced.withinFiveHours,
      virtualElapsedMs: paced.virtualElapsedMs,
      refreshAtMs: paced.refreshAtMs,
      tokenRefreshOk: paced.tokenRefreshOk,
      failedTurns: paced.failedTurns,
      lostWip: paced.lostWip,
      threadId: paced.threadId,
      paidSpendMicroUsd: fallback.paidSpendMicroUsd,
      unconsentedPaidRequests: fallback.unconsentedPaidRequests,
      openRouterRequestCount: fallback.openRouterRequestCount,
      copilotRequestsAfterQuotaZero: fallback.copilotRequestsAfterQuotaZero,
      consentDrillAllowsPaid: fallback.consentDrillAllowsPaid,
      exhaustionOk: fallback.exhaustionOk,
      scenarios: fallback.scenarios,
      conformanceAllTen: conformance.conformanceAllTen,
      adapters: conformance.adapters,
      rogueDowngradeOk: conformance.rogueDowngradeOk,
      rogues: conformance.rogues,
      productionTrapHits: conformance.productionTrapHits,
      rogueTrapHits: conformance.rogueTrapHits,
      cacheHitUnder2ms: conformance.cacheHitUnder2ms,
      cacheInvalidatesOnVersion: conformance.cacheInvalidatesOnVersion,
      interruptUnder2s: conformance.interruptUnder2s,
      processCleanupOk: conformance.processCleanupOk,
      claudeOk: terms.claudeOk && terms.setupCommandHits === 0 && terms.claudeHomeReads === 0,
      geminiOk: terms.geminiOk && terms.geminiPersonalTouches === 0,
      geminiDefaultOff: terms.geminiDefaultOff,
      withdrawnHits: terms.withdrawnHits,
      setupCommandHits: terms.setupCommandHits,
      personalGeminiPathHits: terms.personalGeminiPathHits,
      wireOk: paced.wireOk,
      wireProblems: paced.wireProblems,
      handoffOk: handoff.ok,
      wipTreeSha: handoff.wipTreeSha,
      restoredTreeSha: handoff.restoredTreeSha,
      handoffText: handoff.handoffText,
      ephemeralLeftovers: handoff.leftovers,
      userApprovedSwitch: handoff.userApprovedSwitch,
      analyticsSeparated: currenciesSeparated(usage),
      csvSafe: csvIsSafe(csv.body, records) && csv.filename === "ef-harness-usage-2026-11-23.csv",
      csvFilename: csv.filename,
      idleParkOk: idle.ok,
      idleTerminatedAtMs: idle.terminatedAtMs,
      idleCheckpointPreserved: idle.checkpointPreserved,
      oidcTokenPosts: plane.counts.oidc,
      responsePosts: plane.counts.responses,
      anthropicPosts: plane.counts.anthropic,
      pacingProfileOk: paced.pacingProfileOk,
      aimdOk: paced.aimdOk,
      reserveBoundaryOk: paced.reserveBoundaryOk,
      queuedStartedAt89: paced.queuedStartedAt89,
    };
    return M4ExitGateReport.evaluate(facts, performance.now() - started);
  } finally {
    await plane.close();
  }
}

export function runLiveCertification(env: NodeJS.ProcessEnv = process.env): {
  readonly exitCode: 2;
  readonly claimedCertification: false;
  readonly reason: string;
} {
  const confirmed = env.EF_M4_LIVE_CONFIRM === "1";
  const hasAccount = Boolean(env.EF_M4_LIVE_API_KEY || env.OPENROUTER_API_KEY);
  const reason =
    confirmed && hasAccount
      ? "Live accounts are configured, but this base has no sibling provider adapters. Certification is not claimed and no network call is made."
      : "Live certification is not claimed. Real accounts belong on an integration base that has the provider adapters.";
  return { exitCode: 2, claimedCertification: false, reason };
}

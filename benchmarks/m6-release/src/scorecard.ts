import { canonicalJson, prettyCanonicalJson, sha256Text } from "./canonical.ts";
import type { CertificationProfile, GateResult, ReleaseDecision, V1ReleaseScorecard } from "./types.ts";

export interface DecisionResult {
  readonly decision: ReleaseDecision;
  readonly decisionScope: "ci-replay" | "live-sign-off";
  readonly liveSignOff: "WITHHELD" | "GRANTED";
  readonly productionCertificationClaimed: boolean;
  readonly tagV1Authorized: boolean;
  readonly failingGateIds: readonly string[];
  readonly liveBlockers: readonly string[];
  readonly banner: string;
}

function sortedUnique(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export function decide(profile: CertificationProfile, gates: readonly GateResult[]): DecisionResult {
  const replayFails = gates.filter((gate) => gate.requiredForCiReplay && gate.verdict !== "PASS").map((gate) => gate.id);
  const vetoFails = gates.filter((gate) => gate.veto && gate.verdict === "FAIL").map((gate) => gate.id);
  const liveBlockers = gates.filter((gate) => gate.requiredForLiveSignOff && gate.verdict !== "PASS").map((gate) => gate.id);
  if (profile === "ci-replay") {
    const failing = sortedUnique([...replayFails, ...vetoFails]);
    const decision = failing.length === 0 ? "GO" : "NO-GO";
    return {
      decision,
      decisionScope: "ci-replay",
      liveSignOff: "WITHHELD",
      productionCertificationClaimed: false,
      tagV1Authorized: false,
      failingGateIds: failing,
      liveBlockers: sortedUnique(liveBlockers),
      banner:
        decision === "GO"
          ? "CI-REPLAY LOCAL-PORT GATE: GO. LIVE SIGN-OFF: WITHHELD. This scorecard is not a production certification and does not authorize tagging v1.0.0."
          : "CI-REPLAY LOCAL-PORT GATE: NO-GO. LIVE SIGN-OFF: WITHHELD. This scorecard is not a production certification and does not authorize tagging v1.0.0.",
    };
  }
  const failing = sortedUnique([...liveBlockers, ...replayFails, ...vetoFails]);
  const decision = failing.length === 0 ? "GO" : "NO-GO";
  const granted = decision === "GO";
  return {
    decision,
    decisionScope: "live-sign-off",
    liveSignOff: granted ? "GRANTED" : "WITHHELD",
    productionCertificationClaimed: granted,
    tagV1Authorized: granted,
    failingGateIds: failing,
    liveBlockers: sortedUnique(liveBlockers),
    banner: granted
      ? "LIVE SIGN-OFF: GRANTED. Production certification is claimed and tagging v1.0.0 is authorized."
      : "LIVE SIGN-OFF: NO-GO. Production certification is not claimed. Tag v1.0.0 is not authorized.",
  };
}

export function withIntegrity(scorecard: Omit<V1ReleaseScorecard, "integrity">): V1ReleaseScorecard {
  const contentSha256 = sha256Text(canonicalJson(scorecard));
  return {
    ...scorecard,
    integrity: {
      algorithm: "sha256",
      contentSha256,
      productionSignature: null,
    },
  };
}

export function renderScorecardMarkdown(scorecard: V1ReleaseScorecard): string {
  const lines = [
    "# V1 release scorecard",
    "",
    scorecard.banner,
    "",
    `- Profile: ${scorecard.profile}`,
    `- Decision: ${scorecard.decision}`,
    `- Decision scope: ${scorecard.decisionScope}`,
    `- Live sign-off: ${scorecard.liveSignOff}`,
    `- Production certification claimed: ${scorecard.productionCertificationClaimed}`,
    `- v1.0.0 tag authorized: ${scorecard.tagV1Authorized}`,
    `- Candidate version: ${scorecard.candidateVersion}`,
    `- Git commit: ${scorecard.gitCommit}`,
    `- Branch: ${scorecard.branch}`,
    `- Unsigned dev flag: ${scorecard.unsignedDev}`,
    "",
    "## Suites",
    "",
    "| Suite | Verdict | Evidence | Product executed |",
    "| --- | --- | --- | --- |",
    ...scorecard.suites.map(
      (suite) => `| ${suite.id} | ${suite.verdict} | ${suite.evidenceClass} | ${suite.productExecuted} |`,
    ),
    "",
    "## Milestones",
    "",
    "| Milestone | Verdict | Evidence | Summary |",
    "| --- | --- | --- | --- |",
    ...scorecard.milestones.map(
      (milestone) => `| ${milestone.id} | ${milestone.verdict} | ${milestone.evidenceClass} | ${milestone.summary} |`,
    ),
    "",
    "## Gates",
    "",
    "| Gate | Verdict | Evidence | Replay | Live |",
    "| --- | --- | --- | --- | --- |",
    ...scorecard.gates.map(
      (gate) =>
        `| ${gate.id} | ${gate.verdict} | ${gate.evidenceClass} | ${gate.requiredForCiReplay} | ${gate.requiredForLiveSignOff} |`,
    ),
    "",
    "## Linux case repair",
    "",
    `- Classification: ${scorecard.linuxCaseRepair.classification}`,
    `- CI status: ${scorecard.linuxCaseRepair.ciStatus}`,
    `- Repair pushes: ${scorecard.linuxCaseRepair.repairPushes} / cap ${scorecard.linuxCaseRepair.pushCap}`,
    `- Applied index case: ${scorecard.linuxCaseRepair.appliedRepairIndexCase}`,
    `- Broken index case: ${scorecard.linuxCaseRepair.brokenIndexCase}`,
    `- Single-step git mv index case: ${scorecard.linuxCaseRepair.singleStepGitMvIndexCase}`,
    "",
    "## Live blockers",
    "",
    scorecard.liveBlockers.length === 0 ? "None." : scorecard.liveBlockers.map((id) => `- ${id}`).join("\n"),
    "",
    "## Integration swaps",
    "",
    `${scorecard.integration.swapCount} local-port swaps, ${scorecard.integration.handoffPresentCount} handoffs present, ${scorecard.integration.unaccounted.length} unaccounted.`,
    "",
    "## Commands",
    "",
    "- `node benchmarks/m6-release/cli.ts --profile ci-replay --out <dir>`",
    "- `node benchmarks/m6-release/cli.ts --profile full-release-certification --out <dir>`",
    "- `pnpm --filter @ef-harness/e2e test -- m6-exit-gate`",
    "",
    `Content SHA-256: ${scorecard.integrity.contentSha256}`,
    "",
  ];
  return lines.join("\n");
}

export function serializeScorecard(scorecard: V1ReleaseScorecard): string {
  return prettyCanonicalJson(scorecard);
}

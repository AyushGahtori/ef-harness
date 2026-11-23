import { createHash } from "node:crypto";
import { REPORT_SCHEMA } from "./constants.ts";
import type { PillarVerdict, RedTeamVectorResult, SecurityAuditCertificationReport, SignedAuditReport } from "./types.ts";

export function signReport(report: SignedAuditReport): string {
  const view = {
    schema: report.schema,
    exitCode: report.exitCode,
    findings: [...report.findings].sort(),
    pillars: report.pillars.map((pillar) => ({
      pillar: pillar.pillar,
      id: pillar.id,
      passed: pillar.passed,
      findings: [...pillar.findings].sort(),
    })),
    residualSecretBytes: report.residualSecretBytes,
    silentSpendMicroUsd: report.silentSpendMicroUsd,
    withdrawnVendorHits: report.withdrawnVendorHits,
    skillPinsOk: report.skillPinsOk,
    allowBuildsOk: report.allowBuildsOk,
    redTeamBlocked: report.redTeam.filter((row) => row.blocked).length,
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(view)).digest("hex")}`;
}

export function renderScorecard(report: SecurityAuditCertificationReport): string {
  const lines = [
    "# Security, Privacy & Supply-Chain Audit",
    "",
    `Schema: ${report.schema}`,
    `Exit: ${report.exitCode}`,
    `Certification: ${report.claimedCertification ? "CLAIMED" : "WITHHELD"}`,
    `Signature: ${report.signature}`,
    "",
    "## Pillars",
    ...report.pillars.map(
      (pillar) =>
        `- Pillar ${pillar.pillar} (${pillar.id}): ${pillar.passed ? "PASS" : "FAIL"} — ${pillar.findings.length} findings`,
    ),
    "",
    "## Red team",
    ...report.redTeam.map((row) => `- ${row.id}: ${row.blocked ? "BLOCKED" : "BREACH"} (trap=${row.trapHits}, canary=${row.canaryReads})`),
    "",
    `Residual secret bytes: ${report.residualSecretBytes}`,
    `Silent spend micro-USD: ${report.silentSpendMicroUsd}`,
  ];
  return lines.join("\n");
}

export function buildReport(input: {
  pillars: PillarVerdict[];
  redTeam: RedTeamVectorResult[];
  residualSecretBytes: number;
  silentSpendMicroUsd: number;
  withdrawnVendorHits: number;
  skillPinsOk: boolean;
  allowBuildsOk: boolean;
  hostElapsedMs: number;
}): SecurityAuditCertificationReport {
  const findings = input.pillars.flatMap((pillar) => pillar.findings);
  const redFindings = input.redTeam.filter((row) => !row.blocked).map((row) => `red-team:${row.id}`);
  const combined = [...findings, ...redFindings];
  if (input.residualSecretBytes > 0) combined.push("residualSecretBytes");
  if (input.silentSpendMicroUsd > 0) combined.push("silentSpend");
  if (input.withdrawnVendorHits > 0) combined.push("withdrawnVendor");
  if (!input.skillPinsOk) combined.push("skillPins");
  if (!input.allowBuildsOk) combined.push("allowBuilds");
  combined.sort();
  const exitCode = combined.length === 0 ? 0 : 1;
  const draft: SignedAuditReport = {
    schema: REPORT_SCHEMA,
    exitCode,
    claimedCertification: exitCode === 0,
    findings: combined,
    pillars: input.pillars,
    redTeam: input.redTeam,
    residualSecretBytes: input.residualSecretBytes,
    silentSpendMicroUsd: input.silentSpendMicroUsd,
    withdrawnVendorHits: input.withdrawnVendorHits,
    skillPinsOk: input.skillPinsOk,
    allowBuildsOk: input.allowBuildsOk,
    hostElapsedMs: input.hostElapsedMs,
    scorecardMarkdown: "",
  };
  const signature = signReport(draft);
  const scorecardMarkdown = renderScorecard({ ...draft, signature });
  return { ...draft, scorecardMarkdown, signature };
}

export class SecurityAuditCertificationReportWriter {
  static toJson(report: SecurityAuditCertificationReport): string {
    return JSON.stringify(report, null, 2);
  }
}
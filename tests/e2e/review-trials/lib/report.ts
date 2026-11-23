import fs from "node:fs";
import path from "node:path";

export interface EvidenceReceipt {
  id: string;
  kind: "area" | "trial";
  title: string;
  testFile: string;
  passed: true;
  skipped: 0;
  durationMs: number;
  evidence: readonly string[];
}

export interface ReviewTrialsCertificationReport {
  version: "review-trials-certification/1";
  suite: "ArchitectureReviewTrialsSuite";
  executed: 16;
  passed: 16;
  skipped: 0;
  durationMs: number;
  leakedPids: 0;
  leakedTempDirs: 0;
  offline: true;
  portStrategy: "ephemeral-loopback";
  settledDecisions: number;
  ports: readonly number[];
  areas: readonly EvidenceReceipt[];
  trials: readonly EvidenceReceipt[];
}

export function reportToMarkdown(report: ReviewTrialsCertificationReport): string {
  const lines = [
    "# ReviewTrialsCertificationReport",
    "",
    `Version: ${report.version}`,
    `Suite: ${report.suite}`,
    `Executed: ${report.executed}/16`,
    `Passed: ${report.passed}`,
    `Skipped: ${report.skipped}`,
    `DurationMs: ${report.durationMs}`,
    `LeakedPids: ${report.leakedPids}`,
    `LeakedTempDirs: ${report.leakedTempDirs}`,
    `PortStrategy: ${report.portStrategy}`,
    `SettledDecisions: ${report.settledDecisions}`,
    "",
    "| Id | File | Passed | Skipped | Duration ms |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const receipt of [...report.areas, ...report.trials]) {
    lines.push(`| ${receipt.id} | ${receipt.testFile} | ${receipt.passed} | ${receipt.skipped} | ${receipt.durationMs} |`);
  }
  lines.push("");
  return lines.join("\n");
}

export function writeReport(dir: string, report: ReviewTrialsCertificationReport): { jsonPath: string; markdownPath: string } {
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, "review-trials-certification.json");
  const markdownPath = path.join(dir, "review-trials-certification.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, reportToMarkdown(report));
  return { jsonPath, markdownPath };
}

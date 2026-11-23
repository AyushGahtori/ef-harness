import fs from "node:fs";
import path from "node:path";

export interface JourneyReceipt {
  readonly id: string;
  readonly title: string;
  readonly testFile: string;
  readonly milestones: readonly string[];
  readonly passed: true;
  readonly durationMs: number;
  readonly evidence: readonly string[];
  readonly paperworkPct: number;
  readonly silentStashes: 0;
}

export interface CrossMilestoneIntegrationReport {
  readonly version: "cross-milestone-integration/1";
  readonly suite: "FullLifecycleMultiProjectE2eSuite";
  readonly journeysExecuted: 3;
  readonly journeysPassed: 3;
  readonly skipped: 0;
  readonly durationMs: number;
  readonly leakedPids: 0;
  readonly leakedTempDirs: 0;
  readonly plaintextSecrets: 0;
  readonly offline: true;
  readonly portStrategy: "local-port-task-195";
  readonly portLeases: readonly { projectId: string; purpose: string; port: number }[];
  readonly journeys: readonly JourneyReceipt[];
  readonly seamHealth: {
    readonly packagesChecked: number;
    readonly contractDrift: 0;
    readonly ipcGapFree: true;
    readonly boardUpdateMs: number;
  };
}

export function reportToMarkdown(report: CrossMilestoneIntegrationReport): string {
  const lines = [
    "# CrossMilestoneIntegrationReport",
    "",
    `Version: ${report.version}`,
    `Suite: ${report.suite}`,
    `Journeys: ${report.journeysPassed}/${report.journeysExecuted}`,
    `Skipped: ${report.skipped}`,
    `DurationMs: ${report.durationMs}`,
    `LeakedPids: ${report.leakedPids}`,
    `PlaintextSecrets: ${report.plaintextSecrets}`,
    `PortStrategy: ${report.portStrategy}`,
    "",
    "| Journey | File | Paperwork % | Stashes | Duration ms |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const journey of report.journeys) {
    lines.push(
      `| ${journey.id} | ${journey.testFile} | ${journey.paperworkPct} | ${journey.silentStashes} | ${journey.durationMs} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function writeReport(dir: string, report: CrossMilestoneIntegrationReport): { jsonPath: string; markdownPath: string } {
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, "cross-milestone-integration.json");
  const markdownPath = path.join(dir, "cross-milestone-integration.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, reportToMarkdown(report));
  return { jsonPath, markdownPath };
}
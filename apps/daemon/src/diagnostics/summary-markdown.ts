import type { ClipboardPort } from "./ports.js";
import type { WriteLatencyHealth } from "./types.js";

export interface RedactedSummaryInput {
  readonly osVersion: string;
  readonly appVersion: string;
  readonly sqlite: WriteLatencyHealth;
  readonly governor: string;
  readonly recentErrors: readonly string[];
  readonly scrub: (text: string) => string;
}

export function buildRedactedSummaryMarkdown(input: RedactedSummaryInput): string {
  const sqlite =
    input.sqlite.sampleCount === 0 || input.sqlite.p99Ms === null
      ? "SQLite health: no write samples"
      : `SQLite health: p99 ${input.sqlite.p99Ms} ms (${input.sqlite.withinSlo ? "within" : "above"} ${input.sqlite.sloMs} ms SLO), busy retries ${input.sqlite.busyRetryCount}`;
  const errors =
    input.recentErrors.length === 0
      ? "- Recent errors: none"
      : ["- Recent errors:", ...input.recentErrors.map((error) => `  - ${error}`)].join("\n");
  const markdown = [
    "## EF Harness diagnostics (redacted)",
    "",
    `- OS: ${input.osVersion}`,
    `- App Version: ${input.appVersion}`,
    `- ${sqlite}`,
    `- Governor: ${input.governor}`,
    errors,
    "",
  ].join("\n");
  return input.scrub(markdown);
}

export function copyRedactedSummary(markdown: string, clipboard: ClipboardPort): string {
  clipboard.writeText(markdown);
  return markdown;
}

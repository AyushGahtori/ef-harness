import { hardwareMetadata } from "./stats.ts";
import type { CertificationResult, ScaleBenchmarkScorecard, SloMetric } from "./types.ts";
import { SCALE_BENCHMARK_SCORECARD_SCHEMA } from "./types.ts";

function fixed(value: number): string {
  if (!Number.isFinite(value)) return "inf";
  return value.toFixed(3);
}

export function buildScorecard(metrics: readonly SloMetric[], branch: string): ScaleBenchmarkScorecard {
  const allPass = metrics.every((metric) => metric.passFail === "pass");
  return {
    schema: SCALE_BENCHMARK_SCORECARD_SCHEMA,
    generatedAt: new Date().toISOString(),
    branch,
    hardware: hardwareMetadata(),
    metrics,
    allPass,
  };
}

export function renderScorecardMarkdown(scorecard: ScaleBenchmarkScorecard): string {
  const lines = [
    "# Performance & Scale Benchmark Scorecard",
    "",
    `Schema: \`${scorecard.schema}\``,
    `Generated: ${scorecard.generatedAt}`,
    `Branch: \`${scorecard.branch}\``,
    `Overall: **${scorecard.allPass ? "PASS" : "FAIL"}**`,
    "",
    "## Hardware",
    "",
    "| Key | Value |",
    "| --- | --- |",
    ...Object.entries(scorecard.hardware).map(([key, value]) => `| ${key} | ${value} |`),
    "",
    "## SLO Metrics",
    "",
    "| SLO | p50 (ms) | p95 (ms) | p99 (ms) | peak RAM (MB) | threshold | pass |",
    "| --- | ---: | ---: | ---: | ---: | --- | --- |",
    ...scorecard.metrics.map(
      (metric) =>
        `| ${metric.label} | ${fixed(metric.p50)} | ${fixed(metric.p95)} | ${fixed(metric.p99)} | ${
          metric.peakRamMb === null ? "—" : metric.peakRamMb
        } | ${metric.threshold} | ${metric.passFail} |`,
    ),
    "",
  ];
  for (const metric of scorecard.metrics) {
    if (metric.detail.length > 0) {
      lines.push(`### ${metric.label} detail`, "", ...metric.detail.map((line) => `- ${line}`), "");
    }
  }
  return `${lines.join("\n")}\n`;
}

export function finalizeCertification(metrics: readonly SloMetric[], branch: string): CertificationResult {
  const scorecard = buildScorecard(metrics, branch);
  const markdown = renderScorecardMarkdown(scorecard);
  return { scorecard, markdown, exitCode: scorecard.allPass ? 0 : 1 };
}
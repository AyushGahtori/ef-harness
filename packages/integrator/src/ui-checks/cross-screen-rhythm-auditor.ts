import type { ScreenRhythmMetrics, UiConsistencyFinding } from "./types.js";

type NumericMetric = keyof Pick<
  ScreenRhythmMetrics,
  | "headerHeight"
  | "sidebarWidth"
  | "pageTitleFontSize"
  | "pageTitleLineHeight"
  | "cardPadding"
  | "cardBorderRadius"
  | "primaryButtonHeight"
>;

const NUMERIC_METRICS: NumericMetric[] = [
  "headerHeight",
  "sidebarWidth",
  "pageTitleFontSize",
  "pageTitleLineHeight",
  "cardPadding",
  "cardBorderRadius",
  "primaryButtonHeight",
];

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const left = sorted[mid - 1] ?? 0;
    const right = sorted[mid] ?? 0;
    return (left + right) / 2;
  }
  return sorted[mid] ?? 0;
}

export class CrossScreenRhythmAuditor {
  run(metrics: readonly ScreenRhythmMetrics[]): UiConsistencyFinding[] {
    if (metrics.length < 2) return [];
    const findings: UiConsistencyFinding[] = [];
    for (const metric of NUMERIC_METRICS) {
      const values = metrics.map((entry) => entry[metric]);
      const med = median(values);
      for (const entry of metrics) {
        const value = entry[metric];
        if (Math.abs(value - med) > 2) {
          findings.push({
            stage: "cross_screen_rhythm",
            rule: "rhythm-outlier",
            severity: "error",
            message: `${metric} outlier on ${entry.route}: ${value}px vs median ${med}px`,
          });
        }
      }
    }
    const titleFonts = new Set(metrics.map((entry) => entry.pageTitleFontFamily));
    const bodyFonts = new Set(metrics.map((entry) => entry.bodyFontFamily));
    if (titleFonts.size > 1 || bodyFonts.size > 1) {
      for (const entry of metrics) {
        const medTitle = metrics[0]?.pageTitleFontFamily ?? "";
        const medBody = metrics[0]?.bodyFontFamily ?? "";
        if (entry.pageTitleFontFamily !== medTitle || entry.bodyFontFamily !== medBody) {
          findings.push({
            stage: "cross_screen_rhythm",
            rule: "font-family-drift",
            severity: "error",
            message: `font family drift on ${entry.route}`,
          });
        }
      }
    }
    return findings;
  }
}
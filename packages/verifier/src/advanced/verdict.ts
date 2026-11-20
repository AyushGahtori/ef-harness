export interface AiEvalVerdict {
  readonly passedCount: number;
  readonly totalCount: number;
  readonly threshold: string;
  readonly criticalFailures: number;
  readonly scoreLabel: string;
  readonly passed: boolean;
  readonly errorCount: number;
  readonly rubricAuthor: "oracle-author@1";
  readonly thresholdVersion: number;
  readonly judgeFamily: string;
  readonly generatorFamily: string;
  readonly sampleCount: number;
  readonly warnings: readonly string[];
}

export function formatThreshold(minPassed: number, total: number): string {
  return `${minPassed}/${total}`;
}

export function formatScoreLabel(
  passedCount: number,
  totalCount: number,
  minPassed: number,
  thresholdTotal: number,
): string {
  return `${passedCount}/${totalCount} (threshold ${minPassed}/${thresholdTotal})`;
}

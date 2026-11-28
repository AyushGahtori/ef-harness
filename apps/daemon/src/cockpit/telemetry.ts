import type { TelemetryDb } from "@ef-harness/db";

export interface MetricDispatch {
  readonly attempt: string | null;
  readonly ts: number;
  readonly data: unknown;
}

export function recordHealthMetric(telemetry: TelemetryDb, metric: MetricDispatch): { readonly written: number } {
  telemetry.enqueue({
    attempt: metric.attempt,
    ts: metric.ts,
    kind: "metric",
    data: metric.data,
  });
  return { written: telemetry.flush() };
}

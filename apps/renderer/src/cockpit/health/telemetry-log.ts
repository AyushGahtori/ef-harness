import type {
  HealthMetricEvent,
  TelemetryMetricRow,
  TelemetryMetricWriter,
} from "./types.js";

/**
 * In-process stand-in for telemetry.db. Rows match the existing `telemetry`
 * table (attempt, ts, kind, data) and use kind `metric`. No schema change.
 */
export class InMemoryTelemetryLog implements TelemetryMetricWriter {
  readonly rows: TelemetryMetricRow[] = [];

  insertMetric(row: TelemetryMetricRow): void {
    this.rows.push(row);
  }

  events(): HealthMetricEvent[] {
    return this.rows.map((row) => JSON.parse(row.data) as HealthMetricEvent);
  }
}

export const TELEMETRY_HEALTH_TARGET = {
  database: "telemetry.db",
  table: "telemetry",
  columns: ["attempt", "ts", "kind", "data"],
  kind: "metric",
} as const;

export function metricRow(attemptId: string, event: HealthMetricEvent): TelemetryMetricRow {
  return {
    attempt: attemptId,
    ts: event.atMs,
    kind: "metric",
    data: JSON.stringify(event),
  };
}

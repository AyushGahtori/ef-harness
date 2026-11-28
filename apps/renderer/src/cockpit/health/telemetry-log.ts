import type { PreloadMessagePort } from "../../shell/ports.js";
import type { HealthMetricEvent, TelemetryMetricRow, TelemetryMetricWriter } from "./types.js";

/**
 * Health metrics travel to harnessd as preload JSON-RPC.
 * The renderer never opens telemetry.db.
 */
export class PreloadTelemetryLog implements TelemetryMetricWriter {
  private rpcId = 1;

  constructor(private readonly port: PreloadMessagePort) {}

  insertMetric(row: TelemetryMetricRow): void {
    const data: unknown = JSON.parse(row.data);
    this.port.postMessage({
      jsonrpc: "2.0",
      id: this.rpcId,
      method: "telemetry.metric",
      params: {
        attempt: row.attempt,
        ts: row.ts,
        kind: "metric",
        data,
      },
    });
    this.rpcId += 1;
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

/** Row shape of `telemetry.db.telemetry`. Losing a row loses detail, never the pull itself. */
export interface TelemetryRow {
  readonly id: number;
  readonly attempt: string | null;
  readonly ts: number;
  readonly kind: "tool" | "metric" | "warning";
  readonly data: string;
}

export interface TelemetrySink {
  insert(row: Omit<TelemetryRow, "id">): void;
}

export class InMemoryTelemetryStore implements TelemetrySink {
  readonly rows: TelemetryRow[] = [];

  insert(row: Omit<TelemetryRow, "id">): void {
    this.rows.push({ ...row, id: this.rows.length + 1 });
  }
}

/** Stand-in for a telemetry.db that cannot be opened during a degraded run. */
export class UnavailableTelemetryStore implements TelemetrySink {
  insert(): void {
    throw new Error("telemetry.db is unavailable");
  }
}

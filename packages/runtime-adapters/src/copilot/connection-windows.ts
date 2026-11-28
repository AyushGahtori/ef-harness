import type { AccountQuotaSnapshot, ConnectionWindowSchemaRow } from "./types.js";

export interface CopilotWindowRow extends ConnectionWindowSchemaRow {
  readonly cwnd: number;
}

/**
 * In-memory stand-in for `global.db.connection_windows`.
 * The frozen table has no `remaining` / `resetDateUtc` / `overageEnabled` columns.
 * Those fields are kept on the row and called out as a contract request.
 * Swap for Task 014 / Task 140's window repository at integration.
 */
export class ConnectionWindowStore {
  private readonly rows = new Map<string, CopilotWindowRow>();

  upsert(row: CopilotWindowRow): void {
    this.rows.set(windowKey(row.connection, row.window_kind, row.window_start), row);
  }

  latest(connectionId: string): CopilotWindowRow | null {
    let found: CopilotWindowRow | null = null;
    for (const row of this.rows.values()) {
      if (row.connection !== connectionId) continue;
      if (!found || row.observed_at > found.observed_at) found = row;
    }
    return found;
  }

  list(connectionId: string): readonly CopilotWindowRow[] {
    return [...this.rows.values()].filter((row) => row.connection === connectionId);
  }
}

export function quotaWindow(input: {
  readonly connectionId: string;
  readonly quota: AccountQuotaSnapshot;
  readonly observedAt: number;
  readonly cwnd: number;
}): CopilotWindowRow {
  const resetMs = Date.parse(input.quota.resetDateUtc);
  const windowEnd = Number.isFinite(resetMs) ? resetMs : input.observedAt;
  const windowStart = windowEnd - 30 * 24 * 60 * 60 * 1000;
  return {
    connection: input.connectionId,
    window_kind: "monthly",
    window_start: windowStart,
    window_end: windowEnd,
    limit_units: input.quota.entitlement,
    observed_units: Math.max(0, input.quota.entitlement - input.quota.remaining),
    estimated_units: 0,
    source: "account.getQuota",
    observed_at: input.observedAt,
    remaining: input.quota.remaining,
    resetDateUtc: input.quota.resetDateUtc,
    overageEnabled: input.quota.overageEnabled,
    cwnd: input.cwnd,
  };
}

function windowKey(connection: string, kind: string, start: number): string {
  return `${connection}:${kind}:${start}`;
}

import type { GlobalDbGrantStore, GrantCurrency, GrantLeaseRow } from "./types.js";

function poolKey(connectionId: string, currency: GrantCurrency): string {
  return `${connectionId}\0${currency}`;
}

export class InMemoryGlobalGrantStore implements GlobalDbGrantStore {
  private readonly pools = new Map<string, number>();
  private readonly grants = new Map<string, GrantLeaseRow>();
  private locked = false;

  beginImmediate<T>(fn: () => T): T {
    if (this.locked) {
      throw new Error("GlobalDbGrantStore: nested BEGIN IMMEDIATE is not supported.");
    }
    this.locked = true;
    try {
      return fn();
    } finally {
      this.locked = false;
    }
  }

  getPoolRemaining(connectionId: string, currency: GrantCurrency): number {
    return this.pools.get(poolKey(connectionId, currency)) ?? 0;
  }

  setPoolRemaining(connectionId: string, currency: GrantCurrency, units: number): void {
    this.pools.set(poolKey(connectionId, currency), units);
  }

  seedPool(connectionId: string, currency: GrantCurrency, units: number): void {
    this.pools.set(poolKey(connectionId, currency), units);
  }

  insertGrant(row: GrantLeaseRow): void {
    this.grants.set(row.grantId, { ...row });
  }

  listOpenGrants(connectionId: string, currency: GrantCurrency): GrantLeaseRow[] {
    const out: GrantLeaseRow[] = [];
    for (const row of this.grants.values()) {
      if (
        row.connectionId === connectionId &&
        row.currency === currency &&
        (row.state === "issued" || row.state === "deposited")
      ) {
        out.push({ ...row });
      }
    }
    return out;
  }

  updateGrant(row: GrantLeaseRow): void {
    this.grants.set(row.grantId, { ...row });
  }

  reclaimExpired(nowMs: number): number {
    let reclaimed = 0;
    for (const [id, row] of this.grants) {
      if (row.expiresAtMs > nowMs) continue;
      if (row.state === "closed" || row.state === "expired") continue;
      const unused = row.grantedAmount - row.consumedAmount;
      if (unused > 0) {
        const key = poolKey(row.connectionId, row.currency);
        this.pools.set(key, (this.pools.get(key) ?? 0) + unused);
        reclaimed += unused;
      }
      row.state = "expired";
      this.grants.set(id, { ...row });
    }
    return reclaimed;
  }

  getGrant(grantId: string): GrantLeaseRow | undefined {
    const row = this.grants.get(grantId);
    return row ? { ...row } : undefined;
  }
}
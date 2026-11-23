import { InsufficientGrantPoolError } from "./errors.js";
import type {
  GlobalDbGrantStore,
  GrantCurrency,
  GrantIssueInput,
  GrantIssueResult,
  GrantLeaseRow,
  PriorityClass,
} from "./types.js";
import { GRANT_TTL_MS } from "./types.js";

export class CrossProjectGrantLeaseManager {
  private readonly store: GlobalDbGrantStore;
  private grantSeq = 0;

  constructor(store: GlobalDbGrantStore) {
    this.store = store;
  }

  requestGrant(input: GrantIssueInput, priorityClass: PriorityClass = "foreground"): GrantIssueResult {
    return this.store.beginImmediate(() => this.requestGrantInside(input, priorityClass));
  }

  closeGrant(grantId: string, usedAmount: number, nowMs: number): number {
    return this.store.beginImmediate(() => {
      const row = this.store.getGrant(grantId);
      if (!row) return 0;
      if (row.state === "closed" || row.state === "expired") return 0;
      row.consumedAmount = Math.min(usedAmount, row.grantedAmount);
      row.state = "closed";
      this.store.updateGrant(row);
      const unused = row.grantedAmount - row.consumedAmount;
      if (unused > 0) {
        const prev = this.store.getPoolRemaining(row.connectionId, row.currency);
        this.store.setPoolRemaining(row.connectionId, row.currency, prev + unused);
      }
      if (nowMs >= row.expiresAtMs && unused > 0) {
        return unused;
      }
      return unused;
    });
  }

  reclaimExpiredGrants(nowMs: number): number {
    return this.store.reclaimExpired(nowMs);
  }

  totalCommitted(connectionId: string, currency: GrantCurrency): number {
    return this.store
      .listOpenGrants(connectionId, currency)
      .reduce((sum, row) => sum + row.grantedAmount, 0);
  }

  private requestGrantInside(
    input: GrantIssueInput,
    priorityClass: PriorityClass,
  ): GrantIssueResult {
    const pool = this.store.getPoolRemaining(input.connectionId, input.currency);
    if (pool <= 0) {
      throw new InsufficientGrantPoolError(input.connectionId, input.requestedAmount, 0);
    }
    const grantedAmount = Math.min(input.requestedAmount, pool);
    const partial = grantedAmount < input.requestedAmount;
    this.store.setPoolRemaining(input.connectionId, input.currency, pool - grantedAmount);
    const grantId = input.grantId || `grant-${++this.grantSeq}`;
    const row: GrantLeaseRow = {
      grantId,
      projectId: input.projectId,
      connectionId: input.connectionId,
      currency: input.currency,
      grantedAmount,
      consumedAmount: 0,
      issuedAtMs: input.nowMs,
      expiresAtMs: input.nowMs + GRANT_TTL_MS,
      state: "issued",
    };
    this.store.insertGrant(row);
    void priorityClass;
    return { grantId, grantedAmount, partial };
  }
}
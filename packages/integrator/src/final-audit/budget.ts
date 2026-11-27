import { randomUUID } from "node:crypto";
import type { BudgetLedgerRepo, ScopeKind } from "@ef-harness/db";
import { AUDIT_BUDGET_PERCENT, FIX_BUDGET_PERCENT, auditScopeId, fixScopeId, percentOf } from "./constants.js";

export interface Reservation {
  readonly reservationId: string;
  readonly scopeId: string;
  readonly units: bigint;
}

export interface ScopeBudgetSnapshot {
  readonly scopeKind: ScopeKind;
  readonly scopeId: string;
  readonly limitUnits: bigint;
  readonly spentUnits: bigint;
  readonly reservedUnits: bigint;
  readonly remainingUnits: bigint;
  readonly hardStop: boolean;
}

export interface BudgetLedgerPort {
  ensureCompletionScopes(input: { readonly projectId: string; readonly projectLimitUnits: bigint }):
    | {
        readonly auditLimitUnits: bigint;
        readonly fixLimitUnits: bigint;
        readonly auditScopeId: string;
        readonly fixScopeId: string;
      }
    | Promise<{
        readonly auditLimitUnits: bigint;
        readonly fixLimitUnits: bigint;
        readonly auditScopeId: string;
        readonly fixScopeId: string;
      }>;
  getBudgetRemaining(scopeId: string): bigint | Promise<bigint>;
  getScopeSnapshot(scopeKind: ScopeKind, scopeId: string): ScopeBudgetSnapshot | Promise<ScopeBudgetSnapshot>;
  reserveAcrossScopes(input: {
    readonly scopeId: string;
    readonly units: bigint;
    readonly purpose: string;
  }): (Reservation | null) | Promise<Reservation | null>;
  settleReservation(reservationId: string): void | Promise<void>;
  releaseReservation(reservationId: string): void | Promise<void>;
}

interface ScopeState {
  scopeKind: ScopeKind;
  limit: bigint;
  spent: bigint;
  reserved: bigint;
}

interface ReservationState extends Reservation {
  settled: boolean;
}

/**
 * In-memory `BudgetLedgerPort` stand-in implementing `getScopeSnapshot` and enforcing 2%/10% caps.
 * Production callers bind canonical `BudgetLedgerRepo` via `bindBudgetLedgerRepo`.
 */
export class InMemoryBudgetLedger implements BudgetLedgerPort {
  private readonly scopes = new Map<string, ScopeState>();
  private readonly reservations = new Map<string, ReservationState>();
  private nextId = 1;

  ensureCompletionScopes(input: { readonly projectId: string; readonly projectLimitUnits: bigint }): {
    readonly auditLimitUnits: bigint;
    readonly fixLimitUnits: bigint;
    readonly auditScopeId: string;
    readonly fixScopeId: string;
  } {
    const auditLimitUnits = percentOf(input.projectLimitUnits, AUDIT_BUDGET_PERCENT);
    const fixLimitUnits = percentOf(input.projectLimitUnits, FIX_BUDGET_PERCENT);
    const auditId = auditScopeId(input.projectId);
    const fixId = fixScopeId(input.projectId);
    this.put("wave_paperwork", auditId, auditLimitUnits);
    this.put("feature", fixId, fixLimitUnits);
    return { auditLimitUnits, fixLimitUnits, auditScopeId: auditId, fixScopeId: fixId };
  }

  getBudgetRemaining(scopeId: string): bigint {
    const scope = this.scopes.get(scopeId);
    if (!scope) return 0n;
    return scope.limit - scope.spent - scope.reserved;
  }

  getScopeSnapshot(scopeKind: ScopeKind, scopeId: string): ScopeBudgetSnapshot {
    const scope = this.scopes.get(scopeId);
    if (!scope) {
      return {
        scopeKind,
        scopeId,
        limitUnits: 0n,
        spentUnits: 0n,
        reservedUnits: 0n,
        remainingUnits: 0n,
        hardStop: true,
      };
    }
    const remaining = scope.limit - scope.spent - scope.reserved;
    return {
      scopeKind: scope.scopeKind,
      scopeId,
      limitUnits: scope.limit,
      spentUnits: scope.spent,
      reservedUnits: scope.reserved,
      remainingUnits: remaining,
      hardStop: remaining <= 0n,
    };
  }

  reserveAcrossScopes(input: { readonly scopeId: string; readonly units: bigint; readonly purpose: string }): Reservation | null {
    if (input.units < 0n) return null;
    void input.purpose;
    const scope = this.scopes.get(input.scopeId);
    if (!scope) return null;
    if (scope.limit - scope.spent - scope.reserved < input.units) return null;
    scope.reserved += input.units;
    const reservationId = `rsv-${this.nextId}`;
    this.nextId += 1;
    const reservation = { reservationId, scopeId: input.scopeId, units: input.units, settled: false };
    this.reservations.set(reservationId, reservation);
    return { reservationId, scopeId: input.scopeId, units: input.units };
  }

  settleReservation(reservationId: string): void {
    const reservation = this.reservations.get(reservationId);
    const scope = reservation ? this.scopes.get(reservation.scopeId) : undefined;
    if (!reservation || !scope || reservation.settled) {
      throw new Error(`unknown reservation ${reservationId}`);
    }
    scope.reserved -= reservation.units;
    scope.spent += reservation.units;
    reservation.settled = true;
  }

  releaseReservation(reservationId: string): void {
    const reservation = this.reservations.get(reservationId);
    const scope = reservation ? this.scopes.get(reservation.scopeId) : undefined;
    if (!reservation || !scope || reservation.settled) return;
    scope.reserved -= reservation.units;
    reservation.settled = true;
  }

  spent(scopeId: string): bigint {
    return this.scopes.get(scopeId)?.spent ?? 0n;
  }

  private put(scopeKind: ScopeKind, scopeId: string, limit: bigint): void {
    const existing = this.scopes.get(scopeId);
    if (existing) return;
    this.scopes.set(scopeId, { scopeKind, limit, spent: 0n, reserved: 0n });
  }
}

export interface BudgetLedgerRepoBindingOptions {
  readonly currency?: string;
  readonly waveOrdinal?: number;
  readonly waveId?: string;
  readonly now?: () => number;
}

/**
 * Binds canonical `@ef-harness/db` `BudgetLedgerRepo` (`C09`), using real
 * `getScopeSnapshot(scopeKind, scopeId)`, `reserveAcrossScopes`, `settleReservation`,
 * and `releaseReservation` on `ProjectStateDb`.
 */
export function bindBudgetLedgerRepo(
  repo: BudgetLedgerRepo,
  options: BudgetLedgerRepoBindingOptions = {},
): BudgetLedgerPort {
  const currency = options.currency ?? "usd";
  const waveOrdinal = options.waveOrdinal ?? 9999;
  const now = options.now ?? (() => Date.now());
  const scopeKinds = new Map<string, ScopeKind>();
  const reservedAmounts = new Map<string, number>();

  const toNumber = (units: bigint): number => {
    if (units > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`Budget units ${units.toString()} exceed safe integer range.`);
    }
    return Number(units);
  };

  const ensureScope = (
    scopeKind: ScopeKind,
    scopeId: string,
    limitUnits: number,
    parent?: { readonly kind: ScopeKind; readonly id: string },
  ): void => {
    scopeKinds.set(scopeId, scopeKind);
    const existing = repo.getBudgetRemaining(scopeKind, scopeId).find((row) => row.currency === currency);
    if (existing) return;
    repo.createBudgetScope({
      scopeKind,
      scopeId,
      currency,
      limitUnits,
      ...(parent ? { parentKind: parent.kind, parentId: parent.id } : {}),
    });
  };

  return {
    async ensureCompletionScopes(input) {
      repo.registerCurrency(currency);
      const projectLimit = toNumber(input.projectLimitUnits);
      const auditLimitUnits = percentOf(input.projectLimitUnits, AUDIT_BUDGET_PERCENT);
      const fixLimitUnits = percentOf(input.projectLimitUnits, FIX_BUDGET_PERCENT);
      const sanitizedWave = (options.waveId ?? input.projectId).replace(/[^A-Za-z0-9._-]/g, "-");
      const auditId = `w:${waveOrdinal}:${sanitizedWave}:audit`;
      const fixId = fixScopeId(input.projectId);
      ensureScope("project", input.projectId, projectLimit);
      ensureScope("wave_paperwork", auditId, toNumber(auditLimitUnits), {
        kind: "project",
        id: input.projectId,
      });
      ensureScope("feature", fixId, toNumber(fixLimitUnits), {
        kind: "project",
        id: input.projectId,
      });
      return {
        auditLimitUnits,
        fixLimitUnits,
        auditScopeId: auditId,
        fixScopeId: fixId,
      };
    },
    async getScopeSnapshot(scopeKind, scopeId) {
      const effectiveKind = scopeKinds.get(scopeId) ?? scopeKind;
      const snap = repo.getScopeSnapshot(effectiveKind, scopeId);
      const row = snap.currencies.find((item) => item.currency === currency) ?? snap.currencies[0];
      if (!row) {
        return {
          scopeKind: effectiveKind,
          scopeId,
          limitUnits: 0n,
          spentUnits: 0n,
          reservedUnits: 0n,
          remainingUnits: 0n,
          hardStop: true,
        };
      }
      return {
        scopeKind: effectiveKind,
        scopeId,
        limitUnits: BigInt(row.limitUnits),
        spentUnits: BigInt(row.spentUnits),
        reservedUnits: BigInt(row.reservedUnits),
        remainingUnits: BigInt(row.remainingUnits),
        hardStop: snap.hardStop,
      };
    },
    async getBudgetRemaining(scopeId) {
      const effectiveKind = scopeKinds.get(scopeId) ?? (scopeId.startsWith("w:") ? "wave_paperwork" : "feature");
      const snap = repo.getScopeSnapshot(effectiveKind, scopeId);
      const row = snap.currencies.find((item) => item.currency === currency) ?? snap.currencies[0];
      return row ? BigInt(row.remainingUnits) : 0n;
    },
    async reserveAcrossScopes(input) {
      if (input.units < 0n) return null;
      const effectiveKind =
        scopeKinds.get(input.scopeId) ??
        (input.scopeId.startsWith("w:") || input.purpose === "final_audit" ? "wave_paperwork" : "feature");
      const purpose = effectiveKind === "wave_paperwork" ? "paperwork" : "model_call";
      const amountUnits = toNumber(input.units);
      const reservationId = `fin-${randomUUID()}`;
      const res = repo.reserveAcrossScopes({
        reservationId,
        purpose,
        currency,
        amountUnits,
        scopeKind: effectiveKind,
        scopeId: input.scopeId,
        createdAt: now(),
      });
      if (!res.ok) return null;
      reservedAmounts.set(reservationId, amountUnits);
      return { reservationId, scopeId: input.scopeId, units: input.units };
    },
    async settleReservation(reservationId) {
      const actualUnits = reservedAmounts.get(reservationId) ?? 0;
      const res = repo.settleReservation({ reservationId, actualUnits, now: now() });
      if (!res.ok) {
        throw new Error(`unable to settle reservation ${reservationId}: ${res.reason}`);
      }
    },
    async releaseReservation(reservationId) {
      repo.releaseReservation(reservationId);
    },
  };
}

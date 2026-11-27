import { auditScopeId, fixScopeId, percentOf, AUDIT_BUDGET_PERCENT, FIX_BUDGET_PERCENT } from "./constants.js";

export interface Reservation {
  readonly reservationId: string;
  readonly scopeId: string;
  readonly units: bigint;
}

export interface BudgetLedgerPort {
  ensureCompletionScopes(input: { readonly projectId: string; readonly projectLimitUnits: bigint }): {
    readonly auditLimitUnits: bigint;
    readonly fixLimitUnits: bigint;
    readonly auditScopeId: string;
    readonly fixScopeId: string;
  };
  getBudgetRemaining(scopeId: string): bigint;
  reserveAcrossScopes(input: { readonly scopeId: string; readonly units: bigint; readonly purpose: string }): Reservation | null;
  settleReservation(reservationId: string): void;
  releaseReservation(reservationId: string): void;
}

interface ScopeState {
  limit: bigint;
  spent: bigint;
  reserved: bigint;
}

interface ReservationState extends Reservation {
  settled: boolean;
}

/**
 * Local port of Task 023 `BudgetLedger` / `BudgetLedgerRepo`.
 * Completion-wave audit paperwork is 2% and audit fixes are 10% of the project limit.
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
    this.put(auditId, auditLimitUnits);
    this.put(fixId, fixLimitUnits);
    return { auditLimitUnits, fixLimitUnits, auditScopeId: auditId, fixScopeId: fixId };
  }

  getBudgetRemaining(scopeId: string): bigint {
    const scope = this.scopes.get(scopeId);
    if (!scope) return 0n;
    return scope.limit - scope.spent - scope.reserved;
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

  private put(scopeId: string, limit: bigint): void {
    const existing = this.scopes.get(scopeId);
    if (existing) return;
    this.scopes.set(scopeId, { limit, spent: 0n, reserved: 0n });
  }
}

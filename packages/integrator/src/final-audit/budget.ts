import {
  bindBudgetLedger,
  BudgetScopeExistsError,
  type BudgetLedgerRepo,
  type ProjectStateDb,
  type ScopeKind,
} from "@ef-harness/db";

import { auditScopeId, fixScopeId, percentOf, AUDIT_BUDGET_PERCENT, FIX_BUDGET_PERCENT } from "./constants.js";

export interface Reservation {
  readonly reservationId: string;
  readonly scopeId: string;
  readonly units: bigint;
}

export interface BudgetScopeView {
  readonly scopeId: string;
  readonly remainingUnits: bigint;
  readonly hardStop: boolean;
}

export interface BudgetLedgerPort {
  ensureCompletionScopes(input: { readonly projectId: string; readonly projectLimitUnits: bigint }): {
    readonly auditLimitUnits: bigint;
    readonly fixLimitUnits: bigint;
    readonly auditScopeId: string;
    readonly fixScopeId: string;
  };
  getScopeSnapshot(scopeId: string): BudgetScopeView;
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

  getScopeSnapshot(scopeId: string): BudgetScopeView {
    const remainingUnits = this.getBudgetRemaining(scopeId);
    return { scopeId, remainingUnits, hardStop: remainingUnits <= 0n };
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

interface EnsuredScopes {
  readonly auditLimitUnits: bigint;
  readonly fixLimitUnits: bigint;
  readonly auditScopeId: string;
  readonly fixScopeId: string;
}

/**
 * Completion-wave paperwork on `BudgetLedgerRepo`.
 * Audit is 2% and fixes are 10%. Remaining spend is read from `getScopeSnapshot`.
 */
export class ProjectStateBudgetLedger implements BudgetLedgerPort {
  private readonly kinds = new Map<string, ScopeKind>();
  private nextId = 1;
  private readonly held = new Map<string, Reservation>();

  constructor(private readonly ledger: BudgetLedgerRepo) {}

  static open(state: ProjectStateDb): ProjectStateBudgetLedger {
    const ledger = bindBudgetLedger(state);
    ledger.registerCurrency("usd");
    return new ProjectStateBudgetLedger(ledger);
  }

  ensureCompletionScopes(input: { readonly projectId: string; readonly projectLimitUnits: bigint }): EnsuredScopes {
    const auditLimitUnits = percentOf(input.projectLimitUnits, AUDIT_BUDGET_PERCENT);
    const fixLimitUnits = percentOf(input.projectLimitUnits, FIX_BUDGET_PERCENT);
    const auditId = auditScopeId(input.projectId);
    const fixId = fixScopeId(input.projectId);
    this.ensureScope("project", input.projectId, input.projectLimitUnits);
    this.ensureScope("feature", auditId, auditLimitUnits, input.projectId);
    this.ensureScope("feature", fixId, fixLimitUnits, input.projectId);
    this.kinds.set(input.projectId, "project");
    this.kinds.set(auditId, "feature");
    this.kinds.set(fixId, "feature");
    return { auditLimitUnits, fixLimitUnits, auditScopeId: auditId, fixScopeId: fixId };
  }

  getScopeSnapshot(scopeId: string): BudgetScopeView {
    const kind = this.kinds.get(scopeId);
    if (!kind) return { scopeId, remainingUnits: 0n, hardStop: true };
    const snapshot = this.ledger.getScopeSnapshot(kind, scopeId);
    const row = snapshot.currencies.find((currency) => currency.currency === "usd") ?? snapshot.currencies[0];
    const remainingUnits = row ? BigInt(row.remainingUnits) : 0n;
    return { scopeId, remainingUnits, hardStop: snapshot.hardStop || remainingUnits <= 0n };
  }

  getBudgetRemaining(scopeId: string): bigint {
    return this.getScopeSnapshot(scopeId).remainingUnits;
  }

  reserveAcrossScopes(input: { readonly scopeId: string; readonly units: bigint; readonly purpose: string }): Reservation | null {
    if (input.units < 0n) return null;
    const kind = this.kinds.get(input.scopeId);
    if (!kind) return null;
    const reservationId = `rsv-${this.nextId}`;
    this.nextId += 1;
    if (input.units === 0n) {
      const reservation = { reservationId, scopeId: input.scopeId, units: 0n };
      this.held.set(reservationId, reservation);
      return reservation;
    }
    if (input.units > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    const amountUnits = Number(input.units);
    const result = this.ledger.reserveAcrossScopes({
      reservationId,
      purpose: "effect",
      currency: "usd",
      amountUnits,
      scopeKind: kind,
      scopeId: input.scopeId,
      createdAt: Date.now(),
    });
    if (!result.ok) return null;
    void input.purpose;
    const reservation = { reservationId, scopeId: input.scopeId, units: input.units };
    this.held.set(reservationId, reservation);
    return reservation;
  }

  settleReservation(reservationId: string): void {
    const held = this.held.get(reservationId);
    if (!held) throw new Error(`unknown reservation ${reservationId}`);
    this.held.delete(reservationId);
    if (held.units === 0n) return;
    const result = this.ledger.settleReservation({
      reservationId,
      actualUnits: Number(held.units),
      now: Date.now(),
    });
    if (!result.ok) throw new Error(`unknown reservation ${reservationId}`);
  }

  releaseReservation(reservationId: string): void {
    const held = this.held.get(reservationId);
    if (!held) return;
    this.held.delete(reservationId);
    if (held.units === 0n) return;
    this.ledger.releaseReservation(reservationId);
  }

  private ensureScope(kind: ScopeKind, scopeId: string, limit: bigint, parentId?: string): void {
    if (limit > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`budget limit for ${scopeId} exceeds a safe integer`);
    }
    try {
      if (parentId === undefined) {
        this.ledger.createBudgetScope({
          scopeKind: kind,
          scopeId,
          currency: "usd",
          limitUnits: Number(limit),
        });
        return;
      }
      this.ledger.createBudgetScope({
        scopeKind: kind,
        scopeId,
        currency: "usd",
        limitUnits: Number(limit),
        parentKind: "project",
        parentId,
      });
    } catch (error) {
      if (error instanceof BudgetScopeExistsError) return;
      throw error;
    }
  }
}

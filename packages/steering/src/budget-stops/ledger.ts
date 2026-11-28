import {
  bindBudgetLedger,
  BudgetLedgerRepo,
  BudgetScopeExistsError,
  type ProjectStateDb,
} from "@ef-harness/db";

import { readingFromSides, stepFor, stepRank, assertSafeUnit, percentOf } from "./money.js";
import { openPrivateProjectState } from "./state-handle.js";
import type { CurrencyKind, CurrencySnapshot, LadderReading, ReserveResult } from "./types.js";

const USD_SCOPE = "wind-down";
const PPM_CURRENCY = "allowance:window";

/**
 * Subscription ppm left on the active connection.
 * C54 binds this to `GlobalConnectionWindowRepo`. Until then the project ppm scope is the window.
 */
export interface AllowanceWindowPort {
  remainingPpm(connectionId: string): number | null;
}

export interface LedgerLimits {
  readonly microUsdLimit: number | null;
  readonly ppmLimit: number | null;
  readonly state?: ProjectStateDb;
  readonly allowance?: AllowanceWindowPort;
  readonly connectionId?: string;
}

interface HeldReservation {
  readonly id: string;
  readonly currency: CurrencyKind;
  readonly ceilingUnits: number;
}

/**
 * Reservations are `BudgetLedgerRepo` rows on the open `ProjectStateDb`.
 * The in-memory map only remembers which currency a held id belongs to.
 */
export class AtomicBudgetReservationLedger {
  private readonly state: ProjectStateDb;
  private readonly owns: boolean;
  private readonly repo: BudgetLedgerRepo;
  private readonly allowance: AllowanceWindowPort | null;
  private readonly connectionId: string | null;
  private readonly held = new Map<string, HeldReservation>();
  private nextId: number;
  private ppmScope: string | null;
  private ppmEpoch = 1;
  private chain: Promise<void> = Promise.resolve();

  constructor(limits: LedgerLimits) {
    if (limits.microUsdLimit !== null) assertSafeUnit(limits.microUsdLimit, "micro-USD limit");
    if (limits.ppmLimit !== null) assertSafeUnit(limits.ppmLimit, "ppm limit");
    if (limits.state) {
      this.state = limits.state;
      this.owns = false;
    } else {
      this.state = openPrivateProjectState("ef-budget");
      this.owns = true;
    }
    this.repo = bindBudgetLedger(this.state);
    this.allowance = limits.allowance ?? null;
    this.connectionId = limits.connectionId ?? null;
    this.ppmScope = limits.ppmLimit === null ? null : "wind-down-ppm";
    if (limits.microUsdLimit !== null) this.ensureScope(USD_SCOPE, "usd", limits.microUsdLimit);
    if (limits.ppmLimit !== null && this.ppmScope) this.ensureScope(this.ppmScope, PPM_CURRENCY, limits.ppmLimit);
    this.nextId = this.readNextId();
  }

  snapshot(currency: CurrencyKind): CurrencySnapshot | null {
    if (currency === "micro-usd") return this.scopeSnapshot(USD_SCOPE, "usd", "micro-usd");
    return this.ppmSnapshot();
  }

  ladder(): LadderReading {
    const sides: CurrencySnapshot[] = [];
    const micro = this.snapshot("micro-usd");
    const ppm = this.snapshot("ppm");
    if (micro) sides.push(micro);
    if (ppm) sides.push(ppm);
    return readingFromSides(sides);
  }

  remaining(currency: CurrencyKind): number {
    const snap = this.snapshot(currency);
    return snap ? snap.remaining : 0;
  }

  limit(currency: CurrencyKind): number | null {
    const snap = this.snapshot(currency);
    return snap ? snap.limit : null;
  }

  postHistoricalSpend(currency: CurrencyKind, units: number): void {
    assertSafeUnit(units, "historical spend");
    const snap = this.requireSnapshot(currency);
    if (snap.spent + snap.reserved + units > snap.limit) {
      throw new Error("historical spend would pass the cap");
    }
    this.settleNow(currency, units);
  }

  raiseMicroUsdLimit(delta: number): void {
    assertSafeUnit(delta, "budget delta");
    if (delta <= 0) throw new Error("budget delta must be positive");
    const snap = this.requireSnapshot("micro-usd");
    this.repo.raiseBudgetLimit("project", USD_SCOPE, "usd", snap.limit + delta);
  }

  setPpmSpent(units: number): void {
    assertSafeUnit(units, "ppm spend");
    const snap = this.requireSnapshot("ppm");
    if (snap.reserved !== 0) throw new Error("ppm reservations are still held");
    if (units > snap.limit) throw new Error("ppm spend would pass the allowance");
    if (units === snap.spent) return;
    if (units > snap.spent) {
      this.settleNow("ppm", units - snap.spent);
      return;
    }
    const limit = snap.limit;
    this.ppmEpoch += 1;
    const scopeId = `wind-down-ppm-${this.ppmEpoch}`;
    this.ensureScope(scopeId, PPM_CURRENCY, limit);
    this.ppmScope = scopeId;
    if (units > 0) this.settleNow("ppm", units);
  }

  async reserve(input: {
    readonly workerId: string;
    readonly currency: CurrencyKind;
    readonly ceilingUnits: number;
  }): Promise<ReserveResult> {
    return this.exclusive(() => this.reserveUnlocked(input));
  }

  settle(reservationId: string, actualUnits: number): void {
    assertSafeUnit(actualUnits, "actual spend");
    const reservation = this.requireHeld(reservationId);
    if (actualUnits > reservation.ceilingUnits) {
      throw new Error("actual spend exceeds the reserved worst-case ceiling");
    }
    const settled = this.repo.settleReservation({
      reservationId,
      actualUnits,
      now: Date.now(),
    });
    if (!settled.ok) throw new Error(`unknown reservation ${reservationId}`);
    this.held.delete(reservationId);
  }

  release(reservationId: string): void {
    if (!this.held.has(reservationId) && !this.repo.getReservation(reservationId)) return;
    const released = this.repo.releaseReservation(reservationId);
    if (!released.ok && released.reason !== "missing") {
      throw new Error(`unknown reservation ${reservationId}`);
    }
    this.held.delete(reservationId);
  }

  heldCount(): number {
    return this.countHeld(USD_SCOPE) + this.countHeld(this.ppmScope);
  }

  close(): void {
    if (this.owns) this.state.close();
  }

  private reserveUnlocked(input: {
    readonly workerId: string;
    readonly currency: CurrencyKind;
    readonly ceilingUnits: number;
  }): ReserveResult {
    assertSafeUnit(input.ceilingUnits, "ceiling");
    if (input.ceilingUnits <= 0) throw new Error("ceiling must be positive");
    const snap = this.requireSnapshot(input.currency);
    const committed = snap.spent + snap.reserved;
    const fits = committed + input.ceilingUnits <= snap.limit;
    const windDown =
      stepRank(stepFor(committed, snap.limit)) >= stepRank("wind_down_90") ||
      (!fits && stepRank(stepFor(committed, snap.limit)) >= stepRank("wind_down_90"));
    if (!fits) {
      const after = stepFor(committed, snap.limit);
      return {
        ok: false,
        reservationId: null,
        reason: "over_ceiling",
        windDown: stepRank(after) >= stepRank("wind_down_90"),
        currency: input.currency,
        ceilingUnits: input.ceilingUnits,
      };
    }
    const id = `rsv-${this.nextId}`;
    this.nextId += 1;
    const scopeId = this.scopeId(input.currency);
    const currencyCode = input.currency === "micro-usd" ? "usd" : PPM_CURRENCY;
    const reserved = this.repo.reserveAcrossScopes({
      reservationId: id,
      purpose: "model_call",
      currency: currencyCode,
      amountUnits: input.ceilingUnits,
      scopeKind: "project",
      scopeId,
      createdAt: Date.now(),
    });
    if (!reserved.ok) {
      const after = stepFor(committed, snap.limit);
      return {
        ok: false,
        reservationId: null,
        reason: "over_ceiling",
        windDown: stepRank(after) >= stepRank("wind_down_90"),
        currency: input.currency,
        ceilingUnits: input.ceilingUnits,
      };
    }
    this.held.set(id, { id, currency: input.currency, ceilingUnits: input.ceilingUnits });
    const landed = this.requireSnapshot(input.currency);
    return {
      ok: true,
      reservationId: id,
      reason: "held",
      windDown: stepRank(landed.step) >= stepRank("wind_down_90") || windDown,
      currency: input.currency,
      ceilingUnits: input.ceilingUnits,
    };
  }

  private settleNow(currency: CurrencyKind, units: number): void {
    if (units === 0) return;
    const id = `rsv-${this.nextId}`;
    this.nextId += 1;
    const scopeId = this.scopeId(currency);
    const currencyCode = currency === "micro-usd" ? "usd" : PPM_CURRENCY;
    const now = Date.now();
    const reserved = this.repo.reserveAcrossScopes({
      reservationId: id,
      purpose: "model_call",
      currency: currencyCode,
      amountUnits: units,
      scopeKind: "project",
      scopeId,
      createdAt: now,
    });
    if (!reserved.ok) throw new Error("historical spend would pass the cap");
    const settled = this.repo.settleReservation({ reservationId: id, actualUnits: units, now });
    if (!settled.ok) throw new Error("historical spend would pass the cap");
  }

  private ppmSnapshot(): CurrencySnapshot | null {
    const base = this.ppmScope ? this.scopeSnapshot(this.ppmScope, PPM_CURRENCY, "ppm") : null;
    const windowRemaining = this.windowRemaining();
    if (windowRemaining === null) return base;
    if (!base) {
      return {
        currency: "ppm",
        spent: 0,
        reserved: 0,
        limit: windowRemaining,
        remaining: windowRemaining,
        committed: 0,
        percent: percentOf(0, windowRemaining),
        step: stepFor(0, windowRemaining),
      };
    }
    const remaining = Math.min(base.remaining, windowRemaining);
    const committed = base.limit - remaining;
    return {
      currency: "ppm",
      spent: base.spent,
      reserved: base.reserved,
      limit: base.limit,
      remaining,
      committed,
      percent: percentOf(committed, base.limit),
      step: stepFor(committed, base.limit),
    };
  }

  private windowRemaining(): number | null {
    if (!this.allowance || !this.connectionId) return null;
    return this.allowance.remainingPpm(this.connectionId);
  }

  private scopeSnapshot(scopeId: string, currencyCode: string, currency: CurrencyKind): CurrencySnapshot | null {
    const row = this.repo.getBudgetRemaining("project", scopeId).find((item) => item.currency === currencyCode);
    if (!row) return null;
    const committed = row.spentUnits + row.reservedUnits;
    return {
      currency,
      spent: row.spentUnits,
      reserved: row.reservedUnits,
      limit: row.limitUnits,
      remaining: row.remainingUnits,
      committed,
      percent: percentOf(committed, row.limitUnits),
      step: stepFor(committed, row.limitUnits),
    };
  }

  private requireSnapshot(currency: CurrencyKind): CurrencySnapshot {
    const snap = this.snapshot(currency);
    if (!snap) throw new Error(`no ${currency} cap is configured`);
    return snap;
  }

  private scopeId(currency: CurrencyKind): string {
    if (currency === "micro-usd") return USD_SCOPE;
    if (!this.ppmScope) throw new Error("no ppm cap is configured");
    return this.ppmScope;
  }

  private ensureScope(scopeId: string, currency: string, limit: number): void {
    this.repo.registerCurrency(currency);
    try {
      this.repo.createBudgetScope({
        scopeKind: "project",
        scopeId,
        currency,
        limitUnits: limit,
      });
    } catch (error) {
      if (!(error instanceof BudgetScopeExistsError)) throw error;
    }
  }

  private requireHeld(reservationId: string): HeldReservation {
    const cached = this.held.get(reservationId);
    if (cached) return cached;
    const row = this.repo.getReservation(reservationId);
    if (!row || row.state !== "held") throw new Error(`unknown reservation ${reservationId}`);
    const currency: CurrencyKind = row.currency === "usd" ? "micro-usd" : "ppm";
    return { id: reservationId, currency, ceilingUnits: row.amountUnits };
  }

  private countHeld(scopeId: string | null): number {
    if (!scopeId) return 0;
    const row = this.state.writer
      .prepare(
        `SELECT count(*) AS n FROM reservations r
           JOIN reservation_scopes s ON s.reservation = r.id
          WHERE r.state = 'held' AND s.scope_kind = 'project' AND s.scope_id = ?`,
      )
      .get([scopeId]) as { n?: number | bigint } | undefined;
    return Number(row?.n ?? 0);
  }

  private readNextId(): number {
    const rows = this.state.writer.prepare("SELECT id FROM reservations").all() as Array<{ id?: string }>;
    let max = 0;
    for (const row of rows) {
      const match = /^rsv-(\d+)$/.exec(row.id ?? "");
      if (!match?.[1]) continue;
      max = Math.max(max, Number(match[1]));
    }
    return max + 1;
  }

  private async exclusive<T>(fn: () => T): Promise<T> {
    const previous = this.chain;
    let release: () => void = () => undefined;
    this.chain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return fn();
    } finally {
      release();
    }
  }
}

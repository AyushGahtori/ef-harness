import { readingFromSides, stepFor, stepRank, assertSafeUnit, percentOf } from "./money.js";
import type { CurrencyKind, CurrencySnapshot, LadderReading, ReserveResult } from "./types.js";

interface HeldReservation {
  readonly id: string;
  readonly workerId: string;
  readonly currency: CurrencyKind;
  readonly ceilingUnits: number;
}

interface SideState {
  limit: number | null;
  spent: number;
  reserved: number;
}

export interface LedgerLimits {
  readonly microUsdLimit: number | null;
  readonly ppmLimit: number | null;
}

/**
 * Local stand-in for Task 023 `BudgetLedgerRepo.reserveAcrossScopes`.
 * Reservations hold the worst-case turn ceiling so parallel settles cannot pass 100%.
 * Swap `reserve`, `settle`, and `release` to the ledger repo at integration.
 */
export class AtomicBudgetReservationLedger {
  private readonly micro: SideState;
  private readonly ppm: SideState;
  private readonly held = new Map<string, HeldReservation>();
  private nextId = 1;
  private chain: Promise<void> = Promise.resolve();

  constructor(limits: LedgerLimits) {
    if (limits.microUsdLimit !== null) assertSafeUnit(limits.microUsdLimit, "micro-USD limit");
    if (limits.ppmLimit !== null) assertSafeUnit(limits.ppmLimit, "ppm limit");
    this.micro = { limit: limits.microUsdLimit, spent: 0, reserved: 0 };
    this.ppm = { limit: limits.ppmLimit, spent: 0, reserved: 0 };
  }

  snapshot(currency: CurrencyKind): CurrencySnapshot | null {
    const side = this.side(currency);
    if (side.limit === null) return null;
    const committed = side.spent + side.reserved;
    return {
      currency,
      spent: side.spent,
      reserved: side.reserved,
      limit: side.limit,
      remaining: side.limit - committed,
      committed,
      percent: percentOf(committed, side.limit),
      step: stepFor(committed, side.limit),
    };
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
    return this.side(currency).limit;
  }

  postHistoricalSpend(currency: CurrencyKind, units: number): void {
    assertSafeUnit(units, "historical spend");
    const side = this.requireSide(currency);
    if (side.spent + side.reserved + units > side.limit) {
      throw new Error("historical spend would pass the cap");
    }
    side.spent += units;
  }

  raiseMicroUsdLimit(delta: number): void {
    assertSafeUnit(delta, "budget delta");
    if (delta <= 0) throw new Error("budget delta must be positive");
    const side = this.requireSide("micro-usd");
    side.limit += delta;
  }

  setPpmSpent(units: number): void {
    assertSafeUnit(units, "ppm spend");
    const side = this.requireSide("ppm");
    if (side.reserved !== 0) throw new Error("ppm reservations are still held");
    if (units > side.limit) throw new Error("ppm spend would pass the allowance");
    side.spent = units;
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
    const reservation = this.held.get(reservationId);
    if (!reservation) throw new Error(`unknown reservation ${reservationId}`);
    if (actualUnits > reservation.ceilingUnits) {
      throw new Error("actual spend exceeds the reserved worst-case ceiling");
    }
    const side = this.requireSide(reservation.currency);
    side.reserved -= reservation.ceilingUnits;
    side.spent += actualUnits;
    this.held.delete(reservationId);
  }

  release(reservationId: string): void {
    const reservation = this.held.get(reservationId);
    if (!reservation) return;
    const side = this.requireSide(reservation.currency);
    side.reserved -= reservation.ceilingUnits;
    this.held.delete(reservationId);
  }

  heldCount(): number {
    return this.held.size;
  }

  private reserveUnlocked(input: {
    readonly workerId: string;
    readonly currency: CurrencyKind;
    readonly ceilingUnits: number;
  }): ReserveResult {
    assertSafeUnit(input.ceilingUnits, "ceiling");
    if (input.ceilingUnits <= 0) throw new Error("ceiling must be positive");
    const side = this.requireSide(input.currency);
    const committed = side.spent + side.reserved;
    const fits = committed + input.ceilingUnits <= side.limit;
    const windDown = stepRank(stepFor(committed, side.limit)) >= stepRank("wind_down_90") || !fits && stepRank(stepFor(committed, side.limit)) >= stepRank("wind_down_90");
    if (!fits) {
      const after = stepFor(committed, side.limit);
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
    side.reserved += input.ceilingUnits;
    this.held.set(id, {
      id,
      workerId: input.workerId,
      currency: input.currency,
      ceilingUnits: input.ceilingUnits,
    });
    const landed = stepFor(side.spent + side.reserved, side.limit);
    return {
      ok: true,
      reservationId: id,
      reason: "held",
      windDown: stepRank(landed) >= stepRank("wind_down_90") || windDown,
      currency: input.currency,
      ceilingUnits: input.ceilingUnits,
    };
  }

  private side(currency: CurrencyKind): SideState {
    return currency === "micro-usd" ? this.micro : this.ppm;
  }

  private requireSide(currency: CurrencyKind): SideState & { limit: number } {
    const side = this.side(currency);
    if (side.limit === null) throw new Error(`no ${currency} cap is configured`);
    return side as SideState & { limit: number };
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

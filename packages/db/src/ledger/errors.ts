export class NonIntegerCurrencyUnitsError extends Error {
  readonly amount: unknown;

  constructor(amount: unknown) {
    super("Currency units must be a non-negative safe integer");
    this.name = "NonIntegerCurrencyUnitsError";
    this.amount = amount;
  }
}

export class LedgerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerInputError";
  }
}

export class ReservationAmountError extends Error {
  readonly amountUnits: number;

  constructor(amountUnits: number, message: string) {
    super(message);
    this.name = "ReservationAmountError";
    this.amountUnits = amountUnits;
  }
}

export class CurrencyNotRegisteredError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`Currency ${code} is not registered`);
    this.name = "CurrencyNotRegisteredError";
    this.code = code;
  }
}

export class CurrencyDefinitionConflictError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`Currency ${code} is already registered with a different unit or scale`);
    this.name = "CurrencyDefinitionConflictError";
    this.code = code;
  }
}

export class MissingBudgetScopeError extends Error {
  readonly scopeKind: string;
  readonly scopeId: string;
  readonly currency: string;

  constructor(scopeKind: string, scopeId: string, currency: string) {
    super(`Missing budget scope ${scopeKind}:${scopeId} for ${currency}`);
    this.name = "MissingBudgetScopeError";
    this.scopeKind = scopeKind;
    this.scopeId = scopeId;
    this.currency = currency;
  }
}

export class BudgetScopeExistsError extends Error {
  readonly scopeKind: string;
  readonly scopeId: string;
  readonly currency: string;

  constructor(scopeKind: string, scopeId: string, currency: string) {
    super(`Budget scope ${scopeKind}:${scopeId} already exists for ${currency}`);
    this.name = "BudgetScopeExistsError";
    this.scopeKind = scopeKind;
    this.scopeId = scopeId;
    this.currency = currency;
  }
}

export class ScopeBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeBindingError";
  }
}

export class CrossWaveBorrowError extends Error {
  readonly activeWaveId: string;
  readonly targetWaveId: string;

  constructor(activeWaveId: string, targetWaveId: string) {
    super(
      `Borrowing from later wave ${targetWaveId} while ${activeWaveId} is active requires explicit approval`,
    );
    this.name = "CrossWaveBorrowError";
    this.activeWaveId = activeWaveId;
    this.targetWaveId = targetWaveId;
  }
}

export class ReservationExistsError extends Error {
  readonly reservationId: string;

  constructor(reservationId: string) {
    super(`Reservation ${reservationId} already exists`);
    this.name = "ReservationExistsError";
    this.reservationId = reservationId;
  }
}

export class BudgetLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetLimitError";
  }
}

export class LedgerInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerInvariantError";
  }
}

export class LedgerCycleError extends Error {
  constructor(scopeKind: string, scopeId: string) {
    super(`Budget parent cycle detected at ${scopeKind}:${scopeId}`);
    this.name = "LedgerCycleError";
  }
}

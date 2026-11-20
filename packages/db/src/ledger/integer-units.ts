import { NonIntegerCurrencyUnitsError } from "./errors.js";

export function assertNonNegativeIntegerUnits(amount: unknown): asserts amount is number {
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) {
    throw new NonIntegerCurrencyUnitsError(amount);
  }
}

export function lacksHeadroom(
  reservedUnits: number,
  spentUnits: number,
  amountUnits: number,
  limitUnits: number,
): boolean {
  return (
    BigInt(reservedUnits) + BigInt(spentUnits) + BigInt(amountUnits) > BigInt(limitUnits)
  );
}

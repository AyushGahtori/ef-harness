import { InvalidGrantIdentifierError, NonIntegerUnitsError } from "./errors.js";

export function assertSafeInteger(value: number, field: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new NonIntegerUnitsError(field);
  }
}

export function assertNonNegativeInteger(value: number, field: string): void {
  assertSafeInteger(value, field);
  if (value < 0) {
    throw new NonIntegerUnitsError(field);
  }
}

export function assertPositiveInteger(value: number, field: string): void {
  assertSafeInteger(value, field);
  if (value <= 0) {
    throw new NonIntegerUnitsError(field);
  }
}

export function assertIdentifier(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 200) {
    throw new InvalidGrantIdentifierError(field);
  }
  if (value.includes("\0")) {
    throw new InvalidGrantIdentifierError(field);
  }
}

export function addSafe(left: number, right: number, field: string): number {
  assertSafeInteger(left, field);
  assertSafeInteger(right, field);
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    throw new NonIntegerUnitsError(field);
  }
  return sum;
}

export function windowHeadroom(limitUnits: number | null, estimatedUnits: number): number | null {
  if (limitUnits === null) {
    return null;
  }
  return Math.max(0, limitUnits - estimatedUnits);
}

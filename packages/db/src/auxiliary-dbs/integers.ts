import { AuxiliaryDbError } from "./errors.js";

export function bigintToNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new AuxiliaryDbError("UNSAFE_INTEGER", "SQLite integer exceeds the JavaScript safe range");
  }
  return Number(value);
}

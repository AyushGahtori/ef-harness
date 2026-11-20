/**
 * X-04 rounding rule: integer minor units, half away from zero.
 * The quotient is computed with integers so binary float dust cannot move a cent.
 */
export function roundHalfAwayFromZero(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator === 0) {
    throw new Error("X-04 rounding requires a safe integer numerator and a non-zero safe integer denominator");
  }
  const numer = BigInt(numerator);
  const denom = BigInt(denominator);
  const negative = numer < 0n !== denom < 0n;
  const absNumer = numer < 0n ? -numer : numer;
  const absDenom = denom < 0n ? -denom : denom;
  const quotient = absNumer / absDenom;
  const remainder = absNumer % absDenom;
  const bumped = remainder * 2n >= absDenom ? quotient + 1n : quotient;
  const signed = negative ? -bumped : bumped;
  return Number(signed);
}

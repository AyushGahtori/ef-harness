export function lineTotalMinor(unitMinor, quantity) {
  if (!Number.isInteger(unitMinor) || !Number.isInteger(quantity)) {
    throw new Error("X-04 requires integer minor units");
  }
  if (unitMinor < 0 || quantity < 0) throw new Error("X-04 requires non-negative minor units");
  return unitMinor * quantity;
}

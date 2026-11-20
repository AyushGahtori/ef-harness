export function applyRateMinor(minor, numerator, denominator) {
  if (!Number.isInteger(minor) || !Number.isInteger(numerator) || !Number.isInteger(denominator)) {
    throw new Error("X-04 requires integers");
  }
  if (minor < 0 || numerator < 0 || denominator <= 0) throw new Error("X-04 rate arguments are out of range");
  return Math.floor((minor * numerator + Math.floor(denominator / 2)) / denominator);
}

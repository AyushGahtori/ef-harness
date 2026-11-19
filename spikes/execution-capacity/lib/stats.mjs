/**
 * @param {number[]} values
 * @param {number} percentile 0..100
 */
export function percentile(values, percentileRank) {
  if (values.length === 0) {
    throw new Error("percentile requires at least one sample");
  }
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 1) return sorted[0] ?? 0;
  const rank = (percentileRank / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const low = sorted[lower] ?? 0;
  const high = sorted[upper] ?? low;
  if (lower === upper) return low;
  return low + (high - low) * (rank - lower);
}

/**
 * @param {number[]} values
 */
export function summarize(values) {
  return {
    samples: values.length,
    median: percentile(values, 50),
    p95: percentile(values, 95),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

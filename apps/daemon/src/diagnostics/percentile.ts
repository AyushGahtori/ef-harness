export function percentileNearestRank(
  sortedAscending: readonly number[],
  percentile: number,
): number | null {
  if (sortedAscending.length === 0) return null;
  const rank = Math.ceil((percentile / 100) * sortedAscending.length);
  const index = Math.min(sortedAscending.length, Math.max(1, rank)) - 1;
  return sortedAscending[index] ?? null;
}

export function downsampleSeries(
  points: readonly { readonly at: number; readonly value: number }[],
  cap: number,
): { readonly at: number; readonly value: number }[] {
  if (points.length <= cap || cap < 2) {
    return points.map((point) => ({ at: point.at, value: point.value }));
  }
  const buckets = cap - 1;
  const result: { at: number; value: number }[] = [];
  const span = points.length - 1;
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = Math.floor((bucket * span) / buckets);
    const end = Math.floor(((bucket + 1) * span) / buckets);
    let total = 0;
    let count = 0;
    let at = points[start]?.at ?? 0;
    for (let index = start; index <= end && index < points.length; index += 1) {
      const point = points[index];
      if (!point) continue;
      total += point.value;
      count += 1;
      at = point.at;
    }
    result.push({ at, value: count === 0 ? 0 : total / count });
  }
  const last = points[points.length - 1];
  if (last) result.push({ at: last.at, value: last.value });
  return result;
}

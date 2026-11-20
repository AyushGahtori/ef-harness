/** Mulberry32. Stable across timezones; used for Zipf/Pareto draws, not for wall-clock values. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const zipfCache = new Map<string, readonly number[]>();

export function zipfCdf(count: number, exponent = 1.07): readonly number[] {
  if (count <= 0) return [];
  const cacheKey = `${count}:${exponent}`;
  const cached = zipfCache.get(cacheKey);
  if (cached) return cached;
  const weights: number[] = [];
  let sum = 0;
  for (let rank = 1; rank <= count; rank += 1) {
    const weight = 1 / rank ** exponent;
    weights.push(weight);
    sum += weight;
  }
  const cdf: number[] = [];
  let acc = 0;
  for (const weight of weights) {
    acc += weight / (sum || 1);
    cdf.push(acc);
  }
  zipfCache.set(cacheKey, cdf);
  return cdf;
}

export function pickZipf(rng: () => number, cdf: readonly number[]): number {
  if (cdf.length === 0) return 0;
  const roll = rng();
  for (let index = 0; index < cdf.length; index += 1) {
    if (roll <= (cdf[index] ?? 1)) return index;
  }
  return cdf.length - 1;
}

/** Pareto sample clamped to an inclusive integer range. Heavy tail, many small values. */
export function paretoInt(
  rng: () => number,
  min: number,
  max: number,
  alpha = 1.16,
): number {
  if (max <= min) return min;
  const span = max - min;
  const unit = Math.min(1 - 1e-12, Math.max(1e-12, rng()));
  const raw = min + span * (1 - unit ** (1 / alpha));
  return Math.min(max, Math.max(min, Math.round(raw)));
}

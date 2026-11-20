const MASK = (1n << 64n) - 1n;

function mix(value: bigint): bigint {
  let z = value & MASK;
  z = (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n & MASK;
  z = (z ^ (z >> 27n)) * 0x94d049bb133111ebn & MASK;
  return (z ^ (z >> 31n)) & MASK;
}

/**
 * SplitMix64 stream. One integer seed reproduces the same sequence on every machine.
 * The simulator injects this in place of Math.random and crypto.randomUUID.
 */
export class DeterministicSeededRng {
  private state: bigint;

  constructor(seed: bigint | number) {
    const raw = typeof seed === "bigint" ? seed : BigInt(seed);
    if (raw < 0n) {
      throw new Error("DeterministicSeededRng seed must be non-negative");
    }
    this.state = mix(raw & MASK);
  }

  nextUint64(): bigint {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & MASK;
    return mix(this.state);
  }

  nextUint32(): number {
    return Number(this.nextUint64() >> 32n);
  }

  /** Half-open unit interval, derived only from the seed stream. */
  nextDouble(): number {
    return Number(this.nextUint64() >> 11n) / 2 ** 53;
  }

  nextInt(min: number, maxInclusive: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(maxInclusive) || maxInclusive < min) {
      throw new Error("nextInt requires an integer range");
    }
    const span = maxInclusive - min + 1;
    return min + (this.nextUint32() % span);
  }

  chance(probability: number): boolean {
    if (probability < 0 || probability > 1) {
      throw new Error("chance requires a probability in [0, 1]");
    }
    return this.nextDouble() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error("cannot pick from an empty list");
    }
    const item = items[this.nextInt(0, items.length - 1)];
    if (item === undefined) {
      throw new Error("cannot pick from an empty list");
    }
    return item;
  }

  /** Child stream. Advances the parent once so forks stay ordered by label. */
  fork(label: string): DeterministicSeededRng {
    let hash = this.nextUint64();
    for (let i = 0; i < label.length; i += 1) {
      hash = mix(hash ^ BigInt(label.charCodeAt(i)));
    }
    return new DeterministicSeededRng(hash);
  }
}

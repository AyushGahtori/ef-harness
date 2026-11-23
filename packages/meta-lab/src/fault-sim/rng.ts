const MASK = (1n << 64n) - 1n;

function rotl(x: bigint, k: number): bigint {
  return ((x << BigInt(k)) | (x >> BigInt(64 - k))) & MASK;
}

/**
 * xoshiro256** — deterministic 64-bit stream from a single uint64 seed.
 * No wall-clock or crypto entropy; replays bit-for-bit from `--seed`.
 */
export class Xoshiro256ssRng {
  private readonly state: [bigint, bigint, bigint, bigint];

  constructor(seed: bigint | number) {
    const words: bigint[] = [];
    let mixer = typeof seed === "bigint" ? seed & MASK : BigInt(Math.max(0, seed));
    for (let i = 0; i < 4; i += 1) {
      mixer = (mixer + 0x9e3779b97f4a7c15n) & MASK;
      let z = mixer;
      z = (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n & MASK;
      z = (z ^ (z >> 27n)) * 0x94d049bb133111ebn & MASK;
      words.push((z ^ (z >> 31n)) & MASK);
    }
    this.state = [words[0] ?? 0n, words[1] ?? 0n, words[2] ?? 0n, words[3] ?? 0n];
  }

  nextUint64(): bigint {
    const s = this.state;
    const result = (rotl(s[1]! * 5n, 7) * 9n) & MASK;
    const t = (s[1]! << 17n) & MASK;
    s[2]! ^= s[0]!;
    s[3]! ^= s[1]!;
    s[1]! ^= s[2]!;
    s[0]! ^= s[3]!;
    s[2]! ^= t;
    s[3]! = rotl(s[3]!, 45);
    return result;
  }

  nextUint32(): number {
    return Number(this.nextUint64() >> 32n);
  }

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

  fork(label: string): Xoshiro256ssRng {
    let hash = this.nextUint64();
    for (let i = 0; i < label.length; i += 1) {
      hash ^= BigInt(label.charCodeAt(i)) << BigInt((i % 8) * 8);
      hash = (hash * 0x9e3779b97f4a7c15n) & MASK;
    }
    return new Xoshiro256ssRng(hash);
  }
}
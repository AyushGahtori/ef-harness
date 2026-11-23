import { createHash } from "node:crypto";

/** Deterministic uint32 PRNG from a sha256 digest (mulberry32). */
export function seedFromSha256(input: string): { seed: string; next: () => number } {
  const digest = createHash("sha256").update(input, "utf8").digest();
  const seedHex = digest.toString("hex");
  let state = digest.readUInt32LE(0);
  return {
    seed: seedHex,
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    },
  };
}
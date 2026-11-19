/**
 * Mulberry32. Same seed yields the same sequence on every machine.
 * @param {number} seed
 */
export function createPrng(seed) {
  let state = seed >>> 0;
  return {
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    },
    /** Inclusive integer range. */
    int(min, max) {
      const low = Math.ceil(min);
      const high = Math.floor(max);
      return low + Math.floor(this.next() * (high - low + 1));
    },
  };
}

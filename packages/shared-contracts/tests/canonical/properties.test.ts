import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CanonicalizationError,
  canonicalizeJson,
  computeNodeContentHash,
  normalizeNfc,
} from "../../src/canonical/index.js";

const RUNS = 500;

function hasLoneSurrogate(value: unknown, stack = new Set<object>()): boolean {
  if (typeof value === "string") {
    return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);
  }
  if (value === null || typeof value !== "object") return false;
  if (stack.has(value)) return false;
  stack.add(value);
  if (Array.isArray(value)) return value.some((item) => hasLoneSurrogate(item, stack));
  return Object.keys(value).some((key) => {
    if (hasLoneSurrogate(key)) return true;
    const desc = Object.getOwnPropertyDescriptor(value, key);
    return desc !== undefined && hasLoneSurrogate(desc.value, stack);
  });
}

function mapStrings(value: unknown, map: (text: string) => string, stack = new Set<object>()): unknown {
  if (typeof value === "string") return map(value);
  if (value === null || typeof value !== "object") return value;
  if (stack.has(value)) return value;
  stack.add(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, map, stack));
  const copy = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc || !desc.enumerable || desc.get || desc.set) continue;
    Object.defineProperty(copy, map(key), {
      value: mapStrings(desc.value, map, stack),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return copy;
}

function shuffleKeys(value: unknown, random: () => number, stack = new Set<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (stack.has(value)) return value;
  stack.add(value);
  if (Array.isArray(value)) return value.map((item) => shuffleKeys(item, random, stack));
  const keys = Object.keys(value);
  for (let index = keys.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const current = keys[index];
    const other = keys[swap];
    if (current === undefined || other === undefined) continue;
    keys[index] = other;
    keys[swap] = current;
  }
  const copy = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc || !desc.enumerable || desc.get || desc.set) continue;
    Object.defineProperty(copy, key, {
      value: shuffleKeys(desc.value, random, stack),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return copy;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function canonicalOrCode(value: unknown): { ok: true; text: string } | { ok: false; code: string } {
  try {
    return { ok: true, text: canonicalizeJson(normalizeNfc(value)) };
  } catch (error) {
    if (error instanceof CanonicalizationError) return { ok: false, code: error.code };
    throw error;
  }
}

const nestedJson = fc.jsonValue({
  maxDepth: 4,
  noUnicodeString: false,
  stringUnit: "grapheme",
});

describe("fast-check canonical properties", () => {
  it("is invariant under object-key permutation for 500 nested values", () => {
    fc.assert(
      fc.property(nestedJson, fc.integer(), (value, seed) => {
        fc.pre(!hasLoneSurrogate(value));
        const shuffled = shuffleKeys(value, mulberry32(seed));
        const left = canonicalOrCode(value);
        const right = canonicalOrCode(shuffled);
        expect(left).toEqual(right);
      }),
      { numRuns: RUNS },
    );
  });

  it("treats NFD and NFC nested strings as the same canonical form", () => {
    fc.assert(
      fc.property(nestedJson, (value) => {
        fc.pre(!hasLoneSurrogate(value));
        const nfd = mapStrings(value, (text) => text.normalize("NFD"));
        const nfc = mapStrings(value, (text) => text.normalize("NFC"));
        const left = canonicalOrCode(nfd);
        const right = canonicalOrCode(nfc);
        expect(left).toEqual(right);
        if (left.ok && right.ok) {
          const base = {
            kind: "rule",
            title: "t",
            text: "body",
            fields: nfd,
          };
          expect(computeNodeContentHash(base)).toBe(
            computeNodeContentHash({ ...base, fields: nfc }),
          );
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("hashes -0 and 0 identically inside nested objects", () => {
    fc.assert(
      fc.property(nestedJson, (value) => {
        fc.pre(!hasLoneSurrogate(value));
        const negativeZero = mapStrings(value, (text) => text);
        const withNegative = replaceZeros(negativeZero, -0);
        const withZero = replaceZeros(value, 0);
        expect(canonicalOrCode(withNegative)).toEqual(canonicalOrCode(withZero));
      }),
      { numRuns: RUNS },
    );
  });
});

function replaceZeros(value: unknown, zero: number, stack = new Set<object>()): unknown {
  if (typeof value === "number") return Object.is(value, -0) || value === 0 ? zero : value;
  if (typeof value === "string" || value === null || typeof value !== "object") return value;
  if (stack.has(value)) return value;
  stack.add(value);
  if (Array.isArray(value)) return value.map((item) => replaceZeros(item, zero, stack));
  const copy = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc || !desc.enumerable || desc.get || desc.set) continue;
    Object.defineProperty(copy, key, {
      value: replaceZeros(desc.value, zero, stack),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return copy;
}

import { describe, expect, it } from "vitest";
import { CanonicalizationError, canonicalizeJson, normalizeNfc } from "../../src/canonical/index.js";

describe("canonicalizeJson edge cases", () => {
  it("omits undefined object properties and keeps null", () => {
    expect(canonicalizeJson({ b: 1, a: undefined, c: null })).toBe('{"b":1,"c":null}');
    expect(canonicalizeJson({ z: undefined })).toBe("{}");
  });

  it("normalizes -0 to 0 and rejects non-finite numbers", () => {
    expect(canonicalizeJson(-0)).toBe("0");
    expect(canonicalizeJson({ n: -0 })).toBe(canonicalizeJson({ n: 0 }));
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => canonicalizeJson(value)).toThrow(CanonicalizationError);
      expect(() => canonicalizeJson({ n: value })).toThrow(CanonicalizationError);
    }
    try {
      canonicalizeJson(Number.NaN);
    } catch (error) {
      expect((error as CanonicalizationError).code).toBe("non_finite_number");
    }
  });

  it("rejects raw BigInt and accepts an explicitly serialized string", () => {
    expect(() => canonicalizeJson(1n)).toThrow(CanonicalizationError);
    expect(() => canonicalizeJson({ big: 1n })).toThrow(CanonicalizationError);
    try {
      canonicalizeJson(1n);
    } catch (error) {
      expect((error as CanonicalizationError).code).toBe("bigint");
    }
    expect(canonicalizeJson({ big: "055" })).toBe('{"big":"055"}');
  });

  it("rejects circular references but allows a repeated acyclic object", () => {
    const shared = { a: 1 };
    expect(canonicalizeJson({ x: shared, y: shared })).toBe('{"x":{"a":1},"y":{"a":1}}');
    const cycle: Record<string, unknown> = { a: 1 };
    cycle.self = cycle;
    expect(() => canonicalizeJson(cycle)).toThrow(CanonicalizationError);
    const loop: unknown[] = [];
    loop.push(loop);
    expect(() => canonicalizeJson(loop)).toThrow(CanonicalizationError);
  });

  it("does not mutate the caller's objects or arrays", () => {
    const nested = { b: ["c", { z: 1, a: 2 }] };
    const input = { z: 1, a: "e\u0301", nested };
    const before = structuredClone(input);
    canonicalizeJson(input);
    normalizeNfc(input);
    expect(input).toEqual(before);
    expect(input.nested).toBe(nested);
  });

  it("does not invoke accessors or pollute Object.prototype", () => {
    let reads = 0;
    const boxed = {};
    Object.defineProperty(boxed, "a", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return 1;
      },
    });
    expect(() => canonicalizeJson(boxed)).toThrow(CanonicalizationError);
    expect(() => normalizeNfc(boxed)).toThrow(CanonicalizationError);
    expect(reads).toBe(0);

    const carrier = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(carrier, "__proto__", {
      value: { admin: true },
      enumerable: true,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(carrier, "constructor", {
      value: { x: 1 },
      enumerable: true,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(carrier, "hasOwnProperty", {
      value: 1,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(carrier, "toString", {
      value: "kept",
      enumerable: true,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(carrier, "b", {
      value: 2,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    expect(canonicalizeJson(carrier)).toBe(
      '{"__proto__":{"admin":true},"b":2,"constructor":{"x":1},"hasOwnProperty":1,"toString":"kept"}',
    );
    expect("admin" in Object.prototype).toBe(false);

    const normalized = normalizeNfc(carrier) as Record<string, unknown>;
    expect(Object.getPrototypeOf(normalized)).toBe(null);
    expect(Object.prototype.hasOwnProperty.call(normalized, "__proto__")).toBe(true);
    expect(carrier.b).toBe(2);
  });

  it("serializes array holes like JSON and rejects exotic objects", () => {
    expect(canonicalizeJson([1, undefined, 2])).toBe("[1,null,2]");
    const sparse: unknown[] = [];
    sparse[2] = "x";
    expect(canonicalizeJson(sparse)).toBe("[null,null,\"x\"]");
    expect(canonicalizeJson({ keep: 1, drop: () => 1 })).toBe('{"keep":1}');
    expect(() => canonicalizeJson(undefined)).toThrow(CanonicalizationError);
    expect(() => canonicalizeJson(new Date("2026-11-19T00:00:00Z"))).toThrow(CanonicalizationError);
    expect(() => canonicalizeJson(/abc/)).toThrow(CanonicalizationError);
    expect(() => canonicalizeJson(new Map())).toThrow(CanonicalizationError);
  });

  it("ignores inherited properties", () => {
    const proto = { inherited: 1 };
    const value = Object.assign(Object.create(proto) as object, { own: 2 });
    expect(canonicalizeJson(value)).toBe('{"own":2}');
  });
});

describe("normalizeNfc", () => {
  it("composes combining characters and object keys without mutating", () => {
    const nfd = "e\u0301";
    const nfc = "\u00e9";
    expect(normalizeNfc(nfd)).toBe(nfc);
    const input = { [nfd]: [nfd], title: nfd };
    const before = structuredClone(input);
    const normalized = normalizeNfc(input) as { title: string };
    expect(normalized.title).toBe(nfc);
    expect(Object.keys(normalized)).toContain(nfc);
    expect(input).toEqual(before);
    expect(normalizeNfc(normalizeNfc(input))).toEqual(normalized);
  });

  it("rejects keys that collide under NFC", () => {
    const mixed = Object.create(null) as Record<string, number>;
    mixed["e\u0301"] = 1;
    mixed["\u00e9"] = 2;
    expect(() => normalizeNfc(mixed)).toThrow(CanonicalizationError);
    try {
      normalizeNfc(mixed);
    } catch (error) {
      expect((error as CanonicalizationError).code).toBe("nfc_key_collision");
    }
  });
});

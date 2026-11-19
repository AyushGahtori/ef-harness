import { CanonicalizationError } from "./errors.js";
import { assertSupportedContainer, readOwnData } from "./json-shape.js";

/**
 * Recursively Unicode-NFC-normalize strings, object keys, and nested values.
 * The input is not mutated. Returned objects use a null prototype so keys such
 * as `__proto__` stay data properties.
 */
export function normalizeNfc(value: string): string;
export function normalizeNfc<T>(value: T): T;
export function normalizeNfc(value: unknown): unknown {
  return normalizeValue(value, new Set<object>());
}

function normalizeValue(value: unknown, stack: Set<object>): unknown {
  if (typeof value === "string") return value.normalize("NFC");
  if (value === null || typeof value !== "object") return value;
  if (stack.has(value)) {
    throw new CanonicalizationError("circular", "circular reference in NFC normalization");
  }
  assertSupportedContainer(value);
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      const copy = new Array<unknown>(value.length);
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) continue;
        copy[index] = normalizeValue(value[index], stack);
      }
      return copy;
    }
    const copy = Object.create(null) as Record<string, unknown>;
    const seen = new Set<string>();
    for (const key of Object.keys(value)) {
      const own = readOwnData(value, key);
      if (!own.ok) continue;
      const normalizedKey = key.normalize("NFC");
      if (seen.has(normalizedKey)) {
        throw new CanonicalizationError(
          "nfc_key_collision",
          "two object keys normalize to the same NFC string",
        );
      }
      seen.add(normalizedKey);
      Object.defineProperty(copy, normalizedKey, {
        value: normalizeValue(own.value, stack),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return copy;
  } finally {
    stack.delete(value);
  }
}

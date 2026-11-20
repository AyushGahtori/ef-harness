import { CanonicalizationError } from "./errors.js";

const objectToString = Object.prototype.toString;

const UNSUPPORTED_TAGS = new Set([
  "[object Date]",
  "[object RegExp]",
  "[object Map]",
  "[object Set]",
  "[object WeakMap]",
  "[object WeakSet]",
  "[object ArrayBuffer]",
  "[object DataView]",
  "[object SharedArrayBuffer]",
  "[object Promise]",
  "[object Error]",
  "[object Number]",
  "[object String]",
  "[object Boolean]",
  "[object BigInt]",
  "[object Int8Array]",
  "[object Uint8Array]",
  "[object Uint8ClampedArray]",
  "[object Int16Array]",
  "[object Uint16Array]",
  "[object Int32Array]",
  "[object Uint32Array]",
  "[object Float32Array]",
  "[object Float64Array]",
  "[object BigInt64Array]",
  "[object BigUint64Array]",
]);

export function assertSupportedContainer(value: object): void {
  const tag = objectToString.call(value);
  if (UNSUPPORTED_TAGS.has(tag)) {
    throw new CanonicalizationError(
      "unsupported_type",
      `${tag} cannot be canonicalized; pass a JSON value instead`,
    );
  }
}

/** Object properties JSON.stringify drops instead of encoding. */
export function isOmittedPropertyValue(value: unknown): boolean {
  return value === undefined || typeof value === "function" || typeof value === "symbol";
}

export function readOwnData(
  value: object,
  key: string,
): { ok: true; value: unknown } | { ok: false } {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !descriptor.enumerable) return { ok: false };
  if (descriptor.get || descriptor.set) {
    throw new CanonicalizationError(
      "unsupported_type",
      "accessor properties cannot be canonicalized",
    );
  }
  return { ok: true, value: descriptor.value };
}

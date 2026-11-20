import type { SecretRedactorPort } from "./telemetry-port.js";

/**
 * Redacts prompt and message strings. Objects placed in `opaque` (replayed
 * reasoning items, thinking blocks, thought signatures) are returned by reference
 * and are never walked, so encrypted blobs stay byte-for-byte intact.
 * Auth headers are not passed through this helper.
 */
export function redactStructured(
  value: unknown,
  redactor: SecretRedactorPort,
  opaque: ReadonlySet<unknown>,
): unknown {
  if (opaque.has(value)) return value;
  if (typeof value === "string") return redactor.redact(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    return value.map((entry) => redactStructured(entry, redactor, opaque));
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = redactStructured(entry, redactor, opaque);
    }
    return output;
  }
  return null;
}

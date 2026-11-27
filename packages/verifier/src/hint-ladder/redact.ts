export function redactText(
  redactor: { redact(text: string): string } | null,
  value: string,
): string {
  if (!redactor) return value;
  return redactor.redact(value);
}

export function redactUnknown(
  redactor: { redact(text: string): string } | null,
  value: unknown,
): unknown {
  if (!redactor) return value;
  if (typeof value === "string") return redactor.redact(value);
  if (Array.isArray(value)) return value.map((item) => redactUnknown(redactor, item));
  if (value instanceof Uint8Array) return value;
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = redactUnknown(redactor, item);
    }
    return output;
  }
  return value;
}

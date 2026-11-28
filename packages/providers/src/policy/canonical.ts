export function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

export function signedPayloadBytes(document: Record<string, unknown>): Buffer {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(document)) {
    if (key === "signature") continue;
    rest[key] = value;
  }
  return Buffer.from(canonicalStringify(rest), "utf8");
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortKeys(entry));
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source).sort((left, right) => {
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    });
    const sorted: Record<string, unknown> = {};
    for (const key of keys) {
      sorted[key] = sortKeys(source[key]);
    }
    return sorted;
  }
  return value;
}

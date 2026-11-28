function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortCanonical(item));
  if (!isRecord(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortCanonical(value[key]);
  }
  return sorted;
}

/** Stable UTF-8 JSON used as the Ed25519 signed bytes. Key order does not affect the digest. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortCanonical(value));
}

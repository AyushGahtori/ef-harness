function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortCanonical(value) {
  if (Array.isArray(value)) return value.map((item) => sortCanonical(item));
  if (!isRecord(value)) return value;
  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortCanonical(value[key]);
  }
  return sorted;
}

/** Stable UTF-8 JSON used as the Ed25519 signed bytes. */
export function canonicalJson(value) {
  return JSON.stringify(sortCanonical(value));
}
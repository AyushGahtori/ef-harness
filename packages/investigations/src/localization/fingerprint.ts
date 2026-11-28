import { createHash } from "node:crypto";

const VOLATILE_PATTERNS: readonly RegExp[] = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
  /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g,
  /(?:[A-Za-z]:\\Users\\[^\\ \n]+\\AppData\\Local\\Temp\\[^\\ \n]+|\/tmp\/[^\s]+|\/var\/folders\/[^\s]+)/gi,
  /\b0x[0-9a-f]{8,}\b/gi,
  /\b\d{2,5}ms\b/g,
  /:\d{2,5}\b/g,
];

export function stripVolatileTokens(text: string): string {
  let normalized = text.replaceAll("\\", "/");
  for (const pattern of VOLATILE_PATTERNS) {
    normalized = normalized.replace(pattern, "<volatile>");
  }
  return normalized.replace(/\s+/g, " ").trim();
}

export function normalizeFailureFingerprint(raw: string): string {
  const stripped = stripVolatileTokens(raw);
  return createHash("sha256").update(stripped, "utf8").digest("hex");
}

export function fingerprintsMatch(target: string, actual: string): boolean {
  return normalizeFailureFingerprint(target) === normalizeFailureFingerprint(actual);
}
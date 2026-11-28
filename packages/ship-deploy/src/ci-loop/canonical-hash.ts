import { createHash } from "node:crypto";

const RANDOM_TOKENS = [
  /\b\d{4}-\d{2}-\d{2}T[\d:.]+Z\b/g,
  /\b(?:localhost:\d+|127\.0\.0\.1:\d+)\b/g,
  /\b\d{3,5}ms\b/gi,
  /\(line\s+\d+\)/gi,
];

/**
 * Deterministic failure fingerprint for bounded CI repair (Task 178 / ship_runs).
 */
export function computeFailureFingerprint(parts: {
  readonly errorType: string;
  readonly filePath: string;
  readonly message: string;
}): string {
  const posixFile = parts.filePath.replaceAll("\\", "/").toLowerCase();
  let message = parts.message.trim().toLowerCase();
  for (const pattern of RANDOM_TOKENS) {
    message = message.replace(pattern, "");
  }
  message = message.replace(/\s+/g, " ");
  const payload = `${parts.errorType}|${posixFile}|${message}`;
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}
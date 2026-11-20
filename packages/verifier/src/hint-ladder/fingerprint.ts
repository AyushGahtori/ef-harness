import { createHash } from "node:crypto";
import type { FailureFingerprintInput } from "./types.js";

export function staticFingerprintMetaKey(taskId: string): string {
  return `hint-ladder.static-fingerprint.${taskId}`;
}

export function posixFailurePath(filePath: string): string {
  return filePath
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .replace(/^[A-Za-z]:/, "")
    .replace(/^\//, "");
}

export function stripVolatileTokens(value: string): string {
  return value
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?\b/g, "")
    .replace(/:\d+(?::\d+)?\b/g, "")
    .replace(/\b(line|col|column)\s+\d+\b/gi, "$1")
    .replace(/\bport\s+\d+\b/gi, "port")
    .replace(/\blocalhost:\d+\b/gi, "localhost")
    .replace(/\b127\.0\.0\.1:\d+\b/g, "127.0.0.1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function localComputeFailureFingerprint(input: FailureFingerprintInput): string {
  const failureClass = input.failureClass.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const ruleOrCheckId = input.ruleOrCheckId.trim();
  const filePath = stripVolatileTokens(posixFailurePath(input.filePath));
  const detail = stripVolatileTokens(input.detail);
  const canonical = `${failureClass}\n${ruleOrCheckId}\n${filePath}\n${detail}`;
  return createHash("sha256").update(canonical).digest("hex");
}

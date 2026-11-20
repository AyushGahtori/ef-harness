import { CanonicalizationError } from "./errors.js";
import { canonicalizeJson } from "./canonicalize.js";
import { digestSha256 } from "./hash.js";
import { normalizeNfc } from "./normalize.js";

export interface FailureFingerprintInput {
  failureClass: string;
  ruleId: string;
  filePath: string;
  detail?: string;
}

const ISO_TIMESTAMP =
  /\[?\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b\]?/gi;
const CLOCK_TIME = /\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/g;
const STACK_LINE_COLUMN = /([A-Za-z]):\d+:\d+\b/g;
const STACK_LINE = /([A-Za-z]):\d+\b/g;
const HOST_PORT = /\b(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d{2,5}\b/gi;
const PORT_WORD = /\bport\s+\d{2,5}\b/gi;
const LINE_WORD = /\bline\s+\d+\b/gi;
const EMPTY_BRACKETS = /\[\s*\]|\(\s*\)/g;

/**
 * Drop volatile line, timestamp, and random-port tokens from a failure message.
 * Domain times without seconds (for example `10:45`) are kept.
 */
export function stripVolatileFailureTokens(detail: string): string {
  for (const pattern of [
    ISO_TIMESTAMP,
    CLOCK_TIME,
    HOST_PORT,
    PORT_WORD,
    STACK_LINE_COLUMN,
    STACK_LINE,
    LINE_WORD,
    EMPTY_BRACKETS,
  ]) {
    pattern.lastIndex = 0;
  }
  const nfc = detail.normalize("NFC").replaceAll("\\", "/");
  const stripped = nfc
    .replace(ISO_TIMESTAMP, " ")
    .replace(CLOCK_TIME, " ")
    .replace(HOST_PORT, "$1")
    .replace(PORT_WORD, " ")
    .replace(STACK_LINE_COLUMN, "$1")
    .replace(STACK_LINE, "$1")
    .replace(LINE_WORD, "line")
    .replace(EMPTY_BRACKETS, " ");
  return stripped.replace(/\s+/g, " ").trim();
}

/** POSIX form: NFC, `/` separators, drive letter removed, duplicate slashes collapsed. */
export function normalizePosixPath(filePath: string): string {
  let path = filePath.normalize("NFC").trim().replaceAll("\\", "/");
  path = path.replace(/^[A-Za-z]:(?=\/|$)/, "");
  path = path.replace(/^\.\//, "");
  path = path.replace(/\/\.\//g, "/");
  path = path.replace(/\/{2,}/g, "/");
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path;
}

function hashFingerprint(input: FailureFingerprintInput): string {
  if (typeof input.failureClass !== "string") {
    throw new CanonicalizationError("invalid_input", "failureClass must be a string");
  }
  if (typeof input.ruleId !== "string") {
    throw new CanonicalizationError("invalid_input", "ruleId must be a string");
  }
  if (typeof input.filePath !== "string") {
    throw new CanonicalizationError("invalid_input", "filePath must be a string");
  }
  const detail = typeof input.detail === "string" ? input.detail : "";
  const payload = {
    detail: stripVolatileFailureTokens(detail),
    failureClass: input.failureClass.normalize("NFC").trim(),
    filePath: normalizePosixPath(input.filePath),
    ruleId: input.ruleId.normalize("NFC").trim(),
  };
  return digestSha256(canonicalizeJson(normalizeNfc(payload)));
}

export function computeFailureFingerprint(input: FailureFingerprintInput): string;
export function computeFailureFingerprint(
  failureClass: string,
  ruleId: string,
  filePath: string,
  detail?: string,
): string;
export function computeFailureFingerprint(
  failureClassOrInput: string | FailureFingerprintInput,
  ruleId?: string,
  filePath?: string,
  detail?: string,
): string {
  if (typeof failureClassOrInput === "string") {
    if (typeof ruleId !== "string" || typeof filePath !== "string") {
      throw new CanonicalizationError(
        "invalid_input",
        "computeFailureFingerprint requires failureClass, ruleId, and filePath",
      );
    }
    return hashFingerprint({
      failureClass: failureClassOrInput,
      ruleId,
      filePath,
      ...(typeof detail === "string" ? { detail } : {}),
    });
  }
  if (
    failureClassOrInput !== null &&
    typeof failureClassOrInput === "object" &&
    "failureClass" in failureClassOrInput &&
    "ruleId" in failureClassOrInput &&
    "filePath" in failureClassOrInput
  ) {
    return hashFingerprint(failureClassOrInput);
  }
  throw new CanonicalizationError(
    "invalid_input",
    "computeFailureFingerprint received an unsupported argument",
  );
}

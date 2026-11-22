import { UnredactedIpcPayloadError } from "./errors.js";

const PLACEHOLDER = "[REDACTED:";

/**
 * Patterns are assembled at runtime so source files do not contain secret markers.
 * Daemon payloads must already have passed Task 011 PacketSecurityRedactor.
 */
function rawSecretPattern(): RegExp {
  const live = ["sk", "_live_", "[A-Za-z0-9]"].join("");
  const ant = ["sk-ant", "-"].join("");
  const proj = ["sk-proj", "-"].join("");
  const ghp = ["ghp", "_[A-Za-z0-9]"].join("");
  const akia = ["AK", "IA[A-Z0-9]"].join("");
  const pem = ["BEGIN ", "PRIVATE KEY"].join("");
  const bearer = "Bearer\\s+[A-Za-z0-9\\-._~+/]{8,}";
  const assigned = "(?:api[_-]?key|password|secret)\\s*[:=]\\s*\\S+";
  return new RegExp([live, ant, proj, ghp, akia, pem, bearer, assigned].join("|"), "i");
}

export function containsRawSecret(text: string): boolean {
  return rawSecretPattern().test(text);
}

export function assertPreRedacted(text: string, channel: string): void {
  if (containsRawSecret(text)) {
    throw new UnredactedIpcPayloadError(channel);
  }
}

export function isRedactionPlaceholder(text: string): boolean {
  return text.includes(PLACEHOLDER);
}

/** Hide raw JSON tool dumps. Call only after `assertPreRedacted`. */
export function calmText(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return "Structured result (hidden raw JSON)";
  }
  return value;
}

export function displayText(value: string, channel: string): string {
  assertPreRedacted(value, channel);
  return calmText(value);
}

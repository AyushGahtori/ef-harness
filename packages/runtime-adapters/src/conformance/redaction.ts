import { CANARY_MARKER, CREDENTIAL_MARKER } from "./types.js";
import type { ForensicReceipt } from "./types.js";

export function redactText(value: string): string {
  return value
    .replaceAll(CANARY_MARKER, "[REDACTED]")
    .replaceAll(CREDENTIAL_MARKER, "[REDACTED]")
    .replace(/bearer\s+\S+/gi, "bearer [REDACTED]")
    .replace(/authorization\s+\S+/gi, "authorization [REDACTED]");
}

export function redactEvidence(
  evidence: Readonly<Record<string, string | number | boolean>>,
): Readonly<Record<string, string | number | boolean>> {
  const next: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(evidence)) {
    next[key] = typeof value === "string" ? redactText(value) : value;
  }
  return next;
}

export function redactReceipt(receipt: ForensicReceipt): ForensicReceipt {
  return {
    ...receipt,
    diagnostic: redactText(receipt.diagnostic),
    evidence: redactEvidence(receipt.evidence),
  };
}

export function containsSecretMarker(value: string): boolean {
  return value.includes(CANARY_MARKER) || value.includes(CREDENTIAL_MARKER);
}

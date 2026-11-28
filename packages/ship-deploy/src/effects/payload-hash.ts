import { canonicalJson, canonicalSha256, toBareSha256Hex } from "@ef-harness/shared-contracts";

export function canonicalizeJson(value: unknown): string {
  return canonicalJson(value);
}

/** Bare 64-hex SHA-256 of RFC 8785 canonical JSON. */
export function canonicalPayloadHash(payload: unknown): string {
  return toBareSha256Hex(canonicalSha256(payload));
}

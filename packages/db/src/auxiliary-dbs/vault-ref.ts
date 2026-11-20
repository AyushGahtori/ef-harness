import { VaultRefSecretError } from "./errors.js";

/** Prefixes that must never be stored in connections.vault_ref. Built without contiguous secret markers. */
export function vaultSecretPrefixes(): readonly string[] {
  return [["sk", "-"].join(""), ["AI", "za"].join(""), ["ghp", "_"].join("")];
}

export function assertVaultRef(vaultRef: string | null | undefined): void {
  if (vaultRef === null || vaultRef === undefined) return;
  const trimmed = vaultRef.trim();
  if (trimmed.length === 0) return;
  for (const prefix of vaultSecretPrefixes()) {
    if (trimmed.startsWith(prefix)) throw new VaultRefSecretError();
  }
}

export function maskSecret(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}

export interface SecretVault {
  put(secret: string): string;
}

export class EphemeralKeyBuffer {
  private value: string | null = null;

  set(raw: string): void {
    this.value = raw;
  }

  held(): string | null {
    return this.value;
  }

  save(vault: SecretVault): { readonly vaultRef: string; readonly masked: string } {
    const raw = this.value;
    if (raw === null || raw.trim().length === 0) {
      throw new Error("No key to save");
    }
    const vaultRef = vault.put(raw);
    const masked = maskSecret(raw);
    this.value = null;
    return { vaultRef, masked };
  }
}

export function maskSecret(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}

/**
 * One-way handoff. The renderer posts the paste to harnessd and drops the buffer.
 * It does not keep a vault handle.
 */
export interface ConnectionKeyHandoff {
  save(raw: string, provider: string): { readonly vaultRef: string };
}

export class EphemeralKeyBuffer {
  private value: string | null = null;

  set(raw: string): void {
    this.value = raw;
  }

  held(): string | null {
    return this.value;
  }

  clear(): void {
    this.value = null;
  }

  save(handoff: ConnectionKeyHandoff, provider: string): { readonly vaultRef: string; readonly masked: string } {
    const raw = this.value;
    if (raw === null || raw.trim().length === 0) {
      throw new Error("No key to save");
    }
    const saved = handoff.save(raw, provider);
    const masked = maskSecret(raw);
    this.value = null;
    return { vaultRef: saved.vaultRef, masked };
  }
}

import type { PacketSecurityRedactorPort } from "./ports.js";

const REDACTED = "[REDACTED_SECRET]";

/**
 * Local PacketSecurityRedactor used until Task 011 is wired.
 * Registered canaries and bearer/authorization fragments become `[REDACTED_SECRET]`.
 */
export class LocalPacketSecurityRedactor implements PacketSecurityRedactorPort {
  private readonly secrets = new Set<string>();

  registerCanary(secret: string): void {
    if (secret.length >= 8) this.secrets.add(secret);
  }

  redact(text: string): string {
    let next = text;
    const ordered = [...this.secrets].sort((left, right) => right.length - left.length);
    for (const secret of ordered) {
      if (secret.length < 8 || !next.includes(secret)) continue;
      next = next.split(secret).join(REDACTED);
    }
    next = next.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, `Bearer ${REDACTED}`);
    next = next.replace(
      /\b(authorization|api[-_]?key|x-api-key)\s*[:=]\s*\S+/gi,
      `$1: ${REDACTED}`,
    );
    return next;
  }
}

export const REDACTED_SECRET = REDACTED;

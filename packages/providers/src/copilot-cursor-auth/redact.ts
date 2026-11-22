import { RawCredentialPersistenceError } from "./errors.js";

export function assertNoRawCredential(
  label: string,
  text: string,
  secrets: readonly string[],
): void {
  for (const secret of secrets) {
    if (secret.length >= 8 && text.includes(secret)) {
      throw new RawCredentialPersistenceError(label);
    }
  }
}

export class RedactingAuditLog {
  private readonly secrets: string[] = [];
  private readonly lines: string[] = [];

  seal(secret: string): void {
    if (secret.length >= 8) this.secrets.push(secret);
  }

  record(
    event: string,
    fields: Readonly<Record<string, string | number | boolean | null>>,
  ): void {
    this.lines.push(this.redact(JSON.stringify({ event, fields })));
  }

  text(): string {
    return this.lines.join("\n");
  }

  redact(text: string): string {
    let redacted = text;
    for (const secret of this.secrets) {
      if (secret.length < 8 || !redacted.includes(secret)) continue;
      redacted = redacted.split(secret).join("[REDACTED]");
    }
    return redacted;
  }
}

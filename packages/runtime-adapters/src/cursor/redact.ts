export class SecretRedactor {
  private readonly secrets: string[] = [];

  register(value: string): void {
    if (value.length < 8) return;
    if (!this.secrets.includes(value)) this.secrets.push(value);
  }

  redact(text: string): string {
    let redacted = text;
    for (const secret of this.secrets) {
      if (secret.length === 0) continue;
      redacted = redacted.split(secret).join("[redacted]");
    }
    return redacted;
  }

  redactUnknown(value: unknown): unknown {
    if (typeof value === "string") return this.redact(value);
    if (Array.isArray(value)) return value.map((entry) => this.redactUnknown(entry));
    if (!value || typeof value !== "object") return value;
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = this.redactUnknown(entry);
    }
    return output;
  }
}

export class MemoryAuditLog {
  private readonly entries: string[] = [];

  constructor(private readonly redactor: { redact(text: string): string }) {}

  record(event: string, fields: Readonly<Record<string, string>>): void {
    const parts = Object.entries(fields).map(([key, value]) => `${key}=${this.redactor.redact(value)}`);
    this.entries.push(this.redactor.redact(`${event} ${parts.join(" ")}`.trim()));
  }

  lines(): readonly string[] {
    return [...this.entries];
  }
}

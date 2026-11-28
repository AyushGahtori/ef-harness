import type { PacketSecurityRedactor } from "./ports.js";

const MINIMUM_SECRET_LENGTH = 8;

/**
 * Local stand-in for Task 011 `SecretRedactor`.
 * Swap the class for the package export; keep this method shape.
 */
export class LocalPacketSecurityRedactor implements PacketSecurityRedactor {
  private readonly secrets = new Map<string, string>();

  register(label: string, value: string): void {
    if (label.trim().length === 0) return;
    if (value.trim().length < MINIMUM_SECRET_LENGTH) return;
    this.secrets.set(label, value);
  }

  forget(label: string): boolean {
    return this.secrets.delete(label);
  }

  redact(text: string): string {
    const ordered = [...this.secrets.entries()].sort((left, right) => right[1].length - left[1].length);
    let output = text;
    for (const [label, value] of ordered) {
      const token = `[REDACTED:${label}]`;
      if (output.includes(value)) output = output.split(value).join(token);
      const encoded = encodeURIComponent(value);
      if (encoded !== value && output.includes(encoded)) output = output.split(encoded).join(token);
    }
    return output;
  }

  redactValue(value: unknown): unknown {
    if (typeof value === "string") return this.redact(value);
    if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) {
      return value;
    }
    if (Array.isArray(value)) return value.map((item) => this.redactValue(item));
    if (typeof value === "object") {
      const output: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value)) {
        output[key] = this.redactValue(inner);
      }
      return output;
    }
    return value;
  }
}

/** Holds a trailing partial line so a secret split across reads is still masked. */
export class RedactingLineBuffer {
  private pending = "";

  constructor(private readonly redactor: PacketSecurityRedactor) {}

  push(chunk: string, emit: (line: string) => void): void {
    const combined = this.pending + chunk;
    const lines = combined.split(/\r?\n/);
    this.pending = lines.pop() ?? "";
    if (this.pending.length > 65_536) {
      emit(this.redactor.redact(this.pending));
      this.pending = "";
    }
    for (const line of lines) emit(this.redactor.redact(line));
  }

  flush(emit: (line: string) => void): void {
    if (this.pending.length === 0) return;
    emit(this.redactor.redact(this.pending));
    this.pending = "";
  }
}

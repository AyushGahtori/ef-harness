import type { RegisteredSecret } from "./types.js";

export interface PacketSecurityRedactorPort {
  register(label: string, value: string): void;
  forget(label: string): boolean;
  redact(text: string): string;
  redactValue(value: unknown): unknown;
}

/** Local port of Task 011 `SecretRedactor` / `PacketSecurityRedactor`. */
export class LocalPacketSecurityRedactor implements PacketSecurityRedactorPort {
  private readonly secrets: { label: string; value: string }[] = [];

  register(label: string, value: string): void {
    if (value.length < 4) return;
    this.forget(label);
    this.secrets.push({ label, value });
  }

  forget(label: string): boolean {
    const before = this.secrets.length;
    const next = this.secrets.filter((secret) => secret.label !== label);
    this.secrets.length = 0;
    this.secrets.push(...next);
    return next.length !== before;
  }

  redact(text: string): string {
    let next = text;
    const ordered = [...this.secrets].sort((left, right) => right.value.length - left.value.length);
    for (const secret of ordered) {
      if (!secret.value) continue;
      next = next.split(secret.value).join(`[REDACTED:${secret.label}]`);
    }
    return next;
  }

  redactValue(value: unknown): unknown {
    if (typeof value === "string") return this.redact(value);
    if (Array.isArray(value)) return value.map((item) => this.redactValue(item));
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) out[key] = this.redactValue(item);
      return out;
    }
    return value;
  }
}

export function registerSecrets(redactor: PacketSecurityRedactorPort, secrets: readonly RegisteredSecret[]): void {
  for (const secret of secrets) redactor.register(secret.label, secret.value);
}

export class ByteBoundedRing {
  private readonly chunks: string[] = [];
  private bytes = 0;

  constructor(private readonly maxBytes: number) {}

  push(text: string): void {
    const clipped = text.length > 2_000 ? `${text.slice(0, 2_000)}…` : text;
    this.chunks.push(clipped);
    this.bytes += Buffer.byteLength(clipped);
    while (this.bytes > this.maxBytes && this.chunks.length > 1) {
      const removed = this.chunks.shift() ?? "";
      this.bytes -= Buffer.byteLength(removed);
    }
    if (this.bytes > this.maxBytes && this.chunks.length === 1) {
      const only = this.chunks[0] ?? "";
      const trimmed = only.slice(0, this.maxBytes);
      this.chunks[0] = trimmed;
      this.bytes = Buffer.byteLength(trimmed);
    }
  }

  snapshot(): string {
    return this.chunks.join("\n");
  }

  get byteLength(): number {
    return this.bytes;
  }
}

export interface TurnLogEntry {
  readonly sessionId: string;
  readonly kind: "acp_wire" | "acp_stderr" | "security";
  readonly text: string;
}

/** Local port of Task 029 `turn_log` append. */
export class LocalTurnLog {
  private readonly entries: TurnLogEntry[] = [];

  constructor(private readonly redactor: PacketSecurityRedactorPort) {}

  append(entry: TurnLogEntry): void {
    this.entries.push({
      sessionId: entry.sessionId,
      kind: entry.kind,
      text: this.redactor.redact(entry.text),
    });
  }

  read(sessionId: string): readonly TurnLogEntry[] {
    return this.entries.filter((entry) => entry.sessionId === sessionId);
  }

  text(sessionId: string): string {
    return this.read(sessionId)
      .map((entry) => entry.text)
      .join("\n");
  }
}

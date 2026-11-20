import type { StructuredLogger } from "./types.js";

export interface CapturedLogLine {
  readonly level: "info" | "warn" | "error";
  readonly message: string;
  readonly fields: unknown;
}

export class CapturingStructuredLogger implements StructuredLogger {
  readonly lines: CapturedLogLine[] = [];

  info(message: string, fields?: unknown): void {
    this.lines.push({ level: "info", message, fields });
  }

  warn(message: string, fields?: unknown): void {
    this.lines.push({ level: "warn", message, fields });
  }

  error(message: string, fields?: unknown): void {
    this.lines.push({ level: "error", message, fields });
  }

  withContext(): StructuredLogger {
    return this;
  }
}

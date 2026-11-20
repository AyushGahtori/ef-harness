export type LogFields = Readonly<Record<string, string | number | boolean>>;

export interface StructuredLogger {
  debug(message: string, fields?: unknown): void;
  info(message: string, fields?: unknown): void;
  warn(message: string, fields?: unknown): void;
  error(message: string, fields?: unknown): void;
}

export interface LogEntry {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly message: string;
  readonly fields?: unknown;
}

export class CapturingLogger implements StructuredLogger {
  readonly entries: LogEntry[] = [];

  debug(message: string, fields?: LogFields): void {
    this.record("debug", message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.record("info", message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.record("warn", message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.record("error", message, fields);
  }

  private record(level: LogEntry["level"], message: string, fields?: unknown): void {
    if (fields !== undefined) this.entries.push({ level, message, fields });
    else this.entries.push({ level, message });
  }
}

export class JsonLineLogger implements StructuredLogger {
  constructor(private readonly write: (line: string) => void = (line) => {
    process.stderr.write(`${line}\n`);
  }) {}

  debug(message: string, fields?: LogFields): void {
    this.emit("debug", message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.emit("info", message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.emit("warn", message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.emit("error", message, fields);
  }

  private emit(level: LogEntry["level"], message: string, fields?: LogFields): void {
    const entry: { level: LogEntry["level"]; message: string; fields?: LogFields } = {
      level,
      message,
    };
    if (fields) entry.fields = fields;
    this.write(JSON.stringify(entry));
  }
}

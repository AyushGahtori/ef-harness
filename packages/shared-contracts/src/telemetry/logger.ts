import { getSharedSecretRedactor, type SecretRedactor } from "./redactor.js";
import type { LogLevel, LogRecord, LogSink, TraceContextSource } from "./types.js";
import { errorMessage } from "./util.js";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

export const UNSET_TRACE_ID = "0".repeat(32);
export const UNSET_SPAN_ID = "0".repeat(16);

export interface LogContext {
  component?: string;
  projectId?: string;
  taskId?: string;
  attemptId?: string;
  traceId?: string;
  spanId?: string;
  level?: LogLevel;
}

export interface StructuredLoggerOptions extends LogContext {
  component: string;
  sink: LogSink;
  redactor?: SecretRedactor;
  now?: () => Date;
  tracer?: TraceContextSource;
}

interface ResolvedLoggerOptions {
  component: string;
  sink: LogSink;
  redactor: SecretRedactor;
  level: LogLevel;
  now: () => Date;
  tracer?: TraceContextSource;
  projectId?: string;
  taskId?: string;
  attemptId?: string;
  traceId?: string;
  spanId?: string;
}

export class StructuredLogger {
  private readonly options: ResolvedLoggerOptions;
  private dropped = 0;

  constructor(options: StructuredLoggerOptions) {
    this.options = resolveLoggerOptions(options);
  }

  debug(message: string, fields?: unknown): void {
    this.write("debug", message, fields);
  }

  info(message: string, fields?: unknown): void {
    this.write("info", message, fields);
  }

  warn(message: string, fields?: unknown): void {
    this.write("warn", message, fields);
  }

  error(message: string, fields?: unknown): void {
    this.write("error", message, fields);
  }

  fatal(message: string, fields?: unknown): void {
    this.write("fatal", message, fields);
  }

  withContext(context: LogContext): StructuredLogger {
    return new StructuredLogger({
      ...this.snapshot(),
      ...definedContext(context),
    });
  }

  flush(): void {
    this.options.sink.flush();
  }

  close(): void {
    this.options.sink.close();
  }

  private write(level: LogLevel, message: string, fields: unknown): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.options.level]) return;
    const immediate = level === "error" || level === "fatal";
    let line: string;
    try {
      line = `${JSON.stringify(this.build(level, message, fields))}\n`;
    } catch (error) {
      line = `${JSON.stringify(this.fallback(level, error))}\n`;
    }
    try {
      this.options.sink.write(line, immediate);
    } catch {
      this.dropped += 1;
    }
  }

  private build(level: LogLevel, message: string, fields: unknown): LogRecord {
    const now = this.options.now();
    const active = this.options.tracer?.activeContext();
    const record: LogRecord = {
      ts: now.toISOString(),
      epochMs: now.getTime(),
      level,
      component: this.options.redactor.redact(this.options.component),
      traceId: this.options.redactor.redact(active?.traceId ?? this.options.traceId ?? UNSET_TRACE_ID),
      spanId: this.options.redactor.redact(active?.spanId ?? this.options.spanId ?? UNSET_SPAN_ID),
      msg: this.options.redactor.redact(message),
      fields: fields === undefined ? {} : this.options.redactor.redactValue(fields),
    };
    assignOptional(record, "projectId", this.options.projectId, this.options.redactor);
    assignOptional(record, "taskId", this.options.taskId, this.options.redactor);
    assignOptional(record, "attemptId", this.options.attemptId, this.options.redactor);
    return record;
  }

  private fallback(level: LogLevel, error: unknown): LogRecord {
    const now = this.options.now();
    let reason = "log failure";
    let component = "logger";
    let traceId = UNSET_TRACE_ID;
    let spanId = UNSET_SPAN_ID;
    try {
      reason = this.options.redactor.redact(errorMessage(error));
      component = this.options.redactor.redact(this.options.component);
      traceId = this.options.redactor.redact(this.options.traceId ?? UNSET_TRACE_ID);
      spanId = this.options.redactor.redact(this.options.spanId ?? UNSET_SPAN_ID);
    } catch {
      reason = "log failure";
    }
    return {
      ts: now.toISOString(),
      epochMs: now.getTime(),
      level,
      component,
      traceId,
      spanId,
      msg: "[REDACTED:LOG_FAILURE]",
      fields: { reason },
    };
  }

  private snapshot(): StructuredLoggerOptions {
    const snapshot: StructuredLoggerOptions = {
      component: this.options.component,
      sink: this.options.sink,
      redactor: this.options.redactor,
      level: this.options.level,
      now: this.options.now,
    };
    if (this.options.tracer) snapshot.tracer = this.options.tracer;
    if (this.options.projectId !== undefined) snapshot.projectId = this.options.projectId;
    if (this.options.taskId !== undefined) snapshot.taskId = this.options.taskId;
    if (this.options.attemptId !== undefined) snapshot.attemptId = this.options.attemptId;
    if (this.options.traceId !== undefined) snapshot.traceId = this.options.traceId;
    if (this.options.spanId !== undefined) snapshot.spanId = this.options.spanId;
    return snapshot;
  }
}

function resolveLoggerOptions(options: StructuredLoggerOptions): ResolvedLoggerOptions {
  const resolved: ResolvedLoggerOptions = {
    component: options.component,
    sink: options.sink,
    redactor: options.redactor ?? getSharedSecretRedactor(),
    level: options.level ?? "info",
    now: options.now ?? (() => new Date()),
  };
  if (options.tracer) resolved.tracer = options.tracer;
  if (options.projectId !== undefined) resolved.projectId = options.projectId;
  if (options.taskId !== undefined) resolved.taskId = options.taskId;
  if (options.attemptId !== undefined) resolved.attemptId = options.attemptId;
  if (options.traceId !== undefined) resolved.traceId = options.traceId;
  if (options.spanId !== undefined) resolved.spanId = options.spanId;
  return resolved;
}

function definedContext(context: LogContext): LogContext {
  const defined: LogContext = {};
  if (context.component !== undefined) defined.component = context.component;
  if (context.projectId !== undefined) defined.projectId = context.projectId;
  if (context.taskId !== undefined) defined.taskId = context.taskId;
  if (context.attemptId !== undefined) defined.attemptId = context.attemptId;
  if (context.traceId !== undefined) defined.traceId = context.traceId;
  if (context.spanId !== undefined) defined.spanId = context.spanId;
  if (context.level !== undefined) defined.level = context.level;
  return defined;
}

function assignOptional(
  record: LogRecord,
  key: "projectId" | "taskId" | "attemptId",
  value: string | undefined,
  redactor: SecretRedactor,
): void {
  if (value === undefined) return;
  record[key] = redactor.redact(value);
}

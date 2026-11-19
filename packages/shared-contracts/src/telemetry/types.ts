export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export type SpanStatus = "unset" | "ok" | "error";

export type SpanKind =
  | "transaction"
  | "attempt"
  | "model_call"
  | "tool_call"
  | "git"
  | "verification"
  | "internal";

export interface LogRecord {
  ts: string;
  epochMs: number;
  level: LogLevel;
  component: string;
  traceId: string;
  spanId: string;
  msg: string;
  fields: unknown;
  projectId?: string;
  taskId?: string;
  attemptId?: string;
}

export interface LogSink {
  write(line: string, immediate?: boolean): void;
  flush(): void;
  close(): void;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
}

export interface TraceContextSource {
  activeContext(): TraceContext | undefined;
}

export interface SpanEvent {
  name: string;
  timeMs: number;
  attributes: Record<string, unknown>;
}

export interface SpanSnapshot {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: SpanKind;
  startMs: number;
  endMs?: number;
  durationMs?: number;
  startEpochMs: number;
  endEpochMs?: number;
  status: SpanStatus;
  attributes: Record<string, unknown>;
  events: SpanEvent[];
}

export interface CompletedSpan extends SpanSnapshot {
  endMs: number;
  durationMs: number;
  endEpochMs: number;
}

export interface SpanHandle {
  readonly span: SpanSnapshot;
  setAttribute(key: string, value: unknown): void;
  setStatus(status: SpanStatus): void;
  recordException(error: unknown): void;
  end(status?: SpanStatus): void;
  run<T>(callback: () => T): T;
}

export interface SecretFinding {
  start: number;
  end: number;
  label: string;
  source: "vault" | "pattern";
}

export interface DiskWarning {
  code: string;
  message: string;
  operation: "open" | "write" | "rotate" | "prune" | "flush";
  path?: string;
}

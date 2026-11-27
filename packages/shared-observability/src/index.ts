import {
  getSharedSecretRedactor,
  type LogLevel as TelemetryLogLevel,
} from "@ef-harness/shared-contracts";

export const packageName = "@ef-harness/shared-observability" as const;
export const layer = 0 as const;

export function redactSecrets(value: string): string {
  return getSharedSecretRedactor().redact(value);
}

export type LogLevel = TelemetryLogLevel;

export function formatLog(
  level: LogLevel,
  message: string,
  fields?: Readonly<Record<string, string | number | boolean>>,
): string {
  const entry: {
    level: LogLevel;
    message: string;
    fields?: Readonly<Record<string, string | number | boolean>>;
  } = {
    level,
    message: redactSecrets(message),
  };
  if (fields) {
    const clean: Record<string, string | number | boolean> = {};
    for (const [key, field] of Object.entries(fields)) {
      clean[key] = typeof field === "string" ? redactSecrets(field) : field;
    }
    entry.fields = clean;
  }
  return JSON.stringify(entry);
}

export function packageIdentity(): {
  readonly name: typeof packageName;
  readonly layer: typeof layer;
} {
  return { name: packageName, layer };
}

export {
  DEFAULT_LOG_MAX_BYTES,
  DEFAULT_LOG_PREFIX,
  DEFAULT_LOG_RETENTION_DAYS,
  DEFAULT_RING_CAPACITY,
  DEFAULT_STREAM_OVERLAP,
  LocalTracer,
  MIN_REGISTERED_SECRET_LENGTH,
  MachineKeyError,
  PacketSecurityRedactor,
  RotatingJsonlSink,
  SECRET_LABEL,
  SecretRedactor,
  StreamingRedactor,
  StructuredLogger,
  UNSET_SPAN_ID,
  UNSET_TRACE_ID,
  clearMachineKeyCache,
  computeSecretHmac,
  createHarnessTelemetry,
  defaultHarnessHome,
  defaultLogDirectory,
  defaultTraceDirectory,
  getSharedSecretRedactor,
  loadOrCreateMachineKey,
  machineKeyPath,
  normalizeRedactionLabel,
  redactionPlaceholder,
  resetSharedSecretRedactor,
  scanForSecrets,
} from "@ef-harness/shared-contracts";
export type {
  AttemptSpanInput,
  CompletedSpan,
  DiskWarning,
  HarnessTelemetry,
  HarnessTelemetryOptions,
  LocalTracerOptions,
  LogContext,
  LogRecord,
  LogSink,
  ModelCallSpanInput,
  RotatingJsonlSinkOptions,
  SecretFinding,
  SecretHmacOptions,
  SpanEvent,
  SpanHandle,
  SpanKind,
  SpanSnapshot,
  SpanStatus,
  StartSpanOptions,
  StructuredLoggerOptions,
  TraceContext,
  TraceContextSource,
} from "@ef-harness/shared-contracts";

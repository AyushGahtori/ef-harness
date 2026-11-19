export { createHarnessTelemetry } from "./create.js";
export type { HarnessTelemetry, HarnessTelemetryOptions } from "./create.js";
export {
  clearMachineKeyCache,
  computeSecretHmac,
  loadOrCreateMachineKey,
  MachineKeyError,
  machineKeyPath,
} from "./hmac.js";
export type { SecretHmacOptions } from "./hmac.js";
export { StructuredLogger, UNSET_SPAN_ID, UNSET_TRACE_ID } from "./logger.js";
export type { LogContext, StructuredLoggerOptions } from "./logger.js";
export { defaultHarnessHome, defaultLogDirectory, defaultTraceDirectory } from "./paths.js";
export { SECRET_LABEL } from "./patterns.js";
export {
  DEFAULT_STREAM_OVERLAP,
  getSharedSecretRedactor,
  MIN_REGISTERED_SECRET_LENGTH,
  normalizeRedactionLabel,
  redactionPlaceholder,
  resetSharedSecretRedactor,
  scanForSecrets,
  SecretRedactor,
  StreamingRedactor,
} from "./redactor.js";
export {
  DEFAULT_LOG_MAX_BYTES,
  DEFAULT_LOG_PREFIX,
  DEFAULT_LOG_RETENTION_DAYS,
  RotatingJsonlSink,
} from "./sink.js";
export type { RotatingJsonlSinkOptions } from "./sink.js";
export { DEFAULT_RING_CAPACITY, LocalTracer } from "./tracer.js";
export type { AttemptSpanInput, LocalTracerOptions, ModelCallSpanInput, StartSpanOptions } from "./tracer.js";
export type {
  CompletedSpan,
  DiskWarning,
  LogLevel,
  LogRecord,
  LogSink,
  SecretFinding,
  SpanEvent,
  SpanHandle,
  SpanKind,
  SpanSnapshot,
  SpanStatus,
  TraceContext,
  TraceContextSource,
} from "./types.js";

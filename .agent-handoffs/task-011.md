---
task_id: "Task-011"
branch: "task/011-logger-tracer-redactor"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/shared-contracts/src/telemetry/**"
  - "packages/shared-contracts/tests/telemetry/**"
  - ".agent-handoffs/task-011.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 011 handoff

Structured diagnostics logger, local span tracer, and universal secret redactor. Commit stays on `task/011-logger-tracer-redactor`.

## Exports Provided

Import from `packages/shared-contracts/src/telemetry/index.ts` (the package barrel is intentionally unchanged):

- `SecretRedactor` — `register`, `forget`, `redact`, `redactValue`, `redactHeaders`, `scanForSecrets`, `openStream`
- `StreamingRedactor` — overlap filter from `openStream`; `push` accepts `string | Uint8Array`, `flush` emits the held tail
- `scanForSecrets(text, redactor?)` — character ranges `{ start, end, label, source }` for pasted secrets; without a redactor, only built-in patterns are scanned
- `getSharedSecretRedactor` / `resetSharedSecretRedactor` — process-wide vault registry used when a logger or tracer is constructed without an explicit redactor
- `computeSecretHmac(secret, { key?, directory? })` — HMAC-SHA256 hex fingerprint; default key is a 32-byte file at `%LOCALAPPDATA%\EFHarness\keys\secret-hmac.key` (or `EF_HARNESS_HOME`)
- `loadOrCreateMachineKey`, `machineKeyPath`, `clearMachineKeyCache`, `MachineKeyError`
- `StructuredLogger` — `debug` / `info` / `warn` / `error` / `fatal`, `withContext`, `flush`, `close`
- `RotatingJsonlSink` — redacting JSONL sink with size and UTC-day rotation, 14-day retention, buffered writes, and shutdown flush
- `LocalTracer` — `startTransaction`, `startAttempt`, `startModelCall`, `startToolCall`, `startGitOperation`, `startVerification`, `startSpan`, `recentSpans`, `traceSpans`, `activeContext`, `flush`, `close`
- `createHarnessTelemetry` — wires one redactor, a log sink under `%LOCALAPPDATA%\EFHarness\logs`, and a trace sink under `logs/traces`
- Constants: `MIN_REGISTERED_SECRET_LENGTH` (8), `DEFAULT_STREAM_OVERLAP` (8192), `DEFAULT_LOG_MAX_BYTES`, `DEFAULT_LOG_RETENTION_DAYS`, `DEFAULT_RING_CAPACITY`, `SECRET_LABEL`, `UNSET_TRACE_ID`, `UNSET_SPAN_ID`

Log records always include `ts` (UTC ISO-8601), `epochMs`, `level`, `component`, `traceId`, `spanId`, `msg`, and `fields`, plus `projectId`, `taskId`, and `attemptId` when set. Completed spans always include `traceId`, `spanId`, `parentSpanId`, `name`, `startMs`, `endMs`, `status`, and `attributes`. Durations use a monotonic clock. Model-call spans carry `taskId`, `attemptId`, and `cost` / `outcome` when provided.

Placeholders are exactly `[REDACTED:<LABEL>]`. Vault labels are normalized to `[A-Z0-9_]+`. Sensitive header values (`Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key`) are replaced entirely.

## Shared Wiring Needs (Root / Index Barrels)

`packages/shared-contracts/src/index.ts` and `packages/shared-contracts/package.json` are frozen by Task 001, so this task does not edit them. Integration should add the subpath and re-export the telemetry barrel.

In `packages/shared-contracts/package.json` `exports`:

```json
"./telemetry": {
  "types": "./dist/telemetry/index.d.ts",
  "import": "./dist/telemetry/index.js"
}
```

In `packages/shared-contracts/src/index.ts`:

```ts
export {
  MachineKeyError,
  SECRET_LABEL,
  SecretRedactor,
  StreamingRedactor,
  StructuredLogger,
  RotatingJsonlSink,
  LocalTracer,
  UNSET_SPAN_ID,
  UNSET_TRACE_ID,
  clearMachineKeyCache,
  computeSecretHmac,
  createHarnessTelemetry,
  getSharedSecretRedactor,
  loadOrCreateMachineKey,
  machineKeyPath,
  normalizeRedactionLabel,
  redactionPlaceholder,
  resetSharedSecretRedactor,
  scanForSecrets,
} from "./telemetry/index.js";
export type {
  AttemptSpanInput,
  CompletedSpan,
  DiskWarning,
  HarnessTelemetry,
  HarnessTelemetryOptions,
  LocalTracerOptions,
  LogContext,
  LogLevel,
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
} from "./telemetry/index.js";
```

After that wiring, daemon packages should import `SecretRedactor`, `StructuredLogger`, and `LocalTracer` from `@ef-harness/shared-contracts` or `@ef-harness/shared-contracts/telemetry`. Register session tokens and vault values on the same redactor instance the logger and tracer use (`createHarnessTelemetry` does this). `scanForSecrets` must receive that redactor to see vault values.

## Dependency Intents (New Packages Requested)

None yet.

## Contract Change Requests

None. `redactions.secret_fingerprint` stays an HMAC-SHA256 hex digest of the secret under the local machine key. No schema or package manifest edits were made.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-011-logger-tracer-redactor`:

- `pnpm --filter @ef-harness/shared-contracts test -- telemetry` — pass, 7 files, 40 tests. Covers exact, Base64, Base64URL, URL-encoded, nested URL-encoded Base64, JSON-escaped, header, Error stack/cause, short-string, split-chunk, overlap, PEM, provider-token, `scanForSecrets` offsets, false-positive code, HMAC, size/day rotation, 14-day prune with the open file skipped, EPERM/EBUSY rename, ENOSPC stderr fallback, buffered flush, `beforeExit` flush, parent/child span trees, monotonic duration across a backward wall clock, ring buffer, model-call linkage, and the canary zero-leak property.
- `pnpm --filter @ef-harness/shared-contracts typecheck` — pass (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/shared-contracts lint` — pass (`eslint .`).
- `node scripts/verify-harmony.mjs --task 011` — pass (`harmony ok for Task-011`). This also re-ran repository typecheck, lint, and the full test suite.

## Known Limitations / Follow-Ups

- Dynamic vault matching ignores values shorter than 8 characters, including their encoded forms.
- The streaming overlap window defaults to 8192 characters. A secret fragment longer than that window can be emitted before the rest of the secret arrives. Callers with larger private-key blocks can raise `openStream({ overlap })`.
- Trace files are written under `logs/traces` with prefix `efharness-trace` so a log-directory retention sweep does not unlink the tracer's open file. Both sinks still delete only their own `efharness-*.jsonl` names and skip the file they have open.
- Username, hostname, and repository-path scrubbing is left to the diagnostics exporter. This module redacts vault values, built-in secret patterns, and the four sensitive headers.
- There is no raw write method on `StructuredLogger` or `LocalTracer`. A custom `LogSink` still receives already-redacted JSON; `RotatingJsonlSink` redacts again before any byte is written.

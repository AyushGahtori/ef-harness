import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { defaultTraceDirectory } from "./paths.js";
import { getSharedSecretRedactor, type SecretRedactor } from "./redactor.js";
import { RotatingJsonlSink } from "./sink.js";
import type {
  CompletedSpan,
  DiskWarning,
  LogSink,
  SpanEvent,
  SpanHandle,
  SpanKind,
  SpanSnapshot,
  SpanStatus,
  TraceContext,
  TraceContextSource,
} from "./types.js";

export const DEFAULT_RING_CAPACITY = 1024;

export interface StartSpanOptions {
  kind?: SpanKind;
  attributes?: Record<string, unknown>;
  parent?: SpanHandle;
  traceId?: string;
}

export interface ModelCallSpanInput {
  name?: string;
  taskId: string;
  attemptId: string;
  cost?: number;
  outcome?: string;
  model?: string;
  projectId?: string;
  attributes?: Record<string, unknown>;
  parent?: SpanHandle;
}

export interface AttemptSpanInput {
  attemptId: string;
  taskId?: string;
  projectId?: string;
  attributes?: Record<string, unknown>;
  parent?: SpanHandle;
}

export interface LocalTracerOptions {
  redactor?: SecretRedactor;
  sink?: LogSink;
  traceDirectory?: string;
  ringCapacity?: number;
  monotonicNow?: () => number;
  wallNow?: () => number;
  idFactory?: (bytes: number) => string;
  clock?: () => Date;
  onDiskWarning?: (warning: DiskWarning) => void;
  maxBytes?: number;
  retentionDays?: number;
}

interface MutableSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: SpanKind;
  startMs: number;
  startEpochMs: number;
  endMs?: number;
  durationMs?: number;
  endEpochMs?: number;
  status: SpanStatus;
  attributes: Record<string, unknown>;
  events: SpanEvent[];
  ended: boolean;
}

const spanStates = new WeakMap<SpanHandle, MutableSpan>();

class SpanHandleImpl implements SpanHandle {
  constructor(
    private readonly render: () => SpanSnapshot,
    private readonly finishSpan: (status?: SpanStatus) => void,
    private readonly runSpan: <T>(callback: () => T) => T,
    private readonly clock: () => number,
    private readonly state: MutableSpan,
  ) {
    spanStates.set(this, state);
  }

  get span(): SpanSnapshot {
    return this.render();
  }

  setAttribute(key: string, value: unknown): void {
    if (!this.state.ended) this.state.attributes[key] = value;
  }

  setStatus(status: SpanStatus): void {
    if (!this.state.ended) this.state.status = status;
  }

  recordException(error: unknown): void {
    if (this.state.ended) return;
    this.state.events.push({
      name: "exception",
      timeMs: this.clock(),
      attributes: { error },
    });
    this.state.status = "error";
  }

  end(status?: SpanStatus): void {
    this.finishSpan(status);
  }

  run<T>(callback: () => T): T {
    return this.runSpan(callback);
  }
}

export class LocalTracer implements TraceContextSource {
  private readonly redactor: SecretRedactor;
  private readonly sink: LogSink;
  private readonly ownsSink: boolean;
  private readonly ring: Array<CompletedSpan | undefined>;
  private readonly ringCapacity: number;
  private ringStart = 0;
  private ringCount = 0;
  private readonly monotonicClock: () => number;
  private readonly wallClock: () => number;
  private readonly idFactory: (bytes: number) => string;
  private readonly als = new AsyncLocalStorage<MutableSpan>();
  private readonly open = new Set<MutableSpan>();
  private closed = false;
  private droppedSpans = 0;

  constructor(options: LocalTracerOptions = {}) {
    this.redactor = options.redactor ?? getSharedSecretRedactor();
    this.monotonicClock = options.monotonicNow ?? (() => performance.now());
    this.wallClock = options.wallNow ?? (() => Date.now());
    this.idFactory = options.idFactory ?? ((bytes) => randomBytes(bytes).toString("hex"));
    const requested = options.ringCapacity;
    this.ringCapacity =
      requested === undefined ? DEFAULT_RING_CAPACITY : Math.max(0, Math.floor(requested));
    this.ring = new Array<CompletedSpan | undefined>(this.ringCapacity);
    if (options.sink) {
      this.sink = options.sink;
      this.ownsSink = false;
    } else {
      const sinkOptions: ConstructorParameters<typeof RotatingJsonlSink>[0] = {
        directory: options.traceDirectory ?? defaultTraceDirectory(),
        prefix: "efharness-trace",
        redactor: this.redactor,
      };
      if (options.clock) sinkOptions.clock = options.clock;
      if (options.onDiskWarning) sinkOptions.onDiskWarning = options.onDiskWarning;
      if (options.maxBytes !== undefined) sinkOptions.maxBytes = options.maxBytes;
      if (options.retentionDays !== undefined) sinkOptions.retentionDays = options.retentionDays;
      this.sink = new RotatingJsonlSink(sinkOptions);
      this.ownsSink = true;
    }
  }

  activeContext(): TraceContext | undefined {
    const current = this.als.getStore();
    if (!current) return undefined;
    return { traceId: current.traceId, spanId: current.spanId };
  }

  startSpan(name: string, options?: StartSpanOptions): SpanHandle {
    const parent = options?.parent ? spanStates.get(options.parent) : this.als.getStore();
    const state: MutableSpan = {
      traceId: options?.traceId ?? parent?.traceId ?? this.idFactory(16),
      spanId: this.idFactory(8),
      parentSpanId: parent?.spanId ?? null,
      name,
      kind: options?.kind ?? "internal",
      startMs: this.monotonicClock(),
      startEpochMs: this.wallClock(),
      status: "unset",
      attributes: copyDefined(options?.attributes),
      events: [],
      ended: false,
    };
    const handle = new SpanHandleImpl(
      () => this.snapshotOf(state),
      (status) => this.finish(state, status),
      (callback) => this.als.run(state, callback),
      () => this.monotonicClock(),
      state,
    );
    this.open.add(state);
    return handle;
  }

  startTransaction(name: string, attributes?: Record<string, unknown>): SpanHandle {
    return this.startSpan(name, definedKind("transaction", attributes));
  }

  startAttempt(name: string, input: AttemptSpanInput): SpanHandle {
    const attributes = copyDefined(input.attributes);
    attributes.attemptId = input.attemptId;
    if (input.taskId !== undefined) attributes.taskId = input.taskId;
    if (input.projectId !== undefined) attributes.projectId = input.projectId;
    const options: StartSpanOptions = { kind: "attempt", attributes };
    if (input.parent) options.parent = input.parent;
    return this.startSpan(name, options);
  }

  startModelCall(input: ModelCallSpanInput): SpanHandle {
    const attributes = copyDefined(input.attributes);
    attributes.taskId = input.taskId;
    attributes.attemptId = input.attemptId;
    if (input.cost !== undefined) attributes.cost = input.cost;
    if (input.outcome !== undefined) attributes.outcome = input.outcome;
    if (input.model !== undefined) attributes.model = input.model;
    if (input.projectId !== undefined) attributes.projectId = input.projectId;
    const options: StartSpanOptions = { kind: "model_call", attributes };
    if (input.parent) options.parent = input.parent;
    return this.startSpan(input.name ?? "model_call", options);
  }

  startToolCall(name: string, attributes?: Record<string, unknown>): SpanHandle {
    return this.startSpan(name, definedKind("tool_call", attributes));
  }

  startGitOperation(name: string, attributes?: Record<string, unknown>): SpanHandle {
    return this.startSpan(name, definedKind("git", attributes));
  }

  startVerification(name: string, attributes?: Record<string, unknown>): SpanHandle {
    return this.startSpan(name, definedKind("verification", attributes));
  }

  recentSpans(limit?: number): readonly CompletedSpan[] {
    const spans = this.snapshotRing();
    if (limit === undefined || limit >= spans.length) return spans;
    if (limit <= 0) return [];
    return spans.slice(spans.length - limit);
  }

  traceSpans(traceId: string): readonly CompletedSpan[] {
    return this.snapshotRing().filter((span) => span.traceId === traceId);
  }

  flush(): void {
    this.sink.flush();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const state of [...this.open]) {
      const status: SpanStatus = state.status === "unset" ? "error" : state.status;
      this.finish(state, status, "process_shutdown");
    }
    this.sink.flush();
    if (this.ownsSink) this.sink.close();
  }

  private finish(state: MutableSpan, status?: SpanStatus, reason?: string): void {
    if (state.ended) return;
    if (reason !== undefined) state.attributes.endReason = reason;
    if (status !== undefined) state.status = status;
    else if (state.status === "unset") state.status = "ok";
    const endMs = this.monotonicClock();
    state.ended = true;
    state.endMs = endMs;
    state.durationMs = Math.max(0, endMs - state.startMs);
    state.endEpochMs = this.wallClock();
    this.open.delete(state);
    const completed = this.toCompleted(state);
    this.pushRing(completed);
    try {
      this.sink.write(`${JSON.stringify(completed)}\n`, completed.status === "error");
    } catch {
      this.droppedSpans += 1;
    }
  }

  private snapshotOf(state: MutableSpan): SpanSnapshot {
    const snapshot: SpanSnapshot = {
      traceId: state.traceId,
      spanId: state.spanId,
      parentSpanId: state.parentSpanId,
      name: this.redactor.redact(state.name),
      kind: state.kind,
      startMs: state.startMs,
      startEpochMs: state.startEpochMs,
      status: state.status,
      attributes: asRecord(this.redactor.redactValue(state.attributes)),
      events: asEvents(this.redactor.redactValue(state.events)),
    };
    if (state.ended && state.endMs !== undefined && state.durationMs !== undefined && state.endEpochMs !== undefined) {
      snapshot.endMs = state.endMs;
      snapshot.durationMs = state.durationMs;
      snapshot.endEpochMs = state.endEpochMs;
    }
    return snapshot;
  }

  private toCompleted(state: MutableSpan): CompletedSpan {
    const snapshot = this.snapshotOf(state);
    return {
      ...snapshot,
      endMs: state.endMs ?? state.startMs,
      durationMs: state.durationMs ?? 0,
      endEpochMs: state.endEpochMs ?? state.startEpochMs,
    };
  }

  private pushRing(span: CompletedSpan): void {
    if (this.ringCapacity <= 0) return;
    if (this.ringCount < this.ringCapacity) {
      this.ring[this.ringCount] = span;
      this.ringCount += 1;
      return;
    }
    this.ring[this.ringStart] = span;
    this.ringStart = (this.ringStart + 1) % this.ringCapacity;
  }

  private snapshotRing(): CompletedSpan[] {
    const spans: CompletedSpan[] = [];
    if (this.ringCapacity <= 0 || this.ringCount === 0) return spans;
    if (this.ringCount < this.ringCapacity) {
      for (let index = 0; index < this.ringCount; index += 1) {
        const span = this.ring[index];
        if (span) spans.push(span);
      }
      return spans;
    }
    for (let index = 0; index < this.ringCapacity; index += 1) {
      const span = this.ring[(this.ringStart + index) % this.ringCapacity];
      if (span) spans.push(span);
    }
    return spans;
  }
}

function definedKind(kind: SpanKind, attributes?: Record<string, unknown>): StartSpanOptions {
  if (attributes === undefined) return { kind };
  return { kind, attributes };
}

function copyDefined(attributes: Record<string, unknown> | undefined): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  if (!attributes) return copy;
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) copy[key] = value;
  }
  return copy;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asEvents(value: unknown): SpanEvent[] {
  if (!Array.isArray(value)) return [];
  const events: SpanEvent[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "event";
    const timeMs = typeof record.timeMs === "number" ? record.timeMs : 0;
    const attributes = asRecord(record.attributes);
    events.push({ name, timeMs, attributes });
  }
  return events;
}

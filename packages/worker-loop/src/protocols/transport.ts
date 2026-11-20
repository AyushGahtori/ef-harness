import { usdToMicroUnits } from "./currency-port.js";
import { classifyProviderFailure } from "./errors.js";
import {
  NormalizedModelError,
  StreamStallError,
  UnknownOutcomeTimeoutError,
} from "./model-error.js";
import { redactStructured } from "./redact-payload.js";
import { systemScheduler, type TimeoutScheduler } from "./scheduler.js";
import { SseByteParser, type SseFrame } from "./sse.js";
import { createInMemoryTracer, createLocalSecretRedactor } from "./telemetry-port.js";
import type { AdapterCallOptions, ProtocolFamily, StopReason, StreamEvent } from "./types.js";
import {
  emptyTokenUsage,
  estimateOutputTokens,
  mergeTokenUsage,
  type TokenUsage,
} from "./usage.js";

export const IDLE_TIMEOUT_MS = 60_000;

export interface SseTranslator {
  push(frame: SseFrame): StreamEvent[];
  finish(): StreamEvent[];
  usage(): TokenUsage;
  stopReason(): StopReason;
}

export interface PreparedHttpRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly opaque: ReadonlySet<unknown>;
  readonly outputBudget: number | null;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly protocol: ProtocolFamily;
  readonly model: string;
  readonly route: string;
}

interface ResolvedCall {
  readonly fetchImpl: typeof fetch;
  readonly redactor: ReturnType<typeof createLocalSecretRedactor>;
  readonly tracer: ReturnType<typeof createInMemoryTracer>;
  readonly idleTimeoutMs: number;
  readonly scheduler: TimeoutScheduler;
  readonly signal: AbortSignal | undefined;
  readonly countOutputTokens: (text: string) => number;
  readonly traceParentSpanId: string | undefined;
}

export async function* postProviderStream(
  prepared: PreparedHttpRequest,
  options: AdapterCallOptions,
  createTranslator: () => SseTranslator,
): AsyncGenerator<StreamEvent, void, undefined> {
  const resolved = resolveCall(options);
  const span = resolved.tracer.startSpan({
    name: "model.call",
    ...(resolved.traceParentSpanId ? { parentSpanId: resolved.traceParentSpanId } : {}),
    attributes: {
      protocol: prepared.protocol,
      model: prepared.model,
      route: prepared.route,
      clientRequestId: prepared.clientRequestId,
    },
  });
  let ended = false;
  const endSpan = (
    status: "ok" | "error",
    attributes: Readonly<Record<string, string | number | boolean | null>>,
  ): void => {
    if (ended) return;
    ended = true;
    resolved.tracer.endSpan(span.spanId, { status, attributes });
  };

  const safeBody = redactStructured(prepared.body, resolved.redactor, prepared.opaque);
  const bodyText = JSON.stringify(safeBody);
  for (const item of prepared.opaque) {
    const canonical = JSON.stringify(item);
    if (!bodyText.includes(canonical)) {
      endSpan("error", { errorKind: "opaque_replay_mutated" });
      throw new Error("opaque replay item was mutated before send");
    }
  }

  const fetchController = new AbortController();
  const stallController = new AbortController();
  const budgetController = new AbortController();
  linkAbort(stallController.signal, fetchController);
  linkAbort(budgetController.signal, fetchController);
  if (resolved.signal) linkAbort(resolved.signal, fetchController);

  let transmitted = false;
  let response: Response;
  try {
    transmitted = true;
    response = await resolved.fetchImpl(prepared.url, {
      method: "POST",
      headers: { ...prepared.headers },
      body: bodyText,
      signal: fetchController.signal,
    });
  } catch (error) {
    const wrapped = classifyTransportFailure(error, {
      transmitted,
      stallAborted: stallController.signal.aborted,
      externalAborted: resolved.signal?.aborted === true,
      clientRequestId: prepared.clientRequestId,
      idempotencyKey: prepared.idempotencyKey,
    });
    endSpan("error", { errorKind: wrapped.kind });
    throw wrapped;
  }

  if (!response.ok) {
    const raw = await response.text();
    const nowMs = options.nowMs?.();
    const failure = classifyProviderFailure({
      status: response.status,
      headers: response.headers,
      bodyText: resolved.redactor.redact(raw),
      clientRequestId: prepared.clientRequestId,
      idempotencyKey: prepared.idempotencyKey,
      ...(nowMs === undefined ? {} : { nowMs }),
    });
    endSpan("error", { errorKind: failure.kind });
    throw failure;
  }

  const headerMeta = readProviderMeta(response.headers);
  if (headerMeta) yield headerMeta;

  const reader = response.body?.getReader();
  if (!reader) {
    const failure = new NormalizedModelError({
      kind: "unknown",
      message: "provider response had no body",
      clientRequestId: prepared.clientRequestId,
      idempotencyKey: prepared.idempotencyKey,
    });
    endSpan("error", { errorKind: failure.kind });
    throw failure;
  }

  const translator = createTranslator();
  const parser = new SseByteParser();
  let streamed = 0;
  let idleHandle: number | null = null;
  const clearIdle = (): void => {
    if (idleHandle === null) return;
    resolved.scheduler.clear(idleHandle);
    idleHandle = null;
  };
  const armIdle = (): void => {
    clearIdle();
    idleHandle = resolved.scheduler.schedule(() => {
      stallController.abort();
    }, resolved.idleTimeoutMs);
  };

  const publish = function* (
    events: readonly StreamEvent[],
  ): Generator<StreamEvent, boolean, undefined> {
    for (const event of events) {
      streamed += tokensFor(event, resolved.countOutputTokens);
      yield event;
      if (prepared.outputBudget !== null && streamed > prepared.outputBudget) {
        const settled = settleCutoff(applyHeaderCost(translator.usage(), headerMeta), streamed);
        yield { type: "usage", usage: settled };
        yield { type: "stop", stopReason: "output_budget_cutoff" };
        budgetController.abort();
        return true;
      }
    }
    return false;
  };

  try {
    armIdle();
    while (true) {
      let chunk: Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (budgetController.signal.aborted) return;
        if (stallController.signal.aborted) {
          const partial = settleCutoff(applyHeaderCost(translator.usage(), headerMeta), streamed);
          const stall = new StreamStallError(
            partial,
            prepared.clientRequestId,
            prepared.idempotencyKey,
          );
          endSpan("error", { errorKind: "stream_stall", outputTokens: partial.outputTokens });
          throw stall;
        }
        if (resolved.signal?.aborted && transmitted) {
          const timeout = new UnknownOutcomeTimeoutError(
            prepared.clientRequestId,
            prepared.idempotencyKey,
            settleCutoff(translator.usage(), streamed),
          );
          endSpan("error", { errorKind: "unknown_timeout" });
          throw timeout;
        }
        endSpan("error", { errorKind: "unknown" });
        throw error;
      }
      clearIdle();
      if (chunk.done) break;
      if (chunk.value) {
        const crossed = yield* publish(
          parser.push(chunk.value).flatMap((frame) => translator.push(frame)),
        );
        if (crossed) {
          endSpan("ok", { stopReason: "output_budget_cutoff", outputTokens: streamed });
          return;
        }
      }
      armIdle();
    }
    const crossed = yield* publish([
      ...parser.finish().flatMap((frame) => translator.push(frame)),
      ...translator.finish(),
    ]);
    if (crossed) {
      endSpan("ok", { stopReason: "output_budget_cutoff", outputTokens: streamed });
      return;
    }
    const usage = finalizeUsage(applyHeaderCost(translator.usage(), headerMeta), streamed);
    const stopReason = translator.stopReason();
    yield { type: "usage", usage };
    yield { type: "stop", stopReason };
    endSpan("ok", { stopReason, outputTokens: usage.outputTokens, inputTokens: usage.inputTokens });
  } finally {
    clearIdle();
    await reader.cancel().catch(() => undefined);
    if (!ended) endSpan("ok", { stopReason: translator.stopReason(), outputTokens: streamed });
  }
}

function tokensFor(event: StreamEvent, counter: (text: string) => number): number {
  if (event.type === "text_delta") return counter(event.text);
  if (event.type === "tool_call_delta") return counter(event.argumentsDelta);
  return 0;
}

function settleCutoff(usage: TokenUsage, streamed: number): TokenUsage {
  return mergeTokenUsage(usage, {
    outputTokens: streamed,
    totalTokens:
      usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens + streamed,
  });
}

function finalizeUsage(usage: TokenUsage, streamed: number): TokenUsage {
  if (usage.outputTokens > 0 || streamed === 0) return usage;
  return settleCutoff(usage, streamed);
}

function applyHeaderCost(
  usage: TokenUsage,
  meta: Extract<StreamEvent, { type: "provider_meta" }> | null,
): TokenUsage {
  if (!meta || meta.costMicroUsd === null || usage.costMicroUsd !== null) return usage;
  return mergeTokenUsage(usage, { costMicroUsd: meta.costMicroUsd });
}

function readProviderMeta(
  headers: Headers,
): Extract<StreamEvent, { type: "provider_meta" }> | null {
  const providerName = headers.get("x-openrouter-provider");
  const costRaw = headers.get("x-openrouter-cost");
  if (providerName === null && costRaw === null) return null;
  return {
    type: "provider_meta",
    providerName,
    costMicroUsd: costRaw === null ? null : usdToMicroUnits(costRaw.trim()),
  };
}

function resolveCall(options: AdapterCallOptions): ResolvedCall {
  if (options.baseUrl.trim().length === 0) throw new Error("baseUrl is required");
  if (options.apiKey.trim().length === 0) throw new Error("apiKey is required");
  const hasSchedule = options.scheduleTimeout !== undefined;
  const hasClear = options.clearScheduledTimeout !== undefined;
  if (hasSchedule !== hasClear || !options.scheduleTimeout || !options.clearScheduledTimeout) {
    if (hasSchedule || hasClear) {
      throw new Error("scheduleTimeout and clearScheduledTimeout must be provided together");
    }
  }
  const scheduler =
    options.scheduleTimeout && options.clearScheduledTimeout
      ? { schedule: options.scheduleTimeout, clear: options.clearScheduledTimeout }
      : systemScheduler();
  const idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
  if (!Number.isSafeInteger(idleTimeoutMs) || idleTimeoutMs <= 0) {
    throw new Error("idleTimeoutMs must be a positive safe integer");
  }
  return {
    fetchImpl: options.fetchImpl ?? fetch,
    redactor: options.redactor ?? createLocalSecretRedactor(),
    tracer: (options.tracer as ResolvedCall["tracer"] | undefined) ?? createInMemoryTracer(),
    idleTimeoutMs,
    scheduler,
    signal: options.signal,
    countOutputTokens: options.countOutputTokens ?? estimateOutputTokens,
    traceParentSpanId: options.traceParentSpanId,
  };
}

function classifyTransportFailure(
  error: unknown,
  input: {
    readonly transmitted: boolean;
    readonly stallAborted: boolean;
    readonly externalAborted: boolean;
    readonly clientRequestId: string;
    readonly idempotencyKey: string;
  },
): NormalizedModelError {
  if (error instanceof NormalizedModelError) return error;
  if (input.stallAborted) {
    return new StreamStallError(emptyTokenUsage(), input.clientRequestId, input.idempotencyKey);
  }
  if (input.transmitted && (input.externalAborted || isAbortError(error))) {
    return new UnknownOutcomeTimeoutError(input.clientRequestId, input.idempotencyKey);
  }
  const message = error instanceof Error ? error.message : "provider request failed";
  return new NormalizedModelError({
    kind: "unknown",
    message,
    clientRequestId: input.clientRequestId,
    idempotencyKey: input.idempotencyKey,
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function linkAbort(source: AbortSignal, target: AbortController): void {
  if (source.aborted) {
    target.abort(source.reason);
    return;
  }
  source.addEventListener(
    "abort",
    () => {
      target.abort(source.reason);
    },
    { once: true },
  );
}

export function joinUrl(baseUrl: string, suffix: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith(suffix)) return trimmed;
  return `${trimmed}${suffix}`;
}

export function identityHeaders(
  apiKeyHeader: Readonly<Record<string, string>>,
  clientRequestId: string,
  idempotencyKey: string,
): Record<string, string> {
  return {
    accept: "text/event-stream",
    "content-type": "application/json",
    "idempotency-key": idempotencyKey,
    "x-client-request-id": clientRequestId,
    ...apiKeyHeader,
  };
}

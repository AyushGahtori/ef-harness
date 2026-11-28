import {
  JUNIOR_CONTEXT_FLOOR,
  MAX_PARALLEL_SAME_WEIGHTS,
  SENIOR_CONTEXT_RECOMMENDED,
  SINGLE_SLOT_VRAM_CEILING_BYTES,
  type ExplicitNumCtx,
} from "./constants.js";
import { OpenRouterLocalError } from "./errors.js";
import type {
  GpuHeadroomSample,
  LocalTurnReceipt,
  VramTelemetryPort,
  WhisperPriorityPort,
} from "./ports.js";

export function estimateRequiredVramBytes(modelBytes: number, kvCacheBytes: number): number {
  if (!Number.isFinite(modelBytes) || modelBytes < 0 || !Number.isFinite(kvCacheBytes) || kvCacheBytes < 0) {
    throw new OpenRouterLocalError("bad-vram", "VRAM estimate inputs must be non-negative");
  }
  return Math.ceil(modelBytes * 1.25 + kvCacheBytes);
}

/** Conservative KV size when the GGUF header does not publish one. */
export function estimateKvCacheBytes(modelBytes: number, numCtx: number): number {
  if (!Number.isFinite(modelBytes) || modelBytes < 0 || !Number.isInteger(numCtx) || numCtx <= 0) {
    throw new OpenRouterLocalError("bad-vram", "KV cache inputs are invalid");
  }
  return Math.ceil(modelBytes * (numCtx / SENIOR_CONTEXT_RECOMMENDED) * 0.25);
}

export function assertExplicitNumCtx(value: number): ExplicitNumCtx {
  if (value !== 16_384 && value !== 32_768) {
    throw new OpenRouterLocalError(
      "num-ctx",
      "Ollama num_ctx must be 16384 or 32768 so the 2048 default cannot truncate the brief",
    );
  }
  return value;
}

/**
 * Always 16384 or 32768. Ollama's silent 2048 default is never forwarded.
 * 32768 is used only when the brief wants it and the VRAM estimate fits.
 */
export function chooseExplicitNumCtx(input: {
  readonly briefTokens: number;
  readonly budgetBytes: number;
  readonly modelBytes: number;
  readonly baselineUsageBytes: number;
}): ExplicitNumCtx {
  const headroom = Math.max(0, input.budgetBytes - Math.max(0, input.baselineUsageBytes));
  const at32 = estimateRequiredVramBytes(
    input.modelBytes,
    estimateKvCacheBytes(Math.max(input.modelBytes, 1), 32_768),
  );
  if (input.briefTokens > JUNIOR_CONTEXT_FLOOR && at32 <= headroom) return 32_768;
  if (input.briefTokens <= JUNIOR_CONTEXT_FLOOR && at32 <= headroom && input.modelBytes > 0) {
    return 32_768;
  }
  return assertExplicitNumCtx(16_384);
}

export interface OllamaChatBody {
  readonly model: string;
  readonly stream: false;
  readonly messages: readonly { readonly role: "user"; readonly content: string }[];
  readonly options: { readonly num_ctx: ExplicitNumCtx };
}

export function buildOllamaChatBody(input: {
  readonly model: string;
  readonly content: string;
  readonly numCtx: number;
}): OllamaChatBody {
  const numCtx = assertExplicitNumCtx(input.numCtx);
  return {
    model: input.model,
    stream: false,
    messages: [{ role: "user", content: input.content }],
    options: { num_ctx: numCtx },
  };
}

export function localTurnReceipt(input: {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly wallClockMs: number;
}): LocalTurnReceipt {
  if (
    !Number.isFinite(input.promptTokens) ||
    input.promptTokens < 0 ||
    !Number.isFinite(input.completionTokens) ||
    input.completionTokens < 0 ||
    !Number.isFinite(input.wallClockMs) ||
    input.wallClockMs < 0
  ) {
    throw new OpenRouterLocalError("bad-receipt", "local receipt counts must be non-negative");
  }
  const totalTokens = input.promptTokens + input.completionTokens;
  const wallClockSeconds = input.wallClockMs / 1000;
  return {
    currency: "local_slots",
    costMicroUsd: 0,
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    totalTokens,
    wallClockSeconds,
    tokensPerSecond: wallClockSeconds > 0 ? totalTokens / wallClockSeconds : 0,
  };
}

export interface VramAcquireRequest {
  readonly id: string;
  readonly modelId: string;
  readonly modelBytes: number;
  readonly kvCacheBytes: number;
  readonly briefTokens?: number;
}

export type VramAcquireResult =
  | {
      readonly status: "granted";
      readonly estimatedBytes: number;
      readonly distinctModels: number;
      readonly parallelSlot: number;
      readonly numCtx: ExplicitNumCtx;
    }
  | {
      readonly status: "deferred";
      readonly reason: "whisper_priority" | "distinct_model_cap" | "insufficient_headroom" | "same_model_batched";
      readonly message: string;
      readonly estimatedBytes: number;
    };

export interface VramSlotManagerOptions {
  readonly telemetry: VramTelemetryPort;
  readonly whisper: WhisperPriorityPort;
  readonly ollamaNumParallel?: number;
}

interface ActiveSlot {
  readonly id: string;
  readonly modelId: string;
  readonly estimatedBytes: number;
  readonly kvCacheBytes: number;
  readonly modelBytes: number;
}

function readEnvParallel(): number {
  const raw = process.env.OLLAMA_NUM_PARALLEL;
  if (raw === undefined || raw.trim() === "") return 1;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return parsed;
}

function budgetBytes(sample: GpuHeadroomSample): number | null {
  if (sample.budgetBytes !== null && sample.budgetBytes > 0) return sample.budgetBytes;
  if (sample.sharedVramBudgetBytes !== null && sample.sharedVramBudgetBytes > 0) {
    return sample.sharedVramBudgetBytes;
  }
  return null;
}

/**
 * One distinct local model on GPUs at or under 16 GB. A second slot is allowed
 * only for weights that are already loaded, and only when `OLLAMA_NUM_PARALLEL`
 * and VRAM headroom both allow it. Dictation preempts the next dispatch.
 */
export class LocalVramSlotManager {
  private readonly active: ActiveSlot[] = [];
  private readonly parallelCap: number;

  constructor(private readonly options: VramSlotManagerOptions) {
    const requested = options.ollamaNumParallel ?? readEnvParallel();
    this.parallelCap = requested >= 2 ? MAX_PARALLEL_SAME_WEIGHTS : 1;
  }

  onDictationHotkey(modelClass: "base" | "small" = "base"): void {
    this.options.whisper.activateDictation(modelClass);
  }

  onDictationFinished(): void {
    this.options.whisper.deactivateDictation();
  }

  release(id: string): void {
    const index = this.active.findIndex((slot) => slot.id === id);
    if (index >= 0) this.active.splice(index, 1);
  }

  async acquire(request: VramAcquireRequest): Promise<VramAcquireResult> {
    const estimatedBytes = estimateRequiredVramBytes(request.modelBytes, request.kvCacheBytes);
    const sample = await this.options.telemetry.sampleGpu();
    const budget = budgetBytes(sample);
    if (this.options.whisper.dictationActive) {
      const ticket = this.options.whisper.enqueueLocalModel({
        id: request.id,
        modelId: request.modelId,
        vramMb: Math.ceil(estimatedBytes / (1024 * 1024)),
        role: "background",
        start: "queued",
      });
      return {
        status: "deferred",
        reason: "whisper_priority",
        message: ticket.reason,
        estimatedBytes,
      };
    }
    const distinct = new Set(this.active.map((slot) => slot.modelId));
    const same = this.active.filter((slot) => slot.modelId === request.modelId);
    const maxDistinct = budget !== null && budget > SINGLE_SLOT_VRAM_CEILING_BYTES ? 2 : 1;
    if (same.length === 0 && distinct.size >= maxDistinct) {
      return {
        status: "deferred",
        reason: "distinct_model_cap",
        message: `distinct local models are capped at ${maxDistinct} VRAM ${maxDistinct === 1 ? "slot" : "slots"}`,
        estimatedBytes,
      };
    }
    const baseline = sample.currentUsageBytes ?? 0;
    const reserved = this.active.reduce((sum, slot) => sum + slot.estimatedBytes, 0);
    const available = (budget ?? 0) - baseline - reserved;
    if (same.length > 0) {
      if (same.length < this.parallelCap && request.kvCacheBytes <= available) {
        this.active.push({
          id: request.id,
          modelId: request.modelId,
          estimatedBytes: request.kvCacheBytes,
          kvCacheBytes: request.kvCacheBytes,
          modelBytes: request.modelBytes,
        });
        return this.granted(request, request.kvCacheBytes, distinct.size, same.length + 1, budget, baseline);
      }
      return {
        status: "deferred",
        reason: "same_model_batched",
        message: "Waiting for the loaded local model slot",
        estimatedBytes,
      };
    }
    if (budget === null || estimatedBytes > available) {
      return {
        status: "deferred",
        reason: "insufficient_headroom",
        message: "not enough VRAM headroom for this local model",
        estimatedBytes,
      };
    }
    this.active.push({
      id: request.id,
      modelId: request.modelId,
      estimatedBytes,
      kvCacheBytes: request.kvCacheBytes,
      modelBytes: request.modelBytes,
    });
    return this.granted(request, estimatedBytes, distinct.size + 1, 1, budget, baseline);
  }

  private granted(
    request: VramAcquireRequest,
    estimatedBytes: number,
    distinctModels: number,
    parallelSlot: number,
    budget: number | null,
    baseline: number,
  ): VramAcquireResult {
    const numCtx = chooseExplicitNumCtx({
      briefTokens: request.briefTokens ?? JUNIOR_CONTEXT_FLOOR,
      budgetBytes: budget ?? 0,
      modelBytes: request.modelBytes,
      baselineUsageBytes: baseline,
    });
    return {
      status: "granted",
      estimatedBytes,
      distinctModels,
      parallelSlot,
      numCtx,
    };
  }
}

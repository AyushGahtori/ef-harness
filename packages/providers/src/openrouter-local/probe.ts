import {
  JUNIOR_CONTEXT_FLOOR,
  PROBE_JSON_STATUS,
  PROBE_NONCE,
  PROBE_TIMEOUT_MS,
  PROBE_TOOL_NAME,
  SENIOR_CONTEXT_RECOMMENDED,
  type ExplicitNumCtx,
} from "./constants.js";
import { OpenRouterLocalError } from "./errors.js";
import { fetchWithTimeout, isConnectionRefused } from "./http.js";
import { arrayField, isRecord, numberField, parseJson, readJsonResponse, recordField, stringField } from "./json.js";
import { assertDiscoveryUrl } from "./loopback-url.js";
import type { DiscoveredLocalModel, FetchPort, LocalProbeResult } from "./ports.js";
import { assertExplicitNumCtx, chooseExplicitNumCtx } from "./vram.js";

export function formatContextTokens(tokens: number): string {
  if (Number.isInteger(tokens) && tokens > 0 && tokens % 1024 === 0) {
    return `${tokens / 1024}k`;
  }
  return String(tokens);
}

export function contextTooSmallMessage(tokens: number): string {
  return `Context ${formatContextTokens(tokens)} too small for coding tasks (needs >= 16k)`;
}

export function seniorContextWarning(tokens: number): string {
  return `Context ${formatContextTokens(tokens)} is below 32k; Senior/Planner briefs need >= 32k`;
}

export function effectiveContextTokens(model: DiscoveredLocalModel, requested: ExplicitNumCtx): number {
  if (model.configuredNumCtx !== null) return model.configuredNumCtx;
  if (model.architectureContext !== null) return Math.min(model.architectureContext, requested);
  return requested;
}

export interface ProbeChatRequest {
  readonly path: string;
  readonly body: {
    readonly model: string;
    readonly stream: false;
    readonly messages: readonly { readonly role: "user"; readonly content: string }[];
    readonly tools: readonly [typeof PROBE_TOOL];
    readonly options?: { readonly num_ctx: ExplicitNumCtx };
  };
}

const PROBE_TOOL = {
  type: "function",
  function: {
    name: PROBE_TOOL_NAME,
    description: "Echo the probe nonce.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { nonce: { type: "string" } },
      required: ["nonce"],
    },
  },
} as const;

export function buildProbeRequest(model: DiscoveredLocalModel, numCtx: ExplicitNumCtx): ProbeChatRequest {
  const content = `Call ${PROBE_TOOL_NAME} with nonce ${PROBE_NONCE} and reply with JSON {"status":"${PROBE_JSON_STATUS}","nonce":"${PROBE_NONCE}"}.`;
  const messages = [{ role: "user" as const, content }];
  if (model.server === "ollama") {
    return {
      path: "/api/chat",
      body: {
        model: model.modelId,
        stream: false,
        messages,
        tools: [PROBE_TOOL],
        options: { num_ctx: assertExplicitNumCtx(numCtx) },
      },
    };
  }
  return {
    path: "/v1/chat/completions",
    body: {
      model: model.modelId,
      stream: false,
      messages,
      tools: [PROBE_TOOL],
    },
  };
}

export interface CapabilityProbeOptions {
  readonly fetchImpl?: FetchPort;
  readonly timeoutMs?: number;
  readonly vramBudgetBytes?: number;
  readonly vramUsageBytes?: number;
  readonly briefTokens?: number;
  readonly now?: () => number;
}

interface ParsedGeneration {
  readonly toolOk: boolean;
  readonly jsonOk: boolean;
  readonly completionTokens: number | null;
  readonly evalDurationNs: number | null;
  readonly definitive: boolean;
}

export function tokensPerSecond(input: {
  readonly completionTokens: number | null;
  readonly evalDurationNs: number | null;
  readonly wallClockMs: number;
}): number {
  if (
    input.completionTokens !== null &&
    input.completionTokens > 0 &&
    input.evalDurationNs !== null &&
    input.evalDurationNs > 0
  ) {
    return input.completionTokens / (input.evalDurationNs / 1_000_000_000);
  }
  const seconds = input.wallClockMs / 1000;
  if (input.completionTokens !== null && input.completionTokens > 0 && seconds > 0) {
    return input.completionTokens / seconds;
  }
  return 0;
}

/**
 * Context floor is checked from discovery metadata. The optional 1-shot tool
 * and JSON probe is cached by model digest and never runs longer than 15 seconds.
 */
export class LocalModelCapabilityProber {
  private readonly cache = new Map<string, LocalProbeResult>();

  constructor(private readonly options: CapabilityProbeOptions = {}) {}

  async probe(model: DiscoveredLocalModel): Promise<LocalProbeResult> {
    const hit = this.cache.get(model.digest);
    if (hit) return { ...hit, cached: true };
    const requested = this.requestedNumCtx(model);
    const contextTokens = effectiveContextTokens(model, requested);
    if (contextTokens < JUNIOR_CONTEXT_FLOOR) {
      const result = this.disqualified(model, contextTokens, contextTooSmallMessage(contextTokens));
      this.cache.set(model.digest, result);
      return result;
    }
    const started = this.options.now?.() ?? Date.now();
    const generation = await this.runProbe(model, requested);
    const wallClockMs = (this.options.now?.() ?? Date.now()) - started;
    const supportsTools = generation.toolOk;
    const supportsStructuredJson = generation.jsonOk;
    const role = supportsTools && supportsStructuredJson ? "coding_worker" : "chat_or_summary_only";
    const result: LocalProbeResult = {
      modelId: model.modelId,
      digest: model.digest,
      server: model.server,
      contextTokens,
      contextWarning: null,
      seniorWarning: contextTokens < SENIOR_CONTEXT_RECOMMENDED ? seniorContextWarning(contextTokens) : null,
      supportsTools,
      supportsStructuredJson,
      role,
      tokensPerSecond: tokensPerSecond({
        completionTokens: generation.completionTokens,
        evalDurationNs: generation.evalDurationNs,
        wallClockMs,
      }),
      cached: false,
      numCtxPassed: model.server === "ollama" ? requested : null,
    };
    if (generation.definitive) this.cache.set(model.digest, result);
    return result;
  }

  private requestedNumCtx(model: DiscoveredLocalModel): ExplicitNumCtx {
    const budget = this.options.vramBudgetBytes;
    if (budget === undefined) return 16_384;
    return chooseExplicitNumCtx({
      briefTokens: this.options.briefTokens ?? JUNIOR_CONTEXT_FLOOR,
      budgetBytes: budget,
      modelBytes: model.modelBytes ?? 0,
      baselineUsageBytes: this.options.vramUsageBytes ?? 0,
    });
  }

  private disqualified(model: DiscoveredLocalModel, contextTokens: number, warning: string): LocalProbeResult {
    return {
      modelId: model.modelId,
      digest: model.digest,
      server: model.server,
      contextTokens,
      contextWarning: warning,
      seniorWarning: null,
      supportsTools: false,
      supportsStructuredJson: false,
      role: "chat_or_summary_only",
      tokensPerSecond: 0,
      cached: false,
      numCtxPassed: null,
    };
  }

  private async runProbe(model: DiscoveredLocalModel, numCtx: ExplicitNumCtx): Promise<ParsedGeneration> {
    const target = assertDiscoveryUrl(model.baseUrl, false);
    const request = buildProbeRequest(model, numCtx);
    const timeoutMs = Math.min(this.options.timeoutMs ?? PROBE_TIMEOUT_MS, PROBE_TIMEOUT_MS);
    const fetchImpl = this.options.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchWithTimeout(
        fetchImpl,
        `${target.origin}${request.path}`,
        {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify(request.body),
        },
        timeoutMs,
      );
    } catch (error) {
      if (isConnectionRefused(error)) {
        throw new OpenRouterLocalError("connection-refused", "connection refused");
      }
      if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
        return { toolOk: false, jsonOk: false, completionTokens: null, evalDurationNs: null, definitive: false };
      }
      throw error;
    }
    if (response.status >= 400) {
      return { toolOk: false, jsonOk: false, completionTokens: null, evalDurationNs: null, definitive: true };
    }
    return { ...parseGeneration(await readJsonResponse(response)), definitive: true };
  }
}

export function parseGeneration(body: unknown): ParsedGeneration {
  if (!isRecord(body)) {
    return { toolOk: false, jsonOk: false, completionTokens: null, evalDurationNs: null, definitive: true };
  }
  const message = ollamaMessage(body) ?? openAiMessage(body);
  const toolOk = message !== null && toolMatches(message);
  const jsonOk = message !== null && jsonMatches(message.content);
  const evalCount = numberField(body, "eval_count");
  const usage = recordField(body, "usage");
  const completionTokens = evalCount ?? (usage ? numberField(usage, "completion_tokens") : null);
  return {
    toolOk,
    jsonOk,
    completionTokens,
    evalDurationNs: numberField(body, "eval_duration"),
    definitive: true,
  };
}

function ollamaMessage(body: Record<string, unknown>): { content: string; tools: readonly unknown[] } | null {
  const message = recordField(body, "message");
  if (message === null) return null;
  return {
    content: typeof message.content === "string" ? message.content : "",
    tools: arrayField(message, "tool_calls") ?? [],
  };
}

function openAiMessage(body: Record<string, unknown>): { content: string; tools: readonly unknown[] } | null {
  const choices = arrayField(body, "choices");
  const first = choices?.[0];
  if (!isRecord(first)) return null;
  const message = recordField(first, "message");
  if (message === null) return null;
  return {
    content: typeof message.content === "string" ? message.content : "",
    tools: arrayField(message, "tool_calls") ?? [],
  };
}

function toolMatches(message: { tools: readonly unknown[] }): boolean {
  for (const call of message.tools) {
    if (!isRecord(call)) continue;
    const fn = recordField(call, "function") ?? call;
    const name = stringField(fn, "name");
    if (name !== PROBE_TOOL_NAME) continue;
    const args = argumentRecord(fn.arguments);
    if (args !== null && args.nonce === PROBE_NONCE) return true;
  }
  return false;
}

function jsonMatches(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length === 0) return false;
  let parsed: unknown;
  try {
    parsed = parseJson(trimmed);
  } catch {
    return false;
  }
  if (!isRecord(parsed)) return false;
  return parsed.status === PROBE_JSON_STATUS && parsed.nonce === PROBE_NONCE;
}

function argumentRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = parseJson(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

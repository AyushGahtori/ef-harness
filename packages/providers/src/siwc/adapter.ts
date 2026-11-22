import { SiwcAllowanceHeaderExtractor } from "./allowance.js";
import type { SiwcAllowanceObservation } from "./allowance.js";
import { SiwcStreamCutoffGuard, type StreamCutoffOptions } from "./cutoff.js";
import { SiwcError, SiwcRouteRevokedError } from "./errors.js";
import { postJsonStream } from "./http.js";
import type { AllowancePacingFeed, SignedProviderPolicyEngine } from "./ports.js";
import type { SiwcTokenRefresher } from "./refresher.js";
import type { SqliteSiwcInstallationStore } from "./store.js";
import { buildSiwcWireBody } from "./wire.js";

export interface SiwcDirectResult {
  readonly ok: boolean;
  readonly finishReason: "completed" | "client_stream_cutoff" | "error";
  readonly text: string;
  readonly outputTokens: number;
  readonly errorCode: string | null;
  readonly allowance: SiwcAllowanceObservation;
}

export interface SiwcDirectRequestAdapterOptions {
  readonly refresher: SiwcTokenRefresher;
  readonly policy: SignedProviderPolicyEngine;
  readonly store: SqliteSiwcInstallationStore;
  readonly pacing?: AllowancePacingFeed;
  readonly now?: () => number;
}

/**
 * Every direct ChatGPT request is rebuilt here so callers cannot put forbidden fields on the wire.
 */
export class SiwcDirectRequestAdapter {
  private readonly extractor = new SiwcAllowanceHeaderExtractor();
  private readonly now: () => number;

  constructor(private readonly options: SiwcDirectRequestAdapterOptions) {
    this.now = options.now ?? Date.now;
  }

  prepareWireBody(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
    return buildSiwcWireBody(fields);
  }

  async complete(
    connectionId: string,
    fields: Readonly<Record<string, unknown>>,
    safety: StreamCutoffOptions = {},
  ): Promise<SiwcDirectResult> {
    const policy = await this.options.policy.readSiwcPolicy();
    if (policy.routeRevoked) throw new SiwcRouteRevokedError(policy.fallbackGuidance);
    const hostId = this.options.store.ensureHostId();
    const wire = buildSiwcWireBody(fields);
    const grant = await this.options.refresher.ensureFresh(connectionId);
    const controller = new AbortController();
    const guard = new SiwcStreamCutoffGuard(controller, { ...safety, now: this.now });
    const timer = setInterval(() => {
      guard.checkClock();
    }, 100);
    timer.unref();
    try {
      const response = await postJsonStream(policy.responsesEndpoint, {
        authorization: `Bearer ${grant.accessToken}`,
        "content-type": "application/json",
        ext_agent_host_id: hostId,
      }, JSON.stringify(wire), controller.signal);
      if (response.status < 200 || response.status >= 300) {
        const text = await readIncomingText(response.body);
        const failed = this.extractor.extract(response.headers, text, response.status);
        this.publish(connectionId, failed);
        return {
          ok: false,
          finishReason: "error",
          text: "",
          outputTokens: 0,
          errorCode: failed.errorCode,
          allowance: failed,
        };
      }
      const allowance = this.extractor.extract(response.headers, undefined, response.status);
      this.publish(connectionId, allowance);
      return await this.readStream(response.body, guard, allowance, () => response.destroy());
    } catch (error) {
      const cut = cutoffResult(guard);
      if (cut) return cut;
      if (error instanceof SiwcError) throw error;
      throw new SiwcError("direct_request", "The ChatGPT direct request failed.");
    } finally {
      clearInterval(timer);
    }
  }

  private async readStream(
    body: NodeJS.ReadableStream,
    guard: SiwcStreamCutoffGuard,
    allowance: SiwcAllowanceObservation,
    destroy: () => void,
  ): Promise<SiwcDirectResult> {
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let errorCode: string | null = null;
    let completed = false;
    const consume = (events: unknown[]) => {
      for (const event of events) {
        const outcome = applyEvent(guard, event);
        if (outcome.delta) text += outcome.delta;
        if (outcome.errorCode) errorCode = outcome.errorCode;
        if (outcome.completed) completed = true;
      }
    };
    try {
      for await (const chunk of body) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        buffer += decoder.decode(bytes, { stream: true });
        const parsed = drainSse(buffer);
        buffer = parsed.rest;
        consume(parsed.events);
        if (guard.didCutoff()) {
          destroy();
          return cutoffResult(guard, text) ?? errorResult(allowance);
        }
      }
      if (buffer.trim()) consume(drainSse(`${buffer}\n\n`).events);
      if (guard.didCutoff()) {
        destroy();
        return cutoffResult(guard, text) ?? errorResult(allowance);
      }
    } catch (error) {
      const cut = cutoffResult(guard, text);
      if (cut) return cut;
      throw error;
    }
    if (errorCode) {
      return { ok: false, finishReason: "error", text, outputTokens: guard.output().outputTokens, errorCode, allowance };
    }
    return {
      ok: completed,
      finishReason: completed ? "completed" : "error",
      text,
      outputTokens: guard.output().outputTokens,
      errorCode: completed ? null : "incomplete",
      allowance,
    };
  }

  private publish(connectionId: string, observation: SiwcAllowanceObservation): void {
    this.options.pacing?.ingest({ connectionId, observation });
  }
}

function cutoffResult(guard: SiwcStreamCutoffGuard, text?: string): SiwcDirectResult | null {
  const cut = guard.snapshot();
  if (!cut) return null;
  return {
    ok: false,
    finishReason: "client_stream_cutoff",
    text: text ?? cut.text,
    outputTokens: cut.outputTokens,
    errorCode: null,
    allowance: { rateLimits: {}, retryAfterSeconds: null, errorCode: null, resetAtMs: null, kind: "ok" },
  };
}

function errorResult(allowance: SiwcAllowanceObservation): SiwcDirectResult {
  return { ok: false, finishReason: "error", text: "", outputTokens: 0, errorCode: "incomplete", allowance };
}

async function readIncomingText(body: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function drainSse(buffer: string): { events: unknown[]; rest: string } {
  const events: unknown[] = [];
  let rest = buffer;
  while (true) {
    const splitAt = rest.indexOf("\n\n");
    if (splitAt < 0) break;
    const block = rest.slice(0, splitAt);
    rest = rest.slice(splitAt + 2);
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    try {
      events.push(JSON.parse(data) as unknown);
    } catch {
      continue;
    }
  }
  return { events, rest };
}

function applyEvent(guard: SiwcStreamCutoffGuard, event: unknown): { delta: string; errorCode: string | null; completed: boolean } {
  if (typeof event !== "object" || event === null) return { delta: "", errorCode: null, completed: false };
  const record = event as Record<string, unknown>;
  if (record["type"] === "response.output_text.delta" && typeof record["delta"] === "string") {
    guard.pushText(record["delta"]);
    return { delta: record["delta"], errorCode: null, completed: false };
  }
  if (record["type"] === "response.completed" || record["type"] === "response.failed" || record["type"] === "response.incomplete") {
    const response = recordObject(record["response"]);
    const usage = response ? recordObject(response["usage"]) : null;
    if (usage && typeof usage["output_tokens"] === "number") guard.noteUsage(usage["output_tokens"]);
    const error = response ? recordObject(response["error"]) : null;
    const errorCode = error && typeof error["code"] === "string" ? error["code"] : null;
    return { delta: "", errorCode, completed: record["type"] === "response.completed" && !guard.didCutoff() };
  }
  return { delta: "", errorCode: null, completed: false };
}

function recordObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

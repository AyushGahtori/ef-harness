import { describe, expect, it } from "vitest";
import {
  anthropicConsolePrefix,
  anthropicOauthPrefix,
  createFetchModelListTransport,
  geminiPrefix,
  MODEL_LIST_ENDPOINTS,
  openAiProjectPrefix,
  openAiStandardPrefix,
  openRouterPrefix,
  VALIDATION_MESSAGES,
  ZeroTokenApiKeyValidator,
  type ModelListRequest,
  type ModelListResponse,
  type ModelListTransport,
  type ValidationLogger,
} from "../../src/api-keys/index.js";

const BODY = "BODY136UNIQUEORANGE";

function key(prefix: string): string {
  return `${prefix}${BODY}9x2a`;
}

class MemoryLog implements ValidationLogger {
  readonly lines: string[] = [];
  write(line: string): void {
    this.lines.push(line);
  }
}

class RecordingTransport implements ModelListTransport {
  readonly calls: ModelListRequest[] = [];
  constructor(private readonly respond: (input: ModelListRequest) => ModelListResponse | Promise<ModelListResponse>) {}
  async request(input: ModelListRequest): Promise<ModelListResponse> {
    this.calls.push(input);
    if (input.method !== "GET") throw new Error("validation used a non-GET method");
    const pathname = new URL(input.url).pathname;
    if (!pathname.endsWith("/models")) throw new Error(`validation left the model list: ${pathname}`);
    return this.respond(input);
  }
}

function validator(transport: ModelListTransport, logger?: ValidationLogger): ZeroTokenApiKeyValidator {
  return new ZeroTokenApiKeyValidator({ transport, ...(logger ? { logger } : {}) });
}

describe("ZeroTokenApiKeyValidator", () => {
  it("calls only the read-only model list for each provider and keeps gemini keys in a header", async () => {
    const transport = new RecordingTransport((input) => {
      if (input.url.includes("generativelanguage")) {
        return { status: 200, bodyText: JSON.stringify({ models: [{ name: "models/gemini-2.5-pro" }] }) };
      }
      return { status: 200, bodyText: JSON.stringify({ data: [{ id: "gpt-5.1" }, { id: "claude-sonnet" }] }) };
    });
    const engine = validator(transport);
    const geminiKey = key(geminiPrefix);
    const gemini = await engine.validate({ apiKey: geminiKey, provider: "gemini" });
    const openai = await engine.validate({ apiKey: key(openAiStandardPrefix), provider: "openai" });
    const project = await engine.validate({ apiKey: key(openAiProjectPrefix), provider: "openai" });
    const anthropic = await engine.validate({ apiKey: key(anthropicConsolePrefix), provider: "anthropic" });
    const router = await engine.validate({ apiKey: key(openRouterPrefix), provider: "openrouter" });

    expect(gemini).toMatchObject({
      ok: true,
      completionTokensBilled: 0,
      method: "GET",
      endpoint: MODEL_LIST_ENDPOINTS.gemini,
      discoveredModels: ["models/gemini-2.5-pro"],
    });
    expect(openai).toMatchObject({ ok: true, endpoint: MODEL_LIST_ENDPOINTS.openai, completionTokensBilled: 0 });
    expect(project).toMatchObject({ ok: true, endpoint: MODEL_LIST_ENDPOINTS.openai });
    expect(anthropic).toMatchObject({ ok: true, endpoint: MODEL_LIST_ENDPOINTS.anthropic, discoveredModels: ["claude-sonnet", "gpt-5.1"] });
    expect(router).toMatchObject({ ok: true, endpoint: MODEL_LIST_ENDPOINTS.openrouter });

    const geminiCall = transport.calls[0];
    expect(geminiCall?.method).toBe("GET");
    expect(geminiCall?.url.includes("key=")).toBe(false);
    expect(geminiCall?.url.includes(geminiKey)).toBe(false);
    expect(geminiCall?.headers["x-goog-api-key"]).toBe(geminiKey);
    expect(geminiCall?.headers.Authorization).toBeUndefined();
    expect(transport.calls[1]?.headers.Authorization).toBe(`Bearer ${key(openAiStandardPrefix)}`);
    expect(transport.calls[3]?.headers["x-api-key"]).toBe(key(anthropicConsolePrefix));
    expect(transport.calls.every((call) => call.method === "GET" && !call.url.includes("?"))).toBe(true);
  });

  it("distinguishes invalid keys, billing, org restrictions, rate limits, and quota setup", async () => {
    const cases = [
      { status: 401, body: "{\"error\":{\"code\":\"invalid_api_key\"}}", failureClass: "invalid_key", message: VALIDATION_MESSAGES.invalid_key },
      { status: 402, body: "{\"error\":{\"code\":\"billing_not_active\"}}", failureClass: "billing_not_active", message: VALIDATION_MESSAGES.billing_not_active },
      { status: 403, body: "{\"error\":{\"message\":\"org restriction\"}}", failureClass: "org_restriction", message: VALIDATION_MESSAGES.org_restriction },
      { status: 429, body: "{\"error\":{\"code\":\"rate_limit_exceeded\"}}", failureClass: "rate_limited", message: VALIDATION_MESSAGES.rate_limited },
      { status: 429, body: "{\"error\":{\"code\":\"insufficient_quota\"}}", failureClass: "insufficient_quota", message: VALIDATION_MESSAGES.insufficient_quota },
    ] as const;
    for (const item of cases) {
      const transport = new RecordingTransport(() => ({ status: item.status, bodyText: item.body }));
      const result = await validator(transport).validate({ apiKey: key(openAiProjectPrefix), provider: "openai" });
      expect(result).toMatchObject({
        ok: false,
        failureClass: item.failureClass,
        message: item.message,
        completionTokensBilled: 0,
        httpStatus: item.status,
      });
      expect(transport.calls).toHaveLength(1);
    }
  });

  it("classifies transport failures as network or proxy blocked and strips secrets from the log", async () => {
    const secret = key(geminiPrefix);
    const logger = new MemoryLog();
    const transport = new RecordingTransport(() => {
      throw new Error(
        `proxy blocked Authorization: Bearer ${secret} x-api-key: ${secret} x-goog-api-key: ${secret} https://generativelanguage.googleapis.com/v1beta/models?key=${secret}`,
      );
    });
    const result = await validator(transport, logger).validate({ apiKey: secret, provider: "gemini" });
    expect(result).toMatchObject({
      ok: false,
      failureClass: "network_or_proxy_blocked",
      message: VALIDATION_MESSAGES.network_or_proxy_blocked,
      completionTokensBilled: 0,
    });
    const logged = logger.lines.join("\n");
    expect(logged.includes(secret)).toBe(false);
    expect(logged.includes(`key=${secret}`)).toBe(false);
    expect(logged.includes("Bearer ")).toBe(false);
    expect(result.ok || !result.message.includes(secret)).toBe(true);
  });

  it("does not transmit a subscription oauth token", async () => {
    const transport = new RecordingTransport(() => {
      throw new Error("network should not be called");
    });
    const result = await validator(transport).validate({
      apiKey: `  "${key(anthropicOauthPrefix)}"\n`,
      provider: "anthropic",
    });
    expect(result).toMatchObject({ ok: false, failureClass: "subscription_oauth_rejected", completionTokensBilled: 0 });
    expect(transport.calls).toHaveLength(0);
  });

  it("validates a custom base with GET /models and rejects non-loopback HTTP before fetch", async () => {
    const transport = new RecordingTransport((input) => ({
      status: 200,
      bodyText: JSON.stringify({ data: [{ id: input.url }] }),
    }));
    const engine = validator(transport);
    const customKey = `custom-${BODY}-9x2a`;
    const ok = await engine.validate({
      apiKey: customKey,
      provider: "custom",
      customBaseUrl: "https://proxy.example/v1",
    });
    expect(ok).toMatchObject({ ok: true, endpoint: "https://proxy.example/v1/models" });
    const loopback = await engine.validate({
      apiKey: customKey,
      provider: "custom",
      customBaseUrl: "http://127.0.0.1:8000/v1/",
    });
    expect(loopback).toMatchObject({ ok: true, endpoint: "http://127.0.0.1:8000/v1/models" });
    const ipv6 = await engine.validate({
      apiKey: customKey,
      provider: "custom",
      customBaseUrl: "http://[::1]:8000/v1",
    });
    expect(ipv6).toMatchObject({ ok: true, endpoint: "http://[::1]:8000/v1/models" });
    const blocked = await engine.validate({
      apiKey: customKey,
      provider: "custom",
      customBaseUrl: "http://localhost:8000/v1",
    });
    expect(blocked).toMatchObject({ ok: false, failureClass: "insecure_base_url" });
    expect(transport.calls).toHaveLength(3);
    expect(transport.calls.every((call) => !call.url.includes(customKey) && !call.url.includes("key="))).toBe(true);
  });

  it("refuses a non-GET completion call before fetch", async () => {
    let called = false;
    const transport = createFetchModelListTransport(async () => {
      called = true;
      return new Response(JSON.stringify({ data: [{ id: "gpt-5.1" }] }), { status: 200 });
    });
    await expect(
      transport.request({
        method: "POST" as "GET",
        url: "https://api.openai.com/v1/chat/completions",
        headers: {},
      }),
    ).rejects.toThrow(/GET/);
    expect(called).toBe(false);
  });
});

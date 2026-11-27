import { describe, expect, it } from "vitest";
import {
  CurrencyParseError,
  SiwcConstraintError,
  assertSiwcCompliantBody,
  classifyProviderFailure,
  createDefaultModelProfileRegistry,
  parseDelayMs,
  parseRateLimitHeaders,
  usdToMicroUnits,
} from "../../src/protocols/index.js";

describe("integer currency port", () => {
  it("adds tenths of a dollar in micro-USD without binary float error", () => {
    expect(usdToMicroUnits("0.10") + usdToMicroUnits("0.10") + usdToMicroUnits("0.10")).toBe(
      300_000,
    );
    expect(usdToMicroUnits("$10.00")).toBe(10_000_000);
    expect(usdToMicroUnits("0.000120")).toBe(120);
  });

  it("rejects negative, scientific, and sub-micro amounts", () => {
    expect(() => usdToMicroUnits("-5")).toThrow(CurrencyParseError);
    expect(() => usdToMicroUnits("1e-7")).toThrow(CurrencyParseError);
    expect(() => usdToMicroUnits("0.0000009")).toThrow(CurrencyParseError);
  });
});

describe("provider error classifier", () => {
  const ids = { clientRequestId: "client-req-9", idempotencyKey: "idem-9" };
  const now = Date.parse("2026-01-01T00:00:00.000Z");

  it("distinguishes auth, rate limit, usage limit, billing, overload, and context overflow", () => {
    const auth = classifyProviderFailure({
      status: 401,
      headers: new Headers(),
      bodyText: JSON.stringify({ error: { message: "rejected", code: "invalid_api_key" } }),
      ...ids,
    });
    expect(auth.kind).toBe("auth");
    expect(auth.isProviderSchedulingError).toBe(false);

    const rateHeaders = new Headers({
      "retry-after": "2",
      "x-ratelimit-reset-requests": "6m0s",
      "x-ratelimit-reset-tokens": "1500ms",
    });
    const rate = classifyProviderFailure({
      status: 429,
      headers: rateHeaders,
      bodyText: JSON.stringify({ error: { message: "slow down", type: "tokens" } }),
      ...ids,
      nowMs: now,
    });
    expect(rate.kind).toBe("rate_limit");
    expect(rate.retryAfterMs).toBe(2_000);
    expect(rate.rateLimitResetMs).toBe(360_000);
    expect(rate.isProviderSchedulingError).toBe(true);

    const usage = classifyProviderFailure({
      status: 429,
      headers: new Headers({ "retry-after": "30" }),
      bodyText: JSON.stringify({
        error: { code: "subscription_sharing_usage_limit_exceeded", message: "weekly cap" },
      }),
      ...ids,
    });
    expect(usage.kind).toBe("usage_limit");
    expect(usage.providerCode).toBe("subscription_sharing_usage_limit_exceeded");
    expect(usage.isProviderSchedulingError).toBe(true);
    expect(usage.kind).not.toBe("rate_limit");

    expect(
      classifyProviderFailure({
        status: 402,
        headers: new Headers(),
        bodyText: JSON.stringify({ error: { code: "insufficient_quota", message: "billing" } }),
        ...ids,
      }).kind,
    ).toBe("billing");
    const quota429 = classifyProviderFailure({
      status: 429,
      headers: new Headers(),
      bodyText: JSON.stringify({ error: { code: "insufficient_quota", message: "billing" } }),
      ...ids,
    });
    expect(quota429.kind).toBe("billing");
    expect(quota429.isProviderSchedulingError).toBe(false);
    expect(
      classifyProviderFailure({
        status: 529,
        headers: new Headers(),
        bodyText: JSON.stringify({ error: { type: "overloaded_error", message: "busy" } }),
        ...ids,
      }).kind,
    ).toBe("overloaded");
    expect(
      classifyProviderFailure({
        status: 400,
        headers: new Headers(),
        bodyText: JSON.stringify({
          error: { code: "context_length_exceeded", message: "too long" },
        }),
        ...ids,
      }).kind,
    ).toBe("context_overflow");
  });

  it("rejects a SIWC body that still carries a forbidden sampling field", () => {
    expect(() =>
      assertSiwcCompliantBody({
        store: true,
        stream: true,
        temperature: 0,
        tools: [{ type: "file_search" }],
      }),
    ).toThrow(SiwcConstraintError);
    expect(() =>
      assertSiwcCompliantBody({ store: false, stream: true, tools: [{ type: "function" }] }),
    ).not.toThrow();
  });

  it("parses retry delays as integer milliseconds", () => {
    expect(parseDelayMs("1.5s", now)).toBe(1_500);
    expect(parseDelayMs("200ms", now)).toBe(200);
    expect(parseDelayMs(String(Math.floor(now / 1000) + 5), now)).toBe(5_000);
    const headers = new Headers({
      "anthropic-ratelimit-requests-reset": "Thu, 01 Jan 2026 00:00:04 GMT",
    });
    expect(parseRateLimitHeaders(headers, now).rateLimitResetMs).toBe(4_000);
  });
});

describe("ModelProfileRegistry", () => {
  it("declares the roster fields and refuses coding tasks for an 8k local model", () => {
    const registry = createDefaultModelProfileRegistry();
    const ollama = registry.get("ollama-local-8k");
    expect(ollama.family).toBe("ollama");
    expect(ollama.contextWindow).toBe(8_192);
    expect(ollama.maxOutputTokens).toBe(2_048);
    expect(ollama.editFormat).toBe("search_replace");
    expect(ollama.supportsParallelToolCalls).toBe(false);
    expect(ollama.supportsReasoningReplay).toBe(false);
    expect(ollama.supportsStreamingToolArgs).toBe(false);
    expect(ollama.toolCallReliabilityTier).toBe("low");
    expect(ollama.supportsPromptCaching).toBe(false);
    expect(ollama.supportsToolCalling).toBe(false);
    expect(ollama.smallContext).toBe(true);
    expect(ollama.routeConstraints.protocol).toBe("openai_compatible_chat");
    expect(registry.canAssignCodingTask("ollama-local-8k")).toBe(false);

    const lmStudio = registry.get("lm-studio-local");
    expect(lmStudio.smallContext).toBe(true);
    expect(registry.canAssignCodingTask("lm-studio-local")).toBe(true);

    registry.register({
      ...lmStudio,
      id: "small-8k-tool-model",
      contextWindow: 8_192,
      supportsToolCalling: true,
    });
    expect(registry.canAssignCodingTask("small-8k-tool-model")).toBe(false);

    const siwc = registry.get("gpt-5-siwc");
    expect(siwc.editFormat).toBe("apply_patch");
    expect(siwc.routeConstraints.omitMaxOutputTokens).toBe(true);
    expect(siwc.routeConstraints.omitTemperature).toBe(true);
    expect(siwc.routeConstraints.omitPreviousResponseId).toBe(true);
    expect(siwc.routeConstraints.hostedToolsForbidden).toBe(true);
    expect(registry.get("claude-sonnet").editFormat).toBe("str_replace");
    expect(registry.canAssignCodingTask("gpt-5")).toBe(true);
  });
});

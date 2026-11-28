import { describe, expect, it } from "vitest";
import {
  DEGENERATE_RUN_CHARS,
  OUTPUT_TOKEN_CEILING,
  SIWC_FORBIDDEN_WIRE_FIELDS,
  SIWC_PREVIEW_LABEL,
  SIWC_REQUESTED_SCOPES,
  SIWC_ROUTE_REVOKED_GUIDANCE,
  SiwcAllowanceHeaderExtractor,
  SiwcDirectRequestAdapter,
  SiwcRouteRevokedError,
  SiwcStreamCutoffGuard,
  SiwcTokenRefresher,
  buildSiwcWireBody,
  siwcTokenSecretName,
  trailingRepeatLength,
} from "../../src/siwc/index.js";
import { openHarness, waitFor } from "./support.js";

describe("Siwc direct wire, cutoff, and allowance headers", () => {
  it("strips forbidden fields and forces store false plus stream true", () => {
    const fields: Record<string, unknown> = {
      model: "gpt-test",
      input: [
        { role: "system", content: "stay brief" },
        { role: "user", content: "hi" },
      ],
      temperature: 0.2,
      max_output_tokens: 4096,
      previous_response_id: "resp_1",
      store: true,
      stream: false,
      tools: [{ type: "function", name: "echo" }, { type: "file_search" }, { type: "code_interpreter" }],
    };
    for (const field of SIWC_FORBIDDEN_WIRE_FIELDS) fields[field] = "omit-me";
    const wire = buildSiwcWireBody(fields);
    expect(wire["store"]).toBe(false);
    expect(wire["stream"]).toBe(true);
    expect(wire).not.toHaveProperty("temperature");
    expect(wire).not.toHaveProperty("max_output_tokens");
    expect(wire).not.toHaveProperty("previous_response_id");
    for (const field of SIWC_FORBIDDEN_WIRE_FIELDS) expect(wire).not.toHaveProperty(field);
    expect(wire["instructions"]).toBe("stay brief");
    expect(wire["input"]).toEqual([{ role: "user", content: "hi" }]);
    expect(wire["tools"]).toEqual([{ type: "function", name: "echo" }]);
    expect(wire["model"]).toBe("gpt-test");
  });

  it("aborts a repeating stream and a token overrun with client_stream_cutoff", () => {
    expect(OUTPUT_TOKEN_CEILING).toBe(16_384);
    expect(DEGENERATE_RUN_CHARS).toBe(512);
    expect(trailingRepeatLength("}\n".repeat(256))).toBe(512);
    expect(trailingRepeatLength("}\n".repeat(257))).toBe(514);
    const loopController = new AbortController();
    const loop = new SiwcStreamCutoffGuard(loopController, { outputTokenCeiling: 100_000 });
    expect(loop.pushText("}\n".repeat(256))).toBeNull();
    expect(loop.pushText("}\n")).toMatchObject({ finishReason: "client_stream_cutoff" });
    expect(loopController.signal.aborted).toBe(true);
    const tokenController = new AbortController();
    const tokens = new SiwcStreamCutoffGuard(tokenController);
    expect(tokens.noteUsage(OUTPUT_TOKEN_CEILING)).toBeNull();
    expect(tokens.noteUsage(OUTPUT_TOKEN_CEILING + 1)).toMatchObject({ finishReason: "client_stream_cutoff" });
    expect(tokenController.signal.aborted).toBe(true);
    const clockController = new AbortController();
    let now = 1_000;
    const clock = new SiwcStreamCutoffGuard(clockController, { now: () => now, wallClockMs: 1_000, outputTokenCeiling: 100 });
    expect(clock.checkClock()).toBeNull();
    now = 2_001;
    expect(clock.checkClock()).toMatchObject({ finishReason: "client_stream_cutoff" });
  });

  it("posts a stripped body with the host id and bearer token", async () => {
    const harness = await openHarness();
    try {
      const hostId = await seedFresh(harness);
      const ingested: Array<{ connectionId: string; remaining: string | undefined; retry: number | null }> = [];
      const adapter = new SiwcDirectRequestAdapter({
        refresher: refresher(harness),
        policy: harness.policy,
        store: harness.store,
        pacing: {
          ingest(event) {
            ingested.push({
              connectionId: event.connectionId,
              remaining: event.observation.rateLimits["x-ratelimit-remaining-requests"],
              retry: event.observation.retryAfterSeconds,
            });
          },
        },
      });
      const prepared = adapter.prepareWireBody({
        model: "gpt-test",
        input: "hello",
        temperature: 0.2,
        max_output_tokens: 4096,
        previous_response_id: "resp_1",
        store: true,
        stream: false,
      });
      expect(prepared["store"]).toBe(false);
      expect(prepared["stream"]).toBe(true);
      const result = await adapter.complete("chatgpt-personal", {
        model: "gpt-test",
        input: "hello",
        temperature: 0.2,
        max_output_tokens: 4096,
        previous_response_id: "resp_1",
      });
      expect(result.finishReason).toBe("completed");
      expect(result.text).toBe("Hello");
      expect(result.outputTokens).toBe(1);
      const body = harness.server.responseBodies[0] as Record<string, unknown>;
      expect(body["store"]).toBe(false);
      expect(body["stream"]).toBe(true);
      expect(body).not.toHaveProperty("temperature");
      expect(body).not.toHaveProperty("max_output_tokens");
      expect(body).not.toHaveProperty("previous_response_id");
      const headers = harness.server.seenRequestHeaders[0] ?? {};
      expect(headers["authorization"]).toBe("Bearer efh.access.wire");
      expect(headers["ext_agent_host_id"]).toBe(hostId);
      expect(ingested[0]).toEqual({ connectionId: "chatgpt-personal", remaining: "3", retry: null });
      expect(SIWC_PREVIEW_LABEL).toContain("5h/weekly allowance");
    } finally {
      await harness.close();
    }
  });

  it("aborts a degenerate SSE loop through the adapter", async () => {
    const harness = await openHarness();
    try {
      await seedFresh(harness);
      harness.server.sseMode = "loop";
      const adapter = new SiwcDirectRequestAdapter({
        refresher: refresher(harness),
        policy: harness.policy,
        store: harness.store,
      });
      const result = await adapter.complete("chatgpt-personal", { model: "gpt-test", input: "loop" });
      expect(result.finishReason).toBe("client_stream_cutoff");
      await waitFor(() => harness.server.aborted, "sse abort");
    } finally {
      await harness.close();
    }
  });

  it("aborts a bounded turn that passes the output ceiling", async () => {
    const harness = await openHarness();
    try {
      await seedFresh(harness);
      harness.server.sseMode = "token_ceiling";
      const adapter = new SiwcDirectRequestAdapter({
        refresher: refresher(harness),
        policy: harness.policy,
        store: harness.store,
      });
      const result = await adapter.complete(
        "chatgpt-personal",
        { model: "gpt-test", input: "count" },
        { outputTokenCeiling: 2 },
      );
      expect(result.finishReason).toBe("client_stream_cutoff");
    } finally {
      await harness.close();
    }
  });

  it("feeds usage-limit and rate-limit errors to pacing", async () => {
    const extractor = new SiwcAllowanceHeaderExtractor();
    const usage = extractor.extract(
      { "x-ratelimit-remaining-requests": "0", "retry-after": "8" },
      JSON.stringify({ error: { code: "usage_limit_reached", reset_at: 1_700_000_000 } }),
      429,
    );
    expect(usage.kind).toBe("usage_limit");
    expect(usage.errorCode).toBe("usage_limit_reached");
    expect(usage.resetAtMs).toBe(1_700_000_000_000);
    expect(usage.retryAfterSeconds).toBe(8);
    const rate = extractor.extract({}, JSON.stringify({ error: { code: "rate_limit_exceeded", reset_at: 1_700_000_100 } }), 429);
    expect(rate.kind).toBe("rate_limit");
    expect(rate.resetAtMs).toBe(1_700_000_100_000);

    const harness = await openHarness();
    try {
      await seedFresh(harness);
      const seen: string[] = [];
      const adapter = new SiwcDirectRequestAdapter({
        refresher: refresher(harness),
        policy: harness.policy,
        store: harness.store,
        pacing: {
          ingest(event) {
            seen.push(event.observation.errorCode ?? "");
          },
        },
      });
      harness.server.sseMode = "usage_limit";
      const limited = await adapter.complete("chatgpt-personal", { model: "gpt-test", input: "go" });
      expect(limited.finishReason).toBe("error");
      expect(limited.errorCode).toBe("usage_limit_reached");
      harness.server.sseMode = "rate_limit";
      const throttled = await adapter.complete("chatgpt-personal", { model: "gpt-test", input: "go" });
      expect(throttled.errorCode).toBe("rate_limit_exceeded");
      expect(seen).toEqual(["usage_limit_reached", "rate_limit_exceeded"]);
    } finally {
      await harness.close();
    }
  });

  it("refuses a direct request when the preview route is revoked", async () => {
    const harness = await openHarness({ routeRevoked: true });
    try {
      harness.store.ensureHostId();
      const adapter = new SiwcDirectRequestAdapter({
        refresher: refresher(harness),
        policy: harness.policy,
        store: harness.store,
      });
      await expect(adapter.complete("chatgpt-personal", { model: "gpt-test", input: "go" }))
        .rejects.toBeInstanceOf(SiwcRouteRevokedError);
      await expect(adapter.complete("chatgpt-personal", { model: "gpt-test", input: "go" }))
        .rejects.toThrow(SIWC_ROUTE_REVOKED_GUIDANCE);
      expect(harness.server.responseBodies).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });
});

async function seedFresh(harness: Awaited<ReturnType<typeof openHarness>>): Promise<string> {
  const hostId = harness.store.ensureHostId();
  const now = Date.now();
  harness.store.saveConnected({
    id: "chatgpt-personal",
    label: "ChatGPT (personal)",
    plan: "plus",
    clientId: "oaiapp_efh_wire",
    subject: "acct-wire",
    email: "wire@example.test",
    scopes: SIWC_REQUESTED_SCOPES,
    expiresAtMs: now + 3_600_000,
    earliestRefreshAtMs: null,
  }, now);
  await harness.vault.put(siwcTokenSecretName("chatgpt-personal"), JSON.stringify({
    access_token: "efh.access.wire",
    refresh_token: "efh.refresh.wire",
    id_token: "efh.id.wire",
  }));
  return hostId;
}

function refresher(harness: Awaited<ReturnType<typeof openHarness>>): SiwcTokenRefresher {
  return new SiwcTokenRefresher({
    store: harness.store,
    vault: harness.vault,
    policy: harness.policy,
    parker: { park() { return undefined; } },
    cards: { emit() { return undefined; } },
  });
}

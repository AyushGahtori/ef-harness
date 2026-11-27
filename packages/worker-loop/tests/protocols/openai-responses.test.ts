import { describe, expect, it } from "vitest";
import {
  OpenAIResponsesAdapter,
  SiwcHostedToolError,
  StreamStallError,
  UnknownOutcomeTimeoutError,
  createFakeScheduler,
  createInMemoryTracer,
  createLocalSecretRedactor,
  opaqueReplayItem,
} from "../../src/protocols/index.js";
import {
  callOptions,
  collect,
  fragmentingFetch,
  profiles,
  request,
  sse,
  withMock,
  writeSse,
} from "./support.js";

const roster = profiles();
const adapter = new OpenAIResponsesAdapter();

describe("OpenAIResponsesAdapter", () => {
  it("strips forbidden SIWC fields and keeps function plus custom tools", async () => {
    await withMock(
      (res, captured) => {
        const body = JSON.parse(captured.body) as { input: unknown[] };
        expect(JSON.stringify(body)).not.toContain("max_output_tokens");
        expect(JSON.stringify(body)).not.toContain("previous_response_id");
        expect(JSON.stringify(body)).not.toContain('"temperature"');
        expect(JSON.stringify(body)).not.toContain('"store":true');
        expect(JSON.stringify(body)).toContain('"store":false');
        expect(JSON.stringify(body)).toContain('"stream":true');
        expect(JSON.stringify(body)).toContain('"reasoning.encrypted_content"');
        expect(JSON.stringify(body)).toContain('"type":"function"');
        expect(JSON.stringify(body)).toContain('"type":"custom"');
        writeSse(
          res,
          sse("response.output_text.delta", { type: "response.output_text.delta", delta: "pong" }) +
            sse("response.completed", {
              type: "response.completed",
              response: { usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5 } },
            }),
        );
      },
      async (origin) => {
        const events = await collect(
          adapter.stream(
            request({
              model: "gpt-5",
              profile: roster["gpt-5-siwc"]!,
              route: "siwc",
              maxOutputTokens: 50,
              temperature: 0.2,
              previousResponseId: "resp_old",
              store: true,
              tools: [
                {
                  name: "read_file",
                  description: "Read a file",
                  parameters: { type: "object", properties: {} },
                  kind: "function",
                },
                {
                  name: "apply_patch",
                  description: "Apply a patch",
                  parameters: {},
                  kind: "custom",
                },
              ],
            }),
            callOptions(origin),
          ),
        );
        expect(events.some((event) => event.type === "text_delta" && event.text === "pong")).toBe(
          true,
        );
      },
    );
  });

  it("rejects hosted tools before any HTTP request on the SIWC route", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("hosted tool request was sent");
    };
    expect(() =>
      adapter.stream(
        request({
          model: "gpt-5",
          profile: roster["gpt-5-siwc"]!,
          route: "siwc",
          tools: [
            {
              name: "file_search",
              description: "hosted",
              parameters: {},
              kind: "hosted",
              hostedType: "file_search",
            },
          ],
        }),
        callOptions("http://127.0.0.1:9", { fetchImpl }),
      ),
    ).toThrow(SiwcHostedToolError);
  });

  it("replays opaque reasoning items verbatim and in order", async () => {
    const first = opaqueReplayItem({
      type: "reasoning",
      id: "rs_a",
      encrypted_content: "enc-blob-A",
      summary: [],
    });
    const second = opaqueReplayItem({
      type: "reasoning",
      id: "rs_b",
      encrypted_content: "enc-blob-B",
      summary: [{ type: "summary_text", text: "kept" }],
    });
    await withMock(
      (res, captured) => {
        const body = captured.body;
        const atA = body.indexOf(first.canonicalJson);
        const atB = body.indexOf(second.canonicalJson);
        expect(atA).toBeGreaterThan(-1);
        expect(atB).toBeGreaterThan(atA);
        expect(body).toContain("enc-blob-A");
        expect(body).toContain("enc-blob-B");
        writeSse(
          res,
          sse("response.output_item.done", {
            type: "response.output_item.done",
            item: { type: "reasoning", id: "rs_c", encrypted_content: "enc-blob-C", summary: [] },
          }) +
            sse("response.completed", {
              type: "response.completed",
              response: {
                usage: {
                  input_tokens: 8,
                  output_tokens: 2,
                  total_tokens: 11,
                  output_tokens_details: { reasoning_tokens: 2 },
                  input_tokens_details: { cached_tokens: 1 },
                },
              },
            }),
        );
      },
      async (origin) => {
        const events = await collect(
          adapter.stream(
            request({
              model: "gpt-5",
              profile: roster["gpt-5"]!,
              route: "api_key",
              replayItems: [first, second],
              maxOutputTokens: 32,
            }),
            callOptions(origin),
          ),
        );
        const reasoning = events.find((event) => event.type === "reasoning_item");
        expect(reasoning).toMatchObject({
          type: "reasoning_item",
          item: {
            canonicalJson: JSON.stringify({
              type: "reasoning",
              id: "rs_c",
              encrypted_content: "enc-blob-C",
              summary: [],
            }),
          },
        });
        const usage = events.find((event) => event.type === "usage");
        expect(usage).toMatchObject({
          type: "usage",
          usage: { inputTokens: 8, outputTokens: 2, reasoningTokens: 2, cacheReadInputTokens: 1 },
        });
      },
    );
  });

  it("reports encrypted reasoning when a one-turn probe receives it", async () => {
    await withMock(
      (res) => {
        writeSse(
          res,
          sse("response.output_item.done", {
            type: "response.output_item.done",
            item: { type: "reasoning", id: "rs_probe", encrypted_content: "enc-probe" },
          }) +
            sse("response.completed", {
              type: "response.completed",
              response: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
            }),
        );
      },
      async (origin) => {
        const probed = await adapter.probeEncryptedReasoning(
          request({ model: "gpt-5", profile: roster["gpt-5-siwc"]!, route: "siwc" }),
          callOptions(origin),
        );
        expect(probed.supported).toBe(true);
        expect(probed.items[0]?.canonicalJson).toContain("enc-probe");
      },
    );
  });

  it("falls back when a one-turn probe does not return encrypted reasoning", async () => {
    await withMock(
      (res) => {
        writeSse(
          res,
          sse("response.output_text.delta", { type: "response.output_text.delta", delta: "pong" }) +
            sse("response.completed", {
              type: "response.completed",
              response: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
            }),
        );
      },
      async (origin) => {
        const probed = await adapter.probeEncryptedReasoning(
          request({ model: "gpt-5", profile: roster["gpt-5-siwc"]!, route: "siwc" }),
          callOptions(origin),
        );
        expect(probed.supported).toBe(false);
        expect(probed.items).toEqual([]);
      },
    );
    await withMock(
      (res, captured) => {
        expect(captured.body).not.toContain("reasoning.encrypted_content");
        writeSse(
          res,
          sse("response.output_text.delta", { type: "response.output_text.delta", delta: "ok" }) +
            sse("response.completed", {
              type: "response.completed",
              response: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
            }),
        );
      },
      async (origin) => {
        const events = await collect(
          adapter.stream(
            request({
              model: "gpt-5",
              profile: roster["gpt-5-siwc"]!,
              route: "siwc",
              includeEncryptedReasoning: false,
            }),
            callOptions(origin),
          ),
        );
        expect(events.some((event) => event.type === "text_delta")).toBe(true);
      },
    );
  });

  it("cuts the stream after the SSE frame that crosses the reserved output budget", async () => {
    await withMock(
      (res) => {
        writeSse(
          res,
          sse("response.output_text.delta", { type: "response.output_text.delta", delta: "1234" }) +
            sse("response.output_text.delta", { type: "response.output_text.delta", delta: "56" }) +
            sse("response.output_text.delta", {
              type: "response.output_text.delta",
              delta: "POISON",
            }),
        );
      },
      async (origin) => {
        const events = await collect(
          adapter.stream(
            request({
              model: "gpt-5",
              profile: roster["gpt-5-siwc"]!,
              route: "siwc",
              reservedOutputTokens: 5,
            }),
            callOptions(origin, { countOutputTokens: (text) => text.length }),
          ),
        );
        const text = events
          .filter((event) => event.type === "text_delta")
          .map((event) => (event.type === "text_delta" ? event.text : ""))
          .join("");
        expect(text).toBe("123456");
        expect(text).not.toContain("POISON");
        expect(events.at(-1)).toMatchObject({ type: "stop", stopReason: "output_budget_cutoff" });
        const usage = events.find((event) => event.type === "usage");
        expect(usage).toMatchObject({ type: "usage", usage: { outputTokens: 6 } });
      },
    );
  });

  it("returns malformed tool arguments instead of throwing", async () => {
    await withMock(
      (res) => {
        writeSse(
          res,
          sse("response.function_call_arguments.delta", {
            type: "response.function_call_arguments.delta",
            item_id: "call_1",
            delta: '{"path":',
          }) +
            sse("response.output_item.done", {
              type: "response.output_item.done",
              item: {
                type: "function_call",
                call_id: "call_1",
                name: "read_file",
                arguments: '{"path":',
              },
            }) +
            sse("response.completed", {
              type: "response.completed",
              response: { usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 } },
            }),
        );
      },
      async (origin) => {
        const events = await collect(
          adapter.stream(
            request({ model: "gpt-5", profile: roster["gpt-5"]!, route: "api_key" }),
            callOptions(origin),
          ),
        );
        expect(events).toContainEqual({
          type: "malformed_tool_args",
          item: {
            type: "malformed_tool_args",
            callId: "call_1",
            name: "read_file",
            rawArguments: '{"path":',
            parseError: expect.any(String) as string,
          },
        });
      },
    );
  });

  it("decodes a stream delivered one byte at a time", async () => {
    await withMock(
      (res) => {
        writeSse(
          res,
          sse("response.output_text.delta", {
            type: "response.output_text.delta",
            delta: "café 👍",
          }) +
            sse("response.completed", {
              type: "response.completed",
              response: { usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } },
            }),
        );
      },
      async (origin) => {
        const events = await collect(
          adapter.stream(
            request({ model: "gpt-5", profile: roster["gpt-5"]!, route: "api_key" }),
            callOptions(origin, { fetchImpl: fragmentingFetch(1) }),
          ),
        );
        expect(events.find((event) => event.type === "text_delta")).toMatchObject({
          text: "café 👍",
        });
      },
    );
  });

  it("redacts prompt secrets, leaves auth headers, and preserves encrypted blobs", async () => {
    const apiKey = ["local", "-test", "-key", "-0123456789"].join("");
    const live = ["sk", "_live_", "abcd1234"].join("");
    const redactor = createLocalSecretRedactor();
    const tracer = createInMemoryTracer();
    redactor.registerVaultSecret(apiKey, "API_KEY");
    const replay = opaqueReplayItem({
      type: "reasoning",
      id: "rs_secret",
      encrypted_content: apiKey,
    });
    await withMock(
      (res, captured) => {
        expect(captured.headers.authorization).toBe(`Bearer ${apiKey}`);
        expect(captured.body).not.toContain(live);
        expect(captured.body).toContain("[REDACTED:OPENAI_LIVE]");
        expect(captured.body).toContain(`[REDACTED:API_KEY]`);
        expect(captured.body).toContain(replay.canonicalJson);
        writeSse(
          res,
          sse("response.completed", {
            type: "response.completed",
            response: { usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 } },
          }),
        );
      },
      async (origin) => {
        await collect(
          adapter.stream(
            request({
              model: "gpt-5",
              profile: roster["gpt-5"]!,
              route: "api_key",
              messages: [{ role: "user", text: `token is ${apiKey} and ${live}` }],
              replayItems: [replay],
            }),
            callOptions(origin, { apiKey, redactor, tracer }),
          ),
        );
        const span = tracer.spans().find((item) => item.name === "model.call");
        expect(span?.status).toBe("ok");
        expect(JSON.stringify(span?.attributes)).not.toContain(apiKey);
      },
    );
  });

  it("classifies 401, ordinary 429, and subscription usage limits from the wire", async () => {
    await withMock(
      (res) => {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "rejected", code: "invalid_api_key" } }));
      },
      async (origin) => {
        await expect(
          collect(
            adapter.stream(
              request({ model: "gpt-5", profile: roster["gpt-5"]!, route: "api_key" }),
              callOptions(origin),
            ),
          ),
        ).rejects.toMatchObject({ kind: "auth", isProviderSchedulingError: false });
      },
    );
    await withMock(
      (res) => {
        res.writeHead(429, { "retry-after": "2", "x-ratelimit-reset-requests": "6m0s" });
        res.end(JSON.stringify({ error: { message: "slow down", type: "requests" } }));
      },
      async (origin) => {
        await expect(
          collect(
            adapter.stream(
              request({ model: "gpt-5", profile: roster["gpt-5"]!, route: "api_key" }),
              callOptions(origin),
            ),
          ),
        ).rejects.toMatchObject({
          kind: "rate_limit",
          retryAfterMs: 2_000,
          rateLimitResetMs: 360_000,
          isProviderSchedulingError: true,
        });
      },
    );
    await withMock(
      (res) => {
        res.writeHead(429, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: { code: "subscription_sharing_usage_limit_exceeded", message: "weekly cap" },
          }),
        );
      },
      async (origin) => {
        await expect(
          collect(
            adapter.stream(
              request({ model: "gpt-5", profile: roster["gpt-5-siwc"]!, route: "siwc" }),
              callOptions(origin),
            ),
          ),
        ).rejects.toMatchObject({ kind: "usage_limit", isProviderSchedulingError: true });
      },
    );
  });

  it("fires the 60s idle watchdog after three tokens and preserves partial usage", async () => {
    const scheduler = createFakeScheduler();
    await withMock(
      (res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(
          sse("response.output_text.delta", { type: "response.output_text.delta", delta: "a" }) +
            sse("response.output_text.delta", { type: "response.output_text.delta", delta: "b" }) +
            sse("response.output_text.delta", { type: "response.output_text.delta", delta: "c" }),
        );
      },
      async (origin) => {
        const iter = adapter
          .stream(
            request({ model: "gpt-5", profile: roster["gpt-5"]!, route: "api_key" }),
            callOptions(origin, {
              scheduleTimeout: (callback, ms) => scheduler.schedule(callback, ms),
              clearScheduledTimeout: (handle) => scheduler.clear(handle),
            }),
          )
          [Symbol.asyncIterator]();
        expect((await iter.next()).value).toMatchObject({ type: "text_delta", text: "a" });
        expect((await iter.next()).value).toMatchObject({ type: "text_delta", text: "b" });
        expect((await iter.next()).value).toMatchObject({ type: "text_delta", text: "c" });
        const pending = iter.next();
        await new Promise((resolve) => setImmediate(resolve));
        scheduler.advance(59_999);
        const raced = await Promise.race([
          pending.then(
            () => "settled",
            () => "rejected",
          ),
          Promise.resolve("pending"),
        ]);
        expect(raced).toBe("pending");
        scheduler.advance(1);
        await expect(pending).rejects.toBeInstanceOf(StreamStallError);
        await expect(pending).rejects.toMatchObject({
          kind: "stream_stall",
          isProviderSchedulingError: false,
          partialUsage: { outputTokens: 3 },
        });
      },
    );
  });

  it("reports an unknown outcome when the caller aborts after the body is transmitted", async () => {
    let markReceived: (body: string) => void = () => undefined;
    const received = new Promise<string>((resolve) => {
      markReceived = resolve;
    });
    await withMock(
      (_res, captured) => {
        markReceived(captured.body);
      },
      async (origin) => {
        const controller = new AbortController();
        const pending = collect(
          adapter.stream(
            request({
              model: "gpt-5",
              profile: roster["gpt-5"]!,
              route: "api_key",
              clientRequestId: "client-req-timeout",
              idempotencyKey: "idem-timeout",
            }),
            callOptions(origin, { signal: controller.signal }),
          ),
        );
        expect((await received).length).toBeGreaterThan(0);
        controller.abort();
        await expect(pending).rejects.toBeInstanceOf(UnknownOutcomeTimeoutError);
        await expect(pending).rejects.toMatchObject({
          kind: "unknown_timeout",
          clientRequestId: "client-req-timeout",
          idempotencyKey: "idem-timeout",
          isProviderSchedulingError: false,
        });
      },
    );
  });

  it("seeds added function calls and deduplicates done plus completed events", async () => {
    await withMock(
      (res) => {
        writeSse(
          res,
          sse("response.output_item.added", {
            type: "response.output_item.added",
            item: {
              type: "function_call",
              id: "fc_1",
              call_id: "call_1",
              name: "read_file",
              arguments: "",
            },
          }) +
            sse("response.function_call_arguments.delta", {
              type: "response.function_call_arguments.delta",
              item_id: "fc_1",
              delta: '{"path":"src/a.ts"}',
            }) +
            sse("response.output_item.done", {
              type: "response.output_item.done",
              item: {
                type: "function_call",
                id: "fc_1",
                call_id: "call_1",
                name: "read_file",
                arguments: '{"path":"src/a.ts"}',
              },
            }) +
            sse("response.completed", {
              type: "response.completed",
              response: {
                output: [
                  {
                    type: "function_call",
                    id: "fc_1",
                    call_id: "call_1",
                    name: "read_file",
                    arguments: '{"path":"src/a.ts"}',
                  },
                ],
                usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
              },
            }),
        );
      },
      async (origin) => {
        const events = await collect(
          adapter.stream(
            request({ model: "gpt-5", profile: roster["gpt-5"]!, route: "api_key" }),
            callOptions(origin),
          ),
        );
        expect(events.filter((event) => event.type === "malformed_tool_args")).toHaveLength(0);
        const deltas = events.filter((event) => event.type === "tool_call_delta");
        expect(deltas).toEqual([
          {
            type: "tool_call_delta",
            callId: "call_1",
            name: "read_file",
            argumentsDelta: '{"path":"src/a.ts"}',
          },
        ]);
        const calls = events.filter((event) => event.type === "tool_call");
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
          type: "tool_call",
          call: { callId: "call_1", name: "read_file", arguments: { path: "src/a.ts" } },
        });
      },
    );
  });

  it("places replayed reasoning items before the assistant function_call and tool output", async () => {
    const reasoning = opaqueReplayItem({
      type: "reasoning",
      id: "rs_turn1",
      encrypted_content: "enc-turn-1",
      summary: [],
    });
    await withMock(
      (res, captured) => {
        const parsed = JSON.parse(captured.body) as { input: Array<{ type?: string; role?: string }> };
        const reasoningIdx = parsed.input.findIndex((item) => item.type === "reasoning");
        const callIdx = parsed.input.findIndex((item) => item.type === "function_call");
        const outputIdx = parsed.input.findIndex((item) => item.type === "function_call_output");
        expect(reasoningIdx).toBeGreaterThan(0);
        expect(callIdx).toBeGreaterThan(reasoningIdx);
        expect(outputIdx).toBeGreaterThan(callIdx);
        writeSse(
          res,
          sse("response.output_text.delta", { type: "response.output_text.delta", delta: "done" }) +
            sse("response.completed", {
              type: "response.completed",
              response: { usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } },
            }),
        );
      },
      async (origin) => {
        const events = await collect(
          adapter.stream(
            request({
              model: "gpt-5",
              profile: roster["gpt-5"]!,
              route: "api_key",
              messages: [
                { role: "user", text: "Read src/a.ts" },
                {
                  role: "assistant",
                  text: "",
                  toolCalls: [{ callId: "call_1", name: "read_file", rawArguments: '{"path":"src/a.ts"}' }],
                },
                { role: "tool", toolCallId: "call_1", text: "file contents" },
              ],
              replayItems: [reasoning],
            }),
            callOptions(origin),
          ),
        );
        expect(events.some((event) => event.type === "text_delta" && event.text === "done")).toBe(
          true,
        );
      },
    );
  });
});

import { describe, expect, it } from "vitest";
import { OpenAICompatibleChatAdapter } from "../../src/protocols/index.js";
import { callOptions, collect, profiles, request, sseData, withMock, writeSse } from "./support.js";

const roster = profiles();
const adapter = new OpenAICompatibleChatAdapter();

describe("OpenAICompatibleChatAdapter", () => {
  it("accumulates tool-call deltas, usage, and OpenRouter cost headers", async () => {
    await withMock(
      (res, captured) => {
        const body = JSON.parse(captured.body) as {
          stream_options?: { include_usage?: boolean };
          parallel_tool_calls?: boolean;
        };
        expect(body.stream_options).toEqual({ include_usage: true });
        expect(body.parallel_tool_calls).toBe(true);
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "x-openrouter-provider": "anthropic",
          "x-openrouter-cost": "0.000120",
        });
        res.end(
          sseData({
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    { index: 0, id: "call_a", function: { name: "read_file", arguments: '{"pa' } },
                  ],
                },
              },
            ],
          }) +
            sseData({
              choices: [
                {
                  index: 0,
                  delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.ts"}' } }] },
                  finish_reason: "tool_calls",
                },
              ],
            }) +
            sseData({
              choices: [],
              usage: {
                prompt_tokens: 11,
                completion_tokens: 6,
                total_tokens: 19,
                prompt_tokens_details: { cached_tokens: 4 },
                cost: 0.00012,
              },
            }) +
            "data: [DONE]\n\n",
        );
      },
      async (origin) => {
        const events = await collect(
          adapter.stream(
            request({
              model: "anthropic/claude",
              profile: roster["openrouter-chat"]!,
              route: "openrouter",
              tools: [
                {
                  name: "read_file",
                  description: "Read",
                  parameters: { type: "object" },
                  kind: "function",
                },
              ],
            }),
            callOptions(origin),
          ),
        );
        expect(events[0]).toMatchObject({
          type: "provider_meta",
          providerName: "anthropic",
          costMicroUsd: 120,
        });
        expect(events).toContainEqual({
          type: "tool_call",
          call: {
            callId: "call_a",
            name: "read_file",
            arguments: { path: "a.ts" },
            rawArguments: '{"path":"a.ts"}',
          },
        });
        expect(events).toContainEqual({
          type: "usage",
          usage: {
            inputTokens: 11,
            outputTokens: 6,
            cacheReadInputTokens: 4,
            totalTokens: 19,
            costMicroUsd: 120,
            cacheCreationInputTokens: 0,
            reasoningTokens: 0,
          },
        });
      },
    );
  });

  it("returns malformed streaming arguments and tolerates local models without usage", async () => {
    await withMock(
      (res, captured) => {
        const body = JSON.parse(captured.body) as Record<string, unknown>;
        expect(body.stream_options).toBeUndefined();
        expect(body.parallel_tool_calls).toBeUndefined();
        expect(body.tools).toBeUndefined();
        writeSse(
          res,
          sseData({
            choices: [{ index: 0, delta: { content: "hello" }, finish_reason: "stop" }],
          }) + "data: [DONE]\n\n",
        );
      },
      async (origin) => {
        const events = await collect(
          adapter.stream(
            request({
              model: "llama3",
              profile: roster["ollama-local-8k"]!,
              route: "ollama",
              tools: [
                {
                  name: "read_file",
                  description: "Read",
                  parameters: {},
                  kind: "function",
                },
              ],
            }),
            callOptions(origin),
          ),
        );
        expect(events.find((event) => event.type === "usage")).toMatchObject({
          type: "usage",
          usage: { outputTokens: 2, costMicroUsd: null },
        });
        expect(events.at(-1)).toMatchObject({ type: "stop", stopReason: "end_turn" });
      },
    );

    await withMock(
      (res) => {
        writeSse(
          res,
          sseData({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_bad",
                      function: { name: "read_file", arguments: '{"path":' },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          }) + "data: [DONE]\n\n",
        );
      },
      async (origin) => {
        const events = await collect(
          adapter.stream(
            request({
              model: "local",
              profile: roster["lm-studio-local"]!,
              route: "lm_studio",
            }),
            callOptions(origin),
          ),
        );
        expect(events.some((event) => event.type === "malformed_tool_args")).toBe(true);
      },
    );
  });

  it("ignores cost strings in assistant text and handles sub-micro usage.cost safely", async () => {
    await withMock(
      (res) => {
        writeSse(
          res,
          sseData({
            choices: [
              {
                index: 0,
                delta: { content: 'example {"cost": 999.5}' },
                finish_reason: "stop",
              },
            ],
          }) +
            sseData({
              choices: [],
              usage: {
                prompt_tokens: 4,
                completion_tokens: 2,
                total_tokens: 6,
                cost: 1.5e-7,
              },
            }) +
            "data: [DONE]\n\n",
        );
      },
      async (origin) => {
        const events = await collect(
          adapter.stream(
            request({
              model: "anthropic/claude",
              profile: roster["openrouter-chat"]!,
              route: "openrouter",
            }),
            callOptions(origin),
          ),
        );
        const usage = events.find((event) => event.type === "usage");
        expect(usage).toMatchObject({
          type: "usage",
          usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6, costMicroUsd: 0 },
        });
      },
    );
  });
});

import { describe, expect, it } from "vitest";
import { AnthropicMessagesAdapter } from "../../src/protocols/index.js";
import { callOptions, collect, profiles, request, sse, withMock, writeSse } from "./support.js";

const roster = profiles();
const adapter = new AnthropicMessagesAdapter();

describe("AnthropicMessagesAdapter", () => {
  it("pins ephemeral cache breakpoints and replays thinking blocks verbatim", async () => {
    await withMock(
      (res, captured) => {
        const body = JSON.parse(captured.body) as {
          system: Array<{ text: string; cache_control: { type: string } }>;
          messages: Array<{ role: string; content: unknown }>;
        };
        expect(body.system[0]).toEqual({
          type: "text",
          text: "Kernel rules stay pinned.",
          cache_control: { type: "ephemeral" },
        });
        expect(body.system[1]).toEqual({
          type: "text",
          text: "MUST keep the write scope.",
          cache_control: { type: "ephemeral" },
        });
        expect(JSON.stringify(body.messages)).toContain('"thinking":"plan the edit"');
        expect(JSON.stringify(body.messages)).toContain('"signature":"sig-keep"');
        expect(captured.headers["x-api-key"]).toBe("local-test-key-0123456789");
        writeSse(
          res,
          sse("message_start", {
            type: "message_start",
            message: {
              usage: {
                input_tokens: 20,
                cache_creation_input_tokens: 80,
                cache_read_input_tokens: 15,
                output_tokens: 1,
              },
            },
          }) +
            sse("content_block_start", {
              type: "content_block_start",
              index: 0,
              content_block: { type: "thinking", thinking: "", signature: "" },
            }) +
            sse("content_block_delta", {
              type: "content_block_delta",
              index: 0,
              delta: { type: "thinking_delta", thinking: "look again" },
            }) +
            sse("content_block_delta", {
              type: "content_block_delta",
              index: 0,
              delta: { type: "signature_delta", signature: "sig-out" },
            }) +
            sse("content_block_stop", { type: "content_block_stop", index: 0 }) +
            sse("content_block_start", {
              type: "content_block_start",
              index: 1,
              content_block: { type: "tool_use", id: "toolu_1", name: "read_file", input: {} },
            }) +
            sse("content_block_delta", {
              type: "content_block_delta",
              index: 1,
              delta: { type: "input_json_delta", partial_json: '{"path":' },
            }) +
            sse("content_block_stop", { type: "content_block_stop", index: 1 }) +
            sse("message_delta", {
              type: "message_delta",
              delta: { stop_reason: "tool_use" },
              usage: { output_tokens: 12 },
            }) +
            sse("message_stop", { type: "message_stop" }),
        );
      },
      async (origin) => {
        const events = await collect(
          adapter.stream(
            request({
              model: "claude-sonnet",
              profile: roster["claude-sonnet"]!,
              route: "api_key",
              messages: [
                {
                  role: "assistant",
                  text: "prior",
                  thinkingBlocks: [{ thinking: "plan the edit", signature: "sig-keep" }],
                },
                { role: "user", text: "continue" },
              ],
            }),
            callOptions(origin),
          ),
        );
        expect(events).toContainEqual({
          type: "thinking_block",
          thinking: "look again",
          signature: "sig-out",
        });
        expect(events).toContainEqual({
          type: "malformed_tool_args",
          item: {
            type: "malformed_tool_args",
            callId: "toolu_1",
            name: "read_file",
            rawArguments: '{"path":',
            parseError: expect.any(String) as string,
          },
        });
        expect(events).toContainEqual({
          type: "usage",
          usage: {
            inputTokens: 20,
            cacheCreationInputTokens: 80,
            cacheReadInputTokens: 15,
            outputTokens: 12,
            totalTokens: 127,
            reasoningTokens: 0,
            costMicroUsd: null,
          },
        });
        expect(events.at(-1)).toMatchObject({ type: "stop", stopReason: "tool_use" });
      },
    );
  });
});

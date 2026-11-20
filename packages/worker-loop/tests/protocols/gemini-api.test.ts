import { describe, expect, it } from "vitest";
import { GeminiApiAdapter, opaqueReplayItem } from "../../src/protocols/index.js";
import { callOptions, collect, profiles, request, sseData, withMock, writeSse } from "./support.js";

const roster = profiles();
const adapter = new GeminiApiAdapter();

describe("GeminiApiAdapter", () => {
  it("streams function calls, thought signatures, JSON schema output, and usageMetadata", async () => {
    const thought = opaqueReplayItem({
      text: "kept thought",
      thought: true,
      thoughtSignature: "sig-replay",
    });
    await withMock(
      (res, captured) => {
        expect(captured.url).toContain("/models/gemini-flash:streamGenerateContent?alt=sse");
        expect(captured.headers["x-goog-api-key"]).toBe("local-test-key-0123456789");
        const body = JSON.parse(captured.body) as {
          systemInstruction: { parts: Array<{ text: string }> };
          generationConfig: { responseMimeType: string; responseSchema: { type: string } };
          contents: unknown[];
        };
        expect(body.systemInstruction.parts.map((part) => part.text)).toEqual([
          "Kernel rules stay pinned.",
          "MUST keep the write scope.",
        ]);
        expect(body.generationConfig.responseMimeType).toBe("application/json");
        expect(body.generationConfig.responseSchema).toEqual({ type: "object" });
        expect(JSON.stringify(body.contents)).toContain('"thoughtSignature":"sig-replay"');
        writeSse(
          res,
          sseData({
            candidates: [
              {
                content: {
                  parts: [
                    { text: "consider", thought: true, thoughtSignature: "sig-out" },
                    { functionCall: { name: "read_file", args: { path: "a.ts" } } },
                    { text: '{"ok":true}' },
                  ],
                },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 4,
              totalTokenCount: 16,
              cachedContentTokenCount: 3,
              thoughtsTokenCount: 2,
            },
          }),
        );
      },
      async (origin) => {
        const events = await collect(
          adapter.stream(
            request({
              model: "gemini-flash",
              profile: roster["gemini-flash"]!,
              route: "ai_studio",
              responseSchema: { type: "object" },
              messages: [
                { role: "assistant", text: "", thoughtParts: [thought] },
                { role: "user", text: "next" },
              ],
            }),
            callOptions(origin),
          ),
        );
        expect(events).toContainEqual({
          type: "thought_signature",
          signature: "sig-out",
          canonicalJson: JSON.stringify({
            text: "consider",
            thought: true,
            thoughtSignature: "sig-out",
          }),
        });
        expect(events).toContainEqual({
          type: "thinking_block",
          thinking: "consider",
          signature: "sig-out",
        });
        expect(events).toContainEqual({
          type: "tool_call",
          call: {
            callId: "read_file",
            name: "read_file",
            arguments: { path: "a.ts" },
            rawArguments: '{"path":"a.ts"}',
          },
        });
        expect(events).toContainEqual({
          type: "structured_output",
          jsonText: '{"ok":true}',
          parsed: { ok: true },
        });
        expect(events).toContainEqual({
          type: "usage",
          usage: {
            inputTokens: 10,
            outputTokens: 4,
            cacheReadInputTokens: 3,
            reasoningTokens: 2,
            totalTokens: 16,
            cacheCreationInputTokens: 0,
            costMicroUsd: null,
          },
        });
      },
    );
  });

  it("reports malformed function-call argument strings", async () => {
    await withMock(
      (res) => {
        writeSse(
          res,
          sseData({
            candidates: [
              {
                content: { parts: [{ functionCall: { name: "read_file", args: '{"path":' } }] },
                finishReason: "STOP",
              },
            ],
            usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
          }),
        );
      },
      async (origin) => {
        const events = await collect(
          adapter.stream(
            request({ model: "gemini-flash", profile: roster["gemini-flash"]!, route: "vertex" }),
            callOptions(origin, { apiKey: "vertex-key-0123456789" }),
          ),
        );
        expect(events.some((event) => event.type === "malformed_tool_args")).toBe(true);
      },
    );
  });
});

import type { CollectedTurn, LoopStreamEvent } from "./ports.js";
import type { ProviderItem, ToolCall } from "./types.js";

export async function collectModelTurn(
  stream: AsyncIterable<LoopStreamEvent>,
): Promise<CollectedTurn> {
  const items: ProviderItem[] = [];
  const toolCalls: ToolCall[] = [];
  let text = "";
  let tokensIn = 0;
  let tokensOut = 0;
  let stopReason: CollectedTurn["stopReason"] = "end_turn";

  const flushText = (): void => {
    if (text.length === 0) return;
    items.push({
      type: "message",
      text,
      encryptedContent: null,
      name: null,
      arguments: null,
      callId: null,
    });
    text = "";
  };

  for await (const event of stream) {
    if (event.type === "text_delta") {
      text += event.text;
      continue;
    }
    if (event.type === "reasoning_item") {
      flushText();
      items.push({
        type: "reasoning",
        text: null,
        encryptedContent: event.encryptedContent,
        name: null,
        arguments: event.canonicalJson,
        callId: null,
      });
      continue;
    }
    if (event.type === "tool_call") {
      flushText();
      const call: ToolCall = {
        callId: event.callId,
        name: event.name,
        arguments: event.arguments,
        rawArguments: event.rawArguments,
        malformed: false,
        malformedError: null,
      };
      toolCalls.push(call);
      items.push({
        type: "function_call",
        text: null,
        encryptedContent: null,
        name: event.name,
        arguments: event.rawArguments,
        callId: event.callId,
      });
      continue;
    }
    if (event.type === "malformed_tool_args") {
      flushText();
      toolCalls.push({
        callId: event.callId,
        name: event.name,
        arguments: {},
        rawArguments: event.rawArguments,
        malformed: true,
        malformedError: event.error,
      });
      continue;
    }
    if (event.type === "usage") {
      tokensIn = event.inputTokens;
      tokensOut = event.outputTokens;
      continue;
    }
    if (event.type === "stop") {
      stopReason = event.stopReason;
      continue;
    }
    throw event.error;
  }
  flushText();
  if (toolCalls.length > 0 && stopReason === "end_turn") stopReason = "tool_use";
  return { items, toolCalls, text: items.filter((item) => item.type === "message").map((item) => item.text ?? "").join(""), tokensIn, tokensOut, stopReason };
}

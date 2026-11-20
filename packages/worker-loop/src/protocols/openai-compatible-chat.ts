import { usdToMicroUnits } from "./currency-port.js";
import { assertRoute } from "./profiles.js";
import { asRecord, asString, parseJsonRecord, type SseFrame } from "./sse.js";
import {
  identityHeaders,
  postProviderStream,
  type PreparedHttpRequest,
  type SseTranslator,
} from "./transport.js";
import {
  assertModelTurnRequest,
  localOutputBudget,
  malformedToolArgs,
  parseToolArguments,
  type AdapterCallOptions,
  type ConversationMessage,
  type ModelProtocolAdapter,
  type ModelTurnRequest,
  type StopReason,
  type StreamEvent,
} from "./types.js";
import { emptyTokenUsage, readIntegerField, type TokenUsage } from "./usage.js";

export class OpenAICompatibleChatAdapter implements ModelProtocolAdapter {
  readonly protocol = "openai_compatible_chat" as const;
  readonly adapterName = "OpenAICompatibleChatAdapter";

  stream(request: ModelTurnRequest, options: AdapterCallOptions): AsyncIterable<StreamEvent> {
    assertModelTurnRequest(request);
    assertRoute(this.protocol, request.route, ["api_key", "openrouter", "ollama", "lm_studio"]);
    return postProviderStream(
      prepareOpenAICompatibleChat(request, options),
      options,
      () => new ChatTranslator(),
    );
  }
}

export function prepareOpenAICompatibleChat(
  request: ModelTurnRequest,
  options: AdapterCallOptions,
): PreparedHttpRequest {
  const messages: unknown[] = [
    {
      role: "system",
      content: `${request.prefix.zone1}\n\n${request.prefix.zone2}`,
    },
  ];
  for (const message of request.messages) messages.push(toChatMessage(message));
  const body: Record<string, unknown> = {
    model: request.model,
    stream: true,
    messages,
  };
  const localRoute = request.route === "ollama" || request.route === "lm_studio";
  if (!localRoute) body.stream_options = { include_usage: true };
  if (request.profile.supportsParallelToolCalls) body.parallel_tool_calls = true;
  if (request.maxOutputTokens !== undefined) body.max_tokens = request.maxOutputTokens;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.profile.supportsToolCalling && request.tools.length > 0) {
    body.tools = request.tools
      .filter((tool) => tool.kind === "function")
      .map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
  }
  return {
    url: chatCompletionsUrl(options.baseUrl),
    headers: identityHeaders(
      { authorization: `Bearer ${options.apiKey}` },
      request.clientRequestId,
      request.idempotencyKey,
    ),
    body,
    opaque: new Set<unknown>(),
    outputBudget: localOutputBudget(request),
    clientRequestId: request.clientRequestId,
    idempotencyKey: request.idempotencyKey,
    protocol: "openai_compatible_chat",
    model: request.model,
    route: request.route,
  };
}

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

function toChatMessage(message: ConversationMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId ?? "", content: message.text };
  }
  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: message.text.length > 0 ? message.text : null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.callId,
        type: "function",
        function: { name: call.name, arguments: call.rawArguments },
      })),
    };
  }
  return { role: message.role, content: message.text };
}

interface ToolAccumulator {
  id: string;
  name: string;
  raw: string;
}

class ChatTranslator implements SseTranslator {
  private usageValue = emptyTokenUsage();
  private stop: StopReason = "end_turn";
  private readonly tools = new Map<number, ToolAccumulator>();
  private flushed = false;

  push(frame: SseFrame): StreamEvent[] {
    if (frame.data === "[DONE]") return this.flushTools();
    const record = parseJsonRecord(frame.data);
    if (!record) return [];
    const costText = readDecimal(frame.data, "cost");
    if (costText !== null) {
      this.usageValue = { ...this.usageValue, costMicroUsd: usdToMicroUnits(costText) };
    }
    const usage = asRecord(record.usage);
    if (usage) this.usageValue = usageFromChat(usage, this.usageValue.costMicroUsd);
    const choice = Array.isArray(record.choices) ? asRecord(record.choices[0]) : null;
    if (!choice) return [];
    const events: StreamEvent[] = [];
    const delta = asRecord(choice.delta);
    const content = asString(delta?.content);
    if (content) events.push({ type: "text_delta", text: content });
    const toolCalls = delta?.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const entry of toolCalls) {
        const tool = asRecord(entry);
        if (!tool) continue;
        const index = readIntegerField(tool, "index") ?? 0;
        const current = this.tools.get(index) ?? { id: "", name: "", raw: "" };
        const id = asString(tool.id);
        const name = asString(asRecord(tool.function)?.name);
        const args = asString(asRecord(tool.function)?.arguments) ?? "";
        if (id) current.id = id;
        if (name) current.name = name;
        current.raw += args;
        this.tools.set(index, current);
        if (args.length > 0) {
          events.push({
            type: "tool_call_delta",
            callId: current.id || `call_${index}`,
            name: current.name,
            argumentsDelta: args,
          });
        }
      }
    }
    const finish = asString(choice.finish_reason);
    if (finish === "tool_calls") {
      this.stop = "tool_use";
      events.push(...this.flushTools());
    } else if (finish === "length") {
      this.stop = "max_tokens";
    } else if (finish === "stop") {
      this.stop = "end_turn";
    }
    return events;
  }

  finish(): StreamEvent[] {
    return this.flushTools();
  }

  usage(): TokenUsage {
    return this.usageValue;
  }

  stopReason(): StopReason {
    return this.stop;
  }

  private flushTools(): StreamEvent[] {
    if (this.flushed || this.tools.size === 0) return [];
    this.flushed = true;
    const events: StreamEvent[] = [];
    for (const [index, tool] of this.tools) {
      const callId = tool.id || `call_${index}`;
      const parsed = parseToolArguments(tool.raw);
      if (!parsed.ok) {
        events.push({
          type: "malformed_tool_args",
          item: malformedToolArgs(callId, tool.name, tool.raw, parsed.error),
        });
        continue;
      }
      events.push({
        type: "tool_call",
        call: { callId, name: tool.name, arguments: parsed.value, rawArguments: tool.raw },
      });
    }
    if (events.length > 0 && this.stop === "end_turn") this.stop = "tool_use";
    return events;
  }
}

function usageFromChat(usage: Record<string, unknown>, costMicroUsd: number | null): TokenUsage {
  const inputTokens = readIntegerField(usage, "prompt_tokens") ?? 0;
  const outputTokens = readIntegerField(usage, "completion_tokens") ?? 0;
  const cacheReadInputTokens =
    readIntegerField(asRecord(usage.prompt_tokens_details), "cached_tokens") ?? 0;
  const totalTokens = readIntegerField(usage, "total_tokens") ?? inputTokens + outputTokens;
  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens,
    reasoningTokens: 0,
    totalTokens,
    costMicroUsd,
  };
}

function readDecimal(raw: string, key: string): string | null {
  const match = new RegExp(`"${key}"\\s*:\\s*(\\d+(?:\\.\\d+)?)`).exec(raw);
  return match?.[1] ?? null;
}

import { assertRoute } from "./profiles.js";
import { classifyProviderFailure } from "./errors.js";
import { asRecord, asString, parseJsonRecord, type SseFrame } from "./sse.js";
import type { SecretRedactorPort } from "./telemetry-port.js";
import {
  identityHeaders,
  joinUrl,
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
  type ThinkingBlock,
} from "./types.js";
import { emptyTokenUsage, mergeTokenUsage, readIntegerField, type TokenUsage } from "./usage.js";

export class AnthropicMessagesAdapter implements ModelProtocolAdapter {
  readonly protocol = "anthropic_messages" as const;
  readonly adapterName = "AnthropicMessagesAdapter";

  stream(request: ModelTurnRequest, options: AdapterCallOptions): AsyncIterable<StreamEvent> {
    assertModelTurnRequest(request);
    assertRoute(this.protocol, request.route, ["api_key"]);
    const prepared = prepareAnthropicMessages(request, options);
    return postProviderStream(
      prepared,
      options,
      () =>
        new AnthropicTranslator(options.redactor, request.clientRequestId, request.idempotencyKey),
    );
  }
}

export function prepareAnthropicMessages(
  request: ModelTurnRequest,
  options: AdapterCallOptions,
): PreparedHttpRequest {
  const opaque = new Set<unknown>();
  const body: Record<string, unknown> = {
    model: request.model,
    max_tokens: request.maxOutputTokens ?? request.profile.maxOutputTokens,
    stream: true,
    system: [
      { type: "text", text: request.prefix.zone1, cache_control: { type: "ephemeral" } },
      { type: "text", text: request.prefix.zone2, cache_control: { type: "ephemeral" } },
    ],
    messages: request.messages
      .filter((message) => message.role !== "system")
      .map((message) => toAnthropicMessage(message, opaque)),
  };
  const tools = request.tools
    .filter((tool) => tool.kind === "function")
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  if (tools.length > 0) body.tools = tools;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  return {
    url: joinUrl(options.baseUrl, "/v1/messages"),
    headers: identityHeaders(
      { "x-api-key": options.apiKey, "anthropic-version": "2023-06-01" },
      request.clientRequestId,
      request.idempotencyKey,
    ),
    body,
    opaque,
    outputBudget: localOutputBudget(request),
    clientRequestId: request.clientRequestId,
    idempotencyKey: request.idempotencyKey,
    protocol: "anthropic_messages",
    model: request.model,
    route: request.route,
  };
}

function toAnthropicMessage(
  message: ConversationMessage,
  opaque: Set<unknown>,
): Record<string, unknown> {
  if (message.role === "tool") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: message.toolCallId ?? "",
          content: message.text,
        },
      ],
    };
  }
  if (message.role === "assistant") {
    const content: unknown[] = [];
    for (const block of message.thinkingBlocks ?? []) {
      content.push(opaqueThinking(block, opaque));
    }
    if (message.text.length > 0) content.push({ type: "text", text: message.text });
    for (const call of message.toolCalls ?? []) {
      const parsed = parseToolArguments(call.rawArguments);
      content.push({
        type: "tool_use",
        id: call.callId,
        name: call.name,
        input: parsed.ok ? parsed.value : { raw: call.rawArguments },
      });
    }
    return { role: "assistant", content };
  }
  return { role: "user", content: message.text };
}

function opaqueThinking(block: ThinkingBlock, opaque: Set<unknown>): Record<string, unknown> {
  const thinking = { type: "thinking", thinking: block.thinking, signature: block.signature };
  opaque.add(thinking);
  return thinking;
}

interface AnthropicBlock {
  type: "text" | "thinking" | "tool_use";
  text: string;
  thinking: string;
  signature: string;
  id: string;
  name: string;
  raw: string;
}

class AnthropicTranslator implements SseTranslator {
  private usageValue = emptyTokenUsage();
  private stop: StopReason = "end_turn";
  private readonly blocks = new Map<number, AnthropicBlock>();

  constructor(
    private readonly redactor: SecretRedactorPort | undefined,
    private readonly clientRequestId: string,
    private readonly idempotencyKey: string,
  ) {}

  push(frame: SseFrame): StreamEvent[] {
    const record = parseJsonRecord(frame.data);
    if (!record) return [];
    const type = asString(record.type) ?? frame.event;
    if (type === "error") {
      throw classifyProviderFailure({
        status: 400,
        headers: new Headers(),
        bodyText: this.redactor ? this.redactor.redact(frame.data) : frame.data,
        clientRequestId: this.clientRequestId,
        idempotencyKey: this.idempotencyKey,
      });
    }
    if (type === "message_start") {
      this.usageValue = usageFromAnthropic(
        asRecord(asRecord(record.message)?.usage),
        this.usageValue,
      );
      return [];
    }
    if (type === "content_block_start") {
      const index = readIntegerField(record, "index") ?? this.blocks.size;
      const block = asRecord(record.content_block);
      const blockType = asString(block?.type);
      this.blocks.set(index, {
        type: blockType === "thinking" || blockType === "tool_use" ? blockType : "text",
        text: asString(block?.text) ?? "",
        thinking: asString(block?.thinking) ?? "",
        signature: asString(block?.signature) ?? "",
        id: asString(block?.id) ?? `tool_${index}`,
        name: asString(block?.name) ?? "",
        raw: "",
      });
      return [];
    }
    if (type === "content_block_delta") {
      return this.applyDelta(record);
    }
    if (type === "content_block_stop") {
      return this.finishBlock(readIntegerField(record, "index") ?? -1);
    }
    if (type === "message_delta") {
      this.usageValue = usageFromAnthropic(asRecord(record.usage), this.usageValue);
      const reason = asString(asRecord(record.delta)?.stop_reason);
      if (reason === "tool_use") this.stop = "tool_use";
      else if (reason === "max_tokens") this.stop = "max_tokens";
      else if (reason === "end_turn") this.stop = "end_turn";
      else if (reason === "stop_sequence") this.stop = "stop";
      return [];
    }
    return [];
  }

  finish(): StreamEvent[] {
    return [];
  }

  usage(): TokenUsage {
    return this.usageValue;
  }

  stopReason(): StopReason {
    return this.stop;
  }

  private applyDelta(record: Record<string, unknown>): StreamEvent[] {
    const index = readIntegerField(record, "index") ?? 0;
    const block = this.blocks.get(index);
    const delta = asRecord(record.delta);
    if (!block || !delta) return [];
    const deltaType = asString(delta.type);
    if (deltaType === "text_delta") {
      const text = asString(delta.text) ?? "";
      block.text += text;
      return text.length > 0 ? [{ type: "text_delta", text }] : [];
    }
    if (deltaType === "thinking_delta") {
      block.thinking += asString(delta.thinking) ?? "";
      return [];
    }
    if (deltaType === "signature_delta") {
      block.signature += asString(delta.signature) ?? "";
      return [];
    }
    if (deltaType === "input_json_delta") {
      const partial = asString(delta.partial_json) ?? "";
      block.raw += partial;
      return [
        {
          type: "tool_call_delta",
          callId: block.id,
          name: block.name,
          argumentsDelta: partial,
        },
      ];
    }
    return [];
  }

  private finishBlock(index: number): StreamEvent[] {
    const block = this.blocks.get(index);
    if (!block) return [];
    if (block.type === "thinking") {
      return [{ type: "thinking_block", thinking: block.thinking, signature: block.signature }];
    }
    if (block.type === "tool_use") {
      const parsed = parseToolArguments(block.raw);
      if (!parsed.ok) {
        return [
          {
            type: "malformed_tool_args",
            item: malformedToolArgs(block.id, block.name, block.raw, parsed.error),
          },
        ];
      }
      return [
        {
          type: "tool_call",
          call: {
            callId: block.id,
            name: block.name,
            arguments: parsed.value,
            rawArguments: block.raw,
          },
        },
      ];
    }
    return [];
  }
}

function usageFromAnthropic(
  usage: Record<string, unknown> | null,
  previous: TokenUsage,
): TokenUsage {
  if (!usage) return previous;
  const inputTokens = readIntegerField(usage, "input_tokens");
  const outputTokens = readIntegerField(usage, "output_tokens");
  const cacheCreationInputTokens = readIntegerField(usage, "cache_creation_input_tokens");
  const cacheReadInputTokens = readIntegerField(usage, "cache_read_input_tokens");
  const merged = mergeTokenUsage(previous, {
    ...(inputTokens === null ? {} : { inputTokens }),
    ...(outputTokens === null ? {} : { outputTokens }),
    ...(cacheCreationInputTokens === null ? {} : { cacheCreationInputTokens }),
    ...(cacheReadInputTokens === null ? {} : { cacheReadInputTokens }),
  });
  return mergeTokenUsage(merged, {
    totalTokens:
      merged.inputTokens +
      merged.cacheCreationInputTokens +
      merged.cacheReadInputTokens +
      merged.outputTokens,
  });
}

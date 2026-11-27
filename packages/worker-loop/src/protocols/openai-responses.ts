import { assertRoute } from "./profiles.js";
import { assertSiwcCompliantBody, classifyProviderFailure } from "./errors.js";
import { SiwcHostedToolError } from "./model-error.js";
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
  exemptReplayItems,
  localOutputBudget,
  malformedToolArgs,
  opaqueReplayItem,
  parseToolArguments,
  type AdapterCallOptions,
  type ConversationMessage,
  type EncryptedReasoningProbeResult,
  type ModelProtocolAdapter,
  type ModelTurnRequest,
  type StopReason,
  type StreamEvent,
  type ToolDefinition,
} from "./types.js";
import { emptyTokenUsage, readIntegerField, type TokenUsage } from "./usage.js";

export class OpenAIResponsesAdapter implements ModelProtocolAdapter {
  readonly protocol = "openai_responses" as const;
  readonly adapterName = "OpenAIResponsesAdapter";

  stream(request: ModelTurnRequest, options: AdapterCallOptions): AsyncIterable<StreamEvent> {
    assertModelTurnRequest(request);
    assertRoute(this.protocol, request.route, ["api_key", "siwc"]);
    const prepared = prepareOpenAIResponses(request, options);
    return postProviderStream(
      prepared,
      options,
      () =>
        new OpenAIResponsesTranslator(
          options.redactor,
          request.clientRequestId,
          request.idempotencyKey,
        ),
    );
  }

  async probeEncryptedReasoning(
    request: ModelTurnRequest,
    options: AdapterCallOptions,
  ): Promise<EncryptedReasoningProbeResult> {
    const items = [];
    for await (const event of this.stream(request, options)) {
      if (event.type === "reasoning_item") items.push(event.item);
    }
    const supported = items.some((item) => {
      const value = JSON.parse(item.canonicalJson) as { encrypted_content?: unknown };
      return typeof value.encrypted_content === "string" && value.encrypted_content.length > 0;
    });
    return supported ? { supported: true, items } : { supported: false, items: [] };
  }
}

export function prepareOpenAIResponses(
  request: ModelTurnRequest,
  options: AdapterCallOptions,
): PreparedHttpRequest {
  if (request.route === "siwc") {
    const hosted = request.tools.filter((tool) => tool.kind === "hosted");
    if (hosted.length > 0) {
      throw new SiwcHostedToolError(hosted.map((tool) => tool.hostedType ?? tool.name));
    }
  }
  const replay = exemptReplayItems(request.replayItems);
  const opaque = new Set<unknown>(replay.opaque);
  const input: unknown[] = [
    { role: "system", content: `${request.prefix.zone1}\n${request.prefix.zone2}` },
  ];
  const messages = [...request.messages];
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }
  const splitAt =
    lastAssistantIdx >= 0 ? lastAssistantIdx : messages.length > 0 ? messages.length - 1 : 0;
  for (const message of messages.slice(0, splitAt)) appendResponsesMessage(input, message, opaque);
  for (const item of replay.values) input.push(item);
  for (const message of messages.slice(splitAt)) appendResponsesMessage(input, message, opaque);

  const body: Record<string, unknown> = {
    model: request.model,
    input,
    stream: true,
    store: false,
  };
  if (request.route !== "siwc") {
    if (request.maxOutputTokens !== undefined) body.max_output_tokens = request.maxOutputTokens;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.previousResponseId !== undefined)
      body.previous_response_id = request.previousResponseId;
    if (request.store === true) body.store = true;
  }
  const tools = request.tools
    .filter((tool) => tool.kind !== "hosted" || request.route !== "siwc")
    .map(toResponsesTool);
  if (tools.length > 0) body.tools = tools;
  if (request.includeEncryptedReasoning !== false && request.profile.supportsReasoningReplay) {
    body.include = ["reasoning.encrypted_content"];
  }
  if (request.route === "siwc") assertSiwcCompliantBody(body);
  return {
    url: joinUrl(options.baseUrl, "/responses"),
    headers: identityHeaders(
      { authorization: `Bearer ${options.apiKey}` },
      request.clientRequestId,
      request.idempotencyKey,
    ),
    body,
    opaque,
    outputBudget: localOutputBudget(request),
    clientRequestId: request.clientRequestId,
    idempotencyKey: request.idempotencyKey,
    protocol: "openai_responses",
    model: request.model,
    route: request.route,
  };
}

function appendResponsesMessage(
  target: unknown[],
  message: ConversationMessage,
  opaque: Set<unknown>,
): void {
  if (message.role === "assistant") {
    if (message.replayItems && message.replayItems.length > 0) {
      const perTurn = exemptReplayItems(message.replayItems);
      for (const item of perTurn.values) {
        opaque.add(item);
        target.push(item);
      }
    }
    if (message.toolCalls && message.toolCalls.length > 0) {
      if (message.text.length > 0) target.push({ role: "assistant", content: message.text });
      for (const call of message.toolCalls) {
        target.push({
          type: "function_call",
          call_id: call.callId,
          name: call.name,
          arguments: call.rawArguments,
        });
      }
      return;
    }
  }
  if (message.role === "tool") {
    target.push({
      type: "function_call_output",
      call_id: message.toolCallId ?? "",
      output: message.text,
    });
    return;
  }
  const role = message.role === "system" || message.role === "assistant" ? message.role : "user";
  target.push({ role, content: message.text });
}

function toResponsesTool(tool: ToolDefinition): Record<string, unknown> {
  if (tool.kind === "custom") {
    return { type: "custom", name: tool.name, description: tool.description };
  }
  if (tool.kind === "hosted") {
    return { type: tool.hostedType ?? tool.name };
  }
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

class OpenAIResponsesTranslator implements SseTranslator {
  private usageValue = emptyTokenUsage();
  private stop: StopReason = "end_turn";
  private sawTool = false;
  private readonly seenReasoning = new Set<string>();
  private readonly seenToolCalls = new Set<string>();
  private readonly args = new Map<string, { callId: string; name: string; raw: string }>();

  constructor(
    private readonly redactor: SecretRedactorPort | undefined,
    private readonly clientRequestId: string,
    private readonly idempotencyKey: string,
  ) {}

  push(frame: SseFrame): StreamEvent[] {
    if (frame.data === "[DONE]") return [];
    const record = parseJsonRecord(frame.data);
    if (!record) return [];
    const type = asString(record.type) ?? frame.event;
    if (type === "error" || record.error) {
      throw classifyProviderFailure({
        status: 400,
        headers: new Headers(),
        bodyText: this.redactor ? this.redactor.redact(frame.data) : frame.data,
        clientRequestId: this.clientRequestId,
        idempotencyKey: this.idempotencyKey,
      });
    }
    if (type === "response.output_text.delta") {
      const delta = asString(record.delta) ?? "";
      return delta.length > 0 ? [{ type: "text_delta", text: delta }] : [];
    }
    if (type === "response.function_call_arguments.delta") {
      const delta = asString(record.delta) ?? "";
      const itemId = asString(record.item_id) ?? "call";
      const current = this.args.get(itemId) ?? { callId: itemId, name: "", raw: "" };
      current.raw += delta;
      this.args.set(itemId, current);
      return [
        { type: "tool_call_delta", callId: current.callId, name: current.name, argumentsDelta: delta },
      ];
    }
    if (type === "response.output_item.added") {
      this.seedAddedItem(record.item);
      return [];
    }
    if (type === "response.output_item.done") {
      return this.eventsFromItem(record.item);
    }
    if (type === "response.completed") {
      const response = asRecord(record.response);
      this.usageValue = usageFromResponses(response?.usage);
      const reason = asString(asRecord(response?.incomplete_details)?.reason);
      if (reason === "max_output_tokens") this.stop = "max_tokens";
      const output = response?.output;
      const events: StreamEvent[] = [];
      if (Array.isArray(output)) {
        for (const item of output) events.push(...this.eventsFromItem(item));
      }
      if (this.sawTool && this.stop === "end_turn") this.stop = "tool_use";
      return events;
    }
    return [];
  }

  finish(): StreamEvent[] {
    if (this.sawTool && this.stop === "end_turn") this.stop = "tool_use";
    return [];
  }

  usage(): TokenUsage {
    return this.usageValue;
  }

  stopReason(): StopReason {
    return this.stop;
  }

  private seedAddedItem(value: unknown): void {
    const item = asRecord(value);
    if (!item || item.type !== "function_call") return;
    const itemId = asString(item.id) ?? asString(item.call_id) ?? "call";
    const callId = asString(item.call_id) ?? itemId;
    const name = asString(item.name) ?? "";
    const raw = asString(item.arguments) ?? "";
    const entry = { callId, name, raw };
    this.args.set(itemId, entry);
    if (callId !== itemId) this.args.set(callId, entry);
  }

  private eventsFromItem(value: unknown): StreamEvent[] {
    const item = asRecord(value);
    if (!item) return [];
    if (item.type === "reasoning") {
      const replay = opaqueReplayItem(item);
      if (this.seenReasoning.has(replay.canonicalJson)) return [];
      this.seenReasoning.add(replay.canonicalJson);
      return [{ type: "reasoning_item", item: replay }];
    }
    if (item.type === "function_call") {
      const itemId = asString(item.id) ?? asString(item.call_id) ?? "call";
      const rawCallId = asString(item.call_id);
      const tracked = this.args.get(itemId) ?? (rawCallId ? this.args.get(rawCallId) : undefined);
      const callId = rawCallId ?? tracked?.callId ?? itemId;
      if (this.seenToolCalls.has(callId)) return [];
      this.seenToolCalls.add(callId);
      this.sawTool = true;
      const name = asString(item.name) ?? tracked?.name ?? "";
      const itemArgs = asString(item.arguments);
      const raw =
        itemArgs !== null && itemArgs.length > 0 ? itemArgs : (tracked?.raw ?? itemArgs ?? "");
      const parsed = parseToolArguments(raw);
      if (!parsed.ok) {
        return [
          { type: "malformed_tool_args", item: malformedToolArgs(callId, name, raw, parsed.error) },
        ];
      }
      return [
        {
          type: "tool_call",
          call: { callId, name, arguments: parsed.value, rawArguments: raw },
        },
      ];
    }
    return [];
  }
}

function usageFromResponses(usage: unknown): TokenUsage {
  const record = asRecord(usage);
  if (!record) return emptyTokenUsage();
  const inputTokens = readIntegerField(record, "input_tokens") ?? 0;
  const outputTokens = readIntegerField(record, "output_tokens") ?? 0;
  const reasoningTokens =
    readIntegerField(asRecord(record.output_tokens_details), "reasoning_tokens") ?? 0;
  const cacheReadInputTokens =
    readIntegerField(asRecord(record.input_tokens_details), "cached_tokens") ?? 0;
  const totalTokens =
    readIntegerField(record, "total_tokens") ?? inputTokens + cacheReadInputTokens + outputTokens;
  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens,
    reasoningTokens,
    totalTokens,
    costMicroUsd: null,
  };
}

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
  opaqueReplayItem,
  parseToolArguments,
  readOpaqueReplayItem,
  type AdapterCallOptions,
  type ConversationMessage,
  type ModelProtocolAdapter,
  type ModelTurnRequest,
  type StopReason,
  type StreamEvent,
} from "./types.js";
import { emptyTokenUsage, mergeTokenUsage, readIntegerField, type TokenUsage } from "./usage.js";

export class GeminiApiAdapter implements ModelProtocolAdapter {
  readonly protocol = "gemini_api" as const;
  readonly adapterName = "GeminiApiAdapter";

  stream(request: ModelTurnRequest, options: AdapterCallOptions): AsyncIterable<StreamEvent> {
    assertModelTurnRequest(request);
    assertRoute(this.protocol, request.route, ["ai_studio", "vertex"]);
    const prepared = prepareGemini(request, options);
    return postProviderStream(
      prepared,
      options,
      () => new GeminiTranslator(request.responseSchema !== undefined),
    );
  }
}

export function prepareGemini(
  request: ModelTurnRequest,
  options: AdapterCallOptions,
): PreparedHttpRequest {
  const opaque = new Set<unknown>();
  const contents: unknown[] = [];
  for (const message of request.messages) {
    if (message.role === "system") continue;
    contents.push(toGeminiContent(message, opaque));
  }
  const generationConfig: Record<string, unknown> = {};
  if (request.maxOutputTokens !== undefined)
    generationConfig.maxOutputTokens = request.maxOutputTokens;
  if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
  if (request.responseSchema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = request.responseSchema;
  }
  const body: Record<string, unknown> = {
    systemInstruction: {
      parts: [{ text: request.prefix.zone1 }, { text: request.prefix.zone2 }],
    },
    contents,
  };
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;
  const functions = request.tools
    .filter((tool) => tool.kind === "function")
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  if (functions.length > 0) body.tools = [{ functionDeclarations: functions }];
  const headers =
    request.route === "vertex"
      ? identityHeaders(
          { authorization: `Bearer ${options.apiKey}` },
          request.clientRequestId,
          request.idempotencyKey,
        )
      : identityHeaders(
          { "x-goog-api-key": options.apiKey },
          request.clientRequestId,
          request.idempotencyKey,
        );
  return {
    url: geminiStreamUrl(options.baseUrl, request.model),
    headers,
    body,
    opaque,
    outputBudget: localOutputBudget(request),
    clientRequestId: request.clientRequestId,
    idempotencyKey: request.idempotencyKey,
    protocol: "gemini_api",
    model: request.model,
    route: request.route,
  };
}

function geminiStreamUrl(baseUrl: string, model: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.includes(":streamGenerateContent")) return trimmed;
  return `${trimmed}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
}

function toGeminiContent(
  message: ConversationMessage,
  opaque: Set<unknown>,
): Record<string, unknown> {
  if (message.role === "tool") {
    return {
      role: "user",
      parts: [
        {
          functionResponse: {
            name: message.name ?? "",
            response: { text: message.text },
          },
        },
      ],
    };
  }
  if (message.role === "assistant") {
    const parts: unknown[] = [];
    for (const thought of message.thoughtParts ?? []) {
      const value = readOpaqueReplayItem(thought);
      opaque.add(value);
      parts.push(value);
    }
    if (message.text.length > 0) parts.push({ text: message.text });
    for (const call of message.toolCalls ?? []) {
      const parsed = parseToolArguments(call.rawArguments);
      parts.push({
        functionCall: {
          name: call.name,
          args: parsed.ok ? parsed.value : call.rawArguments,
        },
      });
    }
    return { role: "model", parts };
  }
  return { role: "user", parts: [{ text: message.text }] };
}

class GeminiTranslator implements SseTranslator {
  private usageValue = emptyTokenUsage();
  private stop: StopReason = "end_turn";
  private readonly text: string[] = [];
  private emittedStructured = false;

  constructor(private readonly structured: boolean) {}

  push(frame: SseFrame): StreamEvent[] {
    const record = parseJsonRecord(frame.data);
    if (!record) return [];
    const usage = asRecord(record.usageMetadata);
    if (usage) this.usageValue = usageFromGemini(usage);
    const events: StreamEvent[] = [];
    const candidates = record.candidates;
    if (!Array.isArray(candidates)) return events;
    for (const candidate of candidates) {
      const candidateRecord = asRecord(candidate);
      if (!candidateRecord) continue;
      const finish = asString(candidateRecord.finishReason);
      if (finish === "MAX_TOKENS") this.stop = "max_tokens";
      else if (finish === "STOP") this.stop = "end_turn";
      const parts = asRecord(candidateRecord.content)?.parts;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) events.push(...this.eventsFromPart(part));
    }
    return events;
  }

  finish(): StreamEvent[] {
    if (!this.structured || this.emittedStructured) return [];
    this.emittedStructured = true;
    const jsonText = this.text.join("");
    const parsed = parseToolArguments(jsonText);
    return [
      {
        type: "structured_output",
        jsonText,
        parsed: parsed.ok ? parsed.value : null,
      },
    ];
  }

  usage(): TokenUsage {
    return this.usageValue;
  }

  stopReason(): StopReason {
    return this.sawTool && this.stop === "end_turn" ? "tool_use" : this.stop;
  }

  private sawTool = false;

  private eventsFromPart(value: unknown): StreamEvent[] {
    const part = asRecord(value);
    if (!part) return [];
    const events: StreamEvent[] = [];
    const signature = asString(part.thoughtSignature);
    if (signature) {
      events.push({
        type: "thought_signature",
        signature,
        canonicalJson: opaqueReplayItem(part).canonicalJson,
      });
    }
    const text = asString(part.text);
    if (text && part.thought === true) {
      events.push({ type: "thinking_block", thinking: text, signature: signature ?? "" });
      return events;
    }
    if (text) {
      this.text.push(text);
      events.push({ type: "text_delta", text });
    }
    const call = asRecord(part.functionCall);
    if (call) {
      this.sawTool = true;
      const name = asString(call.name) ?? "";
      const args = call.args;
      if (typeof args === "string") {
        const parsed = parseToolArguments(args);
        if (!parsed.ok) {
          events.push({
            type: "malformed_tool_args",
            item: malformedToolArgs(name || "call", name, args, parsed.error),
          });
          return events;
        }
        events.push({
          type: "tool_call",
          call: { callId: name || "call", name, arguments: parsed.value, rawArguments: args },
        });
        return events;
      }
      const record = asRecord(args);
      if (!record) {
        const raw = JSON.stringify(args ?? "");
        events.push({
          type: "malformed_tool_args",
          item: malformedToolArgs(
            name || "call",
            name,
            raw,
            "tool arguments must be a JSON object",
          ),
        });
        return events;
      }
      const rawArguments = JSON.stringify(record);
      events.push({
        type: "tool_call",
        call: { callId: name || "call", name, arguments: record, rawArguments },
      });
    }
    return events;
  }
}

function usageFromGemini(usage: Record<string, unknown>): TokenUsage {
  const inputTokens = readIntegerField(usage, "promptTokenCount") ?? 0;
  const outputTokens = readIntegerField(usage, "candidatesTokenCount") ?? 0;
  const cacheReadInputTokens = readIntegerField(usage, "cachedContentTokenCount") ?? 0;
  const reasoningTokens = readIntegerField(usage, "thoughtsTokenCount") ?? 0;
  const totalTokens =
    readIntegerField(usage, "totalTokenCount") ?? inputTokens + outputTokens + reasoningTokens;
  return mergeTokenUsage(emptyTokenUsage(), {
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    reasoningTokens,
    totalTokens,
  });
}

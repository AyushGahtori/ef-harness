import type {
  AdapterCallOptions,
  ModelProfile,
  ModelProtocolAdapter,
  ModelTurnRequest,
  StreamEvent,
} from "@ef-harness/worker-loop";

/**
 * Offline ModelProtocolAdapter. It echoes a deterministic router@1 object through
 * the streaming interface so the router does not call the network.
 */
class OfflineRouterAdapter implements ModelProtocolAdapter {
  readonly protocol = "openai_responses" as const;
  readonly adapterName = "offline-router";

  constructor(private readonly output: unknown) {}

  async *stream(request: ModelTurnRequest, options: AdapterCallOptions): AsyncIterable<StreamEvent> {
    void request;
    void options;
    yield {
      type: "structured_output",
      jsonText: JSON.stringify(this.output),
      parsed: this.output,
    };
    yield { type: "stop", stopReason: "end_turn" };
  }
}

export async function completeOfflineRouter(output: unknown): Promise<unknown> {
  return completeRouterAdapter(new OfflineRouterAdapter(output), output);
}

export async function completeRouterAdapter(adapter: ModelProtocolAdapter, fallback: unknown): Promise<unknown> {
  let parsed = fallback;
  for await (const event of adapter.stream(routerRequest(), {
    baseUrl: "http://127.0.0.1",
    apiKey: "offline",
  })) {
    if (event.type === "structured_output") parsed = event.parsed;
  }
  return parsed;
}

function routerRequest(): ModelTurnRequest {
  const profile: ModelProfile = {
    id: "router@1",
    provider: "offline",
    family: "offline",
    contextWindow: 1,
    maxOutputTokens: 1,
    editFormat: "apply_patch",
    supportsParallelToolCalls: false,
    supportsReasoningReplay: false,
    supportsStreamingToolArgs: false,
    toolCallReliabilityTier: "unmeasured",
    supportsPromptCaching: false,
    supportsToolCalling: false,
    smallContext: true,
    routeConstraints: {
      protocol: "openai_responses",
      allowedRoutes: ["ollama"],
      requiresStoreFalse: true,
      requiresStreamTrue: false,
      omitPreviousResponseId: true,
      omitMaxOutputTokens: true,
      omitTemperature: true,
      functionToolsOnly: true,
      hostedToolsForbidden: true,
    },
  };
  return {
    model: "router@1",
    profile,
    route: "ollama",
    prefix: { zone1: "router@1", zone2: "" },
    messages: [{ role: "user", text: "router@1" }],
    tools: [],
    replayItems: [],
    reservedOutputTokens: 1,
    clientRequestId: "router@1",
    idempotencyKey: "router@1",
  };
}

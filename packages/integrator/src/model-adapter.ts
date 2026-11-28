import type {
  AdapterCallOptions,
  ModelProfile,
  ModelProtocolAdapter,
  ModelTurnRequest,
  StreamEvent,
} from "@ef-harness/worker-loop";

/**
 * Offline ModelProtocolAdapter. It echoes a deterministic object through the
 * streaming interface so project-integrator@1 and ccr@1 do not call the network.
 */
class OfflineContractAdapter implements ModelProtocolAdapter {
  readonly protocol = "openai_responses" as const;
  readonly adapterName = "offline-contract";

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

export async function completeOffline(contractId: string, output: unknown): Promise<unknown> {
  const adapter = new OfflineContractAdapter(output);
  let parsed = output;
  for await (const event of adapter.stream(offlineRequest(contractId), {
    baseUrl: "http://127.0.0.1",
    apiKey: "offline",
  })) {
    if (event.type === "structured_output") parsed = event.parsed;
  }
  return parsed;
}

function offlineRequest(contractId: string): ModelTurnRequest {
  const profile: ModelProfile = {
    id: contractId,
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
    model: contractId,
    profile,
    route: "ollama",
    prefix: { zone1: contractId, zone2: "" },
    messages: [{ role: "user", text: contractId }],
    tools: [],
    replayItems: [],
    reservedOutputTokens: 1,
    clientRequestId: contractId,
    idempotencyKey: contractId,
  };
}

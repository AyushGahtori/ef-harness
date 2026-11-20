import type {
  ModelCompletionRequest,
  ModelCompletionResult,
  ModelFamilyProfile,
  ModelProtocolAdapter,
  ModelStopReason,
} from "./ports.js";

export type StubResponseKind =
  | "valid"
  | "malformed_json"
  | "empty"
  | "rate_limited"
  | "timeout"
  | "over_budget"
  | "unavailable";

export interface StubStep {
  readonly kind: StubResponseKind;
  readonly text?: string;
  readonly json?: unknown;
  readonly costMicros?: number;
  readonly latencyMs?: number;
}

export class StubModel implements ModelProtocolAdapter {
  readonly calls: ModelCompletionRequest[] = [];
  private index = 0;

  constructor(
    readonly profile: ModelFamilyProfile,
    private readonly steps: readonly StubStep[],
  ) {
    if (steps.length === 0) {
      throw new Error("stub model requires at least one scripted response");
    }
  }

  async complete(request: ModelCompletionRequest): Promise<ModelCompletionResult> {
    this.calls.push(request);
    const step = this.steps[Math.min(this.index, this.steps.length - 1)];
    if (this.index < this.steps.length) this.index += 1;
    if (!step) {
      throw new Error("stub model step is missing");
    }
    const text = textFor(step);
    return {
      text,
      inputTokens: Math.max(1, request.prompt.length),
      outputTokens: text.length,
      costMicros: step.costMicros ?? 0,
      stopReason: stopReasonFor(step.kind),
      latencyMs: step.latencyMs ?? 0,
    };
  }
}

function textFor(step: StubStep): string {
  if (step.kind === "valid") return JSON.stringify(step.json ?? {});
  if (step.kind === "empty") return "";
  if (step.kind === "malformed_json") return step.text ?? "{";
  return step.text ?? "";
}

function stopReasonFor(kind: StubResponseKind): ModelStopReason {
  if (kind === "valid" || kind === "malformed_json" || kind === "empty") return "stop";
  return kind;
}

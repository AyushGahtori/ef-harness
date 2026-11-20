import type { ModelCompletionRequest, ModelCompletionResult, ModelFamilyProfile, ModelProtocolAdapter } from "./ports.js";

export class FakeModelAdapter implements ModelProtocolAdapter {
  readonly calls: ModelCompletionRequest[] = [];

  constructor(
    readonly profile: ModelFamilyProfile,
    private readonly respond: (
      request: ModelCompletionRequest,
      callIndex: number,
    ) => ModelCompletionResult | Promise<ModelCompletionResult>,
  ) {}

  async complete(request: ModelCompletionRequest): Promise<ModelCompletionResult> {
    const callIndex = this.calls.length;
    this.calls.push(request);
    return this.respond(request, callIndex);
  }
}

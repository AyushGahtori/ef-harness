import type { FakeModelAdapter, FakeModelScript, ModelCallInput, ModelCallResult } from "./types.js";

export class DeterministicFakeModelAdapter implements FakeModelAdapter {
  private count = 0;
  constructor(private readonly scripts: readonly FakeModelScript[] = []) {}

  get callCount(): number {
    return this.count;
  }

  async complete(input: ModelCallInput): Promise<ModelCallResult> {
    this.count += 1;
    const haystack = `${input.systemPrompt}\n${input.messagesJson}`;
    const matching = this.scripts.filter(
      (script) => !script.match?.includes || haystack.includes(script.match.includes),
    );
    const script = matching[(this.count - 1) % Math.max(matching.length, 1)];
    const content =
      script?.response ??
      `reply-${this.count}`;
    return {
      content,
      inputTokens: script?.inputTokens ?? 12,
      outputTokens: script?.outputTokens ?? 8,
      fromCache: false,
      costUsd: 0.0001,
      latencyMs: 2,
    };
  }
}
export interface ToolLessCompletionRequest {
  readonly contractId: "issue-triage@1";
  readonly prompt: string;
  readonly tools: readonly [];
}

export interface ToolLessCompletion {
  readonly text: string;
  readonly tools: readonly [];
}

/**
 * Local port of Task 034 `FakeModelAdapter` for tool-less issue triage.
 * Scripted text is returned as data. Nothing in the prompt is executed.
 */
export class FakeModelAdapter {
  readonly requests: ToolLessCompletionRequest[] = [];
  private index = 0;

  constructor(private readonly script: readonly string[]) {}

  complete(request: ToolLessCompletionRequest): ToolLessCompletion {
    if (request.contractId !== "issue-triage@1" || request.tools.length > 0) {
      throw new Error("issue-triage@1 accepts no tools");
    }
    this.requests.push(request);
    const text = this.script[this.index] ?? "";
    this.index += 1;
    return { text, tools: [] };
  }
}

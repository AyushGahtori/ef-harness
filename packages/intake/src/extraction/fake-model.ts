export interface ExtractorModelRequest {
  readonly role: "intake-extractor@1";
  readonly promptId: "intake-extractor@1";
  readonly tools: readonly [];
  readonly prompt: string;
}

export interface ExtractorModel {
  complete(request: ExtractorModelRequest): { readonly text: string };
}

/** Offline scripted model. `intake-extractor@1` is rejected if any tool is attached. */
export class FakeModelAdapter implements ExtractorModel {
  readonly calls: ExtractorModelRequest[] = [];

  constructor(private readonly script: (request: ExtractorModelRequest) => string) {}

  complete(request: ExtractorModelRequest): { text: string } {
    if (request.role !== "intake-extractor@1" || request.promptId !== "intake-extractor@1") {
      throw new Error("FakeModelAdapter only completes intake-extractor@1.");
    }
    if (request.tools.length !== 0) {
      throw new Error("intake-extractor@1 is tool-less.");
    }
    this.calls.push(request);
    return { text: this.script(request) };
  }
}

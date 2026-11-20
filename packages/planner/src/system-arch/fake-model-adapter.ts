import type { ArchitectModelPort, ArchitectModelRequest } from "./types.js";

/**
 * Local port of Task 034 `FakeModelAdapter`.
 * Scripted text completions stand in for `ModelCompletion.text`.
 */
export class FakeModelAdapter implements ArchitectModelPort {
  private index = 0;
  readonly calls: ArchitectModelRequest[] = [];

  constructor(private readonly script: readonly string[]) {}

  complete(request: ArchitectModelRequest): string {
    this.calls.push(request);
    const next = this.script[this.index];
    this.index += 1;
    if (next === undefined) {
      throw new Error("FakeModelAdapter script exhausted");
    }
    return next;
  }
}

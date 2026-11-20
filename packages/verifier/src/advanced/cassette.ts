import { ReplayCassetteStaleError } from "./errors.js";

export class ReplayCassette {
  private readonly entries = new Map<string, string>();

  record(inputHash: string, body: string): void {
    this.entries.set(inputHash, body);
  }

  replay(inputHash: string): string {
    const body = this.entries.get(inputHash);
    if (body === undefined) {
      throw new ReplayCassetteStaleError(inputHash);
    }
    return body;
  }

  get size(): number {
    return this.entries.size;
  }
}

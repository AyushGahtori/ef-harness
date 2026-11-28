import { MAX_RENDERER_HEAP_BYTES } from "./constants.js";
import { InspectorMemoryCeilingError } from "./errors.js";

/** Counts retained heavy payloads. Off-screen chunks are released, not kept. */
export class ResidentLedger {
  private readonly held = new Map<string, number>();

  retain(key: string, bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new InspectorMemoryCeilingError(bytes, MAX_RENDERER_HEAP_BYTES);
    }
    const next = this.totalExcept(key) + bytes;
    if (next > MAX_RENDERER_HEAP_BYTES) {
      throw new InspectorMemoryCeilingError(next, MAX_RENDERER_HEAP_BYTES);
    }
    this.held.set(key, bytes);
  }

  release(key: string): void {
    this.held.delete(key);
  }

  releasePrefix(prefix: string): void {
    for (const key of [...this.held.keys()]) {
      if (key.startsWith(prefix)) this.held.delete(key);
    }
  }

  releaseAll(): void {
    this.held.clear();
  }

  total(): number {
    let sum = 0;
    for (const bytes of this.held.values()) sum += bytes;
    return sum;
  }

  private totalExcept(skip: string): number {
    let sum = 0;
    for (const [key, bytes] of this.held) {
      if (key !== skip) sum += bytes;
    }
    return sum;
  }
}

export function utf8Size(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

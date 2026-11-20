import { sha256 } from "./hash.js";
import type { CasObject, ContentAddressedStore } from "./ports.js";

export class MemoryContentStore implements ContentAddressedStore {
  private readonly objects = new Map<string, Buffer>();

  put(body: Buffer, mime: string): CasObject {
    const casId = sha256(body);
    this.objects.set(casId, Buffer.from(body));
    return { casId, mime, bytes: body.byteLength };
  }

  get(casId: string): Buffer | undefined {
    const found = this.objects.get(casId);
    return found ? Buffer.from(found) : undefined;
  }
}

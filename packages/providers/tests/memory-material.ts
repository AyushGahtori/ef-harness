import type { VaultMaterialStore } from "../src/api-keys/local-dpapi-vault.js";

/** In-process stand-in for the Windows credential primitive. Production vault construction does not use it. */
export class MemoryMaterialStore implements VaultMaterialStore {
  private readonly blobs = new Map<string, Buffer>();

  async protectAndWrite(target: string, plaintext: Buffer, overflowPath: string): Promise<void> {
    void overflowPath;
    this.blobs.set(target, Buffer.from(plaintext));
  }

  async readAndUnprotect(target: string): Promise<Buffer | null> {
    const value = this.blobs.get(target);
    return value ? Buffer.from(value) : null;
  }

  async deleteMaterial(target: string, overflowPath: string): Promise<void> {
    void overflowPath;
    this.blobs.delete(target);
  }

  async replaceStoredCiphertext(target: string, ciphertext: Buffer, overflowPath: string): Promise<void> {
    void overflowPath;
    this.blobs.set(target, Buffer.from(ciphertext));
  }

  async close(): Promise<void> {
    return undefined;
  }
}

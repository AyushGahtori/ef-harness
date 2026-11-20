import fs from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { CHUNK_BYTES } from "./constants.js";
import { CasBlobMissingError } from "./errors.js";
import type { ArtifactDescriptor, BlobReadHandle, ByteRange, CasBlobSource } from "./ports.js";

/** Reads an on-disk artifact in bounded chunks and tracks open file handles. */
export class FileBlobSource implements CasBlobSource {
  openHandles = 0;
  reads = 0;

  constructor(private readonly locate: (descriptor: ArtifactDescriptor) => string) {}

  async open(descriptor: ArtifactDescriptor, range?: ByteRange): Promise<BlobReadHandle> {
    const filePath = this.locate(descriptor);
    let handle: FileHandle;
    try {
      handle = await fs.promises.open(filePath, "r");
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (code === "ENOENT" || code === "ENOTDIR") {
        throw new CasBlobMissingError(descriptor.casHash ?? descriptor.sha256);
      }
      throw error;
    }
    this.openHandles += 1;
    const start = range?.offset ?? 0;
    const end = range ? range.offset + range.length : descriptor.totalBytes;
    let position = start;
    let closed = false;
    return {
      read: async (maxBytes: number): Promise<Uint8Array | null> => {
        if (closed || position >= end) return null;
        const length = Math.min(maxBytes, end - position, CHUNK_BYTES);
        if (length <= 0) return null;
        const buffer = Buffer.allocUnsafe(length);
        const result = await handle.read(buffer, 0, length, position);
        this.reads += 1;
        if (result.bytesRead <= 0) return null;
        position += result.bytesRead;
        if (result.bytesRead === length) return buffer;
        return buffer.subarray(0, result.bytesRead);
      },
      close: async (): Promise<void> => {
        if (closed) return;
        closed = true;
        this.openHandles -= 1;
        await handle.close();
      },
    };
  }
}

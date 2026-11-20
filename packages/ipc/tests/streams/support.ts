import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CHUNK_BYTES } from "../../src/streams/constants.js";
import { CasBlobMissingError } from "../../src/streams/errors.js";
import type { ArtifactByteSource, ArtifactDescriptor } from "../../src/streams/ports.js";

export function fillPattern(target: Buffer, fileOffset: number, length: number): void {
  for (let index = 0; index < length; index += 1) {
    target[index] = (fileOffset + index) & 0xff;
  }
}

export function patternHash(total: number): string {
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(CHUNK_BYTES);
  let offset = 0;
  while (offset < total) {
    const length = Math.min(CHUNK_BYTES, total - offset);
    fillPattern(buffer, offset, length);
    hash.update(buffer.subarray(0, length));
    offset += length;
  }
  return hash.digest("hex");
}

export async function makeTempDir(): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), "efh-033-"));
}

export async function writePatternFile(filePath: string, total: number): Promise<void> {
  const handle = await fs.promises.open(filePath, "w");
  try {
    const buffer = Buffer.alloc(CHUNK_BYTES);
    let offset = 0;
    while (offset < total) {
      const length = Math.min(CHUNK_BYTES, total - offset);
      fillPattern(buffer, offset, length);
      await handle.write(buffer.subarray(0, length));
      offset += length;
    }
  } finally {
    await handle.close();
  }
}

export function descriptor(
  partial: Pick<ArtifactDescriptor, "id" | "projectId" | "totalBytes" | "sha256"> &
    Partial<ArtifactDescriptor>,
): ArtifactDescriptor {
  return {
    retention: "evidence",
    mime: "application/octet-stream",
    format: "raw",
    ...partial,
  };
}

/** Generates a deterministic artifact without retaining the whole blob. */
export class PatternSource implements ArtifactByteSource {
  closed = false;
  handles = 1;
  reads = 0;
  maxRead = 0;

  constructor(readonly total: number) {}

  read(offset: number, length: number): Uint8Array {
    if (this.closed) throw new CasBlobMissingError("pattern");
    if (offset < 0 || length < 0 || offset + length > this.total) {
      throw new CasBlobMissingError("pattern");
    }
    this.reads += 1;
    if (length > this.maxRead) this.maxRead = length;
    const out = Buffer.alloc(length);
    fillPattern(out, offset, length);
    return out;
  }

  close(): void {
    this.closed = true;
    this.handles = 0;
  }
}

export async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (predicate()) return;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`condition was not met within ${String(timeoutMs)}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

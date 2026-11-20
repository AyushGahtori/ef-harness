import { createHash } from "node:crypto";
import fs from "node:fs";
import { createZstdDecompress, type ZstdDecompress } from "node:zlib";
import { CHUNK_BYTES } from "./constants.js";
import { CasBlobMissingError, CasIntegrityMismatchError, InvalidStreamRequestError } from "./errors.js";
import type { ArtifactByteSource, ArtifactDescriptor, ArtifactRetention, ByteRange } from "./ports.js";

const VERIFIED_RETENTION = new Set<ArtifactRetention>(["evidence", "asset"]);

export function retentionRequiresFullHash(retention: ArtifactRetention): boolean {
  return VERIFIED_RETENTION.has(retention);
}

/** SHA-256 the file in 64 KB steps and keep none of it. */
export function hashFile(filePath: string): string {
  const hash = createHash("sha256");
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(CHUNK_BYTES);
    let offset = 0;
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, offset);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
      offset += read;
    }
  } catch (error) {
    if (isNotFound(error)) throw new CasBlobMissingError(filePath);
    throw error;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
  return hash.digest("hex");
}

/** SHA-256 of the uncompressed bytes. The decoder is drained so it cannot stall on backpressure. */
export async function hashDecompressed(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const source = fs.createReadStream(filePath);
  const decoder = source.pipe(createZstdDecompress());
  try {
    for await (const chunk of decoder) {
      hash.update(chunk);
    }
  } catch (error) {
    source.destroy();
    decoder.destroy();
    if (isNotFound(error)) throw new CasBlobMissingError(filePath);
    throw new CasIntegrityMismatchError(filePath, error instanceof Error ? error.message : "zstd decode failed");
  }
  return hash.digest("hex");
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export class FileByteSource implements ArtifactByteSource {
  private fd: number | null;
  private decoder: ZstdDecompress | null = null;
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private filePos = 0;
  private readonly fileSize: number;
  private inputEnded = false;
  private outputEnded = false;
  private failed: Error | null = null;
  private closedFlag = false;
  private readonly waiters: Array<() => void> = [];
  private readonly logicalLength: number;

  private constructor(
    filePath: string,
    private readonly format: "raw" | "zstd",
    private readonly rangeOffset: number,
    logicalLength: number,
    private readonly hashLabel: string,
  ) {
    try {
      this.fd = fs.openSync(filePath, "r");
    } catch (error) {
      if (isNotFound(error)) throw new CasBlobMissingError(hashLabel);
      throw error;
    }
    this.fileSize = fs.fstatSync(this.fd).size;
    this.logicalLength = logicalLength;
    if (format === "zstd") {
      this.decoder = createZstdDecompress();
      this.decoder.on("data", (chunk: Buffer) => {
        this.pending.push(chunk);
        this.pendingBytes += chunk.byteLength;
        if (this.pendingBytes > CHUNK_BYTES * 4) this.decoder?.pause();
        this.wake();
      });
      this.decoder.on("end", () => {
        this.outputEnded = true;
        this.wake();
      });
      this.decoder.on("error", (error: Error) => {
        this.failed = new CasIntegrityMismatchError(this.hashLabel, error.message);
        this.wake();
      });
      this.decoder.on("drain", () => this.wake());
    }
  }

  static open(
    filePath: string,
    descriptor: ArtifactDescriptor,
    range: ByteRange | undefined,
  ): FileByteSource {
    if (descriptor.format === "zstd-seekable") {
      throw new InvalidStreamRequestError("seekable logs are fetched with log.range, not artifact.open");
    }
    const offset = range?.offset ?? 0;
    const length = range?.length ?? descriptor.totalBytes;
    if (descriptor.format === "zstd" && offset !== 0) {
      throw new InvalidStreamRequestError("compressed artifact ranges must start at byte 0");
    }
    return new FileByteSource(filePath, descriptor.format, offset, length, descriptor.sha256);
  }

  get closed(): boolean {
    return this.closedFlag;
  }

  get handles(): number {
    const fd = this.fd === null ? 0 : 1;
    const decoder = this.decoder !== null && !this.closedFlag ? 1 : 0;
    return fd + decoder;
  }

  read(offset: number, length: number): Uint8Array | Promise<Uint8Array> {
    if (this.closedFlag) throw new CasBlobMissingError(this.hashLabel);
    if (this.format === "raw") return this.readRaw(offset, length);
    return this.readZstd(offset, length);
  }

  close(): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    if (this.decoder) {
      this.decoder.removeAllListeners();
      this.decoder.destroy();
      this.decoder = null;
    }
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
    this.pending = [];
    this.pendingBytes = 0;
    this.wake();
  }

  private readRaw(offset: number, length: number): Uint8Array {
    if (this.fd === null) throw new CasBlobMissingError(this.hashLabel);
    const position = this.rangeOffset + offset;
    if (position + length > this.fileSize && offset + length > this.logicalLength) {
      throw new CasBlobMissingError(this.hashLabel);
    }
    const buffer = Buffer.alloc(length);
    let got = 0;
    while (got < length) {
      const read = fs.readSync(this.fd, buffer, got, length - got, position + got);
      if (read === 0) break;
      got += read;
    }
    if (got !== length) throw new CasBlobMissingError(this.hashLabel);
    return buffer;
  }

  private async readZstd(offset: number, length: number): Promise<Uint8Array> {
    if (offset !== this.produced) {
      throw new CasIntegrityMismatchError(this.hashLabel, "zstd artifact reads are sequential");
    }
    while (this.pendingBytes < length && !this.outputEnded && !this.failed && !this.closedFlag) {
      if (!this.inputEnded && this.fd !== null && this.decoder !== null) {
        const before = this.pendingBytes;
        const accepted = this.feedCompressed();
        if (this.pendingBytes >= length || this.failed || this.closedFlag || this.outputEnded) break;
        if (accepted && (this.pendingBytes > before || !this.inputEnded)) continue;
      }
      if (this.pendingBytes >= length || this.outputEnded || this.failed || this.closedFlag) break;
      await this.nextWake();
    }
    if (this.failed) throw this.failed;
    if (this.closedFlag) throw new CasBlobMissingError(this.hashLabel);
    if (this.pendingBytes < length) throw new CasBlobMissingError(this.hashLabel);
    const out = Buffer.alloc(length);
    let filled = 0;
    while (filled < length) {
      const next = this.pending[0];
      if (!next) break;
      const take = Math.min(next.byteLength, length - filled);
      out.set(next.subarray(0, take), filled);
      filled += take;
      if (take === next.byteLength) this.pending.shift();
      else this.pending[0] = next.subarray(take);
    }
    this.pendingBytes -= filled;
    this.produced += filled;
    if (this.decoder?.isPaused()) this.decoder.resume();
    return out;
  }

  private produced = 0;

  private feedCompressed(): boolean {
    if (this.inputEnded || this.fd === null || this.decoder === null) return false;
    const buffer = Buffer.alloc(CHUNK_BYTES);
    const read = fs.readSync(this.fd, buffer, 0, buffer.length, this.filePos);
    if (read === 0) {
      this.inputEnded = true;
      this.decoder.end();
      return false;
    }
    this.filePos += read;
    return this.decoder.write(buffer.subarray(0, read));
  }

  private nextWake(): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private wake(): void {
    const pending = this.waiters.splice(0);
    for (const resolve of pending) resolve();
  }
}

interface RegisteredFile {
  readonly descriptor: ArtifactDescriptor;
  readonly filePath: string;
}

/** File-backed catalog used by the daemon and by pipe tests. */
export class FileArtifactCatalog {
  private readonly records = new Map<string, RegisteredFile>();

  register(descriptor: ArtifactDescriptor, filePath: string): void {
    this.records.set(descriptor.id, { descriptor, filePath });
  }

  lookup(projectId: string, artifactId: string): ArtifactDescriptor | null {
    const row = this.records.get(artifactId);
    if (!row || row.descriptor.projectId !== projectId) return null;
    return row.descriptor;
  }

  async verifyIntegrity(descriptor: ArtifactDescriptor): Promise<void> {
    const row = this.records.get(descriptor.id);
    if (!row || row.descriptor.projectId !== descriptor.projectId) {
      throw new CasBlobMissingError(descriptor.sha256);
    }
    let actual: string;
    try {
      actual = descriptor.format === "raw" ? hashFile(row.filePath) : await hashDecompressed(row.filePath);
    } catch (error) {
      if (isNotFound(error) || error instanceof CasBlobMissingError) {
        throw new CasBlobMissingError(descriptor.sha256);
      }
      throw error;
    }
    if (actual !== descriptor.sha256) {
      throw new CasIntegrityMismatchError({
        hash: descriptor.sha256,
        actualHash: actual,
        retention: descriptor.retention,
        reason: `uncompressed SHA-256 mismatch for ${descriptor.id}`,
      });
    }
  }

  open(descriptor: ArtifactDescriptor, range: ByteRange | undefined): FileByteSource {
    const row = this.records.get(descriptor.id);
    if (!row || row.descriptor.projectId !== descriptor.projectId) {
      throw new CasBlobMissingError(descriptor.sha256);
    }
    return FileByteSource.open(row.filePath, descriptor, range);
  }
}

import { describe, expect, it } from "vitest";
import { BinaryStreamManager } from "../../src/streams/binary-stream-manager.js";
import { CHUNK_BYTES, EMPTY_SHA256 } from "../../src/streams/constants.js";
import {
  ArtifactNotFoundError,
  InvalidCreditError,
  InvalidStreamRequestError,
} from "../../src/streams/errors.js";
import { binaryStreamId, encodeBinaryFrame, encodeJsonFrame } from "../../src/streams/frame.js";
import { encodeJsonPayload } from "../../src/streams/json-guard.js";
import type { ArtifactCatalog, ArtifactDescriptor, StreamOutput } from "../../src/streams/ports.js";
import { PriorityWriter } from "../../src/streams/priority-writer.js";
import { PatternSource, descriptor, patternHash, waitFor } from "./support.js";

const FIFTY_MB = 50 * 1024 * 1024;

function catalogFor(entries: readonly ArtifactDescriptor[], openSource?: (id: string) => PatternSource): ArtifactCatalog {
  return {
    lookup(projectId, artifactId) {
      const found = entries.find((entry) => entry.id === artifactId);
      if (!found || found.projectId !== projectId) return null;
      return found;
    },
    open(entry) {
      return openSource ? openSource(entry.id) : new PatternSource(entry.totalBytes);
    },
  };
}

describe("credit window and channel priority", () => {
  it("keeps a 50 MB stream inside the credit window and hashes every byte", async () => {
    const source = new PatternSource(FIFTY_MB);
    const artifact = descriptor({
      id: "trace",
      projectId: "proj-a",
      totalBytes: FIFTY_MB,
      sha256: "unchecked",
      retention: "diagnostic",
    });
    let ended: { bytesSent?: number; sha256?: string } | null = null;
    const manager = new BinaryStreamManager({
      projectId: "proj-a",
      catalog: catalogFor([artifact], () => source),
      output: {
        enqueue(frame, lane) {
          if (lane === "binary" || frame[4] === 1) {
            expect(frame[4]).toBe(1);
            expect(frame.byteLength - 9).toBeLessThanOrEqual(CHUNK_BYTES);
            const streamId = binaryStreamId(frame);
            manager.noteBinarySent(frame);
            if (streamId !== null) manager.grantCredit(streamId, 1);
            return;
          }
          const parsed = JSON.parse(Buffer.from(frame.subarray(5)).toString("utf8")) as {
            method?: string;
            params?: { streamId?: number; bytesSent?: number; sha256?: string };
          };
          if (parsed.method === "stream.end") ended = parsed.params ?? null;
        },
        dropBinaryStream() {},
      },
      initialCredits: 4,
    });
    const opened = await manager.prepare({ id: "trace" });
    expect(opened.chunkBytes).toBe(65536);
    expect(opened.initialCredits).toBe(4);
    manager.kick();
    await manager.whenIdle();
    expect(ended).toEqual({
      streamId: opened.streamId,
      bytesSent: FIFTY_MB,
      sha256: patternHash(FIFTY_MB),
    });
    expect(manager.maxStreamBufferedPayloadBytes).toBeLessThanOrEqual(4 * CHUNK_BYTES);
    expect(manager.maxBufferedPayloadBytes).toBeLessThanOrEqual(4 * CHUNK_BYTES);
    expect(source.maxRead).toBeLessThanOrEqual(CHUNK_BYTES);
    expect(source.reads).toBe(FIFTY_MB / CHUNK_BYTES);
    expect(manager.openStreamCount).toBe(0);
    expect(source.handles).toBe(0);
  });

  it("round-robins chunks and refuses credits outside 1..256 or above 512 outstanding", async () => {
    const artifact = (id: string): ArtifactDescriptor =>
      descriptor({
        id,
        projectId: "proj-a",
        totalBytes: 1024 * 1024,
        sha256: "unchecked",
        retention: "diagnostic",
      });
    const sources = new Map<string, PatternSource>();
    const queued: number[] = [];
    const output: StreamOutput = {
      enqueue(frame, lane) {
        if (lane !== "binary") return;
        const streamId = binaryStreamId(frame);
        if (streamId !== null) queued.push(streamId);
      },
      dropBinaryStream() {},
    };
    const manager = new BinaryStreamManager({
      projectId: "proj-a",
      catalog: catalogFor([artifact("a"), artifact("b")], (id) => {
        const source = new PatternSource(1024 * 1024);
        sources.set(id, source);
        return source;
      }),
      output,
      initialCredits: 4,
    });
    const first = await manager.prepare({ id: "a" });
    const second = await manager.prepare({ id: "b" });
    manager.kick();
    await manager.whenIdle();
    expect(queued).toEqual([
      first.streamId,
      second.streamId,
      first.streamId,
      second.streamId,
      first.streamId,
      second.streamId,
      first.streamId,
      second.streamId,
    ]);
    expect(sources.get("a")?.reads).toBe(4);
    expect(sources.get("b")?.reads).toBe(4);
    expect(manager.maxStreamBufferedPayloadBytes).toBeLessThanOrEqual(4 * CHUNK_BYTES);

    manager.grantCredit(first.streamId, 256);
    manager.grantCredit(first.streamId, 252);
    expect(() => manager.grantCredit(first.streamId, 5)).toThrow(InvalidCreditError);
    for (const chunks of [-1, 0, 1.5, 257, 999999, 2 ** 31]) {
      expect(() => manager.grantCredit(second.streamId, chunks)).toThrow(InvalidCreditError);
    }
    expect(manager.grantCredit(999, -1)).toEqual({ applied: false, outstanding: 0 });
    manager.dispose();
    expect(manager.openStreamCount).toBe(0);
    expect(manager.openHandleCount).toBe(0);
    expect(sources.get("a")?.handles).toBe(0);
    expect(sources.get("b")?.handles).toBe(0);
  });

  it("flushes build.stop ahead of queued channel 1 chunks", async () => {
    const written: string[] = [];
    const writer = new PriorityWriter((frame) => {
      written.push(frame[4] === 1 ? "binary" : "control");
      return Promise.resolve();
    });
    writer.pauseBinary();
    writer.enqueue(encodeBinaryFrame(1, Buffer.from("a")), "binary");
    writer.enqueue(encodeBinaryFrame(2, Buffer.from("b")), "binary");
    writer.enqueue(
      encodeJsonFrame(encodeJsonPayload({ jsonrpc: "2.0", method: "build.stop", params: {} })),
      "control",
    );
    await waitFor(() => written.length === 1, 200);
    expect(written).toEqual(["control"]);
    writer.resumeBinary();
    await waitFor(() => written.length === 3, 200);
    expect(written).toEqual(["control", "binary", "binary"]);
  });

  it("hides artifacts from another project and completes a zero-byte artifact without credits", async () => {
    const foreign = descriptor({
      id: "foreign",
      projectId: "proj-b",
      totalBytes: 10,
      sha256: EMPTY_SHA256,
    });
    const empty = descriptor({
      id: "empty",
      projectId: "proj-a",
      totalBytes: 0,
      sha256: EMPTY_SHA256,
    });
    const notices: string[] = [];
    const output: StreamOutput = {
      enqueue(frame, lane) {
        if (lane !== "control" || frame[4] !== 0) return;
        notices.push(Buffer.from(frame.subarray(5)).toString("utf8"));
      },
      dropBinaryStream() {},
    };
    const manager = new BinaryStreamManager({
      projectId: "proj-a",
      catalog: {
        lookup(projectId, artifactId) {
          if (artifactId === "foreign") return foreign;
          if (artifactId === "empty" && projectId === "proj-a") return empty;
          return null;
        },
        open() {
          throw new Error("zero-byte artifacts must not open a reader");
        },
      },
      output,
      initialCredits: 8,
    });
    await expect(manager.prepare({ id: "foreign" })).rejects.toBeInstanceOf(ArtifactNotFoundError);
    await expect(manager.prepare({ id: "missing" })).rejects.toBeInstanceOf(ArtifactNotFoundError);
    await expect(manager.prepare({ id: "empty", projectId: "proj-b" })).rejects.toBeInstanceOf(
      ArtifactNotFoundError,
    );
    const opened = await manager.prepare({ id: "empty" });
    expect(opened).toMatchObject({ totalBytes: 0, initialCredits: 0, empty: true, sha256: EMPTY_SHA256 });
    manager.completeEmpty(opened.streamId);
    expect(notices.join("\n")).toContain('"bytesSent":0');
    expect(notices.join("\n")).toContain(EMPTY_SHA256);
    expect(manager.openHandleCount).toBe(0);
    await expect(manager.prepare({ id: "seek", projectId: "proj-a" })).rejects.toBeInstanceOf(
      ArtifactNotFoundError,
    );
    const seekable = descriptor({
      id: "seek",
      projectId: "proj-a",
      totalBytes: 10,
      sha256: EMPTY_SHA256,
      format: "zstd-seekable",
    });
    const seekManager = new BinaryStreamManager({
      projectId: "proj-a",
      catalog: catalogFor([seekable]),
      output,
    });
    await expect(seekManager.prepare({ id: "seek" })).rejects.toBeInstanceOf(InvalidStreamRequestError);
  });
});

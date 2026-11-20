import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { zstdCompressSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArtifactStreamClient } from "../../src/streams/artifact-stream-client.js";
import { FileArtifactCatalog, hashFile } from "../../src/streams/byte-source.js";
import { CHUNK_BYTES, EMPTY_SHA256, JSON_RPC_MAX_BYTES } from "../../src/streams/constants.js";
import {
  ArtifactNotFoundError,
  CasBlobMissingError,
  CasIntegrityMismatchError,
  InvalidCreditError,
  StreamRemoteError,
} from "../../src/streams/errors.js";
import { StreamFrameCodec, encodeJsonFrame } from "../../src/streams/frame.js";
import { encodeJsonPayload } from "../../src/streams/json-guard.js";
import { ArtifactPipeServer, allocatePipePath } from "../../src/streams/pipe-server.js";
import type {
  ArtifactByteSource,
  ArtifactCatalog,
  ArtifactDescriptor,
  ArtifactLogReader,
  DiffSource,
} from "../../src/streams/ports.js";
import { descriptor, fillPattern, makeTempDir, patternHash, waitFor, writePatternFile } from "./support.js";

const PROJECT = "proj-a";
const TWENTY_FIVE_MB = 25 * 1024 * 1024;
const SMALL = CHUNK_BYTES * 8;

interface Running {
  server: ArtifactPipeServer;
  client: ArtifactStreamClient;
  stop: () => Promise<void>;
}

async function start(
  catalog: ArtifactCatalog,
  extra: {
    initialCredits?: number;
    idleTimeoutMs?: number;
    autoCredit?: boolean;
    retainBytes?: boolean;
    creditWindow?: number;
    recordWrites?: boolean;
    logs?: { reader: ArtifactLogReader; belongsToProject: (artifactId: string) => boolean };
    diffs?: DiffSource;
    onBuildStop?: (params: unknown) => void;
  } = {},
): Promise<Running> {
  const server = new ArtifactPipeServer({
    pipePath: allocatePipePath(),
    projectId: PROJECT,
    catalog,
    initialCredits: extra.initialCredits ?? 4,
    ...(extra.idleTimeoutMs !== undefined ? { idleTimeoutMs: extra.idleTimeoutMs } : {}),
    ...(extra.recordWrites ? { recordWrites: true } : {}),
    ...(extra.logs ? { logs: extra.logs } : {}),
    ...(extra.diffs ? { diffs: extra.diffs } : {}),
    ...(extra.onBuildStop ? { onBuildStop: extra.onBuildStop } : {}),
  });
  await server.listen();
  const client = new ArtifactStreamClient({
    pipePath: server.pipePath,
    creditWindow: extra.creditWindow ?? extra.initialCredits ?? 4,
    autoCredit: extra.autoCredit ?? true,
    retainBytes: extra.retainBytes ?? false,
  });
  await client.connect();
  return {
    server,
    client,
    async stop() {
      client.close();
      await server.close();
    },
  };
}

describe("named-pipe artifact streaming", () => {
  let dir = "";
  let file25 = "";
  let fileSmall = "";
  let hash25 = "";

  beforeAll(async () => {
    dir = await makeTempDir();
    file25 = path.join(dir, "trace-25.bin");
    fileSmall = path.join(dir, "small.bin");
    await writePatternFile(file25, TWENTY_FIVE_MB);
    await writePatternFile(fileSmall, SMALL);
    hash25 = hashFile(file25);
    expect(hash25).toBe(patternHash(TWENTY_FIVE_MB));
  }, 60_000);

  afterAll(async () => {
    if (dir) await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it("streams 25 MB over a Windows named pipe inside a 4-chunk credit window", async () => {
    const catalog = new FileArtifactCatalog();
    catalog.register(
      descriptor({
        id: "trace",
        projectId: PROJECT,
        totalBytes: TWENTY_FIVE_MB,
        sha256: hash25,
        mime: "application/octet-stream",
      }),
      file25,
    );
    const running = await start(catalog, { initialCredits: 4, creditWindow: 4 });
    try {
      expect(running.server.pipePath.startsWith("\\\\.\\pipe\\")).toBe(true);
      const opened = await running.client.openArtifact("trace");
      expect(opened).toMatchObject({
        totalBytes: TWENTY_FIVE_MB,
        chunkBytes: 65536,
        initialCredits: 4,
        mime: "application/octet-stream",
      });
      const download = await running.client.readStream(opened.streamId);
      expect(download.complete).toBe(true);
      expect(download.byteLength).toBe(TWENTY_FIVE_MB);
      expect(download.sha256).toBe(hash25);
      expect(download.bytesSent).toBe(TWENTY_FIVE_MB);
      expect(download.maxChunk).toBeLessThanOrEqual(CHUNK_BYTES);
      expect(download.maxChunk).toBeGreaterThan(0);
      expect(running.server.maxStreamBufferedPayloadBytes).toBeLessThanOrEqual(4 * CHUNK_BYTES);
      expect(running.server.maxBufferedPayloadBytes).toBeLessThanOrEqual(4 * CHUNK_BYTES);
      expect(running.server.openStreamCount).toBe(0);
      expect(running.server.openHandleCount).toBe(0);
    } finally {
      await running.stop();
    }
  }, 60_000);

  it("keeps session.ping, build.stop, and chat.send under 10 ms while 3 streams run", async () => {
    const catalog = new FileArtifactCatalog();
    for (const id of ["s1", "s2", "s3"]) {
      catalog.register(
        descriptor({
          id,
          projectId: PROJECT,
          totalBytes: TWENTY_FIVE_MB,
          sha256: hash25,
          retention: "diagnostic",
        }),
        file25,
      );
    }
    const running = await start(catalog, { initialCredits: 4, creditWindow: 4 });
    try {
      await running.client.ping();
      const opened = [];
      for (const id of ["s1", "s2", "s3"]) opened.push(await running.client.openArtifact(id));
      const downloads = opened.map((item) => running.client.readStream(item.streamId));
      expect(running.server.openStreamCount).toBe(3);
      const samples: number[] = [];
      for (let index = 0; index < 5; index += 1) samples.push(await running.client.ping());
      samples.push(await running.client.buildStop({ reason: "user" }));
      const chatStarted = performance.now();
      await running.client.call("chat.send", { text: "hold" });
      samples.push(performance.now() - chatStarted);
      expect(Math.max(...samples)).toBeLessThan(10);
      const results = await Promise.all(downloads);
      expect(results.every((item) => item.complete && item.sha256 === hash25)).toBe(true);
      expect(running.server.maxStreamBufferedPayloadBytes).toBeLessThanOrEqual(4 * CHUNK_BYTES);
      expect(running.server.buildStopCount).toBe(1);
      expect(running.server.openStreamCount).toBe(0);
      expect(running.server.openHandleCount).toBe(0);
    } finally {
      await running.stop();
    }
  }, 60_000);

  it("lets build.stop pass queued channel 1 chunks and round-robins two streams", async () => {
    const catalog = new FileArtifactCatalog();
    catalog.register(
      descriptor({
        id: "a",
        projectId: PROJECT,
        totalBytes: SMALL,
        sha256: hashFile(fileSmall),
        retention: "diagnostic",
      }),
      fileSmall,
    );
    catalog.register(
      descriptor({
        id: "b",
        projectId: PROJECT,
        totalBytes: SMALL,
        sha256: hashFile(fileSmall),
        retention: "diagnostic",
      }),
      fileSmall,
    );
    const running = await start(catalog, { initialCredits: 4, creditWindow: 4, recordWrites: true });
    try {
      running.server.pauseBinary();
      const first = await running.client.openArtifact("a");
      const second = await running.client.openArtifact("b");
      await running.server.whenIdle();
      expect(running.server.queuedBinaryStreamIds()).toEqual([
        first.streamId,
        second.streamId,
        first.streamId,
        second.streamId,
        first.streamId,
        second.streamId,
        first.streamId,
        second.streamId,
      ]);
      const pending = Promise.all([
        running.client.readStream(first.streamId),
        running.client.readStream(second.streamId),
      ]);
      const stopMs = await running.client.buildStop();
      expect(stopMs).toBeLessThan(10);
      expect(running.server.writeLog.every((entry) => entry.lane === "control")).toBe(true);
      running.server.resumeBinary();
      const downloads = await pending;
      expect(downloads.every((item) => item.complete)).toBe(true);
      expect(running.server.writeLog.some((entry) => entry.lane === "binary")).toBe(true);
    } finally {
      await running.stop();
    }
  }, 30_000);

  it("cleans up disconnect, cancel, zero-byte, missing, corrupt, and invalid credits", async () => {
    const catalog = new FileArtifactCatalog();
    const emptyPath = path.join(dir, "empty.bin");
    await fs.promises.writeFile(emptyPath, Buffer.alloc(0));
    catalog.register(
      descriptor({ id: "empty", projectId: PROJECT, totalBytes: 0, sha256: EMPTY_SHA256 }),
      emptyPath,
    );
    catalog.register(
      descriptor({ id: "gone", projectId: PROJECT, totalBytes: 4, sha256: EMPTY_SHA256 }),
      path.join(dir, "missing.bin"),
    );
    catalog.register(
      descriptor({
        id: "bad-hash",
        projectId: PROJECT,
        totalBytes: SMALL,
        sha256: "ab".repeat(32),
      }),
      fileSmall,
    );
    catalog.register(
      descriptor({
        id: "other-project",
        projectId: "proj-b",
        totalBytes: SMALL,
        sha256: hashFile(fileSmall),
      }),
      fileSmall,
    );
    catalog.register(
      descriptor({
        id: "held",
        projectId: PROJECT,
        totalBytes: TWENTY_FIVE_MB,
        sha256: hash25,
        retention: "diagnostic",
      }),
      file25,
    );
    const running = await start(catalog, { initialCredits: 4, creditWindow: 4 });
    try {
      const empty = await running.client.openArtifact("empty");
      const emptyDownload = await Promise.race([
        running.client.readStream(empty.streamId),
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("zero-byte hung")), 1000)),
      ]);
      expect(emptyDownload).toMatchObject({
        complete: true,
        byteLength: 0,
        bytesSent: 0,
        sha256: EMPTY_SHA256,
      });
      expect(running.server.openHandleCount).toBe(0);

      await expect(running.client.openArtifact("gone")).rejects.toBeInstanceOf(CasBlobMissingError);
      await expect(running.client.openArtifact("bad-hash")).rejects.toBeInstanceOf(CasIntegrityMismatchError);
      await expect(running.client.openArtifact("other-project")).rejects.toBeInstanceOf(ArtifactNotFoundError);
      await expect(running.client.openArtifact("no-such")).rejects.toBeInstanceOf(ArtifactNotFoundError);
      await expect(
        running.client.call("artifact.open", { id: "held", projectId: "proj-b" }),
      ).rejects.toBeInstanceOf(ArtifactNotFoundError);
      expect(await running.client.ping()).toBeLessThan(100);
      expect(running.server.openStreamCount).toBe(0);

      const slice = Buffer.alloc(40);
      fillPattern(slice, 100, 40);
      const ranged = new ArtifactStreamClient({
        pipePath: running.server.pipePath,
        creditWindow: 4,
        retainBytes: true,
      });
      await ranged.connect();
      try {
        const opened = await ranged.openArtifact("held", { offset: 100, length: 40 });
        expect(opened.totalBytes).toBe(40);
        const download = await ranged.readStream(opened.streamId);
        expect(download.byteLength).toBe(40);
        expect(Buffer.from(download.bytes ?? []).equals(slice)).toBe(true);
      } finally {
        ranged.close();
      }

      const held = await running.client.openArtifact("held");
      expect(running.server.openHandleCount).toBeGreaterThan(0);
      const started = Date.now();
      running.client.close();
      await waitFor(
        () => running.server.openHandleCount === 0 && running.server.openStreamCount === 0,
        100,
      );
      expect(Date.now() - started).toBeLessThanOrEqual(100);
      void held;
    } finally {
      await running.stop();
    }
  }, 30_000);

  it("drops late credits and late chunks after stream.close and rejects -1, 999999, and 2^31", async () => {
    const catalog = new FileArtifactCatalog();
    catalog.register(
      descriptor({
        id: "held",
        projectId: PROJECT,
        totalBytes: TWENTY_FIVE_MB,
        sha256: hash25,
        retention: "diagnostic",
      }),
      file25,
    );
    const running = await start(catalog, { initialCredits: 0, creditWindow: 4, autoCredit: false });
    try {
      const opened = await running.client.openArtifact("held");
      expect(running.server.openHandleCount).toBe(1);
      await expect(running.client.call("stream.credit", { streamId: opened.streamId, chunks: -1 })).rejects.toBeInstanceOf(
        InvalidCreditError,
      );
      await expect(
        running.client.call("stream.credit", { streamId: opened.streamId, chunks: 999999 }),
      ).rejects.toBeInstanceOf(InvalidCreditError);
      await expect(
        running.client.call("stream.credit", { streamId: opened.streamId, chunks: 2 ** 31 }),
      ).rejects.toBeInstanceOf(InvalidCreditError);
      expect(running.server.openHandleCount).toBe(1);
      expect(running.server.openStreamCount).toBe(1);
      await running.client.closeStream(opened.streamId);
      expect(running.server.openHandleCount).toBe(0);
      expect(running.server.openStreamCount).toBe(0);
      running.server.emitLateBinary(opened.streamId, Buffer.from("late"));
      await expect(
        running.client.call("stream.credit", { streamId: opened.streamId, chunks: -1 }),
      ).resolves.toEqual({ applied: false, outstanding: 0 });
      expect(await running.client.ping()).toBeLessThan(100);
    } finally {
      await running.stop();
    }
  }, 20_000);

  it("releases an idle stream and reports a missing or corrupt blob without closing the pipe", async () => {
    const flaky = (error: Error): ArtifactByteSource => {
      let reads = 0;
      let closed = false;
      return {
        get closed() {
          return closed;
        },
        handles: 1,
        read(_offset: number, length: number) {
          reads += 1;
          if (reads >= 2) throw error;
          return Buffer.alloc(Math.min(length, CHUNK_BYTES), 7);
        },
        close() {
          closed = true;
        },
      };
    };
    const catalog: ArtifactCatalog = {
      lookup(_projectId, artifactId) {
        if (artifactId !== "flaky" && artifactId !== "idle") return null;
        const entry: ArtifactDescriptor = descriptor({
          id: artifactId,
          projectId: PROJECT,
          totalBytes: CHUNK_BYTES * 3,
          sha256: "unchecked",
          retention: "diagnostic",
        });
        return entry;
      },
      open(entry) {
        if (entry.id === "flaky") return flaky(new CasIntegrityMismatchError("abc", "corrupt mid-stream"));
        return flaky(new CasBlobMissingError("abc"));
      },
    };
    const corrupt = await start(catalog, { initialCredits: 4 });
    try {
      const opened = await corrupt.client.openArtifact("flaky");
      await expect(corrupt.client.readStream(opened.streamId)).rejects.toBeInstanceOf(StreamRemoteError);
      expect(corrupt.server.openStreamCount).toBe(0);
      expect(corrupt.server.openHandleCount).toBe(0);
      expect(await corrupt.client.ping()).toBeLessThan(100);
      const missing = await corrupt.client.openArtifact("idle");
      await expect(corrupt.client.readStream(missing.streamId)).rejects.toBeInstanceOf(StreamRemoteError);
      expect(await corrupt.client.ping()).toBeLessThan(100);
    } finally {
      await corrupt.stop();
    }

    const idleCatalog: ArtifactCatalog = {
      lookup() {
        return descriptor({
          id: "idle",
          projectId: PROJECT,
          totalBytes: SMALL,
          sha256: "unchecked",
          retention: "diagnostic",
        });
      },
      open(entry) {
        return {
          closed: false,
          handles: 1,
          read(offset: number, length: number) {
            const out = Buffer.alloc(Math.min(length, entry.totalBytes - offset));
            fillPattern(out, offset, out.length);
            return out;
          },
          close() {},
        };
      },
    };
    const idle = await start(idleCatalog, { initialCredits: 0, autoCredit: false, idleTimeoutMs: 80 });
    try {
      const opened = await idle.client.openArtifact("idle");
      await expect(idle.client.readStream(opened.streamId)).rejects.toMatchObject({
        streamCode: "STREAM_IDLE_TIMEOUT",
      });
      await waitFor(() => idle.server.openHandleCount === 0 && idle.server.openStreamCount === 0, 100);
      expect(await idle.client.ping()).toBeLessThan(100);
    } finally {
      await idle.stop();
    }
  }, 20_000);

  it("serves log.range and diff.get viewports and still answers ping after a 1 MB reject", async () => {
    const calls: Array<{ method: string; args: readonly unknown[] }> = [];
    const logs: ArtifactLogReader = {
      readLogRange(artifactId, startLine, endLine) {
        calls.push({ method: "readLogRange", args: [artifactId, startLine, endLine] });
        if (endLine - startLine > 5) throw new Error("full log loaded");
        return {
          lines: ["only-10", "only-11"],
          totalLines: 9000,
          truncated: false,
          framesDecompressed: 1,
          indexSource: "sidecar",
        };
      },
      queryLogStream(artifactId, pattern, maxMatches) {
        calls.push({ method: "queryLogStream", args: [artifactId, pattern, maxMatches] });
        return {
          matches: [{ lineNumber: 2, text: pattern }],
          truncated: false,
          capped: false,
          framesDecompressed: 1,
        };
      },
    };
    let hunkReads: readonly number[] | null = null;
    const diffs: DiffSource = {
      summarize(projectId, _task, file) {
        if (projectId !== PROJECT || file !== "src/app.ts") return null;
        return {
          projectId,
          path: file,
          insertions: 5000,
          deletions: 3,
          hunks: [
            {
              index: 0,
              header: "@@ -1,1 +1,1 @@",
              oldStart: 1,
              oldCount: 1,
              newStart: 1,
              newCount: 1,
              insertions: 1,
              deletions: 0,
            },
            {
              index: 1,
              header: "@@ -8,1 +8,2 @@",
              oldStart: 8,
              oldCount: 1,
              newStart: 8,
              newCount: 2,
              insertions: 1,
              deletions: 0,
            },
          ],
        };
      },
      readHunks(_projectId, _task, _file, indexes) {
        hunkReads = indexes;
        return indexes.map((index) => ({
          index,
          header: "hunk",
          oldStart: index,
          oldCount: 1,
          newStart: index,
          newCount: 1,
          insertions: 1,
          deletions: 0,
          lines: ["+viewport"],
        }));
      },
    };
    const running = await start(new FileArtifactCatalog(), {
      logs: { reader: logs, belongsToProject: (artifactId) => artifactId === "log-1" },
      diffs,
    });
    try {
      const range = (await running.client.call("log.range", {
        artifactId: "log-1",
        startLine: 10,
        endLine: 11,
      })) as { lines: string[] };
      expect(range.lines).toEqual(["only-10", "only-11"]);
      expect(calls[0]?.args).toEqual(["log-1", 10, 11]);
      const search = (await running.client.call("log.search", {
        artifactId: "log-1",
        query: "needle",
        maxMatches: 2,
      })) as { matches: Array<{ text: string }> };
      expect(search.matches[0]?.text).toBe("needle");
      await expect(
        running.client.call("log.range", { artifactId: "foreign-log", startLine: 1, endLine: 1 }),
      ).rejects.toBeInstanceOf(ArtifactNotFoundError);
      const summary = (await running.client.call("diff.get", { task: "t", file: "src/app.ts" })) as {
        bodies: string;
        insertions: number;
        hunks: Array<{ lines?: string[] }>;
      };
      expect(summary.bodies).toBe("omitted");
      expect(summary.insertions).toBe(5000);
      expect(summary.hunks.every((hunk) => hunk.lines === undefined)).toBe(true);
      expect(hunkReads).toBeNull();
      const viewport = (await running.client.call("diff.get", {
        task: "t",
        file: "src/app.ts",
        hunks: [1],
      })) as { bodies: string; hunks: Array<{ lines?: string[] }> };
      expect(viewport.bodies).toBe("viewport");
      expect(hunkReads).toEqual([1]);
      expect(viewport.hunks[1]?.lines).toEqual(["+viewport"]);
      expect(viewport.hunks[0]?.lines).toBeUndefined();
      await expect(running.client.call("diff.get", { task: "t", file: "missing.ts" })).rejects.toBeInstanceOf(
        ArtifactNotFoundError,
      );

      const probe = net.createConnection(running.server.pipePath);
      probe.setNoDelay(true);
      await new Promise<void>((resolve, reject) => {
        probe.once("connect", () => resolve());
        probe.once("error", reject);
      });
      const declared = JSON_RPC_MAX_BYTES + 1;
      const header = Buffer.alloc(5);
      header.writeUInt32BE(declared, 0);
      header.writeUInt8(0, 4);
      const ping = encodeJsonFrame(
        encodeJsonPayload({ jsonrpc: "2.0", id: 7, method: "session.ping", params: {} }),
      );
      const codec = new StreamFrameCodec();
      const answered = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("oversized frame wedged the pipe")), 5000);
        probe.on("data", (chunk: Buffer) => {
          for (const event of codec.push(chunk)) {
            if (event.kind !== "frame" || event.channel !== 0) continue;
            const message = JSON.parse(Buffer.from(event.payload).toString("utf8")) as {
              id?: number;
              result?: { ok?: boolean };
            };
            if (message.id === 7 && message.result?.ok === true) {
              clearTimeout(timer);
              resolve();
            }
          }
        });
      });
      probe.write(Buffer.concat([header, Buffer.alloc(declared), ping]));
      await answered;
      probe.destroy();
      expect(await running.client.ping()).toBeLessThan(100);
    } finally {
      await running.stop();
    }
  }, 20_000);

  it("verifies evidence SHA-256 on the uncompressed bytes of a zstd artifact", async () => {
    const raw = Buffer.from("evidence-bytes-for-cas");
    const compressed = zstdCompressSync(raw);
    const filePath = path.join(dir, "evidence.zst");
    await fs.promises.writeFile(filePath, compressed);
    const sha256 = createHash("sha256").update(raw).digest("hex");
    const catalog = new FileArtifactCatalog();
    catalog.register(
      descriptor({
        id: "shot",
        projectId: PROJECT,
        totalBytes: raw.byteLength,
        sha256,
        format: "zstd",
        mime: "text/plain",
        retention: "evidence",
      }),
      filePath,
    );
    const running = await start(catalog, { retainBytes: true, initialCredits: 4 });
    try {
      const opened = await running.client.openArtifact("shot");
      const download = await running.client.readStream(opened.streamId);
      expect(Buffer.from(download.bytes ?? []).equals(raw)).toBe(true);
      expect(download.sha256).toBe(sha256);
      expect(running.server.openHandleCount).toBe(0);
    } finally {
      await running.stop();
    }
  }, 20_000);
});

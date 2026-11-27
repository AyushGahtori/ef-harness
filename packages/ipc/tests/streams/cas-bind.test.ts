import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CasBlobStore } from "@ef-harness/db";
import { toBareSha256Hex, toPrefixedSha256 } from "@ef-harness/shared-contracts";
import { ArtifactPipeServer, allocatePipePath } from "../../src/streams/pipe-server.js";
import { ArtifactStreamClient } from "../../src/streams/artifact-stream-client.js";
import { byteRangeToCasRange, createCasArtifactCatalog } from "../../src/streams/cas-bind.js";
import type { ArtifactDescriptor } from "../../src/streams/ports.js";

const roots: string[] = [];
const databases: DatabaseSync[] = [];

afterEach(async () => {
  for (const db of databases.splice(0)) {
    if (db.isOpen) db.close();
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("CAS artifact streams", () => {
  it("maps a stream byte range onto an exclusive CAS end", () => {
    expect(byteRangeToCasRange({ offset: 6, length: 5 })).toEqual({ start: 6, end: 11 });
    expect(byteRangeToCasRange({ offset: 0, length: 0 })).toEqual({ start: 0, end: 0 });
  });

  it("reads a prefixed digest through openReadStream", async () => {
    const { store } = await openStore();
    const text = Buffer.from("hello world");
    const stored = await store.put(text, { holderKind: "project", holderId: "c13", format: "raw" });
    const catalog = createCasArtifactCatalog({
      store,
      lookup: () => descriptor(toPrefixedSha256(stored.hash), text.byteLength),
    });
    const source = await catalog.open(descriptor(toPrefixedSha256(stored.hash), text.byteLength), {
      offset: 6,
      length: 5,
    });
    const slice = await source.read(0, 5);
    source.close();
    expect(Buffer.from(slice).toString("utf8")).toBe("world");
    expect(toBareSha256Hex(toPrefixedSha256(stored.hash))).toBe(stored.hash);
    expect(source.handles).toBe(0);
  });

  it("streams 4 MB from CasBlobStore with a 128 KB credit window and matching SHA-256", async () => {
    const { store } = await openStore();
    const bytes = Buffer.alloc(4 * 1024 * 1024, 7);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const stored = await store.put(bytes, { holderKind: "project", holderId: "c13", format: "raw" });
    expect(stored.hash).toBe(sha256);
    const catalog = createCasArtifactCatalog({
      store,
      lookup: (_projectId, id) => (id === "log" ? descriptor(stored.hash, bytes.byteLength) : null),
    });
    const server = new ArtifactPipeServer({
      pipePath: allocatePipePath("efh-c13"),
      projectId: "proj-a",
      catalog,
      blobs: store,
      initialCredits: 2,
    });
    await server.listen();
    const client = new ArtifactStreamClient({
      pipePath: server.pipePath,
      creditWindow: 2,
      retainBytes: false,
    });
    try {
      await client.connect();
      const opened = await client.openArtifact("log");
      expect(opened.chunkBytes).toBe(65_536);
      expect(opened.initialCredits).toBe(2);
      const download = await client.readStream(opened.streamId);
      expect(download.complete).toBe(true);
      expect(download.byteLength).toBe(bytes.byteLength);
      expect(download.sha256).toBe(sha256);
      expect(download.maxChunk).toBeLessThanOrEqual(65_536);
      expect(server.openHandleCount).toBe(0);
    } finally {
      client.close();
      await server.close();
    }
  });
});

function descriptor(hash: string, totalBytes: number): ArtifactDescriptor {
  return {
    id: "log",
    projectId: "proj-a",
    retention: "diagnostic",
    mime: "application/octet-stream",
    totalBytes,
    sha256: hash,
    format: "raw",
  };
}

async function openStore(): Promise<{ store: CasBlobStore; root: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "ef-c13-cas-"));
  roots.push(root);
  const globalDb = new DatabaseSync(":memory:");
  databases.push(globalDb);
  globalDb.exec("PRAGMA foreign_keys = ON");
  globalDb.exec(await readFile(schemaPath("global.sql"), "utf8"));
  const store = await CasBlobStore.open({
    globalDb,
    rootDir: path.join(root, "cas"),
    sleep: () => Promise.resolve(),
  });
  return { store, root };
}

function schemaPath(name: string): string {
  return fileURLToPath(new URL(`../../../../schema/${name}`, import.meta.url));
}

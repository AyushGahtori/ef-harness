import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { splitSearchText } from "@ef-harness/shared-contracts";
import {
  SEEKABLE_TEXT_THRESHOLD_BYTES,
  SeekableLogArchiver,
  bindArtifactManager,
  encodeSeekableLog,
} from "../../src/artifacts/index.js";
import { blobFilePath, CasBlobStore, toSecretPurgeCasPort } from "../../src/cas/index.js";
import { RawFileCasBlobStore } from "../../src/secret-purge/cas-store.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) await cleanup();
  }
});

function schemaText(name: "global.sql" | "state.sql"): string {
  return readFileSync(fileURLToPath(new URL(`../../../../schema/${name}`, import.meta.url)), "utf8");
}

function trackDb(db: DatabaseSync): DatabaseSync {
  cleanups.push(async () => {
    db.close();
  });
  return db;
}

describe("unified CasBlobStore", () => {
  it("stores a pre-framed seekable log, reads a byte range, and accepts sha256: prefixes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ef-cas-unified-"));
    cleanups.push(async () => {
      await rm(root, { recursive: true, force: true });
    });
    const globalDb = trackDb(new DatabaseSync(":memory:"));
    globalDb.exec("PRAGMA foreign_keys = ON");
    globalDb.exec(schemaText("global.sql"));
    const state = trackDb(new DatabaseSync(":memory:"));
    state.exec("PRAGMA foreign_keys = ON");
    state.function("ef_search_text", { deterministic: true }, (value: SQLOutputValue) =>
      splitSearchText(value),
    );
    state.exec(schemaText("state.sql"));
    const store = await CasBlobStore.open({ globalDb, projectDb: state, rootDir: root, sleep: async () => {} });
    const text = `${"A".repeat(SEEKABLE_TEXT_THRESHOLD_BYTES)}TAIL\n`;
    const framed = encodeSeekableLog(text, 64 * 1024);
    const archived = await new SeekableLogArchiver(store, 64 * 1024).archive(text, {
      holderKind: "project",
      holderId: "P1",
    });
    expect(archived.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(archived.format).toBe("zstd-seekable");
    const onDisk = await readFile(archived.absolutePath);
    expect(onDisk.equals(framed.stored)).toBe(true);
    expect(path.basename(archived.absolutePath)).toBe(`${archived.hash}.zst`);
    const row = globalDb.prepare("SELECT hash, format FROM cas_blobs WHERE hash = :hash").get({
      hash: archived.hash,
    });
    expect(row).toMatchObject({ hash: archived.hash, format: "zstd-seekable" });
    const start = 8;
    const end = 24;
    const chunks: Uint8Array[] = [];
    for await (const chunk of store.openReadStream(`sha256:${archived.hash}`, { start, end })) {
      chunks.push(chunk);
    }
    expect(Buffer.concat(chunks).equals(Buffer.from(text, "utf8").subarray(start, end))).toBe(true);
    const full = await store.getBytes(`sha256:${archived.hash}`);
    expect(full).not.toBeNull();
    expect(Buffer.from(full ?? new Uint8Array()).equals(Buffer.from(text, "utf8"))).toBe(true);
    expect(store.has(archived.hash)).toBe(true);
    expect(store.has(`sha256:${"ab".repeat(32)}`)).toBe(false);

    const manager = bindArtifactManager({
      stateDb: state,
      globalDb,
      casStore: store,
      projectId: "P1",
      frameBytes: 64 * 1024,
    });
    const stored = manager.storeArtifact({
      content: text,
      kind: "log",
      retention: "diagnostic",
    });
    expect(stored.hash).toBe(archived.hash);
    expect(stored.format).toBe("zstd-seekable");
    const range = manager.readLogRange(stored.artifactId, 1, 1);
    expect(range.lines[0]?.endsWith("TAIL")).toBe(true);
    expect(range.framesDecompressed).toBeGreaterThan(0);

    const mirror = new RawFileCasBlobStore({ root, globalDb });
    expect(Buffer.from(mirror.getBlob(`sha256:${archived.hash}`)).equals(Buffer.from(text, "utf8"))).toBe(true);
    expect(mirror.listStoredHashes()).toContain(archived.hash);
    const port = toSecretPurgeCasPort(store);
    expect(port.listStoredHashes?.()).toContain(archived.hash);
    port.forceDeletePurgedBlob(archived.hash);
    expect(mirror.listStoredHashes()).not.toContain(archived.hash);
    await expect(readFile(blobFilePath(root, archived.hash, "zstd"))).rejects.toThrow();
    await expect(readFile(blobFilePath(root, archived.hash, "raw"))).rejects.toThrow();
  });
});

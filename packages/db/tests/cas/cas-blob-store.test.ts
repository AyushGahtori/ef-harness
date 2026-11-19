import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  CAS_GRACE_MS,
  CAS_RENAME_ATTEMPTS,
  CAS_TMP_MAX_AGE_MS,
  CasBlobMissingError,
  CasBlobStore,
  CasIntegrityMismatchError,
  blobFilePath,
  casRenameBackoffMs,
  globalCasGcCandidatesSql,
  loadNamedQuery,
  defaultCasRoot,
} from "../../src/cas/index.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) await cleanup();
  }
});

function schemaText(name: "global.sql" | "state.sql" | "queries.sql"): string {
  return readFileSync(fileURLToPath(new URL(`../../../../schema/${name}`, import.meta.url)), "utf8");
}

function trackDb(db: DatabaseSync): DatabaseSync {
  cleanups.push(async () => {
    db.close();
  });
  return db;
}

function openGlobal(): DatabaseSync {
  const db = trackDb(new DatabaseSync(":memory:"));
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(schemaText("global.sql"));
  return db;
}

function openState(): DatabaseSync {
  const db = trackDb(new DatabaseSync(":memory:"));
  db.exec("PRAGMA foreign_keys = ON");
  db.function("ef_search_text", { deterministic: true }, (value: SQLOutputValue) => {
    const text = value == null ? "" : String(value);
    const extra = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-./:]+/g, " ");
    return `${text} ${extra}`;
  });
  db.exec(schemaText("state.sql"));
  return db;
}

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "ef-cas-"));
  cleanups.push(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

async function flipLastByte(filePath: string): Promise<void> {
  await chmod(filePath, 0o666);
  const bytes = await readFile(filePath);
  const last = bytes.length - 1;
  bytes[last] = (bytes[last] ?? 0) ^ 0xff;
  await writeFile(filePath, bytes);
  await chmod(filePath, 0o444);
}

function blobState(db: DatabaseSync, hash: string): string | undefined {
  const row = db.prepare("SELECT state FROM cas_blobs WHERE hash = :hash").get({ hash });
  return row ? String(row.state) : undefined;
}

function sha(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

describe("CAS layout and hash key", () => {
  it("stores uncompressed SHA-256 under the two-character shard and promotes read-only zstd", async () => {
    const root = await tempRoot();
    const globalDb = openGlobal();
    const store = await CasBlobStore.open({ globalDb, rootDir: root, sleep: async () => {} });
    const content = Buffer.from("evidence log line\n");
    const result = await store.putBlob(content, { holderKind: "project", holderId: "P1" });

    expect(result.hash).toBe(sha(content));
    expect(result.hash).toBe(result.hash.toLowerCase());
    expect(result.format).toBe("zstd");
    expect(result.deduplicated).toBe(false);
    expect(result.absolutePath).toBe(blobFilePath(root, result.hash, "zstd"));
    expect(result.absolutePath).toBe(
      path.join(root, "sha256", result.hash.slice(0, 2), result.hash.slice(2, 4), `${result.hash}.zst`),
    );
    const stored = await readFile(result.absolutePath);
    expect(sha(stored)).not.toBe(result.hash);
    expect((await stat(result.absolutePath)).mode & 0o222).toBe(0);
    await expect(open(result.absolutePath, "a")).rejects.toMatchObject({ code: "EPERM" });
    expect(await store.getBlob(result.hash, "evidence")).toEqual(content);

    const again = await store.putBlob(content, { holderKind: "backup", holderId: "P-backup-3" });
    expect(again.deduplicated).toBe(true);
    expect(again.hash).toBe(result.hash);
    expect(again.absolutePath).toBe(result.absolutePath);
    expect(again.format).toBe("zstd");
    const pins = globalDb
      .prepare("SELECT holder_kind, holder_id FROM cas_pins WHERE hash = :hash ORDER BY holder_kind")
      .all({ hash: result.hash });
    expect(pins).toEqual([
      { holder_kind: "backup", holder_id: "P-backup-3" },
      { holder_kind: "project", holder_id: "P1" },
    ]);
  });

  it("keeps the same hash for raw bytes and does not depend on the codec", async () => {
    const root = await tempRoot();
    const store = await CasBlobStore.open({
      globalDb: openGlobal(),
      rootDir: root,
      sleep: async () => {},
    });
    const content = Buffer.from("uncompressed");
    const raw = await store.putBlob(content, { holderKind: "export", holderId: "bundle", format: "raw" });
    expect(raw.absolutePath.endsWith(`${raw.hash}.raw`)).toBe(true);
    expect(await readFile(raw.absolutePath)).toEqual(content);
    expect(raw.storedBytes).toBe(content.length);
    const zstd = await store.putBlob(content, { holderKind: "project", holderId: "P", format: "zstd" });
    expect(zstd.hash).toBe(raw.hash);
    expect(zstd.hash).toBe(sha(content));
    expect(zstd.deduplicated).toBe(true);
    expect(zstd.format).toBe("raw");
    expect(await store.getBlob(zstd.hash, "asset")).toEqual(content);
  });

  it("round-trips a zero-byte artifact", async () => {
    const root = await tempRoot();
    const store = await CasBlobStore.open({
      globalDb: openGlobal(),
      rootDir: root,
      sleep: async () => {},
    });
    const empty = Buffer.alloc(0);
    const result = await store.putBlob(empty, { holderKind: "project", holderId: "P" });
    expect(result.hash.startsWith("e3b0c442")).toBe(true);
    expect(result.hash).toBe(sha(empty));
    expect(result.bytes).toBe(0);
    const read = await store.getBlob(result.hash, "diagnostic");
    expect(read).toEqual(empty);
    expect(read.length).toBe(0);
  });

  it("resolves the default root under LOCALAPPDATA/EFHarness/cas", () => {
    expect(defaultCasRoot({ LOCALAPPDATA: path.join("C:", "AppData", "Local") }, "win32")).toBe(
      path.join("C:", "AppData", "Local", "EFHarness", "cas"),
    );
  });
});

describe("pin before record", () => {
  it("commits cas_blobs and cas_pins before the caller writes state.db.artifacts", async () => {
    const root = await tempRoot();
    const globalDb = openGlobal();
    const projectDb = openState();
    const store = await CasBlobStore.open({ globalDb, projectDb, rootDir: root, sleep: async () => {} });
    const content = Buffer.from("pinned before the artifact row");
    const result = await store.putBlob(content, { holderKind: "project", holderId: "P1" });

    const pin = globalDb
      .prepare("SELECT holder_kind, holder_id FROM cas_pins WHERE hash = :hash")
      .get({ hash: result.hash });
    expect(pin).toEqual({ holder_kind: "project", holder_id: "P1" });
    expect(blobState(globalDb, result.hash)).toBe("ok");
    expect(projectDb.prepare("SELECT count(*) AS n FROM artifacts").get()?.n).toBe(0);

    projectDb
      .prepare(
        `INSERT INTO artifacts(id, hash, kind, bytes, retention, created_at)
         VALUES ('ART-1', :hash, 'log', :bytes, 'evidence', 1)`,
      )
      .run({ hash: result.hash, bytes: result.bytes });
    expect(projectDb.prepare("SELECT hash FROM artifacts WHERE id = 'ART-1'").get()?.hash).toBe(result.hash);
  });

  it("preserves created_at when the same bytes are stored again", async () => {
    const root = await tempRoot();
    const globalDb = openGlobal();
    const store = await CasBlobStore.open({ globalDb, rootDir: root, sleep: async () => {} });
    const content = Buffer.from("stable grace");
    const result = await store.putBlob(content, { holderKind: "project", holderId: "P" });
    globalDb.prepare("UPDATE cas_blobs SET created_at = 5 WHERE hash = :hash").run({ hash: result.hash });
    const again = await store.putBlob(content, { holderKind: "research", holderId: "pkg" });
    expect(again.deduplicated).toBe(true);
    expect(globalDb.prepare("SELECT created_at AS n FROM cas_blobs WHERE hash = :hash").get({ hash: result.hash })?.n).toBe(5);
  });
});

describe("concurrent identical puts", () => {
  it("lets one rename win, verifies the winner, and pins every holder", async () => {
    const root = await tempRoot();
    const globalDb = openGlobal();
    const store = await CasBlobStore.open({ globalDb, rootDir: root, sleep: async () => {} });
    const content = Buffer.from("identical concurrent payload");
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        store.putBlob(content, { holderKind: index % 2 === 0 ? "project" : "backup", holderId: `holder-${index}` }),
      ),
    );
    expect(new Set(results.map((result) => result.hash)).size).toBe(1);
    expect(results.filter((result) => !result.deduplicated)).toHaveLength(1);
    const hash = results[0]?.hash ?? "";
    const pins = globalDb.prepare("SELECT count(*) AS n FROM cas_pins WHERE hash = :hash").get({ hash });
    expect(pins?.n).toBe(8);
    expect(await readdir(path.join(root, "tmp"))).toEqual([]);
    expect(await store.getBlob(hash, "ephemeral")).toEqual(content);
  });
});

describe("Windows rename retries", () => {
  it("backs off 50, 100, then 200 ms when the first three renames fail", async () => {
    const root = await tempRoot();
    const delays: number[] = [];
    const codes = ["EPERM", "EBUSY", "EACCES"];
    let attempts = 0;
    const store = await CasBlobStore.open({
      globalDb: openGlobal(),
      rootDir: root,
      sleep: async (ms) => {
        delays.push(ms);
      },
      rename: async (from, to) => {
        attempts += 1;
        if (attempts <= 3) {
          const error = new Error("antivirus lock") as NodeJS.ErrnoException;
          error.code = codes[attempts - 1];
          throw error;
        }
        await rename(from, to);
      },
    });
    const content = Buffer.from("retried rename");
    const result = await store.putBlob(content, { holderKind: "project", holderId: "P" });
    expect(attempts).toBe(4);
    expect(delays).toEqual([50, 100, 200]);
    expect(await readdir(path.join(root, "tmp"))).toEqual([]);
    expect(await store.getBlob(result.hash, "evidence")).toEqual(content);
    expect((await stat(result.absolutePath)).mode & 0o222).toBe(0);
  });

  it("stops after 10 attempts and leaves no temp file", async () => {
    const root = await tempRoot();
    const delays: number[] = [];
    let attempts = 0;
    const store = await CasBlobStore.open({
      globalDb: openGlobal(),
      rootDir: root,
      sleep: async (ms) => {
        delays.push(ms);
      },
      rename: async () => {
        attempts += 1;
        const error = new Error("still locked") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      },
    });
    await expect(store.putBlob(Buffer.from("never"), { holderKind: "pending", holderId: "P:1" })).rejects.toMatchObject({
      code: "EPERM",
    });
    expect(attempts).toBe(CAS_RENAME_ATTEMPTS);
    expect(delays).toEqual([50, 100, 200, 400, 800, 1000, 1000, 1000, 1000]);
    expect(await readdir(path.join(root, "tmp"))).toEqual([]);
    expect(casRenameBackoffMs(1)).toBe(50);
    expect(casRenameBackoffMs(5)).toBe(800);
    expect(casRenameBackoffMs(6)).toBe(1000);
  });
});

describe("integrity quarantine", () => {
  it("marks tampered evidence and asset blobs quarantined and marks dependent receipts", async () => {
    const root = await tempRoot();
    const globalDb = openGlobal();
    const projectDb = openState();
    const store = await CasBlobStore.open({ globalDb, projectDb, rootDir: root, sleep: async () => {} });
    const events: string[] = [];
    const watching = await CasBlobStore.open({
      globalDb,
      projectDb,
      rootDir: root,
      sleep: async () => {},
      onEvent: (event) => {
        events.push(event.kind);
      },
    });

    for (const retention of ["evidence", "asset"] as const) {
      const content = Buffer.from(`tamper-${retention}-${randomUUID()}`);
      const stored = await store.putBlob(content, { holderKind: "project", holderId: "P1" });
      if (retention === "evidence") {
        seedEvidence(projectDb, stored.hash, stored.bytes);
      }
      await flipLastByte(stored.absolutePath);
      const error = await watching.getBlob(stored.hash, retention).then(
        () => {
          throw new Error("corrupted bytes were returned");
        },
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(CasIntegrityMismatchError);
      const mismatch = error as CasIntegrityMismatchError;
      expect(mismatch.hash).toBe(stored.hash);
      expect(mismatch.retention).toBe(retention);
      expect(blobState(globalDb, stored.hash)).toBe("quarantined");
      if (retention === "evidence") {
        expect(mismatch.dependentReceipts.map((mark) => mark.artifactDigest).sort()).toEqual(
          ["ART-1", stored.hash].sort(),
        );
        const receipts = projectDb.prepare("SELECT status, receipt FROM check_results ORDER BY check_version").all();
        expect(receipts).toHaveLength(2);
        for (const receipt of receipts) {
          expect(receipt.status).toBe("error");
          const note = JSON.parse(String(receipt.receipt)) as { casCorruption: boolean; hash: string };
          expect(note.casCorruption).toBe(true);
          expect(note.hash).toBe(stored.hash);
        }
      }
    }
    expect(events).toEqual(["cas.corruption", "cas.corruption"]);
  });

  it("replaces a corrupt existing blob when the same bytes are written again", async () => {
    const root = await tempRoot();
    const globalDb = openGlobal();
    const store = await CasBlobStore.open({ globalDb, rootDir: root, sleep: async () => {} });
    const content = Buffer.from("recover-me");
    const first = await store.putBlob(content, { holderKind: "research", holderId: "docs" });
    await flipLastByte(first.absolutePath);
    const second = await store.putBlob(content, { holderKind: "research", holderId: "docs" });
    expect(second.replacedCorrupt).toBe(true);
    expect(second.hash).toBe(first.hash);
    expect(await store.getBlob(second.hash, "asset")).toEqual(content);
    expect(blobState(globalDb, second.hash)).toBe("ok");
    expect(store.recentEvents().map((event) => event.kind)).toEqual(["cas.scrub_recovery"]);
    expect(await readdir(path.join(root, "tmp"))).toEqual([]);
  });

  it("verifyBlobIntegrity rejects a bit flip and records a successful verification", async () => {
    const root = await tempRoot();
    const globalDb = openGlobal();
    const store = await CasBlobStore.open({ globalDb, rootDir: root, sleep: async () => {}, now: () => 42 });
    const content = Buffer.from("scrub me");
    const stored = await store.putBlob(content, { holderKind: "project", holderId: "P" });
    const report = await store.verifyBlobIntegrity(stored.hash);
    expect(report).toEqual({ hash: stored.hash, bytes: content.length, verifiedAt: 42 });
    await flipLastByte(stored.absolutePath);
    await expect(store.verifyBlobIntegrity(stored.hash)).rejects.toBeInstanceOf(CasIntegrityMismatchError);
    expect(blobState(globalDb, stored.hash)).toBe("quarantined");
  });
});

describe("missing CAS", () => {
  it("returns CasBlobMissingError when the folder or blob is gone and still accepts new writes", async () => {
    const root = await tempRoot();
    const store = await CasBlobStore.open({
      globalDb: openGlobal(),
      rootDir: root,
      sleep: async () => {},
    });
    const stored = await store.putBlob(Buffer.from("was here"), { holderKind: "project", holderId: "P" });
    await rm(root, { recursive: true, force: true });
    const missing = await store.getBlob(stored.hash, "evidence").then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(missing).toBeInstanceOf(CasBlobMissingError);
    expect((missing as CasBlobMissingError).hash).toBe(stored.hash);
    const rebuilt = await store.putBlob(Buffer.from("written again"), { holderKind: "project", holderId: "P" });
    expect(rebuilt.hash).toBe(sha(Buffer.from("written again")));
    expect(await store.getBlob(rebuilt.hash, "diagnostic")).toEqual(Buffer.from("written again"));
    await expect(store.getBlob("ab".repeat(32), "evidence")).rejects.toBeInstanceOf(CasBlobMissingError);
  });
});

describe("garbage collection", () => {
  it("executes global_cas_gc_candidates from schema/queries.sql", async () => {
    const root = await tempRoot();
    const store = await CasBlobStore.open({
      globalDb: openGlobal(),
      rootDir: root,
      sleep: async () => {},
    });
    const sql = loadNamedQuery(schemaText("queries.sql"), "global_cas_gc_candidates");
    expect(store.gcCandidatesSql).toBe(sql);
    expect(store.gcCandidatesSql).toBe(globalCasGcCandidatesSql());
    expect(sql).toContain("created_at < :grace_cutoff");
    expect(sql).toContain("NOT EXISTS");
    expect(sql).toContain("LIMIT 1000");
  });

  it("skips backup pins, offline project pins, and blobs younger than 7 days", async () => {
    const root = await tempRoot();
    const globalDb = openGlobal();
    const store = await CasBlobStore.open({ globalDb, rootDir: root, sleep: async () => {} });
    const backup = await store.putBlob(Buffer.from("backup-pinned"), {
      holderKind: "backup",
      holderId: "P-backup-3",
    });
    const offline = await store.putBlob(Buffer.from("offline-project"), {
      holderKind: "project",
      holderId: "unplugged",
    });
    const young = await store.putBlob(Buffer.from("too-young"), { holderKind: "project", holderId: "P" });
    const expired = await store.putBlob(Buffer.from("past-grace"), { holderKind: "project", holderId: "P" });
    expect(store.unpinHolder(young.hash, "project", "P")).toBe(true);
    expect(store.unpinHolder(expired.hash, "project", "P")).toBe(true);
    globalDb.prepare("UPDATE cas_blobs SET created_at = 0 WHERE hash = :hash").run({ hash: backup.hash });
    globalDb.prepare("UPDATE cas_blobs SET created_at = 0 WHERE hash = :hash").run({ hash: offline.hash });
    globalDb.prepare("UPDATE cas_blobs SET created_at = 0 WHERE hash = :hash").run({ hash: expired.hash });

    const now = CAS_GRACE_MS + 10;
    const gc = await store.runGarbageCollection({ now });
    expect(gc.deleted).toEqual([expired.hash]);
    await access(backup.absolutePath);
    await access(offline.absolutePath);
    await access(young.absolutePath);
    await expect(access(expired.absolutePath)).rejects.toThrow();
    expect(blobState(globalDb, expired.hash)).toBeUndefined();
    expect(await store.getBlob(offline.hash, "diagnostic")).toEqual(Buffer.from("offline-project"));
  });

  it("keeps a blob created exactly 7 days ago and deletes one tick older", async () => {
    const root = await tempRoot();
    const globalDb = openGlobal();
    const store = await CasBlobStore.open({ globalDb, rootDir: root, sleep: async () => {} });
    const stored = await store.putBlob(Buffer.from("boundary"), { holderKind: "export", holderId: "out" });
    store.unpinHolder(stored.hash, "export", "out");
    const now = 5_000_000_000_000;
    globalDb
      .prepare("UPDATE cas_blobs SET created_at = :created WHERE hash = :hash")
      .run({ created: now - CAS_GRACE_MS, hash: stored.hash });
    expect((await store.runGarbageCollection({ now })).deleted).toEqual([]);
    globalDb
      .prepare("UPDATE cas_blobs SET created_at = :created WHERE hash = :hash")
      .run({ created: now - CAS_GRACE_MS - 1, hash: stored.hash });
    expect((await store.runGarbageCollection({ now })).deleted).toEqual([stored.hash]);
  });

  it("stops at the query limit of 1000 candidates", async () => {
    const root = await tempRoot();
    const globalDb = openGlobal();
    const store = await CasBlobStore.open({ globalDb, rootDir: root, sleep: async () => {} });
    const insert = globalDb.prepare(
      "INSERT INTO cas_blobs(hash, bytes, stored_bytes, format, created_at) VALUES (:hash, 1, 1, 'zstd', 0)",
    );
    globalDb.exec("BEGIN");
    for (let index = 1; index <= 1001; index += 1) {
      insert.run({ hash: index.toString(16).padStart(64, "0") });
    }
    globalDb.exec("COMMIT");
    const gc = await store.runGarbageCollection({ now: CAS_GRACE_MS + 1 });
    expect(gc.scanned).toBe(1000);
    expect(gc.deleted).toHaveLength(1000);
    expect(globalDb.prepare("SELECT count(*) AS n FROM cas_blobs").get()?.n).toBe(1);
  });

  it("clears the read-only bit before unlinking a promoted blob on Windows", async () => {
    const root = await tempRoot();
    const globalDb = openGlobal();
    let sawWritable = false;
    const store = await CasBlobStore.open({
      globalDb,
      rootDir: root,
      sleep: async () => {},
      unlinkPromoted: async (filePath) => {
        const handle = await open(filePath, "a");
        await handle.close();
        sawWritable = true;
        await unlink(filePath);
      },
    });
    const stored = await store.putBlob(Buffer.from("read-only-unlink"), {
      holderKind: "project",
      holderId: "P",
    });
    expect((await stat(stored.absolutePath)).mode & 0o222).toBe(0);
    await expect(open(stored.absolutePath, "a")).rejects.toMatchObject({ code: "EPERM" });
    if (process.platform === "win32") {
      const del = spawnSync("cmd.exe", ["/d", "/c", "del", stored.absolutePath], { encoding: "utf8" });
      expect(`${del.stdout}\n${del.stderr}`).toMatch(/Access is denied/i);
      await access(stored.absolutePath);
    }
    store.unpinHolder(stored.hash, "project", "P");
    globalDb.prepare("UPDATE cas_blobs SET created_at = 0 WHERE hash = :hash").run({ hash: stored.hash });
    const gc = await store.runGarbageCollection({ now: CAS_GRACE_MS + 1 });
    expect(gc.deleted).toEqual([stored.hash]);
    expect(sawWritable).toBe(true);
    await expect(access(stored.absolutePath)).rejects.toThrow();
  });
});

describe("temp sweep", () => {
  it("removes cas/tmp files older than one hour at startup and leaves sha256 untouched", async () => {
    const root = await tempRoot();
    const tempDir = path.join(root, "tmp");
    const shard = path.join(root, "sha256", "ab", "cd");
    await mkdir(tempDir, { recursive: true });
    await mkdir(shard, { recursive: true });
    const oldTemp = path.join(tempDir, `${randomUUID()}.tmp`);
    const youngTemp = path.join(tempDir, `${randomUUID()}.tmp`);
    const blob = path.join(shard, `${"ab".repeat(32)}.zst`);
    await writeFile(oldTemp, "orphan");
    await writeFile(youngTemp, "fresh");
    await writeFile(blob, "live");
    const old = new Date(Date.now() - CAS_TMP_MAX_AGE_MS - 5_000);
    await utimes(oldTemp, old, old);
    await utimes(blob, old, old);
    const store = await CasBlobStore.open({
      globalDb: openGlobal(),
      rootDir: root,
      sleep: async () => {},
    });
    await expect(access(oldTemp)).rejects.toThrow();
    expect(await readFile(youngTemp, "utf8")).toBe("fresh");
    expect(await readFile(blob, "utf8")).toBe("live");
    const removed = await store.sweepOrphanTempFiles(Date.now());
    expect(removed).toBe(0);
  });
});

describe("project pin sync", () => {
  it("reconciles project pins and clears recorded or stale pending pins", async () => {
    const root = await tempRoot();
    const globalDb = openGlobal();
    const projectDb = openState();
    const projectId = "project_1";
    const store = await CasBlobStore.open({ globalDb, projectDb, rootDir: root, sleep: async () => {} });
    const live = await store.putBlob(Buffer.from("still referenced"), {
      holderKind: "pending",
      holderId: `${projectId}:write-1`,
    });
    const dropped = await store.putBlob(Buffer.from("artifact gone"), {
      holderKind: "project",
      holderId: projectId,
    });
    const fresh = await store.putBlob(Buffer.from("in flight"), {
      holderKind: "pending",
      holderId: `${projectId}:write-2`,
    });
    projectDb
      .prepare(
        `INSERT INTO artifacts(id, hash, kind, bytes, retention, created_at)
         VALUES ('ART-live', :hash, 'log', :bytes, 'diagnostic', 1)`,
      )
      .run({ hash: live.hash, bytes: live.bytes });
    const staleHash = "cd".repeat(32);
    globalDb
      .prepare(
        `INSERT INTO cas_pins(hash, holder_kind, holder_id, pinned_at) VALUES (:hash, 'pending', :holder, 0)`,
      )
      .run({ hash: staleHash, holder: `${projectId}:crashed` });
    const otherHash = "ef".repeat(32);
    globalDb
      .prepare(
        `INSERT INTO cas_pins(hash, holder_kind, holder_id, pinned_at) VALUES (:hash, 'pending', 'other-project', 0)`,
      )
      .run({ hash: otherHash });

    const synced = store.syncProjectPins(projectId);
    expect(synced.projectPinsAdded).toBe(1);
    expect(synced.projectPinsRemoved).toBe(1);
    expect(synced.pendingPinsCleared).toBe(2);

    const projectPins = globalDb
      .prepare("SELECT hash FROM cas_pins WHERE holder_kind = 'project' AND holder_id = :id")
      .all({ id: projectId });
    expect(projectPins.map((row) => row.hash)).toEqual([live.hash]);
    expect(
      globalDb
        .prepare("SELECT 1 AS n FROM cas_pins WHERE hash = :hash AND holder_kind = 'pending'")
        .get({ hash: fresh.hash }),
    ).toBeTruthy();
    expect(
      globalDb
        .prepare("SELECT 1 AS n FROM cas_pins WHERE hash = :hash AND holder_kind = 'pending'")
        .get({ hash: staleHash }),
    ).toBeUndefined();
    expect(
      globalDb.prepare("SELECT holder_id FROM cas_pins WHERE hash = :hash").get({ hash: otherHash })?.holder_id,
    ).toBe("other-project");
    expect(await store.getBlob(dropped.hash, "diagnostic")).toEqual(Buffer.from("artifact gone"));
  });
});

describe("secret purge delete", () => {
  it("refuses while pins remain and then bypasses the 7-day grace", async () => {
    const root = await tempRoot();
    const globalDb = openGlobal();
    const store = await CasBlobStore.open({ globalDb, rootDir: root, sleep: async () => {} });
    const stored = await store.putBlob(Buffer.from("secret-bearing"), {
      holderKind: "project",
      holderId: "P",
    });
    const createdAt = globalDb.prepare("SELECT created_at AS n FROM cas_blobs WHERE hash = :hash").get({
      hash: stored.hash,
    })?.n;
    expect(typeof createdAt).toBe("number");
    expect(Number(createdAt)).toBeGreaterThan(Date.now() - 60_000);
    await expect(
      store.forceDeletePurgedBlob(stored.hash, { caller: "task-030-secret-purge" }),
    ).rejects.toThrow(/pins remain/);
    await access(stored.absolutePath);
    store.unpinHolder(stored.hash, "project", "P");
    await store.forceDeletePurgedBlob(stored.hash, { caller: "task-030-secret-purge" });
    await expect(access(stored.absolutePath)).rejects.toThrow();
    expect(blobState(globalDb, stored.hash)).toBeUndefined();
    expect((await store.runGarbageCollection()).deleted).not.toContain(stored.hash);
  });
});

describe("extra holders", () => {
  it("pins an existing blob and unpins one holder without deleting bytes", async () => {
    const root = await tempRoot();
    const globalDb = openGlobal();
    const store = await CasBlobStore.open({ globalDb, rootDir: root, sleep: async () => {} });
    const stored = await store.putBlob(Buffer.from("shared"), { holderKind: "project", holderId: "P" });
    store.pinBlob(stored.hash, "export", "bundle-1");
    expect(
      globalDb
        .prepare("SELECT count(*) AS n FROM cas_pins WHERE hash = :hash")
        .get({ hash: stored.hash })?.n,
    ).toBe(2);
    expect(store.unpinHolder(stored.hash, "project", "P")).toBe(true);
    await access(stored.absolutePath);
    expect(() => store.pinBlob("ab".repeat(32), "backup", "missing")).toThrow(CasBlobMissingError);
  });
});

function seedEvidence(project: DatabaseSync, hash: string, bytes: number): void {
  project.exec("BEGIN IMMEDIATE");
  project
    .prepare(
      `INSERT INTO change_sets(id, rev, origin, author, created_at)
       VALUES ('CS-1', 1, 'kernel', 'test', 0)`,
    )
    .run();
  const insertNode = project.prepare(
    `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
     VALUES (:id, :kind, 1, :content_hash, :title, '', '{}', 'CS-1', 1, 1)`,
  );
  insertNode.run({ id: "T1", kind: "task", content_hash: "h-T1", title: "Task" });
  insertNode.run({ id: "CK-1", kind: "check", content_hash: "h-CK", title: "Check" });
  project
    .prepare(
      `INSERT INTO task_runtime(task, feature, state, level, updated_rev)
       VALUES ('T1', 'F1', 'ACCEPTED', 'Mid', 1)`,
    )
    .run();
  project
    .prepare(
      `INSERT INTO attempts(id, task, n, epoch, brief_version, runtime, model, connection, base_commit, state, started_at)
       VALUES ('A-1', 'T1', 1, 1, 1, 'own', 'm', 'c', 'abc', 'accepted', 1)`,
    )
    .run();
  project
    .prepare(
      `INSERT INTO artifacts(id, hash, kind, bytes, retention, created_at)
       VALUES ('ART-1', :hash, 'log', :bytes, 'evidence', 1)`,
    )
    .run({ hash, bytes });
  project
    .prepare(
      `INSERT INTO check_results(check_id, attempt, check_version, artifact_digest, status, receipt, recorded_at)
       VALUES ('CK-1', 'A-1', 1, :digest, 'pass', 'receipt-1', 1)`,
    )
    .run({ digest: hash });
  project
    .prepare(
      `INSERT INTO check_results(check_id, attempt, check_version, artifact_digest, status, receipt, recorded_at)
       VALUES ('CK-1', 'A-1', 2, 'ART-1', 'pass', 'receipt-2', 1)`,
    )
    .run();
  project.exec("COMMIT");
}

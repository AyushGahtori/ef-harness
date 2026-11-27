import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { splitSearchText } from "@ef-harness/shared-contracts";
import { encodeSeekableLog } from "../../src/artifacts/seekable-zstd.js";
import { blobFilePath } from "../../src/cas/layout.js";
import { computeNodeContentHash, computeSecretHmac } from "../../src/secret-purge/canonical.js";
import { RawFileCasBlobStore } from "../../src/secret-purge/cas-store.js";
import { SecretPurgeEngine } from "../../src/secret-purge/engine.js";
import { ensureSearchTextFunction } from "../../src/secret-purge/sqlite-util.js";
import {
  PurgeLockUnavailableError,
  SecretTooShortError,
  type StructuredLogEvent,
} from "../../src/secret-purge/types.js";

const CANARY = ["sk", "_live_", "canary_9988776655"].join("");
const GITHUB_CANARY = ["ghp", "_", "canarysecond99887766"].join("");
const HMAC_KEY = "local-test-hmac-key";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function readAsset(name: "state.sql" | "global.sql" | "telemetry.sql"): string {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  return fs.readFileSync(path.join(root, "schema", name), "utf8");
}

function openState(filePath: string): DatabaseSync {
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA secure_delete = ON");
  db.function("ef_search_text", { deterministic: true }, (value) => splitSearchText(value));
  db.exec(readAsset("state.sql"));
  return db;
}

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "secret-purge-"));
  roots.push(root);
  return root;
}

function textOf(db: DatabaseSync, sql: string): string {
  const row = db.prepare(sql).get();
  if (!row) return "";
  return Object.values(row)
    .map((value) => (value == null ? "" : String(value)))
    .join("\n");
}

function plantProject(root: string, secret: string): {
  state: DatabaseSync;
  statePath: string;
  global: DatabaseSync;
  cas: RawFileCasBlobStore;
  casRoot: string;
  seekablePath: string;
  backupsDir: string;
  telemetryPath: string;
  logsDir: string;
} {
  const statePath = path.join(root, "state.db");
  const state = openState(statePath);
  state.exec("BEGIN IMMEDIATE");
  state
    .prepare(
      "INSERT INTO change_sets(id, rev, origin, author, created_at, summary, origin_ref) VALUES ('CS-1', 1, 'chat', 'dev', 1, ?, ?)",
    )
    .run(`summary ${secret}`, `origin ${secret}`);
  state
    .prepare(
      `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, status, change_set, created_rev, updated_rev)
       VALUES ('F01', 'feature', 1, 'h-F01', 'Feature', '', '{}', 'active', 'CS-1', 1, 1)`,
    )
    .run();
  state
    .prepare(
      `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, status, change_set, created_rev, updated_rev)
       VALUES ('T01', 'task', 1, 'h-v1', 'Draft', ?, '{}', 'active', 'CS-1', 1, 1)`,
    )
    .run(`alpha ${secret}`);
  state.exec("COMMIT");
  state
    .prepare(
      "UPDATE nodes SET version = 2, content_hash = 'h-v2', title = ?, text = ?, updated_rev = 1 WHERE id = 'T01'",
    )
    .run("Kitchen print totals", `Orders close at 10 and ${secret}`);
  state
    .prepare(
      "INSERT INTO task_runtime(task, feature, state, level, updated_rev) VALUES ('T01', 'F01', 'READY', 'Mid', 1)",
    )
    .run();
  state
    .prepare(
      `INSERT INTO attempts(id, task, n, epoch, brief_version, runtime, model, connection, base_commit, state, started_at)
       VALUES ('A0014', 'T01', 1, 1, 2, 'own', 'fake', 'local', 'abc', 'running', 1)`,
    )
    .run();
  state
    .prepare("INSERT INTO turn_log(attempt, step, result_summary) VALUES ('A0014', 1, ?)")
    .run(`worker saw ${secret}`);
  state
    .prepare(
      `INSERT INTO candidates(id, task, attempt, epoch, commit_sha, payload, received_at)
       VALUES ('CAN-1', 'T01', 'A0014', 1, 'abc', ?, 1)`,
    )
    .run(JSON.stringify({ note: secret }));
  state
    .prepare("INSERT INTO turns(id, author, text, created_at) VALUES ('TURN-1', 'developer', ?, 1)")
    .run(`please use ${secret}`);
  state
    .prepare(
      `INSERT INTO evidence(node, node_version, source_kind, source_ref, locator, quote)
       VALUES ('T01', 2, 'turn', 'TURN-1', '{}', ?)`,
    )
    .run(Buffer.from(secret, "utf8").toString("base64"));
  state
    .prepare("INSERT INTO outbox(id, type, payload, created_at) VALUES ('EV-1', 'note', ?, 1)")
    .run(JSON.stringify({ body: secret }));
  state
    .prepare(
      "INSERT INTO inbox_items(id, kind, priority, status, payload, created_at) VALUES ('IN-1', 'secret', 1, 'open', ?, 1)",
    )
    .run(JSON.stringify({ pasted: secret }));
  state
    .prepare(
      "INSERT INTO export_state(target, last_rev, commit_sha, history_seg, updated_at) VALUES ('harness-state', 1, ?, 1, 1)",
    )
    .run("0123456789abcdef0123456789abcdef01234567");

  const globalPath = path.join(root, "global.db");
  const global = new DatabaseSync(globalPath);
  global.exec(readAsset("global.sql"));
  const casRoot = path.join(root, "cas");
  const cas = new RawFileCasBlobStore({ root: casRoot, globalDb: global, now: () => 1 });
  const blob = cas.putBlob(Buffer.from(`build log ${secret}\n`, "utf8"), {
    holderKind: "project",
    holderId: "P1",
  });
  state
    .prepare(
      "INSERT INTO artifacts(id, hash, kind, bytes, mime, retention, created_at) VALUES ('ART-1', ?, 'log', ?, 'text/plain', 'diagnostic', 1)",
    )
    .run(blob.hash, blob.bytes);
  const leaked = `seekable ${secret}\n`;
  const framed = encodeSeekableLog(leaked, 4096);
  const seekable = cas.putBlob(Buffer.from(leaked, "utf8"), {
    holderKind: "project",
    holderId: "P1",
    format: "zstd-seekable",
    storedPayload: framed.stored,
  });
  state
    .prepare(
      "INSERT INTO artifacts(id, hash, kind, bytes, mime, retention, created_at) VALUES ('ART-SEEK', ?, 'log', ?, 'text/plain', 'diagnostic', 1)",
    )
    .run(seekable.hash, seekable.bytes);
  const seekablePath = blobFilePath(casRoot, seekable.hash, "zstd");

  const backupsDir = path.join(root, "backups");
  fs.mkdirSync(backupsDir, { recursive: true });
  const backupPath = path.join(backupsDir, "hourly.db");
  state.exec(`VACUUM INTO '${backupPath.replaceAll("\\", "/")}'`);

  const telemetryPath = path.join(root, "telemetry.db");
  const telemetry = new DatabaseSync(telemetryPath);
  telemetry.exec(readAsset("telemetry.sql"));
  telemetry.prepare("INSERT INTO telemetry(ts, kind, data) VALUES (1, 'progress', ?)").run(secret);
  telemetry.close();

  const logsDir = path.join(root, "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(path.join(logsDir, "efharness-test.jsonl"), `${JSON.stringify({ msg: secret })}\n`);

  return { state, statePath, global, cas, casRoot, seekablePath, backupsDir, telemetryPath, logsDir };
}

function assertFileMisses(filePath: string, secret: string): void {
  const bytes = fs.existsSync(filePath) ? fs.readFileSync(filePath) : Buffer.alloc(0);
  expect(bytes.indexOf(Buffer.from(secret, "utf8"))).toBe(-1);
}

function walk(directory: string, found: string[]): void {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else found.push(full);
  }
}

describe("secret purge engine", { timeout: 20_000 }, () => {
  it("registers the canonical ef_search_text acronym split", () => {
    const db = new DatabaseSync(":memory:");
    ensureSearchTextFunction(db);
    const row = db.prepare("SELECT ef_search_text('XMLHttpRequest') AS probe").get();
    expect(row?.["probe"]).toBe("XMLHttpRequest XML Http Request");
    expect(row?.["probe"]).toBe(splitSearchText("XMLHttpRequest"));
    db.close();
  });

  it("erases the canary from state, wal, backups, CAS, telemetry, and logs", () => {
    const root = tempRoot();
    const project = plantProject(root, CANARY);
    const lines: string[] = [];
    const searchCalls: string[] = [];
    const engine = new SecretPurgeEngine({
      stateDb: project.state,
      stateDbPath: project.statePath,
      projectId: "P1",
      hmacKey: HMAC_KEY,
      computeNodeContentHash,
      computeSecretHmac,
      cas: project.cas,
      casRoot: project.casRoot,
      globalDb: project.global,
      backupsDir: project.backupsDir,
      telemetryDbPath: project.telemetryPath,
      logsDir: project.logsDir,
      search: {
        optimizeSearchIndexes(): void {
          searchCalls.push("optimize");
        },
        rebuildSearchIndexes(): void {
          searchCalls.push("rebuild");
        },
      },
      logSink: {
        write(event: StructuredLogEvent): void {
          lines.push(JSON.stringify(event));
        },
      },
      now: () => 1_700_000_000_000,
    });

    const located = engine.locateSecret(CANARY);
    expect(located.occurrences.some((hit) => hit.table === "node_versions")).toBe(true);
    expect(located.occurrences.some((hit) => hit.table === "turns")).toBe(true);
    expect(located.occurrences.some((hit) => hit.table === "evidence" && hit.variant === "base64")).toBe(
      true,
    );
    expect(located.reachedExportableState).toBe(true);

    const receipt = engine.executeSecretPurge(CANARY, { remotePushed: true });
    expect(receipt.status).toBe("complete");
    expect(receipt.partial).toBe(false);
    expect(receipt.rotationMandatory).toBe(true);
    expect(receipt.rotationUrl).toBe("https://dashboard.stripe.com/apikeys");
    expect(receipt.rotationGuidance.toLowerCase()).toContain("ssd");
    expect(receipt.remoteHistoryRewriteRequired).toBe(true);
    expect(receipt.remoteHistoryRewriteMessage.toLowerCase()).toContain("explicit");
    expect(receipt.remoteHistoryRewriteMessage.toLowerCase()).toContain("force-push");
    expect(receipt.hashMapArtifact).toBeTruthy();
    expect(receipt.counts["nodes"]).toBeGreaterThan(0);
    expect(receipt.counts["node_versions"]).toBeGreaterThanOrEqual(2);
    expect(receipt.counts["turns"]).toBe(1);
    expect(receipt.counts["evidence"]).toBe(1);
    expect(receipt.counts["outbox"]).toBe(1);
    expect(receipt.counts["change_sets"]).toBe(1);
    expect(receipt.counts["candidates"]).toBe(1);
    expect(receipt.counts["inbox_items"]).toBe(1);
    expect(receipt.counts["turn_log"]).toBe(1);
    expect(receipt.counts["cas_blobs"]).toBeGreaterThan(0);
    expect(receipt.counts["backups"]).toBe(1);
    expect(searchCalls).toEqual(["optimize", "rebuild"]);

    const secretBytes = Buffer.from(CANARY, "utf8");
    expect(fs.readFileSync(project.statePath).indexOf(secretBytes)).toBe(-1);
    assertFileMisses(`${project.statePath}-wal`, CANARY);
    for (const name of fs.readdirSync(project.backupsDir)) {
      if (!name.endsWith(".db")) continue;
      assertFileMisses(path.join(project.backupsDir, name), CANARY);
    }
    const casFiles: string[] = [];
    walk(project.casRoot, casFiles);
    for (const filePath of casFiles) assertFileMisses(filePath, CANARY);
    expect(fs.existsSync(project.seekablePath)).toBe(false);
    assertFileMisses(project.telemetryPath, CANARY);
    assertFileMisses(`${project.telemetryPath}-wal`, CANARY);
    for (const name of fs.readdirSync(project.logsDir)) {
      assertFileMisses(path.join(project.logsDir, name), CANARY);
    }
    const encoded = Buffer.from(CANARY, "utf8").toString("base64");
    expect(fs.readFileSync(project.statePath).indexOf(Buffer.from(encoded, "utf8"))).toBe(-1);

    const redactions = project.state.prepare("SELECT * FROM redactions").all();
    expect(redactions).toHaveLength(1);
    const redaction = redactions[0];
    expect(redaction?.["secret_fingerprint"]).toBe(computeSecretHmac(CANARY, HMAC_KEY));
    expect(String(redaction?.["label"])).toBe("[REDACTED:STRIPE_SECRET_KEY]");
    expect(String(redaction?.["hash_map_artifact"])).toBe(receipt.hashMapArtifact);
    const counts = JSON.parse(String(redaction?.["counts"])) as Record<string, number>;
    expect(counts["nodes"]).toBeGreaterThan(0);
    expect(JSON.stringify(redactions)).not.toContain(CANARY);
    expect(lines.join("\n")).not.toContain(CANARY);

    const artifact = project.state
      .prepare("SELECT hash FROM artifacts WHERE id = ?")
      .get(String(receipt.hashMapArtifact));
    const map = JSON.parse(Buffer.from(project.cas.getBlob(String(artifact?.["hash"]))).toString("utf8")) as Record<
      string,
      string
    >;
    expect(map["h-v1"]).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(map["h-v2"]).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(map["h-v1"]).not.toBe(map["h-v2"]);

    expect(project.state.prepare("PRAGMA quick_check").all()).toEqual([{ quick_check: "ok" }]);
    expect(project.state.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(project.state.prepare("SELECT version FROM nodes WHERE id = 'T01'").get()?.["version"]).toBe(2);
    expect(
      project.state.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'nodes_version_guard'").get(),
    ).toBeTruthy();

    const printHits = project.state
      .prepare(
        "SELECT n.id AS id FROM kb_words w JOIN nodes n ON n.nid = w.rowid WHERE kb_words MATCH 'print'",
      )
      .all();
    expect(printHits.map((row) => row["id"])).toContain("T01");
    const secretHits = project.state
      .prepare(
        "SELECT n.id AS id FROM kb_words w JOIN nodes n ON n.nid = w.rowid WHERE kb_words MATCH '9988776655'",
      )
      .all();
    expect(secretHits).toEqual([]);

    expect(() => {
      project.state.exec("BEGIN IMMEDIATE");
      project.state.prepare("UPDATE nodes SET title = title || '!' WHERE id = 'T01'").run();
      project.state.exec("COMMIT");
    }).toThrow(/version \+ 1/);
    if (project.state.isTransaction) project.state.exec("ROLLBACK");
    expect(project.state.prepare("SELECT version FROM nodes WHERE id = 'T01'").get()?.["version"]).toBe(2);

    project.state
      .prepare("INSERT INTO turns(id, author, text, created_at) VALUES ('TURN-2', 'developer', ?, 2)")
      .run(`rotate ${GITHUB_CANARY}`);
    const second = engine.executeSecretPurge(GITHUB_CANARY, { remotePushed: false });
    expect(second.rotationUrl).toBe("https://github.com/settings/tokens");
    expect(second.remoteHistoryRewriteRequired).toBe(false);
    const fingerprints = project.state
      .prepare("SELECT secret_fingerprint, hash_map_artifact FROM redactions ORDER BY created_at, id")
      .all();
    expect(fingerprints.length).toBeGreaterThanOrEqual(2);
    expect(fingerprints[0]?.["secret_fingerprint"]).not.toBe(fingerprints.at(-1)?.["secret_fingerprint"]);
    expect(fingerprints[0]?.["hash_map_artifact"]).not.toBe(fingerprints.at(-1)?.["hash_map_artifact"]);
    expect(JSON.stringify(fingerprints)).not.toContain(GITHUB_CANARY);

    project.state.close();
    project.global.close();
  });

  it("rejects trivially short secrets unless the developer forces the purge", () => {
    const root = tempRoot();
    const statePath = path.join(root, "state.db");
    const state = openState(statePath);
    state
      .prepare(
        "INSERT INTO change_sets(id, rev, origin, author, created_at) VALUES ('CS-1', 1, 'kernel', 'dev', 1)",
      )
      .run();
    state
      .prepare(
        `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
         VALUES ('T01', 'task', 1, 'h-1', 'common', '', '{}', 'CS-1', 1, 1)`,
      )
      .run();
    const engine = new SecretPurgeEngine({
      stateDb: state,
      stateDbPath: statePath,
      projectId: "P1",
      hmacKey: HMAC_KEY,
    });
    expect(() => engine.executeSecretPurge("the")).toThrow(SecretTooShortError);
    expect(() => engine.executeSecretPurge("id")).toThrow(SecretTooShortError);
    expect(textOf(state, "SELECT title FROM nodes WHERE id = 'T01'")).toContain("common");
    const forced = engine.executeSecretPurge("common", { forceShortSecret: true });
    expect(forced.rotationMandatory).toBe(true);
    expect(forced.status).toBe("complete");
    expect(textOf(state, "SELECT title FROM nodes WHERE id = 'T01'")).toBe("[REDACTED:SECRET]");
    expect(textOf(state, "SELECT title FROM nodes WHERE id = 'T01'")).not.toContain("common");
    state.close();
  });

  it("fails loudly when readers cannot be drained and leaves the database unchanged", () => {
    const root = tempRoot();
    const project = plantProject(root, CANARY);
    const engine = new SecretPurgeEngine({
      stateDb: project.state,
      stateDbPath: project.statePath,
      projectId: "P1",
      hmacKey: HMAC_KEY,
      cas: project.cas,
      backupsDir: project.backupsDir,
      readers: { drainReaders: () => false },
    });
    expect(() => engine.executeSecretPurge(CANARY)).toThrow(PurgeLockUnavailableError);
    expect(textOf(project.state, "SELECT text FROM nodes WHERE id = 'T01'")).toContain(CANARY);
    expect(project.state.prepare("SELECT count(*) AS n FROM redactions").get()?.["n"]).toBe(0);
    project.state.close();
    project.global.close();
  });

  it("retries a partial backup scrub without putting the secret back", () => {
    const root = tempRoot();
    const project = plantProject(root, CANARY);
    let failBackups = true;
    const engine = new SecretPurgeEngine({
      stateDb: project.state,
      stateDbPath: project.statePath,
      projectId: "P1",
      hmacKey: HMAC_KEY,
      cas: project.cas,
      casRoot: project.casRoot,
      backupsDir: project.backupsDir,
      telemetryDbPath: project.telemetryPath,
      logsDir: project.logsDir,
      hooks: {
        beforeBackupScrub(): void {
          if (failBackups) throw new Error("backup scrub interrupted");
        },
      },
    });
    const first = engine.executeSecretPurge(CANARY, { remotePushed: true });
    expect(first.partial).toBe(true);
    expect(first.status).toBe("partial");
    expect(first.failedStep).toBe("backups");
    expect(first.rotationMandatory).toBe(true);
    expect(first.pendingTargets.length).toBeGreaterThan(0);
    expect(fs.readFileSync(project.statePath).indexOf(Buffer.from(CANARY))).toBe(-1);
    expect(fs.readFileSync(path.join(project.backupsDir, "hourly.db")).indexOf(Buffer.from(CANARY))).not.toBe(-1);

    failBackups = false;
    const second = engine.executeSecretPurge(CANARY, { remotePushed: true });
    expect(second.status).toBe("complete");
    expect(second.partial).toBe(false);
    assertFileMisses(path.join(project.backupsDir, "hourly.db"), CANARY);
    expect(project.state.prepare("PRAGMA quick_check").get()?.["quick_check"]).toBe("ok");
    const rows = project.state.prepare("SELECT id, hash_map_artifact FROM redactions").all();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(new Set(rows.map((row) => row["hash_map_artifact"])).size).toBe(rows.length);
    project.state.close();
    project.global.close();
  });

  it("replaces URL-encoded forms and keeps canonical hashes stable", () => {
    const secret = "token/with space";
    const encoded = encodeURIComponent(secret);
    expect(encoded).not.toBe(secret);
    const root = tempRoot();
    const statePath = path.join(root, "state.db");
    const state = openState(statePath);
    state
      .prepare(
        "INSERT INTO change_sets(id, rev, origin, author, created_at) VALUES ('CS-1', 1, 'chat', 'dev', 1)",
      )
      .run();
    state
      .prepare(
        `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
         VALUES ('T02', 'task', 1, 'h-2', 'Route', ?, '{}', 'CS-1', 1, 1)`,
      )
      .run(`see ${encoded}`);
    const nfd = "e\u0301";
    const nfc = "\u00e9";
    const left = computeNodeContentHash({
      kind: "task",
      title: nfd,
      text: "same",
      fields: { z: 1, a: -0 },
    });
    const right = computeNodeContentHash({
      kind: "task",
      title: nfc,
      text: "same",
      fields: { a: 0, z: 1 },
    });
    expect(left).toBe(right);
    const engine = new SecretPurgeEngine({
      stateDb: state,
      stateDbPath: statePath,
      projectId: "P1",
      hmacKey: HMAC_KEY,
    });
    const receipt = engine.executeSecretPurge(secret);
    expect(receipt.status).toBe("complete");
    expect(receipt.rotationMandatory).toBe(true);
    const stored = fs.readFileSync(statePath);
    expect(stored.indexOf(Buffer.from(secret, "utf8"))).toBe(-1);
    expect(stored.indexOf(Buffer.from(encoded, "utf8"))).toBe(-1);
    expect(textOf(state, "SELECT text FROM nodes WHERE id = 'T02'")).toContain("[REDACTED:SECRET]");
    state.close();
  });
});

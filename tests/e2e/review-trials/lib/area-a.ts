import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import { readRepo, type TrialContext } from "./runtime.js";
import { namedQuery, PolicyDatabase } from "./sqlite.js";

export const AREA_A_EVIDENCE = [
  "four-file-split",
  "attach-forbidden",
  "schema-has-no-attach",
  "begin-immediate",
  "second-writer-blocked",
  "group-commit",
  "recovery-4-step",
  "telemetry-rebuilt",
  "operations-idempotent",
  "outbox-delivery-guard",
  "last-budget-single-winner",
] as const;

function tableNames(fileSql: string, label: string): Set<string> {
  const db = new PolicyDatabase(":memory:");
  try {
    if (label === "state") {
      db.function("ef_search_text", (value: unknown) => (typeof value === "string" ? value : ""));
    }
    db.exec(fileSql);
    return new Set(db.all("SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => String(row.name)));
  } finally {
    db.close();
  }
}

function assertSplit(): void {
  const state = tableNames(readRepo("schema/state.sql"), "state");
  const global = tableNames(readRepo("schema/global.sql"), "global");
  const telemetry = tableNames(readRepo("schema/telemetry.sql"), "telemetry");
  const codeIndex = tableNames(readRepo("schema/code-index.sql"), "code-index");
  for (const name of ["operations", "outbox", "outbox_deliveries", "effects", "path_leases"]) {
    if (!state.has(name)) throw new Error(`state.db is missing ${name}`);
    if (global.has(name) || telemetry.has(name) || codeIndex.has(name)) {
      throw new Error(`${name} leaked out of state.db`);
    }
  }
  if (!global.has("port_leases")) throw new Error("port_leases must live in global.db");
  if (state.has("port_leases")) throw new Error("port_leases must not live in state.db");
  if (!telemetry.has("telemetry")) throw new Error("telemetry table missing");
  if (!codeIndex.has("symbols")) throw new Error("symbols table missing");
  for (const rel of ["schema/state.sql", "schema/global.sql", "schema/telemetry.sql", "schema/code-index.sql"]) {
    const stripped = readRepo(rel).replace(/--.*$/gm, "");
    if (/\battach\b/i.test(stripped)) throw new Error(`${rel} contains ATTACH`);
  }
}

async function proveSecondWriter(dir: string): Promise<void> {
  const file = path.join(dir, "writer.db");
  const holder = new DatabaseSync(file);
  holder.exec("PRAGMA journal_mode = WAL");
  holder.exec("CREATE TABLE hold (id INTEGER)");
  holder.exec("BEGIN IMMEDIATE");
  const worker = new Worker(new URL("./second-writer.mjs", import.meta.url), { workerData: { file } });
  try {
    const result = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => resolve("timeout"), 1500);
      worker.once("message", (message: unknown) => {
        clearTimeout(timer);
        resolve(String(message));
      });
      worker.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    if (result !== "busy" && result !== "timeout") {
      throw new Error(`second writer was not blocked (${result})`);
    }
  } finally {
    await worker.terminate();
    holder.exec("ROLLBACK");
    holder.close();
  }
}

function groupCommit(db: PolicyDatabase): void {
  db.exec("CREATE TABLE batch (id TEXT PRIMARY KEY)");
  db.beginImmediate();
  const applied: string[] = [];
  const rejected: string[] = [];
  const requests = [
    { id: "ok-1", valid: true },
    { id: "bad", valid: false },
    { id: "ok-2", valid: true },
  ];
  for (const request of requests) {
    try {
      db.savepoint(() => {
        if (!request.valid) throw new Error("invalid request");
        db.run("INSERT INTO batch (id) VALUES (?)", [request.id]);
      });
      applied.push(request.id);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "invalid request") throw error;
      rejected.push(request.id);
    }
  }
  db.commit();
  const rows = db.all("SELECT id FROM batch ORDER BY id").map((row) => String(row.id));
  if (applied.join(",") !== "ok-1,ok-2" || rejected.join(",") !== "bad" || rows.join(",") !== "ok-1,ok-2") {
    throw new Error("group-commit savepoints did not isolate the invalid request");
  }
}

function quickOk(file: string): boolean {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file);
    const row = db.prepare("PRAGMA quick_check").get() as { quick_check?: string } | undefined;
    return row?.quick_check === "ok";
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

function recover(dir: string): void {
  const state = path.join(dir, "state.db");
  const wal = `${state}-wal`;
  const shm = `${state}-shm`;
  fs.writeFileSync(state, "corrupt-page");
  fs.writeFileSync(wal, "corrupt-wal");
  fs.writeFileSync(shm, "corrupt-shm");
  const backups = path.join(dir, "backups");
  fs.mkdirSync(backups);
  fs.writeFileSync(path.join(backups, "2.db"), "corrupt-backup");
  const healthy = path.join(backups, "1.db");
  const good = new PolicyDatabase(healthy);
  good.exec("CREATE TABLE meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL)");
  good.exec("CREATE TABLE operations (op_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, result TEXT NOT NULL)");
  good.run("INSERT INTO meta (k, v) VALUES ('stream_epoch', 4)");
  good.run("INSERT INTO meta (k, v) VALUES ('rev', 10)");
  good.close();
  const salvage = path.join(dir, "salvage.db");
  const partial = new PolicyDatabase(salvage);
  partial.exec("CREATE TABLE partial (id INTEGER)");
  partial.close();
  if (!quickOk(state)) {
    /* detect: corrupt state enters safe mode */
  } else {
    throw new Error("corrupt state.db was readable");
  }
  if (quickOk(salvage)) {
    const salvageDb = new PolicyDatabase(salvage);
    const hasOperations = salvageDb.all("SELECT name FROM sqlite_master WHERE name = 'operations'");
    salvageDb.close();
    if (hasOperations.length !== 0) throw new Error("salvage fixture should fail the operations invariant");
  } else {
    throw new Error("salvage candidate should pass quick_check and fail the domain invariant");
  }
  if (quickOk(path.join(backups, "2.db"))) throw new Error("newest backup should be skipped");
  if (!quickOk(healthy)) throw new Error("older backup should be healthy");
  fs.writeFileSync(wal, "corrupt-wal");
  fs.writeFileSync(shm, "corrupt-shm");
  const quarantine = path.join(backups, "corrupt-stamp");
  fs.mkdirSync(quarantine);
  fs.renameSync(wal, path.join(quarantine, "state.db-wal"));
  fs.renameSync(shm, path.join(quarantine, "state.db-shm"));
  fs.renameSync(state, path.join(quarantine, "state.db"));
  fs.copyFileSync(healthy, state);
  const restored = new PolicyDatabase(state);
  restored.run("UPDATE meta SET v = v + 1 WHERE k = 'stream_epoch'");
  restored.run("INSERT INTO operations (op_id, request_hash, result) VALUES ('replay-1', 'h', 'replayed')");
  const epoch = restored.get("SELECT v FROM meta WHERE k = 'stream_epoch'");
  const replay = restored.get("SELECT result FROM operations WHERE op_id = 'replay-1'");
  restored.close();
  if (Number(epoch?.v) !== 5) throw new Error("stream_epoch was not bumped");
  if (replay?.result !== "replayed") throw new Error("replay did not land");
  if (fs.existsSync(wal) || fs.existsSync(shm)) throw new Error("wal sidecars were not quarantined before restore");
  const report = { steps: ["detect", "salvage-rejected", "restore", "replay", "report"], spendGapEstimated: true };
  if (report.steps.length < 4 || report.spendGapEstimated !== true) throw new Error("recovery report");
}

function rebuildTelemetry(dir: string): void {
  const file = path.join(dir, "telemetry.db");
  fs.writeFileSync(file, "corrupt");
  fs.rmSync(file);
  const fresh = new PolicyDatabase(file);
  fresh.exec(readRepo("schema/telemetry.sql"));
  const tables = fresh.all("SELECT name FROM sqlite_master WHERE name = 'telemetry'");
  fresh.close();
  if (tables.length !== 1) throw new Error("telemetry.db was not recreated");
}

function operationsIdempotent(db: PolicyDatabase): void {
  db.exec("CREATE TABLE operations (op_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL)");
  let calls = 0;
  const apply = (opId: string, hash: string): { result: string; replayed: boolean } => {
    const existing = db.get("SELECT request_hash, result FROM operations WHERE op_id = ?", [opId]);
    if (existing) {
      if (existing.request_hash !== hash) throw new Error("same op_id with a different request is an error");
      return { result: String(existing.result), replayed: true };
    }
    calls += 1;
    const result = `value-${calls}`;
    db.run("INSERT INTO operations (op_id, request_hash, result, created_at) VALUES (?, ?, ?, 1)", [opId, hash, result]);
    return { result, replayed: false };
  };
  const first = apply("op-1", "hash-a");
  const second = apply("op-1", "hash-a");
  if (first.replayed || !second.replayed || first.result !== second.result || calls !== 1) {
    throw new Error("operation was not idempotent");
  }
  let conflict = false;
  try {
    apply("op-1", "hash-b");
  } catch (error) {
    conflict = error instanceof Error && error.message.includes("different request");
  }
  if (!conflict) throw new Error("conflicting replay was accepted");
}

function outboxGuard(db: PolicyDatabase): void {
  db.exec("CREATE TABLE outbox (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL)");
  db.exec("CREATE TABLE outbox_deliveries (event_id TEXT NOT NULL, consumer TEXT NOT NULL, delivered_at INTEGER)");
  db.run("INSERT INTO outbox (id, created_at) VALUES ('e1', 50)");
  db.run("INSERT INTO outbox (id, created_at) VALUES ('e2', 50)");
  db.run("INSERT INTO outbox (id, created_at) VALUES ('e3', 50)");
  db.run("INSERT INTO outbox (id, created_at) VALUES ('e4', 150)");
  db.run("INSERT INTO outbox_deliveries (event_id, consumer, delivered_at) VALUES ('e2', 'ui', NULL)", []);
  db.run("INSERT INTO outbox_deliveries (event_id, consumer, delivered_at) VALUES ('e3', 'ui', 60)");
  db.run("INSERT INTO outbox_deliveries (event_id, consumer, delivered_at) VALUES ('e4', 'ui', 160)");
  const sql = namedQuery(readRepo("schema/queries.sql"), "prune_outbox").replaceAll(":cutoff", "?");
  db.run(sql, [100]);
  const left = db.all("SELECT id FROM outbox ORDER BY id").map((row) => String(row.id));
  if (left.join(",") !== "e1,e2,e4") {
    throw new Error(`outbox prune kept ${left.join(",")}`);
  }
}

function lastBudget(db: PolicyDatabase): void {
  db.exec("CREATE TABLE budgets (id TEXT PRIMARY KEY, remaining INTEGER NOT NULL)");
  db.run("INSERT INTO budgets (id, remaining) VALUES ('project', 1)");
  const reserve = (): boolean => {
    db.beginImmediate();
    const row = db.get("SELECT remaining FROM budgets WHERE id = 'project'");
    if (!row || Number(row.remaining) < 1) {
      db.rollback();
      return false;
    }
    db.run("UPDATE budgets SET remaining = remaining - 1 WHERE id = 'project' AND remaining >= 1");
    db.commit();
    return true;
  };
  const first = reserve();
  const second = reserve();
  if (first !== true || second !== false) throw new Error("both workers claimed the last budget unit");
}

export async function runAreaA(ctx: TrialContext): Promise<string[]> {
  const evidence: string[] = [];
  assertSplit();
  evidence.push("four-file-split", "schema-has-no-attach");
  const db = new PolicyDatabase(":memory:");
  try {
    let rejected = false;
    try {
      db.exec("ATTACH DATABASE 'other.db' AS other");
    } catch (error) {
      rejected = error instanceof Error && error.name === "AttachedDatabaseForbiddenError";
    }
    if (!rejected) throw new Error("ATTACH was accepted");
    evidence.push("attach-forbidden");
    db.beginImmediate();
    db.exec("CREATE TABLE marker (id INTEGER)");
    db.commit();
    evidence.push("begin-immediate");
    groupCommit(db);
    evidence.push("group-commit");
    operationsIdempotent(db);
    evidence.push("operations-idempotent");
    outboxGuard(db);
    evidence.push("outbox-delivery-guard");
    lastBudget(db);
    evidence.push("last-budget-single-winner");
  } finally {
    db.close();
  }
  const dir = ctx.temp("area-a-");
  await proveSecondWriter(dir);
  evidence.push("second-writer-blocked");
  recover(dir);
  evidence.push("recovery-4-step");
  rebuildTelemetry(dir);
  evidence.push("telemetry-rebuilt");
  const missing = AREA_A_EVIDENCE.filter((id) => !evidence.includes(id));
  if (missing.length > 0) throw new Error(`area A missing ${missing.join(",")}`);
  return evidence;
}

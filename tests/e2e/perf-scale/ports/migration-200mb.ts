import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { peakRssMb } from "../stats.ts";

export const TARGET_DB_BYTES = 200 * 1024 * 1024;
const PAYLOAD_BYTES = 8 * 1024;

export interface MigrationSloResult {
  migrationMs: number;
  peakRamMb: number;
  integrityOk: boolean;
  lostRows: number;
  pass: boolean;
  detail: string[];
}

function schemaV1(db: DatabaseSync): void {
  db.exec(`CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE turn_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    turn_no INTEGER NOT NULL,
    payload TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    turn_id INTEGER NOT NULL,
    blob TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id INTEGER NOT NULL,
    body TEXT NOT NULL
  )`);
  db.exec(`CREATE VIRTUAL TABLE turn_fts USING fts5(payload, content='turn_log', content_rowid='id')`);
  db.exec("PRAGMA user_version = 1");
}

export function synthesizeHeavyStateDb(dbPath: string, targetBytes = TARGET_DB_BYTES): number {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath, { force: true });
  const db = new DatabaseSync(dbPath);
  const payload = "z".repeat(PAYLOAD_BYTES);
  try {
    schemaV1(db);
    db.exec("BEGIN");
    const turn = db.prepare("INSERT INTO turn_log (turn_no, payload) VALUES (?, ?)");
    const checkpoint = db.prepare("INSERT INTO checkpoints (turn_id, blob) VALUES (?, ?)");
    const revision = db.prepare("INSERT INTO revisions (node_id, body) VALUES (?, ?)");
    let row = 0;
    let pages = 0;
    while (pages * 4096 < targetBytes) {
      turn.run(row, `${payload}-${row}`);
      const turnId = row + 1;
      checkpoint.run(turnId, `${payload}-chk-${row}`);
      revision.run(row % 10_000, `${payload}-rev-${row}`);
      row += 1;
      if (row % 200 === 0) {
        db.exec("COMMIT");
        db.exec("BEGIN");
        pages = Number((db.prepare("PRAGMA page_count").get() as { page_count: number }).page_count);
      }
    }
    db.exec("COMMIT");
    db.exec("INSERT INTO turn_fts(turn_fts) VALUES('rebuild')");
    db.exec("INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, 'v1_baseline', '2026-01-01T00:00:00.000Z')");
    return row;
  } finally {
    db.close();
  }
}

/** Local ports: Task 015 `MigrationAndRebuildEngine` + Task 016 online backup. */
export class MigrationAndRebuildEngine {
  migrate(dbPath: string): { migrationMs: number; peakRamMb: number; lostRows: number } {
    const peak = { value: peakRssMb() };
    const samplePeak = (): void => {
      peak.value = Math.max(peak.value, peakRssMb());
    };
    const backupPath = `${dbPath}.pre-migration.bak`;
    const started = performance.now();
    const db = new DatabaseSync(dbPath);
    try {
      samplePeak();
      db.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
      samplePeak();
      const beforeTurns = Number((db.prepare("SELECT COUNT(*) AS c FROM turn_log").get() as { c: number }).c);
      db.exec("BEGIN IMMEDIATE");
      db.exec("ALTER TABLE revisions ADD COLUMN migrated_at TEXT NOT NULL DEFAULT '2026-11-22T00:00:00.000Z'");
      db.exec("CREATE INDEX IF NOT EXISTS revisions_migrated_at ON revisions(migrated_at)");
      db.exec("PRAGMA user_version = 2");
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (2, 'v2_perf_scale', datetime('now'))").run();
      db.exec("COMMIT");
      samplePeak();
      samplePeak();
      const afterTurns = Number((db.prepare("SELECT COUNT(*) AS c FROM turn_log").get() as { c: number }).c);
      return {
        migrationMs: performance.now() - started,
        peakRamMb: peak.value,
        lostRows: beforeTurns - afterTurns,
      };
    } finally {
      db.close();
    }
  }

  integrityCheck(dbPath: string): boolean {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const quick = String(db.prepare("PRAGMA quick_check").get()?.quick_check ?? "");
      const integrity = String(db.prepare("PRAGMA integrity_check").get()?.integrity_check ?? "");
      return quick === "ok" && integrity === "ok";
    } finally {
      db.close();
    }
  }
}

export function certifySlo4Migration(scratchDir?: string): MigrationSloResult {
  const dir = scratchDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "ef-perf-200mb-"));
  const dbPath = path.join(dir, "state.db");
  const detail: string[] = [];
  try {
    synthesizeHeavyStateDb(dbPath);
    const sizeMb = Math.round(fs.statSync(dbPath).size / (1024 * 1024));
    if (sizeMb < 190) detail.push(`synthetic db only ${sizeMb} MB (< 200 MB target)`);
    const engine = new MigrationAndRebuildEngine();
    const { migrationMs, peakRamMb, lostRows } = engine.migrate(dbPath);
    const integrityOk = engine.integrityCheck(dbPath);
    if (!(migrationMs < 15_000)) detail.push(`migration ${migrationMs} ms >= 15000`);
    if (!(peakRamMb < 400)) detail.push(`peak RSS ${peakRamMb} MB >= 400`);
    if (lostRows !== 0) detail.push(`lost rows ${lostRows}`);
    if (!integrityOk) detail.push("PRAGMA integrity_check !== ok");
    return { migrationMs, peakRamMb, integrityOk, lostRows, pass: detail.length === 0, detail };
  } finally {
    if (!scratchDir) fs.rmSync(dir, { recursive: true, force: true });
  }
}
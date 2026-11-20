import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { FinalAuditError } from "./errors.js";
import type { AuditCheck, LandingSummary, ShardRun } from "./types.js";

const MIGRATION = `
CREATE TABLE IF NOT EXISTS final_audit_runs (
  run_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'complete')),
  fix_rounds INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS final_audit_checks (
  run_id TEXT NOT NULL,
  check_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (run_id, check_id)
) STRICT;

CREATE TABLE IF NOT EXISTS final_audit_shards (
  run_id TEXT NOT NULL,
  shard_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (run_id, shard_id)
) STRICT;

CREATE TABLE IF NOT EXISTS final_audit_summaries (
  run_id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL
) STRICT;
`;

function encode(value: unknown): unknown {
  if (typeof value === "bigint") return { $u: value.toString() };
  if (Array.isArray(value)) return value.map((item) => encode(item));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = encode(item);
    return out;
  }
  return value;
}

function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => decode(item));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length === 1 && typeof record.$u === "string" && /^\d+$/.test(record.$u)) {
      return BigInt(record.$u);
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) out[key] = decode(item);
    return out;
  }
  return value;
}

function toJson(value: unknown): string {
  return JSON.stringify(encode(value));
}

function fromJson<T>(payload: string, label: string): T {
  try {
    return decode(JSON.parse(payload) as unknown) as T;
  } catch {
    throw new FinalAuditError("corrupt_checkpoint", `${label} checkpoint is not JSON`);
  }
}

/** Crash-resumable completion-wave checkpoint. Tables are additive until schema/ can adopt them. */
export class FinalAuditStore {
  private constructor(private readonly db: DatabaseSync) {}

  static open(path = ":memory:"): FinalAuditStore {
    const db = new DatabaseSync(path);
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(MIGRATION);
    return new FinalAuditStore(db);
  }

  close(): void {
    this.db.close();
  }

  beginRun(projectId: string): string {
    const existing = this.db
      .prepare(
        "SELECT run_id FROM final_audit_runs WHERE project_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1",
      )
      .get(projectId) as { run_id: string } | undefined;
    if (existing) return existing.run_id;
    const runId = randomUUID();
    this.db
      .prepare("INSERT INTO final_audit_runs (run_id, project_id, status, fix_rounds, created_at) VALUES (?, ?, 'open', 0, ?)")
      .run(runId, projectId, Date.now());
    return runId;
  }

  completeRun(runId: string, fixRounds: number): void {
    this.db.prepare("UPDATE final_audit_runs SET status = 'complete', fix_rounds = ? WHERE run_id = ?").run(fixRounds, runId);
  }

  readFixRounds(runId: string): number {
    const row = this.db.prepare("SELECT fix_rounds FROM final_audit_runs WHERE run_id = ?").get(runId) as
      | { fix_rounds: number }
      | undefined;
    return row?.fix_rounds ?? 0;
  }

  saveFixRounds(runId: string, fixRounds: number): void {
    this.db.prepare("UPDATE final_audit_runs SET fix_rounds = ? WHERE run_id = ?").run(fixRounds, runId);
  }

  readCheck(runId: string, checkId: string): AuditCheck | null {
    const row = this.db
      .prepare("SELECT payload_json FROM final_audit_checks WHERE run_id = ? AND check_id = ?")
      .get(runId, checkId) as { payload_json: string } | undefined;
    if (!row) return null;
    return fromJson<AuditCheck>(row.payload_json, checkId);
  }

  saveCheck(runId: string, check: AuditCheck): void {
    this.db
      .prepare(
        "INSERT INTO final_audit_checks (run_id, check_id, payload_json) VALUES (?, ?, ?) ON CONFLICT(run_id, check_id) DO UPDATE SET payload_json = excluded.payload_json",
      )
      .run(runId, check.id, toJson(check));
  }

  readShard(runId: string, shardId: string): ShardRun | null {
    const row = this.db
      .prepare("SELECT payload_json FROM final_audit_shards WHERE run_id = ? AND shard_id = ?")
      .get(runId, shardId) as { payload_json: string } | undefined;
    if (!row) return null;
    return fromJson<ShardRun>(row.payload_json, shardId);
  }

  saveShard(runId: string, run: ShardRun): void {
    this.db
      .prepare(
        "INSERT INTO final_audit_shards (run_id, shard_id, payload_json) VALUES (?, ?, ?) ON CONFLICT(run_id, shard_id) DO UPDATE SET payload_json = excluded.payload_json",
      )
      .run(runId, run.shard.id, toJson(run));
  }

  listShardIds(runId: string): string[] {
    const rows = this.db.prepare("SELECT shard_id FROM final_audit_shards WHERE run_id = ? ORDER BY shard_id").all(runId) as {
      shard_id: string;
    }[];
    return rows.map((row) => row.shard_id);
  }

  saveSummary(runId: string, summary: LandingSummary): void {
    this.db
      .prepare(
        "INSERT INTO final_audit_summaries (run_id, payload_json) VALUES (?, ?) ON CONFLICT(run_id) DO UPDATE SET payload_json = excluded.payload_json",
      )
      .run(runId, toJson(summary));
  }

  readSummary(runId: string): LandingSummary | null {
    const row = this.db.prepare("SELECT payload_json FROM final_audit_summaries WHERE run_id = ?").get(runId) as
      | { payload_json: string }
      | undefined;
    if (!row) return null;
    return fromJson<LandingSummary>(row.payload_json, "summary");
  }
}

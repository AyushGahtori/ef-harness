import { DatabaseSync } from "node:sqlite";
import type { FeatureBranchRecord, FeatureBranchStatus } from "./types.js";

export type SqlValue = null | number | string | bigint | Uint8Array;

export interface FeatureBranchStateDb {
  transaction<T>(fn: () => T): T;
  get(sql: string, params: readonly SqlValue[]): Readonly<Record<string, SqlValue>> | undefined;
  all(sql: string, params: readonly SqlValue[]): readonly Readonly<Record<string, SqlValue>>[];
  run(sql: string, params: readonly SqlValue[]): number;
  close(): void;
}

const DDL = `
CREATE TABLE IF NOT EXISTS ref_leases (
  ref          TEXT PRIMARY KEY,
  holder       TEXT NOT NULL,
  epoch        INTEGER NOT NULL,
  expected_sha TEXT,
  expires_at   INTEGER
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS feature_branch_runtime (
  feature_id TEXT PRIMARY KEY,
  feature_slug TEXT NOT NULL,
  wave_id TEXT NOT NULL,
  ref TEXT NOT NULL UNIQUE,
  base_integration_sha TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  verified_head_sha TEXT NOT NULL,
  pinned_base_commit_sha TEXT NOT NULL,
  active_leaf_slots_json TEXT NOT NULL,
  behind_integration_count INTEGER NOT NULL,
  status TEXT NOT NULL,
  sync_reason TEXT,
  landed_by_task INTEGER,
  lease_holder TEXT NOT NULL,
  lease_epoch INTEGER NOT NULL,
  worktree_path TEXT,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS feature_read_sets (
  feature_id TEXT NOT NULL,
  path TEXT NOT NULL,
  PRIMARY KEY (feature_id, path)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS feature_write_scopes (
  feature_id TEXT NOT NULL,
  path_prefix TEXT NOT NULL,
  PRIMARY KEY (feature_id, path_prefix)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS feature_turns (
  feature_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  PRIMARY KEY (feature_id, slot_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS feature_worktree_slots (
  slot_id TEXT PRIMARY KEY,
  feature_id TEXT,
  ref TEXT NOT NULL,
  path TEXT NOT NULL,
  role TEXT NOT NULL
) STRICT;
`;

export function openFeatureBranchStateDb(filePath: string): FeatureBranchStateDb {
  const db = new DatabaseSync(filePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA secure_delete = ON;
    PRAGMA journal_size_limit = 67108864;
    PRAGMA temp_store = MEMORY;
  `);
  db.exec(DDL);
  return new SqliteFeatureBranchStateDb(db);
}

class SqliteFeatureBranchStateDb implements FeatureBranchStateDb {
  constructor(private readonly db: DatabaseSync) {}

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  get(sql: string, params: readonly SqlValue[]): Readonly<Record<string, SqlValue>> | undefined {
    const row = this.db.prepare(sql).get(...params);
    if (!row || typeof row !== "object") return undefined;
    return normalizeRow(row);
  }

  all(sql: string, params: readonly SqlValue[]): readonly Readonly<Record<string, SqlValue>>[] {
    return this.db
      .prepare(sql)
      .all(...params)
      .map((row) => normalizeRow(row));
  }

  run(sql: string, params: readonly SqlValue[]): number {
    const result = this.db.prepare(sql).run(...params);
    return typeof result.changes === "bigint" ? Number(result.changes) : result.changes;
  }

  close(): void {
    this.db.close();
  }
}

function normalizeRow(row: Record<string, unknown>): Readonly<Record<string, SqlValue>> {
  const normalized: Record<string, SqlValue> = {};
  for (const [key, value] of Object.entries(row)) {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "bigint" ||
      value instanceof Uint8Array
    ) {
      normalized[key] = value;
    } else if (typeof value === "boolean") {
      normalized[key] = value ? 1 : 0;
    } else {
      throw new Error(`Unsupported SQL value for ${key}`);
    }
  }
  return normalized;
}

function text(row: Readonly<Record<string, SqlValue>>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Expected text column ${key}`);
  return value;
}

function integer(row: Readonly<Record<string, SqlValue>>, key: string): number {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`Expected integer column ${key}`);
}

function nullableText(row: Readonly<Record<string, SqlValue>>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`Expected text column ${key}`);
  return value;
}

function nullableInteger(row: Readonly<Record<string, SqlValue>>, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`Expected integer column ${key}`);
}

const STATUSES = new Set<FeatureBranchStatus>(["active", "sync_scheduled", "landed", "pruned", "missing_ref"]);

export function rowToRecord(row: Readonly<Record<string, SqlValue>>): FeatureBranchRecord {
  const status = text(row, "status");
  if (!STATUSES.has(status as FeatureBranchStatus)) {
    throw new Error(`Unknown feature branch status ${status}`);
  }
  const slots = JSON.parse(text(row, "active_leaf_slots_json")) as unknown;
  if (!Array.isArray(slots) || slots.some((slot) => typeof slot !== "string")) {
    throw new Error("active_leaf_slots_json must be a string array");
  }
  return {
    featureId: text(row, "feature_id"),
    featureSlug: text(row, "feature_slug"),
    waveId: text(row, "wave_id"),
    ref: text(row, "ref"),
    baseIntegrationSha: text(row, "base_integration_sha"),
    headSha: text(row, "head_sha"),
    verifiedHeadSha: text(row, "verified_head_sha"),
    pinnedBaseCommitSha: text(row, "pinned_base_commit_sha"),
    activeLeafSlots: slots,
    behindIntegrationCount: integer(row, "behind_integration_count"),
    status: status as FeatureBranchStatus,
    syncReason: nullableText(row, "sync_reason"),
    landedByTask: nullableInteger(row, "landed_by_task"),
    leaseHolder: text(row, "lease_holder"),
    leaseEpoch: integer(row, "lease_epoch"),
    worktreePath: nullableText(row, "worktree_path"),
  };
}

export class FeatureBranchStore {
  constructor(private readonly db: FeatureBranchStateDb) {}

  insert(record: FeatureBranchRecord, now: number): void {
    this.db.run(
      `INSERT INTO feature_branch_runtime (
        feature_id, feature_slug, wave_id, ref, base_integration_sha, head_sha, verified_head_sha,
        pinned_base_commit_sha, active_leaf_slots_json, behind_integration_count, status, sync_reason,
        landed_by_task, lease_holder, lease_epoch, worktree_path, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.featureId,
        record.featureSlug,
        record.waveId,
        record.ref,
        record.baseIntegrationSha,
        record.headSha,
        record.verifiedHeadSha,
        record.pinnedBaseCommitSha,
        JSON.stringify(record.activeLeafSlots),
        record.behindIntegrationCount,
        record.status,
        record.syncReason,
        record.landedByTask,
        record.leaseHolder,
        record.leaseEpoch,
        record.worktreePath,
        now,
      ],
    );
  }

  read(featureId: string): FeatureBranchRecord | null {
    const row = this.db.get(`SELECT * FROM feature_branch_runtime WHERE feature_id = ?`, [featureId]);
    return row ? rowToRecord(row) : null;
  }

  list(): FeatureBranchRecord[] {
    return this.db
      .all(`SELECT * FROM feature_branch_runtime ORDER BY feature_id`, [])
      .map((row) => rowToRecord(row));
  }

  save(record: FeatureBranchRecord, now: number): void {
    this.db.run(
      `UPDATE feature_branch_runtime SET
        base_integration_sha = ?, head_sha = ?, verified_head_sha = ?, pinned_base_commit_sha = ?,
        active_leaf_slots_json = ?, behind_integration_count = ?, status = ?, sync_reason = ?,
        landed_by_task = ?, lease_holder = ?, lease_epoch = ?, worktree_path = ?, updated_at = ?
       WHERE feature_id = ?`,
      [
        record.baseIntegrationSha,
        record.headSha,
        record.verifiedHeadSha,
        record.pinnedBaseCommitSha,
        JSON.stringify(record.activeLeafSlots),
        record.behindIntegrationCount,
        record.status,
        record.syncReason,
        record.landedByTask,
        record.leaseHolder,
        record.leaseEpoch,
        record.worktreePath,
        now,
        record.featureId,
      ],
    );
  }

  replacePaths(table: "feature_read_sets" | "feature_write_scopes", column: "path" | "path_prefix", featureId: string, paths: readonly string[]): void {
    this.db.transaction(() => {
      this.db.run(`DELETE FROM ${table} WHERE feature_id = ?`, [featureId]);
      for (const value of paths) {
        this.db.run(`INSERT INTO ${table} (feature_id, ${column}) VALUES (?, ?)`, [featureId, value]);
      }
    });
  }

  paths(table: "feature_read_sets" | "feature_write_scopes", column: "path" | "path_prefix", featureId: string): string[] {
    return this.db
      .all(`SELECT ${column} AS value FROM ${table} WHERE feature_id = ? ORDER BY ${column}`, [featureId])
      .map((row) => text(row, "value"));
  }

  setTurn(featureId: string, slotId: string, phase: "running" | "boundary"): void {
    this.db.run(
      `INSERT INTO feature_turns (feature_id, slot_id, phase) VALUES (?, ?, ?)
       ON CONFLICT (feature_id, slot_id) DO UPDATE SET phase = excluded.phase`,
      [featureId, slotId, phase],
    );
  }

  clearTurn(featureId: string, slotId: string): void {
    this.db.run(`DELETE FROM feature_turns WHERE feature_id = ? AND slot_id = ?`, [featureId, slotId]);
  }

  runningTurns(featureId: string): number {
    const row = this.db.get(
      `SELECT COUNT(*) AS count FROM feature_turns WHERE feature_id = ? AND phase = 'running'`,
      [featureId],
    );
    return row ? integer(row, "count") : 0;
  }

  upsertSlot(slot: { slotId: string; featureId: string | null; ref: string; path: string; role: string }): void {
    this.db.run(
      `INSERT INTO feature_worktree_slots (slot_id, feature_id, ref, path, role) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (slot_id) DO UPDATE SET feature_id = excluded.feature_id, ref = excluded.ref, path = excluded.path, role = excluded.role`,
      [slot.slotId, slot.featureId, slot.ref, slot.path, slot.role],
    );
  }

  removeSlot(slotId: string): void {
    this.db.run(`DELETE FROM feature_worktree_slots WHERE slot_id = ?`, [slotId]);
  }

  slots(): readonly { slotId: string; featureId: string | null; ref: string; path: string; role: string }[] {
    return this.db.all(`SELECT * FROM feature_worktree_slots ORDER BY slot_id`, []).map((row) => ({
      slotId: text(row, "slot_id"),
      featureId: nullableText(row, "feature_id"),
      ref: text(row, "ref"),
      path: text(row, "path"),
      role: text(row, "role"),
    }));
  }
}

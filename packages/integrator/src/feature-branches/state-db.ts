import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  createLifecycleRepo,
  type LifecyclesSqlStatement,
  type LifecyclesSqlValue,
  type LifecyclesStateConnection,
} from "@ef-harness/db";
import { toPrefixedSha256 } from "@ef-harness/shared-contracts";
import { openSharedStateFile } from "../shared-state.js";
import type { FeatureBranchRecord, FeatureBranchStatus } from "./types.js";

export type SqlValue = null | number | string | bigint | Uint8Array;

export interface FeatureBranchStateDb {
  transaction<T>(fn: () => T): T;
  get(sql: string, params: readonly SqlValue[]): Readonly<Record<string, SqlValue>> | undefined;
  all(sql: string, params: readonly SqlValue[]): readonly Readonly<Record<string, SqlValue>>[];
  run(sql: string, params: readonly SqlValue[]): number;
  close(): void;
}

export function openFeatureBranchStateDb(filePath: string): FeatureBranchStateDb {
  return new SqliteFeatureBranchStateDb(openSharedStateFile(filePath));
}

class SqliteFeatureBranchStateDb implements FeatureBranchStateDb {
  readonly lifecycles: LifecyclesStateConnection;

  constructor(private readonly db: DatabaseSync) {
    this.lifecycles = adaptLifecycle(db);
  }

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
    const lifecycles = lifecycleConnection(this.db);
    if (lifecycles) recordFeatureLifecycle(lifecycles, record, now);
    this.db.run(
      `INSERT INTO feature_coordination (
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
    const row = this.db.get(`SELECT * FROM feature_coordination WHERE feature_id = ?`, [featureId]);
    return row ? rowToRecord(row) : null;
  }

  list(): FeatureBranchRecord[] {
    return this.db
      .all(`SELECT * FROM feature_coordination ORDER BY feature_id`, [])
      .map((row) => rowToRecord(row));
  }

  save(record: FeatureBranchRecord, now: number): void {
    this.db.run(
      `UPDATE feature_coordination SET
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

function lifecycleConnection(db: FeatureBranchStateDb): LifecyclesStateConnection | null {
  if (db instanceof SqliteFeatureBranchStateDb) return db.lifecycles;
  return null;
}

function recordFeatureLifecycle(connection: LifecyclesStateConnection, record: FeatureBranchRecord, now: number): void {
  const raw = connection as LifecyclesStateConnection & {
    exec(sql: string): void;
  };
  raw.exec(
    "INSERT INTO change_sets(id, origin, author, created_at) VALUES ('CS-feature-branch', 'planner', 'feature-branch', 0) ON CONFLICT(id) DO NOTHING",
  );
  const hash = toPrefixedSha256(createHash("sha256").update(record.featureId).digest("hex"));
  const existing = connection.prepare("SELECT 1 AS ok FROM nodes WHERE id = :id").get({ id: record.featureId });
  if (!existing) {
    connection
      .prepare(
        `INSERT INTO nodes(
           id, kind, version, content_hash, title, text, fields, status,
           change_set, created_rev, updated_rev
         ) VALUES (:id, 'feature', 1, :hash, :title, '', '{}', 'active', 'CS-feature-branch', 0, 0)`,
      )
      .run({ id: record.featureId, hash, title: record.featureSlug });
  }
  const repo = createLifecycleRepo(connection);
  const branch = `harness/f/${record.featureSlug}`;
  repo.initFeature({ feature: record.featureId, planAuthor: record.leaseHolder, rev: 1, now, branch });
  repo.transitionFeatureState({ feature: record.featureId, to: "JIT_READY", expectedEpoch: 0, rev: 1, now });
  repo.transitionFeatureState({ feature: record.featureId, to: "IN_WAVE", expectedEpoch: 0, rev: 1, now });
}

function adaptLifecycle(db: DatabaseSync): LifecyclesStateConnection {
  return {
    exec(sql: string): void {
      db.exec(sql);
    },
    prepare(sql: string): LifecyclesSqlStatement {
      const statement = db.prepare(sql);
      statement.setAllowBareNamedParameters(true);
      return {
        all(params?: Readonly<Record<string, LifecyclesSqlValue>>) {
          return statement.all(params ?? {}) as Readonly<Record<string, LifecyclesSqlValue>>[];
        },
        get(params?: Readonly<Record<string, LifecyclesSqlValue>>) {
          const row = statement.get(params ?? {});
          if (row === undefined || row === null) return undefined;
          return row as Readonly<Record<string, LifecyclesSqlValue>>;
        },
        run(params?: Readonly<Record<string, LifecyclesSqlValue>>) {
          const result = statement.run(params ?? {});
          return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
        },
      };
    },
  };
}

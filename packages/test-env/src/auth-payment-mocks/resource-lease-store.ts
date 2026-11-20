import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface LeaseHolder {
  readonly projectId: string;
  readonly envId: string;
  readonly jobId?: string;
}

export interface HeldLease {
  readonly resourceKey: string;
  readonly projectId: string;
  readonly envId: string;
  readonly leasedAtMs: number;
  readonly expiresAtMs: number | null;
  readonly jobId: string | null;
  readonly depth: number;
}

export interface GlobalResourceLeaseStore {
  tryAcquire(input: {
    readonly resourceKey: string;
    readonly holder: LeaseHolder;
    readonly nowMs: number;
    readonly expiresAtMs: number | null;
  }): HeldLease | undefined;
  release(resourceKey: string, holder: { readonly projectId: string; readonly envId: string }): boolean;
  forceRelease(resourceKey: string, holder: { readonly projectId: string; readonly envId: string }): boolean;
  releaseEnvironment(projectId: string, envId: string): readonly string[];
  current(resourceKey: string): HeldLease | undefined;
  close(): void;
}

export class SqliteGlobalResourceLeaseStore implements GlobalResourceLeaseStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS resource_leases (
        resource_key TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        environment TEXT NOT NULL,
        leased_at INTEGER NOT NULL,
        expires_at INTEGER,
        job_id TEXT,
        depth INTEGER NOT NULL DEFAULT 1
      ) STRICT
    `);
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS resource_leases_holder ON resource_leases(project, environment)",
    );
  }

  tryAcquire(input: {
    readonly resourceKey: string;
    readonly holder: LeaseHolder;
    readonly nowMs: number;
    readonly expiresAtMs: number | null;
  }): HeldLease | undefined {
    this.db.exec("BEGIN IMMEDIATE");
    let committed = false;
    try {
      const existing = readLease(this.db.prepare(
        "SELECT resource_key, project, environment, leased_at, expires_at, job_id, depth FROM resource_leases WHERE resource_key = ?",
      ).get(input.resourceKey));
      if (existing && existing.expiresAtMs !== null && existing.expiresAtMs <= input.nowMs && !(existing.projectId === input.holder.projectId && existing.envId === input.holder.envId)) {
        this.db.prepare("DELETE FROM resource_leases WHERE resource_key = ?").run(input.resourceKey);
      } else if (existing) {
        if (existing.projectId === input.holder.projectId && existing.envId === input.holder.envId) {
          const depth = existing.depth + 1;
          this.db.prepare(
            "UPDATE resource_leases SET depth = ?, leased_at = ?, expires_at = ?, job_id = ? WHERE resource_key = ?",
          ).run(depth, input.nowMs, input.expiresAtMs, input.holder.jobId ?? null, input.resourceKey);
          this.db.exec("COMMIT");
          committed = true;
          return heldFrom(input, depth);
        }
        this.db.exec("COMMIT");
        committed = true;
        return undefined;
      }
      this.db.prepare(
        "INSERT INTO resource_leases (resource_key, project, environment, leased_at, expires_at, job_id, depth) VALUES (?, ?, ?, ?, ?, ?, 1)",
      ).run(
        input.resourceKey,
        input.holder.projectId,
        input.holder.envId,
        input.nowMs,
        input.expiresAtMs,
        input.holder.jobId ?? null,
      );
      this.db.exec("COMMIT");
      committed = true;
      return heldFrom(input, 1);
    } catch (error) {
      if (!committed) rollbackQuietly(this.db);
      throw error;
    }
  }

  release(resourceKey: string, holder: { readonly projectId: string; readonly envId: string }): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    let committed = false;
    try {
      const existing = readLease(this.db.prepare(
        "SELECT resource_key, project, environment, leased_at, expires_at, job_id, depth FROM resource_leases WHERE resource_key = ?",
      ).get(resourceKey));
      if (!existing || existing.projectId !== holder.projectId || existing.envId !== holder.envId) {
        this.db.exec("COMMIT");
        committed = true;
        return false;
      }
      if (existing.depth > 1) {
        this.db.prepare("UPDATE resource_leases SET depth = depth - 1 WHERE resource_key = ?").run(resourceKey);
      } else {
        this.db.prepare("DELETE FROM resource_leases WHERE resource_key = ? AND project = ? AND environment = ?").run(
          resourceKey,
          holder.projectId,
          holder.envId,
        );
      }
      this.db.exec("COMMIT");
      committed = true;
      return true;
    } catch (error) {
      if (!committed) rollbackQuietly(this.db);
      throw error;
    }
  }

  forceRelease(resourceKey: string, holder: { readonly projectId: string; readonly envId: string }): boolean {
    const result = this.db.prepare(
      "DELETE FROM resource_leases WHERE resource_key = ? AND project = ? AND environment = ?",
    ).run(resourceKey, holder.projectId, holder.envId);
    return result.changes > 0;
  }

  releaseEnvironment(projectId: string, envId: string): readonly string[] {
    const rows = this.db.prepare(
      "SELECT resource_key FROM resource_leases WHERE project = ? AND environment = ?",
    ).all(projectId, envId);
    const keys = rows.map((row) => {
      const key = row.resource_key;
      return typeof key === "string" ? key : "";
    }).filter((key) => key.length > 0);
    this.db.prepare("DELETE FROM resource_leases WHERE project = ? AND environment = ?").run(projectId, envId);
    return keys;
  }

  current(resourceKey: string): HeldLease | undefined {
    return readLease(this.db.prepare(
      "SELECT resource_key, project, environment, leased_at, expires_at, job_id, depth FROM resource_leases WHERE resource_key = ?",
    ).get(resourceKey));
  }

  close(): void {
    this.db.close();
  }
}

function heldFrom(
  input: {
    readonly resourceKey: string;
    readonly holder: LeaseHolder;
    readonly nowMs: number;
    readonly expiresAtMs: number | null;
  },
  depth: number,
): HeldLease {
  return {
    resourceKey: input.resourceKey,
    projectId: input.holder.projectId,
    envId: input.holder.envId,
    leasedAtMs: input.nowMs,
    expiresAtMs: input.expiresAtMs,
    jobId: input.holder.jobId ?? null,
    depth,
  };
}

function readLease(row: unknown): HeldLease | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  const record = row as Record<string, unknown>;
  const resourceKey = record.resource_key;
  const projectId = record.project;
  const envId = record.environment;
  const leasedAtMs = record.leased_at;
  const depth = record.depth;
  if (typeof resourceKey !== "string" || typeof projectId !== "string" || typeof envId !== "string") return undefined;
  if (typeof leasedAtMs !== "number" || typeof depth !== "number") return undefined;
  const expires = record.expires_at;
  const job = record.job_id;
  return {
    resourceKey,
    projectId,
    envId,
    leasedAtMs,
    expiresAtMs: typeof expires === "number" ? expires : null,
    jobId: typeof job === "string" ? job : null,
    depth,
  };
}

function rollbackQuietly(db: DatabaseSync): void {
  try {
    db.exec("ROLLBACK");
  } catch (rollbackError) {
    const message = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
    if (!/no transaction/i.test(message)) throw rollbackError;
  }
}

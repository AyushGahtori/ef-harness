import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { canonicalAssetAbsolute } from "@ef-harness/shared-contracts";
import {
  PORT_RANGE_MAX,
  PORT_RANGE_MIN,
  type LeasePortInput,
  type PortLeaseRecord,
  type PortLeaseStore,
} from "./types.js";

export function openGlobalDatabase(file = ":memory:"): DatabaseSync {
  const database = new DatabaseSync(file);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec(readFileSync(canonicalAssetAbsolute("globalSql"), "utf8"));
  return database;
}

export function ensureBrokerProject(
  database: DatabaseSync,
  project: {
    readonly id: string;
    readonly path: string;
    readonly displayName: string;
    readonly now: number;
  },
): void {
  database
    .prepare(
      `INSERT INTO projects (id, path, display_name, schema_version, status, last_opened_at, last_seen_at)
       VALUES (?, ?, ?, 1, 'ok', ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run(project.id, project.path, project.displayName, project.now, project.now);
}

export class SqlitePortLeaseStore implements PortLeaseStore {
  constructor(private readonly database: DatabaseSync) {}

  leaseNext(input: LeasePortInput): number | null {
    return withImmediate(this.database, () => {
      const used = new Set(
        this.database
          .prepare("SELECT port FROM port_leases")
          .all()
          .map((row) => readNumber(row.port)),
      );
      const insert = this.database.prepare(
        `INSERT INTO port_leases (port, project, environment, leased_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (let port = PORT_RANGE_MIN; port <= PORT_RANGE_MAX; port += 1) {
        if (used.has(port) || input.skip.has(port)) continue;
        insert.run(port, input.projectId, input.environmentId, input.leasedAt, input.expiresAt);
        return port;
      }
      return null;
    });
  }

  release(port: number, environmentId: string): boolean {
    const result = this.database
      .prepare("DELETE FROM port_leases WHERE port = ? AND environment = ?")
      .run(port, environmentId);
    return Number(result.changes) > 0;
  }

  releaseEnvironment(environmentId: string): number[] {
    return withImmediate(this.database, () => {
      const ports = this.list()
        .filter((row) => row.environment === environmentId)
        .map((row) => row.port);
      this.database.prepare("DELETE FROM port_leases WHERE environment = ?").run(environmentId);
      return ports;
    });
  }

  list(): PortLeaseRecord[] {
    return this.database
      .prepare(
        `SELECT port, project, environment, leased_at, expires_at
         FROM port_leases
         ORDER BY port`,
      )
      .all()
      .map(readLease);
  }

  releaseLeasesForDeadEnvironments(liveEnvironmentIds: ReadonlySet<string>): number[] {
    return withImmediate(this.database, () => {
      const released: number[] = [];
      for (const row of this.list()) {
        if (liveEnvironmentIds.has(row.environment)) continue;
        if (this.release(row.port, row.environment)) released.push(row.port);
      }
      return released;
    });
  }
}

function readLease(row: Record<string, SQLOutputValue>): PortLeaseRecord {
  return {
    port: readNumber(row.port),
    project: readString(row.project),
    environment: readString(row.environment),
    leasedAt: readNumber(row.leased_at),
    expiresAt: readNullableNumber(row.expires_at),
  };
}

function withImmediate<T>(database: DatabaseSync, run: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const value = run();
    database.exec("COMMIT");
    return value;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function readNumber(value: SQLOutputValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error("expected an integer column");
}

function readNullableNumber(value: SQLOutputValue | undefined): number | null {
  if (value === null || value === undefined) return null;
  return readNumber(value);
}

function readString(value: SQLOutputValue | undefined): string {
  if (typeof value === "string") return value;
  throw new Error("expected a text column");
}

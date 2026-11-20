import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { canonicalAssetAbsolute } from "@ef-harness/shared-contracts";
import type { EnvProcessRecord, EnvProcessStore } from "./types.js";

export function openStateDatabase(file = ":memory:"): DatabaseSync {
  const database = new DatabaseSync(file);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  database.function("ef_search_text", { deterministic: true }, (value: SQLOutputValue | null) =>
    String(value ?? ""),
  );
  database.exec(readFileSync(canonicalAssetAbsolute("stateSql"), "utf8"));
  return database;
}

export class SqliteEnvProcessStore implements EnvProcessStore {
  constructor(private readonly database: DatabaseSync) {}

  insert(record: EnvProcessRecord): void {
    this.database
      .prepare(
        `INSERT INTO env_processes (pid, start_time, environment, role, port, job_name)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.pid,
        record.startTime,
        record.environment,
        record.role,
        record.port,
        record.jobName,
      );
  }

  delete(pid: number, startTime: number): void {
    this.database
      .prepare("DELETE FROM env_processes WHERE pid = ? AND start_time = ?")
      .run(pid, startTime);
  }

  deleteEnvironment(environmentId: string): void {
    this.database.prepare("DELETE FROM env_processes WHERE environment = ?").run(environmentId);
  }

  list(): EnvProcessRecord[] {
    return this.database
      .prepare(
        `SELECT pid, start_time, environment, role, port, job_name
         FROM env_processes
         ORDER BY start_time, pid`,
      )
      .all()
      .map(readProcess);
  }

  listByEnvironment(environmentId: string): EnvProcessRecord[] {
    return this.list().filter((record) => record.environment === environmentId);
  }
}

function readProcess(row: Record<string, SQLOutputValue>): EnvProcessRecord {
  return {
    pid: readNumber(row.pid),
    startTime: readNumber(row.start_time),
    environment: readString(row.environment),
    role: readString(row.role),
    port: readNullableNumber(row.port),
    jobName: readNullableString(row.job_name),
  };
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

function readNullableString(value: SQLOutputValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  return readString(value);
}

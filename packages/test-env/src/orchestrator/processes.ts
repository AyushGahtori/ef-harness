import type { ProjectStateDb, SqliteConnection } from "@ef-harness/db";
import {
  WindowsJobObjectManager,
  type EnvProcessRow,
  type ProjectStateDb as JobProcessRegistry,
} from "@ef-harness/sandbox";
import type { EnvProcessRecord, EnvProcessStore } from "./types.js";

export class SqliteEnvProcessStore implements EnvProcessStore, JobProcessRegistry {
  private readonly writer: SqliteConnection;

  constructor(stateDb: ProjectStateDb) {
    this.writer = stateDb.writer;
  }

  insert(record: EnvProcessRecord): void {
    this.insertEnvProcess(record);
  }

  insertEnvProcess(row: EnvProcessRow): void {
    this.insertEnvProcesses([row]);
  }

  insertEnvProcesses(rows: readonly EnvProcessRow[]): void {
    this.writer.transaction(() => {
      for (const row of rows) {
        this.writer.run(
          `INSERT INTO env_processes (pid, start_time, environment, role, port, job_name)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [row.pid, row.startTime, row.environment, row.role, row.port, row.jobName],
        );
      }
    });
  }

  delete(pid: number, startTime: number): void {
    this.deleteEnvProcess(pid, startTime);
  }

  deleteEnvProcess(pid: number, startTime: number): void {
    this.writer.transaction(() => {
      this.writer.run("DELETE FROM env_processes WHERE pid = ? AND start_time = ?", [
        pid,
        startTime,
      ]);
    });
  }

  deleteEnvironment(environmentId: string): void {
    this.writer.transaction(() => {
      this.writer.run("DELETE FROM env_processes WHERE environment = ?", [environmentId]);
    });
  }

  list(): EnvProcessRecord[] {
    return [...this.listEnvProcesses()];
  }

  listEnvProcesses(): readonly EnvProcessRow[] {
    return this.writer
      .all(
        `SELECT pid, start_time, environment, role, port, job_name
         FROM env_processes
         ORDER BY start_time, pid`,
      )
      .map(readProcess);
  }

  listByEnvironment(environmentId: string): EnvProcessRecord[] {
    return this.list().filter((record) => record.environment === environmentId);
  }

  close(): void {
    return;
  }
}

export function createWindowsJobObjectManager(registry: JobProcessRegistry): WindowsJobObjectManager {
  return new WindowsJobObjectManager({ registry });
}

function readProcess(row: unknown): EnvProcessRow {
  const record = asRow(row);
  return {
    pid: readNumber(record.pid),
    startTime: readNumber(record.start_time),
    environment: readString(record.environment),
    role: readString(record.role),
    port: readNullableNumber(record.port),
    jobName: readNullableString(record.job_name),
  };
}

function asRow(row: unknown): Record<string, unknown> {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("expected an env_processes row");
  }
  const record: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    record[key] = Reflect.get(row, key);
  }
  return record;
}

function readNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error("expected an integer column");
}

function readNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return readNumber(value);
}

function readString(value: unknown): string {
  if (typeof value === "string") return value;
  throw new Error("expected a text column");
}

function readNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return readString(value);
}

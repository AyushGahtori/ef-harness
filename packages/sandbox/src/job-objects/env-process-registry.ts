import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { EnvProcessRow, ProjectStateDb } from "./types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS env_processes (
  pid         INTEGER NOT NULL,
  start_time  INTEGER NOT NULL,
  environment TEXT NOT NULL,
  role        TEXT NOT NULL,
  port        INTEGER,
  job_name    TEXT,
  PRIMARY KEY (pid, start_time)
) STRICT, WITHOUT ROWID;
`;

export class SqliteProjectStateDb implements ProjectStateDb {
  private readonly db: DatabaseSync;
  private readonly insertStmt;
  private readonly deleteStmt;
  private readonly listStmt;

  constructor(readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec(SCHEMA);
    this.insertStmt = this.db.prepare(
      `INSERT INTO env_processes (pid, start_time, environment, role, port, job_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.deleteStmt = this.db.prepare(
      `DELETE FROM env_processes WHERE pid = ? AND start_time = ?`,
    );
    this.listStmt = this.db.prepare(
      `SELECT pid, start_time, environment, role, port, job_name
       FROM env_processes
       ORDER BY start_time, pid`,
    );
  }

  insertEnvProcess(row: EnvProcessRow): void {
    this.insertEnvProcesses([row]);
  }

  insertEnvProcesses(rows: readonly EnvProcessRow[]): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        this.insertStmt.run(
          row.pid,
          row.startTime,
          row.environment,
          row.role,
          row.port,
          row.jobName,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  deleteEnvProcess(pid: number, startTime: number): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.deleteStmt.run(pid, startTime);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listEnvProcesses(): readonly EnvProcessRow[] {
    const rows = this.listStmt.all() as ReadonlyArray<Record<string, unknown>>;
    return rows.map((row) => ({
      pid: numberField(row, "pid"),
      startTime: numberField(row, "start_time"),
      environment: stringField(row, "environment"),
      role: stringField(row, "role"),
      port: row["port"] === null || row["port"] === undefined ? null : numberField(row, "port"),
      jobName:
        row["job_name"] === null || row["job_name"] === undefined
          ? null
          : stringField(row, "job_name"),
    }));
  }

  close(): void {
    this.db.close();
  }
}

function numberField(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== "number" && typeof value !== "bigint") {
    throw new Error(`env_processes.${key} is not an integer`);
  }
  return Number(value);
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error(`env_processes.${key} is not text`);
  }
  return value;
}

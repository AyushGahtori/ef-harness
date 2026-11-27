import fs from "node:fs";
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";
import {
  openDatabase,
  registerEfSearchText,
  resolveCanonicalSqlAsset,
  type SqliteConnection as DriverSqliteConnection,
} from "../driver/index.js";
import { inspectSql } from "../driver/sql.js";
import { firstCell } from "../driver/values.js";
import { SCHEMA_VIEWS, WRITER_BUSY_TIMEOUT_MS } from "./constants.js";
import { AttachedDatabaseForbiddenError } from "./errors.js";
import type { DatabaseMode } from "./types.js";
import { sqliteErrorCode } from "./writer-lock.js";

export type SqlParam = SQLInputValue;

export class StateConnection {
  constructor(
    readonly driver: DriverSqliteConnection,
    readonly mode: DatabaseMode,
  ) {}

  exec(sql: string): void {
    this.driver.exec(sql);
  }

  get(sql: string, params: readonly SqlParam[] = []): Record<string, SQLOutputValue> | undefined {
    return this.driver.get(sql, params as readonly (string | number | bigint | null | Uint8Array)[]) as
      | Record<string, SQLOutputValue>
      | undefined;
  }

  all(sql: string, params: readonly SqlParam[] = []): Record<string, SQLOutputValue>[] {
    return this.driver.all(sql, params as readonly (string | number | bigint | null | Uint8Array)[]) as Record<
      string,
      SQLOutputValue
    >[];
  }

  run(sql: string, params: readonly SqlParam[] = []): void {
    this.driver.run(sql, params as readonly (string | number | bigint | null | Uint8Array)[]);
  }

  pragmaValue(name: string): SQLOutputValue | undefined {
    if (!/^[a-z0-9_]+$/i.test(name)) {
      throw new Error(`Unsupported pragma ${name}.`);
    }
    return firstCell(this.driver.pragma(name)) as SQLOutputValue | undefined;
  }

  pragmaText(name: string): string {
    const value = this.pragmaValue(name);
    return value === undefined || value === null ? "" : String(value);
  }

  pragmaInteger(name: string): number {
    return asSafeInteger(this.pragmaValue(name), name);
  }

  immediate<T>(work: () => T): T {
    return this.driver.transaction(work);
  }

  checkpointTruncate(): void {
    this.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }

  close(options?: { readonly skipCheckpoint?: boolean }): void {
    this.driver.close(options);
  }
}

export function openStateConnection(filePath: string, mode: DatabaseMode): StateConnection {
  const driver = openDatabase({
    location: filePath,
    role: "state",
    access: mode === "readonly" ? "readonly" : "writer",
  });
  return new StateConnection(driver, mode);
}

export function loadStateSchemaSql(schemaPath = resolveCanonicalSqlAsset("stateSql")): string {
  return fs.readFileSync(schemaPath, "utf8");
}

/** Read `user_version` without applying writer pragmas or running a query. */
export function probeUserVersion(filePath: string): number {
  const db = new DatabaseSync(filePath, {
    readOnly: true,
    readBigInts: false,
    timeout: WRITER_BUSY_TIMEOUT_MS,
    limits: { attach: 0 },
  });
  try {
    db.exec("PRAGMA query_only = ON");
    const row = db.prepare("PRAGMA user_version").get();
    const value = row ? Object.values(row)[0] : 0;
    return asSafeInteger(value, "user_version");
  } finally {
    db.close();
  }
}

export function registerSearchText(db: DatabaseSync): void {
  registerEfSearchText(db);
}

export function assertSqlHasNoAttach(sql: string): void {
  if (inspectSql(sql).attach) throw new AttachedDatabaseForbiddenError();
}

export function readIntegrityReport(connection: StateConnection, kind: "quick_check" | "integrity_check"): string {
  const rows = connection.all(`PRAGMA ${kind}`);
  if (rows.length === 0) return "";
  return rows
    .map((row) => {
      const value = Object.values(row)[0];
      return value === undefined || value === null ? "" : String(value);
    })
    .join("\n");
}

export function integrityReportOk(report: string): boolean {
  if (report.length === 0) return false;
  return report.split("\n").every((line) => line === "ok");
}

export function assertSchemaViews(connection: StateConnection): void {
  for (const view of SCHEMA_VIEWS) {
    connection.get(`SELECT 1 AS ok FROM ${view} LIMIT 1`);
  }
}

export function asSafeInteger(value: SQLOutputValue | undefined, label: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "bigint" && value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)) {
    return Number(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new Error(`${label} is not a safe integer.`);
}

export function classifyWriteFailure(error: unknown): "disk" | "corrupt" | "other" {
  const code = sqliteErrorCode(error);
  if (code === 13 || code === 10) return "disk";
  if (code === 11 || code === 26) return "corrupt";
  const message = error instanceof Error ? error.message : String(error);
  if (/disk is full|database or disk is full|disk i\/o error|SQLITE_FULL|SQLITE_IOERR/i.test(message)) {
    return "disk";
  }
  if (/malformed|corrupt|not a database/i.test(message)) return "corrupt";
  return "other";
}

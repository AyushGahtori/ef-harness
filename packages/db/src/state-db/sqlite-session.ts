import fs from "node:fs";
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";
import { canonicalAssetAbsolute } from "@ef-harness/shared-contracts";
import {
  JOURNAL_SIZE_LIMIT_BYTES,
  SCHEMA_VIEWS,
  WRITER_BUSY_TIMEOUT_MS,
} from "./constants.js";
import {
  AttachedDatabaseForbiddenError,
  NestedWriteTransactionError,
  WalModeRequiredError,
} from "./errors.js";
import type { DatabaseMode } from "./types.js";
import { isNoTransaction, sqliteErrorCode } from "./writer-lock.js";

export type SqlParam = SQLInputValue;

export class StateConnection {
  private writing = false;

  constructor(
    private readonly db: DatabaseSync,
    readonly mode: DatabaseMode,
  ) {}

  exec(sql: string): void {
    assertSqlHasNoAttach(sql);
    this.db.exec(sql);
  }

  get(sql: string, params: readonly SqlParam[] = []): Record<string, SQLOutputValue> | undefined {
    assertSqlHasNoAttach(sql);
    return this.db.prepare(sql).get(...params);
  }

  all(sql: string, params: readonly SqlParam[] = []): Record<string, SQLOutputValue>[] {
    assertSqlHasNoAttach(sql);
    return this.db.prepare(sql).all(...params);
  }

  run(sql: string, params: readonly SqlParam[] = []): void {
    assertSqlHasNoAttach(sql);
    this.db.prepare(sql).run(...params);
  }

  pragmaValue(name: string): SQLOutputValue | undefined {
    if (!/^[a-z0-9_]+$/i.test(name)) {
      throw new Error(`Unsupported pragma ${name}.`);
    }
    const row = this.get(`PRAGMA ${name}`);
    if (!row) return undefined;
    const values = Object.values(row);
    return values[0];
  }

  pragmaText(name: string): string {
    const value = this.pragmaValue(name);
    return value === undefined || value === null ? "" : String(value);
  }

  pragmaInteger(name: string): number {
    return asSafeInteger(this.pragmaValue(name), name);
  }

  immediate<T>(work: () => T): T {
    if (this.writing) throw new NestedWriteTransactionError();
    this.exec("BEGIN IMMEDIATE");
    this.writing = true;
    try {
      const result = work();
      this.exec("COMMIT");
      this.writing = false;
      return result;
    } catch (error) {
      this.writing = false;
      rollbackQuietly(this);
      throw error;
    }
  }

  checkpointTruncate(): void {
    this.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }

  close(): void {
    this.db.close();
  }
}

export function openStateConnection(filePath: string, mode: DatabaseMode): StateConnection {
  const db =
    mode === "readonly"
      ? new DatabaseSync(filePath, { readOnly: true, readBigInts: false, timeout: WRITER_BUSY_TIMEOUT_MS })
      : new DatabaseSync(filePath, { readBigInts: false, timeout: WRITER_BUSY_TIMEOUT_MS });
  const connection = new StateConnection(db, mode);
  try {
    registerSearchText(db);
    if (mode === "readonly") {
      applyReadonlyPragmas(connection);
    } else {
      applyWriterPragmas(connection);
    }
    return connection;
  } catch (error) {
    try {
      db.close();
    } catch (closeError) {
      const message = closeError instanceof Error ? closeError.message : String(closeError);
      if (!/not open|already closed/i.test(message)) throw error;
    }
    throw error;
  }
}

export function loadStateSchemaSql(schemaPath = canonicalAssetAbsolute("stateSql")): string {
  return fs.readFileSync(schemaPath, "utf8");
}

/** Read `user_version` without applying writer pragmas or running a query. */
export function probeUserVersion(filePath: string): number {
  const db = new DatabaseSync(filePath, {
    readOnly: true,
    readBigInts: false,
    timeout: WRITER_BUSY_TIMEOUT_MS,
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
  db.function("ef_search_text", { deterministic: true }, (value: SQLOutputValue) => efSearchText(value));
}

export function efSearchText(value: SQLOutputValue): string {
  if (typeof value !== "string") {
    if (value === null) return "";
    if (typeof value === "number" || typeof value === "bigint") return efSearchText(String(value));
    return "";
  }
  const extra = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-./:]+/g, " ");
  return `${value} ${extra}`;
}

export function assertSqlHasNoAttach(sql: string): void {
  if (/\battach\s+database\b/i.test(sql)) throw new AttachedDatabaseForbiddenError();
}

export function applyWriterPragmas(connection: StateConnection): void {
  const journalMode = connection.pragmaText("journal_mode");
  connection.exec("PRAGMA journal_mode = WAL");
  const applied = connection.pragmaText("journal_mode").toLowerCase();
  if (applied !== "wal") throw new WalModeRequiredError(applied || journalMode);
  connection.exec("PRAGMA synchronous = FULL");
  connection.exec("PRAGMA foreign_keys = ON");
  connection.exec(`PRAGMA busy_timeout = ${WRITER_BUSY_TIMEOUT_MS}`);
  connection.exec("PRAGMA secure_delete = ON");
  connection.exec(`PRAGMA journal_size_limit = ${JOURNAL_SIZE_LIMIT_BYTES}`);
  connection.exec("PRAGMA temp_store = MEMORY");
  if (connection.pragmaInteger("foreign_keys") !== 1) {
    throw new Error("PRAGMA foreign_keys did not stay enabled on state.db.");
  }
}

export function applyReadonlyPragmas(connection: StateConnection): void {
  connection.exec("PRAGMA foreign_keys = ON");
  connection.exec("PRAGMA query_only = ON");
  connection.exec(`PRAGMA busy_timeout = ${WRITER_BUSY_TIMEOUT_MS}`);
  if (connection.pragmaInteger("query_only") !== 1) {
    throw new Error("PRAGMA query_only did not stay enabled on the read-only state.db connection.");
  }
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

function rollbackQuietly(connection: StateConnection): void {
  try {
    connection.exec("ROLLBACK");
  } catch (error) {
    if (isNoTransaction(error)) return;
  }
}

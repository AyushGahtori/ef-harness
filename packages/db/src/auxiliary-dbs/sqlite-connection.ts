import {
  openDatabase,
  type SqliteConnection as DriverSqliteConnection,
  type SqliteStatement as DriverSqliteStatement,
  type SqlValue as DriverSqlValue,
} from "../driver/index.js";
import { firstCell } from "../driver/values.js";
import {
  AttachedDatabaseForbiddenError,
  AuxiliaryDbError,
  ConnectionClosedError,
} from "./errors.js";
import { bigintToNumber } from "./integers.js";
import type { SqlRow, SqlValue } from "./sql-types.js";

export type { SqlRow, SqlValue } from "./sql-types.js";

export interface RunResult {
  readonly changes: number;
  readonly lastInsertRowid: number;
}

export interface SqliteStatement {
  get(...params: readonly SqlValue[]): SqlRow | undefined;
  all(...params: readonly SqlValue[]): SqlRow[];
  run(...params: readonly SqlValue[]): RunResult;
  finalize?(): void;
}

export interface SqliteConnection {
  readonly driver: DriverSqliteConnection;
  readonly filePath: string;
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  get(sql: string, ...params: readonly SqlValue[]): SqlRow | undefined;
  all(sql: string, ...params: readonly SqlValue[]): SqlRow[];
  run(sql: string, ...params: readonly SqlValue[]): RunResult;
  readPragma(name: string): SqlValue | null;
  inTransaction(): boolean;
  runImmediate<T>(fn: () => T): T;
  databaseNames(): readonly string[];
  close(options?: { readonly skipCheckpoint?: boolean }): void;
}

export type ConnectionProfile = "global" | "state" | "telemetry" | "code-index";

const PRAGMA_NAME = /^[a-z_]+$/;

const SQLITE_BUSY = 5;
const SQLITE_CONSTRAINT = 19;

export function sqliteErrorCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("errcode" in error)) return undefined;
  const code = (error as { errcode: unknown }).errcode;
  return typeof code === "number" ? code : undefined;
}

export function isSqliteBusy(error: unknown): boolean {
  const code = sqliteErrorCode(error);
  if (code !== undefined && (code & 0xff) === SQLITE_BUSY) return true;
  return error instanceof Error && /database is locked/i.test(error.message);
}

export function isSqliteConstraint(error: unknown): boolean {
  const code = sqliteErrorCode(error);
  return code !== undefined && (code & 0xff) === SQLITE_CONSTRAINT;
}

export function isSqliteCorruption(error: unknown): boolean {
  const code = sqliteErrorCode(error);
  if (code !== undefined) {
    const primary = code & 0xff;
    // SQLITE_CORRUPT (11) and SQLITE_NOTADB (26), including extended codes.
    if (primary === 11 || primary === 26) return true;
  }
  return error instanceof Error && /not a database|malformed|corrupt/i.test(error.message);
}

export function openSqliteConnection(filePath: string, profile: ConnectionProfile): SqliteConnection {
  const driver = openDatabase({
    location: filePath,
    role: profile,
    access: "writer",
  });
  return new DriverBackedConnection(driver);
}

class DriverBackedConnection implements SqliteConnection {
  constructor(readonly driver: DriverSqliteConnection) {}

  get filePath(): string {
    return this.driver.location;
  }

  exec(sql: string): void {
    this.driver.exec(sql);
  }

  prepare(sql: string): SqliteStatement {
    return new DriverBackedStatement(this.driver.prepare(sql));
  }

  get(sql: string, ...params: readonly SqlValue[]): SqlRow | undefined {
    const row = this.driver.get(sql, toDriverParams(params));
    return row === undefined ? undefined : toRow(row);
  }

  all(sql: string, ...params: readonly SqlValue[]): SqlRow[] {
    return this.driver.all(sql, toDriverParams(params)).map((row) => toRow(row));
  }

  run(sql: string, ...params: readonly SqlValue[]): RunResult {
    const result = this.driver.run(sql, toDriverParams(params));
    return {
      changes: result.changes,
      lastInsertRowid:
        typeof result.lastInsertRowid === "bigint"
          ? bigintToNumber(result.lastInsertRowid)
          : result.lastInsertRowid,
    };
  }

  readPragma(name: string): SqlValue | null {
    if (!this.driver.open) throw new ConnectionClosedError();
    assertPragmaName(name);
    const cell = firstCell(this.driver.pragma(name));
    return cell === undefined ? null : (cell as SqlValue);
  }

  inTransaction(): boolean {
    if (!this.driver.open) throw new ConnectionClosedError();
    return this.driver.inTransaction;
  }

  runImmediate<T>(fn: () => T): T {
    return this.driver.transaction(fn);
  }

  databaseNames(): readonly string[] {
    return this.all("PRAGMA database_list").map((row) => {
      const name = row.name;
      if (typeof name !== "string") {
        throw new AuxiliaryDbError("ROW_SHAPE", "database_list name was not text");
      }
      return name;
    });
  }

  close(options?: { readonly skipCheckpoint?: boolean }): void {
    this.driver.close(options);
  }
}

class DriverBackedStatement implements SqliteStatement {
  constructor(private readonly statement: DriverSqliteStatement) {}

  get(...params: readonly SqlValue[]): SqlRow | undefined {
    const row = this.statement.get(toDriverParams(params));
    return row === undefined ? undefined : toRow(row);
  }

  all(...params: readonly SqlValue[]): SqlRow[] {
    return this.statement.all(toDriverParams(params)).map((row) => toRow(row));
  }

  run(...params: readonly SqlValue[]): RunResult {
    const result = this.statement.run(toDriverParams(params));
    return {
      changes: result.changes,
      lastInsertRowid:
        typeof result.lastInsertRowid === "bigint"
          ? bigintToNumber(result.lastInsertRowid)
          : result.lastInsertRowid,
    };
  }

  finalize(): void {
    this.statement.finalize();
  }
}

function toRow(row: unknown): SqlRow {
  return row as SqlRow;
}

function toDriverParams(params: readonly SqlValue[]): readonly DriverSqlValue[] | undefined {
  if (params.length === 0) return undefined;
  return params.map(toDriverValue);
}

function toDriverValue(value: SqlValue): DriverSqlValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    return value;
  }
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function assertPragmaName(name: string): void {
  if (!PRAGMA_NAME.test(name)) {
    throw new AuxiliaryDbError("PRAGMA_NAME", `unsafe pragma name ${name}`);
  }
}

export function assertConnectionIsolated(connection: SqliteConnection): void {
  const names = connection.databaseNames().filter((name) => name !== "temp");
  if (names.length !== 1 || names[0] !== "main") {
    throw new AttachedDatabaseForbiddenError();
  }
  let rejected = false;
  try {
    connection.exec("ATTACH DATABASE ':memory:' AS ef_forbidden_attach");
  } catch (error) {
    if (!(error instanceof AttachedDatabaseForbiddenError)) throw error;
    rejected = true;
  }
  if (!rejected) throw new AttachedDatabaseForbiddenError();
}

export function assertQuickCheck(connection: SqliteConnection): void {
  const rows = connection.all("PRAGMA quick_check");
  const messages = rows.map((row) => {
    const value = row.quick_check;
    return value === undefined || value === null ? "" : String(value);
  });
  if (messages.length === 1 && messages[0] === "ok") return;
  throw new AuxiliaryDbError(
    "QUICK_CHECK_FAILED",
    messages.join("; ") || "PRAGMA quick_check failed",
  );
}

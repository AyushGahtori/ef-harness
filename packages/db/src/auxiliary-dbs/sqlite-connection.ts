import { constants, DatabaseSync, type StatementSync } from "node:sqlite";
import {
  AttachedDatabaseForbiddenError,
  AuxiliaryDbError,
  ConnectionClosedError,
  NestedWriteTransactionError,
  WalModeRequiredError,
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
}

/**
 * Local stand-in for Task 012's `SqliteConnection`.
 * The handoff records the barrel swap onto `packages/db/src/driver` once that task is integrated.
 */
export interface SqliteConnection {
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
  close(): void;
}

export type ConnectionProfile = "global" | "state" | "telemetry" | "code-index";

const ATTACH_SQL = /\battach\s+database\b/i;
const PRAGMA_NAME = /^[a-z_]+$/;
const PRAGMA_TOKEN = /^[A-Za-z0-9_]+$/;

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
  const db = new DatabaseSync(filePath, {
    timeout: 5000,
    readBigInts: false,
    enableForeignKeyConstraints: true,
  });
  const connection = new NodeSqliteConnection(db, filePath);
  try {
    connection.applyProfile(profile);
    return connection;
  } catch (error) {
    connection.close();
    throw error;
  }
}

class NodeSqliteConnection implements SqliteConnection {
  private closed = false;

  constructor(
    private readonly db: DatabaseSync,
    readonly filePath: string,
  ) {}

  applyProfile(profile: ConnectionProfile): void {
    this.setPragma("foreign_keys", "ON");
    this.setPragma("busy_timeout", 5000);
    this.setPragma("journal_mode", "WAL");
    const journal = String(this.readPragma("journal_mode") ?? "").toLowerCase();
    if (journal !== "wal") throw new WalModeRequiredError(journal);
    if (profile === "telemetry" || profile === "code-index") {
      this.setPragma("synchronous", "NORMAL");
    } else {
      this.setPragma("synchronous", "FULL");
      this.setPragma("secure_delete", "ON");
      this.setPragma("journal_size_limit", 67_108_864);
      this.setPragma("temp_store", "MEMORY");
    }
    this.db.limits.attach = 0;
    this.db.enableDefensive(true);
    this.db.setAuthorizer((actionCode) => {
      if (actionCode === constants.SQLITE_ATTACH) return constants.SQLITE_DENY;
      return constants.SQLITE_OK;
    });
  }

  exec(sql: string): void {
    this.assertOpen();
    rejectAttach(sql);
    this.db.exec(sql);
  }

  prepare(sql: string): SqliteStatement {
    this.assertOpen();
    rejectAttach(sql);
    return new NodeSqliteStatement(this.db.prepare(sql));
  }

  get(sql: string, ...params: readonly SqlValue[]): SqlRow | undefined {
    return this.prepare(sql).get(...params);
  }

  all(sql: string, ...params: readonly SqlValue[]): SqlRow[] {
    return this.prepare(sql).all(...params);
  }

  run(sql: string, ...params: readonly SqlValue[]): RunResult {
    return this.prepare(sql).run(...params);
  }

  readPragma(name: string): SqlValue | null {
    this.assertOpen();
    assertPragmaName(name);
    const row = this.db.prepare(`PRAGMA ${name}`).get();
    if (row === undefined) return null;
    if (Object.prototype.hasOwnProperty.call(row, name)) {
      const named = row[name];
      if (named !== undefined) return named;
    }
    // Some pragmas report a different column (`PRAGMA busy_timeout` returns `timeout`).
    const values = Object.values(row);
    const value = values[0];
    return values.length === 1 && value !== undefined ? value : null;
  }

  inTransaction(): boolean {
    this.assertOpen();
    return this.db.isTransaction;
  }

  runImmediate<T>(fn: () => T): T {
    this.assertOpen();
    if (this.db.isTransaction) throw new NestedWriteTransactionError();
    this.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.db.isOpen && this.db.isTransaction) {
        try {
          this.db.exec("ROLLBACK");
        } catch (rollbackError) {
          throw new AuxiliaryDbError(
            "ROLLBACK_FAILED",
            rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
          );
        }
      }
      throw error;
    }
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

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.db.isOpen) this.db.close();
  }

  private setPragma(name: string, value: string | number): void {
    assertPragmaName(name);
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new AuxiliaryDbError("PRAGMA_VALUE", `unsafe pragma value for ${name}`);
      }
      this.db.exec(`PRAGMA ${name} = ${value}`);
      return;
    }
    if (!PRAGMA_TOKEN.test(value)) {
      throw new AuxiliaryDbError("PRAGMA_VALUE", `unsafe pragma value for ${name}`);
    }
    this.db.exec(`PRAGMA ${name} = ${value}`);
  }

  private assertOpen(): void {
    if (this.closed || !this.db.isOpen) throw new ConnectionClosedError();
  }
}

class NodeSqliteStatement implements SqliteStatement {
  constructor(private readonly statement: StatementSync) {}

  get(...params: readonly SqlValue[]): SqlRow | undefined {
    const row = this.statement.get(...params);
    return row === undefined ? undefined : toRow(row);
  }

  all(...params: readonly SqlValue[]): SqlRow[] {
    return this.statement.all(...params).map((row) => toRow(row));
  }

  run(...params: readonly SqlValue[]): RunResult {
    const result = this.statement.run(...params);
    return {
      changes: typeof result.changes === "bigint" ? bigintToNumber(result.changes) : result.changes,
      lastInsertRowid:
        typeof result.lastInsertRowid === "bigint"
          ? bigintToNumber(result.lastInsertRowid)
          : result.lastInsertRowid,
    };
  }
}

function toRow(row: Record<string, import("node:sqlite").SQLOutputValue>): SqlRow {
  return row;
}

function rejectAttach(sql: string): void {
  if (ATTACH_SQL.test(sql)) throw new AttachedDatabaseForbiddenError();
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

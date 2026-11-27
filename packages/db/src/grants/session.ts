import fs from "node:fs";
import path from "node:path";
import { constants, DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { splitSearchText } from "@ef-harness/shared-contracts";
import {
  AttachedDatabaseForbiddenError,
  MissingQueryParameterError,
  RealDatabaseFileRequiredError,
  WalModeRequiredError,
  WriteOutsideImmediateTransactionError,
  NestedImmediateTransactionError,
  WrongDatabaseRoleError,
} from "./errors.js";
import { loadQueryCatalog, schemaFile, type QueryCatalog } from "./query-catalog.js";

export type GrantDatabaseRole = "global" | "state";

const ATTACH_SQL = /\bATTACH\b/i;
const WRITE_SQL = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i;
const TRANSACTION_SQL = /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|END)\b/i;

const ATTACH_OR_DETACH_SQL = /\b(?:ATTACH|DETACH)\b/i;

export function installCrossDatabaseAttachGuard(db: DatabaseSync): void {
  if (typeof db.setAuthorizer === "function") {
    db.setAuthorizer((actionCode) => {
      if (actionCode === constants.SQLITE_ATTACH || actionCode === constants.SQLITE_DETACH) {
        return constants.SQLITE_DENY;
      }
      return constants.SQLITE_OK;
    });
    return;
  }
  const exec = db.exec.bind(db);
  const prepare = db.prepare.bind(db);
  const denyAttached = (sql: string): void => {
    if (ATTACH_OR_DETACH_SQL.test(sql)) {
      throw new Error("not authorized");
    }
  };
  Object.defineProperty(db, "exec", {
    configurable: true,
    writable: true,
    value(sql: string) {
      denyAttached(sql);
      exec(sql);
    },
  });
  Object.defineProperty(db, "prepare", {
    configurable: true,
    writable: true,
    value(sql: string) {
      denyAttached(sql);
      return prepare(sql);
    },
  });
}

function changeCount(changes: number | bigint): number {
  if (typeof changes === "bigint") {
    return Number(changes);
  }
  return changes;
}

function isAttachDenial(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not authorized|too many attached databases|ATTACH/i.test(message);
}

export interface SqlRow {
  readonly [column: string]: SQLInputValue;
}

export class GrantSqlSession {
  readonly role: GrantDatabaseRole;
  readonly filePath: string;
  private readonly db: DatabaseSync;
  private readonly catalog: QueryCatalog;
  private readonly statements = new Map<string, StatementSync>();
  private inImmediateTransaction = false;
  private closed = false;

  private constructor(role: GrantDatabaseRole, filePath: string, db: DatabaseSync, catalog: QueryCatalog) {
    this.role = role;
    this.filePath = filePath;
    this.db = db;
    this.catalog = catalog;
  }

  static open(role: GrantDatabaseRole, filePath: string, catalog = loadQueryCatalog()): GrantSqlSession {
    if (filePath === ":memory:" || filePath.includes("mode=memory")) {
      throw new RealDatabaseFileRequiredError();
    }
    const resolved = path.resolve(filePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    const db = new DatabaseSync(resolved, {
      enableForeignKeyConstraints: true,
      timeout: 5000,
      readBigInts: false,
      allowBareNamedParameters: true,
      allowUnknownNamedParameters: false,
      limits: { attach: 0 },
    });
    installCrossDatabaseAttachGuard(db);
    const session = new GrantSqlSession(role, resolved, db, catalog);
    session.applyWriterPragmas();
    if (role === "state") {
      db.function("ef_search_text", { deterministic: true }, (value) => splitSearchText(value));
    }
    session.applySchemaIfEmpty();
    session.assertRole();
    session.assertSingleDatabase();
    return session;
  }

  canonicalSql(name: string): string {
    return this.catalog.sql(name);
  }

  isSafeMode(): boolean {
    const row = this.get("SELECT value FROM meta WHERE key = 'safe_mode'");
    return row?.value === "1";
  }

  runImmediate<T>(fn: () => T): T {
    this.assertOpen();
    if (this.inImmediateTransaction) {
      throw new NestedImmediateTransactionError();
    }
    this.execRaw("BEGIN IMMEDIATE");
    this.inImmediateTransaction = true;
    try {
      const result = fn();
      this.execRaw("COMMIT");
      return result;
    } catch (error) {
      this.rollbackIfOpen();
      throw error;
    } finally {
      this.inImmediateTransaction = false;
    }
  }

  get(sql: string, ...params: SQLInputValue[]): SqlRow | undefined {
    this.assertOpen();
    this.rejectForbidden(sql);
    try {
      const row = this.statement(sql).get(...params) as SqlRow | undefined;
      return row;
    } catch (error) {
      this.rethrowAttach(error);
    }
  }

  all(sql: string, ...params: SQLInputValue[]): SqlRow[] {
    this.assertOpen();
    this.rejectForbidden(sql);
    try {
      return this.statement(sql).all(...params) as SqlRow[];
    } catch (error) {
      this.rethrowAttach(error);
    }
  }

  run(sql: string, ...params: SQLInputValue[]): number {
    this.assertOpen();
    this.rejectForbidden(sql);
    this.assertWritable(sql);
    try {
      return changeCount(this.statement(sql).run(...params).changes);
    } catch (error) {
      this.rethrowAttach(error);
    }
  }

  runNamed(name: string, params: Readonly<Record<string, SQLInputValue>>): number {
    const sql = this.catalog.sql(name);
    this.assertWritable(sql);
    try {
      return changeCount(this.namedStatement(name).run(this.bindNamed(name, params)).changes);
    } catch (error) {
      this.rethrowAttach(error);
    }
  }

  allNamed(name: string, params: Readonly<Record<string, SQLInputValue>>): SqlRow[] {
    const sql = this.catalog.sql(name);
    this.assertWritable(sql);
    try {
      return this.namedStatement(name).all(this.bindNamed(name, params)) as SqlRow[];
    } catch (error) {
      this.rethrowAttach(error);
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.statements.clear();
    this.db.close();
  }

  private applyWriterPragmas(): void {
    const mode = this.pragma("PRAGMA journal_mode = WAL");
    const journal = stringField(mode, "journal_mode");
    if (journal !== "wal") {
      throw new WalModeRequiredError(journal || JSON.stringify(mode));
    }
    this.execRaw("PRAGMA synchronous = FULL");
    this.execRaw("PRAGMA foreign_keys = ON");
    this.execRaw("PRAGMA busy_timeout = 5000");
    this.execRaw("PRAGMA secure_delete = ON");
    this.execRaw("PRAGMA journal_size_limit = 67108864");
    this.execRaw("PRAGMA temp_store = MEMORY");
  }

  private applySchemaIfEmpty(): void {
    const sentinel = this.role === "global" ? "grants" : "grant_receipts";
    const existing = this.db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(sentinel);
    if (existing) {
      return;
    }
    const sql = schemaFile(this.catalog.root, this.role === "global" ? "global.sql" : "state.sql");
    if (ATTACH_SQL.test(sql)) {
      throw new AttachedDatabaseForbiddenError();
    }
    this.execRaw(sql);
  }

  private assertRole(): void {
    const grants = this.tableExists("grants");
    const receipts = this.tableExists("grant_receipts");
    if (this.role === "global" && (!grants || receipts)) {
      throw new WrongDatabaseRoleError("global", receipts ? "state" : "unknown");
    }
    if (this.role === "state" && (!receipts || grants)) {
      throw new WrongDatabaseRoleError("state", grants ? "global" : "unknown");
    }
  }

  private assertSingleDatabase(): void {
    const row = this.db.prepare("SELECT count(*) AS n FROM pragma_database_list").get() as SqlRow;
    if (Number(row.n) !== 1) {
      throw new AttachedDatabaseForbiddenError();
    }
  }

  private tableExists(name: string): boolean {
    const row = this.db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name);
    return row !== undefined;
  }

  private pragma(sql: string): SqlRow {
    const row = this.db.prepare(sql).get() as SqlRow | undefined;
    return row ?? {};
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new GrantClosedConnectionError();
    }
  }

  private rejectForbidden(sql: string): void {
    if (ATTACH_SQL.test(sql)) {
      throw new AttachedDatabaseForbiddenError();
    }
    if (TRANSACTION_SQL.test(sql)) {
      throw new WriteOutsideImmediateTransactionError();
    }
  }

  private assertWritable(sql: string): void {
    if (WRITE_SQL.test(sql) && !this.inImmediateTransaction) {
      throw new WriteOutsideImmediateTransactionError();
    }
  }

  private statement(sql: string): StatementSync {
    const cached = this.statements.get(sql);
    if (cached) {
      return cached;
    }
    const prepared = this.db.prepare(sql);
    this.statements.set(sql, prepared);
    return prepared;
  }

  private namedStatement(name: string): StatementSync {
    const key = `named:${name}`;
    const cached = this.statements.get(key);
    if (cached) {
      return cached;
    }
    const sql = this.catalog.sql(name);
    this.rejectForbidden(sql);
    const prepared = this.db.prepare(sql);
    this.statements.set(key, prepared);
    return prepared;
  }

  private bindNamed(
    name: string,
    params: Readonly<Record<string, SQLInputValue>>,
  ): Record<string, SQLInputValue> {
    const bound: Record<string, SQLInputValue> = {};
    for (const parameter of this.catalog.parameterNames(name)) {
      if (!Object.prototype.hasOwnProperty.call(params, parameter)) {
        throw new MissingQueryParameterError(name, parameter);
      }
      const value = params[parameter];
      bound[parameter] = value ?? null;
    }
    return bound;
  }

  private execRaw(sql: string): void {
    try {
      this.db.exec(sql);
    } catch (error) {
      this.rethrowAttach(error);
    }
  }

  private rollbackIfOpen(): void {
    try {
      this.db.exec("ROLLBACK");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/no transaction is active/i.test(message)) {
        throw error;
      }
    }
  }

  private rethrowAttach(error: unknown): never {
    if (error instanceof AttachedDatabaseForbiddenError) {
      throw error;
    }
    if (isAttachDenial(error)) {
      throw new AttachedDatabaseForbiddenError();
    }
    throw error;
  }
}

class GrantClosedConnectionError extends Error {
  constructor() {
    super("Grant SQL connection is closed.");
    this.name = "GrantClosedConnectionError";
  }
}

function stringField(row: SqlRow, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

export interface GrantDatabasePair {
  readonly global: GrantSqlSession;
  readonly state: GrantSqlSession;
  close(): void;
}

export function openGrantDatabasePair(directory: string): GrantDatabasePair {
  const root = path.resolve(directory);
  const globalPath = path.join(root, "global.db");
  const statePath = path.join(root, "state.db");
  if (globalPath === statePath) {
    throw new RealDatabaseFileRequiredError();
  }
  const catalog = loadQueryCatalog();
  const globalDb = GrantSqlSession.open("global", globalPath, catalog);
  try {
    const stateDb = GrantSqlSession.open("state", statePath, catalog);
    return {
      global: globalDb,
      state: stateDb,
      close(): void {
        globalDb.close();
        stateDb.close();
      },
    };
  } catch (error) {
    globalDb.close();
    throw error;
  }
}

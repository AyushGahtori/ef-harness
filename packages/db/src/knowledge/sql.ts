import fs from "node:fs";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { canonicalAssetAbsolute } from "@ef-harness/shared-contracts";
import { splitSearchText } from "./canonical.js";

export type SqlValue = SQLInputValue;
export type SqlRow = Record<string, SQLInputValue | undefined>;

export interface SqlStatement {
  all(params?: Record<string, SqlValue>): SqlRow[];
  get(params?: Record<string, SqlValue>): SqlRow | undefined;
  run(params?: Record<string, SqlValue>): { changes: number; lastInsertRowid: number };
}

export interface SqlConnection {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  close(): void;
}

class NodeSqliteStatement implements SqlStatement {
  constructor(private readonly statement: StatementSync) {
    statement.setAllowBareNamedParameters(true);
  }

  all(params: Record<string, SqlValue> = {}): SqlRow[] {
    return this.statement.all(params);
  }

  get(params: Record<string, SqlValue> = {}): SqlRow | undefined {
    return this.statement.get(params);
  }

  run(params: Record<string, SqlValue> = {}): { changes: number; lastInsertRowid: number } {
    const result = this.statement.run(params);
    return {
      changes: asCount(result.changes),
      lastInsertRowid: asCount(result.lastInsertRowid),
    };
  }
}

class NodeSqliteConnection implements SqlConnection {
  constructor(private readonly db: DatabaseSync) {}

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): SqlStatement {
    return new NodeSqliteStatement(this.db.prepare(sql));
  }

  close(): void {
    this.db.close();
  }
}

export interface OpenStateConnectionOptions {
  readonly location?: string;
  readonly initialize?: boolean;
  readonly schemaPath?: string;
}

export function openStateConnection(options: OpenStateConnectionOptions = {}): SqlConnection {
  const location = options.location ?? ":memory:";
  const db = new DatabaseSync(location);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.function("ef_search_text", { deterministic: true }, (value) => splitSearchText(value));
  const connection = new NodeSqliteConnection(db);
  if (options.initialize !== false) {
    const schemaPath = options.schemaPath ?? canonicalAssetAbsolute("stateSql");
    connection.exec(fs.readFileSync(schemaPath, "utf8"));
    connection.exec(
      "INSERT INTO meta(key, value) VALUES ('last_rev', '0') ON CONFLICT(key) DO NOTHING",
    );
  }
  return connection;
}

export function readQueriesSql(queriesPath?: string): string {
  return fs.readFileSync(queriesPath ?? canonicalAssetAbsolute("queriesSql"), "utf8");
}

function asCount(value: number | bigint): number {
  const number = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(number)) {
    throw new Error("SQLite changed-row count is outside the safe integer range");
  }
  return number;
}

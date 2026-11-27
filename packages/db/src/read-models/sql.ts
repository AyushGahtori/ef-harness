import fs from "node:fs";
import { constants, DatabaseSync, type StatementSync } from "node:sqlite";
import { canonicalAssetAbsolute, splitSearchText } from "@ef-harness/shared-contracts";
import { RollupWriteForbiddenError } from "./errors.js";
import type { SqlRow, SqlValue } from "./values.js";

const ROLLUP_TABLES = new Set(["rollup_feature_tasks", "rollup_feature_requirements"]);
const WRITE_ACTIONS = new Set<number>([
  constants.SQLITE_INSERT,
  constants.SQLITE_UPDATE,
  constants.SQLITE_DELETE,
]);

const ROLLUP_WRITE =
  /\b(?:insert\s+(?:or\s+\w+\s+)?into|update|delete\s+from|replace\s+into)\s+["`[]?(rollup_feature_tasks|rollup_feature_requirements)\b/i;

export interface ReadModelStatement {
  all(params?: Record<string, SqlValue> | readonly SqlValue[]): SqlRow[];
  get(params?: Record<string, SqlValue> | readonly SqlValue[]): SqlRow | undefined;
  run(params?: Record<string, SqlValue> | readonly SqlValue[]): { changes: number };
}

/** Connection surface shared by a private database and an adopted `ProjectStateDb` writer. */
export interface ReadModelDatabase {
  readonly isTransaction: boolean;
  exec(sql: string): void;
  prepare(sql: string): ReadModelStatement;
  close(): void;
  withRollupRebuild<T>(work: () => T): T;
}

export interface OpenReadModelDatabaseOptions {
  readonly location?: string;
  readonly initialize?: boolean;
  readonly schemaPath?: string;
}

class NodeStatement implements ReadModelStatement {
  constructor(private readonly statement: StatementSync) {
    statement.setAllowBareNamedParameters(true);
  }

  all(params?: Record<string, SqlValue> | readonly SqlValue[]): SqlRow[] {
    if (params === undefined) return this.statement.all();
    if (Array.isArray(params)) return this.statement.all(...positional(params));
    return this.statement.all(named(params));
  }

  get(params?: Record<string, SqlValue> | readonly SqlValue[]): SqlRow | undefined {
    if (params === undefined) return this.statement.get();
    if (Array.isArray(params)) return this.statement.get(...positional(params));
    return this.statement.get(named(params));
  }

  run(params?: Record<string, SqlValue> | readonly SqlValue[]): { changes: number } {
    const result =
      params === undefined
        ? this.statement.run()
        : Array.isArray(params)
          ? this.statement.run(...positional(params))
          : this.statement.run(named(params));
    const changes = typeof result.changes === "bigint" ? Number(result.changes) : result.changes;
    return { changes };
  }
}

function positional(params: readonly SqlValue[]): SqlValue[] {
  return [...params];
}

function named(params: Record<string, SqlValue> | readonly SqlValue[]): Record<string, SqlValue> {
  return params as Record<string, SqlValue>;
}

export class ReadModelConnection {
  private schemaReady = false;
  private healDepth = 0;

  constructor(private readonly db: DatabaseSync) {}

  get isTransaction(): boolean {
    return this.db.isTransaction;
  }

  exec(sql: string): void {
    this.assertApplicationRollupWrite(sql);
    try {
      this.db.exec(sql);
    } catch (error) {
      throw translateRollupDenial(error, sql);
    }
  }

  prepare(sql: string): ReadModelStatement {
    this.assertApplicationRollupWrite(sql);
    try {
      return new NodeStatement(this.db.prepare(sql));
    } catch (error) {
      throw translateRollupDenial(error, sql);
    }
  }

  close(): void {
    this.db.close();
  }

  withRollupRebuild<T>(work: () => T): T {
    this.healDepth += 1;
    try {
      return work();
    } finally {
      this.healDepth -= 1;
    }
  }

  markSchemaReady(): void {
    this.schemaReady = true;
    if (typeof this.db.setAuthorizer !== "function") return;
    this.db.setAuthorizer((action, arg1, _arg2, _dbName, triggerOrView) => {
      if (triggerOrView) return constants.SQLITE_OK;
      if (this.healDepth > 0) return constants.SQLITE_OK;
      if (WRITE_ACTIONS.has(action) && arg1 !== null && ROLLUP_TABLES.has(arg1)) {
        return constants.SQLITE_DENY;
      }
      return constants.SQLITE_OK;
    });
  }

  private assertApplicationRollupWrite(sql: string): void {
    if (!this.schemaReady || this.healDepth > 0) return;
    if (ROLLUP_WRITE.test(sql)) throw new RollupWriteForbiddenError();
  }
}

export function openReadModelDatabase(
  options: OpenReadModelDatabaseOptions = {},
): ReadModelConnection {
  const location = options.location ?? ":memory:";
  const db = new DatabaseSync(location);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  if (location !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
  }
  db.function("ef_search_text", { deterministic: true }, (value) => splitSearchText(value));
  const connection = new ReadModelConnection(db);
  if (options.initialize !== false) {
    const schemaPath = options.schemaPath ?? canonicalAssetAbsolute("stateSql");
    connection.exec(fs.readFileSync(schemaPath, "utf8"));
    connection.exec(
      "INSERT INTO meta(key, value) VALUES ('last_rev', '0') ON CONFLICT(key) DO NOTHING",
    );
  }
  connection.markSchemaReady();
  return connection;
}

export function readQueriesSql(queriesPath?: string): string {
  return fs.readFileSync(queriesPath ?? canonicalAssetAbsolute("queriesSql"), "utf8");
}

function translateRollupDenial(error: unknown, sql: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/not authorized|SQLITE_AUTH/i.test(message) && /rollup_feature_/.test(sql)) {
    return new RollupWriteForbiddenError();
  }
  return error instanceof Error ? error : new Error(message);
}

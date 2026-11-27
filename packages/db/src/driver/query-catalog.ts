import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalAssetAbsolute, type CanonicalAssetKey } from "@ef-harness/shared-contracts";
import type { SqliteConnection, SqliteStatement } from "./types.js";
import { ParameterMismatchError, UnknownQueryError } from "./errors.js";
import { parseQueryCatalog, type ParsedQuery } from "./sql.js";
import type { RunResult, SqlValue } from "./values.js";

export type { ParsedQuery };

export type SqlAssetKey = Extract<
  CanonicalAssetKey,
  "stateSql" | "globalSql" | "telemetrySql" | "codeIndexSql" | "queriesSql"
>;

const SQL_ASSET_FILENAMES: Record<SqlAssetKey, string> = {
  stateSql: "state.sql",
  globalSql: "global.sql",
  telemetrySql: "telemetry.sql",
  codeIndexSql: "code-index.sql",
  queriesSql: "queries.sql",
};

let cachedNamedQueries: ReadonlyMap<string, string> | undefined;

export function resolveCanonicalSqlAsset(key: SqlAssetKey): string {
  const monorepoPath = canonicalAssetAbsolute(key);
  if (existsSync(monorepoPath)) return monorepoPath;
  const filename = SQL_ASSET_FILENAMES[key];
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(moduleDir, "..", "schema", filename),
    path.resolve(moduleDir, "..", "..", "schema", filename),
  ];
  const resourcesPath = Reflect.get(process, "resourcesPath");
  if (typeof resourcesPath === "string" && resourcesPath.length > 0) {
    candidates.push(path.join(resourcesPath, "schema", filename));
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Unable to locate canonical SQL asset schema/${filename}.`);
}

export function loadCanonicalSqlAsset(key: SqlAssetKey): string {
  return readFileSync(resolveCanonicalSqlAsset(key), "utf8");
}

export function loadNamedQueries(source?: string): ReadonlyMap<string, string> {
  if (source === undefined && cachedNamedQueries !== undefined) {
    return cachedNamedQueries;
  }
  const queries = parseQueryCatalog(readQuerySql(source));
  const map = new Map(queries.map((query) => [query.name, query.sql]));
  if (source === undefined) cachedNamedQueries = map;
  return map;
}

export function lookupNamedQuery(name: string, source?: string): string {
  const sql = loadNamedQueries(source).get(name);
  if (sql === undefined) throw new UnknownQueryError(name);
  return sql;
}

export class QueryCatalog {
  readonly names: readonly string[];
  readonly #queries: ReadonlyMap<string, ParsedQuery>;
  readonly #statements = new Map<string, SqliteStatement>();

  constructor(
    private readonly connection: SqliteConnection,
    queries: readonly ParsedQuery[],
  ) {
    this.#queries = new Map(queries.map((query) => [query.name, query]));
    this.names = queries.map((query) => query.name);
  }

  sql(name: string): string {
    return this.require(name).sql;
  }

  params(name: string): readonly string[] {
    return this.require(name).params;
  }

  run(name: string, params?: Record<string, SqlValue>): RunResult {
    return this.invoke(name, params, (statement, bound) => statement.run(bound));
  }

  get(name: string, params?: Record<string, SqlValue>): unknown {
    return this.invoke(name, params, (statement, bound) => statement.get(bound));
  }

  all(name: string, params?: Record<string, SqlValue>): unknown[] {
    return this.invoke(name, params, (statement, bound) => statement.all(bound));
  }

  private invoke<T>(
    name: string,
    params: Record<string, SqlValue> | undefined,
    call: (statement: SqliteStatement, params: Record<string, SqlValue>) => T,
  ): T {
    const query = this.require(name);
    try {
      return call(this.statement(query), params ?? {});
    } catch (error) {
      if (error instanceof ParameterMismatchError && error.queryName === undefined) {
        throw new ParameterMismatchError(error.expected, error.missing, error.extra, name);
      }
      throw error;
    }
  }

  private statement(query: ParsedQuery): SqliteStatement {
    const cached = this.#statements.get(query.name);
    if (cached) return cached;
    const prepared = this.connection.prepare(query.sql);
    this.#statements.set(query.name, prepared);
    return prepared;
  }

  private require(name: string): ParsedQuery {
    const query = this.#queries.get(name);
    if (!query) throw new UnknownQueryError(name);
    return query;
  }
}

export function loadQueryCatalog(connection: SqliteConnection, source?: string): QueryCatalog {
  return new QueryCatalog(connection, parseQueryCatalog(readQuerySql(source)));
}

function readQuerySql(source: string | undefined): string {
  if (source === undefined) return loadCanonicalSqlAsset("queriesSql");
  if (source.includes("-- name:")) return source;
  return readFileSync(source, "utf8");
}

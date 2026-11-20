import { readFileSync } from "node:fs";
import { canonicalAssetAbsolute } from "@ef-harness/shared-contracts";
import type { SqliteConnection, SqliteStatement } from "./connection.js";
import { ParameterMismatchError, UnknownQueryError } from "./errors.js";
import { parseQueryCatalog, type ParsedQuery } from "./sql.js";
import type { RunResult, SqlValue } from "./values.js";

export type { ParsedQuery };

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
  if (source === undefined) return readFileSync(canonicalAssetAbsolute("queriesSql"), "utf8");
  if (source.includes("-- name:")) return source;
  return readFileSync(source, "utf8");
}

import { parseQueryCatalog as parseNamedQueryFile } from "../driver/sql.js";
import { QueryCatalogError } from "./errors.js";
import type { SqlConnection, SqlRow, SqlStatement, SqlValue } from "./sql.js";

/**
 * Named statements from schema/queries.sql.
 * Parsing is the driver catalog's `-- name:` reader. Statements are not copied
 * into TypeScript; every call executes the named block from that file.
 */
export interface QueryCatalog {
  sql(name: string): string;
  all(name: string, params?: Record<string, SqlValue>): SqlRow[];
  get(name: string, params?: Record<string, SqlValue>): SqlRow | undefined;
  run(name: string, params?: Record<string, SqlValue>): { changes: number; lastInsertRowid: number };
}

interface ParsedQuery {
  readonly sql: string;
  readonly params: readonly string[];
}

export function loadQueryCatalog(connection: SqlConnection, queriesSql: string): QueryCatalog {
  const queries = parseQueryCatalog(queriesSql);
  const prepared = new Map<string, SqlStatement>();

  function requireQuery(name: string): ParsedQuery {
    const query = queries.get(name);
    if (!query) throw new QueryCatalogError(`unknown query: ${name}`);
    return query;
  }

  function statement(name: string, params: Record<string, SqlValue>): SqlStatement {
    const query = requireQuery(name);
    const keys = Object.keys(params);
    const missing = query.params.filter((param) => !Object.prototype.hasOwnProperty.call(params, param));
    const extra = keys.filter((key) => !query.params.includes(key));
    if (missing.length > 0 || extra.length > 0) {
      throw new QueryCatalogError(
        `query ${name} parameter mismatch; missing [${missing.join(", ")}] extra [${extra.join(", ")}]`,
      );
    }
    const cached = prepared.get(name);
    if (cached) return cached;
    const compiled = connection.prepare(query.sql);
    prepared.set(name, compiled);
    return compiled;
  }

  return {
    sql(name: string): string {
      return requireQuery(name).sql;
    },
    all(name: string, params: Record<string, SqlValue> = {}): SqlRow[] {
      return statement(name, params).all(params);
    },
    get(name: string, params: Record<string, SqlValue> = {}): SqlRow | undefined {
      return statement(name, params).get(params);
    },
    run(name: string, params: Record<string, SqlValue> = {}) {
      return statement(name, params).run(params);
    },
  };
}

export function parseQueryCatalog(queriesSql: string): Map<string, ParsedQuery> {
  const queries = new Map<string, ParsedQuery>();
  for (const query of parseNamedQueryFile(queriesSql)) {
    if (query.sql.length === 0) continue;
    queries.set(query.name, { sql: query.sql, params: query.params });
  }
  return queries;
}

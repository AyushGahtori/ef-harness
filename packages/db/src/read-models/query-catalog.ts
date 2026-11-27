import { ReadModelQueryError } from "./errors.js";
import type { ReadModelDatabase, ReadModelStatement } from "./sql.js";
import type { SqlRow, SqlValue } from "./values.js";

export interface QueryCatalog {
  sql(name: string): string;
  all(name: string, params?: Record<string, SqlValue>): SqlRow[];
  get(name: string, params?: Record<string, SqlValue>): SqlRow | undefined;
  run(name: string, params?: Record<string, SqlValue>): { changes: number };
}

interface ParsedQuery {
  readonly sql: string;
  readonly params: readonly string[];
}

export function loadQueryCatalog(connection: ReadModelDatabase, queriesSql: string): QueryCatalog {
  const queries = parseQueryCatalog(queriesSql);
  const prepared = new Map<string, ReadModelStatement>();

  function requireQuery(name: string): ParsedQuery {
    const query = queries.get(name);
    if (!query) throw new ReadModelQueryError(`unknown query: ${name}`);
    return query;
  }

  function statement(name: string, params: Record<string, SqlValue>): ReadModelStatement {
    const query = requireQuery(name);
    const keys = Object.keys(params);
    const missing = query.params.filter(
      (param) => !Object.prototype.hasOwnProperty.call(params, param),
    );
    const extra = keys.filter((key) => !query.params.includes(key));
    if (missing.length > 0 || extra.length > 0) {
      throw new ReadModelQueryError(
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
  for (const block of queriesSql.split(/^-- name: /m).slice(1)) {
    const newline = block.indexOf("\n");
    const name = (newline === -1 ? block : block.slice(0, newline)).trim();
    const body = newline === -1 ? "" : block.slice(newline + 1);
    const sql = body
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim()
      .replace(/;\s*$/, "");
    if (!name || !sql) continue;
    queries.set(name, { sql, params: parameterNames(sql) });
  }
  return queries;
}

function parameterNames(sql: string): string[] {
  const withoutStrings = sql.replace(/'(?:''|[^'])*'/g, "''");
  const names = new Set<string>();
  for (const match of withoutStrings.matchAll(/(?<!:):([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const name = match[1];
    if (name) names.add(name);
  }
  return [...names];
}

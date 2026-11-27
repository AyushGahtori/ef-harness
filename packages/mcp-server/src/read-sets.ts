import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { EdgeReadRow, PulledReadRow, ReadSetStore, SearchReadRow } from "./types.js";

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function canonicalSearchQuery(
  query: string,
  filters: Readonly<Record<string, string | number | boolean>> | undefined,
): { canonical: string; hash: string } {
  const sorted: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(filters ?? {}).sort()) {
    const value = filters?.[key];
    if (value !== undefined) sorted[key] = value;
  }
  const canonical = JSON.stringify({ query, filters: sorted });
  return { canonical, hash: sha256(canonical) };
}

export function hashSearchResults(hits: readonly { id: string; version: number }[]): string {
  const sorted = [...hits].sort((left, right) => {
    if (left.id < right.id) return -1;
    if (left.id > right.id) return 1;
    return left.version - right.version;
  });
  return sha256(JSON.stringify(sorted.map((hit) => [hit.id, hit.version])));
}

function stateSchemaSql(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(dir, "schema", "state.sql");
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate, "utf8");
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("schema/state.sql is not available to the read-set store");
}

/**
 * Opens a scratch sqlite file and applies canonical `schema/state.sql`.
 * `ProjectStateDb` is what turns foreign keys on; this opener only materializes the tables.
 */
export function openReadSetDatabase(filename: string): DatabaseSync {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec(stateSchemaSql());
  return db;
}

export interface ReadSetSql {
  run(sql: string, params: readonly (string | number)[]): void;
  get(sql: string, params: readonly (string | number)[]): unknown;
}

function databaseSql(db: DatabaseSync): ReadSetSql {
  return {
    run(sql, params) {
      db.prepare(sql).run(...params);
    },
    get(sql, params) {
      return db.prepare(sql).get(...params);
    },
  };
}

function isDatabase(source: DatabaseSync | ReadSetSql): source is DatabaseSync {
  return typeof source === "object" && source !== null && "prepare" in source;
}

export class SqliteReadSetStore implements ReadSetStore {
  private readonly sql: ReadSetSql;

  constructor(source: DatabaseSync | ReadSetSql) {
    this.sql = isDatabase(source) ? databaseSql(source) : source;
  }

  async recordPulled(row: PulledReadRow): Promise<void> {
    this.sql.run(
      `INSERT INTO read_sets(attempt, node, version, hash, how)
       VALUES (?, ?, ?, ?, 'pulled')
       ON CONFLICT(attempt, node, version) DO UPDATE SET hash = excluded.hash`,
      [row.attempt, row.node, row.version, row.hash],
    );
  }

  async recordSearch(row: SearchReadRow): Promise<void> {
    this.sql.run(
      `INSERT INTO search_reads(attempt, query_hash, query, result_hash, rev)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(attempt, query_hash) DO UPDATE SET
         query = excluded.query,
         result_hash = excluded.result_hash,
         rev = excluded.rev`,
      [row.attempt, row.queryHash, row.query, row.resultHash, row.rev],
    );
  }

  async recordEdge(row: EdgeReadRow): Promise<void> {
    this.sql.run(
      `INSERT INTO edge_read_sets(attempt, node, dir, type, version)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(attempt, node, dir, type) DO UPDATE SET version = excluded.version`,
      [row.attempt, row.node, row.dir, row.type, row.version],
    );
  }

  async countSearchReads(attempt: string): Promise<number> {
    const row = this.sql.get("SELECT count(*) AS n FROM search_reads WHERE attempt = ?", [attempt]);
    if (typeof row !== "object" || row === null || !("n" in row)) return 0;
    const value = Reflect.get(row, "n");
    return typeof value === "number" ? value : Number(value);
  }
}

export class MemoryReadSetStore implements ReadSetStore {
  readonly pulled: PulledReadRow[] = [];
  readonly searches: SearchReadRow[] = [];
  readonly edges: EdgeReadRow[] = [];

  async recordPulled(row: PulledReadRow): Promise<void> {
    const index = this.pulled.findIndex(
      (item) => item.attempt === row.attempt && item.node === row.node && item.version === row.version,
    );
    if (index >= 0) this.pulled[index] = row;
    else this.pulled.push(row);
  }

  async recordSearch(row: SearchReadRow): Promise<void> {
    const index = this.searches.findIndex(
      (item) => item.attempt === row.attempt && item.queryHash === row.queryHash,
    );
    if (index >= 0) this.searches[index] = row;
    else this.searches.push(row);
  }

  async recordEdge(row: EdgeReadRow): Promise<void> {
    const index = this.edges.findIndex(
      (item) => item.attempt === row.attempt && item.node === row.node && item.dir === row.dir && item.type === row.type,
    );
    if (index >= 0) this.edges[index] = row;
    else this.edges.push(row);
  }

  async countSearchReads(attempt: string): Promise<number> {
    return this.searches.filter((item) => item.attempt === attempt).length;
  }
}

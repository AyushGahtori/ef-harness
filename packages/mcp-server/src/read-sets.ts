import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
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

const READ_SET_DDL = `
CREATE TABLE IF NOT EXISTS read_sets (
  attempt TEXT NOT NULL,
  node    TEXT NOT NULL,
  version INTEGER NOT NULL,
  hash    TEXT NOT NULL,
  how     TEXT NOT NULL CHECK (how IN ('pushed','pulled')),
  PRIMARY KEY (attempt, node, version)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS search_reads (
  attempt     TEXT NOT NULL,
  query_hash  TEXT NOT NULL,
  query       TEXT NOT NULL CHECK (json_valid(query)),
  result_hash TEXT NOT NULL,
  rev         INTEGER NOT NULL,
  PRIMARY KEY (attempt, query_hash)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS edge_read_sets (
  attempt TEXT NOT NULL,
  node    TEXT NOT NULL,
  dir     TEXT NOT NULL CHECK (dir IN ('in','out')),
  type    TEXT NOT NULL,
  version INTEGER NOT NULL,
  PRIMARY KEY (attempt, node, dir, type)
) STRICT, WITHOUT ROWID;
`;

/** Opens a sqlite database and ensures the three read-set tables exist. */
export function openReadSetDatabase(filename: string): DatabaseSync {
  const db = new DatabaseSync(filename);
  db.exec(READ_SET_DDL);
  return db;
}

export class SqliteReadSetStore implements ReadSetStore {
  constructor(private readonly db: DatabaseSync) {}

  async recordPulled(row: PulledReadRow): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO read_sets(attempt, node, version, hash, how)
         VALUES (?, ?, ?, ?, 'pulled')
         ON CONFLICT(attempt, node, version) DO UPDATE SET hash = excluded.hash`,
      )
      .run(row.attempt, row.node, row.version, row.hash);
  }

  async recordSearch(row: SearchReadRow): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO search_reads(attempt, query_hash, query, result_hash, rev)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(attempt, query_hash) DO UPDATE SET
           query = excluded.query,
           result_hash = excluded.result_hash,
           rev = excluded.rev`,
      )
      .run(row.attempt, row.queryHash, row.query, row.resultHash, row.rev);
  }

  async recordEdge(row: EdgeReadRow): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO edge_read_sets(attempt, node, dir, type, version)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(attempt, node, dir, type) DO UPDATE SET version = excluded.version`,
      )
      .run(row.attempt, row.node, row.dir, row.type, row.version);
  }

  async countSearchReads(attempt: string): Promise<number> {
    const row = this.db.prepare("SELECT count(*) AS n FROM search_reads WHERE attempt = ?").get(attempt) as
      | { n: number }
      | undefined;
    return row?.n ?? 0;
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

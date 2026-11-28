import type { DatabaseSync } from "node:sqlite";
import type { SQLOutputValue } from "node:sqlite";
import type { FtsHit } from "./types.js";

type Row = Record<string, SQLOutputValue>;

export function sanitizeFtsQuery(input: string): string {
  const tokens = input
    .normalize("NFC")
    .toLowerCase()
    .split(/[^0-9a-z]+/i)
    .filter((token) => token.length >= 2);
  if (tokens.length === 0) return "";
  return tokens.map((token) => `"${token.replaceAll('"', "")}"`).join(" AND ");
}

function betterScore(rank: number): number {
  if (!Number.isFinite(rank)) return 0;
  return rank <= 0 ? -rank : 1 / (1 + rank);
}

/**
 * Local port of Task 018 dual FTS5 (`kb_words` BM25 + `kb_ident`).
 * Swap `searchNodes` / `searchIdentifiers` for `KnowledgeSearchService`.
 */
export class LocalDualFtsSearch {
  private readonly mode: "standalone" | "external";

  constructor(private readonly db: DatabaseSync) {
    const existing = this.db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'kb_words'`).get() as
      | Row
      | undefined;
    const sql = existing ? String(existing.sql ?? "") : "";
    if (!existing) {
      this.db.exec(`
        CREATE VIRTUAL TABLE kb_words USING fts5(
          title, body, tokenize = 'unicode61 remove_diacritics 2'
        );
        CREATE VIRTUAL TABLE kb_ident USING fts5(
          id, title, tokenize = 'trigram'
        );
      `);
      this.mode = "standalone";
      return;
    }
    this.mode = /content\s*=/.test(sql) ? "external" : "standalone";
  }

  upsert(nid: number, id: string, title: string, body: string): void {
    if (this.mode !== "standalone") return;
    this.db.prepare(`DELETE FROM kb_words WHERE rowid = :nid`).run({ nid });
    this.db.prepare(`DELETE FROM kb_ident WHERE rowid = :nid`).run({ nid });
    this.db.prepare(`INSERT INTO kb_words(rowid, title, body) VALUES (:nid, :title, :body)`).run({
      nid,
      title,
      body,
    });
    this.db.prepare(`INSERT INTO kb_ident(rowid, id, title) VALUES (:nid, :id, :title)`).run({
      nid,
      id,
      title,
    });
  }

  searchNodes(query: string, limit = 15): FtsHit[] {
    const match = sanitizeFtsQuery(query);
    if (!match) return [];
    try {
      const rows = this.db
        .prepare(
          `SELECT rowid AS nid, bm25(kb_words, 2.0, 1.0) AS rank
             FROM kb_words
            WHERE kb_words MATCH :q
            LIMIT :limit`,
        )
        .all({ q: match, limit }) as Row[];
      return this.withIds(rows, "kb_words");
    } catch {
      return [];
    }
  }

  searchIdentifiers(needle: string, limit = 15): FtsHit[] {
    const trimmed = needle.trim();
    if (trimmed.length < 2) return [];
    const hits = new Map<string, FtsHit>();
    if (trimmed.length >= 3) {
      const match = sanitizeFtsQuery(trimmed);
      if (match) {
        try {
          const rows = this.db
            .prepare(
              `SELECT rowid AS nid, bm25(kb_ident) AS rank
                 FROM kb_ident
                WHERE kb_ident MATCH :q
                LIMIT :limit`,
            )
            .all({ q: match, limit }) as Row[];
          for (const hit of this.withIds(rows, "kb_ident")) hits.set(hit.id, hit);
        } catch {
          // Trigram queries shorter than a token fall through to LIKE.
        }
      }
    }
    const likeRows = this.db
      .prepare(
        `SELECT id FROM nodes
          WHERE id LIKE '%' || :needle || '%' OR title LIKE '%' || :needle || '%'
          LIMIT :limit`,
      )
      .all({ needle: trimmed, limit }) as Row[];
    for (const row of likeRows) {
      const id = String(row.id);
      if (!hits.has(id)) hits.set(id, { id, score: 8, source: "kb_ident" });
    }
    return [...hits.values()];
  }

  private withIds(rows: readonly Row[], source: FtsHit["source"]): FtsHit[] {
    const hits: FtsHit[] = [];
    for (const row of rows) {
      const nid = typeof row.nid === "bigint" ? Number(row.nid) : Number(row.nid);
      const rank = typeof row.rank === "number" ? row.rank : Number(row.rank);
      const found = this.db.prepare(`SELECT id FROM nodes WHERE nid = :nid`).get({ nid }) as
        | Row
        | undefined;
      if (!found || typeof found.id !== "string") continue;
      const lexical = betterScore(rank);
      hits.push({ id: found.id, score: source === "kb_ident" ? 8 + lexical : lexical, source });
    }
    return hits;
  }
}

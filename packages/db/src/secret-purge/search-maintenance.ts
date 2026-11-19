import type { DatabaseSync } from "node:sqlite";

import type { KnowledgeSearchService } from "./types.js";

export interface TouchedNode {
  readonly nid: number;
  readonly id: string;
  readonly previousTitle: string;
  readonly title: string;
  readonly text: string;
  readonly fields: string;
}

/** Re-index one current node in both FTS5 tables. */
export function reindexNode(db: DatabaseSync, node: TouchedNode): void {
  db.prepare("DELETE FROM kb_words WHERE rowid = ?").run(node.nid);
  db.prepare(
    "INSERT INTO kb_words(rowid, title, body) VALUES (?, ef_search_text(?), ef_search_text(? || ' ' || ?))",
  ).run(node.nid, node.title, node.text, node.fields);
  db.prepare("INSERT INTO kb_ident(kb_ident, rowid, id, title) VALUES ('delete', ?, ?, ?)").run(
    node.nid,
    node.id,
    node.previousTitle,
  );
  db.prepare("INSERT INTO kb_ident(rowid, id, title) VALUES (?, ?, ?)").run(
    node.nid,
    node.id,
    node.title,
  );
}

/**
 * Repopulate contentless `kb_words` from current nodes and rebuild external-content
 * `kb_ident`, then merge FTS5 segments so deleted postings no longer retain plaintext.
 */
export function rebuildAndOptimizeSearchIndexes(db: DatabaseSync): void {
  db.exec("DELETE FROM kb_words");
  db.exec(
    "INSERT INTO kb_words(rowid, title, body) SELECT nid, ef_search_text(title), ef_search_text(text || ' ' || fields) FROM nodes",
  );
  db.exec("INSERT INTO kb_ident(kb_ident) VALUES('rebuild')");
  db.exec("INSERT INTO kb_words(kb_words) VALUES('optimize')");
  db.exec("INSERT INTO kb_ident(kb_ident) VALUES('optimize')");
}

export function createSqliteKnowledgeSearchMaintenance(db: DatabaseSync): KnowledgeSearchService {
  return {
    optimizeSearchIndexes(): void {
      db.exec("INSERT INTO kb_words(kb_words) VALUES('optimize')");
      db.exec("INSERT INTO kb_ident(kb_ident) VALUES('optimize')");
    },
    rebuildSearchIndexes(): void {
      rebuildAndOptimizeSearchIndexes(db);
    },
  };
}

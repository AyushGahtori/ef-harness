import { DatabaseSync } from "node:sqlite";

import type { ExportEntity, HistoryRecord } from "./types.js";
import { RehydrationError } from "./errors.js";

const BOOTSTRAP_SQL = `
PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT, WITHOUT ROWID;
CREATE TABLE change_sets (
  id TEXT PRIMARY KEY,
  rev INTEGER UNIQUE,
  origin TEXT NOT NULL,
  origin_ref TEXT,
  author TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  summary TEXT
) STRICT;
CREATE TABLE nodes (
  nid INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  version INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  fields TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  change_set TEXT NOT NULL,
  created_rev INTEGER NOT NULL,
  updated_rev INTEGER NOT NULL
) STRICT;
CREATE TABLE name_registry (
  scope TEXT NOT NULL,
  name TEXT NOT NULL,
  node_id TEXT NOT NULL,
  PRIMARY KEY (scope, name)
) STRICT, WITHOUT ROWID;
CREATE TABLE feature_rollups (
  feature_id TEXT PRIMARY KEY,
  tasks_total INTEGER NOT NULL DEFAULT 0,
  tasks_accepted INTEGER NOT NULL DEFAULT 0
) STRICT, WITHOUT ROWID;
CREATE VIRTUAL TABLE kb_words USING fts5(title, body);
COMMIT;
`;

function mapNodeKind(exportKind: ExportEntity["kind"]): string {
  const map: Record<ExportEntity["kind"], string> = {
    decision: "decision",
    requirement: "spec_item",
    entity: "arch_node",
    contract: "contract",
    feature: "feature",
    screen: "journey",
    rule: "rule",
    task: "task",
    edge: "arch_node",
  };
  return map[exportKind];
}

export interface RehydratedDatabase {
  readonly db: DatabaseSync;
  readonly search: (query: string) => readonly { readonly id: string; readonly title: string; readonly rank: number }[];
}

export function rebuildStateDatabase(input: {
  readonly projectId: string;
  readonly writerEpoch: number;
  readonly deviceId: string;
  readonly canonicalGraphSha256: string;
  readonly entities: readonly ExportEntity[];
  readonly history: readonly HistoryRecord[];
}): RehydratedDatabase {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(BOOTSTRAP_SQL);
    db.exec("BEGIN IMMEDIATE");

    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run("project_id", input.projectId);
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run("writer_epoch", String(input.writerEpoch));
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run("device_id", input.deviceId);
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(
      "canonical_graph_sha256",
      input.canonicalGraphSha256,
    );
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run("stream_epoch", "1");

    const insertNode = db.prepare(
      `INSERT INTO nodes (id, kind, version, content_hash, title, text, fields, status, change_set, created_rev, updated_rev)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    );
    const insertHistory = db.prepare(
      `INSERT INTO change_sets (id, rev, origin, origin_ref, author, created_at, summary)
       VALUES (?, ?, 'import', ?, 'rehydrator', ?, ?)`,
    );
    const insertFts = db.prepare(`INSERT INTO kb_words(rowid, title, body) VALUES (?, ?, ?)`);
    const upsertRollup = db.prepare(
      `INSERT INTO feature_rollups (feature_id, tasks_total, tasks_accepted)
       VALUES (?, 1, 0)
       ON CONFLICT(feature_id) DO UPDATE SET tasks_total = tasks_total + 1`,
    );

    let nid = 1;
    let revCounter = 1;
    for (const entity of input.entities) {
      if (entity.deleted) continue;
      const changeSetId = `import-${entity.id}@${entity.revision}`;
      const rev = revCounter++;
      insertHistory.run(
        changeSetId,
        rev,
        entity.id,
        Date.parse(input.history.at(-1)?.at ?? "1970-01-01T00:00:00.000Z"),
        `rehydrate ${entity.id}`,
      );
      insertNode.run(
        entity.id,
        mapNodeKind(entity.kind),
        entity.revision,
        `sha256:${entity.id}:${entity.revision}`,
        entity.title ?? entity.id,
        entity.text ?? "",
        JSON.stringify(entity.fields),
        changeSetId,
        entity.revision,
        entity.revision,
      );
      insertFts.run(nid, entity.title ?? entity.id, entity.text ?? "");
      if (entity.kind === "task" && typeof entity.fields.feature === "string") {
        upsertRollup.run(entity.fields.feature);
      }
      if (entity.kind === "feature") {
        db.prepare(
          `INSERT INTO name_registry (scope, name, node_id) VALUES ('feature', ?, ?)
           ON CONFLICT(scope, name) DO UPDATE SET node_id = excluded.node_id`,
        ).run(entity.id, entity.id);
      }
      nid += 1;
    }

    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* empty */
    }
    throw new RehydrationError(
      "sqlite_rebuild_failed",
      error instanceof Error ? error.message : "SQLite rebuild failed",
    );
  }

  return {
    db,
    search(query: string) {
      const rows = db
        .prepare(
          `SELECT nodes.id AS id, nodes.title AS title, bm25(kb_words) AS rank
           FROM kb_words
           JOIN nodes ON nodes.nid = kb_words.rowid
           WHERE kb_words MATCH ?
           ORDER BY rank`,
        )
        .all(query) as { id: string; title: string; rank: number }[];
      return rows;
    },
  };
}
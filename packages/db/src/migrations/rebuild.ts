import {
  ForeignKeyIntegrityError,
  IntegrityCheckError,
  SchemaInvariantError,
  SearchIndexDriftError,
  ViewInvariantError,
} from "./errors.js";
import { efSearchText } from "./search-text.js";
import { firstColumn, quoteIdent, rollbackIfOpen, tableExists } from "./sql.js";
import type { SqliteConnection, TwelveStepRebuildPlan } from "./types.js";

/** Views the state schema must still be able to execute after a rebuild. */
export const STATE_GRAPH_VIEWS = [
  "requirements",
  "task_requirements",
  "check_requirements",
  "waivers",
] as const;

export const FTS_PENDING_META_KEY = "ef_migration_fts_pending";

const recoveryBackups = new WeakMap<SqliteConnection, string>();
const rebuildAuditHooks = new WeakMap<SqliteConnection, (conn: SqliteConnection) => void>();

export function setRecoveryBackupPath(conn: SqliteConnection, backupPath: string): void {
  recoveryBackups.set(conn, backupPath);
}

export function attachRebuildAuditHook(conn: SqliteConnection, hook: (conn: SqliteConnection) => void): void {
  rebuildAuditHooks.set(conn, hook);
}

export function clearRebuildAuditHook(conn: SqliteConnection): void {
  rebuildAuditHooks.delete(conn);
}

interface DependentObject {
  readonly kind: "index" | "trigger" | "view" | "virtual";
  readonly name: string;
  readonly sql: string;
}

function referencesTable(sql: string, table: string): boolean {
  return new RegExp(`\\b${table}\\b`).test(sql);
}

function snapshotDependents(conn: SqliteConnection, table: string): DependentObject[] {
  const rows = conn.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master").all();
  const objects: DependentObject[] = [];
  for (const row of rows) {
    const sql = typeof row.sql === "string" ? row.sql : "";
    const name = typeof row.name === "string" ? row.name : "";
    const type = typeof row.type === "string" ? row.type : "";
    const tbl = typeof row.tbl_name === "string" ? row.tbl_name : "";
    if (name === "" || sql === "") continue;
    if (type === "index" && tbl === table) {
      objects.push({ kind: "index", name, sql });
    } else if (type === "trigger" && tbl === table) {
      objects.push({ kind: "trigger", name, sql });
    } else if (type === "view" && referencesTable(sql, table)) {
      objects.push({ kind: "view", name, sql });
    } else if (type === "table" && /^create\s+virtual\s+table\b/i.test(sql.trim()) && name !== table && referencesTable(sql, table)) {
      objects.push({ kind: "virtual", name, sql });
    }
  }
  return objects;
}

function existingViews(conn: SqliteConnection, names: readonly string[]): string[] {
  const found: string[] = [];
  for (const name of names) {
    const row = conn.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'view' AND name = ?").get(name);
    if (row) found.push(name);
  }
  return found;
}

export function assertNodesIntegerPrimaryKey(conn: SqliteConnection): void {
  if (!tableExists(conn, "nodes")) return;
  const columns = conn.prepare("PRAGMA table_info(nodes)").all();
  const nid = columns.find((column) => column.name === "nid");
  const type = typeof nid?.type === "string" ? nid.type.toUpperCase() : "";
  const pk = typeof nid?.pk === "number" || typeof nid?.pk === "bigint" ? Number(nid.pk) : 0;
  if (type !== "INTEGER" || pk < 1) {
    throw new SchemaInvariantError(
      "nodes.nid INTEGER PRIMARY KEY is required so VACUUM cannot desynchronize FTS rowids",
    );
  }
}

export function assertQuickCheck(conn: SqliteConnection): void {
  const rows = conn.prepare("PRAGMA quick_check").all();
  const failures = rows.map((row) => firstColumn(row)).filter((value) => value !== "ok");
  if (rows.length === 0 || failures.length > 0) {
    throw new IntegrityCheckError(failures.length > 0 ? failures : ["quick_check returned no rows"]);
  }
}

export function assertForeignKeyCheck(conn: SqliteConnection): void {
  const rows = conn.prepare("PRAGMA foreign_key_check").all();
  if (rows.length > 0) throw new ForeignKeyIntegrityError(rows);
}

function assertExpectedViews(conn: SqliteConnection, views: readonly string[]): void {
  for (const view of views) {
    const exists = conn.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'view' AND name = ?").get(view);
    if (!exists) {
      throw new ViewInvariantError(`rebuild forgot dependent view ${view}`);
    }
    try {
      conn.prepare(`SELECT 1 FROM ${quoteIdent(view)} LIMIT 1`).all();
    } catch (error) {
      throw new ViewInvariantError(`expected view ${view} does not execute`, { cause: error });
    }
  }
}

function assertObjectsRestored(conn: SqliteConnection, objects: readonly DependentObject[]): void {
  for (const object of objects) {
    const row = conn
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE name = ?")
      .get(object.name);
    if (!row) {
      throw new ViewInvariantError(`rebuild forgot dependent ${object.kind} ${object.name}`);
    }
  }
}

function markSearchRebuildPending(conn: SqliteConnection): void {
  if (!tableExists(conn, "meta")) return;
  const backupPath = recoveryBackups.get(conn);
  if (!backupPath) return;
  conn
    .prepare(
      "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(FTS_PENDING_META_KEY, backupPath);
}

export function clearSearchRebuildPending(conn: SqliteConnection): void {
  if (!tableExists(conn, "meta")) return;
  conn.prepare("DELETE FROM meta WHERE key = ?").run(FTS_PENDING_META_KEY);
}

export function readSearchRebuildPending(conn: SqliteConnection): string | null {
  if (!tableExists(conn, "meta")) return null;
  const row = conn.prepare("SELECT value FROM meta WHERE key = ?").get(FTS_PENDING_META_KEY);
  const value = row?.value;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function enableForeignKeys(conn: SqliteConnection, committed: boolean): void {
  if (!committed) rollbackIfOpen(conn);
  conn.exec("PRAGMA foreign_keys = ON");
}

/**
 * SQLite's documented 12-step table rebuild.
 * Foreign keys are turned off outside the transaction and always turned back
 * on in a `finally` block, including when `foreign_key_check` fails.
 */
export function runTwelveStepRebuild(conn: SqliteConnection, plan: TwelveStepRebuildPlan): void {
  quoteIdent(plan.table);
  quoteIdent(plan.newTable);
  if (plan.table === plan.newTable) {
    throw new SchemaInvariantError("rebuild new table name must differ from the live table");
  }
  const collision = conn.prepare("SELECT 1 AS ok FROM sqlite_master WHERE name = ?").get(plan.newTable);
  if (collision) {
    throw new SchemaInvariantError(`rebuild target name ${plan.newTable} already exists`);
  }

  const expectedViews = existingViews(conn, STATE_GRAPH_VIEWS);
  const dependents = snapshotDependents(conn, plan.table);
  const omit = new Set(plan.omitDependentObjects ?? []);
  const rebuildSearch = plan.table === "nodes" && tableExists(conn, "kb_words") && tableExists(conn, "kb_ident");
  let committed = false;

  conn.exec("PRAGMA foreign_keys = OFF");
  try {
    conn.exec("BEGIN IMMEDIATE");
    try {
      for (const object of dependents) {
        if (object.kind === "view") conn.exec(`DROP VIEW ${quoteIdent(object.name)}`);
        if (object.kind === "virtual") conn.exec(`DROP TABLE ${quoteIdent(object.name)}`);
      }
      conn.exec(plan.createTableSql);
      conn.exec(plan.copySql);
      conn.exec(`DROP TABLE ${quoteIdent(plan.table)}`);
      conn.exec(`ALTER TABLE ${quoteIdent(plan.newTable)} RENAME TO ${quoteIdent(plan.table)}`);
      for (const object of dependents) {
        if (omit.has(object.name)) continue;
        conn.exec(object.sql);
      }
      assertObjectsRestored(
        conn,
        dependents.filter((object) => !omit.has(object.name)),
      );
      for (const name of omit) {
        const forgotten = dependents.find((object) => object.name === name);
        if (forgotten) {
          throw new ViewInvariantError(`rebuild forgot dependent ${forgotten.kind} ${forgotten.name}`);
        }
      }
      assertForeignKeyCheck(conn);
      assertExpectedViews(conn, expectedViews);
      if (plan.table === "nodes" || tableExists(conn, "nodes")) assertNodesIntegerPrimaryKey(conn);
      if (rebuildSearch) markSearchRebuildPending(conn);
      plan.beforeCommit?.(conn);
      rebuildAuditHooks.get(conn)?.(conn);
      conn.exec("COMMIT");
      committed = true;
    } catch (error) {
      rollbackIfOpen(conn);
      throw error;
    }
  } finally {
    try {
      enableForeignKeys(conn, committed);
    } catch (fkError) {
      if (committed) throw fkError;
    }
  }

  if (rebuildSearch) {
    rebuildNodesSearchIndexes(conn);
    clearSearchRebuildPending(conn);
  }
}

export function rebuildNodesSearchIndexes(conn: SqliteConnection): void {
  if (!tableExists(conn, "nodes") || !tableExists(conn, "kb_words") || !tableExists(conn, "kb_ident")) return;
  conn.exec("INSERT INTO kb_ident(kb_ident) VALUES('rebuild')");
  conn.exec("INSERT INTO kb_words(kb_words) VALUES('delete-all')");
  conn.exec(
    `INSERT INTO kb_words(rowid, title, body)
     SELECT nid, ef_search_text(title), ef_search_text(text || ' ' || fields) FROM nodes`,
  );
  verifyNodesSearchIndexes(conn);
}

export function verifyNodesSearchIndexes(conn: SqliteConnection): void {
  if (!tableExists(conn, "nodes") || !tableExists(conn, "kb_words") || !tableExists(conn, "kb_ident")) return;
  const nodes = countRows(conn, "SELECT count(*) AS c FROM nodes");
  const words = countRows(conn, "SELECT count(*) AS c FROM kb_words");
  const ident = countRows(conn, "SELECT count(*) AS c FROM kb_ident");
  if (words !== nodes || ident !== nodes) {
    throw new SearchIndexDriftError(
      `search index counts drifted after rebuild: nodes=${nodes}, kb_words=${words}, kb_ident=${ident}`,
    );
  }
  const missingWords = countRows(
    conn,
    "SELECT count(*) AS c FROM nodes n WHERE NOT EXISTS (SELECT 1 FROM kb_words w WHERE w.rowid = n.nid)",
  );
  const missingIdent = countRows(
    conn,
    "SELECT count(*) AS c FROM nodes n WHERE NOT EXISTS (SELECT 1 FROM kb_ident k WHERE k.rowid = n.nid AND k.id = n.id)",
  );
  if (missingWords !== 0 || missingIdent !== 0) {
    throw new SearchIndexDriftError(
      `search index rowids drifted: missing kb_words=${missingWords}, missing kb_ident=${missingIdent}`,
    );
  }
  assertCamelCaseHits(conn);
  assertTrigramHits(conn);
}

function countRows(conn: SqliteConnection, sql: string): number {
  const row = conn.prepare(sql).get();
  const value = row?.c;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return 0;
}

function camelCaseFragments(title: string): string[] {
  const raw = new Set(
    title
      .split(/\s+/)
      .map((token) => token.toLowerCase())
      .filter((token) => token.length > 0),
  );
  const produced = efSearchText(title)
    .split(/\s+/)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 2 && /^[a-z0-9]+$/.test(token) && !raw.has(token));
  return [...new Set(produced)];
}

function assertCamelCaseHits(conn: SqliteConnection): void {
  const samples = conn
    .prepare("SELECT id, title FROM nodes WHERE title GLOB '*[a-z][A-Z]*' LIMIT 5")
    .all();
  for (const sample of samples) {
    const id = typeof sample.id === "string" ? sample.id : "";
    const title = typeof sample.title === "string" ? sample.title : "";
    const fragments = camelCaseFragments(title);
    const left = fragments[0];
    const right = fragments[1] ?? fragments[0];
    if (left === undefined || right === undefined) continue;
    const match = left === right ? left : `${left} AND ${right}`;
    const hits = conn
      .prepare(
        "SELECT n.id AS id FROM kb_words w JOIN nodes n ON n.nid = w.rowid WHERE kb_words MATCH ?",
      )
      .all(match);
    if (!hits.some((hit) => hit.id === id)) {
      throw new SearchIndexDriftError(`camelCase query "${match}" did not find node ${id}`);
    }
  }
}

function assertTrigramHits(conn: SqliteConnection): void {
  const samples = conn.prepare("SELECT id FROM nodes WHERE length(id) >= 4 LIMIT 5").all();
  for (const sample of samples) {
    const id = typeof sample.id === "string" ? sample.id : "";
    if (id.length < 4) continue;
    const needle = id.slice(0, 4);
    const hits = conn.prepare("SELECT id FROM kb_ident WHERE id LIKE '%' || ? || '%'").all(needle);
    if (!hits.some((hit) => hit.id === id)) {
      throw new SearchIndexDriftError(`trigram/LIKE query "${needle}" did not find node ${id}`);
    }
  }
}

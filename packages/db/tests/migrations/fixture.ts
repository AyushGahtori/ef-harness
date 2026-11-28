import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openNodeSqliteConnection } from "../../src/migrations/connection.js";
import { runTwelveStepRebuild } from "../../src/migrations/rebuild.js";
import type {
  Clock,
  MigrationDefinition,
  SqlValue,
  SqliteConnection,
  TargetDb,
  TwelveStepRebuildPlan,
  WorkerReaderPool,
} from "../../src/migrations/types.js";

export const APP_VERSION = "1.2.3";
export const CLOCK_NOW = 1_735_000_000_000;
export const HASH_A = "a".repeat(64);
export const HASH_B = "b".repeat(64);

export const fixedClock: Clock = {
  now: () => CLOCK_NOW,
};

export const closedReaders: WorkerReaderPool = {
  drainAndClose() {
    return undefined;
  },
};

export function num(value: SqlValue | undefined): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return 0;
}

export function fileHash(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export async function withDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-task015-"));
  try {
    await run(dir);
  } finally {
    await removeTree(dir);
  }
}

async function removeTree(dir: string): Promise<void> {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 8) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }
  }
}

export function withConnection<T>(
  dbPath: string,
  targetDb: TargetDb,
  readOnly: boolean,
  fn: (conn: SqliteConnection) => T,
): T {
  const conn = openNodeSqliteConnection(dbPath, { readOnly, targetDb });
  try {
    return fn(conn);
  } finally {
    conn.close();
  }
}

export function userVersion(dbPath: string, targetDb: TargetDb): number {
  return withConnection(dbPath, targetDb, true, (conn) => {
    const row = conn.prepare("PRAGMA user_version").get();
    return num(row?.user_version);
  });
}

export function scalar(conn: SqliteConnection, sql: string): number {
  const row = conn.prepare(sql).get();
  return num(row?.c);
}

const STATE_SCHEMA = `
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('additive','rebuild','data')),
  app_version TEXT NOT NULL,
  applied_at INTEGER NOT NULL
) STRICT;

CREATE TABLE node_kinds (
  kind TEXT PRIMARY KEY,
  is_requirement INTEGER NOT NULL DEFAULT 0 CHECK (is_requirement IN (0, 1))
) STRICT, WITHOUT ROWID;

CREATE TABLE nodes (
  nid INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL REFERENCES node_kinds(kind),
  version INTEGER NOT NULL CHECK (version >= 1),
  title TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  fields TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active'
) STRICT;
CREATE INDEX nodes_kind ON nodes(kind);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  bytes INTEGER NOT NULL
) STRICT;

CREATE TABLE task_runtime (
  task TEXT PRIMARY KEY,
  state TEXT NOT NULL
) STRICT;

CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  state TEXT NOT NULL
) STRICT;

CREATE VIRTUAL TABLE kb_words USING fts5(
  title, body, content = '', contentless_delete = 1, tokenize = 'unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE kb_ident USING fts5(
  id, title, content = 'nodes', content_rowid = 'nid', tokenize = 'trigram'
);

CREATE VIEW requirements AS
  SELECT n.id, n.kind, n.title AS risk, n.version
    FROM nodes n JOIN node_kinds k ON k.kind = n.kind
   WHERE k.is_requirement = 1 AND n.status = 'active';

CREATE VIEW task_requirements AS
  SELECT n.id AS task_id, n.id AS requirement_id FROM nodes n WHERE n.kind = 'task';

CREATE VIEW check_requirements AS
  SELECT n.id AS check_id, n.id AS requirement_id FROM nodes n WHERE n.kind = 'check';

CREATE VIEW waivers AS
  SELECT n.id, n.title AS reason FROM nodes n WHERE n.kind = 'waiver';

CREATE TRIGGER nodes_no_delete BEFORE DELETE ON nodes BEGIN
  SELECT RAISE(ABORT, 'nodes are retired, never deleted');
END;

CREATE TRIGGER nodes_ai AFTER INSERT ON nodes BEGIN
  INSERT INTO kb_words(rowid, title, body) VALUES (new.nid, new.title, new.text);
END;

INSERT INTO node_kinds(kind, is_requirement) VALUES
  ('spec_item', 1),
  ('task', 0),
  ('check', 0),
  ('waiver', 0);

INSERT INTO nodes(nid, id, kind, version, title, text, fields, status) VALUES
  (1, 'REQ1', 'spec_item', 1, 'parseHttpResponse', 'split camel case', '{}', 'active'),
  (2, 'TASK7', 'task', 1, 'ShipWorker', 'worker loop', '{}', 'active');

INSERT INTO meta(key, value) VALUES ('project_id', 'fixture');
`;

const GLOBAL_SCHEMA = `
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('additive','rebuild','data')),
  app_version TEXT NOT NULL,
  applied_at INTEGER NOT NULL
) STRICT;

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  display_name TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok','needs_migration','needs_repair','offline','removed')),
  last_opened_at INTEGER,
  last_seen_at INTEGER
) STRICT;

CREATE TABLE cas_pins (
  hash TEXT NOT NULL,
  holder_kind TEXT NOT NULL CHECK (holder_kind IN ('project','backup','research','export','pending')),
  holder_id TEXT NOT NULL,
  pinned_at INTEGER NOT NULL,
  PRIMARY KEY (hash, holder_kind, holder_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE footprints (
  consumer   TEXT NOT NULL,
  project    TEXT NOT NULL DEFAULT '',
  p50_mb     INTEGER NOT NULL,
  p95_mb     INTEGER NOT NULL,
  samples    INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (consumer, project)
) STRICT, WITHOUT ROWID;
`;

const TINY_SCHEMA = `
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('additive','rebuild','data')),
  app_version TEXT NOT NULL,
  applied_at INTEGER NOT NULL
) STRICT;
`;

export interface StateDbOptions {
  readonly artifactHash?: string;
  readonly freelist?: boolean;
  readonly tasks?: readonly { readonly task: string; readonly state: string }[];
  readonly attempts?: readonly { readonly id: string; readonly task: string; readonly state: string }[];
  readonly userVersion?: number;
}

export function createStateDb(dir: string, fileName: string, options: StateDbOptions = {}): string {
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, fileName);
  const conn = openNodeSqliteConnection(dbPath, { readOnly: false, targetDb: "state" });
  try {
    conn.exec(STATE_SCHEMA);
    if (options.artifactHash !== undefined) {
      conn.prepare("INSERT INTO artifacts(id, hash, bytes) VALUES ('art-1', ?, 4)").run(options.artifactHash);
    }
    const insertTask = conn.prepare("INSERT INTO task_runtime(task, state) VALUES (?, ?)");
    for (const task of options.tasks ?? []) insertTask.run(task.task, task.state);
    const insertAttempt = conn.prepare("INSERT INTO attempts(id, task, state) VALUES (?, ?, ?)");
    for (const attempt of options.attempts ?? []) insertAttempt.run(attempt.id, attempt.task, attempt.state);
    if (options.freelist) addFreelist(conn);
    conn.exec(`PRAGMA user_version = ${options.userVersion ?? 1}`);
  } finally {
    conn.close();
  }
  return dbPath;
}

export function createGlobalDb(
  dir: string,
  projects: readonly { readonly id: string; readonly stateDbPath: string; readonly name: string }[],
): string {
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, "global.db");
  const conn = openNodeSqliteConnection(dbPath, { readOnly: false, targetDb: "global" });
  try {
    conn.exec(GLOBAL_SCHEMA);
    const insert = conn.prepare(
      "INSERT INTO projects(id, path, display_name, schema_version, status, last_opened_at, last_seen_at) VALUES (?, ?, ?, 1, 'ok', 1, 1)",
    );
    for (const project of projects) insert.run(project.id, project.stateDbPath, project.name);
    conn.exec("PRAGMA user_version = 1");
  } finally {
    conn.close();
  }
  return dbPath;
}

export function createTinyDb(file: string, userVersion: number, targetDb: TargetDb = "global"): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = openNodeSqliteConnection(file, { readOnly: false, targetDb });
  try {
    conn.exec(TINY_SCHEMA);
    conn.exec(`PRAGMA user_version = ${userVersion}`);
  } finally {
    conn.close();
  }
}

export function addFreelist(conn: SqliteConnection): void {
  conn.exec("CREATE TABLE scratch (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)");
  const insert = conn.prepare("INSERT INTO scratch(payload) VALUES (?)");
  const payload = "x".repeat(4000);
  conn.exec("BEGIN IMMEDIATE");
  try {
    for (let index = 0; index < 40; index += 1) insert.run(payload);
    conn.exec("COMMIT");
  } catch (error) {
    try {
      conn.exec("ROLLBACK");
    } catch (rollbackError) {
      throw new Error(
        `freelist seed failed (${error instanceof Error ? error.message : String(error)}); rollback failed (${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)})`,
      );
    }
    throw error;
  }
  conn.exec("DELETE FROM scratch");
}

export function priorityRebuildPlan(options?: {
  readonly omitDependentObjects?: readonly string[];
  readonly beforeCommit?: (conn: SqliteConnection) => void;
  readonly integerPrimaryKey?: boolean;
  readonly corruptForeignKey?: boolean;
}): TwelveStepRebuildPlan {
  const integerPrimaryKey = options?.integerPrimaryKey !== false;
  const nidColumn = integerPrimaryKey ? "nid INTEGER PRIMARY KEY" : "nid TEXT PRIMARY KEY";
  const nidSelect = integerPrimaryKey ? "nid" : "CAST(nid AS TEXT)";
  let copySql = `INSERT INTO nodes_new (nid, id, kind, version, title, text, fields, status, note, priority)
    SELECT ${nidSelect}, id, kind, version, title, text, fields, status, note, 1 FROM nodes`;
  if (options?.corruptForeignKey) {
    copySql += `;
      INSERT INTO nodes_new (nid, id, kind, version, title, text, fields, status, note, priority)
      VALUES (99, 'BAD1', 'missing-kind', 1, 'Bad Title', '', '{}', 'active', '', 1)`;
  }
  const plan: TwelveStepRebuildPlan = {
    table: "nodes",
    newTable: "nodes_new",
    createTableSql: `CREATE TABLE nodes_new (
      ${nidColumn},
      id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL REFERENCES node_kinds(kind),
      version INTEGER NOT NULL CHECK (version >= 1),
      title TEXT NOT NULL CHECK (length(title) > 0),
      text TEXT NOT NULL DEFAULT '',
      fields TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      note TEXT NOT NULL DEFAULT '',
      priority INTEGER NOT NULL DEFAULT 0
    )`,
    copySql,
    ...(options?.omitDependentObjects !== undefined
      ? { omitDependentObjects: options.omitDependentObjects }
      : {}),
    ...(options?.beforeCommit !== undefined ? { beforeCommit: options.beforeCommit } : {}),
  };
  return plan;
}

export const globalAdditive: MigrationDefinition = {
  kind: "additive",
  version: 2,
  name: "projects_add_note",
  targetDb: "global",
  apply(conn) {
    conn.exec("ALTER TABLE projects ADD COLUMN note TEXT NOT NULL DEFAULT ''");
  },
};

export const stateAdditive: MigrationDefinition = {
  kind: "additive",
  version: 2,
  name: "nodes_add_note",
  targetDb: "state",
  apply(conn) {
    conn.exec("ALTER TABLE nodes ADD COLUMN note TEXT NOT NULL DEFAULT ''");
    conn.exec("UPDATE nodes SET note = 'kept' WHERE id = 'REQ1'");
    conn.exec("CREATE INDEX nodes_note ON nodes(note)");
  },
  check(conn) {
    const row = conn.prepare("SELECT count(*) AS c FROM pragma_table_info('nodes') WHERE name = 'note'").get();
    if (num(row?.c) !== 1) throw new Error("note column missing");
  },
};

export const stateRebuild: MigrationDefinition = {
  kind: "rebuild",
  version: 3,
  name: "nodes_priority_rebuild",
  targetDb: "state",
  apply(conn) {
    runTwelveStepRebuild(conn, priorityRebuildPlan());
  },
  check(conn) {
    const row = conn.prepare("SELECT priority AS priority FROM nodes WHERE id = 'REQ1'").get();
    if (num(row?.priority) !== 1) throw new Error("rebuild did not copy priority");
  },
};

export const stateData: MigrationDefinition = {
  kind: "data",
  version: 2,
  name: "stamp_project_meta",
  targetDb: "state",
  apply(conn) {
    const result = conn.prepare("UPDATE meta SET value = 'stamped' WHERE key = 'project_id'").run();
    if (result.changes !== 1) throw new Error("meta row was not stamped");
  },
  check(conn) {
    const row = conn.prepare("SELECT value FROM meta WHERE key = 'project_id'").get();
    if (row?.value !== "stamped") throw new Error("stamped meta did not persist");
  },
};

export function appMigrations(): MigrationDefinition[] {
  return [globalAdditive, stateAdditive, stateRebuild];
}

export interface AuditRow {
  readonly version: number;
  readonly name: string;
  readonly kind: string;
  readonly appVersion: string;
  readonly appliedAt: number;
}

export function readAudit(conn: SqliteConnection): AuditRow[] {
  return conn
    .prepare("SELECT version, name, kind, app_version, applied_at FROM schema_migrations ORDER BY version")
    .all()
    .map((row) => ({
      version: num(row.version),
      name: String(row.name),
      kind: String(row.kind),
      appVersion: String(row.app_version),
      appliedAt: num(row.applied_at),
    }));
}

export interface PinRow {
  readonly hash: string;
  readonly holderKind: string;
  readonly holderId: string;
  readonly pinnedAt: number;
}

export function readPins(globalDbPath: string): PinRow[] {
  return withConnection(globalDbPath, "global", true, (conn) =>
    conn
      .prepare("SELECT hash, holder_kind, holder_id, pinned_at FROM cas_pins ORDER BY holder_id, hash")
      .all()
      .map((row) => ({
        hash: String(row.hash),
        holderKind: String(row.holder_kind),
        holderId: String(row.holder_id),
        pinnedAt: num(row.pinned_at),
      })),
  );
}

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  PreparedWrite,
  ProjectStateDb,
  ProjectStateWriter,
  SqlValue,
} from "../../src/write-queue/index.js";

export const OPERATIONS_DDL = `
CREATE TABLE operations (
  op_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result TEXT NOT NULL,
  committed_rev INTEGER,
  created_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
CREATE INDEX operations_age ON operations(created_at);
`;

export interface TestStateDb extends ProjectStateDb {
  execHook: ((sql: string) => void) | null;
  armSafeMode(): void;
  readonly safeModeEntries: Array<{
    reason: string;
    diagnostics: Readonly<Record<string, string | number>> | undefined;
  }>;
}

export interface OpenedState {
  readonly stateDb: TestStateDb;
  readonly database: DatabaseSync;
  readonly commits: { count: number };
  close(): void;
}

export function openState(options?: { readonly file?: boolean; readonly extraSql?: string }): OpenedState {
  const commits = { count: 0 };
  let directory: string | undefined;
  const database = options?.file
    ? openFileDatabase((dir) => {
        directory = dir;
      })
    : new DatabaseSync(":memory:");
  database.exec(OPERATIONS_DDL);
  if (options?.extraSql) database.exec(options.extraSql);

  const stateDb: TestStateDb = {
    execHook: null,
    safeModeEntries: [],
    writer: undefined as unknown as ProjectStateWriter,
    isSafeMode(): boolean {
      return this.safeModeEntries.length > 0 || armed;
    },
    enterSafeMode(reason, diagnostics): void {
      armed = true;
      this.safeModeEntries.push({ reason, diagnostics });
    },
    armSafeMode(): void {
      armed = true;
    },
  };
  let armed = false;
  const writer: ProjectStateWriter = {
    exec: (sql: string) => {
      if (stateDb.execHook) {
        stateDb.execHook(sql);
        return;
      }
      database.exec(sql);
      if (sqlVerb(sql) === "COMMIT") commits.count += 1;
    },
    prepare: (sql: string) => prepare(database, sql),
  };
  stateDb.writer = writer;
  return {
    stateDb,
    database,
    commits,
    close: () => {
      database.close();
      if (directory) rmSync(directory, { recursive: true, force: true });
    },
  };
}

export function sqlVerb(sql: string): string {
  const match = /^\s*([A-Za-z]+)/.exec(sql);
  return (match?.[1] ?? "").toUpperCase();
}

export function scalar(database: DatabaseSync, sql: string): number {
  const row = database.prepare(sql).get() as { n?: number | bigint } | undefined;
  const value = row?.n ?? 0;
  return typeof value === "bigint" ? Number(value) : value;
}

function openFileDatabase(remember: (directory: string) => void): DatabaseSync {
  const directory = mkdtempSync(path.join(tmpdir(), "ef-write-queue-"));
  remember(directory);
  const database = new DatabaseSync(path.join(directory, "state.db"));
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA temp_store = MEMORY");
  const mode = database.prepare("PRAGMA journal_mode").get() as { journal_mode?: string } | undefined;
  if (mode?.journal_mode !== "wal") {
    database.close();
    rmSync(directory, { recursive: true, force: true });
    throw new Error(`expected WAL, received ${mode?.journal_mode ?? "unknown"}`);
  }
  return database;
}

function prepare(database: DatabaseSync, sql: string): PreparedWrite {
  const statement = database.prepare(sql);
  statement.setAllowBareNamedParameters(true);
  return {
    get: (params?: Readonly<Record<string, SqlValue>>) => statement.get({ ...(params ?? {}) }),
    all: (params?: Readonly<Record<string, SqlValue>>) => statement.all({ ...(params ?? {}) }),
    run: (params?: Readonly<Record<string, SqlValue>>) => statement.run({ ...(params ?? {}) }),
  };
}

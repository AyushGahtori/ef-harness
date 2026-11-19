import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  createDatabaseFromSchema,
  openDatabase,
  readSchema,
  registerSearchText,
  writeMeta,
} from "../../src/recovery/sqlite-io.js";

export interface ProjectFixture {
  readonly root: string;
  readonly projectId: string;
  readonly projectDir: string;
  readonly stateDbPath: string;
  readonly globalDbPath: string;
  readonly backupsDir: string;
  readonly historyDir: string;
  readonly telemetryDbPath: string;
  readonly codeIndexDbPath: string;
}

export function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ef-task-016-"));
}

export function removeTempRoot(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}

export function makeProject(root: string, projectId = "proj-1"): ProjectFixture {
  const projectDir = path.join(root, "projects", projectId);
  const backupsDir = path.join(projectDir, "backups");
  const historyDir = path.join(root, "history");
  fs.mkdirSync(backupsDir, { recursive: true });
  fs.mkdirSync(historyDir, { recursive: true });
  const stateDbPath = path.join(projectDir, "state.db");
  const globalDbPath = path.join(root, "global.db");
  const telemetryDbPath = path.join(projectDir, "telemetry.db");
  const codeIndexDbPath = path.join(projectDir, "code-index.db");
  const state = createDatabaseFromSchema(stateDbPath, readSchema("state.sql"));
  state.exec("PRAGMA journal_mode = WAL");
  writeMeta(state, "project_id", projectId);
  writeMeta(state, "stream_epoch", "1");
  writeMeta(state, "last_rev", "0");
  state.close();
  const global = createDatabaseFromSchema(globalDbPath, readSchema("global.sql"));
  global
    .prepare(
      `INSERT INTO projects(id, path, display_name, schema_version, status)
       VALUES (?, ?, ?, 1, 'ok')`,
    )
    .run(projectId, projectDir, projectId);
  global.close();
  return {
    root,
    projectId,
    projectDir,
    stateDbPath,
    globalDbPath,
    backupsDir,
    historyDir,
    telemetryDbPath,
    codeIndexDbPath,
  };
}

export function withState(filePath: string, fn: (db: DatabaseSync) => void): void {
  const db = openDatabase(filePath, false);
  registerSearchText(db);
  try {
    fn(db);
  } finally {
    db.close();
  }
}

export function setMeta(filePath: string, key: string, value: string): void {
  withState(filePath, (db) => {
    writeMeta(db, key, value);
  });
}

export function readMetaValue(filePath: string, key: string): string | null {
  const db = openDatabase(filePath, true);
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
    const value = row?.value;
    return typeof value === "string" ? value : value == null ? null : String(value);
  } finally {
    db.close();
  }
}

export function artifactHash(id: string): string {
  return createHash("sha256").update(id).digest("hex");
}

export function replaceArtifacts(filePath: string, ids: readonly string[], at: number): void {
  withState(filePath, (db) => {
    db.exec("DELETE FROM artifacts");
    const insert = db.prepare(
      `INSERT INTO artifacts(id, hash, kind, bytes, retention, created_at)
       VALUES (?, ?, 'diff', 8, 'evidence', ?)`,
    );
    for (const id of ids) insert.run(id, artifactHash(id), at);
  });
}

export function corruptBTreePages(filePath: string, seed: number): void {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 100) {
    throw new Error(`database is too small to corrupt: ${filePath}`);
  }
  const pageSizeRaw = buf.readUInt16BE(16);
  const pageSize = pageSizeRaw === 1 ? 65536 : pageSizeRaw;
  let state = seed >>> 0;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  const pages = Math.max(1, Math.floor(buf.length / Math.max(pageSize, 1)));
  for (let page = 0; page < pages; page += 1) {
    const base = page * pageSize;
    const start = page === 0 ? Math.min(buf.length, base + 100) : Math.min(buf.length, base + 8);
    const end = Math.min(buf.length, base + pageSize);
    for (let offset = start; offset < end; offset += 13) {
      buf[offset] = next() & 0xff;
    }
  }
  fs.writeFileSync(filePath, buf);
}

export function writeCorruptWal(stateDbPath: string): string {
  const walPath = `${stateDbPath}-wal`;
  fs.writeFileSync(walPath, Buffer.from("this is not a sqlite wal frame"));
  return walPath;
}

export function projectFiles(project: ProjectFixture): {
  project: { projectId: string; filePath: string };
  globalDb: { filePath: string };
} {
  return {
    project: { projectId: project.projectId, filePath: project.stateDbPath },
    globalDb: { filePath: project.globalDbPath },
  };
}

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalAssetAbsolute } from "@ef-harness/shared-contracts";

export interface WalCheckpoint {
  readonly busy: number;
  readonly log: number;
  readonly checkpointed: number;
}

export class ReaderPool {
  private readonly readers: DatabaseSync[] = [];

  open(file: string): DatabaseSync {
    const db = new DatabaseSync(file, { readOnly: true });
    this.readers.push(db);
    return db;
  }

  closeAll(): number {
    const count = this.readers.length;
    while (this.readers.length > 0) {
      const db = this.readers.pop();
      if (db) db.close();
    }
    return count;
  }

  get size(): number {
    return this.readers.length;
  }
}

export interface OpenDatabases {
  readonly globalDb: DatabaseSync;
  readonly stateDb: DatabaseSync;
  readonly readers: ReaderPool;
  readonly globalPath: string;
  readonly statePath: string;
}

export function openHarnessDatabases(globalPath: string, statePath: string, appVersion: string): OpenDatabases {
  fs.mkdirSync(path.dirname(globalPath), { recursive: true });
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const globalDb = openWriter(globalPath, canonicalAssetAbsolute("globalSql"), appVersion);
  const stateDb = openWriter(statePath, canonicalAssetAbsolute("stateSql"), appVersion, true);
  const readers = new ReaderPool();
  readers.open(globalPath);
  readers.open(statePath);
  return { globalDb, stateDb, readers, globalPath, statePath };
}

function openWriter(file: string, schemaFile: string, appVersion: string, withSearch: boolean = false): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = FULL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA secure_delete = ON");
  if (withSearch) {
    db.function("ef_search_text", { deterministic: true }, (value) => splitWords(value));
  }
  const existing = db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get() as
    | { c?: number }
    | undefined;
  if (!existing || Number(existing.c ?? 0) === 0) {
    db.exec(fs.readFileSync(schemaFile, "utf8"));
    db.prepare(
      "INSERT INTO schema_migrations(version, name, kind, app_version, applied_at) VALUES (1, 'foundation', 'additive', ?, ?)",
    ).run(appVersion, Date.now());
  }
  return db;
}

export function checkpointTruncate(db: DatabaseSync): WalCheckpoint {
  const row: unknown = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
  if (!row || typeof row !== "object") {
    return { busy: -1, log: -1, checkpointed: -1 };
  }
  const record = row as Record<string, unknown>;
  return {
    busy: Number(record.busy ?? 0),
    log: Number(record.log ?? 0),
    checkpointed: Number(record.checkpointed ?? 0),
  };
}

function splitWords(value: unknown): string {
  const text = typeof value === "string" ? value : "";
  const extra = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-./:]+/g, " ");
  return `${text} ${extra}`;
}

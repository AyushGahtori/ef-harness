import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { ForeignKeyViolationError } from "./errors.js";
import { quoteIdent, sqlParam } from "./sql.js";
import type { DataValue, GeneratedDataset, SqlBatch } from "./types.js";

export function openSqlite(file: string, readOnly = false): DatabaseSync {
  const db = new DatabaseSync(file, {
    readOnly,
    enableForeignKeyConstraints: true,
  });
  if (!readOnly) db.exec("PRAGMA foreign_keys = ON");
  return db;
}

export function assertForeignKeysEnabled(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA foreign_keys").get();
  if (row?.foreign_keys !== 1) {
    throw new Error("SQLite foreign_keys must stay ON during synthetic load");
  }
}

export function loadDatasetSqlite(db: DatabaseSync, dataset: GeneratedDataset): void {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA synchronous = OFF");
  db.exec("PRAGMA journal_mode = OFF");
  assertForeignKeysEnabled(db);
  db.exec("BEGIN");
  try {
    for (const batch of dataset.bulk.sqlite) runBatch(db, batch);
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
  assertForeignKeysEnabled(db);
  const violations = db.prepare("PRAGMA foreign_key_check").all();
  if (violations.length > 0) {
    throw new ForeignKeyViolationError(violations.map((row) => JSON.stringify(row)));
  }
}

function runBatch(db: DatabaseSync, batch: SqlBatch): void {
  const statement = db.prepare(batch.sql);
  const params = batch.params.map((value) => sqlParam(value)) as SQLInputValue[];
  statement.run(...params);
}

export function countRows(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT count(*) AS c FROM ${quoteIdent(table)}`).get();
  const value = row?.c;
  return typeof value === "number" ? value : Number(value ?? 0);
}

export function sqlValues(values: readonly DataValue[]): SQLInputValue[] {
  return values.map((value) => sqlParam(value)) as SQLInputValue[];
}

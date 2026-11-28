import { PreviewMigrationRejectedError } from "./errors.js";
import type { SqlMigration } from "./ports.js";

const CREATE_TABLE =
  /^CREATE TABLE IF NOT EXISTS [A-Za-z_][A-Za-z0-9_]* \([A-Za-z0-9_,() ]+\)$/i;
const ADD_COLUMN =
  /^ALTER TABLE [A-Za-z_][A-Za-z0-9_]* ADD COLUMN [A-Za-z_][A-Za-z0-9_]* [A-Za-z_][A-Za-z0-9_]*$/i;
const CREATE_INDEX =
  /^CREATE INDEX IF NOT EXISTS [A-Za-z_][A-Za-z0-9_]* ON [A-Za-z_][A-Za-z0-9_]* \([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)*\)$/i;

const DESTRUCTIVE =
  /\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT|REPLACE|ATTACH|DETACH|VACUUM|RENAME)\b/i;

export function assertAdditiveSql(sql: string): string {
  const normalized = sql.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) {
    throw new PreviewMigrationRejectedError("empty SQL is not an additive migration");
  }
  if (normalized.includes(";") || normalized.includes("--") || normalized.includes("/*")) {
    throw new PreviewMigrationRejectedError("only a single additive statement is applied");
  }
  if (DESTRUCTIVE.test(normalized)) {
    throw new PreviewMigrationRejectedError(
      "merge updates apply only additive migrations and never wipe preview data",
    );
  }
  if (!CREATE_TABLE.test(normalized) && !ADD_COLUMN.test(normalized) && !CREATE_INDEX.test(normalized)) {
    throw new PreviewMigrationRejectedError(
      "only CREATE TABLE IF NOT EXISTS, ALTER TABLE ADD COLUMN, and CREATE INDEX IF NOT EXISTS are additive",
    );
  }
  return normalized;
}

export function assertMigrationIdentity(migration: SqlMigration): void {
  if (!/^[A-Za-z0-9._:-]+$/.test(migration.id)) {
    throw new PreviewMigrationRejectedError(`invalid migration id ${migration.id}`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(migration.featureId)) {
    throw new PreviewMigrationRejectedError(`invalid feature id ${migration.featureId}`);
  }
  assertAdditiveSql(migration.sql);
}

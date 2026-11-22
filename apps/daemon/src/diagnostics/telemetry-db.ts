import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { TelemetryUnavailableError, type SqliteDatabaseHealth } from "./types.js";

export const TELEMETRY_SCHEMA_SQL = `
CREATE TABLE telemetry (
  id      INTEGER PRIMARY KEY,
  attempt TEXT,
  ts      INTEGER NOT NULL,
  kind    TEXT NOT NULL,
  data    TEXT NOT NULL
) STRICT;
CREATE INDEX telemetry_attempt ON telemetry(attempt, ts);
CREATE INDEX telemetry_ts ON telemetry(ts);
`;

const ENSURE_TELEMETRY_SCHEMA_SQL = TELEMETRY_SCHEMA_SQL.replace(
  "CREATE TABLE telemetry",
  "CREATE TABLE IF NOT EXISTS telemetry",
).replaceAll("CREATE INDEX ", "CREATE INDEX IF NOT EXISTS ");

export interface TelemetryRow {
  readonly id: number;
  readonly ts: number;
  readonly kind: string;
  readonly data: string;
}

export function openTelemetryDatabase(path: string, readOnly: boolean): DatabaseSync {
  try {
    const database = new DatabaseSync(path, { readOnly });
    if (!readOnly) {
      database.exec("PRAGMA journal_mode = WAL");
      database.exec("PRAGMA synchronous = NORMAL");
      database.exec(ENSURE_TELEMETRY_SCHEMA_SQL);
    } else {
      database.exec("PRAGMA query_only = ON");
    }
    return database;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unreadable";
    throw new TelemetryUnavailableError(`${message}`);
  }
}

export function rebuildTelemetryDatabase(path: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const target = `${path}${suffix}`;
    if (existsSync(target)) rmSync(target, { force: true });
  }
  const parent = dirname(path);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  const database = openTelemetryDatabase(path, false);
  database.close();
}

export function fileByteSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

export function inspectSqliteFile(
  path: string,
  name: SqliteDatabaseHealth["name"],
): SqliteDatabaseHealth {
  const bytes = fileByteSize(path);
  const walBytes = fileByteSize(`${path}-wal`);
  if (!existsSync(path)) {
    return {
      name,
      path,
      bytes,
      walBytes,
      schemaVersion: null,
      quickCheck: "missing",
    };
  }
  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(path, { readOnly: true });
    const versionRow = database.prepare("PRAGMA user_version").get();
    const schemaVersion = readNumberField(versionRow, "user_version");
    const checks = database.prepare("PRAGMA quick_check").all();
    const details = checks.map((row) => readTextField(row, "quick_check") ?? "unknown");
    const quickCheck = details.length === 0 ? "unknown" : details.join("; ");
    return {
      name,
      path,
      bytes,
      walBytes,
      schemaVersion,
      quickCheck,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unreadable";
    return {
      name,
      path,
      bytes,
      walBytes,
      schemaVersion: null,
      quickCheck: message,
    };
  } finally {
    database?.close();
  }
}

export function readTelemetryRows(path: string, sinceMs: number): TelemetryRow[] {
  const database = openTelemetryDatabase(path, true);
  try {
    const rows = database
      .prepare(
        "SELECT id, ts, kind, data FROM telemetry WHERE ts >= ? ORDER BY ts ASC",
      )
      .all(sinceMs);
    const parsed: TelemetryRow[] = [];
    for (const row of rows) {
      const id = readNumberField(row, "id");
      const ts = readNumberField(row, "ts");
      const kind = readTextField(row, "kind");
      const data = readTextField(row, "data");
      if (id === null || ts === null || kind === null || data === null) continue;
      parsed.push({ id, ts, kind, data });
    }
    return parsed;
  } finally {
    database.close();
  }
}

export function readLatestTelemetryKind(path: string, kind: string): TelemetryRow | null {
  const database = openTelemetryDatabase(path, true);
  try {
    const row = database
      .prepare(
        "SELECT id, ts, kind, data FROM telemetry WHERE kind = ? ORDER BY ts DESC LIMIT 1",
      )
      .get(kind);
    if (!row) return null;
    const id = readNumberField(row, "id");
    const ts = readNumberField(row, "ts");
    const data = readTextField(row, "data");
    if (id === null || ts === null || data === null) return null;
    return { id, ts, kind, data };
  } finally {
    database.close();
  }
}

export function readNumberField(
  row: Record<string, unknown> | undefined,
  key: string,
): number | null {
  if (!row) return null;
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  return null;
}

export function readTextField(
  row: Record<string, unknown> | undefined,
  key: string,
): string | null {
  if (!row) return null;
  const value = row[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return null;
}

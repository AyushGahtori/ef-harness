import fs from "node:fs";
import {
  BOOTSTRAP_MIGRATION_KIND,
  BOOTSTRAP_MIGRATION_NAME,
  INITIAL_LAST_REV,
  INITIAL_STREAM_EPOCH,
  INITIAL_WRITER_EPOCH,
  META_KEYS,
} from "./constants.js";
import { DatabaseSchemaVersionError } from "./errors.js";
import { tightenDatabasePermissions } from "./paths.js";
import { renameWithRetry } from "./rename-retry.js";
import {
  assertSchemaViews,
  loadStateSchemaSql,
  openStateConnection,
  type StateConnection,
} from "./sqlite-session.js";

export interface BootstrapRequest {
  databasePath: string;
  tempPath: string;
  projectId: string;
  nowMs: number;
  appVersion: string;
  supportedSchemaVersion: number;
  beforePublish?: () => void;
}

export function bootstrapStateDatabase(request: BootstrapRequest): void {
  if (!Number.isSafeInteger(request.supportedSchemaVersion) || request.supportedSchemaVersion < 1) {
    throw new Error("Supported schema version must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(request.nowMs)) {
    throw new Error("Bootstrap timestamp must be a safe integer.");
  }
  discardSqliteFile(request.tempPath);
  const connection = openStateConnection(request.tempPath, "readwrite");
  try {
    connection.immediate(() => {
      connection.exec(loadStateSchemaSql());
      seedFreshDatabase(connection, request);
      connection.exec(`PRAGMA user_version = ${request.supportedSchemaVersion}`);
      verifyFreshDatabase(connection, request);
    });
    connection.checkpointTruncate();
  } catch (error) {
    closeQuietly(connection);
    discardSqliteFile(request.tempPath);
    throw error;
  }
  closeQuietly(connection);
  discardSidecars(request.tempPath);
  tightenDatabasePermissions(request.tempPath);
  try {
    request.beforePublish?.();
    if (fs.existsSync(request.databasePath)) {
      throw new Error(`Refusing to replace existing database at ${request.databasePath}.`);
    }
    renameWithRetry(request.tempPath, request.databasePath);
  } catch (error) {
    discardSqliteFile(request.tempPath);
    throw error;
  }
  discardSidecars(request.tempPath);
  tightenDatabasePermissions(request.databasePath);
}

export function discardSqliteFile(filePath: string): void {
  fs.rmSync(filePath, { force: true });
  discardSidecars(filePath);
}

function discardSidecars(filePath: string): void {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    fs.rmSync(`${filePath}${suffix}`, { force: true });
  }
}

function seedFreshDatabase(connection: StateConnection, request: BootstrapRequest): void {
  insertMeta(connection, META_KEYS.projectId, request.projectId);
  insertMeta(connection, META_KEYS.streamEpoch, String(INITIAL_STREAM_EPOCH));
  insertMeta(connection, META_KEYS.lastRev, String(INITIAL_LAST_REV));
  insertMeta(connection, META_KEYS.writerEpoch, String(INITIAL_WRITER_EPOCH));
  insertMeta(connection, META_KEYS.createdAt, String(request.nowMs));
  connection.run(
    "INSERT INTO project_runtime(id, state, paused, updated_rev) VALUES (1, 'DISCOVERY', 0, 0)",
  );
  connection.run(
    "INSERT INTO schema_migrations(version, name, kind, app_version, applied_at) VALUES (?, ?, ?, ?, ?)",
    [
      request.supportedSchemaVersion,
      BOOTSTRAP_MIGRATION_NAME,
      BOOTSTRAP_MIGRATION_KIND,
      request.appVersion,
      request.nowMs,
    ],
  );
}

function verifyFreshDatabase(connection: StateConnection, request: BootstrapRequest): void {
  const version = connection.pragmaInteger("user_version");
  if (version !== request.supportedSchemaVersion) {
    throw new DatabaseSchemaVersionError(version, request.supportedSchemaVersion);
  }
  const runtime = connection.get(
    "SELECT id, state, paused, updated_rev FROM project_runtime WHERE id = 1",
  );
  if (!runtime || Number(runtime.id) !== 1 || runtime.state !== "DISCOVERY" || Number(runtime.paused) !== 0) {
    throw new Error("state.db bootstrap did not seed the project_runtime singleton.");
  }
  for (const key of [
    META_KEYS.projectId,
    META_KEYS.streamEpoch,
    META_KEYS.lastRev,
    META_KEYS.writerEpoch,
    META_KEYS.createdAt,
  ]) {
    const row = connection.get("SELECT value FROM meta WHERE key = ?", [key]);
    if (!row || row.value === null || row.value === undefined || String(row.value).length === 0) {
      throw new Error(`state.db bootstrap did not seed meta.${key}.`);
    }
  }
  const migration = connection.get("SELECT version FROM schema_migrations WHERE version = ?", [
    request.supportedSchemaVersion,
  ]);
  if (!migration) throw new Error("state.db bootstrap did not record schema_migrations version 1.");
  assertSchemaViews(connection);
}

function insertMeta(connection: StateConnection, key: string, value: string): void {
  connection.run("INSERT INTO meta(key, value) VALUES (?, ?)", [key, value]);
}

function closeQuietly(connection: StateConnection): void {
  try {
    connection.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not open|already closed/i.test(message)) return;
    throw error;
  }
}

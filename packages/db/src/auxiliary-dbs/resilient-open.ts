import fs from "node:fs";
import path from "node:path";
import { AuxiliaryDbError, DatabaseCorruptError } from "./errors.js";
import { quarantineDatabaseFile } from "./fs-retry.js";
import { loadCanonicalSchema, type SchemaKind } from "./schema-file.js";
import {
  assertQuickCheck,
  isSqliteCorruption,
  openSqliteConnection,
  type ConnectionProfile,
  type SqliteConnection,
} from "./sqlite-connection.js";
import type { AuxiliaryLogger } from "./types.js";

export interface ResilientOpenOptions {
  readonly filePath: string;
  readonly profile: Extract<ConnectionProfile, "telemetry" | "code-index">;
  readonly schema: Extract<SchemaKind, "telemetry" | "codeIndex">;
  readonly requiredTable: string;
  readonly logger: AuxiliaryLogger;
  readonly rebuildCode: string;
  readonly rebuildMessage: string;
}

export function openResilientDatabase(options: ResilientOpenOptions): SqliteConnection {
  fs.mkdirSync(path.dirname(options.filePath), { recursive: true });
  if (!fs.existsSync(options.filePath)) {
    return createFresh(options);
  }
  let connection: SqliteConnection | undefined;
  try {
    connection = openSqliteConnection(options.filePath, options.profile);
    assertQuickCheck(connection);
    const table = connection.get(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?",
      options.requiredTable,
    );
    if (table === undefined) {
      throw new DatabaseCorruptError(`missing table ${options.requiredTable}`);
    }
    return connection;
  } catch (error) {
    connection?.close();
    if (!isRecoverableCorruption(error)) throw error;
    const quarantinePath = quarantineDatabaseFile(options.filePath);
    options.logger.warn({
      code: options.rebuildCode,
      message: options.rebuildMessage,
      details: { filePath: options.filePath, quarantinePath },
    });
    return createFresh(options);
  }
}

function createFresh(options: ResilientOpenOptions): SqliteConnection {
  const connection = openSqliteConnection(options.filePath, options.profile);
  try {
    connection.exec(loadCanonicalSchema(options.schema));
    return connection;
  } catch (error) {
    connection.close();
    throw error;
  }
}

function isRecoverableCorruption(error: unknown): boolean {
  if (error instanceof DatabaseCorruptError) return true;
  if (error instanceof AuxiliaryDbError && error.code === "QUICK_CHECK_FAILED") return true;
  return isSqliteCorruption(error);
}

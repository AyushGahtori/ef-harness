import fs from "node:fs";
import { openNodeSqliteConnection } from "./connection.js";
import { connectGlobalBrokerDb } from "./needs-repair.js";
import { PRODUCTION_SCHEMA_VERSION, productionMigrations } from "./production.js";
import { MigrationRunner } from "./runner.js";
import type {
  Clock,
  GlobalBrokerDb,
  MigrationDefinition,
  MigrationSuccess,
  ProjectStatus,
  TargetDb,
} from "./types.js";

export interface UpgradeOnOpenOptions {
  readonly dbPath: string;
  readonly targetDb: TargetDb;
  readonly appVersion: string;
  readonly backupsDir?: string;
  readonly projectId?: string;
  readonly globalDb?: GlobalBrokerDb;
  readonly globalDbPath?: string;
  readonly clock?: Clock;
  readonly migrations?: readonly MigrationDefinition[];
}

const detachedBroker: GlobalBrokerDb = {
  setProjectStatus(projectId: string, status: ProjectStatus): void {
    throw new Error(`Migration has no global broker for ${projectId} (${status})`);
  },
  registerBackupCasPins(): void {
    throw new Error("Migration has no global broker for backup pins");
  },
};

function backupPinBroker(globalDbPath: string): GlobalBrokerDb {
  return {
    setProjectStatus(projectId: string, status: ProjectStatus): void {
      if (!fs.existsSync(globalDbPath)) return;
      try {
        connectGlobalBrokerDb(globalDbPath).setProjectStatus(projectId, status);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("was not found")) return;
        throw error;
      }
    },
    registerBackupCasPins(pin) {
      if (pin.hashes.length === 0 || !fs.existsSync(globalDbPath)) return;
      connectGlobalBrokerDb(globalDbPath).registerBackupCasPins(pin);
    },
  };
}

/**
 * Run `MigrationRunner.migrateToLatest` before the steady-state writer stays open.
 * Fresh schema files stay at user_version 1; this applies every later migration.
 */
export function upgradeDatabaseOnOpen(options: UpgradeOnOpenOptions): MigrationSuccess {
  if (typeof options.appVersion !== "string" || options.appVersion.trim() === "") {
    throw new Error("upgradeDatabaseOnOpen requires an app version");
  }
  const migrations = options.migrations ?? productionMigrations;
  const globalDb =
    options.globalDb ??
    (options.targetDb === "state" && options.globalDbPath !== undefined
      ? backupPinBroker(options.globalDbPath)
      : detachedBroker);
  const runner = new MigrationRunner({
    globalDbPath: options.globalDbPath ?? options.dbPath,
    globalDb,
    migrations,
    appVersion: options.appVersion,
    readers: {
      drainAndClose() {
        return undefined;
      },
    },
    baselineSchemaVersion: PRODUCTION_SCHEMA_VERSION,
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
  });
  const conn = openNodeSqliteConnection(options.dbPath, {
    readOnly: false,
    targetDb: options.targetDb,
  });
  try {
    return runner.migrateToLatest(conn, {
      dbPath: options.dbPath,
      targetDb: options.targetDb,
      ...(options.backupsDir !== undefined ? { backupsDir: options.backupsDir } : {}),
      ...(options.projectId !== undefined ? { projectId: options.projectId } : {}),
    });
  } finally {
    conn.close();
  }
}

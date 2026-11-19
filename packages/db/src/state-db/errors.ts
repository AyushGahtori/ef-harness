import type { SafeModeDiagnostics, SafeModeReason } from "./types.js";

export class ProjectSafeModeError extends Error {
  readonly reason: SafeModeReason;
  readonly diagnostics: SafeModeDiagnostics;

  constructor(reason: SafeModeReason, diagnostics: SafeModeDiagnostics) {
    super(
      `Project is in safe mode (${reason}). New task dispatches and mutating writes are refused. ${diagnostics.message}`,
    );
    this.name = "ProjectSafeModeError";
    this.reason = reason;
    this.diagnostics = diagnostics;
  }
}

export class ReadOnlyDatabaseError extends Error {
  constructor(message = "This project database is open read-only. The write was refused before SQLite was called.") {
    super(message);
    this.name = "ReadOnlyDatabaseError";
  }
}

export class DatabaseVersionTooNewError extends Error {
  readonly dbVersion: number;
  readonly supportedVersion: number;
  readonly backupDirectory: string;

  constructor(dbVersion: number, supportedVersion: number, backupDirectory: string) {
    super(
      `Database schema version ${dbVersion} is newer than this app supports (${supportedVersion}). Restore a pre-migration backup from ${backupDirectory}.`,
    );
    this.name = "DatabaseVersionTooNewError";
    this.dbVersion = dbVersion;
    this.supportedVersion = supportedVersion;
    this.backupDirectory = backupDirectory;
  }
}

export class DatabaseSchemaVersionError extends Error {
  readonly dbVersion: number;
  readonly supportedVersion: number;

  constructor(dbVersion: number, supportedVersion: number) {
    super(
      `Database schema version ${dbVersion} does not match the supported version ${supportedVersion}.`,
    );
    this.name = "DatabaseSchemaVersionError";
    this.dbVersion = dbVersion;
    this.supportedVersion = supportedVersion;
  }
}

export class WalModeRequiredError extends Error {
  readonly journalMode: string;

  constructor(journalMode: string) {
    super(`state.db must stay in WAL mode, but PRAGMA journal_mode returned ${journalMode}.`);
    this.name = "WalModeRequiredError";
    this.journalMode = journalMode;
  }
}

export class ClosedDatabaseError extends Error {
  constructor() {
    super("This project database handle is closed.");
    this.name = "ClosedDatabaseError";
  }
}

export class WorldReadableProjectPathError extends Error {
  readonly projectDir: string;

  constructor(projectDir: string) {
    super(
      `Refusing to place state.db at ${projectDir}. Project files must stay inside the current user profile and must not use a world-readable path.`,
    );
    this.name = "WorldReadableProjectPathError";
    this.projectDir = projectDir;
  }
}

export class AttachedDatabaseForbiddenError extends Error {
  constructor() {
    super("ATTACH DATABASE is forbidden. Each database file has its own connection.");
    this.name = "AttachedDatabaseForbiddenError";
  }
}

export class NestedWriteTransactionError extends Error {
  constructor() {
    super("Nested BEGIN IMMEDIATE is forbidden.");
    this.name = "NestedWriteTransactionError";
  }
}

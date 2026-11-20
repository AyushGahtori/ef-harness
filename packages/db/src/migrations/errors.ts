import type { SqlRow } from "./types.js";

export class MigrationRegistryError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Migration registry is invalid: ${problems.join("; ")}`);
    this.name = "MigrationRegistryError";
    this.problems = problems;
  }
}

export class DatabaseNewerThanAppError extends Error {
  readonly dbPath: string;
  readonly userVersion: number;
  readonly maxKnownVersion: number;
  readonly backupPaths: readonly string[];

  constructor(input: {
    readonly dbPath: string;
    readonly userVersion: number;
    readonly maxKnownVersion: number;
    readonly backupPaths: readonly string[];
  }) {
    const listed =
      input.backupPaths.length === 0 ? "(none in backups/)" : input.backupPaths.join(", ");
    super(
      `Database user_version ${input.userVersion} is newer than this application's max known version ${input.maxKnownVersion}. Refusing to open or modify "${input.dbPath}". Pre-migration backups: ${listed}`,
    );
    this.name = "DatabaseNewerThanAppError";
    this.dbPath = input.dbPath;
    this.userVersion = input.userVersion;
    this.maxKnownVersion = input.maxKnownVersion;
    this.backupPaths = input.backupPaths;
  }
}

export class SchemaVersionGapError extends Error {
  readonly dbPath: string;
  readonly userVersion: number;
  readonly baselineSchemaVersion: number;

  constructor(dbPath: string, userVersion: number, baselineSchemaVersion: number) {
    super(
      `Database "${dbPath}" user_version ${userVersion} is below the pinned baseline schema version ${baselineSchemaVersion}, and no contiguous migration covers that gap`,
    );
    this.name = "SchemaVersionGapError";
    this.dbPath = dbPath;
    this.userVersion = userVersion;
    this.baselineSchemaVersion = baselineSchemaVersion;
  }
}

export class ReadersActiveError extends Error {
  readonly dbPath: string | undefined;

  constructor(message: string, options?: { readonly cause?: unknown; readonly dbPath?: string }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ReadersActiveError";
    this.dbPath = options?.dbPath;
  }
}

export class WorkNotParkedError extends Error {
  readonly dbPath: string;
  readonly activeWork: readonly string[];

  constructor(dbPath: string, activeWork: readonly string[]) {
    super(`Project work is not parked on "${dbPath}": ${activeWork.join(", ")}`);
    this.name = "WorkNotParkedError";
    this.dbPath = dbPath;
    this.activeWork = activeWork;
  }
}

export class InsufficientDiskSpaceError extends Error {
  readonly bytesNeeded: number;
  readonly bytesAvailable: number;
  readonly dbPath: string;

  constructor(input: { readonly dbPath: string; readonly bytesNeeded: number; readonly bytesAvailable: number }) {
    super(
      `Not enough disk space for the pre-migration VACUUM INTO backup of "${input.dbPath}": need exactly ${input.bytesNeeded} bytes (used pages × page size), ${input.bytesAvailable} available. The live database was not modified`,
    );
    this.name = "InsufficientDiskSpaceError";
    this.dbPath = input.dbPath;
    this.bytesNeeded = input.bytesNeeded;
    this.bytesAvailable = input.bytesAvailable;
  }
}

export class BackupVerificationError extends Error {
  readonly backupPath: string;

  constructor(backupPath: string, detail: string, options?: { readonly cause?: unknown }) {
    super(`Pre-migration backup "${backupPath}" failed verification: ${detail}`, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "BackupVerificationError";
    this.backupPath = backupPath;
  }
}

export class ForeignKeyIntegrityError extends Error {
  readonly rows: readonly SqlRow[];

  constructor(rows: readonly SqlRow[]) {
    super(`PRAGMA foreign_key_check returned ${rows.length} row(s); rebuild aborted`);
    this.name = "ForeignKeyIntegrityError";
    this.rows = rows;
  }
}

export class IntegrityCheckError extends Error {
  readonly failures: readonly string[];

  constructor(failures: readonly string[]) {
    super(`PRAGMA quick_check failed: ${failures.join("; ")}`);
    this.name = "IntegrityCheckError";
    this.failures = failures;
  }
}

export class SchemaInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaInvariantError";
  }
}

export class ViewInvariantError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ViewInvariantError";
  }
}

export class SearchIndexDriftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchIndexDriftError";
  }
}

export class RebuildContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RebuildContractError";
  }
}

export class MigrationFailedError extends Error {
  readonly backupPath: string | null;
  readonly restored: boolean;

  constructor(message: string, input: { readonly cause: unknown; readonly backupPath: string | null; readonly restored: boolean }) {
    super(message, { cause: input.cause });
    this.name = "MigrationFailedError";
    this.backupPath = input.backupPath;
    this.restored = input.restored;
  }
}

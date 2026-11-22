import { NewerSchemaVersionError } from "./errors.js";

export const CURRENT_SUPPORTED_SCHEMA_VERSION = 3;

export function newerSchemaMessage(openedByAppVersion: string): string {
  return `This project was opened by EF Harness ${openedByAppVersion} — please update this machine`;
}

export interface DatabaseStamp {
  readonly databaseName: "state.db" | "global.db";
  readonly schemaVersion: number;
  readonly openedByAppVersion: string;
}

/**
 * Older binaries refuse to mutate a database stamped by a newer app.
 * Call this before any statement that writes `state.db` or `global.db`.
 */
export class DowngradeProtectionGuard {
  constructor(private readonly currentSupportedVersion = CURRENT_SUPPORTED_SCHEMA_VERSION) {}

  assertCanOpen(stamp: DatabaseStamp): void {
    if (!Number.isInteger(stamp.schemaVersion) || stamp.schemaVersion > this.currentSupportedVersion) {
      throw new NewerSchemaVersionError(newerSchemaMessage(stamp.openedByAppVersion), stamp.databaseName);
    }
  }
}

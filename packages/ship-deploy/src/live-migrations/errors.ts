export class BackupRequiredBeforeLiveMigrationError extends Error {
  readonly code = "BackupRequiredBeforeLiveMigrationError" as const;

  constructor(detail: string) {
    super(`BackupRequiredBeforeLiveMigrationError: ${detail}`);
    this.name = "BackupRequiredBeforeLiveMigrationError";
  }
}

export class BackfillIncompleteError extends Error {
  readonly code = "BackfillIncompleteError" as const;
  readonly remaining: number;

  constructor(remaining: number) {
    super(`BackfillIncompleteError: ${remaining} rows still unmigrated`);
    this.name = "BackfillIncompleteError";
    this.remaining = remaining;
  }
}

export class DestructiveDdlInExpandError extends Error {
  readonly code = "DestructiveDdlInExpandError" as const;

  constructor(detail: string) {
    super(detail);
    this.name = "DestructiveDdlInExpandError";
  }
}

export class LockHazardBlockedError extends Error {
  readonly code = "LockHazardBlockedError" as const;

  constructor(detail: string) {
    super(detail);
    this.name = "LockHazardBlockedError";
  }
}

export class RehearsalCompatibilityError extends Error {
  readonly code = "RehearsalCompatibilityError" as const;

  constructor(detail: string) {
    super(`RehearsalCompatibilityError: ${detail}`);
    this.name = "RehearsalCompatibilityError";
  }
}

export class ApprovalRequiredError extends Error {
  readonly code = "ApprovalRequiredError" as const;

  constructor(detail: string) {
    super(`ApprovalRequiredError: ${detail}`);
    this.name = "ApprovalRequiredError";
  }
}

export class ExportRequiredBeforeContractError extends Error {
  readonly code = "ExportRequiredBeforeContractError" as const;

  constructor(detail: string) {
    super(`ExportRequiredBeforeContractError: ${detail}`);
    this.name = "ExportRequiredBeforeContractError";
  }
}

export class ActiveDeprecatedReferenceError extends Error {
  readonly code = "ActiveDeprecatedReferenceError" as const;

  constructor(detail: string) {
    super(`ActiveDeprecatedReferenceError: ${detail}`);
    this.name = "ActiveDeprecatedReferenceError";
  }
}

export class MigrationConflictError extends Error {
  readonly code = "MigrationConflictError" as const;

  constructor(detail: string) {
    super(`MigrationConflictError: ${detail}`);
    this.name = "MigrationConflictError";
  }
}

export class ContractBlockedError extends Error {
  readonly code = "ContractBlockedError" as const;

  constructor(detail: string) {
    super(`ContractBlockedError: ${detail}`);
    this.name = "ContractBlockedError";
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

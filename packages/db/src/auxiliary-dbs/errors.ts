export {
  AttachedDatabaseForbiddenError,
  ConnectionClosedError,
  NestedImmediateTransactionError as NestedWriteTransactionError,
  PragmaMismatchError,
  WalModeRequiredError,
} from "../driver/errors.js";

export class AuxiliaryDbError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class BrokerLockHeldError extends AuxiliaryDbError {
  constructor(lockPath: string) {
    super("BROKER_LOCK_HELD", `global broker single-writer lock is held: ${lockPath}`);
  }
}

export class GlobalDatabaseCorruptError extends AuxiliaryDbError {
  constructor(detail: string) {
    super("GLOBAL_DATABASE_CORRUPT", `global.db failed integrity checks: ${detail}`);
  }
}

export class DatabaseCorruptError extends AuxiliaryDbError {
  constructor(detail: string) {
    super("DATABASE_CORRUPT", detail);
  }
}

export class DeviceIdMissingError extends AuxiliaryDbError {
  constructor() {
    super("DEVICE_ID_MISSING", "global.db is missing its permanent device_id");
  }
}

export class DeviceIdInvalidError extends AuxiliaryDbError {
  constructor() {
    super("DEVICE_ID_INVALID", "device_id must be a 128-bit lowercase hex string");
  }
}

export class DeviceIdImmutableError extends AuxiliaryDbError {
  constructor(detail = "device_id is immutable") {
    super("DEVICE_ID_IMMUTABLE", detail);
  }
}

export class GlobalSchemaVersionError extends AuxiliaryDbError {
  constructor(actual: number) {
    super("GLOBAL_SCHEMA_VERSION", `global.db user_version must be 1, received ${actual}`);
  }
}

export class InvalidProjectPathError extends AuxiliaryDbError {
  constructor(detail: string) {
    super("INVALID_PROJECT_PATH", detail);
  }
}

export class InvalidProjectIdError extends AuxiliaryDbError {
  constructor(projectId: string) {
    super("INVALID_PROJECT_ID", `project id is not safe to use as a directory name: ${projectId}`);
  }
}

export class DuplicateProjectPathError extends AuxiliaryDbError {
  constructor(projectPath: string) {
    super("DUPLICATE_PROJECT_PATH", `a project is already registered at ${projectPath}`);
  }
}

export class ProjectAlreadyExistsError extends AuxiliaryDbError {
  constructor(projectId: string) {
    super("PROJECT_EXISTS", `project ${projectId} is already registered`);
  }
}

export class ProjectNotFoundError extends AuxiliaryDbError {
  constructor(projectId: string) {
    super("PROJECT_NOT_FOUND", `project ${projectId} is not registered`);
  }
}

export class InvalidProjectStatusError extends AuxiliaryDbError {
  constructor(status: string) {
    super("INVALID_PROJECT_STATUS", `unknown project status ${status}`);
  }
}

export class InvalidSettingValueError extends AuxiliaryDbError {
  constructor(detail: string) {
    super("INVALID_SETTING_VALUE", detail);
  }
}

export class VaultRefSecretError extends AuxiliaryDbError {
  constructor() {
    super(
      "VAULT_REF_SECRET",
      "connections.vault_ref must be a Credential Manager reference name, never an API key",
    );
  }
}

export class PortOutOfRangeError extends AuxiliaryDbError {
  constructor(port: number) {
    super("PORT_OUT_OF_RANGE", `port ${port} is outside the exclusive lease range 41000-48999`);
  }
}

export class PortLeaseConflictError extends AuxiliaryDbError {
  constructor(port: number) {
    super("PORT_LEASE_CONFLICT", `port ${port} is already leased`);
  }
}

export class PortLeaseNotFoundError extends AuxiliaryDbError {
  constructor(port: number) {
    super("PORT_LEASE_NOT_FOUND", `port ${port} is not leased`);
  }
}

export class PortPoolExhaustedError extends AuxiliaryDbError {
  constructor() {
    super("PORT_POOL_EXHAUSTED", "every port in 41000-48999 is leased");
  }
}

export class InvalidTelemetryEventError extends AuxiliaryDbError {
  constructor(detail: string) {
    super("INVALID_TELEMETRY_EVENT", detail);
  }
}

export class InvalidCodeIndexEntryError extends AuxiliaryDbError {
  constructor(detail: string) {
    super("INVALID_CODE_INDEX_ENTRY", detail);
  }
}

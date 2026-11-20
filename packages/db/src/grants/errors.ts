export class GrantProtocolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class AttachedDatabaseForbiddenError extends GrantProtocolError {
  constructor() {
    super(
      "attached_database_forbidden",
      "ATTACH is forbidden. global.db and state.db never share a SQLite transaction.",
    );
  }
}

export class WrongDatabaseRoleError extends GrantProtocolError {
  constructor(expected: "global" | "state", actual: string) {
    super(
      "wrong_database_role",
      `Expected a ${expected} database connection, received ${actual}.`,
    );
  }
}

export class WalModeRequiredError extends GrantProtocolError {
  constructor(actual: string) {
    super("wal_mode_required", `journal_mode must be wal, received ${actual}.`);
  }
}

export class WriteOutsideImmediateTransactionError extends GrantProtocolError {
  constructor() {
    super(
      "write_outside_immediate_transaction",
      "Grant writes must run inside BEGIN IMMEDIATE.",
    );
  }
}

export class NestedImmediateTransactionError extends GrantProtocolError {
  constructor() {
    super(
      "nested_immediate_transaction",
      "Nested BEGIN IMMEDIATE is forbidden on a grant connection.",
    );
  }
}

export class QueryCatalogError extends GrantProtocolError {
  constructor(message: string) {
    super("query_catalog", message);
  }
}

export class MissingQueryParameterError extends GrantProtocolError {
  constructor(queryName: string, parameter: string) {
    super("missing_query_parameter", `${queryName} is missing :${parameter}.`);
  }
}

export class UnknownCanonicalQueryError extends GrantProtocolError {
  constructor(queryName: string) {
    super("unknown_canonical_query", `Unknown canonical query ${queryName}.`);
  }
}

export class NonIntegerUnitsError extends GrantProtocolError {
  constructor(field: string) {
    super("non_integer_units", `${field} must be a safe integer.`);
  }
}

export class InvalidGrantIdentifierError extends GrantProtocolError {
  constructor(field: string) {
    super("invalid_grant_identifier", `${field} must be a non-empty identifier.`);
  }
}

export class InvalidPriorityClassError extends GrantProtocolError {
  constructor(value: string) {
    super("invalid_priority_class", `Unsupported grant priority class ${value}.`);
  }
}

export class InvalidGrantWindowError extends GrantProtocolError {
  constructor() {
    super("invalid_grant_window", "expiresAt must be greater than issuedAt.");
  }
}

export class UnknownConnectionError extends GrantProtocolError {
  constructor(connectionId: string) {
    super("unknown_connection", `Connection ${connectionId} is not in global.db.`);
  }
}

export class UnknownProjectError extends GrantProtocolError {
  constructor(projectId: string) {
    super("unknown_project", `Project ${projectId} is not in global.db.`);
  }
}

export class CurrencyMismatchError extends GrantProtocolError {
  constructor(connectionId: string, expected: string, actual: string) {
    super(
      "currency_mismatch",
      `Connection ${connectionId} uses ${expected}, not ${actual}.`,
    );
  }
}

export class UnsupportedCurrencyError extends GrantProtocolError {
  constructor(currency: string) {
    super(
      "unsupported_currency",
      `Currency ${currency} is not usd, allowance:<id>, or slots:<id>.`,
    );
  }
}

export class NoActiveConnectionWindowError extends GrantProtocolError {
  constructor(connectionId: string, at: number) {
    super(
      "no_active_connection_window",
      `Connection ${connectionId} has no window covering ${at}.`,
    );
  }
}

export class InsufficientWindowHeadroomError extends GrantProtocolError {
  readonly connectionId: string;
  readonly windowKind: string;
  readonly headroomUnits: number;
  readonly requestedUnits: number;

  constructor(
    connectionId: string,
    windowKind: string,
    headroomUnits: number,
    requestedUnits: number,
  ) {
    super(
      "insufficient_window_headroom",
      `Connection ${connectionId} window ${windowKind} has ${headroomUnits} units of headroom, requested ${requestedUnits}.`,
    );
    this.connectionId = connectionId;
    this.windowKind = windowKind;
    this.headroomUnits = headroomUnits;
    this.requestedUnits = requestedUnits;
  }
}

export class WindowAccountingError extends GrantProtocolError {
  constructor(message: string) {
    super("window_accounting", message);
  }
}

export class GrantNotFoundError extends GrantProtocolError {
  constructor(grantId: string) {
    super("grant_not_found", `Grant ${grantId} was not found.`);
  }
}

export class GrantNotClosedError extends GrantProtocolError {
  constructor(grantId: string) {
    super("grant_not_closed", `Grant ${grantId} has no local closure receipt yet.`);
  }
}

export class ClosureConflictError extends GrantProtocolError {
  constructor(grantId: string) {
    super(
      "closure_conflict",
      `Grant ${grantId} is already closed with different used_units or unknown_units.`,
    );
  }
}

export class UnknownReconciliationError extends GrantProtocolError {
  constructor(message: string) {
    super("unknown_reconciliation", message);
  }
}

export class ProjectSafeModeError extends GrantProtocolError {
  constructor() {
    super("project_safe_mode", "state.db is in safe mode and refuses grant writes.");
  }
}

export class ProjectMismatchError extends GrantProtocolError {
  constructor(expected: string, actual: string) {
    super("project_mismatch", `state.db belongs to ${expected}, message names ${actual}.`);
  }
}

export class GrantsHeldForRecoveryError extends GrantProtocolError {
  constructor() {
    super(
      "grants_held_for_recovery",
      "New grants are held until expired project grants are closed and queued for broker reporting.",
    );
  }
}

export class CrossDatabasePathError extends GrantProtocolError {
  constructor() {
    super(
      "cross_database_path",
      "Broker and project grant connections must be different database files.",
    );
  }
}

export class RealDatabaseFileRequiredError extends GrantProtocolError {
  constructor() {
    super(
      "real_database_file_required",
      "The grant protocol requires separate on-disk global.db and state.db files.",
    );
  }
}

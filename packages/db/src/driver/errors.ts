export interface ForeignKeyDiagnostic {
  readonly table: string;
  readonly rowid: number | bigint | null;
  readonly parent: string;
  readonly fkid: number | bigint | null;
}

export class AttachedDatabaseForbiddenError extends Error {
  readonly code = "ATTACH_FORBIDDEN";

  constructor() {
    super("ATTACH DATABASE is forbidden. No transaction may span two database files.");
    this.name = "AttachedDatabaseForbiddenError";
  }
}

export class WalModeRequiredError extends Error {
  readonly code = "WAL_MODE_REQUIRED";

  constructor(
    readonly location: string,
    readonly journalMode: string,
  ) {
    super(
      `SQLite did not enter WAL journal mode for ${location} (journal_mode=${journalMode}).`,
    );
    this.name = "WalModeRequiredError";
  }
}

export class PragmaMismatchError extends Error {
  readonly code = "PRAGMA_MISMATCH";

  constructor(
    readonly pragma: string,
    readonly expected: string | number,
    readonly actual: unknown,
  ) {
    super(`PRAGMA ${pragma} is ${String(actual)}, expected ${String(expected)}.`);
    this.name = "PragmaMismatchError";
  }
}

export class DeferredBeginForbiddenError extends Error {
  readonly code = "DEFERRED_BEGIN_FORBIDDEN";

  constructor() {
    super("Write transactions must start with BEGIN IMMEDIATE, never deferred BEGIN.");
    this.name = "DeferredBeginForbiddenError";
  }
}

export class NestedImmediateTransactionError extends Error {
  readonly code = "NESTED_IMMEDIATE_TRANSACTION";

  constructor() {
    super("Nested BEGIN IMMEDIATE is forbidden. Use a SAVEPOINT inside the open write transaction.");
    this.name = "NestedImmediateTransactionError";
  }
}

export class ForeignKeyConstraintError extends Error {
  readonly code = "SQLITE_CONSTRAINT_FOREIGNKEY";
  readonly errcode = 787;

  constructor(
    readonly diagnostics: readonly ForeignKeyDiagnostic[],
    cause: unknown,
  ) {
    const detail =
      diagnostics.length === 0
        ? "FOREIGN KEY constraint failed at COMMIT."
        : `FOREIGN KEY constraint failed at COMMIT: ${diagnostics
            .map((row) => `${row.table} row ${String(row.rowid)} -> ${row.parent} (${String(row.fkid)})`)
            .join("; ")}.`;
    super(detail, cause instanceof Error ? { cause } : undefined);
    this.name = "ForeignKeyConstraintError";
  }
}

export class SqliteBusyError extends Error {
  readonly code = "SQLITE_BUSY";
  readonly errcode = 5;

  constructor(
    readonly attempts: number,
    cause: unknown,
  ) {
    super(`SQLite remained locked after ${attempts} whole-transaction attempts.`, {
      cause: cause instanceof Error ? cause : undefined,
    });
    this.name = "SqliteBusyError";
  }
}

export class ConnectionClosedError extends Error {
  readonly code = "CONNECTION_CLOSED";

  constructor() {
    super("SQLite connection is closed.");
    this.name = "ConnectionClosedError";
  }
}

export class StatementFinalizedError extends Error {
  readonly code = "STATEMENT_FINALIZED";

  constructor() {
    super("SQLite statement is finalized.");
    this.name = "StatementFinalizedError";
  }
}

export class UnknownQueryError extends Error {
  readonly code = "UNKNOWN_QUERY";

  constructor(readonly queryName: string) {
    super(`Unknown query "${queryName}". Names come from schema/queries.sql.`);
    this.name = "UnknownQueryError";
  }
}

export class DuplicateQueryNameError extends Error {
  readonly code = "DUPLICATE_QUERY";

  constructor(readonly queryName: string) {
    super(`Query "${queryName}" is declared more than once in schema/queries.sql.`);
    this.name = "DuplicateQueryNameError";
  }
}

export class ParameterMismatchError extends Error {
  readonly code = "PARAMETER_MISMATCH";
  readonly queryName?: string;

  constructor(
    readonly expected: readonly string[],
    readonly missing: readonly string[],
    readonly extra: readonly string[],
    queryName?: string,
  ) {
    const target = queryName === undefined ? "statement" : `query "${queryName}"`;
    const parts = [
      missing.length > 0 ? `missing ${missing.join(", ")}` : "",
      extra.length > 0 ? `unexpected ${extra.join(", ")}` : "",
    ].filter((part) => part !== "");
    super(`Parameter mismatch for ${target}: ${parts.join("; ")}.`);
    this.name = "ParameterMismatchError";
    if (queryName !== undefined) this.queryName = queryName;
  }
}

export class ReaderBudgetError extends Error {
  readonly code = "READER_BUDGET";

  constructor(message: string) {
    super(message);
    this.name = "ReaderBudgetError";
  }
}

export class ReaderTimeoutError extends Error {
  readonly code = "READER_TIMEOUT";

  constructor(
    readonly timeoutMs: number,
    readonly readerClass: "ui" | "export",
  ) {
    super(`Read-only ${readerClass} query exceeded ${timeoutMs} ms and its worker was recycled.`);
    this.name = "ReaderTimeoutError";
  }
}

export function sqliteErrcode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("errcode" in error)) return undefined;
  const value = error.errcode;
  return typeof value === "number" ? value : undefined;
}

export function isSqliteBusy(error: unknown): boolean {
  const errcode = sqliteErrcode(error);
  if (errcode !== undefined && (errcode & 0xff) === 5) return true;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "SQLITE_BUSY" || code === "ERR_SQLITE_BUSY") return true;
  }
  const message = error instanceof Error ? error.message : "";
  return /database is locked|sqlite_busy/i.test(message);
}

export function isForeignKeyConstraint(error: unknown): boolean {
  const errcode = sqliteErrcode(error);
  if (errcode === 787) return true;
  const message = error instanceof Error ? error.message : "";
  return /foreign key constraint failed/i.test(message);
}

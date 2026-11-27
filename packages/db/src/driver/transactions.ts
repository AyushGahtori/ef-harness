import { getRandomValues } from "node:crypto";
import type { SavepointOptions, SqliteConnection, TransactionOptions } from "./types.js";
import {
  ForeignKeyConstraintError,
  isForeignKeyConstraint,
  isSqliteBusy,
  NestedImmediateTransactionError,
  SqliteBusyError,
  type ForeignKeyDiagnostic,
} from "./errors.js";
import { firstCell, pragmaEquals } from "./values.js";

export type { SavepointOptions, TransactionOptions };

const DEFAULT_ATTEMPTS = 4;

export function runImmediateTx<T>(
  connection: SqliteConnection,
  work: () => T,
  options?: TransactionOptions,
): T {
  if (connection.inImmediateTransaction) throw new NestedImmediateTransactionError();
  const maxAttempts = options?.maxAttempts ?? DEFAULT_ATTEMPTS;
  const sleep = options?.sleep ?? sleepSync;
  const random = options?.random ?? randomUnit;
  let lastBusy: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return runImmediateOnce(connection, work);
    } catch (error) {
      if (error instanceof ForeignKeyConstraintError) throw error;
      if (!isSqliteBusy(error)) throw error;
      lastBusy = error;
      if (attempt === maxAttempts) throw new SqliteBusyError(attempt, error);
      sleep(jitterMs(random));
    }
  }
  throw new SqliteBusyError(maxAttempts, lastBusy);
}

export function runSavepoint<T>(connection: SqliteConnection, work: () => T, options?: SavepointOptions): T {
  if (!connection.inImmediateTransaction) {
    return runImmediateTx(connection, () => runSavepoint(connection, work, options));
  }
  const name = savepointName(options?.name);
  connection.exec(`SAVEPOINT ${name}`);
  try {
    const result = work();
    connection.exec(`RELEASE ${name}`);
    return result;
  } catch (error) {
    rollbackSavepoint(connection, name);
    throw error;
  }
}

export function runReadOnlyTx<T>(connection: SqliteConnection, work: () => T): T {
  if (connection.inImmediateTransaction || connection.inTransaction) return work();
  const queryOnly = pragmaEquals(firstCell(connection.pragma("query_only")), 1);
  if (!queryOnly) connection.pragma("query_only = ON");
  try {
    connection.exec("BEGIN");
    try {
      const result = work();
      if (connection.inTransaction) connection.exec("ROLLBACK");
      return result;
    } catch (error) {
      if (connection.inTransaction) connection.exec("ROLLBACK");
      throw error;
    }
  } finally {
    if (!queryOnly) connection.pragma("query_only = OFF");
  }
}

export function randomUnit(): number {
  const buffer = new Uint32Array(1);
  getRandomValues(buffer);
  return (buffer[0] ?? 0) / 0x1_0000_0000;
}

export function sleepSync(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runImmediateOnce<T>(connection: SqliteConnection, work: () => T): T {
  connection.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    try {
      connection.exec("COMMIT");
    } catch (commitError) {
      if (isForeignKeyConstraint(commitError)) {
        const diagnostics = readForeignKeyDiagnostics(connection);
        rollbackIfOpen(connection);
        throw new ForeignKeyConstraintError(diagnostics, commitError);
      }
      rollbackIfOpen(connection);
      throw commitError;
    }
    return result;
  } catch (error) {
    if (!(error instanceof ForeignKeyConstraintError)) rollbackIfOpen(connection);
    throw error;
  }
}

function readForeignKeyDiagnostics(connection: SqliteConnection): ForeignKeyDiagnostic[] {
  let rows: unknown[] = [];
  try {
    rows = connection.all("PRAGMA foreign_key_check");
  } catch (checkError: unknown) {
    const message = checkError instanceof Error ? checkError.message : "";
    void message;
    return [];
  }
  return rows.map((row) => {
    const record = row !== null && typeof row === "object" ? row : {};
    const table = Reflect.get(record, "table");
    const rowid = Reflect.get(record, "rowid");
    const parent = Reflect.get(record, "parent");
    const fkid = Reflect.get(record, "fkid");
    return {
      table: typeof table === "string" ? table : String(table ?? ""),
      rowid: typeof rowid === "number" || typeof rowid === "bigint" ? rowid : null,
      parent: typeof parent === "string" ? parent : String(parent ?? ""),
      fkid: typeof fkid === "number" || typeof fkid === "bigint" ? fkid : null,
    };
  });
}

function rollbackIfOpen(connection: SqliteConnection): void {
  if (!connection.inTransaction) return;
  connection.exec("ROLLBACK");
}

function rollbackSavepoint(connection: SqliteConnection, name: string): void {
  if (!connection.inTransaction) return;
  connection.exec(`ROLLBACK TO ${name}`);
  connection.exec(`RELEASE ${name}`);
}

let savepointSequence = 0;

function savepointName(requested: string | undefined): string {
  if (requested === undefined) {
    savepointSequence += 1;
    return `ef_sp_${savepointSequence}`;
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(requested)) {
    throw new Error(`Savepoint name "${requested}" must be a bare SQL identifier.`);
  }
  return requested;
}

function jitterMs(random: () => number): number {
  const min = 5;
  const max = 40;
  return min + Math.floor(random() * (max - min + 1));
}

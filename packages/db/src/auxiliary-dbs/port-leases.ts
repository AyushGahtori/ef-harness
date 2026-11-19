import {
  AuxiliaryDbError,
  PortLeaseConflictError,
  PortLeaseNotFoundError,
  PortOutOfRangeError,
  PortPoolExhaustedError,
  ProjectNotFoundError,
} from "./errors.js";
import { assertNonEmpty, assertSafeInteger, optionalInt, requiredInt, requiredText } from "./rows.js";
import { isSqliteConstraint, type SqliteConnection } from "./sqlite-connection.js";
import type { LeasePortInput, PortLease } from "./types.js";

export const PORT_MIN = 41_000;
export const PORT_MAX = 48_999;

export function leasePort(connection: SqliteConnection, input: LeasePortInput): PortLease {
  const environment = assertNonEmpty(input.environment, "environment");
  const leasedAt = assertSafeInteger(input.leasedAt, "leasedAt");
  const projectId = assertNonEmpty(input.projectId, "projectId");
  const requested = input.port;
  if (requested !== undefined) assertPortInRange(requested);
  const expiresAt = input.expiresAt === undefined ? null : input.expiresAt;
  if (expiresAt !== null) {
    assertSafeInteger(expiresAt, "expiresAt");
    if (expiresAt < leasedAt) {
      throw new AuxiliaryDbError("INVALID_LEASE_EXPIRY", "expiresAt is earlier than leasedAt");
    }
  }
  const inTransaction = connection.inTransaction();
  const allocate = (): PortLease => {
    const project = connection.get("SELECT id FROM projects WHERE id = ?", projectId);
    if (project === undefined) throw new ProjectNotFoundError(projectId);
    connection.run(
      "DELETE FROM port_leases WHERE expires_at IS NOT NULL AND expires_at <= ?",
      leasedAt,
    );
    const port = requested ?? nextFreePort(connection);
    try {
      connection.run(
        `INSERT INTO port_leases(port, project, environment, leased_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        port,
        projectId,
        environment,
        leasedAt,
        expiresAt,
      );
    } catch (error) {
      if (isSqliteConstraint(error)) throw new PortLeaseConflictError(port);
      throw error;
    }
    return readLease(connection, port);
  };
  if (inTransaction) return allocate();
  return connection.runImmediate(allocate);
}

export function releasePort(connection: SqliteConnection, port: number): void {
  assertPortInRange(port);
  const run = (): void => {
    const result = connection.run("DELETE FROM port_leases WHERE port = ?", port);
    if (result.changes === 0) throw new PortLeaseNotFoundError(port);
  };
  if (connection.inTransaction()) {
    run();
    return;
  }
  connection.runImmediate(run);
}

export function expirePortLeases(connection: SqliteConnection, now: number): number {
  assertSafeInteger(now, "now");
  const run = (): number => {
    const result = connection.run(
      "DELETE FROM port_leases WHERE expires_at IS NOT NULL AND expires_at <= ?",
      now,
    );
    return result.changes;
  };
  if (connection.inTransaction()) return run();
  return connection.runImmediate(run);
}

export function listPortLeases(connection: SqliteConnection): readonly PortLease[] {
  return connection
    .all(
      `SELECT port, project, environment, leased_at, expires_at
       FROM port_leases
       ORDER BY port`,
    )
    .map(mapLease);
}

export function assertPortInRange(port: number): void {
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
    throw new PortOutOfRangeError(port);
  }
}

function nextFreePort(connection: SqliteConnection): number {
  const used = new Set(
    connection.all("SELECT port FROM port_leases").map((row) => requiredInt(row, "port")),
  );
  for (let port = PORT_MIN; port <= PORT_MAX; port += 1) {
    if (!used.has(port)) return port;
  }
  throw new PortPoolExhaustedError();
}

function readLease(connection: SqliteConnection, port: number): PortLease {
  const row = connection.get(
    `SELECT port, project, environment, leased_at, expires_at
     FROM port_leases
     WHERE port = ?`,
    port,
  );
  if (row === undefined) throw new PortLeaseNotFoundError(port);
  return mapLease(row);
}

function mapLease(row: Parameters<typeof requiredText>[0]): PortLease {
  return {
    port: requiredInt(row, "port"),
    projectId: requiredText(row, "project"),
    environment: requiredText(row, "environment"),
    leasedAt: requiredInt(row, "leased_at"),
    expiresAt: optionalInt(row, "expires_at"),
  };
}

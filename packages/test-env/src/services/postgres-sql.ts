export interface SqlCommand {
  readonly sql: string;
  readonly params: readonly unknown[];
}

export const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;

/** Extensions shipped with the embedded Windows build. pgvector and postgis are absent. */
export const EMBEDDED_POSTGRES_EXTENSIONS = ["plpgsql", "pgcrypto", "uuid-ossp", "citext"] as const;

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export function assertSqlIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) {
    throw new Error(`refusing unsafe SQL identifier: ${value}`);
  }
  return value;
}

export function quoteIdent(value: string): string {
  return `"${assertSqlIdentifier(value)}"`;
}

export function postgresDatabaseName(envId: string): string {
  const cleaned = envId
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "");
  if (!cleaned) throw new Error("environment id does not yield a database name");
  const named = cleaned.startsWith("env_") ? cleaned : `env_${cleaned}`;
  return assertSqlIdentifier(named);
}

export function statementTimeoutOption(statementTimeoutMs: number): string {
  if (!Number.isInteger(statementTimeoutMs) || statementTimeoutMs < 1) {
    throw new Error("statement_timeout must be a positive integer number of milliseconds");
  }
  return `-c statement_timeout=${statementTimeoutMs}`;
}

export function postgresConnectionString(input: {
  readonly user: string;
  readonly password: string;
  readonly port: number;
  readonly database: string;
  readonly statementTimeoutMs: number;
}): string {
  const database = assertSqlIdentifier(input.database);
  const user = assertSqlIdentifier(input.user);
  const options = encodeURIComponent(statementTimeoutOption(input.statementTimeoutMs));
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(input.password)}@127.0.0.1:${input.port}/${database}?options=${options}`;
}

export function buildCreateDatabaseCommands(input: {
  readonly database: string;
  readonly password: string;
  readonly templateDatabase?: string;
  readonly statementTimeoutMs: number;
}): SqlCommand[] {
  const database = quoteIdent(input.database);
  if (!/^[0-9a-f]+$/i.test(input.password)) {
    throw new Error("refusing a postgres password that is not hexadecimal");
  }
  const timeout = String(input.statementTimeoutMs);
  if (!/^[0-9]+$/.test(timeout)) throw new Error("statement_timeout is not numeric");
  const createDatabase = input.templateDatabase
    ? `CREATE DATABASE ${database} TEMPLATE ${quoteIdent(input.templateDatabase)} OWNER ${database}`
    : `CREATE DATABASE ${database} OWNER ${database}`;
  return [
    { sql: `CREATE ROLE ${database} LOGIN PASSWORD '${input.password}'`, params: [] },
    { sql: createDatabase, params: [] },
    { sql: `ALTER ROLE ${database} SET statement_timeout = '${timeout}'`, params: [] },
  ];
}

/**
 * Teardown order: revoke connect, terminate backends for that database only,
 * then drop the database. `pid <> pg_backend_pid()` keeps the admin session alive.
 */
export function buildDropDatabaseCommands(database: string): SqlCommand[] {
  const ident = quoteIdent(database);
  return [
    { sql: `REVOKE CONNECT ON DATABASE ${ident} FROM PUBLIC`, params: [] },
    { sql: `REVOKE CONNECT ON DATABASE ${ident} FROM ${ident}`, params: [] },
    {
      sql: "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      params: [database],
    },
    { sql: `DROP DATABASE IF EXISTS ${ident}`, params: [] },
    { sql: `DROP ROLE IF EXISTS ${ident}`, params: [] },
  ];
}

export const LIVE_EXTENSION_SQL = "SELECT name FROM pg_available_extensions WHERE name = $1";

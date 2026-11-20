import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { parseCopyField, quoteIdent, sqlParam } from "./sql.js";
import type {
  DataValue,
  EmbeddedPostgresProviderPort,
  PostgresSession,
  QueryResult,
  SqlPrimitive,
} from "./types.js";

interface DatabaseState {
  readonly file: string;
  allowConnections: boolean;
  connections: number;
  readonly sessions: Set<SimulatedSession>;
}

/**
 * In-process Postgres catalog stand-in backed by SQLite files.
 * Task 050's EmbeddedPostgresProvider replaces this port without changing the SQL the manager runs.
 */
export class SimulatedEmbeddedPostgres implements EmbeddedPostgresProviderPort {
  readonly events: string[] = [];
  private readonly databases = new Map<string, DatabaseState>();

  constructor(private readonly rootDir: string) {
    fs.mkdirSync(rootDir, { recursive: true });
    this.createEmpty("postgres", true);
  }

  async connectAdmin(): Promise<PostgresSession> {
    return this.connectDatabase("postgres");
  }

  async connectDatabase(database: string): Promise<PostgresSession> {
    const state = this.require(database);
    if (!state.allowConnections) {
      throw new Error(`ERROR: database "${database}" is not currently accepting connections`);
    }
    state.connections += 1;
    this.events.push(`connect:${database}`);
    const db = new DatabaseSync(state.file, { enableForeignKeyConstraints: true });
    db.exec("PRAGMA foreign_keys = ON");
    const session = new SimulatedSession(this, database, db);
    state.sessions.add(session);
    return session;
  }

  async closeDatabasePool(database: string): Promise<void> {
    this.events.push(`close-pool:${database}`);
    const state = this.databases.get(database);
    if (!state) return;
    for (const session of [...state.sessions]) {
      await session.close();
    }
  }

  fileFor(database: string): string {
    return this.require(database).file;
  }

  interpret(database: string, sql: string, params: readonly SqlPrimitive[] = []): QueryResult | null {
    const text = sql.trim().replace(/;\s*$/, "");
    const compact = text.replace(/\s+/g, " ");
    const create = /^CREATE DATABASE ("?[A-Za-z_][A-Za-z0-9_]*"?)(?: TEMPLATE ("?[A-Za-z_][A-Za-z0-9_]*"?))?$/i.exec(
      compact,
    );
    if (create?.[1]) {
      const name = unquote(create[1]);
      const template = create[2] ? unquote(create[2]) : undefined;
      this.createDatabase(name, template);
      return { rows: [], rowCount: 0 };
    }
    const alter =
      /^ALTER DATABASE ("?[A-Za-z_][A-Za-z0-9_]*"?) WITH ALLOW_CONNECTIONS (true|false)$/i.exec(
        compact,
      );
    if (alter?.[1] && alter[2]) {
      const name = unquote(alter[1]);
      const allow = alter[2].toLowerCase() === "true";
      this.require(name).allowConnections = allow;
      this.events.push(`allow:${name}:${allow}`);
      return { rows: [], rowCount: 0 };
    }
    const drop = /^DROP DATABASE (?:IF EXISTS )?("?[A-Za-z_][A-Za-z0-9_]*"?)$/i.exec(compact);
    if (drop?.[1]) {
      this.dropDatabase(unquote(drop[1]));
      return { rows: [], rowCount: 0 };
    }
    if (/^SELECT pg_terminate_backend\b/i.test(compact)) {
      const named = typeof params[0] === "string" ? params[0] : database;
      this.events.push(`terminate:${named}`);
      const state = this.databases.get(named);
      if (state) {
        for (const session of [...state.sessions]) session.forceClose();
        state.connections = 0;
      }
      return { rows: [], rowCount: 0 };
    }
    return null;
  }

  release(database: string, session: SimulatedSession): void {
    const state = this.databases.get(database);
    if (!state) return;
    if (state.sessions.delete(session)) {
      state.connections = Math.max(0, state.connections - 1);
      this.events.push(`close:${database}`);
    }
  }

  private createDatabase(name: string, template?: string): void {
    if (this.databases.has(name)) {
      throw new Error(`ERROR: database "${name}" already exists`);
    }
    if (!template) {
      this.events.push(`create:${name}`);
      this.createEmpty(name, true);
      return;
    }
    const source = this.require(template);
    if (source.connections > 0) {
      throw new Error(`ERROR: source database "${template}" is being accessed by other users`);
    }
    this.events.push(`clone:${name}:from:${template}`);
    const file = this.databaseFile(name);
    fs.copyFileSync(source.file, file);
    fs.chmodSync(file, 0o644);
    this.databases.set(name, {
      file,
      allowConnections: true,
      connections: 0,
      sessions: new Set(),
    });
  }

  private createEmpty(name: string, allowConnections: boolean): void {
    const file = this.databaseFile(name);
    const db = new DatabaseSync(file);
    db.close();
    this.databases.set(name, {
      file,
      allowConnections,
      connections: 0,
      sessions: new Set(),
    });
  }

  private dropDatabase(name: string): void {
    const state = this.databases.get(name);
    if (!state) return;
    for (const session of [...state.sessions]) session.forceClose();
    this.databases.delete(name);
    if (fs.existsSync(state.file)) {
      fs.chmodSync(state.file, 0o666);
      fs.rmSync(state.file, { force: true });
    }
    this.events.push(`drop:${name}`);
  }

  private require(name: string): DatabaseState {
    const state = this.databases.get(name);
    if (!state) throw new Error(`ERROR: database "${name}" does not exist`);
    return state;
  }

  private databaseFile(name: string): string {
    return path.join(this.rootDir, `${name}.sqlite`);
  }
}

class SimulatedSession implements PostgresSession {
  private closed = false;

  constructor(
    private readonly cluster: SimulatedEmbeddedPostgres,
    private readonly database: string,
    private readonly db: DatabaseSync,
  ) {}

  async query(sql: string, params: readonly SqlPrimitive[] = []): Promise<QueryResult> {
    this.assertOpen();
    const catalog = this.cluster.interpret(this.database, sql, params);
    if (catalog) return catalog;
    const preparedSql = sql.replace(/\$(\d+)/g, "?");
    const trimmed = preparedSql.trim().toLowerCase();
    const bound = params.map((value) => (value === null ? null : value)) as SQLInputValue[];
    if (trimmed.startsWith("select") || trimmed.startsWith("pragma") || trimmed.startsWith("with")) {
      const rows = this.db.prepare(preparedSql).all(...bound);
      return { rows, rowCount: rows.length };
    }
    if (trimmed.startsWith("insert") || trimmed.startsWith("update") || trimmed.startsWith("delete")) {
      const result = this.db.prepare(preparedSql).run(...bound);
      return { rows: [], rowCount: Number(result.changes) };
    }
    this.db.exec(preparedSql);
    return { rows: [], rowCount: 0 };
  }

  async copyFromStdin(sql: string, stdin: string): Promise<void> {
    this.assertOpen();
    const match = /^COPY\s+("?[A-Za-z_][A-Za-z0-9_]*"?)\s*\(([^)]*)\)/i.exec(sql.trim());
    if (!match?.[1] || !match[2]) throw new Error(`Unsupported COPY statement: ${sql}`);
    const table = unquote(match[1]);
    const columns = match[2].split(",").map((column) => unquote(column.trim()));
    const statement = this.db.prepare(
      `INSERT INTO ${quoteIdent(table)} (${columns.map((column) => quoteIdent(column)).join(", ")}) VALUES (${columns
        .map(() => "?")
        .join(", ")})`,
    );
    const lines = stdin.split(/\n/).filter((line) => line.length > 0);
    for (const line of lines) {
      const fields = splitCopyLine(line).map((field) => parseCopyField(field));
      statement.run(...fields.map((value) => bindCopy(value)));
    }
    this.cluster.events.push(`copy:${this.database}:${table}:${lines.length}`);
  }

  async close(): Promise<void> {
    this.forceClose();
  }

  forceClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
    this.cluster.release(this.database, this);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error(`Connection to ${this.database} is closed`);
  }
}

function bindCopy(value: DataValue): SQLInputValue {
  const param = sqlParam(value);
  return param === null ? null : param;
}

function unquote(identifier: string): string {
  const trimmed = identifier.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
  return trimmed;
}

function splitCopyLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\\" && index + 1 < line.length) {
      current += char + (line[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (char === "\t") {
      fields.push(current);
      current = "";
      continue;
    }
    current += char ?? "";
  }
  fields.push(current);
  return fields;
}
